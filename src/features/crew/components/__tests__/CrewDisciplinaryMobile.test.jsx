import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewDisciplinaryMobile from "../CrewDisciplinaryMobile.jsx";
import { employeeDisciplinaryService } from "../../../../services/employeeDisciplinaryService.js";

vi.mock("../../../../services/employeeDisciplinaryService.js", () => ({
  employeeDisciplinaryService: {
    crewOverview: vi.fn(), crewDetail: vi.fn(), crewEvidence: vi.fn(), crewRespond: vi.fn(), crewAcknowledge: vi.fn(),
  },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const warning = { id: "warning-1", warning_type: "first_written_warning", subject: "Attendance procedure", issued_date: "2026-09-20", status: "delivered", viewed_at: null };
const detail = { ...warning, incident_date: "2026-09-19", warning_details: "The issued warning text.", required_action: "Follow the documented procedure.", outlet_name_snapshot: "QA Outlet", has_evidence: false, response: null };

describe("Crew Warnings & Notices", () => {
  it("shows compact status-driven warning cards", async () => {
    employeeDisciplinaryService.crewOverview.mockResolvedValue({ warnings: [warning] });
    render(<CrewDisciplinaryMobile token="opaque-token" onBack={() => {}} />);
    expect(await screen.findByText("Attendance procedure")).not.toBeNull();
    expect(screen.getByText("Delivered")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review" })).not.toBeNull();
  });

  it("loads exact issued detail and records the view through the canonical authority", async () => {
    employeeDisciplinaryService.crewOverview.mockResolvedValue({ warnings: [warning] });
    employeeDisciplinaryService.crewDetail.mockResolvedValue({ ...detail, status: "viewed", first_viewed_at: "2026-09-21T02:00:00Z" });
    render(<CrewDisciplinaryMobile token="opaque-token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    await waitFor(() => expect(employeeDisciplinaryService.crewDetail).toHaveBeenCalledWith("opaque-token", "warning-1"));
    expect(await screen.findByText("The issued warning text.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Acknowledge Receipt" })).not.toBeNull();
  });

  it("presents receipt acknowledgement without agreement or admission wording", async () => {
    employeeDisciplinaryService.crewOverview.mockResolvedValue({ warnings: [warning] });
    employeeDisciplinaryService.crewDetail.mockResolvedValue({ ...detail, status: "viewed" });
    render(<CrewDisciplinaryMobile token="opaque-token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge Receipt" }));
    expect(screen.getByText(/does not necessarily mean that you agree/i)).not.toBeNull();
    expect(screen.queryByText(/admit misconduct/i)).toBeNull();
  });
});
