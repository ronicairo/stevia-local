"""
Génération du dataset d'entraînement pour le classifieur de pertinence.

Stratégie :
  - Pour chaque chunk indexé (échantillon), on demande à Ollama de générer
    une question à laquelle ce chunk répond.
  - On effectue une recherche vectorielle avec cette question.
  - Le chunk source → label 1 (pertinent)
  - Les autres chunks récupérés → label 0 (non pertinent)
  - On équilibre les classes (sous-échantillonnage de la classe 0).

Usage (dans le conteneur) :
    python /app/ml/generate_dataset.py [--max-chunks N]
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

# Ajouter /app au path pour accéder à fastembed
sys.path.insert(0, "/app")

from extract_features import extract_features

# ─── Configuration ─────────────────────────────────────────────────────────────
DB_URL       = os.getenv("DATABASE_URL", "postgresql://stevia:steviapassword@localhost:5432/stevia")
OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "localhost")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:1b")
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


# ─── Embeddings (FastEmbed) ────────────────────────────────────────────────────
_embeddings = None

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
        _embeddings = FastEmbedEmbeddings()
    return _embeddings


def embed_text(text: str) -> list[float]:
    emb = get_embeddings()
    return emb.embed_query(text)


# ─── Génération de questions via Ollama ────────────────────────────────────────
def generate_question(chunk_text: str) -> str | None:
    """Demande au LLM de formuler une question à partir d'un extrait."""
    prompt = (
        "Tu es un assistant qui génère des questions de recherche documentaire.\n"
        "À partir du texte suivant, génère UNE seule question courte et précise en français "
        "qu'un agent de la CPAM pourrait poser pour trouver cette information.\n"
        "Réponds uniquement avec la question (pas d'explication, pas de guillemets).\n\n"
        f"Texte :\n{chunk_text[:600]}\n\nQuestion :"
    )
    try:
        resp = requests.post(
            f"http://{OLLAMA_HOST}:11434/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.3}},
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

    for i, chunk in enumerate(chunks):
        source_page_id = (chunk["meta"] or {}).get("page_id", "")
        text_preview = chunk["text"][:80].replace("\n", " ")
        print(f"\n[{i+1}/{len(chunks)}] Page {source_page_id} | {text_preview}…")

        # 1. Générer une question
        question = generate_question(chunk["text"])
        if not question:
            print("  ✗ Question non générée, ignoré")
            continue
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
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  ✓ Dataset sauvegardé : {path} ({len(rows)} lignes)")


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
