import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929132630_crew_stock_check_history_check_date_month.sql"), "utf8").toLowerCase();
const history = sql.split("create or replace function public.crew_inventory_stock_check_history(")[1]?.split("end; $$;")[0] || "";
const detail = sql.split("create or replace function public.crew_inventory_stock_checks(")[1]?.split("end; $$;")[0] || "";

describe("Crew Stock Check canonical-date History correction", () => {
  it("buckets and orders History by check date, including late completed checks", () => {
    expect(history).toContain("c.check_date>=p_month");
    expect(history).toContain("c.check_date<(p_month+interval '1 month')::date");
    expect(history).toContain("(c.check_date::timestamp at time zone 'asia/kuala_lumpur') history_at");
    expect(history).not.toContain("c.submitted_at");
    expect(history).not.toContain("c.skipped_at");
  });

  it("closes older Crew detail while retaining completion evidence", () => {
    expect(detail).toContain("and v_check.check_date<");
    expect(detail).toContain("'submitted_at',c.submitted_at");
    expect(detail).toContain("'skipped_at',c.skipped_at");
    expect(sql).not.toContain("function public.crew_inventory_purchase_order_history");
    expect(sql).not.toMatch(/\b(?:update|delete|insert)\s+(?:into\s+|from\s+)?public\.inventory_stock_checks\b/);
  });
});
