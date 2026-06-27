import { describe, it, expect } from "vitest";
import { scoreTransaction } from "../src/fraud.js";

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

describe("fraud /score 客戶端 (M2.1)", () => {
  it("回傳服務的 risk/decision/reasons", async () => {
    const r = await scoreTransaction(
      { type: "TRANSFER", amount: 920000 },
      {
        baseUrl: "http://x",
        fetchImpl: mockFetch(200, {
          risk: 88,
          decision: "block",
          reasons: ["MULE_PATTERN", "NO_REALNAME"],
          source: "model",
        }),
      }
    );
    expect(r.decision).toBe("block");
    expect(r.risk).toBe(88);
    expect(r.reasons).toContain("MULE_PATTERN");
  });

  it("服務非 2xx → review + 標記不可用", async () => {
    const r = await scoreTransaction({}, { baseUrl: "http://x", fetchImpl: mockFetch(500, {}) });
    expect(r.decision).toBe("review");
    expect(r.source).toBe("unavailable");
    expect(r.reasons[0]).toContain("FRAUD_HTTP_500");
  });

  it("連線失敗 → review + FRAUD_SERVICE_UNAVAILABLE（不擋驗證）", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await scoreTransaction({}, { baseUrl: "http://x", fetchImpl: failing });
    expect(r.decision).toBe("review");
    expect(r.reasons).toContain("FRAUD_SERVICE_UNAVAILABLE");
  });
});
