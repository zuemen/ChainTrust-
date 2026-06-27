# 鏈信 ChainTrust — 自主權金融身分錢包

SSI（自主權身分）× AI 反詐 × 區塊鏈，建構於**中華電信信任根**（PublicCA／門號電子卡）。 參賽：2026 中華電信智慧創新應用大賽 · 智慧金融組（校園組）。

## 這是什麼

一個金融級的**自主權身分錢包**：用 DID／可驗證憑證（VC）做到「**一次 KYC、跨機構重用**」，內建 **AI 反詐引擎**即時阻斷人頭帳戶與身分盜用，並以中華電信 PublicCA／門號電子卡作為「信任根」。

三個核心價值：

- **一次 KYC、跨機構重用** — 用 SD-JWT 最小揭露，免重複驗證、不外洩明文個資。
- **AI 即時反詐** — 交易／出示情境即時風險評分，攔截人頭帳戶與盜用。
- **普惠財務信譽** — 無信用紀錄者也能累積可攜、可驗證的財務信譽。

## 架構一覽

```
Issuers（CHT門號電子卡 / 銀行KYC） ──簽發VC──▶ Holder 錢包 ──出示(最小揭露)──▶ Verifier（銀行/商家）
        ▲ 由 CHT PublicCA 根背書                                              │ 驗章+查信任+查撤銷+AI風險
        └──── IssuerRegistry / RevocationRegistry（鏈上）◀───────────────────┘
                         AI 反詐引擎（FastAPI）即時風險分數
   PoC 鏈：Polygon Amoy testnet　｜　落地鏈：中華電信 BaaS
```

詳見 [`docs/architecture.md`](docs/architecture.md)。

## Monorepo 結構

| 套件 | 技術 | 職責 |
| :---- | :---- | :---- |
| `packages/contracts` | Solidity / Hardhat | `IssuerRegistry`（信任根背書）、`RevocationRegistry`（撤銷登記） |
| `packages/issuer-verifier` | TypeScript / Veramo / Express | 簽發 VC（Issuer）、驗證出示（Verifier） |
| `packages/ai-service` | Python / FastAPI / LightGBM | AI 反詐風險評分 `/score` |
| `packages/wallet` | React / Vite PWA | Holder 錢包：持有、出示、最小揭露、防詐警示 |

## 快速開始

```shell
# 0. 安裝 workspace 相依（根目錄）
pnpm install

# 合約
cd packages/contracts && pnpm install && pnpm hardhat compile && pnpm test

# AI 反詐服務
cd packages/ai-service && pip install -r requirements.txt && uvicorn app.main:app --reload

# Issuer/Verifier
cd packages/issuer-verifier && pnpm install && pnpm dev

# 錢包
cd packages/wallet && pnpm install && pnpm dev
```

## 文件

- [`docs/architecture.md`](docs/architecture.md) — 系統設計與架構決策（ADR）
- [`docs/poc-spec.md`](docs/poc-spec.md) — PoC 技術規格（給開發者）
- [`CLAUDE.md`](CLAUDE.md) — 專案脈絡與開發規範（給 Claude Code）

## 狀態

PoC 開發中。所有「中華電信整合點」目前為 **mock**，正式落地時以對應的 CHT 產品（PublicCA／門號電子卡／BaaS／CHT Security 情資／Hami Pay）替換。**僅使用 testnet，請勿提交任何私鑰或機密。**

開發進度：

- [ ] **M1 身分層** — IssuerRegistry / RevocationRegistry + Veramo 簽發/驗證 + e2e
- [ ] **M2 反詐 + 錢包** — AI /score + 錢包出示最小揭露 + 風險攔截
- [ ] **M3 串線** — 單一指令端到端 Demo

## 授權

MIT，見 [`LICENSE`](LICENSE)。
