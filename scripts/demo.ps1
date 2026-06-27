# 一鍵起 ChainTrust Demo（Windows / PowerShell）
# 啟動 ai-service(:8000) + issuer-verifier(:3001) + wallet(:5173)
# 前置：pnpm install；packages/ai-service 已 `pnpm ai:setup` 建好 venv 並 `pnpm ai:train` 產 model.joblib
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "=== ChainTrust Demo 啟動中 ===" -ForegroundColor Cyan

# 1) AI 反詐服務
$ai = Join-Path $root "packages/ai-service"
$venvPy = Join-Path $ai ".venv/Scripts/python.exe"
if (-not (Test-Path $venvPy)) {
  Write-Host "[!] 找不到 ai-service venv，請先執行： pnpm ai:setup; pnpm ai:train" -ForegroundColor Yellow
} else {
  if (-not (Test-Path (Join-Path $ai "model.joblib"))) {
    Write-Host "[ai] 尚無 model.joblib，先訓練…" -ForegroundColor Yellow
    & $venvPy (Join-Path $ai "train.py")
  }
  Write-Host "[ai] 啟動 http://localhost:8000" -ForegroundColor Green
  Start-Process -FilePath $venvPy -ArgumentList "-m","uvicorn","app.main:app","--port","8000" -WorkingDirectory $ai -WindowStyle Minimized
}

# 2) issuer-verifier
Write-Host "[iv] 啟動 http://localhost:3001" -ForegroundColor Green
Start-Process -FilePath "pnpm" -ArgumentList "--filter","@chaintrust/issuer-verifier","dev" -WorkingDirectory $root -WindowStyle Minimized

# 3) wallet
Start-Sleep -Seconds 3
Write-Host "[wallet] 啟動 http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "→ 開啟瀏覽器： http://localhost:5173" -ForegroundColor Cyan
Write-Host "（關閉：結束上面彈出的 PowerShell 視窗，或 Get-Process node,python | Stop-Process）" -ForegroundColor DarkGray
& pnpm --filter "@chaintrust/wallet" dev
