import express from "express";
import { createVeramoAgent, createIssuerDid, createHolderDid } from "./agent.js";
import {
  InMemoryChainGateway,
  EthersChainGateway,
  loadDeployment,
  type ChainGateway,
} from "./chain/gateway.js";
import { issueKYCCredential, issueMobileRealNameCredential, revocationKeyOf } from "./issuer.js";
import { verifyCredential, verifyAndScore } from "./verifier.js";
import { issueKycSdJwt, presentKycWithKeyBinding, verifyKycSdJwtPresentation } from "./sdjwt.js";
import { randomUUID } from "crypto";
import { scoreTransaction } from "./fraud.js";
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

  // 簡易 CORS（PoC：允許錢包前端跨來源呼叫）
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (_req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, chainMode: config.chainMode, issuerDid: issuer.did, issuerAddr });
  });

  // ── SD-JWT（M2.0/M2.2 錢包用）──
  // 簽發 SD-JWT KYCCredential 給 holder（缺 holderDid 則自動建一個）
  app.post("/sdjwt/issue", async (req, res) => {
    try {
      let { holderDid, subject } = req.body ?? {};
      if (!holderDid) holderDid = (await createHolderDid(agent, `holder-${Date.now()}`)).did;
      const vc = await issueKycSdJwt({ issuer, holderDid, subject }, agent);
      res.json({ vc, holderDid, issuerDid: issuer.did });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  // 階段 B：驗證方核發一次性 nonce（防重放）。aud = 本驗證方識別。
  const VERIFIER_AUD = process.env.VERIFIER_AUD ?? "chaintrust-verifier";
  const issuedNonces = new Set<string>();
  app.post("/sdjwt/nonce", (_req, res) => {
    const nonce = randomUUID();
    issuedNonces.add(nonce);
    res.json({ nonce, aud: VERIFIER_AUD });
  });

  // 階段 B：持有者端出示（PoC：holder 金鑰在 server agent），帶 key binding
  app.post("/sdjwt/present", async (req, res) => {
    try {
      const { vc, holderDid, revealKeys, aud, nonce } = req.body ?? {};
      if (!vc || !holderDid) return res.status(400).json({ error: "缺 vc 或 holderDid" });
      const holder = await agent.didManagerGet({ did: holderDid });
      const presentation = await presentKycWithKeyBinding(
        agent,
        holder,
        vc,
        revealKeys ?? ["kycLevel"],
        { aud: aud ?? VERIFIER_AUD, nonce: nonce ?? "" }
      );
      res.json({ presentation });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  // 驗證 SD-JWT 出示（含 key binding）+ AI 風險評分 → 綜合 outcome
  app.post("/sdjwt/verify", async (req, res) => {
    try {
      const { presentation, tx, requireKeyBinding, expectedNonce } = req.body ?? {};
      if (!presentation) return res.status(400).json({ error: "缺 presentation" });
      // 若帶 expectedNonce，驗其為本方核發且未用過（一次性）
      if (expectedNonce != null && !issuedNonces.has(expectedNonce)) {
        return res.json({
          verify: { ok: false, checks: {}, disclosed: [], withheld: [], reason: "nonce 無效或已使用" },
          outcome: "reject",
        });
      }
      const verify = await verifyKycSdJwtPresentation(chain, presentation, {
        minKycLevel: 2,
        requireKeyBinding: requireKeyBinding === true,
        expectedAud: requireKeyBinding === true ? VERIFIER_AUD : undefined,
        expectedNonce: expectedNonce ?? undefined,
      });
      if (verify.ok && expectedNonce != null) issuedNonces.delete(expectedNonce); // 消耗 nonce
      let risk;
      let outcome: "approve" | "review" | "reject" = "reject";
      if (verify.ok) {
        risk = await scoreTransaction(tx ?? {});
        outcome = risk.decision === "block" ? "reject" : risk.decision === "review" ? "review" : "approve";
      }
      res.json({ verify, risk, outcome });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
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

  // 驗證 + AI 風險評分（M2.1 整合）：{ vc, tx } → { 驗證結果 + risk + outcome }
  app.post("/verify-and-score", async (req, res) => {
    try {
      const { vc, tx } = req.body ?? {};
      if (!vc) return res.status(400).json({ error: "缺 vc" });
      const result = await verifyAndScore(agent, chain, vc, tx ?? {});
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  // 純風險評分代理（轉呼叫 ai-service /score）
  app.post("/score", async (req, res) => {
    try {
      res.json(await scoreTransaction(req.body ?? {}));
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
