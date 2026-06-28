"""FastAPI 反詐服務：GET /、GET /health、POST /score、GET /metrics、GET /docs。"""
from __future__ import annotations

import json
import os
import re

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from .model import model_loaded, score
from .schemas import ScoreRequest, ScoreResponse

app = FastAPI(title="ChainTrust AI 反詐服務", version="0.2.0")

_METRICS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "metrics.json")

# ── CORS：來源由 env ALLOWED_ORIGINS 控制（逗號分隔）。
# 預設含本機錢包與所有 *.vercel.app 預覽/正式網域。含 "*" 的項目走 regex 比對。
_DEFAULT_ORIGINS = "http://localhost:5173,https://*.vercel.app"
_origins_env = os.environ.get("ALLOWED_ORIGINS", _DEFAULT_ORIGINS)
_exact: list[str] = []
_patterns: list[str] = []
for o in (s.strip() for s in _origins_env.split(",")):
    if not o:
        continue
    if "*" in o:
        _patterns.append(re.escape(o).replace(r"\*", r"[^.]+"))
    else:
        _exact.append(o)
_origin_regex = "|".join(_patterns) if _patterns else None

app.add_middleware(
    CORSMiddleware,
    allow_origins=_exact,
    allow_origin_regex=_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict:
    """服務資訊與端點清單（雲端健康探測/瀏覽器直開時用，回 200）。"""
    return {
        "service": "ChainTrust AI 反詐服務",
        "version": app.version,
        "model_loaded": model_loaded(),
        "endpoints": {
            "GET /health": "健康檢查",
            "POST /score": "交易風險評分（risk/decision/confidence/top_factors）",
            "GET /metrics": "模型評估報告（PR-AUC / 校準 / 基線 / CHT 增益）",
            "GET /docs": "OpenAPI 互動文件",
        },
    }


@app.get("/favicon.ico")
def favicon() -> Response:
    """瀏覽器自動索取 favicon，回 204 消除 404 雜訊。"""
    return Response(status_code=204)


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
