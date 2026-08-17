"""
Cache sémantique des questions/réponses — validation à 2 étages (Option A).

États d'une entrée (`status`) :
- `pending`  : question répondue → entrée créée, INVISIBLE (pas encore servie).
- `approved` : un 👍 utilisateur l'a validée → devient SERVABLE depuis le cache.
Un 👎 supprime l'entrée (retrait du cache). L'admin peut aussi retirer à la main
une réponse en cache devenue fausse (page de gestion).

Sur une nouvelle question, on cherche le plus proche voisin `approved` (mêmes
rôles) ; si similarité cosinus ≥ seuil, on rejoue la réponse sans recherche ni LLM.
À la (ré)indexation ou suppression d'un livre, on vide le cache.

Module autonome (ni import de rag_engine, ni du LLM). L'embedding est fourni par
l'appelant (rag_engine a déjà `embeddings`).
"""

import os
import re
import logging

from sqlalchemy import create_engine, text

logger = logging.getLogger("stevia")

_THRESHOLD = float(os.getenv("QA_CACHE_THRESHOLD", "0.90"))
# Bande de VÉRIFICATION : entre ce seuil et _THRESHOLD, on ne sert PAS directement ;
# on confirme d'abord que la question retombe sur la MÊME page source (fait côté rag_engine).
_VERIFY_THRESHOLD = float(os.getenv("QA_CACHE_VERIFY_THRESHOLD", "0.80"))
_EMB_DIM = int(os.getenv("QA_CACHE_EMB_DIM", "1024"))
# Nombre max de réponses gardées en cache (0 = illimité). Au-delà, on retire les
# moins demandées (moins de hits, servies le moins récemment).
_MAX_ENTRIES = int(os.getenv("QA_CACHE_MAX_ENTRIES", "500"))

# Exposés pour rag_engine (logique des 2 bandes)
HIGH_THRESHOLD = _THRESHOLD
VERIFY_THRESHOLD = _VERIFY_THRESHOLD

_DB_URL = os.getenv("DATABASE_URL")
_ENGINE = create_engine(_DB_URL, pool_pre_ping=True, pool_recycle=1800) if _DB_URL else None

_GREETING_RE = re.compile(
    r"^(bonjour|bonsoir|salut|hello|hi|hey|coucou|yo|bjr|bsr|cc|bj)[,!.\s]+",
    re.IGNORECASE,
)


def is_enabled() -> bool:
    # Cache toujours actif : la seule condition est que la base soit joignable
    # (garde-fou pour ne pas planter si DATABASE_URL est absente).
    return _ENGINE is not None


def _exec(stmt: str, params: dict | None = None):
    with _ENGINE.begin() as conn:
        return conn.execute(text(stmt), params or {})


def _norm_q(q: str) -> str:
    """Clé de correspondance robuste entre génération et feedback :
    minuscule, salutation retirée, espaces normalisés, ponctuation de fin ôtée."""
    q = (q or "").strip().lower()
    q = _GREETING_RE.sub("", q).strip()
    q = re.sub(r"\s+", " ", q)
    q = q.rstrip(" ?!.")
    return q


def _roles_key(roles) -> str:
    """Clé de rôles déterministe (le contrôle d'accès change la réponse)."""
    if not roles:
        return "user"
    return ",".join(sorted({str(r).strip().lower() for r in roles if str(r).strip()}))


def _emb_literal(emb) -> str:
    return "[" + ",".join(f"{float(x):.6f}" for x in emb) + "]"


