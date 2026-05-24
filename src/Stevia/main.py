from fastapi import FastAPI, Query, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Optional

import hmac
import hashlib
import logging
import logging.handlers
import os
import json
import re
import requests
from pathlib import Path

# ── Formatter style Monolog ───────────────────────────────────────────────────
class MonologFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        dt = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()
        return f"[{dt}] {record.name}.{record.levelname}: {record.getMessage()}"

# ── Loggers Python (fichiers montés depuis var/log/) ──────────────────────────
_LOG_DIR = os.getenv("STEVIA_LOG_DIR", "/app/var_log")
os.makedirs(_LOG_DIR, exist_ok=True)

_log_date = datetime.now().strftime("%Y-%m-%d")

stevia_logger = logging.getLogger("stevia")
stevia_logger.setLevel(logging.INFO)
_stevia_handler = logging.FileHandler(os.path.join(_LOG_DIR, f"stevia-{_log_date}.log"))
_stevia_handler.setFormatter(MonologFormatter())
stevia_logger.addHandler(_stevia_handler)

train_logger = logging.getLogger("stevia_training")
train_logger.setLevel(logging.INFO)
_train_handler = logging.FileHandler(os.path.join(_LOG_DIR, f"stevia_training-{_log_date}.log"))
_train_handler.setFormatter(MonologFormatter())
train_logger.addHandler(_train_handler)

# Désactiver les logs d'accès uvicorn (questions posées, requêtes /health, etc.)
logging.getLogger("uvicorn.access").setLevel(logging.CRITICAL)
logging.getLogger("uvicorn.access").propagate = False

from services.rag_engine import (
    index_bookstack_book,
    delete_vectors_by_book_id,
    list_indexed_bookstack_books,
    get_book_indexed_at,
    rag_answer_streaming,
    rag_answer_streaming_debug,
    db_exec,
)

BOOKSTACK_URL = os.getenv("BOOKSTACK_URL")
if not BOOKSTACK_URL:
    raise ValueError("BOOKSTACK_URL non défini dans le .env")

BOOKSTACK_TOKEN_ID = os.getenv("BOOKSTACK_TOKEN_ID")
if not BOOKSTACK_TOKEN_ID:
    raise ValueError("BOOKSTACK_TOKEN_ID non défini dans le .env")

