import type { VerifiableCredential } from "@veramo/core";
import type { ChainTrustAgent } from "./agent.js";
import type { ChainGateway } from "./chain/gateway.js";
import { revocationKeyOf } from "./issuer.js";
import { scoreTransaction, type TxContext, type RiskAssessment } from "./fraud.js";
import { getAddress, computeAddress } from "ethers";

export interface VerifyChecks {
  signature: boolean;
  trustedIssuer: boolean;
  notRevoked: boolean;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyChecks;
  issuerAddress?: string;
  reason?: string;
}

export interface VerifyAndScoreResult extends VerifyResult {
  /** 憑證有效時的 AI 風險評估；憑證無效則不評分（undefined） */
  risk?: RiskAssessment;
  /** 綜合結論：approve（驗證通過且 AI pass）/ review / reject */
  outcome: "approve" | "review" | "reject";
}

/**
 * 驗證一張 VC：
 *  1) 驗章（Veramo verifyCredential）
 *  2) 查 IssuerRegistry.isTrustedIssuer
 *  3) 查 RevocationRegistry.isRevoked
 * 任一不過即 ok=false 並回明確 reason。
 */
export async function verifyCredential(
  agent: ChainTrustAgent,
  chain: ChainGateway,
  vc: VerifiableCredential
): Promise<VerifyResult> {
  const checks: VerifyChecks = {
    signature: false,
    trustedIssuer: false,
    notRevoked: false,
  };

  // 1) 驗章
  let issuerDid: string;
  try {
    // 停用 Veramo 內建 credentialStatus 檢查：撤銷由我們的 ChainGateway 查 RevocationRegistry。
    const res = await agent.verifyCredential({
      credential: vc,
      policies: { credentialStatus: false },
    });
    checks.signature = res.verified === true;
    if (!checks.signature) {
      return { ok: false, checks, reason: `簽章驗證失敗：${res.error?.message ?? "unknown"}` };
    }
    issuerDid = typeof vc.issuer === "string" ? vc.issuer : vc.issuer.id;
  } catch (e: any) {
    return { ok: false, checks, reason: `簽章驗證例外：${e?.message ?? e}` };
  }

  // 2) 信任 issuer（由 DID 推導 ETH 位址）
  let issuerAddress: string;
  try {
    issuerAddress = issuerAddressFromDid(issuerDid);
    checks.trustedIssuer = await chain.isTrustedIssuer(issuerAddress);
    if (!checks.trustedIssuer) {
      return {
        ok: false,
        checks,
        issuerAddress,
        reason: `Issuer 未被信任根背書：${issuerAddress}`,
      };
    }
  } catch (e: any) {
    return { ok: false, checks, reason: `信任查詢失敗：${e?.message ?? e}` };
  }

  // 3) 未撤銷
  try {
    const key = revocationKeyOf(vc);
    const revoked = await chain.isRevoked(key);
    checks.notRevoked = !revoked;
    if (revoked) {
      return { ok: false, checks, issuerAddress, reason: "VC 已被撤銷" };
    }
  } catch (e: any) {
    return { ok: false, checks, issuerAddress, reason: `撤銷查詢失敗：${e?.message ?? e}` };
  }

  return { ok: true, checks, issuerAddress };
}

/**
 * 整合 M2.1：驗證 VC 通過後呼叫 AI 反詐 /score，產生綜合決策。
 * - 憑證無效 → outcome="reject"，不評分。
 * - 憑證有效 → 依 AI decision：pass→approve、review→review、block→reject。
 */
export async function verifyAndScore(
  agent: ChainTrustAgent,
  chain: ChainGateway,
  vc: VerifiableCredential,
  txContext: TxContext,
  opts?: { fraudBaseUrl?: string }
): Promise<VerifyAndScoreResult> {
  const v = await verifyCredential(agent, chain, vc);
  if (!v.ok) {
    return { ...v, outcome: "reject" };
  }
  const risk = await scoreTransaction(txContext, { baseUrl: opts?.fraudBaseUrl });
  const outcome =
    risk.decision === "block" ? "reject" : risk.decision === "review" ? "review" : "approve";
  return { ...v, risk, outcome };
}

/**
 * 由 issuer DID 推導 ETH 位址。
 * - did:ethr:<net?>:0x.. → 位址
 * - did:key（Secp256k1）→ 解 multibase 公鑰推導位址
 */
export function issuerAddressFromDid(did: string): string {
  const ethrMatch = did.match(/did:ethr:(?:[^:]+:)?(0x[0-9a-fA-F]{40})/);
  if (ethrMatch) return getAddress(ethrMatch[1]);

  if (did.startsWith("did:key:")) {
    const pubHex = secp256k1PublicKeyFromDidKey(did);
    return computeAddress("0x" + pubHex);
  }
  throw new Error(`不支援的 issuer DID 方法：${did}`);
}

/** 解析 did:key（Secp256k1）取出公鑰 hex（去除 multicodec 前綴 0xe701） */
export function secp256k1PublicKeyFromDidKey(did: string): string {
  const mb = did.slice("did:key:".length).split("#")[0];
  if (mb[0] !== "z") throw new Error("did:key 非 base58btc(z) 編碼");
  const bytes = base58btcDecode(mb.slice(1));
  // multicodec：secp256k1-pub = 0xe7 0x01（varint），其後為 33-byte 壓縮公鑰
  if (bytes[0] !== 0xe7 || bytes[1] !== 0x01) {
    throw new Error("did:key 非 Secp256k1（multicodec 前綴不符）");
  }
  const pub = bytes.slice(2);
  return Buffer.from(pub).toString("hex");
}

// 最小 base58btc 解碼（Bitcoin 字母表）
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58btcDecode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error(`base58 非法字元：${ch}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // 前導 '1' → 前導 0 byte
  for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}
