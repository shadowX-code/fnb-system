import { useEffect, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import { crewAccessMutationError } from "../utils/crewAccessErrors.js";

export default function CrewSpecialAccessModal({ employee, onClose, onSaved }) {
  const management = employee.workplace?.trim().toLowerCase() === "management";
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [handover, setHandover] = useState(Boolean(employee.crew_access?.can_initiate_handover));
  const [addAssets, setAddAssets] = useState(Boolean(employee.crew_access?.can_add_assets));
  const [adjustAssets, setAdjustAssets] = useState(Boolean(employee.crew_access?.can_adjust_assets));
  const [inspectAssets, setInspectAssets] = useState(Boolean(employee.crew_access?.can_perform_asset_inspections));
  const [manageAssetDetails, setManageAssetDetails] = useState(Boolean(employee.crew_access?.can_manage_asset_details));
  const [performStockCheck, setPerformStockCheck] = useState(false);
  const [createAuditStockCheck, setCreateAuditStockCheck] = useState(false);
  const [managePurchaseOrders, setManagePurchaseOrders] = useState(false);
  const [receivePurchaseOrders, setReceivePurchaseOrders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let current = true;
    (management ? crewService.managementSpecialAccess(employee.id) : crewService.inventorySpecialAccess(employee.id)).then((result) => {
      if (!current) return;
      if (management) {
        setOutlets(result?.outlets || []);
        setOutletId(result?.outlets?.[0]?.id || "");
      } else {
        setPerformStockCheck(Boolean(result?.can_perform_stock_check));
        setCreateAuditStockCheck(Boolean(result?.can_create_audit_stock_check));
        setManagePurchaseOrders(Boolean(result?.can_manage_purchase_orders));
        setReceivePurchaseOrders(Boolean(result?.can_receive_purchase_orders));
      }
    }).catch((cause) => { if (current) { setLoadFailed(true); setError(crewAccessMutationError(cause, "Unable to load Special Access.")); } })
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
    setPerformStockCheck(Boolean(selected?.can_perform_stock_check));
    setCreateAuditStockCheck(Boolean(selected?.can_create_audit_stock_check));
    setManagePurchaseOrders(Boolean(selected?.can_manage_purchase_orders));
    setReceivePurchaseOrders(Boolean(selected?.can_receive_purchase_orders));
  }, [management, outletId, outlets]);
  async function save() {
    setSaving(true); setError("");
    try {
      const values = { handover, addAssets, adjustAssets, inspectAssets, manageAssetDetails,
        performStockCheck, createAuditStockCheck, managePurchaseOrders, receivePurchaseOrders };
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
  return <Modal title="Special Access" description={`${employee.full_name} · ${employee.workplace || "No workplace"}`} size="sm" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || loading || loadFailed || (management && !outletId)} onClick={save}>{saving ? "Saving..." : "Save Changes"}</button></>}><div className="space-y-4"><p className="text-sm text-text-secondary">{management ? "Additional Crew actions apply only to the selected authorized outlet." : "Per-account Crew capabilities for this workplace outlet."}</p>{management ? <SelectField label="Outlet" ariaLabel="Outlet" value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} disabled={loading || saving} /> : null}{loading ? <p className="text-sm text-text-secondary">Loading outlet access...</p> : null}{!loading && !loadFailed && (!management || outletId) ? <>{capability("Hand Over Cash", "Allow this employee to initiate Cash Handover at this outlet.", handover, setHandover)}{capability("Add Assets", "View outlet Assets and add a new canonical asset for this outlet.", addAssets, setAddAssets)}{capability("Manage Asset Details", "Update Asset name, description, location and master photo only.", manageAssetDetails, setManageAssetDetails)}{capability("Adjust Assets", "View outlet Assets and record quantity movements.", adjustAssets, setAdjustAssets)}{capability("Perform Asset Inspections", "View outlet Assets and complete canonical inspections.", inspectAssets, setInspectAssets)}<p className="pt-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Restaurant Inventory</p>{capability("Perform Stock Check", "Count and complete scheduled outlet Stock Checks.", performStockCheck, setPerformStockCheck)}{capability("Create Audit Stock Check", "Create and complete non-scheduled outlet audits.", createAuditStockCheck, setCreateAuditStockCheck)}{capability("Create / Manage Purchase Orders", "Create drafts, submit and confirm supplier orders.", managePurchaseOrders, setManagePurchaseOrders)}{capability("Receive Purchase Orders", "Record partial or full receipts and stock movements.", receivePurchaseOrders, setReceivePurchaseOrders)}</> : null}{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}</div></Modal>;
}
