"""
Réentraînement du classifieur à partir des feedbacks utilisateurs.

Appelé automatiquement depuis main.py quand le seuil de feedbacks est atteint.
Peut aussi être lancé manuellement :
    python /app/ml/retrain_from_feedback.py
"""

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# Réutilise le logger configuré par main.py (même nom, même handler).
# Fallback Monolog si lancé en standalone (python ml/retrain_from_feedback.py).
train_logger = logging.getLogger("stevia_training")
if not train_logger.handlers:
    class _MonologFormatter(logging.Formatter):
        def format(self, record):
            dt = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()
            return f"[{dt}] {record.name}.{record.levelname}: {record.getMessage()}"

    _log_dir = os.getenv("STEVIA_LOG_DIR", "/app/var/log")
    os.makedirs(_log_dir, exist_ok=True)
    _log_date = datetime.now().strftime("%Y-%m-%d")
    _h = logging.FileHandler(os.path.join(_log_dir, f"stevia_training-{_log_date}.log"))
    _h.setFormatter(_MonologFormatter())
    train_logger.addHandler(_h)
train_logger.setLevel(logging.INFO)
import joblib
from sqlalchemy import create_engine, text
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import f1_score, accuracy_score

DATASET_DIR       = Path(__file__).parent / "dataset"
MODEL_PATH        = DATASET_DIR / "best_model.pkl"
META_PATH         = DATASET_DIR / "model_meta.pkl"
INTENT_MODEL_PATH = DATASET_DIR / "intent_model.pkl"

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
    y = df["label"].values.astype(int)

    # Split 70/30 (stratifié si chaque classe a au moins 2 membres)
    min_class_count = min((y == c).sum() for c in set(y))
    use_stratify = y if min_class_count >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.3, stratify=use_stratify, random_state=42
    )

    # Comparaison des algorithmes — on garde le meilleur F1
    candidates = {
        "Random Forest": Pipeline([("clf", RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=42))]),
        "Decision Tree": Pipeline([("clf", DecisionTreeClassifier(max_depth=5, class_weight="balanced", random_state=42))]),
        "KNN":           Pipeline([("scaler", StandardScaler()), ("clf", KNeighborsClassifier(n_neighbors=5))]),
        "Logistic Regression": Pipeline([("scaler", StandardScaler()), ("clf", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42))]),
    }

    best_name, best_f1, best_model = None, -1, None
    for name, candidate in candidates.items():
        candidate.fit(X_train, y_train)
        f1_candidate = f1_score(candidate.predict(X_test), y_test, zero_division=0)
        train_logger.info(f"[Retrain] {name} — F1={f1_candidate:.4f}")
        if f1_candidate > best_f1:
            best_f1, best_name, best_model = f1_candidate, name, candidate

    model = best_model
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    f1  = f1_score(y_test, y_pred, zero_division=0)

    train_logger.info(f"[Retrain] Meilleur modèle : {best_name} — Accuracy={acc:.4f}  F1={f1:.4f}")

    # Sauvegarde
    joblib.dump(model, MODEL_PATH)

    meta = joblib.load(META_PATH) if META_PATH.exists() else {}
    meta["name"]    = f"{best_name} (feedback)"
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


