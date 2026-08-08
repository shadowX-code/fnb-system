import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FactoryProductMovementsPage from "../FactoryProductMovementsPage.jsx";
import FactoryRawMaterialMovementsPage from "../FactoryRawMaterialMovementsPage.jsx";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";

vi.mock("../../hooks/useRawMaterialMovementsQuery.js", () => ({ default: () => ({ filters: { dateFrom: "", dateTo: "", material: "", movementType: "", storageLocation: "", search: "", batchId: "", batchLabel: "" }, listing: { rows: [], summary: {}, hasLoaded: true, loading: false, error: "", errorKind: "", loadedPage: 1, loadedPageSize: 20, loadedTotal: 0 }, updateFilters: vi.fn(), clearBatch: vi.fn(), selectBatch: vi.fn(), requestPage: vi.fn(), requestPageSize: vi.fn(), retry: vi.fn() }) }));
vi.mock("../../hooks/useProductMovementsQuery.js", () => ({ default: () => ({ filters: { dateFrom: "", dateTo: "", product: "", category: "", movementType: "", batch: "" }, listing: { rows: [], summary: { filteredSkus: [], categories: [], movementTypes: [] }, hasLoaded: true, loading: false, error: "", errorKind: "", loadedPage: 1, loadedPageSize: 20, loadedTotal: 0 }, updateFilters: vi.fn(), resetFilters: vi.fn(), requestPage: vi.fn(), requestPageSize: vi.fn(), retry: vi.fn() }) }));

function renderWithNavigation(node) {
  return render(<FactoryMasterDataProvider data={{ rawMaterials: [] }}><FactoryNavigationProvider rawMovementReferenceLoading="" openRawMaterialMovementReference={vi.fn()}>{node}</FactoryNavigationProvider></FactoryMasterDataProvider>);
}

describe("Movement ledger read-only presentation", () => {
  it("renders Raw Material Movements without create, edit, or delete controls", () => {
    renderWithNavigation(<FactoryRawMaterialMovementsPage onOpenDetail={vi.fn()} onCloseDetail={vi.fn()} />);
    expect(screen.getByText("Raw Material Movements")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /create|edit|delete/i })).toBeNull();
  });

  it("renders Product Movements without create, edit, or delete controls", () => {
    renderWithNavigation(<FactoryProductMovementsPage />);
    expect(screen.getByText("Product Movements")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /create|edit|delete/i })).toBeNull();
  });
});
