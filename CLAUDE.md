# CLAUDE.md — Journal de session Stevia

> Fichier de continuité : résumé de ce qui a été fait à chaque session, pour reprendre le contexte après un `/clear`.
> Convention : **local** = `src/Stevia/` · **prod RAG** = `STEVIA-PROD/` (RAW + reformulation, conteneur `stevia-container`, port 8001) · **prod LLM direct** = `STEVIA-PROD-LLM/` (mode no-RAG hybride, conteneur `stevia-llm`, image `stevia-llm-python`, port 8002, autonome). Modifs Python en local d'abord, répliquer en prod après validation. Ne jamais toucher `scripts/`, `.env`, ni `synonymes.py` côté prod (version prod plus riche). Les 3 dossiers partagent la même base `postgres_db` + Ollama.

---

## Architecture rapide

- **Chatbot RAG documentaire** CPAM SUCRE (gestion de créances), basé sur la doc BookStack.
- **Stack** : FastAPI (`main.py`, port 8001) ← proxy Symfony (`SteviaController.php`) ← widget JS (`public/js/chatbot.js`).
- **Ollama natif macOS** (GPU). Modèles : `qwen2.5vl:7b` (chat+vision), `qwen2.5:3b` (génération dataset ML + mode RAW), `qwen3-embedding:0.6b` (embeddings + classifieurs).
- **PostgreSQL+pgvector** (container `postgres-stevia`), BookStack (`bookstack` + `bookstack-db`).
- Local tourne en Python natif via uvicorn `--reload` (PID variable) — pas dans un container. Toucher un `.py` recharge automatiquement.

## Pipeline RAG (rag_engine.py → rag_answer_streaming)
1. Classifieur intention (`intent_classifier.py`) : bypass cosinus ≥0.88 sinon `intent_model.pkl` (proba≥0.25)
2. Expansion synonymes
3. Recherche vectorielle k=12
4. Recherche mots-clés (complément SQL ILIKE)
5. Reranking (boosts rôle/titre/gras/couverture/préfixe-rôle)
6. Filtrage ML pertinence (`ml/predict.py`, seuil `ML_RELEVANCE_THRESHOLD=0.35`)
7. **best_page_id = page du meilleur chunk** (vote majoritaire supprimé cette session)
8. Complétion contexte (recharge tous chunks de la page)
9. `build_context` : 1 seul chunk envoyé au LLM (min 30 chars de contenu hors [TITRE])

Doc détaillée : `MEMOIRE-STEVIA/notes-en-cours-memoire.md`

---

## Session 2026-06-08/09 — Vision, mode RAW, classifieurs, formatage

### Décisions & changements

**Vision LLM**
- Activée : `rag_engine.py` extrait les URLs `![image](url)` du contexte et les passe à `refine_answer_streaming`.
- `mistral_utils._fetch_image_b64` : **resize Pillow 512px JPEG q80** avant base64 (une capture 1680px passait de ~4000 à ~300 tokens → corrige les erreurs 400 Ollama).
- Fallback auto : si Ollama rejette le payload avec images (HTTPError), retry sans images.
- `pillow` ajouté à `requirements.txt`.
- Constat : pour le simple placement d'URL, le texte suffit (règle 8) ; la vision sert à comprendre le contenu visuel.

**Mode RAW (`RAW_MODE` dans .env)**
- `RAW_MODE=true` → pas de reformulation. Le LLM (`raw_answer_streaming`, prompt `_SYSTEM_RAW`) fait : 1 phrase d'intro + copie verbatim des lignes pertinentes du doc.
- `RAW_OLLAMA_MODEL` (=`qwen2.5:3b`) : modèle dédié au RAW. `_get_raw_model()` lit cette var avec fallback `OLLAMA_MODEL`.
- `_clean_raw_context` : convertit tableaux markdown `| a | b |` → `**nom** : description`, supprime séparateurs `|---|`. Le reste (puces •, titres, sauts de ligne) préservé tel quel.
- `start_stevia.sh` : si RAW_MODE=true → `ollama stop` du modèle principal + télécharge seulement RAW_OLLAMA_MODEL.
- `_extract_relevant_lines` existe mais **plus utilisé** (on laisse le LLM trier).

**Classifieur intention**
- Ajout de seeds "balise AR" + variantes dans `intent_classifier.py` `_VALID`.
- `_SEED_BYPASS_THRESHOLD=0.88` : garde-fou cosinus avant le modèle entraîné (le modèle apprenait "comment fonctionne X" comme invalide).
- `retrain_from_feedback.py` : **les seeds écrasent les labels BDD conflictuels** (normalisation ponctuation), flag `--intent` ajouté, logs seuils seulement quand atteint (plus à chaque feedback).

