import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ bank: vi.fn(), preparation: vi.fn() }));
vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { readBankInfo: mocks.bank } }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: {
  readCalculation: async () => ({ results: [] }), readStatutory: async () => ({ results: [] }),
  readTime: async () => [], readPcb: async () => ({ results: [{employee_id:"e1"},{employee_id:"e2"}] }), readPreparation: mocks.preparation,
} }));
import PayrollRunEmployeesPanel from "../PayrollRunEmployeesPanel.jsx";
afterEach(cleanup);
describe("Review Payroll bank visibility", () => {
  it("places Bank before Status and batches the canonical Employee read without affecting calculation status", async () => {
    mocks.preparation.mockResolvedValue({ results: [{ employee_id: "e1", projection: { employee_name: "QA One" } },
      { employee_id: "e2", projection: { employee_name: "QA Two" } }] });
    mocks.bank.mockResolvedValue([{ id: "e1", bank_name: "Maybank", bank_account_name: "QA", bank_account_number: "123" },
      { id: "e2", bank_name: "" }]);
    render(<PayrollRunEmployeesPanel run={{ id: "run", status: "draft" }} entityId="entity" month="2026-09" data={{employees:[{id:"e1",name:"QA One"},{id:"e2",name:"QA Two"}]}} stage="review" />);
    await screen.findByRole("button", { name: "View bank information for QA One" });
    expect(screen.getByRole("button",{name:/QA Two — incomplete/})).toBeTruthy();
    expect(mocks.bank).toHaveBeenCalledWith(["e1", "e2"]);
    expect(mocks.bank).toHaveBeenCalledTimes(1);
    const headers = screen.getAllByRole("columnheader").map(header => header.textContent);
    expect(headers[headers.indexOf("Status") - 1]).toBe("Bank");
    await waitFor(() => expect(screen.getAllByText("Pending Review").length).toBeGreaterThan(0));
    expect(screen.queryByText("123")).toBeNull();
  });
});
