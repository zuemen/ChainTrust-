"""訓練 LightGBM + IsolationForest，存 model.joblib（含 feature_list）。

資料優先序：data/paysim.csv（真 PaySim，會自動補增益欄）→ 否則合成資料。
時間切分（依 step）train/val/test，印 holdout AUC / PR-AUC / 人頭召回。
"""
from __future__ import annotations

import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")  # 避免 Windows cp950 主控台對 CJK 崩潰
except Exception:
    pass

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, recall_score, roc_auc_score
import lightgbm as lgb

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

from app.featurize import FEATURE_ORDER, featurize  # noqa: E402

DATA_CSV = os.path.join(HERE, "data", "paysim.csv")
MODEL_OUT = os.path.join(HERE, "model.joblib")

AUGMENT_DEFAULTS = {
    "tx_count_1h": 0, "tx_count_24h": 0, "device_changed": 0,
    "mobile_realname_verified": 1, "vc_age_days": 365, "account_age_days": 365,
    "cross_institution_presentations": 0, "payee_risk": 0.0, "geo_jump": 0,
}


def load_data() -> tuple[pd.DataFrame, str]:
    if os.path.exists(DATA_CSV):
        df = pd.read_csv(DATA_CSV)
        for k, v in AUGMENT_DEFAULTS.items():
            if k not in df.columns:
                df[k] = v
        if "step" not in df.columns:
            df["step"] = np.arange(len(df))
        return df, f"PaySim ({DATA_CSV})"
    from synth import generate
    return generate(), "synthetic (PaySim-like)"


def to_matrix(df: pd.DataFrame) -> np.ndarray:
    feats = [featurize(r) for r in df.to_dict("records")]
    return np.array([[f[name] for name in FEATURE_ORDER] for f in feats], dtype=float)


def main() -> None:
    df, source = load_data()
    print(f"[train] 資料來源：{source}  rows={len(df)}  fraud={int(df['isFraud'].sum())}")

    # 依時間切分，避免洩漏
    df = df.sort_values("step").reset_index(drop=True)
    n = len(df)
    tr_end, va_end = int(n * 0.7), int(n * 0.85)
    train, val, test = df[:tr_end], df[tr_end:va_end], df[va_end:]

    Xtr, ytr = to_matrix(train), train["isFraud"].to_numpy()
    Xva, yva = to_matrix(val), val["isFraud"].to_numpy()
    Xte, yte = to_matrix(test), test["isFraud"].to_numpy()

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

    # 用驗證集挑最大化 F1 的門檻，避免 scale_pos_weight 造成的機率校準偏移
    proba_va = clf.predict_proba(Xva)[:, 1]
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

    proba = clf.predict_proba(Xte)[:, 1]
    auc = roc_auc_score(yte, proba)
    pr_auc = average_precision_score(yte, proba)
    recall = recall_score(yte, (proba >= best_thr).astype(int))
    print(f"[train] holdout AUC      = {auc:.4f}")
    print(f"[train] holdout PR-AUC   = {pr_auc:.4f}")
    print(f"[train] 最佳門檻(val F1) = {best_thr:.2f}")
    print(f"[train] holdout 人頭召回 = {recall:.4f} @thr={best_thr:.2f}")

    # IsolationForest 用正常樣本訓練
    iso = IsolationForest(n_estimators=200, contamination=0.06, random_state=42)
    iso.fit(Xtr[ytr == 0])
    raw = -iso.score_samples(Xtr)
    amin, amax = float(np.percentile(raw, 1)), float(np.percentile(raw, 99))

    joblib.dump(
        {
            "lgbm": clf, "iso": iso,
            "feature_list": FEATURE_ORDER,
            "anomaly_min": amin, "anomaly_max": amax,
            "source": source, "holdout_auc": float(auc),
        },
        MODEL_OUT,
    )
    print(f"[train] 已存 {MODEL_OUT}")
    if auc < 0.90:
        print(f"[train] ⚠ AUC<0.90（{auc:.4f}），資料訊號可能不足")


if __name__ == "__main__":
    main()
