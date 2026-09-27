// Presentation of pinned server evidence; never prices salary/leave in the browser.
export function PayrollRecurringBreakdown({ line }) {
  const basis = line?.source?.recurring_period;
  if (!basis) return null;
  const money = value => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(value));
  return <p className="mt-1 text-xs text-text-secondary">{line.source.formula} · {basis.active_days} active days / {basis.period_days} calendar days
    {basis.policy === "calendar_days" && ` · ${money(line.source.daily_amount_sum)} ÷ ${basis.period_days} = ${money(line.amount)}`}
    {` · ${basis.period_start} – ${basis.period_end}`}</p>;
}
export default function PayrollMonthlyBasicBreakdown({ line }) {
  const basis = line?.source?.monthly_entitlement;
  if (!basis || (basis.employed_days === basis.period_days && basis.unpaid_days === 0)) return null;
  const money = value => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(value));
  return <div className="space-y-2 rounded-lg bg-surface-muted p-3 text-sm">
    <strong>Basic Salary calculation</strong>
    <dl className="space-y-1">{[
      ["Monthly Salary", basis.monthly_salary],
      ["Employment proration", basis.employment_reduction, true],
      ["Unpaid Leave", basis.unpaid_leave_reduction, true],
      ["Payable Basic Salary", basis.payable_basic_salary],
    ].filter(([, value, reduction]) => !reduction || Number(value) > 0).map(([label, value, reduction]) =>
      <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="shrink-0 font-semibold tabular-nums">{reduction ? "−" : ""}{money(value)}</dd></div>)}</dl>
    <p className="text-xs text-text-secondary">{basis.period_start}–{basis.period_end} · {basis.eligible_days} eligible / {basis.period_days} calendar days<br />
      Employment {basis.employment_start}–{basis.employment_end}{basis.unpaid_days > 0 && ` · ${basis.unpaid_days} unpaid days`}</p>
    {basis.unpaid_dates?.length > 0 && <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Unpaid Leave dates</summary><p className="mt-1">{basis.unpaid_dates.join(", ")}</p></details>}
    <p className="text-xs text-text-secondary">Monthly Salary ÷ wage-period calendar days × eligible days. Reductions above reconcile Basic Salary; they are not deducted twice.</p>
  </div>;
}
