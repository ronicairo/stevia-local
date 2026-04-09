import logging
import os
import time
import nltk
import re

_LOG_DIR = os.getenv("STEVIA_LOG_DIR", "/app/var_log")
os.makedirs(_LOG_DIR, exist_ok=True)
rag_logger = logging.getLogger("stevia")
rag_logger.setLevel(logging.INFO)

from functools import lru_cache
from langchain_core.documents import Document as LCDocument
from langchain_postgres import PGVector
from langchain_community.embeddings import FastEmbedEmbeddings
from sqlalchemy import create_engine, text
from services.mistral_utils import refine_answer_streaming
from services.bookstack_reader import parse_bookstack_page
from services.synonymes import expand_question

nltk.download('stopwords', quiet=True)
from nltk.corpus import stopwords

STOP_WORDS = set(stopwords.words('french'))

DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("DATABASE_URL non défini dans le .env")

BOOKSTACK_URL = os.getenv("BOOKSTACK_URL")
if not BOOKSTACK_URL:
    raise ValueError("BOOKSTACK_URL non défini dans le .env")

# URL publique pour les liens affichés à l'utilisateur (ex: http://localhost:8080)
BOOKSTACK_PUBLIC_URL = os.getenv("BOOKSTACK_PUBLIC_URL", BOOKSTACK_URL)

ENGINE = create_engine(
    DB_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=1800,
)

def db_exec(stmt: str, params: dict | None = None):
    with ENGINE.begin() as conn:
        return conn.execute(text(stmt), params or {})

embeddings = FastEmbedEmbeddings(model_name="BAAI/bge-small-en-v1.5")

@lru_cache(maxsize=1)
def get_vector_store():
    return PGVector(
        connection=DB_URL,
        embeddings=embeddings,
        collection_name="global",
    )

def get_page_url(metadata: dict) -> str:
    """Construit l'URL de la page BookStack."""
    slug = metadata.get("slug", "")
    book_slug = metadata.get("book_slug", "")
    page_id = metadata.get("page_id")

    if slug and book_slug:
        return f"{BOOKSTACK_PUBLIC_URL}/books/{book_slug}/page/{slug}"
    elif page_id:
        return f"{BOOKSTACK_PUBLIC_URL}/link/{page_id}"
    return ""


# FONCTIONS UTILITAIRES RAG
def extract_search_keywords(question: str) -> list[str]:
    """Extrait les mots-clés de recherche (sans stop words ni apostrophes)."""
    keywords = [w for w in question.lower().split() if len(w) >= 2 and w not in STOP_WORDS]
    return [w for w in keywords if "'" not in w]


def search_by_keywords(keywords: list[str], existing_docs: list) -> list[tuple]:
    """Recherche par mots-clés dans la base (complément à la recherche vectorielle)."""
    if not keywords:
        return []

    results = []
    try:
        safe_keywords = [w.replace("'", "''") for w in keywords]
        conditions = " AND ".join([f"document ILIKE '%{w}%'" for w in safe_keywords])
        query = f"""
            SELECT document, cmetadata
            FROM langchain_pg_embedding
            WHERE {conditions}
            LIMIT 2
        """
        keyword_results = db_exec(query).fetchall()

        for row in keyword_results:
            already_found = any(
                doc.page_content[:100] == row.document[:100]
                for doc, _ in existing_docs
            )
            if not already_found:
                metadata = row.cmetadata if isinstance(row.cmetadata, dict) else {}
                new_doc = LCDocument(page_content=row.document, metadata=metadata)
                results.append((new_doc, 0.10))

    except Exception as e:
        pass  # silencieux — recherche lexicale optionnelle

    return results


