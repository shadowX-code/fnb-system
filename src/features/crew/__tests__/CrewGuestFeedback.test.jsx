import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ crew: vi.fn(), entry: vi.fn(), submit: vi.fn(), submitV2: vi.fn() }));
vi.mock("../../../services/crewService.js", () => ({ crewService: { publicFeedbackCrew: mocks.crew, publicFeedbackEntry: mocks.entry, submitPublicFeedback: mocks.submit, submitPublicFeedbackV2: mocks.submitV2 } }));
import CrewGuestFeedback from "../CrewGuestFeedback.jsx";
const token = "a".repeat(36);
const response = { outlet: { id: "outlet-1", name: "Friends Corner", public_feedback_token: token }, crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", on_shift: true }] };
beforeEach(() => { window.history.replaceState(null, "", "/#feedback?outlet=outlet-1"); sessionStorage.clear(); mocks.crew.mockReset().mockResolvedValue(response); mocks.entry.mockReset().mockResolvedValue(response); mocks.submit.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" }); mocks.submitV2.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" }); });
afterEach(cleanup);
describe("Public guest feedback", () => {
  it("submits Crew evidence with the selected employee and preserves legacy URL compatibility", async () => {
    render(<CrewGuestFeedback />); fireEvent.click(await screen.findByRole("button", { name: /Crew Member/ })); fireEvent.click(screen.getByRole("button", { name: /Alex Tan/ })); fireEvent.click(screen.getByRole("button", { name: /Great.*Loved it/ })); fireEvent.click(screen.getByRole("button", { name: "Friendly" })); fireEvent.click(screen.getByRole("button", { name: /Send Feedback/i }));
    await waitFor(() => expect(mocks.submitV2).toHaveBeenCalledWith(expect.objectContaining({ outletToken: token, scope: "crew", employeeId: "employee-1", positiveTags: ["Friendly"], improvementTags: [] })));
    expect(await screen.findByText(/Thank you for sharing/)).not.toBeNull(); expect(window.location.pathname).toBe(`/feedback/${token}`);
  });
  it("submits Food feedback without Crew attribution or Performance-scoring fields", async () => {
    window.history.replaceState(null, "", `/feedback/${token}`); render(<CrewGuestFeedback />); fireEvent.click(await screen.findByRole("button", { name: /Food & Drinks/ })); fireEvent.click(screen.getByRole("button", { name: /Needs Improvement.*Could be better/ })); fireEvent.click(screen.getByRole("button", { name: "Temperature" })); fireEvent.change(screen.getByRole("textbox"), { target: { value: "Arrived cool" } }); fireEvent.click(screen.getByRole("button", { name: /Send Feedback/i }));
    await waitFor(() => expect(mocks.submitV2).toHaveBeenCalledWith(expect.objectContaining({ scope: "food", employeeId: null, positiveTags: [], improvementTags: ["Temperature"], comment: "Arrived cool" })));
  });
  it("submits Outlet feedback with its canonical tags", async () => {
    window.history.replaceState(null, "", `/feedback/${token}`); render(<CrewGuestFeedback />); fireEvent.click(await screen.findByRole("button", { name: /Overall Visit/ })); fireEvent.click(screen.getByRole("button", { name: /Great.*Loved it/ })); fireEvent.click(screen.getByRole("button", { name: "Atmosphere" })); fireEvent.click(screen.getByRole("button", { name: /Send Feedback/i }));
    await waitFor(() => expect(mocks.submitV2).toHaveBeenCalledWith(expect.objectContaining({ scope: "outlet", employeeId: null, positiveTags: ["Atmosphere"] })));
  });
  it("shows a graceful unavailable state for an invalid public token", async () => { window.history.replaceState(null, "", "/feedback/not-a-real-outlet"); mocks.entry.mockRejectedValue(new Error("Feedback link is unavailable.")); render(<CrewGuestFeedback />); expect(await screen.findByText("Feedback link unavailable")).not.toBeNull(); });
});
