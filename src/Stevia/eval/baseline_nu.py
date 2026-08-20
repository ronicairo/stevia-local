"""BASELINE NU : recherche vectorielle pure (cosinus top-k) → concat chunks → LLM.
AUCUN rerank, AUCUN filtre ML, AUCUN build_para_context, AUCUN RAW. Même modèle que la
prod actuelle (OLLAMA_MODEL via refine_answer_streaming). But : mesurer si toute la
machinerie du pipeline complet apporte vraiment quelque chose vs. une recherche nue.
Lancer depuis src/Stevia/ :  python3 eval/baseline_nu.py   (serveur pas nécessaire)"""
import os, sys, unicodedata
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE)); sys.path.insert(0, _HERE)
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"))
from eval_set import EVAL
from sqlalchemy import create_engine, text
from services import rag_engine as rag

eng = create_engine(os.getenv('DATABASE_URL'))
def gold_pages(mk):
    with eng.begin() as c:
        return {r[0] for r in c.execute(text("SELECT DISTINCT cmetadata->>'page_id' FROM langchain_pg_embedding WHERE document ILIKE :m"), {'m': f'%{mk}%'}).fetchall()}

def _norm(s): return unicodedata.normalize("NFD", (s or "")).encode("ascii", "ignore").decode().lower()

BUDGET = 6000
vs = rag.get_vector_store()
r1 = r3 = rk = just = 0
n = len(EVAL)
print(f"{'top1':5}{'top3':5}{'topK':5}{'juste':6}  question")
for q, mk in EVAL:
    gold = gold_pages(mk)
    dws = vs.similarity_search_with_score(q, k=12)   # COSINUS PUR (question brute, sans expansion)
    pages = []
    for d, s in dws:
        p = d.metadata.get('page_id')
        if p and p not in pages: pages.append(p)
    h1 = bool(pages[:1] and pages[0] in gold)
    h3 = bool(set(pages[:3]) & gold)
    hk = bool(set(pages) & gold)
    # contexte NU : on colle les meilleurs chunks jusqu'au budget, sans filtrage
    ctx = ""
    for d, s in dws:
        if len(ctx) + len(d.page_content) > BUDGET: break
        ctx += d.page_content + "\n\n"
    try:
        ans = "".join(rag.refine_answer_streaming(ctx, q))
    except Exception as e:
        ans = f"[err {e}]"
    good = _norm(mk) in _norm(ans)
    r1 += h1; r3 += h3; rk += hk; just += good
    print(f"  {'✓' if h1 else '·'}   {'✓' if h3 else '·'}   {'✓' if hk else '·'}   {'✓' if good else '✗'}    {q[:48]}")
print(f"\n=== BASELINE NU (cosinus pur + LLM, zéro machinerie) ===")
print(f"RECALL@1 : {r1}/{n} = {100*r1//n}%")
print(f"RECALL@3 : {r3}/{n} = {100*r3//n}%")
print(f"RECALL@K : {rk}/{n} = {100*rk//n}%")
print(f"RÉPONSE JUSTE : {just}/{n} = {100*just//n}%")
