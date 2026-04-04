# Projet Stevia — Contexte complet

## Résumé

**Stevia** est un chatbot documentaire RAG intégré dans **SUCRE**, une application Symfony interne de la **CPAM Hauts-de-Seine** dédiée au recouvrement de créances. Stevia permet aux agents de consulter la documentation interne via une interface conversationnelle. Le projet fait l'objet d'une **thèse professionnelle** pour un Mastère "Chef de projet Data et Intelligence Artificielle" (RNCP 37137).

Ce dépôt contient une **version locale de démonstration** destinée à la soutenance, reproduisant fidèlement l'interface SUCRE avec le chatbot Stevia intégré.

---

## Architecture de production

```
SUCRE (Symfony)
    └── SteviaController.php
            │  HTTP POST /stevia/ask/stream
            ▼
        FastAPI (uvicorn :8001)
            │
            ├── RAG Engine (rag_engine.py)
            │     ├── Recherche vectorielle → PostgreSQL + pgvector (cosinus)
            │     ├── Recherche lexicale    → SQL ILIKE + NLTK stopwords FR
            │     └── Reranking composite   → role_boost, text_boost, content_boost
            │
            ├── Ollama → LLM local (gemma3:1b)
            ├── FastEmbedEmbeddings → BAAI/bge-small-en-v1.5 (384 dim)
            └── BookStack API → Source documentaire unique
```

### Conteneurs Podman (rootless)

| Conteneur | Image | Port | Rôle |
|-----------|-------|------|------|
| `postgres-stevia` | postgres:16 + pgvector | 5432 | Base vectorielle |
| `ollama` | ollama/ollama | 11434 | Inférence LLM locale |
| `stevia-container` | localhost/stevia-python | 8001 | API FastAPI (backend RAG) |
| `bookstack` | linuxserver/bookstack | 8080 | Documentation source |

---

## Stack technique

- **Backend RAG** : FastAPI + uvicorn
- **Base vectorielle** : PostgreSQL 16 + pgvector, table `langchain_pg_embedding`
- **Embeddings** : FastEmbedEmbeddings (`BAAI/bge-small-en-v1.5`, 384 dimensions)
- **LLM** : Ollama avec gemma3:1b
- **ML supervisé** : scikit-learn (classifieur de pertinence intégré au pipeline RAG)
- **Source documentaire** : BookStack (API REST, HTML → texte brut)
- **Frontend** : Symfony + Twig, widget chatbot JS vanilla (streaming SSE)
- **Conteneurisation** : Podman rootless
- **CI/CD** : GitLab avec PHPStan + GrumPHP

---

## Structure du code Stevia (dans SUCRE)

```
SUCRE/
└── src/
    └── Stevia/
        ├── services/
        │   ├── bookstack_reader.py   # Récupération + parsing pages BookStack
        │   ├── mistral_utils.py      # Appels LLM via Ollama (streaming)
        │   ├── rag_engine.py         # Pipeline RAG complet
        │   └── synonymes.py          # Expansion acronymes métier CPAM
        ├── ml/
        │   ├── generate_dataset.py   # Génération du dataset de pertinence
        │   ├── extract_features.py   # Extraction des features
        │   ├── train_model.py        # Entraînement multi-algorithmes
        │   ├── optimize_model.py     # Optimisation hyperparamètres
        │   ├── evaluate_model.py     # Métriques finales
        │   ├── predict.py            # Prédiction en production
        │   └── dataset/              # CSV train/test
        ├── main.py                   # API FastAPI (point d'entrée)
        ├── Dockerfile
        ├── requirements.txt
        ├── .env / .env.example
        ├── start_stevia.sh           # Démarrage complet stack
        ├── update_stevia.sh          # Mise à jour code + réindexation
        ├── reload_stevia.sh          # Rechargement à chaud FastAPI
        └── cleanup_and_reconfigure.sh # Réinitialisation complète
```

---

## Pipeline RAG (rag_engine.py)

