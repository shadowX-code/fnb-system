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
      let data = rowsFor(table, filters)[0] || null;
      if (table === "inventory_stock_check_groups" && mutation === "insert") {
        data = { id: ids.createdGroup, ...payload };
        mocks.tables[table].push(data);
      }
      if (table === "inventory_stock_check_groups" && mutation === "update") {
        const current = rowsFor(table, filters)[0] || {};
        data = { ...current, ...payload };
        mocks.tables[table] = mocks.tables[table].map((row) => row.id === data.id ? data : row);
      }
      return { data, error: null };
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
  activeGroup: "00000000-0000-4000-8000-000000000007", inactiveGroup: "00000000-0000-4000-8000-000000000008",
  createdGroup: "00000000-0000-4000-8000-000000000009",
};

const now = "2026-08-10T08:00:00.000Z";
const groupRow = (id, name, status, outletId, frequency = "custom") => ({
  id, outlet_id: outletId, name, description: `${name} description`, shift: "Opening", frequency_type: frequency,
  frequency_days: frequency === "custom" ? ["Sunday"] : [], schedule_config: { monthDay: 1, checkDays: frequency === "custom" ? ["Sunday"] : [], assignedStaff: "" },
  status, created_at: now, updated_at: now,
});

function seed() {
  mocks.tables = {
    inventory_items: [
      { id: ids.itemA, item_name: "Dried Chilli", sku_code: "RM-CHILLI", category_id: ids.categoryA, unit: "kg", status: "active" },
      { id: ids.itemB, item_name: "Paper Bowl", sku_code: "PK-BOWL", category_id: ids.categoryB, unit: "pcs", status: "active" },
    ],
    inventory_categories: [
      { id: ids.categoryA, name: "Raw Materials", status: "active", sort_order: 1 },
      { id: ids.categoryB, name: "Packaging", status: "active", sort_order: 2 },
    ],
    inventory_uoms: [],
    inventory_item_outlets: [
      { id: "item-a-link", inventory_item_id: ids.itemA, outlet_id: ids.outletA, is_active: true, outlets: { id: ids.outletA, name: "KL Central", code: "KLC" } },
      { id: "item-b-link", inventory_item_id: ids.itemB, outlet_id: ids.outletB, is_active: true, outlets: { id: ids.outletB, name: "PJ Hub", code: "PJH" } },
    ],
    inventory_item_outlet_suppliers: [],
    inventory_stock_check_groups: [
      groupRow(ids.activeGroup, "Morning Produce Count", "active", ids.outletA),
      groupRow(ids.inactiveGroup, "Legacy Packaging Count", "inactive", ids.outletB, "monthly"),
    ],
    inventory_stock_check_group_categories: [
      { group_id: ids.activeGroup, category_id: ids.categoryA },
      { group_id: ids.inactiveGroup, category_id: ids.categoryB },
    ],
    inventory_stock_checks: [{ id: "00000000-0000-4000-8000-000000000010", group_id: ids.activeGroup, outlet_id: ids.outletA, stock_check_type: "scheduled", check_date: "2026-08-10", shift: "Opening", status: "submitted", created_at: now, submitted_at: now }],
    inventory_stock_check_items: [],
    inventory_purchase_orders: [], inventory_purchase_order_items: [], inventory_purchase_receipts: [], inventory_purchase_receipt_items: [],
    inventory_movements: [], inventory_waste_records: [], inventory_menu_categories: [], inventory_recipes: [], inventory_recipe_items: [], employees: [], product_recipe_mappings: [],
  };
}

const groupPermissions = ["inventory_stock_check.view", "inventory_groups.create", "inventory_groups.edit"];
function mount(granted = groupPermissions) {
  render(<InventoryControlPage
    initialTab="groups"
    store={{ outlets: [{ id: ids.outletA, name: "KL Central", code: "KLC" }, { id: ids.outletB, name: "PJ Hub", code: "PJH" }], suppliers: [] }}
    auth={{ user: { id: "user" }, profile: { id: "employee", role_outlet_access_type: "all" }, hasPermission: (key) => granted.includes(key) }}
    ui={{ notify: (entry) => mocks.notifications.push(entry) }}
  />);
}

