import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmployeeDisciplinaryPanel from "../EmployeeDisciplinaryPanel.jsx";
import { employeeDisciplinaryService } from "../../../../services/employeeDisciplinaryService.js";

vi.mock("../../../../services/employeeDisciplinaryService.js", () => ({
  employeeDisciplinaryService: { adminDetail: vi.fn(), saveDraft: vi.fn(), uploadEvidence: vi.fn(), issue: vi.fn(), transition: vi.fn(), adminEvidence: vi.fn() },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const historical = {
  id: "warning-1", display_sequence: 1, warning_type: "first_written_warning", subject: "Legacy issued warning",
  incident_date: "2026-09-01", issued_date: "2026-09-02", warning_details: "Details", required_action: "Improve",
  status: "viewed", activity: [], has_evidence: false,
};

describe("Employee disciplinary creation", () => {
  it("shows history context, future warning levels, related history and the shared evidence picker", async () => {
    employeeDisciplinaryService.adminDetail.mockResolvedValue({ warnings: [historical] });
    render(<EmployeeDisciplinaryPanel employeeId="employee-1" employeeName="QA Crew" canView canManage ui={{ notify: vi.fn() }} />);
    await waitFor(() => expect(screen.getByText("Legacy issued warning")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Create Warning/i }));
    expect(screen.getByText("1 previous warning")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Warning Type.*does not escalate automatically/i })).not.toBeNull();
    expect(screen.getByText("Written Warning")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Related Previous Warning/i })).not.toBeNull();
    expect(screen.getByLabelText("Choose evidence")).not.toBeNull();
    expect(screen.getByText(/does not escalate automatically/i)).not.toBeNull();
  });
});