def init_cache_table():
    """Crée la table du cache si absente + migre l'ancienne colonne booléenne
    `validated` vers `status`. À appeler au démarrage."""
    if _ENGINE is None:
        return
    try:
        _exec(f"""
            CREATE TABLE IF NOT EXISTS stevia_qa_cache (
                id            SERIAL PRIMARY KEY,
                question      TEXT NOT NULL,
                norm_q        TEXT NOT NULL,
                question_emb  vector({_EMB_DIM}),
                answer        TEXT,
                roles         TEXT,
                book_id       INT,
                page_id       INT,
                status        TEXT DEFAULT 'pending',
                hits          INT DEFAULT 0,
                created_at    TIMESTAMP DEFAULT NOW(),
                proposed_at   TIMESTAMP,
                approved_at   TIMESTAMP
            )
        """)
        # Migration douce depuis l'ancien schéma (booléen `validated`)
        _exec("ALTER TABLE stevia_qa_cache ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'")
        _exec("ALTER TABLE stevia_qa_cache ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMP")
        _exec("ALTER TABLE stevia_qa_cache ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP")
        _exec("ALTER TABLE stevia_qa_cache ADD COLUMN IF NOT EXISTS book_id INT")
        _exec("ALTER TABLE stevia_qa_cache ADD COLUMN IF NOT EXISTS page_id INT")
        _exec("ALTER TABLE stevia_qa_cache ADD COLUMN IF NOT EXISTS last_served_at TIMESTAMP")
        _exec("CREATE INDEX IF NOT EXISTS idx_qa_cache_page ON stevia_qa_cache(page_id)")
        _exec("ALTER TABLE stevia_qa_cache DROP COLUMN IF EXISTS validated")
        _exec("ALTER TABLE stevia_qa_cache DROP COLUMN IF EXISTS validated_at")
        _exec("CREATE INDEX IF NOT EXISTS idx_qa_cache_normq ON stevia_qa_cache(norm_q)")
        _exec("CREATE INDEX IF NOT EXISTS idx_qa_cache_status ON stevia_qa_cache(status)")
    except Exception as e:
        logger.error(f"[QACache] Erreur création table : {e}")


# ─────────────────────────── Côté chatbot ───────────────────────────

def lookup_candidate(emb, roles) -> dict | None:
    """Retourne le plus proche voisin APPROUVÉ (mêmes rôles) SI sa similarité ≥
    `VERIFY_THRESHOLD`, sous forme `{id, answer, page_id, sim}`, sinon None. Ne sert
    rien tout seul : rag_engine décide (hit direct si sim ≥ HIGH, sinon vérif page)."""
    if not is_enabled() or emb is None:
        return None
    rk = _roles_key(roles)
    try:
        row = _exec(
            """
            SELECT id, answer, page_id, 1 - (question_emb <=> (:emb)::vector) AS sim
            FROM stevia_qa_cache
            WHERE status = 'approved' AND answer IS NOT NULL AND roles = :rk
            ORDER BY question_emb <=> (:emb)::vector
            LIMIT 1
            """,
            {"emb": _emb_literal(emb), "rk": rk},
        ).fetchone()
    except Exception as e:
        logger.error(f"[QACache] Erreur lookup : {e}")
        return None

    if row is None or row.sim is None or row.sim < VERIFY_THRESHOLD:
        return None
    return {"id": row.id, "answer": row.answer, "page_id": row.page_id, "sim": float(row.sim)}


def mark_served(entry_id, sim, verified=False):
    """Incrémente les hits + trace en console serveur (à l'emplacement du contexte LLM)."""
    try:
        _exec("UPDATE stevia_qa_cache SET hits = hits + 1, last_served_at = NOW() WHERE id = :id", {"id": entry_id})
    except Exception:
        pass
    if verified:
        msg = (f"Réponse renvoyée depuis le CACHE (aucun calcul, aucune IA) — "
               f"reformulation reconnue : même page de doc, ressemblance {sim:.0%}")
    else:
        msg = (f"Réponse renvoyée depuis le CACHE (aucun calcul, aucune IA) — "
               f"question déjà posée, ressemblance {sim:.0%}")
    print(f"\n=== {msg} ===\n", flush=True)


