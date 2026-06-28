"""訓練 LightGBM + IsolationForest，存 model.joblib（含 feature_list）。

資料優先序：data/paysim.csv（真 PaySim，會自動補增益欄）→ 否則合成資料。
時間切分（依 step）train/val/test，印 holdout AUC / PR-AUC / 人頭召回。
"""
from __future__ import annotations

import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")  # 避免 Windows cp950 主控台對 CJK 崩潰
except Exception:
    pass

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    matthews_corrcoef,
    recall_score,
    roc_auc_score,
    roc_curve,
)
import lightgbm as lgb

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

from app.featurize import FEATURE_ORDER, featurize  # noqa: E402
from app.graph import compute_account_graph, apply_graph_features  # noqa: E402
from app.rules import rule_risk  # noqa: E402

DATA_CSV = os.path.join(HERE, "data", "paysim.csv")
MODEL_OUT = os.path.join(HERE, "model.joblib")


def fit_calibrated_lgbm(Xtr, ytr, Xva, yva):
    """訓練 LightGBM 並用驗證集做 isotonic 校準，回傳 (raw_clf, calibrated)。"""
    pos = max(1, int(ytr.sum()))
    neg = max(1, len(ytr) - pos)
    clf = lgb.LGBMClassifier(
        n_estimators=400, learning_rate=0.05, num_leaves=31,
        subsample=0.9, colsample_bytree=0.9,
        scale_pos_weight=neg / pos, random_state=42, verbose=-1,
    )
    clf.fit(
        Xtr, ytr, eval_set=[(Xva, yva)], eval_metric="auc",
        callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)],
    )
    calibrated = CalibratedClassifierCV(FrozenEstimator(clf), method="isotonic")
    calibrated.fit(Xva, yva)
    return clf, calibrated


def expected_calibration_error(y, p, bins: int = 10) -> tuple[float, list[dict]]:
    """ECE（期望校準誤差）+ 可靠度曲線資料（每桶平均預測 vs 實際詐欺率）。"""
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    ece = 0.0
    curve: list[dict] = []
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p < hi) if i < bins - 1 else (p >= lo) & (p <= hi)
        cnt = int(mask.sum())
        if cnt == 0:
            continue
        conf = float(p[mask].mean())
        acc = float(y[mask].mean())
        ece += abs(conf - acc) * cnt / len(p)
        curve.append({"pred_mean": round(conf, 4), "frac_fraud": round(acc, 4), "count": cnt})
    return float(ece), curve

def load_data() -> tuple[pd.DataFrame, str]:
    if os.path.exists(DATA_CSV):
        df = pd.read_csv(DATA_CSV)
        # PaySim 沒有電信/裝置/地理等 ChainTrust 增益訊號 → 以與 isFraud 相關方式半合成注入，
        # 讓模型能學到這些差異化特徵（交易詐欺訊號仍為真資料）。
        from synth import augment_cht_signals, CHT_SIGNAL_COLS
        if not all(c in df.columns for c in CHT_SIGNAL_COLS):
            df = augment_cht_signals(df)
        if "step" not in df.columns:
            df["step"] = np.arange(len(df))
        return df, f"PaySim + 半合成 CHT 訊號 ({DATA_CSV})"
    from synth import generate
    return generate(), "synthetic (PaySim-like)"


def to_matrix(df: pd.DataFrame) -> np.ndarray:
    feats = [featurize(r) for r in df.to_dict("records")]
    return np.array([[f[name] for name in FEATURE_ORDER] for f in feats], dtype=float)


