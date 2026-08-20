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
  summary: { current_balance: 500, available_balance: 400, total_added: 1000, total_collected: 500 },
  checkouts: [{ id: "checkout-1", business_date: "2026-08-20", checked_out_by: "QA Crew", expected_opening_cash: 300, counted_cash: 850, pos_expected_cash: 840, variance: 10, reconciliation_status: "over", carry_forward: 50, amount_for_deposit: 500, review_required: true, review_status: "pending", status: "submitted", denomination_counts: { 100: 8, 50: 1 } }],
  ledger: [{ id: "ledger-1", occurred_at: "2026-08-20T22:00:00+08:00", activity: "Cash Checkout · QA Crew", amount_in: 500, amount_out: 0, balance: 500, recorded_by: "QA Crew" }],
  collections: [], float_history: [], employees: [{ id: "employee-2", name: "Receiver QA", position: "Supervisor" }],
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

  it("records a collection against the server-provided available balance", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Cash Deposit" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Collection" }));
    expect(screen.getByText("Available deposit balance: RM 400.00")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Receiver Name"), { target: { value: "Secure Logistics" } });
    fireEvent.change(screen.getByLabelText("Amount (RM)"), { target: { value: "300" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Record Collection" })[1]);
    await waitFor(() => expect(mocks.collect).toHaveBeenCalledWith("outlet-1", expect.objectContaining({ amount: "300", receiver_name: "Secure Logistics" })));
  });
});
