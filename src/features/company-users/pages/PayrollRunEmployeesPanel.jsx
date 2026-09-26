import { useCallback, useEffect, useMemo, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import PayrollPayableTimeReview from "./PayrollPayableTimeReview.jsx";
import PayrollMonthlyBasicBreakdown from "./PayrollMonthlyBasicBreakdown.jsx";
import { statutorySchemeLabel } from "./PayrollStatutorySetup.jsx";
import { payComponentIsConfigured, payrollEmployeeResult, payrollIssueLabel } from "./payrollRunPresentation.js";

const money = (value) => value == null ? "—" : new Intl.NumberFormat("en-MY", {
  style: "currency", currency: "MYR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value));
const periodEnd = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const currentDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const human = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const hours = (minutes) => minutes == null ? "—" : `${(Number(minutes) / 60).toFixed(2)} h`;
const signedMoney = (amount) => `${amount < 0 ? "−" : "+"}${money(Math.abs(amount))}`;
const signedAdjustments = (items) => signedMoney(items.reduce((sum, item) => sum + Number(item.amount) * (item.component_type === "deduction" ? -1 : 1), 0));

export default function PayrollRunEmployeesPanel({ run, data, entityId, month, canManage, onChanged, focusEmployeeId = "" }) {
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [reviewHours, setReviewHours] = useState(false);
  const [pcbDraft, setPcbDraft] = useState(null);
  const [adjustment, setAdjustment] = useState(null);
  const load = useCallback(async () => {
    try {
      const [time, calculation, statutory, pcb, preparation] = await Promise.all([
        payrollService.readTime(entityId, `${month}-01`, periodEnd(month)),
        payrollService.readCalculation(run.id), payrollService.readStatutory(run.id), payrollService.readPcb(run.id),
        payrollService.readPreparation(run.id),
      ]);
      setEvidence({ time, calculation, statutory, pcb, preparation }); setError("");
    } catch (cause) { setError(cause.message || "Unable to load employee payroll evidence."); }
  }, [entityId, month, run.id]);
  useEffect(() => { setEvidence(null); load(); }, [load]);
  useEffect(() => { if (focusEmployeeId) setEmployeeId(focusEmployeeId); }, [focusEmployeeId]);
  const rows = useMemo(() => (evidence?.pcb?.results || []).map((member) => {
    const employee = (data.employees || []).find((item) => item.id === member.employee_id)
      || { id: member.employee_id, name: evidence?.calculation?.results?.find((item) => item.employee_id === member.employee_id)?.employee_name || "Employee", employee_code: "" };
    const profile = (data.profiles || []).find((item) => item.employee_id === employee.id);
    const time = (evidence?.time || []).filter((item) => item.employee_id === employee.id);
    const calculation = evidence?.calculation?.results?.find((item) => item.employee_id === employee.id);
    const statutory = evidence?.statutory?.results?.find((item) => item.employee_id === employee.id);
    const pcb = member;
    const preparation = evidence?.preparation?.results?.find((item) => item.employee_id === employee.id);
    const projection = preparation?.projection;
    const adjustments = (evidence?.calculation?.adjustments || []).filter((item) => item.employee_id === employee.id);
    const pay = projection?.inputs?.compensation_start?.id ? projection.inputs.compensation_start : projection?.inputs?.compensation_end;
    const timeRelevant = preparation?.time_relevant === true;
    const timeNeedsReview = timeRelevant && time.some((item) => item.status === "review_required");
    const needsReview = !pay || preparation?.statutory_setup?.complete !== true || timeNeedsReview || projection?.status === "review_required"
      || !calculation || calculation.status !== "ready" || calculation.is_stale
      || !statutory || statutory.status !== "ready" || statutory.is_stale
      || (pcb?.applicable === true && !pcb?.confirmation);
    return { ...employee, profile, time, calculation, statutory, result: payrollEmployeeResult(calculation, statutory), pcb, adjustments, pay, preparation, projection, timeRelevant, timeNeedsReview, needsReview };
  }), [data, entityId, evidence, month]);
  const visible = [...rows]
    .sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || a.name.localeCompare(b.name));
  const selected = rows.find((row) => row.id === employeeId);
  const adjustmentComponent = (data.components || []).find((item) => item.id === adjustment?.componentId);
  const active = canManage && ["draft", "review_required"].includes(run.status);
  const adjustmentActions = (item) => active && <span className="ml-3 inline-flex gap-3">
    {["edit", "remove"].map(action => <button key={action} type="button" className="font-semibold text-primary" disabled={busy}
      onClick={() => setAdjustment({ requestId: crypto.randomUUID(), action, adjustmentId: item.id, componentId: item.component_id, amount: String(item.amount), reason: "" })}>{human(action)}</button>)}
  </span>;
  const financialLine = (line, index) => {
    const saved = selected.adjustments.find(item => item.id === line.source?.run_adjustment_id);
    return <div key={`${line.code}-${index}`} className="py-2"><div className="flex justify-between gap-3"><span>{line.label}
      <small className="block text-text-secondary">{saved ? `This period adjustment · ${saved.reason}` : line.minutes != null ? `${hours(line.minutes)} · ${line.multiplier}×` : line.source?.effective_from ? `Effective ${line.source.effective_from}` : "Approved period evidence"}</small></span>
      <span className="shrink-0 text-right"><strong className="tabular-nums">{selected.result.earningsCurrent ? `${line.kind === "deduction" ? "−" : ""}${money(line.amount)}` : "Pending review"}</strong>
        {saved && adjustmentActions(saved)}</span></div>
      {selected.result.earningsCurrent && <PayrollMonthlyBasicBreakdown line={line} />}</div>;
  };
  const refresh = async () => { await load(); await onChanged?.(); };
  const reconcile = async () => {
    setBusy(true); setError("");
    try {
      const end = periodEnd(month);
      await payrollService.reconcileTime(entityId, `${month}-01`, end < currentDate() ? end : currentDate());
      await refresh();
    } catch (cause) { setError(cause.message || "Unable to reconcile time evidence."); }
    finally { setBusy(false); }
  };
  const savePcb = async () => {
    setBusy(true); setError("");
    try { await payrollService.confirmPcb({ ...pcbDraft, runId: run.id, reason: pcbDraft.reason.trim() });
      setPcbDraft(null);
      await payrollService.recalculateEmployee(run.id, pcbDraft.employeeId);
      await refresh(); }
    catch (cause) { await refresh(); setError(cause.message || "Unable to confirm PCB / MTD."); }
    finally { setBusy(false); }
  };
  const saveAdjustment = async () => {
    setBusy(true); setError("");
    try { await payrollService.saveDraftAdjustment({ ...adjustment, runId: run.id, employeeId: selected.id, reason: adjustment.reason.trim() });
      setAdjustment(null);
      await payrollService.recalculateEmployee(run.id, selected.id);
      await refresh(); }
    catch (cause) { await refresh(); setError(cause.message || "Unable to save adjustment or refresh payroll. Review saved evidence and retry Refresh Employee Calculation."); }
    finally { setBusy(false); }
  };
  const timeDecisionSaved = async () => {
    try { await payrollService.recalculateEmployee(run.id, selected.id); }
    finally { await refresh(); }
  };
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <div><strong>{row.name}</strong><small className="block text-text-secondary">{row.employee_code || "—"}</small></div> },
    { key: "pay", header: "Pay", render: (row) => row.pay ? <span>{human(row.pay.pay_basis)}<small className="block text-text-secondary">{money(row.pay.basic_salary || row.pay.hourly_rate)}{row.pay.pay_basis === "hourly" ? " / hour" : ""}</small></span> : <Badge tone="warning">Setup required</Badge> },
    { key: "time", header: "Time & Attendance", render: (row) => !row.timeRelevant ? "Not required" : <Badge tone={row.timeNeedsReview ? "warning" : "neutral"}>{row.timeNeedsReview ? `${row.time.filter((item) => item.status === "review_required").length} exceptions` : row.time.length ? "Reviewed" : "Time evidence required"}</Badge> },
    { key: "adjustments", header: "Adjustments", render: (row) => row.adjustments.length ? `${row.adjustments.length} adjustment${row.adjustments.length === 1 ? "" : "s"} · ${signedAdjustments(row.adjustments)}` : "None" },
    { key: "statutory", header: "Statutory", render: (row) => {
      const schemes = row.preparation?.statutory_setup?.schemes || {};
      const issues = ["epf", "socso", "eis", "pcb"].filter((scheme) =>
        !schemes[scheme] || !["confirmed", "not_applicable"].includes(schemes[scheme].state)
        || (scheme === "pcb" && schemes.pcb.applicable && !row.pcb?.confirmation));
      const applicable = ["epf", "socso", "eis"].filter((scheme) => schemes[scheme]?.applicable).map((scheme) => scheme.toUpperCase());
      return <div className="text-xs"><strong>{issues.length ? `${issues.length} statutory issue${issues.length === 1 ? "" : "s"}` : `Ready${applicable.length ? ` · ${applicable.join(" / ")}` : ""}`}</strong>
        <small className="block text-text-secondary">{schemes.pcb?.applicable === false ? "PCB N/A" : row.pcb?.confirmation ? "PCB confirmed" : "PCB confirmation required"}</small>
        {row.statutory?.is_stale && <small className="block text-text-secondary">Calculation needs refresh</small>}</div>;
    } },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.needsReview ? "warning" : "success"}>{row.needsReview ? "Need Review" : "Ready"}</Badge> },
    { key: "action", header: "Action", render: (row) => <button type="button" className="font-semibold text-primary" onClick={() => setEmployeeId(row.id)}>Review</button> },
  ];
  return <div className="space-y-4">
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h3 className="text-lg font-bold">Prepare Payroll</h3>
      <p className="text-sm text-text-secondary">{rows.length} included · {rows.filter((row) => row.needsReview).length} need attention. Resolve only exceptions; clean evidence needs no manual approval.</p></div>
      {active && <button type="button" className="btn-secondary" disabled={busy} onClick={reconcile}>{busy ? "Reconciling…" : "Refresh time evidence"}</button>}</Card>
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    <Card>{!evidence && !error ? <p className="p-6 text-sm text-text-secondary">Loading monthly employee evidence…</p>
      : visible.length ? <DataTable columns={columns} rows={visible} getRowKey={(row) => row.id} density="compact" onRowClick={(row) => setEmployeeId(row.id)} />
        : <p className="p-6 text-sm text-text-secondary">No employees included in this payroll revision.</p>}</Card>
    {selected && !reviewHours && !pcbDraft && !adjustment && <Modal title={selected.name} description={`${month} · Monthly Payroll review. Permanent compensation changes belong in Employees.`}
      size="xl" onClose={() => setEmployeeId("")} footer={<button className="btn-secondary" type="button" onClick={() => setEmployeeId("")}>Close</button>}>
      <div className="space-y-5 text-sm">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <span>{month}-01 – {periodEnd(month)}</span><Badge tone={selected.needsReview ? "warning" : "success"}>{selected.result.status}</Badge>
        </div>
        <dl className="grid grid-cols-3 gap-3 rounded-xl bg-surface-muted p-4">
          {[["Gross Earnings", selected.result.gross], ["Total Deductions", selected.result.deductions], ["Net Pay", selected.result.net]].map(([label, value]) =>
            <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{value == null ? "Pending" : money(value)}</dd></div>)}
        </dl>
        <section className="border-b border-border pb-4"><div className="flex items-center justify-between gap-3"><h4 className="text-lg font-bold">Earnings</h4>
          {active && <button className="font-semibold text-primary" type="button" disabled={busy} onClick={() => setAdjustment({ requestId: crypto.randomUUID(), componentId: "", amount: "", reason: "" })}>Add Adjustment</button>}</div>
          <p className="mt-1 text-xs text-text-secondary">{selected.pay ? `${human(selected.pay.pay_basis)} · Pay effective ${selected.pay.effective_from}` : "Complete Employee pay setup"}</p>
          <div className="mt-2 divide-y divide-border">{(selected.calculation?.lines || []).filter((line) => line.kind === "earning").map(financialLine)}
            {!selected.calculation?.lines?.some((line) => line.kind === "earning") && <p className="py-2 text-text-secondary">Calculate Payroll to see earning lines.</p>}
          </div>
        </section>
        <div className="flex justify-between border-t border-border pt-3 font-bold"><span>Gross Earnings</span><span className="tabular-nums">{money(selected.result.gross)}</span></div>
        {selected.calculation?.lines?.some(line => line.kind === "reimbursement") && <section><h4 className="font-semibold">Business Reimbursements</h4><p className="text-xs text-text-secondary">Outside Gross Earnings; added to employee payment.</p><div className="divide-y divide-border">{selected.calculation.lines.filter(line => line.kind === "reimbursement").map(financialLine)}</div></section>}
        {selected.adjustments.some(item => !selected.calculation?.lines?.some(line => line.source?.run_adjustment_id === item.id)) && <section><h4 className="font-semibold">Awaiting Calculation</h4>{selected.adjustments.filter(item => !selected.calculation?.lines?.some(line => line.source?.run_adjustment_id === item.id)).map(item => <div key={item.id} className="flex justify-between py-2"><span>{item.component_name}<small className="block text-text-secondary">Saved adjustment · {item.reason}</small></span>{adjustmentActions(item)}</div>)}</section>}
        {selected.timeRelevant && <section className="border-t border-border pt-4"><div className="flex items-center justify-between"><h4 className="font-bold">Time & Attendance</h4><button type="button" className="font-semibold text-primary" onClick={()=>setReviewHours(true)}>Review Hours</button></div><p className="mt-1 text-text-secondary">{selected.time.length} recorded days · {selected.time.filter(item=>item.status === 'review_required').length} exceptions. Review Hours compares roster, clock evidence and approved payable time.</p></section>}
        <section className="border-t border-border pt-4"><div className="flex justify-between gap-3"><h4 className="text-base font-bold">Employee Deductions</h4>{active && selected.pcb?.applicable && <button className="font-semibold text-primary" type="button"
          onClick={() => setPcbDraft({ requestId: crypto.randomUUID(), employeeId: selected.id, amount: selected.pcb?.confirmation?.amount == null ? "" : String(selected.pcb.confirmation.amount), sourceReference: "", note: "", reason: "" })}>{selected.pcb.confirmation ? "Correct PCB" : "Confirm PCB"}</button>}</div>
          <div className="mt-2 divide-y divide-border">{["epf", "socso", "eis", "pcb"].map((scheme) => {
            const line = selected.statutory?.lines?.find((item) => item.scheme === scheme);
            const setup = selected.preparation?.statutory_setup?.schemes?.[scheme];
            const notApplicable = setup?.applicable === false;
            return <div key={scheme} className="flex items-center justify-between gap-4 py-2"><span><strong>{scheme === "pcb" ? "PCB / MTD" : scheme.toUpperCase()}</strong>
              <small className="block text-text-secondary">{notApplicable ? "Not Applicable" : scheme === "pcb" ? selected.pcb?.confirmation ? "Confirmed" : "Confirmation required"
                : setup ? statutorySchemeLabel(scheme, setup) : "Period setup required"}</small></span>
              <strong className="tabular-nums">{notApplicable ? "N/A" : selected.result.statutoryCurrent && line?.employee_amount != null ? money(line.employee_amount) : "Pending review"}</strong></div>;
          })}</div>
          <h5 className="mt-4 text-xs font-semibold text-text-secondary">Other Deductions</h5><div className="mt-2 divide-y divide-border">{(selected.calculation?.lines || []).filter(line => line.kind === "deduction").map(financialLine)}</div>
          <div className="flex justify-between border-t border-border pt-3 font-bold"><span>Total Deductions</span><span className="tabular-nums">{money(selected.result.deductions)}</span></div>
        </section>
        <section className="rounded-xl bg-primary/5 p-4"><h4 className="text-lg font-bold">Net Pay</h4><div className="mt-2 divide-y divide-border">
          <div className="flex justify-between py-2"><span>Gross Earnings</span><strong className="tabular-nums">{money(selected.result.gross)}</strong></div>
          <div className="flex justify-between py-2"><span>− Total Deductions</span><strong className="tabular-nums">{money(selected.result.deductions)}</strong></div>
          {Number(selected.calculation?.reimbursements) > 0 && <div className="flex justify-between py-2"><span>+ Reimbursements · outside gross</span><span className="tabular-nums">{selected.result.earningsCurrent ? money(selected.calculation.reimbursements) : "Pending review"}</span></div>}
          <div className="flex justify-between py-3 text-xl font-bold"><span>= Net Pay</span><span className="tabular-nums">{selected.result.net == null ? "Pending review" : money(selected.result.net)}</span></div>
        </div></section>
        <section className="border-t border-border pt-4 text-text-secondary"><h4 className="font-semibold">Employer Contributions</h4><div className="mt-2 divide-y divide-border">
          {["epf", "socso", "eis"].map((scheme) => { const line = selected.statutory?.lines?.find((item) => item.scheme === scheme);
            return <div key={scheme} className="flex justify-between gap-3 py-2"><span>{scheme.toUpperCase()}</span><strong className="tabular-nums">
              {selected.preparation?.statutory_setup?.schemes?.[scheme]?.applicable === false ? "N/A" : selected.result.statutoryCurrent ? money(line?.employer_amount) : "Pending review"}</strong></div>;
          })}
          {selected.result.statutoryCurrent && selected.statutory?.lines?.some((line) => Number(line.remittance_rounding) > 0) &&
            <div className="flex justify-between py-2"><span>Employer-funded remittance rounding</span><strong className="tabular-nums">{money(selected.statutory.lines.reduce((sum, line) => sum + Number(line.remittance_rounding || 0), 0))}</strong></div>}
          <div className="flex justify-between py-2 font-semibold"><span>Total Employer Contributions</span><span className="tabular-nums">{selected.result.statutoryCurrent ? money(selected.statutory.employer_statutory_cost) : "Pending review"}</span></div>
          <div className="flex justify-between py-2 font-semibold"><span>Total Employer Cost</span><span className="tabular-nums">{selected.result.statutoryCurrent ? money(selected.statutory.total_employer_cost) : "Pending review"}</span></div>
        </div><p className="text-xs text-text-secondary">Employer contributions do not reduce employee Net Pay.</p></section>
        {[...new Set([...(selected.projection?.issues || []), ...(selected.statutory?.issues || [])])].length > 0 &&
          <ul className="list-disc pl-5 text-amber-800">{[...new Set([...(selected.projection?.issues || []), ...(selected.statutory?.issues || [])])].map((issue) =>
            <li key={issue}>{payrollIssueLabel(issue)}</li>)}</ul>}
        {(selected.calculation?.is_stale || selected.statutory?.is_stale) && <p role="status" className="text-amber-800">Inputs changed. Refresh this employee's calculation before reviewing amounts.</p>}
        {active && <button className="btn-secondary" type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError(""); try { await payrollService.recalculateEmployee(run.id, selected.id); await refresh(); }
          catch (cause) { setError(cause.message); } finally { setBusy(false); }
        }}>{busy ? "Updating payroll…" : "Refresh Employee Calculation"}</button>}
        {error && <p role="alert" className="text-rose-700">{error}</p>}
      </div></Modal>}
    {selected && reviewHours && <PayrollPayableTimeReview employee={selected} month={month} canManage={active} onClose={()=>setReviewHours(false)} onDecisionSaved={timeDecisionSaved} />}
    {pcbDraft && <Modal title="Confirm PCB / MTD" description="The confirmed amount is statutory evidence for this employee and period." onClose={() => !busy && setPcbDraft(null)}
      footer={<><button className="btn-secondary" type="button" onClick={() => setPcbDraft(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || pcbDraft.amount === "" || Number(pcbDraft.amount) < 0 || !pcbDraft.reason.trim()} onClick={savePcb}>Confirm PCB</button></>}>
      <div className="space-y-3"><AdminFormField label="Confirmed PCB (RM)" required><input className="control" type="number" min="0" step="0.01" value={pcbDraft.amount} onChange={(event) => setPcbDraft((old) => ({ ...old, amount: event.target.value }))} /></AdminFormField>
        <AdminFormField label="Source / reference"><input className="control" value={pcbDraft.sourceReference} onChange={(event) => setPcbDraft((old) => ({ ...old, sourceReference: event.target.value }))} /></AdminFormField>
        <AdminFormField label="Reason" required><input className="control" value={pcbDraft.reason} onChange={(event) => setPcbDraft((old) => ({ ...old, reason: event.target.value }))} /></AdminFormField></div></Modal>}
    {adjustment && selected && <Modal title={`${human(adjustment.action || "add")} Adjustment · ${selected.name}`} description="This changes this Draft Payroll Run only; permanent employee setup and previous evidence are retained." onClose={() => !busy && setAdjustment(null)}
      footer={<><button className="btn-secondary" type="button" onClick={() => setAdjustment(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || (adjustment.action !== "remove" && (!adjustment.componentId || !Number.isFinite(Number(adjustment.amount)) || Number(adjustment.amount) <= 0))} onClick={saveAdjustment}>{busy ? "Saving…" : `${human(adjustment.action || "add")} Adjustment`}</button></>}>
      <div className="space-y-3">{adjustment.action !== "remove" && <><SelectField label="Pay Component" searchable required value={adjustment.componentId} onChange={(componentId) => setAdjustment((old) => ({ ...old, componentId }))}
        options={(data.components || []).filter((item) => item.is_active).map((item) => ({ value: item.id, label: `${item.name} · ${human(item.component_type)}${payComponentIsConfigured(item) ? "" : " · Setup required"}`, disabled: !payComponentIsConfigured(item) }))} />
        <AdminFormField label="Type"><p>{adjustmentComponent ? human(adjustmentComponent.component_type) : "Select a Pay Component"}</p></AdminFormField>
        <AdminFormField label="Amount (RM)" required><input className="control" type="number" min="0.01" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment((old) => ({ ...old, amount: event.target.value }))} /></AdminFormField></>}
        {adjustment.action === "remove" && <p>Remove this adjustment from the current Draft? Its history will be retained.</p>}
        <AdminFormField label="Remark (Optional)"><input className="control" value={adjustment.reason} onChange={(event) => setAdjustment((old) => ({ ...old, reason: event.target.value }))} /></AdminFormField>{error && <p role="alert" className="text-rose-700">{error}</p>}</div></Modal>}
  </div>;
}
