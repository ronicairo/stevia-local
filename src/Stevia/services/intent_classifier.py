import os
import numpy as np
from functools import lru_cache
from pathlib import Path
from langchain_ollama import OllamaEmbeddings

_VALID = [
    "comment créer un workflow",
    "à quoi sert la phase amiable",
    "quelle est la date de prescription",
    "comment notifier une créance",
    "que faire si le débiteur est décédé",
    "comment paramétrer les délais dans sucre",
    "qu'est-ce que la relance biennale",
    "comment fonctionne le recouvrement contentieux",
    "procédure de contestation d'une créance",
    "créer une adresse débiteur",
    "intégration journée comptable heure",
    "habilitations utilisateurs sucre",
    "comment suspendre un dossier",
    "différence entre phase amiable et contentieuse",
    "comment envoyer une mise en demeure",
    "quel est le délai de prescription",
    "comment fonctionne l'opposition amiable",
    "que signifie le statut ar contrainte",
    # Questions de validation fonctionnelle SUCRE
    "quels sont les objectifs de sucre",
    "à quoi servent les échéances de suivi",
    "quelles sont les en-têtes obligatoires du csv dans les notifications en masse",
    "quelles sont les conditions à respecter dans les notif en masse",
    "à quoi correspondent les créances inférieures à 0,68% pss sans mouvement",
    "à quelle heure a lieu l'intégration de la journée comptable",
    "à quoi sert le champ date transmission pôle",
    "à quoi sert le champ date manifestation débiteur",
    "quelles sont les étapes minimum que doit avoir un workflow",
    "qu'est-ce qu'un workflow",
    "qu'est-ce que le calendrier",
    "lors de la création d'une adresse débiteur combien de caractères maximum pour le champ civilité",
    "à quoi servent les libellés génériques",
    "à quoi sert l'onglet aide mémoire",
    "c'est quoi les libellés notifications",
    "à quoi sert l'épuration des données de la base",
    "c'est quoi les créances à monter en charge",
    "comment vérifier la date de détection de la créance en fonction du délai de régularisation du fichier csv",
    "à quoi sert la balise date_ar_med",
    "comment fonctionne la balise AR",
    "à quoi sert la balise AR",
    "qu'est-ce que la balise AR",
    "comment utiliser les balises dans un modèle sucre",
    "quelles balises sont disponibles dans sucre",
    "comment fonctionne la balise date envoi",
    "liste des balises disponibles",
]

_INVALID = [
    "un deux test",
    "bout en train",
    "comment ça va",
    "azertyuiop",
    "test test test",
    "1 2 3",
    "quelle belle journée",
    "je veux démissionner",
    "tu fais quoi ce soir",
    "allo allo",
    "bla bla bla",
    "abc def ghi",
    "il fait beau",
    "bonjour je suis là",
    "micro test sonore",
    "coucou tu m'entends",
    # Questions hors-domaine bien formées
    "quand est mort napoléon",
    "quelle est la capitale de la france",
    "qui a écrit les misérables",
    "comment faire une tarte aux pommes",
    "quel est le résultat de 15 fois 8",
    "c est quoi la photosynthèse",
    "qui a gagné la coupe du monde 2022",
    "comment soigner un rhume",
    "quelle est la distance entre paris et lyon",
    "c est quoi un trou noir",
    "comment apprendre le python",
    "qui est le président de la république",
    "quelle est la recette du couscous",
    "comment perdre du poids rapidement",
    "c est quoi le machine learning",
    "quelle est la population mondiale",
    "comment créer une entreprise",
    "qui a inventé internet",
    "quel est le pays le plus grand du monde",
    "comment fonctionne un moteur électrique",
    "quelle est la durée de vie moyenne d un chien",
    "c est quoi le bitcoin",
    "comment faire du pain maison",
    "qui a peint la joconde",
    "quel est le film le plus regardé au monde",
    "comment apprendre une langue étrangère",
    "c est quoi l intelligence artificielle",
    "quelle est la vitesse de la lumière",
    "qui est albert einstein",
    "comment fonctionne la bourse",
    "quelle est la hauteur de l everest",
    "comment dormir mieux",
    "c est quoi la démocratie",
    "qui a découvert la pénicilline",
    "quel est l animal le plus rapide",
    "comment réparer un vélo",
    "c est quoi un algorithme",
    "quelle est la différence entre virus et bactérie",
    "comment fonctionne un avion",
    "qui est mozart",
    "quel est le livre le plus vendu de l histoire",
    "comment investir en bourse",
    "c est quoi la relativité",
    "quelle est la profondeur de l océan",
    "comment faire du sport à la maison",
    "qui est darwin",
    "quel est le salaire minimum en france",
    "comment fonctionne un vaccin",
    "c est quoi la conscience",
    "quelle est l origine de l univers",
]


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


@lru_cache(maxsize=1)
def _load_prototypes():
    """Calcule les embeddings des exemples une seule fois au premier appel."""
    _host = os.getenv("OLLAMA_HOST", "127.0.0.1")
    model = OllamaEmbeddings(
        model="qwen3-embedding:0.6b",
        base_url=f"http://{_host}:11434",
    )
    valid_vecs   = np.array(model.embed_documents(_VALID))
    invalid_vecs = np.array(model.embed_documents(_INVALID))
    return model, valid_vecs, invalid_vecs


@lru_cache(maxsize=1)
def _load_trained_model():
    """Charge le modèle entraîné depuis intent_model.pkl s'il existe."""
    model_path = Path(__file__).parent.parent / "ml" / "dataset" / "intent_model.pkl"
    if model_path.exists():
        import joblib
        return joblib.load(model_path)
    return None


_SEED_BYPASS_THRESHOLD = 0.88

def is_valid_question(question: str) -> bool:
    """
    Retourne True si la question ressemble à une vraie question SUCRE.
    Utilise le modèle entraîné (intent_model.pkl) s'il existe,
    sinon fallback sur la similarité cosinus avec les prototypes.
    En cas d'erreur Ollama, laisse passer (True).
    """
    try:
        model_emb, valid_vecs, invalid_vecs = _load_prototypes()
        q_vec = np.array(model_emb.embed_query(question))

        # Garde-fou : très proche d'un seed valide → valide sans passer par le modèle
        max_valid = max(_cosine(q_vec, v) for v in valid_vecs)
        if max_valid >= _SEED_BYPASS_THRESHOLD:
            return True

        trained = _load_trained_model()
        if trained is not None:
            proba = trained.predict_proba(q_vec.reshape(1, -1))[0]
            # classes_ = [0=invalid, 1=valid] ; seuil conservateur pour éviter les faux négatifs
            proba_valid = float(proba[1])
            return proba_valid >= 0.25

        max_invalid = max(_cosine(q_vec, iv) for iv in invalid_vecs)
        return max_valid >= max_invalid

    except Exception:
        return True
