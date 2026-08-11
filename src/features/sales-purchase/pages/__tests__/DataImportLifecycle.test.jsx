import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  imports: {
    listImportBatches: vi.fn(), detectSalesConflicts: vi.fn(), detectPurchaseConflicts: vi.fn(), preparePurchaseMasters: vi.fn(), importSales: vi.fn(), importPurchases: vi.fn(),
  },
}));

vi.mock("../../../../services/importService.js", () => ({ importService: mocks.imports }));

import { DataImportWorkspace } from "../DataImportPage.jsx";

const salesRecord = {
  id: "sales-1", sourceRow: 2, outlet_id: "outlet-1", outletCode: "KLC", outletName: "KL Central",
  year: 2026, month: 8, channel_id: "channel-1", channel_name: "Dine In", amount: 1200, remark: "Imported file",
};

const store = {
  outlets: [{ id: "outlet-1", code: "KLC", name: "KL Central" }],
  salesChannels: [{ id: "channel-1", name: "Dine In" }], salesRecords: [], purchaseRecords: [],
  suppliers: [], purchaseCategories: [], employees: [], monthlyLocks: [],
};
const purchaseStore = {
  ...store,
  suppliers: [{ id: "supplier-1", name: "Fresh Foods", outletIds: ["outlet-1"], default_category_id: "category-1" }],
  purchaseCategories: [{ id: "category-1", name: "Produce" }],
};

function auth(permissions = []) {
  return { profile: { id: "employee-1", role_outlet_access_type: "all" }, user: { id: "auth-1" }, hasPermission: (code) => permissions.includes(code) };
}

function mount(permissions = ["sales_input.import"], onImported = vi.fn()) {
  const ui = { notify: vi.fn() };
  const setStore = vi.fn();
  const view = render(<DataImportWorkspace store={store} setStore={setStore} ui={ui} auth={auth(permissions)} fixedImportType="Sales" embedded onImported={onImported} />);
  return { ...view, ui, setStore, onImported };
}

function mountPurchase({ onImported = vi.fn(), permissions = ["purchase_input.import"], dataStore = purchaseStore } = {}) {
  const ui = { notify: vi.fn() };
  const setStore = vi.fn();
  const view = render(<DataImportWorkspace store={dataStore} setStore={setStore} ui={ui} auth={auth(permissions)} fixedImportType="Purchases" embedded onImported={onImported} />);
  return { ...view, ui, setStore, onImported };
}

async function previewPurchaseImport(container, csv, name = "purchases.csv") {
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File([csv], name, { type: "text/csv" })] } });
  await screen.findByText(`${name} · 1 source rows`);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Validate Data" }));
}

async function resolveNewPurchaseMasters() {
  await screen.findByText("Unknown Category Review Required");
  fireEvent.click(screen.getByRole("button", { name: "Map existing" }));
  fireEvent.click(screen.getByRole("button", { name: "Create category" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Unknown Supplier Review Required");
  fireEvent.click(screen.getByRole("button", { name: "Continue to Preview" }));
  await screen.findByText("New record will be created.");
}

async function confirmPurchaseImport() {
  fireEvent.click(screen.getByRole("button", { name: "Continue Import" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));
}

async function previewSalesImport(container) {
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(["Outlet,Month,Year,Dine In\nKLC,Aug,2026,1200"], "sales.csv", { type: "text/csv" })] } });
  await screen.findByText("sales.csv · 1 source rows");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Validate Data" }));
  await screen.findByText("New record will be created.");
}

beforeEach(() => {
  mocks.imports.listImportBatches.mockReset().mockResolvedValue([]);
  mocks.imports.detectSalesConflicts.mockReset().mockResolvedValue(new Map());
  mocks.imports.detectPurchaseConflicts.mockReset().mockResolvedValue(new Map());
  mocks.imports.preparePurchaseMasters.mockReset().mockResolvedValue({ requestId: "request-purchase", categories: {}, suppliers: {} });
  mocks.imports.importSales.mockReset().mockResolvedValue({ savedRows: [salesRecord], batch: { id: "batch-1", import_type: "sales" }, createdCount: 1, updatedCount: 0 });
  mocks.imports.importPurchases.mockReset();
});

afterEach(cleanup);

