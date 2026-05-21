"""
Extraction des features pour le classifieur de pertinence RAG.

Chaque paire (question, document) est convertie en un vecteur de features
qui servira à entraîner et utiliser le modèle supervisé.
"""

import re
import nltk

nltk.download('stopwords', quiet=True)
from nltk.corpus import stopwords

STOP_WORDS = set(stopwords.words('french'))

try:
    import spacy
    _nlp = spacy.load("fr_core_news_sm", disable=["parser", "ner"])
except (ImportError, OSError):
    _nlp = None

def _lemmatize(words: list[str]) -> list[str]:
    if not _nlp or not words:
        return words
    doc = _nlp(" ".join(words))
    return [token.lemma_ for token in doc]

FEATURE_NAMES = [
    "cosine_score",
    "keyword_match_count",
    "keyword_match_ratio",
    "chunk_length",
    "title_match",
    "role_match",
    "query_length",
    "rank_position",
    "book_id",
]


def _question_keywords(question: str) -> list[str]:
    """Mots significatifs de la question, lemmatisés (sans stopwords, longueur >= 2)."""
    raw = [w for w in re.split(r'\W+', question.lower()) if len(w) >= 2 and w not in STOP_WORDS]
    return _lemmatize(raw)


def extract_features(
    question: str,
    doc_text: str,
    doc_metadata: dict,
    cosine_distance: float,
    rank: int,
    user_role: str = "user",
) -> dict:
    """
    Calcule les 9 features pour une paire (question, document).

    Args:
        question:        Question posée par l'utilisateur
        doc_text:        Contenu textuel du chunk
        doc_metadata:    Métadonnées JSONB du chunk (title, roles, book_id, …)
        cosine_distance: Distance cosinus retournée par pgvector (0 = identique)
        rank:            Position dans les résultats de recherche (1 = meilleur)
        user_role:       Rôle de l'utilisateur ('user', 'admin', …)

    Returns:
        dict {feature_name: value}
    """
    # --- 1. Score de similarité (1 − distance) ---
    cosine_score = round(1.0 - cosine_distance, 4)

    # --- 2-3. Correspondance mots-clés ---
    keywords = _question_keywords(question)
    total_kw = max(len(keywords), 1)
    doc_lower = doc_text.lower()
    keyword_match_count = sum(1 for w in keywords if w in doc_lower)
    keyword_match_ratio = round(keyword_match_count / total_kw, 4)

    # --- 4. Longueur du chunk ---
    chunk_length = len(doc_text)

    # --- 5. Correspondance titre ---
    page_title_words = _lemmatize(doc_metadata.get("title", "").lower().split())
    title_match = int(any(w in page_title_words for w in keywords)) if keywords else 0

    # --- 6. Correspondance rôle utilisateur ---
    doc_roles_raw = doc_metadata.get("roles", "all")
    doc_roles = [r.strip() for r in doc_roles_raw.split(",")]
    role_match = int(
        user_role in doc_roles
        or "all" in doc_roles
        or user_role == "admin"
    )

    # --- 7. Longueur de la question (en mots) ---
    query_length = len(question.split())

    # --- 8. Position dans les résultats ---
    rank_position = rank

    # --- 9. Identifiant du livre (catégoriel) ---
    try:
        book_id = int(doc_metadata.get("book_id") or 0)
    except (ValueError, TypeError):
        book_id = 0

    return {
        "cosine_score":        cosine_score,
        "keyword_match_count": keyword_match_count,
        "keyword_match_ratio": keyword_match_ratio,
        "chunk_length":        chunk_length,
        "title_match":         title_match,
        "role_match":          role_match,
        "query_length":        query_length,
        "rank_position":       rank_position,
        "book_id":             book_id,
    }


def features_to_list(feature_dict: dict) -> list:
    """Retourne les valeurs dans l'ordre attendu par le modèle."""
    return [feature_dict[k] for k in FEATURE_NAMES]
