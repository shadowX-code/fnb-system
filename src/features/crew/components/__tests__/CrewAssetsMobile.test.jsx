import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewAssetsMobile from "../CrewAssetsMobile.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { assetsMobile: vi.fn(), adjustAsset: vi.fn(), submitAssetInspection: vi.fn(), uploadAssetInspectionEvidence: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const payload = {
  outlet: { id: "outlet-1", name: "Friends Corner" }, can_adjust_assets: true, can_perform_asset_inspections: true,
  categories: [{ id: "cat-1", name: "Kitchen" }], condition_templates: [], inspection_drafts: [], inspection_history: [],
  assets: [{ id: "asset-1", asset_code: "QA-1", name: "Staging QA Blender", category_id: "cat-1", category_name: "Kitchen", location: "Bar", unit: "unit", current_quantity: 2, minimum_quantity: 1, condition: "healthy", maintenance: [] }],
};

describe("Crew Assets Mobile", () => {
  it("renders the safe outlet asset projection and capability actions", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    expect(await screen.findByText("Staging QA Blender")).not.toBeNull();
    fireEvent.click(screen.getByText("Staging QA Blender"));
    expect(screen.getByRole("button", { name: /Adjust Asset/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Inspect Asset/i })).not.toBeNull();
  });

  it("opens the adjustment sheet from asset detail", async () => {
    crewService.assetsMobile.mockResolvedValue(payload);
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    fireEvent.click(screen.getByRole("button", { name: /Adjust Asset/i }));
    expect(screen.getByRole("heading", { name: "Adjust Asset" })).not.toBeNull();
    expect(screen.getByLabelText("Quantity").value).toBe("2");
    expect(screen.getByRole("button", { name: "Save adjustment" })).not.toBeNull();
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
    crewService.assetsMobile.mockResolvedValue({ ...payload, can_adjust_assets: false, can_perform_asset_inspections: false });
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Staging QA Blender"));
    expect(screen.queryByRole("button", { name: /Adjust Asset/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Inspect Asset/i })).toBeNull();
  });

  it("shows an explicit access/read error rather than an empty list", async () => {
    crewService.assetsMobile.mockRejectedValue(new Error("Crew Asset access is unavailable."));
    render(<CrewAssetsMobile token="token" onBack={() => {}} />);
    expect(await screen.findByText("Assets unavailable")).not.toBeNull();
    expect(screen.getByText("Crew Asset access is unavailable.")).not.toBeNull();
  });
});
