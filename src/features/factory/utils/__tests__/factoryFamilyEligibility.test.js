import { describe, expect, it } from "vitest";
import { finishedGoodFamiliesWithoutRecords, hasFinishedGoodFamilyRecord } from "../factoryFamilyEligibility.js";

const active = (id) => ({ id, name_en: id, status: "active" });

describe("Factory Finished Good family create eligibility", () => {
  it("keeps only active Finished Goods without an existing family record eligible", () => {
    const families = [active("available"), active("draft"), active("active"), active("archived"), { ...active("inactive"), status: "archived" }];
    const records = [
      { finished_good_id: "draft", status: "draft" },
      { finished_good_id: "active", status: "active" },
      { finished_good_id: "archived", status: "archived" },
    ];

    expect(finishedGoodFamiliesWithoutRecords(families, records).map((family) => family.id)).toEqual(["available"]);
    expect(hasFinishedGoodFamilyRecord(records, "active")).toBe(true);
    expect(hasFinishedGoodFamilyRecord(records, "available")).toBe(false);
  });

  it("retains the selected Finished Good while editing an existing family record", () => {
    const families = [active("existing")];
    expect(finishedGoodFamiliesWithoutRecords(families, [{ finished_good_id: "existing" }], "existing")).toEqual(families);
  });
});
