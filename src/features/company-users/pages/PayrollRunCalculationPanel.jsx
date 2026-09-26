import { useCallback, useEffect, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import { payrollEmployeeResult, payrollIssueLabel } from "./payrollRunPresentation.js";

const rm = (value) => new Intl.NumberFormat("en-MY", {
  style: "currency", currency: "MYR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0));
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const issueLabel = payrollIssueLabel;
const overallStatus = (calculation, statutory) => {
  return payrollEmployeeResult(calculation, statutory).status;
};

export function ResultDetail({ result, statutory, frozenPeriod, onClose }) {
  const compensation = result.inputs?.compensation_start;
  const time = result.inputs?.time || [];
  const deductions = statutory ? Number(result.non_statutory_deductions || 0) + (statutory.lines || []).reduce((sum, line) => sum + Number(line.employee_amount || 0), 0) : null;
  const amount = value => value == null ? "—" : rm(value);
  const row = (name, value, note, key = name) => <div key={key} className="flex justify-between gap-4 py-2 text-sm"><span>{name}{note && <small className="block text-text-secondary">{note}</small>}</span><strong className="shrink-0 tabular-nums">{typeof value === "string" ? value : amount(value)}</strong></div>;
  const financialLines = kind => (result.lines || []).filter(line => line.kind === kind).map((line, index) => row(line.label, line.amount,
    line.minutes != null ? `${(line.minutes / 60).toFixed(2)} h · ${line.multiplier}×` : line.source?.effective_from ? `Effective ${line.source.effective_from}` : line.source?.run_adjustment_id ? "This period adjustment" : null, `${kind}-${index}`));
  const statutoryRows = employer => (statutory?.lines || []).filter(line => !employer || line.scheme !== "pcb").map(line => row(line.scheme === "pcb" ? "PCB / MTD" : line.scheme.toUpperCase(),
    line.applicable === false ? "N/A" : employer ? line.employer_amount : line.employee_amount,
    line.applicable === false ? "Not Applicable" : line.category ? title(line.category) : null));
  return <Modal title={result.employee_name} description={frozenPeriod ? `${frozenPeriod} · Finalized read-only Payroll statement` : "Employee Payroll statement"}
    onClose={onClose} size="xl" footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
    <div className="space-y-6">
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-surface-muted p-4 text-sm">{[["Gross Earnings", result.gross_earnings], ["Total Deductions", deductions], ["Net Pay", statutory?.net_pay]].map(([name, value]) => <div key={name}><dt className="text-text-secondary">{name}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{amount(value)}</dd></div>)}</dl>
      <section><h4 className="text-lg font-bold">Earnings</h4><p className="mt-1 text-xs text-text-secondary">{compensation ? `${title(compensation.pay_basis)} · Effective ${compensation.effective_from}` : "Pinned compensation evidence"}</p>
        <div className="mt-2 divide-y divide-border">{financialLines("earning")}{row("Gross Earnings",result.gross_earnings)}</div>
        {Number(result.reimbursements) > 0 && <div className="mt-3 divide-y divide-border">{financialLines("reimbursement")}</div>}
      </section>
      {(compensation?.pay_basis === "hourly" || time.length > 0) && <section className="border-t border-border pt-4"><h4 className="font-bold">Time & Attendance</h4><p className="text-sm text-text-secondary">{time.length} days · approved payable-time evidence retained in this result.</p></section>}
      <section className="border-t border-border pt-4"><h4 className="text-base font-bold">Employee Deductions</h4><div className="mt-2 divide-y divide-border">{statutoryRows(false)}{financialLines("deduction")}{row("Total Deductions",deductions)}</div></section>
      <section className="rounded-xl bg-primary/5 p-4"><h4 className="text-lg font-bold">Net Pay</h4><div className="mt-2 divide-y divide-border">{row("Gross Earnings",result.gross_earnings)}{row("− Total Deductions",deductions)}
        {Number(result.reimbursements)>0 && row("+ Reimbursements",result.reimbursements,"Outside Gross Earnings")}
        <div className="flex justify-between py-3 text-xl font-bold"><span>= Net Pay</span><span className="tabular-nums">{amount(statutory?.net_pay)}</span></div></div></section>
      <section className="border-t border-border pt-4 text-text-secondary"><h4 className="font-semibold">Employer Contributions</h4><div className="mt-2 divide-y divide-border">{statutoryRows(true)}
        {(statutory?.lines || []).some(line=>Number(line.remittance_rounding)>0) && row("Employer-funded remittance rounding",statutory.lines.reduce((sum,line)=>sum+Number(line.remittance_rounding || 0),0))}
        {row("Total Employer Contributions",statutory?.employer_statutory_cost)}{row("Total Employer Cost",statutory?.total_employer_cost)}</div><p className="text-xs">Employer contributions do not reduce employee Net Pay.</p></section>
      <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Calculation evidence</summary><p className="mt-2">Calculation revision {result.revision} · {result.calculated_at ? new Date(result.calculated_at).toLocaleString() : "Pinned evidence"}</p>
        {(statutory?.lines || []).map(line=><p key={line.scheme} className="mt-2">{line.scheme.toUpperCase()} · {line.source_version || line.method || "Not Applicable"}{line.wage_base != null ? ` · Wage base ${rm(line.wage_base)}` : ""}</p>)}
      </details>
      {(result.issues?.length || statutory?.issues?.length) > 0 && <p role="alert" className="text-sm text-amber-800">{[...(result.issues || []),...(statutory?.issues || [])].map(issueLabel).join(" · ")}</p>}
    </div>
  </Modal>;
}
export default function PayrollRunCalculationPanel({ run, canManage, onChanged, onReviewEmployee, stage = "calculate" }) {
  const [data, setData] = useState(null);
  const [statutory, setStatutory] = useState(null);
  const [pcb, setPcb] = useState(null);
  const [preparation, setPreparation] = useState(null);
  const [pcbForm, setPcbForm] = useState(null);
  const [pcbDraft, setPcbDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const load = useCallback(async () => {
    try {
      const [calculation, statutoryResult, pcbResult, preparationResult] = await Promise.all([
        payrollService.readCalculation(run.id), payrollService.readStatutory(run.id), payrollService.readPcb(run.id),
        payrollService.readPreparation(run.id),
      ]);
      setData(calculation); setStatutory(statutoryResult); setPcb(pcbResult); setPreparation(preparationResult); setError("");
    }
    catch (cause) { setError(cause.message || "Unable to read Payroll calculations."); }
  }, [run.id]);
  useEffect(() => { load(); }, [load]);
  const calculate = async () => {
    setBusy(true); setError("");
    try { await payrollService.calculateRun(run.id); await load(); await onChanged?.(); }
    catch (cause) { setError(cause.message || "Unable to calculate Run."); }
    finally { setBusy(false); }
  };
  const calculateStatutory = async () => {
    setBusy(true); setError("");
    try { await payrollService.calculateStatutory(run.id); await load(); await onChanged?.(); }
    catch (cause) { setError(cause.message || "Unable to calculate statutory results."); }
    finally { setBusy(false); }
  };
  const openPcb = (row) => {
    const current = pcb?.results?.find((item) => item.employee_id === row.employee_id)?.confirmation;
    setPcbDraft({ requestId: crypto.randomUUID(), employeeId: row.employee_id,
      amount: current?.amount == null ? "" : String(current.amount),
      sourceReference: current?.source_reference || "", note: current?.note || "", reason: "" });
    setPcbForm(row);
  };
  const savePcb = async () => {
    setBusy(true); setError("");
    try {
      await payrollService.confirmPcb({ ...pcbDraft, runId: run.id, reason: pcbDraft.reason.trim() });
      await payrollService.recalculateEmployee(run.id, pcbDraft.employeeId);
      setPcbForm(null); setPcbDraft(null);
      await load(); await onChanged?.();
    } catch (cause) { setError(cause.message || "Unable to confirm PCB / MTD."); }
    finally { setBusy(false); }
  };
  const rows = (preparation?.results || []).map((member) => {
    const result = data?.results?.find((row) => row.employee_id === member.employee_id);
    return result ? (run.status === "finalized" ? { ...result, is_stale: false } : result) : {
      ...member.projection, id: member.employee_id, employee_id: member.employee_id,
      uncalculated: true, gross_earnings: null, non_statutory_deductions: null,
      issues: member.projection?.issues?.length ? member.projection.issues : ["Calculate payroll after preparing inputs"],
      status: "review_required",
    };
  });
  const statutoryRows = (statutory?.results || []).map((row) => run.status === "finalized" ? { ...row, is_stale: false } : row);
  const pcbRows = pcb?.results || [];
  const statutoryFor = (row) => statutoryRows.find((item) => item.employee_id === row.employee_id);
  const schemeAmount = (row, scheme) => {
    const result = statutoryFor(row);
    const line = result?.lines?.find((item) => item.scheme === scheme);
    return line?.applicable === false ? "N/A" : !payrollEmployeeResult(row, result).statutoryCurrent || line?.employee_amount == null ? "Pending" : rm(line.employee_amount);
  };
  const columns = stage === "review" ? [
    { key: "employee", header: "Employee", render: (row) => <div><strong>{row.employee_name}</strong><div className="text-xs text-text-secondary">{row.employee_code || "—"}</div></div> },
    { key: "gross", header: "Gross", align: "right", render: (row) => <span className="tabular-nums">{row.uncalculated ? "Pending calculation" : row.status !== "ready" || row.is_stale ? "Pending review" : rm(row.gross_earnings)}</span> },
    { key: "adjustments", header: "Adjustments", align: "right", render: (row) => {
      const items = (data?.adjustments || []).filter((item) => item.employee_id === row.employee_id);
      const amount = items.reduce((sum, item) => sum + Number(item.amount) * (item.component_type === "deduction" ? -1 : 1), 0);
      return items.length ? `${amount < 0 ? "−" : "+"}${rm(Math.abs(amount))}` : "None";
    } },
    ...["epf", "socso", "eis"].map((scheme) => ({ key: scheme, header: scheme.toUpperCase(), align: "right", render: (row) => <span className="tabular-nums">{schemeAmount(row, scheme)}</span> })),
    { key: "pcb", header: "PCB / MTD", align: "right", render: (row) => {
      const evidence = pcbRows.find((item) => item.employee_id === row.employee_id);
      return <span className="tabular-nums">{evidence?.applicable === false ? "N/A" : evidence?.applicable == null ? "Period setup required" : evidence?.confirmation ? rm(evidence.confirmation.amount) : "Confirmation required"}</span>;
    } },
    { key: "deductions", header: "Deductions", align: "right", render: (row) => {
      const value = payrollEmployeeResult(row, statutoryFor(row)).deductions;
      return <span className="tabular-nums">{value == null ? "Pending review" : rm(value)}</span>;
    } },
    { key: "net", header: "Net Pay", align: "right", render: (row) => {
      const value = payrollEmployeeResult(row, statutoryFor(row)).net;
      return <strong className="tabular-nums">{value == null ? "Pending review" : rm(value)}</strong>;
    } },
    { key: "status", header: "Status", render: (row) => {
      const result = statutoryFor(row);
      const status = overallStatus(row, result);
      return <div><Badge tone={status === "Ready" ? "success" : "warning"}>{status}</Badge>
        {status !== "Ready" && <small className="mt-1 block max-w-48 text-text-secondary">{(result?.issues || row.issues || []).map(issueLabel).join(" · ") || "Open details to resolve"}</small>}</div>;
    } },
    { key: "action", header: "Action", render: (row) => <button className="font-semibold text-primary" type="button" onClick={(event) => { event.stopPropagation(); onReviewEmployee ? onReviewEmployee(row.employee_id) : setSelected(row); }}>Review</button> },
  ] : [
    { key: "employee", header: "Employee", render: (row) => <div><strong>{row.employee_name}</strong><div className="text-xs text-text-secondary">{row.employee_code || "—"}</div></div> },
    { key: "basis", header: "Pay Basis", render: (row) => title(row.pay_basis || "Missing") },
    { key: "base", header: "Basic / Hours", render: (row) => row.basic_or_hours || "—" },
    { key: "earnings", header: "Earnings", align: "right", render: (row) => <span className="tabular-nums">{rm(row.gross_earnings)}</span> },
    { key: "deductions", header: "Deductions", align: "right", render: (row) => <span className="tabular-nums">{rm(row.non_statutory_deductions)}</span> },
    { key: "pay", header: "Pre-statutory Pay", align: "right", render: (row) => <strong className="tabular-nums">{rm(row.pre_statutory_pay)}</strong> },
    { key: "net", header: "Net Pay", align: "right", render: (row) => {
      const value = statutoryRows.find((item) => item.employee_id === row.employee_id);
      return <strong className="tabular-nums">{value?.net_pay == null || value.is_stale ? "—" : rm(value.net_pay)}</strong>;
    } },
    { key: "pcb", header: "PCB / MTD", align: "right", render: (row) => {
      const evidence = pcbRows.find((item) => item.employee_id === row.employee_id);
      return <div className="flex flex-col items-end gap-1 text-xs">
        <span className="tabular-nums">{evidence?.applicable === false ? "Not applicable" : evidence?.confirmation ? rm(evidence.confirmation.amount) : "Not confirmed"}</span>
        {canEdit && evidence?.applicable === true && <button className="btn-secondary" type="button" disabled={busy}
          onClick={(event) => { event.stopPropagation(); openPcb(row); }}>{evidence.confirmation ? "Correct" : "Confirm"}</button>}
      </div>;
    } },
    { key: "status", header: "Status", render: (row) => {
      const status = overallStatus(row, statutoryRows.find((item) => item.employee_id === row.employee_id));
      return <Badge tone={status === "Ready" ? "success" : "warning"}>{status}</Badge>;
    } },
  ];
  const canEdit = canManage && ["draft", "review_required"].includes(run.status);
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <div><h4 className="font-bold text-text-primary">{stage === "review" ? "Review Payroll" : "Calculate Payroll"}</h4>
        <p className="text-sm text-text-secondary">{data?.readiness ?
          `${rows.length} employees · ${rows.filter((row) => overallStatus(row, statutoryFor(row)) !== "Ready").length} need attention${data.readiness.period_in_progress ? " · pay period still in progress" : ""}` : "Loading payroll evidence…"}</p></div>
      {canEdit && <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" type="button" disabled={busy || !rows.length} onClick={calculateStatutory}>{busy ? "Calculating…" : "Calculate Statutory"}</button>
        <button className="btn-primary" type="button" disabled={busy} onClick={calculate}>{busy ? "Calculating…" : rows.length ? "Recalculate" : "Calculate Payroll"}</button></div>}
    </div>
    {stage === "review" && rows.length > 0 && <div className="grid gap-3 border-b border-border p-4 text-sm sm:grid-cols-5">
      <div><span className="text-text-secondary">Gross Payroll</span><strong className="block tabular-nums">{rows.some((row) => row.is_stale || row.uncalculated || row.status !== "ready") ? "Pending review" : rm(rows.reduce((sum, row) => sum + Number(row.gross_earnings || 0), 0))}</strong></div>
      <div><span className="text-text-secondary">Employee Deductions</span><strong className="block tabular-nums">{statutoryRows.length === rows.length && statutoryRows.every((row) => row.net_pay != null && !row.is_stale) ? rm(rows.reduce((sum, row) => sum + Number(row.non_statutory_deductions), 0) + statutoryRows.reduce((sum, row) => sum + (row.lines || []).reduce((subtotal, line) => subtotal + Number(line.employee_amount || 0), 0), 0)) : "Pending review"}</strong></div>
      <div><span className="text-text-secondary">Employer Contributions</span><strong className="block tabular-nums">{statutoryRows.length === rows.length && statutoryRows.every((row) => row.net_pay != null && !row.is_stale) ? rm(statutoryRows.reduce((sum, row) => sum + (row.lines || []).reduce((subtotal, line) => subtotal + Number(line.employer_amount || 0) + Number(line.remittance_rounding || 0), 0), 0)) : "Pending review"}</strong></div>
      <div><span className="text-text-secondary">Net Payroll</span><strong className="block tabular-nums">{statutoryRows.length === rows.length && statutoryRows.every((row) => row.net_pay != null && !row.is_stale) ? rm(statutoryRows.reduce((sum, row) => sum + Number(row.net_pay), 0)) : "Pending review"}</strong></div>
      <div><span className="text-text-secondary">Employees Ready / Need Attention</span><strong className="block">{rows.filter((row) => overallStatus(row, statutoryFor(row)) === "Ready").length} / {rows.filter((row) => overallStatus(row, statutoryFor(row)) !== "Ready").length}</strong></div>
    </div>}
    {error && <p role="alert" className="px-4 pt-3 text-sm font-semibold text-rose-700">{error}</p>}
    {stage === "review" && <p className="px-4 py-2 text-xs text-text-secondary">Adjustments are included in Gross or Deductions, not added twice. Employer contributions are separate from employee Net Pay.</p>}
    {rows.length ? <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id || row.employee_id} density="compact" onRowClick={(row) => onReviewEmployee ? onReviewEmployee(row.employee_id) : setSelected(row)} /> :
      <p className="p-6 text-sm text-text-secondary">No payroll results yet. Use Calculate to prepare the employee breakdown.</p>}
    {selected && <ResultDetail result={selected} statutory={statutoryRows.find((item) => item.employee_id === selected.employee_id)}
      pcb={pcbRows.find((item) => item.employee_id === selected.employee_id)} onClose={() => setSelected(null)} />}
    {pcbForm && pcbDraft && <Modal title={`${pcbDraft.amount === "" ? "Confirm" : "Correct"} PCB / MTD · ${pcbForm.employee_name}`}
      description="Enter the confirmed statutory PCB amount for this employee and pay period. Draft corrections retain audit history."
      onClose={() => !busy && setPcbForm(null)} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setPcbForm(null)}>Cancel</button>
        <button className="btn-primary" type="button" disabled={busy || pcbDraft.amount === "" || !Number.isFinite(Number(pcbDraft.amount)) || Number(pcbDraft.amount) < 0 || !pcbDraft.reason.trim()}
          onClick={savePcb}>{busy ? "Saving…" : "Confirm PCB / MTD"}</button></>}>
      <div className="space-y-3">
        <AdminFormField label="Confirmed PCB / MTD (RM)" required><input className="control" type="number" inputMode="decimal" min="0" step="0.01"
          value={pcbDraft.amount} onChange={(event) => setPcbDraft((value) => ({ ...value, amount: event.target.value }))} /></AdminFormField>
        <AdminFormField label="Source / Reference (optional)"><input className="control" value={pcbDraft.sourceReference}
          onChange={(event) => setPcbDraft((value) => ({ ...value, sourceReference: event.target.value }))} /></AdminFormField>
        <AdminFormField label="Note (optional)"><input className="control" value={pcbDraft.note}
          onChange={(event) => setPcbDraft((value) => ({ ...value, note: event.target.value }))} /></AdminFormField>
        <AdminFormField label="Reason" required><input className="control" value={pcbDraft.reason}
          onChange={(event) => setPcbDraft((value) => ({ ...value, reason: event.target.value }))} /></AdminFormField>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>}
  </Card>;
}