def retrain_intent_classifier() -> dict:
    """
    Entraîne le classifieur d'intention à partir des labels auto-collectés.
    Charge stevia_intent_labels, calcule les embeddings Ollama, entraîne une
    LogisticRegression et sauvegarde dans intent_model.pkl.
    """
    import numpy as np
    from langchain_ollama import OllamaEmbeddings
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import f1_score, accuracy_score

    train_logger.info("[IntentRetrain] Chargement des labels...")
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT question, label FROM stevia_intent_labels"
        )).fetchall()

    # Seeds = vérité terrain absolue, ils écrasent les labels BDD conflictuels
    from services.intent_classifier import _VALID as _SEEDS_VALID, _INVALID as _SEEDS_INVALID
    import re as _re
    def _norm(s: str) -> str:
        return _re.sub(r'[^\w\s]', '', s.lower().strip())

    seed_set_norm = {_norm(q) for q in _SEEDS_VALID + _SEEDS_INVALID}

    # DB : on exclut les entrées qui correspondent (après normalisation) à un seed
    db_filtered = [(r[0], int(r[1])) for r in rows if _norm(r[0]) not in seed_set_norm]

    questions = [q for q, _ in db_filtered] + _SEEDS_VALID + _SEEDS_INVALID
    y_list    = [l for _, l in db_filtered] + [1] * len(_SEEDS_VALID) + [0] * len(_SEEDS_INVALID)
    y = np.array(y_list)

    n_overridden = len(rows) - len(db_filtered)
    train_logger.info(f"[IntentRetrain] {len(db_filtered)} DB ({n_overridden} écrasés par seeds) + {len(_SEEDS_VALID)+len(_SEEDS_INVALID)} seeds = {len(questions)} exemples")

    if len(set(y)) < 2:
        train_logger.info("[IntentRetrain] Une seule classe présente. Ignoré.")
        return {}

    train_logger.info(f"[IntentRetrain] {len(questions)} exemples ({sum(y==1)} valides, {sum(y==0)} invalides). Calcul embeddings...")
    _host = os.getenv("OLLAMA_HOST", "127.0.0.1")
    emb_model = OllamaEmbeddings(
        model="qwen3-embedding:0.6b",
        base_url=f"http://{_host}:11434",
    )
    X = np.array(emb_model.embed_documents(questions))

    min_class = min((y == c).sum() for c in set(y))
    stratify = y if min_class >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.3, stratify=stratify, random_state=42
    )

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)),
    ])
    model.fit(X_train, y_train)

    acc = accuracy_score(y_test, model.predict(X_test))
    f1  = f1_score(y_test, model.predict(X_test), zero_division=0)
    train_logger.info(f"[IntentRetrain] Accuracy={acc:.4f}  F1={f1:.4f}")

    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, INTENT_MODEL_PATH)

    intent_meta = joblib.load(INTENT_META_PATH) if INTENT_META_PATH.exists() else {}
    intent_meta["last_retrain_at"] = datetime.now(timezone.utc).isoformat()
    intent_meta["metrics"] = {"accuracy": round(acc, 4), "f1": round(f1, 4)}
    intent_meta["n_total"] = len(rows)
    joblib.dump(intent_meta, INTENT_META_PATH)

    # Invalider le cache dans intent_classifier
    try:
        from services.intent_classifier import _load_trained_model
        _load_trained_model.cache_clear()
        train_logger.info("[IntentRetrain] Cache intent invalidé — nouveau modèle actif.")
    except Exception as e:
        train_logger.warning(f"[IntentRetrain] Cache non invalidé : {e}")

    return {"accuracy": acc, "f1": f1, "n_total": len(rows)}


INTENT_RETRAIN_THRESHOLD = int(os.getenv("INTENT_RETRAIN_THRESHOLD", "10"))
INTENT_META_PATH = DATASET_DIR / "intent_model_meta.pkl"


def count_new_intent_labels_since_last_retrain() -> int:
    """Compte les labels intent insérés depuis le dernier réentraînement intent."""
    engine = create_engine(DB_URL)
    meta = joblib.load(INTENT_META_PATH) if INTENT_META_PATH.exists() else {}
    last_retrain = meta.get("last_retrain_at")

    with engine.connect() as conn:
        if last_retrain:
            count = conn.execute(text("""
                SELECT COUNT(*) FROM stevia_intent_labels
                WHERE source IN ('auto', 'feedback') AND created_at > :ts
            """), {"ts": last_retrain}).scalar()
        else:
            count = conn.execute(text(
                "SELECT COUNT(*) FROM stevia_intent_labels WHERE source IN ('auto', 'feedback')"
            )).scalar()

    return count or 0


def maybe_retrain() -> bool:
    """
    Déclenche les réentraînements selon leurs déclencheurs propres :
    - classifieur pertinence : 10 feedbacks utilisateur
    - classifieur intent     : 10 nouvelles questions auto-labélisées
    Retourne True si au moins un réentraînement a eu lieu.
    """
    if not DB_URL:
        return False

    did_retrain = False

    # Classifieur pertinence — déclenché par les feedbacks
    try:
        n = count_new_feedbacks_since_last_retrain()
        if n >= RETRAIN_THRESHOLD:
            train_logger.info(f"[Retrain] Seuil atteint ({n}/{RETRAIN_THRESHOLD}) — réentraînement...")
            retrain()
            did_retrain = True
    except Exception as e:
        train_logger.error(f"[Retrain] Erreur pertinence : {e}")

    # Classifieur intent — déclenché par les questions auto-labélisées
    try:
        n_intent = count_new_intent_labels_since_last_retrain()
        if n_intent >= INTENT_RETRAIN_THRESHOLD:
            train_logger.info(f"[IntentRetrain] Seuil atteint ({n_intent}/{INTENT_RETRAIN_THRESHOLD}) — réentraînement...")
            retrain_intent_classifier()
            did_retrain = True
    except Exception as e:
        train_logger.error(f"[IntentRetrain] Erreur intent : {e}")

    return did_retrain


if __name__ == "__main__":
    if not DB_URL:
        train_logger.error("DATABASE_URL non défini.")
        sys.exit(1)
    if "--intent" in sys.argv:
        result = retrain_intent_classifier()
        if result:
            train_logger.info(f"[IntentRetrain] Terminé : {result}")
        else:
            train_logger.info("[IntentRetrain] Aucun réentraînement effectué.")
    else:
        result = retrain()
        if result:
            train_logger.info(f"[Retrain] Terminé : {result}")
        else:
            train_logger.info("[Retrain] Aucun réentraînement effectué.")
