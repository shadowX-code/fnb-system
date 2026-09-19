import { describe, expect, it } from "vitest";
import {
  ASSET_CREATE_UNIT_OPTIONS,
  applyAdminAssetCreateContract,
  assetCreateErrorMessage,
  buildCrewAssetCreatePayload,
  validateAssetCreateValues,
} from "../assetCreationContract.js";

describe("Asset creation contract", () => {
  const values = { name: "  QA Blender ", category_id: "cat-1", initial_quantity: "4", unit: "UNIT", asset_code: " QA-1 ", location: " Bar ", description: " Test asset " };

  it("normalizes the same create semantics for Crew and Admin", () => {
    expect(buildCrewAssetCreatePayload(values)).toEqual({ name: "QA Blender", category_id: "cat-1", initial_quantity: 4, unit: "unit", asset_code: "QA-1", location: "Bar", description: "Test asset" });
    expect(applyAdminAssetCreateContract({ ...values, minimum_quantity: 12, remark: "legacy" })).toMatchObject({ current_quantity: 4, minimum_quantity: 0, unit: "unit", remark: "" });
  });

  it("accepts only the shared UOM vocabulary and active categories for new assets", () => {
    expect(ASSET_CREATE_UNIT_OPTIONS.map((option) => option.value)).toEqual(["unit", "piece", "set", "box", "bottle", "pair"]);
    expect(validateAssetCreateValues(values, ["cat-1"])).toBe("");
    expect(validateAssetCreateValues({ ...values, unit: "tray" }, ["cat-1"])).toBe("Choose a supported unit.");
    expect(validateAssetCreateValues({ ...values, category_id: "archived" }, ["cat-1"])).toBe("Choose an active category.");
  });

  it("maps backend failures to stable product copy", () => {
    expect(assetCreateErrorMessage("create", new Error("duplicate key asset code"))).toMatch(/asset code/i);
    expect(assetCreateErrorMessage("photo", new Error("Edge Function returned a non-2xx status code"))).not.toContain("non-2xx");
  });
});
