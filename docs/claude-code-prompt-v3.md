# Claude Code Prompt v3 — 專業級 AI 反詐 ＋ 安全收尾

> 把最底下的 ```text``` 整段貼進 Claude Code（ChainTrust 根目錄）。上半部是給你與 Claude Code 的「反詐樣態專業依據」，請一併讀。

---

## 現況（已完成，請勿重做）

- 身分層：DID/VC、SD-JWT 選擇性揭露、`IssuerRegistry`、`RevocationRegistry`（撤銷權已綁信任根，13 合約測試綠）。
- AI：`featurize.py / rules.py / model.py / train.py / synth.py`；`/score` 已回傳 `top_factors`（LightGBM SHAP）；`train.py` 已 `augment_cht_signals()` ＋輸出 `metrics.json`；`demo_data.json` 已擴充；錢包已顯示「AI 判斷主要依據」。
- 一鍵：`pnpm demo`、`pnpm smoke`；測試：`pnpm contracts:test`、`pnpm iv:test`、`pnpm iv:e2e`、`pnpm test:ai`。

---

## 反詐樣態專業依據（務必對齊；也可寫進簡報）

**人頭帳戶（money mule）紅旗 — FATF／Europol／業界**
- 帳戶「只進只出、無正常商業活動」：款項進來後迅速轉出。
- **Pass-through（過水）**：資金到帳後 24–48 小時內移到下一個帳戶並提領；或「一筆入帳後 2 小時內出現等額出帳」。
- 短時間多筆對外轉帳（velocity）；同一網銀帳戶多個 IP／高風險地區 IP。
- 無法通過 CDD；帳戶持有人多為經濟弱勢、學生、新住民（Europol：>90% 與網路犯罪相關）。

**AML 交易監控樣態**
- **結構化／拆分（structuring/smurfing）**：金額刻意壓在通報門檻下（如門檻 1 萬就轉 9,900）、跨時間窗與關聯帳戶反覆小額進出。
- **快速資金移動（RMF）**：漏斗帳戶、與客戶輪廓不符的突發大額。
- **Fan-in 聚合戶（水房）**：多個來源匯入單一帳戶後集中提領 → ML 能跨帳戶群算 velocity，抓「一群帳戶數週內合計累積」這種單帳戶看不出的樣態。

**台灣脈絡**
- 詐團分工：**機房**（誘騙）＋**水房**（提領贓款、阻斷金流）。
- 誘騙提供帳戶：網路兼職「只要給帳戶就有報酬」、假貸款。
- 新制：人頭／警示帳戶每日轉帳、提領各 ≤ 1 萬、禁網銀。

**反詐 ML 最佳實務**
- 極度不平衡：**別用 accuracy**；主指標用 **PR-AUC**，另看 recall@固定FPR、precision@k、MCC。
- 處理不平衡：class weight 或 SMOTE/ADASYN（謹慎，避免合成洩漏）。
- 機率**校準**（isotonic/Platt）讓風險分數有意義；**時間切分**（out-of-time）防洩漏。
- 可解釋：SHAP／樹模型特徵貢獻，reason code 對齊 AML 樣態語言。
- ⚠ 看到 **AUC≈1.0 幾乎都是資料洩漏或過擬**，要用 PR-AUC＋out-of-time 檢查。

