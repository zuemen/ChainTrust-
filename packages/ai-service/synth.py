"""合成 PaySim-like 資料產生器。

無 Kaggle PaySim 時的退路：模擬 TRANSFER→CASH_OUT 人頭金流鏈，
並加入 ChainTrust 增益訊號（門號實名/裝置/地理/速度等）。
特徵分佈刻意**高度重疊**並加入標籤雜訊，使 holdout AUC 真實（~0.95，非 1.0）。
含時間欄 `step` 供時間切分。

要換真資料：把 PaySim CSV 放到 data/paysim.csv，train.py 會優先使用。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

TYPES = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]


def generate(n: int = 40_000, fraud_ratio: float = 0.07, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n_fraud = int(n * fraud_ratio)
    n_legit = n - n_fraud
    rows = []

    # ── 正常交易（含偶發大額合法轉帳，與詐欺部分重疊）──
    for _ in range(n_legit):
        t = rng.choice(TYPES, p=[0.20, 0.22, 0.05, 0.43, 0.10])
        amount = float(abs(rng.lognormal(mean=8.6, sigma=1.3)))
        old_org = float(amount + abs(rng.lognormal(8.6, 1.1)))
        # 多數合法交易帳戶不會清空，少數會（重疊）
        drain = float(rng.uniform(0.0, 0.5)) if rng.random() < 0.9 else float(rng.uniform(0.5, 1.0))
        new_org = max(0.0, old_org - amount * drain)
        old_dest = float(abs(rng.lognormal(8.0, 1.2)))
        new_dest = old_dest + amount + rng.normal(0, amount * 0.03)
        rows.append({
            "step": int(rng.integers(0, 720)),
            "type": t,
            "amount": amount,
            "oldbalanceOrg": old_org,
            "newbalanceOrig": new_org,
            "oldbalanceDest": old_dest,
            "newbalanceDest": new_dest,
            "tx_count_1h": int(rng.integers(0, 5)),
            "tx_count_24h": int(rng.integers(0, 15)),
            "device_changed": int(rng.random() < 0.08),
            "mobile_realname_verified": int(rng.random() < 0.92),
            "vc_age_days": int(rng.integers(20, 1000)),
            "account_age_days": int(rng.integers(30, 2000)),
            "cross_institution_presentations": int(rng.integers(0, 7)),
            "payee_risk": float(np.clip(rng.normal(0.18, 0.14), 0, 1)),
            "geo_jump": int(rng.random() < 0.06),
            "isFraud": 0,
        })

    # ── 人頭詐欺（多項中等強度訊號；與正常重疊但可分）──
    for _ in range(n_fraud):
        t = rng.choice(TYPES, p=[0.04, 0.42, 0.02, 0.10, 0.42])  # 偏 TRANSFER/CASH_OUT 但不絕對
        old_org = float(abs(rng.lognormal(10.2, 0.9)))
        amount = old_org * float(rng.uniform(0.7, 1.0))
        new_org = max(0.0, old_org - amount) * float(rng.uniform(0.0, 0.10))
        old_dest = float(abs(rng.lognormal(7.2, 1.4)))
        new_dest = old_dest + amount * float(rng.uniform(0.0, 0.6))  # 帳務常不一致
        rows.append({
            "step": int(rng.integers(0, 720)),
            "type": t,
            "amount": amount,
            "oldbalanceOrg": old_org,
            "newbalanceOrig": new_org,
            "oldbalanceDest": old_dest,
            "newbalanceDest": new_dest,
            "tx_count_1h": int(rng.integers(2, 12)),
            "tx_count_24h": int(rng.integers(10, 55)),
            "device_changed": int(rng.random() < 0.58),
            "mobile_realname_verified": int(rng.random() < 0.22),  # 多數未實名
            "vc_age_days": int(rng.integers(0, 75)),
            "account_age_days": int(rng.integers(0, 45)),
            "cross_institution_presentations": int(rng.integers(3, 18)),
            "payee_risk": float(np.clip(rng.normal(0.68, 0.17), 0, 1)),
            "geo_jump": int(rng.random() < 0.50),
            "isFraud": 1,
        })

    df = pd.DataFrame(rows)

    # 標籤雜訊：翻轉 ~1.5%，避免完美可分（更貼近真實）
    flip = rng.random(len(df)) < 0.015
    df.loc[flip, "isFraud"] = 1 - df.loc[flip, "isFraud"]

    return df.sample(frac=1.0, random_state=seed).reset_index(drop=True)


# 供 train.py 對「真 PaySim」補上 ChainTrust 增益訊號（PaySim 本身沒有這些欄位）。
# 注意：半合成 —— 交易詐欺訊號來自真資料；電信/裝置/地理訊號為「與 isFraud 相關」的模擬注入。
CHT_SIGNAL_COLS = [
    "tx_count_1h", "tx_count_24h", "device_changed", "mobile_realname_verified",
    "vc_age_days", "account_age_days", "cross_institution_presentations",
    "payee_risk", "geo_jump",
]


def augment_cht_signals(df: pd.DataFrame, seed: int = 42) -> pd.DataFrame:
    """以與 isFraud 相關的分佈注入 CHT 增益訊號，使模型能學到這些差異化特徵。"""
    rng = np.random.default_rng(seed)
    n = len(df)
    f = (df["isFraud"].to_numpy() == 1) if "isFraud" in df.columns else np.zeros(n, dtype=bool)

    def by_label(p_fraud: float, p_legit: float) -> np.ndarray:
        return np.where(f, rng.random(n) < p_fraud, rng.random(n) < p_legit).astype(int)

    df = df.copy()
    df["device_changed"] = by_label(0.58, 0.08)
    df["mobile_realname_verified"] = by_label(0.22, 0.92)
    df["geo_jump"] = by_label(0.50, 0.06)
    df["payee_risk"] = np.clip(
        np.where(f, rng.normal(0.68, 0.17, n), rng.normal(0.18, 0.14, n)), 0, 1
    )
    df["account_age_days"] = np.where(f, rng.integers(0, 45, n), rng.integers(30, 2000, n))
    df["vc_age_days"] = np.where(f, rng.integers(0, 75, n), rng.integers(20, 1000, n))
    df["cross_institution_presentations"] = np.where(f, rng.integers(3, 18, n), rng.integers(0, 7, n))
    df["tx_count_1h"] = np.where(f, rng.integers(2, 12, n), rng.integers(0, 5, n))
    df["tx_count_24h"] = np.where(f, rng.integers(10, 55, n), rng.integers(0, 15, n))
    return df
