# 🍃 Stevia

Chatbot documentaire intégré à **SUCRE** (application interne CPAM Hauts-de-Seine).  
Stevia permet aux agents de consulter la documentation interne via une interface conversationnelle basée sur un pipeline RAG (*Retrieval-Augmented Generation*).

---

## 📁 Emplacement dans le projet

```
SUCRE/
└── src/
    └── Stevia/
        ├── services/
        │   ├── bookstack_reader.py   # Récupération des pages BookStack
        │   ├── mistral_utils.py      # Appels LLM via Ollama
        │   ├── rag_engine.py         # Pipeline RAG (recherche vectorielle + mots-clés)
        │   └── synonymes.py          # Gestion des synonymes métier
        ├── main.py                   # API FastAPI (point d'entrée)
        ├── Dockerfile
        ├── requirements.txt
        ├── .env                      # Variables d'environnement (non versionné)
        ├── .env.example              # Template de configuration
        ├── start_stevia.sh           # Démarrage complet de la stack
        ├── reload_stevia.sh          # Rechargement sans rebuild
        ├── update_stevia.sh          # Mise à jour (pull modèle, rebuild)
        └── cleanup_and_reconfigure.sh
```

---

## 🏗️ Architecture

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
            ├── Ollama  →  LLM local (qwen3.5:0.8b)
            └── BookStack API  →  Source documentaire
```

---

## ⚙️ Prérequis

- **Podman** (rootless, configuré avec `GraphRoot=/app/stevia_work/containers`)
- **Linux** — déployé sur `l11920173dev`
- Accès réseau à **BookStack** (`l11920175dev.cpam-hauts-de-seine.ramage:8080`)
- Proxy réseau : `127.0.0.1:3128`
- Espace disque disponible : **minimum 3 GB** sur `/app`

---

## 🚀 Installation

### 1. Cloner et se placer dans le répertoire

```bash
cd SUCRE/src/Stevia
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
```

Renseigner les valeurs dans `.env` — notamment les tokens BookStack :  
**BookStack** → Profil → API Tokens → Create Token

### 3. Démarrer la stack

```bash
chmod +x start_stevia.sh
./start_stevia.sh
```

Le script démarre automatiquement :
- PostgreSQL + pgvector (`:5432`)
- Ollama + modèle LLM (`:11434`)
- FastAPI / Stevia (`:8001`)

---

## 🔄 Commandes utiles

| Script | Description |
|--------|-------------|
| `./start_stevia.sh` | Démarrage complet (rebuild inclus) |
| `./reload_stevia.sh` | Redémarrage sans rebuild |
| `./update_stevia.sh` | Mise à jour (modèle + rebuild) |
| `./cleanup_and_reconfigure.sh` | Nettoyage complet des conteneurs et volumes |

```bash
# Logs en direct
podman logs -f stevia-container

# Statut des conteneurs
podman ps --format "table {{.Names}}\t{{.Status}}"

# Tester l'API
curl http://127.0.0.1:8001/health
```

---

## 🔧 Configuration `.env`

| Variable | Description |
|----------|-------------|
| `BOOKSTACK_URL` | URL de l'instance BookStack |
| `BOOKSTACK_TOKEN_ID` | ID du token API BookStack |
| `BOOKSTACK_TOKEN_SECRET` | Secret du token API BookStack |
| `OLLAMA_HOST` | Adresse du serveur Ollama |
| `OLLAMA_MODEL` | Modèle LLM à utiliser |
| `POSTGRES_USER` | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL |
| `POSTGRES_DB` | Nom de la base PostgreSQL |
| `PROXY_URL` | URL du proxy réseau |
| `NO_PROXY_LIST` | Hôtes exclus du proxy |
| `TMPDIR` | Répertoire temporaire Podman |

---

## 📡 API

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/health` | GET | Vérification de l'état de l'API |
| `/ask/stream` | POST | Question en streaming (SSE) |
| `/index` | POST | Indexation de la documentation BookStack |

---

## 🧠 Modèles LLM disponibles

| Modèle | Taille | Notes |
|--------|--------|-------|
| `qwen3.5:0.8b` | ~1 GB | Modèle par défaut |
| `qwen2.5:1.5b` | ~986 MB | Bon équilibre vitesse/qualité |
| `qwen2.5:0.5b` | ~397 MB | Plus rapide, qualité réduite |

---

## 📝 Notes

- Les modèles Ollama sont stockés dans le volume `ollama_data` — ils persistent entre les redémarrages.
- La base vectorielle est dans le volume `stevia_pgdata`.
- Les logs de feedback utilisateur sont écrits dans les logs Symfony via le canal `stevia` (Monolog).
