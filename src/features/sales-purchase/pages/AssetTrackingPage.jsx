import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, Download, Eye, MoreHorizontal, PackageCheck, Plus, Search, Settings2, SlidersHorizontal, UploadCloud, Wrench, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { assetTrackingService } from "../../../services/assetTrackingService.js";
import { canCreate, canDelete, canEdit, canExport, canManage, notifyPermissionDenied } from "../../../utils/accessControl.js";

const assetStatuses = ["active", "healthy", "needs_review", "damaged", "missing", "under_maintenance", "low_quantity", "disposed", "inactive"];
const reduceReasons = ["broken", "missing", "disposed", "stolen", "transferred", "correction", "other"];
const conditionStatuses = ["good", "damaged", "missing", "need_repair"];

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatFullDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function formatRelativeDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday - startDate) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 14) return "1 week ago";
  if (diffDays < 31) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatFullDate(value);
}

function statusTone(status) {
  if (status === "active" || status === "healthy") return "success";
  if (status === "needs_review" || status === "under_maintenance" || status === "low_quantity" || status === "damaged") return "warning";
  if (status === "missing" || status === "disposed") return "danger";
  return "neutral";
}

function assetStatusLabel(status) {
  if (status === "active") return "Healthy";
  if (status === "under_maintenance") return "Under Maintenance";
  return titleCase(status);
}

