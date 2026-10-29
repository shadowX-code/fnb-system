import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { malaysiaYesterday } from "../../supabase/functions/factory-mesti-mcp/protocol.js";
const credentials = JSON.parse(readFileSync(process.argv[2] || "qa-artifacts/mesti-machine/credential.json", "utf8"));
const expected = "https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/factory-mesti-mcp";
assert.equal(credentials.endpoint, expected, "Staging only");
const headers = { authorization: credentials.authorization, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
let sequence = 1;
async function rpc(method, params, overrides = {}) {
  const response = await fetch(expected, { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify({ jsonrpc: "2.0", id: sequence++, method, params }), signal: AbortSignal.timeout(25000) });
  return { status: response.status, body: await response.json() };
}
let result = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "feedx-staging-qa", version: "1" } });
assert.equal(result.status, 200);
assert.equal(result.body.result.protocolVersion, "2025-06-18");
const initialized = await fetch(expected, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
assert.equal(initialized.status, 202);
result = await rpc("tools/list", {});
assert.equal(result.body.result.tools.length, 6);
const toolNames = result.body.result.tools.map((item) => item.name);
assert(toolNames.every((name) => /^(get_mesti_daily_status|list_mesti_exceptions|list_pending_verifications|get_mesti_evidence_details|get_mesti_requirement_schedule|query_factory_resources)$/.test(name)));
// Equivalent review migration must not grant broader raw resources.
const resourceDate = malaysiaYesterday();
const deniedResource = await rpc("tools/call", { name: "query_factory_resources", arguments: { queries: [{ resource: "requirements", action: "list", date_range: { from: resourceDate, to: resourceDate } }] } });
assert.equal(deniedResource.body.error?.code, -32003, "Legacy credentials must not gain resource access");
assert((await rpc("tools/list", {}, { authorization: "Bearer invalid" })).status === 401);
assert((await rpc("tools/list", {}, { origin: "https://untrusted.example" })).status === 403);
assert.equal((await rpc("tools/call", { name: "complete_mesti", arguments: {} })).body.error.code, -32602);
const date = process.env.MESTI_QA_DATE || malaysiaYesterday();
async function tool(name, args) {
  const response = await rpc("tools/call", { name, arguments: args });
  assert.equal(response.status, 200);
  assert(!response.body.error, JSON.stringify(response.body.error));
  assert.equal(response.body.result.isError, false, JSON.stringify(response.body.result));
  return response.body.result.structuredContent;
}
const daily = await tool("get_mesti_daily_status", { date });
assert.equal(daily.coverage.length, 8);
assert(daily.coverage.every((item) => item.date === date));
assert(daily.data_quality_limitations.length > 0);
assert(daily.findings.length > 0);
const range = { from: date, to: date };
const exceptions = await tool("list_mesti_exceptions", { date_range: range, severity: "high" });
assert(exceptions.findings.every((finding) => finding.severity === "high"));
const pending = await tool("list_pending_verifications", { date_range: range });
assert(pending.findings.every((finding) => finding.pending_verification === true));
const schedule = await tool("get_mesti_requirement_schedule", { date_range: range });
assert.equal(schedule.coverage.length, 8);
const detail = await tool("get_mesti_evidence_details", { reference_id: daily.findings[0].evidence_reference });
assert.equal(detail.findings.length, 1);
assert.equal(detail.findings[0].evidence_reference, daily.findings[0].evidence_reference);
for (const finding of daily.findings) {
  assert(finding.module && finding.requirement && finding.date && finding.status && finding.severity && finding.evidence_reference && finding.recommended_follow_up);
  for (const sensitive of ["employee_id", "employee_snapshot", "symptoms", "health_status", "notes", "visitor_contact", "completion_note", "verification_note", "completed_by_name", "verified_by_name"]) {
    assert(!Object.hasOwn(finding.evidence, sensitive), `Unexpected sensitive field ${sensitive}`);
  }
  if (finding.module === "health_declaration") {
    assert.deepEqual(Object.keys(finding.evidence), ["declaration_count"]);
    assert.equal(finding.status, "unavailable");
  }
}
const review = await tool("query_factory_resources", { queries: [{resource:"mesti_review", action:"list", date_range:range, limit:100}] });
const comparable = review.results[0].items.map(({id,label,...row})=>row);
assert.deepEqual(comparable.sort((a,b)=>a.evidence_reference.localeCompare(b.evidence_reference)),daily.findings.sort((a,b)=>a.evidence_reference.localeCompare(b.evidence_reference)),"Migrated resource must match legacy data exactly");
assert.equal(review.results[0].has_more,false,"Narrow date or paginate equivalence check");
const summary = { endpoint: expected, business_date: date, connectivity: "PASS", ungranted_raw_resource_access: "DENIED", migrated_review_equivalence: "PASS", tools: toolNames, findings_by_module_status: {}, high_exceptions: exceptions.findings.length, pending_verifications: pending.findings.length, coverage: daily.coverage, data_quality_limitations: daily.data_quality_limitations };
for (const finding of daily.findings) { const key = `${finding.module}/${finding.status}`; summary.findings_by_module_status[key] = (summary.findings_by_module_status[key] || 0) + 1; }
mkdirSync("qa-artifacts/mesti-machine", { recursive: true, mode: 0o700 });
writeFileSync("qa-artifacts/mesti-machine/smoke-summary.json", JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(summary, null, 2));
