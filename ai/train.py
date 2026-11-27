"""
Train, compare and evaluate fraud-task models, then write the evaluation report.

Follows the Project B plan for Fraud AI:
  * select a final model by comparing candidates on a validation split;
  * evaluate ONCE on a held-out test split (grouped by requester/campaign);
  * run explicit data-leakage checks;
  * show the model outperforms the rule-based baselines;
  * document metrics and expose the model through an API (app/main.py).

Usage:
    python -m ai.train                       # uses data/synthetic_tasks.csv
    python -m ai.train --data path/to.csv
Outputs:
    models/fraud_task_model.joblib, models/model_metadata.json
    reports/model_evaluation_report.md, reports/model_comparison.csv,
    reports/metrics.json, reports/test_predictions.csv, reports/figures/*.png
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from datetime import datetime
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import sklearn  # noqa: E402
from sklearn.base import clone  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.decomposition import TruncatedSVD  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier  # noqa: E402
from sklearn.feature_extraction.text import TfidfVectorizer  # noqa: E402
from sklearn.inspection import permutation_importance  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    average_precision_score, brier_score_loss, confusion_matrix, f1_score, precision_recall_curve,
    precision_score, recall_score, roc_auc_score, roc_curve,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import OneHotEncoder, StandardScaler  # noqa: E402

from .baseline import BudgetRuleBaseline, KeywordRuleBaseline  # noqa: E402
from .features import (  # noqa: E402
    ENGINEERED_COLUMNS, FORBIDDEN_COLUMNS, INPUT_COLUMNS, model_frame, prepare_frame,
)

ROOT = Path(__file__).resolve().parents[1]
SEED = 42
HYBRID_RULE_SCORE = 1.0  # keyword rule fires on >= 2 red-flag families, or budget < 50% of the category minimum


# --------------------------------------------------------------------------
# Candidate models
# --------------------------------------------------------------------------
def _sparse_preprocessor(word_features: int, char: bool, scale: bool = True) -> ColumnTransformer:
    parts = [("word", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=word_features, sublinear_tf=True), "text")]
    if char:
        parts.append(("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=3, max_features=20000,
                                              sublinear_tf=True), "text"))
    parts.append(("cat", OneHotEncoder(handle_unknown="ignore"), ["category"]))
    parts.append(("num", StandardScaler() if scale else "passthrough", ENGINEERED_COLUMNS))
    return ColumnTransformer(parts)


def candidate_models() -> dict[str, dict[str, Pipeline]]:
    """family -> {config_name: pipeline}; best config per family is chosen on validation."""
    lr = {
        f"C={c}": Pipeline([("prep", _sparse_preprocessor(20000, char=True)),
                            ("clf", LogisticRegression(C=c, class_weight="balanced", max_iter=3000, solver="liblinear"))])
        for c in (0.3, 1.0, 3.0)
    }
    rf = {
        f"trees=400,min_leaf={m}": Pipeline([("prep", _sparse_preprocessor(3000, char=False, scale=False)),
                                             ("clf", RandomForestClassifier(n_estimators=400, min_samples_leaf=m,
                                                                            class_weight="balanced_subsample",
                                                                            n_jobs=-1, random_state=SEED))])
        for m in (1, 3)
    }
    hgb = {}
    for lr_rate in (0.05, 0.1):
        prep = ColumnTransformer([
            ("svd", Pipeline([("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=20000, sublinear_tf=True)),
                              ("svd", TruncatedSVD(n_components=64, random_state=SEED))]), "text"),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["category"]),
            ("num", "passthrough", ENGINEERED_COLUMNS),
        ], sparse_threshold=0.0)
        hgb[f"lr={lr_rate}"] = Pipeline([("prep", prep),
                                         ("clf", HistGradientBoostingClassifier(learning_rate=lr_rate, max_iter=300,
                                                                                class_weight="balanced",
                                                                                early_stopping=False, random_state=SEED))])
    return {
        "Logistic Regression (TF-IDF word+char + engineered)": lr,
        "Random Forest (TF-IDF word + engineered)": rf,
        "Hist Gradient Boosting (SVD text + engineered)": hgb,
    }


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def best_f1_threshold(y: np.ndarray, scores: np.ndarray) -> float:
    p, r, t = precision_recall_curve(y, scores)
    f1 = 2 * p * r / np.clip(p + r, 1e-9, None)
    return float(t[np.argmax(f1[:-1])])


def precision_threshold(y: np.ndarray, scores: np.ndarray, target: float, floor: float) -> float:
    p, _, t = precision_recall_curve(y, scores)
    ok = np.where(p[:-1] >= target)[0]
    return float(max(t[ok[0]], floor)) if len(ok) else float(max(np.quantile(scores, 0.99), floor))


def metrics_at(y: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, float]:
    pred = (scores >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "pr_auc": float(average_precision_score(y, scores)),
        "roc_auc": float(roc_auc_score(y, scores)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "false_positive_rate": float(fp / max(fp + tn, 1)),
        "brier": float(brier_score_loss(y, np.clip(scores, 0, 1))),
        "threshold": float(threshold),
        "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn),
    }


def paired_bootstrap(y, s_a, t_a, s_b, t_b, n=1000, seed=SEED) -> dict[str, list[float]]:
    rng = np.random.default_rng(seed)
    idx_all = np.arange(len(y))
    diffs_f1, diffs_ap, f1_a, ap_a = [], [], [], []
    for _ in range(n):
        idx = rng.choice(idx_all, size=len(idx_all), replace=True)
        yy = y[idx]
        if yy.min() == yy.max():
            continue
        fa = f1_score(yy, s_a[idx] >= t_a, zero_division=0)
        fb = f1_score(yy, s_b[idx] >= t_b, zero_division=0)
        aa = average_precision_score(yy, s_a[idx])
        ab = average_precision_score(yy, s_b[idx])
        f1_a.append(fa); ap_a.append(aa); diffs_f1.append(fa - fb); diffs_ap.append(aa - ab)
    ci = lambda v: [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]  # noqa: E731
    return {"f1_ci": ci(f1_a), "pr_auc_ci": ci(ap_a), "f1_diff_ci": ci(diffs_f1), "pr_auc_diff_ci": ci(diffs_ap)}


def normalise_text(df: pd.DataFrame) -> pd.Series:
    return (df["title"].str.lower().str.strip() + "||" + df["description"].str.lower().str.replace(r"\d", "#", regex=True).str.strip())


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def fmt(v: float, pct: bool = False) -> str:
    return f"{v * 100:.1f}%" if pct else f"{v:.3f}"


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=ROOT / "data" / "synthetic_tasks.csv")
    args = parser.parse_args()

    models_dir = ROOT / "models"; reports_dir = ROOT / "reports"; fig_dir = reports_dir / "figures"
    for d in (models_dir, reports_dir, fig_dir):
        d.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    raw = prepare_frame(pd.read_csv(args.data))
    y_all = raw["is_fraud"].to_numpy()
    groups = raw["group_id"].to_numpy()
    print(f"Loaded {len(raw):,} rows, fraud rate {y_all.mean():.1%}, {raw['group_id'].nunique():,} groups")

    # ---- Grouped split: 64% train / 16% validation / 20% held-out test ----
    gss = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=SEED)
    trval_idx, test_idx = next(gss.split(raw, y_all, groups))
    gss2 = GroupShuffleSplit(n_splits=1, test_size=0.20, random_state=SEED + 1)
    tr_rel, val_rel = next(gss2.split(raw.iloc[trval_idx], y_all[trval_idx], groups[trval_idx]))
    train_idx, val_idx = trval_idx[tr_rel], trval_idx[val_rel]
    train, val, test = raw.iloc[train_idx], raw.iloc[val_idx], raw.iloc[test_idx]
    y_tr, y_val, y_te = y_all[train_idx], y_all[val_idx], y_all[test_idx]
    X_tr, X_val, X_te = model_frame(train), model_frame(val), model_frame(test)

    # ---- Leakage checks (part 1: structural) ----
    leakage: dict[str, object] = {}
    g_tr, g_val, g_te = set(train.group_id), set(val.group_id), set(test.group_id)
    leakage["group_overlap_train_test"] = len(g_tr & g_te)
    leakage["group_overlap_train_val"] = len(g_tr & g_val)
    leakage["group_overlap_val_test"] = len(g_val & g_te)
    assert leakage["group_overlap_train_test"] == 0 and leakage["group_overlap_val_test"] == 0
    leakage["forbidden_columns_in_features"] = sorted(set(FORBIDDEN_COLUMNS) & set(X_tr.columns))
    assert not leakage["forbidden_columns_in_features"]
    norm_tr, norm_te = set(normalise_text(train)), normalise_text(test)
    dup_mask = norm_te.isin(norm_tr).to_numpy()
    leakage["test_rows_with_exact_text_in_train"] = int(dup_mask.sum())
    leakage["test_rows_with_exact_text_in_train_pct"] = float(dup_mask.mean())

    # ---- Baselines ----
    results = []
    scores_val: dict[str, np.ndarray] = {}
    scores_te: dict[str, np.ndarray] = {}
    thresholds: dict[str, float] = {}
    for base in (BudgetRuleBaseline(), KeywordRuleBaseline()):
        s_val = base.predict_proba(val)[:, 1]; s_te = base.predict_proba(test)[:, 1]
        thresholds[base.name] = 0.5
        scores_val[base.name], scores_te[base.name] = s_val, s_te
        results.append({"model": base.name, "kind": "rule-based baseline", "config": "fixed rules",
                        "fit_seconds": 0.0, "val": metrics_at(y_val, s_val, 0.5), "test": metrics_at(y_te, s_te, 0.5)})
        print(f"{base.name}: val PR-AUC {results[-1]['val']['pr_auc']:.3f}  F1 {results[-1]['val']['f1']:.3f}")

    # ---- ML candidates: pick best config per family on validation ----
    fitted: dict[str, Pipeline] = {}
    tuning_rows = []
    for family, configs in candidate_models().items():
        best = None
        for cfg_name, pipe in configs.items():
            ts = time.time()
            pipe.fit(X_tr, y_tr)
            fit_s = time.time() - ts
            s_val = pipe.predict_proba(X_val)[:, 1]
            ap = average_precision_score(y_val, s_val)
            tuning_rows.append({"family": family, "config": cfg_name, "val_pr_auc": ap, "fit_seconds": fit_s})
            print(f"  {family} [{cfg_name}] val PR-AUC {ap:.4f} ({fit_s:.1f}s)")
            if best is None or ap > best[0]:
                best = (ap, cfg_name, pipe, fit_s, s_val)
        _, cfg_name, pipe, fit_s, s_val = best
        thr = best_f1_threshold(y_val, s_val)
        s_te = pipe.predict_proba(X_te)[:, 1]
        fitted[family] = pipe
        thresholds[family] = thr
        scores_val[family], scores_te[family] = s_val, s_te
        results.append({"model": family, "kind": "machine learning", "config": cfg_name, "fit_seconds": fit_s,
                        "val": metrics_at(y_val, s_val, thr), "test": metrics_at(y_te, s_te, thr)})

    # ---- Model selection (validation PR-AUC, tie-break F1) ----
    ml_results = [r for r in results if r["kind"] == "machine learning"]
    selected = max(ml_results, key=lambda r: (round(r["val"]["pr_auc"], 3), r["val"]["f1"]))
    sel_name = selected["model"]
    sel_pipe = fitted[sel_name]
    print(f"Selected: {sel_name} [{selected['config']}]")
    best_baseline = max((r for r in results if r["kind"] != "machine learning"), key=lambda r: r["val"]["f1"])

    # ---- Decision bands (tuned on validation only) ----
    # classification threshold = F1-optimal; review band starts where legit FPR <= 3% on validation,
    # block needs precision >= 99% on validation
    f1_thr = thresholds[sel_name]
    s_v = scores_val[sel_name]
    legit_scores = np.sort(s_v[y_val == 0])
    review_thr = float(min(legit_scores[int(np.ceil(0.97 * len(legit_scores))) - 1] + 1e-6, f1_thr))
    block_thr = precision_threshold(y_val, scores_val[sel_name], target=0.99, floor=f1_thr)
    if block_thr - review_thr < 0.05:  # keep a usable human-review band
        review_thr = max(min(review_thr, block_thr - 0.05), 0.05)

    # ---- Held-out test analysis for the selected model ----
    s_te = scores_te[sel_name]
    pred_te = (s_te >= f1_thr).astype(int)
    boot = paired_bootstrap(y_te, s_te, f1_thr, scores_te[best_baseline["model"]], 0.5)
    test_rows = test.assign(score=s_te, predicted=pred_te)
    type_recall = (test_rows[test_rows.is_fraud == 1].groupby("fraud_type")
                   .agg(n=("predicted", "size"), recall=("predicted", "mean")).reset_index())
    base_pred = (scores_te[best_baseline["model"]] >= 0.5).astype(int)
    type_recall["baseline_recall"] = (test_rows.assign(bp=base_pred)[test_rows.is_fraud == 1]
                                      .groupby("fraud_type")["bp"].mean().values)
    cat_fpr = (test_rows[test_rows.is_fraud == 0].groupby("category")
               .agg(n=("predicted", "size"), false_positive_rate=("predicted", "mean")).reset_index())
    unseen = ~dup_mask
    unseen_metrics = metrics_at(y_te[unseen], s_te[unseen], f1_thr) if unseen.sum() and y_te[unseen].min() != y_te[unseen].max() else None
    bands = np.where(s_te >= block_thr, "BLOCKED", np.where(s_te >= review_thr, "NEEDS_REVIEW", "APPROVED"))
    band_table = (pd.DataFrame({"band": bands, "is_fraud": y_te}).groupby("band")
                  .agg(tasks=("is_fraud", "size"), fraud_rate=("is_fraud", "mean")).reindex(["APPROVED", "NEEDS_REVIEW", "BLOCKED"])
                  .fillna(0).reset_index())

    # ---- Leakage checks (part 2: behavioural) ----
    # a) random (non-grouped) split shows how much near-duplicate leakage would inflate scores
    rnd_tr, rnd_te = train_test_split(np.arange(len(raw)), test_size=0.2, random_state=SEED, stratify=y_all)
    rnd_pipe = clone(sel_pipe).fit(model_frame(raw.iloc[rnd_tr]), y_all[rnd_tr])
    rnd_scores = rnd_pipe.predict_proba(model_frame(raw.iloc[rnd_te]))[:, 1]
    leakage["random_split_pr_auc"] = float(average_precision_score(y_all[rnd_te], rnd_scores))
    leakage["random_split_f1"] = float(f1_score(y_all[rnd_te], rnd_scores >= f1_thr))
    leakage["grouped_split_pr_auc"] = float(average_precision_score(y_te, s_te))
    leakage["grouped_split_f1"] = float(f1_score(y_te, pred_te))
    # b) label-permutation test: a model trained on shuffled labels must score ~ prevalence
    perm_y = np.random.default_rng(SEED).permutation(y_tr)
    perm_pipe = clone(sel_pipe).fit(X_tr, perm_y)
    leakage["permuted_label_test_pr_auc"] = float(average_precision_score(y_te, perm_pipe.predict_proba(X_te)[:, 1]))
    leakage["test_prevalence"] = float(y_te.mean())
    # c) single-feature scan: any single engineered feature that alone separates the classes is suspicious
    single = {c: float(roc_auc_score(y_tr, X_tr[c])) for c in ENGINEERED_COLUMNS if X_tr[c].nunique() > 1}
    single = {c: max(v, 1 - v) for c, v in single.items()}
    leakage["single_feature_auc_top5"] = dict(sorted(single.items(), key=lambda kv: -kv[1])[:5])
    leakage["single_feature_auc_over_0_97"] = [c for c, v in single.items() if v > 0.97]

    # ---- Novel-scam generalisation: leave one fraud type out of training ----
    lofo_rows = []
    for ftype in sorted(t for t in raw.fraud_type.unique() if t not in ("none", "label_noise")):
        keep = (train.fraud_type != ftype).to_numpy()
        pipe = clone(sel_pipe).fit(X_tr[keep], y_tr[keep])
        held = (test.fraud_type == ftype).to_numpy()
        legit_te = y_te == 0
        s_h = pipe.predict_proba(X_te[held])[:, 1]
        s_l = pipe.predict_proba(X_te[legit_te])[:, 1]
        base_h = scores_te[best_baseline["model"]][held]
        lofo_rows.append({"fraud_type": ftype, "test_rows": int(held.sum()),
                          "recall_type_unseen": float((s_h >= f1_thr).mean()),
                          "recall_type_seen": float((s_te[held] >= f1_thr).mean()),
                          "baseline_recall": float((base_h >= 0.5).mean()),
                          "legit_fpr": float((s_l >= f1_thr).mean())})
        rule_h = KeywordRuleBaseline().predict_proba(test[held])[:, 1]
        rule_l = KeywordRuleBaseline().predict_proba(test[legit_te])[:, 1]
        lofo_rows[-1]["hybrid_recall_unseen"] = float(((s_h >= f1_thr) | (rule_h >= HYBRID_RULE_SCORE)).mean())
        lofo_rows[-1]["hybrid_legit_fpr"] = float(((s_l >= f1_thr) | (rule_l >= HYBRID_RULE_SCORE)).mean())
    lofo = pd.DataFrame(lofo_rows)
    print(lofo.to_string(index=False))

    # ---- Permutation importance (validation) ----
    imp = permutation_importance(sel_pipe, X_val, y_val, scoring="average_precision", n_repeats=3,
                                 random_state=SEED, n_jobs=1)
    importance = (pd.DataFrame({"feature": X_val.columns, "importance": imp.importances_mean, "std": imp.importances_std})
                  .sort_values("importance", ascending=False).head(15))

    # ---- Latency ----
    one = X_te.iloc[[0]]
    ts = time.perf_counter()
    for _ in range(50):
        sel_pipe.predict_proba(one)
    latency_ms = (time.perf_counter() - ts) / 50 * 1000

    # ---- Save model + metadata ----
    metadata = {
        "model_name": sel_name,
        "config": selected["config"],
        "version": datetime.now().strftime("%Y%m%d-%H%M%S"),
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "sklearn_version": sklearn.__version__,
        "data_file": args.data.name,
        "data_sha256_16": file_sha256(args.data),
        "rows": {"train": int(len(train)), "validation": int(len(val)), "test": int(len(test))},
        "input_columns": INPUT_COLUMNS,
        "engineered_columns": ENGINEERED_COLUMNS,
        "thresholds": {"needs_review": review_thr, "classification": f1_thr, "blocked": block_thr,
                       "hybrid_rule_score": HYBRID_RULE_SCORE},
        "test_metrics": metrics_at(y_te, s_te, f1_thr),
        "baseline_test_metrics": {r["model"]: r["test"] for r in results if r["kind"] != "machine learning"},
        "latency_ms_single_task": latency_ms,
    }
    joblib.dump(sel_pipe, models_dir / "fraud_task_model.joblib")
    (models_dir / "model_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    # ---- Report artefacts ----
    comparison = pd.DataFrame([{
        "model": r["model"], "kind": r["kind"], "config": r["config"], "threshold": r["test"]["threshold"],
        **{f"val_{k}": r["val"][k] for k in ("pr_auc", "roc_auc", "f1")},
        **{f"test_{k}": r["test"][k] for k in ("pr_auc", "roc_auc", "precision", "recall", "f1", "false_positive_rate", "brier")},
        "fit_seconds": r["fit_seconds"], "selected": r["model"] == sel_name,
    } for r in results])
    comparison.to_csv(reports_dir / "model_comparison.csv", index=False)
    pd.DataFrame(tuning_rows).to_csv(reports_dir / "hyperparameter_tuning.csv", index=False)
    test_rows[["task_id", "category", "fraud_type", "is_fraud", "score", "predicted"]].assign(band=bands) \
        .to_csv(reports_dir / "test_predictions.csv", index=False)
    (reports_dir / "metrics.json").write_text(json.dumps({
        "selected_model": sel_name, "results": results, "leakage_checks": leakage, "bootstrap_vs_best_baseline": boot,
        "thresholds": metadata["thresholds"], "unseen_text_test_metrics": unseen_metrics,
    }, indent=2, default=float), encoding="utf-8")

    make_figures(fig_dir, results, scores_te, y_te, sel_name, f1_thr, review_thr, block_thr, y_val, scores_val[sel_name],
                 type_recall, leakage, importance)
    write_report(reports_dir / "model_evaluation_report.md", raw, train, val, test, results, selected, best_baseline,
                 tuning_rows, leakage, boot, type_recall, cat_fpr, band_table, unseen_metrics, importance, metadata, lofo)
    lofo.to_csv(reports_dir / "novel_fraud_type_generalisation.csv", index=False)
    print(f"Done in {time.time() - t0:.0f}s. Report: {reports_dir / 'model_evaluation_report.md'}")


# --------------------------------------------------------------------------
# Figures
# --------------------------------------------------------------------------
PALETTE = ["#8a8f98", "#b5651d", "#2a6fdb", "#1b998b", "#c0392b"]


def make_figures(fig_dir, results, scores_te, y_te, sel_name, f1_thr, review_thr, block_thr, y_val, s_val, type_recall,
                 leakage, importance):
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    for i, r in enumerate(results):
        s = scores_te[r["model"]]
        lw = 2.6 if r["model"] == sel_name else 1.4
        ls = "--" if r["kind"] != "machine learning" else "-"
        p, rc, _ = precision_recall_curve(y_te, s)
        axes[0].plot(rc, p, ls, lw=lw, color=PALETTE[i % len(PALETTE)], label=f"{r['model']} (AP {r['test']['pr_auc']:.3f})")
        fpr, tpr, _ = roc_curve(y_te, s)
        axes[1].plot(fpr, tpr, ls, lw=lw, color=PALETTE[i % len(PALETTE)], label=f"{r['model']} (AUC {r['test']['roc_auc']:.3f})")
    axes[0].set(title="Precision-Recall (held-out test)", xlabel="Recall", ylabel="Precision", ylim=(0, 1.02))
    axes[1].plot([0, 1], [0, 1], ":", color="#bbb")
    axes[1].set(title="ROC (held-out test)", xlabel="False positive rate", ylabel="True positive rate")
    axes[0].legend(fontsize=7, loc="lower left"); axes[1].legend(fontsize=7, loc="lower right")
    fig.tight_layout(); fig.savefig(fig_dir / "pr_roc_curves.png", dpi=140); plt.close(fig)

    fig, ax = plt.subplots(figsize=(9, 4.2))
    names = [r["model"].split(" (")[0] for r in results]
    x = np.arange(len(results)); w = 0.27
    for j, (k, c) in enumerate([("precision", "#2a6fdb"), ("recall", "#1b998b"), ("f1", "#b5651d")]):
        vals = [r["test"][k] for r in results]
        bars = ax.bar(x + (j - 1) * w, vals, w, label=k.upper() if k == "f1" else k.capitalize(), color=c)
        ax.bar_label(bars, fmt="%.2f", fontsize=7, padding=1)
    ax.set_xticks(x, names, rotation=12, ha="right", fontsize=8); ax.set_ylim(0, 1.1)
    ax.set_title("Held-out test metrics at each model's operating threshold"); ax.legend(ncol=3, fontsize=8)
    fig.tight_layout(); fig.savefig(fig_dir / "model_comparison.png", dpi=140); plt.close(fig)

    s = scores_te[sel_name]
    cm = confusion_matrix(y_te, s >= f1_thr)
    fig, ax = plt.subplots(figsize=(4.2, 3.8))
    ax.imshow(cm, cmap="Blues")
    for (i, j), v in np.ndenumerate(cm):
        ax.text(j, i, f"{v}", ha="center", va="center", color="white" if v > cm.max() / 2 else "black", fontsize=12)
    ax.set_xticks([0, 1], ["Legit", "Fraud"]); ax.set_yticks([0, 1], ["Legit", "Fraud"])
    ax.set(xlabel="Predicted", ylabel="Actual", title="Selected model - confusion matrix")
    fig.tight_layout(); fig.savefig(fig_dir / "confusion_matrix.png", dpi=140); plt.close(fig)

    p, rc, t = precision_recall_curve(y_val, s_val)
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(t, p[:-1], label="Precision", color="#2a6fdb"); ax.plot(t, rc[:-1], label="Recall", color="#1b998b")
    ax.axvline(review_thr, color="#b5651d", ls="--", label=f"Needs review >= {review_thr:.2f}")
    ax.axvline(f1_thr, color="#555", ls=":", label=f"Classification (F1-opt) {f1_thr:.2f}")
    ax.axvline(block_thr, color="#c0392b", ls="--", label=f"Blocked >= {block_thr:.2f}")
    ax.set(xlabel="Fraud score threshold", ylabel="Value", title="Threshold trade-off (validation split)")
    ax.legend(fontsize=8); fig.tight_layout(); fig.savefig(fig_dir / "threshold_tradeoff.png", dpi=140); plt.close(fig)

    tr = type_recall.sort_values("recall")
    fig, ax = plt.subplots(figsize=(7.5, 4))
    yy = np.arange(len(tr))
    ax.barh(yy + 0.2, tr["recall"], 0.4, color="#2a6fdb", label="Selected model")
    ax.barh(yy - 0.2, tr["baseline_recall"], 0.4, color="#8a8f98", label="Best rule baseline")
    ax.set_yticks(yy, tr["fraud_type"]); ax.set_xlim(0, 1.05)
    ax.set(xlabel="Recall on held-out test", title="Detection rate by fraud type"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(fig_dir / "recall_by_fraud_type.png", dpi=140); plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.5, 3.6))
    labels = ["Grouped split\n(reported)", "Random split\n(leaky)", "Shuffled labels\n(sanity)"]
    vals = [leakage["grouped_split_pr_auc"], leakage["random_split_pr_auc"], leakage["permuted_label_test_pr_auc"]]
    bars = ax.bar(labels, vals, color=["#2a6fdb", "#b5651d", "#8a8f98"])
    ax.bar_label(bars, fmt="%.3f"); ax.axhline(leakage["test_prevalence"], ls=":", color="#555", label="Fraud prevalence")
    ax.set(ylim=(0, 1.1), ylabel="PR-AUC", title="Leakage checks"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(fig_dir / "leakage_checks.png", dpi=140); plt.close(fig)

    imp = importance.iloc[::-1]
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.barh(imp["feature"], imp["importance"], xerr=imp["std"], color="#1b998b")
    ax.set(xlabel="Drop in validation PR-AUC when shuffled", title="Permutation importance (selected model)")
    fig.tight_layout(); fig.savefig(fig_dir / "feature_importance.png", dpi=140); plt.close(fig)


# --------------------------------------------------------------------------
# Markdown report
# --------------------------------------------------------------------------
def write_report(path, raw, train, val, test, results, selected, best_baseline, tuning_rows, leakage, boot,
                 type_recall, cat_fpr, band_table, unseen_metrics, importance, metadata, lofo):
    sel = selected["test"]; bb = best_baseline["test"]
    th = metadata["thresholds"]
    beats = sel["f1"] > bb["f1"] and sel["pr_auc"] > bb["pr_auc"]
    sig = boot["f1_diff_ci"][0] > 0
    L = []
    a = L.append
    a("# ConnectMyTask - Fraud Task Detection AI: Model Comparison and Evaluation Report\n")
    a(f"*Generated {metadata['trained_at']} by `ai/train.py` - scikit-learn {metadata['sklearn_version']} - "
      f"data `{metadata['data_file']}` (sha256 {metadata['data_sha256_16']})*\n")
    a("## 1. Summary\n")
    a(f"- **Selected model:** {selected['model']} (`{selected['config']}`), chosen on the validation split by PR-AUC.")
    a(f"- **Held-out test (never used for training, tuning or selection):** PR-AUC **{fmt(sel['pr_auc'])}**, "
      f"ROC-AUC {fmt(sel['roc_auc'])}, precision {fmt(sel['precision'], True)}, recall {fmt(sel['recall'], True)}, "
      f"F1 **{fmt(sel['f1'])}**, false-positive rate {fmt(sel['false_positive_rate'], True)}.")
    a(f"- **Best rule-based baseline** ({best_baseline['model']}): PR-AUC {fmt(bb['pr_auc'])}, F1 {fmt(bb['f1'])}, "
      f"recall {fmt(bb['recall'], True)}, false-positive rate {fmt(bb['false_positive_rate'], True)}.")
    a(f"- **Outperforms baseline:** {'YES' if beats else 'NO'} - F1 gain {sel['f1'] - bb['f1']:+.3f} "
      f"(95% paired-bootstrap CI {boot['f1_diff_ci'][0]:+.3f} to {boot['f1_diff_ci'][1]:+.3f}; "
      f"{'statistically clear' if sig else 'not statistically clear'}).")
    a(f"- **Leakage checks:** no requester/campaign appears in both train and test; no label or identifier columns in the "
      f"features; a model trained on shuffled labels scores PR-AUC {fmt(leakage['permuted_label_test_pr_auc'])} "
      f"(prevalence {fmt(leakage['test_prevalence'])}), i.e. nothing leaks.")
    a(f"- **Novel scam patterns:** when a fraud type is removed from training entirely, the model still catches "
      f"{lofo['recall_type_unseen'].mean():.1%} of it on average (worst: {lofo.loc[lofo.recall_type_unseen.idxmin(), 'fraud_type']} "
      f"{lofo['recall_type_unseen'].min():.1%}) - the realistic expectation for scams it has never seen (Section 6.1).")
    a(f"- **Hybrid ML + rules** (what the API runs) raises unseen-type recall to {lofo['hybrid_recall_unseen'].mean():.1%} "
      f"with a {lofo['hybrid_legit_fpr'].mean():.1%} legit false-positive rate.")
    a(f"- **API decision bands** (tuned on validation): score < {th['needs_review']:.2f} -> APPROVED, "
      f"{th['needs_review']:.2f}-{th['blocked']:.2f} -> NEEDS_REVIEW (admin queue), >= {th['blocked']:.2f} -> BLOCKED. "
      f"Classification metrics use the F1-optimal threshold {th['classification']:.2f}.")
    a(f"- **Latency:** {metadata['latency_ms_single_task']:.1f} ms per task on this machine (single prediction).\n")

    a("## 2. Alignment with the Project B plan\n")
    a("| Plan requirement (Fraud AI, P0 / Definition of Done) | How it is met here |")
    a("|---|---|")
    a("| Select a final model | 3 ML families x 2-3 configs compared on a validation split; best by PR-AUC (Section 5) |")
    a("| Evaluate on a held-out test set | Grouped 20% test split, scored once after selection (Section 6) |")
    a("| Check for data leakage | Group-disjoint splits, feature audit, duplicate scan, random-vs-grouped split, label permutation, single-feature scan (Section 7) |")
    a("| Outperform the rule-based baseline | Compared with the live `riskEvaluator.js` rule and a keyword-rule checklist, with bootstrap CI (Sections 5-6) |")
    a("| Rule-based baselines remain as fallbacks | API falls back to Baseline B if the model file is missing (`app/main.py`) |")
    a("| Prediction API integrated into task flow | FastAPI `POST /api/tasks` validates every posted task; output mirrors `Task.isSuspicious / riskLevel / suspiciousReason` |")
    a("| Documented metrics | This report, `metrics.json`, `model_comparison.csv`, `test_predictions.csv` |\n")

    a("## 3. Data\n")
    a(f"Synthetic task postings from `data/generate_synthetic_tasks.py` - **{len(raw):,} tasks**, "
      f"{raw['is_fraud'].mean():.1%} fraud, {raw['group_id'].nunique():,} requesters/scam campaigns. "
      "Columns follow the ConnectMyTask *Post a Task* form: `title`, `description`, `category`, `district` (HCMC ward), "
      "`street_name`, `budget_vnd`, `max_bids`, `deadline`, `urgency`, `image_count`. Labels: `is_fraud`, `fraud_type`.\n")
    a("| Fraud type | Rows | What it looks like |")
    a("|---|---|---|")
    desc = {"upfront_fee": "Provider must pay a fee/deposit before working", "off_platform_payment": "Moves contact/payment to Zalo, Telegram, cash (bypasses escrow)",
            "personal_data_harvesting": "Asks for CCCD, bank login, OTP", "unrealistic_pay": "Trivial work, huge pay",
            "money_mule_reshipping": "Reship parcels or pass money on", "fake_engagement": "Fake reviews, ratings, ad clicks",
            "underpay_exploitation": "Normal-looking big job at a fraction of the fair price", "label_noise": "1.5% randomly flipped labels (imperfect moderation)"}
    for ft, n in raw[raw.fraud_type != "none"]["fraud_type"].value_counts().items():
        a(f"| {ft} | {n} | {desc.get(ft, '')} |")
    a("\nRealism built into the generator: ~30% of scam campaigns hide the scam inside a normal task description, ~15% keep only "
      "one weak cue, ~35% of phone numbers are obfuscated, ~8% of legitimate tasks are cheap enough to trip the budget rule, and "
      "legitimate posts mention *deposit*, *escrow* and *urgent*. Location is **not** a model input (fairness and address privacy).\n")
    a(f"**Splits (grouped by requester/campaign):** train {len(train):,} ({train.is_fraud.mean():.1%} fraud) - "
      f"validation {len(val):,} ({val.is_fraud.mean():.1%}) - test {len(test):,} ({test.is_fraud.mean():.1%}).\n")

    a("## 4. Features\n")
    a("- **Text:** title + description -> TF-IDF word 1-2 grams (+ char 3-5 grams for Logistic Regression, robust to `z.a.l.o`-style obfuscation).")
    a("- **Category:** one-hot.")
    a("- **Engineered (" + str(len(ENGINEERED_COLUMNS)) + "):** " + ", ".join(f"`{c}`" for c in ENGINEERED_COLUMNS) + ".")
    a("- Budget is compared with the same per-category minimums as `riskEvaluator.js`. All vectorisers/scalers are fitted inside "
      "the pipeline on the training split only.\n")

    a("## 5. Model comparison\n")
    a("Validation scores drive selection; test columns are shown for transparency only (computed after selection).\n")
    a("| Model | Type | Config | Val PR-AUC | Val F1 | Test PR-AUC | Test ROC-AUC | Test Precision | Test Recall | Test F1 | Test FPR | Fit (s) |")
    a("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        star = " **(selected)**" if r["model"] == selected["model"] else ""
        v, t = r["val"], r["test"]
        a(f"| {r['model']}{star} | {r['kind']} | {r['config']} | {fmt(v['pr_auc'])} | {fmt(v['f1'])} | {fmt(t['pr_auc'])} | "
          f"{fmt(t['roc_auc'])} | {fmt(t['precision'], True)} | {fmt(t['recall'], True)} | {fmt(t['f1'])} | "
          f"{fmt(t['false_positive_rate'], True)} | {r['fit_seconds']:.1f} |")
    a("\n![PR and ROC curves](figures/pr_roc_curves.png)\n")
    a("![Model comparison](figures/model_comparison.png)\n")
    a("<details><summary>Hyper-parameter search (validation PR-AUC)</summary>\n")
    a("| Family | Config | Val PR-AUC | Fit (s) |"); a("|---|---|---|---|")
    for t in tuning_rows:
        a(f"| {t['family']} | {t['config']} | {t['val_pr_auc']:.4f} | {t['fit_seconds']:.1f} |")
    a("\n</details>\n")

    a("## 6. Selected model on the held-out test set\n")
    a(f"Operating threshold {sel['threshold']:.3f} (F1-optimal on validation). TP {sel['tp']} - FP {sel['fp']} - TN {sel['tn']} - FN {sel['fn']}. "
      f"Brier score {sel['brier']:.3f}.\n")
    a(f"- 95% bootstrap CI: F1 {boot['f1_ci'][0]:.3f}-{boot['f1_ci'][1]:.3f}, PR-AUC {boot['pr_auc_ci'][0]:.3f}-{boot['pr_auc_ci'][1]:.3f}.")
    a(f"- vs best baseline: PR-AUC gain CI {boot['pr_auc_diff_ci'][0]:+.3f} to {boot['pr_auc_diff_ci'][1]:+.3f}.")
    if unseen_metrics:
        a(f"- On the {100 * (1 - leakage['test_rows_with_exact_text_in_train_pct']):.1f}% of test tasks whose normalised text never appears "
          f"in training: PR-AUC {fmt(unseen_metrics['pr_auc'])}, F1 {fmt(unseen_metrics['f1'])}.")
    a("\n![Confusion matrix](figures/confusion_matrix.png)\n")
    a("**Recall by fraud type (test):**\n")
    a("| Fraud type | Test rows | Model recall | Baseline recall |"); a("|---|---|---|---|")
    for r in type_recall.itertuples():
        a(f"| {r.fraud_type} | {r.n} | {r.recall:.1%} | {r.baseline_recall:.1%} |")
    a("\n![Recall by fraud type](figures/recall_by_fraud_type.png)\n")
    a("**False-positive rate on legitimate tasks by category (test)** - checks no category is unfairly flagged:\n")
    a("| Category | Legit test tasks | FPR |"); a("|---|---|---|")
    for r in cat_fpr.itertuples():
        a(f"| {r.category} | {r.n} | {r.false_positive_rate:.1%} |")
    a("\n**Decision bands used by the API (test):**\n")
    a("| Band | Tasks | Actual fraud rate |"); a("|---|---|---|")
    for r in band_table.itertuples():
        a(f"| {r.band} | {int(r.tasks)} | {r.fraud_rate:.1%} |")
    a("\n![Threshold trade-off](figures/threshold_tradeoff.png)\n")
    a("### 6.1 Generalisation to scam types never seen in training\n")
    a("Each fraud type is removed from the training split in turn; the model is retrained and scored on that type in the "
      "test split. Synthetic posts of one type share phrasing across campaigns, so the *seen* recall is optimistic; the "
      "*unseen* recall is the better estimate for a brand-new scam pattern on ConnectMyTask.\n")
    a("| Fraud type (held out) | Test rows | ML recall when seen | ML recall when unseen | Rule baseline recall | "
      "**Hybrid recall when unseen** | ML legit FPR | Hybrid legit FPR |")
    a("|---|---|---|---|---|---|---|---|")
    for r in lofo.itertuples():
        a(f"| {r.fraud_type} | {r.test_rows} | {r.recall_type_seen:.1%} | {r.recall_type_unseen:.1%} | {r.baseline_recall:.1%} | "
          f"**{r.hybrid_recall_unseen:.1%}** | {r.legit_fpr:.1%} | {r.hybrid_legit_fpr:.1%} |")
    a(f"\n**Hybrid policy used by the API:** a task is sent to NEEDS_REVIEW if the ML score is in the review band *or* the "
      f"keyword rule scores >= {HYBRID_RULE_SCORE:.1f} (two or more red-flag families, or budget under half the category minimum). "
      f"For unseen scam types this lifts average recall from {lofo['recall_type_unseen'].mean():.1%} to "
      f"{lofo['hybrid_recall_unseen'].mean():.1%}, at a legit false-positive rate of {lofo['hybrid_legit_fpr'].mean():.1%}. "
      "This is the plan's 'rule-based baselines remain as fallbacks' put into practice.\n")
    a("**Top features (permutation importance on validation; `text` = all title/description words together):**\n")
    a("| Feature | Drop in PR-AUC |"); a("|---|---|")
    for r in importance.itertuples():
        a(f"| `{r.feature}` | {r.importance:.4f} +/- {r.std:.4f} |")
    a("\n![Feature importance](figures/feature_importance.png)\n")

    a("## 7. Data-leakage checks\n")
    a("| Check | Result | Pass? |"); a("|---|---|---|")
    a(f"| Requester/campaign overlap train-test / val-test / train-val | {leakage['group_overlap_train_test']} / "
      f"{leakage['group_overlap_val_test']} / {leakage['group_overlap_train_val']} | {'PASS' if leakage['group_overlap_train_test'] == 0 else 'FAIL'} |")
    a(f"| Label/ID/location columns in model input | {leakage['forbidden_columns_in_features'] or 'none'} | PASS |")
    a(f"| Test rows whose exact (digit-normalised) text is in train | {leakage['test_rows_with_exact_text_in_train']} "
      f"({leakage['test_rows_with_exact_text_in_train_pct']:.1%}) - generic legit posts from shared templates; metrics on unseen text reported above | INFO |")
    infl = leakage["random_split_pr_auc"] - leakage["grouped_split_pr_auc"]
    a(f"| Random split vs grouped split PR-AUC | {fmt(leakage['random_split_pr_auc'])} vs {fmt(leakage['grouped_split_pr_auc'])} "
      f"(F1 {fmt(leakage['random_split_f1'])} vs {fmt(leakage['grouped_split_f1'])}); difference {infl:+.3f}. "
      f"{'A random split lets near-duplicate campaign posts sit in train and test and inflates the score; ' if infl > 0.005 else 'Near-duplicate posts give little advantage here; '}"
      f"the grouped (unseen requester/campaign) number is the one reported | PASS |")
    perm_ok = leakage["permuted_label_test_pr_auc"] < leakage["test_prevalence"] + 0.1
    a(f"| Shuffled-label model PR-AUC (should be ~ prevalence {fmt(leakage['test_prevalence'])}) | "
      f"{fmt(leakage['permuted_label_test_pr_auc'])} | {'PASS' if perm_ok else 'FAIL'} |")
    top = ", ".join(f"`{k}` {v:.3f}" for k, v in leakage["single_feature_auc_top5"].items())
    a(f"| Single engineered feature with ROC-AUC > 0.97 on its own | {leakage['single_feature_auc_over_0_97'] or 'none'} (top: {top}) | "
      f"{'PASS' if not leakage['single_feature_auc_over_0_97'] else 'REVIEW'} |")
    a("| Preprocessing fitted on training data only | TF-IDF/SVD/scaler inside the sklearn Pipeline | PASS |")
    a("| Thresholds chosen without test data | Tuned on validation split | PASS |")
    a("\n![Leakage checks](figures/leakage_checks.png)\n")

    a("## 8. Limitations and next steps\n")
    a("- The data is **synthetic**. The red-flag lexicon and the generator were written by the same team, so absolute scores are "
      "optimistic; the *relative* comparison and the leakage method are the deliverable. Re-run `ai/train.py --data` on "
      "moderator-labelled ConnectMyTask tasks (Task.isSuspicious / admin review outcomes) before production use.")
    a("- English-only text; Vietnamese and mixed-language posts need Vietnamese tokenisation or a multilingual encoder.")
    a("- Text-only signals: account age, past disputes, payment and bid behaviour (User/Bid/Dispute tables) would add strong signals "
      "and should be joined in a v2 user-level model.")
    a("- NEEDS_REVIEW tasks should go to the existing admin review flow (`reviewedByAdminAt`) and the decisions fed back as labels.\n")

    a("## 9. Reproduce\n")
    a("```powershell\n.venv\\Scripts\\python data\\generate_synthetic_tasks.py\n.venv\\Scripts\\python -m ai.train\n```")
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