def main() -> None:
    df, source = load_data()
    print(f"[train] 資料來源：{source}  rows={len(df)}  fraud={int(df['isFraud'].sum())}")

    # 依時間切分（out-of-time），避免洩漏
    df = df.sort_values("step").reset_index(drop=True)
    n = len(df)
    tr_end, va_end = int(n * 0.7), int(n * 0.85)
    train, val, test = df[:tr_end], df[tr_end:va_end], df[va_end:]

    # A2：帳戶圖譜「只用訓練期邊」建立，再套用到 val/test → 不用未來邊（避免時間洩漏）
    graph = compute_account_graph(train)
    train = apply_graph_features(train, graph)
    val = apply_graph_features(val, graph)
    test = apply_graph_features(test, graph)

    Xtr, ytr = to_matrix(train), train["isFraud"].to_numpy()
    Xva, yva = to_matrix(val), val["isFraud"].to_numpy()
    Xte, yte = to_matrix(test), test["isFraud"].to_numpy()

    # 機率校準（isotonic）：用驗證集校準已訓練的 LGBM，使風險分數有意義
    # sklearn>=1.6：以 FrozenEstimator 包裝已訓練模型（取代舊 cv="prefit"）
    clf, calibrated = fit_calibrated_lgbm(Xtr, ytr, Xva, yva)

    def proba_of(X: np.ndarray) -> np.ndarray:
        return calibrated.predict_proba(X)[:, 1]

    # 用驗證集挑最大化 F1 的門檻（基於校準後機率）
    proba_va = proba_of(Xva)
    grid = np.linspace(0.05, 0.95, 91)
    f1s = []
    for thr in grid:
        pred = (proba_va >= thr).astype(int)
        tp = int(((pred == 1) & (yva == 1)).sum())
        fp = int(((pred == 1) & (yva == 0)).sum())
        fn = int(((pred == 0) & (yva == 1)).sum())
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1s.append(2 * prec * rec / (prec + rec) if prec + rec else 0.0)
    best_thr = float(grid[int(np.argmax(f1s))])

    # ── 評估（主指標 PR-AUC；極不平衡下勿看 accuracy）──
    proba = proba_of(Xte)
    pr_auc = average_precision_score(yte, proba)
    roc = roc_auc_score(yte, proba)
    recall = recall_score(yte, (proba >= best_thr).astype(int))
    mcc = matthews_corrcoef(yte, (proba >= best_thr).astype(int))
    # recall @ FPR=1%
    fpr, tpr, _ = roc_curve(yte, proba)
    idx = np.where(fpr <= 0.01)[0]
    recall_at_fpr1 = float(tpr[idx[-1]]) if len(idx) else 0.0
    # precision @ top-100
    k = min(100, len(proba))
    topk = np.argsort(proba)[::-1][:k]
    precision_at_100 = float(yte[topk].mean()) if k else 0.0

    print(f"[train] holdout PR-AUC（主指標）= {pr_auc:.4f}")
    print(f"[train] holdout ROC-AUC        = {roc:.4f}")
    print(f"[train] recall@FPR=1%          = {recall_at_fpr1:.4f}")
    print(f"[train] precision@100          = {precision_at_100:.4f}")
    print(f"[train] MCC@thr={best_thr:.2f}        = {mcc:.4f}")
    print(f"[train] 人頭召回@thr={best_thr:.2f}    = {recall:.4f}")
    if roc >= 0.999:
        print("[train] ⚠ ROC-AUC≈1.0：極可能資料洩漏或過擬，請以 PR-AUC 與 out-of-time 為準")

    # ── 校準品質（ECE + Brier + 可靠度曲線）：證明「風險分數＝真實詐欺機率」 ──
    ece, reliability = expected_calibration_error(yte, proba, bins=10)
    brier = float(brier_score_loss(yte, proba))
    print(f"[train] 校準 ECE={ece:.4f}  Brier={brier:.4f}（越低越準）")

    # ── 基線對照：規則 baseline vs Logistic Regression vs LightGBM（證明模型選型有依據）──
    rules_score = np.array([rule_risk(r)[0] / 100.0 for r in test.to_dict("records")])
    rules_pr = float(average_precision_score(yte, rules_score))
    rules_roc = float(roc_auc_score(yte, rules_score))

    lr = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42),
    )
    lr.fit(Xtr, ytr)
    lr_proba = lr.predict_proba(Xte)[:, 1]
    lr_pr = float(average_precision_score(yte, lr_proba))
    lr_roc = float(roc_auc_score(yte, lr_proba))
    print(f"[train] 基線 PR-AUC  rules={rules_pr:.4f}  LR={lr_pr:.4f}  LGBM={pr_auc:.4f}")

    # ── CHT 訊號增益消融：移除中華電信門號實名/裝置/地理等訊號後重訓，量化能力提升 ──
    from synth import CHT_SIGNAL_COLS
    cht_cols = [c for c in CHT_SIGNAL_COLS if c in FEATURE_ORDER]
    keep_idx = [i for i, name in enumerate(FEATURE_ORDER) if name not in cht_cols]
    _, ablate_cal = fit_calibrated_lgbm(Xtr[:, keep_idx], ytr, Xva[:, keep_idx], yva)
    ablate_proba = ablate_cal.predict_proba(Xte[:, keep_idx])[:, 1]
    ablate_pr = float(average_precision_score(yte, ablate_proba))
    lift = float(pr_auc) - ablate_pr
    lift_pct = round(100.0 * lift / ablate_pr, 2) if ablate_pr > 0 else 0.0
    print(f"[train] CHT 訊號增益：無 CHT PR-AUC={ablate_pr:.4f} → 全特徵={pr_auc:.4f}（+{lift:.4f}, +{lift_pct}%）")

    # IsolationForest 用正常樣本訓練；contamination 依實際詐欺率（夾在合理範圍）
    contamination = float(min(0.2, max(0.01, ytr.mean())))
    iso = IsolationForest(n_estimators=200, contamination=contamination, random_state=42)
    iso.fit(Xtr[ytr == 0])
    raw = -iso.score_samples(Xtr)
    amin, amax = float(np.percentile(raw, 1)), float(np.percentile(raw, 99))

    joblib.dump(
        {
            "lgbm": clf, "calibrator": calibrated, "iso": iso,
            "feature_list": FEATURE_ORDER,
            "anomaly_min": amin, "anomaly_max": amax,
            "source": source, "holdout_pr_auc": float(pr_auc), "holdout_auc": float(roc),
        },
        MODEL_OUT,
    )
    print(f"[train] 已存 {MODEL_OUT}")

    # 指標與特徵重要度 → metrics.json（簡報圖表用）
    pred_te = (proba >= best_thr).astype(int)
    tp = int(((pred_te == 1) & (yte == 1)).sum())
    fp = int(((pred_te == 1) & (yte == 0)).sum())
    fn = int(((pred_te == 0) & (yte == 1)).sum())
    tn = int(((pred_te == 0) & (yte == 0)).sum())
    importances = sorted(
        (
            {"feature": FEATURE_ORDER[i], "importance": int(clf.feature_importances_[i])}
            for i in range(len(FEATURE_ORDER))
        ),
        key=lambda d: d["importance"],
        reverse=True,
    )[:12]
    metrics = {
        "source": source,
        "rows": int(len(df)),
        "fraud": int(df["isFraud"].sum()),
        "primary_metric": "PR-AUC",
        "fraud_prevalence": round(float(yte.mean()), 4),  # PR-AUC 的隨機基準線
        "holdout_pr_auc": round(float(pr_auc), 4),
        "holdout_roc_auc": round(float(roc), 4),
        "holdout_auc": round(float(roc), 4),  # 向後相容
        "recall_at_fpr_1pct": round(float(recall_at_fpr1), 4),
        "precision_at_100": round(float(precision_at_100), 4),
        "mcc": round(float(mcc), 4),
        "threshold": round(float(best_thr), 2),
        "recall_at_threshold": round(float(recall), 4),
        "confusion_at_threshold": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "calibration": "isotonic",
        "calibration_quality": {
            "ece": round(ece, 4),
            "brier": round(brier, 4),
            "reliability_curve": reliability,
        },
        "baselines": {
            "rules_only": {"pr_auc": round(rules_pr, 4), "roc_auc": round(rules_roc, 4)},
            "logistic_regression": {"pr_auc": round(lr_pr, 4), "roc_auc": round(lr_roc, 4)},
            "lightgbm": {"pr_auc": round(float(pr_auc), 4), "roc_auc": round(float(roc), 4)},
        },
        "cht_signal_ablation": {
            "without_cht_pr_auc": round(ablate_pr, 4),
            "with_cht_pr_auc": round(float(pr_auc), 4),
            "lift_pr_auc": round(lift, 4),
            "lift_pct": lift_pct,
            "signals": cht_cols,
        },
        "split": "out-of-time (by step)",
        "top_feature_importances": importances,
    }
    with open(os.path.join(HERE, "metrics.json"), "w", encoding="utf-8") as mf:
        json.dump(metrics, mf, ensure_ascii=False, indent=2)
    print("[train] 已存 metrics.json")

    if pr_auc < 0.70:
        print(f"[train] ⚠ PR-AUC<0.70（{pr_auc:.4f}），資料訊號可能不足")


if __name__ == "__main__":
    main()
