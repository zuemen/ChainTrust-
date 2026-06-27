#!/usr/bin/env bash
# 一鍵起 ChainTrust Demo（macOS / Linux）
# 啟動 ai-service(:8000) + issuer-verifier(:3001) + wallet(:5173)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI="$ROOT/packages/ai-service"
PY="$AI/.venv/bin/python"

pids=()
cleanup() { echo "停止服務…"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

if [ ! -x "$PY" ]; then
  echo "[!] 找不到 ai-service venv，請先： pnpm ai:setup && pnpm ai:train"
else
  [ -f "$AI/model.joblib" ] || (echo "[ai] 訓練模型…"; (cd "$AI" && "$PY" train.py))
  echo "[ai] http://localhost:8000"
  (cd "$AI" && "$PY" -m uvicorn app.main:app --port 8000) & pids+=($!)
fi

echo "[iv] http://localhost:3001"
pnpm --filter @chaintrust/issuer-verifier dev & pids+=($!)

sleep 3
echo "[wallet] http://localhost:5173  → 開啟瀏覽器"
pnpm --filter @chaintrust/wallet dev & pids+=($!)

wait
