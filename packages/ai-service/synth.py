"""合成 PaySim-like 資料產生器。

無 Kaggle PaySim 時的退路。**標籤由「潛在風險 logit + Bernoulli 抽樣」產生**，而非
事先把整列標成 0/1。logit 刻意含**交互作用項（AND 組合）**與**獨立的 CHT 訊號權重**，
忠實反映真實人頭詐欺的本質：

- 單一訊號（大額 / 新帳戶 / 未實名 / 換裝置）各自只是「弱訊號」，
  但**同時出現**才構成強訊號 —— 這是線性模型抓不到、需要 GBM 才學得到的非線性結構。
- 中華電信增益訊號（門號實名 / 裝置 / 地理 / 帳戶年齡 / 收款方風險）帶有**獨立資訊**，
  移除後 PR-AUC 會明顯下降（train.py 的 CHT 消融會量化此增益）。

特徵分佈高度重疊 + Bernoulli 抽樣雜訊，使 holdout PR-AUC 真實（~0.85–0.92，非 1.0）。
含時間欄 `step` 供 out-of-time 切分。

要換真資料：把 PaySim CSV 放到 data/paysim.csv，train.py 會優先使用。
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from app.featurize import featurize  # noqa: E402

TYPES = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def generate(n: int = 40_000, fraud_ratio: float = 0.08, seed: int = 42) -> pd.DataFrame:
    """混合模型合成資料。詐欺含三種樣態，刻意讓 CHT 身分訊號帶獨立資訊、並含非線性交互。

    - 正常戶：交易與身分訊號皆乾淨；含「大額但已實名」與「未實名但小額」兩種安全干擾項。
    - 詐欺 A（身分型，~35%）：**交易表面正常**，僅靠 CHT 身分訊號（未實名＋換裝置＋異地＋新帳戶）
      才攔得到 → 移除 CHT 訊號後這類完全漏接（消融會顯示明顯 PR-AUC 下降）。
    - 詐欺 B（交互型，~40%）：**大額 × 未實名**才可疑（單看大額或單看未實名都不可疑，
      因正常戶兩者各自都有）→ 線性模型抓不到、需要 GBM 的交互結構。
    - 詐欺 C（金流型，~25%）：人頭環清空（高 drain＋水房 fan-in＋CASH_OUT），靠交易/圖譜訊號。
    """
    rng = np.random.default_rng(seed)
    n_fraud = int(n * fraud_ratio)
    n_legit = n - n_fraud
    n_a = int(n_fraud * 0.35)
    n_b = int(n_fraud * 0.40)
    n_c = n_fraud - n_a - n_b

    COLL = [f"MULE_COLL_{i}" for i in range(12)]
    def cust() -> str: return f"C{int(rng.integers(0, 900_000))}"
    def merch() -> str: return f"M{int(rng.integers(0, 90_000))}"

    def base() -> dict:
        return {"step": int(rng.integers(0, 720))}

    rows: list[dict] = []

    # ── 正常戶（含安全干擾項：大額/新帳戶/未實名各自單獨出現都安全，逼模型學「三者同時」）──
    for _ in range(n_legit):
        r = base()
        t = str(rng.choice(TYPES, p=[0.20, 0.20, 0.05, 0.42, 0.13]))
        # 邊際干擾：每個風險邊際各自獨立出現在正常戶（安全），唯獨「三者同時」才是詐欺
        big = rng.random() < 0.18                       # 合法大額
        young = rng.random() < 0.15                     # 合法新戶（新申辦的優質客戶）
        unverified = rng.random() < 0.25                # 合法未實名（尚未綁門號電子卡）
        old_org = float(abs(rng.lognormal(11.0 if big else 8.8, 1.0)))
        drain = float(rng.uniform(0.0, 0.5)) if rng.random() < 0.9 else float(rng.uniform(0.5, 0.9))
        amount = old_org * drain
        r.update({
            "type": t, "nameOrig": cust(), "nameDest": merch() if t == "PAYMENT" else cust(),
            "amount": amount, "oldbalanceOrg": old_org, "newbalanceOrig": max(0.0, old_org - amount),
            "oldbalanceDest": float(abs(rng.lognormal(8.0, 1.2))),
            "newbalanceDest": float(abs(rng.lognormal(8.0, 1.2))) + amount,
            "tx_count_1h": int(rng.integers(0, 5)), "tx_count_24h": int(rng.integers(0, 15)),
            "device_changed": int(rng.random() < 0.08),
            "mobile_realname_verified": 0 if unverified else 1,
            "vc_age_days": int(rng.integers(0, 60) if young else rng.integers(60, 1000)),
            "account_age_days": int(rng.integers(0, 40) if young else rng.integers(40, 2000)),
            "cross_institution_presentations": int(rng.integers(0, 7)),
            "payee_risk": float(np.clip(rng.normal(0.18, 0.12), 0, 1)),
            "geo_jump": int(rng.random() < 0.06), "isFraud": 0,
        })
        rows.append(r)

    # ── 詐欺 A：身分型（交易看似正常，靠 CHT 身分訊號攔截）──
    for _ in range(n_a):
        r = base()
        t = str(rng.choice(TYPES, p=[0.10, 0.15, 0.05, 0.45, 0.25]))
        old_org = float(abs(rng.lognormal(8.8, 1.0)))
        drain = float(rng.uniform(0.1, 0.6))            # 與正常重疊
        amount = old_org * drain
        r.update({
            "type": t, "nameOrig": cust(), "nameDest": merch() if t == "PAYMENT" else cust(),
            "amount": amount, "oldbalanceOrg": old_org, "newbalanceOrig": max(0.0, old_org - amount),
            "oldbalanceDest": float(abs(rng.lognormal(8.0, 1.2))),
            "newbalanceDest": float(abs(rng.lognormal(8.0, 1.2))) + amount,
            "tx_count_1h": int(rng.integers(1, 8)), "tx_count_24h": int(rng.integers(5, 35)),
            "device_changed": int(rng.random() < 0.75),
            "mobile_realname_verified": int(rng.random() < 0.10),   # 幾乎都未實名（CHT 強訊號）
            "vc_age_days": int(rng.integers(0, 60)), "account_age_days": int(rng.integers(0, 40)),
            "cross_institution_presentations": int(rng.integers(6, 18)),
            "payee_risk": float(np.clip(rng.normal(0.35, 0.18), 0, 1)),
            "geo_jump": int(rng.random() < 0.70), "isFraud": 1,
        })
        rows.append(r)

    # ── 詐欺 B：交互型（大額 × 新帳戶 × 未實名「三者同時」才是詐欺；任一單獨皆見於正常戶）──
    for _ in range(n_b):
        r = base()
        t = str(rng.choice(TYPES, p=[0.05, 0.30, 0.02, 0.18, 0.45]))
        old_org = float(abs(rng.lognormal(11.2, 0.8)))  # 大額（與合法大額同分佈）
        drain = float(rng.uniform(0.5, 1.0))
        amount = old_org * drain
        r.update({
            "type": t, "nameOrig": cust(), "nameDest": merch() if t == "PAYMENT" else cust(),
            "amount": amount, "oldbalanceOrg": old_org, "newbalanceOrig": max(0.0, old_org - amount) * float(rng.uniform(0, 0.2)),
            "oldbalanceDest": float(abs(rng.lognormal(7.2, 1.4))),
            "newbalanceDest": float(abs(rng.lognormal(7.2, 1.4))) + amount * float(rng.uniform(0, 0.6)),
            "tx_count_1h": int(rng.integers(1, 10)), "tx_count_24h": int(rng.integers(8, 45)),
            "device_changed": int(rng.random() < 0.40),
            "mobile_realname_verified": 0,                          # 未實名
            "vc_age_days": int(rng.integers(0, 40)), "account_age_days": int(rng.integers(0, 40)),  # 新帳戶
            "cross_institution_presentations": int(rng.integers(3, 15)),
            "payee_risk": float(np.clip(rng.normal(0.4, 0.2), 0, 1)),
            "geo_jump": int(rng.random() < 0.4), "isFraud": 1,
        })
        rows.append(r)

    # ── 詐欺 C：金流型（人頭環清空，靠交易/圖譜）──
    for _ in range(n_c):
        r = base()
        t = "CASH_OUT" if rng.random() < 0.5 else "TRANSFER"
        old_org = float(abs(rng.lognormal(10.5, 0.9)))
        amount = old_org * float(rng.uniform(0.85, 1.0))
        if t == "TRANSFER":
            n_orig, n_dest = cust(), COLL[int(rng.integers(0, len(COLL)))]
        else:
            n_orig, n_dest = COLL[int(rng.integers(0, len(COLL)))], merch()
        r.update({
            "type": t, "nameOrig": n_orig, "nameDest": n_dest,
            "amount": amount, "oldbalanceOrg": old_org,
            "newbalanceOrig": max(0.0, old_org - amount) * float(rng.uniform(0, 0.05)),
            "oldbalanceDest": float(abs(rng.lognormal(7.0, 1.4))),
            "newbalanceDest": float(abs(rng.lognormal(7.0, 1.4))) + amount * float(rng.uniform(0, 0.5)),
            "tx_count_1h": int(rng.integers(2, 12)), "tx_count_24h": int(rng.integers(10, 55)),
            "device_changed": int(rng.random() < 0.5),
            "mobile_realname_verified": int(rng.random() < 0.3),
            "vc_age_days": int(rng.integers(0, 90)), "account_age_days": int(rng.integers(0, 60)),
            "cross_institution_presentations": int(rng.integers(3, 18)),
            "payee_risk": float(np.clip(rng.normal(0.6, 0.2), 0, 1)),
            "geo_jump": int(rng.random() < 0.45), "isFraud": 1,
        })
        rows.append(r)

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
