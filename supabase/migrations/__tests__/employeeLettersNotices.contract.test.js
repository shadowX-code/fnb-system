import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929113909_employee_letters_notices_types.sql"), "utf8").toLowerCase();
const fieldShapeSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929114112_employee_letters_notices_warning_field_shape.sql"), "utf8").toLowerCase();
const transitionSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929114600_employee_letters_notices_transition_copy.sql"), "utf8").toLowerCase();

describe("People Letters & Notices authority", () => {
  it("classifies all requested types but exposes only the safe receipt workflows", () => {
    for (const code of ["warning", "show_cause", "advisory_reminder", "performance_attendance_notice", "confirmation", "promotion_transfer", "salary_adjustment", "suspension", "resignation_acknowledgement", "termination", "general_notice"]) {
      expect(sql).toContain(`('${code}'`);
    }
    expect(sql).toContain("('warning','warning','warning',true,true)");
    expect(sql).toContain("('advisory_reminder','advisory / reminder','receipt',true,true)");
    expect(sql).toContain("('general_notice','general notice','receipt',true,false)");
    expect(sql).toContain("where t.code=v_type and t.enabled");
  });

  it("keeps warning fields conditional and issued content immutable", () => {
    expect(sql).toContain("document_type='warning' and warning_type is not null");
    expect(sql).toContain("document_type<>'warning' and warning_type is null");
    expect(sql).toContain("new.body is distinct from old.body");
    expect(sql).toContain("new.document_type is distinct from old.document_type");
    expect(sql).toContain("where employee_id=v_record.employee_id and document_type='warning'");
    expect(fieldShapeSql).toContain("drop constraint employee_disciplinary_warnings_warning_details_check");
    expect(fieldShapeSql).toContain("drop constraint employee_disciplinary_warnings_required_action_check");
  });

  it("keeps Crew reads token-bound and response category-specific", () => {
    expect(sql).toContain("v_employee:=public.crew_session_employee(p_token)");
    expect(sql).toContain("w.employee_id=v_employee and w.status<>'draft'");
    expect(sql).toContain("type.response_allowed");
    expect(sql).toContain("new.document_type='warning' and new.status='issued'");
    expect(sql).not.toContain("insert into public.employee_employment_documents");
    expect(transitionSql).toContain("this letter or notice cannot be acknowledged");
  });
});
