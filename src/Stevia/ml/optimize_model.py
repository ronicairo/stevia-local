"""
Optimisation des hyperparamètres du meilleur modèle (GridSearchCV).

Usage :
    python /app/ml/optimize_model.py [--model random_forest|decision_tree|knn|logistic]
"""

import sys
import argparse
import warnings
from pathlib import Path

import pandas as pd
import joblib

from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, make_scorer

warnings.filterwarnings("ignore")

DATASET_DIR = Path(__file__).parent / "dataset"
FEATURE_COLS = [
    "cosine_score", "keyword_match_count", "keyword_match_ratio",
    "chunk_length", "title_match", "role_match",
    "query_length", "rank_position", "book_id",
]

PARAM_GRIDS = {
    "random_forest": {
        "model": RandomForestClassifier(random_state=42, class_weight="balanced"),
        "params": {
            "n_estimators":      [50, 100, 200],
            "max_depth":         [None, 5, 10, 20],
            "min_samples_split": [2, 5, 10],
            "min_samples_leaf":  [1, 2, 4],
        },
        "needs_scaler": False,
    },
    "decision_tree": {
        "model": DecisionTreeClassifier(random_state=42, class_weight="balanced"),
        "params": {
            "max_depth":         [3, 5, 8, 10, None],
            "min_samples_split": [2, 5, 10],
            "min_samples_leaf":  [1, 2, 4],
            "criterion":         ["gini", "entropy"],
        },
        "needs_scaler": False,
    },
    "knn": {
        "model": KNeighborsClassifier(),
        "params": {
            "n_neighbors": [3, 5, 7, 11, 15],
            "weights":     ["uniform", "distance"],
            "metric":      ["euclidean", "manhattan"],
        },
        "needs_scaler": True,
    },
    "logistic": {
        "model": LogisticRegression(random_state=42, class_weight="balanced", max_iter=1000),
        "params": {
            "C":       [0.01, 0.1, 1, 10, 100],
            "penalty": ["l1", "l2"],
            "solver":  ["liblinear"],
        },
        "needs_scaler": True,
    },
}


def load_train_data() -> tuple:
    path = DATASET_DIR / "train.csv"
    if not path.exists():
        print("  ✗ train.csv introuvable. Lancer d'abord train_model.py")
        sys.exit(1)
    df = pd.read_csv(path)
    return df[FEATURE_COLS].values, df["label"].values


def optimize(model_key: str):
    print("=" * 65)
    print(f"  OPTIMISATION HYPERPARAMÈTRES — {model_key.upper()}")
    print("=" * 65)

    X_train, y_train = load_train_data()
    cfg = PARAM_GRIDS[model_key]

    estimator = cfg["model"]
    if cfg["needs_scaler"]:
        # Wrap in Pipeline pour préfixer les paramètres
        pipe = Pipeline([("scaler", StandardScaler()), ("clf", estimator)])
        param_grid = {f"clf__{k}": v for k, v in cfg["params"].items()}
    else:
        pipe = estimator
        param_grid = cfg["params"]

    scorer = make_scorer(f1_score, zero_division=0)
    cv     = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    grid = GridSearchCV(
        estimator=pipe,
        param_grid=param_grid,
        scoring=scorer,
        cv=cv,
        n_jobs=-1,
        verbose=1,
        refit=True,
    )

    print(f"\n  Combinaisons à tester : {_count_combinations(cfg['params'])}")
    print("  Validation croisée : 5-fold stratifié\n")

    grid.fit(X_train, y_train)

    print(f"\n  ✓ Meilleurs hyperparamètres :")
    for k, v in grid.best_params_.items():
        print(f"    {k}: {v}")
    print(f"\n  F1 moyen (CV) : {grid.best_score_:.4f}")

    # Sauvegarder le modèle optimisé
    opt_path  = DATASET_DIR / f"optimized_{model_key}.pkl"
    joblib.dump(grid.best_estimator_, opt_path)
    print(f"\n  ✓ Modèle optimisé sauvegardé : {opt_path}")

    # Vérifier s'il est meilleur que l'actuel best_model.pkl
    best_path = DATASET_DIR / "best_model.pkl"
    if best_path.exists():
        current_meta = joblib.load(DATASET_DIR / "model_meta.pkl")
        current_f1   = current_meta.get("metrics", {}).get("f1", 0)
        if grid.best_score_ > current_f1:
            joblib.dump(grid.best_estimator_, best_path)
            current_meta["name"]    = f"{model_key} (optimisé)"
            current_meta["metrics"]["f1"] = round(grid.best_score_, 4)
            joblib.dump(current_meta, DATASET_DIR / "model_meta.pkl")
            print(f"  ✓ best_model.pkl mis à jour (F1 {current_f1:.4f} → {grid.best_score_:.4f})")

    print("\n  Prochaine étape : python /app/ml/evaluate_model.py")


def _count_combinations(params: dict) -> int:
    n = 1
    for v in params.values():
        n *= len(v)
    return n


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="random_forest",
                        choices=list(PARAM_GRIDS.keys()),
                        help="Algorithme à optimiser (défaut: random_forest)")
    args = parser.parse_args()
    optimize(args.model)
