import { randomUUID } from "crypto";
import { sha256, toUtf8Bytes, SigningKey, computeAddress, hexlify } from "ethers";
import { SDJwtVcInstance } from "@sd-jwt/sd-jwt-vc";
import { digest, generateSalt } from "@sd-jwt/crypto-nodejs";
import type { IIdentifier } from "@veramo/core";
import type { ChainTrustAgent } from "./agent.js";
import type { ChainGateway } from "./chain/gateway.js";
import { credentialHash } from "./credentialHash.js";
import { issuerAddressFromDid, secp256k1PublicKeyFromDidKey } from "./verifier.js";
import { REVOCATION_STATUS_TYPE } from "./issuer.js";

/** KYC VC 中可選擇揭露的 claim（其餘如 iss/vct/sub/credentialStatus 常駐可見） */
export const KYC_SD_CLAIMS = ["kycLevel", "over18", "country", "fullName", "birthDate"] as const;
type KycSdClaim = (typeof KYC_SD_CLAIMS)[number];

// ── base64url ─────────────────────────────────────────────
function b64uToString(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8");
}
function b64uToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

// ── ES256K 簽/驗（與 did:key Secp256k1 一致）────────────────
/** signer：用 issuer 在 Veramo 的金鑰簽 JWS（回傳 base64url(r||s)） */
function es256kSigner(agent: ChainTrustAgent, kid: string) {
  return async (data: string): Promise<string> => {
    return agent.keyManagerSign({
      keyRef: kid,
      algorithm: "ES256K",
      data,
      encoding: "utf-8",
    });
  };
}

/** verifier：由 JWS payload 的 iss(did:key) 推導公鑰，驗 ES256K。可驗任意 issuer。 */
const selfResolvingVerifier = async (data: string, sig: string): Promise<boolean> => {
  const payloadB64 = data.split(".")[1];
  if (!payloadB64) return false;
  const payload = JSON.parse(b64uToString(payloadB64));
  const iss: string | undefined = payload?.iss;
  if (!iss) return false;
  const pubHex = secp256k1PublicKeyFromDidKey(iss);
  return verifyES256K(data, sig, pubHex);
};

function verifyES256K(data: string, sigB64u: string, pubKeyHexCompressed: string): boolean {
  const dgst = sha256(toUtf8Bytes(data));
  const raw = b64uToBytes(sigB64u);
  if (raw.length !== 64) return false;
  const r = hexlify(raw.slice(0, 32));
  const s = hexlify(raw.slice(32, 64));
  const expectedAddr = computeAddress("0x" + pubKeyHexCompressed);
  for (const yParity of [0, 1] as const) {
    try {
      const pub = SigningKey.recoverPublicKey(dgst, { r, s, yParity });
      if (computeAddress(pub) === expectedAddr) return true;
    } catch {
      /* try next parity */
    }
  }
  return false;
}

// ── SD-JWT 實例 ───────────────────────────────────────────
function issuerInstance(agent: ChainTrustAgent, kid: string): SDJwtVcInstance {
  return new SDJwtVcInstance({
    signer: es256kSigner(agent, kid),
    signAlg: "ES256K",
    hasher: digest,
    hashAlg: "sha-256",
    saltGenerator: generateSalt,
  });
}

function holderVerifierInstance(): SDJwtVcInstance {
  // 出示(present)與驗證(verify)需要 hasher 重算揭露雜湊；驗證另需 verifier。
  return new SDJwtVcInstance({
    verifier: selfResolvingVerifier,
    hasher: digest,
    hashAlg: "sha-256",
    saltGenerator: generateSalt,
  });
}

// ── 對外 API ──────────────────────────────────────────────
export interface IssueKycSdJwtInput {
  issuer: IIdentifier;
  holderDid: string;
  subject?: {
    kycLevel?: number; // 2 = full KYC
    over18?: boolean;
    country?: string;
    fullName?: string;
    birthDate?: string;
  };
}

/** 簽發 SD-JWT KYCCredential：PII claim 皆為 salted、可選擇揭露 */
export async function issueKycSdJwt(input: IssueKycSdJwtInput, agent: ChainTrustAgent): Promise<string> {
  const kid = input.issuer.keys[0]?.kid;
  if (!kid) throw new Error("Issuer identifier 無金鑰 kid");
  const sdjwt = issuerInstance(agent, kid);

  const id = `urn:uuid:${randomUUID()}`;
  const s = input.subject ?? {};
  const payload = {
    iss: input.issuer.did,
    iat: Math.floor(Date.now() / 1000),
    vct: "KYCCredential",
    sub: input.holderDid,
    jti: id,
    kycLevel: s.kycLevel ?? 2,
    over18: s.over18 ?? true,
    country: s.country ?? "TW",
    fullName: s.fullName ?? "王小明",
    birthDate: s.birthDate ?? "1990-01-01",
    // 常駐可見，供 verifier 查鏈上撤銷
    credentialStatus: {
      id: `chaintrust:revocation#${credentialHash(id)}`,
      type: REVOCATION_STATUS_TYPE,
      revocationKey: credentialHash(id),
    },
  };
  const disclosureFrame = { _sd: [...KYC_SD_CLAIMS] };
  return sdjwt.issue(payload, disclosureFrame as any);
}

