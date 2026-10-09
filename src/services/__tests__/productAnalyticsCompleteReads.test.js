import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [], requests: [], mode: "complete", active: 0, peak: 0 }));
vi.mock("../../lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("http://localhost", "test", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url) => {
      const params = new URL(url).searchParams;
      const filter = params.get("report_id");
      const ids = filter.startsWith("eq.") ? [filter.slice(3)] : filter.slice(4, -1).split(",");
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      const rows = state.rows.filter(row => ids.includes(row.report_id)).sort((a, b) => b.nett_sales - a.nett_sales || a.id.localeCompare(b.id));
      state.requests.push({ ids, offset, limit, order: params.get("order"), count: rows.length });
      state.active++; state.peak = Math.max(state.active, state.peak);
      await new Promise(resolve => setTimeout(resolve, 0));
      state.active--;
      // Reproduce the observed yearly HTTP 500 before any Content-Range exists.
      if ((state.mode === "year-timeout" && rows.length > 1842) || state.mode === "timeout") return new Response(JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }), { status: 500, headers: { "Content-Type": "application/json" } });
      let page = rows.slice(offset, offset + limit);
      let count = rows.length;
      if (state.mode === "unknown-count") count = "*";
      if (state.mode === "changed-count" && offset) count++;
      if (state.mode === "short" && page.length === limit) page = page.slice(0, 20);
      if (state.mode === "overlap" && offset) page[0] = rows[0];
      if (state.mode === "wrong-report" && page.length) page = page.map(row => ({ ...row, report_id: "other-report" }));
      if (state.mode === "cross-report-duplicate" && page.length) page = page.map((row, index) => index ? row : { ...row, id: "same-id" });
      const range = page.length ? `${offset}-${offset + page.length - 1}/${count}` : `*/${count}`;
      return new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": range } });
    } },
  }) };
});
import { productAnalyticsService } from "../productAnalyticsService.js";

// Production-equivalent cardinality: 26 reports, 6,013 yearly rows, 1,842
// Sep/Aug rows. Synthetic values retain audited monthly totals without copying
// business records or writing fixtures into a database.
const counts = [[2,"FC",239],[2,"JYMT",166],[3,"FC",228],[3,"JYMT",165],[4,"FC",236],[4,"HLIPH",317],[4,"JYMT",181],[5,"FC",234],[5,"HLIPH",314],[5,"JYMT",188],[6,"FC",234],[6,"HLIPH",276],[6,"HPIPH",243],[6,"JYMT",197],[7,"FC",232],[7,"HLIPH",283],[7,"HPIPH",239],[7,"JYMT",199],[8,"FC",244],[8,"HLIPH",252],[8,"HPIPH",238],[8,"JYMT",204],[9,"FC",232],[9,"HLIPH",241],[9,"HPIPH",241],[9,"JYMT",190]];
const septemberCents = { FC: 4107285, HLIPH: 9911277, HPIPH: 6552778, JYMT: 10988184 };
const augustCents = { FC: 5882433, HLIPH: 11344409, HPIPH: 6417716, JYMT: 11607307 };
function addReport(id, count, cents = count * 100) {
  for (let i = 0; i < count; i++) state.rows.push({ id: `${id}-${String(i).padStart(4,"0")}`, report_id: id, nett_sales: (Math.floor(cents / count) + (i < cents % count ? 1 : 0)) / 100 });
}
beforeEach(() => {
  state.rows = []; state.requests = []; state.mode = "complete"; state.active = 0; state.peak = 0;
  counts.forEach(([month, outlet, count]) => addReport(`${month}-${outlet}`, count, month === 9 ? septemberCents[outlet] : month === 8 ? augustCents[outlet] : count * 100));
});
const reportIds = () => counts.map(([month, outlet]) => `${month}-${outlet}`);

describe("Product complete reads through real PostgREST response parsing", () => {
  it("avoids the observed 26-report/year timeout while returning all 6013 rows", async () => {
    state.mode = "year-timeout";
    const result = await productAnalyticsService.listCompleteItemsByReportIds(reportIds());
    expect(result).toHaveLength(6013);
    const september = result.filter(row => row.report_id.startsWith("9-"));
    const august = result.filter(row => row.report_id.startsWith("8-"));
    expect(september).toHaveLength(904);
    expect(august).toHaveLength(938);
    expect(september.reduce((sum, row) => sum + row.nett_sales, 0)).toBeCloseTo(315595.24, 2);
    expect(august.reduce((sum, row) => sum + row.nett_sales, 0)).toBeCloseTo(352518.65, 2);
    expect(state.requests).toHaveLength(26);
    expect(state.requests.every(request => request.ids.length === 1 && request.limit === 500 && request.order === "nett_sales.desc,id.asc")).toBe(true);
    expect(state.peak).toBeLessThanOrEqual(3);
  });
  it("still paginates a single large report beyond 1000 rows, with duplicate inputs deduplicated", async () => {
    state.rows = []; addReport("large", 1201);
    const result = await productAnalyticsService.listCompleteItemsByReportIds(["large", "large"]);
    expect(result).toHaveLength(1201);
    expect(state.requests.map(row => row.offset)).toEqual([0,500,1000]);
  });
  it.each(["short", "unknown-count", "changed-count", "overlap"])("rejects %s responses rather than emitting partial KPIs", async mode => {
    state.rows = []; addReport("large", 1201); state.mode = mode;
    await expect(productAnalyticsService.listCompleteItemsByReportIds(["large"])).rejects.toMatchObject({ readState: "incomplete" });
  });
  it("retains the actual statement timeout as an error, not a complete empty result", async () => {
    state.mode = "timeout";
    await expect(productAnalyticsService.listCompleteItemsByReportIds(["9-FC"])).rejects.toMatchObject({ readState: "error", cause: { code: "57014" } });
  });
  it.each(["wrong-report", "cross-report-duplicate"])("rejects %s identity corruption across report reads", async mode => {
    state.mode = mode;
    await expect(productAnalyticsService.listCompleteItemsByReportIds(["9-FC", "9-JYMT"])).rejects.toMatchObject({ readState: "incomplete" });
  });
  it("accepts exact-count empty reports and empty requested scope", async () => {
    await expect(productAnalyticsService.listCompleteItemsByReportIds(["empty"])).resolves.toEqual([]);
    await expect(productAnalyticsService.listCompleteItemsByReportIds([])).resolves.toEqual([]);
  });
});
