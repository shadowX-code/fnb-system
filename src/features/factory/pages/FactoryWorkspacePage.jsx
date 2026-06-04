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
        uom: item.uom || rawMaterials.find((material) => material.id === item.raw_material_id)?.uom || "",
        variance_reason: "",
        notes: item.notes || "",
      };
    });
  }
  return [];
}

function ProductionExecutionModal({ job, rawMaterials, recipes, auth, onClose, onSave }) {
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
                            updateUsageRow(row.id, { raw_material_id: event.target.value, uom: nextMaterial?.uom || row.uom });
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

export default function FactoryWorkspacePage({ initialTab = "dashboard", ui, auth }) {
  const [data, setData] = useState({ jobOrders: [], rawMaterials: [], receivings: [], productions: [], finishedGoods: [], productMovements: [], recipes: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  async function loadData() {
    setLoading(true);
    try {
      const nextData = await factoryService.listFactoryData();
      setData(nextData);
    } catch (error) {
      ui?.notify?.({ title: "Failed to load Factory data", message: error.message, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const metrics = useMemo(() => {
    const openJobs = data.jobOrders.filter((job) => !["completed", "cancelled"].includes(job.status));
    const completedJobs = data.jobOrders.filter((job) => job.status === "completed");
    const lowStock = data.rawMaterials.filter((item) => item.status !== "inactive" && Number(item.current_balance || 0) <= Number(item.min_stock_level || 0));
    const receivingValue = data.receivings.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
    const completedProductions = data.productions.filter((production) => production.status === "completed");
    const totalGoodOutput = completedProductions.reduce((sum, row) => sum + Number(row.good_output_qty || row.produced_quantity || 0), 0);
    const totalWastage = completedProductions.reduce((sum, row) => sum + Number(row.wastage_qty || 0), 0);
    const highVarianceUsage = completedProductions.flatMap((production) => production.material_usage || []).filter((row) => Math.abs(Number(row.variance_percent || 0)) > varianceThresholdPercent);
    return { openJobs, completedJobs, lowStock, receivingValue, completedProductions, totalGoodOutput, totalWastage, highVarianceUsage };
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
      <button className="btn-primary" type="button" onClick={() => setModal({ type: "job" })}><Plus size={15} /> Job Order</button>
      <button className="btn-secondary" type="button" onClick={() => setModal({ type: "receiving" })}><Truck size={15} /> Receive Raw Material</button>
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
        {!["completed", "cancelled"].includes(row.status) ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production", job: row })}><Play size={13} /> Start Production</button>
        ) : null}
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row })}>Edit</button>
        <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteJobOrder(row)}>Delete</button>
      </div>
    ) },
  ];

  const receivingColumns = [
    { key: "receipt", label: "Receipt", render: (row) => <div><div className="font-bold text-text-primary">{row.receipt_no}</div><div className="text-xs text-text-secondary">{row.received_date}</div></div> },
    { key: "material", label: "Raw Material", render: (row) => <div><div className="font-semibold text-text-primary">{row.raw_material_name}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"}</div></div> },
    { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
    { key: "qty", label: "Quantity", render: (row) => quantity(row.received_qty, row.uom) },
    { key: "total_cost", label: "Value", align: "right", render: (row) => money(row.total_cost) },
    { key: "actions", label: "Actions", align: "right", render: (row) => <div className="flex justify-end gap-2"><button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "receiving", value: row })}>Edit</button><button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteReceiving(row)}>Delete</button></div> },
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
    return [...productionRows, ...receivingRows, ...jobRows]
      .filter((row) => row.timestamp)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 8);
  }, [data.jobOrders, data.productions, data.receivings]);

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
          <MetricCard icon={ClipboardCheck} label="Open Jobs" value={metrics.openJobs.length} helper="Planned or in progress" />
          <MetricCard icon={CheckCircle2} label="Completed Production" value={metrics.completedProductions.length} helper={`${quantity(metrics.totalGoodOutput, "")} good output`} />
          <MetricCard icon={AlertTriangle} label="Low Raw Materials" value={metrics.lowStock.length} helper="At or below minimum stock" tone={metrics.lowStock.length ? "warning" : "success"} />
          <MetricCard icon={Activity} label="Material Variance" value={metrics.highVarianceUsage.length} helper="Rows above 5% variance" tone={metrics.highVarianceUsage.length ? "warning" : "success"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Open Job Orders" description="Factory production work that still needs action.">
            <FactoryTable columns={jobColumns.slice(0, 5)} rows={metrics.openJobs.slice(0, 6)} emptyTitle="No open job orders" emptyDescription="Create a job order to start production planning." />
          </Card>
          <Card title="Raw Material Low Stock" description="Materials that need attention before production.">
            <FactoryTable columns={lowStockColumns} rows={metrics.lowStock.slice(0, 6)} emptyTitle="No low stock raw materials" emptyDescription="Raw material stock is currently healthy." />
          </Card>
        </div>
        <Card title="Factory Smart Alerts" description="Phase 1A operational signals from job orders and receiving.">
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
              <div className="mt-3 text-sm font-bold text-text-primary">Finished Goods</div>
              <p className="mt-1 text-sm text-text-secondary">Finished goods production and movement tracking is registered for the next phase.</p>
            </div>
          </div>
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
          actions={<button className="btn-primary" type="button" onClick={() => setModal({ type: "job" })}><Plus size={15} /> Create Job Order</button>}
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
          actions={<button className="btn-primary" type="button" onClick={() => setModal({ type: "receiving" })}><Plus size={15} /> Record Receiving</button>}
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

  function renderProduction() {
    const readyJobs = data.jobOrders.filter((job) => !["completed", "cancelled"].includes(job.status));
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Production Records"
          description="Execute job orders, capture actual material usage, deduct raw stock and stock in finished goods."
          actions={readyJobs[0] ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "production", job: readyJobs[0] })}><Play size={15} /> Start Next Job</button> : null}
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

  if (loading) {
    return <div className="card p-6 text-sm font-semibold text-text-secondary">Loading Factory workspace...</div>;
  }

  return (
    <>
      {initialTab === "job-orders" ? renderJobOrders() : initialTab === "raw-receiving" ? renderRawReceiving() : initialTab === "production" ? renderProduction() : renderDashboard()}
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
          recipes={data.recipes}
          auth={auth}
          onClose={() => setModal(null)}
          onSave={completeProduction}
        />
      ) : null}
    </>
  );
}
