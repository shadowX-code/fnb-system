import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CrewAccessManagerModal from "../CrewAccessManagerModal.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { manageAccess: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Access credential management", () => {
  const employee = {
    id: "employee-1",
    full_name: "Crew QA",
    position: "Service Crew",
    workplace: "Friends Corner",
    contact: "+601155500299",
    crew_access: { access_state: "active", can_initiate_handover: false },
  };

  it("keeps passcode handling separate from Special Access and Admin roles", () => {
    render(<CrewAccessManagerModal employee={employee} mode="reset" onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("heading", { name: "Reset Crew Passcode" })).not.toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Hand Over Cash" })).toBeNull();
    expect(screen.queryByText("Cash Operations")).toBeNull();
    expect(screen.queryByText(/Admin Role/)).toBeNull();
  });

  it("uses the correct reset completion copy and leaves weak-passcode authority to the server", async () => {
    crewService.manageAccess.mockResolvedValue({ mobile_number: "+601155500299", temporary_passcode: "2222" });
    render(<CrewAccessManagerModal employee={employee} mode="reset" onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByText(/common or repeated passcode/i)).toBeNull();
    screen.getByRole("button", { name: "Reset Passcode" }).click();
    expect(await screen.findByRole("heading", { name: "Passcode Reset" })).not.toBeNull();
    expect(screen.getByText(/A new passcode is ready for Crew QA/)).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Crew Access Enabled" })).toBeNull();
  });
});
