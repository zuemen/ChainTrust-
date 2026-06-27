"""特徵工程 — 訓練與服務必須共用同一套，確保一致。"""
from __future__ import annotations

from typing import Any, Mapping

TX_TYPES = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]

# 固定特徵順序（model.joblib 會一併存 feature_list 以防漂移）
FEATURE_ORDER: list[str] = [
    "amount",
    "oldbalanceOrg",
    "newbalanceOrig",
    "oldbalanceDest",
    "newbalanceDest",
    "errorBalanceOrig",
    "errorBalanceDest",
    "tx_count_1h",
    "tx_count_24h",
    "vc_age_days",
    "account_age_days",
    "cross_institution_presentations",
    "payee_risk",
    "device_changed",
    "mobile_realname_verified",
    "geo_jump",
    *[f"type_{t}" for t in TX_TYPES],
]


def _num(v: Any, default: float = 0.0) -> float:
    try:
        if isinstance(v, bool):
            return 1.0 if v else 0.0
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def featurize(row: Mapping[str, Any]) -> dict[str, float]:
    """把一筆 ctx（dict 或 pandas row）轉成特徵字典。容忍缺欄位（給預設）。"""
    amount = _num(row.get("amount"))
    old_org = _num(row.get("oldbalanceOrg"))
    new_org = _num(row.get("newbalanceOrig"))
    old_dest = _num(row.get("oldbalanceDest"))
    new_dest = _num(row.get("newbalanceDest"))

    # PaySim 經典強特徵：帳務不一致
    error_org = old_org - amount - new_org
    error_dest = old_dest + amount - new_dest

    tx_type = str(row.get("type", "PAYMENT")).upper()

    feats: dict[str, float] = {
        "amount": amount,
        "oldbalanceOrg": old_org,
        "newbalanceOrig": new_org,
        "oldbalanceDest": old_dest,
        "newbalanceDest": new_dest,
        "errorBalanceOrig": error_org,
        "errorBalanceDest": error_dest,
        "tx_count_1h": _num(row.get("tx_count_1h")),
        "tx_count_24h": _num(row.get("tx_count_24h")),
        "vc_age_days": _num(row.get("vc_age_days"), 365.0),
        "account_age_days": _num(row.get("account_age_days"), 365.0),
        "cross_institution_presentations": _num(row.get("cross_institution_presentations")),
        "payee_risk": _num(row.get("payee_risk")),
        "device_changed": _num(row.get("device_changed")),
        "mobile_realname_verified": _num(row.get("mobile_realname_verified"), 1.0),
        "geo_jump": _num(row.get("geo_jump")),
    }
    for t in TX_TYPES:
        feats[f"type_{t}"] = 1.0 if tx_type == t else 0.0
    return feats


def vectorize(row: Mapping[str, Any], feature_order: list[str] | None = None) -> list[float]:
    order = feature_order or FEATURE_ORDER
    feats = featurize(row)
    return [float(feats.get(name, 0.0)) for name in order]
