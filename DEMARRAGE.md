# Guide de démarrage — Stevia Local

Répertoire de travail principal : `stevia-local/`

---

## 1. Démarrer les conteneurs

**Depuis : `stevia-local/`**

```bash
podman-compose up -d
```

Vérifie que tout est up :

```bash
podman ps
```

Conteneurs attendus : `postgres-stevia`, `ollama`, `bookstack-db`, `bookstack`, `stevia-container`

---

## 2. Initialisation pgvector (première fois uniquement)

**Depuis : `stevia-local/`**

```bash
podman exec -i postgres-stevia psql -U stevia -d stevia << 'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS langchain_pg_collection (
    name      VARCHAR PRIMARY KEY,
    cmetadata JSON,
    uuid      UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS langchain_pg_embedding (
    id            UUID PRIMARY KEY,
    collection_id UUID REFERENCES langchain_pg_collection(name) ON DELETE CASCADE,
    embedding     VECTOR(384),
    document      TEXT,
    cmetadata     JSONB
);

INSERT INTO langchain_pg_collection (name, cmetadata, uuid)
VALUES ('global', '{}', gen_random_uuid())
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_embedding_hnsw
    ON langchain_pg_embedding USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_embedding_meta
    ON langchain_pg_embedding USING gin (cmetadata);
SQL
```

---

## 3. Obtenir un token BookStack

1. Ouvrir **http://localhost:8080**
2. Se connecter : `admin@admin.com` / `password`
3. Aller dans **Profil → API Tokens → Create Token**
4. Copier le `Token ID` et le `Token Secret`

Mettre à jour `src/Stevia/.env` :

```
BOOKSTACK_TOKEN_ID=<TOKEN_ID>
BOOKSTACK_TOKEN_SECRET=<TOKEN_SECRET>
```

Puis recréer le container pour qu'il lise le nouveau `.env` :

```bash
podman-compose up -d --force-recreate stevia-api
```

---

## 4. Télécharger le modèle LLM (première fois uniquement)

```bash
podman exec ollama ollama pull gemma3:1b
```

Vérifier que le modèle est disponible :

```bash
podman exec ollama ollama list
```

---

## 5. Démarrer Symfony

**Depuis : `stevia-local/`**

```bash
composer install
symfony serve --port=8000
```

Accéder à l'application : **http://localhost:8000**

---

## 6. Indexer les livres BookStack

Via l'interface web : **http://localhost:8000/stevia/indexation**

---

## 7. Mettre à jour le code Python (rag_engine, mistral_utils, bookstack_reader…)

**Depuis : `stevia-local/src/Stevia/`**

```bash
./update_stevia.sh
```

Copie les fichiers Python dans le container et redémarre l'API (~10s).

> Si tu as modifié `requirements.txt` ou le `Dockerfile`, utilise le rebuild complet :
> ```bash
> ./update_stevia.sh --rebuild
> ```

---

## 8. Changer le modèle Ollama

Modifier `src/Stevia/.env` :

```
OLLAMA_MODEL=gemma3:1b
```

Puis **recréer** le container (un simple restart ne relit pas le `.env`) :

```bash
podman-compose up -d --force-recreate stevia-api
```

> `podman restart stevia-container` conserve les anciennes variables — toujours utiliser `--force-recreate` pour changer le modèle.

---

## 9. Planning Ollama (lun–ven, 7h30–18h30)

Les cron jobs sont déjà installés. Ollama démarre automatiquement à 7h30 et s'arrête à 18h30.

Pour gérer manuellement :

```bash
# Démarrer Ollama + précharger le modèle
./ollama_start.sh

# Arrêter Ollama + décharger le modèle
./ollama_stop.sh

# Décharger le modèle sans stopper Ollama (libère ~6 GB de RAM)
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"gemma3:1b","keep_alive":0}' > /dev/null
```

Logs des cron jobs : `/tmp/ollama_cron.log`

---

## 10. Pipeline ML — Entraîner le classifieur de pertinence

A effectuer dans l'ordre, **depuis n'importe où** :

```bash
# Générer le dataset
podman exec stevia-container python /app/ml/generate_dataset.py

# Entraîner les modèles
podman exec stevia-container python /app/ml/train_model.py

# Optimiser les hyperparamètres (optionnel)
podman exec stevia-container python /app/ml/optimize_model.py --model random_forest

# Évaluation finale
podman exec stevia-container python /app/ml/evaluate_model.py
```

---

## Résumé des ports

| Service | URL |
|---------|-----|
| Application Symfony | http://localhost:8000 |
| API Stevia (FastAPI) | http://localhost:8001 |
| BookStack | http://localhost:8080 |
| Ollama | http://localhost:11434 |
| PostgreSQL | localhost:5432 |

---

## Commandes utiles

```bash
# Logs du conteneur Stevia
podman logs -f stevia-container

# Accéder à psql
podman exec -it postgres-stevia psql -U stevia -d stevia

# Vérifier les chunks indexés
podman exec -it postgres-stevia psql -U stevia -d stevia \
  -c "SELECT cmetadata->>'book_name', COUNT(*) FROM langchain_pg_embedding GROUP BY 1;"

# RAM utilisée par container
podman stats --no-stream

# Arrêter toute la stack
podman-compose down
```
