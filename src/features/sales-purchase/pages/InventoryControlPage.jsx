import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  GripVertical,
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
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { supabase } from "../../../lib/supabase.ts";
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
  categories: {
    title: "Inventory Categories",
    description: "Manage inventory item categories used across master inventory and operational filters.",
  },
  "par-levels": {
    title: "Par Levels",
    description: "Bulk manage outlet-specific minimum stock levels.",
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
const statuses = ["active", "inactive", "archived"];
const frequencies = ["custom", "monthly"];
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

function canonical(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  if (group.frequency === "monthly") {
    if (group.monthDay === "last") return "Monthly · Last day";
    return `Monthly · Day ${group.monthDay || 1}`;
  }
  return "Custom";
}

function isGroupDue(group, date) {
  if (group.status !== "active") return false;
  const day = weekdayName(date);
  if (group.frequency === "custom") return (group.checkDays || []).includes(day);
  if (group.frequency === "monthly") {
    const target = new Date(date);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const configuredDay = group.monthDay === "last" ? lastDay : Math.min(Number(group.monthDay || 1), lastDay);
    return target.getDate() === configuredDay;
  }
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

function latestActualCount(checks = [], itemId, outletId) {
  const rows = checks
    .filter((check) => check.outletId === outletId && ["submitted", "reviewed", "locked"].includes(check.status))
    .flatMap((check) => (check.rows || []).map((row) => ({ ...row, checkDate: check.date, submittedAt: check.submittedAt })))
    .filter((row) => row.itemId === itemId && !row.na)
    .sort((a, b) => new Date(b.submittedAt || b.checkDate || 0) - new Date(a.submittedAt || a.checkDate || 0));
  return Number(rows[0]?.actualCount ?? Number.POSITIVE_INFINITY);
}

function groupCategoryIds(group = {}, items = []) {
  const directIds = group.categoryIds || group.category_ids || [];
  if (directIds.length) return uniqueIds(directIds);
  const itemIds = group.itemIds || group.item_ids || [];
  if (!itemIds.length) return [];
  const categoryIds = itemIds
    .map((itemId) => items.find((item) => item.id === itemId)?.categoryId)
    .filter(Boolean);
  return uniqueIds(categoryIds);
}

function itemHasActiveOutletLink(item = {}, outletId) {
  const configs = item.outletConfigs || [];
  if (configs.length) return configs.some((config) => config.outletId === outletId && config.isActive !== false);
  return (item.linkedOutletIds || []).includes(outletId);
}

function stockCheckItemsForGroup(group = {}, items = []) {
  const selectedCategories = new Set(groupCategoryIds(group, items));
  if (!selectedCategories.size) return [];
  return items
    .filter((item) => item.status === "active")
    .filter((item) => selectedCategories.has(item.categoryId))
    .filter((item) => itemHasActiveOutletLink(item, group.outletId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(new Error("Unable to read image. Please try another file."));
    reader.readAsDataURL(file);
  });
}

function parseCsvLine(line = "") {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] || "");
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return headers.reduce((record, header, cellIndex) => ({ ...record, [header]: cells[cellIndex] ?? "" }), { __row: index + 2 });
  });
  return { headers, rows };
}

function readUInt16(view, offset) {
  return view.getUint16(offset, true);
}

function readUInt32(view, offset) {
  return view.getUint32(offset, true);
}

