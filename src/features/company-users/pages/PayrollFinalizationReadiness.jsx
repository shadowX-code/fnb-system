import PayrollEmploymentHistoryRequired, { employmentHistoryRecords } from "./PayrollEmploymentHistoryRequired.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import { payrollReviewRows, payrollReviewSummary } from "./payrollRunPresentation.js";

// Checklist explains existing server gates; it never grants Finalize authority.
export function finalizationGates(readiness, foundationOnly = false, calculating = false) {
  const calculation = readiness?.calculation;
  const membership = Boolean(calculation && !calculation.employment_issue);
  const periodClosed = Boolean(readiness?.time && !readiness.time.period_in_progress && !calculation?.period_in_progress);
  const calculationReady = foundationOnly || Boolean(calculation && !calculating && !calculation.uncalculated && !calculation.review_required && !calculation.stale && calculation.employees > 0);
  return [
    {key:"time",name:"Time & Attendance",ready:readiness?.time?.ready === true,step:0},
    {key:"membership",name:"Employment History",ready:membership,step:0},
    {key:"calculation",name:"Payroll Calculation",ready:calculationReady,step:0},
    {key:"statutory",name:"Statutory",ready:foundationOnly || (!calculating && readiness?.statutory?.ready === true),step:1},
    ...(!periodClosed ? [{key:"period",name:"Pay Period Complete",ready:false,step:0}] : []),
  ];
}
export default function PayrollFinalizationReadiness({ run, read, readiness, allReady, canFinalize, busy, onResolve, onFinalize, bankRead, employees, canEditEmployee }) {
  const gates = finalizationGates(readiness, run.foundation_only, read.calculating);
  const remaining = gates.filter(gate => !gate.ready).length;
  const totals = payrollReviewSummary(payrollReviewRows(read.data));
  const money = value => value == null || read.calculating || readiness?.calculation?.employment_issue ? "Pending" : new Intl.NumberFormat("en-MY", {style:"currency",currency:"MYR"}).format(value);
  const blockedReason = read.error ? "Readiness unavailable. Reload Payroll before finalizing." : !canFinalize ? "Finalize permission required." : busy ? "Payroll action in progress…" : !read.data ? "Checking readiness…" : !allReady ? `${remaining || 1} required item${remaining === 1 ? "" : "s"} remaining` : "All required items ready";
  return <section aria-label="Finalize Payroll"><Card className="space-y-4 p-4">
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[["Gross Payroll",totals.gross],["Employee Deductions",totals.deductions],["Employer Contributions",totals.employerContributions],["Net Payroll",totals.net]].map(([name,value]) => <div key={name}><dt className="text-xs text-text-secondary">{name}</dt><dd className="mt-1 font-bold tabular-nums">{money(value)}</dd></div>)}</dl>
    <ul className="space-y-2" aria-label="Finalization checklist">{gates.map(gate => <li key={gate.key} className="text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{gate.name}</strong><div className="flex items-center gap-2"><Badge tone={gate.ready ? "success" : "warning"}>{gate.ready ? "Ready" : "Needs resolution"}</Badge>
        {!gate.ready && <><span aria-hidden="true">·</span><button type="button" className="font-semibold text-primary" aria-label={`Resolve ${gate.name}`} onClick={() => onResolve(gate.step)}>Resolve →</button></>}</div></div>
      {gate.key === "membership" && readiness?.calculation?.employment_issue && canEditEmployee && employmentHistoryRecords(read.data?.preparation).length > 0 && <details className="mt-2 text-text-secondary"><summary>Employment records requiring resolution</summary><PayrollEmploymentHistoryRequired heading={false} issue={readiness.calculation.employment_issue} preparation={read.data?.preparation} employees={employees} canEditEmployee={canEditEmployee} /></details>}
    </li>)}</ul>
    {bankRead?.missingCount > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><strong>{bankRead.missingCount} employee{bankRead.missingCount === 1 ? "" : "s"} with incomplete Bank Details</strong><p className="mt-1">Payment information warning; this does not block finalization.</p><button type="button" className="mt-1 font-semibold" onClick={() => onResolve(1)}>View Bank Details →</button></div>}
    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-3"><div><p id="payroll-finalize-state" role={read.error ? "alert" : "status"} className="text-sm font-semibold">{blockedReason}</p><p className="mt-1 text-xs text-text-secondary">Finalization freezes this Payroll revision and its evidence. It does not make payment.</p></div>
      <button type="button" className="btn-primary" aria-describedby="payroll-finalize-state" disabled={!canFinalize || !allReady || busy || !read.data || !!read.error} onClick={onFinalize}>Finalize Payroll</button>
    </footer>
  </Card></section>;
}
