import requests
import json
import os

OLLAMA_HOST = os.getenv("OLLAMA_HOST")
if not OLLAMA_HOST:
    raise ValueError("OLLAMA_HOST non défini dans le .env")

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL")
if not OLLAMA_MODEL:
    raise ValueError("OLLAMA_MODEL non défini dans le .env")

OLLAMA_URL = f"http://{OLLAMA_HOST}:11434/api/chat"

def refine_answer_streaming(context: str, question: str):
    """Version streaming pour FastAPI"""
    clean_context = context.replace("{", "(").replace("}", ")").replace('"', "'")

    system_message = """Tu es un assistant documentaire. Tu réponds précisément à la question posée, sans ajouter d'informations non demandées.
    RÈGLES ABSOLUES :
    1. Réponds UNIQUEMENT avec les informations du DOCUMENT SOURCE pertinentes à la question. Zéro invention.
    2. Sois concis : ne cite que ce qui répond directement à la question. N'ajoute pas de contexte non demandé.
    3. Si la réponse dans le document est une liste à puces (•) : restitue-la sous forme de tirets (-), UNE par ligne. Ne fusionne PAS en prose.
    4. Si la réponse est en prose : rédige en prose. Ne tronque pas la réponse.
    5. Utilise **gras** pour les termes importants présents dans le document.
    6. N'invente rien, n'explique pas les acronymes absents du document.
    """

    # Détecte si le contexte contient des puces pour renforcer l'instruction
    has_bullets = "•" in clean_context
    bullet_instruction = (
        "\n\nATTENTION : le document contient une liste à puces (•). Tu DOIS restituer CHAQUE puce sur une ligne séparée avec un tiret (-). NE PAS fusionner en prose."
        if has_bullets else ""
    )

    user_message = f"""DOCUMENT SOURCE :
{clean_context}

QUESTION : {question}

Réponds uniquement à la question posée, en te limitant aux informations directement pertinentes.{bullet_instruction}"""

    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message}
        ],
        "stream": True,
        "keep_alive": -1,
        "options": {
            "temperature": 0.0,
            "num_ctx": 2048,
            "num_predict": 500,
            "top_k": 4,
            "top_p": 0.9,
            "repeat_penalty": 1.1,
            "think": False,
        }
    }

    try:
        with requests.post(OLLAMA_URL, json=payload, stream=True, timeout=120) as response:
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
                            # Filtre les balises <think>...</think> (Qwen3)
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
        yield "⚠️ Le service de chat est disponible du lundi au vendredi de 7h30 à 18h30."
    except Exception:
        yield "Erreur lors de la génération."