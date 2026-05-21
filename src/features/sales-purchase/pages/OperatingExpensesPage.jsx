import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Lock } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { months } from "../data/mockData.js";
import { operatingExpenseService } from "../../../services/operatingExpenseService.js";
import { canWrite, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { monthLabel, toCurrency } from "../utils/analytics.js";

function defaultYear(store) {
  const years = (store.operatingExpenses ?? [])
    .map((record) => Number(record.year))
    .filter(Boolean);
  return years.length ? Math.max(...years) : new Date().getFullYear();
}

function getLock(store, outletId, month, year) {
  return (store.monthlyLocks ?? []).find(
    (lock) => lock.outlet_id === outletId && Number(lock.month) === Number(month) && Number(lock.year) === Number(year),
  );
}

function getExpense(store, outletId, year, month) {
  return (store.operatingExpenses ?? []).find(
    (expense) => expense.outlet_id === outletId && Number(expense.year) === Number(year) && Number(expense.month) === Number(month),
  );
}

function buildDrafts(store, outletId, year) {
  return months.reduce((drafts, month) => {
    const expense = getExpense(store, outletId, year, month.value);
    drafts[month.value] = {
      amount: expense?.amount === undefined || expense?.amount === null ? "" : String(expense.amount),
      remark: expense?.remark ?? "",
      saved: Boolean(expense?.id),
    };
    return drafts;
  }, {});
}

function numericAmount(value) {
  return Math.max(0, Number(value) || 0);
}

function summaryFromDrafts(drafts) {
  const rows = months.map((month) => ({
    ...month,
    amount: numericAmount(drafts[month.value]?.amount),
    remark: drafts[month.value]?.remark ?? "",
    saved: Boolean(drafts[month.value]?.saved),
  }));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const average = total / 12;
  const monthsWithAmount = rows.filter((row) => row.amount > 0);
  const highest = monthsWithAmount.length ? monthsWithAmount.reduce((best, row) => (row.amount > best.amount ? row : best), monthsWithAmount[0]) : null;
  const lowest = monthsWithAmount.length ? monthsWithAmount.reduce((best, row) => (row.amount < best.amount ? row : best), monthsWithAmount[0]) : null;

  return { rows, total, average, highest, lowest };
}

function MiniTrend({ rows, average }) {
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return (
    <div className="mt-4 flex h-14 items-end gap-2 rounded-2xl border border-border bg-slate-50 px-3.5 py-2.5">
      {rows.map((row) => {
        const abnormal = average > 0 && row.amount > average * 1.5;
        return (
          <div key={row.value} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full max-w-3 rounded-t-full ${abnormal ? "bg-amber-400" : "bg-gradient-to-t from-primary/70 to-primary/40"}`}
              style={{ height: `${Math.max(7, (row.amount / max) * 36)}px` }}
              title={`${row.label}: ${toCurrency(row.amount)}`}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function OperatingExpensesPage({ store, setStore, ui, auth }) {
  const initialOutletId = store.outlets[0]?.id ?? "";
  const [outletId, setOutletId] = useState(initialOutletId);
  const [year, setYear] = useState(defaultYear(store));
  const [drafts, setDrafts] = useState(() => buildDrafts(store, initialOutletId, defaultYear(store)));
  const [savingCells, setSavingCells] = useState({});
  const [editingCell, setEditingCell] = useState(null);
  const [error, setError] = useState("");
  const writeAllowed = canWrite(auth, "operating_expenses");
  const readOnlyAccess = !writeAllowed;

  useEffect(() => {
    setDrafts(buildDrafts(store, outletId, year));
    setSavingCells({});
    setEditingCell(null);
    setError("");
  }, [outletId, year, store.operatingExpenses]);

  const summary = useMemo(() => summaryFromDrafts(drafts), [drafts]);

  function isLocked(month) {
    return Boolean(getLock(store, outletId, month, year)?.is_locked);
  }

  function canEditMonth(month) {
    return writeAllowed && !isLocked(month);
  }

  function updateDraft(month, field, value) {
    setDrafts((current) => ({
      ...current,
      [month]: {
        ...current[month],
        [field]: value,
        saved: false,
      },
    }));
  }

  async function saveMonth(month, draftSource = drafts) {
    if (!outletId) return;
    if (isLocked(month)) {
      ui.notify({ title: "Month locked", message: `${monthLabel(month)} ${year} is read-only.`, tone: "error" });
      return;
    }
    if (!writeAllowed) {
      notifyPermissionDenied(ui, "save operating expenses");
      return;
    }

    const draft = draftSource[month] ?? { amount: "", remark: "" };
    setSavingCells((current) => ({ ...current, [month]: true }));
    setError("");
    try {
      const saved = await operatingExpenseService.saveOperatingExpense({
        outletId,
        year,
        month,
        amount: draft.amount,
        remark: draft.remark,
      });
      setStore((current) => ({
        ...current,
        operatingExpenses: [
          ...(current.operatingExpenses ?? []).filter(
            (expense) => !(expense.outlet_id === outletId && Number(expense.year) === Number(year) && Number(expense.month) === Number(month)),
          ),
          saved,
        ],
      }));
      setDrafts((current) => ({
        ...current,
        [month]: {
          amount: String(saved.amount ?? 0),
          remark: saved.remark ?? "",
          saved: true,
        },
      }));
      ui.notify({ title: "OpEx saved", message: `${monthLabel(month)} ${year} saved to Supabase.` });
    } catch (saveError) {
      console.error("Unable to save operating expense", saveError);
      setError(saveError.message || "Unable to save operating expense.");
      ui.notify({ title: "Unable to save operating expense", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSavingCells((current) => ({ ...current, [month]: false }));
    }
  }

  async function saveMonths(monthValues, draftSource = drafts) {
    const editableMonths = monthValues.filter((month) => canEditMonth(month));
    if (!editableMonths.length) return;
    await Promise.all(editableMonths.map((month) => saveMonth(month, draftSource)));
  }

  async function duplicatePreviousMonth() {
    if (!writeAllowed) {
      notifyPermissionDenied(ui, "update operating expenses");
      return;
    }
    const nextDrafts = { ...drafts };
    const touched = [];
    months.forEach((month, index) => {
      if (index === 0 || !canEditMonth(month.value)) return;
      const previousMonth = months[index - 1].value;
      nextDrafts[month.value] = {
        ...nextDrafts[month.value],
        amount: nextDrafts[previousMonth]?.amount ?? "",
        remark: nextDrafts[month.value]?.remark ?? "",
        saved: false,
      };
      touched.push(month.value);
    });
    setDrafts(nextDrafts);
    await saveMonths(touched, nextDrafts);
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader
        section="Operations"
        title="Operating Expenses"
        description="Manage one total monthly OpEx value per month for yearly management P&L."
        actions={readOnlyAccess ? <Badge tone="neutral">Read-only access</Badge> : null}
      />

      <FilterBar
        compact
        actions={(
          <>
            <button className="btn-secondary" type="button" disabled={readOnlyAccess} onClick={duplicatePreviousMonth}>
              <Copy size={15} /> Duplicate Previous Month
            </button>
          </>
        )}
      >
        <SelectField
          label="Outlet"
          value={outletId}
          className="min-w-56"
          options={store.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
          onChange={setOutletId}
          searchable
        />
        <SelectField
          label="Year"
          value={year}
          className="min-w-32"
          options={[2024, 2025, 2026, 2027].map((item) => ({ value: item, label: item }))}
          onChange={(nextValue) => setYear(Number(nextValue))}
        />
      </FilterBar>

      {error ? <div className="card border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card title="Yearly Operating Expenses Matrix" description="One total OpEx amount and one optional remark per month. Category breakdown can be added later.">
          <div className="overflow-x-auto px-0 pb-1 pt-3">
            <table className="w-full min-w-[1900px] border-collapse text-sm">
              <thead className="table-head">
                <tr>
                  <th className="sticky left-0 z-10 w-64 bg-surface px-5 py-3.5 text-left">Metric</th>
                  {months.map((month) => {
                    const locked = isLocked(month.value);
                    return (
                      <th key={month.value} className="w-40 border-l border-border/80 px-3.5 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1 text-[12px] font-bold uppercase tracking-[0.04em] text-text-secondary">
                          <span>{month.label}</span>
                          {locked ? <Lock size={12} className="text-amber-600" /> : null}
                        </div>
                      </th>
                    );
                  })}
                  <th className="w-44 border-l border-border bg-primary/5 px-5 py-3.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="table-row bg-surface">
                  <td className="sticky left-0 z-10 bg-surface px-5 py-7">
                    <div className="text-sm font-bold text-text-primary">Operating Expenses</div>
                    <div className="mt-2 text-xs leading-4 text-text-muted">Monthly total OpEx</div>
                  </td>
                  {summary.rows.map((row) => {
                    const locked = isLocked(row.value);
                    const abnormal = summary.average > 0 && row.amount > summary.average * 1.5;
                    const saving = savingCells[row.value];
                    const editable = canEditMonth(row.value);
                    return (
                      <td key={row.value} className={`border-l border-border/80 px-3.5 py-7 align-top transition hover:bg-primary/5 ${editingCell === `${row.value}:amount` ? "bg-primary/5" : abnormal ? "bg-amber-50/60" : "odd:bg-slate-50/20"}`}>
                        <div className="relative space-y-3.5">
                          <input
                            className={`h-14 w-full rounded-xl border px-4 text-center text-[17px] font-semibold tracking-tight outline-none shadow-sm transition placeholder:text-text-muted/50 hover:-translate-y-px hover:border-primary/30 hover:shadow-md focus:border-primary/70 focus:bg-surface focus:shadow-[0_10px_24px_rgba(34,197,94,0.12)] focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-text-muted ${abnormal ? "border-amber-300 bg-amber-50" : "border-border/80 bg-surface"}`}
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={!editable}
                            placeholder="0.00"
                            value={drafts[row.value]?.amount ?? ""}
                            onFocus={(event) => { event.target.select(); setEditingCell(`${row.value}:amount`); }}
                            onBlur={() => { setEditingCell(null); if (editable) saveMonth(row.value); }}
                            onChange={(event) => updateDraft(row.value, "amount", event.target.value)}
                          />
                          <div className="flex min-h-5 items-center justify-center gap-1 text-[10px] font-medium opacity-80">
                            {locked ? <span className="text-amber-700">Locked</span> : saving ? <span className="text-text-muted">Saving...</span> : row.saved ? <span className="inline-flex items-center gap-1 text-emerald-700/70"><CheckCircle2 size={10} /> Saved</span> : editingCell === `${row.value}:amount` ? <span className="text-primary">Editing</span> : null}
                            {abnormal ? <AlertTriangle size={11} className="text-amber-600" /> : null}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td className="border-l border-border bg-primary/5 px-5 py-7 text-right align-top">
                    <div className="text-base font-bold text-text-primary">{toCurrency(summary.total)}</div>
                    <div className="mt-1 text-[11px] font-semibold text-text-muted">Yearly OpEx</div>
                  </td>
                </tr>
                <tr className="table-row bg-slate-50/60">
                  <td className="sticky left-0 z-10 bg-slate-50 px-5 py-7">
                    <div className="text-sm font-bold text-text-primary">Remark</div>
                    <div className="mt-2 text-xs leading-4 text-text-muted">Optional monthly note</div>
                  </td>
                  {summary.rows.map((row) => {
                    const editable = canEditMonth(row.value);
                    return (
                      <td key={row.value} className={`border-l border-border/80 px-3.5 py-7 align-top transition hover:bg-primary/5 ${editingCell === `${row.value}:remark` ? "bg-primary/5" : ""}`}>
                        <input
                          className="h-12 w-full rounded-xl border border-border/80 bg-surface px-4 text-left text-[13px] font-medium text-text-primary outline-none shadow-sm transition placeholder:text-text-muted/60 hover:-translate-y-px hover:border-primary/25 hover:shadow-md focus:border-primary/60 focus:bg-surface focus:shadow-[0_10px_24px_rgba(34,197,94,0.10)] focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-text-muted"
                          disabled={!editable}
                          placeholder="Optional"
                          value={drafts[row.value]?.remark ?? ""}
                          onFocus={(event) => { event.target.select(); setEditingCell(`${row.value}:remark`); }}
                          onBlur={() => { setEditingCell(null); if (editable) saveMonth(row.value); }}
                          onChange={(event) => updateDraft(row.value, "remark", event.target.value)}
                        />
                      </td>
                    );
                  })}
                  <td className="border-l border-border bg-primary/5 px-5 py-7 text-right text-xs font-semibold text-text-muted">
                    {summary.rows.filter((row) => row.remark).length} notes
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Yearly Summary" description="Full-year operating expense control.">
          <div className="space-y-3 p-3.5">
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3.5">
              <div className="text-xs font-bold uppercase tracking-wide text-text-muted">YTD OpEx</div>
              <div className="mt-2 text-[28px] font-semibold tracking-tight text-text-primary">{toCurrency(summary.total)}</div>
              <div className="mt-1 text-xs text-text-secondary">One total monthly value per month</div>
            </div>
            <div className="grid gap-2.5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-slate-50/70 px-3 py-2.5">
                <span className="text-xs font-semibold text-text-secondary">Average Monthly OpEx</span>
                <strong className="text-sm text-text-primary">{toCurrency(summary.average)}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-slate-50/70 px-3 py-2.5">
                <span className="text-xs font-semibold text-text-secondary">Highest Expense Month</span>
                <strong className="text-right text-sm text-text-primary">{summary.highest ? `${summary.highest.label} · ${toCurrency(summary.highest.amount)}` : "—"}</strong>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-slate-50/70 px-3 py-2.5">
                <span className="text-xs font-semibold text-text-secondary">Lowest Expense Month</span>
                <strong className="text-right text-sm text-text-primary">{summary.lowest ? `${summary.lowest.label} · ${toCurrency(summary.lowest.amount)}` : "—"}</strong>
              </div>
            </div>
            <MiniTrend rows={summary.rows} average={summary.average} />
            <div className="rounded-2xl border border-border bg-slate-50 p-3 text-xs leading-5 text-text-secondary">
              Months above 150% of the yearly average are highlighted in amber for management review.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