def rerank_documents(docs_with_scores: list, question: str, roles: list[str]) -> list[tuple]:
    """Applique le boost par rôle et titre/gras, puis trie."""
    reranked = []
    question_words = set(w for w in question.lower().split() if len(w) > 3)

    for doc, score in docs_with_scores:
        doc_roles = doc.metadata.get("roles", "all").split(",")

        # Boost par rôle (normalise role_admin → admin, etc.)
        norm_roles = [r.replace("role_", "") for r in roles]
        role_boost = 0
        if "admin" not in norm_roles:
            if any(r in doc_roles for r in norm_roles) or "all" in doc_roles:
                role_boost = 0.05

        # Boost par titre/gras (décompose aussi les mots avec tiret ex: "aide-mémoire" → "aide","mémoire")
        title_words_str = doc.metadata.get("title_words", "")
        title_words = set()
        for w in title_words_str.lower().split(","):
            title_words.add(w)
            if "-" in w:
                title_words.update(w.split("-"))

        bold_words_str = doc.metadata.get("bold_words", "")
        bold_words = set()
        for w in bold_words_str.lower().split(","):
            bold_words.add(w)
            if "-" in w:
                bold_words.update(w.split("-"))

        title_matches = question_words & title_words
        bold_matches = question_words & bold_words

        text_boost = len(title_matches) * 0.08 + len(bold_matches) * 0.04

        adjusted_score = score - (role_boost + text_boost)
        reranked.append((doc, adjusted_score, doc_roles))

    return sorted(reranked, key=lambda x: x[1])


def filter_off_topic(best_score: float, second_score: float) -> str | None:
    """Retourne un message de rejet si hors-sujet, sinon None."""
    score_gap = second_score - best_score

    if best_score > 0.75:
        return "Cette question ne relève pas de la documentation SUCRE."

    if best_score > 0.65 and score_gap < 0.05:
        return "Cette question ne semble pas concerner la documentation SUCRE."

    return None


def build_context(docs_with_scores: list, best_page_id: str, search_keywords: list[str]) -> tuple[str, list[str], dict]:
    """Construit le contexte à partir des chunks de la meilleure page."""

    # Filtre les docs de la même page
    same_page_docs = [doc for doc, score, roles in docs_with_scores if doc.metadata.get("page_id") == best_page_id]

    # Fonction de scoring pour prioriser les chunks avec mots-clés adjacents
    def count_keyword_matches(doc):
        content_lower = doc.page_content.lower()
        if re.search(r'seuil\s+ar', content_lower):
            return 100
        return sum(1 for w in search_keywords if w in content_lower)

    same_page_docs = sorted(same_page_docs, key=count_keyword_matches, reverse=True)

    max_chars_per_doc = 2000
    max_total_chars = 4000

    context_parts = []
    all_images = []
    seen_images = set()
    seen_content = set()
    total_chars = 0
    best_metadata = same_page_docs[0].metadata if same_page_docs else {}
    best_title = best_metadata.get("title", "Inconnu")

    for doc in same_page_docs:
        content = " ".join(doc.page_content[:max_chars_per_doc].split())
        content_hash = hash(content[:100])

        if content_hash in seen_content:
            continue
        seen_content.add(content_hash)

        if total_chars + len(content) > max_total_chars:
            break

        context_parts.append(content)
        total_chars += len(content)

        images_str = doc.metadata.get("images", "")
        if images_str:
            for img_url in images_str.split(","):
                img_url = img_url.strip()
                if img_url and img_url not in seen_images:
                    seen_images.add(img_url)
                    all_images.append(img_url)

    all_images = all_images[:2]
    context = f"[Source: {best_title}]\n\n" + "\n\n".join(context_parts)

    return context, all_images, best_metadata


def is_rejection_response(llm_response: str) -> bool:
    """Vérifie si la réponse LLM est un rejet."""
    rejection_phrases = [
        "cette question ne relève pas de la documentation sucre",
        "cette question ne semble pas concerner la documentation sucre",
        "cette question ne concerne pas sucre",
        "information absente",
        "n'est pas présente dans le document",
        "n'est pas mentionné",
        "pas trouvé dans le document",
        "pas présent dans le document",
        "je ne trouve pas",
        "aucune information",
        "pas d'information",
    ]
    return any(phrase in llm_response.lower() for phrase in rejection_phrases)


# FONCTION PRINCIPALE RAG
def log_question_features(question: str, best_doc, best_score: float, rank: int, roles: list[str]):
    """Enregistre les features ML de la question en BDD pour labélisation future."""
    try:
        from ml.extract_features import extract_features
        user_role = roles[0] if roles else "user"
        feats = extract_features(
            question=question,
            doc_text=best_doc.page_content,
            doc_metadata=best_doc.metadata,
            cosine_distance=best_score,
            rank=rank,
            user_role=user_role,
        )
        db_exec("""
            INSERT INTO stevia_ml_feedback
                (question, cosine_score, keyword_match_count, keyword_match_ratio,
                 chunk_length, title_match, role_match, query_length, rank_position, book_id)
            VALUES
                (:question, :cosine_score, :keyword_match_count, :keyword_match_ratio,
                 :chunk_length, :title_match, :role_match, :query_length, :rank_position, :book_id)
        """, {"question": question[:500], **feats})
    except Exception:
        pass


