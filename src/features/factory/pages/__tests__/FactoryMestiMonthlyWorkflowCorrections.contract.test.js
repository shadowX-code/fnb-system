import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919153000_factory_mesti_monthly_workflow_corrections.sql"),
  "utf8",
);

describe("MeSTI monthly workflow correction SQL contract", () => {
  it("projects only scheduled Waste dates and retains the canonical session lifecycle", () => {
    expect(migration).toContain("factory_mesti_recurrence_due(r.frequency,r.recurrence_weekdays,d.run_date)");
    expect(migration).toContain("'session_status',session_status");
    expect(migration).toContain("'logical_requirement_id',logical_requirement_id");
    expect(migration).toContain("jsonb_object_agg(run_date::text");
  });

  it("rejects unscheduled Waste events at the trusted write boundary", () => {
    expect(migration).toContain("No scheduled waste disposal requirement applies to this Location on this date.");
    expect(migration).toContain("factory_mesti_recurrence_due(r.frequency,r.recurrence_weekdays,p_date)");
  });

  it("preserves complete Health correction fields and audit identity", () => {
    expect(migration).toContain("other_symptom_detail=case when 'other'=any(v_symptoms)");
    expect(migration).toContain("employee_snapshot=case when v_row.declaration_type='employee'");
    expect(migration).toContain("where id=v_row.id returning * into v_row");
    expect(migration).toContain("factory_mesti_health_declaration_updated");
  });
});
