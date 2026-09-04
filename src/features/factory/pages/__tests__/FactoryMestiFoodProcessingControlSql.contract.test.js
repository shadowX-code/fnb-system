import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904100000_factory_mesti_food_processing_control.sql"),
  "utf8",
);

describe("Food Processing Control SQL contract", () => {
  it("uses the declared finished-good filter argument in the report projection", () => {
    expect(migration).toContain("p.finished_good_id=p_finished_good_id");
    expect(migration).not.toContain("p.finished_good_id=p_finished_good)");
  });
});
