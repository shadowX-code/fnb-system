import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmployeeDisciplinaryPanel from "../EmployeeDisciplinaryPanel.jsx";
import { employeeDisciplinaryService } from "../../../../services/employeeDisciplinaryService.js";

vi.mock("../../../../services/employeeDisciplinaryService.js", () => ({
  employeeDisciplinaryService: { adminDetail: vi.fn(), listTypes: vi.fn().mockResolvedValue([{ code: "warning", label: "Warning" }, { code: "advisory_reminder", label: "Advisory / Reminder" }, { code: "general_notice", label: "General Notice" }]), saveDraft: vi.fn(), uploadEvidence: vi.fn(), issue: vi.fn(), transition: vi.fn(), adminEvidence: vi.fn() },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const historical = {
  id: "warning-1", display_sequence: 1, warning_type: "first_written_warning", subject: "Legacy issued warning",
  incident_date: "2026-09-01", issued_date: "2026-09-02", warning_details: "Details", required_action: "Improve",
  status: "viewed", activity: [], has_evidence: false,
};

describe("Employee Letters & Notices", () => {
  it("shows history context, future warning levels, related history and the shared evidence picker", async () => {
    employeeDisciplinaryService.adminDetail.mockResolvedValue({ warnings: [historical] });
    render(<EmployeeDisciplinaryPanel employeeId="employee-1" employeeName="QA Crew" canView canManage ui={{ notify: vi.fn() }} />);
    await waitFor(() => expect(screen.getByText("Legacy issued warning")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Create Letter or Notice/i }));
    expect(screen.getByText("1 previous warning")).not.toBeNull();
    expect(screen.getByText("Letters & Notices")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Document Type/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Warning Type.*does not escalate automatically/i })).not.toBeNull();
    expect(screen.getByText("Written Warning")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Related Previous Warning/i })).not.toBeNull();
    expect(screen.getByLabelText("Choose evidence")).not.toBeNull();
    expect(screen.getByText(/does not escalate automatically/i)).not.toBeNull();
  });

  it("shows generic content without warning-only fields for an advisory", async () => {
    employeeDisciplinaryService.adminDetail.mockResolvedValue({ records: [] });
    employeeDisciplinaryService.saveDraft.mockResolvedValue({ id: "advisory-draft" });
    render(<EmployeeDisciplinaryPanel employeeId="employee-1" employeeName="QA Crew" canView canManage ui={{ notify: vi.fn() }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Create Letter or Notice/i }));
    fireEvent.click(screen.getByRole("button", { name: /Document Type/i }));
    fireEvent.click(await screen.findByText("Advisory / Reminder"));
    expect(screen.getByText("Letter / Notice Content")).not.toBeNull();
    expect(screen.queryByText("Incident Date")).toBeNull();
    expect(screen.queryByText("Expected Improvement / Required Action")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Concise description of the matter"), { target: { value: "Workplace reminder" } });
    fireEvent.change(screen.getByPlaceholderText("Write the formal communication to this employee."), { target: { value: "Please review the updated process." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(employeeDisciplinaryService.saveDraft).toHaveBeenCalled());
    expect(employeeDisciplinaryService.saveDraft.mock.calls[0][0].payload).toEqual({
      document_type: "advisory_reminder", subject: "Workplace reminder", body: "Please review the updated process.", issued_date: expect.any(String),
    });
  });

  it("presents receipt evidence separately from the full activity history", async () => {
    employeeDisciplinaryService.adminDetail.mockResolvedValue({ warnings: [{
      ...historical,
      delivered_at: "2026-09-21T01:30:00Z",
      first_viewed_at: "2026-09-21T02:00:00Z",
      acknowledged_at: null,
      response: { text: "My response remains independent.", submitted_at: "2026-09-21T02:10:00Z" },
    }] });
    render(<EmployeeDisciplinaryPanel employeeId="employee-1" employeeName="QA Crew" canView canManage ui={{ notify: vi.fn() }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Legacy issued warning/ }));
    expect(await screen.findByText("Receipt evidence")).not.toBeNull();
    expect(screen.getByText("21/09/2026 9:30 am")).not.toBeNull();
    expect(screen.getByText("21/09/2026 10:00 am")).not.toBeNull();
    expect(screen.getByText("Not acknowledged")).not.toBeNull();
    expect(screen.getByText("Submitted 21/09/2026 10:10 am")).not.toBeNull();
    expect(screen.getByText("Activity")).not.toBeNull();
  });
});
