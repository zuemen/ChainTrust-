#!/usr/bin/env node
/**
 * ChainTrust 五步 Demo 線跨服務 smoke 驗證。
 * 需先啟動 issuer-verifier(:3001) 與 ai-service(:8000)（例如 `pnpm demo`）。
 * 驗證：跨機構重用 KYC（最小揭露）+ 高風險交易攔截。
 *
 * 用法：node scripts/smoke.mjs   或   pnpm smoke
 */
const IV = process.env.IV_URL ?? "http://localhost:3001";
const AI = process.env.AI_URL ?? "http://localhost:8000";

const NORMAL_TX = { type: "PAYMENT", amount: 1280, oldbalanceOrg: 52000, newbalanceOrig: 50720, mobile_realname_verified: true, account_age_days: 900, payee_risk: 0.05, tx_count_1h: 1, tx_count_24h: 4 };
const MULE_TX = { type: "TRANSFER", amount: 920000, oldbalanceOrg: 1000000, newbalanceOrig: 0, mobile_realname_verified: false, tx_count_1h: 8, tx_count_24h: 41, device_changed: true, geo_jump: true, account_age_days: 2, payee_risk: 0.92, cross_institution_presentations: 13 };

let failed = false;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.error(`  ✘ ${m}`); failed = true; };

function b64urlToStr(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}
function parseSdJwt(compact) {
  const segs = compact.split("~");
  const jwt = segs[0];
  const payload = JSON.parse(b64urlToStr(jwt.split(".")[1]));
  const disclosures = segs.slice(1).filter(Boolean).map((raw) => {
    const arr = JSON.parse(b64urlToStr(raw));
    return arr.length >= 3 ? { raw, claim: arr[1] } : { raw, claim: "(el)" };
  });
  return { jwt, payload, disclosures };
}
function buildPresentation(parsed, reveal) {
  const kept = parsed.disclosures.filter((d) => reveal.includes(d.claim)).map((d) => d.raw);
  return [parsed.jwt, ...kept].join("~") + "~";
}
async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function jpost(url, body) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${url} ${r.status}: ${await r.text()}`); return r.json(); }

async function main() {
  console.log("=== ChainTrust 五步 Demo 線 smoke ===");

  console.log("\n[健康檢查]");
  try { const h = await jget(`${IV}/health`); ok(`issuer-verifier 連線（issuer ${String(h.issuerDid).slice(0, 24)}…）`); }
  catch (e) { bad(`issuer-verifier 未連線：${e.message}（先跑 pnpm demo）`); return finish(); }
  try { const a = await jget(`${AI}/health`); a.model_loaded ? ok("ai-service 連線（模型已載入）") : bad("ai-service 連線但模型未載入（跑 pnpm ai:train）"); }
  catch (e) { bad(`ai-service 未連線：${e.message}`); }

  console.log("\n[步驟1-2] 銀行A 簽發 KYC 憑證 → 錢包持有");
  const issued = await jpost(`${IV}/sdjwt/issue`, { subject: { kycLevel: 2, fullName: "王小明", birthDate: "1990-01-01", country: "TW", over18: true } });
  const parsed = parseSdJwt(issued.vc);
  const held = parsed.disclosures.map((d) => d.claim);
  held.length === 5 ? ok(`憑證含 5 個可選擇揭露欄位：${held.join(", ")}`) : bad(`可揭露欄位數不符：${held.join(", ")}`);

  console.log("\n[步驟3-4] 最小揭露：只揭露 kycLevel");
  const pres = buildPresentation(parsed, ["kycLevel"]);

  console.log("\n[步驟5a] 正常交易 → 應放行且驗證方看不到 PII");
  const a = await jpost(`${IV}/sdjwt/verify`, { presentation: pres, tx: NORMAL_TX });
  a.outcome === "approve" ? ok(`outcome=approve（risk=${a.risk?.risk} ${a.risk?.decision}）`) : bad(`outcome=${a.outcome}（期望 approve）`);
  const seen = Object.keys(a.verify.payload ?? {});
  (!seen.includes("fullName") && !seen.includes("birthDate")) ? ok("驗證方看不到 fullName/birthDate（最小揭露成立）") : bad(`驗證方看到 PII：${seen.join(",")}`);
  a.verify.disclosed.length === 1 && a.verify.disclosed[0] === "kycLevel" ? ok("揭露欄位僅 kycLevel") : bad(`揭露欄位：${a.verify.disclosed.join(",")}`);

  console.log("\n[步驟5b] 高風險人頭交易（同一張憑證）→ 應攔截");
  const b = await jpost(`${IV}/sdjwt/verify`, { presentation: pres, tx: MULE_TX });
  (b.outcome === "reject" && b.risk?.decision === "block") ? ok(`outcome=reject / block（risk=${b.risk?.risk}）`) : bad(`outcome=${b.outcome} decision=${b.risk?.decision}（期望 reject/block）`);
  b.risk?.reasons?.includes("MULE_PATTERN") ? ok(`風險原因含 MULE_PATTERN（${b.risk.reasons.join(", ")}）`) : bad(`風險原因：${b.risk?.reasons?.join(",")}`);

  finish();
}
function finish() {
  console.log("\n" + (failed ? "❌ smoke 失敗" : "✅ 五步 Demo 線全數通過"));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("smoke 例外：", e); process.exit(1); });
