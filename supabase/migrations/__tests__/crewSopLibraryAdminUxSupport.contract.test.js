import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812024701_crew_sop_library_admin_ux_support.sql"), "utf8");
const usageFixSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812030929_crew_sop_usage_distinct_assignment_fix.sql"), "utf8");

describe("Crew SOP Library Admin UX support migration", () => {
  it("clones only explicit published source SOPs into independent target drafts", () => {
    expect(sql).toContain("crew_clone_selected_sops");
    expect(sql).toContain("s.id = any(p_sop_ids)");
    expect(sql).toContain("and s.status = 'published'");
    expect(sql).toContain("'draft', null, p_target_outlet_id");
    expect(sql).toContain("'copies_are_independent', true");
  });

  it("enforces permission and both outlet scopes", () => {
    expect(sql).toContain("current_user_has_permission('crew_sop.manage')");
    expect(sql).toContain("current_user_can_access_outlet(p_source_outlet_id)");
    expect(sql).toContain("current_user_can_access_outlet(p_target_outlet_id)");
  });

  it("returns sanitized usage summaries without raw assignment snapshots", () => {
    expect(sql).toContain("crew_admin_sop_usage");
    expect(sql).toContain("'assignment_count', pinned.assignment_count");
    expect(sql).not.toContain("'journey_snapshot',");
    expect(usageFixSql).toContain("count(distinct a.id) as assignment_count");
    expect(usageFixSql).not.toContain("'journey_snapshot',");
  });

  it("keeps both SECURITY DEFINER authorities explicit and authenticated-only", () => {
    for (const signature of [
      "public.crew_clone_selected_sops(uuid, uuid, uuid[], boolean)",
      "public.crew_admin_sop_usage(uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to authenticated`);
    }
    expect(sql.match(/security definer/g)?.length).toBe(2);
    expect(sql.match(/set search_path = public/g)?.length).toBe(2);
  });
});