1. **Salutations** → réponse directe sans RAG
2. **Expansion** → `expand_question()` remplace les acronymes métier (AR, NOEMIE, etc.)
3. **Recherche vectorielle** → FastEmbed convertit la question en vecteur, pgvector cherche les 12 chunks les plus proches
4. **Recherche lexicale** → SQL ILIKE sur mots significatifs (NLTK stopwords FR)
5. **Reranking** → score composite avec `role_boost`, `all_boost`, `text_boost`, `content_boost`
6. **Classifieur de pertinence ML** → le modèle scikit-learn prédit si chaque document est pertinent (remplace/améliore `filter_off_topic()`)
7. **Vérification rôle** → avertissement si doc hors profil utilisateur
8. **Construction contexte** → chunks triés par score, concaténés jusqu'à max_total_chars
9. **Génération LLM** → prompt + contexte envoyés à Ollama en streaming
10. **Post-traitement** → détection rejets LLM, ajout images/liens source

### Fonctions clés de rag_engine.py

- `extract_search_keywords()` — extraction mots significatifs (NLTK)
- `search_by_keywords()` — recherche SQL lexicale (LIMIT 2)
- `rerank_documents()` — score composite + tri
- `predict_relevance()` — classifieur ML de pertinence (scikit-learn, remplace filter_off_topic)
- `build_context()` — assemblage contexte pour le prompt
- `is_rejection_response()` — détection formulations d'ignorance
- `rag_answer_streaming()` — orchestration complète du pipeline

---

## SteviaController.php (Symfony)

Routes principales :

| Route | Méthode | Rôle |
|-------|---------|------|
| `/stevia/ask/stream` | POST | Proxy streaming vers FastAPI |
| `/stevia/health` | GET | Healthcheck API |
| `/stevia/index/book/{id}` | POST | Déclenche indexation d'un livre |
| `/stevia/feedback` | POST | Enregistre feedback utilisateur |

Le contrôleur utilise `StreamedResponse` pour le streaming SSE. Configuration via `services.yaml` avec paramètres `$apiStevia`, `$apiBookstack`, tokens BookStack.

---

## Widget chatbot (frontend JS)

- Widget flottant en bas à droite, présent sur toutes les pages SUCRE
- Streaming SSE (Server-Sent Events) pour l'affichage progressif
- Boutons de feedback (pouce haut/bas) sur chaque réponse
- Indicateur de statut (point vert/rouge) avec healthcheck périodique
- Formatage Markdown dans les réponses (gras, listes, liens)
- Auto-scroll fluide pendant le streaming

---

## Benchmarking des modèles LLM

| Modèle | Paramètres | Temps réponse | Pertinence | RAM | Verdict |
|--------|------------|---------------|------------|-----|---------|
| `mistral:7b` | 7B | >30s (timeout) | Non évalué | ~8 GB | ❌ |
| `qwen2.5:3b` | 3B | ~190s | Correcte | ~3.5 GB | ❌ Trop lent |
| `qwen2.5:1.5b` | 1.5B | ~8s | Bonne | ~2 GB | ✅ Ancien prod |
| `qwen2.5:0.5b` | 0.5B | Rapide | Hallucinations | ~1 GB | ❌ |
| `gemma3:1b` | 1B | ~17s | Bonne | ~1.5 GB | ✅ Actuel prod |

---

## Modèle ML supervisé — Classifieur de pertinence RAG (pour la thèse)

### Objectif
Intégrer un algorithme d'apprentissage supervisé classique dans le pipeline Stevia 
pour **prédire la pertinence des documents récupérés** avant de les envoyer au LLM. 
Ce modèle remplace/améliore les fonctions `filter_off_topic()` et `rerank_documents()` 
actuelles (basées sur des seuils manuels) par un classifieur entraîné sur des données réelles.

**Pourquoi ce choix :**
- Répond aux exigences du guide : algorithmes supervisés (RandomForest, KNN, 
  Decision Tree, Logistic Regression), split 70/30, métriques (Accuracy, F1, 
  Precision, Recall), optimisation d'hyperparamètres
- S'intègre naturellement dans le pipeline RAG existant
- Léger (scikit-learn) : tourne sur n'importe quelle machine, pas besoin de GPU
- Apporte une vraie valeur métier : meilleure détection des questions hors-sujet 
  et meilleur reranking qu'un simple seuil sur le score cosinus

### Variable cible
**Classification binaire** : `pertinent` (1) ou `non_pertinent` (0)

Un document est pertinent si la réponse générée à partir de ce document répond 
effectivement à la question de l'utilisateur.

### Features (variables prédictives)

