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
  it("keeps balances semantic and uses the canonical Crew date field instead of native date inputs", async () => {
    crewService.myLeave.mockResolvedValue({
      ...payload,
      balances: [
        { entitlement_id: "annual-entitlement", leave_type: "annual", available: 2, pending: 0, used: 3, balance_enforced: true },
        { entitlement_id: "unpaid-entitlement", leave_type: "unpaid", available: null, pending: 0, used: 0, balance_enforced: false },
      ],
    });
    render(<CrewLeaveMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByText("2 days", { selector: ".crew-leave-balance-card strong" })).not.toBeNull();
    expect(screen.getByText("Available", { selector: ".crew-leave-balance-unit" })).not.toBeNull();
    expect(screen.getByText("0 pending · 3 used")).not.toBeNull();
    expect(screen.getByText("Unlimited", { selector: ".crew-leave-balance-card strong" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apply Leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelectorAll(".crew-leave-date-grid .crew-date-picker-field")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Start Date" }));
    expect(screen.getByRole("dialog", { name: "Start Date" })).not.toBeNull();
  });

  it("uses the shared selected owner and Mint operational surfaces throughout Apply Leave", async () => {
    render(<CrewLeaveMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply Leave" }));

    fireEvent.click(screen.getByRole("button", { name: /Medical Leave \/ MC/ }));
    const selectedType = screen.getByRole("button", { name: /Medical Leave \/ MC/ });
    expect(selectedType.closest(".crew-ui-choice-list")?.classList.contains("crew-ui-choice-list--mint")).toBe(true);
    expect(selectedType.classList.contains("is-selected")).toBe(true);
    expect(selectedType.querySelector(".crew-ui-icon-container.is-selected")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const balance = document.querySelector(".crew-leave-balance-preview");
    expect(balance?.classList.contains("crew-ui-note--mint")).toBe(true);
    expect(balance?.querySelector(".crew-ui-icon-container")).not.toBeNull();
    expect(screen.getByText("Available")).not.toBeNull();
    expect(screen.getByText("Requested")).not.toBeNull();
    expect(screen.getByText("After")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const documentInfo = screen.getByText("Supporting document not uploaded").closest(".crew-ui-note--mint");
    expect(documentInfo?.querySelector(".crew-ui-icon-container")).not.toBeNull();
  });
});