def has_approved(question: str) -> bool:
    """True si une réponse APPROUVÉE existe pour cette question → la réponse a (ou
    aurait) été servie depuis le cache. Sert à marquer « issue du cache » dans le
    log de feedback. Correspondance par question, indépendamment des rôles."""
    if not is_enabled():
        return False
    nq = _norm_q(question)
    if not nq:
        return False
    try:
        row = _exec(
            "SELECT 1 FROM stevia_qa_cache WHERE norm_q = :nq AND status = 'approved' LIMIT 1",
            {"nq": nq},
        ).fetchone()
        return row is not None
    except Exception:
        return False


def _as_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def store_pending(question: str, emb, roles, book_id=None, page_id=None):
    """Enregistre une entrée `pending` (invisible). `book_id`/`page_id` = livre et
    page BookStack de la source principale → invalidation ciblée à la réindexation.
    Remplace toute entrée `pending` antérieure pour la même question+rôles."""
    if not is_enabled() or emb is None:
        return
    nq = _norm_q(question)
    if not nq:
        return
    rk = _roles_key(roles)
    bid = _as_int(book_id)
    pid = _as_int(page_id)
    try:
        # Déjà approuvée pour cette question+rôles → rien à faire
        exists = _exec(
            "SELECT 1 FROM stevia_qa_cache WHERE norm_q = :nq AND roles = :rk AND status = 'approved' LIMIT 1",
            {"nq": nq, "rk": rk},
        ).fetchone()
        if exists:
            return
        _exec(
            "DELETE FROM stevia_qa_cache WHERE norm_q = :nq AND roles = :rk AND status = 'pending'",
            {"nq": nq, "rk": rk},
        )
        _exec(
            """
            INSERT INTO stevia_qa_cache (question, norm_q, question_emb, roles, book_id, page_id, status)
            VALUES (:q, :nq, (:emb)::vector, :rk, :bid, :pid, 'pending')
            """,
            {"q": question[:1000], "nq": nq, "emb": _emb_literal(emb), "rk": rk, "bid": bid, "pid": pid},
        )
    except Exception as e:
        logger.error(f"[QACache] Erreur store_pending : {e}")


def validate(question: str, answer: str):
    """Sur 👍 : approuve directement l'entrée `pending` la plus récente → SERVABLE,
    en y attachant la réponse exacte vue par l'utilisateur."""
    if not is_enabled():
        return
    nq = _norm_q(question)
    if not nq or not answer:
        return
    try:
        _exec(
            """
            UPDATE stevia_qa_cache
            SET answer = :a, status = 'approved', approved_at = NOW()
            WHERE id = (
                SELECT id FROM stevia_qa_cache
                WHERE norm_q = :nq AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
            )
            """,
            {"a": answer, "nq": nq},
        )
    except Exception as e:
        logger.error(f"[QACache] Erreur validate : {e}")
    _enforce_limit()


def _enforce_limit():
    """Plafonne le nombre de réponses `approved` à `_MAX_ENTRIES` : on GARDE les plus
    demandées/récentes et on retire le surplus. Priorité de conservation :
    hits ↓, puis servie récemment ↓, puis approuvée récemment ↓ (protège les
    nouvelles entrées : une réponse fraîche jamais encore servie n'est pas éjectée
    avant une vieille jamais demandée)."""
    if not is_enabled() or _MAX_ENTRIES <= 0:
        return
    try:
        res = _exec(
            """
            DELETE FROM stevia_qa_cache
            WHERE status = 'approved' AND id NOT IN (
                SELECT id FROM stevia_qa_cache
                WHERE status = 'approved'
                ORDER BY hits DESC,
                         last_served_at DESC NULLS LAST,
                         approved_at DESC
                LIMIT :maxn
            )
            """,
            {"maxn": _MAX_ENTRIES},
        )
        n = res.rowcount or 0
        if n:
            logger.info(f"[Cache] Plafond {_MAX_ENTRIES} atteint : {n} réponse(s) la/les moins demandée(s) retirée(s).")
    except Exception as e:
        logger.error(f"[QACache] Erreur _enforce_limit : {e}")


