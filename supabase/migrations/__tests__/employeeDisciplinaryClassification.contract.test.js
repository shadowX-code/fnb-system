import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921043000_employee_disciplinary_classification_sequence.sql"), "utf8").toLowerCase();

describe("People disciplinary classification and sequence contract", () => {
  it("adds Written Warning without rewriting the legacy issued type", () => {
    expect(sql).toContain("'first_written_warning','written_warning','final_written_warning'");
    expect(sql).toContain("not in ('written_warning','final_written_warning')");
    expect(sql).not.toContain("update public.employee_disciplinary_warnings set warning_type='written_warning'");
  });

  it("backfills and freezes server-derived employee warning sequences", () => {
    expect(sql).toContain("row_number() over");
    expect(sql).toContain("partition by employee_id");
    expect(sql).toContain("employee_disciplinary_warning_sequence_unique");
    expect(sql).toContain("perform 1 from public.employees where id=v_warning.employee_id for update");
    expect(sql).toContain("display_sequence=v_sequence");
    expect(sql).toContain("new.display_sequence is distinct from old.display_sequence");
  });

  it("validates related history against the same employee and exposes it through canonical reads", () => {
    expect(sql).toContain("related_previous_warning_id");
    expect(sql).toContain("related.employee_id=p_employee_id");
    expect(sql).toContain("'related_warning'");
  });
});
