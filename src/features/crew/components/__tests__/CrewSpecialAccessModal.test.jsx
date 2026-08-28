import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewSpecialAccessModal from "../CrewSpecialAccessModal.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { updateCashOperationsAccess: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Special Access", () => {
  const employee = { id: "employee-1", full_name: "Crew QA", workplace: "Friends Corner", crew_access: { access_state: "active", can_initiate_handover: false } };

  it("updates the per-account Hand Over Cash capability without exposing Admin roles", async () => {
    crewService.updateCashOperationsAccess.mockResolvedValue({ can_initiate_handover: true });
    render(<CrewSpecialAccessModal employee={employee} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Hand Over Cash" }).checked).toBe(false);
    expect(screen.queryByText(/Admin Role/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hand Over Cash" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(crewService.updateCashOperationsAccess).toHaveBeenCalledWith("employee-1", true));
  });
});
