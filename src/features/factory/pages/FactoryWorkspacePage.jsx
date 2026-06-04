import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Factory, PackageCheck, Play, Plus, RefreshCw, Truck, Warehouse } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService } from "../../../services/factoryService.js";

const priorityOptions = ["Low", "Normal", "High", "Urgent"];
const jobStatusOptions = ["draft", "planned", "in_progress", "completed", "cancelled"];
const commonUoms = ["kg", "g", "litre", "ml", "pcs", "carton", "pail", "bottle", "pack"];
const qcStatusOptions = ["Pending", "Pass", "Hold", "Failed"];
const varianceThresholdPercent = 5;
const stockCheckWarningPercent = 2;
const stockCheckCriticalPercent = 5;

function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function money(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function quantity(value, uom) {
  return `${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ""}`;
}

function percent(value) {
  return `${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function timeInput() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function employeeDisplayName(auth) {
  return auth?.profile?.nickname || auth?.profile?.full_name || auth?.profile?.email || "";
}

function statusTone(status) {
  if (status === "approved") return "success";
  if (status === "submitted") return "info";
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "in_progress" || status === "planned") return "info";
  return "neutral";
}

function Field({ label, children, error }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <div className="mt-1 text-xs font-semibold text-rose-600">{error}</div> : null}
    </label>
  );
}

function inputClass(error) {
  return `w-full rounded-xl border bg-surface px-3 py-2 text-sm font-semibold text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${
    error ? "border-rose-300" : "border-border"
  }`;
}

function varianceFor(standardUsage, actualUsage) {
  const standard = Number(standardUsage || 0);
  const actual = Number(actualUsage || 0);
  const variance = actual - standard;
  const variancePercent = standard === 0 ? (actual === 0 ? 0 : 100) : (variance / standard) * 100;
  return { variance, variancePercent };
}

function stockCheckVariance(systemQty, physicalQty) {
  const system = Number(systemQty || 0);
  const physical = Number(physicalQty || 0);
  const variance = physical - system;
  const variancePercent = system === 0 ? (physical === 0 ? 0 : 100) : (variance / system) * 100;
  const absPercent = Math.abs(variancePercent);
  const status = absPercent > stockCheckCriticalPercent ? "Critical" : absPercent > stockCheckWarningPercent ? "Warning" : "Normal";
  return { variance, variancePercent, status };
}

function stockVarianceTone(status) {
  if (status === "Critical") return "danger";
  if (status === "Warning") return "warning";
  return "success";
}

function latestReceivingCost(receivings, rawMaterialId) {
  const rows = receivings
    .filter((row) => row.raw_material_id === rawMaterialId && Number(row.unit_cost || 0) > 0)
    .sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0));
  return Number(rows[0]?.unit_cost || 0);
}

function usageUnitCost(usage, receivings) {
  return Number(usage.unit_cost || 0) || latestReceivingCost(receivings, usage.raw_material_id);
}

function productionCost(production, receivings) {
  return (production.material_usage || []).reduce((sum, usage) => sum + Number(usage.actual_usage || 0) * usageUnitCost(usage, receivings), 0);
}

function productionYieldPercent(production) {
  const actualProduced = Number(production.actual_produced_qty || production.produced_quantity || 0);
  if (!actualProduced) return 0;
  return (Number(production.good_output_qty || 0) / actualProduced) * 100;
}

function weightedMaterialVariancePercent(productions) {
  let standard = 0;
  let variance = 0;
  productions.forEach((production) => {
    (production.material_usage || []).forEach((usage) => {
      standard += Number(usage.standard_usage || 0);
      variance += Number(usage.variance_qty || 0);
    });
  });
  return standard ? (variance / standard) * 100 : 0;
}

function FactoryTable({ columns, rows, emptyTitle, emptyDescription }) {
  if (!rows.length) return <div className="p-4"><EmptyState title={emptyTitle} description={emptyDescription} /></div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead>
          <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {columns.map((column) => (
              <th key={column.key} className={`px-4 py-2.5 ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              {columns.map((column) => (
                <td key={column.key} className={`px-4 py-3 text-sm ${column.align === "right" ? "text-right" : ""}`}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessIssueNotice({ issues }) {
  if (!issues?.length) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-bold">Some Factory data is hidden by your current role.</div>
      <div className="mt-1 text-xs font-semibold text-amber-800">
        {issues.map((issue) => issue.label).join(", ")}
      </div>
    </div>
  );
}

function JobOrderModal({ initialValue, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    product_name: "",
    target_quantity: "",
    produced_quantity: 0,
    uom: "kg",
    planned_date: todayInput(),
    due_date: "",
    priority: "Normal",
    status: "draft",
    assigned_team: "",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.product_name || "").trim()) {
      setError("Product name is required.");
      return;
    }
    if (Number(form.target_quantity || 0) <= 0) {
      setError("Target quantity must be greater than 0.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Job Order" : "Create Job Order"}
      description="Plan factory production demand before production execution."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-job-order-form" disabled={saving}>{saving ? "Saving..." : "Save Job Order"}</button>
        </>
      )}
    >
      <form id="factory-job-order-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Product Name">
            <input className={inputClass()} value={form.product_name} onChange={(event) => setForm((current) => ({ ...current, product_name: event.target.value }))} />
          </Field>
          <Field label="Assigned Team">
            <input className={inputClass()} value={form.assigned_team || ""} onChange={(event) => setForm((current) => ({ ...current, assigned_team: event.target.value }))} />
          </Field>
          <Field label="Target Quantity">
            <input className={inputClass()} type="number" min="0" step="0.01" value={form.target_quantity} onChange={(event) => setForm((current) => ({ ...current, target_quantity: event.target.value }))} />
          </Field>
          <Field label="UOM">
            <select className={inputClass()} value={form.uom} onChange={(event) => setForm((current) => ({ ...current, uom: event.target.value }))}>
              {commonUoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
            </select>
          </Field>
          <Field label="Planned Date">
            <input className={inputClass()} type="date" value={form.planned_date || ""} onChange={(event) => setForm((current) => ({ ...current, planned_date: event.target.value }))} />
          </Field>
          <Field label="Due Date">
            <input className={inputClass()} type="date" value={form.due_date || ""} onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} />
          </Field>
          <Field label="Priority">
            <select className={inputClass()} value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
              {priorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputClass()} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {jobStatusOptions.map((option) => <option key={option} value={option}>{option.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function RawReceivingModal({ initialValue, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    supplier_name: "",
    raw_material_name: "",
    batch_no: "",
    received_qty: "",
    uom: "kg",
    unit_cost: "",
    invoice_no: "",
    received_date: todayInput(),
    expiry_date: "",
    storage_location: "",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const totalCost = Number(form.received_qty || 0) * Number(form.unit_cost || 0);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.raw_material_name || "").trim()) {
      setError("Raw material name is required.");
      return;
    }
    if (Number(form.received_qty || 0) <= 0) {
      setError("Received quantity must be greater than 0.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Raw Material Receiving" : "Record Raw Material Receiving"}
      description="Receive raw materials into factory warehouse stock."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-raw-receiving-form" disabled={saving}>{saving ? "Saving..." : "Save Receiving"}</button>
        </>
      )}
    >
      <form id="factory-raw-receiving-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Supplier">
            <input className={inputClass()} value={form.supplier_name || ""} onChange={(event) => setForm((current) => ({ ...current, supplier_name: event.target.value }))} />
          </Field>
          <Field label="Raw Material">
            <input className={inputClass()} value={form.raw_material_name || ""} onChange={(event) => setForm((current) => ({ ...current, raw_material_name: event.target.value }))} />
          </Field>
          <Field label="Batch No.">
            <input className={inputClass()} value={form.batch_no || ""} onChange={(event) => setForm((current) => ({ ...current, batch_no: event.target.value }))} />
          </Field>
          <Field label="Invoice No.">
            <input className={inputClass()} value={form.invoice_no || ""} onChange={(event) => setForm((current) => ({ ...current, invoice_no: event.target.value }))} />
          </Field>
          <Field label="Received Qty">
            <input className={inputClass()} type="number" min="0" step="0.01" value={form.received_qty} onChange={(event) => setForm((current) => ({ ...current, received_qty: event.target.value }))} />
          </Field>
          <Field label="UOM">
            <select className={inputClass()} value={form.uom} onChange={(event) => setForm((current) => ({ ...current, uom: event.target.value }))}>
              {commonUoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
            </select>
          </Field>
          <Field label="Unit Cost">
            <input className={inputClass()} type="number" min="0" step="0.0001" value={form.unit_cost} onChange={(event) => setForm((current) => ({ ...current, unit_cost: event.target.value }))} />
          </Field>
          <Field label="Total Cost">
            <input className={inputClass()} value={money(totalCost)} readOnly />
          </Field>
          <Field label="Received Date">
            <input className={inputClass()} type="date" value={form.received_date || ""} onChange={(event) => setForm((current) => ({ ...current, received_date: event.target.value }))} />
          </Field>
          <Field label="Expiry Date">
            <input className={inputClass()} type="date" value={form.expiry_date || ""} onChange={(event) => setForm((current) => ({ ...current, expiry_date: event.target.value }))} />
          </Field>
        </div>
        <Field label="Storage Location">
          <input className={inputClass()} value={form.storage_location || ""} onChange={(event) => setForm((current) => ({ ...current, storage_location: event.target.value }))} />
        </Field>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function buildInitialUsageRows(job, rawMaterials, recipes) {
  const matchingRecipe = recipes.find((recipe) => recipe.product_name.toLowerCase() === String(job.product_name || "").toLowerCase());
  if (matchingRecipe?.items?.length) {
    const targetQuantity = Number(job.target_quantity || 0);
    const recipeYield = Number(matchingRecipe.yield_quantity || 1) || 1;
    return matchingRecipe.items.map((item) => {
      const standardUsage = (Number(item.quantity_used || 0) * targetQuantity) / recipeYield;
      return {
        id: `recipe-${item.id}`,
        raw_material_id: item.raw_material_id,
        standard_usage: Number(standardUsage.toFixed(4)),
        actual_usage: Number(standardUsage.toFixed(4)),
        raw_material_receiving_id: "",
        raw_material_lot_no: "",
        uom: item.uom || rawMaterials.find((material) => material.id === item.raw_material_id)?.uom || "",
        variance_reason: "",
        notes: item.notes || "",
      };
    });
  }
  return [];
}

function ProductionExecutionModal({ job, rawMaterials, receivings, recipes, sops, auth, onClose, onSave }) {
  const matchingSop = sops.find((sop) => sop.status !== "inactive" && sop.product_name.toLowerCase() === String(job.product_name || "").toLowerCase());
  const [form, setForm] = useState(() => ({
    job_order_id: job.id,
    production_no: "",
    product_name: job.product_name || "",
    batch_no: "",
    production_date: todayInput(),
    operator_id: auth?.profile?.id || "",
    operator_name: employeeDisplayName(auth),
    start_time: timeInput(),
    end_time: "",
    actual_produced_qty: job.target_quantity || "",
    good_output_qty: job.target_quantity || "",
    wastage_qty: 0,
    uom: job.uom || "",
    qc_status: "Pending",
    production_sop_id: matchingSop?.id || "",
    sop_version: matchingSop?.version || "",
    notes: "",
    material_usage: buildInitialUsageRows(job, rawMaterials, recipes),
  }));
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState("");

  function addUsageRow() {
    setForm((current) => ({
      ...current,
      material_usage: [
        ...current.material_usage,
        {
          id: `manual-${Date.now()}`,
          raw_material_id: "",
          raw_material_receiving_id: "",
          raw_material_lot_no: "",
          standard_usage: 0,
          actual_usage: "",
          uom: "",
          variance_reason: "",
          notes: "",
        },
      ],
    }));
  }

  function updateUsageRow(rowId, patch) {
    setForm((current) => ({
      ...current,
      material_usage: current.material_usage.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  function removeUsageRow(rowId) {
    setForm((current) => ({
      ...current,
      material_usage: current.material_usage.filter((row) => row.id !== rowId),
    }));
  }

  function validate() {
    if (!String(form.product_name || "").trim()) return "Product name is required.";
    if (Number(form.good_output_qty || 0) <= 0) return "Good output quantity must be greater than 0.";
    if (!form.material_usage.length) return "At least one material usage row is required.";
    const invalidRow = form.material_usage.find((row) => !row.raw_material_id || Number(row.actual_usage || 0) < 0);
    if (invalidRow) return "Every material usage row needs a raw material and valid actual usage.";
    const missingReason = form.material_usage.find((row) => {
      const { variancePercent } = varianceFor(row.standard_usage, row.actual_usage);
      return Math.abs(variancePercent) > varianceThresholdPercent && !String(row.variance_reason || "").trim();
    });
    if (missingReason) return "Reason is required when material variance exceeds 5%.";
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    const validationError = validate();
    setError(validationError);
    if (validationError) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  const totalActualUsage = form.material_usage.reduce((sum, row) => sum + Number(row.actual_usage || 0), 0);
  const highVarianceRows = form.material_usage.filter((row) => Math.abs(varianceFor(row.standard_usage, row.actual_usage).variancePercent) > varianceThresholdPercent);

  return (
    <Modal
      title="Start Production"
      description={`${job.job_order_no} · ${job.product_name}`}
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-production-form" disabled={saving}>{saving ? "Completing..." : "Complete Production"}</button>
        </>
      )}
    >
      <form id="factory-production-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard icon={ClipboardCheck} label="Job Target" value={quantity(job.target_quantity, job.uom)} helper={job.job_order_no} />
          <MetricCard icon={Factory} label="Good Output" value={quantity(form.good_output_qty, form.uom)} helper="Finished goods stock-in" />
          <MetricCard icon={AlertTriangle} label="High Variance" value={highVarianceRows.length} helper="Requires reason above 5%" tone={highVarianceRows.length ? "warning" : "success"} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Batch No.">
            <input className={inputClass()} value={form.batch_no || ""} onChange={(event) => setForm((current) => ({ ...current, batch_no: event.target.value }))} />
          </Field>
          <Field label="Production Date">
            <input className={inputClass()} type="date" value={form.production_date || ""} onChange={(event) => setForm((current) => ({ ...current, production_date: event.target.value }))} />
          </Field>
          <Field label="Operator">
            <input className={inputClass()} value={form.operator_name || ""} onChange={(event) => setForm((current) => ({ ...current, operator_name: event.target.value }))} />
          </Field>
          <Field label="Start Time">
            <input className={inputClass()} type="time" value={form.start_time || ""} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} />
          </Field>
          <Field label="End Time">
            <input className={inputClass()} type="time" value={form.end_time || ""} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} />
          </Field>
          <Field label="QC Status">
            <select className={inputClass()} value={form.qc_status} onChange={(event) => setForm((current) => ({ ...current, qc_status: event.target.value }))}>
              {qcStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="SOP Used">
            <select
              className={inputClass()}
              value={form.production_sop_id || ""}
              onChange={(event) => {
                const sop = sops.find((item) => item.id === event.target.value);
                setForm((current) => ({ ...current, production_sop_id: event.target.value, sop_version: sop?.version || "" }));
              }}
            >
              <option value="">No SOP reference</option>
              {sops.filter((sop) => sop.status !== "inactive").map((sop) => (
                <option key={sop.id} value={sop.id}>{sop.product_name} · {sop.title} · {sop.version}</option>
              ))}
            </select>
          </Field>
          <Field label="SOP Version">
            <input className={inputClass()} value={form.sop_version || ""} onChange={(event) => setForm((current) => ({ ...current, sop_version: event.target.value }))} />
          </Field>
          <Field label="Actual Produced Qty">
            <input className={inputClass()} type="number" min="0" step="0.01" value={form.actual_produced_qty} onChange={(event) => setForm((current) => ({ ...current, actual_produced_qty: event.target.value }))} />
          </Field>
          <Field label="Good Output">
            <input className={inputClass()} type="number" min="0" step="0.01" value={form.good_output_qty} onChange={(event) => setForm((current) => ({ ...current, good_output_qty: event.target.value }))} />
          </Field>
          <Field label="Wastage Qty">
            <input className={inputClass()} type="number" min="0" step="0.01" value={form.wastage_qty} onChange={(event) => setForm((current) => ({ ...current, wastage_qty: event.target.value }))} />
          </Field>
        </div>
        <Card
          title="Actual Material Usage"
          description="Actual usage is the real raw material stock deduction source. Product recipes remain standard BOM only."
          action={<button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addUsageRow}><Plus size={14} /> Add Material</button>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">Raw Material</th>
                  <th className="px-4 py-2.5">Lot Used</th>
                  <th className="px-4 py-2.5">Standard</th>
                  <th className="px-4 py-2.5">Actual</th>
                  <th className="px-4 py-2.5">Variance</th>
                  <th className="px-4 py-2.5">Variance %</th>
                  <th className="px-4 py-2.5">Reason</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.material_usage.map((row) => {
                  const material = rawMaterials.find((item) => item.id === row.raw_material_id);
                  const materialLots = receivings.filter((item) => item.raw_material_id === row.raw_material_id && item.batch_no);
                  const { variance, variancePercent } = varianceFor(row.standard_usage, row.actual_usage);
                  const needsReason = Math.abs(variancePercent) > varianceThresholdPercent;
                  const showReasonError = submitAttempted && needsReason && !String(row.variance_reason || "").trim();
                  return (
                    <tr key={row.id} className={`border-b border-border last:border-0 ${showReasonError ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-3">
                        <select
                          className={inputClass(submitAttempted && !row.raw_material_id)}
                          value={row.raw_material_id}
                          onChange={(event) => {
                            const nextMaterial = rawMaterials.find((item) => item.id === event.target.value);
                            updateUsageRow(row.id, { raw_material_id: event.target.value, raw_material_receiving_id: "", raw_material_lot_no: "", uom: nextMaterial?.uom || row.uom });
                          }}
                        >
                          <option value="">Select material</option>
                          {rawMaterials.filter((item) => item.status !== "inactive").map((item) => (
                            <option key={item.id} value={item.id}>{item.name} · {quantity(item.current_balance, item.uom)}</option>
                          ))}
                        </select>
                        <div className="mt-1 text-xs text-text-secondary">On hand: {material ? quantity(material.current_balance, material.uom) : "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className={inputClass()}
                          value={row.raw_material_receiving_id || ""}
                          onChange={(event) => {
                            const lot = materialLots.find((item) => item.id === event.target.value);
                            updateUsageRow(row.id, { raw_material_receiving_id: event.target.value, raw_material_lot_no: lot?.batch_no || "" });
                          }}
                        >
                          <option value="">No lot selected</option>
                          {materialLots.map((lot) => (
                            <option key={lot.id} value={lot.id}>{lot.batch_no} · {lot.receipt_no}</option>
                          ))}
                        </select>
                        <div className="mt-1 text-xs text-text-secondary">{row.raw_material_lot_no || "Trace lot optional"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <input className={inputClass()} type="number" min="0" step="0.0001" value={row.standard_usage} onChange={(event) => updateUsageRow(row.id, { standard_usage: event.target.value })} />
                        <div className="mt-1 text-xs text-text-secondary">{row.uom || material?.uom || "uom"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <input className={inputClass()} type="number" min="0" step="0.0001" value={row.actual_usage} onChange={(event) => updateUsageRow(row.id, { actual_usage: event.target.value })} />
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold ${variance > 0 ? "text-amber-600" : variance < 0 ? "text-emerald-600" : "text-text-secondary"}`}>
                        {quantity(variance, row.uom || material?.uom)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={needsReason ? "warning" : "success"}>{percent(variancePercent)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showReasonError)}
                          placeholder={needsReason ? "Reason required" : "Optional"}
                          value={row.variance_reason || ""}
                          onChange={(event) => updateUsageRow(row.id, { variance_reason: event.target.value })}
                        />
                        {showReasonError ? <div className="mt-1 text-xs font-semibold text-amber-700">Required above 5% variance.</div> : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => removeUsageRow(row.id)}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!form.material_usage.length ? (
            <EmptyState title="No material usage rows" description="Add raw material usage before completing production." />
          ) : null}
          <div className="border-t border-border px-4 py-3 text-sm font-semibold text-text-secondary">
            Total actual usage: {quantity(totalActualUsage, "")}
          </div>
        </Card>
        <Field label="Production Notes">
          <textarea className={inputClass()} rows={3} value={form.notes || ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function ProductionSopModal({ initialValue, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    sop_code: "",
    title: "",
    product_name: "",
    version: "v1",
    effective_date: todayInput(),
    equipment: "",
    status: "active",
    notes: "",
    steps: [
      {
        id: "step-1",
        step_no: 1,
        process_name: "",
        description: "",
        control_point: "",
        materials: "",
        equipment: "",
        estimated_time_minutes: "",
        is_qc_checkpoint: false,
      },
    ],
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateStep(rowId, patch) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === rowId ? { ...step, ...patch } : step)),
    }));
  }

  function addStep() {
    setForm((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          id: `step-${Date.now()}`,
          step_no: current.steps.length + 1,
          process_name: "",
          description: "",
          control_point: "",
          materials: "",
          equipment: "",
          estimated_time_minutes: "",
          is_qc_checkpoint: false,
        },
      ],
    }));
  }

  function removeStep(rowId) {
    setForm((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.id !== rowId).map((step, index) => ({ ...step, step_no: index + 1 })),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.title || "").trim()) {
      setError("SOP title is required.");
      return;
    }
    if (!String(form.product_name || "").trim()) {
      setError("Product name is required.");
      return;
    }
    if (!form.steps.some((step) => String(step.process_name || step.description || "").trim())) {
      setError("At least one SOP step is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Production SOP" : "Create Production SOP"}
      description="SOP is the standard process reference. Actual production records can reference the SOP version used."
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-sop-form" disabled={saving}>{saving ? "Saving..." : "Save SOP"}</button>
        </>
      )}
    >
      <form id="factory-sop-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="SOP Title">
            <input className={inputClass()} value={form.title || ""} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </Field>
          <Field label="Product">
            <input className={inputClass()} value={form.product_name || ""} onChange={(event) => setForm((current) => ({ ...current, product_name: event.target.value }))} />
          </Field>
          <Field label="Version">
            <input className={inputClass()} value={form.version || ""} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} />
          </Field>
          <Field label="SOP Code">
            <input className={inputClass()} value={form.sop_code || "Generated on save"} onChange={(event) => setForm((current) => ({ ...current, sop_code: event.target.value }))} />
          </Field>
          <Field label="Effective Date">
            <input className={inputClass()} type="date" value={form.effective_date || ""} onChange={(event) => setForm((current) => ({ ...current, effective_date: event.target.value }))} />
          </Field>
          <Field label="Status">
            <select className={inputClass()} value={form.status || "active"} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </Field>
        </div>
        <Field label="Default Equipment">
          <input className={inputClass()} value={form.equipment || ""} onChange={(event) => setForm((current) => ({ ...current, equipment: event.target.value }))} />
        </Field>
        <Card
          title="SOP Steps"
          description="QC checkpoint flags create production QC checkpoint snapshots when this SOP is attached to a batch."
          action={<button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addStep}><Plus size={14} /> Add Step</button>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">Step</th>
                  <th className="px-4 py-2.5">Process Name</th>
                  <th className="px-4 py-2.5">Description</th>
                  <th className="px-4 py-2.5">Control Point</th>
                  <th className="px-4 py-2.5">Materials</th>
                  <th className="px-4 py-2.5">Equipment</th>
                  <th className="px-4 py-2.5">Est. Time</th>
                  <th className="px-4 py-2.5">QC</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.steps.map((step) => (
                  <tr key={step.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3"><input className={inputClass()} type="number" min="1" value={step.step_no} onChange={(event) => updateStep(step.id, { step_no: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.process_name || ""} onChange={(event) => updateStep(step.id, { process_name: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.description || ""} onChange={(event) => updateStep(step.id, { description: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.control_point || ""} onChange={(event) => updateStep(step.id, { control_point: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.materials || ""} onChange={(event) => updateStep(step.id, { materials: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.equipment || ""} onChange={(event) => updateStep(step.id, { equipment: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} type="number" min="0" value={step.estimated_time_minutes || ""} onChange={(event) => updateStep(step.id, { estimated_time_minutes: event.target.value })} /></td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-secondary">
                        <input type="checkbox" checked={Boolean(step.is_qc_checkpoint)} onChange={(event) => updateStep(step.id, { is_qc_checkpoint: event.target.checked })} />
                        Checkpoint
                      </label>
                    </td>
                    <td className="px-4 py-3 text-right"><button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => removeStep(step.id)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Field label="Notes">
          <textarea className={inputClass()} rows={3} value={form.notes || ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function buildStockCheckRows(stockType, stockItems, initialValue) {
  if (initialValue?.items?.length) {
    return initialValue.items.map((item) => ({
      id: item.id,
      raw_material_id: item.raw_material_id || "",
      finished_good_id: item.finished_good_id || "",
      item_name: item.item_name || "",
      system_qty: item.system_qty,
      physical_qty: item.physical_qty,
      variance_reason: item.variance_reason || "",
      uom: item.uom || "",
    }));
  }
  return stockItems.filter((item) => item.status !== "inactive").map((item) => ({
    id: `${stockType}-${item.id}`,
    raw_material_id: stockType === "raw" ? item.id : "",
    finished_good_id: stockType === "product" ? item.id : "",
    item_name: stockType === "raw" ? item.name : item.product_name,
    system_qty: Number(item.current_balance || 0),
    physical_qty: Number(item.current_balance || 0),
    variance_reason: "",
    uom: item.uom || "",
  }));
}

function StockCheckModal({ stockType, title, initialValue, stockItems, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    check_date: todayInput(),
    status: "draft",
    notes: "",
    ...initialValue,
    items: buildStockCheckRows(stockType, stockItems, initialValue),
  }));
  const [savingAction, setSavingAction] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState("");
  const itemIdKey = stockType === "raw" ? "raw_material_id" : "finished_good_id";
  const itemLabel = stockType === "raw" ? "Raw Material" : "Finished Good";

  function updateRow(rowId, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  function validate() {
    if (!form.items.length) return "Stock check requires at least one counted item.";
    const invalidRow = form.items.find((row) => !row[itemIdKey] || Number(row.physical_qty || 0) < 0);
    if (invalidRow) return "Every row needs an item and physical count.";
    const missingReason = form.items.find((row) => {
      const variance = stockCheckVariance(row.system_qty, row.physical_qty);
      return variance.status !== "Normal" && !String(row.variance_reason || "").trim();
    });
    if (missingReason) return "Variance reason is required for Warning and Critical rows.";
    return "";
  }

  async function submit(nextStatus) {
    setSubmitAttempted(true);
    const validationError = validate();
    setError(validationError);
    if (validationError) return;
    setSavingAction(nextStatus);
    try {
      await onSave({ ...form, status: nextStatus });
    } finally {
      setSavingAction("");
    }
  }

  const varianceRows = form.items.filter((row) => stockCheckVariance(row.system_qty, row.physical_qty).status !== "Normal");
  const criticalRows = form.items.filter((row) => stockCheckVariance(row.system_qty, row.physical_qty).status === "Critical");
  const isLocked = ["submitted", "approved"].includes(form.status);

  return (
    <Modal
      title={initialValue?.id ? `View ${title}` : `Create ${title}`}
      description="Draft and submitted stock checks do not adjust inventory. Approval creates the adjustment movement."
      size="xl"
      onClose={savingAction ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={Boolean(savingAction)} onClick={onClose}>Close</button>
          {!isLocked ? <button className="btn-secondary" type="button" disabled={Boolean(savingAction)} onClick={() => submit("draft")}>{savingAction === "draft" ? "Saving..." : "Save Draft"}</button> : null}
          {!isLocked ? <button className="btn-primary" type="button" disabled={Boolean(savingAction)} onClick={() => submit("submitted")}>{savingAction === "submitted" ? "Submitting..." : "Submit Check"}</button> : null}
        </>
      )}
    >
      <div className="space-y-5">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="Counted Items" value={form.items.length} helper={itemLabel} />
          <MetricCard icon={Activity} label="Variance Rows" value={varianceRows.length} helper="Above 2%" tone={varianceRows.length ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Critical Rows" value={criticalRows.length} helper="Above 5%" tone={criticalRows.length ? "danger" : "success"} />
          <MetricCard icon={CheckCircle2} label="Status" value={form.status} helper={form.check_no || "New check"} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Check Date">
            <input className={inputClass()} type="date" value={form.check_date || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, check_date: event.target.value }))} />
          </Field>
          <Field label="Reference">
            <input className={inputClass()} value={form.check_no || "Generated on save"} readOnly />
          </Field>
        </div>
        <Card title={`${itemLabel} Count`} description="System quantity is snapshotted at check creation; physical count drives variance for approval review.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">{itemLabel}</th>
                  <th className="px-4 py-2.5">System Qty</th>
                  <th className="px-4 py-2.5">Physical Count</th>
                  <th className="px-4 py-2.5">Variance Qty</th>
                  <th className="px-4 py-2.5">Variance %</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((row) => {
                  const variance = stockCheckVariance(row.system_qty, row.physical_qty);
                  const showReasonError = submitAttempted && variance.status !== "Normal" && !String(row.variance_reason || "").trim();
                  return (
                    <tr key={row.id} className={`border-b border-border last:border-0 ${showReasonError ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-text-primary">{row.item_name || "Item"}</div>
                        <div className="text-xs text-text-secondary">{row.uom || "uom"}</div>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.system_qty, row.uom)}</td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(submitAttempted && Number(row.physical_qty || 0) < 0)}
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={isLocked}
                          value={row.physical_qty}
                          onChange={(event) => updateRow(row.id, { physical_qty: event.target.value })}
                        />
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold ${variance.variance > 0 ? "text-amber-600" : variance.variance < 0 ? "text-rose-600" : "text-text-secondary"}`}>
                        {quantity(variance.variance, row.uom)}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{percent(variance.variancePercent)}</td>
                      <td className="px-4 py-3"><Badge tone={stockVarianceTone(variance.status)}>{variance.status}</Badge></td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showReasonError)}
                          disabled={isLocked}
                          placeholder={variance.status === "Normal" ? "Optional" : "Reason required"}
                          value={row.variance_reason || ""}
                          onChange={(event) => updateRow(row.id, { variance_reason: event.target.value })}
                        />
                        {showReasonError ? <div className="mt-1 text-xs font-semibold text-amber-700">Required for Warning/Critical.</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!form.items.length ? <EmptyState title="No stock items" description="Create inventory records before running stock check." /> : null}
        </Card>
        <Field label="Notes">
          <textarea className={inputClass()} rows={3} disabled={isLocked} value={form.notes || ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}

export default function FactoryWorkspacePage({ initialTab = "dashboard", ui, auth }) {
  const [data, setData] = useState({ jobOrders: [], rawMaterials: [], receivings: [], productions: [], finishedGoods: [], productMovements: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], accessIssues: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const can = (code) => Boolean(auth?.hasPermission?.(code));

  async function loadData() {
    setLoading(true);
    try {
      const nextData = await factoryService.listFactoryData({
        scope: initialTab,
        hasPermission: (code) => auth?.hasPermission?.(code),
      });
      setData(nextData);
    } catch (error) {
      ui?.notify?.({ title: "Failed to load Factory data", message: error.message, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [initialTab, auth?.permissions?.length]);

  const metrics = useMemo(() => {
    const openJobs = data.jobOrders.filter((job) => !["completed", "cancelled"].includes(job.status));
    const completedJobs = data.jobOrders.filter((job) => job.status === "completed");
    const lowStock = data.rawMaterials.filter((item) => item.status !== "inactive" && Number(item.current_balance || 0) <= Number(item.min_stock_level || 0));
    const receivingValue = data.receivings.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
    const completedProductions = data.productions.filter((production) => production.status === "completed");
    const totalGoodOutput = completedProductions.reduce((sum, row) => sum + Number(row.good_output_qty || row.produced_quantity || 0), 0);
    const totalWastage = completedProductions.reduce((sum, row) => sum + Number(row.wastage_qty || 0), 0);
    const highVarianceUsage = completedProductions.flatMap((production) => production.material_usage || []).filter((row) => Math.abs(Number(row.variance_percent || 0)) > varianceThresholdPercent);
    const allStockChecks = [
      ...data.rawStockChecks.map((check) => ({ ...check, stockType: "raw" })),
      ...data.productStockChecks.map((check) => ({ ...check, stockType: "product" })),
    ];
    const submittedStockChecks = allStockChecks.filter((check) => check.status === "submitted");
    const approvedStockChecks = allStockChecks.filter((check) => check.status === "approved");
    const stockCheckVarianceRows = allStockChecks.flatMap((check) => (check.items || []).map((item) => ({ ...item, check }))).filter((item) => item.variance_status !== "Normal");
    const criticalStockCheckRows = stockCheckVarianceRows.filter((item) => item.variance_status === "Critical");
    const qcAlertBatches = completedProductions.filter((production) => ["Pending", "Hold", "Failed"].includes(production.qc_status));
    const totalActualProduced = completedProductions.reduce((sum, row) => sum + Number(row.actual_produced_qty || row.produced_quantity || 0), 0);
    const productionYield = totalActualProduced ? (totalGoodOutput / totalActualProduced) * 100 : 0;
    const materialVariancePercent = weightedMaterialVariancePercent(completedProductions);
    const estimatedProductionCost = completedProductions.reduce((sum, row) => sum + productionCost(row, data.receivings), 0);
    const varianceByMaterial = new Map();
    completedProductions.forEach((production) => {
      (production.material_usage || []).forEach((usage) => {
        const current = varianceByMaterial.get(usage.raw_material_id) || { id: usage.raw_material_id, raw_material_name: usage.raw_material_name || "Raw material", variance_qty: 0, variance_cost: 0, uom: usage.uom || "" };
        current.variance_qty += Number(usage.variance_qty || 0);
        current.variance_cost += Number(usage.variance_qty || 0) * usageUnitCost(usage, data.receivings);
        if (!current.uom) current.uom = usage.uom || "";
        varianceByMaterial.set(usage.raw_material_id, current);
      });
    });
    const topVarianceRawMaterials = [...varianceByMaterial.values()].sort((a, b) => Math.abs(b.variance_qty) - Math.abs(a.variance_qty)).slice(0, 5);
    return { openJobs, completedJobs, lowStock, receivingValue, completedProductions, totalGoodOutput, totalWastage, highVarianceUsage, allStockChecks, submittedStockChecks, approvedStockChecks, stockCheckVarianceRows, criticalStockCheckRows, qcAlertBatches, productionYield, materialVariancePercent, estimatedProductionCost, topVarianceRawMaterials };
  }, [data]);

  async function saveJobOrder(form) {
    try {
      await factoryService.saveJobOrder(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Job order updated" : "Job order created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save job order", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function deleteJobOrder(order) {
    const confirmed = await ui?.confirm?.({
      title: "Delete Job Order?",
      message: `${order.job_order_no || order.product_name} will be removed. This action cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.deleteJobOrder(order);
      ui?.notify?.({ title: "Job order deleted", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete job order", message: error.message, tone: "error" });
    }
  }

  async function saveReceiving(form) {
    try {
      await factoryService.saveRawMaterialReceiving(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Raw material receiving updated" : "Raw material received", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save raw material receiving", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function completeProduction(form) {
    try {
      await factoryService.completeProduction(form, auth?.profile?.id);
      ui?.notify?.({ title: "Production completed", message: "Raw materials deducted and finished goods stocked in.", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to complete production", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function saveStockCheck(stockType, form) {
    try {
      await factoryService.saveStockCheck(stockType, form, auth?.profile?.id);
      ui?.notify?.({ title: form.status === "submitted" ? "Stock check submitted" : "Stock check draft saved", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save stock check", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function saveProductionSop(form) {
    try {
      await factoryService.saveProductionSop(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Production SOP updated" : "Production SOP created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Production SOP", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function approveStockCheck(stockType, check) {
    const label = stockType === "raw" ? "Raw Material Stock Check" : "Finished Goods Stock Check";
    const confirmed = await ui?.confirm?.({
      title: `Approve ${label}?`,
      message: `${check.check_no} will adjust inventory balances and create movement logs. Draft and submitted checks do not adjust stock until this approval.`,
      confirmLabel: "Approve",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.approveStockCheck(stockType, check, auth?.profile?.id);
      ui?.notify?.({ title: "Stock check approved", message: "Inventory adjustment movement created.", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to approve stock check", message: error.message, tone: "error" });
    }
  }

  async function deleteReceiving(receiving) {
    const confirmed = await ui?.confirm?.({
      title: "Delete Raw Material Receiving?",
      message: `${receiving.receipt_no || receiving.raw_material_name} will be removed and stock balance adjusted.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.deleteRawMaterialReceiving(receiving);
      ui?.notify?.({ title: "Raw material receiving deleted", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete raw material receiving", message: error.message, tone: "error" });
    }
  }

  const dashboardActions = (
    <>
      <button className="btn-secondary" type="button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>
      {can("factory_job_orders.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "job" })}><Plus size={15} /> Job Order</button> : null}
      {can("factory_raw_receiving.create") ? <button className="btn-secondary" type="button" onClick={() => setModal({ type: "receiving" })}><Truck size={15} /> Receive Raw Material</button> : null}
      {can("factory_raw_stock_check.create") ? <button className="btn-secondary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "raw" })}><ClipboardCheck size={15} /> Raw Check</button> : null}
    </>
  );

  const jobColumns = [
    { key: "job", label: "Job Order", render: (row) => <div><div className="font-bold text-text-primary">{row.job_order_no}</div><div className="text-xs text-text-secondary">{row.product_name}</div></div> },
    { key: "target", label: "Target", render: (row) => quantity(row.target_quantity, row.uom) },
    { key: "planned_date", label: "Planned Date", render: (row) => row.planned_date || "—" },
    { key: "priority", label: "Priority", render: (row) => <Badge tone={row.priority === "Urgent" || row.priority === "High" ? "warning" : "neutral"}>{row.priority}</Badge> },
    { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status.replace(/_/g, " ")}</Badge> },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex justify-end gap-2">
        {!["completed", "cancelled"].includes(row.status) && can("factory_production.complete") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production", job: row })}><Play size={13} /> Start Production</button>
        ) : null}
        {can("factory_job_orders.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row })}>Edit</button> : null}
        {can("factory_job_orders.delete") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteJobOrder(row)}>Delete</button> : null}
      </div>
    ) },
  ];

  const receivingColumns = [
    { key: "receipt", label: "Receipt", render: (row) => <div><div className="font-bold text-text-primary">{row.receipt_no}</div><div className="text-xs text-text-secondary">{row.received_date}</div></div> },
    { key: "material", label: "Raw Material", render: (row) => <div><div className="font-semibold text-text-primary">{row.raw_material_name}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"}</div></div> },
    { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
    { key: "qty", label: "Quantity", render: (row) => quantity(row.received_qty, row.uom) },
    { key: "total_cost", label: "Value", align: "right", render: (row) => money(row.total_cost) },
    { key: "actions", label: "Actions", align: "right", render: (row) => <div className="flex justify-end gap-2">{can("factory_raw_receiving.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "receiving", value: row })}>Edit</button> : null}{can("factory_raw_receiving.delete") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteReceiving(row)}>Delete</button> : null}</div> },
  ];

  const lowStockColumns = [
    { key: "name", label: "Raw Material", render: (row) => <div><div className="font-semibold text-text-primary">{row.name}</div><div className="text-xs text-text-secondary">{row.category || "Uncategorized"} · {row.storage_location || "No location"}</div></div> },
    { key: "current_balance", label: "On Hand", render: (row) => quantity(row.current_balance, row.uom) },
    { key: "min_stock_level", label: "Min Stock", render: (row) => quantity(row.min_stock_level, row.uom) },
    { key: "status", label: "Status", render: () => <Badge tone="warning">Low Stock</Badge> },
  ];

  const productionColumns = [
    { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.product_name} · {row.batch_no || "No batch"}</div></div> },
    { key: "production_date", label: "Date", render: (row) => row.production_date || "—" },
    { key: "operator", label: "Operator", render: (row) => row.operator_name || "—" },
    { key: "output", label: "Output", render: (row) => <div><div className="font-semibold text-text-primary">{quantity(row.good_output_qty, row.uom)}</div><div className="text-xs text-text-secondary">Waste {quantity(row.wastage_qty, row.uom)}</div></div> },
    { key: "qc_status", label: "QC", render: (row) => <Badge tone={row.qc_status === "Pass" ? "success" : row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge> },
    { key: "variance", label: "Variance", render: (row) => {
      const count = (row.material_usage || []).filter((item) => Math.abs(Number(item.variance_percent || 0)) > varianceThresholdPercent).length;
      return <Badge tone={count ? "warning" : "success"}>{count ? `${count} high` : "Normal"}</Badge>;
    } },
  ];

  const finishedGoodsColumns = [
    { key: "product_name", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{row.product_name}</div><div className="text-xs text-text-secondary">{row.category || "Uncategorized"}</div></div> },
    { key: "current_balance", label: "On Hand", render: (row) => quantity(row.current_balance, row.uom) },
    { key: "min_stock_level", label: "Min Stock", render: (row) => quantity(row.min_stock_level, row.uom) },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
  ];

  const sopColumns = [
    { key: "sop", label: "SOP", render: (row) => <div><div className="font-bold text-text-primary">{row.sop_code}</div><div className="text-xs text-text-secondary">{row.title}</div></div> },
    { key: "product_name", label: "Product", render: (row) => row.product_name },
    { key: "version", label: "Version", render: (row) => <Badge tone="info">{row.version}</Badge> },
    { key: "steps", label: "Steps", render: (row) => row.steps?.length || 0 },
    { key: "qc", label: "QC Checkpoints", render: (row) => <Badge tone={row.steps?.some((step) => step.is_qc_checkpoint) ? "warning" : "neutral"}>{(row.steps || []).filter((step) => step.is_qc_checkpoint).length}</Badge> },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "actions", label: "Actions", align: "right", render: (row) => can("factory_production_sop.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "sop", value: row })}>Edit</button> : null },
  ];

  function stockCheckColumns(stockType) {
    return [
      { key: "check", label: "Check", render: (row) => <div><div className="font-bold text-text-primary">{row.check_no}</div><div className="text-xs text-text-secondary">{row.check_date}</div></div> },
      { key: "items", label: "Items", render: (row) => row.items?.length || 0 },
      { key: "variance", label: "Variance", render: (row) => {
        const warningCount = (row.items || []).filter((item) => item.variance_status === "Warning").length;
        const criticalCount = (row.items || []).filter((item) => item.variance_status === "Critical").length;
        if (criticalCount) return <Badge tone="danger">{criticalCount} critical</Badge>;
        if (warningCount) return <Badge tone="warning">{warningCount} warning</Badge>;
        return <Badge tone="success">Normal</Badge>;
      } },
      { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
      { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
      { key: "actions", label: "Actions", align: "right", render: (row) => (
        <div className="flex justify-end gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "stock-check", stockType, value: row })}>{row.status === "draft" ? "Edit" : "View"}</button>
          {row.status === "submitted" && can(stockType === "raw" ? "factory_raw_stock_check.approve" : "factory_product_stock_check.approve") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => approveStockCheck(stockType, row)}>Approve</button> : null}
        </div>
      ) },
    ];
  }

  const recentActivity = useMemo(() => {
    const productionRows = data.productions.map((row) => ({
      id: `production-${row.id}`,
      title: "Production Completed",
      description: `${row.production_no || "Production"} · ${row.product_name}`,
      timestamp: row.completed_at || row.created_at,
      tone: "success",
    }));
    const receivingRows = data.receivings.map((row) => ({
      id: `receiving-${row.id}`,
      title: "Raw Material Received",
      description: `${row.receipt_no} · ${row.raw_material_name}`,
      timestamp: row.created_at,
      tone: "info",
    }));
    const jobRows = data.jobOrders.map((row) => ({
      id: `job-${row.id}`,
      title: row.status === "completed" ? "Job Order Completed" : "Job Order Updated",
      description: `${row.job_order_no} · ${row.product_name}`,
      timestamp: row.updated_at || row.created_at,
      tone: row.status === "completed" ? "success" : "neutral",
    }));
    const rawStockRows = data.rawStockChecks.flatMap((row) => [
      row.submitted_at ? {
        id: `raw-stock-submitted-${row.id}`,
        title: "Raw Stock Check Submitted",
        description: `${row.check_no} · ${row.items?.length || 0} item(s)`,
        timestamp: row.submitted_at,
        tone: "info",
      } : null,
      row.approved_at ? {
        id: `raw-stock-approved-${row.id}`,
        title: "Raw Stock Check Approved",
        description: `${row.check_no} · adjustment movement created`,
        timestamp: row.approved_at,
        tone: "success",
      } : null,
    ].filter(Boolean));
    const productStockRows = data.productStockChecks.flatMap((row) => [
      row.submitted_at ? {
        id: `product-stock-submitted-${row.id}`,
        title: "Finished Goods Check Submitted",
        description: `${row.check_no} · ${row.items?.length || 0} item(s)`,
        timestamp: row.submitted_at,
        tone: "info",
      } : null,
      row.approved_at ? {
        id: `product-stock-approved-${row.id}`,
        title: "Finished Goods Check Approved",
        description: `${row.check_no} · adjustment movement created`,
        timestamp: row.approved_at,
        tone: "success",
      } : null,
    ].filter(Boolean));
    return [...productionRows, ...receivingRows, ...jobRows, ...rawStockRows, ...productStockRows]
      .filter((row) => row.timestamp)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 8);
  }, [data.jobOrders, data.productions, data.productStockChecks, data.rawStockChecks, data.receivings]);

  function renderDashboard() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Factory Dashboard"
          description="Monitor production job orders, raw material receiving and warehouse readiness."
          actions={dashboardActions}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={CheckCircle2} label="Production Yield" value={percent(metrics.productionYield)} helper={`${quantity(metrics.totalGoodOutput, "")} good output`} tone={metrics.productionYield >= 90 ? "success" : "warning"} />
          <MetricCard icon={Activity} label="Material Variance" value={percent(metrics.materialVariancePercent)} helper="Actual vs standard usage" tone={Math.abs(metrics.materialVariancePercent) > 5 ? "warning" : "success"} />
          <MetricCard icon={PackageCheck} label="Est. Production Cost" value={money(metrics.estimatedProductionCost)} helper="Actual usage cost" />
          <MetricCard icon={AlertTriangle} label="QC Alerts" value={metrics.qcAlertBatches.length} helper="Pending, hold or failed batches" tone={metrics.qcAlertBatches.length ? "danger" : "success"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Open Job Orders" description="Factory production work that still needs action.">
            <FactoryTable columns={jobColumns.slice(0, 5)} rows={metrics.openJobs.slice(0, 6)} emptyTitle="No open job orders" emptyDescription="Create a job order to start production planning." />
          </Card>
          <Card title="Raw Material Low Stock" description="Materials that need attention before production.">
            <FactoryTable columns={lowStockColumns} rows={metrics.lowStock.slice(0, 6)} emptyTitle="No low stock raw materials" emptyDescription="Raw material stock is currently healthy." />
          </Card>
        </div>
        <Card title="Factory Smart Alerts" description="Operational signals from production, receiving and stock check approval.">
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <Factory size={18} className="text-primary" />
              <div className="mt-3 text-sm font-bold text-text-primary">Production Planning</div>
              <p className="mt-1 text-sm text-text-secondary">{metrics.openJobs.length ? `${metrics.openJobs.length} open job order(s) need follow-up.` : "No pending production demand."}</p>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <Warehouse size={18} className="text-primary" />
              <div className="mt-3 text-sm font-bold text-text-primary">Warehouse Readiness</div>
              <p className="mt-1 text-sm text-text-secondary">{metrics.lowStock.length ? `${metrics.lowStock.length} raw material(s) are at low stock.` : "Raw material stock is ready."}</p>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <PackageCheck size={18} className="text-primary" />
              <div className="mt-3 text-sm font-bold text-text-primary">Stock Check Approval</div>
              <p className="mt-1 text-sm text-text-secondary">{metrics.submittedStockChecks.length ? `${metrics.submittedStockChecks.length} submitted stock check(s) awaiting approval.` : "No stock checks awaiting approval."}</p>
            </div>
          </div>
        </Card>
        <Card title="Batch QC Alerts" description="Batches with Pending, Hold or Failed QC status need follow-up outside stock check workflows.">
          <FactoryTable
            columns={[
              { key: "batch", label: "Batch", render: (row) => <div><div className="font-bold text-text-primary">{row.batch_no || "No batch"}</div><div className="text-xs text-text-secondary">{row.production_no}</div></div> },
              { key: "product_name", label: "Product", render: (row) => row.product_name },
              { key: "production_date", label: "Date", render: (row) => row.production_date || "—" },
              { key: "operator", label: "Operator", render: (row) => row.operator_name || "—" },
              { key: "qc_status", label: "QC", render: (row) => <Badge tone={row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge> },
            ]}
            rows={metrics.qcAlertBatches.slice(0, 8)}
            emptyTitle="No batch QC alerts"
            emptyDescription="Completed production batches with QC Pass are clear."
          />
        </Card>
        <Card title="Top Variance Raw Materials" description="Ranked by absolute actual-vs-standard usage variance. Costing uses actual usage and receiving cost where available.">
          <FactoryTable
            columns={[
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "variance_qty", label: "Variance Qty", render: (row) => quantity(row.variance_qty, row.uom) },
              { key: "variance_cost", label: "Variance Cost", align: "right", render: (row) => money(row.variance_cost) },
            ]}
            rows={metrics.topVarianceRawMaterials}
            emptyTitle="No material variance yet"
            emptyDescription="Complete production with material usage to see variance analytics."
          />
        </Card>
        <Card title="Stock Check Variance Alerts" description="Physical count variance is separate from production recipe variance and actual usage.">
          <FactoryTable
            columns={[
              { key: "check", label: "Check", render: (row) => <div><div className="font-bold text-text-primary">{row.check.check_no}</div><div className="text-xs text-text-secondary">{row.check.stockType === "raw" ? "Raw Material" : "Finished Goods"}</div></div> },
              { key: "item_name", label: "Item", render: (row) => row.item_name },
              { key: "variance_qty", label: "Variance Qty", render: (row) => quantity(row.variance_qty, row.uom) },
              { key: "variance_percent", label: "Variance %", render: (row) => percent(row.variance_percent) },
              { key: "variance_status", label: "Status", render: (row) => <Badge tone={stockVarianceTone(row.variance_status)}>{row.variance_status}</Badge> },
              { key: "variance_reason", label: "Reason", render: (row) => row.variance_reason || "—" },
            ]}
            rows={metrics.stockCheckVarianceRows.slice(0, 8)}
            emptyTitle="No stock check variance alerts"
            emptyDescription="Submitted and approved stock checks with variance above 2% will appear here."
          />
        </Card>
        <Card title="Recent Factory Activity" description="Latest job orders, raw receiving and production completion activity.">
          <div className="divide-y divide-border">
            {recentActivity.length ? recentActivity.map((item) => (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                <div className={`mt-0.5 rounded-full p-1.5 ${item.tone === "success" ? "bg-emerald-100 text-emerald-700" : item.tone === "info" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                  <Clock3 size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary">{item.title}</div>
                  <div className="text-xs text-text-secondary">{item.description}</div>
                </div>
                <div className="text-xs font-semibold text-text-muted">{new Date(item.timestamp).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
            )) : <EmptyState title="No factory activity yet" description="Create job orders, receive raw materials or complete production to see activity." />}
          </div>
        </Card>
      </div>
    );
  }

  function renderJobOrders() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Job Orders"
          description="Create, update and monitor factory production job orders."
          actions={can("factory_job_orders.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "job" })}><Plus size={15} /> Create Job Order</button> : null}
        />
        <Card title="Job Order Records" description={`Showing ${data.jobOrders.length} job order(s).`}>
          <FactoryTable columns={jobColumns} rows={data.jobOrders} emptyTitle="No job orders" emptyDescription="Create your first factory job order." />
        </Card>
      </div>
    );
  }

  function renderRawReceiving() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Receiving"
          description="Record supplier deliveries into factory raw material warehouse stock."
          actions={can("factory_raw_receiving.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "receiving" })}><Plus size={15} /> Record Receiving</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard icon={Truck} label="Receipts" value={data.receivings.length} helper="Recorded receiving rows" />
          <MetricCard icon={Warehouse} label="Raw Materials" value={data.rawMaterials.length} helper="Factory raw material master" />
          <MetricCard icon={PackageCheck} label="Received Value" value={money(metrics.receivingValue)} helper="Total receiving value" />
        </div>
        <Card title="Receiving Records" description={`Showing ${data.receivings.length} receipt(s).`}>
          <FactoryTable columns={receivingColumns} rows={data.receivings} emptyTitle="No raw material receiving" emptyDescription="Record supplier delivery to begin raw warehouse tracking." />
        </Card>
      </div>
    );
  }

  function renderRawStockCheck() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Stock Check"
          description="Count raw material stock, submit variance for review and approve inventory adjustments."
          actions={can("factory_raw_stock_check.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "raw" })}><Plus size={15} /> New Stock Check</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Warehouse} label="Raw Materials" value={data.rawMaterials.length} helper="Available for count" />
          <MetricCard icon={ClipboardCheck} label="Checks" value={data.rawStockChecks.length} helper="Raw material checks" />
          <MetricCard icon={Clock3} label="Submitted" value={data.rawStockChecks.filter((row) => row.status === "submitted").length} helper="Awaiting approval" tone={data.rawStockChecks.some((row) => row.status === "submitted") ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Variance Rows" value={data.rawStockChecks.flatMap((row) => row.items || []).filter((item) => item.variance_status !== "Normal").length} helper="Above 2%" tone="warning" />
        </div>
        <Card title="Raw Material Stock Checks" description="Draft and submitted checks do not adjust stock. Approval applies the variance adjustment.">
          <FactoryTable columns={stockCheckColumns("raw")} rows={data.rawStockChecks} emptyTitle="No raw material stock checks" emptyDescription="Create a stock check to capture physical counts." />
        </Card>
      </div>
    );
  }

  function renderProductionSop() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Master Data"
          title="Production SOP"
          description="Manage standard process references, product steps and QC checkpoint flags."
          actions={can("factory_production_sop.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "sop" })}><Plus size={15} /> Create SOP</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="SOPs" value={data.sops.length} helper="Standard process references" />
          <MetricCard icon={Factory} label="Products" value={new Set(data.sops.map((sop) => sop.product_name)).size} helper="With SOP coverage" />
          <MetricCard icon={Activity} label="QC Checkpoints" value={data.sops.flatMap((sop) => sop.steps || []).filter((step) => step.is_qc_checkpoint).length} helper="Flagged SOP steps" />
          <MetricCard icon={CheckCircle2} label="Active SOPs" value={data.sops.filter((sop) => sop.status === "active").length} helper="Available for production" />
        </div>
        <Card title="Production SOP Records" description="SOPs are standard process references and do not represent actual production results.">
          <FactoryTable columns={sopColumns} rows={data.sops} emptyTitle="No Production SOPs" emptyDescription="Create SOP steps before attaching a standard process to production batches." />
        </Card>
      </div>
    );
  }

  function renderProduction() {
    const readyJobs = data.jobOrders.filter((job) => !["completed", "cancelled"].includes(job.status));
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Production Records"
          description="Execute job orders, capture actual material usage, deduct raw stock and stock in finished goods."
          actions={readyJobs[0] && can("factory_production.complete") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "production", job: readyJobs[0] })}><Play size={15} /> Start Next Job</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Factory} label="Completed Runs" value={metrics.completedProductions.length} helper="Production completions" />
          <MetricCard icon={PackageCheck} label="Good Output" value={quantity(metrics.totalGoodOutput, "")} helper="Finished goods stocked in" />
          <MetricCard icon={AlertTriangle} label="Wastage Qty" value={quantity(metrics.totalWastage, "")} helper="Reported production wastage" tone={metrics.totalWastage ? "warning" : "success"} />
          <MetricCard icon={Activity} label="High Variance" value={metrics.highVarianceUsage.length} helper="Material rows above 5%" tone={metrics.highVarianceUsage.length ? "warning" : "success"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card title="Ready Job Orders" description="Start production from a planned or in-progress job order.">
            <FactoryTable columns={jobColumns} rows={readyJobs} emptyTitle="No jobs ready for production" emptyDescription="Create or reopen a job order before starting production." />
          </Card>
          <Card title="Finished Goods Stock" description="Balances created from completed production stock-in movements.">
            <FactoryTable columns={finishedGoodsColumns} rows={data.finishedGoods.slice(0, 8)} emptyTitle="No finished goods stock" emptyDescription="Complete production to stock in finished goods." />
          </Card>
        </div>
        <Card title="Production Completion History" description={`Showing ${data.productions.length} completed production record(s).`}>
          <FactoryTable columns={productionColumns} rows={data.productions} emptyTitle="No production records" emptyDescription="Start production from a job order to create the first record." />
        </Card>
        <Card title="Finished Goods Movements" description="Stock-in movements created by production completion.">
          <FactoryTable
            columns={[
              { key: "reference_no", label: "Reference", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{row.movement_date}</div></div> },
              { key: "product_name", label: "Product", render: (row) => row.product_name },
              { key: "movement_type", label: "Movement", render: (row) => <Badge tone="success">{row.movement_type}</Badge> },
              { key: "quantity", label: "Quantity", render: (row) => quantity(row.quantity, row.uom) },
              { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
            ]}
            rows={data.productMovements}
            emptyTitle="No finished goods movements"
            emptyDescription="Completed production will create finished goods stock-in movements."
          />
        </Card>
      </div>
    );
  }

  function renderBatchTraceability() {
    const rows = data.productions.map((production) => {
      const job = data.jobOrders.find((item) => item.id === production.job_order_id);
      const stockInMovements = data.productMovements.filter((movement) => movement.reference_type === "production" && movement.reference_id === production.id);
      return { ...production, job, stockInMovements };
    });
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Batch Traceability"
          description="Trace a production batch across job order, SOP, raw material lots, QC and finished goods stock-in."
          actions={<button className="btn-secondary" type="button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Factory} label="Batches" value={rows.length} helper="Completed production runs" />
          <MetricCard icon={PackageCheck} label="Stock-In Links" value={rows.reduce((sum, row) => sum + row.stockInMovements.length, 0)} helper="Finished goods movements" />
          <MetricCard icon={Truck} label="Material Lots" value={rows.flatMap((row) => row.material_usage || []).filter((item) => item.raw_material_lot_no).length} helper="Lot-tagged usage rows" />
          <MetricCard icon={AlertTriangle} label="QC Alerts" value={metrics.qcAlertBatches.length} helper="Pending, hold or failed" tone={metrics.qcAlertBatches.length ? "danger" : "success"} />
        </div>
        <Card title="Batch Traceability Records" description="Batch traceability connects product, production, raw material usage and finished goods movement.">
          <div className="space-y-4 p-4">
            {rows.length ? rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Batch No</div>
                    <div className="mt-1 text-lg font-bold text-text-primary">{row.batch_no || "No batch"}</div>
                    <div className="text-sm text-text-secondary">{row.product_name} · {row.production_no}</div>
                  </div>
                  <Badge tone={row.qc_status === "Pass" ? "success" : row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div><div className="text-xs font-semibold text-text-muted">Job Order</div><div className="text-sm font-semibold text-text-primary">{row.job?.job_order_no || "—"}</div></div>
                  <div><div className="text-xs font-semibold text-text-muted">Production Date</div><div className="text-sm font-semibold text-text-primary">{row.production_date || "—"}</div></div>
                  <div><div className="text-xs font-semibold text-text-muted">Operator</div><div className="text-sm font-semibold text-text-primary">{row.operator_name || "—"}</div></div>
                  <div><div className="text-xs font-semibold text-text-muted">SOP Used</div><div className="text-sm font-semibold text-text-primary">{row.sop_title ? `${row.sop_title} ${row.sop_version}` : row.sop_version || "—"}</div></div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="text-sm font-bold text-text-primary">Raw Material Lots Used</div>
                    <div className="mt-2 space-y-2">
                      {(row.material_usage || []).length ? row.material_usage.map((item) => (
                        <div key={item.id} className="text-xs text-text-secondary">
                          <span className="font-semibold text-text-primary">{item.raw_material_name}</span> · {quantity(item.actual_usage, item.uom)} · Lot {item.raw_material_lot_no || "—"} {item.receiving_ref ? `· ${item.receiving_ref}` : ""}
                        </div>
                      )) : <div className="text-xs text-text-secondary">No material usage rows.</div>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="text-sm font-bold text-text-primary">Finished Goods Stock-In</div>
                    <div className="mt-2 space-y-2">
                      {row.stockInMovements.length ? row.stockInMovements.map((movement) => (
                        <div key={movement.id} className="text-xs text-text-secondary">
                          <span className="font-semibold text-text-primary">{movement.reference_no}</span> · {quantity(movement.quantity, movement.uom)} · {movement.movement_date}
                        </div>
                      )) : <div className="text-xs text-text-secondary">No finished goods movement linked.</div>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="text-sm font-bold text-text-primary">QC Checkpoints</div>
                    <div className="mt-2 space-y-2">
                      {(row.qc_checkpoints || []).length ? row.qc_checkpoints.map((checkpoint) => (
                        <div key={checkpoint.id} className="text-xs text-text-secondary">
                          <span className="font-semibold text-text-primary">Step {checkpoint.step_no}: {checkpoint.process_name}</span> · {checkpoint.control_point || "No control point"} · {checkpoint.qc_status}
                        </div>
                      )) : <div className="text-xs text-text-secondary">No SOP QC checkpoints attached.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )) : <EmptyState title="No batch traceability records" description="Complete production to create batch traceability records." />}
          </div>
        </Card>
      </div>
    );
  }

  function renderReports() {
    const productionRows = data.productions.map((production) => {
      const cost = productionCost(production, data.receivings);
      const goodOutput = Number(production.good_output_qty || 0);
      return {
        ...production,
        cost_per_batch: cost,
        cost_per_unit: goodOutput ? cost / goodOutput : 0,
        yield_percent: productionYieldPercent(production),
        material_variance_percent: weightedMaterialVariancePercent([production]),
      };
    });
    const usageRows = data.productions.flatMap((production) => (production.material_usage || []).map((usage) => {
      const unitCost = usageUnitCost(usage, data.receivings);
      return {
        id: `${production.id}-${usage.id}`,
        production_no: production.production_no,
        batch_no: production.batch_no,
        production_date: production.production_date,
        product_name: production.product_name,
        raw_material_name: usage.raw_material_name,
        standard_usage: usage.standard_usage,
        actual_usage: usage.actual_usage,
        variance_qty: usage.variance_qty,
        variance_percent: usage.variance_percent,
        unit_cost: unitCost,
        actual_usage_cost: Number(usage.actual_usage || 0) * unitCost,
        uom: usage.uom,
      };
    }));
    const yieldRows = productionRows.map((row) => ({
      id: `yield-${row.id}`,
      production_no: row.production_no,
      batch_no: row.batch_no,
      product_name: row.product_name,
      actual_produced_qty: row.actual_produced_qty,
      good_output_qty: row.good_output_qty,
      wastage_qty: row.wastage_qty,
      yield_percent: row.yield_percent,
      uom: row.uom,
    }));
    const movementRows = data.productMovements.map((movement) => ({
      ...movement,
      id: `movement-${movement.id}`,
    }));
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Factory Reports"
          description="Read-only production, material usage, costing, yield and finished goods movement reports."
          actions={<button className="btn-secondary" type="button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Factory} label="Production Runs" value={productionRows.length} helper="Completed records" />
          <MetricCard icon={CheckCircle2} label="Yield" value={percent(metrics.productionYield)} helper="Good output / actual produced" tone={metrics.productionYield >= 90 ? "success" : "warning"} />
          <MetricCard icon={Activity} label="Material Variance" value={percent(metrics.materialVariancePercent)} helper="Actual vs standard" tone={Math.abs(metrics.materialVariancePercent) > 5 ? "warning" : "success"} />
          <MetricCard icon={PackageCheck} label="Actual Cost" value={money(metrics.estimatedProductionCost)} helper="Actual material usage cost" />
        </div>
        <Card title="Production Summary Report" description="Completed production totals with actual usage costing.">
          <FactoryTable
            columns={[
              { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"} · {row.production_date}</div></div> },
              { key: "product_name", label: "Product", render: (row) => row.product_name },
              { key: "output", label: "Good Output", render: (row) => quantity(row.good_output_qty, row.uom) },
              { key: "yield_percent", label: "Yield", render: (row) => percent(row.yield_percent) },
              { key: "cost_per_batch", label: "Batch Cost", align: "right", render: (row) => money(row.cost_per_batch) },
              { key: "cost_per_unit", label: "Cost / Unit", align: "right", render: (row) => money(row.cost_per_unit) },
            ]}
            rows={productionRows}
            emptyTitle="No production summary"
            emptyDescription="Complete production to populate this read-only report."
          />
        </Card>
        <Card title="Raw Material Usage Report" description="Actual material usage cost uses recorded receiving unit cost when available, otherwise latest receiving cost by raw material.">
          <FactoryTable
            columns={[
              { key: "production_no", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"}</div></div> },
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "actual_usage", label: "Actual Usage", render: (row) => quantity(row.actual_usage, row.uom) },
              { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => money(row.unit_cost) },
              { key: "actual_usage_cost", label: "Actual Usage Cost", align: "right", render: (row) => money(row.actual_usage_cost) },
            ]}
            rows={usageRows}
            emptyTitle="No raw material usage"
            emptyDescription="Complete production with actual material usage to populate this report."
          />
        </Card>
        <Card title="Recipe Standard vs Actual Usage Report" description="Recipe remains the standard reference; this report compares standard usage against actual production usage without modifying either.">
          <FactoryTable
            columns={[
              { key: "production_no", label: "Production", render: (row) => row.production_no },
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "standard_usage", label: "Standard", render: (row) => quantity(row.standard_usage, row.uom) },
              { key: "actual_usage", label: "Actual", render: (row) => quantity(row.actual_usage, row.uom) },
              { key: "variance_qty", label: "Variance", render: (row) => quantity(row.variance_qty, row.uom) },
              { key: "variance_percent", label: "Variance %", render: (row) => percent(row.variance_percent) },
            ]}
            rows={usageRows}
            emptyTitle="No standard vs actual usage"
            emptyDescription="Production material usage rows will appear here."
          />
        </Card>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Production Yield Report" description="Yield is good output divided by actual produced quantity.">
            <FactoryTable
              columns={[
                { key: "production_no", label: "Production", render: (row) => row.production_no },
                { key: "product_name", label: "Product", render: (row) => row.product_name },
                { key: "actual_produced_qty", label: "Actual Produced", render: (row) => quantity(row.actual_produced_qty, row.uom) },
                { key: "good_output_qty", label: "Good Output", render: (row) => quantity(row.good_output_qty, row.uom) },
                { key: "yield_percent", label: "Yield", render: (row) => percent(row.yield_percent) },
              ]}
              rows={yieldRows}
              emptyTitle="No yield records"
              emptyDescription="Complete production to populate yield reporting."
            />
          </Card>
          <Card title="Finished Goods Stock Movement Report" description="Read-only finished goods stock movement history.">
            <FactoryTable
              columns={[
                { key: "reference_no", label: "Reference", render: (row) => row.reference_no || "—" },
                { key: "product_name", label: "Product", render: (row) => row.product_name },
                { key: "movement_type", label: "Movement", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type}</Badge> },
                { key: "quantity", label: "Qty", render: (row) => quantity(row.quantity, row.uom) },
                { key: "movement_date", label: "Date", render: (row) => row.movement_date || "—" },
              ]}
              rows={movementRows}
              emptyTitle="No finished goods movements"
              emptyDescription="Production stock-in and future product movements will appear here."
            />
          </Card>
        </div>
      </div>
    );
  }

  function renderProductStockCheck() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Warehouse"
          title="Product Stock Check"
          description="Count finished goods stock, submit variance for review and approve inventory adjustments."
          actions={can("factory_product_stock_check.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "product" })}><Plus size={15} /> New Stock Check</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Finished Goods" value={data.finishedGoods.length} helper="Available for count" />
          <MetricCard icon={ClipboardCheck} label="Checks" value={data.productStockChecks.length} helper="Finished goods checks" />
          <MetricCard icon={Clock3} label="Submitted" value={data.productStockChecks.filter((row) => row.status === "submitted").length} helper="Awaiting approval" tone={data.productStockChecks.some((row) => row.status === "submitted") ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Variance Rows" value={data.productStockChecks.flatMap((row) => row.items || []).filter((item) => item.variance_status !== "Normal").length} helper="Above 2%" tone="warning" />
        </div>
        <Card title="Finished Goods Stock Checks" description="Draft and submitted checks do not adjust stock. Approval applies the variance adjustment.">
          <FactoryTable columns={stockCheckColumns("product")} rows={data.productStockChecks} emptyTitle="No finished goods stock checks" emptyDescription="Create a stock check to capture physical counts." />
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="card p-6 text-sm font-semibold text-text-secondary">Loading Factory workspace...</div>;
  }

  return (
    <>
      <AccessIssueNotice issues={data.accessIssues} />
      {initialTab === "job-orders" ? renderJobOrders() : initialTab === "raw-receiving" ? renderRawReceiving() : initialTab === "raw-stock-check" ? renderRawStockCheck() : initialTab === "production" ? renderProduction() : initialTab === "reports" ? renderReports() : initialTab === "batch-traceability" ? renderBatchTraceability() : initialTab === "product-stock-check" ? renderProductStockCheck() : initialTab === "production-sop" ? renderProductionSop() : renderDashboard()}
      {modal?.type === "job" ? (
        <JobOrderModal
          initialValue={modal.value}
          onClose={() => setModal(null)}
          onSave={saveJobOrder}
        />
      ) : null}
      {modal?.type === "receiving" ? (
        <RawReceivingModal
          initialValue={modal.value}
          onClose={() => setModal(null)}
          onSave={saveReceiving}
        />
      ) : null}
      {modal?.type === "production" ? (
        <ProductionExecutionModal
          job={modal.job}
          rawMaterials={data.rawMaterials}
          receivings={data.receivings}
          recipes={data.recipes}
          sops={data.sops}
          auth={auth}
          onClose={() => setModal(null)}
          onSave={completeProduction}
        />
      ) : null}
      {modal?.type === "sop" ? (
        <ProductionSopModal
          initialValue={modal.value}
          onClose={() => setModal(null)}
          onSave={saveProductionSop}
        />
      ) : null}
      {modal?.type === "stock-check" ? (
        <StockCheckModal
          stockType={modal.stockType}
          title={modal.stockType === "raw" ? "Raw Material Stock Check" : "Finished Goods Stock Check"}
          initialValue={modal.value}
          stockItems={modal.stockType === "raw" ? data.rawMaterials : data.finishedGoods}
          onClose={() => setModal(null)}
          onSave={(form) => saveStockCheck(modal.stockType, form)}
        />
      ) : null}
    </>
  );
}
