"""模型載入與評分；無模型時自動退回規則 baseline。

評分輸出含 top_factors（可解釋）：模型模式用 LightGBM 的 SHAP 貢獻（pred_contrib，
不需額外相依），規則模式用觸發規則的權重排序。
"""
from __future__ import annotations

import os
from typing import Any, Mapping

from .featurize import FEATURE_ORDER, vectorize, feature_label
from .rules import rule_risk, reason_codes, WEIGHTS, REASON_LABELS
from .schemas import ScoreResponse, TopFactor

# 決策門檻（與 docs/ai-fraud-spec.md 一致）
PASS_MAX = 40   # risk < 40 → pass
BLOCK_MIN = 70  # risk >= 70 → block；中間為 review

MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "model.joblib"),
)

_bundle: dict[str, Any] | None = None
_load_attempted = False


def _load() -> dict[str, Any] | None:
    global _bundle, _load_attempted
    if _load_attempted:
        return _bundle
    _load_attempted = True
    try:
        import joblib  # 延遲匯入，無 ML 相依也能用規則
        if os.path.exists(MODEL_PATH):
            _bundle = joblib.load(MODEL_PATH)
    except Exception:
        _bundle = None
    return _bundle


def model_loaded() -> bool:
    return _load() is not None


def decide(risk: int) -> str:
    if risk >= BLOCK_MIN:
        return "block"
    if risk >= PASS_MAX:
        return "review"
    return "pass"


def _top_factors_from_model(bundle: dict, x: list[list[float]], k: int = 3) -> list[TopFactor]:
    """用 LightGBM SHAP 貢獻取「推升風險」前 k 大特徵（log-odds 空間，正值=更像詐欺）。"""
    try:
        import numpy as np
        booster = bundle["lgbm"].booster_
        contrib = booster.predict(np.asarray(x, dtype=float), pred_contrib=True)[0]
        order = bundle.get("feature_list", FEATURE_ORDER)
        pairs = [(order[i], float(contrib[i])) for i in range(len(order))]
        pairs.sort(key=lambda p: p[1], reverse=True)
        return [
            TopFactor(feature=f, label=feature_label(f), impact=round(v, 4))
            for f, v in pairs[:k]
            if v > 0
        ]
    except Exception:
        return []


def _top_factors_from_rules(codes: list[str], k: int = 3) -> list[TopFactor]:
    ranked = sorted(codes, key=lambda c: WEIGHTS.get(c, 0), reverse=True)[:k]
    return [
        TopFactor(feature=c, label=REASON_LABELS.get(c, c), impact=float(WEIGHTS.get(c, 0)))
        for c in ranked
    ]


def score(row: Mapping[str, Any]) -> ScoreResponse:
    bundle = _load()
    if bundle is None:
        risk, codes = rule_risk(row)
        return ScoreResponse(
            risk=risk,
            decision=decide(risk),
            reasons=codes,
            source="rules",
            top_factors=_top_factors_from_rules(codes),
        )

    feature_order = bundle.get("feature_list", FEATURE_ORDER)
    x = [vectorize(row, feature_order)]

    # p_fraud 優先用校準後機率（isotonic），使風險分數有意義；缺則用原始 LGBM
    estimator = bundle.get("calibrator") or bundle["lgbm"]
    p_fraud = float(estimator.predict_proba(x)[0][1])

    iso = bundle.get("iso")
    anomaly_norm = 0.0
    if iso is not None:
        raw = -float(iso.score_samples(x)[0])  # 越大越異常
        amin = float(bundle.get("anomaly_min", 0.0))
        amax = float(bundle.get("anomaly_max", 1.0))
        rng = amax - amin if amax > amin else 1.0
        anomaly_norm = max(0.0, min(1.0, (raw - amin) / rng))

    risk = int(round(100 * (0.7 * p_fraud + 0.3 * anomaly_norm)))
    risk = max(0, min(100, risk))

    # reason codes：規則映射（可解釋）；模型判高風險但規則無觸發時補 MODEL_ANOMALY
    codes = reason_codes(row)
    if not codes and risk >= PASS_MAX:
        codes = ["MODEL_ANOMALY"]

    # top_factors：優先用模型 SHAP 貢獻；取不到則退回規則權重
    top = _top_factors_from_model(bundle, x)
    if not top:
        top = _top_factors_from_rules(codes)

    return ScoreResponse(
        risk=risk,
        decision=decide(risk),
        reasons=codes,
        source="model",
        p_fraud=round(p_fraud, 4),
        anomaly=round(anomaly_norm, 4),
        top_factors=top,
    )
