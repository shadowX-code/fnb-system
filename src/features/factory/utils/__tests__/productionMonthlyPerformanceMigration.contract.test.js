// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../../../../../supabase/migrations/20261009035944_factory_production_monthly_performance.sql", import.meta.url), "utf8");
describe("Monthly Production performance read authority", () => {
  it("keeps RLS and Production view authority and cannot mutate evidence", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("current_user_has_permission('factory_production.view')");
    expect(sql).toContain("from public, anon");
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|security definer)\b/i);
  });
  it("uses canonical End attribution and actual mass output, never Planning or audit dates", () => {
    expect(sql).toContain("factory_production_operational_completion_at(p.end_date, p.end_time)");
    expect(sql).toContain("at time zone 'Asia/Kuala_Lumpur'");
    expect(sql).toContain("coalesce(p.actual_output_qty, p.good_output_qty, p.actual_produced_qty, p.produced_quantity)");
    expect(sql).toContain("then output_qty / 1000");
    expect(sql).not.toMatch(/completed_at|manufacturing_date|target_|actual_pack_qty/);
  });
  it("counts each JO once and requires valid recorded durations", () => {
    expect(sql).toContain("distinct on (coalesce(job_order_id, id))");
    expect(sql).toContain("case when end_at > start_at");
    expect(sql).toContain("filter (where jo_hours is not null)");
    expect(sql).toContain("filter (where output_kg is not null)");
  });
  it("carries six prior production days for the seven-production-day window", () => {
    expect(sql).toContain("order by day desc limit 6");
    expect(sql).toContain("order by day rows between 6 preceding and current row");
    expect(sql).toContain("sum(missing_output_runs) over window_days = 0");
    expect(sql).toContain("'unattributed_runs'");
  });
});