function getQuantityHealth(asset) {
  const quantity = Number(asset.current_quantity || 0);
  const minimum = Number(asset.minimum_quantity || 0);
  if (quantity <= 0) return { label: "Out", tone: "danger", dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-100" };
  if (minimum > 0 && quantity <= minimum * 0.5) return { label: "Critical", tone: "danger", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50", border: "border-red-100" };
  if (minimum > 0 && quantity <= minimum) return { label: "Low", tone: "warning", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-100" };
  return { label: "Healthy", tone: "success", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-100" };
}

function categoryIcon(categoryName) {
  const name = String(categoryName || "").toLowerCase();
  if (name.includes("pos")) return "POS";
  if (name.includes("dining") || name.includes("furniture")) return "FN";
  if (name.includes("electrical")) return "EL";
  if (name.includes("cleaning")) return "CL";
  if (name.includes("utensil")) return "UT";
  if (name.includes("sign")) return "SG";
  if (name.includes("kitchen")) return "KT";
  return "AS";
}

function AssetThumbnail({ asset, size = "md" }) {
  const [failed, setFailed] = useState(false);
  const sizeClass = size === "lg" ? "h-28 w-28 rounded-3xl" : "h-14 w-14 rounded-xl";
  const imageUrl = asset.thumbnail_url || asset.image_url;
  if (imageUrl && !failed) {
    return <img className={`${sizeClass} shrink-0 bg-slate-100 object-cover shadow-sm`} src={imageUrl} alt={asset.name} onError={() => setFailed(true)} />;
  }
  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 text-xs font-black text-primary shadow-sm`}>
      {categoryIcon(asset.category_name)}
    </div>
  );
}

function DateText({ value }) {
  return <span title={formatFullDate(value)}>{formatRelativeDate(value)}</span>;
}

function inspectionProgress(inspection) {
  const summary = inspection?.summary || {};
  if (Number.isFinite(Number(inspection?.completion_percentage)) && Number(inspection.completion_percentage) > 0) return Math.round(Number(inspection.completion_percentage));
  if (Number.isFinite(Number(summary.completion_percentage))) return Math.round(Number(summary.completion_percentage));
  const total = Number(summary.total_assets || summary.totalAssets || 0);
  const checked = Number(summary.checked_assets || summary.checkedAssets || summary.matched_assets || 0);
  return total ? Math.round((checked / total) * 100) : 0;
}

function draftStatusLabel(status) {
  if (status === "in_progress") return "In Progress";
  if (status === "pending_review") return "Pending Review";
  return titleCase(status || "draft");
}

function isDraftInspection(inspection) {
  return ["draft", "in_progress", "pending_review"].includes(inspection.status);
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
    image_url: "",
    remark: "",
  };
}

function AssetFormModal({ asset, outlets, categories, onClose, onSubmit, saving }) {
  const [values, setValues] = useState(() => ({ ...emptyAsset(), ...asset }));
  const [imageError, setImageError] = useState("");
  const isEdit = Boolean(asset?.id);
  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  function handleImageFile(file) {
    setImageError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Please upload an image file.");
      return;
    }
    if (file.size > 750 * 1024) {
      setImageError("Please use an image below 750KB for now.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update("image_url", reader.result || "");
    reader.onerror = () => setImageError("Unable to read image. Please try another file.");
    reader.readAsDataURL(file);
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
      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <div className="rounded-3xl border border-border bg-slate-50 p-4">
          <div className="flex flex-col items-center text-center">
            <AssetThumbnail asset={{ ...values, category_name: categories.find((category) => category.id === values.category_id)?.name }} size="lg" />
            <label className="btn-secondary mt-4 h-9 cursor-pointer px-3 text-xs">
              <UploadCloud size={14} /> Upload Photo
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => handleImageFile(event.target.files?.[0])} />
            </label>
            {values.image_url ? <button className="mt-2 text-xs font-bold text-text-muted hover:text-rose-600" type="button" onClick={() => update("image_url", "")}>Remove image</button> : null}
            {imageError ? <div className="mt-2 text-xs font-semibold text-rose-600">{imageError}</div> : <div className="mt-2 text-xs text-text-muted">Thumbnail appears in the asset list and profile.</div>}
          </div>
        </div>
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
          <SelectField value={values.status} options={assetStatuses.map((status) => ({ value: status, label: assetStatusLabel(status) }))} onChange={(value) => update("status", value)} />
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
      </div>
      {isEdit ? <p className="mt-3 text-xs font-semibold text-text-secondary">Use Adjust Quantity for stock changes so a movement log is created.</p> : null}
    </Modal>
  );
}

function CategoryModal({ categories, conditionTemplates, onClose, onSave, onArchive, onSaveCondition, saving, canWrite, canArchive }) {
  const [draft, setDraft] = useState({ name: "", description: "", sort_order: categories.length + 1, is_active: true });
  const [conditionDraft, setConditionDraft] = useState({ category_id: categories[0]?.id ?? "", name: "", severity: "healthy", color: "emerald", requires_photo: false, requires_remark: false, active: true, sort_order: conditionTemplates.length + 1 });
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
                {category.is_active && canArchive ? <button className="btn-secondary h-8 text-xs" type="button" onClick={() => onArchive(category)}>Deactivate</button> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-border bg-background p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-text-primary">Manage Conditions</div>
              <div className="text-xs text-text-secondary">Category-aware audit conditions used in inspections.</div>
            </div>
            <Badge tone="info">{conditionTemplates.length} conditions</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px_120px_auto] md:items-end">
            <FieldLabel label="Category">
              <SelectField value={conditionDraft.category_id} options={categories.map((category) => ({ value: category.id, label: category.name }))} onChange={(value) => setConditionDraft((current) => ({ ...current, category_id: value }))} searchable />
            </FieldLabel>
            <FieldLabel label="Condition Name">
              <input className="control" value={conditionDraft.name} onChange={(event) => setConditionDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Needs Cleaning" />
            </FieldLabel>
            <FieldLabel label="Severity">
              <SelectField value={conditionDraft.severity} options={["healthy", "low", "medium", "high", "critical"].map((severity) => ({ value: severity, label: titleCase(severity) }))} onChange={(value) => setConditionDraft((current) => ({ ...current, severity: value }))} />
            </FieldLabel>
            <FieldLabel label="Rules">
              <div className="flex h-10 items-center gap-2">
                <label className="flex items-center gap-1 text-xs font-bold text-text-secondary"><input type="checkbox" checked={conditionDraft.requires_photo} onChange={(event) => setConditionDraft((current) => ({ ...current, requires_photo: event.target.checked }))} /> Photo</label>
                <label className="flex items-center gap-1 text-xs font-bold text-text-secondary"><input type="checkbox" checked={conditionDraft.requires_remark} onChange={(event) => setConditionDraft((current) => ({ ...current, requires_remark: event.target.checked }))} /> Remark</label>
              </div>
            </FieldLabel>
            <button className="btn-primary h-10" type="button" disabled={!canWrite || saving || !conditionDraft.category_id || !conditionDraft.name.trim()} onClick={async () => {
              await onSaveCondition(conditionDraft);
              setConditionDraft({ category_id: conditionDraft.category_id, name: "", severity: "healthy", color: "emerald", requires_photo: false, requires_remark: false, active: true, sort_order: conditionTemplates.length + 2 });
            }}>
              {conditionDraft.id ? "Save" : "Add"}
            </button>
          </div>
          <div className="mt-3 max-h-56 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-white">
            {conditionTemplates.map((condition) => {
              const category = categories.find((item) => item.id === condition.category_id);
              return (
                <div key={condition.id} className="grid gap-2 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div>
                    <div className="text-sm font-bold text-text-primary">{condition.name}</div>
                    <div className="text-xs text-text-secondary">{category?.name || "Category"} · {titleCase(condition.severity)} {condition.requires_photo ? "· Photo required" : ""} {condition.requires_remark ? "· Remark required" : ""}</div>
                  </div>
                  <Badge tone={conditionTone(condition)}>{titleCase(condition.severity)}</Badge>
                  {canWrite ? <button className="btn-secondary h-8 text-xs" type="button" onClick={() => setConditionDraft(condition)}>Edit</button> : null}
                </div>
              );
            })}
          </div>
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

function conditionTone(condition) {
  const severity = condition?.severity || "healthy";
  if (severity === "critical") return "danger";
  if (severity === "high" || severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "success";
}

function evidenceNeeded(row, condition) {
  const diff = Number(row.counted_quantity || 0) - Number(row.asset.current_quantity || 0);
  return diff !== 0 || ["medium", "high", "critical"].includes(condition?.severity) || condition?.requires_photo || condition?.requires_remark;
}

function DifferenceBadge({ diff }) {
  if (diff === 0) return <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Matched</span>;
  if (diff > 0) return <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">+{diff} Extra</span>;
  return <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">{Math.abs(diff)} Missing</span>;
}

function readEvidenceFiles(files, onDone) {
  Array.from(files || []).filter((file) => file.type.startsWith("image/")).forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => onDone({ image_url: reader.result || "", caption: file.name });
    reader.readAsDataURL(file);
  });
}

function InspectionModal({ outletId, categories, assets, conditionTemplates, draftInspection, onClose, onSubmit, saving }) {
  const draftData = draftInspection?.draft_data || {};
  const [step, setStep] = useState(draftInspection?.current_step || draftData.currentStep || 1);
  const [inspectionType, setInspectionType] = useState(draftData.inspectionType || draftInspection?.summary?.inspection_type || "routine_audit");
  const [scopeType, setScopeType] = useState(draftData.scopeType || draftInspection?.category_scope?.type || "all");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState(draftData.selectedCategoryIds || draftInspection?.category_scope?.category_ids || []);
  const [checkedBy, setCheckedBy] = useState(draftData.checkedBy || draftInspection?.checked_by || "");
  const [inspectionDate, setInspectionDate] = useState(draftData.inspectionDate || draftInspection?.inspection_date || new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(draftData.notes || draftInspection?.notes || "");
  const [lightbox, setLightbox] = useState(null);
  const scopedAssets = useMemo(() => assets.filter((asset) => asset.outlet_id === outletId && (scopeType === "all" || selectedCategoryIds.includes(asset.category_id))), [assets, outletId, scopeType, selectedCategoryIds]);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const draftRows = new Map((draftData.rows || []).map((row) => [row.asset_id, row]));
    setRows(scopedAssets.map((asset) => {
      const draftRow = draftRows.get(asset.id);
      return ({
      asset,
      counted_quantity: draftRow?.counted_quantity ?? asset.current_quantity,
      condition_template_id: conditionTemplates.find((condition) => condition.category_id === asset.category_id && condition.name.toLowerCase() === "good")?.id || "",
      condition_status: draftRow?.condition_status || "good",
      evidence: draftRow?.evidence || [],
      remark: draftRow?.remark || "",
      ...(draftRow?.condition_template_id ? { condition_template_id: draftRow.condition_template_id } : {}),
    });
    }));
  }, [conditionTemplates, scopedAssets, draftInspection?.id]);

  const enrichedRows = rows.map((row) => {
    const condition = conditionTemplates.find((template) => template.id === row.condition_template_id) ||
      conditionTemplates.find((template) => template.category_id === row.asset.category_id && template.name.toLowerCase() === row.condition_status) ||
      { name: titleCase(row.condition_status || "Good"), severity: row.condition_status === "missing" ? "critical" : row.condition_status === "good" ? "healthy" : "medium" };
    const diff = Number(row.counted_quantity || 0) - Number(row.asset.current_quantity || 0);
    const needsEvidence = evidenceNeeded(row, condition);
    const evidenceComplete = !needsEvidence || ((row.evidence || []).length > 0 && (!condition.requires_remark || row.remark.trim()));
    return { ...row, condition, diff, needsEvidence, evidenceComplete };
  });
  const varianceRows = enrichedRows.filter((row) => row.diff !== 0);
  const missingRows = enrichedRows.filter((row) => row.diff < 0 || row.condition?.severity === "critical" || row.condition?.name?.toLowerCase() === "missing");
  const extraRows = enrichedRows.filter((row) => row.diff > 0);
  const damagedRows = enrichedRows.filter((row) => ["medium", "high", "critical"].includes(row.condition?.severity) && row.condition?.name?.toLowerCase() !== "missing");
  const pendingEvidenceRows = enrichedRows.filter((row) => row.needsEvidence && !row.evidenceComplete);
  const matchedRows = enrichedRows.filter((row) => row.diff === 0 && row.condition?.severity === "healthy");
  const criticalRows = enrichedRows.filter((row) => row.condition?.severity === "critical" || row.diff < 0);
  const issueRows = enrichedRows.filter((row) => row.diff !== 0 || row.condition?.severity !== "healthy" || !row.evidenceComplete);
  const checkedRows = enrichedRows.filter((row) => row.counted_quantity !== "" && row.counted_quantity !== null && row.counted_quantity !== undefined);
  const categoryScope = scopeType === "all"
    ? { type: "all", category_ids: [] }
    : { type: "selected", category_ids: selectedCategoryIds };
  const summary = {
    total_assets: rows.length,
    checked_assets: checkedRows.length,
    completion_percentage: rows.length ? Math.round((checkedRows.length / rows.length) * 100) : 0,
    matched_assets: matchedRows.length,
    missing_assets: missingRows.length,
    extra_assets: extraRows.length,
    damaged_assets: damagedRows.length,
    critical_alerts: criticalRows.length,
    pending_evidence: pendingEvidenceRows.length,
    inspection_type: inspectionType,
  };

  function updateRow(assetId, key, value) {
    setRows((current) => current.map((row) => (row.asset.id === assetId ? { ...row, [key]: value } : row)));
  }

  function selectCondition(assetId, conditionId) {
    const condition = conditionTemplates.find((item) => item.id === conditionId);
    setRows((current) => current.map((row) => (row.asset.id === assetId ? {
      ...row,
      condition_template_id: conditionId,
      condition_status: condition?.name?.toLowerCase().replace(/\s+/g, "_") || "good",
    } : row)));
  }

  function addEvidence(assetId, evidence) {
    setRows((current) => current.map((row) => (row.asset.id === assetId ? { ...row, evidence: [...(row.evidence || []), evidence] } : row)));
  }

  function removeEvidence(assetId, index) {
    setRows((current) => current.map((row) => (row.asset.id === assetId ? { ...row, evidence: (row.evidence || []).filter((_, itemIndex) => itemIndex !== index) } : row)));
  }

  function submit(status = "completed") {
    const draftRows = enrichedRows.map((row) => ({
      asset_id: row.asset.id,
      counted_quantity: row.counted_quantity,
      condition_template_id: row.condition_template_id,
      condition_status: row.condition_status,
      evidence: row.evidence || [],
      remark: row.remark || "",
    }));
    onSubmit({
      draftId: draftInspection?.id || "",
      outletId,
      inspectionDate,
      checkedBy,
      categoryScope,
      notes,
      remark: notes,
      summary,
      status,
      currentStep: step,
      draftData: {
        currentStep: step,
        inspectionType,
        scopeType,
        selectedCategoryIds,
        checkedBy,
        inspectionDate,
        notes,
        rows: draftRows,
        savedAt: new Date().toISOString(),
      },
      rows: enrichedRows.map((row) => ({ ...row, evidence_required: row.needsEvidence })),
    });
  }

  const stepLabels = ["Setup", "Checklist", "Review", "Submit"];

  return (
    <Modal
      title="Asset Inspection Audit"
      description={draftInspection ? "Resume saved operational audit workflow." : "Structured outlet asset verification with condition, evidence, and discrepancy tracking."}
      onClose={onClose}
      size="2xl"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "Cancel" : "Back"}</button>
          {step > 1 ? <button className="btn-secondary" type="button" disabled={saving || !rows.length} onClick={() => submit("draft")}>Save Draft</button> : null}
          {step < 3 ? (
            <button className="btn-primary" type="button" disabled={scopeType === "selected" && selectedCategoryIds.length === 0} onClick={() => setStep((current) => current + 1)}>{step === 2 ? "Review Summary" : "Continue Checklist"}</button>
          ) : step === 3 ? (
            <button className="btn-primary" type="button" disabled={saving || !rows.length} onClick={() => setStep(4)}>Proceed to Submit</button>
          ) : (
            <button className="btn-primary" type="button" disabled={saving || !rows.length || pendingEvidenceRows.length > 0} onClick={() => submit("completed")}>Submit Inspection</button>
          )}
        </>
      )}
    >
      <div className="mb-5 grid grid-cols-4 gap-2">
        {stepLabels.map((label, index) => {
          const active = step >= index + 1;
          return (
            <div key={label} className={`rounded-2xl border px-3 py-2 ${active ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-slate-50 text-text-muted"}`}>
              <div className="text-[10px] font-black uppercase tracking-wide">Step {index + 1}</div>
              <div className="text-xs font-black">{label}</div>
            </div>
          );
        })}
      </div>

      {step === 1 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <FieldLabel label="Inspection Type">
            <SelectField value={inspectionType} options={[
              { value: "routine_audit", label: "Routine Audit" },
              { value: "opening_check", label: "Opening Check" },
              { value: "closing_check", label: "Closing Check" },
              { value: "maintenance_review", label: "Maintenance Review" },
              { value: "incident_follow_up", label: "Incident Follow-up" },
            ]} onChange={setInspectionType} />
          </FieldLabel>
          <FieldLabel label="Inspection Date"><input className="control" type="date" value={inspectionDate} onChange={(event) => setInspectionDate(event.target.value)} /></FieldLabel>
          <FieldLabel label="Checked By"><input className="control" value={checkedBy} onChange={(event) => setCheckedBy(event.target.value)} placeholder="Manager name" /></FieldLabel>
          <FieldLabel label="Category Scope">
            <SelectField value={scopeType} options={[{ value: "all", label: "All Categories" }, { value: "selected", label: "Selected Categories" }]} onChange={setScopeType} />
          </FieldLabel>
          <FieldLabel label="Inspection Notes"><input className="control" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional audit notes" /></FieldLabel>
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
        <div className="space-y-3">
          {enrichedRows.map((row, index) => {
                const categoryConditions = conditionTemplates.filter((condition) => condition.category_id === row.asset.category_id && condition.active);
                const border = row.condition?.severity === "critical" || row.diff < 0
                  ? "border-l-4 border-l-rose-500 bg-rose-50/40"
                  : row.condition?.severity !== "healthy" || row.diff !== 0
                    ? "border-l-4 border-l-amber-500 bg-amber-50/30"
                    : "bg-white";
                return (
                  <div key={row.asset.id} className={`rounded-3xl border border-border p-4 shadow-sm ${border}`}>
                    <div className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr_1fr]">
                      <div className="flex gap-3">
                        <button type="button" onClick={() => setLightbox({ images: [row.asset.thumbnail_url || row.asset.image_url].filter(Boolean), index: 0 })}>
                          <AssetThumbnail asset={row.asset} />
                        </button>
                        <div className="min-w-0">
                          <div className="font-black text-text-primary">{row.asset.name}</div>
                          <div className="mt-0.5 text-xs text-text-secondary">{row.asset.description || "No description"}</div>
                          <div className="mt-2"><Badge tone="info">{row.asset.category_name}</Badge></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-2xl bg-slate-50 p-3"><div className="text-[10px] font-black uppercase text-text-muted">Expected</div><div className="text-lg font-black">{row.asset.current_quantity}</div></div>
                        <FieldLabel label="Current Qty"><input className="control h-11" type="number" min="0" value={row.counted_quantity} onChange={(event) => updateRow(row.asset.id, "counted_quantity", event.target.value)} /></FieldLabel>
                        <div className="flex items-end pb-1"><DifferenceBadge diff={row.diff} /></div>
                      </div>
                      <div className="space-y-2">
                        <FieldLabel label="Condition">
                          <SelectField value={row.condition_template_id} options={categoryConditions.map((condition) => ({ value: condition.id, label: `${condition.name} · ${titleCase(condition.severity)}` }))} onChange={(value) => selectCondition(row.asset.id, value)} />
                        </FieldLabel>
                        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                          <input className="control h-10" value={row.remark} onChange={(event) => updateRow(row.asset.id, "remark", event.target.value)} placeholder={row.needsEvidence ? "Discrepancy explanation" : "Inspection note"} />
                          <label className="btn-secondary h-10 cursor-pointer px-3 text-xs">
                            Upload Evidence
                            <input className="sr-only" type="file" accept="image/*" multiple capture="environment" onChange={(event) => readEvidenceFiles(event.target.files, (evidence) => addEvidence(row.asset.id, evidence))} />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(row.evidence || []).map((evidence, evidenceIndex) => (
                            <button key={`${evidence.image_url}-${evidenceIndex}`} className="group relative" type="button" onClick={() => setLightbox({ images: row.evidence.map((item) => item.image_url), index: evidenceIndex })}>
                              <img className="h-12 w-12 rounded-xl border border-border object-cover" src={evidence.image_url} alt={evidence.caption || "Evidence"} />
                              <span className="absolute -right-1 -top-1 hidden rounded-full bg-rose-600 px-1 text-[10px] font-black text-white group-hover:block" onClick={(event) => { event.stopPropagation(); removeEvidence(row.asset.id, evidenceIndex); }}>×</span>
                            </button>
                          ))}
                          {row.needsEvidence ? <Badge tone={row.evidenceComplete ? "success" : "warning"}>{row.evidenceComplete ? "Evidence Complete" : "Evidence Required"}</Badge> : null}
                          <Badge tone={conditionTone(row.condition)}>{row.condition?.name || "Good"}</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          {!rows.length ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">No assets found for this inspection scope.</div> : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[["Assets Inspected", rows.length], ["Matched Assets", matchedRows.length], ["Missing Assets", missingRows.length], ["Extra Assets", extraRows.length], ["Damaged Assets", damagedRows.length], ["Critical Alerts", criticalRows.length], ["Pending Evidence", pendingEvidenceRows.length]].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-background p-4">
                <div className="text-xs font-black uppercase tracking-wide text-text-muted">{label}</div>
                <div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-text-muted">Problem Rows</div>
            <div className="divide-y divide-border">
              {issueRows.map((row) => (
                <div key={row.asset.id} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_150px_130px_1fr]">
                  <div className="font-bold text-text-primary">{row.asset.name}</div>
                  <DifferenceBadge diff={row.diff} />
                  <Badge tone={conditionTone(row.condition)}>{row.condition?.name}</Badge>
                  <div className={row.evidenceComplete ? "text-text-secondary" : "font-bold text-amber-700"}>{row.evidenceComplete ? row.remark || "Evidence complete" : "Evidence or remark pending"}</div>
                </div>
              ))}
              {!issueRows.length ? <div className="p-5 text-center text-sm font-semibold text-text-secondary">No discrepancies or condition issues found.</div> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            Quantity differences will create correction movement logs and update asset quantities after submission.
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-4">
          <div className="rounded-3xl border border-primary/20 bg-primary/5 p-5">
            <div className="text-xs font-black uppercase tracking-wide text-primary">Ready to Submit</div>
            <div className="mt-2 text-lg font-black text-text-primary">{rows.length} assets checked · {criticalRows.length} critical alerts · {pendingEvidenceRows.length} pending evidence</div>
            <p className="mt-2 text-sm text-text-secondary">Submitting completes the operational audit and records quantity corrections, conditions, notes, and evidence.</p>
          </div>
          {pendingEvidenceRows.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">Complete required evidence before submitting. You can save this inspection as a draft.</div>
          ) : null}
        </div>
      ) : null}

      {lightbox?.images?.length ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
          <button className="absolute inset-0" type="button" aria-label="Close image preview" onClick={() => setLightbox(null)} />
          <div className="relative max-h-[90vh] max-w-[92vw]">
            <img className="max-h-[86vh] rounded-3xl object-contain shadow-2xl" src={lightbox.images[lightbox.index]} alt="Inspection evidence preview" />
            <button className="absolute -right-3 -top-3 rounded-full bg-white p-2 text-slate-700 shadow-xl" type="button" onClick={() => setLightbox(null)}><X size={18} /></button>
            {lightbox.images.length > 1 ? (
              <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
                <button className="btn-secondary h-8 bg-white px-3 text-xs" type="button" onClick={() => setLightbox((current) => ({ ...current, index: Math.max(0, current.index - 1) }))}>Previous</button>
                <button className="btn-secondary h-8 bg-white px-3 text-xs" type="button" onClick={() => setLightbox((current) => ({ ...current, index: Math.min(current.images.length - 1, current.index + 1) }))}>Next</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function AssetDetailDrawer({ asset, movements, inspections, onClose, onAdjust, onInspect, onEdit, onResumeDraft, onDeleteDraft, onArchiveDraft }) {
  const [tab, setTab] = useState("overview");
  const quantityHealth = getQuantityHealth(asset);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button className="flex-1 cursor-default" type="button" aria-label="Close asset detail" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[620px] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border bg-gradient-to-br from-white to-emerald-50/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-4">
              <AssetThumbnail asset={asset} size="lg" />
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Asset Profile</div>
                <h2 className="mt-1 truncate text-2xl font-semibold text-text-primary">{asset.name}</h2>
                <p className="mt-1 text-sm text-text-secondary">{asset.category_name} · {asset.description || "No description"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={statusTone(asset.status)}>{assetStatusLabel(asset.status)}</Badge>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${quantityHealth.border} ${quantityHealth.bg} ${quantityHealth.text}`}>
                    <span className={`h-2 w-2 rounded-full ${quantityHealth.dot}`} /> {quantityHealth.label}
                  </span>
                </div>
              </div>
            </div>
            <button className="icon-btn" type="button" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="mt-4 flex gap-2">
            {["overview", "movement", "inspection", "maintenance"].map((item) => <button key={item} className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === item ? "bg-primary text-white" : "bg-background text-text-secondary"}`} type="button" onClick={() => setTab(item)}>{item === "movement" ? "Movement Log" : item === "inspection" ? "Inspection History" : item === "maintenance" ? "Maintenance History" : "Overview"}</button>)}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {[["Current Quantity", `${asset.current_quantity} ${asset.unit}`], ["Minimum Quantity", `${asset.minimum_quantity} ${asset.unit}`], ["Status", assetStatusLabel(asset.status)], ["Last Checked", formatRelativeDate(inspections[0]?.inspection_date || asset.last_inspection_at)], ["Last Movement", formatRelativeDate(movements[0]?.movement_date)], ["Outlet Asset", asset.outlet_id ? "Outlet-specific" : "—"]].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-border bg-background p-4"><div className="text-xs font-black uppercase tracking-wide text-text-muted">{label}</div><div className="mt-1 text-sm font-bold text-text-primary">{value}</div></div>
                ))}
              </div>
              {asset.remark ? <div className="rounded-2xl border border-border bg-background p-4 text-sm text-text-secondary"><span className="font-bold text-text-primary">Remark: </span>{asset.remark}</div> : null}
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" type="button" onClick={onAdjust}>Adjust Quantity</button>
                <button className="btn-secondary" type="button" onClick={onInspect}>Start Inspection</button>
                <button className="btn-secondary" type="button" onClick={onEdit}>Edit Asset</button>
              </div>
            </div>
          ) : null}
          {tab === "movement" ? <Timeline rows={movements} empty="No movement logs yet." /> : null}
          {tab === "inspection" ? <InspectionHistory inspections={inspections} onResumeDraft={onResumeDraft} onDeleteDraft={onDeleteDraft} onArchiveDraft={onArchiveDraft} /> : null}
          {tab === "maintenance" ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">No maintenance history yet.</div> : null}
        </div>
      </aside>
    </div>
  );
}

