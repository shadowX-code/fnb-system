import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tables: {}, operations: [], notifications: [], singleResponses: {}, from: vi.fn() }));

vi.mock("../../../../lib/supabase.ts", () => {
  const rowsFor = (table, filters = []) => (mocks.tables[table] || []).filter((row) => filters.every(({ key, value }) => String(row[key]) === String(value)));
  const from = (table) => {
    const filters = [];
    const builder = {};
    let mutation = "";
    let payload;
    builder.select = vi.fn(() => builder);
    builder.upsert = vi.fn((next) => { mutation = "upsert"; payload = next; mocks.operations.push({ table, kind: mutation, payload }); return builder; });
    builder.insert = vi.fn((next) => { mutation = "insert"; payload = next; mocks.operations.push({ table, kind: mutation, payload }); return builder; });
    builder.update = vi.fn((next) => { mutation = "update"; payload = next; mocks.operations.push({ table, kind: mutation, payload }); return builder; });
    builder.delete = vi.fn(() => { mutation = "delete"; mocks.operations.push({ table, kind: mutation }); return builder; });
    builder.eq = vi.fn((key, value) => { filters.push({ key, value }); return builder; });
    builder.in = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.ilike = vi.fn(() => builder);
    builder.single = vi.fn(async () => {
      const queued = mocks.singleResponses[table]?.shift();
      if (queued) return queued;
      if (table === "inventory_item_outlets" && mutation === "upsert") {
        const existing = mocks.tables[table].find((row) => row.inventory_item_id === payload.inventory_item_id && row.outlet_id === payload.outlet_id);
        const data = { ...(existing || { id: `config-${payload.inventory_item_id.slice(-4)}-${payload.outlet_id.slice(-4)}`, outlets: mocks.tables.outletsById?.[payload.outlet_id] }), ...payload };
        if (existing) Object.assign(existing, data);
        else mocks.tables[table].push(data);
        return { data, error: null };
      }
      return { data: rowsFor(table, filters)[0] || null, error: null };
    });
    builder.then = (resolve, reject) => Promise.resolve({ data: rowsFor(table, filters), error: null }).then(resolve, reject);
    return builder;
  };
  mocks.from.mockImplementation(from);
  return { supabase: { from: mocks.from } };
});

vi.mock("../../../../services/productAnalyticsService.js", () => ({ productAnalyticsService: { listReports: vi.fn().mockResolvedValue([]), listItemsByReportIds: vi.fn().mockResolvedValue([]) } }));
vi.mock("../../../../services/auditLogService.js", () => ({ auditLogService: { createAuditLog: vi.fn().mockResolvedValue(undefined) } }));

import InventoryControlPage from "../InventoryControlPage.jsx";

const ids = {
  outletA: "00000000-0000-4000-8000-000000000001", outletB: "00000000-0000-4000-8000-000000000002",
  categoryA: "00000000-0000-4000-8000-000000000003", categoryB: "00000000-0000-4000-8000-000000000004",
  itemA: "00000000-0000-4000-8000-000000000005", itemB: "00000000-0000-4000-8000-000000000006",
  supplierA: "00000000-0000-4000-8000-000000000007", supplierB: "00000000-0000-4000-8000-000000000008",
};

function seed() {
  mocks.tables = {
    outletsById: { [ids.outletA]: { id: ids.outletA, name: "KL Central", code: "KLC" }, [ids.outletB]: { id: ids.outletB, name: "PJ Hub", code: "PJH" } },
    inventory_items: [
      { id: ids.itemA, item_name: "Dried Chilli", sku_code: "RM-CHILLI", category_id: ids.categoryA, unit: "kg", status: "active" },
      { id: ids.itemB, item_name: "Paper Bowl", sku_code: "PK-BOWL", category_id: ids.categoryB, unit: "pcs", status: "active" },
    ],
    inventory_categories: [{ id: ids.categoryA, name: "Raw Materials", status: "active", sort_order: 1 }, { id: ids.categoryB, name: "Packaging", status: "active", sort_order: 2 }],
    inventory_uoms: [],
    inventory_item_outlets: [
      { id: "config-a-kl", inventory_item_id: ids.itemA, outlet_id: ids.outletA, par_level: 12, storage_location: "Dry Store", is_active: true, outlets: { id: ids.outletA, name: "KL Central", code: "KLC" } },
      { id: "config-a-pj", inventory_item_id: ids.itemA, outlet_id: ids.outletB, par_level: 8, storage_location: "Shelf B", is_active: true, outlets: { id: ids.outletB, name: "PJ Hub", code: "PJH" } },
      { id: "config-b-kl", inventory_item_id: ids.itemB, outlet_id: ids.outletA, par_level: null, storage_location: "", is_active: true, outlets: { id: ids.outletA, name: "KL Central", code: "KLC" } },
    ],
    inventory_item_outlet_suppliers: [{ inventory_item_outlet_id: "config-a-kl", supplier_id: ids.supplierA }],
    inventory_stock_check_groups: [], inventory_stock_check_group_categories: [], inventory_stock_checks: [], inventory_stock_check_items: [],
    inventory_purchase_orders: [], inventory_purchase_order_items: [], inventory_purchase_receipts: [], inventory_purchase_receipt_items: [],
    inventory_movements: [], inventory_waste_records: [], inventory_menu_categories: [], inventory_recipes: [], inventory_recipe_items: [], employees: [], product_recipe_mappings: [],
  };
}

