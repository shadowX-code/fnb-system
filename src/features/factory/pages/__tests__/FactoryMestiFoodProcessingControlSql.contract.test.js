import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const legacyMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904005058_factory_mesti_food_processing_control.sql"),
  "utf8",
);
const workflowMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260920010000_factory_mesti_food_processing_qc_and_verification.sql"),
  "utf8",
);

describe("Food Processing Control SQL contract", () => {
  it("uses the declared finished-good filter argument in the report projection", () => {
    expect(legacyMigration).toContain("p.finished_good_id=p_finished_good_id");
    expect(legacyMigration).not.toContain("p.finished_good_id=p_finished_good)");
  });

  it("derives QC requirement from the pinned SOP before classifying evidence", () => {
    expect(workflowMigration).toContain("step.sop_id = production.production_sop_id");
    expect(workflowMigration).toContain("'no_qc_required'");
    expect(workflowMigration).toContain("'evidence_unavailable'");
    expect(workflowMigration).toContain("'No QC Required'");
  });

  it("keeps Role Settings as the sole Production verification authority", () => {
    expect(workflowMigration).toContain("current_user_has_permission('factory_production.verify')");
    expect(workflowMigration).not.toContain("Completed By cannot verify");
    expect(workflowMigration).toContain("where id = v_production.id");
  });
});
