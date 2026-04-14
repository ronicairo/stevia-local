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
    1. Réponds UNIQUEMENT à la question posée en utilisant les informations du DOCUMENT SOURCE.
    2. Utilise **gras** pour les termes importants.
    3. Si le document contient une liste, COPIE EXACTEMENT chaque élément de la liste, un par ligne, précédé d'un tiret (-). N'omets aucun élément.
    4. Si la réponse tient en quelques phrases, rédige en prose (2-5 phrases max).
    5. N'invente rien au-delà du document.
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

    except Exception:
        yield "Erreur lors de la génération."