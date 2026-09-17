import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewAssetsMobile from "../CrewAssetsMobile.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { assetsMobile: vi.fn(), adjustAsset: vi.fn(), createAsset: vi.fn(), uploadInitialAssetPhoto: vi.fn(), submitAssetInspection: vi.fn(), uploadAssetInspectionEvidence: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const payload = {
  outlet: { id: "outlet-1", name: "Friends Corner" }, can_add_assets: true, can_adjust_assets: true, can_perform_asset_inspections: true,
  categories: [{ id: "cat-1", name: "Kitchen" }], condition_templates: [], inspection_drafts: [],
  movement_history: [{ id: "movement-1", asset_id: "asset-1", asset_name: "Staging QA Blender", movement_type: "correction", quantity_before: 2, quantity_after: 3, quantity_change: 1, reason: "stock_count", created_at: "2026-09-17T10:00:00Z", actor_name: "You" }],
  inspection_history: [{ id: "inspection-1", inspection_date: "2026-09-16", created_at: "2026-09-16T10:00:00Z", checked_by: "Jordan", status: "completed", summary: { checked_assets: 1 }, asset_ids: ["asset-1"] }],
  assets: [{ id: "asset-1", asset_code: "QA-1", name: "Staging QA Blender", category_id: "cat-1", category_name: "Kitchen", location: "Bar", unit: "unit", current_quantity: 2, minimum_quantity: 1, condition: "healthy", maintenance: [] }],
};

describe("Crew Assets Mobile", () => {
  it("renders the safe outlet asset projection and capability actions", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    expect(await screen.findByText("Staging QA Blender")).not.toBeNull();
    fireEvent.click(screen.getByText("Staging QA Blender"));
    expect(screen.getByRole("button", { name: /Adjust Quantity/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Inspect Asset/i })).not.toBeNull();
  });

  it("opens the adjustment sheet from asset detail", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Adjust Quantity/i }));
    expect(screen.getByRole("heading", { name: "Adjust Quantity" })).not.toBeNull();
    expect(screen.getByLabelText("Quantity").value).toBe("2");
    expect(screen.getByRole("button", { name: "Save adjustment" })).not.toBeNull();
    expect(screen.getByText("Current quantity")).not.toBeNull();
    expect(screen.getByText("New quantity")).not.toBeNull();
  });

  it("uses the shared picker and presents unified asset activity", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    await screen.findByText("Staging QA Blender");
    expect(screen.queryByRole("combobox", { name: /asset category/i })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Category" }).at(-1));
    expect(screen.getByRole("listbox", { name: "Category" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /Activity/i }));
    expect(screen.getByText("Quantity adjusted · Staging QA Blender")).not.toBeNull();
    expect(screen.getByText("Inspection completed")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Adjustments" }));
    expect(screen.queryByText("Inspection completed")).toBeNull();
  });

  it("requires a confirmation for a large adjustment before the canonical mutation", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Adjust Quantity/i }));
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(screen.getByRole("heading", { name: "Confirm large adjustment" })).not.toBeNull();
    expect(crewService.adjustAsset).not.toHaveBeenCalled();
  });

  it("refreshes Asset Detail and the Activity projection after an adjustment", async () => {
    const refreshed = { ...payload, assets: [{ ...payload.assets[0], current_quantity: 3 }], movement_history: [{ ...payload.movement_history[0], quantity_after: 3, quantity_change: 1 }] };
    crewService.assetsMobile.mockResolvedValueOnce(payload).mockResolvedValueOnce(refreshed);
    crewService.adjustAsset.mockResolvedValue({ asset: { id: "asset-1", current_quantity: 3 } });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Adjust Quantity/i }));
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    await waitFor(() => expect(crewService.assetsMobile).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("3 units")).not.toBeNull();
    expect(screen.getByText("Quantity adjusted · Staging QA Blender")).not.toBeNull();
  });

  it("refreshes the read model after saving an inspection draft", async () => {
    crewService.assetsMobile
      .mockResolvedValueOnce(payload)
      .mockResolvedValueOnce({ ...payload, inspection_drafts: [{ id: "draft-1", current_step: 1, completion_percentage: 0, updated_at: "2026-09-17T10:00:00Z", category_scope: { type: "specific" }, draft_data: { rows: [{ asset_id: "asset-1", counted_quantity: 2, condition_status: "healthy", remark: "QA", evidence: [] }] } }] });
    crewService.submitAssetInspection.mockResolvedValue({});
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Inspect Asset/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(crewService.assetsMobile).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Resume inspection")).not.toBeNull();
  });

  it("does not render mutation actions without their separate capabilities", async () => {
    crewService.assetsMobile.mockResolvedValue({ ...payload, can_add_assets: false, can_adjust_assets: false, can_perform_asset_inspections: false });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    expect(screen.queryByRole("button", { name: /Adjust Quantity/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Inspect Asset/i })).toBeNull();
  });

  it("shows an explicit access/read error rather than an empty list", async () => {
    crewService.assetsMobile.mockRejectedValue(new Error("Crew Asset access is unavailable."));
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    expect(await screen.findByText("Assets unavailable")).not.toBeNull();
    expect(screen.getByText("Crew Asset access is unavailable.")).not.toBeNull();
  });

  it("creates an outlet-scoped asset through the trusted creation authority", async () => {
    const refreshed = { ...payload, assets: [...payload.assets, { ...payload.assets[0], id: "asset-new", name: "Crew QA Tongs", current_quantity: 4 }] };
    crewService.assetsMobile.mockResolvedValueOnce(payload).mockResolvedValueOnce(refreshed);
    crewService.createAsset.mockResolvedValue({ asset: { id: "asset-new" } });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add Asset/i }));
    fireEvent.change(screen.getByLabelText("Asset name"), { target: { value: "Crew QA Tongs" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Category" }).at(-1));
    fireEvent.click(screen.getByRole("option", { name: "Kitchen" }));
    fireEvent.change(screen.getByLabelText("Initial quantity"), { target: { value: "4" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add Asset" }).at(-1));
    await waitFor(() => expect(crewService.createAsset).toHaveBeenCalledWith("token", expect.objectContaining({ asset: expect.objectContaining({ name: "Crew QA Tongs", initial_quantity: 4, category_id: "cat-1" }) })));
    expect(await screen.findByText("Crew QA Tongs")).not.toBeNull();
  });
});
