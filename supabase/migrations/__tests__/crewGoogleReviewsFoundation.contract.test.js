import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve("supabase/migrations/20260925065635_crew_google_reviews_foundation.sql"), "utf8");
const guard = readFileSync(path.resolve("supabase/migrations/20260925070543_crew_google_reviews_outlet_guard.sql"), "utf8");

describe("Google Reviews foundation", () => {
  it("keeps review data unavailable without a verified provider", () => {
    expect(sql).toContain("'api_status', 'pending_allowlist'");
    expect(sql).toContain("'new_reviews', null, 'positive_reviews', null, 'average_rating', null");
    expect(sql).toContain("'rating_breakdown', null, 'review_trend', null, 'reviews', '[]'::jsonb");
    expect(sql).not.toMatch(/create table public\.crew_google_reviews\s*\(/);
  });

  it("enforces outlet permission and authenticated-only read/write", () => {
    expect(sql).toContain("public.current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("public.current_user_has_permission('crew_performance.view')");
    expect(sql).toContain("public.current_user_has_permission('crew_performance.review')");
    expect(sql).toContain("grant execute on function public.crew_google_reviews_admin_context(uuid, date) to authenticated");
    expect(sql).toContain("grant execute on function public.crew_google_set_monthly_target(uuid, date, integer) to authenticated");
    expect(guard.match(/or not exists \(select 1 from public\.outlets where id = p_outlet_id and is_active = true\)/g)).toHaveLength(2);
  });

  it("audits positive targets and refuses edits after finalization", () => {
    expect(sql).toContain("positive_target integer not null check (positive_target > 0)");
    expect(sql).toContain("create table public.crew_google_monthly_target_audit");
    expect(sql).toContain("status = 'finalized'");
    expect(sql).toContain("Monthly target is locked after Performance finalization.");
    expect(sql).toContain("v_old is distinct from p_positive_target");
  });

  it("requires explicit mapping to provider-verified location resources", () => {
    expect(sql).toContain("create table public.crew_google_business_locations");
    expect(sql).toContain("location_resource_name text not null unique references public.crew_google_business_locations(resource_name)");
    expect(sql).toContain("crew_google_outlet_locations");
  });
});
