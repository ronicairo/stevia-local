"""
Entraînement du classifieur d'intention à partir des questions générées.

Sources :
  - intent_questions.csv  : questions SUCRE générées par le LLM (label=1)
  - exemples invalides hardcodés (label=0)

Usage :
    python ml/train_intent_model.py
"""

import os
import sys
import csv
import joblib
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score

sys.path.insert(0, str(Path(__file__).parent.parent))

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "localhost")
DATASET_DIR = Path(__file__).parent / "dataset"
MODEL_PATH  = DATASET_DIR / "intent_model.pkl"

_INVALID = [
    "un deux test",
    "bout en train",
    "comment ça va",
    "azertyuiop",
    "test test test",
    "1 2 3",
    "quelle belle journée",
    "je veux démissionner",
    "tu fais quoi ce soir",
    "allo allo",
    "bla bla bla",
    "abc def ghi",
    "il fait beau",
    "bonjour je suis là",
    "micro test sonore",
    "coucou tu m'entends",
]


def load_intent_questions() -> list[tuple[str, int]]:
    path = DATASET_DIR / "intent_questions.csv"
    if not path.exists():
        print("  ✗ intent_questions.csv introuvable — lance d'abord generate_dataset.py")
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return [(row["question"], int(row["label"])) for row in csv.DictReader(f)]


def embed_questions(questions: list[str]) -> np.ndarray:
    from langchain_ollama import OllamaEmbeddings
    model = OllamaEmbeddings(
        model="qwen3-embedding:0.6b",
        base_url=f"http://{OLLAMA_HOST}:11434",
    )
    print(f"  Embedding {len(questions)} questions...")
    return np.array(model.embed_documents(questions))


def train():
    print("=" * 60)
    print("  ENTRAÎNEMENT CLASSIFIEUR D'INTENTION")
    print("=" * 60)

    # Chargement des questions valides depuis CSV
    intent_rows = load_intent_questions()
    if not intent_rows:
        return

    valid_questions   = [q for q, l in intent_rows if l == 1]
    invalid_questions = _INVALID

    print(f"  Questions valides   : {len(valid_questions)}")
    print(f"  Questions invalides : {len(invalid_questions)}")

    all_questions = valid_questions + invalid_questions
    all_labels    = [1] * len(valid_questions) + [0] * len(invalid_questions)

    # Embeddings
    X = embed_questions(all_questions)
    y = np.array(all_labels)

    # Entraînement
    clf = LogisticRegression(max_iter=1000, C=1.0)
    scores = cross_val_score(clf, X, y, cv=min(5, len(y) // 2), scoring="f1")
    print(f"  F1 cross-val : {scores.mean():.3f} ± {scores.std():.3f}")

    clf.fit(X, y)

    # Sauvegarde
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, MODEL_PATH)
    print(f"  ✓ Modèle sauvegardé : {MODEL_PATH}")
    print(f"  Prochaine requête utilisera déjà ce modèle.")


if __name__ == "__main__":
    train()
