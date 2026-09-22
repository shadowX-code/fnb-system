import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260815171846_crew_tasks_auto_complete_on_block_response.sql"), "utf8").toLowerCase();

describe("Crew Tasks automatic completion migration contract", () => {
  it("reuses the canonical completion authority after the final required response", () => {
    expect(sql).toContain("completion_result := public.crew_tasks_complete(p_token, instance.id)");
    expect(sql).toContain("i.is_required");
    expect(sql).toContain("i.block_type not in ('text', 'key_point', 'image', 'sop_reference')");
    expect(sql).toContain("r.status not in ('not_checked')");
  });

  it("keeps the Crew identity and assignment ownership server-derived", () => {
    expect(sql).toContain("ctx := public.crew_operations_employee_context(p_token)");
    expect(sql).toContain("a.employee_id = v_employee");
    expect(sql).not.toMatch(/p_employee_id/);
  });

  it("returns authoritative task status and completion time", () => {
    expect(sql).toContain("'task_status', assignee_status");
    expect(sql).toContain("'completed_at', assignee.completed_at");
  });

  it("fixes search_path and grants only the intended token-bound roles", () => {
    expect(sql.match(/set search_path = public/g)).toHaveLength(2);
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to anon, authenticated");
  });
});
