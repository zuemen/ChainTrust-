import { config } from "./config.js";

/** 交易／出示情境（對應 ai-service ScoreRequest；欄位缺省由服務端補預設） */
export interface TxContext {
  amount?: number;
  type?: "CASH_IN" | "CASH_OUT" | "DEBIT" | "PAYMENT" | "TRANSFER";
  oldbalanceOrg?: number;
  newbalanceOrig?: number;
  oldbalanceDest?: number;
  newbalanceDest?: number;
  tx_count_1h?: number;
  tx_count_24h?: number;
  device_changed?: boolean;
  mobile_realname_verified?: boolean;
  vc_age_days?: number;
  cross_institution_presentations?: number;
  payee_risk?: number;
  geo_jump?: boolean;
  account_age_days?: number;
}

export interface RiskAssessment {
  risk: number | null;
  decision: "pass" | "review" | "block";
  reasons: string[];
  source: "model" | "rules" | "unavailable";
}

/**
 * 呼叫 AI 反詐服務 POST /score。
 * 服務不可用時不擋驗證流程：回 decision="review" 並標記 FRAUD_SERVICE_UNAVAILABLE。
 */
export async function scoreTransaction(
  ctx: TxContext,
  opts?: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<RiskAssessment> {
  const baseUrl = opts?.baseUrl ?? config.aiServiceUrl;
  const doFetch = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 5000);
  try {
    const res = await doFetch(`${baseUrl}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ctx),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { risk: null, decision: "review", reasons: [`FRAUD_HTTP_${res.status}`], source: "unavailable" };
    }
    const body = (await res.json()) as RiskAssessment;
    return body;
  } catch (e: any) {
    return {
      risk: null,
      decision: "review",
      reasons: ["FRAUD_SERVICE_UNAVAILABLE"],
      source: "unavailable",
    };
  } finally {
    clearTimeout(timer);
  }
}