| Feature | Type | Source |
|---------|------|--------|
| `cosine_score` | float | Score de similarité pgvector |
| `keyword_match_count` | int | Nombre de mots-clés de la question trouvés dans le chunk |
| `keyword_match_ratio` | float | Ratio mots-clés matchés / total mots-clés question |
| `chunk_length` | int | Longueur du chunk en caractères |
| `title_match` | bool | Le titre du chunk contient-il des mots de la question |
| `role_match` | bool | Le rôle du document correspond au profil utilisateur |
| `query_length` | int | Longueur de la question utilisateur |
| `rank_position` | int | Position du document dans les résultats vectoriels (1-12) |
| `book_id` | int | Identifiant du livre source (catégoriel encodé) |

### Pipeline de construction du dataset

1. **Collecter les logs** : extraire les questions posées à Stevia (logs existants) 
   + les documents récupérés avec leurs scores
2. **Générer des questions supplémentaires** : utiliser le LLM (Ollama) pour générer 
   des questions réalistes à partir des pages BookStack
3. **Labéliser** : pour chaque paire (question, document), évaluer si le document 
   est pertinent pour répondre à la question (manuellement + assisté par LLM)
4. **Extraire les features** : calculer toutes les features ci-dessus pour chaque paire
5. **Format** : CSV avec colonnes features + colonne `label` (0/1)

### Pipeline d'entraînement

```python
# Scripts à créer dans stevia/ml/

stevia/ml/
├── generate_dataset.py      # Extraction logs + génération questions + labélisation
├── extract_features.py      # Calcul des features pour chaque paire (question, doc)
├── train_model.py           # Entraînement multi-algorithmes + évaluation
├── optimize_model.py        # GridSearchCV pour hyperparamètres
├── evaluate_model.py        # Métriques finales sur jeu de test
├── predict.py               # Chargement modèle + prédiction en production
└── dataset/
    ├── stevia_relevance_dataset.csv  # Dataset complet
    ├── train.csv                      # 70% entraînement
    └── test.csv                       # 30% test
```

### Algorithmes à comparer (exigence du guide)

**Machine Learning classique (scikit-learn) :**
- Logistic Regression (baseline)
- K-Nearest Neighbors (KNN)
- Decision Tree
- Random Forest
- (optionnel) SVM

**Deep Learning (Keras/TensorFlow) :**
- Petit réseau dense (2-3 couches) sur les mêmes features

### Métriques d'évaluation (exigence du guide)

- **Accuracy** (exigé pour classification)
- **Precision / Recall / F1-score** (par classe)
- **Matrice de confusion**
- **Comparaison temps d'exécution** entre les algorithmes
- **Comparaison avant/après** : taux de faux positifs du filter_off_topic() 
  actuel (seuils manuels) vs le classifieur entraîné

### Optimisation des hyperparamètres

Utiliser `GridSearchCV` ou `RandomizedSearchCV` (scikit-learn) pour optimiser 
chaque algorithme, puis réentraîner le meilleur modèle sur l'ensemble 
d'entraînement complet (exigence du guide).

### Intégration dans le pipeline RAG

Le modèle entraîné (sérialisé avec joblib) est chargé au démarrage de FastAPI 
et appelé dans `rag_engine.py` :

```python
# Dans rag_engine.py — remplace filter_off_topic() et améliore rerank_documents()
import joblib

model = joblib.load("ml/relevance_model.pkl")

def predict_relevance(question: str, docs_with_scores: list) -> list:
    """Prédit la pertinence de chaque document récupéré."""
    features = extract_features(question, docs_with_scores)
    predictions = model.predict(features)
    probas = model.predict_proba(features)[:, 1]
    # Ne garder que les docs prédits pertinents, triés par proba
    return [(doc, score, proba) 
            for (doc, score), pred, proba 
            in zip(docs_with_scores, predictions, probas) 
            if pred == 1]
```

### Dépendances supplémentaires

```
scikit-learn
pandas
joblib
matplotlib       # Visualisations (matrice confusion, courbes)
tensorflow       # Pour le modèle deep learning (optionnel)
```

---

## Base de données vectorielle

### Table `langchain_pg_embedding`

| Champ | Type | Description |
|-------|------|-------------|
| `id` | UUID | Identifiant unique du chunk |
| `collection_id` | UUID | Référence collection LangChain |
| `embedding` | VECTOR(384) | Vecteur FastEmbed (BAAI/bge-small-en-v1.5) |
| `document` | TEXT | Contenu textuel du chunk (~500 tokens) |
| `cmetadata` | JSONB | `book_id`, `page_id`, `page_title`, `book_name`, `shelf_slug`, `indexed_at`, `roles` |

