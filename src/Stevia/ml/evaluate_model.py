"""
Évaluation finale du meilleur modèle sur le jeu de test (30 %).

Produit :
  - Rapport de classification complet
  - Matrice de confusion
  - Courbe ROC (AUC)
  - Importance des features si disponible

Usage :
    python /app/ml/evaluate_model.py
"""

import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_auc_score,
    accuracy_score,
    f1_score,
)

warnings.filterwarnings("ignore")

DATASET_DIR = Path(__file__).parent / "dataset"
FEATURE_COLS = [
    "cosine_score", "keyword_match_count", "keyword_match_ratio",
    "chunk_length", "title_match", "role_match",
    "query_length", "rank_position", "book_id",
]


def load_test_data() -> tuple:
    path = DATASET_DIR / "test.csv"
    if not path.exists():
        print("  ✗ test.csv introuvable. Lancer d'abord train_model.py")
        sys.exit(1)
    df = pd.read_csv(path)
    return df[FEATURE_COLS].values, df["label"].values


def load_model():
    path = DATASET_DIR / "best_model.pkl"
    if not path.exists():
        print("  ✗ best_model.pkl introuvable. Lancer d'abord train_model.py")
        sys.exit(1)
    return joblib.load(path)


def print_confusion_matrix(cm):
    tn, fp, fn, tp = cm.ravel()
    print("\n  Matrice de confusion :")
    print("                 Prédit NP   Prédit P")
    print(f"  Réel NP (0)       {tn:>5}      {fp:>5}")
    print(f"  Réel P  (1)       {fn:>5}      {tp:>5}")
    print(f"\n  Vrais négatifs  (TN) : {tn}")
    print(f"  Faux positifs   (FP) : {fp}  ← hors-sujet accepté à tort")
    print(f"  Faux négatifs   (FN) : {fn}  ← pertinent rejeté à tort")
    print(f"  Vrais positifs  (TP) : {tp}")


def print_feature_importance(model):
    clf = getattr(model, "named_steps", {}).get("clf", model)
    if hasattr(clf, "feature_importances_"):
        pairs = sorted(zip(FEATURE_COLS, clf.feature_importances_),
                       key=lambda x: x[1], reverse=True)
        print("\n  Importance des features :")
        for feat, imp in pairs:
            bar = "█" * int(imp * 50)
            print(f"    {feat:<25} {imp:.4f}  {bar}")


def main():
    print("=" * 65)
    print("  ÉVALUATION FINALE — JEU DE TEST (30 %)")
    print("=" * 65)

    model = load_model()
    X_test, y_test = load_test_data()

    meta_path = DATASET_DIR / "model_meta.pkl"
    if meta_path.exists():
        meta = joblib.load(meta_path)
        print(f"\n  Modèle         : {meta.get('name', '?')}")

    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else y_pred

    acc  = accuracy_score(y_test, y_pred)
    f1   = f1_score(y_test, y_pred, zero_division=0)
    auc  = roc_auc_score(y_test, y_proba) if len(np.unique(y_test)) > 1 else 0.0
    cm   = confusion_matrix(y_test, y_pred)

    print(f"\n  Jeu de test    : {len(y_test)} exemples")
    print(f"  Positifs       : {y_test.sum()} ({y_test.mean()*100:.1f} %)")

    print("\n  ── Métriques globales ──────────────────────────────────")
    print(f"  Accuracy  : {acc:.4f}")
    print(f"  F1-score  : {f1:.4f}")
    print(f"  AUC-ROC   : {auc:.4f}")

    print("\n  ── Rapport détaillé ────────────────────────────────────")
    print(classification_report(y_test, y_pred,
          target_names=["non_pertinent (0)", "pertinent (1)"], zero_division=0))

    print_confusion_matrix(cm)
    print_feature_importance(model)

    # Sauvegarder les métriques finales
    final_metrics = {
        "accuracy": round(acc, 4),
        "f1":       round(f1, 4),
        "auc_roc":  round(auc, 4),
        "n_test":   len(y_test),
    }
    if meta_path.exists():
        meta = joblib.load(meta_path)
        meta["final_eval"] = final_metrics
        joblib.dump(meta, meta_path)

    print(f"\n  ✓ Le modèle est prêt pour la production.")
    print("  → Il sera chargé automatiquement par rag_engine.py")
    print("    à chaque requête via ml/predict.py")


if __name__ == "__main__":
    main()
