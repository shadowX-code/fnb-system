import { useEffect, useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import SummaryPanel from "../components/SummaryPanel.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operatingExpenseService } from "../../../services/operatingExpenseService.js";
import { canDelete, canWrite, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { monthLabel, toCurrency } from "../utils/analytics.js";

function getLock(store, outletId, month, year) {
  return store.monthlyLocks.find((lock) => lock.outlet_id === outletId && Number(lock.month) === Number(month) && Number(lock.year) === Number(year));
}

function getExpense(store, outletId, year, month) {
  return (store.operatingExpenses ?? []).find((expense) => expense.outlet_id === outletId && Number(expense.year) === Number(year) && Number(expense.month) === Number(month));
}

export default function OperatingExpensesPage({ store, setStore, ui, auth }) {
  const filters = usePeriodFilters(store);
  const currentExpense = useMemo(() => getExpense(store, filters.outletId, filters.year, filters.month), [filters.month, filters.outletId, filters.year, store]);
  const [amount, setAmount] = useState(currentExpense?.amount ?? "");
  const [remark, setRemark] = useState(currentExpense?.remark ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const locked = Boolean(getLock(store, filters.outletId, filters.month, filters.year)?.is_locked);
  const writeAllowed = canWrite(auth, "operating_expenses");
  const deleteAllowed = canDelete(auth, "operating_expenses");
  const readOnly = locked || !writeAllowed;

  useEffect(() => {
    setAmount(currentExpense?.amount ?? "");
    setRemark(currentExpense?.remark ?? "");
    setError("");
  }, [currentExpense?.id, filters.month, filters.outletId, filters.year]);

  async function saveExpense() {
    if (locked) {
      ui.notify({ title: "Month locked", message: "Operating Expenses are read-only for this month.", tone: "error" });
      return;
    }
    if (!writeAllowed) {
      notifyPermissionDenied(ui, "save operating expenses");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await operatingExpenseService.saveOperatingExpense({
        outletId: filters.outletId,
        year: filters.year,
        month: filters.month,
        amount,
        remark,
      });
      setStore((current) => ({
        ...current,
        operatingExpenses: [
          ...(current.operatingExpenses ?? []).filter(
            (expense) => !(expense.outlet_id === filters.outletId && Number(expense.year) === Number(filters.year) && Number(expense.month) === Number(filters.month)),
          ),
          saved,
        ],
      }));
      ui.notify({ title: "Operating expense saved", message: "Saved to Supabase" });
    } catch (saveError) {
      console.error("Unable to save operating expense", saveError);
      setError(saveError.message || "Unable to save operating expense.");
      ui.notify({ title: "Unable to save operating expense", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense() {
    if (!currentExpense?.id) return;
    if (!deleteAllowed) {
      notifyPermissionDenied(ui, "delete operating expenses");
      return;
    }
    const confirmed = await ui.confirm({
      title: "Delete Operating Expense?",
      message: `Remove OpEx for ${monthLabel(filters.month)} ${filters.year}?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await operatingExpenseService.deleteOperatingExpense(currentExpense.id);
      setStore((current) => ({
        ...current,
        operatingExpenses: (current.operatingExpenses ?? []).filter((expense) => expense.id !== currentExpense.id),
      }));
      ui.notify({ title: "Operating expense deleted", message: "Saved to Supabase" });
    } catch (deleteError) {
      console.error("Unable to delete operating expense", deleteError);
      ui.notify({ title: "Unable to delete operating expense", message: deleteError.message || "Please try again.", tone: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Operating Expenses"
        description="Enter total monthly OpEx for management P&L. Category breakdown can be added later."
        actions={readOnly ? <Badge tone={locked ? "warning" : "neutral"}>{locked ? "Month Locked" : "Read-only access"}</Badge> : null}
      />

      <PeriodFilterBar store={store} filters={filters} compact />

      {error ? <div className="card border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}
      {locked ? <div className="card border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">This month is locked. Operating Expenses are read-only.</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Monthly OpEx Input" description="One total monthly amount per outlet. Missing months are treated as RM0 in Outlet P&L.">
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Total OpEx</span>
              <input
                className="control mt-1 w-full text-right"
                type="number"
                min="0"
                step="0.01"
                disabled={readOnly}
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Remark</span>
              <input
                className="control mt-1 w-full"
                disabled={readOnly}
                placeholder="Optional note"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-slate-50 px-4 py-3">
            {currentExpense?.id ? (
              <button className="btn-secondary text-rose-600" type="button" disabled={!deleteAllowed || locked} onClick={deleteExpense}>
                <Trash2 size={15} /> Delete
              </button>
            ) : null}
            <button className="btn-primary" type="button" disabled={readOnly || saving} onClick={saveExpense}>
              <Save size={15} /> {saving ? "Saving..." : "Save OpEx"}
            </button>
          </div>
        </Card>

        <SummaryPanel
          title="Current Period"
          items={[
            { label: "Outlet", value: store.outlets.find((outlet) => outlet.id === filters.outletId)?.name ?? "—" },
            { label: "Period", value: `${monthLabel(filters.month)} ${filters.year}` },
            { label: "Saved OpEx", value: toCurrency(Number(currentExpense?.amount ?? amount ?? 0)) },
            { label: "Status", value: currentExpense ? "Saved" : "Not entered" },
          ]}
        />
      </div>
    </div>
  );
}
