import requests
import json
import os
import base64
import io

OLLAMA_HOST = os.getenv("OLLAMA_HOST")
if not OLLAMA_HOST:
    raise ValueError("OLLAMA_HOST non défini dans le .env")

BOOKSTACK_TOKEN_ID = os.getenv("BOOKSTACK_TOKEN_ID", "")
BOOKSTACK_TOKEN_SECRET = os.getenv("BOOKSTACK_TOKEN_SECRET", "")

OLLAMA_URL = f"http://{OLLAMA_HOST}:11434/api/chat"


def _fetch_image_b64(url: str, max_size: int = 512) -> str | None:
    try:
        from PIL import Image
        headers = {}
        if BOOKSTACK_TOKEN_ID and BOOKSTACK_TOKEN_SECRET:
            headers["Authorization"] = f"Token {BOOKSTACK_TOKEN_ID}:{BOOKSTACK_TOKEN_SECRET}"
        r = requests.get(url, headers=headers, timeout=10)
        if not r.ok or not r.content:
            return None
        img = Image.open(io.BytesIO(r.content)).convert("RGB")
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        pass
    return None


_SYSTEM = """Tu es un assistant documentaire. Tu expliques les procédures et fonctionnalités en te basant EXCLUSIVEMENT sur le document source, en reformulant de façon claire et naturelle.
RÈGLES ABSOLUES :
1. Couvre toutes les étapes dans l'ordre (navigation, clics inclus). N'en saute aucune.
2. PROFONDEUR : réponds au niveau du titre qui correspond à la question. Si la question est générale, utilise les sections ## et ### sans descendre dans les ####, sauf si la question le demande explicitement.
3. Reformule avec tes propres mots tout en restant fidèle au sens du document. Ne copie pas mot pour mot, sauf pour les noms de champs, boutons et termes techniques.
4. FORMAT : commence toujours par une courte phrase d'introduction en prose. Utilise une liste à tirets (-) dès que tu énumères 3 éléments distincts ou plus (champs de formulaire, options, étapes). N'utilise JAMAIS de listes imbriquées.
5. Utilise **gras** pour les noms de champs, boutons et termes techniques importants.
6. N'invente rien. N'ajoute aucune information absente du document. N'assemble JAMAIS une définition, une catégorisation ou une liste de « types » à partir d'éléments qui ne la donnent pas explicitement (noms d'onglets, exemples, titres de section) : n'utilise QUE ce que le document énonce.
7. FOCUS : si la question porte sur UN SEUL terme spécifique (ex : 'c'est quoi X', 'que signifie X'), réponds en 1 à 2 phrases sur ce terme uniquement, sans énumérer les autres éléments de la même liste. Pour les questions fonctionnelles ('à quoi sert', 'comment fonctionne', 'quelles sont les règles'), couvre TOUS les concepts clés présents dans l'introduction du document (types, règles, conditions importantes).
8. IMAGES : Lorsque le document contient `![image](url)`, tu DOIS écrire ce markdown EXACTEMENT tel quel dans ta réponse à la position correspondante. NE JAMAIS écrire "l'image ci-dessus", "image 1", "voir image" ou toute autre description à la place. Copie le markdown `![image](url)` avec l'URL intacte."""

_SYSTEM_RAW = """Tu reçois un document dont chaque ligne est numérotée, et une question.
Le document contient le texte officiel : tu ne dois JAMAIS le réécrire ni le recopier.
Réponds sur deux lignes, sans rien ajouter d'autre :
INTRO: une courte phrase qui amène la réponse, SANS répéter le contenu des lignes sélectionnées (elle annonce le sujet, elle ne donne pas déjà la réponse).
LIGNES: les numéros des lignes qui répondent à la question, séparés par des virgules

RÈGLES de sélection des lignes :
- Si la question porte sur un TERME précis (un champ, un nom, un mot exact — ex. « civilité »), choisis la ligne qui contient CE terme exact, pas une ligne voisine qui parle d'un autre terme.
- Si la question demande ce QU'EST ou À QUOI SERT un profil, un rôle ou un terme (ex. « à quoi sert SUCRE_CONSULT », « qu'est-ce que X »), choisis la ligne qui le DÉFINIT (souvent au format « NOM : description » ou « X est/permet… »), et NON un titre de section, une image, ou une description d'écran/d'utilisation.
- Choisis en PRIORITÉ la ou les lignes qui répondent DIRECTEMENT et EXACTEMENT à la question posée (celles qui énoncent la réponse).
- N'inclus PAS les lignes seulement liées au sujet mais qui ne répondent pas précisément à la question (contexte, étapes voisines, autres fonctionnalités).
- Sélectionne TOUTES les lignes qui, ENSEMBLE, répondent PRÉCISÉMENT et COMPLÈTEMENT à la question (pas de nombre fixe : parfois une seule suffit, parfois il en faut plusieurs si la réponse est répartie). Mais UNIQUEMENT celles-là : pas les lignes seulement liées au sujet.
- EXCEPTION : si la question demande explicitement une liste/énumération, sélectionne alors TOUTES les lignes de cette liste, sans en oublier aucune.
- IMPORTANT : si AUCUNE ligne ne répond DIRECTEMENT à la question (la réponse devrait être déduite, ou n'est pas dans le document), réponds UNIQUEMENT : LIGNES: AUCUNE (ne sélectionne pas des lignes seulement liées au sujet)."""


