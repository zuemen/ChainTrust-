"""FastAPI 反詐服務：POST /score、GET /health。"""
from __future__ import annotations

from fastapi import FastAPI

from .model import model_loaded, score
from .schemas import ScoreRequest, ScoreResponse

app = FastAPI(title="ChainTrust AI 反詐服務", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model_loaded": model_loaded()}


@app.post("/score", response_model=ScoreResponse)
def score_endpoint(req: ScoreRequest) -> ScoreResponse:
    return score(req.model_dump())
