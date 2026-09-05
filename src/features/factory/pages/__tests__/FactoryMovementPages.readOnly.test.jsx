import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FactoryProductMovementsPage from "../FactoryProductMovementsPage.jsx";
import FactoryRawMaterialMovementsPage from "../FactoryRawMaterialMovementsPage.jsx";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";

vi.mock("../../hooks/useRawMaterialMovementsQuery.js", () => ({ default: () => ({ filters: { dateFrom: "", dateTo: "", material: "", movementType: "", storageLocation: "", search: "", batchId: "", batchLabel: "" }, listing: { rows: [
  { id: "rm-receive", movement_date: "2026-08-09", movement_type: "Receiving", raw_material_name: "Chili", raw_material_code: "CHI", quantity: 10, balance_after: 10, uom: "kg", storage_location: "Dry Store A", internal_batch_no: "RM-CHI-260809-01", batch_id: "batch-receive", reference_no: "R260809-01", document_id: "receiving-1", created_by_name: "Isaac" },
  { id: "rm-production", movement_date: "2026-08-09", movement_type: "Production Usage", raw_material_name: "Chili", raw_material_code: "CHI", quantity: -2, balance_after: 8, uom: "kg", storage_location: "Production Area", internal_batch_no: "RM-CHI-260809-01", batch_id: "batch-receive", reference_no: "PB260809-01", document_id: "production-1", created_by_name: "Isaac" },
  { id: "rm-adjustment", movement_date: "2026-08-09", movement_type: "Stock Check Adjustment", raw_material_name: "Chili", raw_material_code: "CHI", quantity: -1, balance_after: 7, uom: "kg", storage_location: "Dry Store A", internal_batch_no: "RM-CHI-260809-01", batch_id: "batch-receive", reference_no: "RMSC-260809-01", document_id: "check-1", created_by_name: "Isaac" },
], summary: { movements: 3, stock_in_by_uom: [{ uom: "kg", quantity: 10 }], stock_out_by_uom: [{ uom: "kg", quantity: 3 }], locations: 2, movement_types: ["Receiving", "Production Usage", "Stock Check Adjustment"], location_values: ["Dry Store A", "Production Area"] }, hasLoaded: true, loading: false, error: "", errorKind: "", loadedPage: 1, loadedPageSize: 20, loadedTotal: 3 }, updateFilters: vi.fn(), clearBatch: vi.fn(), selectBatch: vi.fn(), requestPage: vi.fn(), requestPageSize: vi.fn(), retry: vi.fn() }) }));
vi.mock("../../hooks/useProductMovementsQuery.js", () => ({ default: () => ({ filters: { dateFrom: "", dateTo: "", product: "", category: "", movementType: "", batch: "" }, listing: { rows: [
  { id: "fg-production", movement_date: "2026-08-09", reference_type: "production", batch_no: "PB260809-01", product_name: "Sambal", product_name_cn: "叁巴酱", product_code: "SAM-500", variant_name: "500 g Pack", packaging_type: "Pack", quantity: 20, balance_after: 20, storage_location_name: "Finished Goods A", storage_location_type: "Finished Goods Area", storage_location_count: 1, batch_count: 1, expiry_date: "2026-09-09" },
  { id: "fg-dispatch", movement_date: "2026-08-09", reference_type: "finished_goods_dispatch", source_reference: "D260809-01", batch_no: "PB260809-01", product_name: "Sambal", product_code: "SAM-500", variant_name: "500 g Pack", packaging_type: "Pack", quantity: -4, balance_after: 16, storage_location_name: "Finished Goods A", storage_location_count: 1, batch_count: 1, expiry_date: "2026-09-09" },
  { id: "fg-check", movement_date: "2026-08-09", reference_type: "product_stock_check", source_reference: "FGSC260809-01", product_name: "Sambal", product_code: "SAM-500", variant_name: "500 g Pack", packaging_type: "Pack", quantity: -1, balance_after: 15, storage_location_count: 2, batch_count: 2, earliest_expiry_date: "2026-09-09" },
], summary: { filteredSkus: [{ current_balance: 15, packaging_type: "Pack" }], categories: [{ id: "cat-1", name: "Sauces" }], movementTypes: ["Production", "Dispatch", "Stock Check"], stockInCount: 1, stockOutCount: 2 }, hasLoaded: true, loading: false, error: "", errorKind: "", loadedPage: 1, loadedPageSize: 20, loadedTotal: 3 }, updateFilters: vi.fn(), resetFilters: vi.fn(), requestPage: vi.fn(), requestPageSize: vi.fn(), retry: vi.fn() }) }));

function renderWithNavigation(node) {
  return render(<FactoryMasterDataProvider data={{ rawMaterials: [] }}><FactoryNavigationProvider rawMovementReferenceLoading="" openRawMaterialMovementReference={vi.fn()}>{node}</FactoryNavigationProvider></FactoryMasterDataProvider>);
}

describe("Movement ledger read-only presentation", () => {
  it("executes Receiving, Production Usage, and Stock Check row renderers without mutation controls", () => {
    const openReference = vi.fn(); const onOpenDetail = vi.fn();
    render(<FactoryMasterDataProvider data={{ rawMaterials: [{ id: "rm-1", name_en: "Chili" }] }}><FactoryNavigationProvider rawMovementReferenceLoading="" openRawMaterialMovementReference={openReference}><FactoryRawMaterialMovementsPage onOpenDetail={onOpenDetail} onCloseDetail={vi.fn()} /></FactoryNavigationProvider></FactoryMasterDataProvider>);
    expect(screen.getByText("Raw Material Movements")).not.toBeNull();
    expect(screen.getAllByText("RM-CHI-260809-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PB260809-01").length).toBeGreaterThan(0);
    expect(screen.getByText("RMSC-260809-01")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: "rm-receive" }));
    expect(screen.queryByRole("button", { name: /create|edit|delete/i })).toBeNull();
  });

  it("executes Production, Dispatch, and Stock Check Product Movement row renderers without mutation controls", () => {
    renderWithNavigation(<FactoryProductMovementsPage />);
    expect(screen.getByText("Product Movements")).not.toBeNull();
    expect(screen.getAllByText("PB260809-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("D260809-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FGSC260809-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 Batches").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /create|edit|delete/i })).toBeNull();
  });
});
