import { describe, expect, it } from "vitest";
import { buildRawMaterialImportPreview, parseRawMaterialCsv } from "../FactoryRawMaterialImportModal.jsx";

const masters = { rawMaterials: [{ material_code: "EXISTING" }], categories: [{ id: "cat-1", name: "Spices", status: "active" }], storageLocations: [{ id: "loc-1", location_name: "Dry Store", status: "active" }] };

describe("Factory raw material import preview", () => {
  it("parses CSV and prepares a canonical create payload", () => {
    const rows = parseRawMaterialCsv("Raw Material Name,Code,Category,UOM,Initial Cost,Minimum Stock,Storage Location,Status\nChili,RAW-001,Spices,kg,12.5,5,Dry Store,Active");
    const preview = buildRawMaterialImportPreview(rows, masters);
    expect(preview[0]).toMatchObject({ errors: [], material: { material_code: "RAW-001", category_id: "cat-1", storage_location_id: "loc-1", manual_unit_cost: 12.5, min_stock_level: 5 } });
  });

  it("blocks missing fields, duplicate codes, and invalid master references without creating related masters", () => {
    const preview = buildRawMaterialImportPreview([{ __row: 2, "Raw Material Name": "", Code: "EXISTING", Category: "Unknown", UOM: "box", "Initial Cost": "bad", "Minimum Stock": "-1", "Storage Location": "Unknown", Status: "bad" }], masters);
    expect(preview[0].errors.join(" ")).toMatch(/required|already exists|Category|UOM|Cost|Minimum Stock|Storage Location|Status/i);
  });

  it("blocks file-internal duplicate codes", () => {
    const preview = buildRawMaterialImportPreview([{ __row: 2, "Raw Material Name": "A", Code: "RAW-1", Category: "Spices", UOM: "kg" }, { __row: 3, "Raw Material Name": "B", Code: "raw-1", Category: "Spices", UOM: "kg" }], masters);
    expect(preview.every((row) => row.errors.includes("Duplicate Code in file."))).toBe(true);
  });
});
