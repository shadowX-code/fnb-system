import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ teamReviewMobile: vi.fn(), submitTeamReview: vi.fn() }));
vi.mock("../../../services/crewService.js", () => ({ crewService: mocks }));

import CrewTeamReviewHome from "../components/CrewTeamReviewHome.jsx";
import i18n from "../../../i18n/index.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
window.scrollTo = vi.fn();

describe("Crew Home Team Review", () => {
  it("shows every teammate, submits four ratings and an optional Admin-only comment, then confirms success", async () => {
    await i18n.changeLanguage("en");
    mocks.teamReviewMobile.mockResolvedValueOnce({ period_start: "2026-09-01", open: true, completed: 1, total: 2,
      teammates: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", reviewed: false }, { id: "employee-2", name: "Mina Lee", position: "Service Crew", reviewed: true }] });
    mocks.teamReviewMobile.mockResolvedValueOnce({ period_start: "2026-09-01", open: true, completed: 2, total: 2,
      teammates: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", reviewed: true }, { id: "employee-2", name: "Mina Lee", position: "Service Crew", reviewed: true }] });
    mocks.submitTeamReview.mockResolvedValue({ submitted: true });
    render(<CrewTeamReviewHome token="crew-token" employeeId="reviewer-1" />);
    expect(await screen.findByText("Team Review is open")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.getByText("1 reviewed · 1 available")).toBeTruthy();
    fireEvent.click(screen.getByText("Review team"));
    expect(screen.getByText("Mina Lee")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Alex Tan/ }));
    for (const label of ["Teamwork", "Reliability", "Communication", "Work attitude"]) {
      fireEvent.click(screen.getByRole("group", { name: label }).querySelectorAll("button")[3]);
    }
    fireEvent.change(screen.getByPlaceholderText("Private context for Admin"), { target: { value: "Helpful during service" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mocks.submitTeamReview).toHaveBeenCalledWith("crew-token", "2026-09-01", "employee-1", { teamwork: 4, reliability: 4, communication: 4, work_attitude: 4 }, "Helpful during service"));
    expect(await screen.findByText("Review submitted")).toBeTruthy();
    expect(screen.getAllByText("You're all caught up").length).toBeGreaterThan(0);
  });

  it("stays absent when no eligible unreviewed teammate is available", async () => {
    mocks.teamReviewMobile.mockResolvedValue({ open: true, completed: 0, total: 0, teammates: [] });
    const view = render(<CrewTeamReviewHome token="crew-token" />);
    await waitFor(() => expect(mocks.teamReviewMobile).toHaveBeenCalled());
    expect(view.container.querySelector(".crew-team-home-entry")).toBeNull();
  });

  it("prompts once per employee and month without interrupting later Home visits", async () => {
    mocks.teamReviewMobile.mockResolvedValue({ period_start: "2026-09-01", deadline: "2026-10-02T16:00:00Z", open: true, completed: 0, total: 1,
      teammates: [{ id: "employee-1", name: "Alex Tan", position: "Kitchen Crew", reviewed: false }] });
    const first = render(<CrewTeamReviewHome token="crew-token" employeeId="reviewer-1" />);
    expect(await screen.findByText("Team Review is open")).toBeTruthy();
    expect(screen.getByText("Closes 2 Oct 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    first.unmount();
    render(<CrewTeamReviewHome token="crew-token" employeeId="reviewer-1" />);
    expect(await screen.findByText("Teammates available to review: 1")).toBeTruthy();
    expect(screen.queryByText("Team Review is open")).toBeNull();
  });
});
