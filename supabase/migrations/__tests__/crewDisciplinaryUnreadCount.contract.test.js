import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921093000_crew_disciplinary_unread_count.sql"), "utf8");

describe("Crew disciplinary unread projection contract", () => {
  it("derives unread warnings from the token employee and explicit first-view evidence", () => {
    expect(sql).toContain("v_employee:=public.crew_session_employee(p_token)");
    expect(sql).toContain("where employee_id=v_employee");
    expect(sql).toContain("and status='delivered'");
    expect(sql).toContain("and first_viewed_at is null");
    expect(sql).toContain("'unread_count',v_unread_count");
  });

  it("keeps delivery and acknowledgement separate from the unread definition", () => {
    expect(sql).toContain("set status='delivered',delivered_at=v_now");
    expect(sql).not.toMatch(/v_unread_count[\s\S]*acknowledged_at\s+is\s+null/i);
    expect(sql).not.toMatch(/v_unread_count[\s\S]*status\s+in\s*\([^)]*(withdrawn|superseded)/i);
  });

  it("retains the restricted Crew RPC grant boundary", () => {
    expect(sql).toContain("revoke all on function public.crew_employee_disciplinary(text) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_employee_disciplinary(text) to anon,authenticated");
  });
});
