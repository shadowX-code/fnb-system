import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrewLeaveMobile from "../CrewLeaveMobile.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  myLeave: vi.fn(), submitLeave: vi.fn(), cancelLeave: vi.fn(),
} }));

const payload = {
  balances: [{ entitlement_id: "medical-entitlement", leave_type: "medical", available: 8, pending: 0, used: 2, balance_enforced: true }],
  requests: [], upcoming: [],
};

beforeEach(() => { crewService.myLeave.mockResolvedValue(payload); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Leave mobile", () => {
  it("uses the shared selected owner and Mint operational surfaces throughout Apply Leave", async () => {
    render(<CrewLeaveMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply Leave" }));

    fireEvent.click(screen.getByRole("button", { name: /Medical Leave \/ MC/ }));
    const selectedType = screen.getByRole("button", { name: /Medical Leave \/ MC/ });
    expect(selectedType.classList.contains("is-selected")).toBe(true);
    expect(selectedType.querySelector(".crew-ui-icon-container.is-selected")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const balance = document.querySelector(".crew-leave-balance-preview");
    expect(balance?.classList.contains("crew-ui-note")).toBe(true);
    expect(balance?.querySelector(".crew-ui-icon-container")).not.toBeNull();
    expect(screen.getByText("Available")).not.toBeNull();
    expect(screen.getByText("Requested")).not.toBeNull();
    expect(screen.getByText("After")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const documentInfo = screen.getByText("Supporting document not uploaded").closest(".crew-ui-note");
    expect(documentInfo?.querySelector(".crew-ui-icon-container")).not.toBeNull();
  });
});
