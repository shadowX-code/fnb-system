import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmployeeCompliancePage from "../EmployeeCompliancePage.jsx";

const service = vi.hoisted(() => ({ adminPage: vi.fn(), review: vi.fn(), adminEvidenceUrl: vi.fn() }));
vi.mock("../../../../services/employeeComplianceService.js", () => ({ employeeComplianceService: service }));
const requirement = (code, status, extra = {}) => ({ requirement_id: code, requirement_code: code, requirement_name: code === "typhoid_injection" ? "Typhoid Injection" : "Food Handler Certificate", requires_expiry: code === "typhoid_injection", state: { status, ...extra } });
const employee = { employee_id: "employee-1", full_name: "Compliance Crew", position: "Kitchen Crew", outlet_name: "Friends Corner", overall_status: "pending_verification", requirements: [requirement("food_handler_certificate", "verified"), requirement("typhoid_injection", "pending_verification", { pending_submission_id: "submission-1", pending_expiry_date: "2026-12-31" })] };
const mount = () => render(<EmployeeCompliancePage store={{ outlets: [{ id: "outlet-1", name: "Friends Corner" }] }} auth={{ isProtectedRole: true, hasPermission: () => true }} />);

beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear();
  service.adminPage.mockResolvedValue({ rows: [employee], totalCount: 1, page: 1, pageSize: 20, summary: { compliant: 0, needs_verification: 1, expiring_soon: 0, missing_or_expired: 0 } });
});
afterEach(cleanup);

describe("Employee compliance registry", () => {
  it("renders one employee row with both canonical requirement states and employee-level paging", async () => {
    mount();
    expect(await screen.findByText("Compliance Crew")).toBeTruthy();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("Compliant")).toBeTruthy();
    expect(within(rows[1]).getAllByText("Needs Verification")).toHaveLength(2);
    expect(within(rows[1]).getByText("Expires 31 Dec 2026")).toBeTruthy();
    expect(screen.getByText(/Showing 1–1 of 1 employees/)).toBeTruthy();
    expect(screen.getByText(/Employee counts for the current filters/)).toBeTruthy();
  });

  it("passes requirement and status together to the server without removing the other requirement column", async () => {
    mount(); await screen.findByText("Compliance Crew");
    fireEvent.click(screen.getByRole("button", { name: "Requirement" }));
    fireEvent.click(screen.getByRole("button", { name: "Typhoid Injection" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByRole("button", { name: "Missing", exact: true }));
    await waitFor(() => expect(service.adminPage).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { query: "", requirement: "typhoid_injection", status: "missing" }, page: 1 })));
    expect(screen.getByRole("columnheader", { name: "Food Handler Certificate" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Typhoid Injection" })).toBeTruthy();
  });

  it("opens employee details and retains the existing protected review command", async () => {
    mount(); await screen.findByText("Compliance Crew");
    fireEvent.click(screen.getByRole("button", { name: "View Compliance Crew compliance" }));
    fireEvent.click(screen.getByRole("button", { name: "Review Typhoid Injection" }));
    const verify = screen.getByRole("button", { name: "Verify" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("alert").textContent).toContain("Enter a rejection reason");
    expect(service.review).not.toHaveBeenCalled();
    service.review.mockResolvedValue({ decision: "verified" });
    fireEvent.click(verify);
    await waitFor(() => expect(service.review).toHaveBeenCalledTimes(1));
    expect(service.review).toHaveBeenCalledWith({ submissionId: "submission-1", decision: "verified", rejectionReason: "" });
    await waitFor(() => expect(service.adminPage.mock.calls.length).toBeGreaterThan(1));
  });
});
