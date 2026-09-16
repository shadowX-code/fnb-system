import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryPettyCashPage, { PettyCashCategoryModal, PettyCashTransactionModal } from "../FactoryPettyCashPage.jsx";

const permissions = ["factory_petty_cash.view", "factory_petty_cash.create", "factory_petty_cash.post", "factory_petty_cash.adjust", "factory_petty_cash.reverse", "factory_petty_cash.manage"];
const can = (key) => permissions.includes(key);
const category = { id: "00000000-0000-4000-8000-000000000001", code: "transport", name: "Transport", status: "active" };
const posted = { id: "posted-1", reference_no: "PC260916-01", transaction_type: "cash_in", amount: 100, transaction_date: "2026-09-16", description: "Opening float", status: "posted", balance_after: 100, created_by_name: "Amin", posted_by_name: "Amin", posted_at: "2026-09-16T02:00:00Z" };
const draft = { id: "draft-1", reference_no: "PC260916-02", transaction_type: "expense", amount: 20, category_id: category.id, category_name: "Transport", transaction_date: "2026-09-16", description: "Delivery toll", status: "draft", created_by_name: "Amin" };
const reversal = { id: "reversal-1", reference_no: "PC260916-04", transaction_type: "adjustment", adjustment_direction: "decrease", amount: 10, transaction_date: "2026-09-16", description: "Reversal of PC260916-03", status: "posted", balance_after: 100, reversal_of_id: "adjustment-1", reversal_of_reference: "PC260916-03", created_by_name: "Amin", posted_by_name: "Amin", posted_at: "2026-09-16T03:00:00Z" };

function mount() {
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryPettyCashPage onNotify={vi.fn()} onConfirm={vi.fn().mockResolvedValue(true)} /></FactoryPermissionsProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Petty Cash", () => {
  it("renders the derived ledger, KPIs, receipt state and lifecycle actions", async () => {
    vi.spyOn(factoryService, "getPettyCashData").mockResolvedValue({ rows: [draft, posted], categories: [category], summary: { current_balance: 100, cash_in_month: 100, expenses_month: 0, transactions_month: 1 }, total_count: 2 });
    mount();
    expect(await screen.findByRole("heading", { name: "Petty Cash" })).not.toBeNull();
    expect(screen.getAllByText("RM100.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Post" })).not.toBeNull();
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
  });

  it("posts through the trusted service and refreshes the canonical ledger", async () => {
    vi.spyOn(factoryService, "getPettyCashData").mockResolvedValue({ rows: [draft], categories: [category], summary: {}, total_count: 1 });
    const post = vi.spyOn(factoryService, "postPettyCashTransaction").mockResolvedValue({ ...draft, status: "posted" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Post" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("draft-1"));
  });

  it("requires an Adjustment reason before persisting a draft", async () => {
    const save = vi.fn();
    render(<PettyCashTransactionModal categories={[category]} canAdjust onClose={vi.fn()} onSave={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Type *" }));
    fireEvent.click(screen.getByRole("button", { name: "Adjustment" }));
    fireEvent.change(screen.getByLabelText("Amount (RM) *"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Description *"), { target: { value: "Cash count correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText("Adjustment reason is required.")).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("uses the compact shared manager without exposing internal category slugs", () => {
    render(<PettyCashCategoryModal categories={[{ ...category, code: "raw_material", name: "Raw Material", description: "Ingredient purchases" }]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Petty Cash Categories" }).className).toContain("max-w-3xl");
    expect(screen.getByText("Ingredient purchases")).not.toBeNull();
    expect(screen.queryByText("raw_material")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Category *").value).toBe("Raw Material");
    expect(screen.getByRole("button", { name: "Save Changes" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Create Category" })).not.toBeNull();
  });

  it("presents system-generated adjustments as linked Reversals", async () => {
    vi.spyOn(factoryService, "getPettyCashData").mockResolvedValue({ rows: [reversal], categories: [category], summary: { current_balance: 100 }, total_count: 1 });
    mount();
    expect(await screen.findByText("Reversal", { selector: ".factory-cell-semantic" })).not.toBeNull();
    expect(screen.getAllByText("Reversal of PC260916-03").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(screen.getAllByText("Reversal").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Reversal of PC260916-03").length).toBeGreaterThan(1);
  });
});
