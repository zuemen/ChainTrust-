# Claude Code — M2 啟動 Prompt

把下面整段貼進 Claude Code（在 ChainTrust 根目錄）。分三階段，每階段暫停讓你驗收。

---

```text
延續 ChainTrust 專案。先讀 CLAUDE.md、docs/architecture.md、docs/poc-spec.md、docs/ai-fraud-spec.md。
維持護欄：testnet only、絕不提交私鑰/.env、CHT 整合點用 adapter+mock、程式碼英文(註解可中文)、
Conventional Commits、每階段改完先跑該套件 test 再 commit。分三階段，每階段結束暫停並回報，等我確認再繼續。

M2.0 — SD-JWT 選擇性揭露（收尾 M1 gap）：
在 packages/issuer-verifier 接上 SD-JWT VC：
- 簽發 KYCCredential 時，把各 claim 設為可選擇揭露(salted disclosures)。
- Holder 出示時只揭露「kycLevel>=2」述詞與 credentialStatus，不洩其餘欄位。
- verifier 能在未取得完整 PII 下驗證該述詞，仍走原本 isTrustedIssuer + isRevoked 流程。
- 更新 e2e：斷言「未揭露欄位不存在於出示內容」。
驗收：e2e 全綠且可證明最小揭露(印出實際被揭露的欄位清單)。暫停回報。

M2.1 — AI 反詐 /score：
依 docs/ai-fraud-spec.md，在 packages/ai-service：
- 加 train.py：用 PaySim 訓練 LightGBM + IsolationForest，存 model.joblib(含 feature_list)。
- model.py 自動載入模型，featurize 與訓練一致；無模型時退回規則 baseline。
- /score 回傳校準後 risk + decision + reasons；補 pytest 固定向量回歸；印出 holdout AUC。
- 備 demo_data.json(正常×人頭各數筆)。
- 在 issuer-verifier 的 verifier 驗證通過後呼叫 ai-service POST /score，整合風險決策。
驗收：holdout AUC>0.90；人頭樣本→block+reasons；正常→pass。暫停回報。

M2.2 — 錢包出示 UI：
在 packages/wallet：
- 收到出示請求 → 最小揭露同意畫面(明列「將揭露哪些欄位」) → 出示 → 顯示驗證結果與 AI 風險警示。
- 風險用配色與 reasons 呈現(pass/review/block)；串接 issuer-verifier 與 ai-service。
驗收：能完成一次「跨機構重用 KYC(最小揭露)」並在高風險交易顯示攔截警示。暫停回報。

全部完成後，回報整體 e2e 狀態，並提供「一鍵起 demo」的方式(腳本或 docker-compose)。
開始前先用一段話覆述你的 M2.0 計畫。
```

---

## 備註

- 三階段刻意分開，避免一次生成太多難驗收；每階段綠燈再進下一步。
- M2.1 需要下載 PaySim（Kaggle）。若環境無法連 Kaggle，可先用小量合成資料讓管線跑通，之後換真資料重訓。
- M2 完成後即具備完整「五步 Demo 線」，可直接拍初賽影片與排決賽簡報。