# Prompt de DÉDUCTION (fallback RAW) : utilisé UNIQUEMENT quand aucune ligne ne répond
# directement. Le modèle peut raisonner à partir du document, mais de façon encadrée.
_SYSTEM_DEDUCE = """Tu es Stevia, l'assistant documentaire de l'application SUCRE (CPAM).
Le document ne répond PAS directement à la question. Tu peux RAISONNER pour en déduire une réponse,
mais en respectant STRICTEMENT ces règles :
- Fonde ta déduction UNIQUEMENT sur des éléments présents dans le document. N'invente aucun fait.
- Indique clairement que c'est une déduction : commence par « D'après la documentation, on peut en déduire que… ».
- Explique brièvement sur quels éléments du document tu t'appuies.
- Si le document ne contient PAS assez d'éléments pour déduire une réponse fiable, réponds EXACTEMENT :
  « Cette information ne figure pas dans la documentation. » et rien d'autre.
Réponds en 2-4 phrases maximum."""


def deduce_answer(context: str, question: str) -> str:
    """Fallback RAW : le contexte ne répond pas directement → déduction encadrée
    par un modèle génératif, avec garde-fous anti-hallucination.
    Réutilise le modèle du mode RAW (RAW_OLLAMA_MODEL, sinon OLLAMA_MODEL) → pas de
    2ᵉ modèle chargé en RAM."""
    model = _get_raw_model()
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_DEDUCE},
            {"role": "user", "content": f"DOCUMENT :\n{context}\n\nQUESTION : {question}"},
        ],
        "stream": False,
        "keep_alive": -1,
        "options": {"temperature": 0.0, "num_ctx": 8192, "num_predict": 300},
    }
    try:
        with requests.post(OLLAMA_URL, json=payload, timeout=90) as r:
            if not r.ok:
                print(f"[Ollama DEDUCE {r.status_code}] {r.text[:200]}", flush=True)
                return ""
            content = r.json().get("message", {}).get("content", "")
            import re as _re
            return _re.sub(r'<think>.*?</think>', '', content, flags=_re.DOTALL).strip()
    except Exception as e:
        print(f"[Ollama DEDUCE erreur] {e}", flush=True)
        return ""


def _get_raw_model() -> str:
    m = os.getenv("RAW_OLLAMA_MODEL") or os.getenv("OLLAMA_MODEL")
    if not m:
        raise ValueError("OLLAMA_MODEL non défini dans le .env")
    return m


def raw_select_lines(numbered_context: str, question: str) -> str:
    """Mode RAW : le LLM renvoie une intro + les numéros des lignes pertinentes.
    Il ne réécrit jamais le texte (impossible de corrompre des numéros)."""
    user_msg = f"DOCUMENT :\n{numbered_context}\n\nQUESTION : {question}"
    payload = {
        "model": _get_raw_model(),
        "messages": [
            {"role": "system", "content": _SYSTEM_RAW},
            {"role": "user", "content": user_msg},
        ],
        "stream": False,
        "keep_alive": -1,
        "options": {
            "temperature": 0.0,
            "num_ctx": int(os.getenv("RAG_NUM_CTX", "6144")),   # gros contexte (test option 2 RAW)
            "num_predict": 120,
        }
    }
    import re as _re
    # Retry sur réponse VIDE : le modèle peut renvoyer vide s'il est froid (chargement
    # en RAM). Sans retry, on tombe sur le fallback mots-clés (titres) → mauvaise réponse.
    for _attempt in range(2):
        try:
            with requests.post(OLLAMA_URL, json=payload, timeout=90) as r:
                if not r.ok:
                    print(f"[Ollama RAW {r.status_code}] {r.text[:200]}", flush=True)
                    continue
                content = r.json().get("message", {}).get("content", "")
                content = _re.sub(r'<think>.*?</think>', '', content, flags=_re.DOTALL).strip()
                if content:
                    return content
                print(f"[Ollama RAW] réponse vide (essai {_attempt + 1}) → retry", flush=True)
        except Exception as e:
            print(f"[Ollama RAW erreur] {e}", flush=True)
    return ""


