import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202608300002_reporting_outlet_visibility.sql", "utf8");

describe("Reporting outlet selector visibility", () => {
  it("permits only reports.view users within their existing outlet scope", () => {
    expect(sql).toContain('create policy "report viewers can view scoped outlets"');
    expect(sql).toContain("on public.outlets");
    expect(sql).toContain("for select");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("public.current_user_has_permission('reports.view')");
    expect(sql).toContain("public.current_user_can_access_outlet(id)");
    expect(sql).not.toContain("to anon");
  });
});