來源：FATF/Europol money mule（[Sumsub](https://sumsub.com/blog/money-muling/)、[SymphonyAI](https://www.symphonyai.com/resources/blog/financial-services/enhance-money-mule-detection/)）、AML 樣態（[Tookitaki](https://www.tookitaki.com/compliance-hub/key-aml-scenarios-a-compliance-officer-need-to-know)、[Sardine](https://www.sardine.ai/transaction-monitoring)）、台灣人頭帳戶（[臺北地檢](https://www.tpc.moj.gov.tw/292885/976681/661783/1163834/post)、[臺北市警局](https://police.gov.taipei/News_Content.aspx?n=51887A14CF505E63&s=57334C29F220C86C)）、反詐 ML（[ScienceDirect 集成可解釋](https://www.sciencedirect.com/science/article/pii/S2405918826000206)）。

---

## 護欄（硬性）

testnet only、不提交私鑰/.env、CHT 整合點一律 adapter+mock、程式碼英文（註解可中文）、Conventional Commits、每階段跑該套件測試綠再 commit、每階段結束**暫停並回報**。

---

## 貼進 Claude Code 的 Prompt

```text
你是 ChainTrust 開發夥伴。先讀 CLAUDE.md、docs/architecture.md、docs/poc-spec.md、docs/ai-fraud-spec.md，
以及 docs/claude-code-prompt-v3.md 的「反詐樣態專業依據」與「現況（勿重做）」。
維持護欄：testnet only、不提交私鑰/.env、CHT 整合點 adapter+mock、程式英文(註解可中文)、
Conventional Commits、每階段跑該套件測試綠再 commit、每階段結束暫停並回報。分三階段 A→B→C 依序做。

=== 階段 A：把 AI 升級成「專業級反詐」（建構於現有 ai-service，勿重造 top_factors/augment/metrics）===
A1 樣態特徵（app/featurize.py，更新 FEATURE_ORDER 與 FEATURE_LABELS）：
   - amount_log = log1p(amount)
   - drain_ratio = (oldbalanceOrg - newbalanceOrig) / max(oldbalanceOrg, 1)
   - pass_through = 1 if type in (TRANSFER,CASH_OUT) and drain_ratio>=0.9 else 0     # 進來即清空(過水)
   - near_threshold = 1 if amount 落在常見門檻(30000/50000/500000) 下方 5% 帶 else 0  # 結構化拆分
   - round_amount = 1 if amount>0 and amount % 1000 == 0 else 0
   - velocity_ratio = tx_count_1h / max(tx_count_24h, 1)
   保留既有 device_changed/mobile_realname_verified/geo_jump/account_age_days/cross_institution_presentations。
A2 圖譜人頭環偵測（新檔 app/graph.py）：
   - 有真 PaySim(含 nameOrig/nameDest) 時建有向圖，算每帳戶 fan_in(相異匯入對手)、fan_out、
     is_collection(高 fan_in 後 CASH_OUT = 水房聚合戶)，輸出 account_graph_risk 併入訓練特徵。
   - 合成資料：在 synth.py 模擬 nameOrig/nameDest 與聚合戶，使圖譜特徵在離線也可訓練/示範。
   - 提供函式供 /score：可帶 payee_fan_in / account_graph_risk，缺則 0。
A3 reason code 對齊樣態（app/rules.py，含中文 REASON_LABELS 與 WEIGHTS）：新增
   PASS_THROUGH、STRUCTURING、RAPID_MOVEMENT、FAN_IN_COLLECTION、MULE_RING；保留既有碼。
A4 模型與評估（train.py / app/model.py）：
   - LightGBM 保留 scale_pos_weight，加機率校準(CalibratedClassifierCV, isotonic)。
   - 主指標 PR-AUC；另報 ROC-AUC、recall@FPR=1%、precision@100、MCC、混淆矩陣，全寫入 metrics.json。
   - 依 step 做 out-of-time 切分；若 ROC-AUC≈1.0 在 log 警示可能洩漏，以 PR-AUC 為準。
   - 融合維持 0.7*p_fraud+0.3*anomaly，p_fraud 用校準後機率；保留 top_factors(SHAP)，加入新樣態 reason。
A5 demo 與測試：demo_data.json 增 pass_through/structuring/fan_in 水房 案例；補 pytest（新特徵、reason、圖譜函式）。
驗收：pnpm test:ai 綠；pnpm ai:train 印出 PR-AUC 與校準後指標、寫 metrics.json；
      /score 對「過水/結構化/水房聚合」案例回正確 reason 與 top_factors。暫停回報。

=== 階段 B：SD-JWT key binding（防出示被攔截轉手）===
B1 issueKycSdJwt：payload 加 cnf（持有者公鑰 JWK，取自 holder did:key）。
B2 presentKycMinimal：產生 KB-JWT（aud=verifier、nonce、iat、sd_hash），用 holder 私鑰 ES256K(經 Veramo keyManagerSign) 簽。
B3 verifyKycSdJwtPresentation：加 kbVerifier，驗 KB-JWT 對 cnf 公鑰、aud/nonce 正確、未過期；checks 增 keyBinding。
B4 server /sdjwt/verify 帶 expectedNonce/aud；出示端用 holder 私鑰簽 KB（PoC：holder 金鑰在 server agent）。
B5 e2e/sdjwt.test 負向案例：他人無持有者私鑰→keyBinding 失敗；nonce/aud 不符→失敗。
驗收：pnpm iv:e2e、pnpm iv:test 綠且涵蓋負向案例。暫停回報。

=== 階段 C：server 認證/CORS ＋ 去重 ＋ 打磨 ===
C1 server.ts：mutating 端點(/issue/*、/revoke、/sdjwt/issue) 加 X-API-Key(env API_KEY) 檢查；
   CORS 由 env CORS_ORIGIN(預設 http://localhost:5173) 收斂；500 不外洩內部訊息(記 log、回通用碼)。
C2 抽出共用「驗章後 trust+revocation 檢查」helper，verifier.ts 與 sdjwt.ts 共用去重。
C3 打磨：deploy.ts 餘額單位改 POL；DEMO.md/README 註明 (a) model.joblib 需先 pnpm ai:train、
   (b) 真 PaySim 的 CHT 訊號為半合成注入；.env.example 補 API_KEY/CORS_ORIGIN。
驗收：全測試綠、pnpm smoke 綠、pnpm demo 正常。暫停回報。

開始前先用一段話覆述「階段 A 計畫」與你要新增/修改的檔案與特徵清單。
```

---

## 使用提示

- 三階段刻意分開，每階段綠燈再進下一步；A 完成後就有「專業級可解釋反詐＋人頭環偵測」可寫進簡報。
- 圖譜特徵需要真 PaySim 的 `nameOrig/nameDest`；沒有時走合成模擬，demo 一樣能演。
- 簡報誠實點：交易詐欺訊號為真資料，電信/裝置/地理為半合成注入；AUC 以 PR-AUC 為準。
