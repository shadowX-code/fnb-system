import { useEffect, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import { crewAccessMutationError } from "../utils/crewAccessErrors.js";

export default function CrewSpecialAccessModal({ employee, onClose, onSaved }) {
  const management = employee.workplace?.trim().toLowerCase() === "management";
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [loading, setLoading] = useState(management);
  const [handover, setHandover] = useState(Boolean(employee.crew_access?.can_initiate_handover));
  const [addAssets, setAddAssets] = useState(Boolean(employee.crew_access?.can_add_assets));
  const [adjustAssets, setAdjustAssets] = useState(Boolean(employee.crew_access?.can_adjust_assets));
  const [inspectAssets, setInspectAssets] = useState(Boolean(employee.crew_access?.can_perform_asset_inspections));
  const [manageAssetDetails, setManageAssetDetails] = useState(Boolean(employee.crew_access?.can_manage_asset_details));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!management) return undefined;
    let current = true;
    crewService.managementSpecialAccess(employee.id).then((result) => {
      if (!current) return;
      setOutlets(result?.outlets || []);
      setOutletId(result?.outlets?.[0]?.id || "");
    }).catch((cause) => { if (current) setError(crewAccessMutationError(cause, "Unable to load Special Access.")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [employee.id, management]);
  useEffect(() => {
    if (!management || !outletId) return;
    const selected = outlets.find((outlet) => outlet.id === outletId);
    setHandover(Boolean(selected?.can_initiate_handover));
    setAddAssets(Boolean(selected?.can_add_assets));
    setManageAssetDetails(Boolean(selected?.can_manage_asset_details));
    setAdjustAssets(Boolean(selected?.can_adjust_assets));
    setInspectAssets(Boolean(selected?.can_perform_asset_inspections));
  }, [management, outletId, outlets]);
  async function save() {
    setSaving(true); setError("");
    try {
      const values = { handover, addAssets, adjustAssets, inspectAssets, manageAssetDetails };
      const result = management
        ? await crewService.updateManagementSpecialAccess(employee.id, outletId, values)
        : await crewService.updateSpecialAccess(employee.id, values);
      onSaved?.(result);
      onClose();
    }
    catch (cause) { setError(crewAccessMutationError(cause, "Unable to save Special Access.")); }
    finally { setSaving(false); }
  }
  const capability = (label, description, checked, setChecked) => <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-slate-50 p-3 text-left"><span><strong className="block text-sm text-text-primary">{label}</strong><small className="mt-1 block text-text-secondary">{description}</small></span><input aria-label={label} className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /></label>;
  return <Modal title="Special Access" description={`${employee.full_name} · ${employee.workplace || "No workplace"}`} size="sm" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || loading || (management && !outletId)} onClick={save}>{saving ? "Saving..." : "Save Changes"}</button></>}><div className="space-y-4"><p className="text-sm text-text-secondary">{management ? "Additional Crew actions apply only to the selected authorized outlet." : "Per-account Crew capabilities for this workplace outlet."}</p>{management ? <SelectField label="Outlet" ariaLabel="Outlet" value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} disabled={loading || saving} /> : null}{loading ? <p className="text-sm text-text-secondary">Loading outlet access...</p> : null}{!loading && (!management || outletId) ? <>{capability("Hand Over Cash", "Allow this employee to initiate Cash Handover at this outlet.", handover, setHandover)}{capability("Add Assets", "View outlet Assets and add a new canonical asset for this outlet.", addAssets, setAddAssets)}{capability("Manage Asset Details", "Update Asset name, description, location and master photo only.", manageAssetDetails, setManageAssetDetails)}{capability("Adjust Assets", "View outlet Assets and record quantity movements.", adjustAssets, setAdjustAssets)}{capability("Perform Asset Inspections", "View outlet Assets and complete canonical inspections.", inspectAssets, setInspectAssets)}</> : null}{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}</div></Modal>;
}
