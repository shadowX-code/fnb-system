import { useEffect, useMemo, useState } from "react";
import { Download, Eye, PackagePlus, Plus, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { assetTrackingService } from "../../../services/assetTrackingService.js";
import { canCreate, canDelete, canEdit, canExport, canManage, notifyPermissionDenied } from "../../../utils/accessControl.js";

const assetStatuses = ["active", "damaged", "missing", "disposed", "inactive"];
const reduceReasons = ["broken", "missing", "disposed", "stolen", "transferred", "correction", "other"];
const conditionStatuses = ["good", "damaged", "missing", "need_repair"];

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function statusTone(status) {
  if (status === "active") return "success";
  if (status === "damaged" || status === "missing") return "warning";
  if (status === "disposed") return "danger";
  return "neutral";
}

function emptyAsset() {
  return {
    outlet_id: "",
    category_id: "",
    name: "",
    description: "",
    unit: "unit",
    current_quantity: 0,
    minimum_quantity: 0,
    status: "active",
    remark: "",
  };
}

function AssetFormModal({ asset, outlets, categories, onClose, onSubmit, saving }) {
  const [values, setValues] = useState(() => ({ ...emptyAsset(), ...asset }));
  const isEdit = Boolean(asset?.id);
  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  return (
    <Modal
      title={isEdit ? "Edit Asset" : "Add Asset"}
      description="Create or update an outlet asset record."
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            disabled={saving || !values.name.trim() || !values.outlet_id || !values.category_id}
            onClick={() => onSubmit(values)}
          >
            {isEdit ? "Save Asset" : "Create Asset"}
          </button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FieldLabel label="Asset Name">
          <input className="control" value={values.name} onChange={(event) => update("name", event.target.value)} placeholder="2-door chiller" />
        </FieldLabel>
        <FieldLabel label="Outlet">
          <SelectField value={values.outlet_id} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => update("outlet_id", value)} />
        </FieldLabel>
        <FieldLabel label="Category">
          <SelectField value={values.category_id} options={categories.filter((category) => category.is_active).map((category) => ({ value: category.id, label: category.name }))} onChange={(value) => update("category_id", value)} searchable />
        </FieldLabel>
        <FieldLabel label="Status">
          <SelectField value={values.status} options={assetStatuses.map((status) => ({ value: status, label: titleCase(status) }))} onChange={(value) => update("status", value)} />
        </FieldLabel>
        <FieldLabel label="Current Quantity">
          <input className="control" type="number" min="0" value={values.current_quantity} onChange={(event) => update("current_quantity", event.target.value)} disabled={isEdit} />
        </FieldLabel>
        <FieldLabel label="Minimum Quantity">
          <input className="control" type="number" min="0" value={values.minimum_quantity} onChange={(event) => update("minimum_quantity", event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Unit">
          <input className="control" value={values.unit} onChange={(event) => update("unit", event.target.value)} placeholder="unit / set / pcs" />
        </FieldLabel>
        <FieldLabel label="Remark">
          <input className="control" value={values.remark} onChange={(event) => update("remark", event.target.value)} placeholder="Optional" />
        </FieldLabel>
        <FieldLabel label="Description">
          <textarea className="control min-h-24 md:col-span-2" value={values.description} onChange={(event) => update("description", event.target.value)} placeholder="Optional asset details" />
        </FieldLabel>
      </div>
      {isEdit ? <p className="mt-3 text-xs font-semibold text-text-secondary">Use Adjust Quantity for stock changes so a movement log is created.</p> : null}
    </Modal>
  );
}

function CategoryModal({ categories, onClose, onSave, onArchive, saving, canWrite, canArchive }) {
  const [draft, setDraft] = useState({ name: "", description: "", sort_order: categories.length + 1, is_active: true });
  return (
    <Modal title="Asset Categories" description="Manage reusable asset categories." onClose={onClose} size="lg">
      <div className="space-y-3">
        <div className="rounded-2xl border border-border bg-background p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_100px_auto] md:items-end">
            <FieldLabel label="Category Name">
              <input className="control" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Kitchen Equipment" />
            </FieldLabel>
            <FieldLabel label="Description">
              <input className="control" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Optional" />
            </FieldLabel>
            <FieldLabel label="Order">
              <input className="control" type="number" value={draft.sort_order} onChange={(event) => setDraft((current) => ({ ...current, sort_order: event.target.value }))} />
            </FieldLabel>
            <button className="btn-primary h-10" type="button" disabled={!canWrite || saving || !draft.name.trim()} onClick={async () => { await onSave(draft); setDraft({ name: "", description: "", sort_order: categories.length + 2, is_active: true }); }}>
              {draft.id ? "Save" : "Add"}
            </button>
          </div>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {categories.map((category) => (
            <div key={category.id} className="grid gap-2 p-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
              <div>
                <div className="text-sm font-bold text-text-primary">{category.name}</div>
                <div className="text-xs font-semibold text-text-secondary">{category.description || "No description"}</div>
              </div>
              <Badge tone={category.is_active ? "success" : "neutral"}>{category.is_active ? "Active" : "Archived"}</Badge>
              <div className="flex justify-end gap-2">
                {canWrite ? <button className="btn-secondary h-8 text-xs" type="button" onClick={() => setDraft(category)}>Edit</button> : null}
                {category.is_active && canArchive ? <button className="btn-secondary h-8 text-xs" type="button" onClick={() => onArchive(category)}>Archive</button> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function AdjustQuantityModal({ asset, onClose, onSubmit, saving }) {
  const [values, setValues] = useState({ type: "add", quantity: 1, reason: "", remark: "", date: new Date().toISOString().slice(0, 10) });
  const requiresReason = values.type === "reduce";
  const invalid = Number(values.quantity || 0) <= 0 || (requiresReason && !values.reason) || (values.reason === "other" && !values.remark.trim());
  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  return (
    <Modal
      title="Adjust Quantity"
      description={`${asset.name} · Current quantity ${asset.current_quantity} ${asset.unit}`}
      onClose={onClose}
      size="md"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={saving || invalid} onClick={() => onSubmit(values)}>Confirm Adjustment</button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FieldLabel label="Adjustment Type">
          <SelectField value={values.type} options={["add", "reduce", "correction"].map((type) => ({ value: type, label: titleCase(type) }))} onChange={(value) => update("type", value)} />
        </FieldLabel>
        <FieldLabel label="Quantity">
          <input className="control" type="number" min="1" value={values.quantity} onChange={(event) => update("quantity", event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Reason">
          <SelectField value={values.reason} placeholder={requiresReason ? "Required" : "Optional"} options={reduceReasons.map((reason) => ({ value: reason, label: titleCase(reason) }))} onChange={(value) => update("reason", value)} />
        </FieldLabel>
        <FieldLabel label="Date">
          <input className="control" type="date" value={values.date} onChange={(event) => update("date", event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Remark">
          <textarea className="control min-h-24 md:col-span-2" value={values.remark} onChange={(event) => update("remark", event.target.value)} placeholder={values.reason === "other" ? "Required for Other" : "Optional"} />
        </FieldLabel>
      </div>
    </Modal>
  );
}

function InspectionModal({ outletId, categories, assets, onClose, onSubmit, saving }) {
  const [step, setStep] = useState(1);
  const [scopeType, setScopeType] = useState("all");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState([]);
  const [checkedBy, setCheckedBy] = useState("");
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState("");
  const scopedAssets = useMemo(() => assets.filter((asset) => asset.outlet_id === outletId && (scopeType === "all" || selectedCategoryIds.includes(asset.category_id))), [assets, outletId, scopeType, selectedCategoryIds]);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    setRows(scopedAssets.map((asset) => ({
      asset,
      counted_quantity: asset.current_quantity,
      condition_status: "good",
      remark: "",
    })));
  }, [scopedAssets]);

  const varianceRows = rows.filter((row) => Number(row.counted_quantity || 0) !== Number(row.asset.current_quantity || 0));
  const damagedRows = rows.filter((row) => row.condition_status === "damaged" || row.condition_status === "need_repair");
  const missingRows = rows.filter((row) => row.condition_status === "missing");
  const categoryScope = scopeType === "all"
    ? { type: "all", category_ids: [] }
    : { type: "selected", category_ids: selectedCategoryIds };

  function updateRow(assetId, key, value) {
    setRows((current) => current.map((row) => (row.asset.id === assetId ? { ...row, [key]: value } : row)));
  }

  return (
    <Modal
      title="Asset Inspection"
      description="Compare expected quantity with the actual counted quantity."
      onClose={onClose}
      size="2xl"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "Cancel" : "Back"}</button>
          {step < 3 ? (
            <button className="btn-primary" type="button" disabled={scopeType === "selected" && selectedCategoryIds.length === 0} onClick={() => setStep((current) => current + 1)}>Continue</button>
          ) : (
            <button className="btn-primary" type="button" disabled={saving || !rows.length} onClick={() => onSubmit({ outletId, inspectionDate, checkedBy, categoryScope, remark, rows })}>Submit Inspection</button>
          )}
        </>
      )}
    >
      {step === 1 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <FieldLabel label="Inspection Date"><input className="control" type="date" value={inspectionDate} onChange={(event) => setInspectionDate(event.target.value)} /></FieldLabel>
          <FieldLabel label="Checked By"><input className="control" value={checkedBy} onChange={(event) => setCheckedBy(event.target.value)} placeholder="Manager name" /></FieldLabel>
          <FieldLabel label="Category Scope">
            <SelectField value={scopeType} options={[{ value: "all", label: "All Categories" }, { value: "selected", label: "Selected Categories" }]} onChange={setScopeType} />
          </FieldLabel>
          <FieldLabel label="Remark"><input className="control" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Optional" /></FieldLabel>
          {scopeType === "selected" ? (
            <div className="md:col-span-2">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">Select Categories</div>
              <div className="flex flex-wrap gap-2">
                {categories.filter((category) => category.is_active).map((category) => {
                  const selected = selectedCategoryIds.includes(category.id);
                  return (
                    <button key={category.id} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${selected ? "border-primary bg-primary text-white" : "border-border bg-surface text-text-secondary"}`} type="button" onClick={() => setSelectedCategoryIds((current) => selected ? current.filter((id) => id !== category.id) : [...current, category.id])}>
                      {category.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-text-muted">
              <tr><th className="px-3 py-2">Asset</th><th>Category</th><th>Expected</th><th>Counted</th><th>Difference</th><th>Condition</th><th>Remark</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const diff = Number(row.counted_quantity || 0) - Number(row.asset.current_quantity || 0);
                return (
                  <tr key={row.asset.id}>
                    <td className="px-3 py-2 font-bold text-text-primary">{row.asset.name}</td>
                    <td className="text-text-secondary">{row.asset.category_name}</td>
                    <td>{row.asset.current_quantity}</td>
                    <td><input className="control h-9 w-24" type="number" min="0" value={row.counted_quantity} onChange={(event) => updateRow(row.asset.id, "counted_quantity", event.target.value)} /></td>
                    <td className={diff ? "font-bold text-amber-700" : "text-text-secondary"}>{diff}</td>
                    <td><SelectField value={row.condition_status} options={conditionStatuses.map((status) => ({ value: status, label: titleCase(status) }))} onChange={(value) => updateRow(row.asset.id, "condition_status", value)} /></td>
                    <td><input className="control h-9" value={row.remark} onChange={(event) => updateRow(row.asset.id, "remark", event.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">No assets found for this inspection scope.</div> : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[["Items Checked", rows.length], ["Variance Found", varianceRows.length], ["Damaged Items", damagedRows.length], ["Missing Items", missingRows.length]].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-background p-4">
                <div className="text-xs font-black uppercase tracking-wide text-text-muted">{label}</div>
                <div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            Quantity differences will create correction movement logs and update the asset quantity after submission.
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function AssetDetailDrawer({ asset, movements, inspections, onClose, onAdjust, onInspect, onEdit }) {
  const [tab, setTab] = useState("overview");
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button className="flex-1 cursor-default" type="button" aria-label="Close asset detail" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Asset Detail</div><h2 className="mt-1 text-xl font-semibold text-text-primary">{asset.name}</h2><p className="mt-1 text-sm text-text-secondary">{asset.category_name} · {asset.current_quantity} {asset.unit}</p></div>
            <button className="icon-btn" type="button" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="mt-4 flex gap-2">
            {["overview", "movement", "inspection"].map((item) => <button key={item} className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === item ? "bg-primary text-white" : "bg-background text-text-secondary"}`} type="button" onClick={() => setTab(item)}>{item === "movement" ? "Movement Log" : item === "inspection" ? "Inspection History" : "Overview"}</button>)}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {[["Current Quantity", `${asset.current_quantity} ${asset.unit}`], ["Status", titleCase(asset.status)], ["Last Checked", formatDate(inspections[0]?.inspection_date)], ["Last Movement", formatDate(movements[0]?.movement_date)]].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-border bg-background p-4"><div className="text-xs font-black uppercase tracking-wide text-text-muted">{label}</div><div className="mt-1 text-sm font-bold text-text-primary">{value}</div></div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" type="button" onClick={onAdjust}>Adjust Quantity</button>
                <button className="btn-secondary" type="button" onClick={onInspect}>Start Inspection</button>
                <button className="btn-secondary" type="button" onClick={onEdit}>Edit Asset</button>
              </div>
            </div>
          ) : null}
          {tab === "movement" ? <Timeline rows={movements} empty="No movement logs yet." /> : null}
          {tab === "inspection" ? <InspectionHistory inspections={inspections} /> : null}
        </div>
      </aside>
    </div>
  );
}

function Timeline({ rows, empty }) {
  return rows.length ? <div className="space-y-2">{rows.map((row) => (
    <div key={row.id} className="rounded-2xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3"><div className="text-sm font-bold text-text-primary">{titleCase(row.movement_type)}</div><div className="text-xs font-semibold text-text-muted">{formatDate(row.movement_date)}</div></div>
      <div className="mt-1 text-xs font-semibold text-text-secondary">{row.quantity_before} → {row.quantity_after} ({row.quantity_change > 0 ? "+" : ""}{row.quantity_change}) · {titleCase(row.reason)}</div>
      {row.remark ? <div className="mt-2 text-xs text-text-secondary">{row.remark}</div> : null}
    </div>
  ))}</div> : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">{empty}</div>;
}

function InspectionHistory({ inspections }) {
  return inspections.length ? <div className="space-y-3">{inspections.map((inspection) => (
    <div key={inspection.id} className="rounded-2xl border border-border bg-background p-3">
      <div className="flex justify-between gap-3"><div className="text-sm font-bold text-text-primary">{formatDate(inspection.inspection_date)}</div><Badge tone="info">{titleCase(inspection.status)}</Badge></div>
      <div className="mt-2 space-y-1">
        {inspection.items.map((item) => <div key={item.id} className="text-xs font-semibold text-text-secondary">{item.asset?.name || "Asset"} · Expected {item.expected_quantity}, Counted {item.counted_quantity}, Difference {item.difference} · {titleCase(item.condition_status)}</div>)}
      </div>
    </div>
  ))}</div> : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">No inspection history yet.</div>;
}

export default function AssetTrackingPage({ store, ui, auth }) {
  const activeOutlets = store.outlets.filter((outlet) => outlet.status === "active" || outlet.is_active);
  const [outletId, setOutletId] = useState(activeOutlets[0]?.id ?? "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [movements, setMovements] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [assetModal, setAssetModal] = useState(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [adjustAsset, setAdjustAsset] = useState(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [detailAsset, setDetailAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canAdd = canCreate(auth, "asset_tracking");
  const canEditAsset = canEdit(auth, "asset_tracking");
  const canDeleteAsset = canDelete(auth, "asset_tracking");
  const canManageAsset = canManage(auth, "asset_tracking");
  const canExportAsset = canExport(auth, "asset_tracking");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [categoryRows, assetRows, movementRows, inspectionRows] = await Promise.all([
        assetTrackingService.listCategories(),
        assetTrackingService.listAssets(outletId),
        assetTrackingService.listMovementLogs(),
        assetTrackingService.listInspections(),
      ]);
      setCategories(categoryRows);
      setAssets(assetRows);
      setMovements(movementRows);
      setInspections(inspectionRows.filter((inspection) => inspection.outlet_id === outletId));
    } catch (loadError) {
      console.error("Unable to load asset tracking", loadError);
      setError(loadError.message || "Unable to load asset tracking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (outletId) loadData();
  }, [outletId]);

  const filteredAssets = useMemo(() => assets
    .filter((asset) => categoryFilter === "all" || asset.category_id === categoryFilter)
    .filter((asset) => statusFilter === "all" || asset.status === statusFilter)
    .filter((asset) => {
      const search = query.trim().toLowerCase();
      if (!search) return true;
      return [asset.name, asset.category_name, asset.remark].some((value) => String(value || "").toLowerCase().includes(search));
    }), [assets, categoryFilter, query, statusFilter]);

  const summary = useMemo(() => {
    const lastChecked = inspections[0]?.inspection_date;
    return {
      totalItems: filteredAssets.length,
      totalQuantity: filteredAssets.reduce((sum, asset) => sum + Number(asset.current_quantity || 0), 0),
      categories: new Set(filteredAssets.map((asset) => asset.category_id)).size,
      review: filteredAssets.filter((asset) => asset.status !== "active" || Number(asset.current_quantity || 0) <= Number(asset.minimum_quantity || 0)).length,
      lastChecked,
    };
  }, [filteredAssets, inspections]);

  async function saveAsset(asset) {
    if ((asset.id && !canEditAsset) || (!asset.id && !canAdd)) {
      notifyPermissionDenied(ui, asset.id ? "edit assets" : "create assets");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.saveAsset(asset);
      setAssetModal(null);
      await loadData();
      ui.notify({ title: asset.id ? "Asset updated" : "Asset created", message: asset.name });
    } catch (saveError) {
      console.error("Unable to save asset", saveError);
      ui.notify({ title: "Unable to save asset", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function saveCategory(category) {
    if (!canAdd) {
      notifyPermissionDenied(ui, "create asset categories");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.saveCategory(category);
      await loadData();
      ui.notify({ title: "Category saved", message: category.name });
    } catch (saveError) {
      console.error("Unable to save category", saveError);
      ui.notify({ title: "Unable to save category", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function archiveCategory(category) {
    if (!canDeleteAsset) {
      notifyPermissionDenied(ui, "archive asset categories");
      return;
    }
    try {
      await assetTrackingService.archiveCategory(category);
      await loadData();
      ui.notify({ title: "Category archived", message: category.name });
    } catch (archiveError) {
      console.error("Unable to archive category", archiveError);
      ui.notify({ title: "Unable to archive category", message: archiveError.message || "Please try again.", tone: "error" });
    }
  }

  async function adjustQuantity(values) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "adjust asset quantity");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.adjustQuantity(adjustAsset, values);
      setAdjustAsset(null);
      await loadData();
      ui.notify({ title: "Quantity adjusted", message: adjustAsset.name });
    } catch (adjustError) {
      console.error("Unable to adjust quantity", adjustError);
      ui.notify({ title: "Unable to adjust quantity", message: adjustError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function submitInspection(payload) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "submit asset inspections");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.submitInspection(payload);
      setInspectionOpen(false);
      await loadData();
      ui.notify({ title: "Inspection submitted" });
    } catch (inspectionError) {
      console.error("Unable to submit inspection", inspectionError);
      ui.notify({ title: "Unable to submit inspection", message: inspectionError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function archiveAsset(asset) {
    if (!canDeleteAsset) {
      notifyPermissionDenied(ui, "archive assets");
      return;
    }
    try {
      await assetTrackingService.archiveAsset(asset);
      await loadData();
      ui.notify({ title: "Asset archived", message: asset.name });
    } catch (archiveError) {
      console.error("Unable to archive asset", archiveError);
      ui.notify({ title: "Unable to archive asset", message: archiveError.message || "Please try again.", tone: "error" });
    }
  }

  const assetMovements = detailAsset ? movements.filter((movement) => movement.asset_id === detailAsset.id) : [];
  const assetInspections = detailAsset ? inspections.filter((inspection) => inspection.items.some((item) => item.asset_id === detailAsset.id)) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Asset Tracking"
        description="Track outlet assets, quantities, inspections, and movement logs."
        actions={(
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" type="button" disabled={!canExportAsset} onClick={() => ui.notify({ title: "Export prepared", message: "Asset export will be connected to the export service." })}><Download size={16} /> Export</button>
            <button className="btn-secondary" type="button" onClick={() => setCategoryModalOpen(true)}><Settings2 size={16} /> Categories</button>
            {canManageAsset ? <button className="btn-secondary" type="button" onClick={() => setInspectionOpen(true)}><SlidersHorizontal size={16} /> Start Inspection</button> : null}
            {canAdd ? <button className="btn-primary" type="button" onClick={() => setAssetModal({ ...emptyAsset(), outlet_id: outletId })}><Plus size={16} /> Add Asset</button> : null}
          </div>
        )}
      />

      <Card className="p-4">
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr_1.4fr] xl:items-end">
          <FieldLabel label="Outlet"><SelectField value={outletId} options={activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={setOutletId} /></FieldLabel>
          <FieldLabel label="Category"><SelectField value={categoryFilter} options={[{ value: "all", label: "All Categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} searchable /></FieldLabel>
          <FieldLabel label="Status"><SelectField value={statusFilter} options={[{ value: "all", label: "All Status" }, ...assetStatuses.map((status) => ({ value: status, label: titleCase(status) }))]} onChange={setStatusFilter} /></FieldLabel>
          <FieldLabel label="Search Asset"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} /><input className="control h-10 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset name..." /></div></FieldLabel>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total Asset Items", summary.totalItems],
          ["Total Quantity", summary.totalQuantity],
          ["Categories", summary.categories],
          ["Items Needing Review", summary.review],
          ["Last Checked Date", formatDate(summary.lastChecked)],
        ].map(([label, value]) => <Card key={label} className="p-4"><div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{label}</div><div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div></Card>)}
      </div>

      <Card title="Asset List" description="Outlet-specific asset quantities and movement status.">
        {loading ? <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading assets...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="border-b border-border bg-slate-50 text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  {["Asset Name", "Category", "Outlet", "Current Quantity", "Unit", "Status", "Last Checked", "Last Movement", "Actions"].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAssets.map((asset) => {
                  const outlet = activeOutlets.find((item) => item.id === asset.outlet_id);
                  const lastMovement = movements.find((movement) => movement.asset_id === asset.id);
                  const lastInspection = inspections.find((inspection) => inspection.items.some((item) => item.asset_id === asset.id));
                  return (
                    <tr key={asset.id} className="transition hover:bg-primary/5">
                      <td className="px-4 py-3"><button className="text-left font-bold text-text-primary hover:text-primary" type="button" onClick={() => setDetailAsset(asset)}>{asset.name}</button><div className="text-xs text-text-secondary">{asset.description || asset.remark}</div></td>
                      <td className="px-4 py-3 font-semibold text-text-secondary">{asset.category_name}</td>
                      <td className="px-4 py-3 text-text-secondary">{outlet?.name || "—"}</td>
                      <td className="px-4 py-3 font-bold text-text-primary">{asset.current_quantity}</td>
                      <td className="px-4 py-3 text-text-secondary">{asset.unit}</td>
                      <td className="px-4 py-3"><Badge tone={statusTone(asset.status)}>{titleCase(asset.status)}</Badge></td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(lastInspection?.inspection_date)}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(lastMovement?.movement_date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => setDetailAsset(asset)}><Eye size={13} /> View</button>
                          {canManageAsset ? <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => setAdjustAsset(asset)}>Adjust</button> : null}
                          {canEditAsset ? <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => setAssetModal(asset)}>Edit</button> : null}
                          {canDeleteAsset ? <button className="btn-secondary h-8 px-2 text-xs text-amber-700" type="button" onClick={() => archiveAsset(asset)}>Archive</button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filteredAssets.length ? <div className="p-8 text-center text-sm font-semibold text-text-secondary">No assets found for the selected filters.</div> : null}
          </div>
        )}
      </Card>

      {assetModal ? <AssetFormModal asset={assetModal} outlets={activeOutlets} categories={categories} onClose={() => setAssetModal(null)} onSubmit={saveAsset} saving={saving} /> : null}
      {categoryModalOpen ? <CategoryModal categories={categories} onClose={() => setCategoryModalOpen(false)} onSave={saveCategory} onArchive={archiveCategory} saving={saving} canWrite={canAdd} canArchive={canDeleteAsset} /> : null}
      {adjustAsset ? <AdjustQuantityModal asset={adjustAsset} onClose={() => setAdjustAsset(null)} onSubmit={adjustQuantity} saving={saving} /> : null}
      {inspectionOpen ? <InspectionModal outletId={outletId} categories={categories} assets={assets} onClose={() => setInspectionOpen(false)} onSubmit={submitInspection} saving={saving} /> : null}
      {detailAsset ? <AssetDetailDrawer asset={detailAsset} movements={assetMovements} inspections={assetInspections} onClose={() => setDetailAsset(null)} onAdjust={() => setAdjustAsset(detailAsset)} onInspect={() => setInspectionOpen(true)} onEdit={() => setAssetModal(detailAsset)} /> : null}
    </div>
  );
}
