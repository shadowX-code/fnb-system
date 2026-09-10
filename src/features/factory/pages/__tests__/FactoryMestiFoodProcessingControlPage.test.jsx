import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryMestiFoodProcessingControlPage from "../FactoryMestiFoodProcessingControlPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

const awaitingRow = {
  id: "production-1",
  production_date: "2026-09-03",
  production_no: "PRD-1",
  batch_no: "B-1",
  product_name: "Black Pepper Sauce - 1kg Pack",
  finished_good_id: "finished-good-1",
  product_code: "S01",
  variant_name: "1kg Pack",
  qc_summary: "Passed · 3/3",
  qc_checks: [{ id: "qc-1", qc_name: "Temperature", result: "pass", notes: "72 C", recorded_at: "2026-09-04T01:30:00.000Z" }],
  start_time: "09:53:00",
  completed_at: "2026-09-03T10:42:00+08:00",
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
    vi.spyOn(factoryService, "getProductionEvidence").mockResolvedValue(null);
    render(<FactoryMestiFoodProcessingControlPage />);

    expect(await screen.findByText("Black Pepper Sauce")).toBeTruthy();
    expect(screen.getByText("S01 · 1kg Pack")).toBeTruthy();
    expect(screen.queryByText("Black Pepper Sauce - 1kg Pack")).toBeNull();
    expect(screen.getAllByText("03/09/2026")).toHaveLength(3);
    expect(screen.getByText("09:53 AM")).toBeTruthy();
    expect(screen.getByText("10:42 AM")).toBeTruthy();
    expect(screen.getByText("Passed · 3/3")).toBeTruthy();
    expect(screen.getByText("Awaiting Verification")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View Black Pepper Sauce - 1kg Pack" }));
    expect(await screen.findByText("Food Processing Evidence")).toBeTruthy();
    expect(screen.getByText("QC Evidence")).toBeTruthy();
    expect(screen.getByText("Temperature")).toBeTruthy();
    expect(screen.getByText("72 C")).toBeTruthy();
    expect(screen.getAllByText("Awaiting Verification").length).toBeGreaterThan(0);
  });

  it("presents a verified actor and timestamp without a redundant status badge", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([{ ...awaitingRow, verification_status: "verified", verified_by_name: "Mei Ling", verified_at: "2026-09-03T11:15:00+08:00" }]);
    render(<FactoryMestiFoodProcessingControlPage />);

    expect(await screen.findByText("Mei Ling")).toBeTruthy();
    expect(screen.getByText("03/09/2026 11:15 AM")).toBeTruthy();
    expect(screen.queryByText("Awaiting Verification")).toBeNull();
  });

  it("keeps unavailable QC evidence non-actionable", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([{ ...awaitingRow, qc_summary: "Evidence unavailable", qc_checks: [] }]);
    vi.spyOn(factoryService, "getProductionEvidence").mockResolvedValue(null);
    render(<FactoryMestiFoodProcessingControlPage />);

    expect(await screen.findByText("Evidence unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View QC evidence/i })).toBeNull();
  });

  it("sends canonical report filters to the projection service", async () => {
    const list = vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([]);
    render(<FactoryMestiFoodProcessingControlPage />);

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ verificationStatus: "", product: "" }));
  });
});