def _get_model() -> str:
    m = os.getenv("OLLAMA_MODEL")
    if not m:
        raise ValueError("OLLAMA_MODEL non défini dans le .env")
    return m


def _stream_ollama(payload: dict):
    try:
        with requests.post(OLLAMA_URL, json=payload, stream=True, timeout=120) as response:
            if not response.ok:
                print(f"[Ollama {response.status_code}] {response.text[:300]}", flush=True)
                response.raise_for_status()
            buffer = ""
            in_think = False
            for line in response.iter_lines():
                if line:
                    chunk = json.loads(line)
                    if "message" in chunk:
                        content = chunk["message"].get("content", "")
                        if content:
                            buffer += content
                            while True:
                                if in_think:
                                    end = buffer.find("</think>")
                                    if end == -1:
                                        buffer = ""
                                        break
                                    buffer = buffer[end + len("</think>"):]
                                    in_think = False
                                else:
                                    start = buffer.find("<think>")
                                    if start == -1:
                                        yield buffer
                                        buffer = ""
                                        break
                                    if start > 0:
                                        yield buffer[:start]
                                    buffer = buffer[start + len("<think>"):]
                                    in_think = True
                    if chunk.get("done", False):
                        if buffer and not in_think:
                            yield buffer
                        break
    except requests.exceptions.ConnectionError:
        yield "⚠️ Le service de chat est disponible du lundi au vendredi de 7h30 à 18h30 (heure locale)."
    except requests.exceptions.HTTPError:
        raise  # propagé vers refine_answer_streaming pour fallback éventuel
    except Exception as e:
        import traceback; traceback.print_exc()
        yield f"Erreur : {e}"


def refine_answer_streaming(context: str, question: str, image_urls: list[str] | None = None):
    clean_context = context.replace("{", "(").replace("}", ")").replace('"', "'")

    has_bullets = "•" in clean_context
    bullet_instruction = (
        "\n\nATTENTION : le document contient des puces (•) et des paragraphes en prose. Règle stricte :"
        "\n- Chaque ligne commençant par • devient un tiret (-) au même niveau."
        "\n- Chaque ligne sans • reste en prose, sans tiret."
        "\n- INTERDIT : sous-puces ou indentation (pas de '  -', que des '-' à plat)."
        "\nExemple correct : '• item A' → '- item A' | 'Texte libre.' → 'Texte libre.'"
        if has_bullets else ""
    )

    _model = _get_model().lower()
    _is_vision = any(k in _model for k in ("vl", "llava", "vision", "minicpm-v", "moondream"))
    payload_images = None
    fetched_image_urls: list[str] = []
    if _is_vision and image_urls:
        for url in image_urls[:4]:
            b = _fetch_image_b64(url)
            if b:
                if payload_images is None:
                    payload_images = []
                payload_images.append(b)
                fetched_image_urls.append(url)

    vision_instruction = ""
    if payload_images:
        mapping = "\n".join(f"  Image {i+1} → ![image]({url})" for i, url in enumerate(fetched_image_urls))
        vision_instruction = (
            f"\n\nIMAGES JOINTES — tu peux voir ces captures d'écran. "
            f"Correspondance URL dans l'ordre :\n{mapping}\n"
            "Lorsque tu décris ou références le contenu visuel d'une image, "
            "insère le markdown `![image](url)` correspondant à l'endroit précis de la phrase."
        )

    user_message = (
        f"DOCUMENT SOURCE :\n{clean_context}\n\n"
        f"QUESTION : {question}\n\n"
        f"{bullet_instruction}{vision_instruction}"
    )

    payload = {
        "model": _get_model(),
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user_message, **({"images": payload_images} if payload_images else {})},
        ],
        "stream": True,
        "keep_alive": -1,
        "options": {
            "temperature": 0.0,
            "num_ctx": int(os.getenv("RAG_NUM_CTX", "6144")),  # ↑ pour le mode multi-pages
            "num_predict": 1500,
            "top_k": 4,
            "top_p": 0.9,
            "repeat_penalty": 1.1,
        }
    }
    try:
        yield from _stream_ollama(payload)
    except requests.exceptions.HTTPError as e:
        if payload_images:
            # Fallback sans images si Ollama rejette la requête vision
            print(f"[Vision fallback] Ollama a rejeté la requête avec images ({e}), retry sans images.", flush=True)
            payload["messages"] = [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_message},
            ]
            try:
                yield from _stream_ollama(payload)
            except requests.exceptions.HTTPError as e2:
                yield f"Erreur : {e2}"
        else:
            yield f"Erreur : {e}"
