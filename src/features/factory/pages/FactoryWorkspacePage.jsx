import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Factory, PackageCheck, Plus, RefreshCw, Truck, Warehouse } from "lucide-react";
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

export default function FactoryWorkspacePage({ initialTab = "dashboard", ui, auth }) {
  const [data, setData] = useState({ jobOrders: [], rawMaterials: [], receivings: [] });
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
    return { openJobs, completedJobs, lowStock, receivingValue };
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
    { key: "actions", label: "Actions", align: "right", render: (row) => <div className="flex justify-end gap-2"><button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row })}>Edit</button><button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteJobOrder(row)}>Delete</button></div> },
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
          <MetricCard icon={CheckCircle2} label="Completed Jobs" value={metrics.completedJobs.length} helper="Completed production orders" />
          <MetricCard icon={AlertTriangle} label="Low Raw Materials" value={metrics.lowStock.length} helper="At or below minimum stock" tone={metrics.lowStock.length ? "warning" : "success"} />
          <MetricCard icon={Truck} label="Receiving Value" value={money(metrics.receivingValue)} helper="Raw material received value" />
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

  if (loading) {
    return <div className="card p-6 text-sm font-semibold text-text-secondary">Loading Factory workspace...</div>;
  }

  return (
    <>
      {initialTab === "job-orders" ? renderJobOrders() : initialTab === "raw-receiving" ? renderRawReceiving() : renderDashboard()}
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
    </>
  );
}
