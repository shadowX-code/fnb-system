import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ bank: vi.fn(), preparation: vi.fn() }));
vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { readBankInfo: mocks.bank } }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: {
  readCalculation: async () => ({ results: [] }), readStatutory: async () => ({ results: [] }),
  readPcb: async () => ({ results: [] }), readPreparation: mocks.preparation,
} }));
import PayrollRunCalculationPanel from "../PayrollRunCalculationPanel.jsx";
afterEach(cleanup);
describe("Review Payroll bank visibility", () => {
  it("places Bank Info after Net Pay and batches the canonical Employee read without affecting calculation status", async () => {
    mocks.preparation.mockResolvedValue({ results: [{ employee_id: "e1", projection: { employee_name: "QA One" } },
      { employee_id: "e2", projection: { employee_name: "QA Two" } }] });
    mocks.bank.mockResolvedValue([{ id: "e1", bank_name: "Maybank", bank_account_name: "QA", bank_account_number: "123" },
      { id: "e2", bank_name: "" }]);
    render(<PayrollRunCalculationPanel run={{ id: "run", status: "draft" }} stage="review" />);
    await screen.findByRole("button", { name: "View bank information for QA One" });
    expect(screen.getByText("Missing")).toBeTruthy();
    expect(mocks.bank).toHaveBeenCalledWith(["e1", "e2"]);
    expect(mocks.bank).toHaveBeenCalledTimes(1);
    const headers = screen.getAllByRole("columnheader").map(header => header.textContent);
    expect(headers[headers.indexOf("Net Pay") + 1]).toBe("Bank Info");
    await waitFor(() => expect(screen.getAllByText("Needs Attention").length).toBeGreaterThan(0));
    expect(screen.queryByText("123")).toBeNull();
  });
});
