import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewSpecialAccessModal from "../CrewSpecialAccessModal.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { updateSpecialAccess: vi.fn(), inventorySpecialAccess: vi.fn(), managementSpecialAccess: vi.fn(), updateManagementSpecialAccess: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Special Access", () => {
  const employee = { id: "employee-1", full_name: "Crew QA", workplace: "Friends Corner", crew_access: { access_state: "active", can_initiate_handover: false, can_add_assets: false, can_adjust_assets: false, can_perform_asset_inspections: false } };

  it("updates the per-account Hand Over Cash capability without exposing Admin roles", async () => {
    crewService.inventorySpecialAccess.mockResolvedValue({});
    crewService.updateSpecialAccess.mockResolvedValue({ can_initiate_handover: true, can_add_assets: true, can_adjust_assets: true, can_perform_asset_inspections: true });
    render(<CrewSpecialAccessModal employee={employee} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Hand Over Cash" }).checked).toBe(false));
    expect(screen.queryByText(/Admin Role/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hand Over Cash" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Add Assets" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Adjust Assets" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Perform Asset Inspections" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(screen.getByRole("checkbox", { name: "Manage Asset Details" }).checked).toBe(false);
    await waitFor(() => expect(crewService.updateSpecialAccess).toHaveBeenCalledWith("employee-1", { handover: true, addAssets: true, adjustAssets: true, inspectAssets: true, manageAssetDetails: false, performStockCheck: false, createAuditStockCheck: false, managePurchaseOrders: false, receivePurchaseOrders: false }));
  });

  it("loads and saves only the selected Management outlet grant", async () => {
    crewService.managementSpecialAccess.mockResolvedValue({ outlets: [
      { id: "jymt", name: "JYMT Kopitiam", can_add_assets: true, can_perform_asset_inspections: true },
      { id: "hola", name: "Hola Hola Kopitiam Ipoh", can_add_assets: false, can_perform_asset_inspections: false },
    ] });
    crewService.updateManagementSpecialAccess.mockResolvedValue({ outlet_id: "hola", can_add_assets: true });
    render(<CrewSpecialAccessModal employee={{ ...employee, workplace: "Management" }} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Add Assets" }).checked).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Outlet" }));
    fireEvent.click(screen.getByRole("button", { name: "Hola Hola Kopitiam Ipoh" }));
    expect(screen.getByRole("checkbox", { name: "Add Assets" }).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Add Assets" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(crewService.updateManagementSpecialAccess).toHaveBeenCalledWith("employee-1", "hola", {
      handover: false, addAssets: true, adjustAssets: false, inspectAssets: false, manageAssetDetails: false,
      performStockCheck: false, createAuditStockCheck: false, managePurchaseOrders: false, receivePurchaseOrders: false,
    }));
    expect(crewService.updateSpecialAccess).not.toHaveBeenCalled();
  });

  it("keeps Inventory capabilities independent for a fixed outlet", async () => {
    crewService.inventorySpecialAccess.mockResolvedValue({ can_perform_stock_check: true, can_receive_purchase_orders: true });
    crewService.updateSpecialAccess.mockResolvedValue({});
    render(<CrewSpecialAccessModal employee={employee} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Perform Stock Check" }).checked).toBe(true));
    expect(screen.getByRole("checkbox", { name: "Receive Purchase Orders" }).checked).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Create Audit Stock Check" }).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Create Audit Stock Check" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(crewService.updateSpecialAccess).toHaveBeenCalledWith("employee-1", expect.objectContaining({
      performStockCheck: true, createAuditStockCheck: true, managePurchaseOrders: false, receivePurchaseOrders: true,
    })));
  });
});
