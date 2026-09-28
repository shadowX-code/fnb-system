import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260928154126_crew_tasks_admin_creation_metadata.sql", "utf8").toLowerCase();

describe("Crew Tasks paged creation metadata", () => {
  it("retains the paged authority and projects original series creation through the employee identity", () => {
    expect(sql).toContain("create or replace function public.crew_tasks_admin_page");
    expect(sql).toContain("volatile security definer set search_path=public");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("'task_created_at',(select min(t0.created_at)");
    expect(sql).toContain("'created_by_name',(select coalesce(nullif(btrim(e.nickname)");
    expect(sql).toContain("e.auth_user_id=t0.created_by");
    expect(sql).toContain("to_jsonb(x)-'created_by'-'next_run'");
    expect(sql).toContain("grant execute on function public.crew_tasks_admin_page(uuid,date,date,text,jsonb,integer,integer) to authenticated");
  });
});
