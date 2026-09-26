import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PayrollMonthlyBasicBreakdown from "../PayrollMonthlyBasicBreakdown.jsx";
afterEach(cleanup);
const basis = { monthly_salary: 3000, employment_reduction: 1000, unpaid_leave_reduction: 100,
  payable_basic_salary: 1900, period_start: "2026-09-01", period_end: "2026-09-30",
  employment_start: "2026-09-11", employment_end: "2026-09-30", eligible_days: 19,
  employed_days: 20, period_days: 30, unpaid_days: 1, unpaid_dates: ["2026-09-20"] };
it("renders the pinned breakdown and dates without a second deduction or editable amount", () => {
  render(<PayrollMonthlyBasicBreakdown line={{source:{monthly_entitlement:basis}}} />);
  expect(screen.getByText("Payable Basic Salary")).toBeTruthy();
  expect(screen.getByText(/19 eligible \/ 30 calendar days/)).toBeTruthy();
  expect(screen.getByText("2026-09-20")).toBeTruthy();
  expect(screen.getByText(/1,900.00/)).toBeTruthy();
  expect(screen.queryByRole("spinbutton")).toBeNull();
});
it("preserves older frozen statements and keeps full-month salary compact", () => {
  const {container,rerender}=render(<PayrollMonthlyBasicBreakdown line={{amount:3000}} />);
  expect(container.textContent).toBe("");
  rerender(<PayrollMonthlyBasicBreakdown line={{source:{monthly_entitlement:{...basis, employed_days:30, unpaid_days:0}}}} />);
  expect(container.textContent).toBe("");
});
