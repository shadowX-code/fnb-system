import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewCashCheckoutMobile from "../CrewCashCheckoutMobile.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  cashCheckoutMobile: vi.fn(), saveCashCheckout: vi.fn(), recordCashCollection: vi.fn(), confirmCashCollection: vi.fn(),
} }));

const payload = {
  outlet: { id: "outlet-1", name: "Friends Corner" }, business_date: "2026-08-21", can_perform: true, can_record_collection: true,
  settings: { floating_cash: 300, variance_tolerance: 5 }, cash_context: { floating_cash: 300, previous_carry_forward: 50, expected_opening_cash: 350 }, checkout: null,
  deposit: { current_balance: 500, available_balance: 500, recent: [{ id: "l1", occurred_at: "2026-08-20T10:00:00+08:00", activity: "Cash Checkout · QA", signed_amount: 500, balance_after: 500 }], ledger: [{ id: "l1", occurred_at: "2026-08-20T10:00:00+08:00", activity: "Cash Checkout · QA", signed_amount: 500, balance_after: 500 }] },
  receivers: [{ id: "employee-2", name: "Receiver QA", position: "Supervisor" }], pending_receipts: [],
};

beforeEach(() => {
  crewService.cashCheckoutMobile.mockResolvedValue(payload);
  crewService.saveCashCheckout.mockResolvedValue({ checkout: { status: "reconciled" } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Cash Checkout mobile", () => {
  it("renders the server-scoped checkout and deposit summary", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Cash Checkout" })).not.toBeNull();
    expect(screen.getByText("Today’s Checkout")).not.toBeNull();
    expect(screen.getByText("RM 500.00")).not.toBeNull();
    expect(screen.queryByText("Count outlet cash")).toBeNull();
    expect(screen.getByText("RM 300.00")).not.toBeNull();
    expect(screen.getByText("RM 50.00")).not.toBeNull();
    expect(crewService.cashCheckoutMobile).toHaveBeenCalledWith("opaque-session", expect.any(String));
  });

  it("calculates a live denomination preview but sends raw counts to server authority", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByText("Count outlet cash");
    fireEvent.change(screen.getByLabelText("RM 100"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("RM 0.5"), { target: { value: "2" } });
    expect(screen.getByText("RM 401.00")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(crewService.saveCashCheckout).toHaveBeenCalledWith("opaque-session", "draft", expect.objectContaining({ denomination_counts: expect.objectContaining({ "100": "4", "0.50": "2" }) })));
    const sent = crewService.saveCashCheckout.mock.calls[0][2];
    expect(sent).not.toHaveProperty("counted_cash");
    expect(sent).not.toHaveProperty("variance");
  });

  it("keeps a canonical zero opening variance clear, including a stale resumed reason", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, checkout: { status: "draft", actual_opening_cash: 350, opening_variance_reason: "stale explanation", denomination_counts: {}, carry_forward: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.queryByText("Opening Variance")).toBeNull();
    expect(screen.queryByText("Explain the opening difference")).toBeNull();
  });

  it("requires an explanation only while the opening variance is non-zero and clears it on return to expected", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    const opening = screen.getByLabelText("Actual opening");
    fireEvent.change(opening, { target: { value: "330" } });
    expect(screen.getByText("Opening Variance")).not.toBeNull();
    expect(screen.getByText("Opening Variance").parentElement.textContent).toContain("-RM");
    expect(screen.getByText("Opening Variance").parentElement.textContent).toContain("20.00");
    expect(screen.getByLabelText("Explain the opening difference")).not.toBeNull();
    fireEvent.change(opening, { target: { value: "370" } });
    expect(screen.getByText("Opening Variance").parentElement.textContent).toContain("+RM");
    expect(screen.getByText("Opening Variance").parentElement.textContent).toContain("20.00");
    fireEvent.change(opening, { target: { value: "350" } });
    expect(screen.queryByText("Opening Variance")).toBeNull();
    expect(screen.queryByLabelText("Explain the opening difference")).toBeNull();
  });

  it("uses touch-friendly denomination steppers without allowing negative quantities", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    const quantity = screen.getByLabelText("RM 100");
    expect(quantity.value).toBe("0");
    expect(screen.getByRole("button", { name: "Decrease RM 100" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Increase RM 100" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase RM 100" }));
    expect(quantity.value).toBe("2");
    expect(screen.getAllByText("RM 200.00").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Decrease RM 100" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease RM 100" }));
    expect(quantity.value).toBe("0");
    expect(screen.getByRole("button", { name: "Decrease RM 100" }).disabled).toBe(true);
    fireEvent.change(quantity, { target: { value: "4" } });
    expect(screen.getAllByText("RM 400.00").length).toBeGreaterThan(0);
  });

  it("restores saved count quantities through the existing checkout draft payload", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, checkout: { status: "draft", actual_opening_cash: 350, denomination_counts: { "100": 4, "0.50": 2 }, carry_forward: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("RM 100").value).toBe("4");
    expect(screen.getByLabelText("RM 0.5").value).toBe("2");
    expect(screen.getByText("RM 401.00")).not.toBeNull();
  });

  it("shows a compact immutable completion state and opens the server snapshot", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, checkout: { status: "completed", completed_at: "2026-08-21T22:30:00+08:00", business_date: "2026-08-21", checked_out_by: "QA Crew", position: "Service Crew", floating_cash: 300, previous_carry_forward: 50, expected_opening_cash: 350, denomination_counts: { 100: 8, 50: 1 }, counted_cash: 850, pos_expected_cash: 850, variance: 0, carry_forward: 0, amount_for_deposit: 500 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByText("Completed at 10:30 pm")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Complete Checkout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(screen.getByRole("heading", { name: "Checkout Details" })).not.toBeNull();
    expect(screen.getByText("RM100 × 8")).not.toBeNull();
    expect(screen.getByText("This checkout is completed and cannot be edited.")).not.toBeNull();
  });

  it("keeps internal handover receipt confirmation session-bound", async () => {
    crewService.confirmCashCollection.mockResolvedValue({ status: "completed" });
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, pending_receipts: [{ id: "handover-1", amount: 100, purpose: "Bank run", sender: "Sender QA" }] });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(crewService.confirmCashCollection).toHaveBeenCalledWith("opaque-session", "handover-1", 100));
  });

  it("opens a server-backed ledger with each entry balance", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    await screen.findAllByRole("button", { name: "View ledger" });
    fireEvent.click(screen.getAllByRole("button", { name: "View ledger" })[0]);
    expect((await screen.findAllByRole("heading", { name: "Cash Deposit" })).length).toBe(2);
    expect(screen.getByText(/Balance.*500\.00/)).not.toBeNull();
  });
});
