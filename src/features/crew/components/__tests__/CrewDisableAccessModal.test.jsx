import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewDisableAccessModal from "../CrewDisableAccessModal.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: { manageAccess: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Access disable", () => {
  const employee = { id: "employee-1", full_name: "Crew QA" };

  it("prevents duplicate submits and maps unexpected RPC failures to safe copy", async () => {
    let rejectDisable;
    crewService.manageAccess.mockImplementation(() => new Promise((_, reject) => { rejectDisable = reject; }));
    render(<CrewDisableAccessModal employee={employee} onClose={() => {}} onSaved={() => {}} />);
    const disable = screen.getByRole("button", { name: "Disable Access" });
    fireEvent.click(disable);
    expect(disable.disabled).toBe(true);
    fireEvent.click(disable);
    expect(crewService.manageAccess).toHaveBeenCalledTimes(1);
    rejectDisable(new Error('relation "crew_sessions" does not exist'));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Unable to disable Crew Access."));
  });
});
