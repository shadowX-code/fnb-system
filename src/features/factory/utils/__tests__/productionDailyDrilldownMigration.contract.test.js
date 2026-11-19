// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../../../../../supabase/migrations/20261119092747_factory_daily_production_batch_no.sql", import.meta.url), "utf8");
describe("Daily drill-down uses the monthly read authority", () => {
  it("extends the one snapshot without bypassing RLS or mutating records", () => {
    expect(sql.toLowerCase()).toContain("create or replace function feedx_integrations.factory_get_production_monthly_performance_core");
    expect(sql.toLowerCase()).toContain("security invoker");
    expect(sql).toContain("read_permission(p_gateway_token,'factory_production.view')");
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|security definer)\b/i);
  });
  it("projects details from the exact measured/deduplicated aggregate input", () => {
    expect(sql).toContain("select runs.*");
    expect(sql).toContain("distinct on (coalesce(job_order_id, id))");
    expect(sql).toContain("factory_production_operational_completion_at(p.end_date, p.end_time)");
    expect(sql).toContain("'actual_pack_qty', actual_pack_qty");
    expect(sql).toContain("p.production_no, p.batch_no");
    expect(sql).toContain("when p_gateway_token is null then jsonb_build_object('batch_no', batch_no)");
    expect(sql).toContain("'production_no', production_no");
    expect(sql).toContain("'output_kg', output_kg");
    expect(sql).toContain("'jo_hours', jo_hours");
    expect(sql).toContain("order by end_at, id");
    expect(sql).not.toMatch(/completed_at|manufacturing_date|target_/);
    expect(sql.match(/from public.factory_productions/g)).toHaveLength(1);
    expect(sql).toContain("case when runs.uom in");
    expect(sql).not.toMatch(/when uom in/);
  });
});
