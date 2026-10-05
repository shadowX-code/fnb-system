import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import { payrollIssueLabel, payrollReviewRows, payrollReviewSummary } from "./payrollRunPresentation.js";

// Checklist explains existing server gates; it never grants Finalize authority.
export function finalizationGates(readiness, foundationOnly = false, calculating = false) {
  const calculation = readiness?.calculation;
  const membership = Boolean(calculation && !calculation.employment_issue);
  const periodClosed = Boolean(readiness?.time && !readiness.time.period_in_progress && !calculation?.period_in_progress);
  const calculationReady = foundationOnly || Boolean(calculation && !calculating && !calculation.uncalculated && !calculation.review_required && !calculation.stale && calculation.employees > 0);
  return [
    {key:"time",name:"Time & Attendance",ready:readiness?.time?.ready === true,step:0},
    {key:"membership",name:"Employment / Membership",ready:membership,step:0},
    {key:"calculation",name:"Payroll Calculation",ready:calculationReady,step:0},
    {key:"statutory",name:"Statutory",ready:foundationOnly || (!calculating && readiness?.statutory?.ready === true),step:1},
    ...(!periodClosed ? [{key:"period",name:"Pay Period Complete",ready:false,step:0}] : []),
  ];
}
export default function PayrollFinalizationReadiness({ run, read, readiness, allReady, canFinalize, busy, onResolve, onFinalize, bankRead }) {
  const summary = payrollReviewSummary(payrollReviewRows(read.data));
  const gates = finalizationGates(readiness, run.foundation_only, read.calculating);
  const remaining = gates.filter(gate => !gate.ready).length;
  const monetaryReady = !read.calculating && !readiness?.calculation?.employment_issue;
  const money = value => value == null || !monetaryReady ? "Pending" : new Intl.NumberFormat("en-MY", {style:"currency",currency:"MYR"}).format(value);
  const statutory = read.data?.statutory?.results || [];
  const contributions = statutory.length && statutory.every(row => row.status === "ready" && !row.is_stale && row.employer_statutory_cost != null)
    ? statutory.reduce((sum,row) => sum + Number(row.employer_statutory_cost),0) : null;
  return <Card className="space-y-5 p-5">
    <div><h3 className="text-lg font-bold">Finalization Readiness</h3><p className="mt-1 text-sm text-text-secondary">Finalization freezes this Payroll revision and its evidence. It does not make payment.</p></div>
    <dl className="grid grid-cols-2 gap-4 border-b border-border pb-5 lg:grid-cols-5">{[
      ["Employees",summary.employeeCount], ["Gross Payroll",money(summary.gross)], ["Employee Deductions",money(summary.deductions)],
      ["Employer Contributions",money(contributions)], ["Net Payroll",money(summary.net)],
    ].map(([name,value]) => <div key={name}><dt className="text-xs text-text-secondary">{name}</dt><dd className="mt-1 font-bold tabular-nums">{value}</dd></div>)}</dl>
    {read.error && <p role="alert" className="text-sm text-rose-700">Readiness unavailable. Reload Payroll before finalizing.</p>}
    <ul className="divide-y divide-border" aria-label="Finalization checklist">{gates.map(gate => <li key={gate.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <div><strong>{gate.name}</strong>{gate.key === "membership" && readiness?.calculation?.employment_issue && <p className="mt-1 text-text-secondary">{payrollIssueLabel(readiness.calculation.employment_issue)}</p>}</div><div className="flex items-center gap-3"><Badge tone={gate.ready ? "success" : "warning"}>{gate.ready ? "Ready" : "Needs resolution"}</Badge>
        {!gate.ready && <button type="button" className="font-semibold text-primary" aria-label={`Resolve ${gate.name}`} onClick={() => onResolve(gate.step)}>Resolve →</button>}</div>
    </li>)}</ul>
    {bankRead?.missingCount > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><strong>{bankRead.missingCount} employee{bankRead.missingCount === 1 ? "" : "s"} with incomplete Bank Details</strong><p className="mt-1">Payment information warning; this does not block finalization.</p><button type="button" className="mt-2 font-semibold" onClick={() => onResolve(1)}>View Bank Details →</button></div>}
    <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-primary" disabled={!canFinalize || !allReady || busy || !read.data || !!read.error} onClick={onFinalize}>Finalize Payroll</button>
      {!allReady && <span className="text-sm text-text-secondary">{remaining || 1} required item{remaining === 1 ? "" : "s"} remaining</span>}
      {!canFinalize && <span className="text-sm text-text-secondary">Finalize permission required.</span>}
    </div>
  </Card>;
}
