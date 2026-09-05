import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FactoryMestiRawMaterialControlPage from "../FactoryMestiRawMaterialControlPage.jsx";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: { listMestiRawMaterialControlStandards: vi.fn(), listMestiRawMaterialControlReceivingReport: vi.fn() } }));
import { factoryService } from "../../../../services/factoryService.js";

const row = { id: "item-1", receiving_no: "R-1", received_at: "2026-09-04T10:00:00Z", item_name: "Black Pepper", supplier_name: "Supplier", received_qty: 2, uom: "pack", storage_location: "Raw Store", acceptance_procedure_snapshot: "Check seal", control_methods_snapshot: "Visual", received_by_name: "Ahmad", verification_status: "awaiting_verification", verified_by_name: "", reference_no: "DO-1" };
beforeEach(() => { factoryService.listMestiRawMaterialControlStandards.mockResolvedValue([{ raw_material_id: "rm-1", item: "Black Pepper", material_code: "RM-1", acceptance_procedure: "Check seal", control_methods: "Visual" }]); factoryService.listMestiRawMaterialControlReceivingReport.mockResolvedValue([row]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Factory MeSTI Raw Material Control", () => {
  it("projects canonical control standards and receiving evidence without CRUD", async () => {
    render(<FactoryMestiRawMaterialControlPage />);
    expect(await screen.findByText("Black Pepper")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /new|save|record/i })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Receiving Report" }));
    expect(await screen.findByText("Awaiting Verification")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Black Pepper" }));
    expect(await screen.findByText("Receiving Evidence")).not.toBeNull();
    expect(screen.getAllByText("Check seal")).not.toHaveLength(0);
  });
  it("passes report filters to the canonical projection", async () => {
    render(<FactoryMestiRawMaterialControlPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Receiving Report" }));
    await screen.findByText("Black Pepper");
    fireEvent.click(screen.getByRole("button", { name: "Verification" }));
    fireEvent.click(await screen.findByText("Verified"));
    await waitFor(() => expect(factoryService.listMestiRawMaterialControlReceivingReport).toHaveBeenLastCalledWith(expect.objectContaining({ verificationStatus: "verified" })));
  });
});
