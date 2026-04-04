"""
Entraînement du classifieur de pertinence RAG.

Algorithmes testés :
  - Random Forest
  - K-Nearest Neighbors
  - Decision Tree
  - Logistic Regression

Métriques : Accuracy, Precision, Recall, F1-score, AUC-ROC
Split      : 70 % entraînement / 30 % test (stratifié)

Usage :
    python /app/ml/train_model.py [--dataset stevia_relevance_dataset.csv]
"""

import sys
import argparse
import warnings
from pathlib import Path

import pandas as pd
import numpy as np
import joblib

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, classification_report,
)

warnings.filterwarnings("ignore")

DATASET_DIR = Path(__file__).parent / "dataset"
FEATURE_COLS = [
    "cosine_score", "keyword_match_count", "keyword_match_ratio",
    "chunk_length", "title_match", "role_match",
    "query_length", "rank_position", "book_id",
]


# ─── Chargement et préparation ─────────────────────────────────────────────────
def load_data(filename: str) -> tuple:
    path = DATASET_DIR / filename
    if not path.exists():
        print(f"  ✗ Dataset introuvable : {path}")
        print("  → Lancer d'abord : python /app/ml/generate_dataset.py")
        sys.exit(1)

    df = pd.read_csv(path)
    print(f"  Dataset chargé : {len(df)} lignes, {df['label'].sum()} positifs ({df['label'].mean()*100:.1f} %)")

    # Encoder book_id (catégoriel → entier consécutif)
    le = LabelEncoder()
    df["book_id"] = le.fit_transform(df["book_id"].astype(str))

    X = df[FEATURE_COLS].values
    y = df["label"].values
    return X, y, le


# ─── Définition des modèles ────────────────────────────────────────────────────
def get_models() -> dict:
    return {
        "Random Forest": Pipeline([
            ("clf", RandomForestClassifier(n_estimators=100, random_state=42, class_weight="balanced")),
        ]),
        "KNN": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", KNeighborsClassifier(n_neighbors=5)),
        ]),
        "Decision Tree": Pipeline([
            ("clf", DecisionTreeClassifier(max_depth=8, random_state=42, class_weight="balanced")),
        ]),
        "Logistic Regression": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=500, random_state=42, class_weight="balanced")),
        ]),
    }


# ─── Évaluation ────────────────────────────────────────────────────────────────
def evaluate(model, X_test, y_test) -> dict:
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else y_pred
    return {
        "accuracy":  round(accuracy_score(y_test, y_pred), 4),
        "precision": round(precision_score(y_test, y_pred, zero_division=0), 4),
        "recall":    round(recall_score(y_test, y_pred, zero_division=0), 4),
        "f1":        round(f1_score(y_test, y_pred, zero_division=0), 4),
        "auc_roc":   round(roc_auc_score(y_test, y_proba), 4) if len(np.unique(y_test)) > 1 else 0.0,
    }


# ─── Importance des features ───────────────────────────────────────────────────
def print_feature_importance(model):
    clf = model.named_steps.get("clf")
    if hasattr(clf, "feature_importances_"):
        importances = clf.feature_importances_
        pairs = sorted(zip(FEATURE_COLS, importances), key=lambda x: x[1], reverse=True)
        print("\n  Importance des features (Random Forest) :")
        for feat, imp in pairs:
            bar = "█" * int(imp * 40)
            print(f"    {feat:<25} {imp:.4f}  {bar}")


# ─── Main ──────────────────────────────────────────────────────────────────────
def main(filename: str):
    print("=" * 65)
    print("  ENTRAÎNEMENT DU CLASSIFIEUR DE PERTINENCE STEVIA")
    print("=" * 65)

    X, y, le = load_data(filename)

    # Split 70/30 stratifié
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.30, random_state=42, stratify=y
    )
    print(f"\n  Split 70/30 : {len(X_train)} train, {len(X_test)} test")

    # Sauvegarder le jeu de test pour evaluate_model.py
    test_df = pd.DataFrame(X_test, columns=FEATURE_COLS)
    test_df["label"] = y_test
    test_df.to_csv(DATASET_DIR / "test.csv", index=False)
    train_df = pd.DataFrame(X_train, columns=FEATURE_COLS)
    train_df["label"] = y_train
    train_df.to_csv(DATASET_DIR / "train.csv", index=False)

    models  = get_models()
    results = {}

    print(f"\n  {'Algorithme':<22} {'Accuracy':>9} {'Precision':>10} {'Recall':>8} {'F1':>6} {'AUC-ROC':>8}")
    print("  " + "-" * 65)

    best_name, best_f1, best_model = None, -1, None

    for name, model in models.items():
        model.fit(X_train, y_train)
        metrics = evaluate(model, X_test, y_test)
        results[name] = metrics

        flag = ""
        if metrics["f1"] > best_f1:
            best_f1   = metrics["f1"]
            best_name = name
            best_model = model
            flag = " ◄ meilleur"

        print(
            f"  {name:<22} "
            f"{metrics['accuracy']:>9.4f} "
            f"{metrics['precision']:>10.4f} "
            f"{metrics['recall']:>8.4f} "
            f"{metrics['f1']:>6.4f} "
            f"{metrics['auc_roc']:>8.4f}"
            f"{flag}"
        )

    # Rapport détaillé du meilleur modèle
    print(f"\n  ═══ Meilleur modèle : {best_name} (F1={best_f1:.4f}) ═══")
    y_pred_best = best_model.predict(X_test)
    print("\n" + classification_report(y_test, y_pred_best,
          target_names=["non_pertinent", "pertinent"], zero_division=0))

    if best_name == "Random Forest":
        print_feature_importance(best_model)

    # Sauvegarde
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    model_path = DATASET_DIR / "best_model.pkl"
    meta_path  = DATASET_DIR / "model_meta.pkl"

    joblib.dump(best_model, model_path)
    joblib.dump({"name": best_name, "label_encoder": le, "metrics": results[best_name]}, meta_path)

    print(f"\n  ✓ Modèle sauvegardé : {model_path}")
    print(f"  ✓ Métadonnées       : {meta_path}")
    print("\n  Prochaines étapes :")
    print("    python /app/ml/optimize_model.py   # optimiser les hyperparamètres")
    print("    python /app/ml/evaluate_model.py   # rapport final sur le jeu de test")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="stevia_relevance_dataset.csv")
    args = parser.parse_args()
    main(args.dataset)
