import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ crew: vi.fn(), submit: vi.fn() }));
vi.mock("../../../services/crewService.js", () => ({ crewService: { publicFeedbackCrew: mocks.crew, submitPublicFeedback: mocks.submit } }));
import CrewGuestFeedback from "../CrewGuestFeedback.jsx";

beforeEach(() => { window.location.hash = "#feedback?outlet=outlet-1"; sessionStorage.clear(); mocks.crew.mockReset().mockResolvedValue({ outlet: { id: "outlet-1", name: "Friends Corner" }, crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", on_shift: true }] }); mocks.submit.mockReset().mockResolvedValue({ id: "feedback-1", status: "received" }); });
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
  });
});
