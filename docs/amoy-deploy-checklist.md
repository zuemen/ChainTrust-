# Amoy 測試網部署清單（你自己跑）

> **安全第一**：私鑰只放你電腦上的 `packages/contracts/.env`（已 gitignore）。
> **絕不要把私鑰貼到聊天室或傳給任何人，包括我。** 我不經手任何金鑰；部署由你在本機執行。

## 步驟

1. 用 MetaMask 另開一個**只用於測試網**的錢包（別用有真錢的帳戶）。
2. 切到 Polygon Amoy（chainId `80002`），到水龍頭領測試幣 POL：
   - https://faucet.polygon.technology/ （選 Amoy）
3. 在 `packages/contracts/.env` 設定：
   ```
   DEPLOYER_PRIVATE_KEY=0x你的測試私鑰
   AMOY_RPC_URL=https://rpc-amoy.polygon.technology
   ```
4. 部署：
   ```bash
   pnpm --filter @chaintrust/contracts deploy:amoy
   # 或：cd packages/contracts && npx hardhat run scripts/deploy.ts --network amoy
   ```
5. 記下 `packages/contracts/deployments/amoy.json` 內的 `IssuerRegistry` 與 `RevocationRegistry` 位址。
6. 將 issuer-verifier 的 `ChainGateway` 切為 **Ethers**，於 `.env` 填入兩個合約位址與 `AMOY_RPC_URL`（見 `.env.example`）。
7. 煙霧測試：用 owner 帳戶 `setTrustedIssuer`，再 `setRevoked`/`isRevoked` 一筆，確認鏈上事件。
8. 到 PolygonScan Amoy 查交易：https://amoy.polygonscan.com/

## 注意

- 僅測試網、無真實資產；錢包保留少量 POL 當 gas 即可。
- `scripts/deploy.ts` 偵測不到私鑰時會給指引而非崩潰（已實作）。
- 部署位址記得回填到 `deployments/` 與 issuer-verifier 設定，決賽 Demo 才能展示「真的在鏈上」。
