import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), settings: vi.fn(), review: vi.fn(), collect: vi.fn(), reviewCollection: vi.fn(), adjust: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  cashCheckoutAdminData: mocks.data, saveCashSettings: mocks.settings, reviewCashCheckout: mocks.review,
  recordAdminCashCollection: mocks.collect, reviewCashCollection: mocks.reviewCollection, adjustCashCheckout: mocks.adjust,
} }));
import CrewCashCheckoutAdminPage from "../CrewCashCheckoutAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const fixture = {
  settings: { floating_cash: 300, variance_tolerance: 5, required_positions: ["Cashier"] },
  summary: { current_balance: 500, available_balance: 500, pending_handover: 100, total_added: 1000, total_collected: 500 },
  checkouts: [{ id: "checkout-1", business_date: "2026-08-20", checked_out_by: "QA Crew", expected_opening_cash: 300, counted_cash: 850, pos_expected_cash: 840, variance: 10, reconciliation_status: "over", carry_forward: 50, amount_for_deposit: 500, review_required: true, review_status: "pending", status: "submitted", denomination_counts: { 100: 8, 50: 1 } }],
  ledger: [{ id: "ledger-1", occurred_at: "2026-08-20T22:00:00+08:00", activity: "Cash Checkout · QA Crew", amount_in: 500, amount_out: 0, balance: 500, recorded_by: "QA Crew" }],
  collections: [], float_history: [], employees: [{ id: "employee-2", name: "Receiver QA", position: "Supervisor" }], eligible_receivers: [{ id: "employee-2", name: "Receiver QA", position: "Supervisor" }],
};
const auth = { hasPermission: () => true };
const ui = { notify: vi.fn() };

beforeEach(() => { mocks.data.mockReset().mockResolvedValue(fixture); mocks.settings.mockReset().mockResolvedValue({}); mocks.review.mockReset().mockResolvedValue({}); mocks.collect.mockReset().mockResolvedValue({}); mocks.reviewCollection.mockReset().mockResolvedValue({}); mocks.adjust.mockReset().mockResolvedValue({}); ui.notify.mockReset(); });
afterEach(cleanup);

describe("Crew Cash Checkout Admin", () => {
  it("separates daily reconciliation from the append-only deposit ledger", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Cash Checkout" })).not.toBeNull();
    expect(screen.getByText("QA Crew")).not.toBeNull();
    expect(screen.getByText("Review Required")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Cash Deposit" }));
    expect(screen.getByText("Deposit Ledger")).not.toBeNull();
    expect(screen.getByText("Cash Checkout · QA Crew")).not.toBeNull();
  });

  it("shows server-calculated checkout evidence for review", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "View checkout 20/08/2026" }));
    expect(screen.getByRole("dialog", { name: "Cash Checkout · 20/08/2026" })).not.toBeNull();
    expect(screen.getAllByText("RM 500.00").length).toBeGreaterThan(0);
    expect(screen.getByText("RM 10.00")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Approve & Complete" })).not.toBeNull();
  });

  it("uses one canonical Cash Deposit Balance and keeps confirmation informational", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Cash Deposit" }));
    expect(screen.getByText("Cash Deposit Balance")).not.toBeNull();
    expect(screen.queryByText("Available Balance")).toBeNull();
    expect(screen.getByText("Pending Confirmation")).not.toBeNull();
    expect(screen.getByText("Already deducted; confirmation is audit-only")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hand Over Cash" }));
    expect(screen.getByText("Cash Deposit Balance: RM 500.00")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select approved receiver" }));
    fireEvent.click(screen.getByRole("button", { name: /Receiver QA/ }));
    fireEvent.change(screen.getByLabelText("Amount (RM)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Handover" }));
    await waitFor(() => expect(mocks.collect).toHaveBeenCalledWith("outlet-1", expect.objectContaining({ amount: "300", receiver_employee_id: "employee-2" })));
  });

  it("renders an unconfigured outlet without dereferencing null settings", async () => {
    mocks.data.mockResolvedValueOnce({ ...fixture, settings: null });
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("Not configured")).not.toBeNull();
    expect(screen.getByText("Set this before Crew can reconcile opening cash")).not.toBeNull();
  });

  it("uses the shared date controls and only exposes Admin-approved handover receivers", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("From")).not.toBeNull();
    expect(screen.getByText("To")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Cash Checkout Settings" })).not.toBeNull();
    expect(screen.getByText("Require internal receiver confirmation")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getByRole("tab", { name: "Cash Deposit" }));
    fireEvent.click(screen.getByRole("button", { name: "Hand Over Cash" }));
    expect(screen.getByRole("button", { name: "Select approved receiver" })).not.toBeNull();
    expect(screen.queryByText("External Receiver")).toBeNull();
    expect(screen.getByText(/Only Admin-configured Cash Deposit Receivers/)).not.toBeNull();
  });

  it("shows a recoverable error rather than an empty or crashed page", async () => {
    mocks.data.mockRejectedValueOnce(new Error("Request timed out"));
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("Unable to load Cash Checkout")).not.toBeNull();
    expect(screen.getByText("Request timed out")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.data).toHaveBeenCalledTimes(2));
  });
});
