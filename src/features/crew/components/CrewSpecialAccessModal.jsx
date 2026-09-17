import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { crewService } from "../../../services/crewService.js";
import { crewAccessMutationError } from "../utils/crewAccessErrors.js";

export default function CrewSpecialAccessModal({ employee, onClose, onSaved }) {
  const [handover, setHandover] = useState(Boolean(employee.crew_access?.can_initiate_handover));
  const [addAssets, setAddAssets] = useState(Boolean(employee.crew_access?.can_add_assets));
  const [adjustAssets, setAdjustAssets] = useState(Boolean(employee.crew_access?.can_adjust_assets));
  const [inspectAssets, setInspectAssets] = useState(Boolean(employee.crew_access?.can_perform_asset_inspections));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    try {
      onSaved?.(await crewService.updateSpecialAccess(employee.id, { handover, addAssets, adjustAssets, inspectAssets }));
      onClose();
    }
    catch (cause) { setError(crewAccessMutationError(cause, "Unable to save Special Access.")); }
    finally { setSaving(false); }
  }
  const capability = (label, description, checked, setChecked) => <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-slate-50 p-3 text-left"><span><strong className="block text-sm text-text-primary">{label}</strong><small className="mt-1 block text-text-secondary">{description}</small></span><input aria-label={label} className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /></label>;
  return <Modal title="Special Access" description={`${employee.full_name} · ${employee.workplace || "No workplace"}`} size="sm" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save Changes"}</button></>}><div className="space-y-4"><p className="text-sm text-text-secondary">Per-account Crew capabilities. This does not create or assign an Admin role.</p>{capability("Hand Over Cash", "Allow this employee to initiate Cash Handover at their current Crew outlet.", handover, setHandover)}{capability("Add Assets", "View outlet Assets and add a new canonical asset for the current outlet.", addAssets, setAddAssets)}{capability("Adjust Assets", "View outlet Assets and record quantity movements.", adjustAssets, setAdjustAssets)}{capability("Perform Asset Inspections", "View outlet Assets and complete canonical inspections.", inspectAssets, setInspectAssets)}{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}</div></Modal>;
}