def rag_answer_streaming(question: str, roles: list[str] = ["user"]):
    """Générateur de réponse en streaming avec filtrage."""

    # --- 1. SALUTATIONS ---
    greetings = ["bonjour", "salut", "hello", "bonsoir", "hi", "coucou", "yo"]
    clean_q = question.lower().strip().rstrip("!.,?")

    if clean_q in greetings:
        yield "Bonjour, que puis-je faire pour vous ?"
        return

    # --- 2. EXPANSION DES ABRÉVIATIONS ---
    expanded_question = expand_question(question)
    search_keywords = extract_search_keywords(expanded_question)

    # --- 3. RECHERCHE VECTORIELLE ---
    store = get_vector_store()
    try:
        docs_with_scores = store.similarity_search_with_score(expanded_question, k=12)
    except Exception as e:
        yield "Erreur technique lors de la recherche."
        return

    # --- 4. RECHERCHE PAR MOTS-CLÉS (complément) ---
    keyword_docs = search_by_keywords(search_keywords, docs_with_scores)
    docs_with_scores.extend(keyword_docs)

    if not docs_with_scores:
        yield "Je n'ai trouvé aucune information pertinente."
        return

    # --- 5. RERANKING ---
    docs_with_scores = rerank_documents(docs_with_scores, expanded_question, roles)

    # --- 6. FILTRAGE PAR CLASSIFIEUR ML (remplace filter_off_topic) ---
    best_score_before_ml = docs_with_scores[0][1]
    try:
        from ml.predict import predict_relevance
        filtered = predict_relevance(expanded_question, docs_with_scores, roles)
        # Si le meilleur doc avant ML avait un très bon score (< 0.15), on le protège
        if not filtered or (filtered[0][1] > best_score_before_ml + 0.05 and best_score_before_ml < 0.15):
            docs_with_scores = docs_with_scores  # garder tous les docs
        else:
            docs_with_scores = filtered
        if not docs_with_scores:
            yield "Je n'ai pas trouvé de documentation pertinente pour cette question."
            return
    except FileNotFoundError:
        # Modèle pas encore entraîné → fallback sur l'ancien filtrage par seuils
        best_score   = docs_with_scores[0][1]
        second_score = docs_with_scores[1][1] if len(docs_with_scores) > 1 else 1.0
        rejection_msg = filter_off_topic(best_score, second_score)
        if rejection_msg:
            yield rejection_msg
            return
    except Exception:
        best_score   = docs_with_scores[0][1]
        second_score = docs_with_scores[1][1] if len(docs_with_scores) > 1 else 1.0
        rejection_msg = filter_off_topic(best_score, second_score)
        if rejection_msg:
            yield rejection_msg
            return

    # --- 7. VÉRIFICATION RÔLE ---
    best_doc = docs_with_scores[0][0]
    best_doc_roles = docs_with_scores[0][2]
    best_page_id = best_doc.metadata.get("page_id")

    # Normalise les rôles : "role_admin" → "admin", "role_recouv" → "recouv"
    normalized_roles = [r.replace("role_", "") for r in roles]

    user_has_role = (
        any(r in best_doc_roles for r in normalized_roles)
        or "all" in best_doc_roles
        or "admin" in normalized_roles
    )

    if not user_has_role:
        role_display = best_doc_roles[0].upper() if best_doc_roles else "autre profil"
        yield f"⚠️ Cette documentation concerne le profil **{role_display}**.\n\n"

    # --- 8. CONSTRUCTION CONTEXTE ---
    context, all_images, best_metadata = build_context(docs_with_scores, best_page_id, search_keywords)

    # --- 8b. LOG FEATURES POUR FEEDBACK ---
    log_question_features(question, best_doc, docs_with_scores[0][1], rank=1, roles=roles)

    # --- 9. GÉNÉRATION LLM ---
    llm_response = ""
    for chunk in refine_answer_streaming(context, expanded_question):
        llm_response += chunk
        yield chunk

    # --- 10. IMAGES ET LIEN SOURCE ---
    is_rejection = is_rejection_response(llm_response)

    if all_images and not is_rejection:
        yield "\n\n**Documentation visuelle :**\n"
        for img_url in all_images:
            yield f"![image]({img_url})\n"

    if not is_rejection:
        source_url = get_page_url(best_metadata)
        if source_url:
            yield "\n"
            yield f'<a href="{source_url}" target="_blank" class="source-link">Voir la source documentaire.</a>'


