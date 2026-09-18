import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260918160000_factory_production_operational_completion.sql"), "utf8");

describe("Factory Production operational completion migration", () => {
  it("uses Production End as the shared Malaysia-time completion authority", () => {
    expect(migration).toContain("factory_production_operational_completion_at");
    expect(migration).toContain("(p_end_date + p_end_time) at time zone 'Asia/Kuala_Lumpur'");
    expect(migration).toContain("factory_get_production_operational_snapshot");
    expect(migration).toContain("factory_get_dashboard_operational_monthly_analytics");
  });

  it("keeps audit completion metadata separate from operational report filtering", () => {
    expect(migration).toContain("production.completed_at, production.end_date, production.end_time");
    expect(migration).toContain("p.end_date >= p_date_from");
    expect(migration).toContain("p.end_date <= p_date_to");
    expect(migration).not.toContain("production.completed_at::date >= p_date_from");
  });
});
