import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), settings: vi.fn(), review: vi.fn(), collect: vi.fn(), reviewCollection: vi.fn(), adjust: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  cashCheckoutAdminData: mocks.data, saveCashSettings: mocks.settings, reviewCashCheckout: mocks.review,
  recordAdminCashCollection: mocks.collect, reviewCashCollection: mocks.reviewCollection, adjustCashCheckout: mocks.adjust,
} }));
import CrewCashCheckoutAdminPage from "../CrewCashCheckoutAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const cashierPositionId = "11111111-1111-4111-8111-111111111111";
const supervisorPositionId = "22222222-2222-4222-8222-222222222222";
const fixture = {
  settings: { floating_cash: 300, effective_floating_cash: 300, variance_tolerance: 5, required_position_ids: [cashierPositionId], closing_deadline: "23:00:00", require_receiver_confirmation: true, require_manager_review_over_tolerance: true },
  summary: { current_balance: 500, available_balance: 500, pending_handover: 100, total_added: 1000, total_collected: 500 },
  checkouts: [{ id: "checkout-1", business_date: "2026-08-20", checked_out_by: "QA Crew", expected_opening_cash: 300, counted_cash: 850, pos_expected_cash: 840, variance: 10, reconciliation_status: "over", carry_forward: 50, amount_for_deposit: 500, review_required: true, review_status: "pending", status: "submitted", denomination_counts: { 100: 8, 50: 1 } }],
  ledger: [{ id: "ledger-1", occurred_at: "2026-08-20T22:00:00+08:00", activity: "Cash Checkout · QA Crew", amount_in: 500, amount_out: 0, balance: 500, recorded_by: "QA Crew" }],
  collections: [], float_history: [], employees: [{ id: "employee-2", name: "Receiver QA", position: "Supervisor" }], eligible_receivers: [{ id: "employee-2", name: "Receiver QA", position: "Supervisor" }],
  checkout_positions: [{ id: cashierPositionId, name: "Cashier", status: "active" }, { id: supervisorPositionId, name: "Supervisor", status: "active" }],
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
    expect(await screen.findByText("Date Range")).not.toBeNull();
    await screen.findByText("QA Crew");
    expect(screen.getByRole("button", { name: "Date Range" })).not.toBeNull();
    expect(screen.queryByText("View Settings")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Settings" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Cash Checkout Settings" })).not.toBeNull();
    expect(screen.getAllByText("Floating Cash")).toHaveLength(2);
    expect(screen.getByText("Checkout Rules")).not.toBeNull();
    expect(screen.getByText("Eligible Crew")).not.toBeNull();
    expect(screen.getByText("Review Rules")).not.toBeNull();
    expect(screen.getByText("Require internal receiver confirmation")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getByRole("tab", { name: "Cash Deposit" }));
    fireEvent.click(screen.getByRole("button", { name: "Hand Over Cash" }));
    expect(screen.getByRole("button", { name: "Select approved receiver" })).not.toBeNull();
    expect(screen.queryByText("External Receiver")).toBeNull();
    expect(screen.getByText(/Only Admin-configured Cash Deposit Receivers/)).not.toBeNull();
  });

  it("requires a reason only when the current effective Floating Cash changes", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("QA Crew");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByLabelText(/Reason for change/)).toBeNull();

    fireEvent.input(screen.getByLabelText("Floating Cash (RM)"), { target: { value: "350" } });
    await waitFor(() => expect(screen.getByLabelText(/Reason for change/).required).toBe(true));
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: "Weekend operating float" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith("outlet-1", expect.objectContaining({ floating_cash: "350", reason: "Weekend operating float", required_position_ids: [cashierPositionId] })));
  });

  it("groups Floating Cash changes separately from Checkout Rules using the shared field grammar", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("QA Crew");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Applies to a changed Floating Cash amount.")).not.toBeNull();
    expect(screen.getByText("Sets the amount allowed before the review rule applies.")).not.toBeNull();
    expect(screen.getByText("Require review when variance exceeds tolerance")).not.toBeNull();
    expect(screen.getByLabelText("Floating Cash (RM)").closest("label").className).toContain("admin-form-field");
    expect(screen.getByLabelText("Variance Tolerance (RM)").closest("label").className).toContain("admin-form-field");
  });

  it("saves Checkout Positions by canonical Job Position ID", async () => {
    render(<CrewCashCheckoutAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("QA Crew");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /Cashier/ }));
    fireEvent.click(screen.getByRole("button", { name: "Supervisor" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith("outlet-1", expect.objectContaining({ required_position_ids: [cashierPositionId, supervisorPositionId], reason: "" })));
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