**rag_engine — sélection chunk & filtrage**
- `build_context` : 1 seul chunk (au lieu de 4), choisit le meilleur chunk de `best_page_id`.
- Seuil longueur min chunk **150 → 30 chars** (ex : "La civilité doit faire 12 caractères" = 47 chars était filtré).
- `best_page_id` = page du meilleur chunk directement (vote majoritaire par comptage supprimé : favorisait à tort les pages à nombreux chunks génériques).
- `is_rejection_response` : ne rejette plus si la phrase de rejet apparaît en fin d'une vraie réponse (>300 chars → check 200 premiers chars seulement). Phrases de rejet élargies.
- `_merge_action_images` : fusionne toute image bloc dans la ligne de texte qui précède (plus seulement mots d'action) → le LLM voit l'image inline.
- Mécanisme `[EXACT]` **supprimé** (règle 8 simplifiée).

**SteviaController.php / main.py (prod + local)**
- Bug source link manquante : `set_time_limit(0)` (PHP tuait à 30s) + traiter le chunk **avant** `isLast()`.
- `\n\n` avant le lien source.
- `main.py` prod : `build_context` 2 params (était 3), try/except streaming.

**chatbot.js**
- Titres markdown `##/###` → `<strong>` + `<br>` après (cache-busting `?v=timestamp` dans base.html.twig).

**bookstack_reader.py**
- Cellules de tableau : préserve sauts de paragraphe `<p>` / `<br>` / `<li>` via placeholder `⏎` (au lieu de tout joindre avec espaces). Converti en `\n` à l'affichage. **Nécessite ré-indexation** pour effet complet ; heuristique de secours dans `_clean_raw_context` pour le contenu déjà indexé.

**ML / dataset (prod-only)**
- `generate_dataset.py` : strip `<think>...</think>` (modèles reasoning type qwen2.5).
- Page ML : compteur "feedbacks non pris en compte" (depuis dernier retrain via `model_meta.pkl`) au lieu de "en attente".

**STEVIA-PROD mis à jour** : copie services (`mistral_utils`, `rag_engine`, `intent_classifier`, `bookstack_reader`), `ml/retrain_from_feedback`, `ml/predict`, `ml/extract_features`. Adapté (pas copie brute) : `SteviaController.php`, `main.py`. Non copié : `synonymes.py`, `scripts/`, `.env`, scripts génération dataset LLM (prod-only).

### Réglages .env actuels (local)
```
OLLAMA_MODEL=qwen2.5vl:7b
RAW_OLLAMA_MODEL=qwen2.5:3b
ML_OLLAMA_MODEL=qwen2.5:3b
RAW_MODE=<voir .env>
ML_RELEVANCE_THRESHOLD=0.35
ML_RETRAIN_THRESHOLD=10
```
LLM options (`mistral_utils.py`) : num_ctx 10240, num_predict 3000 (normal) / 800 (raw), temp 0.0.

### Points en suspens / prochaines étapes
- [ ] **Ré-indexer BookStack** pour activer le placeholder `⏎` dans les cellules de tableau (listes verticales correctes).
- [ ] Vérifier que `qwen2.5:3b` respecte le prompt RAW (préservation `**gras**`, pas de reformulation) — prompt renforcé avec exemple, à tester.
- [ ] Vision : tester si le resize 512px résout bien le 400 sur des questions avec images.
- [ ] Décider si on déploie le mode RAW en prod (STEVIA-PROD pas encore aligné sur raw_answer_streaming / _SYSTEM_RAW).
- [ ] Retrain intention en prod après alignement (flag `--intent`).

---

## Session 2026-07-15/16 — Multi-instances serveur, garde-fous RAG, reranking titre-section, bug contexte RAW

### Contexte serveur / déploiement (discussion, pas de code)
- `deploy_stevia.sh` / `start_stevia.sh` / `update_stevia.sh` tournent **sur le serveur prod** (root, podman rootful). Conteneurs partagés à noms **fixes** : `stevia-container`, `postgres_db`, `ollama`, image `localhost/stevia-python:latest`, port 8001, base `stevia_pgdata`.
- **Une seule instance par serveur** : relancer `deploy` depuis un autre répertoire (ex. BBL/sucre) **écrase** l'existant (même nom/port/image/base) et réécrit le cron `/etc/cron.d/stevia`. Pour 2 instances il faudrait paramétrer nom d'image + base + crons (non fait).
- **Reco** : garder **un seul backend Stevia** ; brancher plusieurs sites Symfony dessus via `STEVIA_API_URL` (côté Symfony). Base partagée = doc/feedbacks mutualisés (désindexer un doc l'enlève pour tous). Décision « même doc synchro vs docs séparées » **toujours ouverte**.
- BBL au démarrage : erreur `403 BookStack` = hôte BookStack absent de `NO_PROXY_LIST` (le proxy intercepte). En réalité il manquait juste `STEVIA_API_URL` côté Symfony → résolu.

### Changements code (local `src/Stevia/` + prod `STEVIA-PROD/`, tous répliqués)
1. **Garde-fou base à 0 vecteur** (`rag_engine.py`, début `rag_answer_streaming` après `get_vector_store`) : `SELECT COUNT(*) FROM langchain_pg_embedding` == 0 → message « documentation pas encore indexée » et `return` **avant** le LLM (sinon hallucination). Message exact ajusté par l'utilisateur.
2. **Affichage source** : « Source » → « **Source principale** » ; texte du lien = **titre de la page** (`best_metadata["title"]`, fallback « Voir la source documentaire »). Les libellés viennent du **Python** (`rag_engine.py`), le JS (`chatbot.js`) ne fait que préserver les blocs `stevia-source`/`stevia-related`.
3. **Boost titre de SECTION intra-chunk** (`rerank_documents`, avant `base_score`) : extrait les titres `##…`/`[TITRE]…` **du contenu du chunk**, matche accent-insensible avec la question → `section_title_boost = min(0.30, 0.15*len(inter))`, soustrait au `base_score`. Corrige le fait que `title_words`/`bold_words` sont au **niveau page** (identiques pour tous les chunks) donc ne distinguaient pas le chunk portant le vrai titre. **Actif sans réindexation.**
4. **BUG CONTEXTE RAW corrigé** (le plus important) : `_merge_action_images` colle « texte + image + texte » sur une seule ligne ; combiné au retrait des lignes `[TITRE]`, ça **effaçait le texte fusionné** (réponses tronquées, voire vides → seule la source s'affiche). Fix : capturer `context_llm_raw = context_llm` **AVANT** `_merge_action_images`, et le mode RAW part de `context_llm_raw` (pré-fusion). Le mode normal garde `context_llm` fusionné. ⚠️ **Sur le serveur prod (édité à la main par l'utilisateur), la ligne `context_llm_raw = context_llm` était placée APRÈS la fusion → à corriger : la remonter juste après `.replace('⏎','\n')`, avant `_merge_action_images`.**

### Abandonné / testé puis reverté (NE PAS reproposer sans accord)
- `build_context` reste à **1 seul chunk** (le mieux scoré de `best_page_id`). Testés puis **annulés** par l'utilisateur : 2-3 chunks même page (padding), intro forcée pour questions définitionnelles, **top-2 chunks globaux + multi-sources** (`_used_source_metas`, affichage « Sources », détection page utilisée). Motifs : padding non pertinent, intro pas toujours pertinente, on ne veut pas mélanger 2 pages.
- **Boost overview définitionnel** (`_DEFINITIONAL_RE`, `_OVERVIEW_TITLE_WORDS`, `_OVERVIEW_BOOST`) : ajouté pour « c'est quoi X » → page de présentation, puis **entièrement retiré** à la demande de l'utilisateur.
- `chunk_size` bookstack_reader 800→1200 testé puis **remis à 800/80**.

### Problèmes RAG encore ouverts
- **Questions définitionnelles** (« c'est quoi sucre ») : bonne page trouvée mais le chunk-définition a un cosinus faible et n'est pas récupéré ; avec 1 seul chunk + choix par pertinence, impossible de le sortir. Seules vraies voies (toutes rejetées pour l'instant) : plusieurs chunks, ou re-ranking par contenu définitionnel. Le **feedback ML ne peut PAS** résoudre ça (c'est un filtre de pertinence sur features numériques, pas une mémoire question→réponse ; au mieux il masque le mauvais chunk).
- **Réponse répartie sur plusieurs chunks consécutifs** (ex. « à quoi servent les échéances de suivi ») : 1 seul chunk envoyé → réponse partielle. Le boost titre-section aide à choisir le bon chunk mais ne règle pas la couverture multi-chunk.

### Mode LLM DIRECT (no-RAG hybride page-level) — EXPÉRIMENTAL, LOCAL uniquement
> Nouveau 4ᵉ mode, construit **en local seulement** (prod non touchée). App **séparée**, le RAG (`main.py`) est intact.

**Idée** : au lieu d'envoyer 1 chunk (tronqué) au LLM, on garde la **recherche sémantique+hybride existante** pour sélectionner les meilleures **pages entières**, et on laisse le LLM chercher/répondre dedans. Compromis : rapide (contexte ciblé) + couverture complète (pages entières, plus de chunk coupé).

**⚠️ Contrainte CERTIF (RNCP 37137, Bloc 3)** : le jury EXIGE un **algorithme supervisé** (Decision Tree/RandomForest…) entraîné (train/test ≥70%) + métriques (accuracy), **intégré dans l'app**. Le LLM direct **seul** (recherche+génération) N'A PAS de supervisé → **ne certifie PAS à lui seul**. C'est le **classifieur de pertinence ML (`ml/predict.py`, Decision Tree)** + le **classifieur d'intention** du RAG qui valident le Bloc 3. → **Ne JAMAIS retirer ces classifieurs.** Pour cohérence, le mode LLM direct les **réutilise aussi** : intention (rejet hors-domaine) au début + `predict_relevance` (Decision Tree) sur les chunks avant sélection des pages (`_retrieve_relevant_pages` renvoie `(statut, page_ids)`, statut ∈ ok/intent_rejected/empty ; fallback rerank si modèle ML pas entraîné). Le LLM direct est donc un **complément/évolution** (bon pour la section « Conclusion → évolution » + comparaison RAG vs no-RAG), pas un remplacement. Framework app = FastAPI (à justifier vs « flask/dash/shiny ») ; 100% local Ollama = argument RGPD ; penser accessibilité handicap.

**Les 4 modes, sur l'axe fidélité** :
- **Reformulation** (`RAW_MODE=false`) : RAG → 1 chunk → LLM reformule.
- **RAW** (`RAW_MODE=true`) : RAG → 1 chunk → LLM choisit des n° de lignes, Python ressort le **verbatim** (zéro corruption).
- **LLM DIRECT** (ce mode) : recherche → **pages entières** → LLM **reformule** (pas de garantie verbatim).

**Fichiers** :
- `services/llm_direct.py` (isolé) : `_retrieve_relevant_pages` (réutilise `rag_engine` : `expand_question`, `extract_search_keywords`, `get_vector_store`, `search_by_keywords`, `merge_keyword_docs`, `dedupe_by_content`, `rerank_documents`) → top-K page_id ; `_load_pages` (recolle les chunks d'une page, dédup overlap, tronque au budget) ; `llm_direct_answer_streaming` (prompt + `_stream_ollama`).
- `main_llm.py` : app FastAPI séparée, endpoints `/ask/stream` (même NDJSON `{"content":...}` que le RAG → widget JS compatible) + `/health`.
- `main.py` : **inchangé**.

**Réglages `.env` (local)** : `LLM_DIRECT_MODEL=gemma3:4b` (128k ctx), `LLM_DIRECT_PAGES=3`, `LLM_DIRECT_NUM_CTX=32768`, `LLM_DIRECT_MAX_DIST=0.55`.

**Lancer / tester** :
```
cd src/Stevia && uvicorn main_llm:app --host 0.0.0.0 --port 8002 --reload   # (RAG=8001 peut être coupé, indépendant)
curl -sN -X POST http://localhost:8002/ask/stream -H "Content-Type: application/json" \
  -d '{"question":"...","roles":["admin"]}' \
  | python3 -c "import sys,json; print(''.join(json.loads(l)['content'] for l in sys.stdin if l.strip()))"
```
⚠️ Changement de `.env` = **redémarrer** `main_llm` (chargé au démarrage). DB dans la base **`stevia`** (pas `postgres`). Python avec deps = `/Users/roni/miniconda3/bin/python3.13`.

**Garde-fous ajoutés** :
- **Seuil de confiance** (`LLM_DIRECT_MAX_DIST`) : si meilleur cosinus > seuil → hors-sujet → refus net sans appeler le LLM.
- **Prompt strict question-focused** : « cherche le fait EXACT dans TOUTES les pages, ne résume pas ; si absent, réponds littéralement *Cette information ne figure pas dans la documentation.* »
- **Classifieurs supervisés intégrés** (`_retrieve_relevant_pages`) : classifieur d'INTENTION (`is_valid_question`) au début → rejet hors-domaine ; classifieur de PERTINENCE ML (`predict_relevance`, Decision Tree) après rerank → filtre les chunks (fallback rerank si modèle pas entraîné). Renvoie `(statut, page_ids)`, statut ∈ ok/intent_rejected/empty. **But certif : garder le Decision Tree actif dans les 2 modes** (Bloc 3 RNCP).

**Déploiement prod = dossier autonome `STEVIA-PROD-LLM/`** (créé cette session) : copie des services PROD + `ml/` + `main_llm.py` + `services/llm_direct.py` (dernière version) + `Dockerfile` (CMD main_llm, EXPOSE 8002) + `deploy_llm.sh` (build image `stevia-llm-python`, conteneur `stevia-llm` sur 8002, partage `postgres_db`+Ollama, pull `gemma3:4b`) + `README.md`. Indépendant du RAG. Prérequis : doc indexée via le RAG (ce mode n'indexe pas).

**Évolutions llm_direct.py (2e itération, toutes en local + STEVIA-PROD-LLM)** :
- **`/health` renvoie `"online"`** (pas `"ok"`) sinon le widget Symfony le croit hors-ligne (`SteviaController::healthCheckStevia` exige `status=='online'`).
- **Pré-traitement identique au RAG** : salutations (« bonjour » → message d'accueil) + question trop courte, AVANT la recherche.
- **Sélection ADAPTATIVE des pages** (`LLM_DIRECT_PAGE_DELTA`, défaut **0.15**) : 1re page toujours ; page suivante ajoutée seulement si son meilleur chunk est à ≤ delta du meilleur score. Réponse claire → 1 page (rapide) ; scores serrés → plusieurs pages. ⚠️ delta trop petit (0.05) rate des réponses sur d'autres pages (civilité p117 exclue) → 0.15 est le bon compromis.
- **Filtre PARAGRAPHE** (`_filter_relevant_paragraphs`, `_q_stems`) : dans les pages retenues, ne garde que les blocs qui (a) contiennent un mot DISTINCTIF de la question — mots courants `_COMMON` (creance, sucre, dossier…) ignorés — OU (b) sont couverts à ≥60% par un CHUNK RÉCUPÉRÉ (recouvrement de MOTS, pas sous-chaîne → robuste aux abréviations « mvt »↔« mouvement »). + images adjacentes. Fallback page entière si <60 car. retenus. → contexte ÷2, moins de needle-in-haystack, plus rapide.
- **Attribution de SOURCE** (`_rank_pages_by_answer`) : après la réponse, la page qui recouvre le plus les mots de la réponse (dont les nombres) devient « Source principale », les autres « Réponses connexes » (mêmes classes CSS que le RAG). Pas de source si refus.
- **Images placées INLINE** (`_compose_with_images`, génération BUFFERISÉE) : chaque image insérée après la phrase dont les mots recoupent son texte voisin (avant+même ligne+après, tokenisation `\w+` pour ignorer le markdown `**`). Petite icône (sz≤40) sans phrase → ignorée ; grande capture sans phrase → « Documentation visuelle ». URL jamais réécrite par le LLM (déterministe, jamais cassée) — car un 4B corrompt/oublie le markdown image.
- **Pas de mention page/étape** : consigne prompt + nettoyage regex (« (Page 1, Etape 1…) », « voir page 10 »).
- ⚠️ **Ne PAS renforcer le prompt _SYSTEM avec un "FOCUS STRICT"** : testé, ça DÉSTABILISE le 4B (il s'accroche à une mauvaise phrase). Le filtre paragraphe est le bon levier pour le focus, pas le prompt.

Panels : v1 `src/Stevia/test_llm_direct.txt` (3 pages fixes, ~14s/q) · v2 `src/Stevia/test_llm_direct_v2.txt` (filtre+adaptatif, ~5s/q). v2 = plus rapide + Q4/Q5/Q19/Q21 mieux ; régressions Q11/Q7 corrigées en passant delta 0.05→0.15 ; restent mineures Q3 (manque 1 en-tête) et Q10 (question double).

**Résultats / enseignements** :
- ✅ Rapide : **< 7s** (3 pages ~19k tokens sur gemma3:4b).
- ✅ « échéances de suivi » : réponse **complète** (le chunk coupé du RAG n'est plus un problème, page entière).
- ⚠️ **Le prompt est décisif** : avec un prompt générique, gemma3:4b **résumait la mauvaise page** (question civilité → réponse hors-sujet) alors que **la bonne page (117) était fournie**. Avec le prompt question-focused → il **extrait le fait** (« civilité = 12 caractères max » ✅). Sur petit modèle, formulation = fiabilité.
- ⚠️ **Reformule** → pas la garantie verbatim du RAW ; un 4B peut rater un fait précis dans un gros contexte (needle-in-haystack) malgré le bon doc → à surveiller.
- Doc totale ≈ **295k car. / ~75k tokens** (88 pages) → « no-RAG intégral » nécessiterait ~128k ctx ; c'est pourquoi on fait du **page-level** (3 pages) et pas tout.

### DÉCISION D'ARCHI (fin de session) — RAW en prod + améliorer la recherche
> L'utilisateur a tranché : **mode RAW pour la prod** (serveur peu de CPU → RAW = rapide ~2s, verbatim = zéro invention). Le **LLM direct / reformulation** = pour plus tard (quand plus de CPU/GPU). Prochain chantier = **améliorer la recherche vectorielle** (bénéficie à TOUS les modes).

**Mode « paragraphes ciblés bornés » ajouté au RAG (`rag_engine.build_para_context`, RAW + reformulation)** :
- `RAG_PARA_BUDGET` (car., 0=off, local=6000≈2 pages) : au lieu d'1 chunk, envoie les paragraphes pertinents des meilleures pages (top-3 pré-ML), plafonné.
- Filtre paragraphe = mot DISTINCTIF question (mots `_PARA_COMMON` ignorés : sucre, creance…) OU couverture ≥60% par un chunk récupéré (sémantique). Titres-seuls exclus. **Dédup** par signature. **Plafond par page** (budget/2). **Troncature à frontière propre** (fin de phrase/•).
- ⚠️ **Autres flags RAG** (défaut off, en local seulement) : `RAG_PAGES` (multi-pages reformulation), `RAG_FULL_PAGE`, `RAG_MIN_RELEVANCE`, `RAG_NUM_CTX`. **RAG_PARA_BUDGET absent des .env prod** (convention) → à ajouter au serveur pour activer.

**Fix reranking « sucre » (important, dans rag_engine, bénéficie à tous les modes)** : le mot « sucre » (+ creance/dossier/outil/application) était dans `_TITLE_BOOST_STOPWORDS` → exclu du boost titre/gras ET du boost titre-section. Sinon une page « …SUCRE » remontait à tort (ex : « objectifs de Sucre » renvoyait la page « Conditions de rapprochement…SUCRE » au lieu de « PRESENTATION GENERALE »). ✅ corrigé.

**Prompt RAW amélioré (`mistral_utils._SYSTEM_RAW`)** : règles de sélection = priorité à la ligne qui répond EXACTEMENT ; terme exact si question sur un mot précis ; minimum de lignes ; exception liste. Améliore workflow/notifier. ⚠️ N'a PAS réglé civilité (qwen2.5:3b choisit tête de mule la ligne « nom 60 » au lieu de « civilité 12 » présente juste au-dessus → plafond du modèle).

**Fallback DÉDUCTION RAW (`RAW_DEDUCE`, `RAW_REASONING_MODEL=gemma3:4b`)** — pour raisonner quand la doc ne répond pas DIRECTEMENT (ex. « NPAI détectés en amont ? » → à déduire de plusieurs passages). Le prompt RAW peut émettre `LIGNES: AUCUNE` → alors `mistral_utils.deduce_answer` (gemma3:4b, prompt `_SYSTEM_DEDUCE`) déduit de façon ENCADRÉE (« D'après la doc, on peut en déduire… », ou refuse si pas d'éléments).
- ✅ La déduction MARCHE quand on lui donne le bon contexte (NPAI déduit correctement « pas de détection auto »).
- ❌ **Déclencheur = STRICT (AUCUNE only)**. Un déclencheur heuristique (recouvrement mots-clés question/réponse) testé puis RETIRÉ : se déclenchait à tort sur des questions factuelles et faisait HALLUCINER la déduction (civilité → « 50 caractères » au lieu de 12). ⚠️ NE PAS reproposer ce déclencheur heuristique.
- ⚠️ En pratique qwen2.5:3b émet rarement AUCUNE → déduction quasi dormante mais SÛRE (ne casse jamais une réponse factuelle). Testé gemma3:4b comme modèle RAW (RAW_OLLAMA_MODEL) : meilleure sélection (workflow) mais + lent (3-8s vs 2s) et n'émet pas plus AUCUNE → **reverté à qwen2.5:3b** (choix B, garder la vitesse CPU). gemma3:4b RAW = à retester quand GPU dispo.
- **Décision finale : UN SEUL modèle** `qwen2.5:3b` pour RAW **et** déduction (`RAW_REASONING_MODEL=qwen2.5:3b`) → pas de 2e modèle en RAM, cohérent CPU. Vérifié : qwen2.5:3b déduit correctement le cas NPAI (« pas de détection auto ») avec le bon contexte.
- **Enseignement mémoire** : « raisonner sans halluciner » sur petit modèle = le plus dur ; seul un déclencheur ultra-conservateur est sûr. Axe évolution = modèle plus gros pour élargir le déclencheur en confiance.

**Panels RAW+para** : `src/Stevia/test_rag_para.txt`. Vitesse **~2s/q** (le + rapide). Verbatim = zéro invention. MAIS justesse inégale : le RAW **sélectionne parfois les mauvaises lignes** dans un contexte large (ex. Q11 civilité : la ligne « civilité 12 caractères » EST dans le contexte mais le RAW choisit « nom/prénom 60 » → faiblesse du modèle qwen2.5:3b, PAS la recherche ni le budget). Dérives Q3/Q4/Q5/Q7/Q19/Q22. **Constat clé : « verbatim » ≠ « bonne réponse » ; plus le contexte est large, moins la sélection RAW est fiable.**

**Comparatif des 3 approches sur le panel 23 Q** :
- LLM direct v2 (`test_llm_direct_v2.txt`) : ~5s, reformule (risque invention), réponses les + propres.
- RAG RAW+para (`test_rag_para.txt`) : ~2s, verbatim, justesse inégale (sélection lignes).
- RAG RAW 1-chunk : ~2s, verbatim précis mais chunk parfois coupé.

### Session suivante — Fixes LISTES + priorité tier + déduction + « 100% » (rejeté)
> Toujours mode RAW+para en prod. Beaucoup de fixes sur la sélection de contexte, tous répliqués local + STEVIA-PROD + STEVIA-PROD-LLM.

**Chaîne de fixes LISTES À PUCES (le gros du travail)** — une liste (en-têtes CSV, conditions notif masse) ressortait incomplète/coupée. 4 causes trouvées et corrigées :
1. **Priorité tier** (`build_para_context`) : sur une longue page mono-sujet (p117 « notification » partout), le budget se remplissait de paragraphes du début (mot-clé) AVANT d'atteindre le chunk pertinent (chunk_index 19). Fix : blocs couverts par un CHUNK RÉCUPÉRÉ (tier 0) émis AVANT les blocs simple-mot-clé (tier 1).
2. **`_merge_bullet_chunks` robuste** (`bookstack_reader.py`) : fusionne les chunks tant qu'une liste chevauche la frontière (chunk qui FINIT ou COMMENCE par une puce), en boucle (listes 3+ chunks), plafond 3000 car. → une liste n'est plus scindée à l'indexation. **A nécessité une RÉINDEXATION** (locale faite ; 457→524 chunks ; la liste CSV p117 passée de 2 chunks à 1 seul, index 17).
3. **Continuité de liste + dédup overlap** (`build_para_context`) : une puce courte (« • « nom » ») sans mot >3 lettres était jetée → cassait la liste ; fix = garder toute puce adjacente à un bloc gardé (propagation). + dédup des lignes dupliquées par le chunk_overlap.
4. **Expansion INTRO de liste** (`_build_raw_answer`) : le RAW sélectionnait l'intro « …suivantes : » SANS les puces → fix = si une ligne sélectionnée finit par « : », englober le bloc de puces qui suit.

**Retry RAW** (`raw_select_lines`) : le modèle peut renvoyer VIDE s'il est froid → retry 1×. ⚠️ Si Ollama a un runtime corrompu (3 modèles en RAM, redémarrages rapides → `done_reason: None`, générations vides/erratiques), le retry ne suffit pas → **recharger le modèle** : `curl http://localhost:11434/api/generate -d '{"model":"qwen2.5:3b","keep_alive":0}'`. Non-souci en prod (serveur dédié).

**Fix reranking « sucre »** : `_TITLE_BOOST_STOPWORDS` (sucre, creance, dossier, outil, application) exclus du boost titre/gras ET titre-section → une page « …SUCRE » ne remonte plus à tort (« objectifs de Sucre » → bonne page 114).

**« Envoyer uniquement les chunks 100% pertinents » (proba ML) → TESTÉ puis REJETÉ.** Le classifieur ML de pertinence est un **FILTRE binaire**, PAS un classeur fiable : il donne >90% à beaucoup de chunks, et se TROMPE sur les questions ambiguës (civilité courte → note « libellé 50 car. » à 93% et filtre la vraie page 117). Toutes les variantes (envoyer que les 100% / prioriser les pages 100%) régressaient civilité. ⚠️ **NE PAS refaire.** Code mort supprimé (`build_context_from_chunks`, `predict_relevance_scored`). **Ce qui décide quoi envoyer = le SCORE DE RERANK (classement continu), pas la proba du classifieur (filtre oui/non).** `build_para_context` priorise déjà les chunks récupérés par rerank (tier 0) = signal fiable.

**Civilité = 2 problèmes de RECHERCHE (pas de contexte), non résolus** : (1) question COURTE « combien de caractères… civilité » → récupère pages 246/169 (balises/libellé) au lieu de 117/118 ; (2) question COMPLÈTE → bonne page 117 mais le RAW choisit « nom 60 » au lieu de « civilité 12 » (plafond qwen2.5:3b). → chantier RECHERCHE + modèle plus gros.

### Fix TRI DES BLOCS PAR RANG DE CHUNK (build_para_context)
- Problème signalé (« conditions notif masse ») : contexte tronqué à 5 conditions/10. Le chunk #1 (17, les 10 conditions) était bien récupéré, MAIS `build_para_context` gardait les blocs par ORDRE DE LECTURE → le contenu moins pertinent placé plus tôt dans la même longue page (notification, débiteur) remplissait `per_page_cap` avant d'atteindre les conditions (tard dans la page).
- Fix : `ret_ranked` = chunks récupérés triés par SCORE (meilleur d'abord) ; `tier[bloc]` = RANG du chunk qui le couvre (0 = chunk le + pertinent). block_order = (tier, i) → les blocs du chunk #1 (la réponse) passent AVANT ceux des chunks moins pertinents de la même page. → 10 conditions complètes. Doc mémoire : `MEMOIRE-STEVIA/EVALUATION-ET-AMELIORATIONS.md` (méthodo + tableau 20 Q).

### Fix COMPLÉTION DE LISTE (RAW) — +15 pts de justesse
- Problème signalé : « À quoi servent les échéances » → le RAW prenait « induites » mais SAUTAIT « manuelles » (liste coupée). Le contexte était complet ; c'est la sélection RAW qui ne prenait qu'une puce.
- Cause : l'expansion « compléter le bloc de puces » était gatée par `_list_intent` (mots « quelles/liste… ») → ne fichait pas sur « à quoi servent ».
- Fix (`_build_raw_answer`) : **retiré le gate `_list_intent`** → dès que le RAW sélectionne UNE puce (ou une intro « … : »), on complète TOUJOURS le bloc de puces contigu + l'intro. Sûr en RAW (verbatim). ⚠️ NE PAS remettre le gate.
- **Mesuré : RÉPONSE JUSTE 65% → 80%** (recall recherche inchangé 90-100%). Reste des faux négatifs (« objectifs » donne la bonne liste mais saute la phrase-marqueur → réel > 80%).
- ⚠️ **debug-classifieurs affiche la REFORMULATION** (`refine_answer_streaming`), PAS le RAW → elle HALLUCINE (normal, c'est pourquoi prod=RAW). Ne pas juger la prod sur la « réponse générée » du debug.

### Test modèle RAW plus gros — FAIT, CONCLUSION : la taille du modèle n'aide PAS
- **Baseline** `qwen2.5:3b` RAW → **RÉPONSE JUSTE 65%** (recall recherche 90-100%).
- `qwen2.5vl:7b` (vision) → **60%** (pire) + lent. Non concluant (vision).
- **`qwen2.5:7b` (texte pur, téléchargé et testé) → 65% = IDENTIQUE au 3b, mais PLUS LENT.** Mêmes 7 « échecs » au marqueur (dont certains = faux négatifs : « objectifs » donne en fait la bonne liste mais saute la phrase-marqueur ; « notifier » choisit « commentaire » au lieu de « logo W » = vraie erreur différente mais pas meilleure).
- **CONCLUSION (importante pour le mémoire)** : doubler la taille du modèle (3b→7b) N'améliore PAS la justesse (65%→65%) et coûte de la vitesse. **Le goulot n'est PAS la taille du modèle de sélection** — c'est plus fondamental (ambiguïté de récupération sur questions courtes + nature de la tâche RAW). → **reverté à qwen2.5:3b** (même qualité, plus rapide). Le test 7B reste dispo (modèle téléchargé) mais inutile en prod.
- **Ménage modèles Ollama LOCAL** : supprimés `qwen2.5vl:7b` (6 Go) + `gemma3:1b`. Ajouté `qwen2.5:7b` (test). `OLLAMA_MODEL` local repointé vers `qwen2.5:3b`. ⚠️ Local seulement, `.env` prod NON touché.

### Session — ÉVALUATION MESURÉE de la recherche + filtre ML reject-only
> Enfin des CHIFFRES au lieu d'impressions. Harnais réutilisable créé.

**Harnais d'éval `src/Stevia/eval/`** (`run_eval.py` + `eval_set.py`) : 20 questions avec un « marqueur de réponse » ; le script trouve la page-cible en base via le marqueur, lance la vraie recherche, calcule **recall@1/3/K** (rerank) + top-1 après filtre ML. Lancer : `cd src/Stevia && python3 eval/run_eval.py` (Python conda). Étendre le jeu dans `eval_set.py`.

**5 MÉTRIQUES mesurées** (le harnais interroge aussi le serveur :8001 pour la justesse bout-en-bout) :
- **Recall@1 rerank = 90%** (bonne page 1re), **Recall@3 = 95%**, **Recall@K = 100%** (bonne page toujours dans les 12) → **la recherche vectorielle est BONNE**, elle ne « casse » pas le sens. L'impression « le RAG ne comprend pas » venait d'ailleurs.
- **TOP1 après filtre ML = 80-85%** : le classifieur de pertinence DÉGRADE le choix de page (promeut une page « ressemblante », ex. intégration 136→166, libellés 242→243).
- **RÉPONSE JUSTE (bout-en-bout) = 65%** (borne BASSE : test = présence du marqueur exact dans la réponse → quelques faux négatifs comme « notifier »). **CONSTAT CLÉ : l'écart 100% recall → 65% réponse juste = TOUTE la perte est APRÈS la recherche** (sélection de lignes RAW qwen2.5:3b + génération), PAS la recherche. Le goulot = le petit modèle, pas le RAG.

**Fix : `RAG_ML_REORDER=false` (nouveau défaut, mesuré meilleur)** — le classifieur de pertinence (Decision Tree, `ml/predict.py`) TOURNE toujours (certif Bloc 3 + rejet des hors-sujet) mais NE réordonne PLUS le choix de page → on garde l'ordre du **rerank** (top-1 90%). Rappel : le « filtre ML » = classifieur de PERTINENCE (pas l'intention). C'est un FILTRE binaire, pas un classeur fin → on ne s'y fie pas pour le classement. ✅ intégration + libellés génériques corrigés, aucune régression.

**Rôle actif du classifieur en reject-only (`ml.predict.drop_low_relevance`)** : en mode `RAG_ML_REORDER=false`, le classifieur ne se contente pas de rejeter — il **FILTRE le bruit** : retire les chunks franchement non pertinents (proba < 0.15) du contexte, **sans réordonner** (ordre du rerank conservé), + **garde-fou** (rejet si aucun chunk n'atteint 0.35). Donc il a un rôle CONCRET et SÛR (nettoyage) sans décider quelle page gagne. Pour le mémoire : le présenter comme filtre de pertinence + garde-fou + boucle de réentraînement (cycle de vie ML), PAS comme « le cerveau ». Axe évolution = l'améliorer (features, données feedback) pour le rendre assez fiable pour classer.

**Les vraies causes des mauvaises réponses (mesurées)** : (1) le filtre ML réordonnait mal → corrigé ; (2) la sélection de LIGNES du RAW (qwen2.5:3b) sur la bonne page (civilité « nom 60 ») → modèle plus gros ; (3) déduction (NPAI) → non déclenchée car le RAW trouve « quelque chose » à dire (icône) au lieu d'AUCUNE. NPAI reste non résolu (question de déduction).

### Fix DEBUG = mode réel (RAW + paragraphes bornés)
- Demande : « le contexte de la page debug = celui réellement utilisé » (la page debug ne sera pas en prod).
- Avant : `/debug/pipeline` (main.py) construisait le contexte via l'ancien `build_context` (1 chunk) + `refine_answer_streaming` (reformulation → hallucinait) → divergeait de la prod (RAW + `build_para_context`).
- Fix : nouvelle fonction `rag_engine.build_debug_answer(docs_with_scores, expanded, question, roles, preranked_pages)` qui **reproduit exactement** le chemin prod (filtre ML reject-only, reload des pages, `build_para_context` si `RAG_PARA_BUDGET>0`, puis `_build_raw_answer` si `RAW_MODE=true`). Renvoie `(context_sent, answer, mode)`, mode ∈ raw/reformulation/reject.
- `main.py` `/debug/pipeline` : calcule `preranked_pages` comme la prod et appelle `build_debug_answer` (au lieu de build_context + refine). JSON ajoute `answer_mode`.
- Template `debug-classifieurs.html.twig` : titre « Contexte réellement utilisé » + badge « mode RAW (prod) », header réponse dynamique selon `answer_mode`.
- ⚠️ Tableau des chunks (proba pertinence) inchangé. `retained_docs` devenu inutilisé dans l'endpoint (inoffensif). Testé sur :8001 (« échéances de suivi ») → `mode: raw`, contexte para + réponse verbatim = OK.
- **Note mémoire obsolète** : l'ancien avertissement « debug affiche la reformulation qui hallucine » n'est plus vrai (debug = RAW maintenant). Non répliqué en prod (page debug hors-prod).

## Session 2026-08-03 — CACHE SÉMANTIQUE Q/R (nouveau, LOCAL uniquement)

> Ajout d'un cache des questions/réponses fréquentes au RAG. But : resservir une FAQ en **~0.13s sans LLM** (précieux vu la contrainte CPU prod). Voir mémoire `project_qa_cache.md`.
> **Réplication prod (2026-08-05) : BACKEND répliqué dans `STEVIA-PROD/`** (`qa_cache.py` neuf + hooks `rag_engine.py`/`main.py`), **pas encore déployé sur le serveur** (via `update_stevia.sh`). **PAS la page admin** (choix utilisateur : backend seulement ; retrait par 👎). `.env` prod non touché → défauts 0.90/0.80/500. Table auto-créée au démarrage. Détails : `STEVIA-PROD/CHANGES_LOCAL.md`.

### Principe (flux final DÉCIDÉ = automatique, sans validation admin)
- Colonne `status` sur la table `stevia_qa_cache` : `pending` (question répondue → entrée invisible) → `approved` (un **👍 met DIRECTEMENT en cache** = servable) ; un **👎 supprime** l'entrée.
- **Lookup à 2 BANDES** au début de `rag_answer_streaming` (après garde « trop court », avant intent) : embedding de la question (`qwen3-embedding:0.6b`, 1024d) → plus proche voisin `approved` **des mêmes rôles** via pgvector `<=>`. Si **sim ≥ 0.90** → hit DIRECT (rejoue + `return`, pas de recherche ni LLM). Si **0.80 ≤ sim < 0.90** → candidat à CONFIRMER : on laisse la recherche tourner et on ne rejoue le cache QUE si `best_page_id == page_id` de la réponse cachée (check juste après `best_page_id`). Sinon pipeline normal, puis `store_pending` à la fin (si pas un rejet).
- **Réponse cachée = `payload.answer`** (le texte exact vu par l'utilisateur, capturé au 👍 → réplique à l'identique, source comprise).

### Fichiers (local `src/Stevia/` + Symfony)
- **`services/qa_cache.py`** (nouveau, isolé) : `lookup_candidate / mark_served / store_pending / validate(👍) / purge(👎) / invalidate_pages / invalidate_book / invalidate_all / _enforce_limit / has_approved / list_entries / delete_entry / init_cache_table`. Table `vector(1024)`, clé par **rôles** (pas de fuite inter-rôles), correspondance question **normalisée** (salutation/casse/ponctuation), colonnes `book_id`+`page_id`+`last_served_at`, migration douce de l'ancien schéma booléen.
- **`rag_engine.py`** : lookup au début + `store_pending` à la fin. Embedding calculé 1× et réutilisé.
- **`main.py`** : `init_cache_table()` au startup ; `/feedback` → `validate`(👍)/`purge`(👎) + marqueur **`(issue du cache)`** dans le log feedback existant si la réponse venait du cache (`has_approved`) ; endpoints `GET /cache/list`, `DELETE /cache/{id}`. Suppression d'un livre → `invalidate_book(book_id)`.
- **Invalidation CIBLÉE PAR PAGE** (chaque entrée stocke `book_id`+`page_id` de sa source) : dans `rag_engine.index_bookstack_book`, on compare le contenu par page **AVANT** (index actuel = mémoire de l'état précédent, colonne `document`) vs **APRÈS** (nouveaux docs) → `qa_cache.invalidate_pages(pages_changées)`. Empreinte = `_hash_page` = md5 du **multi-ensemble trié** des chunks (⚠️ ordre-indépendant : `langchain_pg_embedding.id` est un UUID → `ORDER BY id` scramble l'ordre). Aucune table de suivi : on réutilise l'index + la source déjà stockés. Seules les réponses des pages **réellement modifiées** sont jetées (pas tout le livre, pas tout le cache).
- **`SteviaController.php`** : routes proxy `stevia_cache` (page), `stevia_cache_list`, `stevia_cache_delete`.
- **`templates/stevia/cache.html.twig`** (nouveau) : page **« Cache réponses »** (menu SUCRE, `base.html.twig`) = vue de **gestion** (liste des réponses en cache : question · rôles · nb de fois posée · date · aperçu · 🗑️ **Retirer du cache**).
- **`.env` local** : `QA_CACHE_THRESHOLD=0.90` (hit direct), `QA_CACHE_VERIFY_THRESHOLD=0.80` (bande de vérif), `QA_CACHE_MAX_ENTRIES=500` (plafond). ⚠️ **Plus de `QA_CACHE_ENABLED`** : le cache est TOUJOURS actif (seule condition : base joignable, via `is_enabled()` = `_ENGINE is not None`).
- **Plafond + éviction** : max `QA_CACHE_MAX_ENTRIES` réponses `approved` (0=illimité). Au-delà (déclenché à chaque 👍 dans `validate` → `_enforce_limit`), on GARDE les plus demandées et on retire le surplus (tri conservation : `hits ↓, last_served_at ↓ NULLS LAST, approved_at ↓` → protège les entrées récentes : une réponse fraîche jamais servie n'est pas éjectée avant une vieille jamais demandée). Colonne `last_served_at` (maj dans `mark_served`). Ordre de grandeur : 500 entrées ≈ 4 Mo, lookup <1 ms ; vrai plafond technique ~10 000 (au-delà : ajouter un index HNSW sur `question_emb`).
- **Lookup à 2 BANDES** (résout le compromis du seuil) : sim ≥ 0.90 → hit direct (sans recherche) ; **0.80 ≤ sim < 0.90 → on ne sert QUE si la recherche retombe sur la MÊME page source** (`page_id`) que la réponse cachée. Rattrape les vraies reformulations (« objectifs de l'appli sucre » 0.849 → même page → HIT) sans risquer de servir « relancer » pour « notifier » (pages ≠). `lookup_candidate` + `mark_served(verified)` ; check dans `rag_engine` juste après `best_page_id`. Logs console réécrits en clair.

### Logs (nettoyés à la demande)
- Supprimé les lignes dédiées `[QACache] VALIDÉ/PURGÉ/HIT` (le feedback +/− est déjà loggé).
- À la place : marqueur **`(issue du cache)`** dans la ligne `Feedback positif/négatif` **quand l'avis porte sur une réponse servie du cache** (donc à partir du 2ᵉ avis sur une même question) ; et en **console serveur** (stdout uvicorn, à l'emplacement du contexte LLM), phrases réécrites en clair : `=== Réponse renvoyée depuis le CACHE (aucun calcul, aucune IA) — question déjà posée, ressemblance X% ===` (hit direct) / `… — reformulation reconnue : même page de doc, ressemblance X% ===` (bande de vérif). Logs d'invalidation : `[Cache] Réindexation : N réponse(s) retirée(s)…` / `[Cache] Suppression du livre X : N…` / `[Cache] Plafond 500 atteint : N…`.

### ENSEIGNEMENT CLÉ — le seuil (mesuré)
Sur `qwen3-embedding:0.6b`, la similarité **question↔question** est faible même pour de vraies reformulations (0.74–0.83), MAIS des questions **différentes mais confusables** montent aussi haut (« notifier » vs « relancer » un débiteur = **0.787**). Les deux plages **se chevauchent** → aucun seuil seul ne sépare paraphrases et questions-différentes. D'où le **hit direct à ≥0.90** (quasi identiques only). **RÉSOLU pour les reformulations** par la **bande de vérif 0.80–0.90 + confirmation par la page source** (voir Principe) : « objectifs de l'appli sucre » (0.849) fait maintenant HIT car même page 114, sans risque de faux hit (une question différente retombe sur une autre page). Élargir encore = meilleur modèle d'embedding, ou vérif cross-encoder/LLM. **Axe évolution mémoire.**

### Étapes abandonnées cette session (NE PAS reproposer sans accord)
- **Validation admin à 2 étages** (👍 → « proposée » → admin « approuve » → servable) : construite (statut `proposed`, page de modération, endpoint `/cache/{id}/approve`) **puis retirée** — l'utilisateur préfère le **tout-automatique** (👍 = cache direct, 👎 = retrait). La page reste en **gestion/retrait** seulement.

### Benchmark — gain de temps mesuré (2026-08-05, local, mode RAW qwen2.5:3b, modèle déjà chargé)
| Question (originale → reformulée) | Sans cache (génération) | Avec cache (rejeu) | Gain |
|---|---|---|---|
| « comment notifier un débiteur » | 2,95 s | 0,13 s | **~23× (−96 %)** |
| « c'est quoi les objectifs de sucre » | 1,58 s | 0,46 s | **~3× (−71 %)** |
| « conditions de notification en masse » | 2,97 s | 0,60 s | **~5× (−80 %)** |
| **Moyenne** | **~2,5 s** | **~0,4 s** | **~6× (−84 %)** |

- Deux régimes de hit : **hit direct** (sim ≥ 0.90) ≈ **0,13 s** (aucune recherche ni LLM) ; **hit via vérif page** (0.80–0.90) ≈ **0,5 s** (recherche vectorielle faite, mais **pas d'appel LLM**). Dans les deux cas on économise la génération LLM = le poste le plus coûteux.
- ⚠️ Mesuré en local. **Sur le serveur prod (CPU sans GPU), la génération est plus lente → le gain relatif du cache est ENCORE plus grand.** Bon argument mémoire (perf + coût d'inférence + charge CPU).

### À faire (cache)
- [ ] Tester soi-même dans le widget (`http://localhost:8000/`) puis via la page « Cache réponses ».
- [ ] Décider réplication `STEVIA-PROD/` (+ `STEVIA-PROD-LLM/` ?) avec la migration `status`.
- [ ] Éventuel : TTL/expiration, badge compteur menu, rendu HTML de l'aperçu réponse.

### Note terminal (hors code)
- Écho terminal désactivé (frappe invisible) = TTY laissé en `-echo` par un process (serveur en fond, `ollama pull`, Ctrl-C). Fix : `stty sane` (ou `reset`) tapé à l'aveugle + Entrée. Réflexe : lancer les serveurs longue durée dans un terminal dédié.

---

### À faire — REFACTO rag_engine.py (plus tard, après déploiement cache)
- [ ] Découper `rag_engine.py` (2191 lignes) **par concern**, PAS « fonction principale vs reste ». Ordre : extraire d'abord `rag_core.py` (db_exec, ENGINE, embeddings, get_vector_store, constantes → évite les imports circulaires), puis `indexation.py` (le + isolé, ~110 lignes), puis `search.py` (recherche+rerank+dedupe), `context_builder.py` (build_context/build_para_context/_build_raw_answer/images). `rag_engine.py` garde l'orchestration (`rag_answer_streaming`, `build_debug_answer`).
- [ ] **Garde-fou** : lancer `eval/run_eval.py` avant/après chaque extraction (recall inchangé = OK).
- [ ] ⚠️ Coût réel = re-synchro sur `STEVIA-PROD/` + `STEVIA-PROD-LLM/` (1→5 fichiers). À faire quand le cache est déployé et stable. Décidé le 2026-08-05 : « on fera ça plus tard ».

### À faire prochaine session — AMÉLIORER LA RECHERCHE (priorité)
- [ ] **Améliorer la récupération** (bénéficie à tous les modes) : pistes = expansion synonymes/abréviations (mvt, PSS, ANV, NPAI…) ; tuning rerank ; meilleure indexation des tableaux (les en-têtes CSV Q3 sont dans un tableau mal récupéré) ; requêtes définitionnelles.
- [ ] Décider si le RAW prod garde **para** (couverture, mais dérives sélection) ou revient à **1 chunk** (précis mais chunk coupé). Q11 échoue dans les deux → c'est le modèle RAW, pas le contexte.
- [ ] **Déployer `STEVIA-PROD-LLM/` sur le serveur et mesurer la VITESSE** (serveur souvent CPU sans GPU → no-RAG page-level peut être lent). C'est LE critère pour décider : si acceptable → mode LLM direct possible en prod ; sinon → RAG en prod, LLM direct présenté comme évolution/comparaison dans le mémoire.
- [ ] Mode LLM direct : tester la **fidélité** sur plus de questions (pointue / définitionnelle / hors-sujet → refus). Éventuellement variante « RAW sur pages entières » pour garder le verbatim.
- [ ] Tester en local puis prod (`update_stevia.sh`) : boost titre-section + fix contexte RAW sur « à quoi servent les échéances de suivi » (réponse complète attendue).
- [ ] **Corriger l'ordre de `context_llm_raw` sur le serveur prod** (avant `_merge_action_images`).
- [ ] Trancher l'archi BBL : backend partagé (via `STEVIA_API_URL`) vs instance dédiée.
- [ ] Décider si on reprend le sujet « réponse multi-chunk » (définitionnel + réponses réparties) via re-ranking contenu ou envoi de plusieurs chunks.
