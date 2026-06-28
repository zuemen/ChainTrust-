"""FastAPI 反詐服務：POST /score、GET /health、GET /metrics。"""
from __future__ import annotations

import json
import os

from fastapi import FastAPI

from .model import model_loaded, score
from .schemas import ScoreRequest, ScoreResponse

app = FastAPI(title="ChainTrust AI 反詐服務", version="0.2.0")

_METRICS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "metrics.json")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model_loaded": model_loaded()}


@app.post("/score", response_model=ScoreResponse)
def score_endpoint(req: ScoreRequest) -> ScoreResponse:
    return score(req.model_dump())


@app.get("/metrics")
def metrics() -> dict:
    """訓練評估報告（PR-AUC、校準品質、基線對照、CHT 訊號增益）。

    供前端「模型可信度報告」與簡報使用。模型尚未訓練時回 available=False。
    """
    if not os.path.exists(_METRICS_PATH):
        return {"available": False, "model_loaded": model_loaded()}
    try:
        with open(_METRICS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return {"available": True, "model_loaded": model_loaded(), "metrics": data}
    except Exception:
        return {"available": False, "model_loaded": model_loaded()}
