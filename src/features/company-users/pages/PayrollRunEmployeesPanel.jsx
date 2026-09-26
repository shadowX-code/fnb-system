import { useCallback, useEffect, useMemo, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import { DecisionModal } from "./PayrollTimeExceptionsTab.jsx";
import { statutorySchemeLabel } from "./PayrollStatutorySetup.jsx";
import { payrollIssueLabel } from "./payrollRunPresentation.js";

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
  const [filter, setFilter] = useState("review");
  const [employeeId, setEmployeeId] = useState("");
  const [decision, setDecision] = useState(null);
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
      || calculation?.status === "review_required" || calculation?.is_stale
      || statutory?.status === "review_required" || statutory?.is_stale
      || (pcb?.applicable === true && !pcb?.confirmation);
    return { ...employee, profile, time, calculation, statutory, pcb, adjustments, pay, preparation, projection, timeRelevant, timeNeedsReview, needsReview };
  }), [data, entityId, evidence, month]);
  const visible = rows.filter((row) => filter === "all" || (filter === "review" ? row.needsReview : !row.needsReview))
    .sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || a.name.localeCompare(b.name));
  const selected = rows.find((row) => row.id === employeeId);
  const active = canManage && ["draft", "review_required"].includes(run.status);
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
      setPcbDraft(null); await refresh(); }
    catch (cause) { setError(cause.message || "Unable to confirm PCB / MTD."); }
    finally { setBusy(false); }
  };
  const saveAdjustment = async () => {
    setBusy(true); setError("");
    try { if (adjustment.adjustmentId) await payrollService.reverseRunComponent({ ...adjustment, reason: adjustment.reason.trim() });
      else await payrollService.addRunComponent({ ...adjustment, runId: run.id, employeeId: selected.id, reason: adjustment.reason.trim() });
      setAdjustment(null); await refresh(); }
    catch (cause) { setError(cause.message || "Unable to save monthly adjustment."); }
    finally { setBusy(false); }
  };
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <div><strong>{row.name}</strong><small className="block text-text-secondary">{row.employee_code || "—"}</small></div> },
    { key: "pay", header: "Pay", render: (row) => row.pay ? <span>{human(row.pay.pay_basis)}<small className="block text-text-secondary">{money(row.pay.basic_salary || row.pay.hourly_rate)}{row.pay.pay_basis === "hourly" ? " / hour" : ""}</small></span> : <Badge tone="warning">Setup required</Badge> },
    { key: "time", header: "Time & Attendance", render: (row) => !row.timeRelevant ? "Not required" : <Badge tone={row.timeNeedsReview ? "warning" : "neutral"}>{row.timeNeedsReview ? `${row.time.filter((item) => item.status === "review_required").length} exceptions` : row.time.length ? "Reviewed" : "Time evidence required"}</Badge> },
    { key: "adjustments", header: "Adjustments", render: (row) => row.adjustments.length ? `${row.adjustments.length} adjustment${row.adjustments.length === 1 ? "" : "s"} · ${signedAdjustments(row.adjustments)}` : "None" },
    { key: "statutory", header: "Statutory", render: (row) => <div className="text-xs">{["epf", "socso", "eis", "pcb"].map((scheme) => { const setup = row.preparation?.statutory_setup?.schemes?.[scheme]; return <div key={scheme}>{scheme.toUpperCase()} · {setup?.applicable === false ? "N/A" : scheme === "pcb" && row.pcb?.applicable === true ? row.pcb.confirmation ? "Confirmed" : "Confirmation required" : setup ? statutorySchemeLabel(setup) : "Period setup required"}</div>; })}</div> },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.needsReview ? "warning" : "success"}>{row.needsReview ? "Need Review" : "Ready"}</Badge> },
    { key: "action", header: "Action", render: (row) => <button type="button" className="font-semibold text-primary" onClick={() => setEmployeeId(row.id)}>Review</button> },
  ];
  return <div className="space-y-4">
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h3 className="text-lg font-bold">Prepare Payroll</h3>
      <p className="text-sm text-text-secondary">{rows.length} included · {rows.filter((row) => row.needsReview).length} need attention. Resolve only exceptions; clean evidence needs no manual approval.</p></div>
      {active && <button type="button" className="btn-secondary" disabled={busy} onClick={reconcile}>{busy ? "Reconciling…" : "Refresh time evidence"}</button>}</Card>
    <div className="admin-segmented-control" aria-label="Employee review filter">{[["all", "All"], ["review", "Need Review"], ["ready", "Ready"]].map(([value, text]) =>
      <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{text}</button>)}</div>
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    <Card>{!evidence && !error ? <p className="p-6 text-sm text-text-secondary">Loading monthly employee evidence…</p>
      : visible.length ? <DataTable columns={columns} rows={visible} getRowKey={(row) => row.id} density="compact" onRowClick={(row) => setEmployeeId(row.id)} />
        : <p className="p-6 text-sm text-text-secondary">No employees in this filter.</p>}</Card>
    {selected && !decision && !pcbDraft && !adjustment && <Modal title={selected.name} description={`${month} · Monthly Payroll review. Permanent compensation changes belong in Employees.`}
      size="xl" onClose={() => setEmployeeId("")} footer={<button className="btn-secondary" type="button" onClick={() => setEmployeeId("")}>Close</button>}>
      <div className="space-y-5 text-sm">
        <section><h4 className="font-bold">Pay</h4><p className="mt-2 font-semibold">{selected.pay ? `${human(selected.pay.pay_basis)} · ${money(selected.pay.basic_salary || selected.pay.hourly_rate)}${selected.pay.pay_basis === "hourly" ? " / hour" : ""}` : "Setup required in Employees"}</p><p className="text-text-secondary">{month}-01 – {periodEnd(month)}{selected.pay?.effective_from ? ` · Pay effective ${selected.pay.effective_from}` : ""}</p></section>
        {selected.timeRelevant && <section><h4 className="font-bold">Time & Attendance</h4><div className="mt-2 divide-y divide-border">{selected.time.length ? selected.time.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><strong>{item.work_date}</strong> · {human(item.classification)}<small className="block text-text-secondary">{item.issue_codes?.map(human).join(" · ") || "No exception"} · proposed {hours(item.proposed_minutes)} · approved {hours(item.approved_minutes)}</small></span>
            {item.status === "review_required" && active && <button className="btn-secondary" type="button" onClick={() => setDecision(item)}>Resolve</button>}</div>) : <p className="py-2 text-text-secondary">Refresh time evidence to prepare this employee's payable time.</p>}</div></section>}
        <section><div className="flex justify-between gap-3"><h4 className="font-bold">This-period allowances, deductions & OT</h4>{active && <button className="font-semibold text-primary" type="button" onClick={() => setAdjustment({ requestId: crypto.randomUUID(), componentId: "", amount: "", reason: "" })}>Add monthly line</button>}</div>
          <div className="mt-2 divide-y divide-border">{selected.adjustments.length ? selected.adjustments.map((item) => <div key={item.id} className="flex justify-between gap-3 py-2"><span><strong>{item.component_name}</strong><small className="block text-text-secondary">{item.reason} · Saved</small></span><span className="flex items-center gap-3"><strong className="tabular-nums">{signedMoney(Number(item.amount) * (item.component_type === "deduction" ? -1 : 1))}</strong>{active && <button type="button" className="text-primary font-semibold" onClick={() => setAdjustment({ requestId: crypto.randomUUID(), adjustmentId: item.id, reason: "" })}>Reverse</button>}</span></div>) : <p className="py-2 text-text-secondary">No one-off adjustments for this period.</p>}</div></section>
        <section><h4 className="font-bold">Recurring Components</h4><div className="mt-2 divide-y divide-border">{(selected.projection?.lines || []).filter((line) => line.source?.component_version_id).map((line, index) => <div key={`${line.code}-${index}`} className="flex justify-between py-2"><span>{line.label}</span><strong>{signedMoney(Number(line.amount) * (line.kind === "deduction" ? -1 : 1))}</strong></div>)}
          {!(selected.projection?.lines || []).some((line) => line.source?.component_version_id) && <p className="py-2 text-text-secondary">No recurring components effective for this period.</p>}</div></section>
        <section><div className="flex justify-between gap-3"><h4 className="font-bold">Statutory & PCB / MTD</h4>{active && selected.pcb?.applicable && <button className="font-semibold text-primary" type="button" onClick={() => setPcbDraft({ requestId: crypto.randomUUID(), employeeId: selected.id, amount: selected.pcb?.confirmation?.amount == null ? "" : String(selected.pcb.confirmation.amount), sourceReference: "", note: "", reason: "" })}>{selected.pcb.confirmation ? "Correct PCB" : "Confirm PCB"}</button>}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">{["epf", "socso", "eis", "pcb"].map((scheme) => { const line = selected.statutory?.lines?.find((item) => item.scheme === scheme); const setup = selected.preparation?.statutory_setup?.schemes?.[scheme]; return <div key={scheme}><small className="text-text-secondary">{scheme.toUpperCase()}</small><p className="font-semibold">{setup?.applicable === false || line?.applicable === false ? "N/A" : setup ? statutorySchemeLabel(setup) : "Period setup required"}</p>{line?.applicable && line.employee_amount != null && <p className="tabular-nums">{money(line.employee_amount)}</p>}</div>; })}</div>
          {selected.pcb?.applicable == null && <p className="mt-2 text-amber-800">Statutory applicability is missing for the start of this payroll period. Later setup cannot establish earlier entitlement.</p>}
          {selected.statutory?.issues?.length > 0 && <p className="mt-2 text-amber-800">{selected.statutory.issues.map(payrollIssueLabel).join(" · ")}</p>}</section>
        <section><h4 className="font-bold">Estimated Pay</h4><div className="mt-2 grid gap-3 sm:grid-cols-3">{[["Gross",selected.calculation?.gross_earnings],["Deductions",selected.calculation?.non_statutory_deductions],["Net",selected.statutory?.net_pay]].map(([label,value]) => <div key={label}><small className="text-text-secondary">{label}</small><p className="font-semibold tabular-nums">{value == null || selected.calculation?.status !== "ready" || selected.calculation?.is_stale || selected.statutory?.is_stale ? "Pending review" : money(value)}</p></div>)}</div>{selected.projection?.issues?.length > 0 ? <ul className="mt-2 list-disc pl-5 text-amber-800">{selected.projection.issues.map((issue) => <li key={issue}>{payrollIssueLabel(issue)}</li>)}</ul> : <p className="mt-2 text-text-secondary">{!selected.calculation ? "Calculate Payroll after preparing inputs to see Gross, deductions and Net Pay." : selected.calculation.is_stale ? "Inputs changed. Refresh the payroll calculation to update estimated pay." : !selected.statutory ? "Calculate statutory contributions to complete Net Pay." : "Calculated from this period's approved evidence."}</p>}</section>
      </div></Modal>}
    {decision && <DecisionModal row={decision} onClose={() => setDecision(null)} onSaved={refresh} />}
    {pcbDraft && <Modal title="Confirm PCB / MTD" description="The confirmed amount is statutory evidence for this employee and period." onClose={() => !busy && setPcbDraft(null)}
      footer={<><button className="btn-secondary" type="button" onClick={() => setPcbDraft(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || pcbDraft.amount === "" || Number(pcbDraft.amount) < 0 || !pcbDraft.reason.trim()} onClick={savePcb}>Confirm PCB</button></>}>
      <div className="space-y-3"><AdminFormField label="Confirmed PCB (RM)" required><input className="control" type="number" min="0" step="0.01" value={pcbDraft.amount} onChange={(event) => setPcbDraft((old) => ({ ...old, amount: event.target.value }))} /></AdminFormField>
        <AdminFormField label="Source / reference"><input className="control" value={pcbDraft.sourceReference} onChange={(event) => setPcbDraft((old) => ({ ...old, sourceReference: event.target.value }))} /></AdminFormField>
        <AdminFormField label="Reason" required><input className="control" value={pcbDraft.reason} onChange={(event) => setPcbDraft((old) => ({ ...old, reason: event.target.value }))} /></AdminFormField></div></Modal>}
    {adjustment && selected && <Modal title={`${adjustment.adjustmentId ? "Reverse" : "Add"} monthly line · ${selected.name}`} description="This changes this Payroll Run only; permanent employee setup is unchanged." onClose={() => !busy && setAdjustment(null)}
      footer={<><button className="btn-secondary" type="button" onClick={() => setAdjustment(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || (!adjustment.adjustmentId && (!adjustment.componentId || !Number.isFinite(Number(adjustment.amount)) || Number(adjustment.amount) <= 0)) || !adjustment.reason.trim()} onClick={saveAdjustment}>{adjustment.adjustmentId ? "Reverse Line" : "Add Line"}</button></>}>
      <div className="space-y-3">{!adjustment.adjustmentId && <><SelectField label="Pay Component" searchable required value={adjustment.componentId} onChange={(componentId) => setAdjustment((old) => ({ ...old, componentId }))}
        options={(data.components || []).filter((item) => item.is_active).map((item) => ({ value: item.id, label: `${item.name} · ${human(item.component_type)}` }))} />
        <AdminFormField label="Amount (RM)" required><input className="control" type="number" min="0.01" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment((old) => ({ ...old, amount: event.target.value }))} /></AdminFormField></>}
        <AdminFormField label="Reason" required><input className="control" value={adjustment.reason} onChange={(event) => setAdjustment((old) => ({ ...old, reason: event.target.value }))} /></AdminFormField>{error && <p role="alert" className="text-rose-700">{error}</p>}</div></Modal>}
  </div>;
}
