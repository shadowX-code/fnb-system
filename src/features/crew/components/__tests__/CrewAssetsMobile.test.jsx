import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewAssetsMobile from "../CrewAssetsMobile.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { assetsMobile: vi.fn(), adjustAsset: vi.fn(), createAsset: vi.fn(), createAssetWithPhoto: vi.fn(), prepareAssetMasterPhoto: vi.fn(), updateAssetDetails: vi.fn(), uploadInitialAssetPhoto: vi.fn(), submitAssetInspection: vi.fn(), archiveAssetInspectionDraft: vi.fn(), uploadAssetInspectionEvidence: vi.fn() } }));
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

  it("groups capability-gated operational actions beneath search with shared button hierarchy", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    const add = await screen.findByRole("button", { name: "Add Asset" });
    const inspect = screen.getByRole("button", { name: "Inspection" });
    expect(add.className).toContain("crew-mobile-secondary");
    expect(inspect.className).toContain("crew-mobile-primary");
    expect(screen.getByRole("button", { name: /Activity/i }).className).not.toContain("crew-mobile-primary");
  });

  it("opens the adjustment sheet from asset detail", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Adjust Quantity/i }));
    expect(screen.getByRole("heading", { name: "Adjust Quantity" })).not.toBeNull();
    expect(screen.getByLabelText("Quantity").value).toBe("2");
    expect(screen.getByLabelText("Quantity").getAttribute("inputmode")).toBe("decimal");
    expect(screen.getByRole("button", { name: "Save adjustment" })).not.toBeNull();
    expect(screen.getByText("Current quantity")).not.toBeNull();
    expect(screen.getByText("New quantity")).not.toBeNull();
  });

  it("uses horizontal category chips and presents unified asset activity", async () => {
    crewService.assetsMobile.mockResolvedValue({ ...payload, categories: [...payload.categories, { id: "cat-empty", name: "Empty category" }] });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    await screen.findByText("Staging QA Blender");
    expect(screen.queryByRole("combobox", { name: /asset category/i })).toBeNull();
    expect(screen.getByRole("group", { name: "Asset categories" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Kitchen" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Empty category" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kitchen" }));
    expect(screen.getByRole("button", { name: "Kitchen" }).getAttribute("aria-pressed")).toBe("true");
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
    expect(screen.getByText("Quantity adjusted")).not.toBeNull();
  });

  it("refreshes the read model after saving an inspection draft", async () => {
    crewService.assetsMobile
      .mockResolvedValueOnce(payload)
      .mockResolvedValueOnce({ ...payload, inspection_drafts: [{ id: "draft-1", current_step: 1, completion_percentage: 0, updated_at: "2026-09-17T10:00:00Z", category_scope: { type: "specific" }, draft_data: { rows: [{ asset_id: "asset-1", counted_quantity: 2, condition_status: "healthy", remark: "QA", evidence: [] }] } }] });
    crewService.submitAssetInspection.mockResolvedValue({});
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Inspect Asset/i }));
    expect(screen.queryByText("No unsaved changes")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Counted"), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Save Draft" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(crewService.assetsMobile).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status").textContent).toContain("Draft saved");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Resume inspection")).not.toBeNull();
  });

  it("uses prominent inspection progress and keeps draft saving subordinate to navigation", async () => {
    const multiAssetPayload = { ...payload, assets: [...payload.assets, { ...payload.assets[0], id: "asset-2", name: "Staging QA Chiller" }] };
    crewService.assetsMobile.mockResolvedValue(multiAssetPayload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspection" }));
    expect(screen.getByRole("button", { name: "Start Inspection" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Inspection" }));
    expect(screen.getByText("1 of 2")).not.toBeNull();
    expect(screen.getByText("50%")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Next" }).closest(".crew-inspection-workflow-dock")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 of 2")).not.toBeNull();
    expect(screen.getByText("100%")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Previous" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Complete Inspection" })).not.toBeNull();
  });

  it("uses the full workflow dock for a one-asset inspection without a disabled Previous action", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Inspect Asset/i }));
    const complete = screen.getByRole("button", { name: "Complete Inspection" });
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(complete.closest(".crew-inspection-workflow-dock")?.className).toContain("is-single-action");
  });

  it("archives a Crew-owned saved draft through the canonical lifecycle and removes Resume inspection", async () => {
    const draft = { id: "draft-1", status: "in_progress", current_step: 1, completion_percentage: 0, updated_at: "2026-09-17T10:00:00Z", category_scope: { type: "specific" }, draft_data: { rows: [{ asset_id: "asset-1", counted_quantity: 2, condition_status: "healthy", remark: "QA", evidence: [] }] } };
    crewService.assetsMobile.mockResolvedValueOnce({ ...payload, inspection_drafts: [draft] }).mockResolvedValueOnce(payload);
    crewService.archiveAssetInspectionDraft.mockResolvedValue({ inspection_id: "draft-1", status: "archived" });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Resume inspection"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel Inspection" }));
    expect(screen.getByRole("heading", { name: "Cancel inspection?" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel inspection" }));
    await waitFor(() => expect(crewService.archiveAssetInspectionDraft).toHaveBeenCalledWith("token", "draft-1"));
    expect(await screen.findByText("Inspection draft cancelled")).not.toBeNull();
    expect(screen.queryByText("Resume inspection")).toBeNull();
  });

  it("supports horizontal swipe navigation without discarding local inspection work", async () => {
    const multiAssetPayload = { ...payload, assets: [...payload.assets, { ...payload.assets[0], id: "asset-2", name: "Staging QA Chiller" }] };
    crewService.assetsMobile.mockResolvedValue(multiAssetPayload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspection" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Inspection" }));
    fireEvent.change(screen.getByLabelText("Counted"), { target: { value: "1" } });
    const step = screen.getByText("Staging QA Blender").closest("article");
    fireEvent.touchStart(step, { touches: [{ clientX: 260, clientY: 160 }] });
    fireEvent.touchEnd(step, { changedTouches: [{ clientX: 120, clientY: 165 }] });
    expect(screen.getByText("Staging QA Chiller")).not.toBeNull();
    const nextStep = screen.getByText("Staging QA Chiller").closest("article");
    fireEvent.touchStart(nextStep, { touches: [{ clientX: 120, clientY: 160 }] });
    fireEvent.touchEnd(nextStep, { changedTouches: [{ clientX: 260, clientY: 165 }] });
    expect(screen.getByLabelText("Counted").value).toBe("1");
  });

  it("refreshes the open Asset Detail after a variance inspection", async () => {
    const refreshed = {
      ...payload,
      assets: [{ ...payload.assets[0], current_quantity: 2 }],
      inspection_history: [{
        ...payload.inspection_history[0],
        items: [{ asset_id: "asset-1", asset_name: "Staging QA Blender", expected_quantity: 2, counted_quantity: 1, difference: -1, condition: "healthy" }],
      }],
    };
    crewService.assetsMobile.mockResolvedValueOnce(payload).mockResolvedValueOnce(refreshed);
    crewService.submitAssetInspection.mockResolvedValue({ status: "completed", asset_updates: [{ id: "asset-1", current_quantity: 1, condition: "healthy" }] });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Inspect Asset/i }));
    fireEvent.change(screen.getByLabelText("Counted"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete Inspection" }));
    await waitFor(() => expect(crewService.assetsMobile).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("1 unit")).not.toBeNull();
    expect(screen.getByText((_, node) => node?.tagName === "SMALL" && /Expected 2 .* Counted 1/i.test(node.textContent || ""))).not.toBeNull();
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
    expect(screen.getByLabelText("Initial quantity").getAttribute("inputmode")).toBe("decimal");
    expect(screen.getByLabelText("Initial quantity").getAttribute("enterkeyhint")).toBe("next");
    fireEvent.click(screen.getByRole("button", { name: "Create Asset" }));
    await waitFor(() => expect(crewService.createAsset).toHaveBeenCalledWith("token", expect.objectContaining({ asset: expect.objectContaining({ name: "Crew QA Tongs", initial_quantity: 4, category_id: "cat-1" }) })));
    expect(await screen.findByText("Crew QA Tongs")).not.toBeNull();
  });

  it("creates a photo-inclusive Asset through one idempotent atomic operation", async () => {
    const refreshed = { ...payload, assets: [...payload.assets, { ...payload.assets[0], id: "asset-new", name: "Crew QA Camera", current_quantity: 1 }] };
    const prepared = { file: new File(["photo"], "asset.jpg", { type: "image/jpeg" }), bundle: {}, previewUrl: "blob:preview" };
    crewService.assetsMobile.mockResolvedValueOnce(payload).mockResolvedValueOnce(refreshed);
    crewService.prepareAssetMasterPhoto.mockResolvedValue(prepared);
    crewService.createAssetWithPhoto.mockResolvedValue({ asset: { id: "asset-new" } });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add Asset/i }));
    fireEvent.change(screen.getByLabelText("Asset name"), { target: { value: "Crew QA Camera" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Category" }).at(-1));
    fireEvent.click(screen.getByRole("option", { name: "Kitchen" }));
    fireEvent.change(screen.getByLabelText("Initial quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Take Photo"), { target: { files: [prepared.file] } });
    expect(await screen.findByAltText("Asset photo crop preview")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Asset" }));
    await waitFor(() => expect(crewService.createAssetWithPhoto).toHaveBeenCalledWith("token", expect.objectContaining({ asset: expect.objectContaining({ name: "Crew QA Camera" }), preparedPhoto: expect.any(Object) })));
    expect(crewService.createAsset).not.toHaveBeenCalled();
    expect(crewService.uploadInitialAssetPhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Retry photo/i })).toBeNull();
  });

  it("does not expose Minimum Quantity or duplicate Remark concepts during creation", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add Asset/i }));
    expect(screen.queryByLabelText(/Minimum quantity/i)).toBeNull();
    expect(screen.queryByLabelText(/Remark/i)).toBeNull();
    expect(screen.getByLabelText(/Description/i)).not.toBeNull();
    expect(screen.getByLabelText("Take Photo")).not.toBeNull();
    expect(screen.getByLabelText("Choose from Library")).not.toBeNull();
  });
});
