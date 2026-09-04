import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryAuditTrailPage from "../FactoryAuditTrailPage.jsx";
import FactoryBatchTraceabilityPage from "../FactoryBatchTraceabilityPage.jsx";

const batch = { id: "batch-1", batch_balance_id: "batch-1", batch_no: "PB260809-01", batch_type: "production", packaging_sku_code: "SAM-500", finished_good_name: "Sambal", original_qty: 20, completed_dispatch_qty: 2, current_balance: 18, manufacturing_date: "2026-08-09", expiry_date: "2026-09-09", storage_location_name: "Finished Goods A", storage_location_type: "Finished Goods Area" };
const event = { id: "event-1", created_at: "2026-08-09T10:00:00+08:00", module: "factory_finished_goods_dispatch", action: "completed", entity_reference: "D260809-01", actor_name: "Isaac", result: "Success", before: { status: "draft" }, after: { status: "completed" } };

function renderPage(Page, permissions) {
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={(key) => permissions.includes(key)}><FactoryMasterDataProvider data={{ finishedGoods: [{ id: "sku-1", product_code: "SAM-500", product_name: "Sambal" }], storageLocations: [{ id: "storage-1", location_name: "Finished Goods A", location_type: "Finished Goods Area" }] }}><FactoryNavigationProvider openAuditReference={vi.fn()}><Page onNotify={vi.fn()} /></FactoryNavigationProvider></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory traceability and audit route smoke", () => {
  it("renders Batch Traceability, opens its detail path, and handles an empty list", async () => {
    vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [batch], summary: { available: 1, remaining_qty: 18, warnings: 0 }, totalCount: 1, page: 1, pageSize: 20 });
    vi.spyOn(factoryService, "getFinishedGoodBatchTraceabilityDetail").mockResolvedValue({ ...batch, timeline: [], dispatch_history: [] });
    renderPage(FactoryBatchTraceabilityPage, ["factory_batch_traceability.view"]);
    expect((await screen.findAllByText("PB260809-01")).length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "Batch no." })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Manufacturing / expiry" })).not.toBeNull();
    expect(screen.getByText("09/08/2026")).not.toBeNull();
    expect(screen.getByText("Expiry 09/09/2026")).not.toBeNull();
    expect(screen.getAllByText("Available")).not.toHaveLength(0);
    expect(screen.getByText("Showing 1–1 of 1")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    await waitFor(() => expect(factoryService.getFinishedGoodBatchTraceabilityDetail).toHaveBeenCalledWith(batch));

    cleanup();
    vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [], summary: {}, totalCount: 0, page: 1, pageSize: 20 });
    renderPage(FactoryBatchTraceabilityPage, ["factory_batch_traceability.view"]);
    expect(await screen.findByText("No records match these filters")).not.toBeNull();
  });

  it("keeps secondary traceability filters in More filters and exposes removable active filter chips", async () => {
    vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [batch], summary: {}, totalCount: 1, page: 1, pageSize: 20 });
    renderPage(FactoryBatchTraceabilityPage, ["factory_batch_traceability.view"]);
    await screen.findByText("PB260809-01");

    fireEvent.click(screen.getByRole("button", { name: "More filters" }));
    expect(screen.getAllByText("Packaging SKU")).not.toHaveLength(0);
    expect(screen.getByText("Batch type")).not.toBeNull();
    expect(screen.getByText("Storage location")).not.toBeNull();
    expect(screen.getByText("Expiry status")).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Batch, SKU, product or location"), { target: { value: "Sambal" } });
    await waitFor(() => expect(screen.getByText("Filtered by")).not.toBeNull());
    expect(screen.getByText("Search: Sambal")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clear all" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove Search filter" }));
    await waitFor(() => expect(screen.queryByText("Search: Sambal")).toBeNull());
  });

  it("uses a column-preserving loading skeleton before the batch list resolves", () => {
    vi.spyOn(factoryService, "listFactoryListingPage").mockReturnValue(new Promise(() => {}));
    renderPage(FactoryBatchTraceabilityPage, ["factory_batch_traceability.view"]);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("columnheader", { name: "Remaining" })).not.toBeNull();
  });

  it("renders Audit Trail detail and clears the visible ledger for a user without View", async () => {
    vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [event], summary: { events: 1, today: 1, users: 1, attention_required: 0, module_values: ["Dispatch"], event_values: ["Completed"], user_values: ["Isaac"] }, totalCount: 1, page: 1, pageSize: 20 });
    renderPage(FactoryAuditTrailPage, ["factory_audit_logs.view"]);
    expect((await screen.findAllByText("D260809-01")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect(screen.getByText("Technical Details · Show raw metadata")).not.toBeNull();

    cleanup();
    renderPage(FactoryAuditTrailPage, []);
    expect(await screen.findByText("The Factory Audit Trail is hidden by your current role.")).not.toBeNull();
    expect(screen.queryByText("D260809-01")).toBeNull();
  });
});
