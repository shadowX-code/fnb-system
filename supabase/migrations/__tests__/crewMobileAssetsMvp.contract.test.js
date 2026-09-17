import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260917104654_crew_mobile_assets_mvp.sql"), "utf8");

describe("Crew Mobile Assets MVP authority", () => {
  it("models independent per-account capabilities and a controlled Admin mutation", () => {
    expect(sql).toContain("can_adjust_assets boolean not null default false");
    expect(sql).toContain("can_perform_asset_inspections boolean not null default false");
    expect(sql).toContain("current_user_has_permission('crew_employees.manage')");
    expect(sql).toContain("current_user_can_access_outlet(v_outlet_id)");
    expect(sql).toMatch(/crew_update_special_access[\s\S]*crew_update_cash_operations_access[\s\S]*crew_update_asset_access/);
  });

  it("keeps Crew reads token-bound, outlet-bound and narrower than Admin tables", () => {
    expect(sql).toMatch(/crew_asset_context\(p_token text\)[\s\S]*crew_session_employee\(p_token\)/);
    expect(sql).toContain("a.outlet_id=v_outlet_id");
    expect(sql).not.toMatch(/'cost'|'vendor'|'purchase_date'/);
    expect(sql).toContain("Crew Asset access is unavailable.");
  });

  it("uses canonical lifecycle requests for idempotent, locked mutations", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('asset_lifecycle_'");
    expect(sql).toContain("operation='quantity_adjustment'");
    expect(sql).toContain("operation='inspection_submission'");
    expect(sql).toContain("actor_employee_id");
  });

  it("prevents Crew from applying Admin-only lifecycle conditions", () => {
    expect(sql).toContain("Crew cannot apply this asset condition.");
    expect(sql).not.toContain("v_condition not in ('healthy','needs_attention','under_maintenance'");
    expect(sql).toContain("Completed inspections are immutable.");
  });

  it("exposes only token-authorized evidence upload context", () => {
    expect(sql).toMatch(/crew_asset_evidence_context\(p_token text,p_asset_id uuid\)[\s\S]*can_perform_asset_inspections/);
    expect(sql).toContain("grant execute on function public.crew_asset_evidence_context(text,uuid) to anon,authenticated");
  });
});
