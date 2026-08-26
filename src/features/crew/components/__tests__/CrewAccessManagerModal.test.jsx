import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewAccessManagerModal from "../CrewAccessManagerModal.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  manageAccess: vi.fn(),
  updateCashOperationsAccess: vi.fn(),
} }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Access Cash Operations", () => {
  const employee = {
    id: "employee-1",
    full_name: "Crew QA",
    position: "Service Crew",
    workplace: "Friends Corner",
    contact: "+601155500299",
    crew_access: { access_state: "active", can_initiate_handover: false },
  };

  it("manages Hand Over Cash under Crew Access without exposing Admin role controls", async () => {
    crewService.updateCashOperationsAccess.mockResolvedValue({ can_initiate_handover: true });
    render(<CrewAccessManagerModal employee={employee} mode="reset" onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("heading", { name: "Cash Operations" })).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Hand Over Cash" }).checked).toBe(false);
    expect(screen.queryByText(/Admin Role/)).not.toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hand Over Cash" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Cash Operations" }));
    await waitFor(() => expect(crewService.updateCashOperationsAccess).toHaveBeenCalledWith("employee-1", true));
  });

  it("does not offer capability configuration before Crew Access exists", () => {
    render(<CrewAccessManagerModal employee={{ ...employee, crew_access: null }} onClose={() => {}} />);
    expect(screen.getByText("Enable Crew Access before configuring Hand Over Cash.")).not.toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Hand Over Cash" })).toBeNull();
  });
});
