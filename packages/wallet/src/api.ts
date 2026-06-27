/** issuer-verifier API（經 vite proxy /api → :3001）。 */

export interface TxContext {
  amount?: number;
  type?: "CASH_IN" | "CASH_OUT" | "DEBIT" | "PAYMENT" | "TRANSFER";
  oldbalanceOrg?: number;
  newbalanceOrig?: number;
  mobile_realname_verified?: boolean;
  tx_count_1h?: number;
  tx_count_24h?: number;
  device_changed?: boolean;
  geo_jump?: boolean;
  account_age_days?: number;
  payee_risk?: number;
  cross_institution_presentations?: number;
}

export interface RiskAssessment {
  risk: number | null;
  decision: "pass" | "review" | "block";
  reasons: string[];
  source: string;
}

export interface SdJwtVerifyResult {
  ok: boolean;
  checks: { signature: boolean; trustedIssuer: boolean; notRevoked: boolean; predicate: boolean };
  disclosed: string[];
  withheld: string[];
  payload?: Record<string, unknown>;
  reason?: string;
}

export interface VerifyResponse {
  verify: SdJwtVerifyResult;
  risk?: RiskAssessment;
  outcome: "approve" | "review" | "reject";
}

const BASE = "/api";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function health(): Promise<{ ok: boolean; issuerDid: string }> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

export async function issueKyc(subject?: Record<string, unknown>): Promise<{
  vc: string;
  holderDid: string;
  issuerDid: string;
}> {
  return postJson("/sdjwt/issue", { subject });
}

export async function verifyPresentation(
  presentation: string,
  tx: TxContext
): Promise<VerifyResponse> {
  return postJson("/sdjwt/verify", { presentation, tx });
}
