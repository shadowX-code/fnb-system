import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { statutoryName } from "./payrollStatutoryLabels.js";
import { statutorySchemeLabel } from "./PayrollStatutorySetup.jsx";
import { payrollIssueLabel } from "./payrollRunPresentation.js";
import PayrollMonthlyBasicBreakdown, { PayrollRecurringBreakdown } from "./PayrollMonthlyBasicBreakdown.jsx";

const rm = (value) => new Intl.NumberFormat("en-MY", {
  style: "currency", currency: "MYR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0));
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const issueLabel = payrollIssueLabel;

export function ResultDetail({ result, statutory, frozenPeriod, onClose, bankInfo, payslip }) {
  const compensation = result.inputs?.compensation_start;
  const time = result.inputs?.time || [];
  const deductions = statutory ? Number(result.non_statutory_deductions || 0) + (statutory.lines || []).reduce((sum, line) => sum + Number(line.employee_amount || 0), 0) : null;
  const amount = value => value == null ? "—" : rm(value);
  const row = (name, value, note, key = name) => <div key={key} className="flex justify-between gap-4 py-2 text-sm"><span>{name}{note && <small className="block text-text-secondary">{note}</small>}</span><strong className="shrink-0 tabular-nums">{typeof value === "string" ? value : amount(value)}</strong></div>;
  const financialLines = kind => (kind === "earning" ? result.earning_groups || [] : (result.lines || []).filter(line => line.kind === kind)).map((line, index) => <div key={`${kind}-${index}`}>
    {row(line.label, line.amount, line.minutes != null ? `${(line.minutes / 60).toFixed(2)} h · ${line.multiplier}×` : line.source?.effective_from ? `Effective ${line.source.effective_from}` : line.source?.run_adjustment_id ? "This period adjustment" : null)}
    <PayrollMonthlyBasicBreakdown line={line} /><PayrollRecurringBreakdown line={line} /></div>);
  const statutoryRows = employer => (statutory?.lines || []).filter(line => !employer || !["pcb", "lindung"].includes(line.scheme)).map(line => row(statutoryName(line.scheme),
    line.applicable === false ? "N/A" : employer ? line.employer_amount : line.employee_amount,
    line.scheme === "lindung" ? statutorySchemeLabel("lindung",{status:line.participation_status}) : line.applicable === false ? "Not Applicable" : line.category ? statutorySchemeLabel(line.scheme,{state:"confirmed",applicable:true,category:line.category,status:line.participation_status}) : line.method === "manual_confirmed" ? "Confirmed" : null));
  return <Modal title={result.employee_name} description={frozenPeriod ? `${frozenPeriod} · Finalized read-only Payroll statement` : "Employee Payroll statement"}
    onClose={onClose} size="xl" footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
    <div className="space-y-6">
      {(result.issues?.length || statutory?.issues?.length) > 0 && <p role="alert" className="text-sm text-amber-800">{[...(result.issues || []),...(statutory?.issues || [])].map(issueLabel).join(" · ")}</p>}
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-surface-muted p-4 text-sm">{[["Gross Earnings", result.gross_earnings], ["Total Deductions", deductions], ["Net Pay", statutory?.net_pay]].map(([name, value]) => <div key={name}><dt className="text-text-secondary">{name}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{amount(value)}</dd></div>)}</dl>
      <section><h4 className="font-bold">Compensation</h4><p className="mt-2 text-sm">{compensation ? `${title(compensation.pay_basis)} · ${amount(compensation.pay_basis === "hourly" ? compensation.hourly_rate : compensation.basic_salary)}${compensation.pay_basis === "hourly" ? " / hour" : ""} · Effective ${compensation.effective_from}` : "Compensation snapshot unavailable"}</p></section>
      <section><h4 className="text-lg font-bold">Earnings</h4><p className="mt-1 text-xs text-text-secondary">{compensation ? `${title(compensation.pay_basis)} · Effective ${compensation.effective_from}` : "Pinned compensation evidence"}</p>
        <div className="mt-2 divide-y divide-border">{financialLines("earning")}{row("Gross Earnings",result.gross_earnings)}</div>
        {Number(result.reimbursements) > 0 && <div className="mt-3 divide-y divide-border">{financialLines("reimbursement")}</div>}
      </section>
      {(compensation?.pay_basis === "hourly" || time.length > 0) && <section className="border-t border-border pt-4"><h4 className="font-bold">Time & Attendance</h4><p className="text-sm text-text-secondary">{time.length} days · approved payable-time evidence retained in this result.</p></section>}
      {result.inputs?.ph_work?.filter(Boolean).length > 0 && <section className="border-t border-border pt-4"><h4 className="font-bold">Public Holiday Work · Company Benefit</h4>
        <div className="divide-y divide-border">{result.inputs.ph_work.filter(Boolean).map(ph => row(ph.work_date,
          ph.decision?.treatment === "replacement_leave" ? "Replacement Leave · 1 day granted" : amount(ph.additional_amount),
          ph.decision?.treatment === "replacement_leave" ? "Expires 31 December; no carry-forward. Frozen source-linked grant." : ph.formula,
          ph.work_date))}</div><p className="text-xs text-text-secondary">Company benefit, not statutory PH entitlement. This statement reads the pinned revision only.</p></section>}
      <section className="border-t border-border pt-4"><h4 className="text-base font-bold">Employee Deductions</h4><div className="mt-2 divide-y divide-border">{statutoryRows(false)}{financialLines("deduction")}{row("Total Deductions",deductions)}</div></section>
      <section className="rounded-xl bg-primary/5 p-4"><h4 className="text-lg font-bold">Net Pay</h4><div className="mt-2 divide-y divide-border">{row("Gross Earnings",result.gross_earnings)}{row("− Total Deductions",deductions)}
        {Number(result.reimbursements)>0 && row("+ Reimbursements",result.reimbursements,"Outside Gross Earnings")}
        <div className="flex justify-between py-3 text-xl font-bold"><span>= Net Pay</span><span className="tabular-nums">{amount(statutory?.net_pay)}</span></div></div></section>
      <section className="border-t border-border pt-4 text-text-secondary"><h4 className="font-semibold">Employer Contributions</h4><div className="mt-2 divide-y divide-border">{statutoryRows(true)}
        {(statutory?.lines || []).some(line=>Number(line.remittance_rounding)>0) && row("Employer-funded remittance rounding",statutory.lines.reduce((sum,line)=>sum+Number(line.remittance_rounding || 0),0))}
        {row("Total Employer Contributions",statutory?.employer_statutory_cost)}{row("Total Employer Cost",statutory?.total_employer_cost)}</div><p className="text-xs">Employer contributions do not reduce employee Net Pay.</p></section>
      <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Calculation details</summary>{(result.lines || []).filter(line => line.kind === "earning").map((line,index) => row(`${line.source?.work_date || "Period"} · ${line.label}`,line.amount,null,`daily-${index}`))}<p className="mt-2">Calculation revision {result.revision} · {result.calculated_at ? new Date(result.calculated_at).toLocaleString() : "Pinned evidence"}</p>
        {(statutory?.lines || []).map(line=><p key={line.scheme} className="mt-2">{statutoryName(line.scheme)} · {line.applicable === false ? "Not Applicable" : line.method === "manual_confirmed" ? "Admin confirmed" : line.source_row || line.source_version || "Pinned contribution schedule"}{line.wage_base != null ? ` · Wage base ${rm(line.wage_base)}` : ""}{line.schedule_version_id && <small className="block">Schedule version {line.schedule_version_id}</small>}</p>)}
      </details>
      {payslip}
      {bankInfo && <section className="border-t border-border pt-4"><h4 className="font-bold">Bank Information</h4>{bankInfo}<p className="mt-1 text-xs text-text-secondary">Current Employee information · read-only; not a finalized payment snapshot.</p></section>}
    </div>
  </Modal>;
}
