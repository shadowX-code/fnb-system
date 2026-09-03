import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903250000_factory_mesti_equipment_cleaning_monthly_summary_occurrence_counts.sql"), "utf8");

describe("Factory MeSTI Equipment Cleaning Monthly projection contract", () => {
  it("returns one Equipment-centric row with Scheduled and After Production occurrence evidence", () => {
    expect(migration).toContain("group by occurrence_rows.equipment_id, occurrence_rows.due_date");
    expect(migration).toContain("group by equipment_id");
    expect(migration).toContain("'equipment_id', equipment_id");
    expect(migration).toContain("'source_type', occurrence_rows.source_type");
    expect(migration).toContain("'production_snapshot', occurrence_rows.requirement_snapshot->'production_snapshot'");
  });

  it("derives canonical cell and summary counts with unsatisfactory precedence", () => {
    expect(migration).toContain("count(*) filter (where occurrence_rows.status = 'verified')");
    expect(migration).toContain("count(*) filter (where occurrence_rows.status = 'completed')");
    expect(migration).toContain("when count(*) filter (where occurrence_rows.status = 'unsatisfactory') > 0 then 'unsatisfactory'");
    expect(migration).toContain("when count(*) filter (where occurrence_rows.status = 'verified') = count(*) then 'verified'");
    expect(migration).toContain("'pending_count', pending_count");
    expect(migration).toContain("coalesce(sum(total_count), 0)::integer as total_count");
  });

  it("preserves audit identity and timestamps in each drill-down occurrence", () => {
    expect(migration).toContain("'due_date', occurrence_rows.due_date");
    expect(migration).toContain("'completed_by_name'");
    expect(migration).toContain("'completed_at', occurrence_rows.completed_at");
    expect(migration).toContain("'verified_by_name'");
    expect(migration).toContain("'verified_at', occurrence_rows.verified_at");
  });
});
