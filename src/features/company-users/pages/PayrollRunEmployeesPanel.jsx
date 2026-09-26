import { useCallback, useEffect, useMemo, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import PayrollPayableTimeReview from "./PayrollPayableTimeReview.jsx";
import { statutorySchemeLabel } from "./PayrollStatutorySetup.jsx";
import { payrollEmployeeResult, payrollIssueLabel } from "./payrollRunPresentation.js";

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
      setPcbDraft(null);
      await payrollService.recalculateEmployee(run.id, pcbDraft.employeeId);
      await refresh(); }
    catch (cause) { await refresh(); setError(cause.message || "Unable to confirm PCB / MTD."); }
    finally { setBusy(false); }
  };
  const saveAdjustment = async () => {
    setBusy(true); setError("");
    try { if (adjustment.adjustmentId) await payrollService.reverseRunComponent({ ...adjustment, reason: adjustment.reason.trim() });
      else await payrollService.addRunComponent({ ...adjustment, runId: run.id, employeeId: selected.id, reason: adjustment.reason.trim() });
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
    <div className="admin-segmented-control" aria-label="Employee review filter">{[["all", "All"], ["review", "Need Review"], ["ready", "Ready"]].map(([value, text]) =>
      <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{text}</button>)}</div>
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    <Card>{!evidence && !error ? <p className="p-6 text-sm text-text-secondary">Loading monthly employee evidence…</p>
      : visible.length ? <DataTable columns={columns} rows={visible} getRowKey={(row) => row.id} density="compact" onRowClick={(row) => setEmployeeId(row.id)} />
        : <p className="p-6 text-sm text-text-secondary">No employees in this filter.</p>}</Card>
    {selected && !reviewHours && !pcbDraft && !adjustment && <Modal title={selected.name} description={`${month} · Monthly Payroll review. Permanent compensation changes belong in Employees.`}
      size="xl" onClose={() => setEmployeeId("")} footer={<button className="btn-secondary" type="button" onClick={() => setEmployeeId("")}>Close</button>}>
      <div className="space-y-5 text-sm">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <span>{month}-01 – {periodEnd(month)}</span><Badge tone={selected.needsReview ? "warning" : "success"}>{selected.result.status}</Badge>
        </div>
        <dl className="grid grid-cols-3 gap-3 border-b border-border pb-4">
          {[["Gross Earnings", selected.result.gross], ["Total Deductions", selected.result.deductions], ["Net Pay", selected.result.net]].map(([label, value]) =>
            <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{value == null ? "Pending" : money(value)}</dd></div>)}
        </dl>
        <section><div className="flex items-center justify-between gap-3"><h4 className="font-bold">Earnings</h4>
          {selected.timeRelevant && <button type="button" className="font-semibold text-primary" onClick={()=>setReviewHours(true)}>Review Hours</button>}</div>
          <p className="mt-1 text-xs text-text-secondary">{selected.pay ? `${human(selected.pay.pay_basis)} · Pay effective ${selected.pay.effective_from}` : "Complete Employee pay setup"}</p>
          <div className="mt-2 divide-y divide-border">{(selected.calculation?.lines || []).filter((line) => line.kind === "earning").map((line, index) =>
            <div key={`${line.code}-${index}`} className="flex justify-between gap-3 py-2"><span>{line.label}
              <small className="block text-text-secondary">{line.minutes != null ? `${hours(line.minutes)} · ${line.multiplier}×` : line.source?.effective_from ? `Effective ${line.source.effective_from}` : "Approved period evidence"}</small></span>
              <strong className="shrink-0 tabular-nums">{selected.result.earningsCurrent ? money(line.amount) : "Pending review"}</strong></div>)}
            {!selected.calculation?.lines?.some((line) => line.kind === "earning") && <p className="py-2 text-text-secondary">Calculate Payroll to see earning lines.</p>}
          </div>
        </section>
        <section><div className="flex justify-between gap-3"><h4 className="font-bold">This Period Adjustments</h4>{active && <button className="font-semibold text-primary" type="button" disabled={busy}
          onClick={() => setAdjustment({ requestId: crypto.randomUUID(), type: "earning", componentId: "", amount: "", reason: "" })}>Add Adjustment</button>}</div>
          <div className="mt-2 divide-y divide-border">{selected.adjustments.length ? selected.adjustments.map((item) =>
            <div key={item.id} className="flex justify-between gap-3 py-2"><span><strong>{item.component_name}</strong><small className="block text-text-secondary">{human(item.component_type)} · {item.reason} · Saved</small></span>
              <span className="flex items-center gap-3"><strong className="tabular-nums">{signedMoney(Number(item.amount) * (item.component_type === "deduction" ? -1 : 1))}</strong>
              {active && <button type="button" className="font-semibold text-primary" disabled={busy} onClick={() => setAdjustment({ requestId: crypto.randomUUID(), adjustmentId: item.id, reason: "" })}>Reverse</button>}</span></div>)
              : <p className="py-2 text-text-secondary">No one-off adjustments for this period.</p>}</div>
          <p className="mt-1 text-xs text-text-secondary">Saved adjustments are included in the calculated earnings or deductions below, not added twice.</p>
        </section>
        {selected.timeRelevant && <section><h4 className="font-bold">Time & Attendance</h4><p className="mt-1 text-text-secondary">{selected.time.length} recorded days · {selected.time.filter(item=>item.status === 'review_required').length} exceptions. Review Hours compares roster, clock evidence and approved payable time.</p></section>}
        <section><div className="flex justify-between gap-3"><h4 className="font-bold">Statutory Deductions</h4>{active && selected.pcb?.applicable && <button className="font-semibold text-primary" type="button"
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
        </section>
        <section><h4 className="font-bold">Employer Contributions</h4><div className="mt-2 divide-y divide-border">
          {["epf", "socso", "eis"].map((scheme) => { const line = selected.statutory?.lines?.find((item) => item.scheme === scheme);
            return <div key={scheme} className="flex justify-between gap-3 py-2"><span>{scheme.toUpperCase()}</span><strong className="tabular-nums">
              {selected.preparation?.statutory_setup?.schemes?.[scheme]?.applicable === false ? "N/A" : selected.result.statutoryCurrent ? money(line?.employer_amount) : "Pending review"}</strong></div>;
          })}
          {selected.result.statutoryCurrent && selected.statutory?.lines?.some((line) => Number(line.remittance_rounding) > 0) &&
            <div className="flex justify-between py-2"><span>Employer-funded remittance rounding</span><strong className="tabular-nums">{money(selected.statutory.lines.reduce((sum, line) => sum + Number(line.remittance_rounding || 0), 0))}</strong></div>}
          <div className="flex justify-between py-2 font-semibold"><span>Total Employer Cost</span><span className="tabular-nums">{selected.result.statutoryCurrent ? money(selected.statutory.total_employer_cost) : "Pending review"}</span></div>
        </div><p className="text-xs text-text-secondary">Employer contributions do not reduce employee Net Pay.</p></section>
        <section className="border-t border-border pt-3"><h4 className="font-bold">Net Pay</h4><div className="mt-2 divide-y divide-border">
          <div className="flex justify-between py-2"><span>Gross Earnings</span><strong className="tabular-nums">{money(selected.result.gross)}</strong></div>
          {(selected.calculation?.lines || []).filter((line) => line.kind === "deduction").map((line, index) =>
            <div key={`${line.code}-${index}`} className="flex justify-between gap-3 py-2"><span>{line.label}</span><span className="tabular-nums">{selected.result.earningsCurrent ? `−${money(line.amount)}` : "Pending review"}</span></div>)}
          <div className="flex justify-between py-2"><span>Employee statutory deductions</span><span className="tabular-nums">{selected.result.statutoryCurrent ? `−${money(selected.statutory.lines.reduce((sum, line) => sum + Number(line.employee_amount || 0), 0))}` : "Pending review"}</span></div>
          {Number(selected.calculation?.reimbursements) > 0 && <div className="flex justify-between py-2"><span>Reimbursements · outside gross</span><span className="tabular-nums">+{money(selected.calculation.reimbursements)}</span></div>}
          <div className="flex justify-between py-3 text-base font-bold"><span>Net Pay</span><span className="tabular-nums">{selected.result.net == null ? "Pending review" : money(selected.result.net)}</span></div>
        </div></section>
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
    {adjustment && selected && <Modal title={`${adjustment.adjustmentId ? "Reverse" : "Add"} Adjustment · ${selected.name}`} description="This changes this Payroll Run only; permanent employee setup is unchanged." onClose={() => !busy && setAdjustment(null)}
      footer={<><button className="btn-secondary" type="button" onClick={() => setAdjustment(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || (!adjustment.adjustmentId && (!adjustment.componentId || !Number.isFinite(Number(adjustment.amount)) || Number(adjustment.amount) <= 0)) || !adjustment.reason.trim()} onClick={saveAdjustment}>{busy ? "Saving…" : adjustment.adjustmentId ? "Reverse Adjustment" : "Add Adjustment"}</button></>}>
      <div className="space-y-3">{!adjustment.adjustmentId && <><SelectField label="Type" required value={adjustment.type} onChange={(type) => setAdjustment((old) => ({ ...old, type, componentId: "" }))} options={[{ value: "earning", label: "Earning" }, { value: "deduction", label: "Deduction" }]} />
        <SelectField label="Component" searchable required value={adjustment.componentId} onChange={(componentId) => setAdjustment((old) => ({ ...old, componentId }))}
        options={(data.components || []).filter((item) => item.is_active && (adjustment.type === "deduction" ? item.component_type === "deduction" : ["earning", "allowance", "reimbursement"].includes(item.component_type))).map((item) => ({ value: item.id, label: `${item.name} · ${human(item.component_type)}` }))} />
        <AdminFormField label="Amount (RM)" required><input className="control" type="number" min="0.01" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment((old) => ({ ...old, amount: event.target.value }))} /></AdminFormField></>}
        <AdminFormField label="Reason" required><input className="control" value={adjustment.reason} onChange={(event) => setAdjustment((old) => ({ ...old, reason: event.target.value }))} /></AdminFormField>{error && <p role="alert" className="text-rose-700">{error}</p>}</div></Modal>}
  </div>;
}
