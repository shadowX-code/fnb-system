import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve("supabase/migrations/20260827170432_crew_task_reset_authority.sql"), "utf8");

describe("Crew Task reset authority contract", () => {
  it("keeps reset token-bound, outlet-scoped, unfinished-only, and audited", () => {
    [
      "public.crew_operations_employee_context(p_token)",
      "v_instance.outlet_id <> (ctx->>'outlet_id')::uuid",
      "v_assignee.status not in ('not_started', 'in_progress')",
      "Only an unfinished Task can be redone.",
      "delete from public.crew_task_item_responses",
      "set status = 'not_started'",
      "'crew_task_reset'",
      "'actor_employee_id', v_employee",
      "'cleared_response_count', v_cleared_count",
      "security definer",
      "set search_path = public",
      "grant execute on function public.crew_tasks_reset(text, uuid) to anon, authenticated",
    ].forEach((contract) => expect(sql).toContain(contract));
  });

  it("keeps completed and reviewing Task blocks server-read-only", () => {
    expect(sql).toContain("Completed or reviewing Tasks cannot be edited.");
    expect(sql).toContain("crew_tasks_update_block_unlocked");
    expect(sql).toContain("revoke all on function public.crew_tasks_update_block_unlocked");
  });

  it("does not rewrite task definitions, assignments, or historical audit records", () => {
    expect(sql).not.toMatch(/delete from public\.crew_operation_(?:instances|template|template_items)/);
    expect(sql).not.toMatch(/delete from public\.crew_task_instance_assignees/);
    expect(sql).not.toMatch(/delete from public\.audit_logs/);
  });
});