def rag_answer_streaming_debug(question: str):
    """Version DEBUG avec timing."""
    timings = {}

    t0 = time.time()
    store = get_vector_store()
    timings["store"] = (time.time() - t0) * 1000

    t1 = time.time()
    docs_with_scores = store.similarity_search_with_score(question, k=4)
    timings["search"] = (time.time() - t1) * 1000

    if not docs_with_scores:
        yield "Aucun document trouvé."
        return

    t2 = time.time()
    context = "\n\n".join([doc.page_content[:1000] for doc, _ in docs_with_scores])
    timings["context"] = (time.time() - t2) * 1000

    print(f"\n{'='*40}")
    print(f"  Store:   {timings['store']:>7.1f} ms")
    print(f"  Search:  {timings['search']:>7.1f} ms")
    print(f"  Context: {timings['context']:>7.1f} ms")
    print(f"{'='*40}")

    t3 = time.time()
    first_token = True

    for chunk in refine_answer_streaming(context, question):
        if first_token:
            print(f"  LLM 1st: {(time.time() - t3) * 1000:>7.1f} ms")
            first_token = False
        yield chunk

    print(f"  LLM tot: {(time.time() - t3) * 1000:>7.1f} ms")
    print(f"  TOTAL:   {(time.time() - t0) * 1000:>7.1f} ms")
    print(f"{'='*40}\n")

def delete_vectors_by_book_id(book_id: int):
    res = db_exec("""
        DELETE FROM langchain_pg_embedding
        WHERE cmetadata ->> 'source' = 'bookstack'
          AND cmetadata ->> 'book_id' = :bid
    """, {"bid": str(book_id)})

def index_bookstack_book(book_id: int, pages: list[dict], book_name: str = "", book_slug: str = None, book_tags: list = None) -> dict:
    delete_vectors_by_book_id(book_id)

    all_docs = []
    pages_kept = 0

    for page in pages:
        docs = parse_bookstack_page(page, book_name=book_name, book_slug=book_slug, book_tags=book_tags or [])
        if not docs:
            continue
        all_docs.extend(docs)
        pages_kept += 1

    if not all_docs:
        return {"pages": 0, "chunks": 0}

    store = get_vector_store()
    store.add_documents(all_docs)

    return {"pages": pages_kept, "chunks": len(all_docs)}

def list_indexed_bookstack_books() -> list[dict]:
    try:
        rows = db_exec("""
            SELECT
                cmetadata->>'book_id' AS book_id,
                MAX(cmetadata->>'book_name') AS book_name,
                MAX(cmetadata->>'indexed_at') AS indexed_at,
                COUNT(DISTINCT cmetadata->>'page_id') AS pages,
                COUNT(*) AS chunks
            FROM langchain_pg_embedding
            WHERE cmetadata->>'source' = 'bookstack'
              AND cmetadata ? 'book_id'
            GROUP BY cmetadata->>'book_id'
            ORDER BY MAX(cmetadata->>'indexed_at') DESC
        """).fetchall()
        return [
            {"book_id": r.book_id, "book_name": r.book_name, "indexed_at": r.indexed_at, "pages": r.pages, "chunks": r.chunks}
            for r in rows
        ]
    except Exception:
        return []

def get_book_indexed_at(book_id: int) -> str | None:
    try:
        r = db_exec("""
            SELECT MAX(cmetadata->>'indexed_at') AS indexed_at
            FROM langchain_pg_embedding
            WHERE cmetadata->>'source' = 'bookstack'
              AND cmetadata->>'book_id' = :bid
        """, {"bid": str(book_id)}).fetchone()
        return r.indexed_at if r else None
    except Exception:
        return None