const groupWrites = (kind) => mocks.operations.filter((entry) => entry.table === "inventory_stock_check_groups" && entry.kind === kind);
const masterReads = () => mocks.from.mock.calls.filter(([table]) => table === "inventory_items").length;
async function ready() { await screen.findByText("Morning Produce Count"); }
async function dialog(title) { return (await screen.findByRole("heading", { name: title })).closest(".fixed"); }
function groupCard(name) { return screen.getByText(name).closest(".rounded-2xl.border"); }
async function choose(label, option) { fireEvent.click(screen.getByRole("button", { name: label })); fireEvent.click(await screen.findByRole("button", { name: option })); }

beforeEach(() => { seed(); mocks.operations.length = 0; mocks.notifications.length = 0; mocks.singleResponses = {}; mocks.from.mockClear(); });
afterEach(cleanup);

describe("InventoryControlPage Groups lifecycle", () => {
  it("renders non-empty Groups data with outlet, category, membership, schedule, and status presentation", async () => {
    mount(); await ready();
    expect(screen.getByText("KL Central · Opening · Last checked Never")).toBeTruthy();
    expect(screen.getByText("Raw Materials")).toBeTruthy();
    expect(within(groupCard("Morning Produce Count")).getByText("1 items")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Legacy Packaging Count")).toBeTruthy();
    expect(screen.queryByText("No inventory alerts")).toBeNull();
  });

  it("applies current search, outlet, status, and frequency filters", async () => {
    mount(); await ready();
    fireEvent.change(screen.getByPlaceholderText("Search group or category"), { target: { value: "Legacy" } });
    expect(screen.queryByText("Morning Produce Count")).toBeNull();
    expect(screen.getByText("Legacy Packaging Count")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search group or category"), { target: { value: "" } });
    await choose("All Outlets", "KL Central");
    expect(screen.getByText("Morning Produce Count")).toBeTruthy();
    expect(screen.queryByText("Legacy Packaging Count")).toBeNull();
    await choose("All Status", "Active");
    expect(screen.getByText("Morning Produce Count")).toBeTruthy();
    await choose("All Frequency", "Custom");
    expect(screen.getByText("Morning Produce Count")).toBeTruthy();
  });

  it("creates a Group through one parent persistence path, refresh, notification, and close", async () => {
    mount(); await ready(); await choose("All Outlets", "KL Central");
    const readsBefore = masterReads();
    fireEvent.click(screen.getByRole("button", { name: "Add Group" }));
    const modal = await dialog("Add Stock Check Group");
    fireEvent.change(within(modal).getByPlaceholderText("Kitchen Daily"), { target: { value: "Kitchen Daily" } });
    fireEvent.click(within(modal).getByRole("button", { name: /Raw Materials/ }));
    fireEvent.click(within(modal).getByRole("button", { name: "Save Group" }));
    await waitFor(() => expect(groupWrites("insert")).toHaveLength(1));
    expect(groupWrites("insert")[0].payload).toEqual(expect.objectContaining({ outlet_id: ids.outletA, name: "Kitchen Daily", frequency_type: "custom", shift: "Closing", status: "active" }));
    expect(mocks.operations.filter((entry) => entry.table === "inventory_stock_check_group_categories" && entry.kind === "insert")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add Stock Check Group" })).toBeNull());
    expect(masterReads()).toBe(readsBefore + 1);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Stock check group saved" }));
  });

  it("edits the mounted Group with populated category and schedule values", async () => {
    mount(); await ready(); const readsBefore = masterReads();
    fireEvent.click(within(groupCard("Morning Produce Count")).getByRole("button", { name: "Edit" }));
    const modal = await dialog("Edit Stock Check Group");
    expect(within(modal).getByDisplayValue("Morning Produce Count")).toBeTruthy();
    expect(within(modal).getByText("1 selected")).toBeTruthy();
    expect(within(modal).getByRole("button", { name: /Raw Materials/ })).toBeTruthy();
    fireEvent.change(within(modal).getByDisplayValue("Morning Produce Count"), { target: { value: "Morning Produce Revised" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Save Group" }));
    await waitFor(() => expect(groupWrites("update")).toHaveLength(1));
    expect(groupWrites("update")[0].payload).toEqual(expect.objectContaining({ name: "Morning Produce Revised", outlet_id: ids.outletA, frequency_type: "custom", frequency_days: ["Sunday"] }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Stock Check Group" })).toBeNull());
    expect(masterReads()).toBe(readsBefore + 1);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Stock check group saved" }));
  });

  it("duplicates through the current prefilled draft-modal flow instead of persisting immediately", async () => {
    mount(); await ready();
    fireEvent.click(within(groupCard("Morning Produce Count")).getByRole("button", { name: "Duplicate" }));
    const modal = await dialog("Edit Stock Check Group");
    expect(within(modal).getByDisplayValue("Morning Produce Count Copy")).toBeTruthy();
    expect(groupWrites("insert")).toHaveLength(0);
    fireEvent.click(within(modal).getByRole("button", { name: "Save Group" }));
    await waitFor(() => expect(groupWrites("insert")).toHaveLength(1));
  });

  it("archives an active Group through one parent mutation, refresh, notification, and inactive update", async () => {
    mount(); await ready(); const readsBefore = masterReads();
    fireEvent.click(within(groupCard("Morning Produce Count")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(groupWrites("update")).toHaveLength(1));
    expect(groupWrites("update")[0].payload).toEqual(expect.objectContaining({ status: "inactive" }));
    expect(masterReads()).toBe(readsBefore + 1);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Stock check group archived" }));
    await waitFor(() => expect(within(groupCard("Morning Produce Count")).getByText("Inactive")).toBeTruthy());
  });

  it("keeps a failed Group save modal open and permits a successful retry without a false refresh", async () => {
    mount(); await ready(); await choose("All Outlets", "KL Central");
    mocks.singleResponses.inventory_stock_check_groups = [{ data: null, error: new Error("group rejected") }];
    const readsBefore = masterReads();
    fireEvent.click(screen.getByRole("button", { name: "Add Group" }));
    const modal = await dialog("Add Stock Check Group");
    fireEvent.change(within(modal).getByPlaceholderText("Kitchen Daily"), { target: { value: "Retry Group" } });
    fireEvent.click(within(modal).getByRole("button", { name: /Raw Materials/ }));
    fireEvent.click(within(modal).getByRole("button", { name: "Save Group" }));
    await waitFor(() => expect(groupWrites("insert")).toHaveLength(1));
    expect(screen.getByRole("heading", { name: "Add Stock Check Group" })).toBeTruthy();
    expect(masterReads()).toBe(readsBefore);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Unable to save stock check group", tone: "error" }));
    fireEvent.click(within(modal).getByRole("button", { name: "Save Group" }));
    await waitFor(() => expect(groupWrites("insert")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add Stock Check Group" })).toBeNull());
  });

  it("keeps a failed archive visible for retry without a false refresh", async () => {
    mount(); await ready();
    mocks.singleResponses.inventory_stock_check_groups = [{ data: null, error: new Error("archive rejected") }];
    const readsBefore = masterReads();
    const archive = within(groupCard("Morning Produce Count")).getByRole("button", { name: "Archive" });
    fireEvent.click(archive);
    await waitFor(() => expect(groupWrites("update")).toHaveLength(1));
    expect(masterReads()).toBe(readsBefore);
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Unable to archive stock check group", tone: "error" }));
    expect(within(groupCard("Morning Produce Count")).getByRole("button", { name: "Archive" })).toBeTruthy();
    fireEvent.click(within(groupCard("Morning Produce Count")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(groupWrites("update")).toHaveLength(2));
    expect(mocks.notifications).toContainEqual(expect.objectContaining({ title: "Stock check group archived" }));
  });

  it("keeps protected create, edit, duplicate, and archive callbacks inert without Groups permissions", async () => {
    mount(["inventory_stock_check.view"]); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add Group" }));
    const card = groupCard("Morning Produce Count");
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(card).getByRole("button", { name: "Duplicate" }));
    fireEvent.click(within(card).getByRole("button", { name: "Archive" }));
    expect(screen.queryByText("Add Stock Check Group", { exact: true })).toBeNull();
    expect(screen.queryByText("Edit Stock Check Group", { exact: true })).toBeNull();
    expect(groupWrites("insert")).toHaveLength(0);
    expect(groupWrites("update")).toHaveLength(0);
  });
});
