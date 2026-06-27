import * as dotenv from "dotenv";
dotenv.config();

/** 執行環境設定。私鑰類一律從 .env 讀，勿入庫。 */
export const config = {
  port: Number(process.env.PORT ?? 3001),
  // 鏈：'memory'（離線 e2e/dev）或 'ethers'（接已部署合約）
  chainMode: (process.env.CHAIN_MODE ?? "memory") as "memory" | "ethers",
  amoyRpcUrl: process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology",
  // 接真合約時用：issuer 操作（撤銷）的簽署私鑰；缺則為唯讀
  chainPrivateKey: process.env.CHAIN_PRIVATE_KEY,
  // AI 反詐服務（M2 用）
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  // did:ethr 用的網路名稱（落地時換 CHT BaaS）
  ethrNetwork: process.env.ETHR_NETWORK ?? "polygon:amoy",
  ethrChainId: Number(process.env.ETHR_CHAIN_ID ?? 80002),
};
