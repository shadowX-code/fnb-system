import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewCashCheckoutMobile from "../CrewCashCheckoutMobile.jsx";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  cashCheckoutMobile: vi.fn(), cashCheckoutHistory: vi.fn(), saveCashCheckout: vi.fn(), recordCashCollection: vi.fn(), confirmCashCollection: vi.fn(),
} }));

const payload = {
  outlet: { id: "outlet-1", name: "Friends Corner" }, business_date: "2026-08-21", can_perform: true, can_initiate_handover: true, can_record_collection: true,
  settings: { floating_cash: 300, variance_tolerance: 5 }, cash_context: { floating_cash: 300, previous_carry_forward: 50, expected_opening_cash: 350 }, checkout: null,
  deposit: { current_balance: 500, available_balance: 500, recent: [{ id: "l1", occurred_at: "2026-08-20T10:00:00+08:00", activity: "Cash Checkout · QA", signed_amount: 500, balance_after: 500 }], ledger: [{ id: "l1", occurred_at: "2026-08-20T10:00:00+08:00", activity: "Cash Checkout · QA", signed_amount: 500, balance_after: 500 }] },
  receivers: [{ id: "employee-2", name: "Receiver QA", position: "Supervisor" }], pending_receipts: [],
};

beforeEach(() => {
  crewService.cashCheckoutMobile.mockResolvedValue(payload);
  crewService.cashCheckoutHistory.mockResolvedValue([]);
  crewService.saveCashCheckout.mockResolvedValue({ checkout: { status: "reconciled" } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Crew Cash Checkout mobile", () => {
  it("renders the server-scoped checkout and deposit summary", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Cash Checkout" })).not.toBeNull();
    expect(screen.queryByText("Today’s Checkout")).toBeNull();
    expect(screen.getByText(/21 Aug 2026/)).not.toBeNull();
    expect(screen.getByText("RM 500.00")).not.toBeNull();
    expect(screen.queryByText("Count Outlet Cash")).toBeNull();
    expect(screen.getByText("RM 300.00")).not.toBeNull();
    expect(screen.getByText("RM 50.00")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Start" }).classList.contains("crew-mobile-primary")).toBe(true);
    expect(crewService.cashCheckoutMobile).toHaveBeenCalledWith("opaque-session", expect.any(String));
  });

  it("shows one canonical deposit balance and keeps pending confirmation informational", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, deposit: { ...payload.deposit, current_balance: 400, pending_confirmation_amount: 100 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByText("Cash Deposit Balance")).not.toBeNull();
    expect(screen.getByText("RM 400.00")).not.toBeNull();
    expect(screen.getByText("RM 100.00 pending confirmation")).not.toBeNull();
    expect(screen.getByText("RM 100.00 pending confirmation").closest(".crew-ui-status.is-warning")).not.toBeNull();
    expect(screen.queryByText(/Available after pending receipt/)).toBeNull();
  });

  it("presents recent activity as a continuous audit list with a dedicated ledger control", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Recent Activity" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "View ledger" })).toHaveLength(1);
    expect(screen.getAllByText("Cash Checkout").length).toBeGreaterThan(1);
    expect(screen.getByText("+RM 500.00")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Cash Checkout in ledger" }));
    expect(await screen.findByRole("heading", { name: "Cash Deposit" })).not.toBeNull();
  });

  it("calculates a live denomination preview but sends raw counts to server authority", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByText("Count Outlet Cash");
    fireEvent.change(screen.getByLabelText("RM 100"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("RM 0.5"), { target: { value: "2" } });
    expect(screen.getByText("RM 401.00")).not.toBeNull();
    const countedResult = document.querySelector(".crew-cash-counted-result");
    const actions = document.querySelector(".crew-cash-actions-count");
    expect(countedResult?.textContent).toContain("Counted cash");
    expect(countedResult?.textContent).toContain("RM");
    expect(Boolean(countedResult?.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(actions?.querySelector(".crew-cash-action-total")).toBeNull();
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

  it("keeps allocation decision-focused and confirm limited to final allocation values", async () => {
    crewService.cashCheckoutMobile.mockResolvedValueOnce(payload).mockResolvedValueOnce({ ...payload, checkout: { status: "reconciled", denomination_counts: { "100": 5, "50": 1 }, pos_expected_cash: 500, carry_forward: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByLabelText("RM 100"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("RM 50"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("POS closing cash"), { target: { value: "500" } });
    expect(screen.getByRole("heading", { name: "Count Outlet Cash" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Allocate Closing Cash");
    expect(screen.getByRole("heading", { name: "Allocate Closing Cash" })).not.toBeNull();
    expect(screen.getByLabelText("Carry Forward for next cycle")).not.toBeNull();
    expect(screen.getAllByText("For deposit")).toHaveLength(1);
    expect(document.querySelector(".crew-cash-actions-allocate .crew-cash-action-total")).toBeNull();
    expect(screen.queryByText("Keep the outlet float, choose carry forward, and deposit the remainder.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Review Cash Checkout");
    expect(screen.getByRole("heading", { name: "Review Cash Checkout" })).not.toBeNull();
    expect(screen.queryByText("Variance and deposit are calculated by FeedX.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Reconciliation" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Allocation" })).not.toBeNull();
    expect(screen.queryByText("Previous Carry Forward")).toBeNull();
    expect(screen.getByText("Carry Forward for next cycle")).not.toBeNull();
    const allocation = screen.getByRole("heading", { name: "Allocation" }).closest("section");
    expect(allocation?.textContent).toContain("Floating cash");
    expect(allocation?.textContent).toMatch(/RM\s+300\.00/);
    expect(document.querySelector(".crew-cash-actions-confirm .crew-cash-action-total")).toBeNull();
    expect(screen.getByRole("button", { name: "Submit Review" })).not.toBeNull();
    const warning = document.querySelector(".crew-cash-confirm-card .crew-cash-warning");
    expect(warning?.querySelector(".crew-ui-icon-container.is-warning")).not.toBeNull();
    expect(warning?.querySelector(".crew-ui-status.is-warning")?.textContent).toBe("Manager review required");
    expect(warning?.querySelector(":scope > div > span:not(.crew-ui-status)")?.textContent).toBeTruthy();
    expect(warning?.nextElementSibling?.classList.contains("crew-cash-field")).toBe(true);
  });

  it("uses current and completed primary-brand step states without extending progress past Confirm", async () => {
    crewService.cashCheckoutMobile.mockResolvedValueOnce(payload).mockResolvedValueOnce({ ...payload, checkout: { status: "reconciled", denomination_counts: { "100": 5 }, pos_expected_cash: 500, carry_forward: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect(document.querySelectorAll(".crew-cash-steps .is-current")).toHaveLength(1);
    expect(document.querySelectorAll(".crew-cash-steps .is-completed")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("POS closing cash"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Allocate Closing Cash");
    expect(document.querySelectorAll(".crew-cash-steps .is-current")).toHaveLength(1);
    expect(document.querySelectorAll(".crew-cash-steps .is-completed")).toHaveLength(1);
    expect(document.querySelector(".crew-cash-steps > span")?.style.getPropertyValue("--crew-cash-step-progress")).toBe("0.5");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Review Cash Checkout");
    expect(document.querySelectorAll(".crew-cash-steps .is-completed")).toHaveLength(2);
    expect(document.querySelector(".crew-cash-steps > span")?.style.getPropertyValue("--crew-cash-step-progress")).toBe("1");
  });

  it("restores saved count quantities through the existing checkout draft payload", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, checkout: { status: "draft", actual_opening_cash: 350, denomination_counts: { "100": 4, "0.50": 2 }, carry_forward: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("RM 100").value).toBe("4");
    expect(screen.getByLabelText("RM 0.5").value).toBe("2");
    expect(screen.getByText("RM 401.00")).not.toBeNull();
  });

  it("merges completed status and time into one compact treatment and opens the current snapshot", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, checkout: { status: "completed", review_required: true, completed_at: "2026-08-21T22:30:00+08:00", business_date: "2026-08-21", checked_out_by: "QA Crew", position: "Service Crew", floating_cash: 300, previous_carry_forward: 50, expected_opening_cash: 350, denomination_counts: { 100: 8, 50: 1 }, counted_cash: 850, pos_expected_cash: 850, variance: 0, carry_forward: 0, amount_for_deposit: 500 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    const completed = await screen.findByText("Completed · 10:30 PM");
    expect(completed.closest(".crew-ui-status.is-success")).not.toBeNull();
    expect(screen.queryByText("Completed at 10:30 pm")).toBeNull();
    expect(screen.queryByText("Review Required")).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete Checkout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(screen.getByRole("heading", { name: "Checkout Details" })).not.toBeNull();
    expect(screen.getByText("RM100 × 8")).not.toBeNull();
    expect(screen.getByText("This checkout is completed and cannot be edited.")).not.toBeNull();
  });

  it("opens a bounded checkout-snapshot history and returns through the existing details page", async () => {
    crewService.cashCheckoutHistory.mockResolvedValue([
      { id: "checkout-new", status: "completed", business_date: "2026-08-21", completed_at: "2026-08-21T22:30:00+08:00", checked_out_by: "QA Crew", amount_for_deposit: 220, variance: 0, denomination_counts: {}, counted_cash: 570, pos_expected_cash: 500, expected_opening_cash: 350, floating_cash: 300, previous_carry_forward: 50, carry_forward: 50 },
      { id: "checkout-old", status: "completed", business_date: "2026-08-20", completed_at: "2026-08-20T22:15:00+08:00", checked_out_by: "A Very Long Crew Name", amount_for_deposit: 150, variance: 5, denomination_counts: {}, counted_cash: 505, pos_expected_cash: 500, expected_opening_cash: 350, floating_cash: 300, previous_carry_forward: 50, carry_forward: 50 },
    ]);
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Checkout History" }));
    expect(await screen.findByRole("heading", { name: "Checkout History" })).not.toBeNull();
    const rows = document.querySelectorAll(".crew-cash-history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("21/08/2026");
    expect(rows[1].textContent).toMatch(/Variance \+RM\s*5\.00/);
    expect(screen.queryByText("Cash Handover")).toBeNull();
    fireEvent.click(rows[1]);
    expect(await screen.findByRole("heading", { name: "Checkout Details" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Checkout History" })).not.toBeNull();
  });

  it("uses the canonical empty state when the server returns no completed checkout snapshots", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Checkout History" }));
    expect(await screen.findByText("No checkout history in the last 30 days")).not.toBeNull();
    expect(document.querySelector(".crew-cash-history-list")).toBeNull();
  });

  it("renders the completed checkout snapshot in the canonical read-only detail hierarchy", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, checkout: { status: "completed", completed_at: "2026-08-21T22:30:00+08:00", business_date: "2026-08-21", checked_out_by: { full_name: "QA Crew" }, position: "Service Crew", floating_cash: 300, previous_carry_forward: 50, expected_opening_cash: 350, denomination_counts: { 100: 5, 50: 1, 20: 1 }, counted_cash: 570, pos_expected_cash: 500, variance: 70, variance_reason: "Extra cash at close", carry_forward: 50, amount_for_deposit: 220 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    const snapshot = screen.getByRole("heading", { name: "Checkout Details" }).closest("section.crew-cash-details")?.querySelector(".crew-cash-detail-snapshot");
    expect(snapshot?.textContent).toContain("Completed");
    expect(snapshot?.textContent).toContain("Business date");
    expect(snapshot?.textContent).toContain("Completed at");
    expect(snapshot?.textContent).toContain("Checked out by");
    expect(snapshot?.textContent).toContain("QA Crew");
    expect(snapshot?.textContent).toContain("Previous Carry Forward");
    expect(snapshot?.textContent).toContain("For deposit");
    expect(snapshot?.textContent).toContain("RM100 × 5");
    expect(snapshot?.textContent).toContain("Variance reason below");
    expect(snapshot?.querySelector(".crew-cash-detail-rows .is-total")).not.toBeNull();
    expect(snapshot?.querySelector(".crew-ui-icon-container.is-warning")).not.toBeNull();
  });

  it("keeps configured receiver confirmation session-bound and acknowledgement-only", async () => {
    crewService.confirmCashCollection.mockResolvedValue({ status: "completed" });
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, is_cash_handover_receiver: true, pending_receipts: [{ id: "handover-1", amount: 100, purpose: "Bank run", sender: "Sender QA", outlet_name: "Friends Corner", occurred_at: "2026-08-21T10:30:00+08:00", note: "Counter receipt" }] });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    const pendingHeading = await screen.findByRole("heading", { name: "Pending Confirmations" });
    expect(pendingHeading.closest(".crew-cash-pending-confirmations")).not.toBeNull();
    expect(pendingHeading.closest(".crew-cash-receipts")).toBeNull();
    const recentHeading = screen.getByRole("heading", { name: "Recent Activity" });
    expect(pendingHeading.closest(".crew-ui-section-head")?.className).toBe(recentHeading.closest(".crew-ui-section-head")?.className);
    expect(recentHeading.closest(".crew-cash-recent-activity-list")).toBeNull();
    expect(document.querySelector(".crew-cash-recent-activity > .crew-cash-recent-activity-list")).not.toBeNull();
    expect(screen.getByText("Handed over by Sender QA")).not.toBeNull();
    expect(screen.getByText("Friends Corner")).not.toBeNull();
    expect(screen.queryByText("Bank run")).toBeNull();
    const receipt = document.querySelector(".crew-cash-receipts article");
    expect(receipt?.querySelector(".crew-ui-status.is-warning")).not.toBeNull();
    expect(receipt?.querySelector(".crew-mobile-primary")?.textContent).toBe("Confirm Received");
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Received" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Confirm Received" })[1]);
    await waitFor(() => expect(crewService.confirmCashCollection).toHaveBeenCalledWith("opaque-session", "handover-1", 100));
  });

  it("keeps the canonical Hand Over Cash primary action on Summary, not Cash Deposit", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    const action = await screen.findByRole("button", { name: "Hand Over Cash" });
    expect(action.disabled).toBe(false);
    expect(action.classList.contains("crew-mobile-primary")).toBe(true);
    expect(action.closest(".crew-cash-deposit-summary")).not.toBeNull();
    expect(document.querySelector(".crew-cash-summary > .crew-cash-handover-action")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View ledger" }));
    expect(await screen.findByRole("heading", { name: "Cash Deposit" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Hand Over Cash" })).toBeNull();
  });

  it("keeps Hand Over Cash available to an initiator with pending confirmations", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, is_cash_handover_receiver: true, pending_receipts: [{ id: "handover-1", amount: 100, purpose: "Bank run", sender: "Sender QA", outlet_name: "Friends Corner" }], deposit: { ...payload.deposit, pending_confirmation_amount: 100 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect((await screen.findByRole("button", { name: "Hand Over Cash" })).disabled).toBe(false);
  });

  it("does not grant handover initiation to a receiver-only Crew user", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, can_initiate_handover: false, can_record_collection: false, is_cash_handover_receiver: true, pending_receipts: [{ id: "handover-1", amount: 100, purpose: "Bank run", sender: "Sender QA", outlet_name: "Friends Corner" }] });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    const action = await screen.findByRole("button", { name: "Hand Over Cash" });
    expect(action.disabled).toBe(true);
    expect(screen.getByText("You do not have permission to hand over Cash Deposit funds.")).not.toBeNull();
    fireEvent.click(action);
    expect(screen.queryByRole("heading", { name: "Hand Over Cash" })).toBeNull();
  });

  it("keeps Hand Over Cash enabled for a Crew user with both receiver and initiation capabilities", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, is_cash_handover_receiver: true, pending_receipts: [{ id: "handover-1", amount: 100, purpose: "Bank run", sender: "Sender QA", outlet_name: "Friends Corner" }] });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect((await screen.findByRole("button", { name: "Hand Over Cash" })).disabled).toBe(false);
  });

  it("uses the Crew-owned handover capability when the legacy projection alias disagrees", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, can_initiate_handover: true, can_record_collection: false });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect((await screen.findByRole("button", { name: "Hand Over Cash" })).disabled).toBe(false);
  });

  it("keeps Hand Over Cash visible but disabled when the Cash Deposit balance is zero", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, deposit: { ...payload.deposit, current_balance: 0, available_balance: 0 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    expect((await screen.findByRole("button", { name: "Hand Over Cash" })).disabled).toBe(true);
    expect(screen.getByText("No Cash Deposit balance is available to hand over.")).not.toBeNull();
  });

  it("opens the existing Amount, Receiver, Review, and Confirm Handover flow from Cash Deposit", async () => {
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hand Over Cash" }));
    expect(screen.getByRole("heading", { name: "Hand Over Cash" })).not.toBeNull();
    expect(document.querySelector(".crew-ui-modal.crew-cash-collection-modal")).not.toBeNull();
    expect(screen.getByText("Friends Corner Crew")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Receiver" })).not.toBeNull();
    expect(screen.getByLabelText("Amount (RM)").getAttribute("inputmode")).toBe("decimal");
    expect(screen.queryByText("Purpose")).toBeNull();
    expect(screen.queryByText("External receiver")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Receiver" }));
    const receiverPicker = screen.getByRole("dialog", { name: "Choose Crew" });
    expect(receiverPicker).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose Crew" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Hand Over Cash" })).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Receiver" }));
    const receiverSearch = screen.getByRole("textbox", { name: "Receiver" });
    receiverSearch.focus();
    fireEvent.change(receiverSearch, { target: { value: "Receiver QA" } });
    expect(document.activeElement).toBe(receiverSearch);
    fireEvent.click(await screen.findByText("Receiver QA · Supervisor"));
    fireEvent.change(screen.getByLabelText("Amount (RM)"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("From")).not.toBeNull();
    expect(screen.getByText("To")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Confirm Handover" })).not.toBeNull();
  });

  it("opens a server-backed Cash Deposit ledger with balance, pending status, and no duplicate handover action", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, deposit: { ...payload.deposit, current_balance: 400, pending_confirmation_amount: 100 } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "View ledger" }));
    expect(await screen.findByRole("heading", { name: "Cash Deposit" })).not.toBeNull();
    expect(screen.getByText(/Balance.*500\.00/)).not.toBeNull();
    expect(screen.getByText("RM 100.00 pending confirmation").classList.contains("crew-ui-status")).toBe(true);
    expect(screen.getAllByRole("button", { name: /2026/ })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Hand Over Cash" })).toBeNull();
  });

  it("renders pending confirmation on a negative ledger row without a second balance", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, deposit: { ...payload.deposit, current_balance: 400, ledger: [{ id: "collection-1", entry_type: "collection", occurred_at: "2026-08-20T10:00:00+08:00", signed_amount: -100, balance_after: 400, recorded_by: "Manager A", confirmation_status: "pending_confirmation" }] } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "View ledger" }));
    expect(await screen.findByText(/Pending Confirmation/)).not.toBeNull();
    expect(screen.getByText(/100\.00/)).not.toBeNull();
    expect(screen.getByText(/Balance RM.*400\.00/)).not.toBeNull();
  });

  it("filters the bounded canonical ledger projection by one of the latest three calendar months", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, deposit: { ...payload.deposit, ledger: [
      { id: "aug", occurred_at: "2026-08-20T10:00:00+08:00", activity: "Cash Checkout · August", signed_amount: 500, balance_after: 500 },
      { id: "jul", occurred_at: "2026-07-20T10:00:00+08:00", activity: "Cash Checkout · July", signed_amount: 400, balance_after: 400 },
      { id: "jun", occurred_at: "2026-06-20T10:00:00+08:00", activity: "Cash Checkout · June", signed_amount: 300, balance_after: 300 },
    ] } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "View ledger" }));
    expect(await screen.findByText("Cash Checkout")).not.toBeNull();
    expect(screen.getByText("20/08/2026 · 10:00 AM")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Jul 2026" }));
    expect(screen.getByText("20/07/2026 · 10:00 AM")).not.toBeNull();
    expect(screen.queryByText("20/08/2026 · 10:00 AM")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Jun 2026" }));
    expect(screen.getByText("20/06/2026 · 10:00 AM")).not.toBeNull();
  });

  it("uses the canonical empty state when the selected month has no cash activity", async () => {
    crewService.cashCheckoutMobile.mockResolvedValue({ ...payload, deposit: { ...payload.deposit, ledger: [{ id: "jul", occurred_at: "2026-07-20T10:00:00+08:00", activity: "Cash Checkout · July", signed_amount: 400, balance_after: 400 }] } });
    render(<CrewCashCheckoutMobile token="opaque-session" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "View ledger" }));
    expect(await screen.findByText("No cash activity this month")).not.toBeNull();
    expect(document.querySelector(".crew-cash-ledger-list")).toBeNull();
  });
});