function Timeline({ rows, empty }) {
  return rows.length ? <div className="space-y-2">{rows.map((row) => (
    <div key={row.id} className="rounded-2xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3"><div className="text-sm font-bold text-text-primary">{titleCase(row.movement_type)}</div><div className="text-xs font-semibold text-text-muted"><DateText value={row.movement_date} /></div></div>
      <div className="mt-1 text-xs font-semibold text-text-secondary">{row.quantity_before} → {row.quantity_after} ({row.quantity_change > 0 ? "+" : ""}{row.quantity_change}) · {titleCase(row.reason)}</div>
      {row.remark ? <div className="mt-2 text-xs text-text-secondary">{row.remark}</div> : null}
    </div>
  ))}</div> : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">{empty}</div>;
}

function InspectionHistory({ inspections, onResumeDraft, onDeleteDraft, onArchiveDraft }) {
  return inspections.length ? <div className="space-y-3">{inspections.map((inspection) => (
    <div key={inspection.id} className={`rounded-2xl border p-3 ${isDraftInspection(inspection) ? "border-amber-200 bg-amber-50/50" : "border-border bg-background"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button className="min-w-0 text-left" type="button" onClick={() => isDraftInspection(inspection) && onResumeDraft?.(inspection)}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold text-text-primary"><DateText value={inspection.inspection_date} /></div>
            <Badge tone={isDraftInspection(inspection) ? "warning" : "info"}>{draftStatusLabel(inspection.status)}</Badge>
          </div>
          <div className="mt-2 text-xs font-semibold text-text-secondary">{inspection.summary?.total_assets || inspection.items.length} assets · {inspection.summary?.critical_alerts || 0} critical · saved <DateText value={inspection.last_edited_at || inspection.updated_at} /></div>
          {isDraftInspection(inspection) ? (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-primary" style={{ width: `${inspectionProgress(inspection)}%` }} />
              </div>
              <div className="mt-1 text-xs font-bold text-text-muted">{inspectionProgress(inspection)}% completed</div>
            </div>
          ) : null}
        </button>
        {isDraftInspection(inspection) ? (
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-primary h-8 px-2 text-xs" type="button" onClick={() => onResumeDraft?.(inspection)}>Resume</button>
            <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => onArchiveDraft?.(inspection)}>Archive</button>
            <button className="btn-secondary h-8 px-2 text-xs text-rose-700" type="button" onClick={() => onDeleteDraft?.(inspection)}>Delete</button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 space-y-1">
        {!isDraftInspection(inspection) ? inspection.items.map((item) => <div key={item.id} className="text-xs font-semibold text-text-secondary">{item.asset?.name || "Asset"} · Expected {item.expected_quantity}, Counted {item.counted_quantity}, Difference {item.difference} · {titleCase(item.condition_status)}</div>) : null}
      </div>
    </div>
  ))}</div> : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">No inspection history yet.</div>;
}

export default function AssetTrackingPage({ store, ui, auth }) {
  const activeOutlets = useMemo(() => store.outlets.filter((outlet) => outlet.status === "active" || outlet.is_active), [store.outlets]);
  const [outletId, setOutletId] = useState(activeOutlets[0]?.id ?? "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState([]);
  const [conditionTemplates, setConditionTemplates] = useState([]);
  const [assets, setAssets] = useState([]);
  const [movements, setMovements] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [assetModal, setAssetModal] = useState(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [adjustAsset, setAdjustAsset] = useState(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [detailAsset, setDetailAsset] = useState(null);
  const [actionAssetId, setActionAssetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canAdd = canCreate(auth, "asset_tracking");
  const canEditAsset = canEdit(auth, "asset_tracking");
  const canDeleteAsset = canDelete(auth, "asset_tracking");
  const canManageAsset = canManage(auth, "asset_tracking");
  const canExportAsset = canExport(auth, "asset_tracking");

  useEffect(() => {
    if (!activeOutlets.length) {
      setOutletId("");
      setAssets([]);
      setMovements([]);
      setInspections([]);
      setLoading(false);
      return;
    }
    if (!activeOutlets.some((outlet) => outlet.id === outletId)) {
      setOutletId(activeOutlets[0].id);
    }
  }, [activeOutlets, outletId]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [categoryRows, assetRows, movementRows, inspectionRows, conditionRows] = await Promise.all([
        assetTrackingService.listCategories(),
        assetTrackingService.listAssets(outletId),
        assetTrackingService.listMovementLogs("", outletId),
        assetTrackingService.listInspections("", outletId),
        assetTrackingService.listConditionTemplates(),
      ]);
      setCategories(categoryRows);
      setConditionTemplates(conditionRows);
      setAssets(assetRows);
      setMovements(movementRows);
      setInspections(inspectionRows);
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
    const lastChecked = inspections[0]?.inspection_date || filteredAssets.find((asset) => asset.last_inspection_at)?.last_inspection_at;
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

  async function saveConditionTemplate(condition) {
    if (!canEditAsset && !canAdd) {
      notifyPermissionDenied(ui, "manage asset conditions");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.saveConditionTemplate(condition);
      await loadData();
      ui.notify({ title: "Condition saved", message: condition.name });
    } catch (saveError) {
      console.error("Unable to save condition", saveError);
      ui.notify({ title: "Unable to save condition", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
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
      ui.notify({ title: payload.status === "draft" ? "Inspection draft saved" : "Inspection submitted" });
    } catch (inspectionError) {
      console.error("Unable to submit inspection", inspectionError);
      ui.notify({ title: "Unable to submit inspection", message: inspectionError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function updateInspectionStatus(inspection, status) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "manage inspection drafts");
      return;
    }
    try {
      await assetTrackingService.updateInspectionStatus(inspection.id, status);
      await loadData();
      ui.notify({ title: status === "archived" ? "Draft archived" : "Inspection updated" });
    } catch (statusError) {
      console.error("Unable to update inspection", statusError);
      ui.notify({ title: "Unable to update inspection", message: statusError.message || "Please try again.", tone: "error" });
    }
  }

  async function deleteInspection(inspection) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "delete inspection drafts");
      return;
    }
    try {
      await assetTrackingService.deleteInspection(inspection.id);
      await loadData();
      ui.notify({ title: "Draft deleted" });
    } catch (deleteError) {
      console.error("Unable to delete inspection", deleteError);
      ui.notify({ title: "Unable to delete draft", message: deleteError.message || "Please try again.", tone: "error" });
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
  const assetInspections = detailAsset ? inspections.filter((inspection) => (
    inspection.items.some((item) => item.asset_id === detailAsset.id) ||
    (isDraftInspection(inspection) && (inspection.draft_data?.rows || []).some((row) => row.asset_id === detailAsset.id))
  )) : [];
  const draftInspections = inspections.filter(isDraftInspection);

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
          <FieldLabel label="Category"><SelectField value={categoryFilter} options={[{ value: "all", label: "All Categories" }, ...categories.filter((category) => category.is_active).map((category) => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} searchable /></FieldLabel>
          <FieldLabel label="Status"><SelectField value={statusFilter} options={[{ value: "all", label: "All Status" }, ...assetStatuses.map((status) => ({ value: status, label: assetStatusLabel(status) }))]} onChange={setStatusFilter} /></FieldLabel>
          <FieldLabel label="Search Asset"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} /><input className="control h-10 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset name..." /></div></FieldLabel>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}

      {draftInspections.length ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Draft Inspections</div>
              <div className="mt-1 text-lg font-black text-text-primary">{draftInspections.length} pending {draftInspections.length === 1 ? "inspection" : "inspections"} require completion.</div>
            </div>
            <div className="grid flex-1 gap-3 lg:max-w-3xl">
              {draftInspections.slice(0, 3).map((inspection) => {
                const outlet = activeOutlets.find((item) => item.id === inspection.outlet_id);
                const progress = inspectionProgress(inspection);
                const scope = inspection.category_scope?.type === "selected"
                  ? `${inspection.category_scope.category_ids?.length || 0} selected categories`
                  : "All Categories";
                return (
                  <div key={inspection.id} className="rounded-2xl border border-amber-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-black text-text-primary">{outlet?.name || "Outlet"}</span>
                          <Badge tone="warning">{draftStatusLabel(inspection.status)}</Badge>
                        </div>
                        <div className="mt-1 text-xs font-semibold text-text-secondary">{scope} · Saved <DateText value={inspection.last_edited_at || inspection.updated_at} /></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="mt-1 text-xs font-bold text-text-muted">{progress}% completed · {inspection.summary?.critical_alerts || 0} critical · {inspection.summary?.pending_evidence || 0} evidence pending</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-primary h-9 px-3 text-xs" type="button" onClick={() => setInspectionOpen(inspection)}>Resume Inspection</button>
                        <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setInspectionOpen({ ...inspection, id: "", status: "draft" })}>Duplicate</button>
                        <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => updateInspectionStatus(inspection, "archived")}>Archive</button>
                        <button className="btn-secondary h-9 px-3 text-xs text-rose-700" type="button" onClick={() => deleteInspection(inspection)}>Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : null}

      {!activeOutlets.length ? (
        <Card className="p-8 text-center">
          <div className="text-sm font-bold uppercase tracking-[0.16em] text-text-muted">No Outlet Access</div>
          <div className="mt-2 text-lg font-semibold text-text-primary">No outlets are assigned to your role.</div>
          <p className="mt-2 text-sm text-text-secondary">Please contact admin to review your outlet access.</p>
        </Card>
      ) : null}

      {activeOutlets.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total Asset Items", summary.totalItems],
          ["Total Quantity", summary.totalQuantity],
          ["Categories", summary.categories],
          ["Items Needing Review", summary.review],
          ["Last Checked Date", formatRelativeDate(summary.lastChecked)],
        ].map(([label, value]) => <Card key={label} className="p-4"><div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{label}</div><div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div></Card>)}
      </div> : null}

      {activeOutlets.length ? <Card title="Asset List" description="Outlet-specific asset quantities and movement status.">
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
                  const quantityHealth = getQuantityHealth(asset);
                  return (
                    <tr key={asset.id} className="transition hover:bg-primary/5">
                      <td className="px-4 py-3">
                        <button className="flex max-w-[330px] items-center gap-3 text-left" type="button" onClick={() => setDetailAsset(asset)}>
                          <AssetThumbnail asset={asset} />
                          <span className="min-w-0">
                            <span className="block truncate font-black text-text-primary transition hover:text-primary">{asset.name}</span>
                            <span className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{asset.description || asset.remark || "No description"}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-semibold text-text-secondary">{asset.category_name}</td>
                      <td className="px-4 py-3 text-text-secondary">{outlet?.name || "—"}</td>
                      <td className="px-4 py-3">
                        <div className={`inline-flex min-w-[112px] items-center justify-between gap-3 rounded-2xl border px-3 py-2 ${quantityHealth.border} ${quantityHealth.bg}`}>
                          <span className="text-lg font-black text-text-primary">{asset.current_quantity}</span>
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-black ${quantityHealth.text}`}>
                            <span className={`h-2 w-2 rounded-full ${quantityHealth.dot}`} /> {quantityHealth.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{asset.unit}</td>
                      <td className="px-4 py-3"><Badge tone={statusTone(asset.status)}>{assetStatusLabel(asset.status)}</Badge></td>
                      <td className="px-4 py-3 text-text-secondary"><DateText value={lastInspection?.inspection_date || asset.last_inspection_at} /></td>
                      <td className="px-4 py-3 text-text-secondary"><DateText value={lastMovement?.movement_date} /></td>
                      <td className="relative px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => setDetailAsset(asset)}><Eye size={13} /> View</button>
                          <button className="icon-btn h-8 w-8" type="button" onClick={() => setActionAssetId((current) => current === asset.id ? "" : asset.id)} aria-label={`More actions for ${asset.name}`}>
                            <MoreHorizontal size={15} />
                          </button>
                        </div>
                        {actionAssetId === asset.id ? (
                          <div className="absolute right-4 top-12 z-30 w-44 overflow-hidden rounded-2xl border border-border bg-white p-1.5 shadow-xl">
                            {canManageAsset ? <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-text-secondary hover:bg-primary/5 hover:text-primary" type="button" onClick={() => { setActionAssetId(""); setAdjustAsset(asset); }}><Wrench size={14} /> Adjust Quantity</button> : null}
                            {canManageAsset ? <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-text-secondary hover:bg-primary/5 hover:text-primary" type="button" onClick={() => { setActionAssetId(""); setInspectionOpen(true); }}><ClipboardCheck size={14} /> Start Inspection</button> : null}
                            {canEditAsset ? <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-text-secondary hover:bg-primary/5 hover:text-primary" type="button" onClick={() => { setActionAssetId(""); setAssetModal(asset); }}><PackageCheck size={14} /> Edit Asset</button> : null}
                            {canDeleteAsset ? <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-amber-700 hover:bg-amber-50" type="button" onClick={() => { setActionAssetId(""); archiveAsset(asset); }}><AlertTriangle size={14} /> Archive</button> : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filteredAssets.length ? <div className="p-8 text-center text-sm font-semibold text-text-secondary">No assets found for the selected filters.</div> : null}
          </div>
        )}
      </Card> : null}

      {assetModal ? <AssetFormModal asset={assetModal} outlets={activeOutlets} categories={categories} onClose={() => setAssetModal(null)} onSubmit={saveAsset} saving={saving} /> : null}
      {categoryModalOpen ? <CategoryModal categories={categories} conditionTemplates={conditionTemplates} onClose={() => setCategoryModalOpen(false)} onSave={saveCategory} onArchive={archiveCategory} onSaveCondition={saveConditionTemplate} saving={saving} canWrite={canAdd || canEditAsset} canArchive={canDeleteAsset} /> : null}
      {adjustAsset ? <AdjustQuantityModal asset={adjustAsset} onClose={() => setAdjustAsset(null)} onSubmit={adjustQuantity} saving={saving} /> : null}
      {inspectionOpen ? <InspectionModal outletId={inspectionOpen?.outlet_id || outletId} categories={categories} assets={assets} conditionTemplates={conditionTemplates} draftInspection={inspectionOpen === true ? null : inspectionOpen} onClose={() => setInspectionOpen(false)} onSubmit={submitInspection} saving={saving} /> : null}
      {detailAsset ? <AssetDetailDrawer asset={detailAsset} movements={assetMovements} inspections={assetInspections} onClose={() => setDetailAsset(null)} onAdjust={() => setAdjustAsset(detailAsset)} onInspect={() => setInspectionOpen(true)} onEdit={() => setAssetModal(detailAsset)} onResumeDraft={(inspection) => setInspectionOpen(inspection)} onDeleteDraft={deleteInspection} onArchiveDraft={(inspection) => updateInspectionStatus(inspection, "archived")} /> : null}
    </div>
  );
}
