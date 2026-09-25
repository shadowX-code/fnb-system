import { useCallback, useEffect, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import { payrollService } from "../../../services/payrollService.js";

// Only pay-type/basis pairs consumed by the canonical Phase 3 calculator.
const supported = [
  ["monthly_basic", "monthly", "Basic Salary", "Normal monthly salary"],
  ["regular", "hourly", "Regular Pay", "Normal hourly rate"],
  ...["overtime", "rest_day", "public_holiday", "public_holiday_ot"].flatMap((code) =>
    ["monthly", "hourly"].map((basis) => [code, basis, {
      overtime: "Overtime", rest_day: "Rest Day", public_holiday: "Public Holiday", public_holiday_ot: "Public Holiday OT",
    }[code], "Approved payable time × rule multiplier"])),
  ["unpaid_time", "monthly", "Unpaid Time", "Approved deduction for non-payable time"],
  ["non_payable", "monthly", "Non-Payable Time", "No pay"],
  ["non_payable", "hourly", "Non-Payable Time", "No pay"],
];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function PayrollPayRulesPanel({ canManage }) {
  const [rules, setRules] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRules(await payrollService.readRules()); setError(""); }
    catch (cause) { setError(cause.message || "Unable to read Pay Rules."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const rows = supported.map(([code, basis, name, explanation]) => {
    const history = [...(rules || [])].filter((item) => item.rule_code === code && item.pay_basis === basis)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return { code, basis, name, explanation, history, current: history.find((item) => item.effective_from <= today()) };
  });
  const openDraft = (row) => {
    setDraft({ ruleCode: row.code, payBasis: row.basis, effectiveFrom: today(), multiplier: row.current?.multiplier == null ? "" : String(row.current.multiplier),
      monthlyDivisorMinutes: row.current?.monthly_divisor_minutes == null ? "" : String(row.current.monthly_divisor_minutes), sourceNote: "", reason: "" });
    setError("");
  };
  const patch = (key, value) => setDraft((old) => ({ ...old, [key]: value }));
  const publish = async () => {
    setBusy(true); setError("");
    try { await payrollService.publishRule(draft); await load(); setDraft(null); }
    catch (cause) { setError(cause.message || "Unable to publish Pay Rule version."); }
    finally { setBusy(false); }
  };
  const needDivisor = draft?.payBasis === "monthly" && !["monthly_basic", "non_payable"].includes(draft?.ruleCode);
  const valid = draft && draft.effectiveFrom && draft.multiplier !== "" && Number(draft.multiplier) >= 0
    && (!needDivisor || Number(draft.monthlyDivisorMinutes) > 0) && draft.sourceNote.trim() && draft.reason.trim();
  return <div className="space-y-3">
    <div><h3 className="text-lg font-bold">Pay Calculation Rules</h3><p className="text-sm text-text-secondary">Current approved rules for supported pay types. Missing rules remain Review Required in a Run.</p></div>
    {error && !draft && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    <Card>{rules === null && !error ? <p className="p-6 text-sm text-text-secondary">Loading rules…</p> : <DataTable density="compact" rows={rows} getRowKey={(row) => `${row.code}:${row.basis}`} columns={[
      { key: "type", header: "Pay Type", render: (row) => <strong>{row.name}</strong> },
      { key: "basis", header: "Applies To", render: (row) => row.basis === "monthly" ? "Monthly" : "Hourly" },
      { key: "rule", header: "Current Rule", render: (row) => row.current ? <span>{row.explanation}<small className="block text-text-secondary">{row.current.multiplier}×{row.current.monthly_divisor_minutes ? ` · ${row.current.monthly_divisor_minutes} minute divisor` : ""}</small></span> : "—" },
      { key: "date", header: "Effective From", render: (row) => row.current?.effective_from || "—" },
      { key: "status", header: "Status", render: (row) => <Badge tone={row.current ? "success" : "warning"}>{row.current ? "Configured" : "Not configured"}</Badge> },
      { key: "action", header: "Action", render: (row) => <button className="font-semibold text-primary" type="button" onClick={() => setSelected(row)}>View</button> },
    ]} onRowClick={setSelected} />}</Card>
    {selected && <Modal title={`${selected.name} · ${selected.basis === "monthly" ? "Monthly" : "Hourly"}`} description={selected.explanation} onClose={() => setSelected(null)}
      footer={<><button className="btn-secondary" type="button" onClick={() => setSelected(null)}>Close</button>{canManage && <button className="btn-primary" type="button" onClick={() => openDraft(selected)}>Create New Version</button>}</>}>
      <div className="space-y-4 text-sm"><div className="grid gap-3 sm:grid-cols-2"><div><span className="text-text-secondary">Current rule</span><p className="font-bold">{selected.current ? `${selected.current.multiplier}×` : "Not configured"}</p></div>
        <div><span className="text-text-secondary">Effective from</span><p className="font-bold">{selected.current?.effective_from || "—"}</p></div></div>
        <div><strong>Source / evidence</strong><p className="text-text-secondary">{selected.current?.source_note || "No approved rule published."}</p></div>
        <details><summary className="cursor-pointer font-semibold">Version History ({selected.history.length})</summary><div className="mt-2 divide-y divide-border">{selected.history.map((item) => <div key={item.id} className="py-2">{item.effective_from} · {item.multiplier}× · {item.source_note}</div>)}</div></details>
        <details><summary className="cursor-pointer font-semibold">Advanced / technical identity</summary><p className="mt-2 text-text-secondary">{selected.code} · {selected.basis}</p></details></div>
    </Modal>}
    {draft && <Modal title="Create Pay Rule Version" description="A new effective-dated version is added; published versions are never edited." size="lg" onClose={() => !busy && setDraft(null)}
      footer={<><button className="btn-secondary" type="button" onClick={() => setDraft(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || !valid} onClick={publish}>{busy ? "Publishing…" : "Publish Version"}</button></>}>
      <div className="grid gap-4 sm:grid-cols-2"><SelectField label="Pay Type" value={draft.ruleCode} onChange={(ruleCode) => patch("ruleCode", ruleCode)} options={supported.filter((row) => row[1] === draft.payBasis).map(([value, , name]) => ({ value, label: name }))} />
        <SelectField label="Pay Basis" value={draft.payBasis} onChange={(payBasis) => setDraft((old) => ({ ...old, payBasis, ruleCode: supported.find((row) => row[0] === old.ruleCode && row[1] === payBasis)?.[0] || (payBasis === "monthly" ? "monthly_basic" : "regular") }))}
          options={[{ value: "monthly", label: "Monthly" }, { value: "hourly", label: "Hourly" }]} />
        <AdminFormField label="Multiplier" required><input className="control" type="number" min="0" max="10" step="0.0001" value={draft.multiplier} onChange={(event) => patch("multiplier", event.target.value)} /></AdminFormField>
        <DatePickerField label="Effective From" required value={draft.effectiveFrom} onChange={(value) => patch("effectiveFrom", value)} />
        {needDivisor && <AdminFormField label="Approved monthly divisor (minutes)" required><input className="control" type="number" min="1" step="1" value={draft.monthlyDivisorMinutes} onChange={(event) => patch("monthlyDivisorMinutes", event.target.value)} /></AdminFormField>}
        <AdminFormField label="Source / policy reference" required><input className="control" value={draft.sourceNote} onChange={(event) => patch("sourceNote", event.target.value)} /></AdminFormField>
        <AdminFormField label="Approval reason" required><input className="control" value={draft.reason} onChange={(event) => patch("reason", event.target.value)} /></AdminFormField>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </Modal>}
  </div>;
}
