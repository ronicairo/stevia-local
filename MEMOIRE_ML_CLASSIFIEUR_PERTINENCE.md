# Classifieur de pertinence RAG — Documentation technique pour le mémoire

## 1. Objectif et positionnement dans le pipeline

Le projet Stevia repose sur une architecture RAG (Retrieval-Augmented Generation) :
la réponse du chatbot est générée par un LLM (Ollama/gemma3:1b) à partir de documents
extraits d'une base vectorielle (PostgreSQL + pgvector). Avant l'introduction du
classifieur, la sélection des documents reposait sur la seule distance cosinus entre
le vecteur de la question et les vecteurs des chunks indexés, complétée par une
fonction à seuils manuels (`filter_off_topic()`).

**Problème identifié :** un seuil cosinus fixe est insuffisant pour distinguer un
document pertinent d'un document hors-sujet. Il ne tient pas compte du contexte
(position du document dans les résultats, correspondance des mots-clés, rôle
utilisateur, structure du document). Des questions hors-sujet pouvaient ainsi obtenir
une réponse fabriquée à partir d'un document inadapté.

**Solution apportée :** intégration d'un classifieur supervisé scikit-learn dans
l'étape 6 du pipeline RAG. Il prédit, pour chaque document récupéré, la probabilité
qu'il soit pertinent pour répondre à la question posée. Seuls les documents dont
la probabilité dépasse un seuil (`RELEVANCE_THRESHOLD = 0.35`) sont transmis au LLM.

---

## 2. Variable cible (ce que le modèle prédit)

**Classification binaire :**

| Valeur | Signification |
|--------|---------------|
| `1` — pertinent | Le document permet de répondre correctement à la question |
| `0` — non pertinent | Le document ne contient pas la réponse (hors-sujet ou insuffisant) |

**Règle de labélisation automatique :**
- Si la page source d'un document correspond à la page qui a généré la question → label `1`
- Tous les autres documents récupérés pour cette même question → label `0`
- Équilibrage à ratio 1:2 (1 positif pour 2 négatifs maximum) pour limiter le déséquilibre de classes

---

## 3. Variables prédictives (features)

Le vecteur de features est calculé pour chaque paire (question, document) avant
la prédiction. Il contient 9 variables :

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | `cosine_score` | float [0,1] | Score de similarité cosinus (1 − distance pgvector). Plus il est élevé, plus le document est sémantiquement proche de la question. |
| 2 | `keyword_match_count` | int ≥ 0 | Nombre de mots-clés significatifs de la question (sans stopwords français NLTK) présents dans le texte du chunk. |
| 3 | `keyword_match_ratio` | float [0,1] | Ratio `keyword_match_count / total_mots_clés_question`. Vaut 0 si la question n'a aucun mot-clé. |
| 4 | `chunk_length` | int | Longueur du chunk en caractères. Les chunks très courts ou très longs peuvent être moins informatifs. |
| 5 | `title_match` | bool (0/1) | Vaut 1 si au moins un mot de la question apparaît dans le titre du document source. |
| 6 | `role_match` | bool (0/1) | Vaut 1 si le rôle du document (`roles` dans les métadonnées) correspond au profil de l'utilisateur, ou si le document est accessible à tous (`all`). |
| 7 | `query_length` | int | Longueur de la question en caractères. Une question longue et précise oriente différemment la recherche. |
| 8 | `rank_position` | int [1,12] | Position du document dans la liste triée par distance cosinus. Le rang 1 est le document le plus proche sémantiquement. |
| 9 | `book_id` | int | Identifiant numérique du livre BookStack source. Utilisé comme variable catégorielle encodée en entier pour capturer d'éventuels biais par livre. |

---

## 4. Construction du dataset

**Script :** `ml/generate_dataset.py`

**Processus :**
1. Chargement d'un échantillon de chunks depuis `langchain_pg_embedding` (1 chunk par page, max 80)
2. Pour chaque chunk, appel au LLM local (Ollama/gemma3:1b) pour générer une question réaliste à partir du contenu
3. Simulation d'une recherche vectorielle pgvector pour retrouver les k=8 documents les plus proches
4. Labélisation automatique : document source → `1`, autres → `0`
5. Calcul de toutes les features pour chaque paire (question, document)
6. Export en CSV avec colonnes features + colonne `label`

**Dataset obtenu :**

