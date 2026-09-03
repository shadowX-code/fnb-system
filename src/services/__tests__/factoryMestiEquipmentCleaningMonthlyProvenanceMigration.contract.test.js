import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903230000_factory_mesti_equipment_cleaning_monthly_equipment_projection.sql"), "utf8");

describe("Factory MeSTI Equipment Cleaning Monthly projection contract", () => {
  it("returns one Equipment-centric row with Scheduled and After Production occurrence evidence", () => {
    expect(migration).toContain("group by equipment_id, due_date");
    expect(migration).toContain("group by equipment_id");
    expect(migration).toContain("'equipment_id', equipment_id");
    expect(migration).toContain("'source_type', source_type");
    expect(migration).toContain("'production_snapshot', requirement_snapshot->'production_snapshot'");
  });

  it("derives canonical cell and summary counts with unsatisfactory precedence", () => {
    expect(migration).toContain("count(*) filter (where status = 'verified')");
    expect(migration).toContain("count(*) filter (where status = 'completed')");
    expect(migration).toContain("when count(*) filter (where status = 'unsatisfactory') > 0 then 'unsatisfactory'");
    expect(migration).toContain("when count(*) filter (where status = 'verified') = count(*) then 'verified'");
    expect(migration).toContain("'pending_count', pending_count");
  });

  it("preserves audit identity and timestamps in each drill-down occurrence", () => {
    expect(migration).toContain("'due_date', due_date");
    expect(migration).toContain("'completed_by_name'");
    expect(migration).toContain("'completed_at', completed_at");
    expect(migration).toContain("'verified_by_name'");
    expect(migration).toContain("'verified_at', verified_at");
  });
});
