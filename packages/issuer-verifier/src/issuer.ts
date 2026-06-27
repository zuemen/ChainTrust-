import { randomUUID } from "crypto";
import type { VerifiableCredential } from "@veramo/core";
import type { ChainTrustAgent } from "./agent.js";
import { credentialHash } from "./credentialHash.js";
import { MockMobileCardAdapter } from "./adapters/cht.js";

/** RevocationRegistry 的 credentialStatus 型別識別字 */
export const REVOCATION_STATUS_TYPE = "ChainTrustRevocationRegistry2026";

function buildCredentialStatus(credentialId: string) {
  return {
    id: `chaintrust:revocation#${credentialHash(credentialId)}`,
    type: REVOCATION_STATUS_TYPE,
    // 供 verifier 直接取用的鏈上撤銷鍵
    revocationKey: credentialHash(credentialId),
  };
}

export interface IssueKycInput {
  issuerDid: string;
  holderDid: string;
  subject?: {
    kycLevel?: "basic" | "full";
    over18?: boolean;
    country?: string;
  };
}

/** 簽發 KYCCredential（含指向 RevocationRegistry 的 credentialStatus） */
export async function issueKYCCredential(
  agent: ChainTrustAgent,
  input: IssueKycInput
): Promise<VerifiableCredential> {
  const id = `urn:uuid:${randomUUID()}`;
  const subject = input.subject ?? {};
  return agent.createVerifiableCredential({
    proofFormat: "jwt",
    credential: {
      id,
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "KYCCredential"],
      issuer: { id: input.issuerDid },
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: input.holderDid,
        kycLevel: subject.kycLevel ?? "full",
        fullVerified: (subject.kycLevel ?? "full") === "full",
        over18: subject.over18 ?? true,
        country: subject.country ?? "TW",
      },
      credentialStatus: buildCredentialStatus(id),
    },
  });
}

export interface IssueMobileInput {
  issuerDid: string;
  holderDid: string;
  msisdn: string;
}

/** 簽發 MobileRealNameCredential（門號電子卡實名，CHT adapter mock） */
export async function issueMobileRealNameCredential(
  agent: ChainTrustAgent,
  input: IssueMobileInput
): Promise<VerifiableCredential> {
  const card = new MockMobileCardAdapter();
  const v = await card.verifyMsisdn(input.msisdn);
  const id = `urn:uuid:${randomUUID()}`;
  return agent.createVerifiableCredential({
    proofFormat: "jwt",
    credential: {
      id,
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "MobileRealNameCredential"],
      issuer: { id: input.issuerDid },
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: input.holderDid,
        msisdnVerified: v.verified,
        carrier: v.carrier,
        realName: v.realName,
        msisdnMasked: v.msisdnMasked,
      },
      credentialStatus: buildCredentialStatus(id),
    },
  });
}

/** 由 VC 取出鏈上撤銷鍵（bytes32）。優先用 credentialStatus.revocationKey，否則由 id 計算。 */
export function revocationKeyOf(vc: VerifiableCredential): string {
  const status: any = (vc as any).credentialStatus;
  if (status?.revocationKey) return status.revocationKey;
  if (!vc.id) throw new Error("VC 無 id，無法計算撤銷鍵");
  return credentialHash(vc.id);
}
