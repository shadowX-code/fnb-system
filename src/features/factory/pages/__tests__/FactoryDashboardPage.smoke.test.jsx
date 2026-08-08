import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FactoryDashboardPage from "../FactoryDashboardPage.jsx";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";

vi.mock("../../hooks/useFactoryDashboardQuery.js", () => ({ default: () => ({ state: { hasLoaded: true, loading: false, error: "", errorKind: "", snapshot: { filters: { month_start: "2026-08-01", permissions: { production: true, receiving: true, dispatch: true, job_orders: true, qc: true, finished_inventory: true } }, kpis: { production_output: { by_uom: [{ quantity: 12.5, uom: "kg" }], batch_count: 2 }, dispatch_volume: { pack_qty: 3, dispatch_count: 1 }, completion_rate: { rate: 100, completed_within_month_count: 1, eligible_due_count: 1 }, qc_pass_rate: { rate: 100, passed: 1, failed: 0, pending: 0, metadata_unavailable: 0 }, raw_receiving: { by_uom: [{ quantity: 8, uom: "kg" }], record_count: 1, material_count: 1 }, inventory_alerts: {} }, production_summary: [{ finished_good_id: "sku-1", product: "Sambal", packaging_sku: "SKU-1", uom: "kg", output_qty: 12.5, batch_count: 2, average_batch_qty: 6.25, completion_rate: 100 }], top_dispatch_products: [], top_raw_materials: [{ raw_material_id: "rm-1", raw_material: "Chili", uom: "kg", received_qty: 8, receiving_count: 1, supplier_count: 1 }], planned_vs_actual: [], raw_material_flow: [], production_dispatch_trend: { months: [], production: [], dispatch: [] }, qc_performance: { passed: 1, failed: 0, pending: 0, metadata_unavailable: 0, no_qc_required: 0, metadata_unavailable_jobs: 0, top_failures: [] }, inventory_health: {}, action_required: [] } }, retry: vi.fn() }) }));

describe("FactoryDashboardPage render smoke", () => {
  it("renders KPI quantity lists, Production Summary, and Raw Material chart/table paths", () => {
    render(<FactoryMasterDataProvider data={{ finishedGoods: [] }}><FactoryDashboardPage onRefreshFactoryData={vi.fn()} /></FactoryMasterDataProvider>);
    expect(screen.getAllByText("12.5 kg").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8 kg").length).toBeGreaterThan(0);
    expect(screen.getByText("Production Summary")).not.toBeNull();
    expect(screen.getByText("Sambal")).not.toBeNull();
    expect(screen.getByText("Chili")).not.toBeNull();
  });
});
