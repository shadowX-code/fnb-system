import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ read: vi.fn(), dimensions: vi.fn(), window: vi.fn(), exclude: vi.fn(), assess: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  teamReviewAdmin: mocks.read,
  teamReviewAdminDimensions: mocks.dimensions,
  setTeamReviewWindow: mocks.window,
  excludeTeamReview: mocks.exclude,
  submitTeamAdminReview: mocks.assess,
} }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewTeamReviewAdminPage from "../CrewTeamReviewAdminPage.jsx";

const store = { outlets: [{ id: "outlet-1", name: "Friends Corner", is_active: true }] };
const auth = { hasPermission: (permission) => permission === "crew_performance.review" };
const data = {
  window: { status: "closed", frozen: true, closes_at: "2026-09-03T00:00:00Z" },
  summary: { eligible_crew: 2, reviews_received: 1, ready: 1, admin_required: 1 },
  employees: [
    { employee_id: "alex", employee_name: "Alex Tan", eligible_teammates: 1, reviews_received: 1, score: 4.5, source: "crew", status: "ready" },
    { employee_id: "mina", employee_name: "Mina Lee", eligible_teammates: 1, reviews_received: 0, score: null, source: null, status: "admin_review_required" },
  ],
  reviews: [{ id: "review-1", subject_id: "alex", subject_name: "Alex Tan", reviewer_name: "Mina Lee", criteria: { teamwork: 5, reliability: 4, communication: 5, work_attitude: 4 }, work_evidence: { attendance_overlaps: 2, roster_overlap: true }, comment: "Helped during rush", submitted_at: "2026-08-30T02:00:00Z", eligible: true }],
  window_events: [],
};

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue(data);
  mocks.dimensions.mockReset().mockResolvedValue({ teamwork: 5, reliability: 4, communication: 5, work_attitude: 4 });
  mocks.window.mockReset().mockResolvedValue({});
  mocks.exclude.mockReset().mockResolvedValue({});
  mocks.assess.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe("Team Review Admin workspace", () => {
  it("shows outlet/month progress, source and protected review evidence", async () => {
    render(<CrewTeamReviewAdminPage auth={auth} store={store} />);
    expect(await screen.findByRole("heading", { name: "Team Review" })).not.toBeNull();
    expect(await screen.findByText("Alex Tan")).not.toBeNull();
    expect(screen.getByText("Admin Reviews Required")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Team Review for Alex Tan" }));
    const dialog = screen.getByRole("dialog", { name: "Alex Tan" });
    expect(await within(dialog).findByText(/Teamwork 5.00/)).not.toBeNull();
    expect(within(dialog).getByText("Mina Lee")).not.toBeNull();
    expect(within(dialog).getByText(/Helped during rush/)).not.toBeNull();
    expect(within(dialog).getByText(/Published roster overlap/)).not.toBeNull();
  });

  it("requires an audit reason to exclude while leaving evidence visible", async () => {
    render(<CrewTeamReviewAdminPage auth={auth} store={store} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("button", { name: "View Team Review for Alex Tan" }));
    fireEvent.click(screen.getByRole("button", { name: "Exclude Review" }));
    const dialog = screen.getByRole("dialog", { name: "Exclude Team Review" });
    const submit = within(dialog).getByRole("button", { name: "Exclude Review" });
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason" }), { target: { value: "Duplicate review evidence" } });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.exclude).toHaveBeenCalledWith("review-1", "Duplicate review evidence"));
  });

  it("offers Admin fallback only after close when no valid reviews remain", async () => {
    mocks.dimensions.mockResolvedValue({ teamwork: null, reliability: null, communication: null, work_attitude: null });
    render(<CrewTeamReviewAdminPage auth={auth} store={store} />);
    await screen.findByText("Mina Lee");
    fireEvent.click(screen.getByRole("button", { name: "View Team Review for Mina Lee" }));
    expect(screen.queryByText(/Teamwork 0.00/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Complete Admin Review" }));
    const dialog = screen.getByRole("dialog", { name: "Admin Review" });
    expect(within(dialog).getByRole("button", { name: "Submit Admin Review" }).disabled).toBe(true);
    for (const name of ["Teamwork", "Reliability", "Communication", "Work Attitude"])
      fireEvent.click(within(dialog).getByRole("button", { name: `${name}: 4 Often` }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Admin Review" }));
    await waitFor(() => expect(mocks.assess).toHaveBeenCalledWith("mina", expect.any(String), { teamwork: 4, reliability: 4, communication: 4, work_attitude: 4 }));
  });

  it("shows the final review day rather than the exclusive midnight close boundary", async () => {
    mocks.read.mockResolvedValue({
      ...data,
      window: { status: "open", closes_at: "2026-10-02T16:00:00Z" },
      employees: [{ ...data.employees[1], status: "provisional" }],
    });
    render(<CrewTeamReviewAdminPage auth={auth} store={store} />);
    expect(await screen.findByText(/Open until 2 Oct 2026/)).not.toBeNull();
    expect(screen.getAllByText("Awaiting reviews").every((item) => item.classList.contains("is-pending"))).toBe(true);
  });
});
