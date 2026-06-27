/**
 * 中華電信整合點 — adapter + mock（ADR-007）。
 * 正式落地時以對應 CHT 產品替換實作，呼叫端不變。
 */

export interface PublicCaAdapter {
  /** 由 CHT PublicCA 根背書某 Issuer（PoC：mock 直接回傳已背書） */
  anchorIssuerRoot(issuerAddress: string): Promise<{ anchored: boolean; rootAuthority: string }>;
}

export interface MobileCardAdapter {
  /** 門號電子卡驗證（PoC：mock 回傳固定已驗證身分） */
  verifyMsisdn(msisdn: string): Promise<{
    verified: boolean;
    carrier: string;
    realName: string;
    msisdnMasked: string;
  }>;
}

export class MockPublicCaAdapter implements PublicCaAdapter {
  async anchorIssuerRoot(issuerAddress: string) {
    return { anchored: true, rootAuthority: "CHT-PublicCA (mock)", ...{ issuerAddress } };
  }
}

export class MockMobileCardAdapter implements MobileCardAdapter {
  async verifyMsisdn(msisdn: string) {
    const masked = msisdn.replace(/(\d{4})\d{3}(\d{3})/, "$1***$2");
    return {
      verified: true,
      carrier: "中華電信 (mock)",
      realName: "王小明",
      msisdnMasked: masked || "0912***678",
    };
  }
}