BOOKSTACK_TOKEN_SECRET = os.getenv("BOOKSTACK_TOKEN_SECRET")
if not BOOKSTACK_TOKEN_SECRET:
    raise ValueError("BOOKSTACK_TOKEN_SECRET non défini dans le .env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryModel(BaseModel):
    question: str
    roles: list[str] = ["user"]

class FeedbackModel(BaseModel):
    message_id: str = ""
    question: str
    answer: str = ""
    feedback: str  # "positive" ou "negative"
    user: str = "inconnu"



def get_bookstack_headers():
    return {"Authorization": f"Token {BOOKSTACK_TOKEN_ID}:{BOOKSTACK_TOKEN_SECRET}"}


def init_feedback_table():
    """Crée les tables de feedback si elles n'existent pas."""
    try:
        db_exec("""
            CREATE TABLE IF NOT EXISTS stevia_ml_feedback (
                id                   SERIAL PRIMARY KEY,
                question             TEXT NOT NULL,
                cosine_score         FLOAT,
                keyword_match_count  INT,
                keyword_match_ratio  FLOAT,
                chunk_length         INT,
                title_match          SMALLINT,
                role_match           SMALLINT,
                query_length         INT,
                rank_position        INT,
                book_id              INT,
                label                SMALLINT,
                feedback_value       VARCHAR(20),
                created_at           TIMESTAMP DEFAULT NOW(),
                labeled_at           TIMESTAMP
            )
        """)
    except Exception as e:
        stevia_logger.error(f"[Init] Erreur création table feedback : {e}")
    try:
        db_exec("""
            CREATE TABLE IF NOT EXISTS stevia_intent_labels (
                id         SERIAL PRIMARY KEY,
                question   TEXT NOT NULL,
                label      SMALLINT NOT NULL,
                source     VARCHAR(20) DEFAULT 'auto',
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
    except Exception as e:
        stevia_logger.error(f"[Init] Erreur création table intent_labels : {e}")


def seed_intent_labels():
    """Insère les 34 prototypes hardcodés si la table est vide, puis entraîne intent_model.pkl."""
    try:
        count = db_exec("SELECT COUNT(*) FROM stevia_intent_labels").fetchone()[0]
        if count > 0:
            return
        from services.intent_classifier import _VALID, _INVALID
        for q in _VALID:
            db_exec("INSERT INTO stevia_intent_labels (question, label, source) VALUES (:q, 1, 'seed')", {"q": q})
        for q in _INVALID:
            db_exec("INSERT INTO stevia_intent_labels (question, label, source) VALUES (:q, 0, 'seed')", {"q": q})
        train_logger.info(f"[IntentSeed] {len(_VALID)+len(_INVALID)} prototypes insérés dans stevia_intent_labels.")
    except Exception as e:
        train_logger.error(f"[IntentSeed] Erreur seed intent labels : {e}")
        return

    # Entraîne intent_model.pkl tout de suite si pas encore présent
    try:
        from pathlib import Path
        intent_model_path = Path(__file__).parent / "ml" / "dataset" / "intent_model.pkl"
        if not intent_model_path.exists():
            from ml.retrain_from_feedback import retrain_intent_classifier
            retrain_intent_classifier()
            train_logger.info("[IntentSeed] intent_model.pkl entraîné depuis les prototypes.")
    except Exception as e:
        train_logger.error(f"[IntentSeed] Erreur entraînement intent initial : {e}")


@app.on_event("startup")
def startup():
    init_feedback_table()
    seed_intent_labels()
    # Initialise les tables PGVector (crée langchain_pg_embedding si absente)
    try:
        from services.rag_engine import get_vector_store
        get_vector_store()
    except Exception as e:
        stevia_logger.error(f"[Init] PGVector init error: {e}")


@app.post("/ask/stream")
async def ask_stream(payload: QueryModel, request: Request):
    async def event_generator():
        for chunk in rag_answer_streaming(payload.question, roles=payload.roles):
            if await request.is_disconnected():
                break
            yield json.dumps({"content": chunk}) + "\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/feedback")
async def receive_feedback(payload: FeedbackModel):
    """
    Reçoit le feedback utilisateur (👍/👎), labélise le dernier log
    associé à cette question, puis déclenche un réentraînement si le
    seuil est atteint.
    """
    label = 1 if payload.feedback == "positive" else 0

    try:
        db_exec("""
            UPDATE stevia_ml_feedback
            SET label          = :label,
                feedback_value = :fv,
                labeled_at     = NOW()
            WHERE id = (
                SELECT id FROM stevia_ml_feedback
                WHERE question = :question
                  AND label IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            )
        """, {"label": label, "fv": payload.feedback, "question": payload.question[:500]})

        clean_answer = re.sub(r"⚠️[^\n]*\n\n", "", payload.answer).strip()
        answer_preview = (clean_answer[:300] + "…") if len(clean_answer) > 300 else clean_answer
        label_str = "positif" if label == 1 else "négatif"
        stevia_logger.info(
            f"Feedback {label_str} "
            + json.dumps({
                "user": payload.user,
                "question": payload.question[:200],
                "answer": answer_preview,
            }, ensure_ascii=False)
        )

    except Exception as e:
        stevia_logger.error(f"[Feedback] Erreur mise à jour label : {e}")
        return {"status": "error", "message": str(e)}

    # 👍 → label=1 dans stevia_intent_labels pour enrichir le classifieur d'intention
    if label == 1:
        try:
            existing = db_exec(
                "SELECT COUNT(*) FROM stevia_intent_labels WHERE question = :q",
                {"q": payload.question[:500]}
            ).scalar()
            if not existing:
                db_exec(
                    "INSERT INTO stevia_intent_labels (question, label, source) VALUES (:q, 1, 'feedback')",
                    {"q": payload.question[:500]}
                )
        except Exception as e:
            stevia_logger.error(f"[Feedback] Erreur insertion intent label : {e}")

    # Réentraînement automatique si seuil atteint
    try:
        from ml.retrain_from_feedback import maybe_retrain
        retrained = maybe_retrain()
        if retrained:
            stevia_logger.info("[Feedback] Réentraînement automatique déclenché.")
            return {"status": "ok", "retrained": True}
    except Exception as e:
        stevia_logger.error(f"[Feedback] Erreur réentraînement : {e}")

    return {"status": "ok", "retrained": False}


@app.post("/index/bookstack/book/{book_id}")
async def index_book(book_id: int, force: bool = Query(False)):
    if not BOOKSTACK_URL:
        return {"status": "error", "message": "BOOKSTACK_URL non configuré"}

    headers = get_bookstack_headers()

    try:
        response = requests.get(f"{BOOKSTACK_URL}/api/books/{book_id}", headers=headers, timeout=30)
        response.raise_for_status()
        book = response.json()

        book_name = book.get("name", "")
        book_updated_at = book.get("updated_at", "")
        book_slug = book.get("slug", "")
        book_tags = book.get("tags", [])

        if not force:
            indexed_at = get_book_indexed_at(book_id)
            if indexed_at and book_updated_at:
                try:
                    book_date = datetime.fromisoformat(book_updated_at.replace("Z", "+00:00"))
                    index_date = datetime.fromisoformat(indexed_at)
                    if index_date >= book_date:
                        return {
                            "status": "skipped",
                            "message": f"Livre '{book_name}' déjà à jour",
                            "indexed_at": indexed_at,
                        }
                except Exception as e:
                    stevia_logger.error(f"Erreur comparaison dates : {e}")

        pages_data: list[dict] = []

        for item in book.get("contents", []):
            if item.get("type") == "page":
                page_resp = requests.get(f"{BOOKSTACK_URL}/api/pages/{item['id']}", headers=headers, timeout=30)
                if page_resp.ok:
                    pages_data.append(page_resp.json())

            elif item.get("type") == "chapter":
                chapter_resp = requests.get(f"{BOOKSTACK_URL}/api/chapters/{item['id']}", headers=headers, timeout=30)
                if chapter_resp.ok:
                    for p in chapter_resp.json().get("pages", []):
                        page_resp = requests.get(f"{BOOKSTACK_URL}/api/pages/{p['id']}", headers=headers, timeout=30)
                        if page_resp.ok:
                            pages_data.append(page_resp.json())

        if not pages_data:
            return {"status": "error", "message": "Aucune page trouvée dans ce livre"}

        result = index_bookstack_book(book_id, pages_data, book_name=book_name, book_slug=book_slug, book_tags=book_tags)

        return {
            "status": "indexed",
            "book_id": book_id,
            "book_name": book_name,
            "pages": result["pages"],
            "chunks": result["chunks"],
        }

    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": f"Erreur API BookStack : {str(e)}"}
    except Exception as e:
        stevia_logger.error(f"Erreur indexation : {e}")
        return {"status": "error", "message": str(e)}


@app.delete("/index/bookstack/book/{book_id}")
async def delete_book_index(book_id: int):
    if not BOOKSTACK_URL:
        return {"status": "error", "message": "BOOKSTACK_URL non configuré"}

    try:
        resp = requests.get(
            f"{BOOKSTACK_URL}/api/books/{book_id}",
            headers=get_bookstack_headers(),
            timeout=10
        )
        book_name = resp.json().get("name", f"Livre {book_id}") if resp.ok else f"Livre {book_id}"
        delete_vectors_by_book_id(book_id)
        return {"status": "deleted", "book_id": book_id, "book_name": book_name}

    except Exception as e:
        return {"status": "error", "message": str(e), "book_id": book_id}


@app.get("/bookstack/books")
async def list_bookstack_books():
    if not BOOKSTACK_URL:
        return {"status": "error", "message": "BOOKSTACK_URL non configuré", "data": []}

    try:
        shelves_response = requests.get(
            f"{BOOKSTACK_URL}/api/shelves",
            headers=get_bookstack_headers(),
            timeout=10
        )
        shelves_response.raise_for_status()
        shelves = shelves_response.json().get("data", [])

        sucre_shelf = next((s for s in shelves if s.get("slug") == "sucre"), None)
        if not sucre_shelf:
            return {"status": "error", "message": "Étagère SUCRE non trouvée", "data": []}

        shelf_detail = requests.get(
            f"{BOOKSTACK_URL}/api/shelves/{sucre_shelf['id']}",
            headers=get_bookstack_headers(),
            timeout=10
        )
        shelf_detail.raise_for_status()
        books = shelf_detail.json().get("books", [])

        indexed_books = {b["book_id"]: b for b in list_indexed_bookstack_books()}
        books_with_pages = []

        for book in books:
            book_id = str(book["id"])

            try:
                book_detail = requests.get(
                    f"{BOOKSTACK_URL}/api/books/{book['id']}",
                    headers=get_bookstack_headers(),
                    timeout=10,
                )
                if not book_detail.ok:
                    continue

                detail_data = book_detail.json()
                contents = detail_data.get("contents", [])
                page_count = sum(1 for c in contents if c.get("type") == "page")
                for c in contents:
                    if c.get("type") == "chapter":
                        page_count += len(c.get("pages", []))

                if page_count == 0:
                    continue

                book["page_count"] = page_count
                if detail_data.get("updated_at"):
                    book["updated_at"] = detail_data["updated_at"]

            except Exception as e:
                stevia_logger.error(f"Erreur récupération livre {book['id']} : {e}")
                continue

            if book_id in indexed_books:
                book["indexed"] = True
                book["indexed_at"] = indexed_books[book_id]["indexed_at"]
                book["indexed_pages"] = indexed_books[book_id]["pages"]
                book["indexed_chunks"] = indexed_books[book_id]["chunks"]

                book_updated = book.get("updated_at", "")
                indexed_at = indexed_books[book_id]["indexed_at"]
                if book_updated and indexed_at:
                    try:
                        book_date = datetime.fromisoformat(book_updated.replace("Z", "+00:00"))
                        index_date = datetime.fromisoformat(indexed_at)
                        book["needs_update"] = book_date > index_date
                    except Exception:
                        book["needs_update"] = False
                else:
                    book["needs_update"] = False
            else:
                book["indexed"] = False
                book["indexed_at"] = None
                book["indexed_pages"] = 0
                book["indexed_chunks"] = 0
                book["needs_update"] = False

            books_with_pages.append(book)

        return {"status": "ok", "data": books_with_pages}

    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}


@app.get("/indexed/bookstack/books")
def indexed_books():
    return {"status": "ok", "data": list_indexed_bookstack_books()}


@app.post("/webhook/bookstack")
async def bookstack_webhook(
    request: Request,
    x_bookstack_signature: Optional[str] = Header(None, alias="X-Bookstack-Signature")
):
    body = await request.body()

    try:
        payload = await request.json()
    except:
        return {"status": "error", "message": "Invalid JSON"}

    event = payload.get("event", "")
    related_item = payload.get("related_item", {})

    reindex_events = [
        "page_create", "page_update", "page_delete",
        "chapter_create", "chapter_update", "chapter_delete",
        "book_update", "book_create", "bookshelf_update"
    ]

    if event not in reindex_events:
        return {"status": "ignored", "event": event}

    # shelf_update : on compare les livres de la shelf avec ceux déjà indexés
    if event == "bookshelf_update":
        shelf_id = related_item.get("id")
        if not shelf_id:
            return {"status": "ignored", "message": "shelf_id manquant"}
        try:
            shelf_data = requests.get(f"{BOOKSTACK_URL}/api/shelves/{shelf_id}", headers=get_bookstack_headers(), timeout=10).json()
            if shelf_data.get("slug") != "sucre":
                return {"status": "ignored", "message": "Shelf hors SUCRE"}
            shelf_book_ids = {b["id"] for b in shelf_data.get("books", [])}
            indexed_ids = {int(r["book_id"]) for r in db_exec("SELECT DISTINCT cmetadata->>'book_id' AS book_id FROM langchain_pg_embedding WHERE cmetadata->>'book_id' IS NOT NULL").fetchall()}
            new_ids = shelf_book_ids - indexed_ids
            results = []
            for bid in new_ids:
                r = await index_book(bid, force=True)
                results.append(r)
            return {"status": "success", "indexed": results}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    book_id = None
    if "book_id" in related_item:
        book_id = related_item["book_id"]
    elif event in ("book_create", "book_update") and "id" in related_item:
        book_id = related_item.get("id")

    try:
        shelves = requests.get(f"{BOOKSTACK_URL}/api/shelves", headers=get_bookstack_headers(), timeout=10).json().get("data", [])
        sucre_shelf = next((s for s in shelves if s.get("slug") == "sucre"), None)
        if sucre_shelf:
            shelf_books = requests.get(f"{BOOKSTACK_URL}/api/shelves/{sucre_shelf['id']}", headers=get_bookstack_headers(), timeout=10).json().get("books", [])
            if not any(b.get("id") == book_id for b in shelf_books):
                return {"status": "ignored", "message": "Livre hors étagère SUCRE"}
    except Exception as e:
        stevia_logger.error(f"Erreur vérification étagère : {e}")

    try:
        result = await index_book(book_id, force=True)
        return {"status": "success", "result": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/index/bookstack/all")
async def index_all_books():
    if not BOOKSTACK_URL:
        return {"status": "error", "message": "BOOKSTACK_URL non configuré"}

    headers = get_bookstack_headers()
    results = []
    total_pages = 0
    total_chunks = 0

    try:
        shelves_response = requests.get(f"{BOOKSTACK_URL}/api/shelves", headers=headers, timeout=10)
        shelves_response.raise_for_status()
        shelves = shelves_response.json().get("data", [])

        sucre_shelf = next((s for s in shelves if s.get("slug") == "sucre"), None)
        if not sucre_shelf:
            return {"status": "error", "message": "Étagère SUCRE non trouvée"}

        shelf_detail = requests.get(f"{BOOKSTACK_URL}/api/shelves/{sucre_shelf['id']}", headers=headers, timeout=10)
        shelf_detail.raise_for_status()
        books = shelf_detail.json().get("books", [])

        for book in books:
            book_id = book.get("id")
            book_name = book.get("name", "")
            result = await index_book(book_id, force=True)
            pages = result.get("pages", 0)
            chunks = result.get("chunks", 0)
            total_pages += pages
            total_chunks += chunks
            results.append({
                "book_id": book_id, "book_name": book_name,
                "status": result.get("status", "error"),
                "pages": pages, "chunks": chunks
            })

        return {
            "status": "success",
            "total_books": len(results),
            "total_pages": total_pages,
            "total_chunks": total_chunks,
            "results": results
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.delete("/index/bookstack/all")
async def delete_all_books():
    try:
        db_exec("DELETE FROM langchain_pg_embedding WHERE cmetadata ->> 'source' = 'bookstack'", {})
        return {"status": "success", "message": "Tous les livres ont été désindexés"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/webhook/bookstack/test")
async def test_webhook():
    return {"status": "ok", "message": "Webhook endpoint ready"}


# =============================================================
# ML — Entraînement du classifieur de pertinence
# =============================================================

_ML_DIR = Path(__file__).parent / "ml"

ML_STEPS = {
    "generate":  str(_ML_DIR / "generate_dataset.py"),
    "train":     str(_ML_DIR / "train_model.py"),
    "optimize":  str(_ML_DIR / "optimize_model.py"),
    "evaluate":  str(_ML_DIR / "evaluate_model.py"),
    "retrain":   str(_ML_DIR / "retrain_from_feedback.py"),
}


@app.get("/ml/status")
def ml_status():
    """Retourne l'état du modèle ML et les statistiques de feedback."""
    import sys
    import joblib

    dataset_dir = _ML_DIR / "dataset"
    model_path  = dataset_dir / "best_model.pkl"
    meta_path   = dataset_dir / "model_meta.pkl"
    dataset_path = dataset_dir / "stevia_relevance_dataset.csv"

    status = {
        "model_trained": model_path.exists(),
        "model_name": None,
        "metrics": {},
        "n_train": None,
        "last_retrain_at": None,
        "dataset_size": None,
        "feedback_total": 0,
        "feedback_labeled": 0,
        "feedback_pending": 0,
    }

    if meta_path.exists():
        try:
            meta = joblib.load(meta_path)
            status["model_name"]      = meta.get("name")
            status["metrics"]         = meta.get("metrics", {})
            status["n_train"]         = meta.get("n_train")
            status["last_retrain_at"] = meta.get("last_retrain_at")
        except Exception:
            pass

    if dataset_path.exists():
        try:
            import pandas as pd
            df = pd.read_csv(dataset_path)
            status["dataset_size"] = len(df)
        except Exception:
            pass

    try:
        row = db_exec("SELECT COUNT(*) as total FROM stevia_ml_feedback").fetchone()
        status["feedback_total"] = row.total if row else 0
        row2 = db_exec("SELECT COUNT(*) as labeled FROM stevia_ml_feedback WHERE label IS NOT NULL").fetchone()
        status["feedback_labeled"] = row2.labeled if row2 else 0
        status["feedback_pending"] = status["feedback_total"] - status["feedback_labeled"]
    except Exception:
        pass

    return status


@app.post("/ml/run/{step}")
async def ml_run(step: str, request: Request):
    """Lance une étape du pipeline ML et streame la sortie en temps réel."""
    import subprocess
    import sys

    if step not in ML_STEPS:
        return {"error": f"Étape inconnue : {step}. Valeurs : {list(ML_STEPS.keys())}"}

    script = ML_STEPS[step]

    async def stream_output():
        try:
            proc = await __import__("asyncio").create_subprocess_exec(
                sys.executable, script,
                stdout=__import__("asyncio").subprocess.PIPE,
                stderr=__import__("asyncio").subprocess.STDOUT,
            )
            async for line in proc.stdout:
                text = line.decode("utf-8", errors="replace").rstrip()
                yield json.dumps({"line": text}) + "\n"
            await proc.wait()
            yield json.dumps({"line": f"\n✓ Étape '{step}' terminée (code {proc.returncode})", "done": True}) + "\n"
        except Exception as e:
            yield json.dumps({"line": f"Erreur : {e}", "done": True}) + "\n"

    return StreamingResponse(stream_output(), media_type="text/event-stream")


@app.delete("/ml/reset")
def ml_reset():
    """Supprime dataset, modèles et feedbacks ML pour repartir de zéro."""
    dataset_dir = _ML_DIR / "dataset"
    deleted = []
    for filename in ["stevia_relevance_dataset.csv", "best_model.pkl", "model_meta.pkl",
                     "optimized_random_forest.pkl", "train.csv", "test.csv"]:
        p = dataset_dir / filename
        if p.exists():
            p.unlink()
            deleted.append(filename)

    feedback_deleted = 0
    try:
        result = db_exec("DELETE FROM stevia_ml_feedback")
        feedback_deleted = result.rowcount or 0
    except Exception as e:
        stevia_logger.error(f"[ML Reset] Erreur suppression feedbacks : {e}")
        return {
            "status": "error",
            "message": "Fichiers ML supprimés, mais impossible de purger les feedbacks.",
            "deleted": deleted,
            "feedback_deleted": feedback_deleted,
        }

    return {"status": "ok", "deleted": deleted, "feedback_deleted": feedback_deleted}


@app.get("/health")
def health_check():
    return {"status": "online", "message": "Stevia est prête"}


@app.post("/ask/debug")
async def ask_debug(payload: QueryModel):
    async def event_generator():
        for chunk in rag_answer_streaming_debug(payload.question):
            yield json.dumps({"content": chunk}) + "\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/debug/pipeline")
async def debug_pipeline(payload: QueryModel):
    """Retourne le résultat complet des deux classifieurs pour une question donnée."""
    from services.rag_engine import get_vector_store, expand_question, rerank_documents, build_context, extract_search_keywords
    from services.mistral_utils import refine_answer_streaming
    from services.intent_classifier import _load_trained_model, _load_prototypes
    from ml.extract_features import extract_features, FEATURE_NAMES
    from ml.predict import _load_model, features_to_list, RELEVANCE_THRESHOLD
    import numpy as np

    question = payload.question
    roles = payload.roles or ["user"]

    # --- 1. Classifieur d'intention ---
    intent_result = {"valid": True, "proba_valid": None, "model": "inconnu"}
    try:
        model_emb, valid_vecs, invalid_vecs = _load_prototypes()
        q_vec = np.array(model_emb.embed_query(question))
        trained_intent = _load_trained_model()
        if trained_intent is not None:
            proba = trained_intent.predict_proba(q_vec.reshape(1, -1))[0]
            intent_result = {
                "valid": bool(trained_intent.predict(q_vec.reshape(1, -1))[0]),
                "proba_valid": round(float(proba[1]), 4),
                "proba_invalid": round(float(proba[0]), 4),
                "model": "LogisticRegression (intent_model.pkl)",
            }
        else:
            max_valid = max(float(np.dot(q_vec, v) / (np.linalg.norm(q_vec) * np.linalg.norm(v))) for v in valid_vecs)
            max_invalid = max(float(np.dot(q_vec, iv) / (np.linalg.norm(q_vec) * np.linalg.norm(iv))) for iv in invalid_vecs)
            intent_result = {
                "valid": max_valid >= max_invalid,
                "proba_valid": round(max_valid, 4),
                "proba_invalid": round(max_invalid, 4),
                "model": "Fallback cosinus (prototypes)",
            }
    except Exception as e:
        intent_result["error"] = str(e)

    # Court-circuit si hors domaine
    if not intent_result.get("valid", True):
        return {
            "question": question,
            "expanded_question": None,
            "intent": intent_result,
            "chunks": [],
            "seuil_pertinence": RELEVANCE_THRESHOLD,
            "context_sent": None,
            "llm_response": None,
        }

    # --- 2. Recherche vectorielle ---
    expanded = expand_question(question)
    store = get_vector_store()
    raw_docs = store.similarity_search_with_score(expanded, k=12)
    search_keywords = extract_search_keywords(expanded)
    docs_with_scores = rerank_documents(raw_docs, question, roles)

    # --- 3. Classifieur de pertinence sur chaque chunk ---
    relevance_model = _load_model()
    user_role = roles[0] if roles else "user"
    chunks_debug = []
    retained_docs = []
    for rank, (doc, score, doc_roles) in enumerate(docs_with_scores, start=1):
        features = extract_features(
            question=question,
            doc_text=doc.page_content,
            doc_metadata=doc.metadata,
            cosine_distance=score,
            rank=rank,
            user_role=user_role,
        )
        feat_vec = [features_to_list(features)]
        proba_rel = float(relevance_model.predict_proba(feat_vec)[0][1])
        prediction = int(proba_rel >= RELEVANCE_THRESHOLD)
        chunks_debug.append({
            "rank": rank,
            "title": doc.metadata.get("title", "?"),
            "book": doc.metadata.get("book_name", "?"),
            "features": {k: features[k] for k in FEATURE_NAMES},
            "proba_pertinent": round(proba_rel, 4),
            "prediction": prediction,
            "retenu": prediction == 1,
        })
        if prediction == 1:
            retained_docs.append((doc, score, doc_roles))

    # --- 4. Contexte + réponse LLM ---
    context_sent = None
    llm_response = None
    if retained_docs:
        best_page_id = retained_docs[0][0].metadata.get("page_id")
        context_sent, _, _ = build_context(docs_with_scores, best_page_id, search_keywords)
        llm_response = "".join(refine_answer_streaming(context_sent, expanded))

    return {
        "question": question,
        "expanded_question": expanded if expanded != question else None,
        "intent": intent_result,
        "chunks": chunks_debug,
        "seuil_pertinence": RELEVANCE_THRESHOLD,
        "context_sent": context_sent,
        "llm_response": llm_response,
    }


@app.post("/debug/chunks")
async def debug_chunks(payload: QueryModel):
    from services.rag_engine import get_vector_store, expand_question
    expanded = expand_question(payload.question)
    store = get_vector_store()
    docs = store.similarity_search_with_score(expanded, k=12)
    return [
        {
            "score": round(score, 4),
            "page_id": doc.metadata.get("page_id"),
            "title": doc.metadata.get("title", "?"),
            "book": doc.metadata.get("book_name", "?"),
            "preview": doc.page_content[:800],
        }
        for doc, score in docs
    ]