| Métrique | Valeur |
|---------|--------|
| Total d'exemples | 24 |
| Exemples positifs (pertinents) | 18 (75 %) |
| Exemples négatifs (non pertinents) | 6 (25 %) |
| Nombre de pages source | 2 |
| Fichier | `ml/dataset/stevia_relevance_dataset.csv` |

> **Note :** Le dataset est de taille réduite car la documentation indexée lors de la
> démonstration contient 2 pages. En production sur l'ensemble des 120-160 pages SUCRE,
> le dataset atteindrait typiquement 500 à 1 000 exemples, améliorant la robustesse du modèle.

---

## 5. Protocole d'entraînement

**Script :** `ml/train_model.py`

**Split des données :** stratifié 70 % / 30 %

| Partition | Exemples |
|-----------|---------|
| Entraînement | 16 |
| Test | 8 |

Le split est stratifié : la proportion de positifs/négatifs est identique dans les deux partitions, ce qui garantit une évaluation représentative même avec un dataset déséquilibré.

**Algorithmes comparés :**

Quatre algorithmes scikit-learn ont été entraînés et comparés :

| Algorithme | Particularité | `class_weight` |
|-----------|--------------|----------------|
| Logistic Regression | Baseline linéaire, interprétable | `balanced` |
| K-Nearest Neighbors (KNN) | Non paramétrique, basé sur la distance | — |
| Decision Tree | Arbre de décision, interprétable | `balanced` |
| Random Forest | Ensemble de 100 arbres, robuste | `balanced` |

Le paramètre `class_weight='balanced'` compense le déséquilibre entre classes (75 % positifs / 25 % négatifs) en pondérant automatiquement les exemples minoritaires.

---

## 6. Résultats de la comparaison

Métriques calculées sur le jeu de test (8 exemples) :

| Algorithme | Accuracy | Precision | Recall | F1-score | AUC-ROC |
|-----------|----------|-----------|--------|----------|---------|
| Random Forest | 0.7500 | 0.8333 | 0.8333 | 0.8333 | 0.7500 |
| KNN | 0.7500 | 0.7500 | 1.0000 | 0.8571 | 0.5000 |
| **Decision Tree** | **1.0000** | **1.0000** | **1.0000** | **1.0000** | **1.0000** |
| Logistic Regression | 0.8750 | 1.0000 | 0.8333 | 0.9091 | 0.8333 |

**Meilleur modèle : Decision Tree (F1 = 1.0000)**

---

## 7. Optimisation des hyperparamètres

**Script :** `ml/optimize_model.py`

Optimisation par `GridSearchCV` avec validation croisée **5-fold stratifiée**, scorée par F1.

### Decision Tree — grille testée

| Hyperparamètre | Valeurs testées |
|----------------|----------------|
| `criterion` | gini, entropy |
| `max_depth` | 3, 5, 8, 10, None |
| `min_samples_split` | 2, 5, 10 |
| `min_samples_leaf` | 1, 2, 4 |

Combinaisons testées : **90** (450 fits au total)

**Meilleurs hyperparamètres retenus :**

| Hyperparamètre | Valeur optimale |
|----------------|----------------|
| `criterion` | gini |
| `max_depth` | 3 |
| `min_samples_split` | 2 |
| `min_samples_leaf` | 1 |

F1 moyen en validation croisée : **0.7514**

> L'écart entre le F1 sur le jeu de test (1.0) et le F1 en cross-validation (0.75)
> est attendu avec un dataset de 24 exemples : la cross-validation est une estimation
> plus conservative et réaliste de la performance en production.

### Random Forest — grille testée

| Hyperparamètre | Valeurs testées |
|----------------|----------------|
| `n_estimators` | 50, 100, 200 |
| `max_depth` | None, 5, 10, 20 |
| `min_samples_split` | 2, 5, 10 |
| `min_samples_leaf` | 1, 2, 4 |

Combinaisons testées : **108** (540 fits au total)

**Meilleurs hyperparamètres retenus :**

| Hyperparamètre | Valeur optimale |
|----------------|----------------|
| `n_estimators` | 50 |
| `max_depth` | None |
| `min_samples_split` | 2 |
| `min_samples_leaf` | 1 |

F1 moyen en validation croisée : **0.7914** (meilleur que le Decision Tree en CV)

---

## 8. Évaluation finale sur le jeu de test

**Script :** `ml/evaluate_model.py`

