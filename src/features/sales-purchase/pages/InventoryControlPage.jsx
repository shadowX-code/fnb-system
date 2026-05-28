import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  Filter,
  PackageCheck,
  PackagePlus,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  Warehouse,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import DashboardSection from "../../../components/layout/DashboardSection.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { canExport, canImport, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";

const STORAGE_KEY = "feedx.inventoryControl.v1";

const INVENTORY_MODULE = "inventory_control";

const pageMeta = {
  dashboard: {
    title: "Inventory Dashboard",
    description: "Monitor stock health, ordering activity and inventory risks.",
  },
  master: {
    title: "Master Inventory",
    description: "Create and manage all inventory items used across outlets.",
  },
  groups: {
    title: "Stock Check Groups",
    description: "Manage outlet-level stock check groups and frequencies.",
  },
  "stock-check": {
    title: "Stock Check",
    description: "Complete scheduled inventory checks by outlet and group.",
  },
  requests: {
    title: "Stock Requests",
    description: "Review and manage replenishment requests from outlets.",
  },
  orders: {
    title: "Purchase Orders",
    description: "Convert approved requests into supplier purchase orders.",
  },
  movements: {
    title: "Inventory Movements",
    description: "Track purchases, transfers, waste, usage and adjustments.",
  },
  waste: {
    title: "Waste & Variance",
    description: "Identify wastage, stock leakage and unusual variance.",
  },
  recipes: {
    title: "Recipes & Usage",
    description: "Link menu items to ingredients and estimate consumption.",
  },
};

