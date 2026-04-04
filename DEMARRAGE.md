# Guide de démarrage — Stevia Local

Répertoire de travail principal : `stevia-local/`

---

## Prérequis

- Podman + podman-compose installés
- PHP 8.2+, Composer
- Symfony CLI (`symfony serve`)
- Node.js + npm (optionnel, pour webpack)

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

Mettre à jour les tokens dans `.env` et redémarrer le conteneur :

**Depuis : `stevia-local/`**

```bash
./update-tokens.sh <TOKEN_ID> <TOKEN_SECRET>
```

---

## 4. Télécharger le modèle LLM (première fois uniquement)

**Depuis : n'importe où**

```bash
podman exec ollama ollama pull gemma3:1b
```

Vérifier que le modèle est disponible :

```bash
podman exec ollama ollama list
```

---

## 5. Installer les dépendances Python ML (si nécessaire)

Si scikit-learn n'est pas installé dans le conteneur :

**Depuis : n'importe où**

```bash
podman exec stevia-container pip install scikit-learn pandas joblib
```

> Note : Ces paquets sont déjà dans `sucre-source/Stevia/requirements.txt` depuis la dernière mise à jour. Un rebuild de l'image les inclura automatiquement.

---

## 6. Démarrer Symfony

**Depuis : `stevia-local/`**

```bash
composer install
symfony serve --port=8000
```

Accéder à l'application : **http://localhost:8000**

---

## 7. Pipeline ML — Entraîner le classifieur de pertinence

A effectuer dans l'ordre, **depuis n'importe où** (les commandes s'exécutent dans le conteneur) :

### Étape 1 — Générer le dataset

```bash
podman exec stevia-container python /app/ml/generate_dataset.py
```

Génère `stevia-api/ml/dataset/stevia_relevance_dataset.csv`
Durée : 2-10 minutes selon le nombre de pages indexées.

### Étape 2 — Entraîner les modèles

```bash
podman exec stevia-container python /app/ml/train_model.py
```

Compare RandomForest, KNN, DecisionTree, LogisticRegression.
Sauvegarde le meilleur dans `stevia-api/ml/dataset/best_model.pkl`.

### Étape 3 — Optimiser les hyperparamètres (optionnel)

```bash
podman exec stevia-container python /app/ml/optimize_model.py --model random_forest
```

Options `--model` : `random_forest`, `decision_tree`, `knn`, `logistic`

### Étape 4 — Évaluation finale

```bash
podman exec stevia-container python /app/ml/evaluate_model.py
```

Affiche : rapport de classification, matrice de confusion, AUC-ROC, importance des features.

> Une fois `best_model.pkl` présent, le pipeline RAG l'utilise automatiquement à la prochaine requête.

---

## 8. Indexer les livres BookStack

Via l'interface web : **http://localhost:8000/stevia/indexation**

Ou via curl :

```bash
curl -X POST http://localhost:8000/stevia/index/book/<BOOK_ID>
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

# Redémarrer uniquement Stevia (après modif rag_engine.py)
podman restart stevia-container

# Reconstruire l'image Stevia (après modif requirements.txt ou Dockerfile)
podman-compose build --no-cache stevia-api && podman-compose up -d stevia-api

# Accéder à psql
podman exec -it postgres-stevia psql -U stevia -d stevia

# Vérifier les chunks indexés
podman exec -it postgres-stevia psql -U stevia -d stevia \
  -c "SELECT cmetadata->>'book_name', COUNT(*) FROM langchain_pg_embedding GROUP BY 1;"

# Arrêter toute la stack
podman-compose down
```
