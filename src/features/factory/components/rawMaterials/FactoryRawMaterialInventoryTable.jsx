import { ArrowDown, ArrowUp, ArrowUpDown, Check, Package, Pencil, X } from "lucide-react";
import { useState } from "react";
import Badge from "../../../../components/ui/Badge.jsx";
import { FactoryTable } from "../FactoryDataDisplay.jsx";

function rawMaterialStatusTone(stockStatus) {
  if (stockStatus === "Out of Stock") return "danger";
  if (stockStatus === "Low Stock") return "warning";
  return "success";
}
function coverage(row) { const par = Number(row.par_level); if (!(par > 0)) return null; const percent = (Number(row.current_balance || 0) / par) * 100; return { percent, label: percent >= 100 ? "Healthy" : percent >= 50 ? "Low" : "Critical", tone: percent >= 100 ? "bg-emerald-500" : percent >= 50 ? "bg-amber-500" : "bg-rose-500" }; }

export default function FactoryRawMaterialInventoryTable({ rows, canEdit, categorySort = "", onCategorySort, materialLabel, formatQuantity, formatDate, formatCost, normalizedCostUnit, onPreviewImage, onOpenCost, onOpenDetail, onEdit, onSaveParLevel }) {
  const [editingId, setEditingId] = useState(null); const [draft, setDraft] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const startParEdit = (row) => { if (!canEdit || !onSaveParLevel) return; setEditingId(row.id); setDraft(row.par_level == null ? "" : String(row.par_level)); setError(""); };
  const cancelParEdit = () => { if (saving) return; setEditingId(null); setDraft(""); setError(""); };
  const saveParEdit = async (row) => { const value = String(draft).trim(); if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) { setError("Par Level must be zero or greater."); return; } setSaving(true); setError(""); try { await onSaveParLevel(row, value === "" ? null : Number(value)); setEditingId(null); setDraft(""); } catch (saveError) { setError(saveError?.message || "Unable to save Par Level."); } finally { setSaving(false); } };
  const columns = [
    { key: "name", label: "Raw Material", render: (row) => {
      const secondaryNames = [row.name_cn, row.name_bm].filter(Boolean).join(" · ");
      return (
        <div className="flex items-center gap-3">
          {row.image_url ? (
            <button className="shrink-0" type="button" onClick={() => onPreviewImage(row)}>
              <img className="h-10 w-10 rounded-lg object-cover ring-1 ring-border transition hover:ring-primary" src={row.image_url} alt={materialLabel(row)} />
            </button>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-text-secondary"><Package size={18} /></div>
          )}
          <div className="min-w-0">
            <div className="font-bold text-text-primary">{materialLabel(row)}</div>
            {secondaryNames ? <div className="text-xs text-text-secondary">{secondaryNames}</div> : null}
          </div>
        </div>
      );
    } },
    { key: "material_code", label: "Code", render: (row) => row.material_code || "—" },
    { key: "category", label: <button className="inline-flex items-center gap-1.5 transition hover:text-text-primary focus:outline-none focus:text-text-primary" type="button" onClick={onCategorySort} aria-label={`Sort Category ${categorySort === "asc" ? "descending" : categorySort === "desc" ? "default" : "ascending"}`}><span>Category</span>{categorySort === "asc" ? <ArrowUp size={13} /> : categorySort === "desc" ? <ArrowDown size={13} /> : <ArrowUpDown className="text-text-secondary" size={13} />}</button>, render: (row) => row.category || "No category" },
    { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
    { key: "current_balance", label: "Current Balance", render: (row) => formatQuantity(row.current_balance, row.uom) },
    { key: "par_level", label: "Par Level", render: (row) => editingId === row.id ? <div className="min-w-[180px]"><div className="flex items-center gap-1"><input aria-label={`Par Level for ${materialLabel(row)}`} className="w-20 rounded border border-border px-2 py-1 text-sm" type="number" min="0" step="0.0001" autoFocus value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveParEdit(row); } if (event.key === "Escape") { event.preventDefault(); cancelParEdit(); } }} /><span className="text-xs font-semibold text-text-secondary">{row.uom || "—"}</span><button aria-label={`Save Par Level for ${materialLabel(row)}`} className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50" type="button" disabled={saving} onClick={() => saveParEdit(row)}><Check size={15} /></button><button aria-label={`Cancel Par Level edit for ${materialLabel(row)}`} className="rounded p-1 text-text-secondary hover:bg-slate-100 disabled:opacity-50" type="button" disabled={saving} onClick={cancelParEdit}><X size={15} /></button></div>{error ? <div role="alert" className="mt-1 max-w-[180px] text-xs font-semibold text-rose-700">{error}</div> : null}</div> : canEdit && onSaveParLevel ? <button aria-label={`Edit Par Level for ${materialLabel(row)}`} className="group inline-flex items-center gap-1 text-left font-semibold text-text-primary hover:text-primary" type="button" onClick={() => startParEdit(row)}>{Number(row.par_level) > 0 ? formatQuantity(row.par_level, row.uom) : "Not Set"}<Pencil className="opacity-0 transition group-hover:opacity-100" size={12} /></button> : Number(row.par_level) > 0 ? formatQuantity(row.par_level, row.uom) : "Not Set" },
    { key: "coverage", label: "Coverage", render: (row) => { const value = coverage(row); return !value ? "Not Set" : <div className="min-w-[100px]"><div className="flex justify-between text-xs font-semibold"><span>{value.label}</span><span>{value.percent.toFixed(0)}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${value.tone}`} style={{ width: `${Math.min(value.percent, 100)}%` }} /></div></div>; } },
    { key: "latest_cost", label: "Latest Cost", render: (row) => (
      <button className="font-semibold text-primary underline-offset-2 hover:underline" type="button" onClick={() => onOpenCost(row)}>
        {row.latest_cost_missing ? "Missing Cost" : row.latest_cost_uom ? `${formatCost(row.latest_cost)}/${normalizedCostUnit(row.latest_cost_uom)?.display || row.latest_cost_uom}` : "Unsupported UOM"}
      </button>
    ) },
    { key: "last_receiving_date", label: "Last Receiving", render: (row) => formatDate(row.last_receiving_date) },
    { key: "last_consumption_date", label: "Last Consumption", render: (row) => formatDate(row.last_consumption_date) },
    { key: "status", label: "Status", render: (row) => <Badge tone={rawMaterialStatusTone(row.stock_status)}>{row.stock_status}</Badge> },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onOpenDetail(row)}>Detail</button>
        {canEdit ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onEdit(row)}>Edit</button> : null}
      </div>
    ) },
  ];

  return <FactoryTable columns={columns} rows={rows} emptyTitle="No raw materials" emptyDescription="Create a raw material before receiving stock or building Product Recipes." />;
}
