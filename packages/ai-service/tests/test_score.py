"""固定向量回歸測試：人頭→block、正常→pass；門檻與規則 baseline 確定性。"""
from __future__ import annotations

import json
import os

from fastapi.testclient import TestClient

from app.main import app
from app.model import decide
from app.rules import rule_risk

client = TestClient(app)

HERE = os.path.dirname(__file__)
DEMO = os.path.join(os.path.dirname(HERE), "demo_data.json")


def _samples():
    with open(DEMO, encoding="utf-8") as f:
        return json.load(f)["samples"]


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_decision_thresholds():
    assert decide(0) == "pass"
    assert decide(39) == "pass"
    assert decide(40) == "review"
    assert decide(69) == "review"
    assert decide(70) == "block"
    assert decide(100) == "block"


def test_demo_samples_pass_and_block():
    """正常→pass、人頭→block（不論用 model 或 rules 都應成立）。"""
    for s in _samples():
        r = client.post("/score", json=s["ctx"])
        assert r.status_code == 200
        body = r.json()
        if s["expect"] in ("pass", "block"):
            assert body["decision"] == s["expect"], f"{s['label']}: {body}"


def test_mule_reasons():
    mule = next(s for s in _samples() if s["label"] == "mule_transfer_drain")
    body = client.post("/score", json=mule["ctx"]).json()
    assert body["decision"] == "block"
    assert "MULE_PATTERN" in body["reasons"]
    assert "NO_REALNAME" in body["reasons"]


def test_rules_baseline_deterministic():
    """規則 baseline（無模型退路）固定向量：人頭高分、正常 0 分。"""
    mule = next(s for s in _samples() if s["label"] == "mule_transfer_drain")["ctx"]
    normal = next(s for s in _samples() if s["label"] == "normal_payment")["ctx"]
    risk_m, codes_m = rule_risk(mule)
    risk_n, codes_n = rule_risk(normal)
    assert risk_m >= 70 and "MULE_PATTERN" in codes_m
    assert risk_n < 40 and codes_n == []


def test_top_factors_present_and_shaped():
    """可解釋輸出：人頭交易應回傳非空 top_factors，且每筆有 feature/label/impact。"""
    mule = next(s for s in _samples() if s["label"] == "mule_transfer_drain")
    body = client.post("/score", json=mule["ctx"]).json()
    tf = body.get("top_factors")
    assert isinstance(tf, list) and len(tf) >= 1
    first = tf[0]
    assert set(first.keys()) >= {"feature", "label", "impact"}
    assert isinstance(first["label"], str) and first["label"]
