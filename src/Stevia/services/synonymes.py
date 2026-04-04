SYNONYMES = {

    # Raccourcis courants
    "notif": "notification",
    "notifs": "notifications",
    "param": "paramètre",
    "params": "paramètres",
    "config": "configuration",
    "admin": "administrateur",
    "doc": "document",
    "docs": "documents",
    "mdp": "mot de passe",
    "pb": "problème",
    "msg": "message",
    "msgs": "messages",
    "info": "information",
    "infos": "informations",
    "maj": "mise à jour",
    "bdd": "base de données",
    "appli": "application",
    "ordo": "ordonnancement",
    "pj": "pièce jointe",
    "pjs": "pièces jointes",
    "pq": "pourquoi",

    # Termes métier SUCRE/CPAM
    "wf": "workflow",
    "eta": "fichier ETA",
    "mouv": "fichier MOUV",
    "prod": "production",
    "dev": "développement",
    "qualif": "qualification",
    "consult": "consultation",
    "mec": "montée en charge"
}

def expand_question(question: str) -> str:
    """Remplace les raccourcis par leurs synonymes."""
    words = question.split()
    expanded_words = []

    for word in words:
        clean_word = word.lower().strip(".,?!:;")
        punctuation = word[len(clean_word):] if len(word) > len(clean_word) else ""

        if clean_word in SYNONYMES:
            expanded_words.append(SYNONYMES[clean_word] + punctuation)
        else:
            expanded_words.append(word)

    expanded = " ".join(expanded_words)

    if expanded != question:
        print(f"Question enrichie : '{question}' → '{expanded}'")

    return expanded