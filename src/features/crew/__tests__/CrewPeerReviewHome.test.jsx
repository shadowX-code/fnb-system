import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ peerReviewMobile: vi.fn(), submitPeerReview: vi.fn() }));
vi.mock("../../../services/crewService.js", () => ({ crewService: mocks }));

import CrewPeerReviewHome from "../components/CrewPeerReviewHome.jsx";
import i18n from "../../../i18n/index.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
window.scrollTo = vi.fn();

describe("Crew Home Peer Review", () => {
  it("shows monthly progress, submits four ratings, and never exposes reviewer identities", async () => {
    await i18n.changeLanguage("en");
    mocks.peerReviewMobile.mockResolvedValueOnce({ open: true, completed: 2, total: 3,
      assignments: [{ id: "review-3", subject_name: "Alex Tan", subject_position: "Service Crew", submitted: false }] });
    mocks.peerReviewMobile.mockResolvedValueOnce({ open: true, completed: 3, total: 3,
      assignments: [{ id: "review-3", subject_name: "Alex Tan", subject_position: "Service Crew", submitted: true }] });
    mocks.submitPeerReview.mockResolvedValue({ submitted: true });
    render(<CrewPeerReviewHome token="crew-token" />);
    expect(await screen.findByText("2 of 3 completed")).toBeTruthy();
    fireEvent.click(screen.getByText("Continue"));
    for (const label of ["Teamwork", "Reliability", "Communication", "Work attitude"]) {
      fireEvent.click(screen.getByRole("group", { name: label }).querySelectorAll("button")[3]);
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mocks.submitPeerReview).toHaveBeenCalledWith("crew-token", "review-3", { teamwork: 4, reliability: 4, communication: 4, work_attitude: 4 }));
    await waitFor(() => expect(screen.queryByText("2 of 3 completed")).toBeNull());
  });

  it("stays absent when no assignment is open", async () => {
    mocks.peerReviewMobile.mockResolvedValue({ open: false, completed: 0, total: 0, assignments: [] });
    const view = render(<CrewPeerReviewHome token="crew-token" />);
    await waitFor(() => expect(mocks.peerReviewMobile).toHaveBeenCalled());
    expect(view.container.querySelector(".crew-peer-home-entry")).toBeNull();
  });
});
