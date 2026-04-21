# Stevia — Version locale (démo jury)

Chatbot documentaire intégré à **SUCRE**.
Stevia permet aux agents de consulter la documentation interne via une interface conversationnelle basée sur un pipeline RAG (*Retrieval-Augmented Generation*).

> Version locale macOS pour démonstration. Pour la version production CPAM, voir `STEVIA-PROD/`.

---

## Architecture

```
SUCRE (Symfony)
    └── SteviaController.php
            │  HTTP POST /ask/stream
            ▼
        FastAPI (uvicorn :8001)
            │
            ├── RAG Engine
            │     ├── Recherche vectorielle  →  PostgreSQL + pgvector
            │     └── Recherche mots-clés    →  SQL ILIKE + NLTK
            │
            ├── ML — classifieur de pertinence (Decision Tree)
            │     ├── Feedback utilisateur   →  stevia_ml_feedback (BDD)
            │     └── Réentraînement         →  interface admin /stevia/ml
            │
            ├── Ollama natif macOS (GPU Metal)
            └── BookStack  →  source documentaire
```

---

## Structure

```
src/Stevia/
├── main.py                      ← API FastAPI
├── Dockerfile
├── requirements.txt
├── compose.yaml                 ← PostgreSQL + BookStack
├── .env                         ← à créer depuis .env.example (non versionné)
├── services/
│   ├── rag_engine.py            ← pipeline RAG
│   ├── mistral_utils.py         ← intégration Ollama
│   ├── bookstack_reader.py      ← parsing HTML → chunks
│   └── synonymes.py             ← expansion abréviations SUCRE
├── ml/
│   ├── extract_features.py      ← features ML
│   ├── predict.py               ← inférence classifieur
│   └── retrain_from_feedback.py ← réentraînement
├── start_stevia.sh              ← démarrage complet
├── reload_stevia.sh             ← rechargement sans rebuild
├── update_stevia.sh             ← mise à jour + rebuild
└── cleanup_and_reconfigure.sh   ← nettoyage complet Podman
```

---

## Prérequis

- macOS avec **Ollama natif** installé (GPU Metal)
- **Docker** (PostgreSQL + BookStack via compose.yaml)
- Python 3.12+

---

## Installation

### 1. Configurer l'environnement

```bash
cp .env.example .env
```

Renseigner les valeurs dans `.env` — tokens BookStack : Profil → API Tokens → Create Token

### 2. Démarrer la stack

```bash
chmod +x *.sh
./start_stevia.sh
```

Démarre automatiquement :
- PostgreSQL + pgvector (`:5432`)
- Ollama + modèle LLM (`:11434`)
- FastAPI / Stevia (`:8001`)

---

## Scripts

| Script | Description |
|---|---|
| `./start_stevia.sh` | Démarrage complet (rebuild inclus) |
| `./reload_stevia.sh` | Rechargement sans rebuild |
| `./update_stevia.sh` | Mise à jour + rebuild |
| `./cleanup_and_reconfigure.sh` | Nettoyage complet des conteneurs Podman |

```bash
# Logs en direct
podman logs -f stevia-container

# Statut des conteneurs
podman ps --format "table {{.Names}}\t{{.Status}}"

# Tester l'API
curl http://127.0.0.1:8001/health
```

---

## Configuration `.env`

| Variable | Description |
|---|---|
| `BOOKSTACK_URL` | URL BookStack local (ex: `http://localhost:8080`) |
| `BOOKSTACK_TOKEN_ID` | Token API BookStack |
| `BOOKSTACK_TOKEN_SECRET` | Secret du token API |
| `OLLAMA_HOST` | `host.containers.internal` (Ollama natif macOS) |
| `OLLAMA_MODEL` | Modèle LLM (ex: `gemma3:4b`) |
| `POSTGRES_USER` | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL |
| `POSTGRES_DB` | Nom de la base |

---

## Entraînement ML

L'entraînement complet du classifieur de pertinence est disponible via l'interface admin Symfony : `/stevia/ml`

- Génération du dataset depuis les feedbacks utilisateurs
- Entraînement du modèle Decision Tree
- Évaluation (accuracy, F1)
- Reset du modèle

---

## Fichiers à ne pas versionner

```
.env
```
