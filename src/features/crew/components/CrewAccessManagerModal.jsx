import { useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import { crewService } from "../../../services/crewService.js";

function validPasscode(value) {
  return /^\d{4}$/.test(value) && !["0000", "1111", "1234", "4321"].includes(value);
}

export default function CrewAccessManagerModal({ employee, mode = "enable", onClose, onSaved }) {
  const [manual, setManual] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingCashOperations, setSavingCashOperations] = useState(false);
  const [canInitiateHandover, setCanInitiateHandover] = useState(Boolean(employee.crew_access?.can_initiate_handover));
  const [cashOperationsError, setCashOperationsError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const reset = mode === "reset";

  async function copyPasscode() {
    try { await navigator.clipboard.writeText(result.temporary_passcode); } catch { /* The passcode remains visible for this one-time session. */ }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (manual && !validPasscode(passcode)) {
      setError("Use four digits that are not a common or repeated passcode.");
      return;
    }
    setSaving(true);
    try {
      const data = await crewService.manageAccess(employee.id, reset ? "reset_passcode" : "enable", manual ? passcode : "");
      setResult(data);
      onSaved?.(data);
    } catch (submitError) {
      setError(submitError.message || "Unable to update Crew Access.");
    } finally { setSaving(false); }
  }

  async function saveCashOperations() {
    setCashOperationsError("");
    setSavingCashOperations(true);
    try {
      const data = await crewService.updateCashOperationsAccess(employee.id, canInitiateHandover);
      onSaved?.(data);
    } catch (submitError) {
      setCashOperationsError(submitError.message || "Unable to update Cash Operations.");
    } finally { setSavingCashOperations(false); }
  }

  if (result) {
    return <Modal title="Crew Access Enabled" description="This temporary passcode is shown once only." size="sm" onClose={onClose} footer={<button className="btn-primary" type="button" onClick={onClose}>Done</button>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><ShieldCheck className="mr-2 inline" size={16} />Crew Access is active for {employee.full_name}.</div>
        <div className="rounded-xl border border-border bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Mobile</div><div className="mt-1 text-sm font-bold text-text-primary">{result.mobile_number}</div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Temporary Passcode</div>
          <div className="mt-1 flex items-center gap-2"><code className="text-2xl font-bold tracking-[0.22em] text-text-primary">{result.temporary_passcode}</code><button className="icon-btn" type="button" onClick={copyPasscode} aria-label="Copy temporary passcode"><Copy size={16} /></button></div>
        </div>
        <p className="text-xs font-medium text-text-secondary">Share it securely. It cannot be viewed again after this window is closed.</p>
      </div>
    </Modal>;
  }

  return <Modal title={reset ? "Generate New Crew Passcode" : "Enable Crew Access"} description={`${employee.full_name} · ${employee.position || "No position"} · ${employee.workplace || "No workplace"}`} size="sm" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" form="crew-access-form" type="submit" disabled={saving}>{saving ? "Saving..." : reset ? "Generate Passcode" : "Enable Access"}</button></>}>
    <form id="crew-access-form" className="space-y-4" onSubmit={submit}>
      <div className="rounded-xl border border-border bg-slate-50 p-3 text-sm"><div className="font-bold text-text-primary">Mobile number</div><div className="mt-1 text-text-secondary">{employee.contact || "Missing from employee record"}</div></div>
      {!employee.contact ? <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">Add a valid mobile number to this employee before enabling Crew Access.</div> : null}
      {employee.crew_access ? <section className="rounded-xl border border-border bg-slate-50 p-3" aria-labelledby="cash-operations-title"><div className="mb-3"><h3 id="cash-operations-title" className="text-sm font-bold text-text-primary">Cash Operations</h3><p className="mt-1 text-xs text-text-secondary">This Crew Mobile capability is separate from Admin Access, Admin Roles, and Cash Handover Receiver configuration.</p></div><label className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 text-left"><span><strong className="block text-sm text-text-primary">Hand Over Cash</strong><small className="mt-0.5 block text-text-secondary">Allow this employee to initiate Cash Handover for their Crew outlet.</small></span><input aria-label="Hand Over Cash" className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={canInitiateHandover} onChange={(event) => setCanInitiateHandover(event.target.checked)} /></label>{cashOperationsError ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{cashOperationsError}</p> : null}<button className="btn-secondary mt-3" type="button" disabled={savingCashOperations} onClick={saveCashOperations}>{savingCashOperations ? "Saving…" : "Save Cash Operations"}</button></section> : <section className="rounded-xl border border-border bg-slate-50 p-3 text-sm text-text-secondary"><strong className="block text-text-primary">Cash Operations</strong><p className="mt-1">Enable Crew Access before configuring Hand Over Cash.</p></section>}
      <div><div className="text-sm font-bold text-text-primary">Passcode</div><label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={!manual} onChange={() => setManual(false)} /> Generate random</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={manual} onChange={() => setManual(true)} /> Enter manually</label>{manual ? <input className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-center text-lg font-bold tracking-[0.3em] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" inputMode="numeric" maxLength="4" value={passcode} onChange={(event) => setPasscode(event.target.value.replace(/\D/g, ""))} placeholder="••••" autoComplete="off" /> : null}</div>
      {error ? <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div> : null}
    </form>
  </Modal>;
}
