"""模型載入與評分；無模型時自動退回規則 baseline。"""
from __future__ import annotations

import os
from typing import Any, Mapping

from .featurize import FEATURE_ORDER, vectorize
from .rules import rule_risk, reason_codes
from .schemas import ScoreResponse

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


def score(row: Mapping[str, Any]) -> ScoreResponse:
    bundle = _load()
    if bundle is None:
        risk, codes = rule_risk(row)
        return ScoreResponse(risk=risk, decision=decide(risk), reasons=codes, source="rules")

    feature_order = bundle.get("feature_list", FEATURE_ORDER)
    x = [vectorize(row, feature_order)]

    lgbm = bundle["lgbm"]
    p_fraud = float(lgbm.predict_proba(x)[0][1])

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

    return ScoreResponse(
        risk=risk,
        decision=decide(risk),
        reasons=codes,
        source="model",
        p_fraud=round(p_fraud, 4),
        anomaly=round(anomaly_norm, 4),
    )
