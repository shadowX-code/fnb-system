import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tables: {}, usageItems: [], usageFailure: null, queries: [], mutations: [], notifications: [] }));

vi.mock("../../../../lib/supabase.ts", () => ({
  supabase: {
    from(table) {
      let projection = "*";
      let selectOptions = {};
      let mutation = "";
      const filters = [];
      const query = {
        select(fields = "*", options = {}) { projection = fields; selectOptions = options; return query; },
        order() { return query; },
        eq(key, value) { filters.push({ key, value }); return query; },
        in(key, values) { filters.push({ key, values }); return query; },
        delete() { mutation = "delete"; return query; },
        async range(start, end) {
          mocks.queries.push({ table, projection, start, end, filters: [...filters] });
          if (table === "inventory_items" && projection === "id,unit" && mocks.usageFailure) {
            return mocks.usageFailure === "error"
              ? { data: null, count: null, error: new Error("Read unavailable") }
              : { data: [], count: 1, error: null };
          }
          const source = table === "inventory_items" && projection === "id,unit" ? mocks.usageItems : (mocks.tables[table] || []);
          const rows = source.filter((row) => filters.every(({ key, value, values }) => values ? values.includes(row[key]) : row[key] === value));
          return { data: rows.slice(start, end + 1), count: rows.length, error: null };
        },
        then(resolve, reject) {
          const rows = (mocks.tables[table] || []).filter((row) => filters.every(({ key, value, values }) => values ? values.includes(row[key]) : row[key] === value));
          if (mutation === "delete") {
            mocks.mutations.push({ table, filters: [...filters] });
            mocks.tables[table] = (mocks.tables[table] || []).filter((row) => !rows.includes(row));
          }
          return Promise.resolve(selectOptions.head
            ? { data: null, count: rows.length, error: null }
            : { data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  },
}));

import InventoryControlPage from "../InventoryControlPage.jsx";

const uomId = "00000000-0000-4000-8000-000000000001";
const categoryId = "00000000-0000-4000-8000-000000000002";
const outletId = "00000000-0000-4000-8000-000000000003";

function mount(permissions = () => true, accessibleOutletIds = [outletId]) {
  render(<InventoryControlPage
    initialTab="master"
    store={{ outlets: [{ id: outletId, name: "QA Outlet" }], suppliers: [] }}
    auth={{ user: { id: "user" }, profile: { id: "employee", role_outlet_access_type: "all" }, accessibleOutletIds, hasPermission: permissions }}
    ui={{ notify: (notification) => mocks.notifications.push(notification) }}
  />);
}

async function openUomSettings() {
  await screen.findByRole("button", { name: "UOM Settings" });
  fireEvent.click(screen.getByRole("button", { name: "UOM Settings" }));
  await screen.findByText("Inventory UOM Settings");
}

beforeEach(() => {
  mocks.tables = {
    inventory_items: [],
    inventory_uoms: [{ id: uomId, code: "kg", display_name: "Kilogram", is_active: true }],
    inventory_categories: [{ id: categoryId, name: "Unused", status: "active" }],
  };
  mocks.usageItems = [];
  mocks.usageFailure = null;
  mocks.queries = [];
  mocks.mutations = [];
  mocks.notifications = [];
});
afterEach(cleanup);

describe("Master Inventory UOM deletion usage guard", () => {
  it("leaves the legacy Stock Check route rendering after Master ownership moves", async () => {
    render(<InventoryControlPage
      initialTab="stock-check"
      store={{ outlets: [{ id: outletId, name: "QA Outlet" }], suppliers: [] }}
      auth={{ user: { id: "user" }, profile: { id: "employee", role_outlet_access_type: "all" }, hasPermission: () => true }}
      ui={{ notify: vi.fn() }}
    />);
    await screen.findByRole("heading", { name: "Stock Check" });
    expect(screen.getByRole("button", { name: /Audit Stock Check/ })).toBeTruthy();
  });

  it("allows an unused UOM to be deleted after a verified complete read", async () => {
    mount();
    await openUomSettings();
    fireEvent.click(screen.getByTitle("Delete UOM"));
    await waitFor(() => expect(mocks.mutations).toContainEqual({ table: "inventory_uoms", filters: [{ key: "id", value: uomId }] }));
    expect(mocks.queries.some((query) => query.table === "inventory_items" && query.projection === "id,unit")).toBe(true);
  });

  it("blocks a UOM used by one item, including a legacy spelling", async () => {
    mocks.usageItems = [{ id: "used-item", unit: "K-G" }];
    mount(() => true, [outletId]);
    await openUomSettings();
    fireEvent.click(screen.getByTitle("Delete UOM"));
    await waitFor(() => expect(mocks.notifications.some((entry) => entry.title === "Cannot delete this UOM")).toBe(true));
    expect(mocks.mutations).toEqual([]);
    expect(mocks.queries.find((query) => query.table === "inventory_items" && query.projection === "id,unit")?.filters).toEqual([]);
  });

  it("finds usage beyond the first capped response", async () => {
    mocks.usageItems = Array.from({ length: 1_200 }, (_, index) => ({ id: `other-${index}`, unit: "pcs" }));
    mocks.usageItems.push({ id: "late-used-item", unit: "kg" });
    mount();
    await openUomSettings();
    fireEvent.click(screen.getByTitle("Delete UOM"));
    await waitFor(() => expect(mocks.notifications.some((entry) => entry.title === "Cannot delete this UOM")).toBe(true));
    expect(mocks.queries.some((query) => query.table === "inventory_items" && query.projection === "id,unit" && query.start === 1_000)).toBe(true);
    expect(mocks.mutations).toEqual([]);
  });

  it.each(["error", "incomplete"])("fails closed when the usage read is %s", async (failure) => {
    mocks.usageFailure = failure;
    mount();
    await openUomSettings();
    fireEvent.click(screen.getByTitle("Delete UOM"));
    await waitFor(() => expect(mocks.notifications.some((entry) => entry.title === "Unable to delete UOM")).toBe(true));
    expect(mocks.mutations).toEqual([]);
  });

  it("retains the Category exact-count deletion path", async () => {
    mount();
    await screen.findByRole("button", { name: "Category Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Category Settings" }));
    await screen.findByText("Inventory Category Settings");
    fireEvent.click(screen.getByTitle("Delete category"));
    await waitFor(() => expect(mocks.mutations.some((entry) => entry.table === "inventory_categories")).toBe(true));
    expect(mocks.queries.some((query) => query.table === "inventory_items" && query.projection === "id,unit")).toBe(false);
  });

  it("does not bypass the existing UOM delete permission", async () => {
    mount((permission) => permission !== "inventory_uoms.delete");
    await openUomSettings();
    fireEvent.click(screen.getByTitle("Delete UOM"));
    expect(mocks.mutations).toEqual([]);
    expect(mocks.queries.some((query) => query.table === "inventory_items" && query.projection === "id,unit")).toBe(false);
  });
});
