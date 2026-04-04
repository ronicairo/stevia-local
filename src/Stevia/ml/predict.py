"""
Prédiction de pertinence en production.

Ce module est importé par rag_engine.py à l'étape 6 du pipeline RAG.
Il remplace filter_off_topic() par un classifieur ML entraîné.

Si le modèle n'est pas encore entraîné, il lève FileNotFoundError
et rag_engine.py bascule sur l'ancien filtrage par seuils.
"""

import os
from pathlib import Path
from functools import lru_cache

import joblib

from ml.extract_features import extract_features, features_to_list

DATASET_DIR  = Path(__file__).parent / "dataset"
MODEL_PATH   = DATASET_DIR / "best_model.pkl"
META_PATH    = DATASET_DIR / "model_meta.pkl"

# Seuil de probabilité en dessous duquel un doc est jugé non pertinent
RELEVANCE_THRESHOLD = float(os.getenv("ML_RELEVANCE_THRESHOLD", "0.35"))


@lru_cache(maxsize=1)
def _load_model():
    """Charge le modèle une seule fois (cache en mémoire)."""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Modèle ML introuvable : {MODEL_PATH}\n"
            "→ Lancer : python /app/ml/generate_dataset.py && python /app/ml/train_model.py"
        )
    model = joblib.load(MODEL_PATH)
    return model


def predict_relevance(
    question: str,
    docs_with_scores: list,
    roles: list[str],
) -> list:
    """
    Filtre les documents par pertinence ML.

    Args:
        question:        Question de l'utilisateur (après expansion).
        docs_with_scores: Liste de tuples (LCDocument, score, doc_roles)
                          — format retourné par rerank_documents().
        roles:           Rôles de l'utilisateur.

    Returns:
        Sous-liste filtrée conservant uniquement les docs pertinents.
        Si tous sont rejetés, retourne le meilleur (pour éviter réponse vide).

    Raises:
        FileNotFoundError: si le modèle n'est pas encore entraîné.
    """
    model     = _load_model()
    user_role = roles[0] if roles else "user"

    scored = []
    for rank, (doc, score, doc_roles) in enumerate(docs_with_scores, start=1):
        features = extract_features(
            question       = question,
            doc_text       = doc.page_content,
            doc_metadata   = doc.metadata,
            cosine_distance= score,        # score = distance cosinus après reranking
            rank           = rank,
            user_role      = user_role,
        )
        feat_vec  = [features_to_list(features)]
        proba_pos = model.predict_proba(feat_vec)[0][1]
        scored.append((doc, score, doc_roles, proba_pos))

    # Conserver les docs au-dessus du seuil, triés par proba décroissante
    filtered = sorted(
        [(d, s, r, p) for d, s, r, p in scored if p >= RELEVANCE_THRESHOLD],
        key=lambda x: x[3],
        reverse=True,
    )

    if not filtered:
        # Fallback : garder le meilleur si aucun ne passe le seuil
        best = max(scored, key=lambda x: x[3])
        if best[3] < 0.15:
            return []          # rag_engine affichera "pas d'info pertinente"
        return [(best[0], best[1], best[2])]

    return [(d, s, r) for d, s, r, p in filtered]
