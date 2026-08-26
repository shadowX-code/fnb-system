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

  it("keeps the confirmed deposit balance primary and labels the pending-receipt-adjusted balance precisely", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, deposit: { ...payload.deposit, current_balance: 500, available_balance: 400 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByText("Cash Deposit Balance")).not.toBeNull();
    expect(screen.getByText("RM 500.00")).not.toBeNull();
    expect(screen.getByText("Available to collect: RM 400.00")).not.toBeNull();
    expect(screen.queryByText("Available balance: RM 400.00")).toBeNull();
  });

  it("presents recent activity as a continuous audit list with a dedicated ledger control", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Recent Activity" })).not.toBeNull();
    expect(screen.getAllByText("Cash Checkout").length).toBeGreaterThan(1);
    expect(screen.getByText("+RM 500.00")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Cash Checkout in ledger" }));
    expect((await screen.findAllByRole("heading", { name: "Cash Deposit" })).length).toBeGreaterThan(1);
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

  it("keeps the canonical opening context readable, removes Actual Opening, and places POS cash before denominations", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, checkout: { status: "draft", actual_opening_cash: 350, opening_variance_reason: "stale explanation", denomination_counts: {}, carry_forward: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.getByText("Expected opening")).not.toBeNull();
    expect(screen.queryByLabelText("Actual opening")).toBeNull();
    expect(screen.queryByText("Enter each MYR denomination. FeedX calculates the total on the server.")).toBeNull();
    const pos = screen.getByLabelText("POS closing cash");
    const denominations = screen.getByLabelText("Denomination Count");
    expect(Boolean(pos.compareDocumentPosition(denominations) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("announces a successful draft only after the server confirms it", async () => {
    const onNotify = vi.fn();
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} onNotify={onNotify} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith({ title: "Saved to draft", tone: "success" }));
  });

  it("uses canonical error feedback when a draft save fails", async () => {
    const onNotify = vi.fn();
    crewService.saveCashCheckout.mockRejectedValueOnce(new Error("Draft rejected"));
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} onNotify={onNotify} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith({ title: "Unable to save Cash Checkout", message: "Draft rejected", tone: "error" }));
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

  it("keeps Summary outside the three-step flow and groups denomination work for mobile counting", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(screen.queryByRole("navigation", { name: "Cash Checkout progress" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(screen.getByRole("navigation", { name: "Cash Checkout progress" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Notes" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Coins" })).not.toBeNull();
    expect(screen.getByLabelText("RM 100").getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByText("Counted cash")).not.toBeNull();
    expect(screen.getAllByText("RM 0.00").length).toBeGreaterThan(1);
  });

  it("keeps allocation and confirm carry-forward labels unambiguous", async () => {
    crewService.cashCheckoutMobile.mockResolvedValueOnce(payload).mockResolvedValueOnce({ ...payload, checkout: { status: "reconciled", denomination_counts: { "100": 5, "50": 1 }, pos_expected_cash: 500, carry_forward: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByLabelText("RM 100"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("RM 50"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("POS closing cash"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: Allocate/ }));
    await screen.findByText("Allocate closing cash");
    expect(screen.getByLabelText("Carry Forward for next cycle")).not.toBeNull();
    expect(screen.getAllByText("For deposit").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: /Next: Confirm/ }));
    await screen.findByText("Review Cash Checkout");
    expect(screen.getByRole("heading", { name: "Reconciliation" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Allocation" })).not.toBeNull();
    expect(screen.getByText("Previous Carry Forward")).not.toBeNull();
    expect(screen.getByText("Carry Forward for next cycle")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Submit RM\s*250\.00 for Review/ })).not.toBeNull();
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
