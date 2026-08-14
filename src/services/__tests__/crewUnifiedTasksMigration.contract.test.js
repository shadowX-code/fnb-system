import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve("supabase/migrations/20260814063008_crew_unified_tasks.sql"), "utf8");
const fix = readFileSync(resolve("supabase/migrations/20260814070437_crew_unified_tasks_measurement_range_fix.sql"), "utf8");
const blockFix = readFileSync(resolve("supabase/migrations/20260814071046_crew_unified_tasks_block_compatibility_fix.sql"), "utf8");
const guardFix = readFileSync(resolve("supabase/migrations/20260814071158_crew_unified_tasks_guard_runtime_fix.sql"), "utf8");
const todayFix = readFileSync(resolve("supabase/migrations/20260814071542_crew_unified_tasks_today_role_fix.sql"), "utf8");
const confirmationFix = readFileSync(resolve("supabase/migrations/20260814071808_crew_unified_tasks_confirmation_block_fix.sql"), "utf8");
const lifecycle = readFileSync(resolve("supabase/migrations/20260814100940_crew_task_lifecycle_results.sql"), "utf8");
const lifecycleGuardFix = readFileSync(resolve("supabase/migrations/20260814102750_crew_task_lifecycle_guard_fix.sql"), "utf8");
const duplicateEndDateFix = readFileSync(resolve("supabase/migrations/20260814103401_crew_task_duplicate_end_date_fix.sql"), "utf8");

describe("Crew unified Tasks migration contract", () => {
  it("adds one versioned Task model without deleting legacy Operations history", () => {
    for (const field of ["task_type", "schedule_type", "schedule_config", "assignment_type", "completion_rule", "priority"]) {
      expect(sql).toContain(`add column if not exists ${field}`);
    }
    expect(sql).toContain("template_snapshot");
    expect(sql).toContain("create table public.crew_task_instance_assignees");
    expect(sql).toContain("create table public.crew_task_item_responses");
    expect(sql).not.toMatch(/drop table(?: if exists)? public\.crew_(?:operation|daily)/);
    expect(sql).not.toMatch(/delete from public\.crew_(?:operation|daily)/);
  });

  it("supports the approved schedules, assignments, content and completion rules", () => {
    for (const value of ["one_time", "recurring", "shift_based", "specific_weekdays", "custom_interval", "all_crew", "position", "specific_crew", "group", "every_assigned", "one_for_team", "health_rating", "sop_reference", "temperature"]) {
      expect(sql).toContain(`'${value}'`);
    }
    expect(sql).toContain("duty_roster_published_entries");
    expect(sql).toContain("v.status='published'");
    expect(sql).toContain("sop_snapshot");
  });

  it("keeps direct tables closed and splits Admin from token-bound Crew authorities", () => {
    expect(sql).toContain("alter table public.crew_task_instance_assignees enable row level security");
    expect(sql).toContain("revoke all on public.crew_task_instance_assignees,public.crew_task_item_responses,public.crew_task_reviews from public,anon,authenticated");
    expect(sql).toContain("security definer set search_path=public");
    expect(sql).toContain("public.crew_operations_employee_context(p_token)");
    expect(sql).toContain("grant execute on function public.crew_tasks_today(text,date) to anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_tasks_review(uuid,uuid,text,text) to authenticated");
    expect(sql).not.toMatch(/grant execute on function public\.crew_tasks_(?:schedule_matches|employee_applies)[^;]+to (?:anon|authenticated)/);
  });

  it("protects frozen instances, outlet scope and first-writer responses", () => {
    expect(sql).toContain("public.current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("on conflict(instance_item_id,employee_id) do nothing");
    expect(sql).toContain("A teammate has already completed this item.");
    expect(sql).toContain("Photo content remains disabled until the Operations media store is available.");
    expect(fix).toContain("alter column task_type set default 'checklist'");
    expect(fix).toContain("Measurement is outside the allowed range. Record an exception with a reason.");
    expect(fix).toContain("security definer set search_path=public");
    expect(fix).toContain("revoke all on function public.crew_tasks_update_block(text,uuid,text,jsonb,text,text) from public,anon,authenticated");
    expect(blockFix).toContain("alter column block_type set default 'checklist_item'");
    expect(guardFix).toContain("if tg_table_name='crew_operation_templates' then");
    expect(guardFix).toContain("elsif tg_table_name='crew_operation_template_items' then");
    expect(todayFix).toContain("v_role:=nullif(ctx->>'role_id','')::uuid");
    expect(confirmationFix).toContain("'confirmation'" );
  });

  it("adds controlled lifecycle operations without rewriting frozen history", () => {
    for (const status of ["paused", "ended", "archived"]) expect(lifecycle).toContain(`'${status}'`);
    expect(lifecycle).toContain("create or replace function public.crew_tasks_manage_schedule");
    expect(lifecycle).toContain("public.current_user_has_permission('crew_operations.manage')");
    expect(lifecycle).toContain("public.current_user_can_access_outlet(v_task.outlet_id)");
    expect(lifecycle).toContain("grant execute on function public.crew_tasks_manage_schedule(uuid,text,date) to authenticated");
    expect(lifecycle).not.toMatch(/grant execute on function public\.crew_tasks_manage_schedule[^;]+to (?:public|anon)/);
    expect(lifecycle).not.toMatch(/delete from public\.crew_(?:operation_instances|task_item_responses)/);
    expect(lifecycleGuardFix).toContain("if tg_table_name='crew_operation_templates' then");
    expect(lifecycleGuardFix).toContain("elsif tg_table_name='crew_operation_template_items' then");
  });

  it("derives next run, progress and result reads on the server", () => {
    expect(lifecycle).toContain("create or replace function public.crew_tasks_next_run");
    expect(lifecycle).toContain("create or replace function public.crew_tasks_admin_detail");
    expect(lifecycle).toContain("create or replace function public.crew_tasks_admin_result");
    expect(lifecycle).toContain("'created_date',(select min(x.created_at)::date");
    expect(lifecycle).toContain("to_jsonb(v_instance)-'template_snapshot'");
    expect(lifecycle).toContain("revoke all on public.crew_operation_templates");
  });

  it("duplicates the complete recurrence schedule through the controlled authority", () => {
    expect(duplicateEndDateFix).toContain("source.schedule_end_date");
    expect(duplicateEndDateFix).toContain("public.current_user_has_permission('crew_operations.manage')");
    expect(duplicateEndDateFix).toContain("public.current_user_can_access_outlet(source.outlet_id)");
    expect(duplicateEndDateFix).toContain("security definer");
    expect(duplicateEndDateFix).toContain("set search_path=public");
    expect(duplicateEndDateFix).toContain("revoke all on function public.crew_tasks_duplicate(uuid) from public,anon,authenticated");
    expect(duplicateEndDateFix).toContain("grant execute on function public.crew_tasks_duplicate(uuid) to authenticated");
  });
});
