import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260927131723_crew_google_review_target_history.sql", "utf8");

describe("Google monthly target history", () => {
  it("requires authenticated Performance read permission and an accessible active outlet", () => {
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("current_user_has_permission('crew_performance.view')");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("is_active = true");
    expect(sql).toContain("stable security definer set search_path = public");
    expect(sql).toContain("from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_google_target_history(uuid,date) to authenticated");
  });
  it("returns only scoped configuration history, without provider content or credentials", () => {
    expect(sql).toContain("p_period <> date_trunc('month', p_period)::date");
    expect(sql).toContain("a.outlet_id = p_outlet_id and a.period_start = p_period");
    expect(sql).toContain("order by a.changed_at desc, a.id desc");
    expect(sql).not.toMatch(/insert into|update public|delete from|auth_user_id|email|token|review_text/i);
  });
});
