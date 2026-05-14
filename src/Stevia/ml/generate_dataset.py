"""
Génération du dataset d'entraînement pour le classifieur de pertinence.

Stratégie :
  - Pour chaque chunk indexé (échantillon), on demande à Ollama de générer
    une question à laquelle ce chunk répond.
  - On effectue une recherche vectorielle avec cette question.
  - Le chunk source → label 1 (pertinent)
  - Les autres chunks récupérés → label 0 (non pertinent)
  - On équilibre les classes (sous-échantillonnage de la classe 0).

Usage :
    python ml/generate_dataset.py [--max-chunks N]
"""

import os
import sys
import csv
import json
import random
import argparse
import requests
import numpy as np
from pathlib import Path
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from extract_features import extract_features

# ─── Configuration ─────────────────────────────────────────────────────────────
DB_URL       = os.getenv("DATABASE_URL", "postgresql://stevia:steviapassword@localhost:5432/stevia")
OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "localhost")
OLLAMA_MODEL = os.getenv("ML_OLLAMA_MODEL", "gemma3:1b")
DATASET_DIR  = Path(__file__).parent / "dataset"

ENGINE = create_engine(DB_URL, pool_pre_ping=True)


# ─── Helpers DB ────────────────────────────────────────────────────────────────
def load_sample_chunks(max_chunks: int) -> list[dict]:
    """Charge un échantillon diversifié de chunks (1 par page max)."""
    with ENGINE.connect() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT ON (cmetadata->>'page_id')
                id::text AS id,
                document,
                cmetadata
            FROM langchain_pg_embedding
            WHERE cmetadata->>'source' = 'bookstack'
              AND length(document) > 100
            ORDER BY cmetadata->>'page_id', random()
            LIMIT :n
        """), {"n": max_chunks}).fetchall()
    return [{"id": r.id, "text": r.document, "meta": r.cmetadata} for r in rows]


def similarity_search_raw(query_vector: list[float], k: int = 12) -> list[dict]:
    """Recherche par vecteur directement en SQL (sans LangChain)."""
    vec_str = "[" + ",".join(str(x) for x in query_vector) + "]"
    with ENGINE.connect() as conn:
        rows = conn.execute(text(f"""
            SELECT
                id::text,
                document,
                cmetadata,
                (embedding <=> '{vec_str}'::vector) AS distance
            FROM langchain_pg_embedding
            ORDER BY embedding <=> '{vec_str}'::vector
            LIMIT :k
        """), {"k": k}).fetchall()
    return [
        {"id": r.id, "text": r.document, "meta": r.cmetadata, "distance": float(r.distance)}
        for r in rows
    ]


# ─── Embeddings (Ollama — même modèle que le RAG engine) ──────────────────────
_embeddings = None

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        from langchain_ollama import OllamaEmbeddings
        _embeddings = OllamaEmbeddings(
            model="qwen3-embedding:0.6b",
            base_url=f"http://{OLLAMA_HOST}:11434",
        )
    return _embeddings


def embed_text(text: str) -> list[float]:
    emb = get_embeddings()
    return emb.embed_query(text)


# ─── Génération de questions via Ollama ────────────────────────────────────────
def generate_question(chunk_text: str) -> str | None:
    """Demande au LLM de formuler une question à partir d'un extrait."""
    prompt = (
        "Tu es un agent de la CPAM Hauts-de-Seine qui utilise l'application SUCRE "
        "(gestion de suivi de créances).\n"
        "À partir du texte de documentation SUCRE ci-dessous, génère UNE seule question "
        "précise en français que tu poserais pour retrouver cette information.\n"
        "La question doit :\n"
        "- Utiliser le vocabulaire du texte (noms d'onglets, acronymes, termes métier)\n"
        "- Être formulée comme une vraie recherche : 'Comment...', 'À quoi sert...', "
        "'Quand...', 'Quelle est...', 'Comment faire pour...', 'À quelle heure...'\n"
        "- Être spécifique, pas générale\n"
        "- Être rédigée en FRANÇAIS obligatoirement\n\n"
        "Réponds UNIQUEMENT avec la question, sans guillemets ni explication.\n\n"
        f"Texte :\n{chunk_text[:800]}\n\nQuestion:"
    )
    try:
        resp = requests.post(
            f"http://{OLLAMA_HOST}:11434/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
                  "options": {"temperature": 0.6, "num_predict": 80}},
            timeout=45,
        )
        raw = resp.json().get("response", "").strip()
        # Garder seulement la première ligne non vide
        for line in raw.split("\n"):
            line = line.strip().strip('"').strip("'")
            if len(line) > 10:
                return line
    except Exception as e:
        print(f"  ⚠️  Ollama error: {e}")
    return None


