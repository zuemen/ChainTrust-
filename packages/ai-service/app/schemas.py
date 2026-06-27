"""API 契約：ScoreRequest / ScoreResponse（勿改既有欄位名，呼叫端依賴）。"""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field

TxType = Literal["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]
Decision = Literal["pass", "review", "block"]


class ScoreRequest(BaseModel):
    """交易／出示情境。金額與餘額用模擬幣單位；增益訊號多來自 CHT mock。"""

    amount: float = 0.0
    type: TxType = "PAYMENT"

    # 帳戶餘額（PaySim 原生）
    oldbalanceOrg: float = 0.0
    newbalanceOrig: float = 0.0
    oldbalanceDest: float = 0.0
    newbalanceDest: float = 0.0

    # 速度（velocity）
    tx_count_1h: int = 0
    tx_count_24h: int = 0

    # ChainTrust 增益訊號
    device_changed: bool = False
    mobile_realname_verified: bool = True  # 來自 CHT 門號電子卡 mock（強訊號）
    vc_age_days: int = 365
    cross_institution_presentations: int = 0
    payee_risk: float = 0.0  # 0..1
    geo_jump: bool = False
    account_age_days: int = 365

    model_config = {"extra": "ignore"}


class ScoreResponse(BaseModel):
    risk: int = Field(ge=0, le=100, description="0-100 風險分數")
    decision: Decision
    reasons: list[str] = Field(default_factory=list)
    source: Literal["model", "rules"] = "rules"
    p_fraud: float | None = None
    anomaly: float | None = None
