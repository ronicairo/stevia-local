"""Harnais d'ÉVALUATION de la recherche RAG (recall@k). Mesure objective, réutilisable.
Lancer depuis src/Stevia/ :  python3 eval/run_eval.py
Sépare 2 signaux : rerank (recall@1/3/K) vs choix final de page après filtre ML.
Étend le jeu de test dans eval/eval_set.py (question, marqueur de réponse)."""
import os, sys
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))   # src/Stevia (pour services/, ml/)
sys.path.insert(0, _HERE)                     # eval/ (pour eval_set)
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"))
from eval_set import EVAL
from sqlalchemy import create_engine, text
from services import rag_engine as rag
from ml.predict import predict_relevance

eng=create_engine(os.getenv('DATABASE_URL'))
def gold_pages(mk):
    with eng.begin() as c:
        return {r[0] for r in c.execute(text("SELECT DISTINCT cmetadata->>'page_id' FROM langchain_pg_embedding WHERE document ILIKE :m"),{'m':f'%{mk}%'}).fetchall()}

def retrieved_pages(q):
    e=rag.expand_question(q); kw=rag.extract_search_keywords(e)
    dws=rag.get_vector_store().similarity_search_with_score(e,k=12)
    dws=rag.merge_keyword_docs(dws, rag.search_by_keywords(kw,dws)); dws=rag.dedupe_by_content(dws)
    ranked=rag.rerank_documents(dws,e,['admin'])
    # pages dans l'ordre du rerank (avant filtre ML)
    pages_rerank=[]
    for d,s,r in ranked:
        p=d.metadata.get('page_id')
        if p and p not in pages_rerank: pages_rerank.append(p)
    # pages après filtre ML (ce qui décide best_page_id)
    try:
        filt=predict_relevance(e,ranked,['admin'])
        pages_ml=[]
        for d,s,r in filt:
            p=d.metadata.get('page_id')
            if p and p not in pages_ml: pages_ml.append(p)
    except Exception:
        pages_ml=pages_rerank
    return pages_rerank, pages_ml

r1=r3=rk=ml1=0; n=len(EVAL)
print(f"{'top1':5}{'top3':5}{'topK':5}{'ML1':4}  question")
for q,mk in EVAL:
    gold=gold_pages(mk)
    pr,pml=retrieved_pages(q)
    h1='✓' if pr[:1] and pr[0] in gold else '·'
    h3='✓' if set(pr[:3]) & gold else '·'
    hk='✓' if set(pr) & gold else '·'
    m1='✓' if pml[:1] and pml[0] in gold else '·'
    r1+= h1=='✓'; r3+= h3=='✓'; rk+= hk=='✓'; ml1+= m1=='✓'
    print(f"  {h1}   {h3}   {hk}   {m1}   {q[:50]}  (gold={sorted(gold)} rerank1={pr[0] if pr else '-'} ml1={pml[0] if pml else '-'})")
print(f"\nRECALL@1 (rerank) : {r1}/{n} = {100*r1//n}%")
print(f"RECALL@3 (rerank) : {r3}/{n} = {100*r3//n}%")
print(f"RECALL@K (rerank) : {rk}/{n} = {100*rk//n}%")
print(f"TOP1 après filtre ML (= best_page_id) : {ml1}/{n} = {100*ml1//n}%")

# --- JUSTESSE DE RÉPONSE (nécessite le serveur RAG lancé sur :8001) ---
# En mode RAW verbatim, une réponse CORRECTE contient le marqueur. On interroge le vrai
# pipeline et on vérifie la présence du marqueur (accent/casse-insensible).
import json as _json, unicodedata, urllib.request
def _norm(s): return unicodedata.normalize("NFD", (s or "")).encode("ascii","ignore").decode().lower()
def _ask(q):
    data=_json.dumps({"question":q,"roles":["admin"]}).encode()
    req=urllib.request.Request("http://localhost:8001/ask/stream", data=data,
                               headers={"Content-Type":"application/json"})
    out=""
    with urllib.request.urlopen(req, timeout=120) as r:
        for line in r:
            line=line.decode().strip()
            if line:
                try: out+=_json.loads(line).get("content","")
                except Exception: pass
    return out
try:
    urllib.request.urlopen("http://localhost:8001/health", timeout=3)
    print("\n=== JUSTESSE DE RÉPONSE (serveur :8001) ===")
    ok=0
    for q,mk in EVAL:
        try:
            ans=_ask(q)
            good = _norm(mk) in _norm(ans)
        except Exception as e:
            good=False; ans=f"[err {e}]"
        ok+= good
        print(f"  {'✓' if good else '✗'}  {q[:55]}")
    print(f"\nRÉPONSE JUSTE : {ok}/{n} = {100*ok//n}%")
except Exception:
    print("\n(justesse de réponse ignorée : serveur :8001 non joignable)")
