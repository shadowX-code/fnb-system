import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryMestiOperatorHygienePage from "../FactoryMestiOperatorHygienePage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: {
  getMestiOperatorHygieneDaily: vi.fn(),
  listMestiOperatorHygieneMonthly: vi.fn(),
  saveMestiOperatorHygiene: vi.fn(),
  submitMestiOperatorHygiene: vi.fn(),
  verifyMestiOperatorHygiene: vi.fn(),
} }));

const permissions = ["factory_mesti_operator_hygiene.view", "factory_mesti_operator_hygiene.manage", "factory_mesti_operator_hygiene.submit", "factory_mesti_operator_hygiene.verify"];
const draftDaily = {
  session: { id: "session-1", inspection_date: "2026-09-03", status: "draft" },
  employees: [{ id: "emp-1", name: "Aisha", position: "Operator" }, { id: "emp-2", name: "Ben", position: "Packer" }],
  entries: [{ id: "entry-1", employee_id: "emp-1", employee_snapshot: { employee_name: "Aisha", position: "Operator" }, clothing_result: "pass", hygiene_result: "pass", overall_result: "compliant", issue: "", action_taken: "", notes: "" }],
};
const submittedDaily = {
  ...draftDaily,
  session: { id: "session-1", inspection_date: "2026-09-03", status: "submitted", submitted_by: "employee-1", submitted_by_name: "Current User", submitted_at: "2026-09-03T01:00:00Z" },
};
const monthlyRows = [{
  employee_id: "emp-1",
  employee_name: "Aisha",
  position: "Operator",
  summary: { inspected_count: 1, compliant_count: 0, non_compliant_count: 1 },
  days: {
    "2026-09-03": {
      entry_id: "entry-1",
      state: "non_compliant",
      session_status: "verified",
      clothing_result: "fail",
      hygiene_result: "pass",
      overall_result: "non_compliant",
      issue: "Apron missing",
      action_taken: "Replaced apron",
      submitted_by_name: "Mira",
      submitted_at: "2026-09-03T01:00:00Z",
      verified_by_name: "Nora",
      verified_at: "2026-09-03T02:00:00Z",
    },
  },
}];

function renderPage({ daily = draftDaily } = {}) {
  factoryService.getMestiOperatorHygieneDaily.mockResolvedValue(daily);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={(permission) => permissions.includes(permission)}><FactoryMestiOperatorHygienePage auth={{ profile: { id: "employee-1" } }} onNotify={vi.fn()} /></FactoryPermissionsProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  factoryService.getMestiOperatorHygieneDaily.mockResolvedValue(draftDaily);
  factoryService.listMestiOperatorHygieneMonthly.mockResolvedValue(monthlyRows);
  factoryService.saveMestiOperatorHygiene.mockResolvedValue({});
  factoryService.submitMestiOperatorHygiene.mockResolvedValue({});
  factoryService.verifyMestiOperatorHygiene.mockRejectedValue(new Error("Self-verification is not allowed."));
});

afterEach(cleanup);

describe("Factory MeSTI Operator Hygiene", () => {
  it("uses canonical Employee selection and Mark All Pass in the Daily draft", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Operator Hygiene Inspection" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Operator" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ben - Packer" }));
    await waitFor(() => expect(factoryService.saveMestiOperatorHygiene).toHaveBeenCalledWith(expect.objectContaining({ entries: expect.arrayContaining([expect.objectContaining({ employee_id: "emp-2" })]) })));
    fireEvent.click(screen.getByRole("button", { name: "Mark All Pass" }));
    await waitFor(() => expect(factoryService.saveMestiOperatorHygiene).toHaveBeenCalledWith(expect.objectContaining({ entries: [expect.objectContaining({ clothing_result: "pass", hygiene_result: "pass", issue: "", action_taken: "" })] })));
  });

  it("shows session evidence and blocks self-verification errors", async () => {
    renderPage({ daily: submittedDaily });
    expect(await screen.findByText("Submitted")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mark All Pass" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Session Details" }));
    const dialog = await screen.findByRole("dialog", { name: /Inspection Session/ });
    expect(within(dialog).getByText("Inspected Count")).not.toBeNull();
    expect(within(dialog).getByText("Compliant Count")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Close modal"));
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Self-verification is not allowed.");
  });

  it("renders the Monthly employee-centric matrix and opens employee-date details", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    expect(await screen.findByText("Aisha")).not.toBeNull();
    expect(screen.getByText("1 inspected · 0 compliant · 1 non-compliant")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Aisha on/ }));
    const dialog = await screen.findByRole("dialog", { name: "Aisha" });
    expect(within(dialog).getByText("Apron missing")).not.toBeNull();
    expect(within(dialog).getByText("Replaced apron")).not.toBeNull();
    expect(within(dialog).getByText("Nora")).not.toBeNull();
  });
});
