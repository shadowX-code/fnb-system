import { useState } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import { crewService } from "../../../services/crewService.js";
import { crewAccessMutationError } from "../utils/crewAccessErrors.js";

function validPasscode(value) {
  return /^\d{4}$/.test(value);
}

export default function CrewAccessManagerModal({ employee, mode = "enable", onClose, onSaved }) {
  const [manual, setManual] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [saving, setSaving] = useState(false);
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
      setError("Enter a four-digit passcode.");
      return;
    }
    setSaving(true);
    try {
      const data = await crewService.manageAccess(employee.id, reset ? "reset_passcode" : "enable", manual ? passcode : "");
      setResult(data);
      onSaved?.(data);
    } catch (submitError) {
      setError(crewAccessMutationError(submitError, "Unable to update Crew Access."));
    } finally { setSaving(false); }
  }

  if (result) {
    return <Modal title={reset ? "Passcode Reset" : "Crew Access Activated"} description="This temporary passcode is shown once only." size="sm" onClose={onClose} footer={<button className="btn-primary" type="button" onClick={onClose}>Done</button>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><ShieldCheck className="mr-2 inline" size={16} />{reset ? `A new passcode is ready for ${employee.full_name}.` : `Crew Access is active for ${employee.full_name}.`}</div>
        <div className="rounded-xl border border-border bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Mobile</div><div className="mt-1 text-sm font-bold text-text-primary">{result.mobile_number}</div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Temporary Passcode</div>
          <div className="mt-1 flex items-center gap-2"><code className="text-2xl font-bold tracking-[0.22em] text-text-primary">{result.temporary_passcode}</code><button className="icon-btn" type="button" onClick={copyPasscode} aria-label="Copy temporary passcode"><Copy size={16} /></button></div>
        </div>
        <p className="text-xs font-medium text-text-secondary">Share it securely. It cannot be viewed again after this window is closed.</p>
      </div>
    </Modal>;
  }

  return <Modal title={reset ? "Reset Crew Passcode" : "Activate Crew Access"} description={`${employee.full_name} · ${employee.position || "No position"} · ${employee.workplace || "No workplace"}`} size="sm" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" form="crew-access-form" type="submit" disabled={saving}>{saving ? "Saving..." : reset ? "Reset Passcode" : "Activate"}</button></>}>
    <form id="crew-access-form" className="space-y-4" onSubmit={submit}>
      <div className="rounded-xl border border-border bg-slate-50 p-3 text-sm"><div className="font-bold text-text-primary">Mobile number</div><div className="mt-1 text-text-secondary">{employee.contact || "Missing from employee record"}</div></div>
      {!employee.contact ? <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">Add a valid mobile number to this employee before enabling Crew Access.</div> : null}
      <div><div className="text-sm font-bold text-text-primary">Passcode</div><label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={!manual} onChange={() => setManual(false)} /> Generate random</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={manual} onChange={() => setManual(true)} /> Enter manually</label>{manual ? <input className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-center text-lg font-bold tracking-[0.3em] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" inputMode="numeric" maxLength="4" value={passcode} onChange={(event) => setPasscode(event.target.value.replace(/\D/g, ""))} placeholder="••••" autoComplete="off" /> : null}</div>
      {error ? <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div> : null}
    </form>
  </Modal>;
}
