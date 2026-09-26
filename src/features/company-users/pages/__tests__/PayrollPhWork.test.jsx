import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ readPhWork: vi.fn(), confirmPhWork: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: mocks }));
import PayrollPhWork from "../PayrollPhWork.jsx";
afterEach(cleanup);
const work = { work_date: "2026-08-31", source_fingerprint: "exact-evidence", recommended_treatment: "additional_pay",
  policy: { id: "policy" }, time: { approved_minutes: 300 }, compensation: { pay_basis: "hourly", hourly_rate: 15 },
  additional_amount: 75, formula: "Effective Hourly Rate × approved PH hours", issue: "ph_treatment_confirmation_required",
  source: { paid_holiday_policy: { holidays: [{ name: "QA PH" }] }, scheduled_start_at: "2026-08-31T01:00Z", scheduled_end_at: "2026-08-31T07:00Z", clock_in_at: "2026-08-31T01:00Z", clock_out_at: "2026-08-31T07:00Z" } };
beforeEach(() => { vi.clearAllMocks(); mocks.readPhWork.mockResolvedValue([work]); mocks.confirmPhWork.mockResolvedValue("decision"); });
it("uses approved hours, retains source evidence and submits only treatment intent", async () => {
 const changed = vi.fn(); render(<PayrollPhWork runId="run" employeeId="employee" canManage onChanged={changed} />);
 await screen.findByText(/QA PH/); expect(screen.getByText("5.00 h")).toBeTruthy();
 expect(screen.getByText(/RM\s*75/)).toBeTruthy();
 fireEvent.click(screen.getByRole("button", { name: "Use Recommended Treatment" }));
 await waitFor(() => expect(changed).toHaveBeenCalledOnce());
 const intent = mocks.confirmPhWork.mock.calls[0][0];
 expect(intent).toMatchObject({ runId: "run", employeeId: "employee", workDate: "2026-08-31", treatment: "additional_pay", fingerprint: "exact-evidence" });
 expect(intent.amount).toBeUndefined(); expect(intent.actor).toBeUndefined();
});
it("shows a confirmed source-linked leave grant without a monetary benefit", async () => {
 mocks.readPhWork.mockResolvedValue([{ ...work, issue: null, grant_id: "grant", decision: { treatment: "replacement_leave" } }]);
 render(<PayrollPhWork runId="run" employeeId="employee" canManage={false} />);
 await screen.findByText(/1 day granted/); expect(screen.queryByText(/RM\s*75/)).toBeNull();
 expect(screen.queryByRole("button", { name: "Change Treatment" })).toBeNull();
});
it("does not manufacture a work case on an empty canonical projection", async () => {
 mocks.readPhWork.mockResolvedValue([]); const { container } = render(<PayrollPhWork runId="run" employeeId="employee" canManage />);
 await waitFor(() => expect(container.innerHTML).toBe("")); expect(mocks.confirmPhWork).not.toHaveBeenCalled();
});
it("keeps the same request identity when a consequential transport retry fails", async () => {
 mocks.confirmPhWork.mockRejectedValueOnce(new Error("Offline"));
 render(<PayrollPhWork runId="run" employeeId="employee" canManage />);
 fireEvent.click(await screen.findByRole("button", { name: "Use Recommended Treatment" }));
 await screen.findByText("Offline");
 fireEvent.click(screen.getByRole("button", { name: "Confirm Treatment" }));
 await waitFor(() => expect(mocks.confirmPhWork).toHaveBeenCalledTimes(2));
 expect(mocks.confirmPhWork.mock.calls[1][0].requestId).toBe(mocks.confirmPhWork.mock.calls[0][0].requestId);
});
