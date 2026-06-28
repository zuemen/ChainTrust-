import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 部署 IssuerRegistry + RevocationRegistry。
 * - 從 .env 讀 DEPLOYER_PRIVATE_KEY（由 hardhat.config 注入 amoy network accounts）。
 * - 部署後把位址寫入 deployments/<network>.json，供 issuer-verifier 讀取。
 * 用法：pnpm --filter @chaintrust/contracts deploy:amoy
 */
async function main() {
  const net = network.name;

  // 對非本地網路要求至少一個帳戶（即有私鑰）；缺則給清楚指引、不崩潰。
  const signers = await ethers.getSigners();
  if (net !== "hardhat" && net !== "localhost" && signers.length === 0) {
    console.error(
      `\n[deploy] 網路 "${net}" 沒有可用帳戶。\n` +
        `請在 packages/contracts/.env 設定 DEPLOYER_PRIVATE_KEY（測試錢包，勿入庫），\n` +
        `並確認該錢包有 Amoy 測試代幣。參考 .env.example。\n`
    );
    process.exitCode = 1;
    return;
  }

  const deployer = signers[0];
  console.log(`[deploy] network=${net}`);
  console.log(`[deploy] deployer=${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy] balance=${ethers.formatEther(balance)} POL`);

  const IssuerRegistry = await ethers.getContractFactory("IssuerRegistry");
  const issuerRegistry = await IssuerRegistry.deploy();
  await issuerRegistry.waitForDeployment();
  const issuerRegistryAddr = await issuerRegistry.getAddress();
  console.log(`[deploy] IssuerRegistry      => ${issuerRegistryAddr}`);

  // RevocationRegistry 綁定 IssuerRegistry：只有受信任 issuer 能撤銷
  const RevocationRegistry = await ethers.getContractFactory("RevocationRegistry");
  const revocationRegistry = await RevocationRegistry.deploy(issuerRegistryAddr);
  await revocationRegistry.waitForDeployment();
  const revocationRegistryAddr = await revocationRegistry.getAddress();
  console.log(`[deploy] RevocationRegistry  => ${revocationRegistryAddr}`);

  const out = {
    network: net,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    contracts: {
      IssuerRegistry: issuerRegistryAddr,
      RevocationRegistry: revocationRegistryAddr,
    },
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${net}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[deploy] 位址已寫入 ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
