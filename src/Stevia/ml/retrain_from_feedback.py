"""
Réentraînement du classifieur à partir des feedbacks utilisateurs.

Appelé automatiquement depuis main.py quand le seuil de feedbacks est atteint.
Peut aussi être lancé manuellement :
    python /app/ml/retrain_from_feedback.py
"""

import logging
import os
import sys
from pathlib import Path

import pandas as pd

# Logger partagé avec main.py (même fichier via le répertoire monté)
_LOG_DIR = os.getenv("STEVIA_LOG_DIR", "/app/var_log")
os.makedirs(_LOG_DIR, exist_ok=True)
train_logger = logging.getLogger("stevia_entrainement")
if not train_logger.handlers:
    _h = logging.FileHandler(os.path.join(_LOG_DIR, "stevia-entrainement.log"))
    _h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    train_logger.addHandler(_h)
train_logger.setLevel(logging.INFO)
import joblib
from sqlalchemy import create_engine, text
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import f1_score, accuracy_score

DATASET_DIR = Path(__file__).parent / "dataset"
MODEL_PATH  = DATASET_DIR / "best_model.pkl"
META_PATH   = DATASET_DIR / "model_meta.pkl"

FEATURE_COLS = [
    "cosine_score", "keyword_match_count", "keyword_match_ratio",
    "chunk_length", "title_match", "role_match",
    "query_length", "rank_position", "book_id",
]

RETRAIN_THRESHOLD = int(os.getenv("ML_RETRAIN_THRESHOLD", "10"))
DB_URL = os.getenv("DATABASE_URL")


def load_feedback_examples() -> pd.DataFrame:
    """Charge les exemples labélisés depuis la BDD."""
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT cosine_score, keyword_match_count, keyword_match_ratio,
                   chunk_length, title_match, role_match,
                   query_length, rank_position, book_id, label
            FROM stevia_ml_feedback
            WHERE label IS NOT NULL
        """)).fetchall()

    if not rows:
        return pd.DataFrame(columns=FEATURE_COLS + ["label"])

    return pd.DataFrame(rows, columns=FEATURE_COLS + ["label"])


def count_new_feedbacks_since_last_retrain() -> int:
    """Compte les feedbacks labélisés depuis le dernier entraînement."""
    engine = create_engine(DB_URL)
    meta = joblib.load(META_PATH) if META_PATH.exists() else {}
    last_retrain = meta.get("last_retrain_at")

    with engine.connect() as conn:
        if last_retrain:
            count = conn.execute(text("""
                SELECT COUNT(*) FROM stevia_ml_feedback
                WHERE label IS NOT NULL AND labeled_at > :ts
            """), {"ts": last_retrain}).scalar()
        else:
            count = conn.execute(text("""
                SELECT COUNT(*) FROM stevia_ml_feedback
                WHERE label IS NOT NULL
            """)).scalar()

    return count or 0


def retrain() -> dict:
    """
    Réentraîne le modèle en fusionnant dataset original + feedbacks.
    Retourne les métriques du nouveau modèle.
    """
    from datetime import datetime, timezone

    train_logger.info("[Retrain] Chargement des données...")

    # Dataset original
    original_path = DATASET_DIR / "stevia_relevance_dataset.csv"
    if original_path.exists():
        df_orig = pd.read_csv(original_path)[FEATURE_COLS + ["label"]]
    else:
        df_orig = pd.DataFrame(columns=FEATURE_COLS + ["label"])

    # Feedbacks utilisateurs
    df_feedback = load_feedback_examples()

    # Fusion
    df = pd.concat([df_orig, df_feedback], ignore_index=True).dropna()
    train_logger.info(f"[Retrain] Dataset fusionné : {len(df_orig)} orig + {len(df_feedback)} feedbacks = {len(df)} exemples")

    if len(df) < 5:
        train_logger.info("[Retrain] Pas assez de données pour réentraîner (< 5 exemples).")
        return {}

    X = df[FEATURE_COLS].values
    y = df["label"].values

    # Split 70/30
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.3, stratify=y, random_state=42
    )

    # Réentraînement Decision Tree (paramètres optimisés)
    model = DecisionTreeClassifier(
        criterion="gini",
        max_depth=3,
        min_samples_split=2,
        min_samples_leaf=1,
        class_weight="balanced",
        random_state=42,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    f1  = f1_score(y_test, y_pred, zero_division=0)

    train_logger.info(f"[Retrain] Nouveau modèle — Accuracy={acc:.4f}  F1={f1:.4f}")

    # Sauvegarde
    joblib.dump(model, MODEL_PATH)

    meta = joblib.load(META_PATH) if META_PATH.exists() else {}
    meta["name"]    = "Decision Tree (feedback)"
    meta["metrics"] = {"accuracy": round(acc, 4), "f1": round(f1, 4)}
    meta["n_train"] = len(X_train)
    meta["n_feedback"] = len(df_feedback)
    meta["last_retrain_at"] = datetime.now(timezone.utc).isoformat()
    joblib.dump(meta, META_PATH)

    # Invalider le cache du modèle en production
    try:
        from ml.predict import _load_model
        _load_model.cache_clear()
        train_logger.info("[Retrain] Cache modèle invalidé — nouveau modèle actif.")
    except Exception as e:
        train_logger.warning(f"[Retrain] Cache non invalidé (sera rechargé à la prochaine requête) : {e}")

    return {"accuracy": acc, "f1": f1, "n_total": len(df), "n_feedback": len(df_feedback)}


def maybe_retrain() -> bool:
    """
    Déclenche le réentraînement si le seuil de nouveaux feedbacks est atteint.
    Retourne True si un réentraînement a eu lieu.
    """
    if not DB_URL:
        return False
    try:
        n = count_new_feedbacks_since_last_retrain()
        train_logger.info(f"[Retrain] {n} nouveau(x) feedback(s) depuis le dernier entraînement (seuil={RETRAIN_THRESHOLD})")
        if n >= RETRAIN_THRESHOLD:
            retrain()
            return True
    except Exception as e:
        train_logger.error(f"[Retrain] Erreur lors de la vérification/réentraînement : {e}")
    return False


if __name__ == "__main__":
    if not DB_URL:
        train_logger.error("DATABASE_URL non défini.")
        sys.exit(1)
    result = retrain()
    if result:
        train_logger.info(f"[Retrain] Terminé : {result}")
    else:
        train_logger.info("[Retrain] Aucun réentraînement effectué.")
