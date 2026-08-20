# Stevia — Modes de réponse & bascule

Ce document récapitule **les 2 modes** du RAG Stevia et **comment basculer** de l'un à l'autre, en **local** et en **prod**.

---

## 1. Les 2 modes

| Mode | Ce qu'il fait | Backend | Port | Conteneur (prod) |
|---|---|---|---|---|
| **RAW** | Recherche → **paragraphes ciblés** (`build_para_context`, filtrage serré) → le LLM **recopie verbatim** les lignes pertinentes (zéro reformulation) | `main.py` | **8001** | `stevia-container` |
| **Reformulation** | Recherche → **section (h2) entière** (`build_section_context`, sinon page entière) → le LLM **reformule** une réponse | `main.py` | **8001** | `stevia-container` |

> Les 2 partagent la **même recherche** (vectoriel + mots-clés + rerank + Decision Tree + intention) et la **même base** indexée. La différence est **en aval** (contexte + rôle du LLM) :
> - **RAW** = petit modèle (`qwen2.5:3b`), contexte serré (il se noie sinon), **verbatim = zéro invention** → choix **prod** (CPU).
> - **Reformulation** = modèle capable (`qwen2.5:7b`), contexte large (section entière), **synthèse** → concis mais peut inventer si le contexte est incomplet → **exige une recherche fiable**.

**Dossiers :** `src/Stevia/` (local) · `STEVIA-PROD/` (prod).

---

## 2. La bascule : `RAW_MODE`

Une seule variable dans le `.env` du **backend Stevia** :
- `RAW_MODE=true`  → **RAW** (verbatim)
- `RAW_MODE=false` → **Reformulation**

Fichier : `src/Stevia/.env` (local) · `STEVIA-PROD/.env` (prod).
⚠️ Le `.env` est lu **au démarrage** → il faut **redémarrer le backend** (local) ou **`update_stevia.sh`** (prod) pour l'appliquer.

> Le chatbot Symfony pointe toujours sur le RAG via `STEVIA_API_URL=http://localhost:8001` (`.env` racine). Après modif de cette URL → `php bin/console cache:clear`.

---

## 3. En LOCAL

### Démarrer le backend
```bash
cd src/Stevia
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
# (ou : bash scripts/start_stevia.sh — lance aussi postgres/bookstack/ollama)
```

### Basculer RAW ↔ Reformulation
1. `src/Stevia/.env` → `RAW_MODE=true` ou `false`.
2. **Redémarrer** le backend (le `.env` est lu au démarrage ; `--reload` sur un `.py` recharge aussi le `.env`).

### Tester en console (sans le chat)
```bash
curl -sN -X POST http://localhost:8001/ask/stream \
  -H "Content-Type: application/json" \
  -d '{"question":"à quoi servent les échéances de suivi","roles":["admin"]}' \
  | python3 -c "import sys,json; print(''.join(json.loads(l)['content'] for l in sys.stdin if l.strip()))"
```

---

## 4. En PROD (STEVIA-PROD, port 8001)

```bash
cd STEVIA-PROD
# RAW ↔ reformulation : éditer RAW_MODE dans .env, puis :
./scripts/update_stevia.sh      # rebuild + restart (applique le .env)
# (changement structurel — nouveau fichier/Dockerfile — → ./scripts/deploy_stevia.sh, --no-cache)
```

> Prod actuelle = **RAW** (verbatim, sûr sur CPU). La reformulation reste un mode **local/expérimental** (nécessite un modèle capable + une recherche fiable ; cf. `CLAUDE.md`).

---

## 5. Réglages du contexte (reformulation)

`.env` du backend :

| Variable | Défaut | Effet |
|---|---|---|
| `RAG_PARA_BUDGET` | 6000 | budget contexte du mode **RAW** (car.) |
| `RAG_SECTION_BUDGET` | 20000 | plafond d'une **section** (reformulation) |
| `RAG_NUM_CTX` | 16384 | fenêtre de contexte du LLM (reformulation) |

- **Reformulation** = `build_section_context` : la **section h2** qui contient la réponse, **en entier** (sinon la page entière si aucun `##`). But : contexte **complet et focalisé** (comme donner le PDF/la page), qui règle « c'est quoi X » et les listes coupées.
- **RAW** = `build_para_context` (filtrage serré) — inchangé, le petit modèle se noie dans un gros contexte.
- **Modèles Ollama** : `OLLAMA_MODEL` (reformulation, ex. `qwen2.5:7b`) · `RAW_OLLAMA_MODEL` (RAW, ex. `qwen2.5:3b`).

---

## 6. Aide-mémoire

| Je veux… | Je change… | Où | Après |
|---|---|---|---|
| RAG verbatim | `RAW_MODE=true` | `.env` backend | restart / `update_stevia.sh` |
| RAG reformulé | `RAW_MODE=false` | `.env` backend | restart / `update_stevia.sh` |
| + de contexte (reformulation) | `RAG_SECTION_BUDGET` / `RAG_NUM_CTX` | `.env` backend | restart |
| Changer le modèle de génération | `OLLAMA_MODEL` (reformulation) / `RAW_OLLAMA_MODEL` (RAW) | `.env` backend | restart |
