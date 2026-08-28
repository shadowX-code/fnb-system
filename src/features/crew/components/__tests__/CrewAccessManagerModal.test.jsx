import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CrewAccessManagerModal from "../CrewAccessManagerModal.jsx";

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
});
