import { useCallback, useEffect, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";

const ruleCodes = ["monthly_basic", "regular", "overtime", "rest_day", "public_holiday", "public_holiday_ot", "unpaid_time", "non_payable"];
const title = (value) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function PayrollPayRulesPanel({ canManage }) {
  const [rules, setRules] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ ruleCode: "overtime", payBasis: "hourly", effectiveFrom: "",
    multiplier: "", monthlyDivisorMinutes: "", sourceNote: "", reason: "" });
  const load = useCallback(async () => {
    try { setRules(await payrollService.readRules()); setError(""); }
    catch (cause) { setError(cause.message || "Unable to read Pay Rules."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const patch = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const publish = async () => {
    setBusy(true); setError("");
    try {
      await payrollService.publishRule(draft);
      await load();
      setDraft((previous) => ({ ...previous, effectiveFrom: "", multiplier: "", monthlyDivisorMinutes: "", sourceNote: "", reason: "" }));
    } catch (cause) { setError(cause.message || "Unable to publish Pay Rule."); }
    finally { setBusy(false); }
  };
  return <Card className="space-y-4 p-4">
    <div><h3 className="font-bold">Versioned Pay Rules</h3>
      <p className="text-sm text-text-secondary">Only identity arithmetic is seeded. Premium, unpaid-time and monthly divisor rules need an approved source before calculation; missing rules leave employees in Review Required. Rules are append-only and effective-dated.</p></div>
    <div className="divide-y divide-border rounded-xl border border-border">{rules.map((rule) => <div key={rule.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
      <span><strong>{title(rule.rule_code)}</strong> · {title(rule.pay_basis)}<small className="block text-text-secondary">Effective {rule.effective_from} · {rule.source_note}</small></span>
      <span className="tabular-nums">{rule.multiplier}×{rule.monthly_divisor_minutes ? ` · ${rule.monthly_divisor_minutes} monthly minutes` : ""}</span>
    </div>)}</div>
    {canManage && <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
      <AdminFormField label="Rule" required><select className="control" value={draft.ruleCode} onChange={(event) => patch("ruleCode", event.target.value)}>{ruleCodes.map((code) => <option key={code} value={code}>{title(code)}</option>)}</select></AdminFormField>
      <AdminFormField label="Pay Basis" required><select className="control" value={draft.payBasis} onChange={(event) => patch("payBasis", event.target.value)}><option value="hourly">Hourly</option><option value="monthly">Monthly</option></select></AdminFormField>
      <AdminFormField label="Effective From" required><input className="control" type="date" value={draft.effectiveFrom} onChange={(event) => patch("effectiveFrom", event.target.value)} /></AdminFormField>
      <AdminFormField label="Multiplier" required><input className="control" type="number" min="0" max="10" step="0.0001" value={draft.multiplier} onChange={(event) => patch("multiplier", event.target.value)} /></AdminFormField>
      {draft.payBasis === "monthly" && !["monthly_basic", "non_payable"].includes(draft.ruleCode) && <AdminFormField label="Approved Monthly Divisor (minutes)" required><input className="control" type="number" min="1" step="1" value={draft.monthlyDivisorMinutes} onChange={(event) => patch("monthlyDivisorMinutes", event.target.value)} /></AdminFormField>}
      <AdminFormField label="Source / policy reference" required><input className="control" value={draft.sourceNote} onChange={(event) => patch("sourceNote", event.target.value)} placeholder="Reviewed statute or approved policy reference" /></AdminFormField>
      <AdminFormField label="Approval reason" required><input className="control" value={draft.reason} onChange={(event) => patch("reason", event.target.value)} /></AdminFormField>
      <div className="flex items-end"><button className="btn-primary" type="button" disabled={busy || !draft.effectiveFrom || !draft.multiplier || !draft.sourceNote.trim() || !draft.reason.trim()} onClick={publish}>{busy ? "Publishing…" : "Publish Rule Version"}</button></div>
    </div>}
    {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
  </Card>;
}
