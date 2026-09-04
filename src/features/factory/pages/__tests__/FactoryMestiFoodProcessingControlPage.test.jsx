import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryMestiFoodProcessingControlPage from "../FactoryMestiFoodProcessingControlPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

const awaitingRow = {
  id: "production-1",
  production_date: "2026-09-04",
  production_no: "PRD-1",
  batch_no: "B-1",
  product_name: "QA Sauce",
  finished_good_id: "finished-good-1",
  product_code: "QA-1",
  qc_summary: "Passed · 3/3",
  start_time: "09:00:00",
  completed_at: "2026-09-04T02:00:00.000Z",
  good_output_qty: 10,
  uom: "pack",
  expiry_date: "2026-12-04",
  notes: "QA evidence",
  completed_by_name: "Completer",
  verification_status: "awaiting_verification",
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory MeSTI Food Processing Control", () => {
  it("projects completed Production evidence and keeps verification state in the detail drawer", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([awaitingRow]);
    render(<FactoryMestiFoodProcessingControlPage />);

    expect(await screen.findByText("QA Sauce")).toBeTruthy();
    expect(screen.getByText("Passed · 3/3")).toBeTruthy();
    expect(screen.getByText("Awaiting Verification")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View QA Sauce" }));
    expect(await screen.findByText("Food Processing Evidence")).toBeTruthy();
    expect(screen.getAllByText("Completed By").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Awaiting Verification").length).toBeGreaterThan(0);
  });

  it("sends canonical report filters to the projection service", async () => {
    const list = vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([]);
    render(<FactoryMestiFoodProcessingControlPage />);

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ verificationStatus: "", product: "" }));
  });
});