def purge(question: str):
    """Sur 👎 : supprime toutes les entrées de cette question (pending/proposed/
    approved) → jamais servie, ré-apprenable ensuite."""
    if not is_enabled():
        return
    nq = _norm_q(question)
    if not nq:
        return
    try:
        _exec("DELETE FROM stevia_qa_cache WHERE norm_q = :nq", {"nq": nq})
    except Exception as e:
        logger.error(f"[QACache] Erreur purge : {e}")


def invalidate_pages(page_ids):
    """Invalidation la plus FINE : supprime les réponses cachées dont la source est
    l'une des pages `page_ids` (celles dont le contenu a réellement changé à la
    réindexation). Les réponses des pages inchangées du même livre restent en cache."""
    if not is_enabled():
        return
    ids = sorted({_as_int(p) for p in page_ids} - {None})
    if not ids:
        return
    try:
        res = _exec("DELETE FROM stevia_qa_cache WHERE page_id = ANY(:ids)", {"ids": ids})
        n = res.rowcount or 0
        if n:
            logger.info(f"[Cache] Réindexation : {n} réponse(s) retirée(s) du cache (leur page de doc a changé).")
    except Exception as e:
        logger.error(f"[QACache] Erreur invalidate_pages : {e}")


def invalidate_book(book_id):
    """Invalidation CIBLÉE : supprime les réponses cachées dont la source est le
    livre `book_id` (à appeler quand ce livre est réindexé ou supprimé → son
    contenu a pu changer). N'affecte pas les réponses issues des autres livres."""
    if not is_enabled():
        return
    bid = _as_int(book_id)
    if bid is None:
        return
    try:
        res = _exec("DELETE FROM stevia_qa_cache WHERE book_id = :bid", {"bid": bid})
        n = res.rowcount or 0
        if n:
            logger.info(f"[Cache] Suppression du livre {bid} : {n} réponse(s) retirée(s) du cache.")
    except Exception as e:
        logger.error(f"[QACache] Erreur invalidate_book : {e}")


def invalidate_all():
    """Vide TOUT le cache (filet de sécurité : remise à zéro globale)."""
    if not is_enabled():
        return
    try:
        _exec("DELETE FROM stevia_qa_cache")
        logger.info("[QACache] Cache entièrement vidé.")
    except Exception as e:
        logger.error(f"[QACache] Erreur invalidate_all : {e}")


# ─────────────────────────── Côté admin ───────────────────────────

def _row_to_dict(r) -> dict:
    return {
        "id": r.id,
        "question": r.question,
        "answer": r.answer or "",
        "roles": r.roles or "",
        "hits": r.hits or 0,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "proposed_at": r.proposed_at.isoformat() if r.proposed_at else None,
        "approved_at": r.approved_at.isoformat() if r.approved_at else None,
    }


def list_entries() -> dict:
    """Renvoie les réponses en cache (`approved`) pour la page de gestion."""
    out = {"approved": [], "enabled": is_enabled(), "threshold": _THRESHOLD}
    if not is_enabled():
        return out
    try:
        rows = _exec(
            """
            SELECT id, question, answer, roles, hits, status, created_at, proposed_at, approved_at
            FROM stevia_qa_cache
            WHERE status = 'approved'
            ORDER BY approved_at DESC
            """
        ).fetchall()
        out["approved"] = [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"[QACache] Erreur list_entries : {e}")
    return out


def delete_entry(entry_id: int) -> bool:
    """Admin : retire une réponse du cache (devenue fausse)."""
    if not is_enabled():
        return False
    try:
        res = _exec("DELETE FROM stevia_qa_cache WHERE id = :id", {"id": entry_id})
        ok = (res.rowcount or 0) > 0
        if ok:
            logger.info(f"[QACache] SUPPRIMÉ (admin) id={entry_id}")
        return ok
    except Exception as e:
        logger.error(f"[QACache] Erreur delete_entry : {e}")
        return False