# ─── Construction du dataset ───────────────────────────────────────────────────
def build_dataset(max_chunks: int = 100) -> tuple[list[dict], list[int]]:
    chunks = load_sample_chunks(max_chunks)
    print(f"  {len(chunks)} chunks chargés depuis la BDD")

    rows_pos, rows_neg = [], []
    questions_seen: set[str] = set()

    for i, chunk in enumerate(chunks):
        source_page_id = (chunk["meta"] or {}).get("page_id", "")
        text_preview = chunk["text"][:80].replace("\n", " ")
        print(f"\n[{i+1}/{len(chunks)}] Page {source_page_id} | {text_preview}…")

        # 1. Générer une question
        question = generate_question(chunk["text"])
        if not question:
            print("  ✗ Question non générée, ignoré")
            continue

        # Dédupliquer les questions (normalisées)
        q_normalized = question.lower().strip()
        if q_normalized in questions_seen:
            print(f"  ✗ Question dupliquée, ignorée : {question}")
            continue
        questions_seen.add(q_normalized)

        print(f"  ✓ Question : {question}")

        # 2. Encoder la question
        try:
            q_vec = embed_text(question)
        except Exception as e:
            print(f"  ✗ Erreur embedding: {e}")
            continue

        # 3. Recherche vectorielle
        results = similarity_search_raw(q_vec, k=12)
        if not results:
            continue

        # 4. Extraction features + label
        for rank, r in enumerate(results, start=1):
            meta = r["meta"] if isinstance(r["meta"], dict) else {}
            is_relevant = int(meta.get("page_id", "") == source_page_id)
            features = extract_features(
                question=question,
                doc_text=r["text"],
                doc_metadata=meta,
                cosine_distance=r["distance"],
                rank=rank,
                user_role="user",
            )
            row = {**features, "label": is_relevant, "question": question}

            if is_relevant:
                rows_pos.append(row)
            else:
                rows_neg.append(row)

    # 5. Équilibrage des classes (ratio 1:2 pour conserver assez de négatifs)
    random.shuffle(rows_neg)
    n_neg = min(len(rows_neg), len(rows_pos) * 2)
    balanced = rows_pos + rows_neg[:n_neg]
    random.shuffle(balanced)

    print(f"\n  Dataset : {len(rows_pos)} positifs, {n_neg} négatifs → {len(balanced)} total")
    return balanced


def save_dataset(rows: list[dict], filename: str = "stevia_relevance_dataset.csv"):
    if not rows:
        print("  ✗ Dataset vide, rien à sauvegarder.")
        return
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    path = DATASET_DIR / filename

    # Charger les exemples existants et fusionner
    existing = []
    if path.exists():
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            existing = list(reader)
        print(f"  ↺ {len(existing)} exemples existants chargés")

    # Dédupliquer sur la question (normalize)
    seen_questions = {row["question"].lower().strip() for row in existing if "question" in row}
    new_rows = [r for r in rows if r.get("question", "").lower().strip() not in seen_questions]
    print(f"  + {len(new_rows)} nouveaux exemples ajoutés ({len(rows) - len(new_rows)} doublons ignorés)")

    merged = existing + new_rows
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged)
    print(f"  ✓ Dataset sauvegardé : {path} ({len(merged)} lignes au total)")


# ─── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Génère le dataset de pertinence Stevia")
    parser.add_argument("--max-chunks", type=int, default=80,
                        help="Nombre max de chunks sources à utiliser (défaut: 80)")
    args = parser.parse_args()

    print("=" * 60)
    print("  GÉNÉRATION DU DATASET DE PERTINENCE")
    print(f"  Modèle Ollama : {OLLAMA_MODEL} @ {OLLAMA_HOST}")
    print(f"  Max chunks    : {args.max_chunks}")
    print("=" * 60)

    dataset = build_dataset(max_chunks=args.max_chunks)
    save_dataset(dataset)

    print("\n  Prochaine étape : python /app/ml/train_model.py")
