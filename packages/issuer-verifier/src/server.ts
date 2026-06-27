import express from "express";
import { createVeramoAgent, createIssuerDid, createHolderDid } from "./agent.js";
import {
  InMemoryChainGateway,
  EthersChainGateway,
  loadDeployment,
  type ChainGateway,
} from "./chain/gateway.js";
import { issueKYCCredential, issueMobileRealNameCredential, revocationKeyOf } from "./issuer.js";
import { verifyCredential } from "./verifier.js";
import { issuerAddressFromIdentifier } from "./credentialHash.js";
import { config } from "./config.js";

/**
 * Issuer/Verifier HTTP 服務（PoC）。
 * 啟動時建立一個示範 Issuer DID 並由（記憶體）信任根背書，方便前端/curl 直接試。
 */
async function buildChain(): Promise<ChainGateway> {
  if (config.chainMode === "ethers") {
    const dep = loadDeployment("amoy");
    if (!dep) throw new Error("CHAIN_MODE=ethers 但缺 deployments/amoy.json");
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
  const agent = createVeramoAgent();
  const chain = await buildChain();
  const issuer = await createIssuerDid(agent);
  const issuerAddr = issuerAddressFromIdentifier(issuer);
  // 記憶體模式下自動背書示範 issuer
  if (config.chainMode === "memory") {
    await chain.setTrustedIssuer(issuerAddr, true);
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, chainMode: config.chainMode, issuerDid: issuer.did, issuerAddr });
  });

  // 建立一個新的 Holder DID（demo 用）
  app.post("/holder", async (_req, res) => {
    const holder = await createHolderDid(agent, `holder-${Date.now()}`);
    res.json({ did: holder.did });
  });

  // 簽發 KYC VC
  app.post("/issue/kyc", async (req, res) => {
    try {
      const { holderDid, subject } = req.body ?? {};
      if (!holderDid) return res.status(400).json({ error: "缺 holderDid" });
      const vc = await issueKYCCredential(agent, { issuerDid: issuer.did, holderDid, subject });
      res.json({ vc, revocationKey: revocationKeyOf(vc) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  // 簽發 門號實名 VC
  app.post("/issue/mobile", async (req, res) => {
    try {
      const { holderDid, msisdn } = req.body ?? {};
      if (!holderDid || !msisdn) return res.status(400).json({ error: "缺 holderDid 或 msisdn" });
      const vc = await issueMobileRealNameCredential(agent, {
        issuerDid: issuer.did,
        holderDid,
        msisdn,
      });
      res.json({ vc, revocationKey: revocationKeyOf(vc) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  // 驗證 VC
  app.post("/verify", async (req, res) => {
    try {
      const { vc } = req.body ?? {};
      if (!vc) return res.status(400).json({ error: "缺 vc" });
      const result = await verifyCredential(agent, chain, vc);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  // 撤銷 VC（dev：記憶體或具私鑰的 ethers 模式）
  app.post("/revoke", async (req, res) => {
    try {
      const { revocationKey } = req.body ?? {};
      if (!revocationKey) return res.status(400).json({ error: "缺 revocationKey" });
      await chain.revoke(revocationKey);
      res.json({ revoked: true, revocationKey });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  app.listen(config.port, () => {
    console.log(`[issuer-verifier] 服務啟動 http://localhost:${config.port}`);
    console.log(`[issuer-verifier] chainMode=${config.chainMode} issuer=${issuer.did}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