/** Holder 出示：只揭露指定 claim（預設只揭露 kycLevel 供述詞檢查），其餘 PII 不洩 */
export async function presentKycMinimal(
  sdJwtVc: string,
  revealKeys: KycSdClaim[] = ["kycLevel"]
): Promise<string> {
  const sdjwt = holderVerifierInstance();
  const frame: Record<string, boolean> = {};
  for (const k of revealKeys) frame[k] = true;
  return sdjwt.present(sdJwtVc, frame as any);
}

export interface SdJwtVerifyChecks {
  signature: boolean;
  trustedIssuer: boolean;
  notRevoked: boolean;
  predicate: boolean;
}
export interface SdJwtVerifyResult {
  ok: boolean;
  checks: SdJwtVerifyChecks;
  issuerAddress?: string;
  /** 此次出示實際揭露的 PII claim 清單 */
  disclosed: string[];
  /** 未揭露（被最小揭露隱藏）的 PII claim 清單 */
  withheld: string[];
  payload?: Record<string, unknown>;
  reason?: string;
}

/**
 * 驗證 SD-JWT 出示：
 *  1) 驗章（揭露雜湊比對 + ES256K）— 即使缺完整 PII 也能驗
 *  2) isTrustedIssuer（由 iss did:key 推導位址）
 *  3) isRevoked（credentialStatus.revocationKey）
 *  4) 述詞 kycLevel >= minKycLevel
 */
export async function verifyKycSdJwtPresentation(
  chain: ChainGateway,
  presentation: string,
  opts?: { minKycLevel?: number }
): Promise<SdJwtVerifyResult> {
  const checks: SdJwtVerifyChecks = {
    signature: false,
    trustedIssuer: false,
    notRevoked: false,
    predicate: false,
  };
  const sdjwt = holderVerifierInstance();

  let payload: Record<string, any>;
  try {
    const verified = await sdjwt.verify(presentation);
    payload = (verified.payload ?? {}) as Record<string, any>;
    checks.signature = true;
  } catch (e: any) {
    return {
      ok: false,
      checks,
      disclosed: [],
      withheld: [...KYC_SD_CLAIMS],
      reason: `SD-JWT 驗章失敗：${e?.message ?? e}`,
    };
  }

  const disclosed = KYC_SD_CLAIMS.filter((k) => k in payload);
  const withheld = KYC_SD_CLAIMS.filter((k) => !(k in payload));

  // 2) 信任 issuer
  let issuerAddress: string;
  try {
    issuerAddress = issuerAddressFromDid(String(payload.iss));
    checks.trustedIssuer = await chain.isTrustedIssuer(issuerAddress);
    if (!checks.trustedIssuer) {
      return {
        ok: false,
        checks,
        issuerAddress,
        disclosed,
        withheld,
        reason: `Issuer 未被信任根背書：${issuerAddress}`,
      };
    }
  } catch (e: any) {
    return { ok: false, checks, disclosed, withheld, reason: `信任查詢失敗：${e?.message ?? e}` };
  }

  // 3) 未撤銷
  const revocationKey = payload.credentialStatus?.revocationKey;
  if (!revocationKey) {
    return { ok: false, checks, issuerAddress, disclosed, withheld, reason: "出示缺 credentialStatus" };
  }
  const revoked = await chain.isRevoked(revocationKey);
  checks.notRevoked = !revoked;
  if (revoked) {
    return { ok: false, checks, issuerAddress, disclosed, withheld, reason: "VC 已被撤銷" };
  }

  // 4) 述詞 kycLevel >= 門檻
  const minLevel = opts?.minKycLevel ?? 2;
  checks.predicate = typeof payload.kycLevel === "number" && payload.kycLevel >= minLevel;
  if (!checks.predicate) {
    return {
      ok: false,
      checks,
      issuerAddress,
      disclosed,
      withheld,
      payload,
      reason: `述詞未滿足：需 kycLevel>=${minLevel}（揭露值：${payload.kycLevel ?? "未揭露"}）`,
    };
  }

  return { ok: true, checks, issuerAddress, disclosed, withheld, payload };
}
