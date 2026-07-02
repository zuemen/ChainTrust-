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

export interface BillingSummary {
  /** 門號在網月數 */
  tenureMonths: number;
  /** 近 24 期準時繳費比例 0..1 */
  onTimeRatio: number;
  /** 近 12 個月逾繳次數 */
  latePayments12m: number;
  /** 月均帳單金額區間（避免揭露精確消費額） */
  avgMonthlyBillBand: string;
  carrier: string;
}

export interface BillingHistoryAdapter {
  /**
   * 電信繳費紀錄摘要（普惠金融：替代信用資料）。
   * PoC：mock 回傳多年準時繳費的 thin-file 使用者；
   * 落地：CHT 帳務系統，需當事人同意（個資法）且僅輸出摘要、不輸出明細。
   */
  getBillingSummary(msisdn: string): Promise<BillingSummary>;
}

export class MockPublicCaAdapter implements PublicCaAdapter {
  async anchorIssuerRoot(issuerAddress: string) {
    return { anchored: true, rootAuthority: "CHT-PublicCA (mock)", ...{ issuerAddress } };
  }
}

export class MockBillingHistoryAdapter implements BillingHistoryAdapter {
  async getBillingSummary(_msisdn: string): Promise<BillingSummary> {
    // 典型普惠對象：無聯徵信用紀錄（學生/新住民/自由工作者），但有多年電信準時繳費史
    return {
      tenureMonths: 78,
      onTimeRatio: 0.98,
      latePayments12m: 0,
      avgMonthlyBillBand: "NT$1,000–1,999",
      carrier: "中華電信 (mock)",
    };
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