const editPermission = ["inventory_par_levels.edit"];
function mount(granted = editPermission) {
  render(<InventoryControlPage
    initialTab="par-levels"
    store={{ outlets: [{ id: ids.outletA, name: "KL Central", code: "KLC" }, { id: ids.outletB, name: "PJ Hub", code: "PJH" }], suppliers: [{ id: ids.supplierA, name: "Chilli Supplier", status: "active", outletIds: [ids.outletA] }, { id: ids.supplierB, name: "Backup Supplier", status: "active", outletIds: [ids.outletA] }] }}
    auth={{ user: { id: "user" }, profile: { id: "employee", role_outlet_access_type: "all" }, hasPermission: (key) => granted.includes(key) }}
    ui={{ notify: (entry) => mocks.notifications.push(entry) }}
  />);
}

const configWrites = () => mocks.operations.filter((entry) => entry.table === "inventory_item_outlets" && entry.kind === "upsert");
const itemReads = () => mocks.from.mock.calls.filter(([table]) => table === "inventory_items").length;
async function ready() { await screen.findByText("Dried Chilli"); }
async function choose(label, option) { fireEvent.click(screen.getByRole("button", { name: label })); fireEvent.click(await screen.findByRole("button", { name: option })); }
function gridInput(row, field) { return document.querySelector(`[data-grid-row="${row}"][data-grid-field="${field}"]`); }
function matrixInput(row, column) { return document.querySelector(`[data-matrix-row="${row}"][data-matrix-column="${column}"]`); }
function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

const offsetParentDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeEach(() => {
  seed(); mocks.operations.length = 0; mocks.notifications.length = 0; mocks.singleResponses = {}; mocks.from.mockClear();
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentElement || document.body; } });
});
afterEach(() => { cleanup(); if (offsetParentDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParentDescriptor); });

