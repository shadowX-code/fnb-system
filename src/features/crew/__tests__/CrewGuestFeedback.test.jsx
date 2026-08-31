import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ crew: vi.fn(), entry: vi.fn(), submit: vi.fn(), submitByToken: vi.fn() }));
vi.mock("../../../services/crewService.js", () => ({ crewService: { publicFeedbackCrew: mocks.crew, publicFeedbackEntry: mocks.entry, submitPublicFeedback: mocks.submit, submitPublicFeedbackByToken: mocks.submitByToken } }));
import CrewGuestFeedback from "../CrewGuestFeedback.jsx";

beforeEach(() => { window.history.replaceState(null, "", "/#feedback?outlet=outlet-1"); sessionStorage.clear(); mocks.crew.mockReset().mockResolvedValue({ outlet: { id: "outlet-1", name: "Friends Corner", public_feedback_token: "a".repeat(36) }, crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", on_shift: true }] }); mocks.entry.mockReset(); mocks.submit.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" }); mocks.submitByToken.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" }); });
afterEach(cleanup);
describe("Public guest feedback", () => {
  it("binds feedback to the selected outlet and Crew without a score field", async () => {
    render(<CrewGuestFeedback />);
    fireEvent.click(await screen.findByRole("button", { name: /Alex Tan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Great.*positive experience/ }));
    fireEvent.click(screen.getByRole("button", { name: "Friendly" }));
    fireEvent.click(screen.getByRole("button", { name: /Submit feedback/i }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1", employeeId: "employee-1", experience: "great" })));
    expect(mocks.submit.mock.calls[0][0]).not.toHaveProperty("score");
    expect(await screen.findByText(/Thank you/)).not.toBeNull();
    expect(window.location.pathname).toBe(`/feedback/${"a".repeat(36)}`);
  });

  it("uses the stable token entry and never sends an outlet UUID", async () => {
    window.history.replaceState(null, "", `/feedback/${"b".repeat(36)}`);
    mocks.entry.mockResolvedValue({ outlet: { name: "Friends Corner", public_feedback_token: "b".repeat(36) }, crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", on_shift: true }] });
    render(<CrewGuestFeedback />);
    fireEvent.click(await screen.findByRole("button", { name: /Alex Tan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Great.*positive experience/ }));
    fireEvent.click(screen.getByRole("button", { name: /Submit feedback/i }));
    await waitFor(() => expect(mocks.submitByToken).toHaveBeenCalledWith(expect.objectContaining({ outletToken: "b".repeat(36), employeeId: "employee-1" })));
    expect(mocks.submitByToken.mock.calls[0][0]).not.toHaveProperty("outletId");
    expect(mocks.crew).not.toHaveBeenCalled();
  });

  it("shows a graceful unavailable state for an invalid public token", async () => {
    window.history.replaceState(null, "", "/feedback/not-a-real-outlet");
    mocks.entry.mockRejectedValue(new Error("Feedback link is unavailable."));
    render(<CrewGuestFeedback />);
    expect(await screen.findByText("Feedback link unavailable")).not.toBeNull();
    expect(screen.getByText("Feedback link is unavailable.")).not.toBeNull();
  });
});