const categoryPresets = ["Raw Material", "Beverage", "Packaging", "Cleaning", "Frozen", "Dry Goods", "Kitchen Supply", "Retail Item"];
const units = ["kg", "g", "pcs", "box", "pack", "bottle", "carton", "litre"];
const itemTypes = ["Ingredient", "Packaging", "Consumable", "Retail Item", "Operating Supply"];
const statuses = ["active", "inactive", "archived"];
const frequencies = ["daily", "weekly", "monthly", "custom"];
const shifts = ["Opening", "Mid", "Closing", "Any Shift"];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const movementTypes = ["purchase", "transfer_in", "transfer_out", "waste", "adjustment", "staff_meal", "production_usage", "return"];
const wasteTypes = ["Spoilage", "Expired", "Kitchen Error", "Burnt", "Returned Item", "Staff Consumption", "Unknown"];

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function toTitle(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function toCurrency(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function weekdayName(value = todayInput()) {
  return new Date(value).toLocaleDateString("en-MY", { weekday: "long" });
}

function statusTone(status) {
  if (["active", "normal", "completed", "submitted", "reviewed", "locked", "delivered"].includes(status)) return "success";
  if (["draft", "due today", "scheduled", "partial approved", "partial delivery"].includes(status)) return "warning";
  if (["critical", "shortage", "overdue", "rejected", "archived"].includes(status)) return "danger";
  if (["excess", "sent", "confirmed", "ordered", "packing"].includes(status)) return "info";
  return "neutral";
}

function frequencyLabel(group) {
  if (group.frequency === "custom") return (group.checkDays || []).join(", ") || "Custom";
  if (group.frequency === "weekly") return `Weekly · ${(group.checkDays || [])[0] || "Not set"}`;
  if (group.frequency === "monthly") return "Monthly";
  return "Daily";
}

function isGroupDue(group, date) {
  if (group.status !== "active") return false;
  const day = weekdayName(date);
  if (group.frequency === "daily") return true;
  if (group.frequency === "weekly") return (group.checkDays || []).includes(day);
  if (group.frequency === "custom") return (group.checkDays || []).includes(day);
  if (group.frequency === "monthly") return new Date(date).getDate() === Number(group.monthDay || 1);
  return false;
}

function dueStatus(group, checks, date) {
  const completed = checks.some((check) => check.groupId === group.id && check.date === date && ["submitted", "reviewed", "locked"].includes(check.status));
  if (completed) return "Completed";
  if (isGroupDue(group, date)) return "Due Today";
  const lastChecked = group.lastChecked ? new Date(group.lastChecked) : null;
  if (lastChecked && new Date(date) - lastChecked > 1000 * 60 * 60 * 24 * 8) return "Overdue";
  return "Not Due";
}

function varianceStatus(parLevel, count) {
  const variance = Number(parLevel || 0) - Number(count || 0);
  if (variance <= 0) return { label: variance < 0 ? "Excess" : "Normal", tone: variance < 0 ? "info" : "success", variance };
  if (variance >= Math.max(3, Number(parLevel || 0) * 0.35)) return { label: "Critical", tone: "danger", variance };
  return { label: "Shortage", tone: "warning", variance };
}

function defaultData(outlets = [], suppliers = []) {
  const activeOutlets = outlets.length ? outlets : [{ id: "sample-outlet", name: "Sample Outlet" }];
  const firstOutlet = activeOutlets[0];
  const secondOutlet = activeOutlets[1] ?? firstOutlet;
  const categoryRows = categoryPresets.map((name, index) => ({
    id: `inv_cat_${index + 1}`,
    name,
    description: `${name} inventory classification.`,
    sortOrder: index + 1,
    status: "active",
  }));
  const supplierId = suppliers[0]?.id ?? "";
  const items = [
    {
      id: "item_sambal",
      name: "Sambal Sauce",
      sku: "RAW-SAM-001",
      categoryId: "inv_cat_1",
      unit: "kg",
      photo: "",
      description: "House sambal batch for kitchen production.",
      inventoryType: "Ingredient",
      defaultSupplierId: supplierId,
      lowStockThreshold: 8,
      parLevel: 24,
      status: "active",
      linkedOutletIds: [firstOutlet.id, secondOutlet.id],
    },
    {
      id: "item_cups",
      name: "Takeaway Cup 12oz",
      sku: "PKG-CUP-012",
      categoryId: "inv_cat_3",
      unit: "pcs",
      photo: "",
      description: "Standard takeaway beverage cup.",
      inventoryType: "Packaging",
      defaultSupplierId: supplierId,
      lowStockThreshold: 200,
      parLevel: 800,
      status: "active",
      linkedOutletIds: [firstOutlet.id],
    },
    {
      id: "item_chicken",
      name: "Frozen Chicken Cut",
      sku: "FRZ-CHK-001",
      categoryId: "inv_cat_5",
      unit: "kg",
      photo: "",
      description: "Frozen chicken for daily prep.",
      inventoryType: "Ingredient",
      defaultSupplierId: supplierId,
      lowStockThreshold: 20,
      parLevel: 60,
      status: "active",
      linkedOutletIds: [firstOutlet.id, secondOutlet.id],
    },
  ];
  const groups = [
    {
      id: "group_kitchen_daily",
      outletId: firstOutlet.id,
      name: "Kitchen Daily",
      description: "Closing count for core kitchen stock.",
      itemIds: ["item_sambal", "item_chicken"],
      frequency: "daily",
      checkDays: weekdays,
      monthDay: 1,
      shift: "Closing",
      assignedStaff: "",
      status: "active",
      lastChecked: "",
    },
    {
      id: "group_packaging_weekly",
      outletId: firstOutlet.id,
      name: "Packaging Check",
      description: "Weekly packaging stock check.",
      itemIds: ["item_cups"],
      frequency: "weekly",
      checkDays: [weekdayName()],
      monthDay: 1,
      shift: "Opening",
      assignedStaff: "",
      status: "active",
      lastChecked: "",
    },
  ];
  return {
    categories: categoryRows,
    items,
    groups,
    checks: [],
    requests: [],
    orders: [],
    movements: [
      {
        id: "move_seed",
        date: todayInput(),
        itemId: "item_sambal",
        type: "purchase",
        quantity: 12,
        outletId: firstOutlet.id,
        user: "System",
        reference: "Opening balance",
        notes: "Initial stock setup",
      },
    ],
    waste: [],
    recipes: [],
  };
}

function useInventoryData(outlets, suppliers) {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : defaultData(outlets, suppliers);
    } catch {
      return defaultData(outlets, suppliers);
    }
  });

  useEffect(() => {
    if (!outlets.length) return;
    setData((current) => {
      if (current.items?.length || current.groups?.length) return current;
      return defaultData(outlets, suppliers);
    });
  }, [outlets, suppliers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  return [data, setData];
}

function Field({ label, value, onChange, type = "text", placeholder, required = false }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </div>
      <input
        className="control h-9 w-full text-[13px]"
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">{label}</div>
      <textarea className="control min-h-20 w-full resize-none text-[13px]" value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SectionCard({ title, description, action, children, className = "" }) {
  return (
    <DashboardSection title={title} subtitle={description} action={action} className={className}>
      {children}
    </DashboardSection>
  );
}

function MiniPill({ tone = "neutral", children }) {
  return <Badge tone={tone}>{children}</Badge>;
}

function MultiOutletPicker({ outlets, selectedIds, onChange }) {
  const selected = new Set(selectedIds || []);
  return (
    <div className="rounded-2xl border border-border p-2">
      <div className="mb-2 type-caption font-semibold text-text-secondary">Linked Outlets</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {outlets.map((outlet) => (
          <button
            key={outlet.id}
            type="button"
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-[13px] font-semibold transition ${
              selected.has(outlet.id) ? "border-primary/40 bg-primary/8 text-primary" : "border-border text-text-secondary hover:bg-slate-50"
            }`}
            onClick={() => {
              const next = new Set(selected);
              if (next.has(outlet.id)) next.delete(outlet.id);
              else next.add(outlet.id);
              onChange([...next]);
            }}
          >
            <span>{outlet.name}</span>
            {selected.has(outlet.id) ? <CheckCircle2 size={15} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function InventoryItemModal({ item, categories, outlets, suppliers, onClose, onSave }) {
  const [form, setForm] = useState(item ?? {
    id: "",
    name: "",
    sku: "",
    categoryId: categories[0]?.id ?? "",
    unit: "kg",
    photo: "",
    description: "",
    inventoryType: "Ingredient",
    defaultSupplierId: "",
    lowStockThreshold: 0,
    parLevel: 0,
    status: "active",
    linkedOutletIds: outlets[0]?.id ? [outlets[0].id] : [],
  });
  const [touched, setTouched] = useState(false);
  const invalid = touched && (!form.name.trim() || !form.categoryId || !form.unit || !form.linkedOutletIds?.length);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      title={item ? "Edit Inventory Item" : "Add Inventory Item"}
      description="Create outlet-linked inventory items used by stock checks, requests and ordering."
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setTouched(true);
              if (!form.name.trim() || !form.categoryId || !form.unit || !form.linkedOutletIds?.length) return;
              onSave({ ...form, id: form.id || makeId("item") });
            }}
          >
            Save Item
          </button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Item Name" value={form.name} required onChange={(value) => update("name", value)} placeholder="Sambal Sauce" />
        <Field label="SKU Code" value={form.sku} onChange={(value) => update("sku", value)} placeholder="RAW-SAM-001" />
        <SelectField label="Category" value={form.categoryId} options={categories.map((category) => ({ value: category.id, label: category.name }))} onChange={(value) => update("categoryId", value)} searchable required />
        <SelectField label="Unit" value={form.unit} options={units.map((unit) => ({ value: unit, label: unit }))} onChange={(value) => update("unit", value)} />
        <SelectField label="Inventory Type" value={form.inventoryType} options={itemTypes.map((type) => ({ value: type, label: type }))} onChange={(value) => update("inventoryType", value)} />
        <SelectField label="Default Supplier" value={form.defaultSupplierId} placeholder="Optional" options={[{ value: "", label: "No default supplier" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} onChange={(value) => update("defaultSupplierId", value)} searchable />
        <Field label="Low Stock Threshold" type="number" value={form.lowStockThreshold} onChange={(value) => update("lowStockThreshold", Number(value || 0))} />
        <Field label="Par Level" type="number" value={form.parLevel} onChange={(value) => update("parLevel", Number(value || 0))} />
        <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
        <Field label="Photo / Icon URL" value={form.photo} onChange={(value) => update("photo", value)} placeholder="Optional image URL" />
        <div className="md:col-span-2">
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} placeholder="Short operational description." />
        </div>
        <div className="md:col-span-2">
          <MultiOutletPicker outlets={outlets} selectedIds={form.linkedOutletIds} onChange={(ids) => update("linkedOutletIds", ids)} />
          {invalid ? <div className="mt-2 type-caption font-semibold text-rose-600">Item name, category, unit and at least one linked outlet are required.</div> : null}
        </div>
      </div>
    </Modal>
  );
}

function CategoryModal({ category, onClose, onSave }) {
  const [form, setForm] = useState(category ?? { id: "", name: "", description: "", sortOrder: 1, status: "active" });
  return (
    <Modal
      title={category ? "Edit Category" : "Add Category"}
      description="Inventory categories keep the master list clean and searchable."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!form.name.trim()} onClick={() => onSave({ ...form, id: form.id || makeId("inv_cat") })}>Save Category</button>
        </>
      )}
    >
      <div className="grid gap-3">
        <Field label="Category Name" value={form.name} required onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
        <TextArea label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
        <Field label="Sort Order" type="number" value={form.sortOrder} onChange={(value) => setForm((current) => ({ ...current, sortOrder: Number(value || 0) }))} />
        <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
      </div>
    </Modal>
  );
}

function GroupModal({ group, outlets, items, categories, onClose, onSave }) {
  const [form, setForm] = useState(group ?? {
    id: "",
    outletId: outlets[0]?.id ?? "",
    name: "",
    description: "",
    itemIds: [],
    frequency: "daily",
    checkDays: [weekdayName()],
    monthDay: 1,
    shift: "Closing",
    assignedStaff: "",
    status: "active",
    lastChecked: "",
  });
  const allowedItems = useMemo(() => items.filter((item) => (item.linkedOutletIds || []).includes(form.outletId) && item.status === "active"), [items, form.outletId]);
  const selected = new Set(form.itemIds || []);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      title={group ? "Edit Stock Check Group" : "Add Stock Check Group"}
      description="Group only the items this outlet actually needs to count for the selected frequency."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!form.name.trim() || !form.outletId || !form.itemIds.length} onClick={() => onSave({ ...form, id: form.id || makeId("group") })}>Save Group</button>
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3">
          <SelectField label="Outlet" value={form.outletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => update("outletId", value)} searchable />
          <Field label="Group Name" value={form.name} required onChange={(value) => update("name", value)} placeholder="Kitchen Daily" />
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Check Frequency" value={form.frequency} options={frequencies.map((frequency) => ({ value: frequency, label: toTitle(frequency) }))} onChange={(value) => update("frequency", value)} />
            <SelectField label="Shift" value={form.shift} options={shifts.map((shift) => ({ value: shift, label: shift }))} onChange={(value) => update("shift", value)} />
          </div>
          {form.frequency === "monthly" ? <Field label="Monthly Check Day" type="number" value={form.monthDay} onChange={(value) => update("monthDay", Number(value || 1))} /> : null}
          {["weekly", "custom"].includes(form.frequency) ? (
            <div className="rounded-2xl border border-border p-2">
              <div className="mb-2 type-caption font-semibold text-text-secondary">Check Days</div>
              <div className="flex flex-wrap gap-2">
                {weekdays.map((day) => {
                  const active = (form.checkDays || []).includes(day);
                  return (
                    <button
                      key={day}
                      className={`rounded-full border px-2.5 py-1 type-caption font-semibold transition ${active ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-secondary hover:bg-slate-50"}`}
                      type="button"
                      onClick={() => {
                        const next = new Set(form.checkDays || []);
                        if (next.has(day)) next.delete(day);
                        else next.add(day);
                        update("checkDays", [...next]);
                      }}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
        </div>
        <div className="rounded-2xl border border-border bg-slate-50/70 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="type-title font-bold text-text-primary">Linked Items</div>
              <div className="type-caption text-text-secondary">Only inventory linked to the selected outlet is available.</div>
            </div>
            <Badge tone="info">{selected.size} selected</Badge>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {allowedItems.length ? allowedItems.map((item) => {
              const category = categories.find((entry) => entry.id === item.categoryId);
              const active = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  className={`flex w-full items-start justify-between gap-3 rounded-2xl border p-3 text-left transition ${active ? "border-primary/40 bg-white shadow-sm" : "border-border bg-white/70 hover:border-slate-300"}`}
                  type="button"
                  onClick={() => {
                    const next = new Set(selected);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    update("itemIds", [...next]);
                  }}
                >
                  <span>
                    <span className="block type-body-sm font-bold text-text-primary">{item.name}</span>
                    <span className="mt-1 block type-caption text-text-secondary">{category?.name ?? "Uncategorized"} · Par {item.parLevel} {item.unit}</span>
                  </span>
                  {active ? <CheckCircle2 className="text-primary" size={18} /> : null}
                </button>
              );
            }) : <EmptyState title="No linked items" description="Link inventory items to this outlet before adding them to a stock check group." />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RequestModal({ outlets, items, categories, suppliers, onClose, onSave }) {
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const outletItems = items.filter((item) => item.linkedOutletIds?.includes(outletId) && item.status === "active");
  const [lines, setLines] = useState([]);
  const itemById = new Map(items.map((item) => [item.id, item]));

  function addLine(item) {
    setLines((current) => [...current, { itemId: item.id, currentQty: 0, suggestedQty: Math.max(1, Number(item.parLevel || 0) - Number(item.lowStockThreshold || 0)), requestedQty: Math.max(1, Number(item.parLevel || 0) - Number(item.lowStockThreshold || 0)), priority: "Normal", notes: "" }]);
  }

  return (
    <Modal
      title="Create Stock Request"
      description="Draft a replenishment request from low stock or operational needs."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            disabled={!outletId || !lines.length}
            onClick={() => onSave({
              id: makeId("req"),
              requestNo: `REQ-${Date.now().toString().slice(-6)}`,
              outletId,
              date: todayInput(),
              requestedBy: "Current User",
              status: "draft",
              lines,
            })}
          >
            Save Request
          </button>
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-3">
          <SelectField label="Outlet" value={outletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={setOutletId} searchable />
          <div className="rounded-2xl border border-border p-3">
            <div className="mb-2 type-caption font-semibold text-text-secondary">Available Items</div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {outletItems.map((item) => {
                const category = categories.find((entry) => entry.id === item.categoryId);
                return (
                  <button key={item.id} className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2 text-left transition hover:border-primary/30 hover:bg-primary/5" type="button" onClick={() => addLine(item)}>
                    <span>
                      <span className="block type-body-sm font-bold text-text-primary">{item.name}</span>
                      <span className="type-caption text-text-secondary">{category?.name ?? "Uncategorized"} · Par {item.parLevel} {item.unit}</span>
                    </span>
                    <PackagePlus size={16} className="text-primary" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-slate-50/70 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="type-title font-bold text-text-primary">Request Detail</div>
            <Badge tone={lines.length ? "success" : "neutral"}>{lines.length} items</Badge>
          </div>
          {lines.length ? (
            <div className="space-y-2">
              {lines.map((line, index) => {
                const item = itemById.get(line.itemId);
                const supplier = suppliers.find((entry) => entry.id === item?.defaultSupplierId);
                return (
                  <div key={`${line.itemId}-${index}`} className="rounded-2xl border border-border bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="type-body-sm font-bold text-text-primary">{item?.name}</div>
                        <div className="type-caption text-text-secondary">{supplier?.name ?? "No supplier"} · Suggested {line.suggestedQty} {item?.unit}</div>
                      </div>
                      <button className="icon-btn" type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={14} /></button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <Field label="Current Qty" type="number" value={line.currentQty} onChange={(value) => setLines((current) => current.map((entry, lineIndex) => lineIndex === index ? { ...entry, currentQty: Number(value || 0) } : entry))} />
                      <Field label="Requested Qty" type="number" value={line.requestedQty} onChange={(value) => setLines((current) => current.map((entry, lineIndex) => lineIndex === index ? { ...entry, requestedQty: Number(value || 0) } : entry))} />
                      <SelectField label="Priority" value={line.priority} options={["Low", "Normal", "High", "Urgent"].map((priority) => ({ value: priority, label: priority }))} onChange={(value) => setLines((current) => current.map((entry, lineIndex) => lineIndex === index ? { ...entry, priority: value } : entry))} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No request items yet" description="Add low stock or replenishment items from the outlet-linked inventory list." />}
        </div>
      </div>
    </Modal>
  );
}

function MovementModal({ outlets, items, onClose, onSave }) {
  const [form, setForm] = useState({
    id: "",
    date: todayInput(),
    itemId: items[0]?.id ?? "",
    type: "adjustment",
    quantity: 0,
    outletId: outlets[0]?.id ?? "",
    user: "Current User",
    reference: "",
    notes: "",
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal
      title="Record Inventory Movement"
      description="Every stock movement should create an operational audit trail."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!form.itemId || !form.outletId || !Number(form.quantity)} onClick={() => onSave({ ...form, id: makeId("move") })}>Save Movement</button>
        </>
      )}
    >
      <div className="grid gap-3">
        <SelectField label="Item" value={form.itemId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => update("itemId", value)} searchable />
        <SelectField label="Outlet" value={form.outletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => update("outletId", value)} searchable />
        <SelectField label="Movement Type" value={form.type} options={movementTypes.map((type) => ({ value: type, label: toTitle(type) }))} onChange={(value) => update("type", value)} />
        <Field label="Quantity" type="number" value={form.quantity} onChange={(value) => update("quantity", Number(value || 0))} />
        <Field label="Reference" value={form.reference} onChange={(value) => update("reference", value)} />
        <TextArea label="Notes" value={form.notes} onChange={(value) => update("notes", value)} />
      </div>
    </Modal>
  );
}

function WasteModal({ outlets, items, onClose, onSave }) {
  const [form, setForm] = useState({
    id: "",
    date: todayInput(),
    itemId: items[0]?.id ?? "",
    outletId: outlets[0]?.id ?? "",
    wasteType: "Spoilage",
    quantity: 0,
    value: 0,
    notes: "",
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal
      title="Record Waste"
      description="Track spoilage, expiry, kitchen error and unexplained operational leakage."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!form.itemId || !form.outletId || !Number(form.quantity)} onClick={() => onSave({ ...form, id: makeId("waste") })}>Save Waste</button>
        </>
      )}
    >
      <div className="grid gap-3">
        <SelectField label="Item" value={form.itemId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => update("itemId", value)} searchable />
        <SelectField label="Outlet" value={form.outletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => update("outletId", value)} searchable />
        <SelectField label="Waste Type" value={form.wasteType} options={wasteTypes.map((type) => ({ value: type, label: type }))} onChange={(value) => update("wasteType", value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quantity" type="number" value={form.quantity} onChange={(value) => update("quantity", Number(value || 0))} />
          <Field label="Estimated Value" type="number" value={form.value} onChange={(value) => update("value", Number(value || 0))} />
        </div>
        <TextArea label="Notes" value={form.notes} onChange={(value) => update("notes", value)} />
      </div>
    </Modal>
  );
}

function InventoryControlPage({ store, auth, ui, initialTab = "dashboard" }) {
  const outlets = store?.outlets ?? [];
  const suppliers = store?.suppliers ?? [];
  const [data, setData] = useInventoryData(outlets, suppliers);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [date, setDate] = useState(todayInput());
  const [modal, setModal] = useState(null);
  const [activeCheckGroupId, setActiveCheckGroupId] = useState(null);
  const [checkRows, setCheckRows] = useState([]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const can = useMemo(() => ({
    import: canImport(auth, INVENTORY_MODULE) || hasPermission(auth, "inventory_master.import"),
    export: canExport(auth, INVENTORY_MODULE) || hasPermission(auth, "inventory_master.export") || hasPermission(auth, "inventory_orders.export") || hasPermission(auth, "inventory_movements.export") || hasPermission(auth, "inventory_waste.export"),
    manageMaster: hasPermission(auth, "inventory_master.create") || hasPermission(auth, "inventory_master.edit") || hasPermission(auth, "inventory_control.manage_master") || hasPermission(auth, "inventory_control.manage"),
    manageCategories: hasPermission(auth, "inventory_master.edit") || hasPermission(auth, "inventory_control.manage_categories") || hasPermission(auth, "inventory_control.manage"),
    manageGroups: hasPermission(auth, "inventory_groups.create") || hasPermission(auth, "inventory_groups.edit") || hasPermission(auth, "inventory_control.manage_groups") || hasPermission(auth, "inventory_control.manage"),
    createCheck: hasPermission(auth, "inventory_stock_check.create") || hasPermission(auth, "inventory_control.create_stock_check") || hasPermission(auth, "inventory_control.create"),
    editCheck: hasPermission(auth, "inventory_stock_check.edit") || hasPermission(auth, "inventory_control.edit_stock_check") || hasPermission(auth, "inventory_control.edit"),
    reviewCheck: hasPermission(auth, "inventory_stock_check.approve") || hasPermission(auth, "inventory_control.review_stock_check") || hasPermission(auth, "inventory_control.approve"),
    createRequest: hasPermission(auth, "inventory_requests.create") || hasPermission(auth, "inventory_control.create_request") || hasPermission(auth, "inventory_control.create"),
    approveRequest: hasPermission(auth, "inventory_requests.approve") || hasPermission(auth, "inventory_control.approve_request") || hasPermission(auth, "inventory_control.approve"),
    generatePo: hasPermission(auth, "inventory_orders.create") || hasPermission(auth, "inventory_control.generate_purchase_order") || hasPermission(auth, "inventory_control.manage"),
    managePo: hasPermission(auth, "inventory_orders.edit") || hasPermission(auth, "inventory_control.manage_purchase_orders") || hasPermission(auth, "inventory_control.manage"),
    recordMovement: hasPermission(auth, "inventory_movements.create") || hasPermission(auth, "inventory_control.record_movement") || hasPermission(auth, "inventory_control.manage"),
    recordWaste: hasPermission(auth, "inventory_waste.create") || hasPermission(auth, "inventory_control.record_waste") || hasPermission(auth, "inventory_control.manage"),
    viewWaste: hasPermission(auth, "inventory_waste.view") || hasPermission(auth, "inventory_control.view_waste") || hasPermission(auth, "inventory_control.view"),
    viewInsights: hasPermission(auth, "inventory_dashboard.view") || hasPermission(auth, "inventory_control.view_insights") || hasPermission(auth, "inventory_control.view"),
    manageRecipes: hasPermission(auth, "inventory_recipes.create") || hasPermission(auth, "inventory_recipes.edit") || hasPermission(auth, "inventory_control.manage_recipes") || hasPermission(auth, "inventory_control.manage"),
  }), [auth]);

  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);

  const visibleItems = useMemo(() => data.items.filter((item) => {
    const matchesOutlet = selectedOutletId === "all" || item.linkedOutletIds?.includes(selectedOutletId);
    const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    return matchesOutlet && matchesQuery && matchesCategory && matchesStatus;
  }), [data.items, selectedOutletId, query, categoryFilter, statusFilter]);

  const selectedOutletIds = selectedOutletId === "all" ? outlets.map((outlet) => outlet.id) : [selectedOutletId];
  const scopedGroups = data.groups.filter((group) => selectedOutletIds.includes(group.outletId));
  const dueGroups = scopedGroups.filter((group) => ["Due Today", "Completed", "Overdue"].includes(dueStatus(group, data.checks, date)));
  const activeCheckGroup = data.groups.find((group) => group.id === activeCheckGroupId);

  const dashboard = useMemo(() => {
    const scopedItems = data.items.filter((item) => selectedOutletId === "all" || item.linkedOutletIds?.includes(selectedOutletId));
    const lowStock = scopedItems.filter((item) => Number(item.lowStockThreshold || 0) > 0 && Number(item.parLevel || 0) <= Number(item.lowStockThreshold || 0)).length;
    const pendingRequests = data.requests.filter((request) => selectedOutletIds.includes(request.outletId) && !["completed", "rejected"].includes(request.status)).length;
    const criticalChecks = dueGroups.filter((group) => dueStatus(group, data.checks, date) === "Overdue").length;
    const completion = dueGroups.length ? Math.round((dueGroups.filter((group) => dueStatus(group, data.checks, date) === "Completed").length / dueGroups.length) * 100) : 100;
    return {
      inventoryValue: scopedItems.reduce((sum, item) => sum + Number(item.parLevel || 0) * 8, 0),
      lowStock,
      pendingRequests,
      varianceRisk: criticalChecks,
      checkCompletion: completion,
    };
  }, [data.items, data.requests, data.checks, dueGroups, selectedOutletId, selectedOutletIds, date]);

  useEffect(() => {
    if (!activeCheckGroup) return;
    const draft = data.checks.find((check) => check.groupId === activeCheckGroup.id && check.date === date && check.status === "draft");
    if (draft?.rows?.length) {
      setCheckRows(draft.rows.map((row) => ({ itemId: row.itemId, actualCount: row.actualCount, status: row.status ?? "normal", notes: row.notes ?? "", na: Boolean(row.na) })));
      return;
    }
    const items = activeCheckGroup.itemIds.map((id) => itemById.get(id)).filter(Boolean);
    setCheckRows(items.map((item) => ({ itemId: item.id, actualCount: item.parLevel, status: "normal", notes: "", na: false })));
  }, [activeCheckGroupId, activeCheckGroup, data.checks, date, itemById]);

  function notify(title, message = "", tone = "success") {
    ui?.notify?.({ title, message, tone });
  }

  function requirePermission(allowed, action) {
    if (allowed) return true;
    notifyPermissionDenied(ui, action);
    return false;
  }

  function saveItem(item) {
    setData((current) => ({
      ...current,
      items: current.items.some((entry) => entry.id === item.id)
        ? current.items.map((entry) => entry.id === item.id ? item : entry)
        : [item, ...current.items],
    }));
    setModal(null);
    notify("Inventory item saved");
  }

  function saveCategory(category) {
    setData((current) => ({
      ...current,
      categories: current.categories.some((entry) => entry.id === category.id)
        ? current.categories.map((entry) => entry.id === category.id ? category : entry)
        : [...current.categories, category],
    }));
    setModal(null);
    notify("Inventory category saved");
  }

  function saveGroup(group) {
    setData((current) => ({
      ...current,
      groups: current.groups.some((entry) => entry.id === group.id)
        ? current.groups.map((entry) => entry.id === group.id ? group : entry)
        : [group, ...current.groups],
    }));
    setModal(null);
    notify("Stock check group saved");
  }

  function archiveItem(itemId) {
    setData((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, status: "archived" } : item),
    }));
    notify("Inventory item archived");
  }

  function saveStockCheck(status) {
    if (!activeCheckGroup) return;
    const rows = checkRows.map((row) => {
      const item = itemById.get(row.itemId);
      const variance = row.na ? 0 : Number(item?.parLevel || 0) - Number(row.actualCount || 0);
      return { ...row, expectedQty: item?.parLevel ?? 0, variance };
    });
    const record = {
      id: makeId("check"),
      groupId: activeCheckGroup.id,
      outletId: activeCheckGroup.outletId,
      date,
      shift: activeCheckGroup.shift,
      status,
      rows,
      submittedAt: status === "submitted" ? new Date().toISOString() : "",
    };
    const shortageMovements = rows
      .filter((row) => row.variance !== 0)
      .map((row) => ({
        id: makeId("move"),
        date,
        itemId: row.itemId,
        type: "adjustment",
        quantity: -row.variance,
        outletId: activeCheckGroup.outletId,
        user: "Current User",
        reference: record.id,
        notes: "Stock check variance adjustment",
      }));
    setData((current) => ({
      ...current,
      checks: [record, ...current.checks.filter((check) => !(check.groupId === activeCheckGroup.id && check.date === date && check.status === "draft"))],
      groups: current.groups.map((group) => group.id === activeCheckGroup.id && status !== "draft" ? { ...group, lastChecked: date } : group),
      movements: status === "submitted" ? [...shortageMovements, ...current.movements] : current.movements,
    }));
    setActiveCheckGroupId(null);
    notify(status === "draft" ? "Stock check draft saved" : "Stock check submitted", status === "submitted" ? "Variance movements were recorded for review." : "");
  }

  function saveRequest(request) {
    setData((current) => ({ ...current, requests: [request, ...current.requests] }));
    setModal(null);
    notify("Stock request saved");
  }

  function approveRequest(requestId) {
    setData((current) => ({
      ...current,
      requests: current.requests.map((request) => request.id === requestId ? { ...request, status: "approved" } : request),
    }));
    notify("Request approved");
  }

  function convertRequestToPo(request) {
    const supplierGroups = new Map();
    request.lines.forEach((line) => {
      const item = itemById.get(line.itemId);
      const supplierId = item?.defaultSupplierId || "unassigned";
      if (!supplierGroups.has(supplierId)) supplierGroups.set(supplierId, []);
      supplierGroups.get(supplierId).push(line);
    });
    const orders = [...supplierGroups.entries()].map(([supplierId, lines]) => ({
      id: makeId("po"),
      poNo: `PO-${Date.now().toString().slice(-6)}-${ordersSuffix(supplierId)}`,
      supplierId,
      outletIds: [request.outletId],
      requestIds: [request.id],
      status: "draft",
      eta: "",
      lines,
    }));
    setData((current) => ({
      ...current,
      requests: current.requests.map((entry) => entry.id === request.id ? { ...entry, status: "ordered" } : entry),
      orders: [...orders, ...current.orders],
    }));
    notify("Purchase order drafted", `${orders.length} supplier order${orders.length === 1 ? "" : "s"} created.`);
  }

  function ordersSuffix(value) {
    return String(value || "GEN").slice(-3).toUpperCase();
  }

  function saveMovement(movement) {
    setData((current) => ({ ...current, movements: [movement, ...current.movements] }));
    setModal(null);
    notify("Inventory movement recorded");
  }

  function saveWaste(waste) {
    const movement = {
      id: makeId("move"),
      date: waste.date,
      itemId: waste.itemId,
      type: "waste",
      quantity: -Math.abs(Number(waste.quantity || 0)),
      outletId: waste.outletId,
      user: "Current User",
      reference: waste.id,
      notes: waste.notes || waste.wasteType,
    };
    setData((current) => ({ ...current, waste: [waste, ...current.waste], movements: [movement, ...current.movements] }));
    setModal(null);
    notify("Waste recorded", "A waste movement was added to the inventory audit trail.");
  }

  function renderFilters() {
    return (
      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-end">
        <SelectField
          label="Outlet"
          value={selectedOutletId}
          options={[{ value: "all", label: "All Outlets" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
          onChange={setSelectedOutletId}
          searchable
          className="lg:w-64"
        />
        <SelectField
          label="Category"
          value={categoryFilter}
          options={[{ value: "all", label: "All Categories" }, ...data.categories.map((category) => ({ value: category.id, label: category.name }))]}
          onChange={setCategoryFilter}
          searchable
          className="lg:w-56"
        />
        <SelectField
          label="Status"
          value={statusFilter}
          options={[{ value: "all", label: "All Status" }, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]}
          onChange={setStatusFilter}
          className="lg:w-44"
        />
        <label className="min-w-0 flex-1">
          <div className="mb-1 type-caption font-semibold text-text-secondary">Search item</div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input className="control h-9 w-full pl-9 text-[13px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item name or SKU" />
          </div>
        </label>
      </div>
    );
  }

  function renderDashboard() {
    const outletRows = outlets.map((outlet) => {
      const outletItems = data.items.filter((item) => item.linkedOutletIds?.includes(outlet.id));
      const outletGroups = data.groups.filter((group) => group.outletId === outlet.id);
      const outletDue = outletGroups.filter((group) => isGroupDue(group, date));
      const lowStock = outletItems.filter((item) => Number(item.parLevel || 0) <= Number(item.lowStockThreshold || 0)).length;
      const waste = data.waste.filter((row) => row.outletId === outlet.id).reduce((sum, row) => sum + Number(row.value || 0), 0);
      const pendingOrders = data.orders.filter((order) => order.outletIds?.includes(outlet.id) && !["completed", "delivered"].includes(order.status)).length;
      const completion = outletDue.length ? Math.round((outletDue.filter((group) => dueStatus(group, data.checks, date) === "Completed").length / outletDue.length) * 100) : 100;
      const status = lowStock > 2 || completion < 60 ? "Critical" : lowStock || pendingOrders ? "Watch" : "Good";
      return { outlet, lowStock, waste, pendingOrders, completion, status };
    }).filter((row) => selectedOutletId === "all" || row.outlet.id === selectedOutletId);

    const alerts = [
      dashboard.lowStock ? { title: `${dashboard.lowStock} low stock items`, reason: "Review par levels and suggested requests.", tone: "warning", category: "Low Stock" } : null,
      dashboard.varianceRisk ? { title: `${dashboard.varianceRisk} overdue stock checks`, reason: "Outlet check groups are not completed.", tone: "danger", category: "Stock Check" } : null,
      data.orders.some((order) => ["sent", "confirmed", "packing"].includes(order.status)) ? { title: "Supplier delivery pending", reason: "Purchase orders are still open.", tone: "info", category: "Ordering" } : null,
    ].filter(Boolean);

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={Warehouse} label="Inventory Value" value={toCurrency(dashboard.inventoryValue)} helper="Estimated at par level" trend="Monthly" emphasis="primary" />
          <MetricCard icon={AlertTriangle} label="Low Stock Items" value={dashboard.lowStock} helper="Below configured threshold" tone={dashboard.lowStock ? "warning" : "success"} />
          <MetricCard icon={PackagePlus} label="Pending Requests" value={dashboard.pendingRequests} helper="Draft / submitted / approved" tone={dashboard.pendingRequests ? "warning" : "success"} />
          <MetricCard icon={Sparkles} label="Variance Risk" value={dashboard.varianceRisk} helper="Overdue checks" tone={dashboard.varianceRisk ? "danger" : "success"} />
          <MetricCard icon={ClipboardCheck} label="Check Completion" value={`${dashboard.checkCompletion}%`} helper="Due groups completed" tone={dashboard.checkCompletion < 80 ? "warning" : "success"} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
          <SectionCard title="Inventory Health by Outlet" description="Operational stock health, variance and ordering snapshot.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Outlet</th>
                    <th>Health Score</th>
                    <th>Low Stock</th>
                    <th>Waste</th>
                    <th>Pending Orders</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {outletRows.map((row) => (
                    <tr key={row.outlet.id} className="transition hover:bg-primary/5">
                      <td className="py-3 font-bold text-text-primary">{row.outlet.name}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${row.completion}%` }} />
                          </div>
                          <span className="font-semibold">{row.completion}%</span>
                        </div>
                      </td>
                      <td>{row.lowStock}</td>
                      <td>{toCurrency(row.waste)}</td>
                      <td>{row.pendingOrders}</td>
                      <td><Badge tone={row.status === "Good" ? "success" : row.status === "Watch" ? "warning" : "danger"}>{row.status}</Badge></td>
                      <td><button className="text-xs font-bold text-primary" type="button" onClick={() => { setSelectedOutletId(row.outlet.id); ui?.navigate?.("inventory_stock_check"); }}>Open checks</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Smart Alerts" description="AI-style operational signals from stock checks, requests and movements.">
            {can.viewInsights && alerts.length ? (
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <div key={alert.title} className={`rounded-2xl border p-3 ${alert.tone === "danger" ? "border-rose-200 bg-rose-50" : alert.tone === "warning" ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="type-body-sm font-bold text-text-primary">{alert.title}</span>
                      <Badge tone={alert.tone}>{alert.category}</Badge>
                    </div>
                    <p className="mt-1 type-caption text-text-secondary">{alert.reason}</p>
                  </div>
                ))}
              </div>
            ) : <EmptyState title="No inventory alerts" description="Stock check, low stock and supplier delay alerts will appear here." />}
          </SectionCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="Stock Check Groups Summary" description="Frequency-based group schedule across selected outlets.">
            <div className="space-y-2">
              {scopedGroups.slice(0, 6).map((group) => (
                <div key={group.id} className="flex items-center justify-between rounded-2xl border border-border px-3 py-2.5">
                  <div>
                    <div className="type-body-sm font-bold text-text-primary">{group.name}</div>
                    <div className="type-caption text-text-secondary">{outletById.get(group.outletId)?.name} · {group.itemIds.length} items · {frequencyLabel(group)}</div>
                  </div>
                  <Badge tone={statusTone(dueStatus(group, data.checks, date).toLowerCase())}>{dueStatus(group, data.checks, date)}</Badge>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Recent Movements" description="Latest inventory audit trail.">
            {data.movements.length ? (
              <div className="space-y-2">
                {data.movements.slice(0, 6).map((movement) => {
                  const item = itemById.get(movement.itemId);
                  return (
                    <div key={movement.id} className="flex items-center justify-between rounded-2xl border border-border px-3 py-2.5">
                      <div>
                        <div className="type-body-sm font-bold text-text-primary">{item?.name ?? "Inventory item"}</div>
                        <div className="type-caption text-text-secondary">{formatDate(movement.date)} · {toTitle(movement.type)} · {outletById.get(movement.outletId)?.name}</div>
                      </div>
                      <span className="font-bold text-text-primary">{Number(movement.quantity) > 0 ? "+" : ""}{movement.quantity} {item?.unit}</span>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState title="No movement yet" description="Inventory movement history will appear here." />}
          </SectionCard>
        </div>
      </div>
    );
  }

  function renderMasterInventory() {
    return (
      <div className="space-y-4">
        {renderFilters()}
        <SectionCard
          title="Master Inventory List"
          description="Source of truth for all inventory items and outlet availability."
          action={(
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" type="button" onClick={() => requirePermission(can.import, "import inventory")}>
                <Upload size={15} /> Import
              </button>
              <button className="btn-secondary" type="button" onClick={() => requirePermission(can.export, "export inventory")}>
                <Download size={15} /> Export
              </button>
              <button className="btn-primary" type="button" onClick={() => requirePermission(can.manageMaster, "manage master inventory") && setModal({ type: "item" })}>
                <PackagePlus size={15} /> Add Item
              </button>
            </div>
          )}
        >
          {visibleItems.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Item</th>
                    <th>Category</th>
                    <th>SKU Code</th>
                    <th>Unit</th>
                    <th>Linked Outlets</th>
                    <th>Low Stock</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {visibleItems.map((item) => {
                    const category = categoryById.get(item.categoryId);
                    return (
                      <tr key={item.id} className="transition hover:bg-primary/5">
                        <td className="py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-sm font-bold text-primary">
                              {item.photo ? <img src={item.photo} alt="" className="h-full w-full object-cover" /> : item.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-text-primary">{item.name}</div>
                              <div className="type-caption text-text-secondary">{item.description || item.inventoryType}</div>
                            </div>
                          </div>
                        </td>
                        <td>{category?.name ?? "Uncategorized"}</td>
                        <td className="font-mono text-xs text-text-secondary">{item.sku || "-"}</td>
                        <td>{item.unit}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {(item.linkedOutletIds || []).slice(0, 2).map((id) => <Badge key={id} tone="neutral">{outletById.get(id)?.name ?? "Outlet"}</Badge>)}
                            {(item.linkedOutletIds || []).length > 2 ? <Badge tone="info">+{item.linkedOutletIds.length - 2}</Badge> : null}
                          </div>
                        </td>
                        <td>{item.lowStockThreshold} {item.unit}</td>
                        <td><Badge tone={statusTone(item.status)}>{toTitle(item.status)}</Badge></td>
                        <td>
                          <div className="flex justify-end gap-2">
                            <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageMaster, "edit inventory items") && setModal({ type: "item", item })}>Edit</button>
                            <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageMaster, "archive inventory items") && archiveItem(item.id)}>Archive</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Create your first inventory item to start stock tracking." description="Inventory items can be linked to one or multiple outlets." />}
        </SectionCard>

        <SectionCard
          title="Inventory Categories"
          description="Manage item categories used in filters, stock checks and reports."
          action={<button className="btn-secondary" type="button" onClick={() => requirePermission(can.manageCategories, "manage inventory categories") && setModal({ type: "category" })}>Add Category</button>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {data.categories.map((category) => (
              <button key={category.id} className="rounded-2xl border border-border p-3 text-left transition hover:border-primary/30 hover:bg-primary/5" type="button" onClick={() => requirePermission(can.manageCategories, "edit categories") && setModal({ type: "category", category })}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-text-primary">{category.name}</div>
                  <Badge tone={statusTone(category.status)}>{toTitle(category.status)}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 type-caption text-text-secondary">{category.description}</p>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
    );
  }

  function renderGroups() {
    return (
      <SectionCard
        title="Stock Check Groups"
        description="Configure outlet-level count groups and frequency. Daily Stock Check only shows groups that are due."
        action={<button className="btn-primary" type="button" onClick={() => requirePermission(can.manageGroups, "manage stock check groups") && setModal({ type: "group" })}><PackagePlus size={15} /> Add Group</button>}
      >
        {data.groups.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {data.groups.filter((group) => selectedOutletId === "all" || group.outletId === selectedOutletId).map((group) => (
              <div key={group.id} className="rounded-2xl border border-border bg-white p-4 transition hover:border-primary/25 hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="type-title font-bold text-text-primary">{group.name}</div>
                    <div className="mt-1 type-caption text-text-secondary">{outletById.get(group.outletId)?.name} · {group.itemIds.length} items · {group.shift}</div>
                  </div>
                  <Badge tone={statusTone(dueStatus(group, data.checks, date).toLowerCase())}>{dueStatus(group, data.checks, date)}</Badge>
                </div>
                <p className="mt-3 type-body-sm text-text-secondary">{group.description || "No description provided."}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <MiniPill tone="info">{frequencyLabel(group)}</MiniPill>
                  <MiniPill tone={statusTone(group.status)}>{toTitle(group.status)}</MiniPill>
                  <MiniPill>Last checked {group.lastChecked ? formatDate(group.lastChecked) : "never"}</MiniPill>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button">View Items</button>
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageGroups, "edit stock check groups") && setModal({ type: "group", group })}>Edit</button>
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageGroups, "duplicate stock check groups") && setModal({ type: "group", group: { ...group, id: "", name: `${group.name} Copy` } })}>Duplicate</button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Set up stock check groups so outlets know what to count." description="Groups decide which inventory items appear in daily, weekly or custom checks." />}
      </SectionCard>
    );
  }

  function renderStockCheck() {
    if (activeCheckGroup) {
      return (
        <div className="space-y-4">
          <SectionCard
            title={activeCheckGroup.name}
            description={`${outletById.get(activeCheckGroup.outletId)?.name} · ${activeCheckGroup.shift} · ${formatDate(date)}`}
            action={<button className="btn-secondary" type="button" onClick={() => setActiveCheckGroupId(null)}>Back to Due Checks</button>}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Item</th>
                    <th>Par Level</th>
                    <th>Actual Count</th>
                    <th>Variance</th>
                    <th>Unit</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {checkRows.map((row, index) => {
                    const item = itemById.get(row.itemId);
                    const category = categoryById.get(item?.categoryId);
                    const result = varianceStatus(item?.parLevel, row.actualCount);
                    return (
                      <tr key={row.itemId} className="align-top">
                        <td className="py-3">
                          <div className="font-bold text-text-primary">{item?.name}</div>
                          <div className="type-caption text-text-secondary">{category?.name ?? "Uncategorized"}</div>
                        </td>
                        <td>{item?.parLevel}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button className="icon-btn h-8 w-8" type="button" onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Math.max(0, Number(entry.actualCount || 0) - 1), na: false } : entry))}>-</button>
                            <input className="control h-8 w-20 text-center text-[13px]" type="number" value={row.actualCount} onChange={(event) => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Number(event.target.value || 0), na: false } : entry))} />
                            <button className="icon-btn h-8 w-8" type="button" onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Number(entry.actualCount || 0) + 1, na: false } : entry))}>+</button>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {[
                              ["Full", item?.parLevel ?? 0],
                              ["Half", Math.round(Number(item?.parLevel || 0) / 2)],
                              ["Empty", 0],
                              ["NA", row.actualCount],
                            ].map(([label, value]) => (
                              <button key={label} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary" type="button" onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Number(value || 0), na: label === "NA" } : entry))}>{label}</button>
                            ))}
                          </div>
                        </td>
                        <td className="font-semibold">{row.na ? "NA" : result.variance}</td>
                        <td>{item?.unit}</td>
                        <td><Badge tone={row.na ? "neutral" : result.tone}>{row.na ? "NA" : result.label}</Badge></td>
                        <td><input className="control h-8 w-full text-[13px]" value={row.notes} onChange={(event) => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, notes: event.target.value } : entry))} placeholder="Optional note" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
          <div className="sticky bottom-4 z-20 flex flex-col gap-2 rounded-2xl border border-border bg-white/95 p-3 shadow-card backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2 type-caption font-semibold text-text-secondary">
              <span>{checkRows.length} items checked</span>
              <span>·</span>
              <span>{checkRows.filter((row) => varianceStatus(itemById.get(row.itemId)?.parLevel, row.actualCount).tone === "danger").length} critical items</span>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" type="button" onClick={() => requirePermission(can.editCheck, "save stock check drafts") && saveStockCheck("draft")}>Save Draft</button>
              <button className="btn-primary" type="button" onClick={() => requirePermission(can.createCheck, "submit stock checks") && saveStockCheck("submitted")}>Submit Stock Check</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="card flex flex-col gap-3 p-3 md:flex-row md:items-end">
          <SelectField label="Outlet" value={selectedOutletId} options={[{ value: "all", label: "All Outlets" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} onChange={setSelectedOutletId} searchable className="md:w-64" />
          <Field label="Date" type="date" value={date} onChange={setDate} />
          <SelectField label="Shift" value="all" options={[{ value: "all", label: "All Shifts" }, ...shifts.map((shift) => ({ value: shift, label: shift }))]} onChange={() => {}} className="md:w-48" />
        </div>
        <SectionCard title="Today's Required Checks" description="Only due groups appear here; outlets are not asked to count every item every day.">
          {dueGroups.length ? (
            <div className="grid gap-3 xl:grid-cols-3">
              {dueGroups.map((group) => {
                const status = dueStatus(group, data.checks, date);
                const hasDraft = data.checks.some((check) => check.groupId === group.id && check.date === date && check.status === "draft");
                return (
                  <div key={group.id} className="rounded-2xl border border-border bg-white p-4 transition hover:border-primary/30 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="type-title font-bold text-text-primary">{group.name}</div>
                        <div className="type-caption text-text-secondary">{outletById.get(group.outletId)?.name} · {group.itemIds.length} items</div>
                      </div>
                      <Badge tone={statusTone(status.toLowerCase())}>{status}</Badge>
                    </div>
                    <div className="mt-4 space-y-1 type-caption text-text-secondary">
                      <div>Frequency: <span className="font-semibold text-text-primary">{frequencyLabel(group)}</span></div>
                      <div>Last checked: <span className="font-semibold text-text-primary">{group.lastChecked ? formatDate(group.lastChecked) : "Never"}</span></div>
                    </div>
                    <button className="btn-primary mt-4 w-full" type="button" disabled={status === "Completed"} onClick={() => requirePermission(can.createCheck, "start stock checks") && setActiveCheckGroupId(group.id)}>
                      {hasDraft ? "Continue Draft" : "Start Check"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No stock check required today." description="Due groups will appear automatically based on each group's frequency and check days." />}
        </SectionCard>
      </div>
    );
  }

  function renderRequests() {
    return (
      <SectionCard
        title="Stock Requests"
        description="Outlet replenishment requests can be drafted, submitted, approved and converted to purchase orders."
        action={<button className="btn-primary" type="button" onClick={() => requirePermission(can.createRequest, "create stock requests") && setModal({ type: "request" })}><PackagePlus size={15} /> New Request</button>}
      >
        {data.requests.length ? (
          <div className="space-y-3">
            {data.requests.filter((request) => selectedOutletId === "all" || request.outletId === selectedOutletId).map((request) => (
              <div key={request.id} className="rounded-2xl border border-border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="type-title font-bold text-text-primary">{request.requestNo}</div>
                    <div className="type-caption text-text-secondary">{outletById.get(request.outletId)?.name} · {formatDate(request.date)} · {request.lines.length} items</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={statusTone(request.status)}>{toTitle(request.status)}</Badge>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" disabled={request.status !== "draft"} onClick={() => setData((current) => ({ ...current, requests: current.requests.map((entry) => entry.id === request.id ? { ...entry, status: "submitted" } : entry) }))}>Submit</button>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" disabled={!["submitted", "draft"].includes(request.status)} onClick={() => requirePermission(can.approveRequest, "approve stock requests") && approveRequest(request.id)}>Approve</button>
                    <button className="btn-primary h-8 px-2.5 text-xs" type="button" disabled={!["approved", "partial approved"].includes(request.status)} onClick={() => requirePermission(can.generatePo, "generate purchase orders") && convertRequestToPo(request)}>Convert to PO</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No stock requests submitted yet." description="Create a request from low stock items or outlet replenishment needs." />}
      </SectionCard>
    );
  }

  function renderOrders() {
    return (
      <SectionCard title="Purchase Orders" description="Approved requests become supplier grouped purchase orders.">
        {data.orders.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {data.orders.map((order) => {
              const supplier = suppliers.find((entry) => entry.id === order.supplierId);
              const total = order.lines.reduce((sum, line) => sum + Number(line.requestedQty || 0) * 8, 0);
              return (
                <div key={order.id} className="rounded-2xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="type-title font-bold text-text-primary">{supplier?.name ?? "Unassigned Supplier"}</div>
                      <div className="type-caption text-text-secondary">{order.poNo} · {order.lines.length} items · {toCurrency(total)}</div>
                    </div>
                    <Badge tone={statusTone(order.status)}>{toTitle(order.status)}</Badge>
                  </div>
                  <div className="mt-4 flex items-center gap-2 type-caption font-semibold text-text-secondary">
                    {["Draft", "Sent", "Confirmed", "Packing", "Delivered"].map((stage, index) => (
                      <span key={stage} className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-1 ${index === 0 ? "bg-primary/10 text-primary" : "bg-slate-100"}`}>{stage}</span>
                        {index < 4 ? <ArrowRight size={12} /> : null}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="No purchase orders yet." description="Convert approved stock requests into supplier purchase orders." />}
      </SectionCard>
    );
  }

  function renderMovements() {
    return (
      <SectionCard
        title="Inventory Movements"
        description="All purchase, transfer, waste, adjustment and production usage movements."
        action={<button className="btn-primary" type="button" onClick={() => requirePermission(can.recordMovement, "record inventory movements") && setModal({ type: "movement" })}><RefreshCw size={15} /> Record Movement</button>}
      >
        {data.movements.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                <tr className="border-b border-border">
                  <th className="py-2">Date & Time</th>
                  <th>Item</th>
                  <th>Movement Type</th>
                  <th>Qty</th>
                  <th>Outlet</th>
                  <th>User</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-[13px]">
                {data.movements.filter((movement) => selectedOutletId === "all" || movement.outletId === selectedOutletId).map((movement) => {
                  const item = itemById.get(movement.itemId);
                  return (
                    <tr key={movement.id}>
                      <td className="py-3">{formatDate(movement.date)}</td>
                      <td className="font-bold text-text-primary">{item?.name ?? "Inventory item"}</td>
                      <td><Badge tone={movement.type === "waste" ? "danger" : movement.type.includes("transfer") ? "info" : movement.type === "adjustment" ? "warning" : "success"}>{toTitle(movement.type)}</Badge></td>
                      <td>{Number(movement.quantity) > 0 ? "+" : ""}{movement.quantity} {item?.unit}</td>
                      <td>{outletById.get(movement.outletId)?.name ?? "-"}</td>
                      <td>{movement.user}</td>
                      <td>{movement.reference || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Inventory movement history will appear here." description="Record purchase, transfer, waste and adjustment movements." />}
      </SectionCard>
    );
  }

  function renderWaste() {
    if (!can.viewWaste) {
      return <EmptyState title="Permission required" description="You do not have permission to view Waste & Variance." />;
    }
    const wasteValue = data.waste.reduce((sum, row) => sum + Number(row.value || 0), 0);
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Waste Value" value={toCurrency(wasteValue)} helper="Recorded waste value" tone={wasteValue ? "warning" : "success"} />
          <MetricCard label="Waste % of Inventory" value={dashboard.inventoryValue ? `${((wasteValue / dashboard.inventoryValue) * 100).toFixed(1)}%` : "0%"} helper="Against estimated inventory value" />
          <MetricCard label="Highest Waste Outlet" value={outlets[0]?.name ?? "-"} helper="Based on current records" />
          <MetricCard label="Unexplained Loss %" value="0%" helper="No unexplained loss logged" />
        </div>
        <SectionCard
          title="Waste & Variance Insights"
          description="Rule-based operational signals for leakage and stock variance."
          action={<button className="btn-primary" type="button" onClick={() => requirePermission(can.recordWaste, "record waste") && setModal({ type: "waste" })}>Record Waste</button>}
        >
          <div className="grid gap-3 xl:grid-cols-3">
            {[
              "Oil usage variance will appear after recipe usage is connected.",
              "Stock check misses will appear when due checks become overdue.",
              "Top wasted items will appear after waste movements are recorded.",
            ].map((insight) => (
              <div key={insight} className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
                <div className="flex items-center gap-2 font-bold text-text-primary"><Sparkles size={15} className="text-primary" /> AI-style insight</div>
                <p className="mt-2 type-body-sm text-text-secondary">{insight}</p>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Waste Types" description="Spoilage, expired stock, kitchen error and unexplained leakage.">
          <div className="flex flex-wrap gap-2">{wasteTypes.map((type) => <Badge key={type} tone="neutral">{type}</Badge>)}</div>
        </SectionCard>
        <SectionCard title="Waste Records" description="Recorded waste entries for the selected outlet scope.">
          {data.waste.length ? (
            <div className="space-y-2">
              {data.waste.filter((row) => selectedOutletId === "all" || row.outletId === selectedOutletId).map((row) => {
                const item = itemById.get(row.itemId);
                return (
                  <div key={row.id} className="flex items-center justify-between rounded-2xl border border-border px-3 py-2.5">
                    <div>
                      <div className="type-body-sm font-bold text-text-primary">{item?.name ?? "Inventory item"}</div>
                      <div className="type-caption text-text-secondary">{formatDate(row.date)} · {row.wasteType} · {outletById.get(row.outletId)?.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-text-primary">{row.quantity} {item?.unit}</div>
                      <div className="type-caption text-text-secondary">{toCurrency(row.value)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No waste recorded yet." description="Waste and variance records will appear here." />}
        </SectionCard>
      </div>
    );
  }

  function renderRecipes() {
    return (
      <SectionCard title="Recipes & Usage" description="Future-ready recipe usage and production consumption workspace.">
        <EmptyState title="Recipes & Usage is ready for setup." description="Recipe-level consumption, staff meal usage and production variance can be connected here next." />
      </SectionCard>
    );
  }

  function renderActiveTab() {
    if (activeTab === "dashboard") return renderDashboard();
    if (activeTab === "master") return renderMasterInventory();
    if (activeTab === "groups") return renderGroups();
    if (activeTab === "stock-check") return renderStockCheck();
    if (activeTab === "requests") return renderRequests();
    if (activeTab === "orders") return renderOrders();
    if (activeTab === "movements") return renderMovements();
    if (activeTab === "waste") return renderWaste();
    return renderRecipes();
  }

  function renderPageActions() {
    if (activeTab === "master") {
      return (
        <>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.import, "import inventory")}>
            <Upload size={15} /> Import
          </button>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.export, "export inventory")}>
            <Download size={15} /> Export
          </button>
          <button className="btn-primary" type="button" onClick={() => requirePermission(can.manageMaster, "add inventory items") && setModal({ type: "item" })}>
            <PackagePlus size={15} /> Add Item
          </button>
        </>
      );
    }
    if (activeTab === "groups") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.manageGroups, "manage stock check groups") && setModal({ type: "group" })}><PackagePlus size={15} /> Add Group</button>;
    }
    if (activeTab === "requests") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.createRequest, "create stock requests") && setModal({ type: "request" })}><PackagePlus size={15} /> New Request</button>;
    }
    if (activeTab === "movements") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.recordMovement, "record inventory movements") && setModal({ type: "movement" })}><RefreshCw size={15} /> Record Movement</button>;
    }
    if (activeTab === "waste") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.recordWaste, "record waste") && setModal({ type: "waste" })}>Record Waste</button>;
    }
    return (
      <button className="btn-secondary" type="button" onClick={() => requirePermission(can.export, "export inventory")}>
        <Download size={15} /> Export
      </button>
    );
  }

  const meta = pageMeta[activeTab] ?? pageMeta.dashboard;

  return (
    <div className="space-y-4">
      <PageHeader
        section="INVENTORY CONTROL"
        title={meta.title}
        description={meta.description}
        actions={renderPageActions()}
      />

      <div className="rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/8 via-white to-white p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 type-body-sm font-semibold text-text-primary">
            <Filter size={15} className="text-primary" />
            Daily F&B stock operations workspace
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{outlets.length} accessible outlets</Badge>
            <Badge tone="info">{data.items.length} master items</Badge>
            <Badge tone="warning">{dueGroups.length} due checks</Badge>
          </div>
        </div>
      </div>

      {renderActiveTab()}

      {modal?.type === "item" ? <InventoryItemModal item={modal.item} categories={data.categories} outlets={outlets} suppliers={suppliers} onClose={() => setModal(null)} onSave={saveItem} /> : null}
      {modal?.type === "category" ? <CategoryModal category={modal.category} onClose={() => setModal(null)} onSave={saveCategory} /> : null}
      {modal?.type === "group" ? <GroupModal group={modal.group} outlets={outlets} items={data.items} categories={data.categories} onClose={() => setModal(null)} onSave={saveGroup} /> : null}
      {modal?.type === "request" ? <RequestModal outlets={outlets} items={data.items} categories={data.categories} suppliers={suppliers} onClose={() => setModal(null)} onSave={saveRequest} /> : null}
      {modal?.type === "movement" ? <MovementModal outlets={outlets} items={data.items} onClose={() => setModal(null)} onSave={saveMovement} /> : null}
      {modal?.type === "waste" ? <WasteModal outlets={outlets} items={data.items} onClose={() => setModal(null)} onSave={saveWaste} /> : null}
    </div>
  );
}

export default InventoryControlPage;
