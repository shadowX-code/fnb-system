import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903280000_factory_mesti_health_declaration.sql"), "utf8");

describe("Factory MeSTI Health Declaration contract", () => {
  it("uses one immutable declaration domain with canonical employee references and structured symptoms", () => {
    expect(sql).toContain("factory_mesti_health_declarations");
    expect(sql).toContain("declaration_type in ('employee', 'visitor')");
    expect(sql).toContain("employee_id uuid references public.employees");
    expect(sql).toContain("employee_snapshot jsonb not null");
    expect(sql).toContain("symptoms text[] not null");
    expect(sql).toContain("'diarrhea','fever','jaundice','visible_skin_infection','ear_nose_eye_infection','other'");
  });

  it("derives health state, persists employee actions separately, and makes retry submission idempotent", () => {
    expect(sql).toContain("case when cardinality(symptom_values)=0 then 'fit_for_work' else 'health_issue_declared' end");
    expect(sql).toContain("case when cardinality(symptom_values)=0 then 'cleared' else 'health_issue_declared' end");
    expect(sql).toContain("factory_mesti_health_declarations_request_key");
    expect(sql).toContain("factory_mesti_action_health_declaration");
    expect(sql).toContain("declaration evidence is immutable");
  });

  it("enforces canonical server permissions and provides one filtered unified records projection", () => {
    expect(sql).toContain("factory_mesti_health_declaration.create");
    expect(sql).toContain("factory_mesti_health_declaration.manage");
    expect(sql).toContain("factory_mesti_health_declaration_records");
    expect(sql).toContain("p_symptom=any(d.symptoms)");
    expect(sql).toContain("revoke all on function");
  });
});