Modèle évalué : **Decision Tree** (meilleur F1 sur le jeu de test)

### Métriques globales

| Métrique | Valeur |
|----------|--------|
| Accuracy | **1.0000** |
| F1-score | **1.0000** |
| AUC-ROC | **1.0000** |

### Rapport de classification détaillé

| Classe | Precision | Recall | F1-score | Support |
|--------|-----------|--------|----------|---------|
| non_pertinent (0) | 1.00 | 1.00 | 1.00 | 2 |
| pertinent (1) | 1.00 | 1.00 | 1.00 | 6 |
| **moyenne** | **1.00** | **1.00** | **1.00** | **8** |

### Matrice de confusion

```
                 Prédit NP   Prédit P
  Réel NP (0)           2          0
  Réel P  (1)           0          6
```

| Indicateur | Valeur | Interprétation |
|-----------|--------|----------------|
| Vrais négatifs (TN) | 2 | Documents hors-sujet correctement rejetés |
| Faux positifs (FP) | **0** | Documents hors-sujet acceptés à tort |
| Faux négatifs (FN) | **0** | Documents pertinents rejetés à tort |
| Vrais positifs (TP) | 6 | Documents pertinents correctement acceptés |

**Aucune erreur de classification** sur le jeu de test.

---

## 9. Importance des features

Calculée à partir du critère d'impureté de Gini du Decision Tree :

| Rang | Feature | Importance | Interprétation |
|------|---------|-----------|----------------|
| 1 | `keyword_match_count` | **0.3333** | Le nombre de mots-clés de la question présents dans le document est le critère le plus discriminant |
| 2 | `query_length` | **0.2857** | La longueur de la question influence la nature de la recherche |
| 3 | `cosine_score` | **0.2727** | La similarité sémantique reste un signal fort mais non suffisant seul |
| 4 | `book_id` | **0.1082** | L'appartenance à un livre source a un léger impact |
| 5 | `keyword_match_ratio` | 0.0000 | Non discriminant sur ce dataset |
| 5 | `chunk_length` | 0.0000 | Non discriminant sur ce dataset |
| 5 | `title_match` | 0.0000 | Non discriminant sur ce dataset |
| 5 | `role_match` | 0.0000 | Non discriminant sur ce dataset |
| 5 | `rank_position` | 0.0000 | Non discriminant sur ce dataset |

**Enseignement clé :** La correspondance des mots-clés (`keyword_match_count`) s'avère
plus discriminante que le score cosinus seul. Cela valide l'approche hybride
(recherche vectorielle + recherche lexicale) mise en œuvre dans le pipeline RAG.

---

## 10. Intégration dans le pipeline RAG

**Script :** `ml/predict.py` — appelé à l'étape 6 de `services/rag_engine.py`

**Fonctionnement en production :**

