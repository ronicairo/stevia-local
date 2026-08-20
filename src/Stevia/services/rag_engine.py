import logging
import os
import time
import unicodedata
import nltk
import re

_LOG_DIR = os.getenv("STEVIA_LOG_DIR", "/app/var/log")
os.makedirs(_LOG_DIR, exist_ok=True)
rag_logger = logging.getLogger("stevia")
rag_logger.setLevel(logging.INFO)

from functools import lru_cache
from langchain_core.documents import Document as LCDocument
from langchain_postgres import PGVector
from langchain_ollama import OllamaEmbeddings
from sqlalchemy import create_engine, text
from services.mistral_utils import refine_answer_streaming, raw_select_lines
from services.bookstack_reader import parse_bookstack_page
from services.synonymes import expand_question

nltk.download('stopwords', quiet=True)
from nltk.corpus import stopwords

STOP_WORDS = set(stopwords.words('french'))

try:
    import spacy
    _nlp = spacy.load("fr_core_news_sm", disable=["parser", "ner"])
except (ImportError, OSError):
    _nlp = None

def _lemmatize(words: list[str]) -> set[str]:
    if not _nlp or not words:
        return set(words)
    doc = _nlp(" ".join(words))
    return {token.lemma_ for token in doc}

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

_OLLAMA_HOST = os.getenv("OLLAMA_HOST", "localhost")
embeddings = OllamaEmbeddings(
    model="qwen3-embedding:0.6b",
    base_url=f"http://{_OLLAMA_HOST}:11434",
)

@lru_cache(maxsize=1)
def get_vector_store():
    return PGVector(
        connection=DB_URL,
        embeddings=embeddings,
        collection_name="global",
    )

def _pick_anchor(content: str, anchors_meta: str, question: str) -> str:
    """Choisit, parmi les ancres d'un chunk (métadonnée 'anchors' = 'offset:id|...'),
    celle située juste EN AMONT du 1er mot-clé de la question dans le contenu.
    Un chunk couvre parfois plusieurs sections : on vise celle qui répond plutôt que
    la 1ère du chunk. Retourne '' si pas de liste d'ancres (index pas encore réindexé)."""
    if not anchors_meta:
        return ""
    items: list[tuple[int, str]] = []
    for part in anchors_meta.split("|"):
        off, _, aid = part.partition(":")
        if off.isdigit() and aid:
            items.append((int(off), aid))
    if not items:
        return ""

    raw_q = [w for w in question.lower().split() if len(w) > 3 and w not in STOP_WORDS]
    qwords = _lemmatize(raw_q) if _nlp else set(raw_q)
    qwords = {w for w in qwords if len(w) >= 4 and w.isalpha() and w not in _QUERY_STOPWORDS}

    # Position (offset caractère) de chaque mot-clé trouvé dans le contenu
    hits: list[tuple[int, str]] = []
    for m in re.finditer(r"\w+", content.lower()):
        w = m.group(0)
        for qw in qwords:
            if w == qw or (
                len(w) >= 4 and len(qw) >= 4 and (w.startswith(qw) or qw.startswith(w))
            ):
                hits.append((m.start(), qw))
                break
    if not hits:
        return items[0][1]

    # Cible = début de la paire de mots-clés DIFFÉRENTS la plus rapprochée (le passage
    # qui répond, ex: 'avancer ... workflow'). Sinon 1ère occurrence.
    target = hits[0][0]
    best_d = None
    for a in range(len(hits)):
        for b in range(a + 1, len(hits)):
            if hits[b][1] == hits[a][1]:
                continue
            d = hits[b][0] - hits[a][0]
            if best_d is None or d < best_d:
                best_d = d
                target = hits[a][0]

    best = items[0][1]
    for off, aid in items:
        if off <= target:
            best = aid
        else:
            break
    return best


def get_page_url(metadata: dict) -> str:
    """Construit l'URL de la page BookStack, avec ancre #bkmrk-... si disponible
    (lien direct vers la section/le paragraphe qui répond)."""
    slug = metadata.get("slug", "")
    book_slug = metadata.get("book_slug", "")
    page_id = metadata.get("page_id")

    if slug and book_slug:
        base = f"{BOOKSTACK_PUBLIC_URL}/books/{book_slug}/page/{slug}"
    elif page_id:
        base = f"{BOOKSTACK_PUBLIC_URL}/link/{page_id}"
    else:
        return BOOKSTACK_PUBLIC_URL

    anchor = metadata.get("anchor", "")
    if anchor:
        # L'ancre BookStack (id HTML) est déjà URL-encodée → pas de ré-encodage
        return f"{base}#{anchor}"
    return base


# FONCTIONS UTILITAIRES RAG
def extract_search_keywords(question: str) -> list[str]:
    """Mots-clés de recherche = noms, verbes et noms propres (lemmatisés), dans
    l'ordre de la phrase. Le filtrage par nature grammaticale (spaCy) élimine le bruit
    (pronoms, auxiliaires, déterminants, adverbes interrogatifs : 'quoi', 'comment'…)
    de façon DÉTERMINISTE — contrairement à l'ancien `list(set(...))` dont l'ordre
    variait d'un process à l'autre. Les identifiants techniques (underscore) sont
    préservés tels quels."""
    technical = [w for w in question.lower().split() if '_' in w and len(w) >= 2]

    if not _nlp:
        # Fallback sans spaCy : ancien comportement (sans stop words ni apostrophes)
        regular = [w for w in question.lower().split()
                   if len(w) >= 2 and w not in STOP_WORDS and "'" not in w and '_' not in w]
        return technical + regular

    keywords: list[str] = []
    seen: set[str] = set()
    for tok in _nlp(question):
        if tok.pos_ not in ("NOUN", "PROPN", "VERB"):
            continue
        lemma = tok.lemma_.lower().strip()
        if len(lemma) < 2 or '_' in lemma or lemma in STOP_WORDS:
            continue
        if lemma not in seen:
            seen.add(lemma)
            keywords.append(lemma)
    return technical + keywords


# Largeur de bande pour le tie-break du reranking : deux chunks dont le score
# structurel (cosinus + rôle/titre) diffère de moins de cette valeur sont considérés
# « ex æquo » et départagés par le boost contenu+proximité.
_RERANK_BAND = 0.08

# Mots interrogatifs/génériques exclus du matching de contenu (trop fréquents)
_QUERY_STOPWORDS = {
    "comment", "pourquoi", "combien", "quel", "quelle", "quels", "quelles",
    "quand", "peut", "doit", "faut", "faire", "avec", "dans", "pour", "sans",
}

# Mots NON DISCRIMINANTS pour le boost titre/gras : nom du produit + termes omniprésents
# (présents dans de très nombreux titres → ne doivent pas faire remonter une page).
# Ex : « objectifs de SUCRE » ne doit pas booster « Conditions de rapprochement … SUCRE ».
_TITLE_BOOST_STOPWORDS = {
    "sucre", "creance", "creances", "dossier", "dossiers", "outil", "application",
}


def _proximity_hit(document: str, keywords: list[str], window: int = 6) -> bool:
    """True si deux mots-clés DIFFÉRENTS apparaissent à <= `window` mots l'un de
    l'autre dans le document (matching par sous-chaîne, ex: 'avance' ∈ 'avancer').
    Récompense les chunks où les termes de la question sont proches (ex: 'faire
    avancer le workflow')."""
    words = re.findall(r"\w+", document.lower())
    hits: list[tuple[int, str]] = []
    for i, w in enumerate(words):
        for kw in keywords:
            if kw in w:
                hits.append((i, kw))
                break
    for a in range(len(hits)):
        for b in range(a + 1, len(hits)):
            if hits[b][0] - hits[a][0] > window:
                break
            if hits[b][1] != hits[a][1]:
                return True
    return False


def search_by_keywords(keywords: list[str], existing_docs: list) -> list[tuple]:
    """Recherche par mots-clés dans la base (complément à la recherche vectorielle).
    Les identifiants techniques (underscore) sont toujours retournés avec score 0.05,
    même s'ils sont déjà dans les résultats vectoriels (pour forcer le boost de score)."""
    if not keywords:
        return []

    results = []
    existing_contents = {doc.page_content for doc, _ in existing_docs}
    seen_technical = set()

    def _run_technical(term: str):
        safe = term.replace("'", "''")
        query = f"""
            SELECT document, cmetadata
            FROM langchain_pg_embedding
            WHERE document ILIKE '%{safe}%'
            LIMIT 3
        """
        for row in db_exec(query).fetchall():
            if row.document in seen_technical:
                continue
            seen_technical.add(row.document)
            metadata = row.cmetadata if isinstance(row.cmetadata, dict) else {}
            new_doc = LCDocument(page_content=row.document, metadata=metadata)
            results.append((new_doc, 0.05))

    def _run_regular(conditions_str: str):
        query = f"""
            SELECT document, cmetadata
            FROM langchain_pg_embedding
            WHERE {conditions_str}
            LIMIT 3
        """
        for row in db_exec(query).fetchall():
            if row.document in existing_contents:
                continue
            metadata = row.cmetadata if isinstance(row.cmetadata, dict) else {}
            new_doc = LCDocument(page_content=row.document, metadata=metadata)
            results.append((new_doc, 0.25))
            existing_contents.add(row.document)

    def _run_content_multi(salient: list[str]):
        """Repêche les chunks (hors top vectoriel) contenant >= 2 mots-clés distincts
        de la question, classés par nombre de mots-clés + bonus de proximité.
        Comble le trou : un chunk pertinent par son contenu mais mal classé en cosinus
        (ex: 'faire avancer le workflow') n'entrait jamais dans le pool."""
        safe = [w.replace("'", "''") for w in salient]
        score_expr = " + ".join(f"(document ILIKE '%{w}%')::int" for w in safe)
        or_cond = " OR ".join(f"document ILIKE '%{w}%'" for w in safe)
        query = f"""
            SELECT document, cmetadata, ({score_expr}) AS kw_hits
            FROM langchain_pg_embedding
            WHERE {or_cond}
            ORDER BY kw_hits DESC
            LIMIT 40
        """
        candidates = []
        for row in db_exec(query).fetchall():
            if row.kw_hits < 2 or row.document in existing_contents:
                continue
            # Plus de mots-clés distincts = meilleur (score plus bas) ; proximité = bonus
            score = 0.35 - 0.02 * (row.kw_hits - 2)
            if _proximity_hit(row.document, salient):
                score -= 0.07
            candidates.append((round(score, 4), row))
        candidates.sort(key=lambda x: x[0])
        for score, row in candidates[:5]:
            metadata = row.cmetadata if isinstance(row.cmetadata, dict) else {}
            results.append((LCDocument(page_content=row.document, metadata=metadata), score))
            existing_contents.add(row.document)

    try:
        technical = [w for w in keywords if '_' in w]
        for term in technical:
            _run_technical(term)

        regular = [w for w in keywords if '_' not in w]
        if regular:
            specific = regular[-3:] if len(regular) > 3 else regular
            safe_regular = [w.replace("'", "''") for w in specific]
            conditions = " AND ".join([f"document ILIKE '%{w}%'" for w in safe_regular])
            _run_regular(conditions)

        # Matching multi-mots-clés sur le contenu (>= 2 termes distincts + proximité)
        salient = [
            w for w in regular
            if len(w) >= 4 and w.isalpha()
            and w not in STOP_WORDS and w not in _QUERY_STOPWORDS
        ]
        if len(salient) >= 2:
            _run_content_multi(salient)

    except Exception:
        pass

    return results


def merge_keyword_docs(existing_docs: list, keyword_docs: list) -> list:
    """Fusionne les résultats keyword dans les résultats vectoriels.
    Pour les doublons, garde le score le plus bas (= meilleure pertinence)."""
    content_to_idx = {doc.page_content: i for i, (doc, _) in enumerate(existing_docs)}
    extra = []
    for kw_doc, kw_score in keyword_docs:
        if kw_doc.page_content in content_to_idx:
            idx = content_to_idx[kw_doc.page_content]
            _, existing_score = existing_docs[idx]
            if kw_score < existing_score:
                existing_docs[idx] = (kw_doc, kw_score)
        else:
            extra.append((kw_doc, kw_score))
    existing_docs.extend(extra)
    return existing_docs


def _dedupe_key(content: str) -> str:
    """Clé de déduplication : texte normalisé, images retirées.
    Une page copiée dans BookStack ('Copier la page') garde un texte identique mais
    ré-uploade ses images sous de nouveaux noms de fichier — on ignore donc les
    marqueurs d'image pour que les deux versions soient reconnues comme identiques."""
    no_img = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', content)
    return " ".join(no_img.split())


def dedupe_by_content(docs_with_scores: list) -> list:
    """Supprime les chunks au contenu identique (pages dupliquées dans BookStack,
    ex: 'Gestion des Workflow' copiée sous le slug '...-eF4').
    Garde la meilleure occurrence (score le plus bas). La comparaison ignore les
    images (cf. _dedupe_key) pour attraper les copies de page."""
    seen: dict[str, int] = {}  # clé normalisée → index dans result
    result: list = []
    for doc, score in docs_with_scores:
        key = _dedupe_key(doc.page_content)
        if not key:
            result.append((doc, score))
            continue
        if key in seen:
            i = seen[key]
            if score < result[i][1]:
                result[i] = (doc, score)
        else:
            seen[key] = len(result)
            result.append((doc, score))
    return result


