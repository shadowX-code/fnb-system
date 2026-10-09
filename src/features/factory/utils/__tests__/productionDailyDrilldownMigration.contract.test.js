// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../../../../../supabase/migrations/20261009043918_factory_production_daily_drilldown_uom_owner.sql", import.meta.url), "utf8");
describe("Daily drill-down uses the monthly read authority", () => {
  it("extends the one snapshot without bypassing RLS or mutating records", () => {
    expect(sql).toContain("create or replace function public.factory_get_production_monthly_performance");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("current_user_has_permission('factory_production.view')");
    expect(sql).toContain("from public, anon");
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|security definer)\b/i);
  });
  it("projects details from the exact measured/deduplicated aggregate input", () => {
    expect(sql).toContain("select runs.*");
    expect(sql).toContain("distinct on (coalesce(job_order_id, id))");
    expect(sql).toContain("factory_production_operational_completion_at(p.end_date, p.end_time)");
    expect(sql).toContain("'actual_pack_qty', actual_pack_qty");
    expect(sql).toContain("'output_kg', output_kg");
    expect(sql).toContain("'jo_hours', jo_hours");
    expect(sql).toContain("order by end_at, id");
    expect(sql).not.toMatch(/completed_at|manufacturing_date|target_/);
    expect(sql.match(/from public.factory_productions/g)).toHaveLength(1);
    expect(sql).toContain("case when runs.uom in");
    expect(sql).not.toMatch(/when uom in/);
  });
});