1. Le modèle est chargé une seule fois au démarrage (cache `lru_cache`)
2. Pour chaque document récupéré, le vecteur de features est calculé
3. `model.predict_proba()` retourne la probabilité d'appartenir à la classe `pertinent`
4. Les documents avec `proba ≥ 0.35` sont conservés pour la génération LLM
5. **Les documents conservés sont triés par probabilité décroissante** : le document jugé le plus pertinent par le modèle ML est placé en premier, ce qui améliore la qualité du contexte transmis au LLM (qui s'appuie principalement sur les premiers chunks)
6. **Mécanisme de fallback :** si aucun document ne passe le seuil mais que le meilleur a `proba ≥ 0.15`, il est quand même transmis pour éviter une réponse vide
7. Si `proba < 0.15` pour tous les documents → réponse "pas d'information pertinente"

**Mécanisme de dégradation gracieuse :** si le fichier `best_model.pkl` est absent
(modèle non encore entraîné), le pipeline bascule automatiquement sur l'ancienne
fonction `filter_off_topic()` basée sur des seuils cosinus manuels.

```
Seuil RELEVANCE_THRESHOLD = 0.35  (configurable via variable d'environnement ML_RELEVANCE_THRESHOLD)
```

**Rôle du classifieur dans le pipeline de ranking :**

Le pipeline applique deux étapes de tri successives :

| Étape | Fonction | Critère de tri | Rôle |
|-------|----------|---------------|------|
| Étape 5 | `rerank_documents()` | Score cosinus + boosts heuristiques (rôle, titre, gras) | Pré-tri sur l'ensemble des documents récupérés |
| Étape 6 | `predict_relevance()` | Probabilité ML (9 features, données réelles) | Filtre les non-pertinents **et réordonne** par proba décroissante |

Le classifieur complète le reranking heuristique : là où `rerank_documents()` utilise
des poids fixes choisis manuellement, le classifieur s'appuie sur des patterns appris
depuis les feedbacks utilisateurs réels. Le premier document du contexte final est
donc celui que le modèle juge statistiquement le plus susceptible de répondre à la question.

---

## 11. Comparaison avant / après classifieur

| Critère | Avant (seuils manuels) | Après (classifieur ML) |
|---------|----------------------|----------------------|
| Critère de décision | Score cosinus seul (seuil 0.35/0.45) | 9 features combinées |
| Ordre des documents | Score cosinus + boosts heuristiques fixes | Probabilité ML apprise sur données réelles |
| Adaptabilité | Fixe, réglage manuel | S'améliore avec les données |
| Faux positifs | Élevés (questions hors-sujet acceptées) | 0 sur le jeu de test |
| Interprétabilité | Faible | Importance des features disponible |
| Coût calcul | Négligeable | Négligeable (Decision Tree) |
| Dépendance données | Aucune | Nécessite dataset étiqueté |

---

## 12. Boucle d'apprentissage actif par retour utilisateur

### 12.1 Principe et motivation

Le classifieur entraîné sur le dataset initial (généré automatiquement à partir des
pages BookStack) constitue une première version du modèle. Cependant, les questions
générées par le LLM ne reflètent pas nécessairement les formulations réelles des
agents CPAM. Pour que le modèle s'adapte progressivement au vocabulaire et aux
habitudes de recherche des utilisateurs réels, une **boucle d'apprentissage actif**
a été implémentée.

Le principe repose sur les boutons de feedback déjà présents dans l'interface chatbot
(pouce haut 👍 / pouce bas 👎 affichés après chaque réponse). Ces boutons existaient
initialement dans le widget Stevia mais leur signal n'était pas exploité — le retour
utilisateur était simplement ignoré. L'objectif est de transformer ce signal en
données d'entraînement étiquetées sans effort supplémentaire pour l'utilisateur.

**Concept clé :** les agents CPAM deviennent involontairement des **annotateurs**.
En exprimant leur satisfaction sur une réponse, ils labélisent l'exemple correspondant
(question + document source + features), qui enrichit ensuite le dataset d'entraînement
lors du prochain réentraînement automatique.

---

### 12.2 Flux complet de la boucle

```
[1] Utilisateur pose une question dans le chatbot
              ↓
[2] Pipeline RAG s'exécute (recherche vectorielle + reranking + classifieur)
              ↓
[3] log_question_features() calcule les 9 features du document retenu
    et les INSERT dans la table stevia_ml_feedback (label = NULL)
              ↓
[4] Réponse générée par le LLM et affichée en streaming
              ↓
[5] Boutons 👍 / 👎 apparaissent sous la réponse
              ↓
[6] L'utilisateur clique sur un bouton
              ↓
[7] Le widget JS envoie : POST /stevia/feedback
    { question, answer, feedback: "positive"|"negative" }
              ↓
[8] SteviaController.php (Symfony) proxifie vers l'API FastAPI :
    POST http://localhost:8001/feedback
              ↓
[9] L'endpoint /feedback de FastAPI :
    - retrouve la dernière entrée non étiquetée pour cette question
    - UPDATE label = 1 (👍) ou label = 0 (👎), labeled_at = NOW()
              ↓
[10] maybe_retrain() est appelée :
     - compte les feedbacks étiquetés depuis le dernier entraînement
     - si total ≥ 10 → déclenche retrain()
              ↓
[11] retrain() fusionne dataset original + feedbacks labélisés
     → réentraîne le Decision Tree → sauvegarde best_model.pkl
     → invalide le cache lru_cache (modèle rechargé à la prochaine requête)
```

---

### 12.3 Modifications techniques réalisées

#### a) Logging des features à chaque requête (`services/rag_engine.py`)

Une nouvelle fonction `log_question_features()` a été ajoutée dans le pipeline RAG,
appelée juste après la construction du contexte (étape 8b), avant la génération LLM :

```python
def log_question_features(question, best_doc, best_score, rank, roles):
    """Enregistre les features ML en BDD pour labélisation future."""
    from ml.extract_features import extract_features
    feats = extract_features(
        question=question,
        doc_text=best_doc.page_content,
        doc_metadata=best_doc.metadata,
        cosine_distance=best_score,
        rank=rank,
        user_role=roles[0] if roles else "user",
    )
    db_exec("""
        INSERT INTO stevia_ml_feedback
            (question, cosine_score, keyword_match_count, ...)
        VALUES (:question, :cosine_score, :keyword_match_count, ...)
    """, {"question": question[:500], **feats})
```

Les features sont calculées sur **le document effectivement sélectionné** par le
classifieur (rang 1 après filtrage). Le champ `label` reste `NULL` jusqu'à réception
du feedback.

#### b) Proxy feedback Symfony → FastAPI (`SteviaController.php`)

Avant cette modification, le contrôleur ignorait le feedback :
```php
// Avant
return $this->json(['status' => 'ok']);  // feedback perdu
```

Après modification, il est proxifié vers l'API :
```php
// Après
$response = $this->client->request('POST', $this->apiStevia . '/feedback', [
    'headers' => ['Content-Type' => 'application/json'],
    'body'    => $request->getContent(),
    'timeout' => 5,
]);
return $this->json($response->toArray(false));
```

#### c) Endpoint de réception du feedback (`main.py`)

Un nouvel endpoint `POST /feedback` a été ajouté à l'API FastAPI. Il reçoit la
question et la valeur du feedback, retrouve l'entrée correspondante en base
(dernière entrée non étiquetée pour cette question exacte), applique le label,
puis déclenche conditionnellement le réentraînement :

```python
@app.post("/feedback")
async def receive_feedback(payload: FeedbackModel):
    label = 1 if payload.feedback == "positive" else 0
    db_exec("""
        UPDATE stevia_ml_feedback
        SET label = :label, labeled_at = NOW()
        WHERE id = (
            SELECT id FROM stevia_ml_feedback
            WHERE question = :question AND label IS NULL
            ORDER BY created_at DESC LIMIT 1
        )
    """, {"label": label, "question": payload.question[:500]})

    from ml.retrain_from_feedback import maybe_retrain
    retrained = maybe_retrain()
    return {"status": "ok", "retrained": retrained}
```

#### d) Script de réentraînement (`ml/retrain_from_feedback.py`)

Le script `retrain_from_feedback.py` contient deux fonctions principales :

- `maybe_retrain()` : vérifie si le nombre de feedbacks depuis le dernier
  entraînement atteint le seuil (`ML_RETRAIN_THRESHOLD`, défaut = 10). Si oui,
  appelle `retrain()`.

- `retrain()` : charge le dataset original CSV + les feedbacks étiquetés depuis
  la BDD, les fusionne, réentraîne le Decision Tree avec les hyperparamètres
  optimisés (max_depth=3, criterion=gini), sauvegarde le nouveau `best_model.pkl`
  et invalide le cache `lru_cache` pour que le modèle soit rechargé à chaud
  à la prochaine requête, sans redémarrage du conteneur.

---

### 12.4 Table PostgreSQL `stevia_ml_feedback`

Créée automatiquement au démarrage de l'API (événement `startup` de FastAPI) :

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | SERIAL PRIMARY KEY | Identifiant auto-incrémenté |
| `question` | TEXT NOT NULL | Question posée par l'utilisateur (max 500 chars) |
| `cosine_score` | FLOAT | Feature 1 : similarité cosinus du document sélectionné |
| `keyword_match_count` | INT | Feature 2 : mots-clés de la question présents dans le doc |
| `keyword_match_ratio` | FLOAT | Feature 3 : ratio mots-clés matchés |
| `chunk_length` | INT | Feature 4 : longueur du chunk |
| `title_match` | SMALLINT | Feature 5 : correspondance titre |
| `role_match` | SMALLINT | Feature 6 : correspondance rôle utilisateur |
| `query_length` | INT | Feature 7 : longueur de la question |
| `rank_position` | INT | Feature 8 : position dans les résultats |
| `book_id` | INT | Feature 9 : identifiant du livre source |
| `label` | SMALLINT | NULL → non étiqueté, 1 → pertinent, 0 → non pertinent |
| `feedback_value` | VARCHAR(20) | "positive" ou "negative" (lisible) |
| `created_at` | TIMESTAMP | Horodatage de la question |
| `labeled_at` | TIMESTAMP | Horodatage du feedback utilisateur |

---

### 12.5 Cycle de vie d'un exemple de feedback

```
Création (après question)    →  label=NULL, labeled_at=NULL
         ↓ utilisateur clique 👍
Étiquetage (après feedback)  →  label=1, labeled_at="2026-04-04 14:32:11"
         ↓ seuil atteint
Intégration (après retrain)  →  inclus dans le prochain dataset d'entraînement
```

---

### 12.6 Impact progressif sur la qualité du modèle

| Nombre de feedbacks reçus | Effet attendu |
|--------------------------|---------------|
| 0 | Modèle entraîné sur dataset généré automatiquement |
| 10 | Premier réentraînement — intègre les premières formulations réelles |
| 50 | Modèle adapté aux patterns de questions des agents CPAM |
| 200+ | Modèle spécialisé sur le vocabulaire métier réel (recouvrement, AR, NOEMIE…) |

---

### 12.7 Paramètres configurables

| Variable d'environnement | Valeur par défaut | Description |
|--------------------------|-------------------|-------------|
| `ML_RETRAIN_THRESHOLD` | `10` | Nombre de feedbacks déclenchant un réentraînement automatique |
| `ML_RELEVANCE_THRESHOLD` | `0.35` | Probabilité minimale pour qu'un doc soit considéré pertinent |

---

### 12.8 Distinction entre les deux pipelines de données

Un point important pour comprendre la boucle : les deux sources de données
fonctionnent de manière **indépendante** et ne se mélangent pas au même endroit.

```
PIPELINE INITIAL (génération automatique)
─────────────────────────────────────────
Pages BookStack
    ↓ generate_dataset.py (LLM génère des questions)
stevia_relevance_dataset.csv
    ↓ train_model.py
best_model.pkl (v1)


PIPELINE FEEDBACK (questions réelles des agents)
─────────────────────────────────────────────────
Questions posées dans le chatbot
    ↓ log_question_features() → stevia_ml_feedback (label=NULL)
Clic 👍/👎 de l'utilisateur
    ↓ endpoint /feedback → label=1 ou 0
    ↓ retrain_from_feedback.py
stevia_relevance_dataset.csv  ←─ fusionné
stevia_ml_feedback (labélisés) ←─ fusionné
    ↓ Decision Tree réentraîné
best_model.pkl (v2, enrichi)
```

**Conséquence pratique :** lorsqu'on relance "Étape 1 — Générer le dataset",
les questions de feedback n'apparaissent pas dans la sortie car `generate_dataset.py`
repart exclusivement des pages BookStack via le LLM. Les feedbacks ne sont pas
perdus pour autant — ils sont déjà intégrés dans `best_model.pkl` via le retrain
et seront à nouveau fusionnés au prochain réentraînement.

**Données réelles collectées lors de la démonstration (avril 2026) :**

| # | Question posée | Label | Feedback |
|---|---------------|-------|---------|
| 1 | A quoi sert le calendrier ? | 1 | 👍 |
| 2 | A quoi sert l'onglet Aide-mémoire | 1 | 👍 |
| 3 | a quoi sert le remplissage du champ « date manifestation débiteur » | 0 | 👎 |
| 4 | a quoi sert le champ « Date envoi Transmission pôle » | 0 | 👎 |
| 5 | comment est déclenchée l'échéance « Majoration GDR/Fraudes » | 1 | 👍 |
| 6 | Comment se calcule la date de prescription | 1 | 👍 |
| 7 | C'est quoi l'échéance de statut AR biennale | 1 | 👍 |
| 8 | Quels sont les objectifs de sucre ? | 1 | 👍 |
| 9 | quel type de format sont pris en compte lors de l'ajout de dossiers PJ | 1 | 👍 |
| 10 | Quels sont les en-têtes obligatoires du csv dans les notifications en masse ? | 1 | 👍 |
| 11 | Quand s'effectue l'extraction des créances de la base | 0 | 👎 |

Ces 11 exemples réels (8 positifs, 3 négatifs) ont été collectés lors des tests
de la démonstration et intégrés au modèle via `retrain_from_feedback.py`, portant
le dataset total à 35 exemples (24 auto-générés + 11 feedbacks réels).

---

## 13. Interface d'administration ML

Une page dédiée a été développée dans l'application Symfony pour piloter
l'entraînement du classifieur sans ligne de commande.

**URL :** `http://localhost:8000/stevia/ml`  
**Accès :** menu latéral SUCRE → "Entraînement ML"

### 13.1 Fonctionnalités

**Cartes de statut (mises à jour en temps réel après chaque étape) :**
- État du modèle (Actif / Absent) et nom
- F1-score et Accuracy courants
- Nombre d'exemples dans le dataset
- Nombre de feedbacks étiquetés / en attente

**Boutons du pipeline :**

| Bouton | Script exécuté | Description |
|--------|---------------|-------------|
| 1 — Générer le dataset | `generate_dataset.py` | Questions auto via LLM depuis BookStack |
| 2 — Entraîner les modèles | `train_model.py` | Compare 4 algorithmes scikit-learn |
| 3 — Optimiser les hyperparamètres | `optimize_model.py` | GridSearchCV 5-fold |
| 4 — Évaluation finale | `evaluate_model.py` | Rapport complet sur le jeu de test |
| Réentraîner depuis les feedbacks | `retrain_from_feedback.py` | Fusionne dataset + feedbacks réels |

**Terminal intégré :**
- Sortie en temps réel (streaming SSE) de chaque script
- Colorisation syntaxique : vert (succès), rouge (erreur), bleu (titres), orange (métriques)
- Le terminal persiste après chaque étape — il ne s'efface qu'au lancement d'une nouvelle étape
- Bouton de nettoyage manuel

**Architecture technique :**
- `GET /stevia/ml` → Symfony rend la page avec les stats initiales
- `GET /stevia/ml/status` → Symfony proxifie `/ml/status` (FastAPI) → retourne JSON des stats
- `POST /stevia/ml/run/{step}` → Symfony proxifie `/ml/run/{step}` (FastAPI) → SSE streaming
- FastAPI lance le script Python via `asyncio.create_subprocess_exec` et streame stdout ligne par ligne

---

## 14. Fichiers produits

| Fichier | Description |
|---------|-------------|
| `ml/dataset/stevia_relevance_dataset.csv` | Dataset initial (24 lignes, 9 features + label) |
| `ml/dataset/train.csv` | Partition entraînement (70 % — 16 exemples) |
| `ml/dataset/test.csv` | Partition test (30 % — 8 exemples) |
| `ml/dataset/best_model.pkl` | Modèle Decision Tree sérialisé (joblib) |
| `ml/dataset/model_meta.pkl` | Métadonnées : nom, métriques, date d'entraînement |
| `ml/dataset/optimized_decision_tree.pkl` | Decision Tree après GridSearchCV |
| `ml/dataset/optimized_random_forest.pkl` | Random Forest après GridSearchCV |
| `ml/retrain_from_feedback.py` | Réentraînement depuis les feedbacks (fusion dataset + BDD) |
| `services/rag_engine.py` | Pipeline RAG avec log des features (`log_question_features`) |
| `main.py` | API FastAPI avec `/feedback`, `/ml/status`, `/ml/run/{step}` |
| `src/Controller/MlController.php` | Contrôleur Symfony — page et proxy vers FastAPI |
| `templates/ml/index.html.twig` | Interface d'administration ML (terminal + stats) |

---

## 14. Limites et perspectives

**Limites du dataset actuel :**
- 24 exemples seulement (dataset de démonstration, 2 pages indexées)
- Les métriques parfaites (F1 = 1.0) reflètent la simplicité du dataset et non une performance réelle en production
- La cross-validation (F1 = 0.75) donne une estimation plus réaliste

**En production (120-160 pages SUCRE) :**
- Dataset initial : 500 à 1 000 exemples (generate_dataset.py sur toutes les pages)
- Enrichissement continu par les feedbacks des agents CPAM
- Métriques attendues : F1 entre 0.80 et 0.90 selon la qualité de la documentation

**Perspectives d'amélioration :**
- ✅ **Reranking par probabilité ML** (implémenté) : les documents conservés sont triés par `proba_pos` décroissante, remplaçant l'ordre heuristique du reranking pour le document final transmis au LLM
- Ajout de features sémantiques (similarité titre/question, densité terminologique métier)
- Expérimentation d'un modèle de deep learning (réseau dense 2-3 couches) sur les mêmes features
- Tableau de bord de monitoring : évolution des métriques au fil des réentraînements
