import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewComplianceMobile from "../CrewComplianceMobile.jsx";
import { employeeComplianceService } from "../../../../services/employeeComplianceService.js";

vi.mock("../../../../services/employeeComplianceService.js", () => ({
  employeeComplianceService: { crewOverview: vi.fn(), crewEvidenceUrl: vi.fn(), submit: vi.fn() },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const requirement = (status, extra = {}) => ({
  requirement_code: `requirement-${status}`,
  requirement_name: status === "missing" ? "Food Handler Certificate" : "Typhoid Injection",
  requires_expiry: status !== "missing",
  status,
  ...extra,
});

describe("Crew Documents & Compliance", () => {
  it("uses the shared Crew page-section rhythm around the requirement list", async () => {
    employeeComplianceService.crewOverview.mockResolvedValue({ requirements: [requirement("missing"), requirement("verified", { effective_submission_id: "verified" })] });
    const { container } = render(<CrewComplianceMobile token="opaque-token" onBack={() => {}} />);
    await screen.findByRole("button", { name: "Add Document" });
    const section = container.querySelector(".crew-ui-page-section");
    expect(section).not.toBeNull();
    expect(section.querySelector(".crew-compliance-list").children).toHaveLength(2);
  });

  it("presents one canonical next action for each lifecycle state", async () => {
    employeeComplianceService.crewOverview.mockResolvedValue({ requirements: [
      requirement("missing"),
      requirement("pending_verification", { pending_submission_id: "pending", pending_submitted_at: "2026-09-20T09:00:00Z" }),
      requirement("verified", { effective_submission_id: "verified", effective_expiry_date: "2027-09-20" }),
      requirement("expiring_soon", { effective_submission_id: "expiring", effective_expiry_date: "2026-10-01" }),
      requirement("expired", { effective_submission_id: "expired", effective_expiry_date: "2026-08-01" }),
      requirement("rejected", { rejected_submission_id: "rejected", rejection_reason: "Photo is unclear." }),
    ] });
    render(<CrewComplianceMobile token="opaque-token" onBack={() => {}} />);
    expect(await screen.findByRole("button", { name: "Add Document" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "View Submission" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "View" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Renew" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Resubmit" })).not.toBeNull();
    expect(screen.getByText("Photo is unclear.")).not.toBeNull();
  });

  it("opens an existing submission through the private signed-read authority", async () => {
    employeeComplianceService.crewOverview.mockResolvedValue({ requirements: [requirement("pending_verification", { pending_submission_id: "submission-1", pending_submitted_at: "2026-09-20T09:00:00Z" })] });
    employeeComplianceService.crewEvidenceUrl.mockResolvedValue("https://signed.example/evidence.webp");
    render(<CrewComplianceMobile token="opaque-token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "View Submission" }));
    await waitFor(() => expect(employeeComplianceService.crewEvidenceUrl).toHaveBeenCalledWith("opaque-token", "submission-1"));
    expect(await screen.findByRole("button", { name: /View full image/ })).not.toBeNull();
    expect(screen.getByAltText("Compliance evidence").getAttribute("src")).toBe("https://signed.example/evidence.webp");
  });

  it("uses the shared bottom-sheet submission grammar and keeps submit disabled until evidence exists", async () => {
    employeeComplianceService.crewOverview.mockResolvedValue({ requirements: [requirement("missing")] });
    render(<CrewComplianceMobile token="opaque-token" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Document" }));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText("Take Photo")).not.toBeNull();
    expect(screen.getByText("Choose from Library")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Submit for Review" }).disabled).toBe(true);
  });
});
