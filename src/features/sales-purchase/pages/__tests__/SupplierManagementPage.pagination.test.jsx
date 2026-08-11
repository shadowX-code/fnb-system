import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../services/supplierService.js", () => ({
  formatSupplierName: (value) => value,
  supplierService: {
    listSuppliers: vi.fn().mockResolvedValue([]),
    getSupplierUsageMap: vi.fn().mockResolvedValue({}),
    saveSupplier: vi.fn(),
    setSupplierActive: vi.fn(),
    deleteSupplier: vi.fn(),
  },
}));

import SupplierManagementPage from "../SupplierManagementPage.jsx";

function suppliers() {
  return Array.from({ length: 21 }, (_, index) => ({
    id: `supplier-${index + 1}`,
    name: `Supplier ${String(index + 1).padStart(2, "0")}`,
    default_category_id: "category-1",
    outletIds: ["outlet-1"],
    status: "active",
  }));
}

function mount() {
  render(
    <SupplierManagementPage
      store={{
        suppliers: suppliers(),
        outlets: [{ id: "outlet-1", name: "KL Central", status: "active" }],
        purchaseCategories: [{ id: "category-1", name: "Ingredients" }],
        purchaseRecords: [],
      }}
      setStore={vi.fn()}
      ui={{ notify: vi.fn(), confirm: vi.fn() }}
      auth={{
        session: { user: { id: "user-1" } },
        profile: { id: "user-1" },
        isProtectedRole: true,
        loading: false,
        contextLoading: false,
        hasPermission: () => true,
      }}
    />,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("SupplierManagementPage pagination", () => {
  it("paginates the post-filter Supplier Directory result and resets when search changes", () => {
    mount();
    expect(screen.getByText("Showing 1–20 of 21 records")).toBeTruthy();
    expect(screen.getByText("Supplier 01")).toBeTruthy();
    expect(screen.queryByText("Supplier 21")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Previous" }).every((button) => button.disabled)).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]);
    expect(screen.getByText("Showing 21–21 of 21 records")).toBeTruthy();
    expect(screen.getByText("Supplier 21")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search supplier..."), { target: { value: "Supplier 01" } });
    expect(screen.getByText("Showing 1–1 of 1 records")).toBeTruthy();
    expect(screen.getByText("Supplier 01")).toBeTruthy();
    expect(screen.queryByText("Supplier 21")).toBeNull();
  });
});
