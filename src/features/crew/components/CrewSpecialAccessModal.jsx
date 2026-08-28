import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { crewService } from "../../../services/crewService.js";

export default function CrewSpecialAccessModal({ employee, onClose, onSaved }) {
  const [handover, setHandover] = useState(Boolean(employee.crew_access?.can_initiate_handover));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    try { onSaved?.(await crewService.updateCashOperationsAccess(employee.id, handover)); onClose(); }
    catch (cause) { setError(cause.message || "Unable to save Special Access."); }
    finally { setSaving(false); }
  }
  return <Modal title="Special Access" description={`${employee.full_name} · ${employee.workplace || "No workplace"}`} size="sm" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save Changes"}</button></>}><div className="space-y-4"><p className="text-sm text-text-secondary">Per-account Crew capabilities. This does not create or assign an Admin role.</p><label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-slate-50 p-3 text-left"><span><strong className="block text-sm text-text-primary">Hand Over Cash</strong><small className="mt-1 block text-text-secondary">Allow this employee to initiate Cash Handover at their current Crew outlet.</small></span><input aria-label="Hand Over Cash" className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={handover} onChange={(event) => setHandover(event.target.checked)} /></label>{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}</div></Modal>;
}
