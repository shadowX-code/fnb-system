import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260908073820_factory_mesti_health_declaration_symptom_taxonomy.sql"), "utf8");

describe("Factory MeSTI Health Declaration symptom taxonomy forward contract", () => {
  it("accepts separate new symptom codes while retaining the legacy combined value only for historical rows", () => {
    expect(sql).toContain("'vomiting'");
    expect(sql).toContain("'sore_throat'");
    expect(sql).toContain("'skin_infection_open_wound'");
    expect(sql).toContain("'eye_infection_discharge'");
    expect(sql).toContain("'ear_infection_discharge'");
    expect(sql).toContain("'nose_infection_discharge'");
    expect(sql).toContain("'ear_nose_eye_infection'");
    expect(sql).toContain("allowed_symptoms constant text[]");
    expect(sql).not.toContain("'ear_nose_eye_infection'\n  ];");
  });

  it("stores Other detail separately and retains the canonical empty-array No symptoms contract", () => {
    expect(sql).toContain("add column if not exists other_symptom_detail text");
    expect(sql).toContain("Please specify the Other symptom.");
    expect(sql).toContain("case when cardinality(symptom_values)=0 then 'fit_for_work'");
    expect(sql).toContain("p_symptom = 'no_symptoms' and cardinality(d.symptoms) = 0");
  });
});
