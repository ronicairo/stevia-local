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
    RÈGLES :
    1. Réponds UNIQUEMENT avec les informations du DOCUMENT SOURCE. Zéro invention.
    2. DÉTECTE si la réponse à la question se trouve dans une liste à puces (•) du document.
       - OUI → restitue CHAQUE puce sur une ligne séparée avec un tiret (-). Ne fusionne PAS en prose.
       - NON → rédige en prose courte (2-5 phrases max).
    3. Utilise **gras** pour les termes importants présents dans le document.
    4. N'invente rien, n'explique pas les acronymes absents du document.
    """

    user_message = f"""DOCUMENT SOURCE :
{clean_context}

QUESTION : {question}

Si la réponse est une liste à puces dans le document, restitue-la OBLIGATOIREMENT sous forme de tirets (-), une par ligne.
Sinon, réponds en prose courte. Ne reproduis pas tout le document."""

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