### Données indexées
- 4 livres (shelf `sucre`)
- 120-160 pages, ~500-700 Ko texte brut
- Documentation procédurale en français avec acronymes métier CPAM
- Mise à jour en temps réel via webhook BookStack → endpoint FastAPI `/webhook`

---

## Objectif de la démo locale

Créer une version locale complète sur **Mac M5 16 Go** pour la soutenance de thèse :

### Pages nécessaires

1. **Fausse page d'accueil SUCRE** — reproduit le look de l'application réelle (layout, header, sidebar, couleurs CPAM)
2. **Page d'indexation** — affiche les documents indexés depuis BookStack (livre, nombre de pages, nombre de chunks, date d'indexation), avec boutons d'indexation/suppression
3. **Widget chatbot Stevia** — présent sur TOUTES les pages, en bas à droite, avec streaming

### Stack locale (Podman Compose)

- PostgreSQL 16 + pgvector
- Ollama + gemma3:1b
- FastAPI (Stevia backend)
- BookStack (instance locale avec échantillon de docs)
- Symfony (pages simplifiées)

### Contraintes

- Pas de VPN nécessaire
- Pas de connexion aux services CPAM
- BDD locale autonome
- Le look doit ressembler fidèlement à SUCRE (s'inspirer des templates Twig, CSS et layout du vrai code source)

---

## Contexte professionnel

- **Entreprise** : CPAM Hauts-de-Seine (Assurance Maladie)
- **Service** : Pôle Développement
- **Rôle** : Apprenti développeur
- **Thèse** : Mastère Data & IA, RNCP 37137, Nexa Digital School
- **Deadline** : envoi des livrables avant le 30 août 2026
- **Soutenance** : 90 minutes (30 min présentation + 15 min Q&A + 15 min entretien + 30 min jeu de rôle)

---

## Conventions de code

- Python : FastAPI, type hints, docstrings
- PHP : Symfony 5+, PHP 8+, attributs de routing
- Scripts bash : `set -euo pipefail`, variables depuis `.env`
- Conteneurs : Podman rootless (pas Docker)
- Pas de dépendances cloud — tout tourne en local / on-premise

---

## Code source SUCRE (référence)

Le dossier `sucre-source/` contient uniquement les fichiers relatifs à Stevia 
et les assets de SUCRE, PAS l'application complète.

### Ce qui est disponible :
- **Les assets complets** : CSS + JS de SUCRE (couleurs, typographie, style CPAM)
- **Le SteviaController.php** : logique du proxy streaming et routes
- **Les templates chatbot** : widget Twig + JS (streaming SSE, feedback, status)
- **Le services.yaml** : configuration des services Symfony
- **Tout le code Python Stevia** : main.py, rag_engine.py, bookstack_reader.py, 
  mistral_utils.py, synonymes.py, Dockerfile, requirements.txt, .env.example, 
  scripts shell (start, update, reload, cleanup)

### Ce qui N'EST PAS disponible :
- Le layout principal (base.html.twig, header, sidebar)
- Les pages métier de SUCRE (recouvrement, etc.)
- Les contrôleurs hors Stevia

→ **Déduis le layout SUCRE** (header, sidebar, structure) à partir des CSS 
dans les assets. Reproduis un look fidèle sans avoir le template original.

Ne modifie JAMAIS les fichiers dans `sucre-source/`. C'est une référence en 
lecture seule. Crée tous les nouveaux fichiers dans le dossier principal du projet.

---

## Exigences du guide de thèse (critères d'évaluation)

Le guide impose les éléments suivants pour la partie ML/données :

- **Algorithme supervisé** : au moins un parmi Logistic Regression, KNN, 
  RandomForest, Decision Tree (ML) + deep learning
- **Split 70/30** : jeu d'entraînement séparé avec au moins 70% des données
- **Métriques** : Accuracy (classification), comparaison temps d'exécution 
  tables optimisées vs non-optimisées
- **Optimisation hyperparamètres** : réentraîner le meilleur modèle
- **Documentation technique** sur le modèle choisi
- **Dictionnaire de données**
- **Tableau de suivi** des problématiques techniques
- **Application web** intégrant l'algorithme supervisé (→ Stevia avec le classifieur)
- **Accessibilité** personnes en situation de handicap
- **Mesures RGPD** et protection des données
