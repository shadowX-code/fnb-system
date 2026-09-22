import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260920193914_employee_disciplinary_records_v1.sql"), "utf8").toLowerCase();

describe("People disciplinary records V1 contract", () => {
  it("uses dedicated People permissions and private evidence", () => {
    expect(sql).toContain("employee_disciplinary.view");
    expect(sql).toContain("employee_disciplinary.manage");
    expect(sql).toContain("employee-disciplinary-evidence");
    expect(sql).toContain("values ('employee-disciplinary-evidence','employee-disciplinary-evidence',false");
  });

  it("keeps V1 types narrow and issued content immutable", () => {
    expect(sql).toContain("first_written_warning");
    expect(sql).toContain("final_written_warning");
    expect(sql).toContain("issued warning content is immutable");
    expect(sql).toContain("disciplinary history is immutable");
    expect(sql).toContain("supersedes_warning_id");
    expect(sql).toContain("superseded_by_warning_id");
  });

  it("derives Crew identity from the opaque session token", () => {
    expect(sql).toContain("v_employee:=public.crew_session_employee(p_token)");
    expect(sql).toContain("where id=p_warning_id and employee_id=v_employee");
  });

  it("records delivery, view, response and acknowledgement as server evidence", () => {
    expect(sql).toContain("'delivered','system'");
    expect(sql).toContain("'viewed','crew'");
    expect(sql).toContain("'response_added','crew'");
    expect(sql).toContain("'acknowledged','crew'");
    expect(sql).toContain("clock_timestamp()");
  });

  it("does not grant direct table access", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.employee_disciplinary_warnings");
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete).*employee_disciplinary_/);
  });
});