function columnIndex(cellRef = "") {
  const letters = String(cellRef).match(/[A-Z]+/i)?.[0] ?? "A";
  return [...letters.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("XLSX parsing requires browser ZIP support. Please use CSV in this browser.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsx(buffer) {
  const view = new DataView(buffer);
  let eocdOffset = -1;
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 66000); offset -= 1) {
    if (readUInt32(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Unable to read XLSX workbook.");
  const entryCount = readUInt16(view, eocdOffset + 10);
  let centralOffset = readUInt32(view, eocdOffset + 16);
  const files = {};
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(view, centralOffset) !== 0x02014b50) break;
    const method = readUInt16(view, centralOffset + 10);
    const compressedSize = readUInt32(view, centralOffset + 20);
    const fileNameLength = readUInt16(view, centralOffset + 28);
    const extraLength = readUInt16(view, centralOffset + 30);
    const commentLength = readUInt16(view, centralOffset + 32);
    const localOffset = readUInt32(view, centralOffset + 42);
    const name = decoder.decode(new Uint8Array(buffer, centralOffset + 46, fileNameLength));
    const localNameLength = readUInt16(view, localOffset + 26);
    const localExtraLength = readUInt16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataOffset, compressedSize);
    const bytes = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (bytes) files[name] = decoder.decode(bytes);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function textFromXlsxCell(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "s") {
    const index = Number(cell.querySelector("v")?.textContent ?? -1);
    return sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") return [...cell.querySelectorAll("t")].map((item) => item.textContent ?? "").join("");
  return cell.querySelector("v")?.textContent ?? "";
}

async function parseXlsx(file) {
  const files = await unzipXlsx(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedStringsXml = files["xl/sharedStrings.xml"];
  const sharedStrings = sharedStringsXml
    ? [...parser.parseFromString(sharedStringsXml, "application/xml").querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((item) => item.textContent ?? "").join(""))
    : [];
  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("No worksheet found in XLSX file.");
  const sheet = parser.parseFromString(files[sheetName], "application/xml");
  const rawRows = [...sheet.querySelectorAll("sheetData row")].map((rowNode) => {
    const values = [];
    [...rowNode.querySelectorAll("c")].forEach((cell) => {
      values[columnIndex(cell.getAttribute("r"))] = textFromXlsxCell(cell, sharedStrings);
    });
    return values;
  }).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const headers = rawRows[0]?.map((cell) => String(cell ?? "").trim()) ?? [];
  const rows = rawRows.slice(1).map((row, index) => headers.reduce((record, header, cellIndex) => ({ ...record, [header]: row[cellIndex] ?? "" }), { __row: index + 2 }));
  return { headers, rows };
}

async function uploadInventoryItemPhoto(file, itemId = "draft") {
  const extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const { data, error } = await supabase.storage
    .from("inventory-item-photos")
    .upload(path, file, {
      contentType: file.type || `image/${extension}`,
      upsert: true,
    });
  if (error) throw error;
  const { data: publicUrlData } = supabase.storage.from("inventory-item-photos").getPublicUrl(data.path);
  return publicUrlData.publicUrl;
}

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getLinkedOutletIds(item = {}) {
  return uniqueIds([
    ...(item.linkedOutletIds || []),
    ...(item.outletConfigs || []).map((config) => config.outletId),
  ]);
}

function buildOutletConfig(item = {}, outletId, existing = {}) {
  const fallbackPar = Number(item.parLevel || 0);
  const parLevel = Number(existing.parLevel ?? fallbackPar);
  return {
    id: existing.id || `${item.id || "draft"}_${outletId}`,
    inventoryItemId: existing.inventoryItemId || item.id || "",
    outletId,
    parLevel,
    storageLocation: existing.storageLocation ?? "",
    supplierIds: uniqueIds(existing.supplierIds || existing.supplier_ids || []),
    isActive: existing.isActive !== false,
    createdAt: existing.createdAt || item.createdAt || "",
    updatedAt: existing.updatedAt || item.updatedAt || "",
  };
}

function normalizeInventoryItem(item = {}) {
  const linkedOutletIds = getLinkedOutletIds(item);
  const existingConfigs = new Map((item.outletConfigs || []).map((config) => [config.outletId, config]));
  return {
    ...item,
    photo: item.photo ?? item.photo_url ?? "",
    linkedOutletIds,
    outletConfigs: linkedOutletIds.map((outletId) => buildOutletConfig(item, outletId, existingConfigs.get(outletId))),
  };
}

function outletConfigForItem(item = {}, outletId) {
  if (!outletId) return buildOutletConfig(item, "");
  const existing = (item.outletConfigs || []).find((config) => config.outletId === outletId);
  return buildOutletConfig(item, outletId, existing);
}

function outletConfigsForScope(item = {}, outletIds = []) {
  const allowed = new Set(outletIds);
  return (normalizeInventoryItem(item).outletConfigs || []).filter((config) => (!outletIds.length || allowed.has(config.outletId)) && config.isActive !== false);
}

function parLevelForOutlet(item = {}, outletId) {
  return outletConfigForItem(item, outletId).parLevel;
}

function normalizeInventoryData(raw, outlets = [], suppliers = []) {
  const fallback = defaultData(outlets, suppliers);
  const source = raw || fallback;
  return {
    ...fallback,
    ...source,
    categories: source.categories?.length ? source.categories : fallback.categories,
    items: (source.items?.length ? source.items : fallback.items).map(normalizeInventoryItem),
    groups: source.groups ?? fallback.groups,
    checks: source.checks ?? [],
    requests: source.requests ?? [],
    orders: source.orders ?? [],
    movements: source.movements ?? fallback.movements,
    waste: source.waste ?? [],
    recipes: source.recipes ?? [],
  };
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
      parLevel: 24,
      status: "active",
      linkedOutletIds: [firstOutlet.id, secondOutlet.id],
      outletConfigs: [
        { id: "cfg_sambal_first", inventoryItemId: "item_sambal", outletId: firstOutlet.id, parLevel: 8, storageLocation: "Kitchen chiller", isActive: true },
        { id: "cfg_sambal_second", inventoryItemId: "item_sambal", outletId: secondOutlet.id, parLevel: 20, storageLocation: "Prep kitchen", isActive: true },
      ],
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
      parLevel: 800,
      status: "active",
      linkedOutletIds: [firstOutlet.id],
      outletConfigs: [
        { id: "cfg_cups_first", inventoryItemId: "item_cups", outletId: firstOutlet.id, parLevel: 800, storageLocation: "Front counter dry rack", isActive: true },
      ],
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
      parLevel: 60,
      status: "active",
      linkedOutletIds: [firstOutlet.id, secondOutlet.id],
      outletConfigs: [
        { id: "cfg_chicken_first", inventoryItemId: "item_chicken", outletId: firstOutlet.id, parLevel: 60, storageLocation: "Freezer A", isActive: true },
        { id: "cfg_chicken_second", inventoryItemId: "item_chicken", outletId: secondOutlet.id, parLevel: 45, storageLocation: "Freezer", isActive: true },
      ],
    },
  ];
  const groups = [
    {
      id: "group_kitchen_daily",
      outletId: firstOutlet.id,
      name: "Kitchen Daily",
      description: "Closing count for core kitchen stock.",
      categoryIds: ["inv_cat_1", "inv_cat_5"],
      itemIds: ["item_sambal", "item_chicken"],
      frequency: "custom",
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
      description: "Packaging stock check.",
      categoryIds: ["inv_cat_3"],
      itemIds: ["item_cups"],
      frequency: "custom",
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
    items: items.map(normalizeInventoryItem),
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
      return normalizeInventoryData(raw ? JSON.parse(raw) : null, outlets, suppliers);
    } catch {
      return normalizeInventoryData(null, outlets, suppliers);
    }
  });

  useEffect(() => {
    if (!outlets.length) return;
    setData((current) => {
      if (current.items?.length || current.groups?.length) return normalizeInventoryData(current, outlets, suppliers);
      return normalizeInventoryData(null, outlets, suppliers);
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

function LinkedOutletsSummary({ item, outlets, onConfigure }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const configs = normalizeInventoryItem(item).outletConfigs || [];
  const activeCount = configs.filter((config) => config.isActive !== false).length;

  return (
    <div ref={anchorRef} className="inline-flex">
      <button
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 type-caption font-bold text-text-primary transition hover:border-primary/30 hover:text-primary"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {configs.length} outlet{configs.length === 1 ? "" : "s"}
        <ChevronDown size={13} />
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" width={320} estimatedHeight={280} className="p-0">
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="type-body-sm font-bold text-text-primary">Linked Outlets</div>
              <div className="type-caption text-text-secondary">{activeCount} active configuration{activeCount === 1 ? "" : "s"}</div>
            </div>
            <Badge tone="info">{item.unit}</Badge>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {configs.length ? configs.map((config) => {
              const outlet = outletById.get(config.outletId);
              return (
                <div key={config.outletId} className="rounded-xl border border-border bg-slate-50/70 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="type-body-sm font-bold text-text-primary">{outlet?.name ?? "Unknown outlet"}</div>
                      <div className="type-caption text-text-secondary">{outlet?.code || outlet?.shortCode || outlet?.short_code || "No outlet code"}</div>
                    </div>
                    <Badge tone={config.isActive === false ? "neutral" : "success"}>{config.isActive === false ? "Inactive link" : "Active"}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 type-caption text-text-secondary">
                    <span>Par <strong className="text-text-primary">{config.parLevel}</strong></span>
                    <span>{config.storageLocation || "No location"}</span>
                  </div>
                </div>
              );
            }) : <EmptyState title="No linked outlets" description="Configure outlet stock settings before using this item operationally." />}
          </div>
          <button
            className="btn-secondary mt-3 w-full justify-center"
            type="button"
            onClick={() => {
              setOpen(false);
              onConfigure?.();
            }}
          >
            Open Par Level Setup
          </button>
        </div>
      </FloatingLayer>
    </div>
  );
}

function SupplierAssignmentPicker({ suppliers, outletId, selectedIds = [], onSave }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState(selectedIds);
  const selected = new Set(draftIds);
  const outletSuppliers = useMemo(() => suppliers
    .filter((supplier) => supplier.status === "active" || supplier.is_active === true)
    .filter((supplier) => (supplier.outletIds || supplier.assignedOutletIds || []).includes(outletId))
    .filter((supplier) => !query.trim() || supplier.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [suppliers, outletId, query]);
  const selectedSuppliers = suppliers.filter((supplier) => selectedIds.includes(supplier.id));
  const label = selectedSuppliers.length === 0
    ? "No supplier"
    : selectedSuppliers.length === 1
      ? selectedSuppliers[0].name
      : `${selectedSuppliers.length} suppliers`;

  useEffect(() => {
    if (open) setDraftIds(selectedIds);
  }, [open, selectedIds]);

  return (
    <>
      <button
        ref={anchorRef}
        className="inline-flex h-8 max-w-[180px] items-center gap-1 rounded-full border border-border bg-white px-2.5 type-caption font-bold text-text-primary transition hover:border-primary/30 hover:text-primary"
        type="button"
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0 text-text-muted" />
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" minWidth={280} estimatedHeight={340}>
        <div className="space-y-2">
          <div className="px-1">
            <div className="type-caption font-bold text-text-primary">Assign suppliers</div>
            <div className="type-micro text-text-muted">Only suppliers linked to this outlet are shown.</div>
          </div>
          <input
            className="control h-8 w-full text-[12px]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search suppliers"
          />
          {draftIds.length ? (
            <div className="flex flex-wrap gap-1">
              {suppliers.filter((supplier) => draftIds.includes(supplier.id)).map((supplier) => (
                <span key={supplier.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{supplier.name}</span>
              ))}
            </div>
          ) : null}
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {outletSuppliers.length ? outletSuppliers.map((supplier) => {
              const checked = selected.has(supplier.id);
              return (
                <label key={supplier.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-primary/5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(draftIds);
                      if (event.target.checked) next.add(supplier.id);
                      else next.delete(supplier.id);
                      setDraftIds([...next]);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate type-body-sm font-semibold text-text-primary">{supplier.name}</span>
                </label>
              );
            }) : (
              <div className="rounded-xl bg-slate-50 px-3 py-2 type-caption font-semibold text-text-secondary">
                No active suppliers linked to this outlet.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-2">
            <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary h-8 px-2.5 text-xs" type="button" onClick={() => { onSave(draftIds); setOpen(false); }}>Save</button>
          </div>
        </div>
      </FloatingLayer>
    </>
  );
}

function ItemPhotoPicker({ value, itemId, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Please use an image below 2MB.");
      return;
    }

    setUploading(true);
    try {
      const preview = await readFileAsDataUrl(file);
      onChange(preview);
      try {
        const publicUrl = await uploadInventoryItemPhoto(file, itemId || "draft");
        onChange(publicUrl);
      } catch (uploadError) {
        console.warn("[InventoryControl] Item photo upload failed", uploadError);
        setError("Photo preview is shown, but upload storage is not ready. Please check the inventory-item-photos bucket.");
      }
    } catch (readError) {
      setError(readError.message || "Unable to read image. Please try another file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="mb-1 type-caption font-semibold text-text-secondary">Item Photo</div>
      <div className="rounded-2xl border border-border bg-slate-50/70 p-3">
        {value ? (
          <div className="flex items-center gap-3">
            <img className="h-20 w-20 rounded-2xl border border-border object-cover" src={value} alt="Item preview" />
            <div className="min-w-0 flex-1">
              <div className="type-body-sm font-bold text-text-primary">Photo selected</div>
              <div className="type-caption text-text-secondary">{uploading ? "Uploading to inventory-item-photos..." : "Thumbnail appears in Master Inventory."}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="btn-secondary h-8 cursor-pointer px-3 text-xs">
                  Replace photo
                  <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleFile(event.target.files?.[0])} />
                </label>
                <button className="btn-secondary h-8 px-3 text-xs text-rose-600" type="button" onClick={() => { setError(""); onChange(""); }}>Remove</button>
              </div>
            </div>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 py-5 text-center transition hover:border-primary/40 hover:bg-primary/5">
            <Upload size={18} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">{uploading ? "Uploading..." : "Upload item photo"}</span>
            <span className="mt-0.5 type-caption text-text-muted">PNG/JPG/WebP</span>
            <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
        )}
        {error ? <div className="mt-2 type-caption font-semibold text-amber-700">{error}</div> : null}
      </div>
    </div>
  );
}

const inventoryImportColumns = ["Item Name", "SKU Code", "Category", "Unit", "Description", "Default Supplier", "Status", "Linked Outlets", "Photo URL"];

function readImportValue(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => canonical(key) === canonical(alias));
    if (found) return String(found[1] ?? "").trim();
  }
  return "";
}

function buildInventoryImportPreview(rows, { categories, outlets, suppliers, items }) {
  const categoryByName = new Map(categories.map((category) => [canonical(category.name), category]));
  const outletByKey = new Map(outlets.flatMap((outlet) => [
    [canonical(outlet.code || outlet.shortCode || outlet.short_code || ""), outlet],
    [canonical(outlet.name), outlet],
  ]).filter(([key]) => key));
  const supplierByName = new Map(suppliers.map((supplier) => [canonical(supplier.name), supplier]));
  const existingBySku = new Map(items.filter((item) => item.sku).map((item) => [canonical(item.sku), item]));
  const existingByName = new Map(items.map((item) => [canonical(item.name), item]));
  const seenSkus = new Map();
  const seenNamesWithoutSku = new Map();

  return rows.map((row) => {
    const name = readImportValue(row, ["Item Name", "Name", "Item"]);
    const sku = readImportValue(row, ["SKU Code", "SKU"]);
    const categoryName = readImportValue(row, ["Category"]);
    const unit = readImportValue(row, ["Unit"]);
    const description = readImportValue(row, ["Description"]);
    const supplierName = readImportValue(row, ["Default Supplier", "Supplier"]);
    const status = (readImportValue(row, ["Status"]) || "active").toLowerCase();
    const linkedOutletText = readImportValue(row, ["Linked Outlets", "Outlets"]);
    const photo = readImportValue(row, ["Photo URL", "Photo", "Photo Url"]);
    const errors = [];
    const warnings = [];

    if (!name) errors.push("Missing Item Name");
    if (!categoryName) errors.push("Missing Category");
    const category = categoryByName.get(canonical(categoryName));
    if (categoryName && !category) errors.push("Unknown Category");
    if (!unit) errors.push("Missing Unit");
    if (unit && !units.map(canonical).includes(canonical(unit))) errors.push("Invalid Unit");
    if (!["active", "inactive", "archived"].includes(status)) errors.push("Invalid Status");

    const skuKey = canonical(sku);
    const nameKey = canonical(name);
    if (skuKey) {
      if (seenSkus.has(skuKey)) errors.push("Duplicate SKU in file");
      seenSkus.set(skuKey, row.__row);
    } else if (nameKey) {
      if (seenNamesWithoutSku.has(nameKey)) errors.push("Duplicate item name without SKU");
      seenNamesWithoutSku.set(nameKey, row.__row);
    }

    const linkedOutlets = linkedOutletText
      ? linkedOutletText.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const outlet = outletByKey.get(canonical(entry));
        if (!outlet) errors.push(`Unknown Outlet: ${entry}`);
        return outlet;
      }).filter(Boolean)
      : [];
    const supplier = supplierName ? supplierByName.get(canonical(supplierName)) : null;
    if (supplierName && !supplier) errors.push("Unknown Supplier");
    const existing = skuKey ? existingBySku.get(skuKey) : existingByName.get(nameKey);

    return {
      rowNumber: row.__row,
      source: row,
      action: existing ? "update" : "create",
      errors,
      warnings,
      item: {
        id: existing?.id || "",
        name,
        sku,
        categoryId: category?.id || "",
        unit,
        description,
        defaultSupplierId: supplier?.id || existing?.defaultSupplierId || "",
        status,
        photo: photo || existing?.photo || existing?.photo_url || "",
        linkedOutletIds: linkedOutlets.length ? linkedOutlets.map((outlet) => outlet.id) : existing?.linkedOutletIds || [],
      },
    };
  });
}

function InventoryImportModal({ categories, outlets, suppliers, items, onClose, onImport }) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(null);
  const validRows = preview.filter((row) => !row.errors.length);
  const failedRows = preview.filter((row) => row.errors.length);

  async function handleFile(file) {
    setError("");
    setComplete(null);
    setPreview([]);
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx"].includes(extension)) {
      setError("Please upload CSV or XLSX only.");
      return;
    }
    try {
      setFileName(file.name);
      const parsed = extension === "xlsx" ? await parseXlsx(file) : parseCsv(await file.text());
      const built = buildInventoryImportPreview(parsed.rows, { categories, outlets, suppliers, items });
      setPreview(built);
    } catch (parseError) {
      setError(parseError.message || "Unable to parse import file.");
    }
  }

  function downloadTemplate() {
    const sampleCategory = categories[0]?.name || "Raw Material";
    const sampleOutlet = outlets[0]?.name || "Friends Corner";
    const text = [
      inventoryImportColumns.join(","),
      ["Sambal Sauce", "RAW-SAM-001", sampleCategory, "kg", "House sambal batch", suppliers[0]?.name || "", "active", sampleOutlet, ""].map(csvEscape).join(","),
    ].join("\n");
    downloadTextFile("feedx-master-inventory-template.csv", text);
  }

  function confirmImport() {
    const result = onImport(validRows);
    setComplete(result);
  }

  return (
    <Modal
      title="Import Master Inventory"
      description="Upload CSV or XLSX, validate rows, preview changes, then import valid rows."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-primary" type="button" disabled={!validRows.length || Boolean(complete)} onClick={confirmImport}>Confirm Import</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center transition hover:bg-primary/10">
            <Upload size={20} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">{fileName || "Upload CSV or XLSX"}</span>
            <span className="type-caption text-text-secondary">Required: Item Name, Category, Unit</span>
            <input className="sr-only" type="file" accept=".csv,.xlsx" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
          <button className="btn-secondary" type="button" onClick={downloadTemplate}><Download size={15} /> Download Template</button>
        </div>
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 type-body-sm font-semibold text-rose-700">{error}</div> : null}
        {preview.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Rows" value={preview.length} helper="Parsed from file" />
              <MetricCard label="Valid" value={validRows.length} helper="Ready to import" tone="success" />
              <MetricCard label="Failed" value={failedRows.length} helper="Can be skipped" tone={failedRows.length ? "danger" : "success"} />
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th>Action</th>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Unit</th>
                    <th>Linked Outlets</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {preview.slice(0, 80).map((row) => (
                    <tr key={row.rowNumber} className={row.errors.length ? "bg-rose-50/50" : "bg-white"}>
                      <td className="px-3 py-2 font-mono text-xs">{row.rowNumber}</td>
                      <td><Badge tone={row.action === "create" ? "success" : "info"}>{toTitle(row.action)}</Badge></td>
                      <td className="font-bold text-text-primary">{row.item.name || "-"}</td>
                      <td>{categoryByIdName(categories, row.item.categoryId)}</td>
                      <td>{row.item.unit || "-"}</td>
                      <td>{row.item.linkedOutletIds.length} outlet{row.item.linkedOutletIds.length === 1 ? "" : "s"}</td>
                      <td className={row.errors.length ? "text-rose-700" : "text-emerald-700"}>{row.errors.length ? row.errors.join("; ") : "Ready"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {complete ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 type-body-sm font-semibold text-emerald-700">Import complete: {complete.created} created · {complete.updated} updated · {failedRows.length} skipped.</div> : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function categoryByIdName(categories, categoryId) {
  return categories.find((category) => category.id === categoryId)?.name || "Uncategorized";
}

function InventoryItemModal({ item, categories, outlets, suppliers, onClose, onSave }) {
  const initialItem = normalizeInventoryItem(item ?? {
    id: "",
    name: "",
    sku: "",
    categoryId: categories[0]?.id ?? "",
    unit: "kg",
    photo: "",
    description: "",
    inventoryType: item?.inventoryType ?? "",
    defaultSupplierId: "",
    status: "active",
    linkedOutletIds: outlets[0]?.id ? [outlets[0].id] : [],
  });
  const [form, setForm] = useState(initialItem);
  const [touched, setTouched] = useState(false);
  const invalid = touched && (!form.name.trim() || !form.categoryId || !form.unit || !form.linkedOutletIds?.length);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLinkedOutlets(ids) {
    setForm((current) => {
      const next = { ...current, linkedOutletIds: ids };
      const existing = new Map((current.outletConfigs || []).map((config) => [config.outletId, config]));
      next.outletConfigs = ids.map((outletId) => buildOutletConfig(current, outletId, existing.get(outletId)));
      return next;
    });
  }

  return (
    <Modal
      title={item ? "Edit Inventory Item" : "Add Inventory Item"}
      description="Define the global item identity. Par levels are managed separately in Par Level Setup."
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
              const id = form.id || makeId("item");
              onSave(normalizeInventoryItem({ ...form, id, outletConfigs: (form.outletConfigs || []).map((config) => ({ ...config, inventoryItemId: id })) }));
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
        <SelectField label="Default Supplier" value={form.defaultSupplierId} placeholder="Optional" options={[{ value: "", label: "No default supplier" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} onChange={(value) => update("defaultSupplierId", value)} searchable />
        <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
        <div className="md:col-span-2">
          <ItemPhotoPicker value={form.photo} itemId={form.id || form.sku || "draft"} onChange={(value) => update("photo", value)} />
        </div>
        <div className="md:col-span-2">
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} placeholder="Short operational description." />
        </div>
        <div className="md:col-span-2">
          <MultiOutletPicker outlets={outlets} selectedIds={form.linkedOutletIds} onChange={updateLinkedOutlets} />
          <div className="mt-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 type-caption text-text-secondary">
            Par levels can be managed in <span className="font-bold text-text-primary">Par Level Setup</span> after the item is saved.
          </div>
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
        <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
      </div>
    </Modal>
  );
}

function CategorySettingsModal({ categories, itemCounts, canAdd, canEdit, canDelete, requirePermission, onAdd, onEdit, onArchive, onDelete, onSort, onClose }) {
  const [draggedId, setDraggedId] = useState(null);

  function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) return;
    onSort(draggedId, targetId);
    setDraggedId(null);
  }

  return (
    <Modal
      title="Inventory Category Settings"
      description="Manage categories used by master inventory items, stock checks and reports."
      size="xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="type-caption text-text-secondary">{categories.length} configured categor{categories.length === 1 ? "y" : "ies"}</div>
          <div className="type-caption text-text-muted">Drag categories to control display order in inventory filters and item forms.</div>
        </div>
        <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={() => requirePermission(canAdd, "add inventory categories") && onAdd()}>
          <PackagePlus size={14} /> Add Category
        </button>
      </div>

      {categories.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {categories.map((category) => {
            const linkedCount = itemCounts.get(category.id) || 0;
            return (
              <div
                key={category.id}
                draggable={canEdit}
                onDragStart={(event) => {
                  if (!canEdit) return;
                  setDraggedId(category.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => {
                  if (canEdit) event.preventDefault();
                }}
                onDrop={() => handleDrop(category.id)}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 transition last:border-b-0 hover:bg-primary/5 ${
                  draggedId === category.id ? "bg-primary/8 opacity-70" : ""
                }`}
              >
                <button
                  className={`icon-btn h-8 w-8 cursor-grab text-text-muted ${canEdit ? "" : "opacity-40"}`}
                  type="button"
                  title={canEdit ? "Drag to reorder" : "Reordering requires edit permission"}
                  aria-label="Drag to reorder category"
                >
                  <GripVertical size={16} />
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate type-body-sm font-bold text-text-primary">{category.name}</div>
                    <Badge tone={statusTone(category.status)}>{toTitle(category.status)}</Badge>
                  </div>
                  <div className="mt-0.5 truncate type-caption text-text-secondary">{category.description || "No description provided."}</div>
                  <div className="mt-1 type-caption font-semibold text-text-muted">{linkedCount} linked item{linkedCount === 1 ? "" : "s"}</div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canEdit, "edit inventory categories") && onEdit(category)}>Edit</button>
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canDelete, "archive inventory categories") && onArchive(category)}>Archive</button>
                  {linkedCount === 0 ? (
                    <button className="icon-btn h-8 w-8 text-rose-600" type="button" onClick={() => requirePermission(canDelete, "delete inventory categories") && onDelete(category)} title="Delete category">
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Create your first inventory category to organize items." description="Categories keep filters, item forms and reports easier to scan." />
      )}
    </Modal>
  );
}

function GroupModal({ group, outlets, items, categories, onClose, onSave }) {
  const initialGroup = group ? {
    ...group,
    categoryIds: groupCategoryIds(group, items),
    frequency: frequencies.includes(group.frequency) ? group.frequency : "custom",
    checkDays: group.checkDays?.length ? group.checkDays : [weekdayName()],
  } : {
    id: "",
    outletId: outlets[0]?.id ?? "",
    name: "",
    description: "",
    categoryIds: [],
    itemIds: [],
    frequency: "custom",
    checkDays: [weekdayName()],
    monthDay: 1,
    shift: "Closing",
    assignedStaff: "",
    status: "active",
    lastChecked: "",
  };
  const [form, setForm] = useState(initialGroup);
  const selected = new Set(form.categoryIds || []);
  const categoryCounts = useMemo(() => {
    const counts = new Map();
    items
      .filter((item) => item.status === "active")
      .filter((item) => itemHasActiveOutletLink(item, form.outletId))
      .forEach((item) => counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1));
    return counts;
  }, [items, form.outletId]);
  const allowedCategories = useMemo(() => categories
    .filter((category) => category.status !== "archived")
    .filter((category) => (categoryCounts.get(category.id) || 0) > 0 || selected.has(category.id)),
  [categories, categoryCounts, selected]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      title={group ? "Edit Stock Check Group" : "Add Stock Check Group"}
      description="Group the categories this outlet needs to count for the selected schedule."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!form.name.trim() || !form.outletId || !form.categoryIds.length} onClick={() => onSave({ ...form, id: form.id || makeId("group"), itemIds: [] })}>Save Group</button>
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
          {form.frequency === "monthly" ? (
            <SelectField
              label="Monthly Rule"
              value={String(form.monthDay || 1)}
              options={[
                ...Array.from({ length: 28 }, (_, index) => {
                  const day = index + 1;
                  const suffix = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
                  return { value: String(day), label: `${day}${suffix} day of month` };
                }),
                { value: "last", label: "Last day of month" },
              ]}
              onChange={(value) => update("monthDay", value === "last" ? "last" : Number(value))}
            />
          ) : null}
          {form.frequency === "custom" ? (
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
              <div className="type-title font-bold text-text-primary">Linked Categories</div>
              <div className="type-caption text-text-secondary">Items are loaded automatically from the selected categories for this outlet.</div>
            </div>
            <Badge tone="info">{selected.size} selected</Badge>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {allowedCategories.length ? allowedCategories.map((category) => {
              const active = selected.has(category.id);
              const linkedCount = categoryCounts.get(category.id) || 0;
              return (
                <button
                  key={category.id}
                  className={`flex w-full items-start justify-between gap-3 rounded-2xl border p-3 text-left transition ${active ? "border-primary/40 bg-white shadow-sm" : "border-border bg-white/70 hover:border-slate-300"}`}
                  type="button"
                  onClick={() => {
                    const next = new Set(selected);
                    if (next.has(category.id)) next.delete(category.id);
                    else next.add(category.id);
                    update("categoryIds", [...next]);
                  }}
                >
                  <span>
                    <span className="block type-body-sm font-bold text-text-primary">{category.name}</span>
                    <span className="mt-1 block type-caption text-text-secondary">{linkedCount} linked active item{linkedCount === 1 ? "" : "s"} for {outlets.find((outlet) => outlet.id === form.outletId)?.name || "selected outlet"}</span>
                  </span>
                  {active ? <CheckCircle2 className="text-primary" size={18} /> : null}
                </button>
              );
            }) : <EmptyState title="No linked categories" description="Only categories with active items linked to this outlet are shown." />}
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
    const suggestedQty = Math.max(1, Number(parLevelForOutlet(item, outletId) || 0));
    setLines((current) => [...current, { itemId: item.id, currentQty: 0, suggestedQty, requestedQty: suggestedQty, priority: "Normal", notes: "" }]);
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
                      <span className="type-caption text-text-secondary">{category?.name ?? "Uncategorized"} · Par {parLevelForOutlet(item, outletId)} {item.unit}</span>
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
  const [masterGroupBy, setMasterGroupBy] = useState("category");
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState(() => new Set());
  const [parLevelView, setParLevelView] = useState("outlet");
  const [parLevelGroupBy, setParLevelGroupBy] = useState("category");
  const [collapsedParCategoryIds, setCollapsedParCategoryIds] = useState(() => new Set());
  const [parLevelOutletId, setParLevelOutletId] = useState(outlets[0]?.id ?? "");
  const [date, setDate] = useState(todayInput());
  const [modal, setModal] = useState(null);
  const [activeCheckGroupId, setActiveCheckGroupId] = useState(null);
  const [checkRows, setCheckRows] = useState([]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!parLevelOutletId && outlets[0]?.id) setParLevelOutletId(outlets[0].id);
  }, [outlets, parLevelOutletId]);

  const can = useMemo(() => ({
    import: canImport(auth, INVENTORY_MODULE) || hasPermission(auth, "inventory_master.import"),
    export: canExport(auth, INVENTORY_MODULE) || hasPermission(auth, "inventory_master.export") || hasPermission(auth, "inventory_orders.export") || hasPermission(auth, "inventory_movements.export") || hasPermission(auth, "inventory_waste.export"),
    manageMaster: hasPermission(auth, "inventory_master.create") || hasPermission(auth, "inventory_master.edit") || hasPermission(auth, "inventory_control.manage_master") || hasPermission(auth, "inventory_control.manage"),
    viewCategories: hasPermission(auth, "inventory_categories.view") || hasPermission(auth, "inventory_master.view") || hasPermission(auth, "inventory_control.view"),
    createCategory: hasPermission(auth, "inventory_categories.create") || hasPermission(auth, "inventory_control.manage_categories") || hasPermission(auth, "inventory_control.manage"),
    editCategory: hasPermission(auth, "inventory_categories.edit") || hasPermission(auth, "inventory_control.manage_categories") || hasPermission(auth, "inventory_control.manage"),
    deleteCategory: hasPermission(auth, "inventory_categories.delete") || hasPermission(auth, "inventory_control.manage_categories") || hasPermission(auth, "inventory_control.manage"),
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

  const sortedCategories = useMemo(() => [...data.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name)), [data.categories]);
  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const itemCountByCategory = useMemo(() => {
    const counts = new Map();
    data.items.forEach((item) => counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1));
    return counts;
  }, [data.items]);
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);

  const visibleItems = useMemo(() => data.items.filter((item) => {
    const matchesOutlet = selectedOutletId === "all" || item.linkedOutletIds?.includes(selectedOutletId);
    const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    return matchesOutlet && matchesQuery && matchesCategory && matchesStatus;
  }), [data.items, selectedOutletId, query, categoryFilter, statusFilter]);
  const visibleItemGroups = useMemo(() => {
    const groups = new Map();
    visibleItems.forEach((item) => {
      const category = categoryById.get(item.categoryId);
      const key = item.categoryId || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
    });
    return [...groups.values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
  }, [visibleItems, categoryById]);

  const selectedOutletIds = selectedOutletId === "all" ? outlets.map((outlet) => outlet.id) : [selectedOutletId];
  const scopedGroups = data.groups.filter((group) => selectedOutletIds.includes(group.outletId));
  const dueGroups = scopedGroups.filter((group) => ["Due Today", "Completed", "Overdue"].includes(dueStatus(group, data.checks, date)));
  const activeCheckGroup = data.groups.find((group) => group.id === activeCheckGroupId);

  const dashboard = useMemo(() => {
    const scopedItems = data.items.filter((item) => selectedOutletId === "all" || item.linkedOutletIds?.includes(selectedOutletId));
    const lowStock = scopedItems.reduce((count, item) => {
      const configs = outletConfigsForScope(item, selectedOutletIds);
      return count + configs.filter((config) => Number(config.parLevel || 0) > 0 && latestActualCount(data.checks, item.id, config.outletId) < Number(config.parLevel || 0)).length;
    }, 0);
    const pendingRequests = data.requests.filter((request) => selectedOutletIds.includes(request.outletId) && !["completed", "rejected"].includes(request.status)).length;
    const criticalChecks = dueGroups.filter((group) => dueStatus(group, data.checks, date) === "Overdue").length;
    const completion = dueGroups.length ? Math.round((dueGroups.filter((group) => dueStatus(group, data.checks, date) === "Completed").length / dueGroups.length) * 100) : 100;
    return {
      inventoryValue: scopedItems.reduce((sum, item) => sum + outletConfigsForScope(item, selectedOutletIds).reduce((configSum, config) => configSum + Number(config.parLevel || 0) * 8, 0), 0),
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
    const items = stockCheckItemsForGroup(activeCheckGroup, data.items);
    setCheckRows(items.map((item) => ({ itemId: item.id, actualCount: parLevelForOutlet(item, activeCheckGroup.outletId), status: "normal", notes: "", na: false })));
  }, [activeCheckGroupId, activeCheckGroup, data.checks, data.items, date]);

  function notify(title, message = "", tone = "success") {
    ui?.notify?.({ title, message, tone });
  }

  function requirePermission(allowed, action) {
    if (allowed) return true;
    notifyPermissionDenied(ui, action);
    return false;
  }

  function saveItem(item) {
    const normalizedItem = normalizeInventoryItem({ ...item, photo_url: item.photo ?? item.photo_url ?? "" });
    setData((current) => ({
      ...current,
      items: current.items.some((entry) => entry.id === normalizedItem.id)
        ? current.items.map((entry) => entry.id === normalizedItem.id ? normalizedItem : entry)
        : [normalizedItem, ...current.items],
    }));
    setModal(null);
    notify("Inventory item saved");
  }

  function saveCategory(category) {
    setData((current) => ({
      ...current,
      categories: current.categories.some((entry) => entry.id === category.id)
        ? current.categories.map((entry) => entry.id === category.id ? category : entry)
        : [...current.categories, { ...category, sortOrder: current.categories.length ? Math.max(...current.categories.map((entry) => Number(entry.sortOrder || 0))) + 1 : 1 }],
    }));
    setModal(modal?.returnToSettings ? { type: "category-settings" } : null);
    notify("Inventory category saved");
  }

  function sortCategories(draggedId, targetId) {
    setData((current) => {
      const ordered = [...current.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name));
      const fromIndex = ordered.findIndex((category) => category.id === draggedId);
      const toIndex = ordered.findIndex((category) => category.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(toIndex, 0, moved);
      const sorted = ordered.map((category, index) => ({ ...category, sortOrder: index + 1 }));
      const byId = new Map(sorted.map((category) => [category.id, category]));
      return {
        ...current,
        categories: current.categories.map((category) => byId.get(category.id) || category),
      };
    });
    notify("Category order updated");
  }

  function archiveCategory(category) {
    setData((current) => ({
      ...current,
      categories: current.categories.map((entry) => entry.id === category.id ? { ...entry, status: "archived" } : entry),
    }));
    notify("Inventory category archived");
  }

  function deleteCategory(category) {
    if ((itemCountByCategory.get(category.id) || 0) > 0) {
      notify("Category is linked to inventory items", "Archive it instead to preserve item history.", "warning");
      return;
    }
    setData((current) => ({
      ...current,
      categories: current.categories.filter((entry) => entry.id !== category.id),
    }));
    notify("Inventory category deleted");
  }

  function importInventoryRows(rows) {
    let created = 0;
    let updated = 0;
    setData((current) => {
      let nextItems = [...current.items];
      rows.forEach((row) => {
        const incoming = row.item;
        const existingIndex = nextItems.findIndex((item) => (
          incoming.sku ? canonical(item.sku) === canonical(incoming.sku) : canonical(item.name) === canonical(incoming.name)
        ));
        const existing = existingIndex >= 0 ? nextItems[existingIndex] : null;
        const mergedLinkedIds = uniqueIds([...(existing?.linkedOutletIds || []), ...(incoming.linkedOutletIds || [])]);
        const existingConfigs = new Map((existing?.outletConfigs || []).map((config) => [config.outletId, config]));
        const nextItem = normalizeInventoryItem({
          ...(existing || {}),
          ...incoming,
          id: existing?.id || makeId("item"),
          linkedOutletIds: mergedLinkedIds,
          outletConfigs: mergedLinkedIds.map((outletId) => buildOutletConfig(existing || incoming, outletId, existingConfigs.get(outletId))),
        });
        if (existingIndex >= 0) {
          updated += 1;
          nextItems = nextItems.map((item, index) => index === existingIndex ? nextItem : item);
        } else {
          created += 1;
          nextItems = [nextItem, ...nextItems];
        }
      });
      return { ...current, items: nextItems };
    });
    notify("Master inventory imported", `${created} created · ${updated} updated.`);
    return { created, updated };
  }

  function exportMasterInventory() {
    const rows = visibleItems.map((item) => {
      const category = categoryById.get(item.categoryId);
      const supplier = suppliers.find((entry) => entry.id === item.defaultSupplierId);
      const linkedOutlets = (item.linkedOutletIds || []).map((id) => {
        const outlet = outletById.get(id);
        const code = outlet?.code || outlet?.shortCode || outlet?.short_code;
        return [outlet?.name, code ? `(${code})` : ""].filter(Boolean).join(" ");
      }).filter(Boolean).join(", ");
      return {
        "Item Name": item.name,
        "SKU Code": item.sku,
        Category: category?.name || "",
        Unit: item.unit,
        Description: item.description,
        "Default Supplier": supplier?.name || "",
        Status: item.status,
        "Linked Outlets": linkedOutlets,
        "Created At": item.createdAt || "",
        "Updated At": item.updatedAt || "",
      };
    });
    const columns = ["Item Name", "SKU Code", "Category", "Unit", "Description", "Default Supplier", "Status", "Linked Outlets", "Created At", "Updated At"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-master-inventory-${todayInput()}.csv`, csv);
    notify("Master inventory exported successfully", `${rows.length} item${rows.length === 1 ? "" : "s"} exported.`);
  }

  function supplierNamesForConfig(config = {}) {
    return (config.supplierIds || [])
      .map((id) => suppliers.find((supplier) => supplier.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  }

  function exportParLevels() {
    const activeOutletId = parLevelOutletId || outlets[0]?.id || "";
    const scopedOutlets = parLevelView === "outlet"
      ? outlets.filter((outlet) => outlet.id === activeOutletId)
      : outlets;
    const rows = [];
    data.items
      .filter((item) => {
        const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
        const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
        const matchesStatus = statusFilter === "all" || item.status === statusFilter;
        return matchesQuery && matchesCategory && matchesStatus;
      })
      .forEach((item) => {
        const category = categoryById.get(item.categoryId);
        scopedOutlets.forEach((outlet) => {
          if (!item.linkedOutletIds?.includes(outlet.id)) return;
          const config = outletConfigForItem(item, outlet.id);
          rows.push({
            "Item Name": item.name,
            "SKU Code": item.sku,
            Category: category?.name || "",
            Unit: item.unit,
            Outlet: outlet.name,
            "Par Level": config.parLevel,
            "Storage Location": config.storageLocation,
            Active: config.isActive !== false ? "Active" : "Inactive",
            Suppliers: supplierNamesForConfig(config),
          });
        });
      });
    const columns = ["Item Name", "SKU Code", "Category", "Unit", "Outlet", "Par Level", "Storage Location", "Active", "Suppliers"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-par-levels-${todayInput()}.csv`, csv);
    notify("Par levels exported successfully", `${rows.length} outlet item config${rows.length === 1 ? "" : "s"} exported.`);
  }

  function saveParLevelConfig(itemId, outletId, patch) {
    setData((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;
        const normalized = normalizeInventoryItem(item);
        const linkedOutletIds = uniqueIds([...normalized.linkedOutletIds, outletId]);
        const existing = new Map((normalized.outletConfigs || []).map((config) => [config.outletId, config]));
        const outletConfigs = linkedOutletIds.map((id) => {
          const config = buildOutletConfig({ ...normalized, linkedOutletIds }, id, existing.get(id));
          return id === outletId ? { ...config, ...patch, updatedAt: new Date().toISOString() } : config;
        });
        return normalizeInventoryItem({ ...normalized, linkedOutletIds, outletConfigs });
      }),
    }));
  }

  function saveGroup(group) {
    const normalizedGroup = {
      ...group,
      categoryIds: groupCategoryIds(group, data.items),
      frequency: frequencies.includes(group.frequency) ? group.frequency : "custom",
      itemIds: [],
    };
    setData((current) => ({
      ...current,
      groups: current.groups.some((entry) => entry.id === group.id)
        ? current.groups.map((entry) => entry.id === group.id ? normalizedGroup : entry)
        : [normalizedGroup, ...current.groups],
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
      const expectedQty = parLevelForOutlet(item, activeCheckGroup.outletId);
      const variance = row.na ? 0 : Number(expectedQty || 0) - Number(row.actualCount || 0);
      return { ...row, expectedQty, variance };
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
          options={[{ value: "all", label: "All Categories" }, ...sortedCategories.map((category) => ({ value: category.id, label: category.name }))]}
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
      const lowStock = outletItems.filter((item) => latestActualCount(data.checks, item.id, outlet.id) < parLevelForOutlet(item, outlet.id)).length;
      const waste = data.waste.filter((row) => row.outletId === outlet.id).reduce((sum, row) => sum + Number(row.value || 0), 0);
      const pendingOrders = data.orders.filter((order) => order.outletIds?.includes(outlet.id) && !["completed", "delivered"].includes(order.status)).length;
      const completion = outletDue.length ? Math.round((outletDue.filter((group) => dueStatus(group, data.checks, date) === "Completed").length / outletDue.length) * 100) : 100;
      const status = lowStock > 2 || completion < 60 ? "Critical" : lowStock || pendingOrders ? "Watch" : "Good";
      return { outlet, lowStock, waste, pendingOrders, completion, status };
    }).filter((row) => selectedOutletId === "all" || row.outlet.id === selectedOutletId);

    const alerts = [
      dashboard.lowStock ? { title: `${dashboard.lowStock} low stock items`, reason: "Actual counts are below configured par levels.", tone: "warning", category: "Low Stock" } : null,
      dashboard.varianceRisk ? { title: `${dashboard.varianceRisk} overdue stock checks`, reason: "Outlet check groups are not completed.", tone: "danger", category: "Stock Check" } : null,
      data.orders.some((order) => ["sent", "confirmed", "packing"].includes(order.status)) ? { title: "Supplier delivery pending", reason: "Purchase orders are still open.", tone: "info", category: "Ordering" } : null,
    ].filter(Boolean);

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={Warehouse} label="Inventory Value" value={toCurrency(dashboard.inventoryValue)} helper="Estimated at par level" trend="Monthly" emphasis="primary" />
          <MetricCard icon={AlertTriangle} label="Low Stock Items" value={dashboard.lowStock} helper="Below outlet par level" tone={dashboard.lowStock ? "warning" : "success"} />
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
              {scopedGroups.slice(0, 6).map((group) => {
                const itemCount = stockCheckItemsForGroup(group, data.items).length;
                return (
                  <div key={group.id} className="flex items-center justify-between rounded-2xl border border-border px-3 py-2.5">
                    <div>
                      <div className="type-body-sm font-bold text-text-primary">{group.name}</div>
                      <div className="type-caption text-text-secondary">{outletById.get(group.outletId)?.name} · {itemCount} items · {frequencyLabel(group)}</div>
                    </div>
                    <Badge tone={statusTone(dueStatus(group, data.checks, date).toLowerCase())}>{dueStatus(group, data.checks, date)}</Badge>
                  </div>
                );
              })}
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
    const renderItemRow = (item) => {
      const category = categoryById.get(item.categoryId);
      const photo = item.photo || item.photo_url;
      return (
        <tr key={item.id} className="transition hover:bg-primary/5">
          <td className="py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : item.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-text-primary">{item.name}</div>
                <div className="type-caption text-text-secondary">{item.description || category?.name || "Inventory item"}</div>
              </div>
            </div>
          </td>
          {masterGroupBy === "none" ? <td>{category?.name ?? "Uncategorized"}</td> : null}
          <td className="font-mono text-xs text-text-secondary">{item.sku || "-"}</td>
          <td>{item.unit}</td>
          <td>
            <LinkedOutletsSummary item={item} outlets={outlets} onConfigure={() => { if (requirePermission(can.manageMaster, "manage par levels")) ui?.navigate?.("inventory_par_levels"); }} />
          </td>
          <td><Badge tone={statusTone(item.status)}>{toTitle(item.status)}</Badge></td>
          <td>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageMaster, "edit inventory items") && setModal({ type: "item", item })}>Edit</button>
              <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageMaster, "archive inventory items") && archiveItem(item.id)}>Archive</button>
            </div>
          </td>
        </tr>
      );
    };

    return (
      <div className="space-y-4">
        {renderFilters()}
        <div className="flex items-center justify-end">
          <SelectField
            label="Group by"
            value={masterGroupBy}
            options={[{ value: "category", label: "Category" }, { value: "none", label: "None" }]}
            onChange={setMasterGroupBy}
            className="w-44"
          />
        </div>
          <SectionCard
          title="Inventory Items"
          description="Global item definitions. Outlet par levels are managed in Par Level Setup."
        >
          {visibleItems.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Item</th>
                    {masterGroupBy === "none" ? <th>Category</th> : null}
                    <th>SKU Code</th>
                    <th>Unit</th>
                    <th>Linked Outlets</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {masterGroupBy === "category" ? visibleItemGroups.map((group) => {
                    const collapsed = collapsedCategoryIds.has(group.id);
                    return (
                      <Fragment key={group.id}>
                        <tr key={`${group.id}-header`} className="bg-slate-50">
                          <td className="py-2" colSpan={6}>
                            <button
                              className="flex w-full items-center justify-between rounded-xl px-2 py-1 text-left transition hover:bg-primary/5"
                              type="button"
                              onClick={() => setCollapsedCategoryIds((current) => {
                                const next = new Set(current);
                                if (next.has(group.id)) next.delete(group.id);
                                else next.add(group.id);
                                return next;
                              })}
                            >
                              <span className="type-body-sm font-black text-text-primary">{group.category?.name || "Uncategorized"} <span className="font-semibold text-text-secondary">· {group.items.length} item{group.items.length === 1 ? "" : "s"}</span></span>
                              <ChevronDown className={`text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
                            </button>
                          </td>
                        </tr>
                        {collapsed ? null : group.items.map(renderItemRow)}
                      </Fragment>
                    );
                  }) : visibleItems.map(renderItemRow)}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Create your first inventory item to start stock tracking." description="Inventory items can be linked to one or multiple outlets." />}
        </SectionCard>
      </div>
    );
  }

  function renderParLevels() {
    const activeOutletId = parLevelOutletId || outlets[0]?.id || "";
    const outletScopedItems = data.items.filter((item) => {
      const matchesOutlet = item.linkedOutletIds?.includes(activeOutletId);
      const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesOutlet && matchesQuery && matchesCategory && matchesStatus;
    });
    const parItems = data.items.filter((item) => {
      const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesQuery && matchesCategory && matchesStatus;
    });
    const parItemGroups = [...outletScopedItems.reduce((groups, item) => {
      const category = categoryById.get(item.categoryId);
      const key = item.categoryId || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
      return groups;
    }, new Map()).values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));

    const renderParRow = (item) => {
      const category = categoryById.get(item.categoryId);
      const config = outletConfigForItem(item, activeOutletId);
      return (
        <tr key={item.id} className="transition hover:bg-primary/5">
          <td className="py-3 font-bold text-text-primary">{item.name}</td>
          {parLevelGroupBy === "none" ? <td>{category?.name ?? "Uncategorized"}</td> : null}
          <td>{item.unit}</td>
          <td>
            <input
              className="control h-8 w-28 text-[13px]"
              type="number"
              value={config.parLevel}
              onChange={(event) => saveParLevelConfig(item.id, activeOutletId, { parLevel: Number(event.target.value || 0) })}
            />
          </td>
          <td>
            <input
              className="control h-8 min-w-44 text-[13px]"
              value={config.storageLocation}
              onChange={(event) => saveParLevelConfig(item.id, activeOutletId, { storageLocation: event.target.value })}
              placeholder="Optional"
            />
          </td>
          <td>
            <SupplierAssignmentPicker
              suppliers={suppliers}
              outletId={activeOutletId}
              selectedIds={config.supplierIds}
              onSave={(supplierIds) => saveParLevelConfig(item.id, activeOutletId, { supplierIds })}
            />
          </td>
          <td>
            <label className="inline-flex items-center gap-2 type-caption font-semibold text-text-secondary">
              <input
                type="checkbox"
                checked={config.isActive !== false}
                onChange={(event) => saveParLevelConfig(item.id, activeOutletId, { isActive: event.target.checked })}
              />
              Active
            </label>
          </td>
        </tr>
      );
    };

    return (
      <div className="space-y-4">
        <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-end">
            <SelectField
              label="Outlet"
              value={activeOutletId}
              options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
              onChange={setParLevelOutletId}
              searchable
              className="lg:w-72"
            />
            <SelectField
              label="Category"
              value={categoryFilter}
              options={[{ value: "all", label: "All Categories" }, ...sortedCategories.map((category) => ({ value: category.id, label: category.name }))]}
              onChange={setCategoryFilter}
              searchable
              className="lg:w-56"
            />
            <label className="min-w-0 flex-1">
              <div className="mb-1 type-caption font-semibold text-text-secondary">Search item</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
                <input className="control h-9 w-full pl-9 text-[13px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item name or SKU" />
              </div>
            </label>
          </div>
          {parLevelView === "outlet" ? (
            <SelectField
              label="Group by"
              value={parLevelGroupBy}
              options={[{ value: "category", label: "Category" }, { value: "none", label: "None" }]}
              onChange={setParLevelGroupBy}
              className="lg:w-44"
            />
          ) : null}
          <div className="inline-flex rounded-xl border border-border bg-slate-50 p-1">
            {[
              ["outlet", "Outlet View"],
              ["matrix", "Matrix View"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`rounded-lg px-3 py-1.5 type-caption font-bold transition ${parLevelView === value ? "bg-white text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
                type="button"
                onClick={() => setParLevelView(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {parLevelView === "outlet" ? (
          <SectionCard
            title={`${outletById.get(activeOutletId)?.name ?? "Outlet"} Par Levels`}
            description="Set the minimum quantity this outlet should keep for each linked item."
          >
            {outletScopedItems.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left">
                  <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2">Item</th>
                      {parLevelGroupBy === "none" ? <th>Category</th> : null}
                      <th>Unit</th>
                      <th>Par Level</th>
                      <th>Storage Location</th>
                      <th>Suppliers</th>
                      <th>Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {parLevelGroupBy === "category" ? parItemGroups.map((group) => {
                      const collapsed = collapsedParCategoryIds.has(group.id);
                      return (
                        <Fragment key={group.id}>
                          <tr className="bg-slate-50">
                            <td className="py-2" colSpan={6}>
                              <button
                                className="flex w-full items-center justify-between rounded-xl px-2 py-1 text-left transition hover:bg-primary/5"
                                type="button"
                                onClick={() => setCollapsedParCategoryIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(group.id)) next.delete(group.id);
                                  else next.add(group.id);
                                  return next;
                                })}
                              >
                                <span className="type-body-sm font-black text-text-primary">{group.category?.name || "Uncategorized"} <span className="font-semibold text-text-secondary">· {group.items.length} item{group.items.length === 1 ? "" : "s"}</span></span>
                                <ChevronDown className={`text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
                              </button>
                            </td>
                          </tr>
                          {collapsed ? null : group.items.map(renderParRow)}
                        </Fragment>
                      );
                    }) : outletScopedItems.map(renderParRow)}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No linked items for this outlet" description="Link items to this outlet from Master Inventory before setting par levels." />}
          </SectionCard>
        ) : (
          <SectionCard title="Par Level Matrix" description="HQ view for comparing item par levels across outlets.">
            {parItems.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2">Item</th>
                      <th>Unit</th>
                      {outlets.map((outlet) => <th key={outlet.id}>{outlet.name}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {parItems.map((item) => (
                      <tr key={item.id} className="transition hover:bg-primary/5">
                        <td className="py-3">
                          <div className="font-bold text-text-primary">{item.name}</div>
                          <div className="type-caption text-text-secondary">{categoryById.get(item.categoryId)?.name ?? "Uncategorized"}</div>
                        </td>
                        <td>{item.unit}</td>
                        {outlets.map((outlet) => {
                          const linked = item.linkedOutletIds?.includes(outlet.id);
                          const config = outletConfigForItem(item, outlet.id);
                          return (
                            <td key={outlet.id}>
                              {linked ? (
                                <input
                                  className="control h-8 w-24 text-[13px]"
                                  type="number"
                                  value={config.parLevel}
                                  onChange={(event) => saveParLevelConfig(item.id, outlet.id, { parLevel: Number(event.target.value || 0) })}
                                />
                              ) : (
                                <span className="type-caption text-text-muted">Not linked</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No inventory items found" description="Adjust filters or create inventory items first." />}
          </SectionCard>
        )}
      </div>
    );
  }

  function renderGroups() {
    return (
      <SectionCard
        title="Stock Check Groups"
        description="Configure outlet-level category groups and schedules. Stock Check only shows groups that are due."
        action={<button className="btn-primary" type="button" onClick={() => requirePermission(can.manageGroups, "manage stock check groups") && setModal({ type: "group" })}><PackagePlus size={15} /> Add Group</button>}
      >
        {data.groups.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {data.groups.filter((group) => selectedOutletId === "all" || group.outletId === selectedOutletId).map((group) => {
              const categoryIds = groupCategoryIds(group, data.items);
              const itemCount = stockCheckItemsForGroup(group, data.items).length;
              const categoryNames = categoryIds.map((id) => categoryById.get(id)?.name).filter(Boolean).join(", ") || "No categories";
              return (
                <div key={group.id} className="rounded-2xl border border-border bg-white p-4 transition hover:border-primary/25 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="type-title font-bold text-text-primary">{group.name}</div>
                      <div className="mt-1 type-caption text-text-secondary">{outletById.get(group.outletId)?.name} · {categoryIds.length} categories · {itemCount} items · {group.shift}</div>
                    </div>
                    <Badge tone={statusTone(dueStatus(group, data.checks, date).toLowerCase())}>{dueStatus(group, data.checks, date)}</Badge>
                  </div>
                  <p className="mt-3 type-body-sm text-text-secondary">{group.description || "No description provided."}</p>
                  <div className="mt-2 type-caption font-semibold text-text-secondary">Categories: <span className="text-text-primary">{categoryNames}</span></div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MiniPill tone="info">{frequencyLabel(group)}</MiniPill>
                    <MiniPill tone={statusTone(group.status)}>{toTitle(group.status)}</MiniPill>
                    <MiniPill>Last checked {group.lastChecked ? formatDate(group.lastChecked) : "never"}</MiniPill>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageGroups, "edit stock check groups") && setModal({ type: "group", group })}>Edit</button>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageGroups, "duplicate stock check groups") && setModal({ type: "group", group: { ...group, id: "", name: `${group.name} Copy`, categoryIds } })}>Duplicate</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="Set up stock check groups so outlets know what to count." description="Groups decide which inventory categories appear in custom or monthly checks." />}
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
                    const parLevel = parLevelForOutlet(item, activeCheckGroup.outletId);
                    const result = varianceStatus(parLevel, row.actualCount);
                    return (
                      <tr key={row.itemId} className="align-top">
                        <td className="py-3">
                          <div className="font-bold text-text-primary">{item?.name}</div>
                          <div className="type-caption text-text-secondary">{category?.name ?? "Uncategorized"}</div>
                        </td>
                        <td>{parLevel}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button className="icon-btn h-8 w-8" type="button" onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Math.max(0, Number(entry.actualCount || 0) - 1), na: false } : entry))}>-</button>
                            <input className="control h-8 w-20 text-center text-[13px]" type="number" value={row.actualCount} onChange={(event) => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Number(event.target.value || 0), na: false } : entry))} />
                            <button className="icon-btn h-8 w-8" type="button" onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Number(entry.actualCount || 0) + 1, na: false } : entry))}>+</button>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {[
                              ["Full", parLevel],
                              ["Half", Math.round(Number(parLevel || 0) / 2)],
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
              <span>{checkRows.filter((row) => varianceStatus(parLevelForOutlet(itemById.get(row.itemId), activeCheckGroup.outletId), row.actualCount).tone === "danger").length} critical items</span>
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
                const itemCount = stockCheckItemsForGroup(group, data.items).length;
                return (
                  <div key={group.id} className="rounded-2xl border border-border bg-white p-4 transition hover:border-primary/30 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="type-title font-bold text-text-primary">{group.name}</div>
                        <div className="type-caption text-text-secondary">{outletById.get(group.outletId)?.name} · {itemCount} items</div>
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
    if (activeTab === "par-levels") return renderParLevels();
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
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.manageMaster, "import master inventory") && setModal({ type: "inventory-import" })}>
            <Upload size={15} /> Import
          </button>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.export, "export inventory") && exportMasterInventory()}>
            <Download size={15} /> Export
          </button>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.viewCategories, "view inventory categories") && setModal({ type: "category-settings" })}>
            Category Settings
          </button>
          <button className="btn-primary" type="button" onClick={() => requirePermission(can.manageMaster, "add inventory items") && setModal({ type: "item" })}>
            <PackagePlus size={15} /> Add Item
          </button>
        </>
      );
    }
    if (activeTab === "par-levels") {
      return (
        <button className="btn-secondary" type="button" onClick={() => requirePermission(can.export, "export par levels") && exportParLevels()}>
          <Download size={15} /> Export
        </button>
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

      {modal?.type === "item" ? <InventoryItemModal item={modal.item} categories={sortedCategories} outlets={outlets} suppliers={suppliers} onClose={() => setModal(null)} onSave={saveItem} /> : null}
      {modal?.type === "inventory-import" ? (
        <InventoryImportModal
          categories={sortedCategories}
          outlets={outlets}
          suppliers={suppliers}
          items={data.items}
          onClose={() => setModal(null)}
          onImport={importInventoryRows}
        />
      ) : null}
      {modal?.type === "category-settings" ? (
        <CategorySettingsModal
          categories={sortedCategories}
          itemCounts={itemCountByCategory}
          canAdd={can.createCategory}
          canEdit={can.editCategory}
          canDelete={can.deleteCategory}
          requirePermission={requirePermission}
          onClose={() => setModal(null)}
          onAdd={() => setModal({ type: "category", returnToSettings: true })}
          onEdit={(category) => setModal({ type: "category", category, returnToSettings: true })}
          onArchive={archiveCategory}
          onDelete={deleteCategory}
          onSort={sortCategories}
        />
      ) : null}
      {modal?.type === "category" ? <CategoryModal category={modal.category} onClose={() => setModal(null)} onSave={saveCategory} /> : null}
      {modal?.type === "group" ? <GroupModal group={modal.group} outlets={outlets} items={data.items} categories={sortedCategories} onClose={() => setModal(null)} onSave={saveGroup} /> : null}
      {modal?.type === "request" ? <RequestModal outlets={outlets} items={data.items} categories={sortedCategories} suppliers={suppliers} onClose={() => setModal(null)} onSave={saveRequest} /> : null}
      {modal?.type === "movement" ? <MovementModal outlets={outlets} items={data.items} onClose={() => setModal(null)} onSave={saveMovement} /> : null}
      {modal?.type === "waste" ? <WasteModal outlets={outlets} items={data.items} onClose={() => setModal(null)} onSave={saveWaste} /> : null}
    </div>
  );
}

export default InventoryControlPage;