def _content_keyword_boost(content: str, question_words: set) -> float:
    """Boost basé sur le CONTENU du chunk :
    - présence de mots-clés de la question (lemmatisés, ou match par préfixe) ;
    - renforcé fortement si ≥2 mots-clés DIFFÉRENTS sont proches l'un de l'autre
      (ex: 'faire avancer le workflow' → 'avancer' et 'workflow' à 2 mots).
    Plus les mots-clés sont proches, plus le bonus est élevé."""
    if not question_words or not content:
        return 0.0

    if _nlp:
        lemmas = [t.lemma_.lower() for t in _nlp(content[:3000]) if not t.is_space]
    else:
        lemmas = re.findall(r"\w+", content.lower())

    hits: list[tuple[int, str]] = []  # (position, mot-clé question)
    for pos, lemma in enumerate(lemmas):
        for qw in question_words:
            if lemma == qw or (
                len(lemma) >= 4 and len(qw) >= 4
                and (lemma.startswith(qw) or qw.startswith(lemma))
            ):
                hits.append((pos, qw))
                break
    if not hits:
        return 0.0

    distinct = {qw for _, qw in hits}
    boost = min(len(distinct), 3) * 0.05  # présence : jusqu'à 0.15 (3+ mots-clés)

    # Proximité : plus petite distance entre deux mots-clés DIFFÉRENTS
    if len(distinct) >= 2:
        min_dist = None
        for a in range(len(hits)):
            for b in range(a + 1, len(hits)):
                if hits[b][1] == hits[a][1]:
                    continue
                d = abs(hits[b][0] - hits[a][0])
                if min_dist is None or d < min_dist:
                    min_dist = d
        if min_dist is not None:
            if min_dist <= 2:
                boost += 0.20
            elif min_dist <= 5:
                boost += 0.12
            elif min_dist <= 10:
                boost += 0.06

    return min(boost, 0.30)


def rerank_documents(docs_with_scores: list, question: str, roles: list[str]) -> list[tuple]:
    """Applique le boost par rôle, titre/gras et contenu (présence + proximité), puis trie."""
    reranked = []
    raw_q_words = [w for w in question.lower().split() if len(w) > 3]
    question_words = _lemmatize(raw_q_words) if _nlp else set(raw_q_words)
    # Sous-ensemble salient pour le boost de contenu (évite que 'on/de/un' matchent partout)
    content_qw = {
        w for w in question_words
        if len(w) >= 4 and w.isalpha()
        and w not in STOP_WORDS and w not in _QUERY_STOPWORDS
    }
    for doc, score in docs_with_scores:
        doc_roles = doc.metadata.get("roles", "all").split(",")

        # Boost par rôle (normalise role_admin → admin, sucre_notif → notif, etc.)
        norm_roles = [r.replace("role_", "") for r in roles]
        role_boost = 0
        if "admin" not in norm_roles:
            def _role_match(nr, dr):
                return nr == dr or nr.split("_")[-1] == dr or dr.split("_")[-1] == nr
            if any(_role_match(r, dr) for r in norm_roles for dr in doc_roles) or "all" in doc_roles:
                role_boost = 0.10

        # Boost par titre/gras (décompose aussi les mots avec tiret ex: "aide-mémoire" → "aide","mémoire")
        title_words_str = doc.metadata.get("title_words", "")
        title_words_raw = set()
        for w in title_words_str.lower().split(","):
            title_words_raw.add(w)
            if "-" in w:
                title_words_raw.update(w.split("-"))
            if "_" in w:
                title_words_raw.update(w.split("_"))

        bold_words_str = doc.metadata.get("bold_words", "")
        bold_words_raw = set()
        for w in bold_words_str.lower().split(","):
            bold_words_raw.add(w)
            if "-" in w:
                bold_words_raw.update(w.split("-"))
            if "_" in w:
                bold_words_raw.update(w.split("_"))

        title_words = _lemmatize(list(title_words_raw)) if _nlp else title_words_raw
        bold_words = _lemmatize(list(bold_words_raw)) if _nlp else bold_words_raw

        # Mots de la question utilisés pour le boost titre/gras : on retire les mots
        # non discriminants (nom produit « sucre », etc.) pour ne pas booster une page
        # juste parce que son titre contient « SUCRE ».
        title_qw = {w for w in question_words if w not in _TITLE_BOOST_STOPWORDS}

        title_matches = title_qw & title_words
        bold_matches = title_qw & bold_words

        # Matching par préfixe (ex: "notifier" matche "notif" dans "sucre_notif")
        for qw in list(title_qw):
            for tw in list(title_words):
                if len(tw) >= 4 and len(qw) >= 4 and qw not in title_matches and (qw.startswith(tw) or tw.startswith(qw)):
                    title_matches.add(qw)
        for qw in list(title_qw):
            for tw in list(bold_words):
                if len(tw) >= 4 and len(qw) >= 4 and qw not in bold_matches and (qw.startswith(tw) or tw.startswith(qw)):
                    bold_matches.add(qw)

        # Bonus fort si le titre de la page est quasi-entièrement couvert par la question
        # (ex: titre="Calendrier", question="qu'est-ce que le calendrier" → coverage=1.0)
        title_coverage_bonus = 0.0
        filtered_title_words = {w for w in title_words if len(w) > 2}
        if filtered_title_words:
            coverage = len(title_matches & filtered_title_words) / len(filtered_title_words)
            if coverage >= 0.5:
                title_coverage_bonus = 0.35

        text_boost = len(title_matches) * 0.08 + len(bold_matches) * 0.04 + title_coverage_bonus

        # Boost si un mot de la question est préfixe d'un rôle du document
        # (ex: "notifier" → doc rôle "notif", "recouvrer" → doc rôle "recouv")
        # S'applique indépendamment du rôle de l'utilisateur
        role_keyword_boost = 0.0
        for qw in question_words:
            for dr in doc_roles:
                if len(qw) >= 4 and len(dr) >= 4 and qw.startswith(dr) and dr != "all":
                    role_keyword_boost = 0.15
                    break
            if role_keyword_boost:
                break

        content_boost = _content_keyword_boost(doc.page_content, content_qw)

        # Boost par titre de SECTION présent DANS le chunk (## …, ### …, [TITRE] …).
        # Contrairement à title_words (niveau page, identique pour tous les chunks),
        # ceci distingue le chunk qui porte réellement le titre correspondant à la
        # question (ex. le chunk contenant "### Suivi des échéances"). Accent-insensible.
        heading_text = " ".join(
            re.findall(r'(?m)^\s*#{1,6}\s+(.+)$', doc.page_content)
            + re.findall(r'(?m)^\s*\[TITRE\]\s+(.+)$', doc.page_content)
        )
        heading_words = {w for w in _norm_accent(heading_text).split() if len(w) > 3}
        section_title_boost = 0.0
        if heading_words:
            q_norm = {
                w for w in _norm_accent(question).split()
                if len(w) > 3 and w not in STOP_WORDS and w not in _QUERY_STOPWORDS
                and w not in _TITLE_BOOST_STOPWORDS   # « sucre » etc. ne doit pas booster
            }
            inter = heading_words & q_norm
            if inter:
                section_title_boost = min(0.30, 0.15 * len(inter))

        # Score structurel : cosinus + boosts rôle/titre (peuvent légitimement
        # réordonner). Le boost contenu+proximité est gardé À PART : il ne sert qu'à
        # départager des chunks de score proche, pas à renverser un écart sémantique.
        base_score = score - (role_boost + text_boost + role_keyword_boost + section_title_boost)
        reranked.append((doc, base_score, content_boost, doc_roles))

    # Tri tie-break : on regroupe les scores par bande (_RERANK_BAND) ; à l'intérieur
    # d'une même bande (chunks ~équivalents), le boost contenu+proximité décide l'ordre.
    # Entre bandes différentes, le score structurel prime → un net écart sémantique n'est
    # jamais renversé par les mots-clés.
    reranked.sort(key=lambda r: (round(r[1] / _RERANK_BAND), r[1] - r[2]))
    return [(doc, base, doc_roles) for doc, base, _cb, doc_roles in reranked]


def filter_off_topic(best_score: float, second_score: float) -> str | None:
    """Retourne un message de rejet si hors-sujet, sinon None."""
    score_gap = second_score - best_score

    if best_score > 0.65:
        return "Cette question ne relève pas de la documentation SUCRE."

    if best_score > 0.55 and score_gap < 0.05:
        return "Cette question ne semble pas concerner la documentation SUCRE."

    return None


_ACTION_KEYWORDS = ('cliquez', 'cliquer', 'saisir', 'saisissez', 'modifier', 'modifiez', 'appuyer', 'appuyez')


def _build_image_anchors(context: str) -> list[tuple[str, str, bool]]:
    """
    Construit des ancres pour l'injection inline :
    - Cas 1 : image INLINE (icône + texte sur la même ligne) → ancre = texte qui suit.
    - Cas 2 : image BLOC (seule sur sa ligne) précédée d'une ligne d'action
      (contient "cliquez sur", "modifier", etc.) → ancre = cette ligne d'action.
      Permet d'injecter l'icône d'un bouton juste après que le LLM l'a décrit.
    Les captures d'écran pleine page (pas précédées d'une ligne d'action) restent
    en Documentation visuelle.
    """
    lines = context.split('\n')
    anchors = []
    seen_urls: set = set()
    seen_anchors: set = set()  # évite les doublons quand plusieurs images partagent la même instruction

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Cas 1 : image INLINE — `![alt](url) texte qui suit`
        m_inline = re.match(r'!\[[^\]]*\]\(([^)]+)\)\s+(.+)', stripped)
        if m_inline:
            url = m_inline.group(1)
            inline_text = m_inline.group(2)
            if url not in seen_urls and len(inline_text) >= 10:
                seen_urls.add(url)
                c = re.sub(r'[\*#\[\]\(\)•«»]', '', inline_text).strip().lower()
                c = re.sub(r'\s+', ' ', c).rstrip(' .,;:!?')
                words = c.split()
                a = ' '.join(words[:5]) if len(words) >= 5 else c
                if len(a) >= 10 and a not in seen_anchors:
                    seen_anchors.add(a)
                    anchors.append((a, url, True))  # Cas 1 : image avant texte (prepend)
            continue

        # Cas 2 : image BLOC → cherche la ligne d'action précédente (non-image)
        m_bloc = re.match(r'!\[[^\]]*\]\(([^)]+)\)$', stripped)
        if m_bloc:
            url = m_bloc.group(1)
            if url in seen_urls:
                continue
            for j in range(i - 1, max(-1, i - 4), -1):
                prev_s = lines[j].strip()
                if not prev_s or re.match(r'!\[', prev_s):
                    continue
                prev_lower = prev_s.lower()
                if any(kw in prev_lower for kw in _ACTION_KEYWORDS):
                    c = re.sub(r'[\*#\[\]\(\)•«»]', '', prev_s).strip().lower()
                    c = re.sub(r'\s+', ' ', c).rstrip(' .,;:!?')
                    words = c.split()
                    a = ' '.join(words[1:6]) if len(words) >= 4 else c
                    if len(a) >= 8 and a not in seen_anchors:
                        seen_anchors.add(a)
                        seen_urls.add(url)
                        anchors.append((a, url, False))  # Cas 2 : après "cliquez sur"
                break

    return anchors


_ACTION_KW_RE = re.compile(
    r'\b(?:cliquez|cliquer|saisir|saisissez|modifier|modifiez|appuyer|appuyez)\b',
    re.IGNORECASE
)


def _prepare_context_for_llm(context_llm: str) -> str:
    """
    Prépare le contexte avant envoi au LLM :
    - Lignes avec image inline (texte + image) → conservées telles quelles.
    - Lignes IMAGE BLOC (![image](url) seule) → supprimées.
    """
    lines = context_llm.split('\n')
    result = []
    for line in lines:
        stripped = line.strip()
        if re.match(r'^!\[image\]\([^)]+\)$', stripped):
            pass  # bloc seul → supprimer
        else:
            result.append(line)
    return '\n'.join(result)


def _merge_action_images(text: str) -> str:
    """
    Fusionne toute image bloc (seule sur sa ligne) dans la ligne de texte
    qui précède, pour que le LLM la voie inline et la reproduise correctement.

    Avant : "texte quelconque\\n![image](url)\\ntexte suivant"
    Après  : "texte quelconque ![image](url) texte suivant"
    """
    pattern = re.compile(
        r'([^\n]{8,})\n+'
        r'(!\[image\]\([^)]+\))\n+'
        r'([^\n!][^\n]{0,120})',
        re.IGNORECASE
    )
    return pattern.sub(r'\1 \2 \3', text)


