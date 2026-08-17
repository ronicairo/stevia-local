# Stevia — Modes de réponse & bascules

Ce document récapitule **les 3 modes** de Stevia et **comment basculer** de l'un à l'autre, en **local** et en **prod**.

---

## 1. Les 3 modes

| Mode | Ce qu'il fait | Backend | Port | Conteneur (prod) |
|---|---|---|---|---|
| **RAG — RAW** | Recherche → **1 chunk** → le LLM **recopie verbatim** les lignes pertinentes (zéro reformulation) | `main.py` | **8001** | `stevia-container` |
| **RAG — Reformulation** | Recherche → **1 chunk** → le LLM **reformule** une réponse | `main.py` | **8001** | `stevia-container` |
| **LLM direct** (RAG page-level) | Recherche → **pages entières** (top-N) → le LLM **synthétise** | `main_llm.py` | **8002** | `stevia-llm` |

> Les 3 partagent la **même recherche** (vectoriel + mots-clés + rerank + Decision Tree + intention) et la **même base** indexée. La différence est **en aval** (granularité + rôle du LLM).

**Dossiers :** `src/Stevia/` (local) · `STEVIA-PROD/` (prod RAG) · `STEVIA-PROD-LLM/` (prod LLM direct).

---

## 2. Deux bascules indépendantes

Il y a **deux leviers distincts** :

### Levier A — RAW ↔ Reformulation (à l'intérieur du RAG)
Variable **`RAW_MODE`** dans le `.env` du **backend Stevia** :
- `RAW_MODE=true`  → **RAW** (verbatim)
- `RAW_MODE=false` → **Reformulation**

Fichier : `src/Stevia/.env` (local) · `STEVIA-PROD/.env` (prod).
⚠️ Le `.env` est lu **au démarrage** → il faut **redémarrer le backend** (local) ou **`update_stevia.sh`** (prod) pour l'appliquer.

### Levier B — RAG ↔ LLM direct (quel backend le chatbot appelle)
Variable **`STEVIA_API_URL`** dans le `.env` **RACINE (Symfony)** :
- `http://localhost:8001` → chatbot = **RAG** (RAW ou reformulation selon levier A)
- `http://localhost:8002` → chatbot = **LLM direct**

⚠️ Après modif → **`php bin/console cache:clear`** (Symfony met l'URL en cache).

**Résumé :** le levier A choisit *comment* le RAG répond ; le levier B choisit *quel backend* (RAG ou LLM direct) le chat interroge.

---

## 3. En LOCAL

### Démarrer les backends
```bash
cd src/Stevia
# RAG (RAW/reformulation selon RAW_MODE du .env) :
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
# LLM direct (dans un autre terminal) :
uvicorn main_llm:app --host 0.0.0.0 --port 8002 --reload
```

### Choisir le mode vu par le chatbot
1. Éditer `.env` **racine** → `STEVIA_API_URL=http://localhost:8001` (RAG) **ou** `:8002` (LLM direct).
2. `php bin/console cache:clear`
3. Recharger la page du chatbot.

### Basculer RAW ↔ Reformulation (RAG uniquement)
1. `src/Stevia/.env` → `RAW_MODE=true` ou `false`.
2. **Redémarrer** `uvicorn main:app` (Ctrl+C puis relancer) — un simple `--reload` sur un `.py` suffit aussi à recharger le `.env`.

### Tester en console (sans le chat)
```bash
# RAG :        port 8001    |    LLM direct : port 8002
curl -sN -X POST http://localhost:8002/ask/stream \
  -H "Content-Type: application/json" \
  -d '{"question":"à quoi servent les échéances de suivi","roles":["admin"]}' \
  | python3 -c "import sys,json; print(''.join(json.loads(l)['content'] for l in sys.stdin if l.strip()))"
```

---

## 4. En PROD

### RAG (STEVIA-PROD, port 8001)
```bash
cd STEVIA-PROD
# RAW ↔ reformulation : éditer RAW_MODE dans .env, puis :
./scripts/update_stevia.sh      # rebuild + restart (applique le .env)
```

### LLM direct (STEVIA-PROD-LLM, port 8002)
```bash
cd STEVIA-PROD-LLM
./deploy_llm.sh                 # build image stevia-llm-python + conteneur stevia-llm:8002
```
(Prérequis : doc indexée via le RAG — `curl -X POST http://127.0.0.1:8001/index/bookstack/all`.)

### Choisir le mode vu par le chatbot (prod)
`STEVIA_API_URL` du `.env` **Symfony prod** → `:8001` (RAG) ou `:8002` (LLM direct), puis `php bin/console cache:clear`.

> Les deux conteneurs (`stevia-container` 8001 et `stevia-llm` 8002) peuvent tourner **en même temps** ; c'est `STEVIA_API_URL` qui décide lequel le chat utilise.

---

## 5. Points d'attention

- **Feedback (pouce)** : `main_llm` (LLM direct) n'a **pas** de route `/feedback` ni `/log/error`. En mode LLM direct, la réponse marche mais le **bouton pouce renvoie 404**. (Le RAG a `/feedback`.)
- **Un seul mode à la fois dans le chat** : la bascule via `STEVIA_API_URL` route **tout** le chat vers un backend. Pour choisir RAG **ou** LLM direct **depuis l'interface** (comparaison côte à côte), il faut ajouter un **toggle** (param widget + `SteviaController`) — non fait à ce jour.
- **Réglages LLM direct** (`.env` du backend LLM) : `LLM_DIRECT_MODEL` (gemma3:4b), `LLM_DIRECT_PAGES` (3), `LLM_DIRECT_NUM_CTX` (32768), `LLM_DIRECT_MAX_DIST` (0.55, seuil hors-sujet).
- **Modèles Ollama** : RAG = `OLLAMA_MODEL` (reformulation) / `RAW_OLLAMA_MODEL` (RAW) ; LLM direct = `LLM_DIRECT_MODEL`.

---

## 6. Aide-mémoire (quel réglage pour quel effet)

| Je veux… | Je change… | Où | Après |
|---|---|---|---|
| RAG verbatim | `RAW_MODE=true` | `.env` backend RAG | restart / `update_stevia.sh` |
| RAG reformulé | `RAW_MODE=false` | `.env` backend RAG | restart / `update_stevia.sh` |
| Chat sur RAG | `STEVIA_API_URL=…:8001` | `.env` racine Symfony | `cache:clear` |
| Chat sur LLM direct | `STEVIA_API_URL=…:8002` | `.env` racine Symfony | `cache:clear` |
| + de pages au LLM direct | `LLM_DIRECT_PAGES=…` | `.env` backend LLM | restart / `deploy_llm.sh` |