describe("InventoryControlPage Par Levels interaction contract", () => {
  it("renders the current outlet mode with configured and unconfigured normalized item configs", async () => {
    mount(); await ready();
    expect(screen.getByText("KL Central Par Levels")).toBeTruthy();
    expect(screen.getByText("Dried Chilli")).toBeTruthy();
    expect(screen.getByText("RM-CHILLI · Raw Materials")).toBeTruthy();
    expect(screen.getByText("Paper Bowl")).toBeTruthy();
    expect(gridInput(0, "par").value).toBe("12");
    expect(gridInput(1, "par").value).toBe("");
    expect(screen.getByRole("button", { name: "Chilli Supplier" })).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("renders and edits the matrix with exact item/outlet config identity", async () => {
    mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Matrix View" }));
    await screen.findByText("Par Level Matrix");
    expect(screen.getByTitle("KL Central")).toBeTruthy();
    expect(screen.getByTitle("PJ Hub")).toBeTruthy();
    expect(matrixInput(0, 0).value).toBe("12");
    expect(matrixInput(0, 1).value).toBe("8");
    expect(matrixInput(1, 0).value).toBe("");
    expect(screen.getByTitle("Paper Bowl is not linked to PJ Hub")).toBeTruthy();
    matrixInput(0, 0).focus();
    fireEvent.keyDown(matrixInput(0, 0), { key: "ArrowRight" });
    expect(document.activeElement).toBe(matrixInput(0, 1));
    fireEvent.change(matrixInput(0, 1), { target: { value: "9" } });
    await waitFor(() => expect(configWrites()).toHaveLength(1));
    expect(configWrites()[0].payload).toEqual(expect.objectContaining({ inventory_item_id: ids.itemA, outlet_id: ids.outletB, par_level: 9, storage_location: "Shelf B" }));
  });

  it("persists one outlet par field locally without a broad refresh or success notification", async () => {
    mount(); await ready(); const readsBefore = itemReads();
    fireEvent.change(gridInput(0, "par"), { target: { value: "15" } });
    await waitFor(() => expect(configWrites()).toHaveLength(1));
    expect(configWrites()[0].payload).toEqual(expect.objectContaining({ inventory_item_id: ids.itemA, outlet_id: ids.outletA, par_level: 15, storage_location: "Dry Store" }));
    await waitFor(() => expect(gridInput(0, "par").value).toBe("15"));
    expect(itemReads()).toBe(readsBefore);
    expect(mocks.notifications).toHaveLength(0);
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("persists supplier assignment against the exact item/outlet config and supports clearing", async () => {
    mount(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Chilli Supplier" }));
    const picker = await screen.findByText("Assign suppliers");
    const layer = picker.parentElement.parentElement;
    fireEvent.click(within(layer).getByRole("checkbox", { name: "Chilli Supplier" }));
    fireEvent.click(within(layer).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(configWrites()).toHaveLength(1));
    expect(configWrites()[0].payload).toEqual(expect.objectContaining({ inventory_item_id: ids.itemA, outlet_id: ids.outletA, par_level: 12 }));
    expect(mocks.operations.filter((entry) => entry.table === "inventory_item_outlet_suppliers" && entry.kind === "delete")).toHaveLength(1);
    expect(mocks.operations.filter((entry) => entry.table === "inventory_item_outlet_suppliers" && entry.kind === "insert")).toHaveLength(0);
  });

  it("preserves outlet-grid Tab and Enter navigation plus category collapse", async () => {
    mount(); await ready();
    const firstPar = gridInput(0, "par"); const firstStorage = gridInput(0, "storage"); const secondPar = gridInput(1, "par");
    firstPar.focus(); fireEvent.keyDown(firstPar, { key: "Tab" }); expect(document.activeElement).toBe(firstStorage);
    firstPar.focus(); fireEvent.keyDown(firstPar, { key: "Enter" }); expect(document.activeElement).toBe(secondPar);
    fireEvent.click(screen.getByRole("button", { name: /Raw Materials/ }));
    expect(screen.queryByText("Dried Chilli")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Raw Materials/ }));
    expect(screen.getByText("Dried Chilli")).toBeTruthy();
  });

  it("recovers from a rejected par save without false success and permits retry", async () => {
    mocks.singleResponses.inventory_item_outlets = [{ data: null, error: new Error("par rejected") }];
    mount(); await ready(); const readsBefore = itemReads();
    fireEvent.change(gridInput(0, "par"), { target: { value: "18" } });
    await waitFor(() => expect(configWrites()).toHaveLength(1));
    expect(screen.getByText("Save failed")).toBeTruthy();
    expect(gridInput(0, "par").value).toBe("12");
    expect(itemReads()).toBe(readsBefore);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Unable to save Par Level", tone: "error" }));
    fireEvent.change(gridInput(0, "par"), { target: { value: "18" } });
    await waitFor(() => expect(configWrites()).toHaveLength(2));
    await waitFor(() => expect(gridInput(0, "par").value).toBe("18"));
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("keeps the latest same-config save when an earlier response resolves late", async () => {
    const first = deferred(); const second = deferred();
    mocks.singleResponses.inventory_item_outlets = [first.promise, second.promise];
    mount(); await ready();
    fireEvent.change(gridInput(0, "par"), { target: { value: "13" } });
    fireEvent.change(gridInput(0, "par"), { target: { value: "14" } });
    await waitFor(() => expect(configWrites()).toHaveLength(2));
    expect(configWrites().map((entry) => entry.payload.par_level)).toEqual([13, 14]);
    second.resolve({ data: { ...mocks.tables.inventory_item_outlets[0], par_level: 14, updated_at: "2026-08-10T00:00:14.000Z" }, error: null });
    await waitFor(() => expect(gridInput(0, "par").value).toBe("14"));
    first.resolve({ data: { ...mocks.tables.inventory_item_outlets[0], par_level: 13, updated_at: "2026-08-10T00:00:13.000Z" }, error: null });
    await waitFor(() => expect(gridInput(0, "par").value).toBe("14"));
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(mocks.notifications).toHaveLength(0);
  });

  it("merges rapid same-config par and storage intents before persistence", async () => {
    const first = deferred(); const second = deferred();
    mocks.singleResponses.inventory_item_outlets = [first.promise, second.promise];
    mount(); await ready();
    fireEvent.change(gridInput(0, "par"), { target: { value: "13" } });
    fireEvent.change(gridInput(0, "storage"), { target: { value: "Rack B" } });
    await waitFor(() => expect(configWrites()).toHaveLength(2));
    expect(configWrites()[1].payload).toEqual(expect.objectContaining({
      inventory_item_id: ids.itemA,
      outlet_id: ids.outletA,
      par_level: 13,
      storage_location: "Rack B",
    }));
    second.resolve({ data: { ...mocks.tables.inventory_item_outlets[0], par_level: 13, storage_location: "Rack B", updated_at: "2026-08-10T00:00:14.000Z" }, error: null });
    await waitFor(() => expect(gridInput(0, "storage").value).toBe("Rack B"));
    first.resolve({ data: { ...mocks.tables.inventory_item_outlets[0], par_level: 13, storage_location: "Dry Store", updated_at: "2026-08-10T00:00:13.000Z" }, error: null });
    await waitFor(() => expect(gridInput(0, "par").value).toBe("13"));
    expect(gridInput(0, "storage").value).toBe("Rack B");
  });

  it("suppresses a stale failed save after a newer same-config success", async () => {
    const first = deferred(); const second = deferred();
    mocks.singleResponses.inventory_item_outlets = [first.promise, second.promise];
    mount(); await ready();
    fireEvent.change(gridInput(0, "par"), { target: { value: "13" } });
    fireEvent.change(gridInput(0, "par"), { target: { value: "14" } });
    await waitFor(() => expect(configWrites()).toHaveLength(2));
    second.resolve({ data: { ...mocks.tables.inventory_item_outlets[0], par_level: 14, updated_at: "2026-08-10T00:00:14.000Z" }, error: null });
    await waitFor(() => expect(gridInput(0, "par").value).toBe("14"));
    first.resolve({ data: null, error: new Error("stale par rejected") });
    await waitFor(() => expect(gridInput(0, "par").value).toBe("14"));
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(mocks.notifications).toHaveLength(0);
  });

  it("allows different item/outlet config saves to persist concurrently", async () => {
    const first = deferred(); const second = deferred();
    mocks.singleResponses.inventory_item_outlets = [first.promise, second.promise];
    mount(); await ready();
    fireEvent.change(gridInput(0, "par"), { target: { value: "13" } });
    fireEvent.change(gridInput(1, "par"), { target: { value: "4" } });
    await waitFor(() => expect(configWrites()).toHaveLength(2));
    expect(configWrites().map((entry) => [entry.payload.inventory_item_id, entry.payload.outlet_id])).toEqual([
      [ids.itemA, ids.outletA], [ids.itemB, ids.outletA],
    ]);
    second.resolve({ data: { ...mocks.tables.inventory_item_outlets[2], par_level: 4, updated_at: "2026-08-10T00:00:04.000Z" }, error: null });
    first.resolve({ data: { ...mocks.tables.inventory_item_outlets[0], par_level: 13, updated_at: "2026-08-10T00:00:13.000Z" }, error: null });
    await waitFor(() => expect(gridInput(0, "par").value).toBe("13"));
    await waitFor(() => expect(gridInput(1, "par").value).toBe("4"));
  });

  it("keeps view-only Par Levels visible while disabling every mutation entry point", async () => {
    mount([]); await ready();
    expect(gridInput(0, "par").disabled).toBe(true);
    expect(gridInput(0, "storage").disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Chilli Supplier" }).disabled).toBe(true);
    fireEvent.change(gridInput(0, "par"), { target: { value: "16" } });
    expect(configWrites()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Matrix View" }));
    await screen.findByText("Par Level Matrix");
    expect(matrixInput(0, 0).disabled).toBe(true);
    expect(configWrites()).toHaveLength(0);
    expect(screen.getByText("Dried Chilli")).toBeTruthy();
  });
});
