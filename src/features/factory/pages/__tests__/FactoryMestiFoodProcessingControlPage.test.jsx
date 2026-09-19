import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryMestiFoodProcessingControlPage from "../FactoryMestiFoodProcessingControlPage.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
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
  start_date: "2026-09-03",
  completion_date: "2026-09-02",
  completion_time: "17:00:00",
  completed_at: "2026-09-03T10:42:00+08:00",
  good_output_qty: 10,
  uom: "pack",
  expiry_date: "2026-12-04",
  notes: "QA evidence",
  completed_by_name: "Completer",
  verification_status: "awaiting_verification",
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderPage(permissionSet = []) {
  return render(<FactoryPermissionsProvider permissionSet={permissionSet} can={(permission) => permissionSet.includes(permission)}><FactoryMestiFoodProcessingControlPage /></FactoryPermissionsProvider>);
}

describe("Factory MeSTI Food Processing Control", () => {
  it("projects completed Production evidence and keeps verification state in the detail drawer", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([awaitingRow]);
    vi.spyOn(factoryService, "getProductionEvidence").mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText("Black Pepper Sauce")).toBeTruthy();
    expect(screen.getByText("S01 · 1kg Pack")).toBeTruthy();
    expect(screen.queryByText("Black Pepper Sauce - 1kg Pack")).toBeNull();
    expect(screen.getAllByText("03/09/2026")).toHaveLength(2);
    expect(screen.getByText("02/09/2026")).toBeTruthy();
    expect(screen.getByText("09:53 AM")).toBeTruthy();
    expect(screen.getByText("05:00 PM")).toBeTruthy();
    expect(screen.getByText("Passed · 3/3")).toBeTruthy();
    expect(screen.getByText("Awaiting Verification")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View Black Pepper Sauce - 1kg Pack" }));
    expect(await screen.findByText("Food Processing Evidence")).toBeTruthy();
    expect(screen.getByText("QC Evidence")).toBeTruthy();
    expect(screen.getByText("Recorded At")).toBeTruthy();
    expect(screen.getByText("Temperature")).toBeTruthy();
    expect(screen.getByText("72 C")).toBeTruthy();
    expect(screen.getAllByText("Awaiting Verification").length).toBeGreaterThan(0);
  });

  it("presents a verified actor and timestamp without a redundant status badge", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([{ ...awaitingRow, verification_status: "verified", verified_by_name: "Mei Ling", verified_at: "2026-09-03T11:15:00+08:00" }]);
    renderPage();

    expect(await screen.findByText("Mei Ling")).toBeTruthy();
    expect(screen.getByText("03/09/2026 11:15 AM")).toBeTruthy();
    expect(screen.queryByText("Awaiting Verification")).toBeNull();
  });

  it("keeps unavailable QC evidence non-actionable", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([{ ...awaitingRow, qc_summary: "Evidence unavailable", qc_checks: [] }]);
    vi.spyOn(factoryService, "getProductionEvidence").mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText("Evidence unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View QC evidence/i })).toBeNull();
  });

  it("shows No QC Required only when the pinned SOP has no QC points", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([{ ...awaitingRow, qc_summary: "No QC Required", qc_requirement_status: "no_qc_required", qc_required_count: 0, qc_evidence_count: 0 }]);
    renderPage();

    expect(await screen.findByText("No QC Required")).toBeTruthy();
    expect(screen.queryByText("Evidence unavailable")).toBeNull();
    expect(screen.queryByRole("button", { name: /View QC evidence/i })).toBeNull();
  });

  it("uses the canonical Production verification authority when Role Settings permits Verify", async () => {
    const list = vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([awaitingRow]);
    const verify = vi.spyOn(factoryService, "verifyProductionRecord").mockResolvedValue({ verification_status: "verified" });
    renderPage(["factory_production.verify"]);

    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));

    await waitFor(() => expect(verify).toHaveBeenCalledWith(awaitingRow));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it("does not expose Verify without the canonical permission", async () => {
    vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([awaitingRow]);
    renderPage();

    expect(await screen.findByText("Awaiting Verification")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("sends canonical report filters to the projection service", async () => {
    const list = vi.spyOn(factoryService, "listMestiFoodProcessingControl").mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ verificationStatus: "", product: "" }));
  });
});
