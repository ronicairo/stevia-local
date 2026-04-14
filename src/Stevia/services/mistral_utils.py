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

    system_message = """Tu es un assistant documentaire.
    RÈGLES ABSOLUES :
    1. Réponds UNIQUEMENT avec les informations EXACTES du DOCUMENT SOURCE et n'invente pas des explications qui ne sont pas dans le document.
    2. COPIE EXACTEMENT les listes et énumérations telles qu'elles apparaissent.
    3. INTERDICTION TOTALE d'inventer ou développer.
    4. Si un acronyme apparaît dans le document, utilise-le tel quel SANS l'expliquer.
    5. NE JAMAIS inventer ni ajouter une explication (acronyme..) non présente dans la documentation.
    6. Enjoliver l'affichage de la réponse avec des sauts de ligne, listes à puces quand il y en a dans le contexte ..
    """

    user_message = f"""DOCUMENT SOURCE :
{clean_context}

QUESTION : {question}

Réponds brièvement et précisément à la question (2-5 phrases). Ne reproduis pas tout le document."""

    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message}
        ],
        "stream": True,
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