describe("Data Import mounted lifecycle contracts", () => {
  it("runs the current Sales preview/confirm path once, refreshes local data through its callback, and notifies only after success", async () => {
    const { container, ui, setStore, onImported } = mount();
    await previewSalesImport(container);
    fireEvent.click(screen.getByRole("button", { name: "Continue Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

    await waitFor(() => expect(mocks.imports.importSales).toHaveBeenCalledTimes(1));
    expect(mocks.imports.importSales).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "sales.csv", requestId: expect.any(String), records: [expect.objectContaining({ outlet_id: "outlet-1", year: 2026, month: 8, channel_id: "channel-1", amount: 1200 })],
    }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ batch: expect.objectContaining({ id: "batch-1" }) }), "Sales"));
    expect(setStore).toHaveBeenCalledTimes(1);
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Import completed" }));
    expect(screen.queryByText("Confirm import")).toBeNull();
  });

  it("keeps the import UI retryable and reports no false success when the service rejects", async () => {
    mocks.imports.importSales.mockRejectedValueOnce(new Error("target rejected"));
    const { container, ui, onImported } = mount();
    await previewSalesImport(container);
    fireEvent.click(screen.getByRole("button", { name: "Continue Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

    await waitFor(() => expect(mocks.imports.importSales).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Confirm import")).toBeNull());
    expect(screen.getByRole("button", { name: "Continue Import" }).disabled).toBe(false);
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Import failed", tone: "error" }));
    expect(ui.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import completed" }));
    expect(onImported).not.toHaveBeenCalled();
  });

  it("reports a server-reconciled partial batch truthfully without converting committed successful rows into a client failure", async () => {
    mocks.imports.importSales.mockResolvedValueOnce({ savedRows: [salesRecord], batch: { id: "batch-1", import_type: "sales", status: "partial_failed" }, createdCount: 1, updatedCount: 0, failedCount: 1, outcomes: [{ success: true }, { success: false }] });
    const { container, ui, onImported } = mount();
    await previewSalesImport(container);
    fireEvent.click(screen.getByRole("button", { name: "Continue Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));
    await screen.findByText("Import complete");
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Import partially completed", tone: "warning" }));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ batch: expect.objectContaining({ status: "partial_failed" }) }), "Sales");
  });

  it("runs the current Purchase preview/confirm path with its supplier/category record identity and success refresh", async () => {
    const purchased = { ...salesRecord, id: "purchase-1", supplier_id: "supplier-1", supplier_name: "Fresh Foods", category_id: "category-1", category_name: "Produce", amount: 450, remark: "Invoice 1" };
    mocks.imports.importPurchases.mockResolvedValueOnce({ savedRows: [purchased], batch: { id: "batch-purchase", import_type: "purchase" }, createdCount: 1, updatedCount: 0 });
    const { container, ui, onImported } = mountPurchase();
    await previewPurchaseImport(container, "Outlet,Month,Year,Supplier,Category,Amount,Remark\nKLC,Aug,2026,Fresh Foods,Produce,450,Invoice 1");
    await screen.findByText("New record will be created.");
    fireEvent.click(screen.getByRole("button", { name: "Continue Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

    await waitFor(() => expect(mocks.imports.importPurchases).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "purchases.csv", requestId: expect.any(String), records: [expect.objectContaining({ outlet_id: "outlet-1", supplier_id: "supplier-1", category_id: "category-1", amount: 450 })],
    })));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ batch: expect.objectContaining({ id: "batch-purchase" }) }), "Purchases"));
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Import completed" }));
  });

  it("uses the mounted in-flight guard to prevent rapid repeat confirmation from creating a second service request", async () => {
    let resolveImport;
    mocks.imports.importSales.mockImplementationOnce(() => new Promise((resolve) => { resolveImport = resolve; }));
    const { container } = mount();
    await previewSalesImport(container);
    fireEvent.click(screen.getByRole("button", { name: "Continue Import" }));
    const confirm = screen.getByRole("button", { name: "Confirm Import" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.imports.importSales).toHaveBeenCalledTimes(1));
    resolveImport({ savedRows: [salesRecord], batch: { id: "batch-1", import_type: "sales" }, createdCount: 1, updatedCount: 0 });
    await screen.findByText("Import complete");
    expect(mocks.imports.importSales).toHaveBeenCalledTimes(1);
  });

  it("does not expose a mutation-capable upload path without the exact Sales import permission", async () => {
    const { container, ui } = mount(["sales_input.view"]);
    await screen.findByText(/Read-only access/);
    const upload = screen.getByRole("button", { name: /Upload CSV or XLSX/ });
    expect(upload.disabled).toBe(true);
    const input = container.querySelector('input[type="file"]');
    expect(input.disabled).toBe(false);
    fireEvent.click(upload);
    expect(mocks.imports.detectSalesConflicts).not.toHaveBeenCalled();
    expect(mocks.imports.importSales).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Import completed" }));
  });

  it("prepares new purchase masters once, applies their canonical IDs, and keeps browser master writes out of the import path", async () => {
    const emptyPurchaseStore = { ...store, suppliers: [], purchaseCategories: [] };
    const imported = { ...salesRecord, id: "purchase-new", supplier_id: "supplier-new", supplier_name: "New Supplier", category_id: "category-new", category_name: "New Category", amount: 450 };
    mocks.imports.preparePurchaseMasters.mockResolvedValueOnce({ requestId: "request-new", categories: { "New Category": "category-new" }, suppliers: { "New Supplier": "supplier-new" } });
    mocks.imports.importPurchases.mockResolvedValueOnce({ savedRows: [imported], batch: { id: "batch-new", import_type: "purchase" }, createdCount: 1, updatedCount: 0 });
    const { container, ui, onImported } = mountPurchase({ dataStore: emptyPurchaseStore, permissions: ["purchase_input.import", "purchase_categories.create", "suppliers.create"] });
    await previewPurchaseImport(container, "Outlet,Month,Year,Supplier,Category,Amount,Remark\nKLC,Aug,2026,New Supplier,New Category,450,Invoice");
    await resolveNewPurchaseMasters();
    await confirmPurchaseImport();

    await waitFor(() => expect(mocks.imports.preparePurchaseMasters).toHaveBeenCalledTimes(1));
    const preparation = mocks.imports.preparePurchaseMasters.mock.calls[0][0];
    expect(preparation).toEqual(expect.objectContaining({
      requestId: expect.any(String),
      categories: [{ source_key: "New Category", name: "New Category" }],
      suppliers: [{ source_key: "New Supplier", name: "New Supplier", category_source_key: "New Category", outlet_id: "outlet-1" }],
    }));
    await waitFor(() => expect(mocks.imports.importPurchases).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-new", records: [expect.objectContaining({ supplier_id: "supplier-new", category_id: "category-new" })],
    })));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ batch: expect.objectContaining({ id: "batch-new" }) }), "Purchases");
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Import completed" }));
  });

  it("keeps a rejected preparation retryable with the same logical request and never applies a target row before preparation succeeds", async () => {
    const emptyPurchaseStore = { ...store, suppliers: [], purchaseCategories: [] };
    const imported = { ...salesRecord, id: "purchase-retry", supplier_id: "supplier-new", category_id: "category-new", amount: 450 };
    mocks.imports.preparePurchaseMasters
      .mockRejectedValueOnce(new Error("category permission denied"))
      .mockResolvedValueOnce({ requestId: "request-reused", categories: { "New Category": "category-new" }, suppliers: { "New Supplier": "supplier-new" } });
    mocks.imports.importPurchases.mockResolvedValueOnce({ savedRows: [imported], batch: { id: "batch-retry", import_type: "purchase" }, createdCount: 1, updatedCount: 0 });
    const { container, ui } = mountPurchase({ dataStore: emptyPurchaseStore, permissions: ["purchase_input.import", "purchase_categories.create", "suppliers.create"] });
    await previewPurchaseImport(container, "Outlet,Month,Year,Supplier,Category,Amount,Remark\nKLC,Aug,2026,New Supplier,New Category,450,Invoice");
    await resolveNewPurchaseMasters();
    await confirmPurchaseImport();
    await waitFor(() => expect(mocks.imports.preparePurchaseMasters).toHaveBeenCalledTimes(1));
    expect(mocks.imports.importPurchases).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Import failed", tone: "error" }));
    expect(screen.getByRole("button", { name: "Continue Import" }).disabled).toBe(false);

    await confirmPurchaseImport();
    await waitFor(() => expect(mocks.imports.importPurchases).toHaveBeenCalledTimes(1));
    expect(mocks.imports.preparePurchaseMasters).toHaveBeenCalledTimes(2);
    expect(mocks.imports.preparePurchaseMasters.mock.calls[1][0].requestId).toBe(mocks.imports.preparePurchaseMasters.mock.calls[0][0].requestId);
    expect(mocks.imports.importPurchases).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-reused", records: [expect.objectContaining({ supplier_id: "supplier-new", category_id: "category-new" })] }));
  });

  it("allows existing canonical purchase masters without create permissions and does not duplicate their local reconciliation", async () => {
    const purchased = { ...salesRecord, id: "purchase-existing", supplier_id: "supplier-1", category_id: "category-1", amount: 450 };
    mocks.imports.importPurchases.mockResolvedValueOnce({ savedRows: [purchased], batch: { id: "batch-existing", import_type: "purchase" }, createdCount: 1, updatedCount: 0 });
    const { container, setStore } = mountPurchase({ permissions: ["purchase_input.import"] });
    await previewPurchaseImport(container, "Outlet,Month,Year,Supplier,Category,Amount,Remark\nKLC,Aug,2026,Fresh Foods,Produce,450,Invoice");
    await screen.findByText("New record will be created.");
    await confirmPurchaseImport();
    await waitFor(() => expect(mocks.imports.importPurchases).toHaveBeenCalledTimes(1));
    expect(mocks.imports.preparePurchaseMasters).toHaveBeenCalledWith(expect.objectContaining({ categories: [], suppliers: [] }));
    expect(setStore).toHaveBeenCalledTimes(1);
  });

  it("keeps authoritative Purchase partial completion truthful after preparation without compensating master data", async () => {
    const purchased = { ...salesRecord, id: "purchase-partial", supplier_id: "supplier-1", category_id: "category-1", amount: 450 };
    mocks.imports.importPurchases.mockResolvedValueOnce({ savedRows: [purchased], batch: { id: "batch-partial", import_type: "purchase", status: "partial_failed" }, createdCount: 1, updatedCount: 0, failedCount: 1, outcomes: [{ success: true }, { success: false }] });
    const { container, ui } = mountPurchase();
    await previewPurchaseImport(container, "Outlet,Month,Year,Supplier,Category,Amount,Remark\nKLC,Aug,2026,Fresh Foods,Produce,450,Invoice");
    await screen.findByText("New record will be created.");
    await confirmPurchaseImport();
    await screen.findByText("Import complete");
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Import partially completed", tone: "warning" }));
  });

  it("does not offer category creation or any Purchase target write when the exact category-create permission is absent", async () => {
    const { container } = mountPurchase({ dataStore: { ...store, suppliers: [], purchaseCategories: [] }, permissions: ["purchase_input.import"] });
    await previewPurchaseImport(container, "Outlet,Month,Year,Supplier,Category,Amount,Remark\nKLC,Aug,2026,New Supplier,New Category,450,Invoice");
    await screen.findByText("Unknown Category Review Required");
    fireEvent.click(screen.getByRole("button", { name: "Map existing" }));
    expect(screen.queryByRole("button", { name: "Create category" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" }).disabled).toBe(true);
    expect(mocks.imports.preparePurchaseMasters).not.toHaveBeenCalled();
    expect(mocks.imports.importPurchases).not.toHaveBeenCalled();
  });

  it("does not offer supplier creation or any Purchase target write when the exact supplier-create permission is absent", async () => {
    const { container } = mountPurchase({ dataStore: { ...store, suppliers: [], purchaseCategories: [{ id: "category-1", name: "Produce" }] }, permissions: ["purchase_input.import"] });
    await previewPurchaseImport(container, "Outlet,Month,Year,Supplier,Category,Amount,Remark\nKLC,Aug,2026,New Supplier,Produce,450,Invoice");
    await screen.findByText("Unknown Supplier Review Required");
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryByRole("button", { name: "Create supplier" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue to Preview" }).disabled).toBe(true);
    expect(mocks.imports.preparePurchaseMasters).not.toHaveBeenCalled();
    expect(mocks.imports.importPurchases).not.toHaveBeenCalled();
  });
});
