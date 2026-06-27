/**
 * M1 端到端示範：
 *  1) 建 Issuer/Holder DID，信任根背書 Issuer
 *  2) 簽發 KYC VC → 驗證「通過」
 *  3) 撤銷 → 驗證「失敗」(notRevoked=false)
 *  4) （加碼）未受信任的 Issuer → 驗證「失敗」
 *
 * 預設用 InMemoryChainGateway（離線可跑）。設 CHAIN_MODE=ethers 可接已部署合約。
 */
import { createVeramoAgent, createIssuerDid, createHolderDid } from "./agent.js";
import {
  InMemoryChainGateway,
  EthersChainGateway,
  loadDeployment,
  type ChainGateway,
} from "./chain/gateway.js";
import { issueKYCCredential, revocationKeyOf } from "./issuer.js";
import { verifyCredential } from "./verifier.js";
import { issuerAddressFromIdentifier } from "./credentialHash.js";
import { MockPublicCaAdapter } from "./adapters/cht.js";
import { config } from "./config.js";

// 小工具
function line(s = "") {
  console.log(s);
}
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`\n❌ 斷言失敗：${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`   ✔ ${msg}`);
}

function makeChain(): ChainGateway {
  if (config.chainMode === "ethers") {
    const dep = loadDeployment("amoy");
    if (!dep) throw new Error("CHAIN_MODE=ethers 但找不到 deployments/amoy.json，請先部署合約");
    return new EthersChainGateway({
      rpcUrl: config.amoyRpcUrl,
      issuerRegistry: dep.contracts.IssuerRegistry,
      revocationRegistry: dep.contracts.RevocationRegistry,
      privateKey: config.chainPrivateKey,
    });
  }
  return new InMemoryChainGateway();
}

async function main() {
  line("=== ChainTrust M1 端到端示範 ===");
  line(`鏈模式：${config.chainMode}`);

  const agent = createVeramoAgent();
  const chain = makeChain();
  const publicCa = new MockPublicCaAdapter();

  // 1) DID + 信任根背書
  const issuer = await createIssuerDid(agent);
  const holder = await createHolderDid(agent);
  const issuerAddr = issuerAddressFromIdentifier(issuer);
  line(`\n[1] Issuer DID = ${issuer.did}`);
  line(`    Issuer 位址 = ${issuerAddr}`);
  line(`    Holder DID = ${holder.did}`);

  const anchor = await publicCa.anchorIssuerRoot(issuerAddr);
  line(`    CHT PublicCA 背書：${anchor.anchored}（${anchor.rootAuthority}）`);
  await chain.setTrustedIssuer(issuerAddr, true);
  assert(await chain.isTrustedIssuer(issuerAddr), "IssuerRegistry 已信任此 Issuer");

  // 2) 簽發 + 驗證通過
  line(`\n[2] 簽發 KYCCredential…`);
  const vc = await issueKYCCredential(agent, {
    issuerDid: issuer.did,
    holderDid: holder.did,
    subject: { kycLevel: "full", over18: true, country: "TW" },
  });
  line(`    VC id = ${vc.id}`);
  const r1 = await verifyCredential(agent, chain, vc);
  line(`    驗證結果：${JSON.stringify(r1.checks)}（reason: ${r1.reason ?? "-"}）`);
  assert(r1.ok === true, "未撤銷時驗證通過 (ok=true)");
  assert(r1.checks.signature && r1.checks.trustedIssuer && r1.checks.notRevoked, "三項檢查皆通過");

  // 3) 撤銷 → 驗證失敗
  line(`\n[3] 撤銷此 VC…`);
  const key = revocationKeyOf(vc);
  line(`    撤銷鍵 = ${key}`);
  await chain.revoke(key);
  assert(await chain.isRevoked(key), "RevocationRegistry 顯示已撤銷");
  const r2 = await verifyCredential(agent, chain, vc);
  line(`    驗證結果：${JSON.stringify(r2.checks)}（reason: ${r2.reason}）`);
  assert(r2.ok === false, "撤銷後驗證失敗 (ok=false)");
  assert(r2.checks.notRevoked === false, "notRevoked=false");

  // 4) 未受信任 issuer → 失敗
  line(`\n[4] 另建未受信任 Issuer 簽發…`);
  const rogue = await createIssuerDid(agent, "rogue-issuer");
  const vc2 = await issueKYCCredential(agent, {
    issuerDid: rogue.did,
    holderDid: holder.did,
  });
  const r3 = await verifyCredential(agent, chain, vc2);
  line(`    驗證結果：${JSON.stringify(r3.checks)}（reason: ${r3.reason}）`);
  assert(r3.ok === false && r3.checks.trustedIssuer === false, "未受信任 Issuer 驗證失敗");

  line("\n✅ M1 e2e 全數通過。");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
