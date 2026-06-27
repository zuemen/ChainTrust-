"""可解釋規則 baseline — 無模型時的退路，也用來產生 reason codes。"""
from __future__ import annotations

from typing import Any, Mapping

# reason code 對照
REASON_LABELS = {
    "MULE_PATTERN": "人頭金流樣態（大額轉出後帳戶清空）",
    "NO_REALNAME": "未通過門號實名（CHT 電子卡）",
    "VELOCITY": "短時間高頻交易",
    "DEVICE_CHANGE": "裝置變更",
    "GEO_JUMP": "地理位置跳躍",
    "NEW_ACCOUNT": "新開帳戶",
    "HIGH_PAYEE_RISK": "收款方高風險",
    "CROSS_INST_REUSE": "跨機構頻繁出示",
}


def reason_codes(row: Mapping[str, Any]) -> list[str]:
    """依情境列出觸發的 reason code（不含分數）。"""
    codes: list[str] = []
    amount = float(row.get("amount", 0) or 0)
    old_org = float(row.get("oldbalanceOrg", 0) or 0)
    new_org = float(row.get("newbalanceOrig", 0) or 0)
    tx_type = str(row.get("type", "PAYMENT")).upper()

    mule = (
        tx_type in ("TRANSFER", "CASH_OUT")
        and amount >= 50_000
        and old_org >= 50_000
        and new_org <= 0.01 * old_org
    )
    if mule:
        codes.append("MULE_PATTERN")
    if not bool(row.get("mobile_realname_verified", True)):
        codes.append("NO_REALNAME")
    if float(row.get("tx_count_1h", 0) or 0) >= 5 or float(row.get("tx_count_24h", 0) or 0) >= 20:
        codes.append("VELOCITY")
    if bool(row.get("device_changed", False)):
        codes.append("DEVICE_CHANGE")
    if bool(row.get("geo_jump", False)):
        codes.append("GEO_JUMP")
    if float(row.get("account_age_days", 365) or 365) < 7:
        codes.append("NEW_ACCOUNT")
    if float(row.get("payee_risk", 0) or 0) >= 0.7:
        codes.append("HIGH_PAYEE_RISK")
    if float(row.get("cross_institution_presentations", 0) or 0) >= 8:
        codes.append("CROSS_INST_REUSE")
    return codes


def rule_risk(row: Mapping[str, Any]) -> tuple[int, list[str]]:
    """規則風險分數（0-100）＋ reason codes。"""
    weights = {
        "MULE_PATTERN": 45,
        "NO_REALNAME": 25,
        "VELOCITY": 20,
        "DEVICE_CHANGE": 10,
        "GEO_JUMP": 10,
        "NEW_ACCOUNT": 10,
        "HIGH_PAYEE_RISK": 15,
        "CROSS_INST_REUSE": 10,
    }
    codes = reason_codes(row)
    score = sum(weights.get(c, 0) for c in codes)
    risk = max(0, min(100, int(round(score))))
    return risk, codes
