import { useCallback, useEffect, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";

const rm = (value) => new Intl.NumberFormat("en-MY", {
  style: "currency", currency: "MYR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value || 0));
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const issueLabel = (value) => title(String(value).replace(/:\d{4}-\d{2}-\d{2}$/, ""));

function ResultDetail({ result, onClose }) {
  const compensation = result.inputs?.compensation_start;
  const time = result.inputs?.time || [];
  const earnings = result.lines.filter((line) => line.kind === "earning");
  const deductions = result.lines.filter((line) => line.kind === "deduction");
  const reimbursements = result.lines.filter((line) => line.kind === "reimbursement");
  const section = (heading, lines) => <section>
    <h4 className="mb-2 text-sm font-bold text-text-primary">{heading}</h4>
    {lines.length ? <div className="divide-y divide-border rounded-xl border border-border">
      {lines.map((line, index) => <div key={`${line.code}-${index}`} className="flex justify-between gap-4 px-3 py-2 text-sm">
        <div><strong>{line.label}</strong>
          <div className="text-xs text-text-secondary">
            {line.minutes != null ? `${(line.minutes / 60).toFixed(2)} h · ${line.multiplier}× · ${line.source?.work_date}` :
              line.source?.effective_from ? `Effective ${line.source.effective_from}` : "Approved run component"}
            {line.source?.rule_source ? ` · ${line.source.rule_source}` : ""}
          </div>
        </div><strong className="shrink-0 tabular-nums">{rm(line.amount)}</strong>
      </div>)}
    </div> : <p className="text-sm text-text-secondary">None.</p>}
  </section>;
  return <Modal title={`${result.employee_name} · Calculation`} description="Pre-statutory Payroll result. No contribution, net-pay or payment amount is included."
    onClose={onClose} size="xl" footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><span className="text-xs text-text-secondary">Compensation used</span><p className="font-bold">{compensation ?
          `${title(compensation.pay_basis)} · ${rm(compensation.basic_salary || compensation.hourly_rate)}${compensation.pay_basis === "hourly" ? " / hour" : ""}` : "Missing"}</p>
          <p className="text-xs text-text-secondary">{compensation?.effective_from ? `Effective ${compensation.effective_from}` : "No effective version"}</p></div>
        <div><span className="text-xs text-text-secondary">Payable time evidence</span><p className="font-bold">{time.length} day{time.length === 1 ? "" : "s"}</p>
          <p className="text-xs text-text-secondary">Approved decisions only are priced.</p></div>
        <div><span className="text-xs text-text-secondary">Status</span><p><Badge tone={result.status === "ready" ? "success" : "warning"}>{result.is_stale ? "Stale · recalculate" : title(result.status)}</Badge></p></div>
      </div>
      {result.issues?.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Review required</strong><ul className="mt-1 list-disc pl-5">{result.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issueLabel(issue)}</li>)}</ul>
      </section>}
      {section("Earnings", earnings)}
      {section("Deductions", deductions)}
      {section("Reimbursements · outside gross wages", reimbursements)}
      <dl className="grid grid-cols-2 gap-2 rounded-xl bg-surface-muted p-3 text-sm sm:grid-cols-4">
        <div><dt className="text-text-secondary">Gross Earnings</dt><dd className="font-bold tabular-nums">{rm(result.gross_earnings)}</dd></div>
        <div><dt className="text-text-secondary">Non-statutory Deductions</dt><dd className="font-bold tabular-nums">{rm(result.non_statutory_deductions)}</dd></div>
        <div><dt className="text-text-secondary">Reimbursements</dt><dd className="font-bold tabular-nums">{rm(result.reimbursements)}</dd></div>
        <div><dt className="text-text-secondary">Pre-statutory Pay</dt><dd className="font-bold tabular-nums">{rm(result.pre_statutory_pay)}</dd></div>
      </dl>
    </div>
  </Modal>;
}

export default function PayrollRunCalculationPanel({ run, components, canManage }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [draft, setDraft] = useState({ employeeId: "", componentId: "", amount: "", reason: "" });
  const openAdjustment = (mode, values = {}) => {
    setDraft({ employeeId: "", componentId: "", amount: "", reason: "", requestId: crypto.randomUUID(), ...values });
    setForm(mode);
  };
  const load = useCallback(async () => {
    try { setData(await payrollService.readCalculation(run.id)); setError(""); }
    catch (cause) { setError(cause.message || "Unable to read Payroll calculations."); }
  }, [run.id]);
  useEffect(() => { load(); }, [load]);
  const calculate = async () => {
    setBusy(true); setError("");
    try { await payrollService.calculateRun(run.id); await load(); }
    catch (cause) { setError(cause.message || "Unable to calculate Run."); }
    finally { setBusy(false); }
  };
  const saveAdjustment = async () => {
    setBusy(true); setError("");
    try {
      if (form === "reverse") await payrollService.reverseRunComponent({
        requestId: draft.requestId, adjustmentId: draft.adjustmentId, reason: draft.reason.trim(),
      });
      else await payrollService.addRunComponent({
        requestId: draft.requestId, runId: run.id, employeeId: draft.employeeId,
        componentId: draft.componentId, amount: draft.amount, reason: draft.reason.trim(),
      });
      setForm(null); setDraft({ employeeId: "", componentId: "", amount: "", reason: "" });
      await load();
    } catch (cause) { setError(cause.message || "Unable to save component."); }
    finally { setBusy(false); }
  };
  const rows = data?.results || [];
  const columns = [
    { key: "employee", header: "Employee", render: (row) => <div><strong>{row.employee_name}</strong><div className="text-xs text-text-secondary">{row.employee_code || "—"}</div></div> },
    { key: "basis", header: "Pay Basis", render: (row) => title(row.pay_basis || "Missing") },
    { key: "base", header: "Basic / Hours", render: (row) => row.basic_or_hours || "—" },
    { key: "earnings", header: "Earnings", align: "right", render: (row) => <span className="tabular-nums">{rm(row.gross_earnings)}</span> },
    { key: "deductions", header: "Deductions", align: "right", render: (row) => <span className="tabular-nums">{rm(row.non_statutory_deductions)}</span> },
    { key: "pay", header: "Pre-statutory Pay", align: "right", render: (row) => <strong className="tabular-nums">{rm(row.pre_statutory_pay)}</strong> },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "ready" && !row.is_stale ? "success" : "warning"}>{row.is_stale ? "Stale" : title(row.status)}</Badge> },
  ];
  const canEdit = canManage && ["draft", "review_required"].includes(run.status);
  const options = components.filter((item) => item.is_active && ["earning", "allowance", "deduction", "reimbursement"].includes(item.component_type));
  return <Card className="mt-3 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <div><h4 className="font-bold text-text-primary">Payroll Calculation</h4>
        <p className="text-sm text-text-secondary">{data?.readiness ?
          `${data.readiness.employees} employees · ${data.readiness.review_required} review required · ${data.readiness.uncalculated} uncalculated · ${data.readiness.stale} stale${data.readiness.period_in_progress ? " · period in progress" : ""}` : "Loading calculation evidence…"}</p></div>
      {canEdit && <div className="flex gap-2"><button className="btn-secondary" type="button" onClick={() => openAdjustment("add")}>Add variable line</button>
        <button className="btn-primary" type="button" disabled={busy} onClick={calculate}>{busy ? "Calculating…" : rows.length ? "Recalculate" : "Calculate Run"}</button></div>}
    </div>
    {error && <p role="alert" className="px-4 pt-3 text-sm font-semibold text-rose-700">{error}</p>}
    {rows.length ? <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} density="compact" onRowClick={setSelected} /> :
      <p className="p-6 text-sm text-text-secondary">No calculations yet. Calculate the open Run to identify ready results and exceptions.</p>}
    {data?.adjustments?.length > 0 && <div className="border-t border-border p-4"><h5 className="mb-2 text-sm font-bold">Approved variable lines</h5>
      <div className="divide-y divide-border">{data.adjustments.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span>{rows.find((row) => row.employee_id === item.employee_id)?.employee_name || "Employee"} · {item.component_name}
          <small className="block text-text-secondary">{item.reason}</small></span>
        <span className="flex items-center gap-2"><strong className="tabular-nums">{rm(item.amount)}</strong>
          {canEdit && <button className="btn-secondary" type="button" onClick={() => openAdjustment("reverse", { adjustmentId: item.id })}>Reverse</button>}</span>
      </div>)}</div></div>}
    {selected && <ResultDetail result={selected} onClose={() => setSelected(null)} />}
    {form && <Modal title={form === "reverse" ? "Reverse variable line" : "Add variable Payroll line"}
      description="This is audited Run evidence. Recalculate after changing variable lines."
      onClose={() => !busy && setForm(null)} footer={<><button className="btn-secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
        <button className="btn-primary" type="button" disabled={busy || !draft.reason?.trim() || (form === "add" && (!draft.employeeId || !draft.componentId || Number(draft.amount) <= 0))}
          onClick={saveAdjustment}>{busy ? "Saving…" : form === "reverse" ? "Reverse Line" : "Add Line"}</button></>}>
      <div className="space-y-3">{form === "add" && <>
        <AdminFormField label="Employee" required><select className="control" value={draft.employeeId} onChange={(event) => setDraft((value) => ({ ...value, employeeId: event.target.value }))}>
          <option value="">Select employee</option>{rows.map((row) => <option key={row.employee_id} value={row.employee_id}>{row.employee_name}</option>)}
        </select></AdminFormField>
        <AdminFormField label="Pay Component" required><select className="control" value={draft.componentId} onChange={(event) => setDraft((value) => ({ ...value, componentId: event.target.value }))}>
          <option value="">Select component</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name} · {title(item.component_type)}</option>)}
        </select></AdminFormField>
        <AdminFormField label="Amount (RM)" required><input className="control" type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => setDraft((value) => ({ ...value, amount: event.target.value }))} /></AdminFormField>
      </>}
        <AdminFormField label="Reason" required><input className="control" value={draft.reason || ""} onChange={(event) => setDraft((value) => ({ ...value, reason: event.target.value }))} /></AdminFormField>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>}
  </Card>;
}
