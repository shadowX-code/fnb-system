import { useEffect, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { outletService } from "../../../services/outletService.js";

const options = [
  { value: "peninsular_labuan", label: "Peninsular Malaysia / Labuan" },
  { value: "sabah", label: "Sabah" },
  { value: "sarawak", label: "Sarawak" },
  { value: "unresolved", label: "Unresolved" },
];
const label = value => options.find(o => o.value === value)?.label || "Unresolved";

export default function OutletEmploymentLawCoverage({ outlet, onClose }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [values, setValues] = useState({ coverage: "", effective_from: "", reference: "", reason: "" });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let cancelled = false;
    outletService.readEmploymentLawCoverage(outlet.id).then(result => { if (!cancelled) setData(result); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [outlet.id]);
  function change(key, value) {
    setValues(current => ({ ...current, [key]: value }));
    setRequestId(crypto.randomUUID());
  }
  async function confirm() {
    setBusy(true); setError("");
    try {
      const prior = data.history.find(v => v.effective_from === values.effective_from);
      await outletService.confirmEmploymentLawCoverage(outlet.id, values, requestId, prior?.id || null);
      setData(await outletService.readEmploymentLawCoverage(outlet.id));
      setValues({ coverage: "", effective_from: "", reference: "", reason: "" });
      setRequestId(crypto.randomUUID());
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Employment Law Coverage" description={outlet.name} onClose={() => { if (!busy) onClose(); }} footer={<>
    <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>
    {data?.can_confirm && <button type="button" className="btn-primary" disabled={busy || Object.values(values).some(v => !v.trim())} onClick={confirm}>{busy ? "Confirming…" : "Confirm Coverage"}</button>}
  </>}>
    {error && <p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
    {!data ? <p className="text-sm">{error ? "Coverage could not be loaded." : "Loading coverage…"}</p> : <div className="space-y-4">
      <p className="text-sm"><strong>Current coverage:</strong> {label(data.current.coverage)}{data.current.effective_from && ` · from ${data.current.effective_from}`}{data.current.origin === "dated_outlet_state" && " · dated State evidence"}</p>
      {data.can_confirm && <div className="space-y-3">
        <p className="text-sm text-text-secondary">Confirm the legal coverage and the date it became effective. Historical confirmation preserves later evidence. State-specific holidays remain separate.</p>
        <SelectField disabled={busy} label="Employment law coverage" ariaLabel="Employment law coverage" options={options} value={values.coverage} onChange={v => change("coverage", v)} />
        <label className="block text-sm font-semibold">Effective from<input className="control mt-1 w-full" type="date" value={values.effective_from} disabled={busy} onChange={e => change("effective_from", e.target.value)} /></label>
        <label className="block text-sm font-semibold">Evidence / reference<input className="control mt-1 w-full" value={values.reference} disabled={busy} onChange={e => change("reference", e.target.value)} /></label>
        <label className="block text-sm font-semibold">Confirmation / correction reason<textarea className="control mt-1 w-full" value={values.reason} disabled={busy} onChange={e => change("reason", e.target.value)} /></label>
      </div>}
      <details><summary className="cursor-pointer text-sm font-semibold">Coverage history ({data.history.length})</summary>
        <ul className="mt-2 space-y-3 text-sm">{data.history.map(v => <li key={v.id} className="border-b border-border pb-2">
          <strong>{v.effective_from} · {label(v.coverage)}</strong><p>{v.reference} · {v.reason}</p>
          <p className="text-xs text-text-secondary">{v.actor_name} · {v.recorded_at}{v.supersedes_id ? " · Corrected revision" : ""}</p>
        </li>)}</ul>
      </details>
    </div>}
  </Modal>;
}
