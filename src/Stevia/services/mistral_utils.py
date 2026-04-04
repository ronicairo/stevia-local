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

    system_message = """Tu es un assistant DE REFORMULATION documentaire STRICT.
    RÈGLES ABSOLUES :
    1. Réponds UNIQUEMENT avec les informations EXACTES du DOCUMENT SOURCE et n'invente pas des explications qui ne sont pas dans le document.
    2. COPIE EXACTEMENT les listes et énumérations telles qu'elles apparaissent.
    3. INTERDICTION TOTALE d'inventer ou développer.
    4. Si un acronyme apparaît dans le document, utilise-le tel quel SANS l'expliquer.
    5. NE JAMAIS inventer ni ajouter une explication (acronyme..) non présente dans la documentation.
    6. Si une question ne concerne pas la documentation SUCRE, répondre "Cette question ne semble pas concerner la documentation SUCRE."
    """

    user_message = f"""DOCUMENT SOURCE :
{clean_context}

QUESTION : {question}

Réponds en copiant EXACTEMENT les informations du document."""

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
            "repeat_penalty": 1.1
        }
    }

    try:
        with requests.post(OLLAMA_URL, json=payload, stream=True, timeout=120) as response:
            response.raise_for_status()

            for line in response.iter_lines():

                if line:
                    chunk = json.loads(line)

                    if "message" in chunk:
                        content = chunk["message"].get("content", "")

                        if content:
                            yield content

                    if chunk.get("done", False):
                        break

    except Exception as e:
        print(f"Erreur streaming : {e}")
        yield "Erreur lors de la génération."