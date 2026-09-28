import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), existingLinks: [], savedConfigs: [], operations: [], failUpsert: false }));
vi.mock("../../../../../services/inventoryCompleteRead.js", () => ({ readCompleteInventoryRows: mocks.read }));
vi.mock("../../../../../lib/supabase.ts", () => ({
  supabase: {
    from(table) {
      let action = "read";
      let payload;
      let selection = "";
      let id = "";
      const query = {
        update(value) { action = "update"; payload = value; return query; },
        insert(value) { action = "insert"; payload = value; return query; },
        delete() { action = "delete"; return query; },
        upsert(value) { action = "upsert"; payload = value; return query; },
        select(value) { selection = value; return query; },
        eq(column, value) { if (column === "id") id = value; return query; },
        in() { return query; },
        async single() {
          mocks.operations.push({ table, action, payload, id });
          return { data: { id, ...payload }, error: null };
        },
        then(resolve, reject) {
          mocks.operations.push({ table, action, payload, selection });
          const data = selection === "id,outlet_id" ? mocks.existingLinks : selection.startsWith("*") ? mocks.savedConfigs : [];
          return Promise.resolve({ data, error: action === "upsert" && mocks.failUpsert ? new Error("link write failed") : null }).then(resolve, reject);
        },
      };
      return query;
    },
  },
}));

import { loadInventoryMaster, persistRemoteInventoryItem } from "../inventoryMasterService.js";

const itemId = "00000000-0000-4000-8000-000000000001";
const outletA = "00000000-0000-4000-8000-000000000002";
const outletB = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  mocks.read.mockReset();
  mocks.read.mockImplementation(async () => ({ data: [], count: 0, completeness: "complete" }));
  mocks.existingLinks = [];
  mocks.savedConfigs = [];
  mocks.operations = [];
  mocks.failUpsert = false;
});

describe("Master Inventory read and item persistence boundary", () => {
  it("loads only its five complete catalog/configuration collections", async () => {
    const result = await loadInventoryMaster();
    expect(mocks.read.mock.calls.map(([table]) => table)).toEqual([
      "inventory_items", "inventory_categories", "inventory_uoms", "inventory_item_outlets", "inventory_item_outlet_suppliers",
    ]);
    expect(result).toMatchObject({ items: [], categories: [], uoms: [], rawItemCount: 0, outletLinkCount: 0 });
  });

  it("never turns an incomplete collection into an authoritative empty catalog", async () => {
    mocks.read.mockImplementation(async (table) => {
      if (table === "inventory_item_outlets") throw Object.assign(new Error("capped"), { readState: "incomplete" });
      return { data: [], count: 0, completeness: "complete" };
    });
    await expect(loadInventoryMaster()).rejects.toMatchObject({ readState: "incomplete" });
  });

  it("preserves out-of-scope outlet links on an item edit", async () => {
    mocks.existingLinks = [{ id: "link-a", outlet_id: outletA }, { id: "link-b", outlet_id: outletB }];
    mocks.savedConfigs = [
      { id: "link-a", inventory_item_id: itemId, outlet_id: outletA, par_level: 1 },
      { id: "link-b", inventory_item_id: itemId, outlet_id: outletB, par_level: 2 },
    ];
    const saved = await persistRemoteInventoryItem({ id: itemId, name: "QA Item", unit: "kg", linkedOutletIds: [outletA], outletConfigs: [{ outletId: outletA, parLevel: 1 }] }, "qa-user", [outletA]);
    expect(mocks.operations.some(operation => operation.action === "delete")).toBe(false);
    expect(mocks.operations.find(operation => operation.action === "upsert")?.payload).toMatchObject([{ inventory_item_id: itemId, outlet_id: outletA }]);
    expect(saved.linkedOutletIds).toEqual([outletA, outletB]);
  });

  it("reports item-saved/link-failed as a partial failure, not success", async () => {
    mocks.failUpsert = true;
    await expect(persistRemoteInventoryItem({ id: itemId, name: "QA Item", unit: "kg", linkedOutletIds: [outletA], outletConfigs: [{ outletId: outletA, parLevel: 1 }] }, "qa-user", [outletA]))
      .rejects.toMatchObject({ partialItemSaved: true });
    expect(mocks.operations.some(operation => operation.table === "inventory_items" && operation.action === "update")).toBe(true);
  });
});
