import PayrollEmploymentHistoryRequired, { employmentHistoryRecords } from "./PayrollEmploymentHistoryRequired.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import PayrollStageHeading from "./PayrollStageHeading.jsx";

// Checklist explains existing server gates; it never grants Finalize authority.
export function finalizationGates(readiness, foundationOnly = false, calculating = false) {
  const calculation = readiness?.calculation;
  const membership = Boolean(calculation && !calculation.employment_issue);
  const periodClosed = Boolean(readiness?.time && !readiness.time.period_in_progress && !calculation?.period_in_progress);
  const calculationReady = foundationOnly || Boolean(calculation && !calculating && !calculation.uncalculated && !calculation.review_required && !calculation.stale && calculation.employees > 0);
  return [
    {key:"time",name:"Time & Attendance",ready:readiness?.time?.ready === true,step:0},
    {key:"membership",name:membership ? "Employment History" : "Employment History Required",ready:membership,step:0},
    {key:"calculation",name:"Payroll Calculation",ready:calculationReady,step:0},
    {key:"statutory",name:"Statutory",ready:foundationOnly || (!calculating && readiness?.statutory?.ready === true),step:1},
    ...(!periodClosed ? [{key:"period",name:"Pay Period Complete",ready:false,step:0}] : []),
  ];
}
export default function PayrollFinalizationReadiness({ run, read, readiness, allReady, canFinalize, busy, onResolve, onFinalize, bankRead, employees, canEditEmployee }) {
  const gates = finalizationGates(readiness, run.foundation_only, read.calculating);
  const remaining = gates.filter(gate => !gate.ready).length;
  return <section className="space-y-3">
    <PayrollStageHeading title="Finalize Payroll" summary={allReady ? "All required items ready" : `${remaining || 1} required item${remaining === 1 ? "" : "s"} remaining`} />
    <p className="text-sm text-text-secondary">Finalization freezes this Payroll revision and its evidence. It does not make payment.</p>
    {read.error && <p role="alert" className="text-sm text-rose-700">Readiness unavailable. Reload Payroll before finalizing.</p>}
    <ul className="divide-y divide-border" aria-label="Finalization checklist">{gates.map(gate => <li key={gate.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <div><strong>{gate.name}</strong>{gate.key === "membership" && readiness?.calculation?.employment_issue && <PayrollEmploymentHistoryRequired heading={false} issue={readiness.calculation.employment_issue} preparation={read.data?.preparation} employees={employees} canEditEmployee={canEditEmployee} />}</div><div className="flex items-center gap-3"><Badge tone={gate.ready ? "success" : "warning"}>{gate.ready ? "Ready" : "Needs resolution"}</Badge>
        {!gate.ready && !(gate.key === "membership" && canEditEmployee && employmentHistoryRecords(read.data?.preparation).length) && <button type="button" className="font-semibold text-primary" aria-label={`Resolve ${gate.name}`} onClick={() => onResolve(gate.step)}>Resolve →</button>}</div>
    </li>)}</ul>
    {bankRead?.missingCount > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><strong>{bankRead.missingCount} employee{bankRead.missingCount === 1 ? "" : "s"} with incomplete Bank Details</strong><p className="mt-1">Payment information warning; this does not block finalization.</p><button type="button" className="mt-2 font-semibold" onClick={() => onResolve(1)}>View Bank Details →</button></div>}
    <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-primary" disabled={!canFinalize || !allReady || busy || !read.data || !!read.error} onClick={onFinalize}>Finalize Payroll</button>
      {!canFinalize && <span className="text-sm text-text-secondary">Finalize permission required.</span>}
    </div>
  </section>;
}
