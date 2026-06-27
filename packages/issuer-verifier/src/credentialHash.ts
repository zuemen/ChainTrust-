import { keccak256, toUtf8Bytes, computeAddress, getAddress } from "ethers";
import type { IIdentifier } from "@veramo/core";

/**
 * 由 VC 的 id 算出鏈上 RevocationRegistry 使用的 bytes32 雜湊。
 * 與合約端 keccak256(utf8(credentialId)) 一致。
 */
export function credentialHash(credentialId: string): string {
  return keccak256(toUtf8Bytes(credentialId));
}

/**
 * 取得 Issuer 的 Ethereum 位址（對應 IssuerRegistry 的信任查詢鍵）。
 * - did:ethr：位址即 DID 識別碼。
 * - did:key（Secp256k1）：由其公鑰推導位址。
 * 兩者皆回傳 checksum 格式的位址，讓信任查詢與 DID 方法解耦。
 */
export function issuerAddressFromIdentifier(identifier: IIdentifier): string {
  const did = identifier.did;
  // did:ethr:<network?>:0x....
  const ethrMatch = did.match(/did:ethr:(?:[^:]+:)?(0x[0-9a-fA-F]{40})$/);
  if (ethrMatch) return getAddress(ethrMatch[1]);

  // did:key → 由 Secp256k1 公鑰推導
  const key = identifier.keys.find((k) => k.type === "Secp256k1");
  if (!key?.publicKeyHex) {
    throw new Error(
      `無法由 DID 推導 Issuer 位址：${did}（需 did:ethr 或帶 Secp256k1 公鑰的 did:key）`
    );
  }
  return computeAddress("0x" + key.publicKeyHex);
}