def _find_adjacent_images(context: str, llm_response: str, yielded_images: set | None = None) -> list[str]:
    """
    Retourne les images (bloc ET inline non injectées) dont le texte voisin
    figure dans la réponse LLM.
    """
    llm_lower = llm_response.lower()
    llm_clean = re.sub(r'\s+', ' ', re.sub(r'[«»,;:\*\[\]\(\)•]', ' ', llm_lower))
    lines = context.split('\n')
    result = []
    seen = set()
    for i, line in enumerate(lines):
        stripped = line.strip()

        # Image inline non injectée par anchor → utilise le texte inline comme voisin
        m_inline = re.match(r'!\[[^\]]*\]\(([^)]+)\)\s+(.+)', stripped)
        if m_inline:
            url = m_inline.group(1)
            if url in seen or (yielded_images and url in yielded_images):
                seen.add(url)
                continue
            neighbor = m_inline.group(2)
            k = re.sub(r'[«»,;:\*\[\]\(\)•#]', ' ', neighbor).strip().lower()
            k = re.sub(r'\s+', ' ', k).rstrip(' .,;:!?')
            # Matching par mots distinctifs (len > 5) — robuste aux reformulations LLM
            distinctive = [w for w in k.split() if len(w) > 5]
            if len(distinctive) >= 3:
                matches = sum(1 for w in distinctive if w in llm_clean)
                if matches >= max(2, len(distinctive) // 2):
                    result.append(url)
                    seen.add(url)
            continue

        m = re.match(r'!\[[^\]]*\]\(([^)]+)\)$', stripped)
        if not m:
            continue
        url = m.group(1)
        if url in seen or url in llm_response:
            continue
        if yielded_images and url in yielded_images:
            seen.add(url)
            continue
        prev_line = lines[i - 1].strip() if i > 0 else ''
        next_line = lines[i + 1].strip() if i < len(lines) - 1 else ''
        prev_has_text = bool(prev_line) and not re.match(r'!\[', prev_line) and len(prev_line) >= 10
        next_has_text = bool(next_line) and not re.match(r'!\[', next_line) and len(next_line) >= 10
        if prev_has_text and next_has_text:
            if yielded_images is None or url in yielded_images:
                continue  # inline déjà injecté via anchor
        for j in range(max(0, i - 3), min(len(lines), i + 4)):
            if j == i:
                continue
            neighbor = lines[j].strip()
            if re.search(r'!\[', neighbor) or len(neighbor) < 15:
                continue
            k = re.sub(r'[«»,;:\*\[\]\(\)•#]', ' ', neighbor).strip().lower()
            k = re.sub(r'\s+', ' ', k).rstrip(' .,;:!?')
            # Même logique que les images inline : mots distinctifs (> 5 chars)
            # évite les faux-positifs sur les mots courants du contexte
            distinctive = [w for w in k.split() if len(w) > 5]
            if len(distinctive) >= 3:
                matches = sum(1 for w in distinctive if w in llm_clean)
                if matches >= max(2, len(distinctive) // 2):
                    seen.add(url)
                    result.append(url)
                    break
    return result[:2]


def _norm_accent(s: str) -> str:
    """Normalise les accents pour comparaison robuste (icone == icône)."""
    return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()


def _place_image_in_sentence(sentence: str, url: str, prepend: bool = False) -> str:
    """
    Place l'image dans la phrase selon le type d'ancre :
    - prepend=True (Cas 1 inline) : image AVANT le texte → '![image](url) texte...'
    - prepend=False (Cas 2 bloc)  : après 'cliquez sur' si présent, sinon à la fin.
    """
    if prepend:
        return f"![image]({url}) {sentence}"
    m = re.search(r'\bclique(?:r|z)\s+sur\b', sentence, re.IGNORECASE)
    if m:
        return sentence[:m.end()] + f" ![image]({url})" + sentence[m.end():]
    return sentence + f" ![image]({url})"


def _match_sentence_to_anchor(
    sentence: str, anchors: list[tuple[str, str, bool]], injected: set
) -> tuple[str, bool] | None:
    """
    Retourne (url, prepend) si la phrase correspond à une ancre, sinon None.
    prepend=True → image avant le texte (Cas 1 inline), False → après 'cliquez sur' (Cas 2).
    Marque l'URL comme injectée dans `injected`.
    """
    sent_norm = _norm_accent(sentence)
    for anchor_text, url, prepend in anchors:
        if url in injected:
            continue
        distinctive = [w for w in anchor_text.split() if len(w) > 4]
        if len(distinctive) < 2:
            continue
        threshold = max(2, len(distinctive) // 2)
        if sum(1 for w in distinctive if _norm_accent(w) in sent_norm) >= threshold:
            injected.add(url)
            return url, prepend
    return None


def _inject_inline_images(response: str, anchors: list[tuple[str, str, bool]]) -> tuple[str, set]:
    """Post-traitement (non-streaming) : injecte les images inline dans une réponse complète."""
    injected: set = set()
    result = response
    parts = re.split(r'(?<=[.!?])\s+', result)
    for part in parts:
        match = _match_sentence_to_anchor(part, anchors, injected)
        if match:
            url, prepend = match
            idx = result.find(part)
            if idx != -1:
                placed = _place_image_in_sentence(part, url, prepend=prepend)
                result = result[:idx] + placed + result[idx + len(part):]
    return result, injected


def _extract_relevant_lines(text: str, question: str) -> str:
    """En mode raw, garde uniquement les lignes qui répondent à la question.
    Seuil relatif : score >= max_score - 1 (filtre les lignes qui matchent
    uniquement des mots génériques partagés par toutes les lignes).
    Les titres (## / **) sont toujours conservés."""
    keywords = {w.lower() for w in question.split() if len(w) >= 4 and w.lower() not in STOP_WORDS}
    if not keywords:
        return text

    lines = text.split('\n')
    n = len(lines)

    def _score(line: str) -> int:
        low = _norm_accent(line.lower())
        return sum(1 for kw in keywords if _norm_accent(kw) in low)

    def _is_header(line: str) -> bool:
        s = line.strip()
        if s.startswith('#'):
            return True
        # Un vrai titre en gras est COURT et sans « : ». Une ligne « **NOM** : valeur »
        # (issue de la conversion de tableau, ex. « **SUCRE_CONSULT** : Profil… ») est une
        # DONNÉE, pas un titre : la garder ferait ressortir TOUTES les lignes de la liste.
        return s.startswith('**') and ':' not in s and len(s) < 80

    scored = [_score(l) for l in lines]
    max_score = max(scored) if scored else 0

    # Seuil : au moins max_score - 1, minimum 2 (évite de tout garder sur score 1)
    threshold = max(max_score - 1, 2) if max_score >= 2 else 1

    keep = [False] * n
    for i, line in enumerate(lines):
        if _is_header(line):
            keep[i] = True
        elif scored[i] >= threshold:
            keep[i] = True

    result = []
    prev_blank = False
    for i, line in enumerate(lines):
        if keep[i]:
            result.append(line)
            prev_blank = False
        elif not line.strip():
            if not prev_blank and result:
                result.append('')
            prev_blank = True

    content = '\n'.join(result).strip()
    return content if content else text


def _clean_raw_context(text: str) -> str:
    """Nettoie le texte brut pour le mode RAW :
    - Supprime lignes séparatrices de tableaux (|---|---|)
    - Convertit lignes de tableau en texte lisible **nom** : description
    - Tout le reste (puces, titres, sauts de ligne) est préservé tel quel.
    """
    lines = text.split('\n')
    result = []
    for line in lines:
        stripped = line.strip()

        # Lignes séparatrices de tableaux → supprimer
        if re.match(r'^\|[\s\-|:]+\|$', stripped):
            continue

        # Lignes de tableau → **nom** : description (avec restauration des listes)
        if stripped.startswith('|') and stripped.count('|') >= 2:
            cells = [c.strip() for c in stripped.split('|')]
            cells = [c for c in cells if c]
            if not cells:
                continue
            if len(cells) == 1:
                result.append(cells[0].replace('⏎', '\n'))
            else:
                name = next((c for c in cells if c and len(c) <= 40 and not c.lower().startswith('param')), '')
                # Description = TOUTES les autres colonnes (Signification, Exemple…) dans l'ordre,
                # pas seulement la dernière — sinon on perd les colonnes du milieu (tableau 3 colonnes).
                rest = list(cells)
                if name and name in rest:
                    rest.remove(name)
                description = ' — '.join(rest).replace('⏎', '\n')
                # Heuristique pour contenu déjà indexé sans ⏎ :
                # si la description contient 3+ items " - Mot" consécutifs, restaurer les sauts de ligne
                if '⏎' not in stripped and description.count(' - ') >= 2:
                    description = re.sub(r' - (?=\S)', '\n- ', description)
                if name and name != description.split('\n')[0].strip():
                    result.append(f'**{name}** : {description}')
                else:
                    result.append(description)
            continue

        # Tout le reste : préservé tel quel, juste convertir ⏎ en saut de ligne réel
        result.append(line.replace('⏎', '\n'))

    return '\n'.join(result)


def _build_raw_answer(raw_text: str, question: str) -> str:
    """Mode RAW : le LLM trie (renvoie numéros de lignes + intro), Python ressort le texte verbatim.
    Aucun texte ne passe par la génération du LLM → zéro corruption."""
    # Lignes non vides numérotées (1-indexé)
    all_lines = raw_text.split('\n')
    numbered = [(i, l) for i, l in enumerate(all_lines) if l.strip()]
    if not numbered:
        return raw_text

    numbered_context = '\n'.join(f"{n}. {l}" for n, (_, l) in enumerate(numbered, start=1))
    print(
        f"\n=== CONTEXT RAW envoyé au LLM ({len(numbered)} lignes) ===\n"
        + numbered_context
        + "\n=== QUESTION ===\n" + question
        + "\n=== END CONTEXT RAW ===\n",
        flush=True
    )
    response = raw_select_lines(numbered_context, question)
    print(f"=== RÉPONSE LLM RAW ===\n{response}\n=== END RÉPONSE ===\n", flush=True)

    def _parse_nums(s: str) -> list[int]:
        """Parse '2, 6, 9-14' → [2, 6, 9, 10, 11, 12, 13, 14] (gère les plages)."""
        nums: list[int] = []
        for part in re.split(r'[,\s]+', s.strip()):
            if not part:
                continue
            m = re.match(r'(\d+)\s*[-–]\s*(\d+)$', part)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                if a <= b:
                    nums.extend(range(a, b + 1))
            elif part.isdigit():
                nums.append(int(part))
        return nums

    # Parse le format balisé : INTRO: ... / LIGNES: ...
    intro = ""
    selected_nums: list[int] = []
    if response:
        m_lignes = re.search(r'LIGNES?\s*:\s*([\d,\s\-–]+)', response, re.IGNORECASE)
        if m_lignes:
            selected_nums = _parse_nums(m_lignes.group(1))
        m_intro = re.search(r'INTRO\s*:\s*(.+)', response, re.IGNORECASE)
        if m_intro:
            intro = m_intro.group(1).strip()
        elif m_lignes:
            # Pas de tag INTRO mais LIGNES présent → prend la dernière ligne avant LIGNES:
            before = response[:m_lignes.start()].strip().split('\n')
            intro = before[-1].strip() if before and before[-1].strip() else ""
        # Fallback : aucun tag → numéros isolés. MAIS uniquement si la réponse est
        # VRAIMENT une liste de numéros (« 4 », « ligne 4, 5 »). Si le modèle a cassé
        # le format et répondu en PROSE (reformulation « 1. Il permet… 2. Les
        # utilisateurs… »), ses puces « 1. 2. 3. » NE sont PAS des n° de lignes :
        # les extraire ressortirait des lignes du contexte au hasard. Dans ce cas on
        # laisse selected_nums vide → l'extraction par mots-clés (verbatim, sûre) prend le relais.
        if not selected_nums:
            _residue = re.sub(r'lignes?|:', '', response, flags=re.IGNORECASE)
            if sum(c.isalpha() for c in _residue) <= 3:
                selected_nums = _parse_nums(response)

    # Nettoie l'intro : retire toute référence à la numérotation interne (ex: "dans les lignes 4 à 12")
    if intro:
        intro = re.sub(
            r'[,(]?\s*(?:(?:décrit\w*|détaill\w*|expliqu\w*|indiqu\w*|présent\w*|mentionn\w*|list\w*|voir|cf\.?|selon|dans|aux?|à|de|du|des?|la|une?|les?)\s+)*lignes?\s+\d[\d\s,\-–àaeto]*\)?',
            ' ', intro, flags=re.IGNORECASE
        )
        intro = re.sub(r'\s+', ' ', intro).strip(' .,;:()')
        # Après retrait du « ligne N », si l'intro se termine par un mot « suspendu »
        # (article / préposition / verbe de renvoi), c'était une phrase de pointage
        # tronquée (« …sont listés dans la ») qui n'apporte rien → on l'abandonne.
        if intro and re.search(
            r'(?:^|\s)(?:dans|la|le|les|une?|des?|du|aux?|à|de|sur|sont|est|list\w*|décrit\w*|présent\w*|indiqu\w*|mentionn\w*|détaill\w*|expliqu\w*)$',
            intro, flags=re.IGNORECASE,
        ):
            intro = ""
        # Si après nettoyage il ne reste presque rien, on abandonne l'intro
        if len(intro.split()) < 3:
            intro = ""

    # Complétion de liste : si le RAW sélectionne UNE puce (ou l'intro « … : »), on étend
    # à TOUT le bloc de puces contigu (+ sa ligne d'intro) pour ne jamais couper une liste
    # en deux. TOUJOURS actif (pas seulement sur les questions « quelles/liste ») : ex.
    # « À quoi servent les échéances » → le RAW prenait « induites » mais pas « manuelles ».
    # En RAW c'est SÛR (verbatim, aucune invention) — au pire un peu plus de contexte.
    def _is_bullet_line(s: str) -> bool:
        t = s.strip()
        # ⚠️ Une ligne en GRAS « **NOM** : … » (conversion de tableau) commence par « * »
        # mais N'EST PAS une puce : la traiter comme telle englobait tout le bloc de
        # lignes « **…** » contiguës (toute la table des profils) à partir d'une seule.
        if t.startswith('**'):
            return False
        return t.startswith(('•', '-', '*'))

    if selected_nums:
        expanded = set(selected_nums)
        for num in list(selected_nums):
            idx = num - 1
            if not (0 <= idx < len(numbered)):
                continue
            line_txt = numbered[idx][1].strip()
            if _is_bullet_line(line_txt):
                # Sélection d'une PUCE → englobe tout le bloc de puces (+ intro « : »)
                j = idx
                while j >= 0 and _is_bullet_line(numbered[j][1]):
                    expanded.add(j + 1)
                    j -= 1
                if j >= 0 and numbered[j][1].strip().endswith(':'):
                    expanded.add(j + 1)
                j = idx
                while j < len(numbered) and _is_bullet_line(numbered[j][1]):
                    expanded.add(j + 1)
                    j += 1
            elif line_txt.endswith(':'):
                # Sélection d'une INTRO de liste (« …suivantes : ») → englobe le bloc de
                # puces qui suit (le modèle sélectionne l'intro sans les puces).
                j = idx + 1
                # saute d'éventuelles images entre l'intro et la 1re puce
                while j < len(numbered) and re.match(r'^!\[image\]', numbered[j][1].strip()):
                    j += 1
                while j < len(numbered) and _is_bullet_line(numbered[j][1]):
                    expanded.add(j + 1)
                    j += 1
        selected_nums = sorted(expanded)

    # Inclusion des images : une image seule sur sa ligne, située à l'intérieur de la zone
    # sélectionnée ou juste à côté d'une ligne retenue, est ajoutée à la réponse.
    if selected_nums:
        sel = set(selected_nums)
        lo, hi = min(selected_nums), max(selected_nums)
        for n, (_, line) in enumerate(numbered, start=1):
            if re.match(r'^!\[image\]\([^)]+\)$', line.strip()):
                if lo <= n <= hi or (n - 1) in sel or (n + 1) in sel:
                    sel.add(n)
        selected_nums = sorted(sel)

    # Récupère les lignes verbatim correspondant aux numéros (1-indexé sur `numbered`)
    selected_lines = []
    for num in selected_nums:
        if 1 <= num <= len(numbered):
            selected_lines.append(numbered[num - 1][1])

    # Fallback : si le LLM n'a rien sélectionné de valide → extraction par mots-clés
    if not selected_lines:
        body = _extract_relevant_lines(raw_text, question)
    else:
        body = '\n'.join(selected_lines)

    # FALLBACK DÉDUCTION — CONSERVATEUR : uniquement si le modèle RAW signale
    # explicitement « LIGNES: AUCUNE » (aucune ligne ne répond directement). On tente
    # alors une déduction ENCADRÉE via un modèle génératif (gemma3:4b) ; son prompt refuse
    # si le document ne fournit pas d'éléments → pas d'hallucination.
    # ⚠️ Déclencheur volontairement STRICT : un déclencheur heuristique (mots-clés) se
    # déclenchait à tort sur des questions factuelles et faisait halluciner la déduction
    # (ex. civilité → « 50 caractères » au lieu de 12). On ne se fie donc QU'à AUCUNE.
    if os.getenv("RAW_DEDUCE", "true").strip().lower() == "true" and \
       re.search(r'LIGNES?\s*:\s*aucune', response or "", re.IGNORECASE):
        try:
            from services.mistral_utils import deduce_answer
            plain = "\n".join(l for _, l in numbered)
            print("[RAW] AUCUNE ligne ne répond → fallback déduction", flush=True)
            deduced = deduce_answer(plain, question)
            if deduced:
                return deduced
        except Exception as _e:
            print(f"[RAW deduce fallback erreur] {_e}", flush=True)

    # Garde-fou anti-répétition : si l'intro (paraphrase du LLM) recoupe trop une ligne
    # du corps (verbatim), on la supprime — le corps dit déjà la même chose, souvent en
    # plus complet (ex. intro « …générées pour créances non soldées » vs corps « …générées
    # DANS TOUS LES CAS pour créances non soldées »). On scanne TOUTES les lignes du corps,
    # pas seulement la première (le doublon peut être plus bas dans la réponse).
    if intro and body:
        def _sig_words(s: str) -> set:
            s = _norm_accent(re.sub(r'[^\w\s]', ' ', s.lower()))
            return {w for w in s.split() if len(w) > 3 and w not in STOP_WORDS}
        intro_words = _sig_words(intro)
        if intro_words:
            for _bl in body.split('\n'):
                bw = _sig_words(_bl)
                if bw and len(intro_words & bw) / len(intro_words) >= 0.6:
                    intro = ""
                    break

    if intro:
        return intro + "\n\n" + body
    return body


def build_context(docs_with_scores: list, best_page_id: str, full_page: bool = False, target_pages: list | None = None) -> tuple[str, list[tuple[str, str]], list[dict]]:
    """Contexte pour le LLM.
    - défaut : chunk le plus pertinent de best_page_id.
    - full_page=True : TOUS les chunks de best_page_id (ordre de lecture).
    - target_pages (RAG_PAGES>1) : liste de page_id (ordre pré-rerank) → pages ENTIÈRES,
      titre inclus devant chaque page. Corrige « la bonne page n'est pas la mieux
      scorée » (ex. civilité p117 alors que best_page_id=p169)."""

    def _is_valid(doc, score):
        if score == 0.0:
            return False
        body = re.sub(r'^\[TITRE\][^\n]*\n?', '', doc.page_content)
        body = re.sub(r'(?m)^\s*#{1,6}\s+.*$', '', body)   # lignes de titre markdown
        body = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', body)    # images
        return len(body.strip()) >= 30

    top3: list[LCDocument] = []

    # Mode MULTI-PAGES : pages cibles (capturées avant le filtre ML), chacune ENTIÈRE,
    # dans l'ordre fourni. On prend TOUS les chunks de ces pages présents en mémoire.
    if target_pages:
        order = {pid: i for i, pid in enumerate(target_pages)}
        top3 = [d for d, _s, _r in docs_with_scores if d.metadata.get("page_id") in order]

    # Mode PAGE ENTIÈRE (1 page) : tous les chunks de best_page_id.
    if not top3 and full_page and best_page_id:
        top3 = [d for d, _s, _r in docs_with_scores if d.metadata.get("page_id") == best_page_id]

    # Sinon : meilleur chunk de best_page_id (docs_with_scores est trié par score)
    if not top3:
        for doc, score, _ in docs_with_scores:
            if not _is_valid(doc, score):
                continue
            if doc.metadata.get("page_id") == best_page_id:
                top3 = [doc]
                break

    # Fallback : meilleur chunk global si best_page_id n'a pas de chunk valide
    if not top3:
        for doc, score, _ in docs_with_scores:
            if _is_valid(doc, score):
                top3 = [doc]
                break

    # Fallback final : premier chunk de best_page_id sans contrainte de longueur
    if not top3:
        for doc, score, _ in docs_with_scores:
            if doc.metadata.get("page_id") == best_page_id:
                top3 = [doc]
                break

    # Ordre des pages : si target_pages fourni (multi-pages), on suit cet ordre
    # (pré-rerank, meilleure page d'abord) ; sinon ordre d'apparition dans top3.
    _multi = bool(target_pages)
    if top3:
        page_order = []
        seen_pages = set()
        if _multi:
            for pid in target_pages:
                if pid not in seen_pages and any(d.metadata.get("page_id") == pid for d in top3):
                    page_order.append(pid); seen_pages.add(pid)
        for doc in top3:
            pid = doc.metadata.get("page_id")
            if pid not in seen_pages:
                page_order.append(pid); seen_pages.add(pid)
        groups = {pid: [] for pid in page_order}
        for doc in top3:
            groups[doc.metadata.get("page_id")].append(doc)
        for pid in page_order:
            groups[pid].sort(key=lambda d: int(d.metadata.get("chunk_index", 999)))
        top3 = [doc for pid in page_order for doc in groups[pid]]

    print(f"[build_context] top1 cidx={[d.metadata.get('chunk_index') for d in top3]} pages={[d.metadata.get('page_id') for d in top3]}", flush=True)

    max_chars_per_doc = 2500
    chunk_images: list[tuple[str, str]] = []  # (chunk_text, image_url)
    seen_images = set()
    context_parts = []
    _last_pid = None

    for doc in top3:
        pid = doc.metadata.get("page_id")
        raw = doc.page_content
        if len(raw) > max_chars_per_doc:
            cut = raw.rfind('\n', 0, max_chars_per_doc)
            if cut < max_chars_per_doc * 0.7:
                cut = raw.rfind('. ', 0, max_chars_per_doc)
            raw = raw[:cut] if cut > 0 else raw[:max_chars_per_doc]
        lines = []
        for line in raw.splitlines():
            normalized = " ".join(line.split())
            if normalized.startswith("•") or normalized:
                lines.append(normalized)
        # Multi-pages : titre de page devant son contenu → le LLM sait que les infos
        # viennent de pages DIFFÉRENTES (il peut combiner ou n'en garder qu'une).
        if _multi and pid != _last_pid:
            _title = (doc.metadata.get("title") or "").strip() or "Document"
            context_parts.append(f"## {_title}\n" + "\n".join(lines))
            _last_pid = pid
        else:
            context_parts.append("\n".join(lines))

        images_str = doc.metadata.get("images", "")
        if images_str:
            img_url = images_str.split(",")[0].strip()
            if img_url and img_url not in seen_images:
                seen_images.add(img_url)
                chunk_images.append((doc.page_content, img_url))

    # Pages uniques triées par nombre de chunks (page la plus représentée = source principale)
    page_chunk_count: dict[str, int] = {}
    for doc in top3:
        pid = doc.metadata.get("page_id")
        if pid:
            page_chunk_count[pid] = page_chunk_count.get(pid, 0) + 1

    unique_page_metas: list[dict] = []
    seen_pids: set = set()
    _meta_iter = top3 if _multi else sorted(top3, key=lambda d: -page_chunk_count.get(d.metadata.get("page_id"), 0))
    for doc in _meta_iter:
        pid = doc.metadata.get("page_id")
        if pid not in seen_pids:
            seen_pids.add(pid)
            unique_page_metas.append(doc.metadata)

    titles = [m.get("title", "?") for m in unique_page_metas]
    source_header = "[Source: " + " | ".join(titles) + "]"
    context = f"{source_header}\n\n" + "\n\n".join(context_parts)

    return context, chunk_images, unique_page_metas


# Mots omniprésents ignorés pour le filtrage paragraphe (ne discriminent pas un bloc)
_PARA_COMMON = {
    "creance", "creances", "sucre", "dossier", "dossiers", "menu", "onglet", "ecran",
    "bouton", "page", "cliquez", "cliquer", "permet", "affiche", "outil", "application",
}
_PARA_IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]+\)")


def _para_words(s: str) -> set:
    """Mots significatifs d'un texte (sans markdown/ponctuation, accents retirés)."""
    return {w for w in re.findall(r"[a-z0-9]+", _norm_accent(s)) if len(w) > 3 and w not in STOP_WORDS}


def build_para_context(docs_with_scores: list, target_pages: list, question: str, budget: int):
    """Contexte « paragraphes ciblés bornés » (comme le LLM direct, pour le RAG).
    Pour les pages des meilleurs chunks (target_pages, ordre de pertinence), ne garde
    que les paragraphes qui parlent du sujet — (a) mot DISTINCTIF de la question OU
    (b) bloc couvert à ≥60% par un chunk RÉCUPÉRÉ (sémantique, robuste aux abréviations)
    — + images adjacentes. Plafonné à `budget` caractères (vitesse prod).
    Retourne (context, chunk_images, page_metas) comme build_context."""
    q_stems = {w[:5] for w in _para_words(question) if len(w) >= 4 and w not in _PARA_COMMON}

    by_page: dict[str, list] = {}
    for doc, score, _r in docs_with_scores:
        pid = doc.metadata.get("page_id")
        if pid:
            by_page.setdefault(pid, []).append((doc, score))

    order = list(dict.fromkeys(p for p in (target_pages or []) if p in by_page))  # dédup, ordre gardé
    if not order:
        order = list(by_page.keys())[:1]

    def _real_text(b: str) -> str:
        # texte réel du bloc : sans les titres markdown (## …) ni les images
        t = re.sub(r'(?m)^\s*#{1,6}\s*.*$', '', b)
        t = _PARA_IMG_RE.sub('', t)
        return t.strip()

    parts: list[str] = []
    metas: list[dict] = []
    chunk_images: list[tuple[str, str]] = []
    seen_img: set = set()
    seen_sig: set = set()   # signatures des paragraphes déjà ajoutés (anti-doublon overlap)
    total = 0
    # Plafond par page : évite qu'une page à mot omniprésent (« workflow ») remplisse
    # tout le budget. Au moins 2 pages peuvent contribuer.
    per_page_cap = max(2000, budget // 2)

    def _sig(s: str) -> str:
        return re.sub(r'\s+', ' ', _real_text(s)).strip().lower()[:80]

    for pid in order:
        if total >= budget:
            break
        page_total = 0
        chunks = sorted(by_page[pid], key=lambda ds: int(ds[0].metadata.get("chunk_index", 999)))
        # Chunks RÉCUPÉRÉS de la page, triés par PERTINENCE (score croissant = meilleur
        # d'abord). Sert à ordonner les blocs par rang : le contenu du chunk le PLUS
        # pertinent (ex. la liste des conditions) passe AVANT le contenu moins pertinent
        # de la même page (ex. les captures de notification) → pas coupé par le budget.
        ret_ranked = [_para_words(d.page_content) for d, s in
                      sorted([(d, s) for d, s in chunks if s != 0.0], key=lambda ds: ds[1])]
        ret_words: set = set().union(*ret_ranked) if ret_ranked else set()
        full = "\n".join(
            re.sub(r'^\[TITRE\][^\n]*\n?', '', d.page_content).strip() for d, _s in chunks
        ).replace('⏎', '\n')
        # Dédup du CHEVAUCHEMENT entre chunks (chunk_overlap=80) : supprime une ligne
        # non vide identique à la précédente (ex. « date-acte » répété entre chunk 19/20).
        _seen_line: set = set()
        _dedup_lines: list[str] = []
        for _ln in full.split('\n'):
            _k = _ln.strip()
            if _k and _k in _seen_line:
                continue
            if _k:
                _seen_line.add(_k)
            _dedup_lines.append(_ln)
        full = "\n".join(_dedup_lines)

        blocks = re.split(r"\n\s*\n", full)
        keep = [False] * len(blocks)
        # tier = RANG du chunk récupéré qui couvre le bloc (0 = chunk le + pertinent).
        # Un bloc couvert par le chunk #1 passe avant celui couvert par le chunk #2, etc.
        # Simple match mot-clé sans couverture chunk → tier après tous les chunks.
        _kw_tier = len(ret_ranked) + 1
        tier = [_kw_tier + 1] * len(blocks)
        for i, b in enumerate(blocks):
            real = _real_text(b)
            if len(real) < 15:           # bloc titre-seul / quasi vide → jamais gardé
                continue
            bw = _para_words(b)
            best_rank = None
            for rk, cw in enumerate(ret_ranked):
                if bw and len(bw & cw) / len(bw) >= 0.6:
                    best_rank = rk
                    break
            stems = {w[:5] for w in bw if len(w) >= 4}
            kw = bool(q_stems and (stems & q_stems))
            if best_rank is not None:
                keep[i] = True
                tier[i] = best_rank
            elif kw:
                keep[i] = True
                tier[i] = _kw_tier
        def _is_bullet(s: str) -> bool:
            return bool(re.match(r'^\s*[•\-\*]', s.strip()))

        # CONTINUITÉ DE LISTE : une puce courte (ex. « • « nom » ») n'a pas de mot
        # significatif → serait jetée, cassant la liste. On garde toute PUCE adjacente
        # à un bloc gardé (propagation de proche en proche dans une liste contiguë).
        # + images adjacentes à un bloc gardé.
        changed = True
        while changed:
            changed = False
            for i, b in enumerate(blocks):
                if keep[i]:
                    continue
                is_img = bool(_PARA_IMG_RE.search(b)) and not _PARA_IMG_RE.sub("", b).strip()
                adj_prev = i > 0 and keep[i - 1]
                adj_next = i < len(blocks) - 1 and keep[i + 1]
                if (adj_prev or adj_next) and (is_img or _is_bullet(b)):
                    keep[i] = True
                    tier[i] = min(tier[i - 1] if adj_prev else 9, tier[i + 1] if adj_next else 9)
                    changed = True

        title = chunks[0][0].metadata.get("title", "?")
        header = (f"## {title}\n" if len(order) > 1 else "")
        added = False
        header_added = False
        # PRIORITÉ : d'abord les blocs tier 0 (chunks récupérés = réponse), puis tier 1
        # (mot-clé), chacun en ordre de lecture. Évite que du bruit placé tôt dans une
        # longue page (ex. p117 « notification » partout) évince la vraie réponse (chunk 19).
        block_order = sorted((i for i in range(len(blocks)) if keep[i]),
                             key=lambda i: (tier[i], i))
        for i in block_order:
            b = blocks[i]
            if total >= budget or page_total >= per_page_cap:
                continue
            piece = b.strip()
            sig = _sig(piece)
            if sig and sig in seen_sig:      # paragraphe déjà vu (overlap chunks) → skip
                continue
            if total + len(piece) > budget:
                # Budget dépassé : on coupe à une FRONTIÈRE PROPRE (fin de phrase ou
                # saut de ligne) pour ne pas tronquer en plein milieu d'une phrase.
                room = max(0, budget - total)
                cut = max(piece.rfind('. ', 0, room), piece.rfind('.\n', 0, room),
                          piece.rfind('\n', 0, room), piece.rfind('• ', 0, room))
                if cut <= 0:
                    break
                piece = piece[:cut + 1].strip()
                if not piece:
                    break
                if not header_added and header:
                    parts.append(header.rstrip()); total += len(header); header_added = True
                parts.append(piece); total += len(piece) + 2; added = True
                if sig:
                    seen_sig.add(sig)
                break
            if not header_added and header:
                parts.append(header.rstrip()); total += len(header); header_added = True
            parts.append(piece)
            total += len(piece) + 2
            page_total += len(piece)
            added = True
            if sig:
                seen_sig.add(sig)
        if added:
            metas.append(chunks[0][0].metadata)
            for doc, _s in chunks:
                imgs = doc.metadata.get("images", "")
                if imgs:
                    u = imgs.split(",")[0].strip()
                    if u and u not in seen_img:
                        seen_img.add(u)
                        chunk_images.append((doc.page_content, u))

    if not parts:  # fallback : rien gardé → build_context classique (1 chunk)
        return None

    titles = [m.get("title", "?") for m in metas]
    context = "[Source: " + " | ".join(titles) + "]\n\n" + "\n\n".join(parts)
    print(f"[build_para_context] pages={[m.get('page_id') for m in metas]} "
          f"{total} car. (budget {budget})", flush=True)
    return context, chunk_images, metas


_DEF_RE = re.compile(r"\b(c'?est\s+quoi|qu'?est[- ]ce\s+qu|que\s+signifie|d[ée]finition|c\s*koi)\b", re.IGNORECASE)


def build_full_context(docs_with_scores: list, budget: int, question: str = ""):
    """Contexte LARGE pour la REFORMULATION (modèle capable).
    Colle les meilleurs chunks dans l'ordre du rerank jusqu'au budget, SANS le filtrage
    paragraphe serré de build_para_context. Mesuré : sur un modèle capable (qwen2.5:7b),
    ce contexte complet répond MIEUX (réponse juste ~45%) que le contexte filtré (~35%) —
    le filtrage serré affame le modèle (il jette du contenu utile). Le filtrage reste
    réservé au mode RAW (petit modèle, qui se noie dans un contexte large).
    Retourne (context, chunk_images, page_metas) comme build_para_context."""
    ordered = list(docs_with_scores)
    # DÉFINITIONNEL (« c'est quoi X ») : la déf est presque toujours au DÉBUT de la page
    # mais a un cosinus faible → non récupérée → placée en score 0.0 en fin de liste →
    # évincée par le budget. On remonte les 3 premiers chunks de la MEILLEURE page en tête
    # pour garantir l'intro/définition (sinon le modèle invente). Ciblé : seulement sur les
    # questions définitionnelles (ne gâche pas le budget des questions factuelles).
    if question and _DEF_RE.search(question) and ordered:
        best_pid = ordered[0][0].metadata.get("page_id")

        def _cidx(t) -> int:
            try:
                return int(t[0].metadata.get("chunk_index", 999))
            except (TypeError, ValueError):
                return 999
        intro = sorted((t for t in ordered if t[0].metadata.get("page_id") == best_pid and _cidx(t) <= 2),
                       key=_cidx)
        if intro:
            intro_ids = {id(t) for t in intro}
            ordered = intro + [t for t in ordered if id(t) not in intro_ids]

    # CONTINUITÉ DE CHUNK : une intro de liste finit par « : » mais sa suite (la liste) est
    # dans le chunk SUIVANT, souvent non récupéré (cosinus faible) → le contexte affichait
    # « Il existe deux types : » puis sautait au chunk suivant récupéré, enjambant la liste.
    # Dès qu'un chunk retenu finit par « : », on insère juste après le chunk chunk_index+1
    # de la même page (disponible via la complétion de contexte). Marche pour TOUTE
    # formulation (pas seulement « c'est quoi »).
    def _key(t):
        try:
            return (t[0].metadata.get("page_id"), int(t[0].metadata.get("chunk_index", -1)))
        except (TypeError, ValueError):
            return (t[0].metadata.get("page_id"), -1)
    _by_key = {_key(t): t for t in docs_with_scores if _key(t)[1] >= 0}
    _expanded: list = []
    _seen: set = set()
    for t in ordered:
        if id(t) in _seen:
            continue
        _expanded.append(t); _seen.add(id(t))
        _txt = _PARA_IMG_RE.sub('', t[0].page_content).rstrip()
        if _txt.endswith(':'):
            pid, ci = _key(t)
            _nxt = _by_key.get((pid, ci + 1))
            if _nxt is not None and id(_nxt) not in _seen:
                _expanded.append(_nxt); _seen.add(id(_nxt))
    ordered = _expanded

    parts: list[str] = []
    metas: list[dict] = []
    chunk_images: list[tuple[str, str]] = []
    seen_img: set = set()
    seen_sig: set = set()
    total = 0
    for doc, score, *_ in ordered:
        c = re.sub(r'^\[TITRE\][^\n]*\n?', '', doc.page_content).strip().replace('⏎', '\n')
        sig = re.sub(r'\s+', ' ', _PARA_IMG_RE.sub('', c)).strip().lower()[:80]
        if len(sig) < 15 or (sig in seen_sig):      # vide / titre-seul / doublon overlap
            continue
        if total + len(c) > budget:
            break
        parts.append(c)
        total += len(c) + 2
        seen_sig.add(sig)
        metas.append(doc.metadata)
        imgs = doc.metadata.get("images", "")
        if imgs:
            u = imgs.split(",")[0].strip()
            if u and u not in seen_img:
                seen_img.add(u)
                chunk_images.append((doc.page_content, u))
    if not parts:
        return None
    # metas dédupliqués par page (ordre gardé → source principale = 1re page)
    seen_p: set = set()
    uniq_metas: list[dict] = []
    for m in metas:
        p = m.get("page_id")
        if p not in seen_p:
            seen_p.add(p)
            uniq_metas.append(m)
    titles = list(dict.fromkeys(m.get("title", "?") for m in uniq_metas))
    context = "[Source: " + " | ".join(titles) + "]\n\n" + "\n\n".join(parts)
    print(f"[build_full_context] pages={[m.get('page_id') for m in uniq_metas]} "
          f"{total} car. (budget {budget})", flush=True)
    return context, chunk_images, uniq_metas


_H2_RE = re.compile(r'(?m)^\s{0,3}#{2,}\s+')  # titre de section : ## (h2) OU ### (h3) OU +, pas le # (h1/titre page)


def build_section_context(docs_with_scores: list, budget: int, question: str = "", page_fallback: bool = True):
    """Contexte par SECTION (titre ## / ###) pour la REFORMULATION (modèle capable).
    Principe : la bonne PAGE est trouvée (recall ~90-95%), on lui donne son contenu
    COMPLET mais FOCALISÉ — la SECTION la plus fine (bloc délimité par un titre ##/###)
    qui contient la réponse, en entier. Si la page n'a AUCUN titre → **page entière**.
    Objectif : reproduire le « PDF/page entière » (qui répond bien) sans le bruit des
    autres sections. Résout « c'est quoi X » et les listes coupées (tout est là).
    Retourne (context, chunk_images, page_metas) comme build_para_context."""
    if not docs_with_scores:
        return None
    dl = list(docs_with_scores)
    best_pid = dl[0][0].metadata.get("page_id")

    def _ci(t) -> int:
        try:
            return int(t[0].metadata.get("chunk_index", 999))
        except (TypeError, ValueError):
            return 999
    page_chunks = sorted((t for t in dl if t[0].metadata.get("page_id") == best_pid), key=_ci)
    if not page_chunks:
        return None
    title = page_chunks[0][0].metadata.get("title", "?")

    # 1) Reconstruire le texte PLEIN de la page (dédup des lignes dupliquées par l'overlap)
    seen: set = set()
    lines: list[str] = []
    for t in page_chunks:
        txt = re.sub(r'^\[TITRE\][^\n]*\n?', '', t[0].page_content).replace('⏎', '\n')
        for ln in txt.split('\n'):
            k = ln.strip()
            if k and k in seen:
                continue
            if k:
                seen.add(k)
            lines.append(ln)
    full = '\n'.join(lines).strip()

    # 2) Découper à la frontière de titre la PLUS FINE (h3 ## sinon h2, cf. _H2_RE = #{2,}).
    # La partie AVANT le 1er titre = section 0 (souvent l'intro). Si la page n'a AUCUN
    # titre ## / ### → page entière (beaucoup de pages BookStack sont plates).
    idxs = [m.start() for m in _H2_RE.finditer(full)]
    is_page = not idxs
    if is_page:
        section = full  # aucun titre de section → PAGE ENTIÈRE
    else:
        bounds = [0] + idxs + [len(full)]
        sections = [full[bounds[i]:bounds[i + 1]].strip() for i in range(len(bounds) - 1)]
        sections = [s for s in sections if len(s) > 15]
        # 3) Section qui contient le MEILLEUR chunk récupéré (recouvrement de mots distinctifs)
        anchor_words = {w for w in _para_words(dl[0][0].page_content) if len(w) >= 4}
        section = max(sections, key=lambda s: len(anchor_words & set(_para_words(s)))) if sections else full
        if len(section) < 40:      # section réduite à un titre → page entière (sécurité)
            section, is_page = full, True

    # RAW : si on retombe sur la PAGE ENTIÈRE (pas de section), on rend None → le RAW
    # garde son filtrage serré (build_para_context) au lieu de noyer le petit modèle.
    if is_page and not page_fallback:
        return None

    # 4) Garde-fou budget (une section énorme) : coupe à une frontière de phrase.
    if budget > 0 and len(section) > budget:
        cut = max(section.rfind('. ', 0, budget), section.rfind('\n', 0, budget))
        section = section[:cut + 1].strip() if cut > 0 else section[:budget]

    # 5) ROBUSTESSE (reformulation) : + les paragraphes des meilleurs chunks RÉCUPÉRÉS
    # (toutes pages), non déjà dans la section. La réponse peut être dans une AUTRE section
    # (ex. l'intro « à minima deux étapes ») que celle du meilleur chunk — comme la prod RAW
    # (multi-paragraphes). La section reste EN TÊTE (focalisée) ; les paras complètent.
    metas = [page_chunks[0][0].metadata]
    body = section
    if page_fallback:   # reformulation seulement (pas RAW, qui reste serré)
        def _sig(s: str) -> str:
            return re.sub(r'\s+', ' ', _PARA_IMG_RE.sub('', s)).strip().lower()[:70]
        kept = {_sig(b) for b in re.split(r'\n\s*\n', section) if len(_sig(b)) > 12}
        # Collecte des paragraphes candidats (chunks RÉCUPÉRÉS uniquement) avec leur POSITION
        # dans le document (page, chunk_index, ordre) → tri en ORDRE DE LECTURE ensuite.
        page_rank: dict = {}
        pid_meta: dict = {}
        cands: list = []   # (rang_page, chunk_index, seq, page_id, texte)
        for doc, score, *_ in docs_with_scores:
            if score == 0.0:        # uniquement les chunks RÉCUPÉRÉS (pas la complétion de page)
                continue
            pid = doc.metadata.get("page_id")
            if pid not in page_rank:
                page_rank[pid] = len(page_rank)   # ordre d'apparition = pertinence de la page
                pid_meta[pid] = doc.metadata
            try:
                ci = int(doc.metadata.get("chunk_index", 999))
            except (TypeError, ValueError):
                ci = 999
            raw = re.sub(r'^\[TITRE\][^\n]*\n?', '', doc.page_content).replace('⏎', '\n')
            for seq, para in enumerate(re.split(r'\n\s*\n', raw)):
                cands.append((page_rank[pid], ci, seq, pid, para.strip()))
        # ORDRE DE LECTURE : par page (pertinence), puis position dans le doc (chunk_index, seq).
        # Ne réordonne JAMAIS l'intérieur d'une page → le sens/les enchaînements sont préservés.
        cands.sort(key=lambda t: (t[0], t[1], t[2]))
        total = len(section)
        seen_pages = {best_pid}
        extra: list[str] = []
        for _rank, _ci, _seq, pid, p in cands:   # PAS de plafond de pages sur le CONTEXTE (complétude)
            s = _sig(p)
            if len(s) < 15 or s in kept:
                continue
            if total + len(p) > budget:
                break
            extra.append(p); kept.add(s); total += len(p) + 2
            if pid not in seen_pages:
                seen_pages.add(pid); metas.append(pid_meta[pid])
        if extra:
            body = section + "\n\n" + "\n\n".join(extra)

    # [Source: …] : on plafonne l'AFFICHAGE des sources aux 3 pages les plus contributrices
    # (les 1res de `metas`, par pertinence). Le CONTEXTE, lui, n'est PAS plafonné (complétude).
    _titles = list(dict.fromkeys(m.get("title", "?") for m in metas))[:3]
    context = f"[Source: {' | '.join(_titles)}]\n\n{body}"
    chunk_images = [(body, u) for u in re.findall(r'!\[[^\]]*\]\(([^)]+)\)', body)]
    print(f"[build_section_context] page={best_pid} '{title[:28]}' → "
          f"{'PAGE ENTIÈRE' if is_page else 'section (##/###)'} + {len(body)-len(section)} car paras "
          f"({len(body)} car)", flush=True)
    return context, chunk_images, metas


def is_rejection_response(llm_response: str) -> bool:
    """Vérifie si la réponse LLM est un rejet."""
    rejection_phrases = [
        "cette question ne relève pas de la documentation sucre",
        "cette question ne semble pas concerner la documentation sucre",
        "cette question ne concerne pas sucre",
        "n'est pas présente dans le document",
        "n'est pas contenue dans le document",
        "pas trouvé dans le document",
        "pas présent dans le document",
        "ne figure pas dans le document",
        "ne figure pas dans la documentation",
        "ne concerne pas la documentation",
        "ne fait pas partie de la documentation",
        "n'est pas mentionné dans le document",
        "n'est pas mentionnée dans le document",
        "n'apparaît pas dans le document",
        "n'apparait pas dans le document",
        "absent du document",
        "absente du document",
        "le document ne fournit pas",
        "ne fournit pas d'information",
        "faudrait consulter un autre document",
        "il faudrait consulter",
        "cette information n'est pas présente",
        "ne traite pas de",
        "ne parle pas de",
    ]
    normalized = llm_response.lower().replace("’", "'").replace("‘", "'")
    if not any(phrase in normalized for phrase in rejection_phrases):
        return False
    # Une vraie réponse (> 300 chars) avec une phrase de rejet à la fin n’est PAS un rejet :
    # le LLM a répondu mais ajouté un disclaimer superflu.
    # On considère rejet uniquement si la phrase est dans les 200 premiers caractères
    # ou si la réponse est courte (≤ 300 chars).
    if len(normalized) > 300:
        first_200 = normalized[:200]
        return any(phrase in first_200 for phrase in rejection_phrases)
    return True


# FONCTION PRINCIPALE RAG
def _log_intent_label(question: str, label: int):
    """Enregistre un label d'intention (0=hors-sujet, 1=valide) pour l'entraînement futur."""
    try:
        db_exec(
            "INSERT INTO stevia_intent_labels (question, label) VALUES (:q, :l)",
            {"q": question[:500], "l": label},
        )
    except Exception:
        pass


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


def rag_answer_streaming(question: str, roles: list[str] = ["user"], mode: str | None = None):
    # Mode effectif : override par requête (bouton widget) sinon RAW_MODE du .env.
    # "raw" → RAW (verbatim, RAW_OLLAMA_MODEL) ; "reformulation" → génératif (OLLAMA_MODEL).
    _mode_raw = (mode == "raw") if mode in ("raw", "reformulation") \
        else os.getenv("RAW_MODE", "false").strip().lower() == "true"
    """Générateur de réponse en streaming avec filtrage."""

    # --- 1. SALUTATIONS ET HORS-SUJET ÉVIDENT ---
    # Salutation seule → message de bienvenue
    if re.match(r"^(bonjour|bonsoir|salut|hello|hi|hey|coucou|yo|bjr|bsr|cc|bj)\W*$", question.strip(), re.IGNORECASE):
        yield "Bonjour, que puis-je faire pour vous ?"
        return

    # Salutation en début de phrase → on la retire avant la recherche
    question = re.sub(r"^(bonjour|bonsoir|salut|hello|hi|hey|coucou|yo|bjr|bsr|cc|bj)[,!.\s]+", "", question.strip(), flags=re.IGNORECASE).strip()
    if not question:
        yield "Bonjour, que puis-je faire pour vous ?"
        return

    # --- 2. EXPANSION DES ABRÉVIATIONS ---
    expanded_question = expand_question(question)

    # Requête trop vague : un seul mot sans expansion connue
    words = question.strip().split()
    if len(words) == 1 and expanded_question.strip() == question.strip():
        yield "Votre question est trop courte. Pouvez-vous préciser ce que vous cherchez ?"
        return

    # --- 2b. CACHE SÉMANTIQUE (questions fréquentes validées 👍) ---
    # Embedding calculé 1× : sert au lookup ET au store_pending final.
    #  - sim ≥ HIGH_THRESHOLD (0.90) → hit DIRECT (rapide, pas de recherche).
    #  - VERIFY_THRESHOLD ≤ sim < HIGH → candidat à CONFIRMER par la page source
    #    (on laisse la recherche tourner ; on ne sert que si la même page ressort).
    q_emb = None
    _cache_cand = None
    try:
        from services import qa_cache
        if qa_cache.is_enabled():
            q_emb = embeddings.embed_query(question)
            cand = qa_cache.lookup_candidate(q_emb, roles)
            if cand:
                if cand["sim"] >= qa_cache.HIGH_THRESHOLD:
                    qa_cache.mark_served(cand["id"], cand["sim"])
                    yield cand["answer"]
                    return
                elif cand.get("page_id"):
                    _cache_cand = cand  # bande de vérif : confirmé plus bas par la page source
    except Exception:
        q_emb = None

    # Intent classifier — bloque les questions hors-sujet sémantiquement
    try:
        from services.intent_classifier import is_valid_question, _load_trained_model, _load_prototypes
        if not is_valid_question(expanded_question):
            # Logger label=0 seulement si le modèle est très confiant (évite de polluer le dataset)
            try:
                _m_emb, _, _ = _load_prototypes()
                _qv = _m_emb.embed_query(expanded_question)
                _trained = _load_trained_model()
                if _trained is not None:
                    _proba_invalid = float(_trained.predict_proba([_qv])[0][0])
                    if _proba_invalid >= 0.80:
                        _log_intent_label(expanded_question, 0)
            except Exception:
                pass
            yield "Cette question ne semble pas concerner la documentation SUCRE."
            return
    except Exception:
        pass

    search_keywords = extract_search_keywords(expanded_question)

    # --- 3. RECHERCHE VECTORIELLE ---
    store = get_vector_store()

    # Garde-fou : aucune doc indexée (0 vecteur en base) → le dire clairement
    # et ne PAS passer par le LLM (sinon il invente à partir de ses connaissances).
    try:
        total_vectors = db_exec("SELECT COUNT(*) AS n FROM langchain_pg_embedding").fetchone().n
    except Exception:
        total_vectors = None
    if total_vectors == 0:
        yield "Aucun document n'est indexé à Stevia, veuillez contacter un administrateur."
        return

    try:
        docs_with_scores = store.similarity_search_with_score(expanded_question, k=12)
    except Exception:
        yield "Erreur technique lors de la recherche."
        return

    # --- 4. RECHERCHE PAR MOTS-CLÉS (complément) ---
    keyword_docs = search_by_keywords(search_keywords, docs_with_scores)
    docs_with_scores = merge_keyword_docs(docs_with_scores, keyword_docs)
    docs_with_scores = dedupe_by_content(docs_with_scores)

    if not docs_with_scores:
        yield "Je n'ai trouvé aucune information pertinente."
        return

    # --- 5. RERANKING ---
    docs_with_scores = rerank_documents(docs_with_scores, expanded_question, roles)

    # Top-N pages APRÈS rerank, AVANT le filtre ML (qui peut supprimer des pages utiles
    # comme p117 civilité). Sert au mode multi-pages (RAG_PAGES) et au mode paragraphes
    # (RAG_PARA_BUDGET) : on rechargera ces pages à l'étape 8, même si le ML les écarte.
    try:
        _rag_pages_n = max(1, int(os.getenv("RAG_PAGES", "1")))
    except ValueError:
        _rag_pages_n = 1
    try:
        _rag_para_budget = int(os.getenv("RAG_PARA_BUDGET", "0"))
    except ValueError:
        _rag_para_budget = 0
    # Mode paragraphes → on capture les 5 meilleures pages (le budget limitera le contenu)
    _pages_capture = max(_rag_pages_n, 5) if _rag_para_budget > 0 else _rag_pages_n
    _preranked_pages: list[str] = []
    if _pages_capture > 1:
        for _d, _s, _ in docs_with_scores:
            _pid = _d.metadata.get("page_id")
            if _pid and _pid not in _preranked_pages:
                _preranked_pages.append(_pid)
            if len(_preranked_pages) >= _pages_capture:
                break

    # --- 6. FILTRAGE PAR CLASSIFIEUR ML (Decision Tree supervisé — brique certif Bloc 3) ---
    # RAG_ML_REORDER=true (défaut historique) : le ML RÉORDONNE le choix de page.
    # RAG_ML_REORDER=false (reco, mesuré meilleur) : le ML sert de GARDE-FOU (rejet si rien
    #   de pertinent) mais NE réordonne PAS → on garde l'ordre du rerank (top-1 90% vs 80%).
    #   Le classifieur tourne toujours (certif + rejet) — on ne fait que ne pas s'y fier
    #   pour le CLASSEMENT (c'est un filtre binaire, pas un classeur fin).
    _ml_reorder = os.getenv("RAG_ML_REORDER", "false").strip().lower() == "true"
    best_score_before_ml = docs_with_scores[0][1]
    try:
        if _ml_reorder:
            # Ancien comportement : le ML RÉORDONNE le choix de page (mesuré moins bon).
            from ml.predict import predict_relevance
            filtered = predict_relevance(expanded_question, docs_with_scores, roles)
            if not filtered:
                yield "Je n'ai pas trouvé de documentation pertinente pour cette question."
                return
            if not (filtered[0][1] > best_score_before_ml + 0.05 and best_score_before_ml < 0.50):
                docs_with_scores = sorted(filtered, key=lambda x: x[1])
        else:
            # Reco : le classifieur ML sert de FILTRE DE BRUIT (retire les chunks franchement
            # non pertinents, proba < 0.15) + GARDE-FOU (rejet si rien n'atteint le seuil),
            # SANS réordonner → ordre du rerank conservé (rôle actif mais sûr).
            from ml.predict import drop_low_relevance
            survivors, has_relevant = drop_low_relevance(expanded_question, docs_with_scores, roles)
            if not has_relevant:
                yield "Je n'ai pas trouvé de documentation pertinente pour cette question."
                return
            if survivors:
                docs_with_scores = survivors
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

    best_page_id = best_doc.metadata.get("page_id")

    # --- CACHE : confirmation borderline par la page source ---
    # Un candidat en bande de vérif (0.80–0.90) n'est servi QUE si la recherche
    # retombe sur la même page source → évite de servir « relancer » pour « notifier »
    # (pages différentes), tout en rattrapant les vraies reformulations (même page).
    if _cache_cand is not None and best_page_id and str(best_page_id) == str(_cache_cand.get("page_id")):
        try:
            from services import qa_cache
            qa_cache.mark_served(_cache_cand["id"], _cache_cand["sim"], verified=True)
        except Exception:
            pass
        yield _cache_cand["answer"]
        return

    # Roles et vérification basés sur la page principale (pas le premier chunk ML)
    best_doc_roles = next(
        (r for doc, _, r in docs_with_scores if doc.metadata.get("page_id") == best_page_id),
        docs_with_scores[0][2]
    )

    # Normalise les rôles : "role_admin" → "admin", "role_recouv" → "recouv"
    normalized_roles = [r.replace("role_", "") for r in roles]

    def _role_match_check(nr, dr):
        return nr == dr or nr.split("_")[-1] == dr or dr.split("_")[-1] == nr

    user_has_role = (
        any(_role_match_check(r, dr) for r in normalized_roles for dr in best_doc_roles)
        or "all" in best_doc_roles
        or "admin" in normalized_roles
    )

    if not user_has_role:
        role_display = best_doc_roles[0].upper() if best_doc_roles else "autre profil"
        yield f"⚠️ Cette documentation concerne le profil **{role_display}**.\n\n"

    # --- 8. COMPLÉTION CONTEXTE — tous les chunks des pages cibles ---
    # Le ML filtering peut réduire docs_with_scores à 1 seul chunk (voire supprimer des
    # pages utiles). On recharge depuis la BDD les chunks manquants pour ne pas tronquer.
    # En mode multi-pages (RAG_PAGES), on recharge TOUTES les pages pré-rerank
    # (_preranked_pages) — sinon la page à la vraie réponse (ex. p117) reste absente.
    _pages_to_reload = list(dict.fromkeys([str(best_page_id)] + [str(p) for p in _preranked_pages]))
    try:
        existing = {doc.page_content[:100] for doc, _, _ in docs_with_scores}
        for _pid in _pages_to_reload:
            extra_rows = db_exec(
                "SELECT document, cmetadata FROM langchain_pg_embedding WHERE cmetadata ->> 'page_id' = :pid",
                {"pid": _pid}
            ).fetchall()
            for row in extra_rows:
                if row.document[:100] not in existing:
                    meta = row.cmetadata if isinstance(row.cmetadata, dict) else {}
                    docs_with_scores.append((
                        LCDocument(page_content=row.document, metadata=meta),
                        0.0,
                        meta.get("roles", "all").split(",")
                    ))
                    existing.add(row.document[:100])
    except Exception:
        pass

    # --- 7b. GARDE-FOU PERTINENCE (RAW + reformulation) ---
    # But : ne JAMAIS laisser le LLM décider en premier. Si le meilleur chunk n'atteint
    # pas un seuil de pertinence, on rejette AVANT d'appeler le LLM (pas d'envoi).
    # Score post-rerank (plus bas = plus pertinent), cohérent avec filter_off_topic.
    # RAG_MIN_RELEVANCE ∈ [0,1] (pertinence mini) ; 0 = désactivé (comportement actuel).
    try:
        _min_rel = float(os.getenv("RAG_MIN_RELEVANCE", "0"))
    except ValueError:
        _min_rel = 0.0
    if _min_rel > 0:
        _best_dist = docs_with_scores[0][1]
        _pertinence = 1.0 - _best_dist  # approximation (score post-rerank)
        if _pertinence < _min_rel:
            print(f"[rag] rejet pertinence : {_pertinence:.2f} < seuil {_min_rel} "
                  f"(dist={_best_dist:.3f})", flush=True)
            yield "Je n'ai pas trouvé d'information pertinente dans la documentation pour répondre à cette question."
            return

    # --- 8b. CONSTRUCTION CONTEXTE ---
    _raw_mode_ctx = _mode_raw

    _para_result = None
    # Mode PARAGRAPHES CIBLÉS BORNÉS (RAG_PARA_BUDGET>0) : paragraphes pertinents des
    # meilleures pages (pré-rerank), plafonnés. build_para_context priorise déjà en
    # interne les chunks RÉCUPÉRÉS (tier 0, par score de rerank) → signal + fiable que la
    # proba du classifieur ML (qui se trompe sur les questions ambiguës, ex. civilité).
    if _rag_para_budget > 0:
        if _raw_mode_ctx:
            # RAW : contexte PARAGRAPHES CIBLÉS BORNÉS (build_para_context), aligné sur la PROD.
            # La section h2/h3 (build_section_context) a été retirée du RAW : contexte trop
            # lourd → trop lent sur le serveur CPU. On garde uniquement le prompt renforcé.
            _para_result = build_para_context(
                docs_with_scores, [str(best_page_id)] + [str(p) for p in _preranked_pages],
                expanded_question, _rag_para_budget,
            )
        else:
            # REFORMULATION (modèle capable) : contexte par SECTION (h2) — la section qui
            # répond, EN ENTIER, sinon la page entière. Budget large (une section tient
            # largement dans num_ctx 16k+). Fallback build_full_context si section vide.
            _sec_budget = max(_rag_para_budget, int(os.getenv("RAG_SECTION_BUDGET", "20000")))
            _para_result = build_section_context(docs_with_scores, _sec_budget, question) \
                or build_full_context(docs_with_scores, _rag_para_budget, question)
    if _para_result is not None:
        context, chunk_images, page_metadatas = _para_result
    else:
        # Fallback / mode classique. RAW : 1 chunk ; reformulation : full/multi-pages selon flags.
        _full_page = (not _raw_mode_ctx) and os.getenv("RAG_FULL_PAGE", "false").strip().lower() == "true"
        _target_pages = _preranked_pages if (_rag_pages_n > 1 and not _raw_mode_ctx) else None
        context, chunk_images, page_metadatas = build_context(docs_with_scores, best_page_id, _full_page, _target_pages)
    best_metadata = page_metadatas[0] if page_metadatas else {}
    # Marqueurs normalisés en ![image](url)
    context_llm = re.sub(r'!\[[^\]]*\]\(([^)]+)\)', r'![image](\1)', context)
    context_llm = context_llm.replace('⏎', '\n')  # restaure les sauts de ligne des cellules tableau

    # Version PRÉ-FUSION pour le mode RAW : _merge_action_images colle plusieurs lignes
    # de texte en une seule (via les images). Combiné au retrait des lignes [TITRE], cela
    # ferait disparaître le texte fusionné sur la ligne [TITRE]. RAW numérote ligne par
    # ligne → il lui faut le texte NON fusionné.
    context_llm_raw = context_llm

    # Fusion des images bloc dans la ligne d'action qui précède (ex: "cliquez sur\n![image](url)\ntexte")
    # → "cliquez sur ![image](url) texte" : le LLM voit l'image inline et la recopie via [EXACT].
    context_llm = _merge_action_images(context_llm)

    # Contexte pour le LLM :
    # - Images INLINE (icône + texte sur la même ligne) → conservées avec [EXACT].
    # - Images BLOC restantes (captures plein écran) → supprimées, injectées en post-traitement.
    context_for_llm = _prepare_context_for_llm(context_llm)

    # --- 8c. LOG FEATURES POUR FEEDBACK ---
    log_question_features(question, best_doc, docs_with_scores[0][1], rank=1, roles=roles)

    # --- 9. MODE RAW ou GÉNÉRATION LLM ---
    _raw_mode = _mode_raw

    injected_urls: set = set()
    llm_response = ""

    if _raw_mode:
        # Mode raw : le LLM trie (numéros de lignes), Python ressort le texte verbatim.
        # Aucun texte ne passe par la génération du LLM → zéro corruption.
        raw_text = re.sub(r'^\[Source:[^\]]*\]\s*\n?', '', context_llm_raw).strip()
        raw_text = re.sub(r'^\[TITRE\][^\n]*\n?', '', raw_text, flags=re.MULTILINE).strip()
        raw_text = _clean_raw_context(raw_text)
        anchors: list = []
        context_image_urls: list = []
        raw_answer = _build_raw_answer(raw_text, question)  # question ORIGINALE (pas l'expansion synonymes)
        llm_response = raw_answer
        yield raw_answer
        llm_gen = iter([])
    else:
        anchors = _build_image_anchors(context_llm)
        context_image_urls = re.findall(r'!\[image\]\(([^)]+)\)', context_llm)
        n_inline = len([a for a in anchors if a[2]])
        n_bloc   = len([a for a in anchors if not a[2]])
        n_ctx_img = len(re.findall(r'!\[image\]', context_for_llm))
        print(
            f"\n=== CONTEXT LLM ({n_ctx_img} img dans contexte | "
            f"ancres: {n_inline} inline + {n_bloc} bloc action) ===\n"
            + context_for_llm
            + "\n=== END ===\n",
            flush=True
        )
        llm_gen = refine_answer_streaming(context_for_llm, question, context_image_urls or None)  # question ORIGINALE

    if not anchors:
        # Pas d'images inline à injecter → streaming direct
        for chunk in llm_gen:
            llm_response += chunk
            yield chunk
    else:
        # Sentence-buffering : yield phrase par phrase avec injection/fusion d'images inline.
        # Peek : si une image bloc suit immédiatement la phrase dans le buffer LLM,
        # elle est consommée et affichée inline plutôt que seule sur une ligne séparée.
        sentence_buf = ""
        for chunk in llm_gen:
            llm_response += chunk
            sentence_buf += chunk
            while True:
                # Exclut les coupures sur "1." "2." etc. (listes numérotées)
                m = re.search(r'(?<!\d)(?<=[.!?])\s', sentence_buf)
                if not m:
                    break
                sentence = sentence_buf[:m.start() + 1]
                sentence_buf = sentence_buf[m.end():]

                # Retire le tiret de liste parasite après une image (artefact LLM)
                sentence = re.sub(r'^(!\[image\]\([^)]+\))\s*[-•]\s+', r'\1 ', sentence)
                # Gère les images verbatim dans la phrase :
                # - 1ère occurrence d'une URL : marquer comme injectée, garder dans la phrase
                # - Occurrences suivantes : supprimer de la phrase (évite les doublons)
                for verbatim_url in list(re.findall(r'!\[image\]\(([^)]+)\)', sentence)):
                    if verbatim_url in injected_urls:
                        sentence = sentence.replace(f'![image]({verbatim_url})', '', 1)
                    else:
                        injected_urls.add(verbatim_url)

                # Consomme les images bloc immédiates du LLM sans les afficher inline.
                # Elles seront gérées par Documentation visuelle si non injectées par ancre.
                while True:
                    bloc_m = re.match(r'[\n\s]*!\[image\]\(([^)]+)\)[\n\s]*', sentence_buf)
                    if not bloc_m:
                        break
                    injected_urls.add(bloc_m.group(1))  # marque comme vue (évite Doc visuelle en double)
                    sentence_buf = sentence_buf[bloc_m.end():]

                # Injection depuis nos ancres (verbatim LLM ou correspondance d'ancre)
                match = _match_sentence_to_anchor(sentence, anchors, injected_urls)

                if match:
                    our_url, prepend = match
                    yield _place_image_in_sentence(sentence, our_url, prepend=prepend) + "\n"
                else:
                    yield sentence + " "

        # Flush final : nettoie les images bloc résiduelles du LLM (elles iront en Doc visuelle)
        if sentence_buf:
            for llm_url in re.findall(r'!\[image\]\(([^)]+)\)', sentence_buf):
                injected_urls.add(llm_url)
            clean_buf = re.sub(r'\n*!\[image\]\([^)]+\)\n*', '', sentence_buf).strip()
            match = _match_sentence_to_anchor(clean_buf, anchors, injected_urls)
            if match:
                our_url, prepend = match
                yield _place_image_in_sentence(clean_buf, our_url, prepend=prepend) + "\n"
            elif clean_buf:
                yield clean_buf

    # Collecte les images déjà incluses par le LLM (chemin direct sans injection)
    for llm_url in re.findall(r'!\[image\]\(([^)]+)\)', llm_response):
        injected_urls.add(llm_url)

    is_rejection = is_rejection_response(llm_response)

    # --- 11. DOCUMENTATION VISUELLE (images non injectées inline) ---
    # On ne montre que les images présentes dans le contexte texte (pas celles de métadonnées seules)
    _ctx_image_set = set(context_image_urls)
    if not is_rejection and chunk_images:
        remaining = [(ct, url) for ct, url in chunk_images if url not in injected_urls and url in _ctx_image_set]
        if remaining:
            llm_words = set(w for w in llm_response.lower().split() if len(w) > 4)
            best_url = ""
            best_score = -1
            for chunk_text, img_url in remaining:
                chunk_words = [w for w in chunk_text.lower().split() if len(w) > 4]
                score = sum(1 for w in chunk_words if w in llm_words)
                if score > best_score:
                    best_score = score
                    best_url = img_url
            if best_url:
                yield "\n\n**Documentation visuelle :**\n"
                yield f"![image]({best_url})\n"

    if not is_rejection:
        # --- Source PRINCIPALE par recouvrement avec la RÉPONSE (post-génération) ---
        # Le contexte peut venir de PLUSIEURS pages (section + paragraphes d'autres pages).
        # La vraie source = celle dont le contenu recoupe le plus la réponse générée (noms,
        # chiffres, termes). Sinon on garde la page de la section (page_metadatas[0]).
        if llm_response and page_metadatas and len(page_metadatas) > 1:
            def _sig_words(t: str) -> set:
                ws = {w for w in _para_words(t) if len(w) >= 4 and w not in _PARA_COMMON}
                ws |= set(re.findall(r'\d+', t or ""))     # les chiffres comptent (ex. « 12 caractères »)
                return ws
            _ans = _sig_words(llm_response)
            if _ans:
                _page_txt: dict = {}
                for _d, _s, *_ in docs_with_scores:
                    _pid = _d.metadata.get("page_id")
                    if _pid:
                        _page_txt[_pid] = _page_txt.get(_pid, "") + " " + _d.page_content
                _cands = [m for m in page_metadatas if m.get("page_id")]
                _scored = sorted(
                    _cands, key=lambda m: len(_ans & _sig_words(_page_txt.get(m["page_id"], ""))),
                    reverse=True,
                )
                if _scored and len(_ans & _sig_words(_page_txt.get(_scored[0]["page_id"], ""))) > 0:
                    best_metadata = _scored[0]
                    best_page_id = _scored[0].get("page_id")   # pour que les connexes l'excluent
        # Ancre précise : section du chunk principal la plus proche des mots-clés
        if best_doc.metadata.get("page_id") == best_metadata.get("page_id"):
            picked = _pick_anchor(best_doc.page_content, best_doc.metadata.get("anchors", ""), expanded_question)
            if picked:
                best_metadata = {**best_metadata, "anchor": picked}
        source_url = get_page_url(best_metadata)
        if source_url:
            source_title = (best_metadata.get("title") or "").strip() or "Voir la source documentaire"
            yield "\n\n"
            yield (
                '<div class="stevia-source" style="padding-top:8px;'
                'border-top:1px solid #e5e8ee;">'
                '<span style="display:block;font-size:11px;font-weight:600;color:#8a8f99;'
                'text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">'
                'Source principale</span>'
                f'<a href="{source_url}" target="_blank" class="source-link" '
                'style="display:flex;align-items:center;gap:8px;padding:7px 10px;'
                'margin-bottom:4px;background:#f7f8fa;border:1px solid #e5e8ee;'
                'border-radius:8px;color:#2f6fed;text-decoration:none;font-size:13px;">'
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" '
                'style="flex-shrink:0"><path d="M4 0h5.5L14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5 1.5V4a1 1 0 0 0 1 1h2.5L9 1.5zM5 7h6v1H5V7zm0 3h6v1H5v-1z"/></svg>'
                f'<span>{source_title}</span></a></div>'
            )

        # --- 12. RÉPONSES CONNEXES — autres pages bien scorées (≠ page principale) ---
        # Si plusieurs chunks ont un bon score sur des pages différentes, on propose des
        # liens vers ces sources complémentaires (max 2).
        best_score = docs_with_scores[0][1] if docs_with_scores else 1.0
        related_metas: list[dict] = []
        seen_pids = {best_page_id}
        seen_titles = {(best_metadata.get("title") or "").strip().lower()}
        for doc, score, _ in docs_with_scores:
            pid = doc.metadata.get("page_id")
            title = (doc.metadata.get("title") or "").strip().lower()
            if not pid or pid in seen_pids or score == 0.0:
                continue
            # Évite les doublons de titre (pages différentes au même nom)
            if title in seen_titles:
                seen_pids.add(pid)
                continue
            # Comparablement pertinent au meilleur chunk, et globalement bon.
            # Fenêtre élargie (0.30) car les boosts de contenu/proximité peuvent
            # creuser l'écart entre la page principale (très boostée) et une page
            # connexe légitime. Le plafond score < 0.60 reste le garde-fou absolu.
            if score <= best_score + 0.30 and score < 0.60:
                seen_pids.add(pid)
                seen_titles.add(title)
                meta = dict(doc.metadata)
                # Ancre précise : section du chunk connexe la plus proche des mots-clés
                picked = _pick_anchor(doc.page_content, meta.get("anchors", ""), expanded_question)
                if picked:
                    meta["anchor"] = picked
                # Sinon, si ce chunk n'a pas d'ancre, emprunte celle d'un autre chunk de la page
                elif not meta.get("anchor"):
                    for d2, _, _ in docs_with_scores:
                        if d2.metadata.get("page_id") == pid and d2.metadata.get("anchor"):
                            meta["anchor"] = d2.metadata["anchor"]
                            break
                related_metas.append(meta)
            if len(related_metas) == 2:
                break

        if related_metas:
            html = (
                '<div class="stevia-related" style="margin-top:10px;padding-top:8px;'
                'border-top:1px solid #e5e8ee;">'
                '<span style="display:block;font-size:11px;font-weight:600;color:#8a8f99;'
                'text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">'
                'Réponses connexes</span>'
            )
            for meta in related_metas:
                rel_url = get_page_url(meta)
                rel_title = meta.get("title", "Voir la source")
                html += (
                    f'<a href="{rel_url}" target="_blank" '
                    'style="display:flex;align-items:center;gap:8px;padding:7px 10px;'
                    'margin-bottom:4px;background:#f7f8fa;border:1px solid #e5e8ee;'
                    'border-radius:8px;color:#2f6fed;text-decoration:none;font-size:13px;">'
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" '
                    'style="flex-shrink:0"><path d="M4 0h5.5L14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5 1.5V4a1 1 0 0 0 1 1h2.5L9 1.5zM5 7h6v1H5V7zm0 3h6v1H5v-1z"/></svg>'
                    f'<span>{rel_title}</span></a>'
                )
            html += '</div>'
            yield html

    # --- 13. CACHE SÉMANTIQUE : enregistre l'entrée EN ATTENTE (validée plus tard par 👍) ---
    # Seulement pour une vraie réponse (pas un rejet). Réponse servable uniquement après 👍.
    if not is_rejection and q_emb is not None:
        try:
            from services import qa_cache
            # Livre + page source de la réponse → invalidation ciblée si ils changent.
            _src_book = best_metadata.get("book_id") or best_doc.metadata.get("book_id")
            _src_page = best_metadata.get("page_id") or best_doc.metadata.get("page_id")
            qa_cache.store_pending(question, q_emb, roles, book_id=_src_book, page_id=_src_page)
        except Exception:
            pass


def build_debug_answer(docs_with_scores: list, expanded_question: str, question: str,
                       roles: list[str], preranked_pages: list[str], mode: str | None = None):
    """Reproduit EXACTEMENT la construction de contexte + réponse de rag_answer_streaming
    (mode RAW + paragraphes ciblés bornés, tel qu'en prod) pour la page debug, mais en NON
    streaming. Renvoie (context_sent, answer, mode) où :
      - context_sent = le contexte RÉELLEMENT envoyé au moteur de réponse (RAW = context_llm_raw
        nettoyé ; reformulation = context_for_llm) ;
      - answer = la réponse produite par le même chemin que la prod ;
      - mode = "raw" ou "reformulation".
    `docs_with_scores` doit être la liste POST-rerank (mêmes chunks que le tableau debug)."""
    docs_with_scores = list(docs_with_scores)  # copie (drop_low_relevance / reload la modifient)

    # --- Filtre ML (comme prod) : reject-only par défaut, réordonne si RAG_ML_REORDER=true ---
    _ml_reorder = os.getenv("RAG_ML_REORDER", "false").strip().lower() == "true"
    best_score_before_ml = docs_with_scores[0][1]
    try:
        if _ml_reorder:
            from ml.predict import predict_relevance
            filtered = predict_relevance(expanded_question, docs_with_scores, roles)
            if not filtered:
                return None, "Je n'ai pas trouvé de documentation pertinente pour cette question.", "reject"
            if not (filtered[0][1] > best_score_before_ml + 0.05 and best_score_before_ml < 0.50):
                docs_with_scores = sorted(filtered, key=lambda x: x[1])
        else:
            from ml.predict import drop_low_relevance
            survivors, has_relevant = drop_low_relevance(expanded_question, docs_with_scores, roles)
            if not has_relevant:
                return None, "Je n'ai pas trouvé de documentation pertinente pour cette question.", "reject"
            if survivors:
                docs_with_scores = survivors
    except Exception:
        pass

    best_page_id = docs_with_scores[0][0].metadata.get("page_id")

    # --- Complétion contexte : recharge tous les chunks des pages cibles (comme prod) ---
    _pages_to_reload = list(dict.fromkeys([str(best_page_id)] + [str(p) for p in preranked_pages]))
    try:
        existing = {doc.page_content[:100] for doc, _, _ in docs_with_scores}
        for _pid in _pages_to_reload:
            extra_rows = db_exec(
                "SELECT document, cmetadata FROM langchain_pg_embedding WHERE cmetadata ->> 'page_id' = :pid",
                {"pid": _pid}
            ).fetchall()
            for row in extra_rows:
                if row.document[:100] not in existing:
                    meta = row.cmetadata if isinstance(row.cmetadata, dict) else {}
                    docs_with_scores.append((
                        LCDocument(page_content=row.document, metadata=meta),
                        0.0,
                        meta.get("roles", "all").split(",")
                    ))
                    existing.add(row.document[:100])
    except Exception:
        pass

    # --- Construction contexte (paragraphes bornés si RAG_PARA_BUDGET>0, sinon build_context) ---
    _raw_mode = (mode == "raw") if mode in ("raw", "reformulation") \
        else os.getenv("RAW_MODE", "false").strip().lower() == "true"
    try:
        _rag_para_budget = int(os.getenv("RAG_PARA_BUDGET", "0"))
    except ValueError:
        _rag_para_budget = 0

    _para_result = None
    if _rag_para_budget > 0:
        # ALIGNÉ sur rag_answer_streaming : RAW → filtrage serré ; reformulation → contexte
        # large (+ continuité de chunk + intro définitionnelle). Sinon la page debug montre
        # un contexte qui n'est PAS celui réellement envoyé au LLM en reformulation.
        if _raw_mode:
            # RAW : build_para_context (paragraphes ciblés bornés), aligné sur la PROD.
            _para_result = build_para_context(
                docs_with_scores, [str(best_page_id)] + [str(p) for p in preranked_pages],
                expanded_question, _rag_para_budget,
            )
        else:
            _sec_budget = max(_rag_para_budget, int(os.getenv("RAG_SECTION_BUDGET", "20000")))
            _para_result = build_section_context(docs_with_scores, _sec_budget, question) \
                or build_full_context(docs_with_scores, _rag_para_budget, question)
    if _para_result is not None:
        context, _chunk_images, _page_metadatas = _para_result
    else:
        _full_page = (not _raw_mode) and os.getenv("RAG_FULL_PAGE", "false").strip().lower() == "true"
        _target_pages = preranked_pages if (int(os.getenv("RAG_PAGES", "1") or 1) > 1 and not _raw_mode) else None
        context, _chunk_images, _page_metadatas = build_context(docs_with_scores, best_page_id, _full_page, _target_pages)

    context_llm = re.sub(r'!\[[^\]]*\]\(([^)]+)\)', r'![image](\1)', context)
    context_llm = context_llm.replace('⏎', '\n')
    context_llm_raw = context_llm  # pré-fusion (le RAW numérote ligne par ligne)

    if _raw_mode:
        raw_text = re.sub(r'^\[Source:[^\]]*\]\s*\n?', '', context_llm_raw).strip()
        raw_text = re.sub(r'^\[TITRE\][^\n]*\n?', '', raw_text, flags=re.MULTILINE).strip()
        raw_text = _clean_raw_context(raw_text)
        answer = _build_raw_answer(raw_text, question)  # question ORIGINALE
        return raw_text, answer, "raw"
    else:
        context_llm = _merge_action_images(context_llm)
        context_for_llm = _prepare_context_for_llm(context_llm)
        context_image_urls = re.findall(r'!\[image\]\(([^)]+)\)', context_llm)
        answer = "".join(refine_answer_streaming(context_for_llm, question, context_image_urls or None))
        return context_for_llm, answer, "reformulation"


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
    db_exec("""
        DELETE FROM langchain_pg_embedding
        WHERE cmetadata ->> 'source' = 'bookstack'
          AND cmetadata ->> 'book_id' = :bid
    """, {"bid": str(book_id)})

def _hash_page(texts: list) -> str:
    """Empreinte d'une page = hash du MULTI-ENSEMBLE de ses chunks, indépendant de
    l'ordre (les ids en base sont des UUID → ordre de stockage ≠ ordre de lecture).
    Contenu identique → même empreinte ; changement de contenu → empreinte différente."""
    import hashlib
    return hashlib.md5("\n".join(sorted(texts)).encode()).hexdigest()


def _page_content_hashes_from_index(book_id: int) -> dict:
    """Empreinte du contenu ACTUELLEMENT indexé, par page (état d'AVANT réindexation)."""
    from collections import defaultdict
    per_page = defaultdict(list)
    try:
        rows = db_exec("""
            SELECT cmetadata->>'page_id' AS page_id, document
            FROM langchain_pg_embedding
            WHERE cmetadata->>'book_id' = :bid AND cmetadata->>'page_id' IS NOT NULL
        """, {"bid": str(book_id)}).fetchall()
        for r in rows:
            if r.page_id:
                per_page[str(r.page_id)].append(r.document or "")
    except Exception:
        return {}
    return {pid: _hash_page(txts) for pid, txts in per_page.items()}


def _page_content_hashes_from_docs(docs: list) -> dict:
    """Même empreinte, calculée sur les NOUVEAUX documents (état d'APRÈS)."""
    from collections import defaultdict
    per_page = defaultdict(list)
    for d in docs:
        pid = d.metadata.get("page_id")
        if pid:
            per_page[str(pid)].append(d.page_content)
    return {pid: _hash_page(txts) for pid, txts in per_page.items()}


def index_bookstack_book(book_id: int, pages: list[dict], book_name: str = "", book_slug: str = None, book_tags: list = None) -> dict:
    # État d'AVANT (index actuel = mémoire du contenu précédent) — lu avant le delete.
    old_hashes = _page_content_hashes_from_index(book_id)

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

    # Invalidation CIBLÉE du cache Q/R : seules les pages dont le contenu a changé
    # (ajout / modif / suppression). Les réponses des pages inchangées restent.
    try:
        new_hashes = _page_content_hashes_from_docs(all_docs)
        changed = {pid for pid in (set(old_hashes) | set(new_hashes))
                   if old_hashes.get(pid) != new_hashes.get(pid)}
        if changed:
            from services import qa_cache
            qa_cache.invalidate_pages(changed)
    except Exception as e:
        rag_logger.error(f"[Index] Invalidation cache par page : {e}")

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