import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Download,
  FileText,
  Folder,
  GripVertical,
  Plus,
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
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { supabase } from "../../../lib/supabase.ts";
import { productAnalyticsService } from "../../../services/productAnalyticsService.js";
import { getAccessibleOutletOptions, getAccessibleOutlets, hasAllOutletAccess, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";

const STORAGE_KEY = "feedx.inventoryControl.v2";
const LEGACY_STORAGE_KEYS = ["feedx.inventoryControl.v1"];
const SHOW_STOCK_CHECK_CARD_DEBUG = import.meta.env.DEV && String(import.meta.env.VITE_SHOW_STOCK_CHECK_CARD_DEBUG ?? "false").toLowerCase() === "true";
const INVENTORY_BROWSER_CACHE_KEYS = [
  STORAGE_KEY,
  ...LEGACY_STORAGE_KEYS,
  "feedx.inventoryControl",
  "feedx.masterInventory",
  "masterInventory",
  "inventoryItems",
];

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
  orders: {
    title: "Purchase Orders",
    description: "Create draft POs from reviewed stock check suggestions or manual purchase planning.",
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
const defaultUoms = [
  { id: "uom_kg", code: "kg", displayName: "Kilogram", uomType: "Weight", isActive: true, sortOrder: 1 },
  { id: "uom_g", code: "g", displayName: "Gram", uomType: "Weight", isActive: true, sortOrder: 2 },
  { id: "uom_pcs", code: "pcs", displayName: "Pieces", uomType: "Count", isActive: true, sortOrder: 3 },
  { id: "uom_box", code: "box", displayName: "Box", uomType: "Packaging", isActive: true, sortOrder: 4 },
  { id: "uom_pack", code: "pack", displayName: "Pack", uomType: "Packaging", isActive: true, sortOrder: 5 },
  { id: "uom_bottle", code: "bottle", displayName: "Bottle", uomType: "Volume", isActive: true, sortOrder: 6 },
  { id: "uom_carton", code: "carton", displayName: "Carton", uomType: "Packaging", isActive: true, sortOrder: 7 },
  { id: "uom_litre", code: "litre", displayName: "Litre", uomType: "Volume", isActive: true, sortOrder: 8 },
];
const statuses = ["active", "inactive", "archived"];
const frequencies = ["custom", "monthly"];
const shifts = ["Opening", "Mid", "Closing", "Any Shift"];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const movementTypes = ["purchase", "transfer_in", "transfer_out", "waste", "adjustment", "staff_meal", "production_usage", "return"];
const wasteTypes = ["Spoilage", "Expired", "Kitchen Error", "Burnt", "Returned Item", "Staff Consumption", "Unknown"];
const poStatuses = ["draft", "submitted", "supplier_confirmed", "partial_received", "fully_received", "completed", "cancelled"];
const poSources = ["stock_check", "manual"];
const auditTypes = ["Month-End Closing", "Full Stock Audit", "Spot Check", "Category Audit", "Custom Audit"];
const recipeMenuCategories = ["Main Dish", "Beverage", "Side Dish", "Sauce", "Dessert", "Prep Item", "Combo", "Other"];

function toDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getBusinessDateInput(timeZone = "Asia/Kuala_Lumpur", value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (byType.year && byType.month && byType.day) return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    // Fall back to browser local date if the requested timezone is unavailable.
  }
  return toDateInputValue(date);
}

function todayInput(timeZone = "Asia/Kuala_Lumpur") {
  return getBusinessDateInput(timeZone);
}

function normalizeBusinessDate(value, fallback = todayInput()) {
  if (value instanceof Date) return toDateInputValue(value) || fallback;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  return toDateInputValue(raw) || fallback;
}

function businessDateToTimestamp(value) {
  return `${normalizeBusinessDate(value)}T12:00:00.000Z`;
}

function businessDateToLocalDate(value) {
  const [year, month, day] = normalizeBusinessDate(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function stockCheckDateFromUrl() {
  if (typeof window === "undefined") return "";
  const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?")[1] : "";
  const searchParams = new URLSearchParams(window.location.search || "");
  const hashParams = new URLSearchParams(hashQuery || "");
  const candidate = hashParams.get("date") || searchParams.get("stockCheckDate") || searchParams.get("date") || "";
  return candidate ? normalizeBusinessDate(candidate, "") : "";
}

function getInitialStockCheckDate() {
  const urlDate = stockCheckDateFromUrl();
  if (urlDate) return { date: urlDate, source: "url" };
  return { date: getBusinessDateInput("Asia/Kuala_Lumpur"), source: "business-today" };
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function debugLog(...args) {
  if (import.meta.env.DEV) console.log(...args);
}

function debugTable(...args) {
  if (import.meta.env.DEV) console.table(...args);
}

function toTitle(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function poStatusLabel(status) {
  const labels = {
    supplier_confirmed: "Supplier Confirmed",
    partial_received: "Partial Received",
    fully_received: "Fully Received",
  };
  return labels[status] || toTitle(status);
}

function poSourceLabel(source) {
  const labels = { stock_check: "Stock Check", stock_request: "Stock Request", manual: "Manual" };
  return labels[source] || toTitle(source || "manual");
}

function toCurrency(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatInventoryCost(value, unit = "") {
  if (value === "" || value === null || value === undefined) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const formatted = amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `RM ${formatted}${unit ? ` / ${unit}` : ""}`;
}

function parseInventoryCostInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d+(\.\d{0,4})?$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function canonical(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeOutletRecord(outlet = {}) {
  const relatedOutlet = Array.isArray(outlet.outlets) ? outlet.outlets[0] : outlet.outlets;
  const source = relatedOutlet || outlet.outlet || outlet;
  const id = source?.id ?? outlet.outlet_id ?? outlet.outletId ?? outlet.id ?? "";
  const code =
    source?.code ??
    source?.outlet_code ??
    source?.shortCode ??
    source?.short_code ??
    source?.abbreviation ??
    outlet.code ??
    outlet.outlet_code ??
    outlet.shortCode ??
    outlet.short_code ??
    outlet.abbreviation ??
    "";
  const name =
    source?.name ??
    source?.outlet_name ??
    source?.outletName ??
    outlet.name ??
    outlet.outlet_name ??
    outlet.outletName ??
    "";
  return {
    ...outlet,
    ...source,
    id,
    code: String(code || "").trim(),
    name: String(name || "").trim(),
  };
}

function outletDisplayCode(outlet = {}) {
  const normalized = normalizeOutletRecord(outlet);
  return normalized.code || normalized.name || normalized.id || "Outlet";
}

function outletDisplayName(outlet = {}) {
  const normalized = normalizeOutletRecord(outlet);
  return normalized.name || normalized.code || normalized.id || "Unknown outlet";
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

function clearInventoryBrowserCache() {
  INVENTORY_BROWSER_CACHE_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // Browser storage can be unavailable in private or restricted modes.
    }
  });
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTimeCompact(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function employeeDisplayName(employee = {}) {
  return employee.nickname || employee.full_name || employee.fullName || employee.name || employee.email || "Unknown User";
}

function weekdayName(value = todayInput()) {
  return businessDateToLocalDate(value).toLocaleDateString("en-MY", { weekday: "long" });
}

function statusTone(status) {
  if (["active", "normal", "completed", "reviewed", "locked", "delivered", "fully_received"].includes(status)) return "success";
  if (["draft", "due today", "scheduled", "partial approved", "partial delivery", "partial_delivered", "partial_received"].includes(status)) return "warning";
  if (["critical", "shortage", "overdue", "missed", "rejected", "archived", "cancelled"].includes(status)) return "danger";
  if (["excess", "sent", "submitted", "confirmed", "supplier_confirmed", "ordered", "packing"].includes(status)) return "info";
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

function ordinalDay(value) {
  const day = Number(value || 1);
  const suffix = day === 1 || day === 21 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  return `${day}${suffix} day`;
}

function compactFrequencyLabel(group) {
  if (group.frequency === "custom") return `Custom · ${(group.checkDays || []).length} day${(group.checkDays || []).length === 1 ? "" : "s"}`;
  if (group.frequency === "monthly") return group.monthDay === "last" ? "Monthly · Last day" : `Monthly · ${ordinalDay(group.monthDay)}`;
  return frequencyLabel(group);
}

function isGroupDue(group, date) {
  if (group.status !== "active") return false;
  const day = weekdayName(date);
  if (group.frequency === "custom") return (group.checkDays || []).includes(day);
  if (group.frequency === "monthly") {
    const target = businessDateToLocalDate(date);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const configuredDay = group.monthDay === "last" ? lastDay : Math.min(Number(group.monthDay || 1), lastDay);
    return target.getDate() === configuredDay;
  }
  return false;
}

function sameStockCheckDate(left, right) {
  return String(left || "").slice(0, 10) === String(right || "").slice(0, 10);
}

function compareBusinessDates(left, right) {
  return normalizeBusinessDate(left).localeCompare(normalizeBusinessDate(right));
}

function isPastBusinessDate(value, reference = getBusinessDateInput("Asia/Kuala_Lumpur")) {
  return compareBusinessDates(value, reference) < 0;
}

function sameStockCheckShift(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function checkMatchesGroupRun(check = {}, group = {}, date, shiftFilter = "all") {
  const matchesShift = shiftFilter === "all" || !shiftFilter
    ? true
    : sameStockCheckShift(check.shift, shiftFilter);
  return check.stockCheckType !== "audit"
    && check.groupId === group.id
    && check.outletId === group.outletId
    && sameStockCheckDate(check.date, date)
    && matchesShift;
}

function submittedCheckForGroupRun(group = {}, checks = [], date, shiftFilter = "all") {
  return checks
    .filter((check) => checkMatchesGroupRun(check, group, date, shiftFilter) && ["submitted", "reviewed", "locked"].includes(check.status))
    .sort((a, b) => new Date(b.submittedAt || b.updatedAt || b.date || 0) - new Date(a.submittedAt || a.updatedAt || a.date || 0))[0] || null;
}

function draftCheckForGroupRun(group = {}, checks = [], date, shiftFilter = "all") {
  return checks
    .filter((check) => checkMatchesGroupRun(check, group, date, shiftFilter) && check.status === "draft")
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || b.date || 0) - new Date(a.updatedAt || a.createdAt || a.date || 0))[0] || null;
}

function dueStatus(group, checks, date, shiftFilter = "all") {
  if (submittedCheckForGroupRun(group, checks, date, shiftFilter)) return "Completed";
  const draft = draftCheckForGroupRun(group, checks, date, shiftFilter);
  const due = isGroupDue(group, date);
  if (due && isPastBusinessDate(date)) return "Missed";
  if (draft) return "Draft";
  if (due) return "Due Today";
  return "Not Due";
}

function dueStatusDescription(status) {
  if (status === "Missed") return "This stock check was not completed on schedule.";
  if (status === "Completed") return "Stock check completed for this date.";
  if (status === "Draft") return "Draft saved. Continue counting today.";
  if (status === "Due Today") return "Ready to count on the assigned date.";
  return "";
}

function canStartScheduledStockCheckForDate(group, date) {
  return isGroupDue(group, date) && compareBusinessDates(date, getBusinessDateInput("Asia/Kuala_Lumpur")) === 0;
}

function isActionableStockCheckStatus(status) {
  return ["Due Today", "Completed", "Draft", "Missed"].includes(status);
}

function stockCheckCardActionState(status) {
  if (status === "Completed") return "completed";
  if (status === "Draft") return "draft";
  if (status === "Missed") return "missed";
  if (status === "Due Today") return "start";
  return "none";
}

function varianceStatus(parLevel, count) {
  const variance = Number(parLevel || 0) - Number(count || 0);
  if (variance <= 0) return { label: variance < 0 ? "Excess" : "Normal", tone: variance < 0 ? "info" : "success", variance };
  if (variance >= Math.max(3, Number(parLevel || 0) * 0.35)) return { label: "Critical", tone: "danger", variance };
  return { label: "Shortage", tone: "warning", variance };
}

function stockCheckResultStatus(row = {}) {
  if (row.skipped) return { label: "Skipped", tone: "neutral" };
  if (row.na) return { label: "Not Available", tone: "neutral" };
  const variance = Number(row.variance || 0);
  if (variance > 0) return { label: "Shortage", tone: "warning" };
  if (variance < 0) return { label: "Excess", tone: "info" };
  return { label: "Normal", tone: "success" };
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
  return (item.linkedOutletIds || []).includes(outletId);
}

function stockCheckItemsForGroup(group = {}, items = []) {
  const selectedItemIds = uniqueIds(group.itemIds || group.item_ids || []);
  if (group.stockCheckType === "audit" && selectedItemIds.length) {
    const selected = new Set(selectedItemIds);
    return items
      .filter((item) => item.status === "active")
      .filter((item) => selected.has(item.id))
      .filter((item) => itemHasActiveOutletLink(item, group.outletId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
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
  const bucket = "inventory-item-photos";
  const extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || `image/${extension}`,
      upsert: true,
    });
  if (error) throw error;
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return { bucket, path: data.path, publicUrl: publicUrlData.publicUrl };
}

async function uploadRecipePhoto(file, recipeId = "draft") {
  const bucket = "inventory-item-photos";
  const extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `recipe_photos/${recipeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || `image/${extension}`,
      upsert: true,
    });
  if (error) throw error;
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return { bucket, path: data.path, publicUrl: publicUrlData.publicUrl };
}

async function uploadWasteEvidencePhoto(file, wasteId = "draft") {
  const bucket = "inventory-item-photos";
  const extension = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `waste_evidence/${wasteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || `image/${extension}`,
      upsert: true,
    });
  if (error) throw error;
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return { bucket, path: data.path, publicUrl: publicUrlData.publicUrl };
}

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sameIdSet(first = [], second = []) {
  const left = uniqueIds(first).sort();
  const right = uniqueIds(second).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isImageDataUrl(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(String(value || ""));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function getStockCheckResponsiveLayout() {
  if (typeof window === "undefined") return "desktop";
  const width = window.innerWidth || document.documentElement?.clientWidth || 1024;
  if (width <= 768) return "mobile";
  if (width < 1024) return "compact";
  return "desktop";
}

function useStockCheckResponsiveLayout() {
  const [layout, setLayout] = useState(getStockCheckResponsiveLayout);

  useEffect(() => {
    if (typeof window === "undefined") {
      setLayout("desktop");
      return undefined;
    }
    const update = () => setLayout(getStockCheckResponsiveLayout());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return layout;
}

function selectInputText(event) {
  if (!event.target.value) return;
  event.target.select?.();
}

function parseNonNegativeNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return Math.max(0, parsed);
}

function focusEditableGridInput(gridRef, currentRow, currentField, direction) {
  const fields = ["par", "storage"];
  const visibleInputs = [...(gridRef.current?.querySelectorAll("[data-grid-row][data-grid-field]") || [])]
    .filter((input) => !input.disabled && input.offsetParent !== null)
    .map((input) => ({
      input,
      row: Number(input.dataset.gridRow),
      field: input.dataset.gridField,
      fieldIndex: fields.indexOf(input.dataset.gridField),
    }))
    .filter((entry) => Number.isFinite(entry.row) && entry.fieldIndex >= 0)
    .sort((a, b) => a.row - b.row || a.fieldIndex - b.fieldIndex);
  if (!visibleInputs.length) return;

  const currentIndex = visibleInputs.findIndex((entry) => entry.row === currentRow && entry.field === currentField);
  let nextIndex = currentIndex;
  if (direction === "next-row") nextIndex = visibleInputs.findIndex((entry) => entry.row > currentRow && entry.field === currentField);
  if (direction === "previous-row") {
    for (let index = visibleInputs.length - 1; index >= 0; index -= 1) {
      if (visibleInputs[index].row < currentRow && visibleInputs[index].field === currentField) {
        nextIndex = index;
        break;
      }
    }
  }
  if (direction === "right") nextIndex = Math.min(visibleInputs.length - 1, currentIndex + 1);
  if (direction === "left") nextIndex = Math.max(0, currentIndex - 1);
  if (nextIndex < 0 || nextIndex === currentIndex) return;
  const target = visibleInputs[nextIndex]?.input;
  target?.focus?.();
  target?.select?.();
}

function focusMatrixGridInput(gridRef, currentRow, currentColumn, direction) {
  const visibleInputs = [...(gridRef.current?.querySelectorAll("[data-matrix-row][data-matrix-column]") || [])]
    .filter((input) => !input.disabled && input.offsetParent !== null)
    .map((input) => ({
      input,
      row: Number(input.dataset.matrixRow),
      column: Number(input.dataset.matrixColumn),
    }))
    .filter((entry) => Number.isFinite(entry.row) && Number.isFinite(entry.column))
    .sort((a, b) => a.row - b.row || a.column - b.column);
  if (!visibleInputs.length) return;

  const currentIndex = visibleInputs.findIndex((entry) => entry.row === currentRow && entry.column === currentColumn);
  let nextIndex = currentIndex;
  if (direction === "next-row") nextIndex = visibleInputs.findIndex((entry) => entry.row > currentRow && entry.column === currentColumn);
  if (direction === "previous-row") {
    for (let index = visibleInputs.length - 1; index >= 0; index -= 1) {
      if (visibleInputs[index].row < currentRow && visibleInputs[index].column === currentColumn) {
        nextIndex = index;
        break;
      }
    }
  }
  if (direction === "right") {
    nextIndex = visibleInputs.findIndex((entry) => entry.row === currentRow && entry.column > currentColumn);
  }
  if (direction === "left") {
    for (let index = visibleInputs.length - 1; index >= 0; index -= 1) {
      if (visibleInputs[index].row === currentRow && visibleInputs[index].column < currentColumn) {
        nextIndex = index;
        break;
      }
    }
  }
  if (nextIndex < 0 || nextIndex === currentIndex) return;
  const target = visibleInputs[nextIndex]?.input;
  target?.focus?.();
  target?.select?.();
}

function focusIndexedInput(containerRef, currentIndex, direction, selector = "[data-entry-index]") {
  const inputs = [...(containerRef.current?.querySelectorAll(selector) || [])]
    .filter((input) => !input.disabled && input.offsetParent !== null)
    .map((input) => ({ input, index: Number(input.dataset.entryIndex) }))
    .filter((entry) => Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index);
  if (!inputs.length) return;
  const currentPosition = inputs.findIndex((entry) => entry.index === currentIndex);
  const nextPosition = direction === "previous"
    ? Math.max(0, currentPosition - 1)
    : Math.min(inputs.length - 1, currentPosition + 1);
  if (nextPosition < 0 || nextPosition === currentPosition) return;
  inputs[nextPosition]?.input?.focus?.();
  inputs[nextPosition]?.input?.select?.();
}

function getLinkedOutletIds(item = {}) {
  if (Array.isArray(item.linkedOutletIds)) return uniqueIds(item.linkedOutletIds);
  if (Array.isArray(item.linked_outlet_ids)) return uniqueIds(item.linked_outlet_ids);
  return uniqueIds([
    ...(item.linkedOutlets || []).map((outlet) => normalizeOutletRecord(outlet).id),
    ...(item.linked_outlets || []).map((outlet) => normalizeOutletRecord(outlet).id),
    ...(item.outletConfigs || []).map((config) => config.outletId),
    ...(item.outlet_configs || []).map((config) => config.outlet_id || config.outletId),
  ]);
}

function buildOutletConfig(item = {}, outletId, existing = {}) {
  const rawParLevel = existing.parLevel ?? existing.par_level ?? item.parLevel ?? item.par_level ?? null;
  const parLevel = rawParLevel === "" || rawParLevel === null || rawParLevel === undefined ? "" : Number(rawParLevel);
  return {
    id: existing.id || `${item.id || "draft"}_${outletId}`,
    inventoryItemId: existing.inventoryItemId || existing.inventory_item_id || item.id || "",
    outletId,
    parLevel,
    storageLocation: existing.storageLocation ?? existing.storage_location ?? "",
    supplierIds: uniqueIds(existing.supplierIds || existing.supplier_ids || []),
    isActive: existing.isActive ?? existing.is_active ?? true,
    createdAt: existing.createdAt || existing.created_at || item.createdAt || item.created_at || "",
    updatedAt: existing.updatedAt || existing.updated_at || item.updatedAt || item.updated_at || "",
  };
}

function normalizeInventoryItem(item = {}) {
  const rawCategoryRecord = item.category || item.inventory_categories || item.inventory_category || {};
  const categoryRecord = Array.isArray(rawCategoryRecord) ? rawCategoryRecord[0] || {} : rawCategoryRecord;
  const rawUomRecord = item.uom || item.inventory_uoms || item.inventory_uom || {};
  const uomRecord = Array.isArray(rawUomRecord) ? rawUomRecord[0] || {} : rawUomRecord;
  const linkedOutlets = (item.linkedOutlets || item.linked_outlets || [])
    .map(normalizeOutletRecord)
    .filter((outlet) => outlet.id);
  const linkedOutletIds = getLinkedOutletIds(item);
  const existingConfigs = new Map([...(item.outletConfigs || []), ...(item.outlet_configs || [])].map((config) => [config.outletId || config.outlet_id, config]));
  const id = item.id || "";
  const name = item.name ?? item.item_name ?? item.itemName ?? "Inventory item";
  const sku = item.sku ?? item.sku_code ?? item.skuCode ?? "";
  const categoryId = item.categoryId ?? item.category_id ?? categoryRecord.id ?? "";
  const categoryName = item.categoryName ?? item.category_name ?? categoryRecord.name ?? "";
  const categoryCode = item.categoryCode ?? item.category_code ?? categoryRecord.code ?? categoryRecord.category_code ?? "";
  const uomCode = item.unit ?? item.uomCode ?? item.uom_code ?? uomRecord.code ?? "";
  const photoUrl = item.photo_url ?? item.photoUrl ?? item.image_url ?? item.item_photo_url ?? item.photo ?? item.image ?? "";
  const rawCost = item.cost ?? item.defaultCost ?? item.default_cost ?? "";
  const cost = rawCost === "" || rawCost === null || rawCost === undefined ? "" : Number(rawCost);
  const description = item.description ?? "";
  const status = String(item.status ?? "active").toLowerCase();
  const createdAt = item.createdAt ?? item.created_at ?? "";
  const updatedAt = item.updatedAt ?? item.updated_at ?? "";
  return {
    ...item,
    id,
    name,
    item_name: name,
    sku,
    sku_code: sku,
    description,
    categoryId,
    category_id: categoryId,
    categoryName,
    category_name: categoryName,
    categoryCode,
    category_code: categoryCode,
    unit: uomCode,
    uomCode,
    uom_code: uomCode,
    cost: Number.isFinite(cost) ? cost : "",
    defaultCost: Number.isFinite(cost) ? cost : "",
    costUpdatedAt: item.costUpdatedAt ?? item.cost_updated_at ?? "",
    cost_updated_at: item.costUpdatedAt ?? item.cost_updated_at ?? "",
    costUpdatedBy: item.costUpdatedBy ?? item.cost_updated_by ?? "",
    cost_updated_by: item.costUpdatedBy ?? item.cost_updated_by ?? "",
    status,
    photo: photoUrl,
    photo_url: photoUrl,
    linkedOutlets,
    linked_outlets: linkedOutlets,
    linkedOutletIds,
    linked_outlet_ids: linkedOutletIds,
    outletConfigs: linkedOutletIds.map((outletId) => buildOutletConfig(item, outletId, existingConfigs.get(outletId))),
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

function normalizeUom(uom = {}) {
  const code = String(uom.code ?? uom.uom_code ?? "").trim();
  return {
    id: uom.id || makeId("uom"),
    code,
    displayName: uom.displayName ?? uom.display_name ?? code,
    uomType: uom.uomType ?? uom.uom_type ?? "General",
    isActive: uom.isActive ?? uom.is_active ?? uom.status !== "inactive",
    sortOrder: Number(uom.sortOrder ?? uom.sort_order ?? 0),
    createdAt: uom.createdAt ?? uom.created_at ?? "",
    updatedAt: uom.updatedAt ?? uom.updated_at ?? "",
  };
}

function mapRemoteCategory(row = {}) {
  return {
    id: row.id,
    name: row.name || "Uncategorized",
    description: row.description || "",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    status: row.status || "active",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

function mapRemoteUom(row = {}) {
  return normalizeUom({
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    uomType: row.uom_type,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapRemoteInventoryItem(row = {}, configs = [], categoryById = new Map(), supplierIdsByConfigId = new Map()) {
  const category = categoryById.get(row.category_id) || row.inventory_categories || row.category || {};
  const linkedOutlets = configs
    .map((config) => normalizeOutletRecord(config.outlets || config.outlet || { id: config.outlet_id }))
    .filter((outlet) => outlet.id);
  const outletConfigs = configs.map((config) => ({
    id: config.id,
    inventoryItemId: config.inventory_item_id,
    outletId: config.outlet_id,
    parLevel: config.par_level === null || config.par_level === undefined ? "" : Number(config.par_level),
    storageLocation: config.storage_location || "",
    supplierIds: supplierIdsByConfigId.get(config.id) || [],
    isActive: config.is_active !== false,
    createdAt: config.created_at || "",
    updatedAt: config.updated_at || "",
  }));
  return normalizeInventoryItem({
    id: row.id,
    name: row.item_name || row.name || "Inventory item",
    sku: row.sku_code || row.sku || "",
    categoryId: row.category_id || "",
    categoryName: row.category_name || category?.name || "",
    categoryCode: row.category_code || category?.code || category?.category_code || "",
    unit: row.unit || row.uom_code || row.uom || "",
    cost: row.cost === null || row.cost === undefined ? "" : Number(row.cost),
    costUpdatedAt: row.cost_updated_at || "",
    costUpdatedBy: row.cost_updated_by || "",
    photo: row.photo_url || row.image_url || row.item_photo_url || row.photo || row.image || "",
    description: row.description || "",
    inventoryType: row.inventory_type || "",
    defaultSupplierId: row.default_supplier_id || "",
    status: row.status || "active",
    linkedOutletIds: uniqueIds(outletConfigs.map((config) => config.outletId)),
    linkedOutlets,
    outletConfigs,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  });
}

function mapRemoteStockCheckGroup(row = {}, categoryIds = []) {
  const schedule = row.schedule_config || {};
  const lastCheckedAt = row.last_checked_at || row.lastCheckedAt || "";
  return {
    id: row.id,
    outletId: row.outlet_id || row.outletId || "",
    name: row.name || "Stock Check Group",
    description: row.description || "",
    categoryIds: uniqueIds(categoryIds),
    itemIds: [],
    frequency: row.frequency_type || row.frequency || "custom",
    checkDays: Array.isArray(row.frequency_days) ? row.frequency_days : (schedule.checkDays || []),
    monthDay: schedule.monthDay || row.month_day || 1,
    shift: row.shift || "Closing",
    assignedStaff: schedule.assignedStaff || row.assigned_staff || "",
    status: row.status || "active",
    lastChecked: lastCheckedAt || "",
    lastCheckedAt,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function mapRemoteStockCheckItem(row = {}) {
  return {
    id: row.id,
    itemId: row.item_id || "",
    categoryId: row.category_id || "",
    expectedQty: row.par_level_quantity === null || row.par_level_quantity === undefined ? "" : Number(row.par_level_quantity),
    actualCount: row.actual_count_quantity === null || row.actual_count_quantity === undefined ? "" : Number(row.actual_count_quantity),
    variance: row.variance === null || row.variance === undefined ? 0 : Number(row.variance),
    unit: row.unit || "",
    status: row.skipped ? "skipped" : (row.status || "normal"),
    notes: row.notes || "",
    skipped: Boolean(row.skipped),
    skipReason: row.skip_reason || "",
    na: row.status === "na",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

function mapRemoteStockCheck(row = {}, rows = []) {
  const checkType = row.stock_check_type || row.check_type || "scheduled";
  const checkDate = normalizeBusinessDate(row.check_date || row.created_at);
  const mappedRows = rows.map(mapRemoteStockCheckItem);
  const categoryIds = row.audit_category_ids?.length
    ? uniqueIds(row.audit_category_ids)
    : uniqueIds(mappedRows.map((item) => item.categoryId).filter(Boolean));
  return {
    id: row.id,
    groupId: row.group_id || "",
    outletId: row.outlet_id || "",
    date: checkDate,
    shift: row.shift || "",
    stockCheckType: checkType,
    auditType: row.audit_type || "",
    auditName: row.audit_name || row.check_name || "",
    auditCategoryIds: categoryIds,
    checkName: row.check_name || "",
    notes: row.notes || "",
    categoryIds,
    status: row.status || "draft",
    rows: mappedRows,
    createdBy: row.created_by || "",
    submittedBy: row.submitted_by || "",
    submittedAt: row.submitted_at || "",
    reviewedAt: row.reviewed_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function mapRemoteEmployeeLite(row = {}) {
  return {
    id: row.id || "",
    authUserId: row.auth_user_id || "",
    fullName: row.full_name || row.name || "",
    nickname: row.nickname || "",
    email: row.email || "",
    name: employeeDisplayName(row),
  };
}

function mapRemotePurchaseOrderItem(row = {}) {
  return {
    id: row.id,
    itemId: row.item_id || "",
    requestedQty: row.requested_qty === null || row.requested_qty === undefined ? 0 : Number(row.requested_qty),
    receivedQty: row.received_qty === null || row.received_qty === undefined ? 0 : Number(row.received_qty),
    unit: row.unit || "",
    remark: row.remark || "",
    sourceStockCheckItemId: row.source_stock_check_item_id || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function mapRemotePurchaseReceiptItem(row = {}) {
  return {
    id: row.id,
    receiptId: row.receipt_id || "",
    purchaseOrderItemId: row.purchase_order_item_id || "",
    itemId: row.item_id || "",
    receivedQty: row.received_qty === null || row.received_qty === undefined ? 0 : Number(row.received_qty),
    unit: row.unit || "",
    remark: row.remark || "",
    createdAt: row.created_at || "",
  };
}

function mapRemotePurchaseReceipt(row = {}, items = []) {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id || "",
    outletId: row.outlet_id || "",
    supplierId: row.supplier_id || "",
    receivedBy: row.received_by || "",
    receivedAt: row.received_at || row.created_at || "",
    remark: row.remark || "",
    createdAt: row.created_at || "",
    items: items.map(mapRemotePurchaseReceiptItem),
  };
}

function mapRemoteInventoryMovement(row = {}) {
  return {
    id: row.id,
    date: normalizeBusinessDate(row.movement_date || row.created_at),
    dateTime: row.created_at || "",
    itemId: row.inventory_item_id || row.item_id || "",
    type: String(row.movement_type || "purchase").toLowerCase(),
    movementType: row.movement_type || "Purchase",
    quantity: row.quantity === null || row.quantity === undefined ? 0 : Number(row.quantity),
    unit: row.unit || "",
    outletId: row.outlet_id || "",
    user: row.created_by || "",
    createdBy: row.created_by || "",
    reference: row.reference_no || "",
    referenceType: row.reference_type || "",
    referenceId: row.reference_id || "",
    notes: row.notes || "",
  };
}

function mapRemoteWasteRecord(row = {}) {
  return {
    id: row.id,
    date: normalizeBusinessDate(row.waste_date || row.created_at),
    itemId: row.inventory_item_id || "",
    outletId: row.outlet_id || "",
    wasteType: row.waste_type || "Unknown",
    quantity: row.quantity === null || row.quantity === undefined ? 0 : Number(row.quantity),
    unit: row.unit || "",
    notes: row.notes || "",
    photoUrl: row.photo_url || "",
    photo_url: row.photo_url || "",
    user: row.created_by || "",
    recordedBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
    value: 0,
  };
}

function mapRemoteRecipeItem(row = {}) {
  return {
    id: row.id,
    itemId: row.inventory_item_id || "",
    quantityUsed: row.quantity_used === null || row.quantity_used === undefined ? 0 : Number(row.quantity_used),
    unit: row.unit || "",
    wastagePercent: row.wastage_percent === null || row.wastage_percent === undefined ? 0 : Number(row.wastage_percent),
    remark: row.remark || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

function mapRemoteMenuCategory(row = {}) {
  return {
    id: row.id || makeId("menu_cat"),
    name: row.name || "",
    description: row.description || "",
    status: row.status || "active",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

function recipeCode(recipe = {}) {
  return String(recipe.recipeCode || recipe.recipe_code || "").trim();
}

function recipeNameEn(recipe = {}) {
  return String(recipe.recipeNameEn || recipe.recipe_name_en || recipe.recipeName || recipe.recipe_name || "").trim();
}

function recipeNameCn(recipe = {}) {
  return String(recipe.recipeNameCn || recipe.recipe_name_cn || "").trim();
}

function recipeDisplayName(recipe = {}) {
  return recipeNameCn(recipe) || recipeNameEn(recipe) || recipeCode(recipe) || "Recipe";
}

const recipeAnalysisPeriodOptions = [
  { value: "current", label: "Current Month", months: 1 },
  { value: "last3", label: "Last 3 Months", months: 3 },
  { value: "last6", label: "Last 6 Months", months: 6 },
  { value: "last12", label: "Last 12 Months", months: 12 },
];

function normalizeProductRecipeKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getRecipeMappingCandidates(recipe = {}) {
  return [
    { type: "recipe_code", value: recipeCode(recipe), confidence: 98 },
    { type: "recipe_name_en", value: recipeNameEn(recipe), confidence: 92 },
    { type: "recipe_name_cn", value: recipeNameCn(recipe), confidence: 88 },
  ].filter((entry) => entry.value);
}

function suggestRecipeMatch(productName, recipes = []) {
  const productKey = normalizeProductRecipeKey(productName);
  if (!productKey) return { recipe: null, confidence: 0, matchType: "" };
  for (const recipe of recipes) {
    const match = getRecipeMappingCandidates(recipe).find((candidate) => normalizeProductRecipeKey(candidate.value) === productKey);
    if (match) return { recipe, confidence: match.confidence, matchType: match.type };
  }
  const fuzzy = recipes
    .map((recipe) => {
      const candidates = getRecipeMappingCandidates(recipe);
      const matched = candidates.find((candidate) => {
        const key = normalizeProductRecipeKey(candidate.value);
        return key && (productKey.includes(key) || key.includes(productKey));
      });
      return matched ? { recipe, confidence: Math.max(55, matched.confidence - 25), matchType: `${matched.type}_partial` } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return fuzzy || { recipe: null, confidence: 0, matchType: "" };
}

function monthSerial(year, month) {
  return Number(year) * 12 + Number(month);
}

function businessMonthSerial(offsetMonths = 0) {
  const [year, month] = getBusinessDateInput("Asia/Kuala_Lumpur").split("-").map(Number);
  return monthSerial(year, month) + offsetMonths;
}

function mapRemoteRecipe(row = {}, items = []) {
  const nameEn = row.recipe_name_en || row.recipe_name || "";
  const nameCn = row.recipe_name_cn || "";
  const code = row.recipe_code || "";
  return {
    id: row.id,
    outletId: row.outlet_id || "",
    recipeCode: code,
    recipe_code: code,
    recipeNameEn: nameEn,
    recipe_name_en: nameEn,
    recipeNameCn: nameCn,
    recipe_name_cn: nameCn,
    recipeName: nameEn || nameCn || code || "Recipe",
    menuCategory: row.menu_category || "",
    recipePhotoUrl: row.recipe_photo_url || "",
    recipe_photo_url: row.recipe_photo_url || "",
    sellingPrice: row.selling_price === null || row.selling_price === undefined ? "" : Number(row.selling_price),
    selling_price: row.selling_price === null || row.selling_price === undefined ? "" : Number(row.selling_price),
    servingSize: row.serving_size === null || row.serving_size === undefined ? "" : String(Number(row.serving_size)),
    status: row.status || "active",
    notes: row.notes || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
    ingredients: items.map(mapRemoteRecipeItem),
  };
}

function mapRemotePurchaseOrder(row = {}, lines = [], receipts = []) {
  return {
    id: row.id,
    poNo: row.po_no || "PO",
    supplierId: row.supplier_id || "",
    outletId: row.outlet_id || "",
    outletIds: row.outlet_id ? [row.outlet_id] : [],
    requestIds: row.source_stock_request_id ? [row.source_stock_request_id] : [],
    status: row.status || "draft",
    sourceType: row.source_type || "manual",
    sourceStockCheckId: row.source_stock_check_id || row.source_check_id || "",
    sourceStockRequestId: row.source_stock_request_id || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    submittedAt: row.submitted_at || "",
    confirmedAt: row.confirmed_at || "",
    completedAt: row.completed_at || "",
    cancelledAt: row.cancelled_at || "",
    cancellationReason: row.cancellation_reason || "",
    completionType: row.completion_type || "",
    completionReason: row.completion_reason || "",
    unfulfilledQty: Number(row.unfulfilled_qty || 0),
    lines: lines.map(mapRemotePurchaseOrderItem),
    receipts: receipts.map((receipt) => mapRemotePurchaseReceipt(receipt, receipt.items || [])),
  };
}

async function loadRemoteInventoryMaster() {
  const itemsResult = await supabase.from("inventory_items").select("*").order("created_at", { ascending: false });
  if (itemsResult.error) throw itemsResult.error;

  const [categoriesResult, uomsResult, itemOutletsResult, itemOutletSuppliersResult, stockGroupsResult, stockGroupCategoriesResult, stockChecksResult, stockCheckItemsResult, purchaseOrdersResult, purchaseOrderItemsResult, purchaseReceiptsResult, purchaseReceiptItemsResult, movementsResult, wasteResult, menuCategoriesResult, recipesResult, recipeItemsResult, employeesResult] = await Promise.all([
    supabase.from("inventory_categories").select("*").order("sort_order", { ascending: true }),
    supabase.from("inventory_uoms").select("*").order("sort_order", { ascending: true }),
    supabase.from("inventory_item_outlets").select("*, outlets:outlet_id(*)"),
    supabase.from("inventory_item_outlet_suppliers").select("*"),
    supabase.from("inventory_stock_check_groups").select("*").order("created_at", { ascending: false }),
    supabase.from("inventory_stock_check_group_categories").select("*"),
    supabase.from("inventory_stock_checks").select("*").order("created_at", { ascending: false }),
    supabase.from("inventory_stock_check_items").select("*").order("created_at", { ascending: true }),
    supabase.from("inventory_purchase_orders").select("*").order("created_at", { ascending: false }),
    supabase.from("inventory_purchase_order_items").select("*").order("created_at", { ascending: true }),
    supabase.from("inventory_purchase_receipts").select("*").order("received_at", { ascending: false }),
    supabase.from("inventory_purchase_receipt_items").select("*").order("created_at", { ascending: true }),
    supabase.from("inventory_movements").select("*").order("created_at", { ascending: false }),
    supabase.from("inventory_waste_records").select("*").order("waste_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("inventory_menu_categories").select("*").order("sort_order", { ascending: true }),
    supabase.from("inventory_recipes").select("*").order("created_at", { ascending: false }),
    supabase.from("inventory_recipe_items").select("*").order("created_at", { ascending: true }),
    supabase.from("employees").select("id, auth_user_id, full_name, nickname, email"),
  ]);
  if (categoriesResult.error) console.warn("[InventoryControl] Inventory categories metadata unavailable. Items will still render.", categoriesResult.error);
  if (uomsResult.error) console.warn("[InventoryControl] Inventory UOM metadata unavailable. Items will still render.", uomsResult.error);
  if (itemOutletSuppliersResult.error) console.warn("[InventoryControl] Inventory outlet supplier links unavailable. Items will still render without supplier assignments.", itemOutletSuppliersResult.error);
  if (stockGroupsResult.error) console.warn("[InventoryControl] Stock check groups unavailable. Groups will render empty until persistence is configured.", stockGroupsResult.error);
  if (stockGroupCategoriesResult.error) console.warn("[InventoryControl] Stock check group category links unavailable.", stockGroupCategoriesResult.error);
  if (stockChecksResult.error) console.warn("[InventoryControl] Stock checks unavailable. Drafts and results will render empty until persistence is configured.", stockChecksResult.error);
  if (stockCheckItemsResult.error) console.warn("[InventoryControl] Stock check item rows unavailable.", stockCheckItemsResult.error);
  if (purchaseOrdersResult.error) console.warn("[InventoryControl] Purchase orders unavailable. Draft POs will render empty until persistence is configured.", purchaseOrdersResult.error);
  if (purchaseOrderItemsResult.error) console.warn("[InventoryControl] Purchase order items unavailable.", purchaseOrderItemsResult.error);
  if (purchaseReceiptsResult.error) console.warn("[InventoryControl] Purchase receipts unavailable. Receiving history will render empty until persistence is configured.", purchaseReceiptsResult.error);
  if (purchaseReceiptItemsResult.error) console.warn("[InventoryControl] Purchase receipt items unavailable.", purchaseReceiptItemsResult.error);
  if (movementsResult.error) console.warn("[InventoryControl] Inventory movements unavailable. Movement history will render empty until persistence is configured.", movementsResult.error);
  if (wasteResult.error) console.warn("[InventoryControl] Waste records unavailable. Waste & Variance will render empty until persistence is configured.", wasteResult.error);
  if (menuCategoriesResult.error) console.warn("[InventoryControl] Menu categories unavailable. Recipes & Usage will use default menu category labels.", menuCategoriesResult.error);
  if (recipesResult.error) console.warn("[InventoryControl] Recipes unavailable. Recipes & Usage will render empty until persistence is configured.", recipesResult.error);
  if (recipeItemsResult.error) console.warn("[InventoryControl] Recipe ingredients unavailable.", recipeItemsResult.error);
  if (employeesResult.error) console.warn("[InventoryControl] Employee names unavailable. Stock checks will show fallback checker names.", employeesResult.error);
  debugLog("[WasteFetchDebug]", { result: { data: wasteResult.data || [], error: wasteResult.error }, error: wasteResult.error });
  debugLog("[RecipeFetchDebug]", { result: { recipes: recipesResult.data || [], items: recipeItemsResult.data || [], recipeError: recipesResult.error, itemError: recipeItemsResult.error } });

  let itemOutletRows = itemOutletsResult.data || [];
  if (itemOutletsResult.error) {
    console.warn("[InventoryControl] Outlet join unavailable. Falling back to plain inventory_item_outlets query.", itemOutletsResult.error);
    const fallbackItemOutletsResult = await supabase.from("inventory_item_outlets").select("*");
    if (fallbackItemOutletsResult.error) {
      console.warn("[InventoryControl] Inventory outlet links unavailable. Items will still render without outlet chips.", fallbackItemOutletsResult.error);
    } else {
      itemOutletRows = fallbackItemOutletsResult.data || [];
    }
  }

  const categories = (categoriesResult.data || []).map(mapRemoteCategory);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const supplierIdsByConfigId = new Map();
  (itemOutletSuppliersResult.data || []).forEach((link) => {
    const list = supplierIdsByConfigId.get(link.inventory_item_outlet_id) || [];
    if (link.supplier_id) list.push(link.supplier_id);
    supplierIdsByConfigId.set(link.inventory_item_outlet_id, uniqueIds(list));
  });
  const configsByItem = new Map();
  itemOutletRows.forEach((config) => {
    const list = configsByItem.get(config.inventory_item_id) || [];
    list.push(config);
    configsByItem.set(config.inventory_item_id, list);
  });
  const itemRows = itemsResult.data || [];
  const normalizedItems = itemRows.map((item) => mapRemoteInventoryItem(item, configsByItem.get(item.id) || [], categoryById, supplierIdsByConfigId));
  const activeItems = normalizedItems.filter((item) => String(item.status || "").toLowerCase() === "active");
  const categoryIdsByGroupId = new Map();
  (stockGroupCategoriesResult.data || []).forEach((link) => {
    const list = categoryIdsByGroupId.get(link.group_id) || [];
    if (link.category_id) list.push(link.category_id);
    categoryIdsByGroupId.set(link.group_id, uniqueIds(list));
  });
  const groups = (stockGroupsResult.data || []).map((group) => mapRemoteStockCheckGroup(group, categoryIdsByGroupId.get(group.id) || []));
  const checkItemsByCheckId = new Map();
  (stockCheckItemsResult.data || []).forEach((row) => {
    const list = checkItemsByCheckId.get(row.stock_check_id) || [];
    list.push(row);
    checkItemsByCheckId.set(row.stock_check_id, list);
  });
  const checks = (stockChecksResult.data || []).map((check) => mapRemoteStockCheck(check, checkItemsByCheckId.get(check.id) || []));
  debugLog("[SubmittedScheduledChecksDebug]");
  debugTable((stockChecksResult.data || [])
    .filter((check) => (check.stock_check_type || check.check_type || "scheduled") === "scheduled" && ["submitted", "reviewed", "locked"].includes(check.status))
    .map((check) => ({
      id: check.id,
      group_id: check.group_id,
      outlet_id: check.outlet_id,
      check_date: check.check_date,
      shift: check.shift,
      status: check.status,
      check_type: check.stock_check_type || check.check_type || "scheduled",
      submitted_at: check.submitted_at,
    })));
  const purchaseItemsByOrderId = new Map();
  (purchaseOrderItemsResult.data || []).forEach((row) => {
    const list = purchaseItemsByOrderId.get(row.purchase_order_id) || [];
    list.push(row);
    purchaseItemsByOrderId.set(row.purchase_order_id, list);
  });
  const receiptItemsByReceiptId = new Map();
  (purchaseReceiptItemsResult.data || []).forEach((row) => {
    const list = receiptItemsByReceiptId.get(row.receipt_id) || [];
    list.push(row);
    receiptItemsByReceiptId.set(row.receipt_id, list);
  });
  const receiptsByOrderId = new Map();
  (purchaseReceiptsResult.data || []).forEach((receipt) => {
    const list = receiptsByOrderId.get(receipt.purchase_order_id) || [];
    list.push({ ...receipt, items: receiptItemsByReceiptId.get(receipt.id) || [] });
    receiptsByOrderId.set(receipt.purchase_order_id, list);
  });
  const orders = (purchaseOrdersResult.data || []).map((order) => mapRemotePurchaseOrder(order, purchaseItemsByOrderId.get(order.id) || [], receiptsByOrderId.get(order.id) || []));
  const recipeItemsByRecipeId = new Map();
  (recipeItemsResult.data || []).forEach((row) => {
    const list = recipeItemsByRecipeId.get(row.recipe_id) || [];
    list.push(row);
    recipeItemsByRecipeId.set(row.recipe_id, list);
  });
  const recipes = (recipesResult.data || []).map((recipe) => mapRemoteRecipe(recipe, recipeItemsByRecipeId.get(recipe.id) || []));
  const menuCategories = menuCategoriesResult.error
    ? recipeMenuCategories.map((name, index) => mapRemoteMenuCategory({ id: `default_menu_${index + 1}`, name, sort_order: index + 1, status: "active" }))
    : (menuCategoriesResult.data || []).map(mapRemoteMenuCategory);

  debugLog("[InventoryFetchRaw]", {
    itemRows: itemRows.map((row) => ({
      id: row.id,
      name: row.item_name || row.name,
      status: row.status,
      category_id: row.category_id,
      uom_code: row.uom_code,
      unit: row.unit,
      photo_url: row.photo_url,
      image_url: row.image_url,
      item_photo_url: row.item_photo_url,
      photo: row.photo,
      image: row.image,
      created_by: row.created_by,
      archived_at: row.archived_at,
    })),
    itemCount: itemRows.length,
    error: itemsResult.error || null,
  });
  debugTable(normalizedItems.map((item) => ({
    id: item.id,
    name: item.name,
    category_id: item.category_id,
    category_name: item.category_name,
    uom: item.uom_code,
    photo: item.photo_url,
    status: item.status,
    outlets: item.linked_outlets?.map(outletDisplayCode).join(","),
  })));
  debugLog("[InventoryMissingAnalysis]", {
    allInventoryItemsCount: itemRows.length,
    allInventoryItemNames: itemRows.map((item) => item.item_name || item.name || item.id),
    afterStatusFilterCount: activeItems.length,
    afterStatusFilterNames: activeItems.map((item) => item.name),
    afterJoinMappingCount: normalizedItems.length,
    afterJoinMappingNames: normalizedItems.map((item) => item.name),
    missingExpectedItems: ["HHHHHHHHHH", "Test", "Sambal Sauce", "Takeaway Cup 12oz", "Frozen Chicken Cut"].filter((name) => !normalizedItems.some((item) => item.name === name)),
  });

  return {
    categories,
    items: normalizedItems,
    uoms: (uomsResult.data || []).map(mapRemoteUom),
    groups,
    checks,
    orders,
    movements: (movementsResult.data || []).map(mapRemoteInventoryMovement),
    waste: (wasteResult.data || []).map(mapRemoteWasteRecord),
    menuCategories,
    recipes,
    people: (employeesResult.data || []).map(mapRemoteEmployeeLite),
    rawItemCount: itemRows.length,
    outletLinkCount: itemOutletRows.length,
    fallbackActive: false,
  };
}

async function persistRemoteInventoryItem(item, userId, accessibleOutletIds = null) {
  const normalized = normalizeInventoryItem(item);
  const mode = isUuid(normalized.id) ? "edit" : "create";
  const itemPayload = {
    item_name: normalized.name,
    sku_code: normalized.sku || null,
    category_id: isUuid(normalized.categoryId) ? normalized.categoryId : null,
    unit: normalized.unit || null,
    cost: normalized.cost === "" || normalized.cost === null || normalized.cost === undefined ? null : Number(normalized.cost),
    photo_url: normalized.photo || normalized.photo_url || null,
    description: normalized.description || null,
    inventory_type: normalized.inventoryType || null,
    default_supplier_id: isUuid(normalized.defaultSupplierId) ? normalized.defaultSupplierId : null,
    status: normalized.status || "active",
    updated_by: userId || null,
  };
  if (itemPayload.cost !== null && (!Number.isFinite(itemPayload.cost) || itemPayload.cost < 0)) throw new Error("Cost must be a non-negative number.");
  if (item.costMetadataChanged === true) {
    itemPayload.cost_updated_at = new Date().toISOString();
    itemPayload.cost_updated_by = isUuid(item.costUpdatedBy || item.cost_updated_by) ? (item.costUpdatedBy || item.cost_updated_by) : null;
  }
  const debug = {
    mode,
    payload: itemPayload,
    itemId: normalized.id || null,
    selectedUom: normalized.unit || null,
    savedUnit: null,
    photoUrl: itemPayload.photo_url,
    linkedOutletIds: uniqueIds(normalized.linkedOutletIds || []),
    itemInsertResult: null,
    itemUpdateResult: null,
    outletLinksPayload: [],
    outletLinksResult: null,
    outletDeleteResult: null,
    error: null,
  };
  const selectedOutletIds = uniqueIds(normalized.linkedOutletIds || []).filter((outletId) => isUuid(outletId));
  const hasExplicitAccessibleScope = Array.isArray(accessibleOutletIds);
  const accessibleSet = hasExplicitAccessibleScope ? new Set(accessibleOutletIds) : null;
  const inScope = (outletId) => !accessibleSet || accessibleSet.has(outletId);
  const selectedOutletIdsInScope = selectedOutletIds.filter(inScope);
  const skippedSelectedOutOfScope = selectedOutletIds.filter((outletId) => !inScope(outletId));

  let savedItem = null;
  if (mode === "edit") {
    const result = await supabase
      .from("inventory_items")
      .update(itemPayload)
      .eq("id", normalized.id)
      .select("*")
      .single();
    debug.itemUpdateResult = { data: result.data, error: result.error };
    if (result.error) {
      debug.error = result.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      throw result.error;
    }
    savedItem = result.data;
  } else {
    const result = await supabase
      .from("inventory_items")
      .insert({ ...itemPayload, created_by: userId || null })
      .select("*")
      .single();
    debug.itemInsertResult = { data: result.data, error: result.error };
    if (result.error) {
      debug.error = result.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      throw result.error;
    }
    savedItem = result.data;
  }
  debug.savedUnit = savedItem?.unit || savedItem?.uom_code || null;

  const remoteItemId = savedItem.id;
  const { data: existingLinks, error: existingLinksError } = await supabase
    .from("inventory_item_outlets")
    .select("id,outlet_id")
    .eq("inventory_item_id", remoteItemId);
  if (existingLinksError) {
    debug.error = existingLinksError;
    debugLog("[InventorySaveDebug]", debug);
    debugLog("[InventoryItemSaveDebug]", debug);
    debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds: [], accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd: [], toRemove: [], skippedOutOfScope: skippedSelectedOutOfScope, error: existingLinksError });
    throw existingLinksError;
  }
  const existingOutletIds = uniqueIds((existingLinks || []).map((row) => row.outlet_id).filter(Boolean));
  const existingOutletIdsInScope = existingOutletIds.filter(inScope);
  const toAdd = selectedOutletIdsInScope.filter((outletId) => !existingOutletIdsInScope.includes(outletId));
  const toRemove = existingOutletIdsInScope.filter((outletId) => !selectedOutletIdsInScope.includes(outletId));
  const skippedOutOfScope = uniqueIds([
    ...skippedSelectedOutOfScope,
    ...existingOutletIds.filter((outletId) => !inScope(outletId)),
  ]);

  debugLog("[InventoryLinkedOutletsSaveDebug]", {
    itemId: remoteItemId,
    existingOutletIds,
    accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null,
    selectedOutletIds,
    toAdd,
    toRemove,
    skippedOutOfScope,
  });

  const configRows = selectedOutletIdsInScope
    .map((outletId) => {
      const config = outletConfigForItem(normalized, outletId);
      return {
        inventory_item_id: remoteItemId,
        outlet_id: outletId,
        par_level: config.parLevel === "" || config.parLevel === null || config.parLevel === undefined ? null : Number(config.parLevel),
        storage_location: config.storageLocation || null,
        is_active: true,
      };
    });
  debug.outletLinksPayload = configRows;

  if (toRemove.length) {
    const deleteResult = await supabase
      .from("inventory_item_outlets")
      .delete()
      .eq("inventory_item_id", remoteItemId)
      .in("outlet_id", toRemove);
    debug.outletDeleteResult = { data: deleteResult.data || null, error: deleteResult.error };
    if (deleteResult.error) {
      const error = new Error("Item saved, but outlet links failed.");
      error.cause = deleteResult.error;
      error.partialItemSaved = true;
      error.debug = debug;
      debug.error = deleteResult.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds, accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd, toRemove, skippedOutOfScope, error: deleteResult.error });
      throw error;
    }
  } else {
    debug.outletDeleteResult = { data: null, error: null };
  }

  if (configRows.length) {
    const configResult = await supabase
      .from("inventory_item_outlets")
      .upsert(configRows, { onConflict: "inventory_item_id,outlet_id" });
    debug.outletLinksResult = { data: configResult.data || null, error: configResult.error };
    if (configResult.error) {
      const error = new Error("Item saved, but outlet links failed.");
      error.cause = configResult.error;
      error.partialItemSaved = true;
      error.debug = debug;
      debug.error = configResult.error;
      debugLog("[InventorySaveDebug]", debug);
      debugLog("[InventoryItemSaveDebug]", debug);
      debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds, accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd, toRemove, skippedOutOfScope, error: configResult.error });
      throw error;
    }
  }

  const { data: savedConfigs, error: configsError } = await supabase
    .from("inventory_item_outlets")
    .select("*, outlets:outlet_id(*)")
    .eq("inventory_item_id", remoteItemId);
  if (configsError) {
    debug.error = configsError;
    debugLog("[InventorySaveDebug]", debug);
    debugLog("[InventoryItemSaveDebug]", debug);
    throw configsError;
  }
  debugLog("[InventorySaveDebug]", debug);
  debugLog("[InventoryItemSaveDebug]", debug);
  debugLog("[InventoryLinkedOutletsSaveDebug]", { itemId: remoteItemId, existingOutletIds, accessibleOutletIds: hasExplicitAccessibleScope ? accessibleOutletIds : null, selectedOutletIds, toAdd, toRemove, skippedOutOfScope, error: null });
  return mapRemoteInventoryItem(savedItem, savedConfigs || []);
}

async function persistRemoteInventoryCategory(category) {
  const payload = {
    name: String(category.name || "").trim(),
    description: String(category.description || "").trim() || null,
    sort_order: Number(category.sortOrder ?? category.sort_order ?? 0) || 0,
    status: category.status || "active",
    updated_at: new Date().toISOString(),
  };
  if (!payload.name) throw new Error("Category name is required.");

  if (isUuid(category.id)) {
    const { data, error } = await supabase
      .from("inventory_categories")
      .update(payload)
      .eq("id", category.id)
      .select("*")
      .single();
    if (error) throw error;
    return mapRemoteCategory(data);
  }

  const { data, error } = await supabase
    .from("inventory_categories")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return mapRemoteCategory(data);
}

async function countRemoteInventoryItemsForCategory(categoryId) {
  if (!isUuid(categoryId)) return 0;
  const { count, error } = await supabase
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);
  if (error) throw error;
  return count || 0;
}

async function persistRemoteInventoryUom(uom) {
  const normalized = normalizeUom(uom);
  const payload = {
    code: String(normalized.code || "").trim(),
    display_name: String(normalized.displayName || "").trim(),
    uom_type: String(normalized.uomType || "").trim() || "General",
    is_active: Boolean(normalized.isActive),
    sort_order: Number(normalized.sortOrder ?? 0) || 0,
    updated_at: new Date().toISOString(),
  };
  if (!payload.code || !payload.display_name || !payload.uom_type) throw new Error("UOM code, display name and type are required.");

  if (isUuid(normalized.id)) {
    const result = await supabase
      .from("inventory_uoms")
      .update(payload)
      .eq("id", normalized.id)
      .select("*")
      .single();
    debugLog("[UomSaveDebug]", { action: "update", payload, result: { data: result.data, error: result.error }, error: result.error });
    if (result.error) throw result.error;
    return mapRemoteUom(result.data);
  }

  const result = await supabase
    .from("inventory_uoms")
    .insert(payload)
    .select("*")
    .single();
  debugLog("[UomSaveDebug]", { action: "create", payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteUom(result.data);
}

async function countRemoteInventoryItemsForUom(code) {
  const rawCode = String(code || "").trim();
  if (!rawCode) return 0;
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, unit");
  if (error) throw error;
  return (data || []).filter((item) => canonical(item.unit) === canonical(rawCode)).length;
}

async function persistRemoteParLevelConfig(item, outletId, patch) {
  const normalized = normalizeInventoryItem(item);
  if (!isUuid(normalized.id) || !isUuid(outletId)) throw new Error("Valid item and outlet are required.");
  const existing = outletConfigForItem(normalized, outletId);
  const payload = {
    inventory_item_id: normalized.id,
    outlet_id: outletId,
    par_level: Object.prototype.hasOwnProperty.call(patch, "parLevel")
      ? (patch.parLevel === "" || patch.parLevel === null || patch.parLevel === undefined ? null : Number(patch.parLevel))
      : (existing.parLevel === "" || existing.parLevel === null || existing.parLevel === undefined ? null : Number(existing.parLevel)),
    storage_location: Object.prototype.hasOwnProperty.call(patch, "storageLocation") ? (patch.storageLocation || null) : (existing.storageLocation || null),
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  if (payload.par_level !== null && (!Number.isFinite(payload.par_level) || payload.par_level < 0)) throw new Error("Par Level must be a non-negative number.");

  const configResult = await supabase
    .from("inventory_item_outlets")
    .upsert(payload, { onConflict: "inventory_item_id,outlet_id" })
    .select("*")
    .single();
  debugLog("[ParLevelSaveDebug]", { action: "upsert-config", itemId: normalized.id, outletId, payload, result: { data: configResult.data, error: configResult.error }, error: configResult.error });
  if (configResult.error) throw configResult.error;

  if (Object.prototype.hasOwnProperty.call(patch, "supplierIds")) {
    const supplierIds = uniqueIds(patch.supplierIds || []).filter(isUuid);
    const deleteResult = await supabase
      .from("inventory_item_outlet_suppliers")
      .delete()
      .eq("inventory_item_outlet_id", configResult.data.id);
    debugLog("[ParLevelSaveDebug]", { action: "delete-suppliers", itemId: normalized.id, outletId, payload: { supplierIds }, result: { data: deleteResult.data || null, error: deleteResult.error }, error: deleteResult.error });
    if (deleteResult.error) throw deleteResult.error;
    if (supplierIds.length) {
      const supplierPayload = supplierIds.map((supplierId) => ({
        inventory_item_outlet_id: configResult.data.id,
        supplier_id: supplierId,
        updated_at: new Date().toISOString(),
      }));
      const supplierResult = await supabase
        .from("inventory_item_outlet_suppliers")
        .insert(supplierPayload);
      debugLog("[ParLevelSaveDebug]", { action: "insert-suppliers", itemId: normalized.id, outletId, payload: supplierPayload, result: { data: supplierResult.data || null, error: supplierResult.error }, error: supplierResult.error });
      if (supplierResult.error) throw supplierResult.error;
    }
  }

  return {
    ...buildOutletConfig(normalized, outletId, existing),
    id: configResult.data.id,
    parLevel: configResult.data.par_level === null || configResult.data.par_level === undefined ? "" : Number(configResult.data.par_level),
    storageLocation: configResult.data.storage_location || "",
    supplierIds: Object.prototype.hasOwnProperty.call(patch, "supplierIds") ? uniqueIds(patch.supplierIds || []) : existing.supplierIds,
    updatedAt: configResult.data.updated_at || new Date().toISOString(),
  };
}

async function persistRemoteStockCheckGroup(group) {
  const categoryIds = uniqueIds(groupCategoryIds(group, []));
  const frequency = frequencies.includes(group.frequency) ? group.frequency : "custom";
  const payload = {
    outlet_id: isUuid(group.outletId) ? group.outletId : null,
    name: String(group.name || "").trim(),
    description: String(group.description || "").trim() || null,
    shift: group.shift || "Closing",
    frequency_type: frequency,
    frequency_days: frequency === "custom" ? (group.checkDays || []) : [],
    schedule_config: {
      monthDay: group.monthDay || 1,
      checkDays: frequency === "custom" ? (group.checkDays || []) : [],
      assignedStaff: group.assignedStaff || "",
    },
    status: group.status || "active",
    last_checked_at: group.lastCheckedAt || (group.lastChecked ? businessDateToTimestamp(group.lastChecked) : null),
    updated_at: new Date().toISOString(),
  };
  if (!payload.name) throw new Error("Group name is required.");
  if (!payload.outlet_id) throw new Error("Outlet is required.");

  const mode = isUuid(group.id) ? "edit" : "create";
  const groupResult = mode === "edit"
    ? await supabase
      .from("inventory_stock_check_groups")
      .update(payload)
      .eq("id", group.id)
      .select("*")
      .single()
    : await supabase
      .from("inventory_stock_check_groups")
      .insert(payload)
      .select("*")
      .single();
  debugLog("[StockCheckGroupSaveDebug]", { action: mode, payload, categoryIds, result: { data: groupResult.data, error: groupResult.error }, error: groupResult.error });
  if (groupResult.error) throw groupResult.error;

  const groupId = groupResult.data.id;
  const deleteResult = await supabase
    .from("inventory_stock_check_group_categories")
    .delete()
    .eq("group_id", groupId);
  debugLog("[StockCheckGroupSaveDebug]", { action: "delete-category-links", groupId, result: { data: deleteResult.data || null, error: deleteResult.error }, error: deleteResult.error });
  if (deleteResult.error) throw deleteResult.error;

  if (categoryIds.length) {
    const linkPayload = categoryIds.map((categoryId) => ({ group_id: groupId, category_id: categoryId }));
    const linkResult = await supabase
      .from("inventory_stock_check_group_categories")
      .insert(linkPayload);
    debugLog("[StockCheckGroupSaveDebug]", { action: "insert-category-links", groupId, payload: linkPayload, result: { data: linkResult.data || null, error: linkResult.error }, error: linkResult.error });
    if (linkResult.error) throw linkResult.error;
  }

  return mapRemoteStockCheckGroup(groupResult.data, categoryIds);
}

async function archiveRemoteStockCheckGroup(groupId) {
  if (!isUuid(groupId)) throw new Error("This stock check group has not been saved to Supabase yet.");
  const result = await supabase
    .from("inventory_stock_check_groups")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .select("*")
    .single();
  debugLog("[StockCheckGroupSaveDebug]", { action: "archive", groupId, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteStockCheckGroup(result.data);
}

async function persistRemoteStockCheck(activeGroup, rows = [], status = "draft", userId, employeeId) {
  if (!activeGroup) throw new Error("Stock check is not active.");
  const isAudit = activeGroup.stockCheckType === "audit";
  const checkDate = normalizeBusinessDate(activeGroup.date);
  const existingId = isUuid(activeGroup.existingCheckId) ? activeGroup.existingCheckId : (isUuid(activeGroup.id) && isAudit ? activeGroup.id : "");
  const submittedAt = status === "submitted" ? new Date().toISOString() : null;
  const payload = {
    outlet_id: isUuid(activeGroup.outletId) ? activeGroup.outletId : null,
    group_id: isAudit ? null : (isUuid(activeGroup.id) ? activeGroup.id : null),
    stock_check_type: isAudit ? "audit" : "scheduled",
    check_name: isAudit ? (activeGroup.auditName || activeGroup.name || "Audit Stock Check") : (activeGroup.name || "Stock Check"),
    shift: activeGroup.shift || (isAudit ? "Audit" : null),
    check_date: checkDate,
    audit_type: isAudit ? (activeGroup.auditType || "Custom Audit") : null,
    audit_name: isAudit ? (activeGroup.auditName || activeGroup.name || "Audit Stock Check") : null,
    audit_category_ids: isAudit ? uniqueIds(activeGroup.categoryIds || activeGroup.auditCategoryIds || []) : [],
    notes: activeGroup.notes || null,
    status,
    submitted_at: submittedAt,
    updated_at: new Date().toISOString(),
  };
  if (status === "submitted" && isUuid(employeeId)) payload.submitted_by = employeeId;
  if (!payload.outlet_id) throw new Error("Outlet is required.");
  if (!isAudit && !payload.group_id) throw new Error("Stock check group is required.");

  const action = status === "submitted" ? "submit" : "save-draft";
  const logLabel = isAudit ? "[AuditStockCheckDebug]" : status === "submitted" ? "[StockCheckSubmitDebug]" : "[StockCheckSaveDebug]";
  const debug = { action, payload, rows, checkResult: null, deleteItemsResult: null, insertItemsResult: null, groupUpdateResult: null, error: null };

  const checkResult = existingId
    ? await supabase
      .from("inventory_stock_checks")
      .update(payload)
      .eq("id", existingId)
      .select("*")
      .single()
    : await supabase
      .from("inventory_stock_checks")
      .insert({ ...payload, created_by: userId || null })
      .select("*")
      .single();
  debug.checkResult = { data: checkResult.data, error: checkResult.error };
  if (checkResult.error) {
    debug.error = checkResult.error;
    debugLog(logLabel, debug);
    throw checkResult.error;
  }

  const checkId = checkResult.data.id;
  const deleteItemsResult = await supabase
    .from("inventory_stock_check_items")
    .delete()
    .eq("stock_check_id", checkId);
  debug.deleteItemsResult = { data: deleteItemsResult.data || null, error: deleteItemsResult.error };
  if (deleteItemsResult.error) {
    debug.error = deleteItemsResult.error;
    debugLog(logLabel, debug);
    throw deleteItemsResult.error;
  }

  const itemPayload = rows.map((row) => {
    const actualMissing = row.actualCount === "" || row.actualCount === null || row.actualCount === undefined;
    return {
      stock_check_id: checkId,
      item_id: isUuid(row.itemId) ? row.itemId : null,
      category_id: isUuid(row.categoryId) ? row.categoryId : null,
      par_level_quantity: row.expectedQty === "" || row.expectedQty === null || row.expectedQty === undefined ? null : Number(row.expectedQty),
      actual_count_quantity: row.skipped || actualMissing ? null : Number(row.actualCount),
      variance: row.skipped || row.na ? null : Number(row.variance || 0),
      unit: row.unit || null,
      status: row.skipped ? "skipped" : (row.na ? "na" : row.status || "normal"),
      notes: row.notes || null,
      skipped: Boolean(row.skipped),
      skip_reason: row.skipped ? (row.skipReason || null) : null,
      updated_at: new Date().toISOString(),
    };
  });

  if (itemPayload.length) {
    const insertItemsResult = await supabase
      .from("inventory_stock_check_items")
      .insert(itemPayload)
      .select("*");
    debug.insertItemsResult = { data: insertItemsResult.data, error: insertItemsResult.error };
    if (insertItemsResult.error) {
      debug.error = insertItemsResult.error;
      debugLog(logLabel, debug);
      throw insertItemsResult.error;
    }
  } else {
    debug.insertItemsResult = { data: [], error: null };
  }

  if (!isAudit && status === "submitted") {
    const groupUpdateResult = await supabase
      .from("inventory_stock_check_groups")
      .update({ last_checked_at: checkResult.data.submitted_at || new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", payload.group_id);
    debug.groupUpdateResult = { data: groupUpdateResult.data || null, error: groupUpdateResult.error };
    if (groupUpdateResult.error) {
      debug.error = groupUpdateResult.error;
      debugLog(logLabel, debug);
      throw groupUpdateResult.error;
    }
  }

  debugLog(logLabel, debug);
  const savedItemsResult = await supabase
    .from("inventory_stock_check_items")
    .select("*")
    .eq("stock_check_id", checkId)
    .order("created_at", { ascending: true });
  if (savedItemsResult.error) throw savedItemsResult.error;
  return mapRemoteStockCheck(checkResult.data, savedItemsResult.data || []);
}

async function deleteRemoteStockCheckDraft(checkId) {
  if (!isUuid(checkId)) throw new Error("This audit draft has not been saved to Supabase yet.");
  const checkResult = await supabase
    .from("inventory_stock_checks")
    .select("id,status,stock_check_type")
    .eq("id", checkId)
    .single();
  debugLog("[AuditStockCheckDebug]", { action: "delete-draft-read", checkId, result: { data: checkResult.data, error: checkResult.error }, error: checkResult.error });
  if (checkResult.error) throw checkResult.error;
  if (checkResult.data?.status !== "draft") throw new Error("Only draft audit stock checks can be deleted.");
  if (checkResult.data?.stock_check_type !== "audit") throw new Error("Only audit drafts can be deleted from this action.");

  const deleteItemsResult = await supabase
    .from("inventory_stock_check_items")
    .delete()
    .eq("stock_check_id", checkId);
  debugLog("[AuditStockCheckDebug]", { action: "delete-draft-items", checkId, result: { data: deleteItemsResult.data || null, error: deleteItemsResult.error }, error: deleteItemsResult.error });
  if (deleteItemsResult.error) throw deleteItemsResult.error;

  const deleteCheckResult = await supabase
    .from("inventory_stock_checks")
    .delete()
    .eq("id", checkId);
  debugLog("[AuditStockCheckDebug]", { action: "delete-draft-check", checkId, result: { data: deleteCheckResult.data || null, error: deleteCheckResult.error }, error: deleteCheckResult.error });
  if (deleteCheckResult.error) throw deleteCheckResult.error;
  return true;
}

async function fetchRemotePurchaseOrdersForStockCheck(stockCheckId) {
  if (!isUuid(stockCheckId)) return [];
  const ordersResult = await supabase
    .from("inventory_purchase_orders")
    .select("*")
    .eq("source_type", "stock_check")
    .eq("source_stock_check_id", stockCheckId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  debugLog("[PurchaseSuggestionDebug]", { action: "fetch-linked-orders", stockCheckId, result: { data: ordersResult.data, error: ordersResult.error }, error: ordersResult.error });
  if (ordersResult.error) throw ordersResult.error;
  const orderIds = (ordersResult.data || []).map((order) => order.id);
  if (!orderIds.length) return [];
  const itemsResult = await supabase
    .from("inventory_purchase_order_items")
    .select("*")
    .in("purchase_order_id", orderIds)
    .order("created_at", { ascending: true });
  debugLog("[PurchaseSuggestionDebug]", { action: "fetch-linked-order-items", stockCheckId, orderIds, result: { data: itemsResult.data, error: itemsResult.error }, error: itemsResult.error });
  if (itemsResult.error) throw itemsResult.error;
  const itemsByOrderId = new Map();
  (itemsResult.data || []).forEach((row) => {
    const list = itemsByOrderId.get(row.purchase_order_id) || [];
    list.push(row);
    itemsByOrderId.set(row.purchase_order_id, list);
  });
  return (ordersResult.data || []).map((order) => mapRemotePurchaseOrder(order, itemsByOrderId.get(order.id) || []));
}

async function persistRemoteDraftPurchaseOrders(stockCheck, suggestionRows = [], userId) {
  if (!isUuid(stockCheck?.id)) throw new Error("Stock check must be saved before creating Draft PO.");
  if (stockCheck.stockCheckType !== "scheduled" || stockCheck.status !== "submitted") {
    throw new Error("Purchase Suggestions are only available for submitted scheduled stock checks.");
  }
  const includedRows = suggestionRows.filter((row) => Number(row.suggestedOrderQty || 0) > 0 && row.include !== false);
  if (!includedRows.length) throw new Error("No included shortage items to create Draft PO.");
  const missingSupplier = includedRows.find((row) => !isUuid(row.selectedSupplierId));
  if (missingSupplier) throw new Error("Choose a supplier for every included item before creating Draft PO.");

  const existingOrders = await fetchRemotePurchaseOrdersForStockCheck(stockCheck.id);
  if (existingOrders.length) {
    const error = new Error("Draft PO already created for this stock check.");
    error.existingOrders = existingOrders;
    throw error;
  }

  const stockCheckItemIds = uniqueIds(includedRows.map((row) => row.stockCheckItemId).filter(isUuid));
  if (stockCheckItemIds.length) {
    const duplicateItemsResult = await supabase
      .from("inventory_purchase_order_items")
      .select("id, source_stock_check_item_id, purchase_order_id")
      .in("source_stock_check_item_id", stockCheckItemIds);
    debugLog("[CreateDraftPODebug]", { action: "duplicate-item-check", stockCheckId: stockCheck.id, stockCheckItemIds, result: { data: duplicateItemsResult.data, error: duplicateItemsResult.error }, error: duplicateItemsResult.error });
    if (duplicateItemsResult.error) throw duplicateItemsResult.error;
    const duplicateOrderIds = uniqueIds((duplicateItemsResult.data || []).map((row) => row.purchase_order_id).filter(isUuid));
    if (duplicateOrderIds.length) {
      const duplicateOrdersResult = await supabase
        .from("inventory_purchase_orders")
        .select("*")
        .in("id", duplicateOrderIds)
        .neq("status", "cancelled");
      debugLog("[CreateDraftPODebug]", { action: "duplicate-order-check", stockCheckId: stockCheck.id, duplicateOrderIds, result: { data: duplicateOrdersResult.data, error: duplicateOrdersResult.error }, error: duplicateOrdersResult.error });
      if (duplicateOrdersResult.error) throw duplicateOrdersResult.error;
      if ((duplicateOrdersResult.data || []).length) {
        const error = new Error("Draft PO already created for this stock check.");
        error.existingOrders = existingOrders;
        throw error;
      }
    }
  }

  const supplierGroups = includedRows.reduce((groups, row) => {
    if (!groups.has(row.selectedSupplierId)) groups.set(row.selectedSupplierId, []);
    groups.get(row.selectedSupplierId).push(row);
    return groups;
  }, new Map());
  const createdOrders = [];
  const createdAt = new Date().toISOString();

  for (const [supplierId, rows] of supplierGroups.entries()) {
    const poNo = `PO-${Date.now().toString().slice(-6)}-${ordersSuffix(supplierId)}`;
    const orderPayload = {
      po_no: poNo,
      outlet_id: stockCheck.outletId,
      supplier_id: supplierId,
      status: "draft",
      source_type: "stock_check",
      source_stock_check_id: stockCheck.id,
      created_by: userId || null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const orderResult = await supabase
      .from("inventory_purchase_orders")
      .insert(orderPayload)
      .select("*")
      .single();
    debugLog("[CreateDraftPODebug]", { action: "insert-order", stockCheckId: stockCheck.id, payload: orderPayload, result: { data: orderResult.data, error: orderResult.error }, error: orderResult.error });
    if (orderResult.error) throw orderResult.error;

    const itemPayload = rows.map((row) => ({
      purchase_order_id: orderResult.data.id,
      item_id: isUuid(row.itemId) ? row.itemId : null,
      requested_qty: Number(row.suggestedOrderQty || 0),
      received_qty: 0,
      unit: row.unit || null,
      remark: row.remark || null,
      source_stock_check_item_id: isUuid(row.stockCheckItemId) ? row.stockCheckItemId : null,
      created_at: createdAt,
      updated_at: createdAt,
    }));
    const itemsResult = await supabase
      .from("inventory_purchase_order_items")
      .insert(itemPayload)
      .select("*");
    debugLog("[CreateDraftPODebug]", { action: "insert-order-items", stockCheckId: stockCheck.id, poNo, payload: itemPayload, result: { data: itemsResult.data, error: itemsResult.error }, error: itemsResult.error });
    if (itemsResult.error) throw itemsResult.error;
    createdOrders.push(mapRemotePurchaseOrder(orderResult.data, itemsResult.data || []));
  }

  debugLog("[CreateDraftPODebug]", { action: "created-draft-pos", stockCheckId: stockCheck.id, createdOrders, error: null });
  return createdOrders;
}

async function fetchRemotePurchaseOrder(orderId) {
  if (!isUuid(orderId)) throw new Error("Valid purchase order is required.");
  const [orderResult, itemsResult, receiptsResult, receiptItemsResult] = await Promise.all([
    supabase.from("inventory_purchase_orders").select("*").eq("id", orderId).single(),
    supabase.from("inventory_purchase_order_items").select("*").eq("purchase_order_id", orderId).order("created_at", { ascending: true }),
    supabase.from("inventory_purchase_receipts").select("*").eq("purchase_order_id", orderId).order("received_at", { ascending: false }),
    supabase.from("inventory_purchase_receipt_items").select("*").order("created_at", { ascending: true }),
  ]);
  if (orderResult.error) throw orderResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (receiptsResult.error) throw receiptsResult.error;
  if (receiptItemsResult.error) throw receiptItemsResult.error;
  const receiptIds = new Set((receiptsResult.data || []).map((receipt) => receipt.id));
  const receiptItemsByReceiptId = new Map();
  (receiptItemsResult.data || [])
    .filter((row) => receiptIds.has(row.receipt_id))
    .forEach((row) => {
      const list = receiptItemsByReceiptId.get(row.receipt_id) || [];
      list.push(row);
      receiptItemsByReceiptId.set(row.receipt_id, list);
    });
  const receipts = (receiptsResult.data || []).map((receipt) => ({ ...receipt, items: receiptItemsByReceiptId.get(receipt.id) || [] }));
  return mapRemotePurchaseOrder(orderResult.data, itemsResult.data || [], receipts);
}

async function persistRemotePurchaseOrderStatus(orderId, status) {
  if (!isUuid(orderId)) throw new Error("Valid purchase order is required.");
  const timestamp = new Date().toISOString();
  const payload = { status, updated_at: timestamp };
  if (status === "submitted") payload.submitted_at = timestamp;
  if (status === "supplier_confirmed") payload.confirmed_at = timestamp;
  const result = await supabase
    .from("inventory_purchase_orders")
    .update(payload)
    .eq("id", orderId)
    .select("*")
    .single();
  debugLog("[POSubmitDebug]", { action: "update-status", orderId, status, payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return fetchRemotePurchaseOrder(orderId);
}

async function persistRemotePurchaseOrderEdit(order = {}) {
  if (!isUuid(order.id)) throw new Error("Valid purchase order is required.");
  if (order.status !== "draft") throw new Error("Only Draft purchase orders can be edited.");
  const timestamp = new Date().toISOString();
  const orderPayload = {
    supplier_id: isUuid(order.supplierId) ? order.supplierId : null,
    updated_at: timestamp,
  };
  const orderResult = await supabase
    .from("inventory_purchase_orders")
    .update(orderPayload)
    .eq("id", order.id)
    .eq("status", "draft")
    .select("*")
    .single();
  debugLog("[POSubmitDebug]", { action: "edit-order", orderId: order.id, payload: orderPayload, result: { data: orderResult.data, error: orderResult.error }, error: orderResult.error });
  if (orderResult.error) throw orderResult.error;

  const deleteResult = await supabase
    .from("inventory_purchase_order_items")
    .delete()
    .eq("purchase_order_id", order.id);
  debugLog("[POSubmitDebug]", { action: "replace-order-items-delete", orderId: order.id, result: { data: deleteResult.data || null, error: deleteResult.error }, error: deleteResult.error });
  if (deleteResult.error) throw deleteResult.error;

  const itemPayload = (order.lines || [])
    .filter((line) => isUuid(line.itemId) && Number(line.requestedQty || 0) > 0)
    .map((line) => ({
      purchase_order_id: order.id,
      item_id: line.itemId,
      requested_qty: Number(line.requestedQty || 0),
      received_qty: 0,
      unit: line.unit || null,
      remark: line.remark || null,
      source_stock_check_item_id: isUuid(line.sourceStockCheckItemId) ? line.sourceStockCheckItemId : null,
      created_at: line.createdAt || timestamp,
      updated_at: timestamp,
    }));
  if (!itemPayload.length) throw new Error("Purchase order requires at least one item.");
  const itemsResult = await supabase
    .from("inventory_purchase_order_items")
    .insert(itemPayload)
    .select("*");
  debugLog("[POSubmitDebug]", { action: "replace-order-items-insert", orderId: order.id, payload: itemPayload, result: { data: itemsResult.data, error: itemsResult.error }, error: itemsResult.error });
  if (itemsResult.error) throw itemsResult.error;
  return mapRemotePurchaseOrder(orderResult.data, itemsResult.data || [], []);
}

async function persistRemotePurchaseOrderCancel(order = {}, reason = "") {
  if (!isUuid(order.id)) throw new Error("Valid purchase order is required.");
  const hasReceived = receivedQty(order) > 0;
  const cancellableStatus = ["draft", "submitted", "supplier_confirmed"].includes(order.status);
  if (!cancellableStatus || hasReceived) throw new Error("PO cannot be cancelled after receiving has started.");
  const timestamp = new Date().toISOString();
  const payload = {
    status: "cancelled",
    cancellation_reason: reason,
    cancelled_at: timestamp,
    updated_at: timestamp,
  };
  const result = await supabase
    .from("inventory_purchase_orders")
    .update(payload)
    .eq("id", order.id)
    .select("*")
    .single();
  debugLog("[POCancelDebug]", { action: "cancel-po", orderId: order.id, payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return fetchRemotePurchaseOrder(order.id);
}

async function persistRemotePurchaseOrderComplete(order = {}, reason = "") {
  if (!isUuid(order.id)) throw new Error("Valid purchase order is required.");
  if (!["partial_received", "fully_received"].includes(order.status)) throw new Error("Only received purchase orders can be completed.");
  const progress = poProgress(order);
  const remaining = Math.max(0, progress.ordered - progress.received);
  const completionType = remaining > 0 ? "partial" : "full";
  if (completionType === "partial" && !String(reason || "").trim()) throw new Error("Completion reason is required for partially fulfilled POs.");
  const timestamp = new Date().toISOString();
  const payload = {
    status: "completed",
    completed_at: timestamp,
    completion_type: completionType,
    completion_reason: reason || null,
    unfulfilled_qty: remaining,
    updated_at: timestamp,
  };
  const result = await supabase
    .from("inventory_purchase_orders")
    .update(payload)
    .eq("id", order.id)
    .select("*")
    .single();
  debugLog("[POCompleteDebug]", { action: "complete-po", orderId: order.id, payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return fetchRemotePurchaseOrder(order.id);
}

async function persistRemotePurchaseOrderReceive(order = {}, rows = [], receiptRemark = "", userId) {
  if (!isUuid(order.id)) throw new Error("Valid purchase order is required.");
  if (["cancelled", "completed"].includes(order.status)) throw new Error("Cannot receive a Cancelled or Completed PO.");
  const receivedRows = rows.filter((row) => Number(row.receiveNowQty || 0) > 0);
  if (!receivedRows.length) throw new Error("Enter received quantity for at least one item.");
  const invalidRow = receivedRows.find((row) => Number(row.receiveNowQty || 0) < 0 || Number(row.receiveNowQty || 0) > remainingQty(row));
  if (invalidRow) throw new Error("Receive quantity cannot exceed remaining quantity.");
  const receivedAt = new Date().toISOString();
  const receiptPayload = {
    purchase_order_id: order.id,
    outlet_id: order.outletId || order.outletIds?.[0] || null,
    supplier_id: order.supplierId || null,
    received_by: userId || null,
    received_at: receivedAt,
    remark: receiptRemark || null,
    created_at: receivedAt,
  };
  const receiptResult = await supabase
    .from("inventory_purchase_receipts")
    .insert(receiptPayload)
    .select("*")
    .single();
  debugLog("[POReceiveDebug]", { action: "insert-receipt", orderId: order.id, payload: receiptPayload, result: { data: receiptResult.data, error: receiptResult.error }, error: receiptResult.error });
  if (receiptResult.error) throw receiptResult.error;

  const receiptItemsPayload = receivedRows.map((row) => ({
    receipt_id: receiptResult.data.id,
    purchase_order_item_id: isUuid(row.id) ? row.id : null,
    item_id: isUuid(row.itemId) ? row.itemId : null,
    received_qty: Number(row.receiveNowQty || 0),
    unit: row.unit || null,
    remark: row.receiveRemark || null,
    created_at: receivedAt,
  }));
  const receiptItemsResult = await supabase
    .from("inventory_purchase_receipt_items")
    .insert(receiptItemsPayload)
    .select("*");
  debugLog("[POReceiveDebug]", { action: "insert-receipt-items", orderId: order.id, payload: receiptItemsPayload, result: { data: receiptItemsResult.data, error: receiptItemsResult.error }, error: receiptItemsResult.error });
  if (receiptItemsResult.error) throw receiptItemsResult.error;

  for (const row of receivedRows) {
    const nextReceivedQty = Number(row.receivedQty || 0) + Number(row.receiveNowQty || 0);
    const itemResult = await supabase
      .from("inventory_purchase_order_items")
      .update({ received_qty: nextReceivedQty, updated_at: receivedAt })
      .eq("id", row.id)
      .select("*")
      .single();
    debugLog("[POReceiveDebug]", { action: "update-order-item-received", orderId: order.id, itemId: row.id, nextReceivedQty, result: { data: itemResult.data, error: itemResult.error }, error: itemResult.error });
    if (itemResult.error) throw itemResult.error;
  }

  const nextLines = (order.lines || []).map((line) => {
    const received = receivedRows.find((row) => (row.id || row.itemId) === (line.id || line.itemId));
    return received ? { ...line, receivedQty: Number(line.receivedQty || 0) + Number(received.receiveNowQty || 0) } : line;
  });
  const nextStatus = nextLines.every((line) => remainingQty(line) <= 0) ? "fully_received" : "partial_received";
  const orderResult = await supabase
    .from("inventory_purchase_orders")
    .update({ status: nextStatus, updated_at: receivedAt })
    .eq("id", order.id)
    .select("*")
    .single();
  debugLog("[POReceiveDebug]", { action: "update-order-status", orderId: order.id, nextStatus, result: { data: orderResult.data, error: orderResult.error }, error: orderResult.error });
  if (orderResult.error) throw orderResult.error;

  const movementPayload = receivedRows.map((row) => ({
    outlet_id: order.outletId || order.outletIds?.[0] || null,
    inventory_item_id: isUuid(row.itemId) ? row.itemId : null,
    movement_type: "Purchase",
    quantity: Number(row.receiveNowQty || 0),
    unit: row.unit || null,
    reference_type: "purchase_order",
    reference_id: order.id,
    reference_no: order.poNo,
    notes: row.receiveRemark || receiptRemark || "Purchase receive",
    created_by: userId || null,
    created_at: receivedAt,
  }));
  const movementResult = await supabase
    .from("inventory_movements")
    .insert(movementPayload)
    .select("*");
  debugLog("[POReceiveDebug]", { action: "insert-movements", orderId: order.id, payload: movementPayload, result: { data: movementResult.data, error: movementResult.error }, error: movementResult.error });
  if (movementResult.error) throw movementResult.error;

  return {
    order: await fetchRemotePurchaseOrder(order.id),
    movements: (movementResult.data || []).map(mapRemoteInventoryMovement),
  };
}

async function persistRemoteInventoryMovement(movement = {}, userId) {
  if (!isUuid(movement.outletId)) throw new Error("Outlet is required.");
  if (!isUuid(movement.itemId)) throw new Error("Inventory item is required.");
  const timestamp = movement.date ? businessDateToTimestamp(movement.date) : new Date().toISOString();
  const payload = {
    outlet_id: movement.outletId,
    inventory_item_id: movement.itemId,
    movement_type: toTitle(movement.type || movement.movementType || "adjustment"),
    quantity: Number(movement.quantity || 0),
    unit: movement.unit || null,
    reference_type: movement.referenceType || "manual",
    reference_id: isUuid(movement.referenceId) ? movement.referenceId : null,
    reference_no: movement.reference || movement.referenceNo || null,
    notes: movement.notes || null,
    created_by: userId || null,
    created_at: timestamp,
  };
  if (!Number.isFinite(payload.quantity) || payload.quantity === 0) throw new Error("Quantity is required.");
  const result = await supabase
    .from("inventory_movements")
    .insert(payload)
    .select("*")
    .single();
  debugLog("[InventoryMovementDebug]", { action: "insert-movement", payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteInventoryMovement(result.data);
}

async function persistRemoteWasteRecord(waste = {}, userId) {
  if (!isUuid(waste.outletId)) throw new Error("Outlet is required.");
  if (!isUuid(waste.itemId)) throw new Error("Inventory item is required.");
  const quantity = Number(waste.quantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Waste quantity must be greater than zero.");
  const wasteDate = normalizeBusinessDate(waste.date || waste.wasteDate);
  const timestamp = new Date().toISOString();
  const wastePayload = {
    outlet_id: waste.outletId,
    inventory_item_id: waste.itemId,
    waste_type: waste.wasteType || "Unknown",
    quantity,
    unit: waste.unit || null,
    waste_date: wasteDate,
    notes: waste.notes || null,
    photo_url: /^https?:\/\//i.test(String(waste.photoUrl || waste.photo_url || "")) ? (waste.photoUrl || waste.photo_url) : null,
    created_by: userId || null,
    updated_at: timestamp,
  };
  const wasteResult = await supabase
    .from("inventory_waste_records")
    .insert(wastePayload)
    .select("*")
    .single();
  debugLog("[WasteSaveDebug]", { action: "insert-waste", payload: wastePayload, result: { data: wasteResult.data, error: wasteResult.error }, error: wasteResult.error });
  if (wasteResult.error) throw wasteResult.error;

  const shortRef = `WASTE-${String(wasteResult.data.id).slice(0, 8).toUpperCase()}`;
  try {
    const movement = await persistRemoteInventoryMovement({
      outletId: waste.outletId,
      itemId: waste.itemId,
      type: "waste",
      quantity: -Math.abs(quantity),
      unit: waste.unit || null,
      referenceType: "waste",
      referenceId: wasteResult.data.id,
      reference: shortRef,
      notes: waste.notes || waste.wasteType || "Waste recorded",
      date: wasteDate,
    }, userId);
    debugLog("[WasteSaveDebug]", { action: "insert-waste-movement", wasteRecordId: wasteResult.data.id, movement, error: null });
    return { waste: mapRemoteWasteRecord(wasteResult.data), movement };
  } catch (error) {
    debugLog("[WasteSaveDebug]", { action: "insert-waste-movement", wasteRecordId: wasteResult.data.id, movement: null, error });
    const wrapped = new Error("Waste saved, but inventory movement failed.");
    wrapped.cause = error;
    wrapped.partialWasteSaved = true;
    wrapped.waste = mapRemoteWasteRecord(wasteResult.data);
    throw wrapped;
  }
}

async function persistRemoteRecipe(recipe = {}, userId) {
  if (!isUuid(recipe.outletId)) throw new Error("Outlet is required.");
  const code = recipeCode(recipe);
  const nameEn = recipeNameEn(recipe);
  const nameCn = recipeNameCn(recipe);
  if (!code) throw new Error("Recipe code is required.");
  if (!nameEn) throw new Error("Recipe Name EN is required.");
  if (!nameCn) throw new Error("Recipe Name CN is required.");
  const ingredients = (recipe.ingredients || recipe.items || []).map((line) => {
    const quantityUsed = Number(line.quantityUsed ?? line.quantity_used ?? 0);
    const wastagePercent = Number(line.wastagePercent ?? line.wastage_percent ?? 0);
    return {
      id: line.id,
      inventory_item_id: line.itemId || line.inventory_item_id || "",
      quantity_used: quantityUsed,
      unit: line.unit || null,
      wastage_percent: Number.isFinite(wastagePercent) ? wastagePercent : 0,
      remark: line.remark || null,
    };
  });
  if (!ingredients.length) throw new Error("At least one ingredient is required.");
  if (ingredients.some((line) => !isUuid(line.inventory_item_id))) throw new Error("Every ingredient needs an inventory item.");
  if (ingredients.some((line) => !Number.isFinite(line.quantity_used) || line.quantity_used <= 0)) throw new Error("Quantity used must be greater than zero.");
  if (ingredients.some((line) => !Number.isFinite(line.wastage_percent) || line.wastage_percent < 0)) throw new Error("Wastage percentage cannot be negative.");

  const servingSize = Number(recipe.servingSize ?? recipe.serving_size ?? "");
  const sellingPrice = Number(recipe.sellingPrice ?? recipe.selling_price ?? "");
  const recipePayload = {
    outlet_id: recipe.outletId,
    recipe_code: code,
    recipe_name: nameEn,
    recipe_name_en: nameEn,
    recipe_name_cn: nameCn,
    menu_category: recipe.menuCategory || recipe.menu_category || null,
    recipe_photo_url: recipe.recipePhotoUrl || recipe.recipe_photo_url || null,
    selling_price: Number.isFinite(sellingPrice) && sellingPrice >= 0 ? sellingPrice : null,
    serving_size: Number.isFinite(servingSize) && servingSize >= 0 ? servingSize : null,
    status: recipe.status || "active",
    notes: recipe.notes || null,
    updated_at: new Date().toISOString(),
  };
  const mode = isUuid(recipe.id) ? "edit" : "create";
  const debug = { action: mode, payload: recipePayload, ingredientPayload: ingredients, recipeResult: null, deleteItemsResult: null, insertItemsResult: null, error: null };
  const recipeResult = mode === "edit"
    ? await supabase
      .from("inventory_recipes")
      .update(recipePayload)
      .eq("id", recipe.id)
      .select("*")
      .single()
    : await supabase
      .from("inventory_recipes")
      .insert({ ...recipePayload, created_by: userId || null })
      .select("*")
      .single();
  debug.recipeResult = { data: recipeResult.data, error: recipeResult.error };
  if (recipeResult.error) {
    debug.error = recipeResult.error;
    debugLog("[RecipeSaveDebug]", debug);
    throw recipeResult.error;
  }

  const recipeId = recipeResult.data.id;
  const deleteItemsResult = await supabase
    .from("inventory_recipe_items")
    .delete()
    .eq("recipe_id", recipeId);
  debug.deleteItemsResult = { data: deleteItemsResult.data || null, error: deleteItemsResult.error };
  if (deleteItemsResult.error) {
    debug.error = deleteItemsResult.error;
    debugLog("[RecipeSaveDebug]", debug);
    throw deleteItemsResult.error;
  }

  const itemPayload = ingredients.map((line) => ({
    recipe_id: recipeId,
    inventory_item_id: line.inventory_item_id,
    quantity_used: line.quantity_used,
    unit: line.unit,
    wastage_percent: line.wastage_percent,
    remark: line.remark,
    updated_at: new Date().toISOString(),
  }));
  const insertItemsResult = await supabase
    .from("inventory_recipe_items")
    .insert(itemPayload)
    .select("*");
  debug.insertItemsResult = { data: insertItemsResult.data, error: insertItemsResult.error };
  if (insertItemsResult.error) {
    debug.error = insertItemsResult.error;
    debugLog("[RecipeSaveDebug]", debug);
    throw insertItemsResult.error;
  }

  debugLog("[RecipeSaveDebug]", debug);
  return mapRemoteRecipe(recipeResult.data, insertItemsResult.data || []);
}

async function archiveRemoteRecipe(recipeId) {
  if (!isUuid(recipeId)) throw new Error("Recipe is required.");
  const result = await supabase
    .from("inventory_recipes")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", recipeId)
    .select("*")
    .single();
  debugLog("[RecipeSaveDebug]", { action: "archive", recipeId, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteRecipe(result.data, []);
}

async function persistRemoteMenuCategory(category = {}) {
  const name = String(category.name || "").trim();
  if (!name) throw new Error("Menu category name is required.");
  const payload = {
    name,
    description: String(category.description || "").trim() || null,
    status: category.status || "active",
    sort_order: Number(category.sortOrder ?? category.sort_order ?? 0) || 0,
    updated_at: new Date().toISOString(),
  };
  const mode = isUuid(category.id) ? "edit" : "create";
  const result = mode === "edit"
    ? await supabase
      .from("inventory_menu_categories")
      .update(payload)
      .eq("id", category.id)
      .select("*")
      .single()
    : await supabase
      .from("inventory_menu_categories")
      .insert(payload)
      .select("*")
      .single();
  debugLog("[RecipeMenuCategoryDebug]", { action: mode, payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteMenuCategory(result.data);
}

function uomOptionLabel(uom = {}) {
  return uom.displayName && canonical(uom.displayName) !== canonical(uom.code)
    ? `${uom.code} · ${uom.displayName}`
    : uom.code;
}

function outletConfigForItem(item = {}, outletId) {
  if (!outletId) return buildOutletConfig(item, "");
  const existing = (item.outletConfigs || []).find((config) => config.outletId === outletId);
  return buildOutletConfig(item, outletId, existing);
}

function outletConfigsForScope(item = {}, outletIds = []) {
  const allowed = new Set(outletIds);
  return (normalizeInventoryItem(item).outletConfigs || []).filter((config) => (!outletIds.length || allowed.has(config.outletId)));
}

function parLevelForOutlet(item = {}, outletId) {
  return outletConfigForItem(item, outletId).parLevel;
}

function ordersSuffix(value) {
  return String(value || "GEN").slice(-3).toUpperCase();
}

function orderedQty(order = {}) {
  return (order.lines || []).reduce((sum, line) => sum + Number(line.requestedQty || 0), 0);
}

function receivedQty(order = {}) {
  return (order.lines || []).reduce((sum, line) => sum + Number(line.receivedQty || 0), 0);
}

function remainingQty(line = {}) {
  return Math.max(0, Number(line.requestedQty || 0) - Number(line.receivedQty || 0));
}

function poProgress(order = {}) {
  const ordered = orderedQty(order);
  const received = receivedQty(order);
  const percent = ordered ? Math.round((received / ordered) * 100) : 0;
  return { ordered, received, percent };
}

function normalizeInventoryData(raw, outlets = [], suppliers = [], options = {}) {
  const fallback = import.meta.env.DEV ? defaultData(outlets, suppliers) : emptyInventoryData();
  const source = raw || fallback;
  const allowEmptyMaster = Boolean(options.allowEmptyMaster);
  const categories = allowEmptyMaster ? (source.categories ?? []) : (source.categories?.length ? source.categories : fallback.categories);
  const uoms = allowEmptyMaster ? (source.uoms ?? []) : (source.uoms?.length ? source.uoms : fallback.uoms);
  const items = allowEmptyMaster ? (source.items ?? []) : (source.items?.length ? source.items : fallback.items);
  return {
    ...fallback,
    ...source,
    categories,
    uoms: uoms.map(normalizeUom),
    items: items.map(normalizeInventoryItem),
    groups: allowEmptyMaster ? (source.groups ?? []) : (source.groups ?? fallback.groups),
    checks: source.checks ?? [],
    requests: source.requests ?? [],
    orders: source.orders ?? [],
    movements: source.movements ?? [],
    waste: source.waste ?? [],
    menuCategories: source.menuCategories ?? [],
    recipes: source.recipes ?? [],
  };
}

function emptyInventoryData() {
  return {
    categories: [],
    uoms: [],
    items: [],
    groups: [],
    checks: [],
    requests: [],
    orders: [],
    movements: [],
    waste: [],
    menuCategories: [],
    recipes: [],
    people: [],
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
    uoms: defaultUoms.map(normalizeUom),
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
    menuCategories: recipeMenuCategories.map((name, index) => mapRemoteMenuCategory({ id: `default_menu_${index + 1}`, name, sort_order: index + 1, status: "active" })),
    recipes: [],
  };
}

function useInventoryData(outlets, suppliers) {
  const [data, setData] = useState(() => {
    clearInventoryBrowserCache();
    return normalizeInventoryData({ categories: [], items: [], uoms: [] }, outlets, suppliers, { allowEmptyMaster: true });
  });
  const [meta, setMeta] = useState({ dataSource: "fallback", lastFetchedAt: "", rawItemsCount: 0, normalizedItemsCount: 0, outletLinkCount: 0, fallbackActive: true });

  useEffect(() => {
    if (!outlets.length) return;
    setData((current) => {
      if (current.items?.length || current.groups?.length) return normalizeInventoryData(current, outlets, suppliers, { allowEmptyMaster: true });
      return normalizeInventoryData({ categories: [], items: [], uoms: [] }, outlets, suppliers, { allowEmptyMaster: true });
    });
  }, [outlets, suppliers, meta.dataSource]);

  const refreshInventory = useCallback(async () => {
    clearInventoryBrowserCache();
    setMeta((current) => ({ ...current, dataSource: current.dataSource === "supabase" ? "refreshing" : "loading" }));
    try {
      const remote = await loadRemoteInventoryMaster();
      const fetchedAt = new Date().toISOString();
      setData((current) => normalizeInventoryData({
        ...current,
        categories: remote.categories,
        items: remote.items,
        uoms: remote.uoms,
        groups: remote.groups,
        checks: remote.checks,
        orders: remote.orders,
        movements: remote.movements,
        waste: remote.waste,
        menuCategories: remote.menuCategories,
        recipes: remote.recipes,
        people: remote.people,
      }, outlets, suppliers, { allowEmptyMaster: true }));
      setMeta({
        dataSource: "supabase",
        lastFetchedAt: fetchedAt,
        rawItemsCount: remote.rawItemCount ?? remote.items.length,
        normalizedItemsCount: remote.items.length,
        outletLinkCount: remote.outletLinkCount ?? 0,
        fallbackActive: Boolean(remote.fallbackActive),
      });
      return remote;
    } catch (error) {
      console.warn("[InventoryControl] Unable to load remote master inventory. Keeping in-memory fallback data.", error);
      setMeta((current) => ({ ...current, dataSource: "remote_error", lastFetchedAt: current.lastFetchedAt || "", fallbackActive: true }));
      return null;
    }
  }, [outlets, suppliers]);

  useEffect(() => {
    let cancelled = false;
    refreshInventory().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refreshInventory]);

  return [data, setData, meta, refreshInventory];
}

function Field({ label, value, onChange, type = "text", placeholder, required = false, onBlur, error }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </div>
      <input
        className="control h-9 w-full text-[13px]"
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value ?? ""}
        placeholder={placeholder}
        onFocus={type === "number" ? selectInputText : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? <div className="mt-1 type-caption font-semibold text-rose-600">{error}</div> : null}
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

function InventoryCategoryIcon({ category, size = "md" }) {
  const initial = (category?.name || "Inventory").slice(0, 1).toUpperCase();
  const sizeClass = size === "sm" ? "h-10 w-10 text-sm" : "h-11 w-11 text-base";
  return (
    <div className={`${sizeClass} grid shrink-0 place-items-center rounded-2xl border border-primary/15 bg-primary/10 font-black text-primary shadow-sm`}>
      {initial}
    </div>
  );
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
  const normalizedOutlets = useMemo(() => outlets.map(normalizeOutletRecord), [outlets]);
  const outletById = useMemo(() => new Map(normalizedOutlets.map((outlet) => [outlet.id, outlet])), [normalizedOutlets]);
  const configs = normalizeInventoryItem(item).outletConfigs || [];
  const linkedOutletsRaw = useMemo(() => configs.map((config) => ({
    config,
    outlet: outletById.get(config.outletId) || null,
  })), [configs, outletById]);
  const mappedOutletLabels = linkedOutletsRaw.map(({ outlet }) => outlet ? outletDisplayCode(outlet) : "Outlet");
  const visibleCodes = mappedOutletLabels.slice(0, 3);
  const hiddenCount = Math.max(0, configs.length - visibleCodes.length);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    debugLog("[OutletChipDebug]", {
      browser: navigator.userAgent,
      linkedOutletsRaw,
      mappedOutletLabels,
    });
  }, [item.id, configs.length, linkedOutletsRaw, mappedOutletLabels]);

  const linkedOutletCards = configs.map((config) => {
    const outlet = outletById.get(config.outletId);
    return { config, outlet };
  });

  return (
    <div ref={anchorRef} className="inline-flex">
      <button
        className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 type-caption font-bold text-text-primary transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {visibleCodes.length ? visibleCodes.map((code, index) => (
          <span key={`${code}-${index}`} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-text-secondary">{code}</span>
        )) : <span>No outlets</span>}
        {hiddenCount ? <span className="text-text-muted">+{hiddenCount}</span> : null}
        <ChevronDown size={13} />
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" width={320} estimatedHeight={280} className="p-0">
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="type-body-sm font-bold text-text-primary">Linked Outlets</div>
              <div className="type-caption text-text-secondary">{configs.length} linked outlet{configs.length === 1 ? "" : "s"}</div>
            </div>
            <Badge tone="info">{item.unit}</Badge>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {linkedOutletCards.length ? linkedOutletCards.map(({ config, outlet }) => {
              return (
                <div key={config.outletId} className="rounded-xl border border-border bg-slate-50/70 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="type-body-sm font-bold text-text-primary">{outlet ? outletDisplayName(outlet) : "Unknown outlet"}</div>
                      <div className="type-caption text-text-secondary">{outlet ? outletDisplayCode(outlet) : "No outlet code"}</div>
                    </div>
                    <Badge tone="success">Linked</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 type-caption text-text-secondary">
                    <span>Par <strong className="text-text-primary">{config.parLevel === "" || config.parLevel === null || config.parLevel === undefined ? "Not set" : config.parLevel}</strong></span>
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

function ItemPhotoPicker({ value, onChange }) {
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

    try {
      const preview = await readFileAsDataUrl(file);
      onChange(preview, { localPreview: true, uploadFailed: false, file });
    } catch (readError) {
      setError(readError.message || "Unable to read image. Please try another file.");
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
              <div className="type-caption text-text-secondary">Photo uploads when you save the item.</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="btn-secondary h-8 cursor-pointer px-3 text-xs">
                  Replace photo
                  <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleFile(event.target.files?.[0])} />
                </label>
                <button className="btn-secondary h-8 px-3 text-xs text-rose-600" type="button" onClick={() => { setError(""); onChange("", { removed: true, uploadFailed: false }); }}>Remove</button>
              </div>
            </div>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 py-5 text-center transition hover:border-primary/40 hover:bg-primary/5">
            <Upload size={18} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">Upload item photo</span>
            <span className="mt-0.5 type-caption text-text-muted">PNG/JPG/WebP</span>
            <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
        )}
        {error ? <div className="mt-2 type-caption font-semibold text-amber-700">{error}</div> : null}
      </div>
    </div>
  );
}

function itemInitials(item, category) {
  const source = item?.name || category?.name || "Item";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function InventoryItemThumbnail({ item, category, onPreview, size = "md" }) {
  const photo = item?.photo || item?.photo_url || "";
  const sizeClass = size === "sm" ? "h-10 w-10" : "h-12 w-12";
  const commonClass = `${sizeClass} shrink-0 overflow-hidden rounded-xl border border-border bg-slate-50`;

  if (photo) {
    return (
      <button
        className={`${commonClass} transition hover:border-primary/40 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/25`}
        type="button"
        onClick={() => onPreview?.({ src: photo, title: item?.name || "Inventory item" })}
        title="View item photo"
        aria-label={`View photo for ${item?.name || "inventory item"}`}
      >
        <img className="h-full w-full object-cover" src={photo} alt={item?.name || "Inventory item"} />
      </button>
    );
  }

  return (
    <div className={`${commonClass} flex items-center justify-center text-[11px] font-black text-primary`} title="No photo uploaded">
      {itemInitials(item, category)}
    </div>
  );
}

function StockCheckMobileView({
  activeCheckGroup,
  isAudit,
  rows,
  itemById,
  categoryById,
  outletName,
  dateLabel,
  startedByName,
  submittedByName,
  draftSavedAt,
  activePersistedCheck,
  currentCheckerName,
  validationIssues,
  checkSearch,
  onSearchChange,
  onPreviewPhoto,
  onUpdateRow,
  onSkipRow,
  onUnskipRow,
  onBack,
  onSaveDraft,
  onSubmit,
}) {
  const issueByRowIndex = new Map((validationIssues || []).map((issue) => [issue.rowIndex, issue]));
  const filteredRows = rows.filter((row) => {
    if (!checkSearch.trim()) return true;
    const item = itemById.get(row.itemId);
    return `${item?.name || ""} ${item?.sku || ""}`.toLowerCase().includes(checkSearch.trim().toLowerCase());
  });
  const isRowCounted = (row = {}) => row.actualCount !== "" && row.actualCount !== null && row.actualCount !== undefined && Number.isFinite(Number(row.actualCount));
  const totalItems = rows.length;
  const skippedCount = rows.filter((row) => row.skipped).length;
  const completedCount = rows.filter((row) => row.skipped || isRowCounted(row)).length;
  const remainingCount = Math.max(0, totalItems - completedCount);
  const progressPercent = totalItems ? Math.round((completedCount / totalItems) * 100) : 0;
  const isComplete = totalItems > 0 && completedCount === totalItems;

  return (
    <div className="space-y-3 pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <SectionCard
        title={activeCheckGroup.name}
        description={`${outletName} · ${isAudit ? activeCheckGroup.auditType : activeCheckGroup.shift} · ${dateLabel}`}
        action={<button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={onBack}>Back</button>}
      >
        <div className="grid gap-2 rounded-2xl border border-border bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="type-micro font-black uppercase text-text-muted">Checked by</div>
              <div className="type-body-sm font-bold text-text-primary">{currentCheckerName}</div>
            </div>
            <Badge tone={isAudit ? "info" : "warning"}>{isAudit ? "Audit" : "Scheduled"}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="type-micro font-black uppercase text-text-muted">Started by</div>
              <div className="type-caption font-bold text-text-primary">{startedByName}</div>
            </div>
            <div>
              <div className="type-micro font-black uppercase text-text-muted">{activePersistedCheck?.status === "submitted" ? "Submitted" : "Draft saved"}</div>
              <div className="type-caption font-bold text-text-primary">
                {activePersistedCheck?.status === "submitted"
                  ? `${submittedByName || "Unknown User"} · ${formatDateTimeCompact(activePersistedCheck.submittedAt)}`
                  : (draftSavedAt ? formatDateTimeCompact(draftSavedAt) : "Not saved yet")}
              </div>
            </div>
          </div>
        </div>

        {isAudit ? (
          <label className="mt-3 block">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
              <input className="control h-10 w-full pl-9 text-[13px]" value={checkSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search item" />
            </div>
          </label>
        ) : null}

        {validationIssues.length ? (
          <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
              <div>
                <div className="type-body-sm font-black">{isAudit ? "Audit Check cannot be submitted" : "Stock Check cannot be submitted"}</div>
                <div className="mt-1 type-caption font-semibold">{validationIssues.length} item{validationIssues.length === 1 ? "" : "s"} require attention:</div>
                <ul className="mt-2 space-y-1 type-caption">
                  {validationIssues.slice(0, 6).map((issue) => (
                    <li key={`${issue.rowIndex}-${issue.reason}`}><span className="font-bold">{issue.itemName}</span> &rarr; {issue.reason}</li>
                  ))}
                  {validationIssues.length > 6 ? <li className="font-semibold">+{validationIssues.length - 6} more</li> : null}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <div className="space-y-3">
        {filteredRows.map((row) => {
          const item = itemById.get(row.itemId);
          const category = categoryById.get(item?.categoryId);
          const parLevel = parLevelForOutlet(item, activeCheckGroup.outletId);
          const result = row.skipped ? { label: "Skipped", tone: "neutral", variance: 0 } : varianceStatus(parLevel, row.actualCount);
          const issue = issueByRowIndex.get(row.rowIndex);
          const rowCompleted = row.skipped || isRowCounted(row);
          return (
            <div key={row.itemId} data-check-row-index={row.rowIndex} className={`rounded-2xl border bg-white p-3 shadow-sm transition ${issue ? "border-amber-300 bg-amber-50/70" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <InventoryItemThumbnail item={item} category={category} onPreview={onPreviewPhoto} />
                <div className="min-w-0 flex-1">
                  <div className="font-black text-text-primary">{item?.name || "Inventory item"}</div>
                  <div className="type-caption text-text-secondary">{category?.name ?? "Uncategorized"}{item?.sku ? ` · ${item.sku}` : ""}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={row.skipped ? "neutral" : rowCompleted ? "success" : "warning"}>{row.skipped ? "Skipped" : rowCompleted ? "Recorded" : "Pending"}</Badge>
                  {rowCompleted && !row.skipped ? <Badge tone={row.na ? "neutral" : result.tone}>{row.na ? "Not Available" : result.label}</Badge> : null}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center">
                <div><div className="type-micro font-black uppercase text-text-muted">Par</div><div className="type-body-sm font-bold text-text-primary">{parLevel}</div></div>
                <div><div className="type-micro font-black uppercase text-text-muted">Variance</div><div className="type-body-sm font-bold text-text-primary">{row.skipped ? "Skipped" : row.na ? "Not Available" : result.variance}</div></div>
                <div><div className="type-micro font-black uppercase text-text-muted">UOM</div><div className="type-body-sm font-bold text-text-primary">{item?.unit || "-"}</div></div>
              </div>

              <div className="mt-3">
                <div className="mb-1 type-caption font-semibold text-text-secondary">Actual Count</div>
                <div className="flex items-center gap-2">
                  <button className="icon-btn h-10 w-10" type="button" disabled={row.skipped} onClick={() => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: Math.max(0, Number(entry.actualCount || 0) - 1), na: false }))}>-</button>
                  <input className="control h-10 min-w-0 flex-1 text-center text-[15px] font-bold" type="number" min="0" disabled={row.skipped} value={row.actualCount ?? ""} placeholder="Qty" onFocus={selectInputText} onChange={(event) => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: parseNonNegativeNumber(event.target.value), na: false }))} />
                  <button className="icon-btn h-10 w-10" type="button" disabled={row.skipped} onClick={() => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: Number(entry.actualCount || 0) + 1, na: false }))}>+</button>
                </div>
                {issue ? <div className="mt-2 type-caption font-bold text-amber-700">{issue.reason === "Count not entered" ? "Count required" : issue.reason}</div> : null}
              </div>

              {!row.skipped ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {[
                    ["Full", parLevel],
                    ["Half", Math.round(Number(parLevel || 0) / 2)],
                    ["Empty", 0],
                  ].map(([label, value]) => (
                    <button key={label} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary" type="button" onClick={() => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: Number(value || 0), na: false }))}>{label}</button>
                  ))}
                  <button className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary" type="button" onClick={() => onSkipRow(row.rowIndex, item?.name)}>Skip</button>
                </div>
              ) : <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 type-caption font-semibold text-text-muted">Not Available · {row.skipReason}</div>}

              <input className="control mt-3 h-10 w-full text-[13px]" value={row.notes} onChange={(event) => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, notes: event.target.value }))} placeholder="Optional note" />

              {row.skipped ? (
                <div className="mt-3 flex justify-end">
                  <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => onUnskipRow(row.rowIndex)}>Unskip</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="type-micro font-black uppercase tracking-wide text-text-muted">Progress</div>
            <div className="type-body-sm font-black text-text-primary">{completedCount} / {totalItems} completed</div>
          </div>
          <Badge tone={isComplete ? "success" : "info"}>{isComplete ? "Ready to submit" : `${progressPercent}%`}</Badge>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all ${isComplete ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 type-caption font-semibold text-text-secondary">
          <div>{skippedCount} skipped</div>
          <div className="text-right">{isComplete ? "Ready to submit" : `${remainingCount} remaining`}</div>
        </div>
      </div>

      <div className="sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-border bg-white/95 p-3 shadow-card backdrop-blur">
        <div className="mb-2">
          <div className="type-body-sm font-black text-text-primary">{completedCount} / {totalItems} completed</div>
          <div className="mt-0.5 flex flex-wrap gap-2 type-caption font-semibold text-text-secondary">
            <span>{skippedCount} skipped</span>
            <span>·</span>
            <span>{isComplete ? "Ready to submit" : `${remainingCount} remaining`}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secondary" type="button" onClick={onSaveDraft}>Save Draft</button>
          <button className="btn-primary" type="button" onClick={onSubmit}>{isAudit ? "Submit Audit" : "Submit"}</button>
        </div>
      </div>
    </div>
  );
}

function InventoryItemPhotoPreview({ preview, onClose }) {
  useEffect(() => {
    if (!preview?.src) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, preview?.src]);

  if (!preview?.src) return null;
  return (
    <div
      className="fixed inset-0 z-lightbox-layer flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={preview.title || "Item photo preview"}
      onMouseDown={onClose}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate type-title font-bold text-white">{preview.title || "Item Photo"}</div>
            <div className="type-caption text-slate-300">Inventory item photo preview</div>
          </div>
          <button className="rounded-full border border-white/15 px-3 py-1 text-sm font-bold text-white transition hover:bg-white/10" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 p-3">
          <img className="mx-auto max-h-[72vh] w-auto max-w-full rounded-xl object-contain" src={preview.src} alt={preview.title || "Item photo"} />
        </div>
      </div>
    </div>
  );
}

const inventoryImportColumns = ["Item Name", "SKU Code", "Category", "UOM", "Cost", "Description", "Status", "Linked Outlet Codes"];

function readImportValue(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => canonical(key) === canonical(alias));
    if (found) return String(found[1] ?? "").trim();
  }
  return "";
}

function buildInventoryImportPreview(rows, { categories, outlets, items, uoms }) {
  const categoryByName = new Map(categories.map((category) => [canonical(category.name), category]));
  const uomByCode = new Map(uoms.map((uom) => [canonical(uom.code), uom]));
  const outletByCode = new Map(outlets.map((outlet) => {
    const normalized = normalizeOutletRecord(outlet);
    return [canonical(normalized.code || ""), normalized];
  }).filter(([key]) => key));
  const existingBySku = new Map(items.filter((item) => item.sku).map((item) => [canonical(item.sku), item]));
  const existingByName = new Map(items.map((item) => [canonical(item.name), item]));
  const seenSkus = new Map();
  const seenNamesWithoutSku = new Map();

  return rows.map((row) => {
    const name = readImportValue(row, ["Item Name", "Name", "Item"]);
    const sku = readImportValue(row, ["SKU Code", "SKU"]);
    const categoryName = readImportValue(row, ["Category"]);
    const unit = readImportValue(row, ["UOM", "Unit"]);
    const rawCost = readImportValue(row, ["Cost", "Default Cost"]);
    const description = readImportValue(row, ["Description"]);
    const status = (readImportValue(row, ["Status"]) || "active").toLowerCase();
    const linkedOutletText = readImportValue(row, ["Linked Outlet Codes", "Linked Outlets", "Outlets"]);
    const errors = [];
    const warnings = [];

    if (!name) errors.push("Missing Item Name");
    if (!categoryName) errors.push("Missing Category");
    const category = categoryByName.get(canonical(categoryName));
    if (categoryName && !category) errors.push("Unknown Category");
    if (!unit) errors.push("Missing UOM");
    const uom = unit ? uomByCode.get(canonical(unit)) : null;
    if (unit && !uom) errors.push("Unknown UOM");
    const parsedCost = rawCost ? parseInventoryCostInput(rawCost) : "";
    if (parsedCost === null) errors.push("Invalid Cost");
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
        const outlet = outletByCode.get(canonical(entry));
        if (!outlet) errors.push(`Unknown Outlet Code: ${entry}`);
        return outlet;
      }).filter(Boolean)
      : [];
    const linkedOutletCodes = linkedOutlets.map(outletDisplayCode).filter(Boolean);
    const existing = skuKey ? existingBySku.get(skuKey) : existingByName.get(nameKey);

    return {
      rowNumber: row.__row,
      source: row,
      action: errors.length ? "error" : existing ? "update" : "create",
      errors,
      warnings,
      item: {
        id: existing?.id || "",
        name,
        sku,
        categoryId: category?.id || "",
        unit: uom?.code || unit,
        cost: parsedCost === "" ? (existing?.cost ?? "") : parsedCost,
        description,
        defaultSupplierId: existing?.defaultSupplierId || "",
        status,
        photo: existing?.photo || existing?.photo_url || "",
        linkedOutletIds: linkedOutlets.length ? linkedOutlets.map((outlet) => outlet.id) : existing?.linkedOutletIds || [],
        linkedOutletCodes,
      },
    };
  });
}

function InventoryImportModal({ categories, outlets, items, uoms, onClose, onImport }) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
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
      const built = buildInventoryImportPreview(parsed.rows, { categories, outlets, items, uoms });
      setPreview(built);
    } catch (parseError) {
      setError(parseError.message || "Unable to parse import file.");
    }
  }

  function downloadTemplate() {
    const text = [
      inventoryImportColumns.join(","),
      ["Sambal Sauce 三八", "RAW-SAM-001", "Raw Material", "kg", "6.5000", "House sambal batch", "Active", "FC,HLIPH"].map(csvEscape).join(","),
    ].join("\n");
    downloadTextFile("feedx-master-inventory-template.csv", text);
  }

  async function confirmImport() {
    setError("");
    setIsImporting(true);
    try {
      const result = await onImport(preview);
      setComplete(result);
    } catch (importError) {
      setError(importError.message || "Unable to import master inventory.");
    } finally {
      setIsImporting(false);
    }
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
          <button className="btn-primary" type="button" disabled={!validRows.length || Boolean(complete) || isImporting} onClick={confirmImport}>{isImporting ? "Importing..." : "Confirm Import"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center transition hover:bg-primary/10">
            <Upload size={20} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">{fileName || "Upload CSV or XLSX"}</span>
            <span className="type-caption text-text-secondary">Required: Item Name, Category, UOM</span>
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
                    <th>UOM</th>
                    <th>Cost</th>
                    <th>Linked Outlet Codes</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {preview.slice(0, 80).map((row) => (
                    <tr key={row.rowNumber} className={row.errors.length ? "bg-rose-50/50" : "bg-white"}>
                      <td className="px-3 py-2 font-mono text-xs">{row.rowNumber}</td>
                      <td><Badge tone={row.action === "error" ? "danger" : row.action === "create" ? "success" : "info"}>{row.action === "error" ? "Error" : toTitle(row.action)}</Badge></td>
                      <td className="font-bold text-text-primary">{row.item.name || "-"}</td>
                      <td>{categoryByIdName(categories, row.item.categoryId)}</td>
                      <td>{row.item.unit || "-"}</td>
                      <td>{formatInventoryCost(row.item.cost, row.item.unit)}</td>
                      <td>{row.item.linkedOutletCodes?.length ? row.item.linkedOutletCodes.join(", ") : "-"}</td>
                      <td className={row.errors.length ? "text-rose-700" : "text-emerald-700"}>{row.errors.length ? row.errors.join("; ") : "Ready"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {complete ? (
              <div className={`rounded-2xl border p-3 type-body-sm font-semibold ${complete.failed ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                Import complete: {complete.created} created · {complete.updated} updated · {complete.skipped} skipped · {complete.failed} failed.
                {complete.failures?.length ? <div className="mt-1 font-medium">{complete.failures.slice(0, 3).map((failure) => `Row ${failure.rowNumber}: ${failure.message}`).join(" · ")}</div> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function categoryByIdName(categories, categoryId) {
  return categories.find((category) => category.id === categoryId)?.name || "Uncategorized";
}

function categoryForItem(item = {}, categoryById = new Map()) {
  const category = categoryById.get(item.categoryId || item.category_id);
  if (category) return category;
  if (item.categoryName || item.category_name) {
    return {
      id: item.categoryId || item.category_id || canonical(item.categoryName || item.category_name) || "uncategorized",
      name: item.categoryName || item.category_name,
      code: item.categoryCode || item.category_code || "",
      sortOrder: 9999,
      status: "active",
    };
  }
  return null;
}

function UomModal({ uom, onClose, onSave }) {
  const [form, setForm] = useState(() => normalizeUom(uom ?? {
    id: "",
    code: "",
    displayName: "",
    uomType: "General",
    isActive: true,
    sortOrder: 1,
  }));
  const [touched, setTouched] = useState(false);
  const invalid = touched && (!form.code.trim() || !form.displayName.trim() || !form.uomType.trim());
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      title={uom ? "Edit UOM" : "Add New UOM"}
      description="Manage units of measure used by master inventory items and imports."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setTouched(true);
              if (!form.code.trim() || !form.displayName.trim() || !form.uomType.trim()) return;
              onSave(normalizeUom({
                ...form,
                id: form.id || makeId("uom"),
                code: form.code.trim(),
                displayName: form.displayName.trim(),
                uomType: form.uomType.trim(),
                updatedAt: new Date().toISOString(),
                createdAt: form.createdAt || new Date().toISOString(),
              }));
            }}
          >
            Save
          </button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="UOM Code" value={form.code} required onChange={(value) => update("code", value)} placeholder="kg" />
        <Field label="Display Name" value={form.displayName} required onChange={(value) => update("displayName", value)} placeholder="Kilogram" />
        <Field label="UOM Type" value={form.uomType} required onChange={(value) => update("uomType", value)} placeholder="Weight" />
        <Field label="Sort Order" type="number" value={form.sortOrder} onChange={(value) => update("sortOrder", Number(value || 0))} />
        <SelectField label="Status" value={form.isActive ? "active" : "inactive"} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(value) => update("isActive", value === "active")} />
        {invalid ? <div className="md:col-span-2 type-caption font-semibold text-rose-600">UOM code, display name and type are required.</div> : null}
      </div>
    </Modal>
  );
}

function UomSettingsModal({ uoms, remoteRows, visibleRows, lastWriteStatus, canAdd, canEdit, canDelete, requirePermission, onAdd, onEdit, onArchive, onDelete, onClose }) {
  return (
    <Modal
      title="Inventory UOM Settings"
      description="Manage units of measure used by master inventory items, stock checks and imports."
      size="lg"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="type-caption text-text-secondary">{uoms.length} configured UOM{uoms.length === 1 ? "" : "s"}</div>
          <div className="type-caption text-text-muted">Only active UOMs appear in item forms and import validation.</div>
          <div className="mt-1 type-caption font-semibold text-text-muted">Remote UOM Rows: {remoteRows} · Visible UOM Rows: {visibleRows} · Last Write Status: {lastWriteStatus}</div>
        </div>
        <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={() => requirePermission(canAdd, "add UOM") && onAdd()}>
          <PackagePlus size={14} /> Add UOM
        </button>
      </div>
      {uoms.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {uoms.map((uom) => (
            <div key={uom.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-primary/5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate type-body-sm font-bold text-text-primary">{uom.code}</div>
                  <Badge tone={uom.isActive ? "success" : "neutral"}>{uom.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-0.5 truncate type-caption text-text-secondary">{uom.displayName || "No display name"} · {uom.uomType || "General"}</div>
                <div className="mt-1 type-caption font-semibold text-text-muted">Sort {uom.sortOrder || 0}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canEdit, "edit UOM") && onEdit(uom)}>Edit</button>
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canEdit, "archive UOM") && onArchive(uom)}>{uom.isActive ? "Archive" : "Activate"}</button>
                <button className="icon-btn h-8 w-8 text-rose-600" type="button" onClick={() => requirePermission(canDelete, "delete UOM") && onDelete(uom)} title="Delete UOM">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Create your first UOM." description="UOMs control the item form dropdown and Master Inventory import validation." />
      )}
    </Modal>
  );
}

function MenuCategoryModal({ category, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    id: category?.id || "",
    name: category?.name || "",
    description: category?.description || "",
    status: category?.status || "active",
    sortOrder: category?.sortOrder ?? 0,
  }));
  const [touched, setTouched] = useState(false);
  const invalid = touched && !form.name.trim();
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal
      title={category ? "Edit Menu Category" : "Add Menu Category"}
      description="Menu categories organize recipe BOMs and recipe filters."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setTouched(true);
              if (!form.name.trim()) return;
              onSave({
                ...form,
                name: form.name.trim(),
                description: form.description.trim(),
                sortOrder: Number(form.sortOrder || 0),
              });
            }}
          >
            Save
          </button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Category Name" value={form.name} required onChange={(value) => update("name", value)} placeholder="Main Dish" />
        <Field label="Sort Order" type="number" value={form.sortOrder} onChange={(value) => update("sortOrder", Number(value || 0))} />
        <SelectField label="Status" value={form.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(value) => update("status", value)} />
        <div className="md:col-span-2">
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} placeholder="Optional description" />
        </div>
        {invalid ? <div className="md:col-span-2 type-caption font-semibold text-rose-600">Menu category name is required.</div> : null}
      </div>
    </Modal>
  );
}

function MenuCategorySettingsModal({ categories, canManage, requirePermission, onAdd, onEdit, onArchive, onSort, onClose }) {
  const ordered = [...categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  return (
    <Modal
      title="Menu Category Settings"
      description="Create, edit, archive and sort menu categories used by Recipes & Usage."
      size="lg"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="type-caption text-text-secondary">{ordered.length} configured menu categor{ordered.length === 1 ? "y" : "ies"}</div>
          <div className="type-caption text-text-muted">Only active menu categories appear in recipe forms and filters.</div>
        </div>
        <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={() => requirePermission(canManage, "add menu categories") && onAdd()}>
          <PackagePlus size={14} /> Add Category
        </button>
      </div>
      {ordered.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {ordered.map((category) => (
            <div
              key={category.id}
              draggable={canManage}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", category.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData("text/plain");
                if (draggedId && draggedId !== category.id) onSort(draggedId, category.id);
              }}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-primary/5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <GripVertical size={14} className="text-text-muted" />
                  <div className="truncate type-body-sm font-bold text-text-primary">{category.name}</div>
                  <Badge tone={category.status === "active" ? "success" : "neutral"}>{toTitle(category.status || "active")}</Badge>
                </div>
                <div className="mt-0.5 truncate type-caption text-text-secondary">{category.description || "No description"}</div>
                <div className="mt-1 type-caption font-semibold text-text-muted">Sort {category.sortOrder || 0}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canManage, "edit menu categories") && onEdit(category)}>Edit</button>
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canManage, "archive menu categories") && onArchive(category)}>{category.status === "active" ? "Archive" : "Activate"}</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Create your first menu category." description="Menu categories help scan recipe BOMs by product type." />
      )}
    </Modal>
  );
}

function InventoryItemModal({ item, categories, outlets, uoms, canCreateUom, onAddUom, onClose, onSave }) {
  const initialItem = normalizeInventoryItem(item ?? {
    id: "",
    name: "",
    sku: "",
    categoryId: categories[0]?.id ?? "",
    unit: uoms.find((uom) => uom.isActive)?.code || "kg",
    cost: "",
    photo: "",
    description: "",
    inventoryType: item?.inventoryType ?? "",
    defaultSupplierId: "",
    status: "active",
    linkedOutletIds: outlets[0]?.id ? [outlets[0].id] : [],
  });
  const [form, setForm] = useState(initialItem);
  const [quickUomOpen, setQuickUomOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const parsedCost = parseInventoryCostInput(form.cost);
  const costInvalid = parsedCost === null;
  const invalid = touched && (!form.name.trim() || !form.categoryId || !form.unit || !form.linkedOutletIds?.length || costInvalid);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLinkedOutlets(ids) {
    setForm((current) => {
      const next = { ...current, linkedOutletIds: ids, linked_outlet_ids: ids, linkedOutlets: [], linked_outlets: [] };
      const existing = new Map((current.outletConfigs || []).map((config) => [config.outletId, config]));
      next.outletConfigs = ids.map((outletId) => buildOutletConfig(current, outletId, existing.get(outletId)));
      next.outlet_configs = next.outletConfigs.map((config) => ({
        ...config,
        inventory_item_id: config.inventoryItemId,
        outlet_id: config.outletId,
      }));
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
              if (!form.name.trim() || !form.categoryId || !form.unit || !form.linkedOutletIds?.length || costInvalid) return;
              const id = form.id || makeId("item");
              onSave({ ...form, id, cost: parsedCost === "" ? "" : parsedCost, outletConfigs: (form.outletConfigs || []).map((config) => ({ ...config, inventoryItemId: id })) });
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
        <SelectField
          label="UOM"
          value={form.unit}
          options={uoms.filter((uom) => uom.isActive).map((uom) => ({ value: uom.code, label: uomOptionLabel(uom) }))}
          onChange={(value) => update("unit", value)}
          footerAction={({ close }) => (
            <button
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] font-bold text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:text-text-muted"
              type="button"
              disabled={!canCreateUom}
              onClick={() => {
                close();
                window.requestAnimationFrame(() => setQuickUomOpen(true));
              }}
            >
              <Plus size={14} /> Add New UOM
            </button>
          )}
        />
        <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
        <label className="block">
          <div className="mb-1 type-caption font-semibold text-text-secondary">Default Cost</div>
          <input
            className="control h-9 w-full text-[13px]"
            type="number"
            min="0"
            step="0.0001"
            value={form.cost ?? ""}
            placeholder="0.00"
            onFocus={selectInputText}
            onChange={(event) => update("cost", event.target.value)}
          />
          <div className="mt-1 type-caption text-text-muted">Cost is per selected UOM. RM per {form.unit || "UOM"}.</div>
          {touched && costInvalid ? <div className="mt-1 type-caption font-semibold text-rose-600">Cost must be a non-negative number with up to 4 decimals.</div> : null}
        </label>
        <div className="md:col-span-2">
          <ItemPhotoPicker
            value={form.photo}
            onChange={(value, meta = {}) => {
              setForm((current) => ({
                ...current,
                photo: value,
                photoFile: meta.file || null,
                photoUploadFailed: meta.uploadFailed === true,
                photoLocalPreview: meta.localPreview === true,
              }));
            }}
          />
        </div>
        <div className="md:col-span-2">
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} placeholder="Short operational description." />
        </div>
        <div className="md:col-span-2">
          <MultiOutletPicker outlets={outlets} selectedIds={form.linkedOutletIds} onChange={updateLinkedOutlets} />
          <div className="mt-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 type-caption text-text-secondary">
            Par levels can be managed in <span className="font-bold text-text-primary">Par Level Setup</span> after the item is saved.
          </div>
          {invalid ? <div className="mt-2 type-caption font-semibold text-rose-600">Item name, category, UOM and at least one linked outlet are required. Cost must be valid when entered.</div> : null}
        </div>
      </div>
      {quickUomOpen ? (
        <UomModal
          onClose={() => setQuickUomOpen(false)}
          onSave={(nextUom) => {
            Promise.resolve(onAddUom(nextUom)).then((saved) => {
              if (!saved?.code) return;
              update("unit", saved.code);
              setQuickUomOpen(false);
            });
          }}
        />
      ) : null}
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

function GroupModal({ group, outletId, outlets, items, categories, onClose, onSave }) {
  const initialGroup = group ? {
    ...group,
    categoryIds: groupCategoryIds(group, items),
    frequency: frequencies.includes(group.frequency) ? group.frequency : "custom",
    checkDays: group.checkDays?.length ? group.checkDays : [weekdayName()],
  } : {
    id: "",
    outletId: outletId || outlets[0]?.id || "",
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
          <div className="rounded-2xl border border-border bg-slate-50 p-3">
            <div className="type-caption font-semibold text-text-secondary">Outlet</div>
            <div className="mt-1 type-body-sm font-bold text-text-primary">{outlets.find((outlet) => outlet.id === form.outletId)?.name || "Selected outlet"}</div>
          </div>
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

function AuditStockCheckModal({ outlets, categories, items, onClose, onStart }) {
  const [form, setForm] = useState({
    outletId: outlets[0]?.id || "",
    date: todayInput(),
    auditName: "",
    auditType: auditTypes[0],
    categoryIds: [],
    notes: "",
  });

  const outletItems = items.filter((item) => item.status === "active" && itemHasActiveOutletLink(item, form.outletId));
  const selectedCategories = new Set(form.categoryIds);
  const selectedLinkedItemCount = outletItems.filter((item) => selectedCategories.has(item.categoryId)).length;
  const canStart = form.outletId && form.auditName.trim() && form.auditType && selectedLinkedItemCount > 0;

  function update(key, value) {
    setForm((current) => {
      if (key === "outletId") return { ...current, outletId: value, categoryIds: [] };
      return { ...current, [key]: value };
    });
  }

  function toggleCategory(categoryId) {
    update("categoryIds", selectedCategories.has(categoryId)
      ? form.categoryIds.filter((id) => id !== categoryId)
      : [...form.categoryIds, categoryId]);
  }

  return (
    <Modal
      title="Audit Stock Check"
      description="Run a special non-scheduled stock check for closing, spot checks or control audits."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!canStart} onClick={() => onStart(form)}>Start Audit</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField label="Outlet" value={form.outletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => update("outletId", value)} searchable />
          <DatePickerField label="Audit Date" value={form.date} onChange={(value) => update("date", value)} required />
          <Field label="Audit Name" value={form.auditName} onChange={(value) => update("auditName", value)} placeholder="Month-end closing count" required />
          <SelectField label="Audit Type" value={form.auditType} options={auditTypes.map((type) => ({ value: type, label: type }))} onChange={(value) => update("auditType", value)} />
        </div>
        <div className="rounded-2xl border border-border p-3">
          <div className="type-title font-bold text-text-primary">Category Selection</div>
          <p className="mt-1 type-caption text-text-secondary">Audit setup selects categories only. The full item list is generated next, and individual items can be skipped during counting with a reason.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {categories.filter((category) => category.status === "active").map((category) => {
              const count = outletItems.filter((item) => item.categoryId === category.id).length;
              return (
                <button
                  key={category.id}
                  className={`rounded-2xl border p-3 text-left transition ${selectedCategories.has(category.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                  type="button"
                  disabled={!count}
                  onClick={() => toggleCategory(category.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="type-body-sm font-bold text-text-primary">{category.name}</span>
                    <Badge tone={!count ? "neutral" : selectedCategories.has(category.id) ? "success" : "info"}>{count ? `${count} items` : "No linked items"}</Badge>
                  </div>
                  <div className="mt-1 type-caption text-text-secondary">{category.description || "Inventory category"}</div>
                </button>
              );
            })}
          </div>
        </div>
        <TextArea label="Notes" value={form.notes} onChange={(value) => update("notes", value)} placeholder="Optional audit objective or instruction" />
      </div>
    </Modal>
  );
}

function SkipReasonModal({ itemName, onClose, onSave }) {
  const [reason, setReason] = useState("");
  const examples = ["Item not available for counting", "Locked storage", "Damaged label", "Staff unable to locate", "Other"];
  return (
    <Modal
      title="Skip stock check item"
      description={`Provide a reason before skipping ${itemName || "this item"}.`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!reason.trim()} onClick={() => onSave(reason)}>Save Reason</button>
        </>
      )}
    >
      <div className="space-y-3">
        <SelectField label="Reason Example" value="" options={[{ value: "", label: "Choose common reason" }, ...examples.map((entry) => ({ value: entry, label: entry }))]} onChange={setReason} />
        <TextArea label="Skip Reason" value={reason} onChange={setReason} placeholder="Explain why this item was skipped" />
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
    quantity: "",
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
        <Field label="Quantity" type="number" value={form.quantity} placeholder="Enter quantity" onChange={(value) => update("quantity", parseNonNegativeNumber(value))} />
        <Field label="Reference" value={form.reference} onChange={(value) => update("reference", value)} />
        <TextArea label="Notes" value={form.notes} onChange={(value) => update("notes", value)} />
      </div>
    </Modal>
  );
}

function WasteModal({ outlet, items, onClose, onSave }) {
  const [form, setForm] = useState({
    id: "",
    date: todayInput(),
    itemId: items[0]?.id ?? "",
    outletId: outlet?.id ?? "",
    wasteType: "Spoilage",
    quantity: "",
    photoUrl: "",
    photoFile: null,
    notes: "",
  });
  const [photoError, setPhotoError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const selectedItem = items.find((item) => item.id === form.itemId);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function handlePhoto(file) {
    setPhotoError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please upload an image file.");
      return;
    }
    try {
      const preview = await readFileAsDataUrl(file);
      setForm((current) => ({ ...current, photoUrl: preview, photoFile: file }));
    } catch (error) {
      setPhotoError(error.message || "Unable to read image.");
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave({ ...form, unit: selectedItem?.unit || selectedItem?.uom_code || "" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      title="Record Waste"
      description={`${outlet?.name || "Selected outlet"} · Track spoilage, expiry, kitchen error and unexplained leakage.`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={isSaving || !form.itemId || !form.outletId || Number(form.quantity) <= 0} onClick={handleSave}>{isSaving ? "Saving..." : "Save Waste"}</button>
        </>
      )}
    >
      <div className="grid gap-3">
        <div className="rounded-2xl border border-border bg-slate-50 p-3">
          <div className="type-caption font-semibold text-text-secondary">Outlet</div>
          <div className="mt-1 type-body-sm font-bold text-text-primary">{outlet?.name || "Selected outlet"}</div>
        </div>
        <SelectField label="Item" value={form.itemId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => update("itemId", value)} searchable />
        <SelectField label="Waste Type" value={form.wasteType} options={wasteTypes.map((type) => ({ value: type, label: type }))} onChange={(value) => update("wasteType", value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quantity" type="number" value={form.quantity} placeholder="Enter quantity" onChange={(value) => update("quantity", parseNonNegativeNumber(value))} />
          <label className="block">
            <div className="mb-1 type-caption font-semibold text-text-secondary">Unit</div>
            <div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{selectedItem?.unit || "Unit"}</div>
          </label>
        </div>
        <DatePickerField label="Waste Date" value={form.date} onChange={(value) => update("date", value)} />
        <TextArea label="Reason / Remark" value={form.notes} onChange={(value) => update("notes", value)} />
        <div>
          <div className="mb-1 type-caption font-semibold text-text-secondary">Photo Evidence</div>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-slate-50 p-3">
            <label className="btn-secondary h-8 cursor-pointer px-3 text-xs">
              <Upload size={14} /> Upload Photo
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => handlePhoto(event.target.files?.[0])} />
            </label>
            {form.photoUrl ? (
              <>
                <img className="h-12 w-12 rounded-xl border border-border object-cover" src={form.photoUrl} alt="Waste evidence preview" />
                <button className="btn-secondary h-8 px-3 text-xs text-rose-700" type="button" onClick={() => setForm((current) => ({ ...current, photoUrl: "", photoFile: null }))}>Remove</button>
              </>
            ) : <span className="type-caption font-semibold text-text-muted">Optional evidence</span>}
          </div>
          {photoError ? <div className="mt-1 type-caption font-semibold text-amber-700">{photoError}</div> : null}
        </div>
      </div>
    </Modal>
  );
}

function recipeIngredientCost(line = {}, item) {
  const quantity = Number(line.quantityUsed || 0);
  const unitCost = Number(item?.cost || 0);
  const totalCost = quantity * unitCost;
  const wastageCost = totalCost * (Number(line.wastagePercent || 0) / 100);
  return {
    quantity,
    unitCost,
    totalCost,
    wastageCost,
  };
}

function RecipeIngredientPreviewPill({ recipe, itemById }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const ingredients = recipe.ingredients || [];
  const rows = ingredients.slice(0, 5).map((line) => {
    const item = itemById.get(line.itemId);
    const quantity = Number(line.quantityUsed ?? line.quantity_used ?? 0);
    const displayQty = Number.isFinite(quantity) ? String(quantity).replace(/\.0+$/, "") : "-";
    const unit = line.unit || item?.unit || "";
    const cost = recipeIngredientCost(line, item);
    return `${item?.name || "Inventory item"} · ${displayQty} ${unit}`.trim() + ` · ${toCurrency(cost.totalCost)}`;
  });
  const remaining = Math.max(0, ingredients.length - 5);

  return (
    <span
      className="inline-flex"
      ref={anchorRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        className="rounded-full border border-border bg-slate-50 px-2.5 py-1 type-caption font-bold text-text-secondary transition hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/20"
        type="button"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        {ingredients.length} ingredient{ingredients.length === 1 ? "" : "s"}
      </button>
      <FloatingLayer
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        align="start"
        width={300}
        minWidth={260}
        estimatedHeight={220}
        className="p-0"
        contentClassName="p-3"
      >
        <div className="mb-2 type-caption font-black uppercase tracking-wide text-text-muted">Ingredient Preview</div>
        {rows.length ? (
          <div className="space-y-1.5">
            {rows.map((line) => (
              <div key={line} className="type-caption font-semibold text-text-secondary">{line}</div>
            ))}
            {remaining ? <div className="type-caption font-black text-primary">+{remaining} more</div> : null}
          </div>
        ) : (
          <div className="type-caption text-text-muted">No ingredients</div>
        )}
      </FloatingLayer>
    </span>
  );
}

function recipeCostSummary(recipe = {}, items = []) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return (recipe.ingredients || []).reduce((summary, line) => {
    const cost = recipeIngredientCost(line, itemById.get(line.itemId));
    return {
      ingredientCost: summary.ingredientCost + cost.totalCost,
      wastageCost: summary.wastageCost + cost.wastageCost,
      totalCost: summary.totalCost + cost.totalCost + cost.wastageCost,
    };
  }, { ingredientCost: 0, wastageCost: 0, totalCost: 0 });
}

function recipeMarginPercent(sellingPrice, cost) {
  const price = Number(sellingPrice || 0);
  const totalCost = Number(cost || 0);
  if (!price || price <= 0) return null;
  return ((price - totalCost) / price) * 100;
}

function recipeMarginTone(margin) {
  if (margin === null || margin === undefined || !Number.isFinite(Number(margin))) return "neutral";
  if (margin >= 70) return "success";
  if (margin >= 40) return "warning";
  return "danger";
}

function formatRecipeMargin(margin) {
  if (margin === null || margin === undefined || !Number.isFinite(Number(margin))) return "—";
  return `${Math.round(margin)}%`;
}

function RecipeIntelligencePlaceholder({ title, description }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-border bg-slate-50/70 p-4 text-center dark:bg-white/5">
      <div>
        <div className="type-title font-black text-text-primary">{title}</div>
        <p className="mt-1 max-w-md type-body-sm text-text-secondary">{description}</p>
      </div>
    </div>
  );
}

function RecipeIntelligenceCard({ title, description, children, showViewAll = false }) {
  return (
    <div className="rounded-3xl border border-border bg-background p-4 shadow-sm dark:bg-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="type-title font-black text-text-primary">{title}</div>
          <p className="mt-1 type-body-sm text-text-secondary">{description}</p>
        </div>
        {showViewAll ? <button className="type-caption font-black text-primary hover:underline" type="button">View All</button> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function RecipeInsightBadge({ classification }) {
  const tone = classification === "Star" ? "success" : classification === "Puzzle" ? "info" : classification === "Workhorse" ? "warning" : "danger";
  return <Badge tone={tone}>{classification}</Badge>;
}

function classifyMenuEngineeringRow(row, averageVolume, averageMargin) {
  const highVolume = Number(row.salesVolume || 0) >= Number(averageVolume || 0);
  const highMargin = Number(row.margin || 0) >= Number(averageMargin || 0);
  if (highVolume && highMargin) {
    return {
      classification: "Star",
      impact: "High",
      reason: "High volume and high margin.",
      action: "Protect availability and keep promoting.",
    };
  }
  if (highVolume && !highMargin) {
    return {
      classification: "Workhorse",
      impact: "High",
      reason: "Strong volume but margin trails the average.",
      action: "Review ingredient cost, portioning, or price.",
    };
  }
  if (!highVolume && highMargin) {
    return {
      classification: "Puzzle",
      impact: "Medium",
      reason: "Good margin but lower sales volume.",
      action: "Improve placement, bundling, or staff recommendation.",
    };
  }
  return {
    classification: "Dog",
    impact: "Low",
    reason: "Low volume and low margin.",
    action: "Consider simplifying, repricing, or retiring.",
  };
}

function RecipeInsightsPanel({ rows = [] }) {
  if (!rows.length) {
    return (
      <RecipeIntelligenceCard title="Recipe Insights" description="Actionable classification will appear when mapped sales data is available.">
        <RecipeIntelligencePlaceholder
          title="No reliable insights yet"
          description="Map recipes to Product Analytics products to classify Star, Workhorse, Puzzle and Dog recipes."
        />
      </RecipeIntelligenceCard>
    );
  }
  const averageVolume = rows.reduce((sum, row) => sum + Number(row.salesVolume || 0), 0) / rows.length;
  const averageMargin = rows.reduce((sum, row) => sum + Number(row.margin || 0), 0) / rows.length;
  const ranked = rows
    .map((row) => ({ ...row, ...classifyMenuEngineeringRow(row, averageVolume, averageMargin) }))
    .sort((a, b) => {
      const priority = { Star: 0, Workhorse: 1, Puzzle: 2, Dog: 3 };
      return priority[a.classification] - priority[b.classification] || Number(b.revenue || 0) - Number(a.revenue || 0);
    })
    .slice(0, 5);
  return (
    <RecipeIntelligenceCard title="Recipe Insights" description="Top actions from the mapped Product Analytics period.">
      <div className="space-y-3">
        {ranked.map((row) => (
          <div key={`${row.id}-${row.classification}`} className="rounded-2xl border border-border bg-slate-50/80 p-3 dark:bg-white/5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-black text-text-primary">{recipeNameEn(row.recipe) || row.label}</div>
                <div className="type-caption text-text-muted">{row.salesVolume.toLocaleString()} sold · {toCurrency(row.revenue)} revenue</div>
              </div>
              <RecipeInsightBadge classification={row.classification} />
            </div>
            <p className="mt-2 type-body-sm text-text-secondary">{row.reason}</p>
            <div className="mt-2 rounded-xl bg-background/80 p-2 type-caption text-text-secondary dark:bg-black/20">
              <span className="font-black text-text-primary">Recommended action:</span> {row.action}
            </div>
            <div className="mt-2 type-caption font-bold text-text-muted">Impact: {row.impact}</div>
          </div>
        ))}
      </div>
    </RecipeIntelligenceCard>
  );
}

function RecipeIntelligenceLockedState({ mappedCount }) {
  const remaining = Math.max(10 - Number(mappedCount || 0), 0);
  return (
    <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-amber-200 bg-amber-50/80 p-6 text-center shadow-inner dark:border-amber-400/30 dark:bg-amber-950/30">
      <div className="max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-200/80 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100">
          <Sparkles size={24} />
        </div>
        <div className="mt-4 type-title font-black text-text-primary">Need at least 10 mapped recipes</div>
        <p className="mt-1 type-body-sm text-text-secondary">Menu Engineering needs enough mapped products to avoid noisy management decisions.</p>
        <p className="mt-3 type-body-sm font-bold text-amber-800 dark:text-amber-100">
          Map {remaining} more {remaining === 1 ? "recipe" : "recipes"} to unlock reliable matrix insights.
        </p>
      </div>
    </div>
  );
}

function RecipeBarChart({ rows = [], valueFormatter = (value) => value, emptyTitle, emptyDescription, tone = "primary" }) {
  const maxValue = Math.max(...rows.map((row) => Number(row.value || 0)), 0);
  const toneClass = tone === "warning" ? "bg-amber-500" : tone === "success" ? "bg-emerald-500" : "bg-primary";
  if (!rows.length || !maxValue) {
    return <RecipeIntelligencePlaceholder title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const value = Number(row.value || 0);
        const width = Math.max(6, Math.round((value / maxValue) * 100));
        return (
          <div key={row.id || row.label} className="space-y-1">
            <div className="flex items-center justify-between gap-3 type-caption">
              <span className="truncate font-bold text-text-primary">{row.label}</span>
              <span className="shrink-0 font-black text-text-secondary">{valueFormatter(value)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${toneClass}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecipeMappingHealth({ mapped, unmapped, totalRecipes, loading }) {
  const total = mapped + unmapped;
  const coverage = total ? Math.round((mapped / total) * 100) : 0;
  return (
    <div className="overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/10 via-background to-emerald-50 p-4 shadow-sm dark:from-emerald-400/10 dark:via-white/5 dark:to-cyan-400/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="type-caption font-black uppercase tracking-wide text-text-muted">Recipe Mapping Health</div>
          <div className="mt-1 text-3xl font-black text-text-primary">{coverage}%</div>
          <p className="mt-1 max-w-xl type-body-sm text-text-secondary">You’re almost there. Map more recipes to unlock full menu insights.</p>
        </div>
        {loading ? <Badge tone="info">Loading</Badge> : <Badge tone={coverage >= 80 ? "success" : coverage >= 40 ? "warning" : "neutral"}>{mapped} mapped</Badge>}
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/80 shadow-inner dark:bg-black/30">
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all" style={{ width: `${coverage}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center type-caption sm:grid-cols-4">
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{mapped}</div>
          <div className="font-semibold text-text-muted">Mapped</div>
        </div>
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{unmapped}</div>
          <div className="font-semibold text-text-muted">Unmapped</div>
        </div>
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{coverage}%</div>
          <div className="font-semibold text-text-muted">Coverage %</div>
        </div>
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{total || 0} / {totalRecipes || 0}</div>
          <div className="font-semibold text-text-muted">Products / Recipes</div>
        </div>
      </div>
    </div>
  );
}

function RecipeMenuEngineeringMatrix({ rows = [] }) {
  if (!rows.length) {
    return (
      <RecipeIntelligencePlaceholder
        title="Coming Soon"
        description="Requires Product Analytics ↔ Recipe Mapping before sales volume, margin %, and revenue bubbles can be plotted."
      />
    );
  }
  const maxVolume = Math.max(...rows.map((row) => Number(row.salesVolume || 0)), 1);
  const maxRevenue = Math.max(...rows.map((row) => Number(row.revenue || 0)), 1);
  const averageVolume = rows.reduce((sum, row) => sum + Number(row.salesVolume || 0), 0) / rows.length;
  const averageMargin = rows.reduce((sum, row) => sum + Number(row.margin || 0), 0) / rows.length;
  const averageVolumeX = 10 + (averageVolume / maxVolume) * 80;
  const averageMarginY = 86 - Math.max(0, Math.min(100, averageMargin));
  return (
    <div className="relative h-[360px] overflow-hidden rounded-3xl border border-border bg-slate-950 p-4 shadow-inner dark:bg-slate-950">
      <div className="absolute inset-x-10 bottom-12 top-10 overflow-hidden rounded-2xl border border-white/10">
        <div className="absolute left-0 top-0 h-1/2 w-1/2 bg-amber-400/10" />
        <div className="absolute right-0 top-0 h-1/2 w-1/2 bg-emerald-400/10" />
        <div className="absolute bottom-0 left-0 h-1/2 w-1/2 bg-rose-400/10" />
        <div className="absolute bottom-0 right-0 h-1/2 w-1/2 bg-sky-400/10" />
      </div>
      <div className="absolute left-4 top-3 type-caption font-black uppercase tracking-wide text-slate-300">Margin %</div>
      <div className="absolute bottom-4 right-4 type-caption font-black uppercase tracking-wide text-slate-300">Qty Sold</div>
      <div className="absolute bottom-12 top-10 border-l border-dashed border-white/35" style={{ left: `${averageVolumeX}%` }} />
      <div className="absolute left-10 right-10 border-t border-dashed border-white/35" style={{ top: `${averageMarginY}%` }} />
      <div className="absolute right-14 top-14 rounded-full bg-emerald-400/15 px-2 py-1 type-caption font-black text-emerald-100">Star</div>
      <div className="absolute left-14 top-14 rounded-full bg-amber-400/15 px-2 py-1 type-caption font-black text-amber-100">Puzzle</div>
      <div className="absolute bottom-16 right-14 rounded-full bg-sky-400/15 px-2 py-1 type-caption font-black text-sky-100">Workhorse</div>
      <div className="absolute bottom-16 left-14 rounded-full bg-rose-400/15 px-2 py-1 type-caption font-black text-rose-100">Dog</div>
      {rows.map((row) => {
        const x = 10 + (Number(row.salesVolume || 0) / maxVolume) * 80;
        const y = 86 - Math.max(0, Math.min(100, Number(row.margin || 0)));
        const size = 18 + (Number(row.revenue || 0) / maxRevenue) * 34;
        const cost = Number(row.recipeCost || 0);
        const price = Number(row.sellingPrice || 0);
        return (
          <div
            key={row.id}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%`, height: size, width: size }}
            title={`${row.label}: ${row.salesVolume} sold, ${toCurrency(row.revenue)} revenue, ${formatRecipeMargin(row.margin)} margin`}
          >
            <div className="h-full w-full rounded-full border-2 border-white/80 bg-primary shadow-[0_0_22px_rgba(34,197,94,0.55)] ring-4 ring-primary/25" />
            <div className="pointer-events-none absolute left-full top-1/2 ml-2 hidden w-48 -translate-y-1/2 rounded-2xl border border-white/15 bg-slate-900/95 p-3 text-left text-xs text-white shadow-2xl group-hover:block">
              <div className="font-black">{recipeNameEn(row.recipe) || row.label}</div>
              <div className="mt-1 text-slate-300">Qty Sold: {Number(row.salesVolume || 0).toLocaleString()}</div>
              <div className="text-slate-300">Revenue: {toCurrency(row.revenue)}</div>
              <div className="text-slate-300">Cost: {toCurrency(cost)}</div>
              <div className="text-slate-300">Price: {toCurrency(price)}</div>
              <div className="text-slate-300">Profit: {toCurrency(row.profitPerServing)}</div>
              <div className="text-slate-300">Margin: {formatRecipeMargin(row.margin)}</div>
            </div>
            <div className="absolute left-full top-1/2 ml-2 max-w-[110px] -translate-y-1/2 truncate rounded-full bg-white/90 px-2 py-0.5 type-caption font-black text-slate-900 shadow-sm">
              {row.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecipeRankingTable({ rows = [], columns = [], emptyTitle, emptyDescription }) {
  if (!rows.length) {
    return <RecipeIntelligencePlaceholder title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
          <tr>
            {columns.map((column, index) => (
              <th key={column.key} className={index === 0 ? "px-3 py-2" : "py-2"}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id || row.label}>
              {columns.map((column, index) => (
                <td key={column.key} className={index === 0 ? "px-3 py-2" : "py-2"}>
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

function RecipeModal({ recipe, outletId, outlet, items, menuCategories, existingRecipes = [], onClose, onSave }) {
  const [isSaving, setIsSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(recipe?.recipePhotoUrl || recipe?.recipe_photo_url || "");
  const [touched, setTouched] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [duplicateCodeError, setDuplicateCodeError] = useState("");
  const [checkingRecipeCode, setCheckingRecipeCode] = useState(false);
  const duplicateCheckRef = useRef({ requestId: 0, submitting: false, saving: false });
  const [form, setForm] = useState(() => ({
    id: recipe?.id || "",
    outletId: recipe?.outletId || outletId || "",
    recipeCode: recipeCode(recipe),
    recipeNameEn: recipeNameEn(recipe),
    recipeNameCn: recipeNameCn(recipe),
    menuCategory: recipe?.menuCategory || recipe?.menu_category || menuCategories.find((category) => category.status === "active")?.name || recipeMenuCategories[0],
    recipePhotoUrl: recipe?.recipePhotoUrl || recipe?.recipe_photo_url || "",
    recipePhotoFile: null,
    sellingPrice: recipe?.sellingPrice ?? recipe?.selling_price ?? "",
    servingSize: recipe?.servingSize || recipe?.serving_size || "1",
    status: recipe?.status || "active",
    notes: recipe?.notes || "",
    ingredients: (recipe?.ingredients || recipe?.items || []).map((line) => ({
      id: line.id || makeId("recipe_item"),
      itemId: line.itemId || line.inventory_item_id || "",
      quantityUsed: line.quantityUsed ?? line.quantity_used ?? 0,
      unit: line.unit || "",
      wastagePercent: line.wastagePercent ?? line.wastage_percent ?? 0,
      remark: line.remark || "",
    })),
  }));
  const availableItems = items.filter((item) => item.status === "active" && itemHasActiveOutletLink(item, form.outletId));
  const update = (key, value) => setForm((current) => {
    return { ...current, [key]: value };
  });
  const updateIngredient = (id, patch) => setForm((current) => ({
    ...current,
    ingredients: current.ingredients.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      if (patch.itemId) next.unit = items.find((item) => item.id === patch.itemId)?.unit || next.unit;
      return next;
    }),
  }));
  const addIngredient = () => {
    const firstItem = availableItems[0];
    setForm((current) => ({
      ...current,
      ingredients: [
        ...current.ingredients,
        {
          id: makeId("recipe_item"),
          itemId: firstItem?.id || "",
          quantityUsed: 0,
          unit: firstItem?.unit || "",
          wastagePercent: 0,
          remark: "",
        },
      ],
    }));
  };
  const removeIngredient = (id) => setForm((current) => ({ ...current, ingredients: current.ingredients.filter((line) => line.id !== id) }));
  const summary = recipeCostSummary(form, items);
  const margin = recipeMarginPercent(form.sellingPrice, summary.totalCost);
  const profit = Number(form.sellingPrice || 0) - Number(summary.totalCost || 0);
  const normalizedRecipeCode = recipeCode(form).toLowerCase();
  const duplicateValidationSuppressed = isSaving || duplicateCheckRef.current.saving;
  const setRecipeDuplicateError = (message, source, meta = {}) => {
    debugLog("[RecipeDuplicateErrorSource]", {
      source,
      value: recipeCode(form),
      mode: form.id ? "edit" : "create",
      recipeId: form.id || "",
      timestamp: new Date().toISOString(),
      message,
      ...meta,
    });
    setDuplicateCodeError(message);
  };
  const localDuplicateRecipeCode = !duplicateValidationSuppressed && Boolean(normalizedRecipeCode && existingRecipes.some((entry) => entry.id !== form.id && recipeCode(entry).toLowerCase() === normalizedRecipeCode));
  const duplicateRecipeCode = !duplicateValidationSuppressed && Boolean(localDuplicateRecipeCode || duplicateCodeError);
  const sellingPriceValue = Number(form.sellingPrice);
  const sellingPriceInvalid = form.sellingPrice === "" || !Number.isFinite(sellingPriceValue) || sellingPriceValue <= 0;
  const identityErrors = {
    recipeCode: !form.recipeCode.trim() ? "Recipe code is required." : duplicateRecipeCode ? "Recipe code already exists." : "",
    recipeNameEn: !form.recipeNameEn.trim() ? "Recipe Name EN is required." : "",
    recipeNameCn: !form.recipeNameCn.trim() ? "Recipe Name CN is required." : "",
    sellingPrice: sellingPriceInvalid ? "Selling price must be greater than 0." : "",
  };
  const categoryOptions = menuCategories
    .filter((category) => category.status === "active")
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.name.localeCompare(b.name))
    .map((category) => ({ value: category.name, label: category.name }));
  const safeCategoryOptions = categoryOptions.length ? categoryOptions : recipeMenuCategories.map((category) => ({ value: category, label: category }));
  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setPhotoPreview(preview);
    update("recipePhotoFile", file);
  };
  const hasInvalidIngredients = !form.ingredients.length || form.ingredients.some((line) => !line.itemId || Number(line.quantityUsed || 0) <= 0);
  const invalid = Boolean(identityErrors.recipeCode || identityErrors.recipeNameEn || identityErrors.recipeNameCn || identityErrors.sellingPrice || !form.outletId || hasInvalidIngredients);
  const showError = (key) => Boolean(touched[key] || submitAttempted);
  const touchField = (key) => setTouched((current) => ({ ...current, [key]: true }));
  const ingredientFieldKey = (lineId, field) => `ingredient.${lineId}.${field}`;
  const handleRecipeCodeChange = (value) => {
    duplicateCheckRef.current.requestId += 1;
    setRecipeDuplicateError("", "recipe-code-change");
    update("recipeCode", value);
  };
  const checkDuplicateRecipeCode = async ({ forSubmit = false } = {}) => {
    const code = recipeCode(form);
    const codeKey = normalizeProductRecipeKey(code);
    const requestId = duplicateCheckRef.current.requestId + 1;
    duplicateCheckRef.current.requestId = requestId;
    if (forSubmit) duplicateCheckRef.current.submitting = true;
    touchField("recipeCode");
    if (!code) {
      if (duplicateCheckRef.current.requestId === requestId) setRecipeDuplicateError("", forSubmit ? "submit-duplicate-check-blank" : "onBlur-duplicate-check-blank", { requestId });
      debugLog("[RecipeCodeValidation]", { value: code, duplicateResult: false, submitBlocked: forSubmit && true, reason: "blank" });
      return false;
    }
    const localDuplicate = Boolean(codeKey && existingRecipes.some((entry) => entry.id !== form.id && normalizeProductRecipeKey(recipeCode(entry)) === codeKey));
    if (localDuplicate) {
      if (duplicateCheckRef.current.requestId === requestId && !duplicateCheckRef.current.saving) setRecipeDuplicateError("Recipe code already exists.", forSubmit ? "submit-duplicate-check-local" : "onBlur-duplicate-check-local", { requestId });
      debugLog("[RecipeCodeValidation]", { value: code, duplicateResult: true, submitBlocked: forSubmit, source: "local" });
      return true;
    }
    setCheckingRecipeCode(true);
    try {
      const result = await supabase
        .from("inventory_recipes")
        .select("id, recipe_code")
        .ilike("recipe_code", code)
        .limit(5);
      if (result.error) throw result.error;
      const duplicate = (result.data || []).some((row) => row.id !== form.id && normalizeProductRecipeKey(recipeCode(row)) === codeKey);
      const isLatest = duplicateCheckRef.current.requestId === requestId && recipeCode(form).toLowerCase() === code.toLowerCase();
      if (isLatest && !duplicateCheckRef.current.saving) setRecipeDuplicateError(duplicate ? "Recipe code already exists." : "", forSubmit ? "submit-duplicate-check-remote" : "onBlur-duplicate-check-remote", { requestId, duplicateResult: duplicate });
      debugLog("[RecipeCodeValidation]", { value: code, duplicateResult: duplicate, submitBlocked: forSubmit && duplicate, source: "remote", stale: !isLatest });
      return duplicate;
    } catch (error) {
      debugLog("[RecipeCodeDuplicateDebug]", { recipeId: form.id, recipeCode: code, error });
      if (duplicateCheckRef.current.requestId === requestId && !duplicateCheckRef.current.saving) setRecipeDuplicateError("", forSubmit ? "submit-duplicate-check-error-clear" : "onBlur-duplicate-check-error-clear", { requestId, error });
      return false;
    } finally {
      if (duplicateCheckRef.current.requestId === requestId) setCheckingRecipeCode(false);
      if (forSubmit) duplicateCheckRef.current.submitting = false;
    }
  };
  const handleSave = async () => {
    setSubmitAttempted(true);
    if (isSaving) return;
    const blockingInvalid = Boolean(!form.recipeCode.trim() || !form.recipeNameEn.trim() || !form.recipeNameCn.trim() || identityErrors.sellingPrice || !form.outletId || hasInvalidIngredients);
    if (blockingInvalid) return;
    const hasDuplicate = await checkDuplicateRecipeCode({ forSubmit: true });
    if (hasDuplicate) return;
    duplicateCheckRef.current.saving = true;
    duplicateCheckRef.current.requestId += 1;
    setRecipeDuplicateError("", "submit-no-duplicate-clear");
    setIsSaving(true);
    try {
      await onSave({ ...form });
      setRecipeDuplicateError("", "save-success-clear");
      setTouched({});
      setSubmitAttempted(false);
    } catch (error) {
      if (/inventory_recipes_recipe_code_unique|recipe_code/i.test(String(error?.message || error?.details || ""))) {
        duplicateCheckRef.current.saving = false;
        setRecipeDuplicateError("Recipe code already exists.", "supabase-unique-fallback", { error });
        touchField("recipeCode");
      }
    } finally {
      duplicateCheckRef.current.saving = false;
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={recipe ? "Edit Recipe" : "Add Recipe"}
      description="Build a recipe BOM by linking menu items to outlet-linked inventory ingredients."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={isSaving || checkingRecipeCode} onClick={handleSave}>{isSaving ? "Saving..." : "Save Recipe"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3">
            <div className="type-title font-black text-text-primary">Recipe Identity</div>
            <div className="type-caption text-text-secondary">Core recipe names and lifecycle state.</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Recipe Code"
              value={form.recipeCode}
              required
              onChange={handleRecipeCodeChange}
              onBlur={checkDuplicateRecipeCode}
              error={showError("recipeCode") ? identityErrors.recipeCode : ""}
              placeholder="RCP-CURRY-001"
            />
            {checkingRecipeCode ? <div className="self-end type-caption font-semibold text-text-muted">Checking recipe code...</div> : null}
            <SelectField label="Menu Category" value={form.menuCategory} options={safeCategoryOptions} onChange={(value) => update("menuCategory", value)} />
            <Field
              label="Recipe Name EN"
              value={form.recipeNameEn}
              required
              onChange={(value) => update("recipeNameEn", value)}
              onBlur={() => touchField("recipeNameEn")}
              error={showError("recipeNameEn") ? identityErrors.recipeNameEn : ""}
              placeholder="Classic Dry Curry Noodle"
            />
            <Field
              label="Recipe Name CN"
              value={form.recipeNameCn}
              required
              onChange={(value) => update("recipeNameCn", value)}
              onBlur={() => touchField("recipeNameCn")}
              error={showError("recipeNameCn") ? identityErrors.recipeNameCn : ""}
              placeholder="经典干咖喱面"
            />
            <label>
              <div className="mb-1 type-caption font-semibold text-text-secondary">Outlet</div>
              <div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{outlet?.name || "Selected outlet"}</div>
            </label>
            <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3">
            <div className="type-title font-black text-text-primary">Commercial Information</div>
            <div className="type-caption text-text-secondary">Selling price and yield drive live recipe costing.</div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.4fr] lg:items-end">
            <Field
              label="Selling Price"
              type="number"
              value={form.sellingPrice}
              required
              onChange={(value) => update("sellingPrice", parseNonNegativeNumber(value))}
              onBlur={() => touchField("sellingPrice")}
              error={showError("sellingPrice") ? identityErrors.sellingPrice : ""}
              placeholder="0.00"
            />
            <Field label="Serving Size / Yield" value={form.servingSize} onChange={(value) => update("servingSize", value)} placeholder="1" />
            <div className="grid gap-2 sm:grid-cols-3">
              <MetricCard label="Recipe Cost" value={toCurrency(summary.totalCost)} helper="Ingredient + wastage" tone="success" size="compact" />
              <MetricCard label="Profit" value={form.sellingPrice !== "" ? toCurrency(profit) : "—"} helper="Price - cost" tone={profit >= 0 ? "success" : "danger"} size="compact" />
              <MetricCard label="Margin %" value={formatRecipeMargin(margin)} helper="Price vs cost" tone={recipeMarginTone(margin)} size="compact" />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3">
            <div className="type-title font-black text-text-primary">Product Display</div>
            <div className="type-caption text-text-secondary">Photo and notes shown to operators reviewing the recipe.</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <label>
              <div className="mb-1 type-caption font-semibold text-text-secondary">Recipe Photo</div>
              <div className="rounded-2xl border border-border bg-slate-50 p-3">
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-100">
                  {photoPreview ? <img className="h-full w-full object-contain p-2" src={photoPreview} alt="Recipe preview" /> : <div className="text-xs font-bold text-text-muted">No recipe photo</div>}
                </div>
                <input type="file" accept="image/*" onChange={handlePhotoChange} className="mt-3 block w-full text-xs text-text-secondary file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-primary" />
              </div>
            </label>
            <TextArea label="Notes" value={form.notes} onChange={(value) => update("notes", value)} placeholder="Prep notes, yield assumptions or special handling." />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="type-title font-black text-text-primary">Ingredients</div>
              <div className="type-caption text-text-secondary">Quantity used is per serving/yield above.</div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge tone="success">Running total {toCurrency(summary.totalCost)}</Badge>
              <button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={addIngredient} disabled={!availableItems.length}>
                <Plus size={14} /> Add Ingredient
              </button>
            </div>
          </div>
          <div className="mb-3 rounded-2xl border border-primary/15 bg-primary/5 p-3 type-caption text-text-secondary">
            Ingredient selector only shows active inventory items linked to the selected outlet.
          </div>
          {form.ingredients.length ? (
            <div className="space-y-2">
              {form.ingredients.map((line) => {
                const item = items.find((entry) => entry.id === line.itemId);
                const cost = recipeIngredientCost(line, item);
                return (
                  <div key={line.id} className="grid gap-2 rounded-2xl border border-border bg-slate-50/70 p-3 xl:grid-cols-[1.4fr_95px_72px_95px_95px_100px_1fr_auto] xl:items-end">
                    <div>
                      <SelectField label="Inventory Item" value={line.itemId} options={availableItems.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(value) => updateIngredient(line.id, { itemId: value })} searchable />
                      {submitAttempted && !line.itemId ? <div className="mt-1 type-caption font-semibold text-rose-600">Inventory item is required.</div> : null}
                    </div>
                    <Field
                      label="Qty Used"
                      type="number"
                      value={line.quantityUsed}
                      onChange={(value) => updateIngredient(line.id, { quantityUsed: parseNonNegativeNumber(value) })}
                      onBlur={() => touchField(ingredientFieldKey(line.id, "quantityUsed"))}
                      error={(showError(ingredientFieldKey(line.id, "quantityUsed")) && Number(line.quantityUsed || 0) <= 0) ? "Qty must be greater than 0." : ""}
                    />
                    <label>
                      <div className="mb-1 type-caption font-semibold text-text-secondary">Unit</div>
                      <div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{item?.unit || line.unit || "-"}</div>
                    </label>
                    <label>
                      <div className="mb-1 type-caption font-semibold text-text-secondary">Unit Cost</div>
                      <div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{toCurrency(cost.unitCost)}</div>
                    </label>
                    <Field label="Wastage %" type="number" value={line.wastagePercent} onChange={(value) => updateIngredient(line.id, { wastagePercent: parseNonNegativeNumber(value) })} />
                    <label>
                      <div className="mb-1 type-caption font-semibold text-text-secondary">Total Cost</div>
                      <div className="control flex h-9 items-center text-[13px] font-semibold text-text-primary">{toCurrency(cost.totalCost + cost.wastageCost)}</div>
                    </label>
                    <Field label="Remark" value={line.remark} onChange={(value) => updateIngredient(line.id, { remark: value })} placeholder="Optional" />
                    <button className="btn-secondary h-9 px-3 text-xs text-rose-700" type="button" onClick={() => removeIngredient(line.id)}>Remove</button>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No ingredients yet" description={availableItems.length ? "Add ingredients to define usage per serving." : "No active outlet-linked inventory items are available for this outlet."} />}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-slate-50 p-3">
            <div>
              <div className="type-caption font-black uppercase tracking-wide text-text-muted">Total Recipe Cost</div>
              <div className="type-title font-black text-text-primary">{toCurrency(summary.totalCost)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">Ingredient {toCurrency(summary.ingredientCost)}</Badge>
              <Badge tone={summary.wastageCost ? "warning" : "neutral"}>Wastage {toCurrency(summary.wastageCost)}</Badge>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function RecipeDetailModal({ recipe, outlet, items, categories, onClose, onEdit }) {
  const ingredients = recipe?.ingredients || [];
  const summary = recipeCostSummary(recipe, items);
  const margin = recipeMarginPercent(recipe?.sellingPrice ?? recipe?.selling_price, summary.totalCost);
  const photoUrl = recipe?.recipePhotoUrl || recipe?.recipe_photo_url || "";
  const code = recipeCode(recipe);
  const nameEn = recipeNameEn(recipe);
  const nameCn = recipeNameCn(recipe);
  return (
    <Modal
      title={nameEn || nameCn || code || "Recipe"}
      description={`${outlet?.name || "Outlet"} · ${recipe?.menuCategory || "Menu Category"}`}
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-primary" type="button" onClick={onEdit}>Edit Recipe</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-3xl border border-border bg-slate-50 lg:h-[240px] lg:w-[240px]">
            {photoUrl ? (
              <img className="h-full w-full object-contain p-2" src={photoUrl} alt={nameEn || nameCn || code || "Recipe"} />
            ) : (
              <div className="type-body-sm font-bold text-text-muted">No recipe photo</div>
            )}
          </div>
          <div className="rounded-3xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="type-caption font-black uppercase tracking-wide text-text-muted">{code || "No recipe code"}</div>
                <div className="type-section-title font-black text-text-primary">{nameEn || "Recipe Name EN required"}</div>
                <div className="mt-1 type-body-sm font-semibold text-text-secondary">{nameCn || "Recipe Name CN required"}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge tone="info">{recipe?.menuCategory || "Uncategorized"}</Badge>
                  <Badge tone={statusTone(recipe?.status || "active")}>{toTitle(recipe?.status || "active")}</Badge>
                </div>
                <div className="mt-2 type-body-sm font-semibold text-text-secondary">{outlet?.name || "Outlet"} · {recipe?.servingSize || "1 portion"}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="Estimated Cost" value={toCurrency(summary.totalCost)} helper="Ingredient + wastage" tone="success" size="compact" />
              <MetricCard label="Selling Price" value={recipe?.sellingPrice !== "" && recipe?.sellingPrice !== null && recipe?.sellingPrice !== undefined ? toCurrency(recipe.sellingPrice) : "—"} helper="Menu price" size="compact" />
              <MetricCard label="Margin %" value={formatRecipeMargin(margin)} helper="Price vs cost" tone={recipeMarginTone(margin)} size="compact" />
              <MetricCard label="Ingredients" value={ingredients.length} helper="BOM rows" size="compact" />
              <MetricCard label="Ingredient Cost" value={toCurrency(summary.ingredientCost)} helper="Before wastage" size="compact" />
              <MetricCard label="Status" value={toTitle(recipe?.status || "active")} helper="Recipe lifecycle" tone={statusTone(recipe?.status || "active")} size="compact" />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2">Inventory Item</th>
                <th>Category</th>
                <th>Qty Used</th>
                <th>Unit</th>
                <th>Unit Cost</th>
                <th>Total Cost</th>
                <th>Wastage %</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[13px]">
              {ingredients.map((line) => {
                const item = items.find((entry) => entry.id === line.itemId);
                const category = categories.find((entry) => entry.id === item?.categoryId);
                const cost = recipeIngredientCost(line, item);
                return (
                  <tr key={line.id || line.itemId}>
                    <td className="px-3 py-2 font-bold text-text-primary">{item?.name || "Inventory item"}</td>
                    <td>{category?.name || "Uncategorized"}</td>
                    <td>{line.quantityUsed}</td>
                    <td>{line.unit || item?.unit || "-"}</td>
                    <td>{toCurrency(cost.unitCost)}</td>
                    <td>{toCurrency(cost.totalCost)}</td>
                    <td>{line.wastagePercent || 0}%</td>
                    <td>{line.remark || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
          <div className="type-title font-bold text-text-primary">Usage Estimate</div>
          <p className="mt-1 type-body-sm text-text-secondary">Upload product sales reports and connect menu items to recipes to estimate ingredient usage.</p>
        </div>
        {recipe?.notes ? <div className="rounded-2xl border border-border bg-slate-50 p-3 type-body-sm text-text-secondary">{recipe.notes}</div> : null}
      </div>
    </Modal>
  );
}

function PurchaseSuggestionsModal({ suggestions, suppliers, outlet, existingOrders = [], onClose, onCreateDraftPo, onViewPurchaseOrder }) {
  const [rows, setRows] = useState(suggestions.map((row) => ({
    ...row,
    include: true,
    selectedSupplierId: row.supplierChoices[0]?.id || "",
    suggestedOrderQty: row.shortageQty,
    remark: "",
  })));
  const includedRows = rows.filter((row) => row.include && Number(row.suggestedOrderQty || 0) > 0);
  const validRows = includedRows.filter((row) => row.selectedSupplierId);
  const groupedRows = includedRows.reduce((groups, row) => {
    const key = row.selectedSupplierId || "unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
    return groups;
  }, new Map());
  const hasExistingOrders = existingOrders.length > 0;

  function updateRow(id, patch) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  return (
    <Modal
      title="Purchase Suggestions"
      description="Review shortage items before creating Draft POs. Stock checks suggest ordering; they do not auto-submit purchase orders."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          {hasExistingOrders ? (
            <button className="btn-primary" type="button" onClick={() => onViewPurchaseOrder(existingOrders[0])}>
              View Purchase Order
            </button>
          ) : suggestions.length ? (
            <button className="btn-primary" type="button" disabled={!validRows.length || validRows.length !== includedRows.length} onClick={() => onCreateDraftPo(validRows)}>
              Create Draft PO
            </button>
          ) : null}
        </>
      )}
    >
      <div className="space-y-4">
        {hasExistingOrders ? (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
            <div className="type-title font-bold text-text-primary">Draft PO already created</div>
            <div className="mt-1 type-body-sm text-text-secondary">This stock check already has linked purchase orders. Create Draft PO is disabled to prevent duplicates.</div>
            <div className="mt-3 space-y-2">
              {existingOrders.map((order) => {
                const supplier = suppliers.find((entry) => entry.id === order.supplierId);
                return (
                  <button
                    key={order.id}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2 text-left transition hover:border-primary/30 hover:bg-white"
                    type="button"
                    onClick={() => onViewPurchaseOrder(order)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate type-body-sm font-bold text-text-primary">{order.poNo}</span>
                      <span className="block type-caption text-text-secondary">{supplier?.name || "Supplier"} · {order.lines?.length || 0} item{order.lines?.length === 1 ? "" : "s"}</span>
                    </span>
                    <Badge tone={statusTone(order.status)}>{poStatusLabel(order.status)}</Badge>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {!hasExistingOrders && !suggestions.length ? (
          <EmptyState title="No purchase suggestions found" description="This completed stock check has no shortage items that require Draft PO creation." />
        ) : null}
        {!hasExistingOrders && suggestions.length ? <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Shortage Items" value={suggestions.length} helper={outlet?.name || "Selected outlet"} tone="warning" />
          <MetricCard label="Supplier Groups" value={groupedRows.size} helper="Based on selected suppliers" tone="info" />
          <MetricCard label="Ready for Draft PO" value={validRows.length} helper="Included items with supplier" tone={validRows.length === includedRows.length ? "success" : "warning"} />
        </div> : null}
        {!hasExistingOrders ? [...groupedRows.entries()].map(([supplierId, groupRows]) => {
          const supplier = suppliers.find((entry) => entry.id === supplierId);
          return (
            <div key={supplierId} className="rounded-2xl border border-border bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="type-title font-bold text-text-primary">{supplier?.name || "Unassigned Supplier"}</div>
                  <div className="type-caption text-text-secondary">{outlet?.name || "Outlet"} · {groupRows.length} item{groupRows.length === 1 ? "" : "s"}</div>
                </div>
                <Badge tone={supplier ? "info" : "warning"}>{supplier ? "Suggested PO" : "Supplier required"}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2">Include</th>
                      <th>Item</th>
                      <th>Par</th>
                      <th>Actual</th>
                      <th>Shortage</th>
                      <th>Order Qty</th>
                      <th>Supplier</th>
                      <th>Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {groupRows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2">
                          <input type="checkbox" checked={row.include} onChange={(event) => updateRow(row.id, { include: event.target.checked })} />
                        </td>
                        <td>
                          <div className="font-bold text-text-primary">{row.itemName}</div>
                          <div className="type-caption text-text-secondary">{row.categoryName} · {row.unit}</div>
                        </td>
                        <td>{row.parLevel}</td>
                        <td>{row.actualCount}</td>
                        <td className="font-bold text-amber-700">{row.shortageQty}</td>
                        <td>
                          <input className="control h-8 w-24 text-[13px]" type="number" min="0" value={row.suggestedOrderQty ?? ""} placeholder="Qty" onFocus={selectInputText} onChange={(event) => updateRow(row.id, { suggestedOrderQty: parseNonNegativeNumber(event.target.value) })} />
                        </td>
                        <td>
                          <SelectField
                            value={row.selectedSupplierId}
                            placeholder="Choose supplier"
                            options={[{ value: "", label: "Choose supplier" }, ...row.supplierChoices.map((supplier) => ({ value: supplier.id, label: supplier.name }))]}
                            onChange={(value) => updateRow(row.id, { selectedSupplierId: value })}
                            searchable
                          />
                        </td>
                        <td>
                          <input className="control h-8 min-w-44 text-[13px]" value={row.remark} onChange={(event) => updateRow(row.id, { remark: event.target.value })} placeholder="Optional" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }) : null}
        {!hasExistingOrders && includedRows.length !== validRows.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm font-semibold text-amber-800">
            Choose a supplier for unassigned items before creating Draft POs.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function PurchaseOrderEditModal({ order, suppliers, items, onClose, onSave }) {
  const [form, setForm] = useState({
    ...order,
    lines: (order.lines || []).map((line) => ({ ...line })),
  });
  const updateLine = (index, patch) => setForm((current) => ({
    ...current,
    lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
  }));
  const availableItems = items.filter((item) => item.status === "active" && item.linkedOutletIds?.includes(form.outletId || form.outletIds?.[0]));

  return (
    <Modal
      title="Edit Draft PO"
      description="Draft purchase orders can be adjusted before submission."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={form.status !== "draft" || !form.lines.length} onClick={() => onSave(form)}>Save Draft PO</button>
        </>
      )}
    >
      <div className="space-y-4">
        {form.status !== "draft" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm font-semibold text-amber-800">
            This PO has already been submitted. Create an adjustment or cancel if needed.
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Supplier" value={form.supplierId} options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} onChange={(value) => setForm((current) => ({ ...current, supplierId: value }))} searchable disabled={form.status !== "draft"} />
        </div>
        <div className="space-y-2">
          {form.lines.map((line, index) => {
            const item = items.find((entry) => entry.id === line.itemId);
            return (
              <div key={line.id || `${line.itemId}-${index}`} className="grid gap-2 rounded-2xl border border-border p-3 md:grid-cols-[1.4fr_120px_1fr_auto] md:items-end">
                <SelectField label="Item" value={line.itemId} options={availableItems.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(value) => {
                  const nextItem = items.find((entry) => entry.id === value);
                  updateLine(index, { itemId: value, unit: nextItem?.unit || line.unit });
                }} searchable disabled={form.status !== "draft"} />
                <Field label="Order Qty" type="number" value={line.requestedQty} placeholder="Enter quantity" onChange={(value) => updateLine(index, { requestedQty: parseNonNegativeNumber(value) })} />
                <Field label="Remark" value={line.remark || ""} onChange={(value) => updateLine(index, { remark: value })} />
                <button className="btn-secondary h-9 px-2.5 text-xs" type="button" disabled={form.status !== "draft"} onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}>Remove</button>
                <div className="type-caption text-text-secondary md:col-span-4">Unit: <span className="font-bold text-text-primary">{line.unit || item?.unit || "-"}</span></div>
              </div>
            );
          })}
        </div>
        <button className="btn-secondary" type="button" disabled={form.status !== "draft"} onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, { id: makeId("po_item"), itemId: availableItems[0]?.id || "", requestedQty: 1, receivedQty: 0, unit: availableItems[0]?.unit || "", remark: "" }] }))}>Add Item</button>
      </div>
    </Modal>
  );
}

function ReceiveInventoryModal({ order, supplier, outlet, items, onClose, onReceive }) {
  const [remark, setRemark] = useState("");
  const [rows, setRows] = useState((order.lines || []).map((line) => ({ ...line, receiveNowQty: "", receiveRemark: "" })));
  const receiveGridRef = useRef(null);
  const receivable = rows.filter((row) => remainingQty(row) > 0);
  const hasValidQty = rows.some((row) => Number(row.receiveNowQty || 0) > 0);
  const invalid = rows.some((row) => Number(row.receiveNowQty || 0) < 0 || Number(row.receiveNowQty || 0) > remainingQty(row));
  const totalOrdered = orderedQty({ lines: rows });
  const totalReceivingNow = rows.reduce((sum, row) => sum + Number(row.receiveNowQty || 0), 0);
  const totalRemainingBeforeReceive = rows.reduce((sum, row) => sum + remainingQty(row), 0);
  const receivingStatus = totalReceivingNow > 0 && totalReceivingNow >= totalRemainingBeforeReceive ? "Full Receive" : "Partial Receive";
  const updateRow = (id, patch) => setRows((current) => current.map((row) => (row.id || row.itemId) === id ? { ...row, ...patch } : row));
  const fillRemaining = () => setRows((current) => current.map((row) => ({ ...row, receiveNowQty: remainingQty(row) > 0 ? remainingQty(row) : "" })));

  function handleReceiveKeyDown(event, rowIndex) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    focusIndexedInput(receiveGridRef, rowIndex, event.shiftKey ? "previous" : "next");
  }

  return (
    <Modal
      title="Receive Inventory"
      description={`${order.poNo} · ${supplier?.name || "Supplier"} · ${outlet?.name || "Outlet"} · ${poStatusLabel(order.status)}`}
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!hasValidQty || invalid || ["cancelled", "completed"].includes(order.status)} onClick={() => onReceive(rows, remark)}>Confirm Receive</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/15 bg-primary/5 p-3">
          <div>
            <div className="type-body-sm font-black text-text-primary">Receiving entry</div>
            <div className="type-caption text-text-secondary">Fill quantities from delivery order or invoice. Attachments can be added in a future receiving step.</div>
          </div>
          <button className="btn-secondary h-8 px-3 text-xs" type="button" disabled={!receivable.length} onClick={fillRemaining}>Fill Remaining</button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border" ref={receiveGridRef}>
          <table className="w-full min-w-[860px] text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th>Ordered</th>
                <th>Previously Received</th>
                <th>Remaining</th>
                <th>Receive Now</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Unit</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[13px]">
              {rows.map((row, rowIndex) => {
                const item = items.find((entry) => entry.id === row.itemId);
                const remaining = remainingQty(row);
                const receiveNow = Number(row.receiveNowQty || 0);
                const balance = Math.max(0, remaining - receiveNow);
                const rowStatus = receiveNow > 0 && balance === 0 ? "Full Receive" : receiveNow > 0 ? "Partial Receive" : "Pending";
                return (
                  <tr key={row.id || row.itemId}>
                    <td className="px-3 py-2 font-bold text-text-primary">{item?.name || "Inventory item"}</td>
                    <td>{row.requestedQty}</td>
                    <td>{row.receivedQty || 0}</td>
                    <td>{remaining}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <input
                          className="[appearance:textfield] control h-8 w-24 text-[13px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={remaining}
                          disabled={remaining <= 0}
                          value={row.receiveNowQty ?? ""}
                          placeholder="Qty"
                          data-entry-index={rowIndex}
                          onFocus={selectInputText}
                          onKeyDown={(event) => handleReceiveKeyDown(event, rowIndex)}
                          onChange={(event) => updateRow(row.id || row.itemId, { receiveNowQty: parseNonNegativeNumber(event.target.value) })}
                        />
                        <button className="btn-secondary h-8 px-2 text-xs" type="button" disabled={remaining <= 0} onClick={() => updateRow(row.id || row.itemId, { receiveNowQty: remaining })}>Fill</button>
                      </div>
                    </td>
                    <td className={balance > 0 && receiveNow > 0 ? "font-bold text-amber-700" : "font-semibold text-text-secondary"}>{balance}</td>
                    <td><Badge tone={rowStatus === "Full Receive" ? "success" : rowStatus === "Partial Receive" ? "warning" : "neutral"}>{rowStatus}</Badge></td>
                    <td>{row.unit || item?.unit || ""}</td>
                    <td><input className="control h-8 min-w-40 text-[13px]" value={row.receiveRemark} onChange={(event) => updateRow(row.id || row.itemId, { receiveRemark: event.target.value })} placeholder="Optional" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!receivable.length ? <EmptyState title="No remaining quantity to receive." description="This PO has already been fully received." /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Total Ordered" value={totalOrdered} helper="Original PO quantity" size="compact" />
          <MetricCard label="Receiving Now" value={totalReceivingNow} helper="Quantity entered now" tone={totalReceivingNow ? "info" : "neutral"} size="compact" />
          <MetricCard label="Receiving Status" value={hasValidQty ? receivingStatus : "Not Started"} helper="Based on entered quantities" tone={receivingStatus === "Full Receive" && hasValidQty ? "success" : hasValidQty ? "warning" : "neutral"} size="compact" />
        </div>
        <TextArea label="Receipt Remark" value={remark} onChange={setRemark} />
      </div>
    </Modal>
  );
}

function CancelPurchaseOrderModal({ order, onClose, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Cancel Purchase Order"
      description={`${order.poNo} will be preserved for audit history.`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Keep PO</button>
          <button className="btn-danger" type="button" disabled={!reason.trim()} onClick={() => onCancel(reason)}>Cancel PO</button>
        </>
      )}
    >
      <TextArea label="Cancellation Reason" value={reason} onChange={setReason} required />
    </Modal>
  );
}

function CompletePurchaseOrderModal({ order, onClose, onComplete }) {
  const [reason, setReason] = useState("");
  const progress = poProgress(order);
  const remaining = Math.max(0, progress.ordered - progress.received);
  const isPartial = remaining > 0;
  const reasonRequired = isPartial;

  return (
    <Modal
      title="Complete Purchase Order?"
      description={isPartial ? "This PO has not been fully received." : "All ordered quantities have been received."}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={reasonRequired && !reason.trim()} onClick={() => onComplete(reason)}>
            Complete PO
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Ordered Qty" value={progress.ordered} helper="Original PO quantity" />
          <MetricCard label="Received Qty" value={progress.received} helper="Confirmed into inventory" tone={progress.received ? "success" : "neutral"} />
          <MetricCard label="Remaining Qty" value={remaining} helper={isPartial ? "Will be unfulfilled" : "None"} tone={isPartial ? "warning" : "success"} />
        </div>
        {isPartial ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm font-semibold text-amber-800">
            The remaining quantity will be marked as unfulfilled. This PO will be closed and no further receiving can be recorded.
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 type-body-sm font-semibold text-emerald-800">
            This PO will be closed as fully fulfilled.
          </div>
        )}
        <TextArea
          label={isPartial ? "Completion Reason" : "Completion Note"}
          value={reason}
          onChange={setReason}
          required={reasonRequired}
          placeholder={isPartial ? "Supplier cannot fulfill remaining quantity." : "Optional note"}
        />
      </div>
    </Modal>
  );
}

function CopyPoTextModal({ text, onClose, onCopy }) {
  return (
    <Modal
      title="Copy PO Text"
      description="Clipboard access was blocked. Copy the supplier message manually."
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-primary" type="button" onClick={() => onCopy(text)}><Copy size={15} /> Copy</button>
        </>
      )}
    >
      <textarea
        className="control min-h-[360px] w-full whitespace-pre-wrap font-mono text-[12px]"
        readOnly
        value={text}
        onFocus={(event) => event.target.select()}
      />
    </Modal>
  );
}

function InventoryControlPage({ store, auth, ui, initialTab = "dashboard" }) {
  const initialStockCheckDate = useMemo(getInitialStockCheckDate, []);
  const outlets = useMemo(() => (store?.outlets ?? []).map(normalizeOutletRecord), [store?.outlets]);
  const suppliers = useMemo(() => store?.suppliers ?? [], [store?.suppliers]);
  const [data, setData, inventoryMeta, refreshInventory] = useInventoryData(outlets, suppliers);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [masterGroupBy, setMasterGroupBy] = useState("category");
  const [groupStatusFilter, setGroupStatusFilter] = useState("all");
  const [groupFrequencyFilter, setGroupFrequencyFilter] = useState("all");
  const [groupSearch, setGroupSearch] = useState("");
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState(() => new Set());
  const [parLevelView, setParLevelView] = useState("outlet");
  const [parLevelGroupBy, setParLevelGroupBy] = useState("category");
  const [collapsedParCategoryIds, setCollapsedParCategoryIds] = useState(() => new Set());
  const [parLevelOutletId, setParLevelOutletId] = useState(outlets[0]?.id ?? "");
  const [parLevelSaveState, setParLevelSaveState] = useState("saved");
  const [uomWriteStatus, setUomWriteStatus] = useState("Not written");
  const [poFilters, setPoFilters] = useState({ outletId: "all", supplierId: "all", status: "all", source: "all", search: "", from: "", to: "" });
  const [movementFilters, setMovementFilters] = useState({ outletId: "all", movementType: "all", search: "", from: "", to: "" });
  const [wasteFilters, setWasteFilters] = useState({ wasteType: "all", from: "", to: "", search: "" });
  const [recipeFilters, setRecipeFilters] = useState({ category: "all", status: "active", search: "" });
  const [recipeAnalysisPeriod, setRecipeAnalysisPeriod] = useState("last3");
  const [recipeProductReports, setRecipeProductReports] = useState([]);
  const [recipeProductItems, setRecipeProductItems] = useState([]);
  const [recipeProductMappings, setRecipeProductMappings] = useState([]);
  const [recipeProductLoading, setRecipeProductLoading] = useState(false);
  const [recipeMappingSelections, setRecipeMappingSelections] = useState({});
  const [ignoredRecipeProductKeys, setIgnoredRecipeProductKeys] = useState(() => new Set());
  const [savingRecipeMappingKey, setSavingRecipeMappingKey] = useState("");
  const [date, setDateState] = useState(initialStockCheckDate.date);
  const [selectedDateSource, setSelectedDateSource] = useState(initialStockCheckDate.source);
  const selectedDateSourceRef = useRef(initialStockCheckDate.source);
  const [stockCheckShiftFilter, setStockCheckShiftFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [editingCostItemId, setEditingCostItemId] = useState(null);
  const [editingCostValue, setEditingCostValue] = useState("");
  const [savingCostItemId, setSavingCostItemId] = useState(null);
  const skipCostBlurSaveRef = useRef(false);
  const parLevelGridRef = useRef(null);
  const parLevelMatrixRef = useRef(null);
  const [activeCheckGroupId, setActiveCheckGroupId] = useState(null);
  const [activeScheduledCheckId, setActiveScheduledCheckId] = useState(null);
  const [activeAuditCheck, setActiveAuditCheck] = useState(null);
  const [checkRows, setCheckRows] = useState([]);
  const [checkValidationAttempted, setCheckValidationAttempted] = useState(false);
  const [checkSearch, setCheckSearch] = useState("");
  const [collapsedCheckCategoryIds, setCollapsedCheckCategoryIds] = useState(() => new Set());
  const [photoPreview, setPhotoPreview] = useState(null);
  const stockCheckResponsiveLayout = useStockCheckResponsiveLayout();
  const useStockCheckCardLayout = stockCheckResponsiveLayout !== "desktop";
  const recipeOutletOptions = useMemo(() => getAccessibleOutletOptions(auth, outlets).filter((option) => option.value !== "all"), [auth, outlets]);
  const activeRecipeOutletId = selectedOutletId === "all" ? (recipeOutletOptions[0]?.value || "") : selectedOutletId;

  const setDate = useCallback((value, source = "manual") => {
    setDateState(normalizeBusinessDate(value));
    selectedDateSourceRef.current = source;
    setSelectedDateSource(source);
  }, []);

  useEffect(() => {
    debugLog("[BusinessDateDebug]", {
      browserDate: toDateInputValue(new Date()),
      utcDate: new Date().toISOString().slice(0, 10),
      businessDate: getBusinessDateInput("Asia/Kuala_Lumpur"),
      selectedDate: date,
      selectedDateSource,
    });
  }, [date, selectedDateSource]);

  useEffect(() => {
    if (activeTab !== "recipes" || !activeRecipeOutletId) return undefined;
    let cancelled = false;
    const selectedPeriod = recipeAnalysisPeriodOptions.find((option) => option.value === recipeAnalysisPeriod) || recipeAnalysisPeriodOptions[1];
    const startSerial = businessMonthSerial(-(selectedPeriod.months - 1));
    const endSerial = businessMonthSerial(0);
    setRecipeProductLoading(true);
    Promise.all([
      productAnalyticsService.listReports({ outletIds: [activeRecipeOutletId] }),
      supabase
        .from("product_recipe_mappings")
        .select("*")
        .eq("outlet_id", activeRecipeOutletId),
    ])
      .then(async ([reports, mappingsResult]) => {
        if (mappingsResult.error) throw mappingsResult.error;
        const periodReports = reports.filter((report) => {
          const serial = monthSerial(report.report_year, report.report_month);
          return serial >= startSerial && serial <= endSerial;
        });
        const items = await productAnalyticsService.listItemsByReportIds(periodReports.map((report) => report.id));
        if (!cancelled) {
          setRecipeProductReports(periodReports);
          setRecipeProductItems(items);
          setRecipeProductMappings(mappingsResult.data || []);
        }
      })
      .catch((error) => {
        console.warn("[InventoryControl] Unable to load Product Analytics for Recipe Intelligence.", error);
        if (!cancelled) {
          setRecipeProductReports([]);
          setRecipeProductItems([]);
          setRecipeProductMappings([]);
        }
      })
      .finally(() => {
        if (!cancelled) setRecipeProductLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRecipeOutletId, activeTab, recipeAnalysisPeriod]);

  useEffect(() => {
    setRecipeMappingSelections({});
    setIgnoredRecipeProductKeys(new Set());
  }, [activeRecipeOutletId, recipeAnalysisPeriod]);

  useEffect(() => {
    setCheckValidationAttempted(false);
  }, [activeCheckGroupId, activeScheduledCheckId, activeAuditCheck?.id]);

  useEffect(() => {
    function applyUrlStockCheckDate() {
      const urlDate = stockCheckDateFromUrl();
      if (!urlDate) {
        if (selectedDateSourceRef.current === "url") {
          selectedDateSourceRef.current = "business-today";
          setDateState(getBusinessDateInput("Asia/Kuala_Lumpur"));
          setSelectedDateSource("business-today");
        }
        return;
      }
      selectedDateSourceRef.current = "url";
      setDateState(urlDate);
      setSelectedDateSource("url");
    }
    applyUrlStockCheckDate();
    window.addEventListener("hashchange", applyUrlStockCheckDate);
    window.addEventListener("popstate", applyUrlStockCheckDate);
    return () => {
      window.removeEventListener("hashchange", applyUrlStockCheckDate);
      window.removeEventListener("popstate", applyUrlStockCheckDate);
    };
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!parLevelOutletId && outlets[0]?.id) setParLevelOutletId(outlets[0].id);
  }, [outlets, parLevelOutletId]);

  useEffect(() => {
    if (!["groups", "waste", "recipes"].includes(activeTab)) return;
    if (!outlets.length) return;
    if (activeTab === "waste" || activeTab === "recipes") {
      const firstAccessibleOutlet = getAccessibleOutlets(auth, outlets)[0]?.id || outlets[0]?.id || "";
      if (selectedOutletId === "all" && firstAccessibleOutlet) {
        setSelectedOutletId(firstAccessibleOutlet);
        return;
      }
      if (selectedOutletId !== "all" && !outlets.some((outlet) => outlet.id === selectedOutletId) && firstAccessibleOutlet) {
        setSelectedOutletId(firstAccessibleOutlet);
        return;
      }
    }
    if (selectedOutletId !== "all" && !outlets.some((outlet) => outlet.id === selectedOutletId)) {
      setSelectedOutletId("all");
    }
  }, [activeTab, auth, outlets, selectedOutletId]);

  const can = useMemo(() => ({
    importMaster: hasPermission(auth, "inventory_master.import"),
    exportMaster: hasPermission(auth, "inventory_master.export"),
    createMaster: hasPermission(auth, "inventory_master.create"),
    editMaster: hasPermission(auth, "inventory_master.edit"),
    deleteMaster: hasPermission(auth, "inventory_master.delete"),
    export: hasPermission(auth, "inventory_master.export") || hasPermission(auth, "inventory_par_levels.export") || hasPermission(auth, "inventory_stock_check.export") || hasPermission(auth, "inventory_orders.export") || hasPermission(auth, "inventory_movements.export") || hasPermission(auth, "inventory_waste.export") || hasPermission(auth, "inventory_recipes.export"),
    manageMaster: hasPermission(auth, "inventory_master.create") || hasPermission(auth, "inventory_master.edit"),
    editParLevels: hasPermission(auth, "inventory_par_levels.edit"),
    exportParLevels: hasPermission(auth, "inventory_par_levels.export"),
    viewCategories: hasPermission(auth, "inventory_categories.view") || hasPermission(auth, "inventory_master.view"),
    createCategory: hasPermission(auth, "inventory_categories.create"),
    editCategory: hasPermission(auth, "inventory_categories.edit"),
    deleteCategory: hasPermission(auth, "inventory_categories.delete"),
    viewUoms: hasPermission(auth, "inventory_uoms.view") || hasPermission(auth, "inventory_master.view"),
    createUom: hasPermission(auth, "inventory_uoms.create"),
    editUom: hasPermission(auth, "inventory_uoms.edit"),
    deleteUom: hasPermission(auth, "inventory_uoms.delete"),
    manageGroups: hasPermission(auth, "inventory_groups.create") || hasPermission(auth, "inventory_groups.edit"),
    createCheck: hasPermission(auth, "inventory_stock_check.create") || hasPermission(auth, "inventory_stock_check.audit"),
    editCheck: hasPermission(auth, "inventory_stock_check.edit"),
    reviewCheck: hasPermission(auth, "inventory_stock_check.review"),
    viewPo: hasPermission(auth, "inventory_orders.view"),
    generatePo: hasPermission(auth, "inventory_orders.create"),
    editPo: hasPermission(auth, "inventory_orders.edit"),
    submitPo: hasPermission(auth, "inventory_orders.submit"),
    receivePo: hasPermission(auth, "inventory_orders.receive"),
    completePo: hasPermission(auth, "inventory_orders.complete"),
    cancelPo: hasPermission(auth, "inventory_orders.cancel"),
    exportPo: hasPermission(auth, "inventory_orders.export"),
    managePo: hasPermission(auth, "inventory_orders.edit") || hasPermission(auth, "inventory_orders.submit") || hasPermission(auth, "inventory_orders.receive") || hasPermission(auth, "inventory_orders.complete") || hasPermission(auth, "inventory_orders.cancel"),
    recordMovement: hasPermission(auth, "inventory_movements.create"),
    recordWaste: hasPermission(auth, "inventory_waste.create") || hasPermission(auth, "inventory_waste.manage"),
    viewWaste: hasPermission(auth, "inventory_waste.view"),
    viewInsights: hasPermission(auth, "inventory_dashboard.view"),
    viewRecipes: hasPermission(auth, "inventory_recipes.view"),
    manageRecipes: hasPermission(auth, "inventory_recipes.manage"),
    exportRecipes: hasPermission(auth, "inventory_recipes.export"),
  }), [auth]);

  const sortedCategories = useMemo(() => [...data.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name)), [data.categories]);
  const sortedActiveCategories = useMemo(() => sortedCategories.filter((category) => String(category.status || "active").toLowerCase() === "active"), [sortedCategories]);
  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const sortedUoms = useMemo(() => [...(data.uoms || [])].map(normalizeUom).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.code.localeCompare(b.code)), [data.uoms]);
  const sortedActiveUoms = useMemo(() => sortedUoms.filter((uom) => uom.isActive), [sortedUoms]);
  const itemCountByCategory = useMemo(() => {
    const counts = new Map();
    data.items.forEach((item) => counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1));
    return counts;
  }, [data.items]);
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);
  const peopleById = useMemo(() => new Map((data.people || []).map((person) => [person.id, person])), [data.people]);
  const peopleByAuthId = useMemo(() => new Map((data.people || []).filter((person) => person.authUserId).map((person) => [person.authUserId, person])), [data.people]);
  const accessibleOutletIds = useMemo(() => getAccessibleOutlets(auth, outlets).map((outlet) => outlet.id), [auth, outlets]);
  const canSeeAllMasterItems = selectedOutletId === "all" && hasAllOutletAccess(auth);
  const currentCheckerName = employeeDisplayName(auth?.profile || { email: auth?.user?.email, name: auth?.user?.email });
  const actorNameByEmployeeId = (employeeId) => {
    if (!employeeId) return "Unknown User";
    if (employeeId === auth?.profile?.id) return currentCheckerName;
    return peopleById.get(employeeId)?.name || "Unknown User";
  };
  const actorNameByAuthUserId = (authUserId) => {
    if (!authUserId) return "Unknown User";
    if (authUserId === auth?.user?.id) return currentCheckerName;
    return peopleByAuthId.get(authUserId)?.name || "Unknown User";
  };
  const actorNameByAnyId = (id) => {
    if (!id) return "Unknown User";
    if (id === auth?.profile?.id || id === auth?.user?.id) return currentCheckerName;
    const person = peopleById.get(id) || peopleByAuthId.get(id);
    return person?.name || person?.email || "Unknown User";
  };

  const visibleItems = useMemo(() => data.items.filter((item) => {
    const linkedOutletIds = item.linkedOutletIds || [];
    const matchesOutlet = selectedOutletId === "all"
      ? (canSeeAllMasterItems || linkedOutletIds.some((outletId) => accessibleOutletIds.includes(outletId)))
      : linkedOutletIds.includes(selectedOutletId);
    const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
    const itemCategory = categoryForItem(item, categoryById);
    const selectedCategory = categoryById.get(categoryFilter);
    const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter || item.category_id === categoryFilter || (selectedCategory && canonical(itemCategory?.name) === canonical(selectedCategory.name));
    const itemStatus = String(item.status || "").toLowerCase();
    const selectedStatus = String(statusFilter || "all").toLowerCase();
    const matchesStatus = selectedStatus === "all" || itemStatus === selectedStatus;
    return matchesOutlet && matchesQuery && matchesCategory && matchesStatus;
  }), [data.items, selectedOutletId, canSeeAllMasterItems, accessibleOutletIds, query, categoryFilter, categoryById, statusFilter]);
  useEffect(() => {
    if (activeTab !== "master") return;
    debugLog("[InventoryFilterDebug]", {
      outletFilter: selectedOutletId,
      categoryFilter,
      statusFilter,
      searchTerm: query,
      beforeFilterCount: data.items.length,
      afterFilterCount: visibleItems.length,
      visibleNames: visibleItems.map((item) => item.name),
    });
    debugLog("[InventoryMissingAnalysis]", {
      allInventoryItemsCount: inventoryMeta.rawItemsCount || data.items.length,
      allInventoryItemNames: data.items.map((item) => item.name),
      afterStatusFilterCount: data.items.filter((item) => String(item.status || "").toLowerCase() === "active").length,
      afterStatusFilterNames: data.items.filter((item) => String(item.status || "").toLowerCase() === "active").map((item) => item.name),
      afterJoinMappingCount: inventoryMeta.normalizedItemsCount || data.items.length,
      afterJoinMappingNames: data.items.map((item) => item.name),
      finalVisibleCount: visibleItems.length,
      finalVisibleNames: visibleItems.map((item) => item.name),
    });
  }, [activeTab, categoryFilter, data.items, inventoryMeta.normalizedItemsCount, inventoryMeta.rawItemsCount, query, selectedOutletId, statusFilter, visibleItems]);
  const visibleItemGroups = useMemo(() => {
    const groups = new Map();
    visibleItems.forEach((item) => {
      const category = categoryForItem(item, categoryById);
      const key = item.categoryId || item.category_id || category?.id || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
    });
    return [...groups.values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
  }, [visibleItems, categoryById]);

  useEffect(() => {
    if (activeTab !== "master") return;
    const itemNames = visibleItems.map((item) => item.name);
    debugLog("[InventoryDesktopItems]", itemNames);
    debugLog("[InventoryMobileItems]", itemNames);
    debugLog("[SafariInventoryDebug]", {
      browser: navigator.userAgent,
      build: import.meta.env.VITE_APP_VERSION || import.meta.env.MODE,
      userEmail: auth?.user?.email || auth?.profile?.email || "",
      roleName: auth?.profile?.role_name || auth?.profile?.role?.name || "",
      outletAccessType: auth?.profile?.role_outlet_access_type || auth?.profile?.role?.outlet_access_type || "",
      selectedOutletFilter: selectedOutletId,
      selectedCategoryFilter: categoryFilter,
      selectedStatusFilter: statusFilter,
      groupBy: masterGroupBy,
      rawItemsCount: data.items.length,
      rawItemNames: data.items.map((item) => item.name),
      filteredItemsCount: visibleItems.length,
      filteredItemNames: itemNames,
      dataSource: inventoryMeta.dataSource,
      lastFetchedAt: inventoryMeta.lastFetchedAt,
    });
    debugTable(visibleItems.map((item) => ({
      name: item.name,
      category: categoryForItem(item, categoryById)?.name || item.category_name || "Uncategorized",
      uom: item.uom_code || item.unit,
      photo: Boolean(item.photo_url || item.photo),
      outlets: (item.linked_outlets?.length ? item.linked_outlets : (item.linkedOutletIds || []).map((id) => outletById.get(id)).filter(Boolean)).map(outletDisplayCode).join(","),
    })));
  }, [activeTab, auth, categoryById, categoryFilter, data.items, inventoryMeta, masterGroupBy, outletById, selectedOutletId, statusFilter, visibleItems]);

  const selectedOutletIds = selectedOutletId === "all" ? outlets.map((outlet) => outlet.id) : [selectedOutletId];
  const scopedGroups = data.groups.filter((group) => selectedOutletIds.includes(group.outletId) && (stockCheckShiftFilter === "all" || sameStockCheckShift(group.shift, stockCheckShiftFilter)));
  const dueGroups = scopedGroups.filter((group) => isActionableStockCheckStatus(dueStatus(group, data.checks, date, stockCheckShiftFilter)));
  const activeCheckGroup = activeAuditCheck || data.groups.find((group) => group.id === activeCheckGroupId);

  const dashboard = useMemo(() => {
    const scopedItems = data.items.filter((item) => selectedOutletId === "all" || item.linkedOutletIds?.includes(selectedOutletId));
    const lowStock = scopedItems.reduce((count, item) => {
      const configs = outletConfigsForScope(item, selectedOutletIds);
      return count + configs.filter((config) => Number(config.parLevel || 0) > 0 && latestActualCount(data.checks, item.id, config.outletId) < Number(config.parLevel || 0)).length;
    }, 0);
    const criticalChecks = dueGroups.filter((group) => dueStatus(group, data.checks, date, stockCheckShiftFilter) === "Missed").length;
    const completion = dueGroups.length ? Math.round((dueGroups.filter((group) => dueStatus(group, data.checks, date, stockCheckShiftFilter) === "Completed").length / dueGroups.length) * 100) : 100;
    return {
      inventoryValue: scopedItems.reduce((sum, item) => sum + outletConfigsForScope(item, selectedOutletIds).reduce((configSum, config) => configSum + Number(config.parLevel || 0) * 8, 0), 0),
      lowStock,
      pendingOrders: data.orders.filter((order) => selectedOutletIds.includes(order.outletId || order.outletIds?.[0]) && !["completed", "cancelled"].includes(order.status)).length,
      varianceRisk: criticalChecks,
      checkCompletion: completion,
    };
  }, [data.items, data.orders, data.checks, dueGroups, selectedOutletId, selectedOutletIds, date, stockCheckShiftFilter]);

  useEffect(() => {
    if (!activeCheckGroup) return;
    const draft = activeScheduledCheckId
      ? data.checks.find((check) => check.id === activeScheduledCheckId)
      : activeCheckGroup.existingCheckId
        ? data.checks.find((check) => check.id === activeCheckGroup.existingCheckId)
        : draftCheckForGroupRun(activeCheckGroup, data.checks, activeCheckGroup.date || date, stockCheckShiftFilter);
    if (draft?.rows?.length) {
      setCheckRows(draft.rows.map((row) => ({ itemId: row.itemId, actualCount: row.actualCount, status: row.status ?? "normal", notes: row.notes ?? "", na: Boolean(row.na), skipped: Boolean(row.skipped), skipReason: row.skipReason ?? "" })));
      return;
    }
    const items = stockCheckItemsForGroup(activeCheckGroup, data.items);
    setCheckRows(items.map((item) => ({ itemId: item.id, actualCount: parLevelForOutlet(item, activeCheckGroup.outletId), status: "normal", notes: "", na: false, skipped: false, skipReason: "" })));
  }, [activeCheckGroupId, activeScheduledCheckId, activeAuditCheck, activeCheckGroup, data.checks, data.items, date, stockCheckShiftFilter]);

  function notify(title, message = "", tone = "success") {
    ui?.notify?.({ title, message, tone });
  }

  function requirePermission(allowed, action) {
    if (allowed) return true;
    notifyPermissionDenied(ui, action);
    return false;
  }

  async function saveItem(item) {
    const existingItem = data.items.find((entry) => entry.id === item.id);
    const hasNewPhotoFile = typeof File !== "undefined" && item.photoFile instanceof File;
    const incomingPhoto = item.photo ?? item.photo_url ?? "";
    const isLocalPreview = isImageDataUrl(incomingPhoto);
    const isCreate = !isUuid(item.id);
    let uploadedPhotoUrl = "";
    let photoDebug = {
      itemId: isCreate ? null : item.id,
      hasNewPhotoFile,
      previewUrl: isLocalPreview ? incomingPhoto.slice(0, 80) : incomingPhoto,
      uploadBucket: "inventory-item-photos",
      uploadPath: "",
      uploadError: null,
      publicUrl: "",
      dbPayloadPhotoUrl: "",
      savedRowPhotoUrl: "",
    };
    if (hasNewPhotoFile) {
      try {
        const uploadResult = await uploadInventoryItemPhoto(item.photoFile, isCreate ? "draft" : item.id);
        uploadedPhotoUrl = uploadResult.publicUrl;
        photoDebug = {
          ...photoDebug,
          uploadBucket: uploadResult.bucket,
          uploadPath: uploadResult.path,
          publicUrl: uploadResult.publicUrl,
        };
      } catch (uploadError) {
        photoDebug = { ...photoDebug, uploadError };
        debugLog("[InventoryPhotoSaveDebug]", photoDebug);
        notify("Photo upload failed. Item was not updated.", uploadError.message || "Please check the inventory-item-photos bucket and try again.", "error");
        return;
      }
    }
    const photoUploadFailed = item.photoUploadFailed === true || (isLocalPreview && !hasNewPhotoFile);
    const safePhoto = uploadedPhotoUrl || (photoUploadFailed ? (existingItem?.photo || existingItem?.photo_url || "") : incomingPhoto);
    const normalizedItem = normalizeInventoryItem({ ...item, photo: safePhoto, photo_url: safePhoto, costUpdatedBy: auth?.profile?.id || "" });
    const photoChanged = !photoUploadFailed && (existingItem?.photo || existingItem?.photo_url || "") !== (normalizedItem.photo || normalizedItem.photo_url || "");
    const linkedOutletsChanged = !sameIdSet(existingItem?.linkedOutletIds || [], normalizedItem.linkedOutletIds || []);
    const existingOutletIdsForDebug = uniqueIds(existingItem?.linkedOutletIds || []);
    const selectedOutletIdsForDebug = uniqueIds(normalizedItem.linkedOutletIds || []);
    debugLog("[InventoryOutletSaveDebug]", {
      itemId: normalizedItem.id || null,
      existingOutletIds: existingOutletIdsForDebug,
      selectedOutletIds: selectedOutletIdsForDebug,
      outletsToAdd: selectedOutletIdsForDebug.filter((outletId) => !existingOutletIdsForDebug.includes(outletId)),
      outletsToRemove: existingOutletIdsForDebug.filter((outletId) => !selectedOutletIdsForDebug.includes(outletId)),
    });
    const nameChanged = !isCreate && Boolean(existingItem) && existingItem.name !== normalizedItem.name;
    const skuChanged = !isCreate && Boolean(existingItem) && (existingItem.sku || "") !== (normalizedItem.sku || "");
    const categoryChanged = !isCreate && Boolean(existingItem) && (existingItem.categoryId || "") !== (normalizedItem.categoryId || "");
    const uomChanged = !isCreate && Boolean(existingItem) && (existingItem.unit || "") !== (normalizedItem.unit || "");
    const statusChanged = !isCreate && Boolean(existingItem) && (existingItem.status || "active") !== (normalizedItem.status || "active");
    const descriptionChanged = !isCreate && Boolean(existingItem) && (existingItem.description || "") !== (normalizedItem.description || "");
    const costChanged = isCreate ? normalizedItem.cost !== "" : Boolean(existingItem) && Number(existingItem.cost ?? 0) !== Number(normalizedItem.cost ?? 0);
    const changeFlags = {
      nameChanged,
      skuChanged,
      categoryChanged,
      uomChanged,
      statusChanged,
      photoChanged,
      descriptionChanged,
      costChanged,
      linkedOutletsChanged,
    };
    const changeCount = Object.values(changeFlags).filter(Boolean).length;
    try {
      const remoteItem = await persistRemoteInventoryItem({ ...normalizedItem, costMetadataChanged: isCreate || costChanged }, auth?.user?.id, accessibleOutletIds);
      photoDebug = {
        ...photoDebug,
        itemId: remoteItem.id,
        dbPayloadPhotoUrl: normalizedItem.photo || normalizedItem.photo_url || "",
        savedRowPhotoUrl: remoteItem.photo || remoteItem.photo_url || "",
      };
      debugLog("[InventoryPhotoSaveDebug]", photoDebug);
      debugLog("[InventoryItemSaveDebug]", {
        itemId: remoteItem.id,
        payload: {
          name: normalizedItem.name,
          sku: normalizedItem.sku,
          categoryId: normalizedItem.categoryId,
          unit: normalizedItem.unit,
          cost: normalizedItem.cost,
          status: normalizedItem.status,
          photo_url: normalizedItem.photo || normalizedItem.photo_url || null,
        },
        selectedUom: normalizedItem.unit,
        savedUnit: remoteItem.unit || remoteItem.uom_code,
        photoUrl: remoteItem.photo || remoteItem.photo_url,
        linkedOutletIds: remoteItem.linkedOutletIds || [],
      });
      setData((current) => ({
        ...current,
        items: current.items.some((entry) => entry.id === normalizedItem.id || entry.id === remoteItem.id)
          ? current.items.map((entry) => (entry.id === normalizedItem.id || entry.id === remoteItem.id ? remoteItem : entry))
          : [remoteItem, ...current.items],
      }));
      const refreshedInventory = await refreshInventory();
      if (hasNewPhotoFile) {
        const refetchedItem = (refreshedInventory?.items || []).find((entry) => entry.id === remoteItem.id);
        const refetchedPhotoUrl = refetchedItem?.photo || refetchedItem?.photo_url || "";
        debugLog("[InventoryPhotoSaveDebug]", { ...photoDebug, refetchedPhotoUrl });
        if (!refetchedPhotoUrl || refetchedPhotoUrl !== (normalizedItem.photo || normalizedItem.photo_url || "")) {
          notify("Photo uploaded, but item update failed.", "The item list did not return the saved photo URL after refetch.", "error");
          return;
        }
      }
      setModal(null);
      if (photoUploadFailed) {
        notify("Item saved, but photo upload failed", "The item details were saved. Please try uploading the photo again.", "warning");
      } else if (isCreate) {
        notify("Inventory item created", remoteItem.name);
      } else if (changeCount === 1 && linkedOutletsChanged) {
        notify("Linked outlets updated", remoteItem.name);
      } else if (changeCount === 1 && photoChanged) {
        notify("Inventory photo updated", remoteItem.name);
      } else if (changeCount === 1 && uomChanged) {
        notify("Inventory UOM updated", remoteItem.name);
      } else if (changeCount === 1 && categoryChanged) {
        notify("Inventory category updated", remoteItem.name);
      } else if (changeCount === 1 && statusChanged) {
        notify("Inventory status updated", remoteItem.name);
      } else if (changeCount === 1 && descriptionChanged) {
        notify("Inventory item details updated", remoteItem.name);
      } else if (changeCount === 1 && costChanged) {
        notify("Inventory cost updated", remoteItem.name);
      } else {
        notify("Inventory item updated", changeCount > 1 ? `${remoteItem.name} · ${changeCount} changes saved` : remoteItem.name);
      }
    } catch (error) {
      console.warn("[InventoryControl] Unable to save inventory item to Supabase.", error);
      if (hasNewPhotoFile) {
        debugLog("[InventoryPhotoSaveDebug]", { ...photoDebug, dbPayloadPhotoUrl: normalizedItem.photo || normalizedItem.photo_url || "", uploadError: null, dbError: error });
        notify("Photo uploaded, but item update failed.", error.message || "Please try again.", "error");
        return;
      }
      if (error?.debug) {
        debugLog("[InventorySaveDebug]", error.debug);
        debugLog("[InventoryItemSaveDebug]", error.debug);
      }
      await refreshInventory();
      if (error?.partialItemSaved) {
        notify("Linked outlet update failed", error.cause?.message || error.message || "Please check outlet access and try again.", "warning");
      } else {
        notify(isCreate ? "Failed to create Inventory Item" : "Failed to update Inventory Item", error.message || "Please try again.", "error");
      }
    }
  }

  function beginInlineCostEdit(item) {
    if (!requirePermission(can.editMaster, "edit inventory item cost")) return;
    skipCostBlurSaveRef.current = false;
    setEditingCostItemId(item.id);
    setEditingCostValue(item.cost === "" || item.cost === null || item.cost === undefined ? "" : String(item.cost));
  }

  function cancelInlineCostEdit() {
    skipCostBlurSaveRef.current = true;
    setEditingCostItemId(null);
    setEditingCostValue("");
  }

  async function saveInlineCost(item) {
    if (!requirePermission(can.editMaster, "edit inventory item cost")) return;
    const parsedCost = parseInventoryCostInput(editingCostValue);
    if (parsedCost === null) {
      notify("Failed to update inventory cost", "Cost must be a non-negative number with up to 4 decimals.", "error");
      return;
    }
    setSavingCostItemId(item.id);
    const payload = {
      cost: parsedCost === "" ? null : parsedCost,
      cost_updated_at: new Date().toISOString(),
      cost_updated_by: isUuid(auth?.profile?.id) ? auth.profile.id : null,
    };
    try {
      const result = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", item.id)
        .select("*")
        .single();
      debugLog("[InventoryCostSaveDebug]", { itemId: item.id, payload, result: { data: result.data, error: result.error }, error: result.error });
      if (result.error) throw result.error;
      await refreshInventory();
      cancelInlineCostEdit();
      notify("Inventory cost updated", item.name);
    } catch (error) {
      console.warn("[InventoryControl] Unable to update inventory cost.", error);
      debugLog("[InventoryCostSaveDebug]", { itemId: item.id, payload, result: null, error });
      notify("Failed to update inventory cost", error.message || "Please try again.", "error");
    } finally {
      setSavingCostItemId(null);
    }
  }

  async function saveCategory(category) {
    const shouldReturnToSettings = modal?.returnToSettings;
    const normalized = {
      ...category,
      name: String(category.name || "").trim(),
      description: String(category.description || "").trim(),
      sortOrder: Number(category.sortOrder ?? category.sort_order ?? 0)
        || (data.categories.length ? Math.max(...data.categories.map((entry) => Number(entry.sortOrder || 0))) + 1 : 1),
      status: category.status || "active",
    };
    try {
      const savedCategory = await persistRemoteInventoryCategory(normalized);
      debugLog("[CategoryActionDebug]", {
        action: isUuid(category.id) ? "edit" : "create",
        categoryId: savedCategory.id,
        categoryName: savedCategory.name,
        linkedItemCount: itemCountByCategory.get(savedCategory.id) || 0,
        supabaseResult: savedCategory,
        error: null,
      });
      setData((current) => ({
        ...current,
        categories: current.categories.some((entry) => entry.id === savedCategory.id)
          ? current.categories.map((entry) => entry.id === savedCategory.id ? savedCategory : entry)
          : [...current.categories, savedCategory],
      }));
      await refreshInventory();
      setModal(shouldReturnToSettings ? { type: "category-settings" } : null);
      notify("Inventory category saved");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save inventory category.", error);
      debugLog("[CategoryActionDebug]", {
        action: isUuid(category.id) ? "edit" : "create",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: null,
        error,
      });
      notify("Unable to save category", error.message || "Please try again.", "error");
    }
  }

  async function saveUom(uom) {
    const normalized = normalizeUom({
      ...uom,
      code: String(uom.code || "").trim(),
      displayName: String(uom.displayName || "").trim(),
      uomType: String(uom.uomType || "").trim(),
      updatedAt: new Date().toISOString(),
      createdAt: uom.createdAt || new Date().toISOString(),
    });
    const shouldReturnToSettings = modal?.returnToSettings;
    try {
      setUomWriteStatus("Saving");
      const savedUom = await persistRemoteInventoryUom(normalized);
      setData((current) => ({
        ...current,
        uoms: current.uoms?.some((entry) => entry.id === savedUom.id)
          ? current.uoms.map((entry) => entry.id === savedUom.id ? savedUom : entry)
          : [...(current.uoms || []), savedUom],
      }));
      await refreshInventory();
      setUomWriteStatus(`Saved ${savedUom.code}`);
      setModal(shouldReturnToSettings ? { type: "uom-settings" } : null);
      notify("Inventory UOM saved", savedUom.code);
      return savedUom;
    } catch (error) {
      console.warn("[InventoryControl] Unable to save UOM.", error);
      debugLog("[UomSaveDebug]", { action: isUuid(normalized.id) ? "update" : "create", payload: normalized, result: null, error });
      setUomWriteStatus(`Failed: ${error.message || "Unable to save"}`);
      notify("Unable to save UOM", error.message || "Please try again.", "error");
      return null;
    }
  }

  async function saveQuickUom(uom) {
    const normalized = normalizeUom({
      ...uom,
      code: String(uom.code || "").trim(),
      displayName: String(uom.displayName || "").trim(),
      uomType: String(uom.uomType || "").trim(),
      updatedAt: new Date().toISOString(),
      createdAt: uom.createdAt || new Date().toISOString(),
    });
    try {
      setUomWriteStatus("Saving");
      const savedUom = await persistRemoteInventoryUom(normalized);
      setData((current) => ({
        ...current,
        uoms: current.uoms?.some((entry) => entry.id === savedUom.id)
          ? current.uoms.map((entry) => entry.id === savedUom.id ? savedUom : entry)
          : [...(current.uoms || []), savedUom],
      }));
      await refreshInventory();
      setUomWriteStatus(`Saved ${savedUom.code}`);
      notify("Inventory UOM saved", savedUom.code);
      return savedUom;
    } catch (error) {
      console.warn("[InventoryControl] Unable to save quick UOM.", error);
      debugLog("[UomSaveDebug]", { action: "create", payload: normalized, result: null, error });
      setUomWriteStatus(`Failed: ${error.message || "Unable to save"}`);
      notify("Unable to save UOM", error.message || "Please try again.", "error");
      return null;
    }
  }

  async function sortCategories(draggedId, targetId) {
    let sortedCategories = [];
    setData((current) => {
      const ordered = [...current.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name));
      const fromIndex = ordered.findIndex((category) => category.id === draggedId);
      const toIndex = ordered.findIndex((category) => category.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(toIndex, 0, moved);
      const sorted = ordered.map((category, index) => ({ ...category, sortOrder: index + 1 }));
      sortedCategories = sorted;
      const byId = new Map(sorted.map((category) => [category.id, category]));
      return {
        ...current,
        categories: current.categories.map((category) => byId.get(category.id) || category),
      };
    });
    try {
      const results = await Promise.all(sortedCategories
        .filter((category) => isUuid(category.id))
        .map((category) => supabase
          .from("inventory_categories")
          .update({ sort_order: category.sortOrder, updated_at: new Date().toISOString() })
          .eq("id", category.id)
        ));
      const sortError = results.find((result) => result.error)?.error;
      if (sortError) throw sortError;
      await refreshInventory();
      notify("Category order updated");
    } catch (error) {
      console.warn("[InventoryControl] Unable to persist category order.", error);
      notify("Unable to update category order", error.message || "Please try again.", "error");
      await refreshInventory();
    }
  }

  async function archiveCategory(category) {
    try {
      const savedCategory = await persistRemoteInventoryCategory({ ...category, status: "inactive" });
      debugLog("[CategoryActionDebug]", {
        action: "archive",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: savedCategory,
        error: null,
      });
      setData((current) => ({
        ...current,
        categories: current.categories.map((entry) => entry.id === category.id ? savedCategory : entry),
      }));
      await refreshInventory();
      notify("Inventory category archived");
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive inventory category.", error);
      debugLog("[CategoryActionDebug]", {
        action: "archive",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: null,
        error,
      });
      notify("Unable to archive category", error.message || "Please try again.", "error");
    }
  }

  async function deleteCategory(category) {
    try {
      const linkedItemCount = await countRemoteInventoryItemsForCategory(category.id);
      if (linkedItemCount > 0) {
        debugLog("[CategoryActionDebug]", {
          action: "delete",
          categoryId: category.id,
          categoryName: category.name,
          linkedItemCount,
          supabaseResult: "blocked",
          error: null,
        });
        notify("Cannot delete this category", `Cannot delete this category because it is used by ${linkedItemCount} inventory item${linkedItemCount === 1 ? "" : "s"}. Archive it or reassign items first.`, "warning");
        return;
      }
      const { error } = await supabase
        .from("inventory_categories")
        .delete()
        .eq("id", category.id);
      if (error) throw error;
      debugLog("[CategoryActionDebug]", {
        action: "delete",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount,
        supabaseResult: "deleted",
        error: null,
      });
      setData((current) => ({
        ...current,
        categories: current.categories.filter((entry) => entry.id !== category.id),
      }));
      await refreshInventory();
      notify("Inventory category deleted");
    } catch (error) {
      console.warn("[InventoryControl] Unable to delete inventory category.", error);
      debugLog("[CategoryActionDebug]", {
        action: "delete",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: null,
        error,
      });
      notify("Unable to delete category", error.message || "Please try again.", "error");
    }
  }

  async function archiveUom(uom) {
    const action = uom.isActive ? "archive" : "activate";
    try {
      setUomWriteStatus(action === "archive" ? "Archiving" : "Activating");
      const savedUom = await persistRemoteInventoryUom({ ...uom, isActive: !uom.isActive });
      setData((current) => ({
        ...current,
        uoms: (current.uoms || []).map((entry) => entry.id === savedUom.id ? savedUom : entry),
      }));
      await refreshInventory();
      setUomWriteStatus(`${action === "archive" ? "Archived" : "Activated"} ${savedUom.code}`);
      notify(uom.isActive ? "Inventory UOM archived" : "Inventory UOM activated", savedUom.code);
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive UOM.", error);
      debugLog("[UomSaveDebug]", { action, payload: uom, result: null, error });
      setUomWriteStatus(`Failed: ${error.message || "Unable to update"}`);
      notify("Unable to update UOM", error.message || "Please try again.", "error");
    }
  }

  async function deleteUom(uom) {
    try {
      setUomWriteStatus("Deleting");
      const linkedItemCount = await countRemoteInventoryItemsForUom(uom.code);
      if (linkedItemCount > 0) {
        debugLog("[UomSaveDebug]", { action: "delete", payload: uom, result: "blocked", linkedItemCount, error: null });
        setUomWriteStatus(`Blocked: ${uom.code} is used`);
        notify("Cannot delete this UOM", `Cannot delete this UOM because it is used by ${linkedItemCount} inventory item${linkedItemCount === 1 ? "" : "s"}. Archive it instead.`, "warning");
        return;
      }
      const result = await supabase
        .from("inventory_uoms")
        .delete()
        .eq("id", uom.id);
      debugLog("[UomSaveDebug]", { action: "delete", payload: uom, result: { data: result.data || null, error: result.error }, error: result.error });
      if (result.error) throw result.error;
      setData((current) => ({ ...current, uoms: (current.uoms || []).filter((entry) => entry.id !== uom.id) }));
      await refreshInventory();
      setUomWriteStatus(`Deleted ${uom.code}`);
      notify("Inventory UOM deleted", uom.code);
    } catch (error) {
      console.warn("[InventoryControl] Unable to delete UOM.", error);
      debugLog("[UomSaveDebug]", { action: "delete", payload: uom, result: null, error });
      setUomWriteStatus(`Failed: ${error.message || "Unable to delete"}`);
      notify("Unable to delete UOM", error.message || "Please try again.", "error");
    }
  }

  async function importInventoryRows(previewRows) {
    const validRows = previewRows.filter((row) => !row.errors.length);
    const invalidRows = previewRows.filter((row) => row.errors.length);
    let created = 0;
    let updated = 0;
    const failures = [];

    for (const row of validRows) {
      const incoming = row.item;
      const existing = data.items.find((item) => (
        incoming.sku ? canonical(item.sku) === canonical(incoming.sku) : canonical(item.name) === canonical(incoming.name)
      )) || null;
      const linkedOutletIds = uniqueIds(incoming.linkedOutletIds || []);
      const existingConfigs = new Map((existing?.outletConfigs || []).map((config) => [config.outletId, config]));
      const remoteItem = normalizeInventoryItem({
        ...(existing || {}),
        ...incoming,
        id: existing?.id || incoming.id || "",
        photo: existing?.photo || existing?.photo_url || incoming.photo || "",
        photo_url: existing?.photo_url || existing?.photo || incoming.photo || "",
        costUpdatedBy: auth?.profile?.id || "",
        costMetadataChanged: incoming.cost !== "" && incoming.cost !== null && incoming.cost !== undefined,
        linkedOutletIds,
        outletConfigs: linkedOutletIds.map((outletId) => buildOutletConfig(existing || incoming, outletId, existingConfigs.get(outletId))),
      });

      try {
        const result = await persistRemoteInventoryItem(remoteItem, auth?.user?.id, accessibleOutletIds);
        debugLog("[InventoryImportDebug]", {
          rowNumber: row.rowNumber,
          action: row.action,
          item: remoteItem.name,
          linkedOutletIds,
          result,
          error: null,
        });
        if (row.action === "update" || existing) updated += 1;
        else created += 1;
      } catch (error) {
        console.warn("[InventoryControl] Unable to import inventory row.", error);
        debugLog("[InventoryImportDebug]", {
          rowNumber: row.rowNumber,
          action: row.action,
          item: remoteItem.name,
          linkedOutletIds,
          result: null,
          error,
        });
        failures.push({ rowNumber: row.rowNumber, message: error?.cause?.message || error?.message || "Remote save failed" });
      }
    }

    await refreshInventory();
    const result = {
      created,
      updated,
      skipped: invalidRows.length,
      failed: failures.length,
      failures,
    };
    if (failures.length) {
      notify("Import completed", `${created} created · ${updated} updated · ${invalidRows.length} skipped · ${failures.length} failed.`, "warning");
    } else {
      notify("Import completed", `${created} created · ${updated} updated · ${invalidRows.length} skipped.`);
    }
    return result;
  }

  function exportMasterInventory() {
    const rows = visibleItems.map((item) => {
      const category = categoryForItem(item, categoryById);
      const linkedOutlets = (item.linkedOutletIds || []).map((id) => {
        const outlet = outletById.get(id);
        return outlet ? outletDisplayCode(outlet) : "";
      }).filter(Boolean).join(", ");
      return {
        "Item Name": item.name,
        "SKU Code": item.sku_code || item.sku,
        Category: category?.name || "",
        UOM: item.uom_code || item.unit,
        Cost: item.cost === "" || item.cost === null || item.cost === undefined ? "" : item.cost,
        Description: item.description,
        Status: item.status,
        "Linked Outlet Codes": linkedOutlets,
        "Created At": item.createdAt || "",
        "Updated At": item.updatedAt || "",
      };
    });
    const columns = ["Item Name", "SKU Code", "Category", "UOM", "Cost", "Description", "Status", "Linked Outlet Codes", "Created At", "Updated At"];
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
        const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter || item.category_id === categoryFilter;
        return matchesQuery && matchesCategory;
      })
      .forEach((item) => {
        const category = categoryForItem(item, categoryById);
        scopedOutlets.forEach((outlet) => {
          if (!item.linkedOutletIds?.includes(outlet.id)) return;
          const config = outletConfigForItem(item, outlet.id);
          rows.push({
            "Item Name": item.name,
            "SKU Code": item.sku_code || item.sku,
            Category: category?.name || "",
            Unit: item.uom_code || item.unit,
            Outlet: outlet.name,
            "Par Level": config.parLevel,
            "Storage Location": config.storageLocation,
            Suppliers: supplierNamesForConfig(config),
          });
        });
      });
    const columns = ["Item Name", "SKU Code", "Category", "UOM", "Outlet", "Par Level", "Storage Location", "Suppliers"];
    rows.forEach((row) => { row.UOM = row.Unit; delete row.Unit; });
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-par-levels-${todayInput()}.csv`, csv);
    notify("Par levels exported successfully", `${rows.length} outlet item config${rows.length === 1 ? "" : "s"} exported.`);
  }

  function exportPurchaseOrders() {
    const rows = data.orders.filter((order) => {
      const outletId = order.outletId || order.outletIds?.[0] || "";
      const supplier = suppliers.find((entry) => entry.id === order.supplierId);
      const createdDate = (order.createdAt || order.submittedAt || "").slice(0, 10);
      const searchText = [order.poNo, supplier?.name, ...(order.lines || []).map((line) => itemById.get(line.itemId)?.name)].join(" ").toLowerCase();
      return (poFilters.outletId === "all" || outletId === poFilters.outletId)
        && (poFilters.supplierId === "all" || order.supplierId === poFilters.supplierId)
        && (poFilters.status === "all" || order.status === poFilters.status)
        && (poFilters.source === "all" || (order.sourceType || "manual") === poFilters.source)
        && (!poFilters.search.trim() || searchText.includes(poFilters.search.trim().toLowerCase()))
        && (!poFilters.from || !createdDate || createdDate >= poFilters.from)
        && (!poFilters.to || !createdDate || createdDate <= poFilters.to);
    }).map((order) => {
      const progress = poProgress(order);
      return {
        "PO No.": order.poNo,
        Supplier: suppliers.find((supplier) => supplier.id === order.supplierId)?.name || "",
        Outlet: outletById.get(order.outletId || order.outletIds?.[0])?.name || "",
        Items: order.lines.length,
        "Ordered Qty": progress.ordered,
        "Received Qty": progress.received,
        "Remaining Qty": Math.max(0, progress.ordered - progress.received),
        Status: poStatusLabel(order.status),
        Source: poSourceLabel(order.sourceType),
        "Created Date": order.createdAt || "",
        "Submitted Date": order.submittedAt || "",
        "Completed Date": order.completedAt || "",
        "Completion Type": order.completionType ? toTitle(order.completionType) : "",
        "Completion Reason": order.completionReason || "",
        "Cancelled Reason": order.cancellationReason || "",
      };
    });
    const columns = ["PO No.", "Supplier", "Outlet", "Items", "Ordered Qty", "Received Qty", "Remaining Qty", "Status", "Source", "Created Date", "Submitted Date", "Completed Date", "Completion Type", "Completion Reason", "Cancelled Reason"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-purchase-orders-${todayInput()}.csv`, csv);
    notify("Purchase orders exported", `${rows.length} PO${rows.length === 1 ? "" : "s"} exported.`);
  }

  function formatPurchaseOrderText(order) {
    const supplier = suppliers.find((entry) => entry.id === order.supplierId);
    const outlet = outletById.get(order.outletId || order.outletIds?.[0]);
    const supplierName = supplier?.name || "Supplier";
    const statusLine = ["cancelled", "completed"].includes(order.status) ? [`Status: ${poStatusLabel(order.status)}`] : [];
    const itemLines = (order.lines || []).map((line, index) => {
      const item = itemById.get(line.itemId);
      const base = `${index + 1}. ${item?.name || "Inventory item"} — ${Number(line.requestedQty || 0)} ${line.unit || item?.unit || ""}`.trim();
      return line.remark ? `${base}\n   Remark: ${line.remark}` : base;
    });
    const remarks = order.remark || order.notes || "";
    return [
      `Hi ${supplierName},`,
      "",
      "Please arrange the following order:",
      "",
      `PO No.: ${order.poNo || "-"}`,
      `Date: ${formatDate(order.createdAt || todayInput())}`,
      `Outlet: ${outlet?.name || "Outlet"}`,
      ...statusLine,
      "",
      "Items:",
      ...(itemLines.length ? itemLines : ["1. No items listed"]),
      ...(remarks ? ["", "Remarks:", remarks] : []),
      "",
      "Please confirm stock availability and delivery date.",
      "",
      "Thank you.",
    ].join("\n");
  }

  async function copyPurchaseOrderText(order) {
    if (!requirePermission(can.viewPo, "view purchase orders")) return;
    const text = formatPurchaseOrderText(order);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      notify("PO text copied.");
    } catch {
      setModal({ type: "po-copy-text", text });
    }
  }

  async function copyRawText(text) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setModal(null);
      notify("PO text copied.");
    } catch {
      notify("Unable to copy automatically", "Select and copy the text manually.", "warning");
    }
  }

  async function saveParLevelConfig(itemId, outletId, patch) {
    const item = data.items.find((entry) => entry.id === itemId);
    if (!item) {
      notify("Unable to save Par Level", "Inventory item was not found.", "error");
      return;
    }
    setParLevelSaveState("saving");
    try {
      const savedConfig = await persistRemoteParLevelConfig(item, outletId, patch);
      setData((current) => ({
        ...current,
        items: current.items.map((entry) => {
          if (entry.id !== itemId) return entry;
          const normalized = normalizeInventoryItem(entry);
          const linkedOutletIds = uniqueIds(normalized.linkedOutletIds);
          const existing = new Map((normalized.outletConfigs || []).map((config) => [config.outletId, config]));
          existing.set(outletId, savedConfig);
          const outletConfigs = linkedOutletIds.map((id) => buildOutletConfig({ ...normalized, linkedOutletIds }, id, existing.get(id)));
          return normalizeInventoryItem({ ...normalized, linkedOutletIds, outletConfigs });
        }),
      }));
      setParLevelSaveState("saved");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save Par Level config.", error);
      debugLog("[ParLevelSaveDebug]", { action: "save", itemId, outletId, payload: patch, result: null, error });
      setParLevelSaveState("error");
      notify("Unable to save Par Level", error.message || "Please try again.", "error");
    }
  }

  async function saveGroup(group) {
    const normalizedGroup = {
      ...group,
      categoryIds: groupCategoryIds(group, data.items),
      frequency: frequencies.includes(group.frequency) ? group.frequency : "custom",
      itemIds: [],
    };
    try {
      const savedGroup = await persistRemoteStockCheckGroup(normalizedGroup);
      setData((current) => ({
        ...current,
        groups: current.groups.some((entry) => entry.id === normalizedGroup.id || entry.id === savedGroup.id)
          ? current.groups.map((entry) => (entry.id === normalizedGroup.id || entry.id === savedGroup.id ? savedGroup : entry))
          : [savedGroup, ...current.groups],
      }));
      await refreshInventory();
      setModal(null);
      notify("Stock check group saved");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save stock check group.", error);
      debugLog("[StockCheckGroupSaveDebug]", { action: isUuid(group.id) ? "edit" : "create", payload: normalizedGroup, result: null, error });
      notify("Unable to save stock check group", error.message || "Please try again.", "error");
    }
  }

  function openCreateGroup() {
    if (!requirePermission(can.manageGroups, "create stock check groups")) return;
    if (selectedOutletId === "all") {
      notify("Select an outlet first", "Select an outlet before creating a stock check group.", "warning");
      return;
    }
    setModal({ type: "group", outletId: selectedOutletId });
  }

  function openRecordWaste() {
    if (!requirePermission(can.recordWaste, "record waste")) return;
    const wasteOutletId = selectedOutletId === "all" ? getAccessibleOutlets(auth, outlets)[0]?.id : selectedOutletId;
    if (!wasteOutletId) {
      notify("Select an outlet first", "Select an outlet before recording waste.", "warning");
      return;
    }
    if (selectedOutletId === "all") setSelectedOutletId(wasteOutletId);
    setModal({ type: "waste", outletId: wasteOutletId });
  }

  async function archiveGroup(groupId) {
    if (!requirePermission(can.manageGroups, "archive stock check groups")) return;
    try {
      const savedGroup = await archiveRemoteStockCheckGroup(groupId);
      setData((current) => ({
        ...current,
        groups: current.groups.map((group) => group.id === groupId ? savedGroup : group),
      }));
      await refreshInventory();
      notify("Stock check group archived");
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive stock check group.", error);
      debugLog("[StockCheckGroupSaveDebug]", { action: "archive", groupId, result: null, error });
      notify("Unable to archive stock check group", error.message || "Please try again.", "error");
    }
  }

  function buildStockCheckRowsForGroup(group, sourceRows = checkRows) {
    return sourceRows.map((row) => {
      const item = itemById.get(row.itemId);
      const expectedQty = parLevelForOutlet(item, group.outletId);
      const skipped = Boolean(row.skipped);
      const actualMissing = row.actualCount === "" || row.actualCount === null || row.actualCount === undefined;
      const variance = skipped || row.na || actualMissing ? 0 : Number(expectedQty || 0) - Number(row.actualCount || 0);
      return {
        ...row,
        itemId: row.itemId,
        categoryId: row.categoryId || item?.categoryId || "",
        skipped,
        status: skipped ? "skipped" : row.na ? "na" : row.status ?? "normal",
        id: row.id || makeId("check_item"),
        expectedQty,
        variance,
        unit: item?.unit || "",
      };
    });
  }

  function initialStockCheckRowsForGroup(group) {
    return stockCheckItemsForGroup(group, data.items).map((item) => ({
      itemId: item.id,
      categoryId: item.categoryId,
      actualCount: parLevelForOutlet(item, group.outletId),
      status: "normal",
      notes: "",
      na: false,
      skipped: false,
      skipReason: "",
    }));
  }

  async function startScheduledStockCheck(group) {
    const status = dueStatus(group, data.checks, date, stockCheckShiftFilter);
    if (status === "Missed") {
      notify("Stock check missed", "This stock check was not completed on schedule.", "warning");
      return;
    }
    if (!canStartScheduledStockCheckForDate(group, date) && status !== "Draft") {
      notify("Stock check locked", "Scheduled stock checks can only be started on their assigned date.", "warning");
      return;
    }
    const existingDraft = draftCheckForGroupRun(group, data.checks, date, stockCheckShiftFilter);
    if (existingDraft) {
      setActiveAuditCheck(null);
      setActiveScheduledCheckId(existingDraft.id);
      setActiveCheckGroupId(group.id);
      return;
    }
    try {
      const initialRows = initialStockCheckRowsForGroup({ ...group, date });
      const savedCheck = await persistRemoteStockCheck({ ...group, date, existingCheckId: "" }, buildStockCheckRowsForGroup({ ...group, date }, initialRows), "draft", auth?.user?.id, auth?.profile?.id);
      setData((current) => ({ ...current, checks: [savedCheck, ...current.checks.filter((check) => check.id !== savedCheck.id)] }));
      await refreshInventory();
      setActiveAuditCheck(null);
      setActiveScheduledCheckId(savedCheck.id);
      setActiveCheckGroupId(group.id);
    } catch (error) {
      console.warn("[InventoryControl] Unable to start scheduled stock check.", error);
      debugLog("[StockCheckSaveDebug]", { action: "start-scheduled", groupId: group.id, error });
      notify("Unable to start stock check", error.message || "Please try again.", "error");
    }
  }

  async function startAuditStockCheck(form) {
    const auditGroup = {
      id: makeId("audit_group"),
      outletId: form.outletId,
      name: form.auditName.trim(),
      description: form.notes || "",
      categoryIds: form.categoryIds,
      itemIds: [],
      frequency: "audit",
      checkDays: [],
      monthDay: "",
      shift: "Audit",
      status: "active",
      stockCheckType: "audit",
      auditType: form.auditType,
      auditName: form.auditName.trim(),
      date: form.date,
      notes: form.notes,
    };
    try {
      const initialRows = initialStockCheckRowsForGroup(auditGroup);
      const savedCheck = await persistRemoteStockCheck(auditGroup, buildStockCheckRowsForGroup(auditGroup, initialRows), "draft", auth?.user?.id, auth?.profile?.id);
      setData((current) => ({ ...current, checks: [savedCheck, ...current.checks.filter((check) => check.id !== savedCheck.id)] }));
      await refreshInventory();
      setSelectedOutletId(form.outletId);
      setDate(form.date);
      setActiveCheckGroupId(null);
      setActiveScheduledCheckId(null);
      setActiveAuditCheck({ ...auditGroup, id: savedCheck.id, existingCheckId: savedCheck.id });
      setModal(null);
    } catch (error) {
      console.warn("[InventoryControl] Unable to start audit stock check.", error);
      debugLog("[AuditStockCheckDebug]", { action: "start-audit", form, error });
      notify("Unable to start audit stock check", error.message || "Please try again.", "error");
    }
  }

  function continueAuditStockCheck(check) {
    setSelectedOutletId(check.outletId);
    setDate(check.date || todayInput());
    setActiveCheckGroupId(null);
    setActiveScheduledCheckId(null);
    setActiveAuditCheck({
      id: check.id,
      existingCheckId: check.id,
      outletId: check.outletId,
      name: check.auditName || "Audit Stock Check",
      description: check.notes || "",
      categoryIds: check.categoryIds || check.auditCategoryIds || uniqueIds((check.rows || []).map((row) => itemById.get(row.itemId)?.categoryId).filter(Boolean)),
      itemIds: [],
      frequency: "audit",
      checkDays: [],
      monthDay: "",
      shift: "Audit",
      status: "active",
      stockCheckType: "audit",
      auditType: check.auditType || "Custom Audit",
      auditName: check.auditName || "Audit Stock Check",
      date: check.date || todayInput(),
      notes: check.notes || "",
    });
  }

  async function deleteAuditDraft(check) {
    if (!check || check.status !== "draft") {
      notify("Failed to delete audit draft", "Only draft audit stock checks can be deleted.", "error");
      return;
    }
    const confirmed = await ui.confirm({
      title: "Delete Audit Draft?",
      message: "This action cannot be undone.",
      danger: true,
      confirmLabel: "Delete Draft",
    });
    if (!confirmed) return;
    try {
      await deleteRemoteStockCheckDraft(check.id);
      setData((current) => ({ ...current, checks: current.checks.filter((entry) => entry.id !== check.id) }));
      if (activeAuditCheck?.existingCheckId === check.id || activeAuditCheck?.id === check.id) {
        setActiveAuditCheck(null);
      }
      await refreshInventory();
      notify("Audit draft deleted");
    } catch (error) {
      console.warn("[InventoryControl] Unable to delete audit draft.", error);
      debugLog("[AuditStockCheckDebug]", { action: "delete-draft", checkId: check?.id, error });
      notify("Failed to delete audit draft", error.message || "Please try again.", "error");
    }
  }

  function skipCheckRow(rowIndex, reason) {
    setCheckRows((current) => current.map((entry, index) => index === rowIndex ? {
      ...entry,
      skipped: true,
      skipReason: reason,
      status: "skipped",
      na: true,
    } : entry));
    setModal(null);
  }

  function unskipCheckRow(rowIndex) {
    setCheckRows((current) => current.map((entry, index) => index === rowIndex ? {
      ...entry,
      skipped: false,
      skipReason: "",
      status: "normal",
      na: false,
    } : entry));
  }

  function stockCheckValidationIssues(rows = checkRows, isAudit = false) {
    return rows
      .map((row, rowIndex) => {
        const countMissing = row.actualCount === "" || row.actualCount === null || row.actualCount === undefined;
        const negative = Number(row.actualCount || 0) < 0;
        const item = itemById.get(row.itemId);
        if (row.skipped) {
          if (!row.skipReason?.trim()) {
            return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: "Skip reason required", action: "Add a skip reason" };
          }
          return null;
        }
        if (countMissing) return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: "Count not entered", action: "Complete count or click Skip" };
        if (negative) return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: "Count cannot be negative", action: "Enter a non-negative count" };
        return null;
      })
      .filter(Boolean);
  }

  function revealFirstInvalidStockCheckRow(issue) {
    if (!issue) return;
    const item = itemById.get(issue.itemId);
    if (checkSearch.trim()) setCheckSearch("");
    if (item?.categoryId) {
      setCollapsedCheckCategoryIds((current) => {
        if (!current.has(item.categoryId)) return current;
        const next = new Set(current);
        next.delete(item.categoryId);
        return next;
      });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelector(`[data-check-row-index="${issue.rowIndex}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  async function archiveItem(itemId) {
    const item = data.items.find((entry) => entry.id === itemId);
    if (!isUuid(itemId)) {
      notify("Failed to archive Inventory Item", "This item has not been saved to Supabase yet.", "error");
      return;
    }
    try {
      const result = await supabase
        .from("inventory_items")
        .update({ status: "inactive", updated_by: auth?.user?.id || null, updated_at: new Date().toISOString() })
        .eq("id", itemId)
        .select("*")
        .single();
      debugLog("[InventorySaveDebug]", { mode: "archive", payload: { itemId }, itemUpdateResult: { data: result.data, error: result.error }, error: result.error });
      if (result.error) throw result.error;
      setData((current) => ({
        ...current,
        items: current.items.map((item) => item.id === itemId ? { ...item, status: "inactive", updatedAt: result.data?.updated_at || new Date().toISOString() } : item),
      }));
      await refreshInventory();
      notify("Inventory item archived", item?.name || result.data?.item_name || result.data?.name || "");
    } catch (error) {
      console.warn("[InventoryControl] Unable to sync archived inventory item.", error);
      debugLog("[InventorySaveDebug]", { mode: "archive", payload: { itemId }, itemUpdateResult: null, error });
      notify("Failed to archive Inventory Item", error.message || "Please try again.", "error");
    }
  }

  async function saveStockCheck(status) {
    if (!activeCheckGroup) return;
    const isAudit = activeCheckGroup.stockCheckType === "audit";
    if (status === "submitted") {
      const invalidRows = stockCheckValidationIssues(checkRows, isAudit);
      if (invalidRows.length) {
        setCheckValidationAttempted(true);
        revealFirstInvalidStockCheckRow(invalidRows[0]);
        return;
      }
    }
    const existingDraft = isAudit ? null : activeScheduledCheckId
      ? data.checks.find((check) => check.id === activeScheduledCheckId)
      : draftCheckForGroupRun(activeCheckGroup, data.checks, activeCheckGroup.date || date, stockCheckShiftFilter);
    const persistGroup = {
      ...activeCheckGroup,
      date: activeCheckGroup.date || date,
      existingCheckId: activeCheckGroup.existingCheckId || existingDraft?.id || activeScheduledCheckId || "",
    };
    const rows = buildStockCheckRowsForGroup(persistGroup);
    try {
      const savedCheck = await persistRemoteStockCheck(persistGroup, rows, status, auth?.user?.id, auth?.profile?.id);
      const refreshedInventory = status === "submitted" ? await refreshInventory() : null;
      if (status === "submitted") {
        debugLog("[SubmittedScheduledChecksDebug]");
        debugTable((refreshedInventory?.checks || [savedCheck])
          .filter((check) => check.stockCheckType === "scheduled" && ["submitted", "reviewed", "locked"].includes(check.status))
          .map((check) => ({
            id: check.id,
            group_id: check.groupId,
            outlet_id: check.outletId,
            check_date: check.date,
            shift: check.shift,
            status: check.status,
            check_type: check.stockCheckType,
            submitted_at: check.submittedAt,
          })));
      }
      setData((current) => ({
        ...current,
        ...(refreshedInventory ? {
          categories: refreshedInventory.categories,
          items: refreshedInventory.items,
          uoms: refreshedInventory.uoms,
          groups: refreshedInventory.groups,
          checks: refreshedInventory.checks,
          orders: refreshedInventory.orders,
          movements: refreshedInventory.movements,
          waste: refreshedInventory.waste,
          recipes: refreshedInventory.recipes,
          people: refreshedInventory.people,
        } : {}),
        checks: [
          savedCheck,
          ...(refreshedInventory?.checks || current.checks).filter((check) => check.id !== savedCheck.id && !(!isAudit && checkMatchesGroupRun(check, activeCheckGroup, activeCheckGroup.date || date, stockCheckShiftFilter) && check.status === "draft")),
        ],
        groups: isAudit ? (refreshedInventory?.groups || current.groups) : (refreshedInventory?.groups || current.groups).map((group) => group.id === activeCheckGroup.id && status !== "draft" ? { ...group, lastChecked: savedCheck.date, lastCheckedAt: savedCheck.submittedAt || new Date().toISOString() } : group),
      }));
      if (!refreshedInventory) await refreshInventory();
      setActiveCheckGroupId(null);
      setActiveScheduledCheckId(null);
      setActiveAuditCheck(null);
      setCheckValidationAttempted(false);
      if (status === "submitted") {
        notify(isAudit ? "Audit Stock Check submitted" : "Stock Check submitted", isAudit ? "Audit result saved without purchase suggestions." : "Review purchase suggestions from the completed check card if shortages exist.");
      } else {
        notify(isAudit ? "Audit Stock Check draft saved" : "Stock Check draft saved");
      }
    } catch (error) {
      console.warn("[InventoryControl] Unable to save stock check.", error);
      debugLog(isAudit ? "[AuditStockCheckDebug]" : status === "submitted" ? "[StockCheckSubmitDebug]" : "[StockCheckSaveDebug]", { action: status, activeCheckGroup, rows, error });
      notify(
        status === "submitted"
          ? (isAudit ? "Failed to submit Audit Stock Check" : "Failed to submit Stock Check")
          : (isAudit ? "Failed to save Audit Stock Check draft" : "Failed to save Stock Check draft"),
        error.message || "Please try again.",
        "error",
      );
    }
  }

  function buildPurchaseSuggestions(record) {
    if (!record || record.stockCheckType !== "scheduled" || record.status !== "submitted") return [];
    return (record.rows || [])
      .filter((row) => !row.skipped && !row.na && Number(row.actualCount || 0) < Number(row.expectedQty || 0))
      .map((row) => {
        const item = itemById.get(row.itemId);
        const config = outletConfigForItem(item, record.outletId);
        const shortageQty = Math.max(0, Number(row.expectedQty || 0) - Number(row.actualCount || 0));
        const supplierChoices = suppliers
          .filter((supplier) => (config.supplierIds || []).includes(supplier.id))
          .filter((supplier) => supplier.status === "active" || supplier.is_active === true)
          .filter((supplier) => (supplier.outletIds || supplier.assignedOutletIds || []).includes(record.outletId));
        return {
          id: row.id || makeId("suggest"),
          stockCheckId: record.id,
          stockCheckItemId: row.id,
          itemId: row.itemId,
          itemName: item?.name || "Inventory item",
          categoryName: categoryById.get(item?.categoryId)?.name || "Uncategorized",
          unit: item?.unit || row.unit || "",
          parLevel: row.expectedQty,
          actualCount: row.actualCount,
          shortageQty,
          supplierChoices,
        };
      });
  }

  function linkedPurchaseOrdersForStockCheck(stockCheckId) {
    if (!stockCheckId) return [];
    return data.orders.filter((order) => (
      (order.sourceType || "") === "stock_check"
      && order.sourceStockCheckId === stockCheckId
      && order.status !== "cancelled"
    ));
  }

  function latestCheckForGroup(group) {
    return [...data.checks]
      .filter((check) => checkMatchesGroupRun(check, group, date, stockCheckShiftFilter))
      .sort((a, b) => new Date(b.submittedAt || b.updatedAt || b.date || 0) - new Date(a.submittedAt || a.updatedAt || a.date || 0))[0] || null;
  }

  async function openPurchaseSuggestionsForCheck(check) {
    if (!check || check.stockCheckType !== "scheduled" || check.status !== "submitted") {
      setModal({ type: "check-result", stockCheck: check, suggestions: [], isAudit: check?.stockCheckType === "audit" });
      return;
    }
    const suggestions = buildPurchaseSuggestions(check);
    try {
      const existingOrders = await fetchRemotePurchaseOrdersForStockCheck(check.id);
      setData((current) => ({
        ...current,
        orders: [
          ...existingOrders,
          ...current.orders.filter((order) => !existingOrders.some((entry) => entry.id === order.id)),
        ],
      }));
      if (!suggestions.length && !existingOrders.length) {
        setModal({ type: "check-result", stockCheck: check, suggestions });
        return;
      }
      setModal({ type: "purchase-suggestions", stockCheck: check, suggestions, existingOrders });
    } catch (error) {
      console.warn("[InventoryControl] Unable to load purchase suggestions.", error);
      debugLog("[PurchaseSuggestionDebug]", { action: "open-suggestions", stockCheckId: check.id, error });
      notify("Unable to load purchase suggestions", error.message || "Please try again.", "error");
    }
  }

  async function createDraftPurchaseOrders(stockCheck, suggestionRows) {
    if (!requirePermission(can.generatePo, "create draft purchase orders")) return;
    try {
      const orders = await persistRemoteDraftPurchaseOrders(stockCheck, suggestionRows, auth?.user?.id);
      setData((current) => ({
        ...current,
        checks: current.checks.map((check) => check.id === stockCheck.id ? { ...check, generatedPoIds: orders.map((order) => order.id) } : check),
        orders: [
          ...orders,
          ...current.orders.filter((order) => !orders.some((entry) => entry.id === order.id)),
        ],
      }));
      await refreshInventory();
      setModal({ type: "purchase-suggestions", stockCheck, suggestions: buildPurchaseSuggestions(stockCheck), existingOrders: orders });
      notify("Draft PO created", `${orders.length} draft PO${orders.length === 1 ? "" : "s"} ready for review.`);
    } catch (error) {
      console.warn("[InventoryControl] Unable to create Draft PO.", error);
      debugLog("[CreateDraftPODebug]", { action: "create-draft-po", stockCheckId: stockCheck?.id, suggestionRows, error });
      const existingOrders = error?.existingOrders?.length ? error.existingOrders : linkedPurchaseOrdersForStockCheck(stockCheck?.id);
      if (existingOrders.length) {
        setModal({ type: "purchase-suggestions", stockCheck, suggestions: buildPurchaseSuggestions(stockCheck), existingOrders });
      }
      notify("Failed to create Draft PO", error.message || "Please try again.", "error");
    }
  }

  async function updatePurchaseOrderStatus(orderId, status) {
    try {
      const updatedOrder = await persistRemotePurchaseOrderStatus(orderId, status);
      setData((current) => ({
        ...current,
        orders: current.orders.map((order) => order.id === orderId ? updatedOrder : order),
      }));
      await refreshInventory();
      notify(status === "submitted" ? "PO submitted" : status === "supplier_confirmed" ? "PO supplier confirmed" : "PO status updated", poStatusLabel(status));
    } catch (error) {
      console.warn("[InventoryControl] Unable to update PO status.", error);
      debugLog("[POSubmitDebug]", { action: "update-status", orderId, status, error });
      notify(status === "submitted" ? "Failed to submit PO" : "Failed to update PO", error.message || "Please try again.", "error");
    }
  }

  async function savePurchaseOrder(order) {
    try {
      const updatedOrder = await persistRemotePurchaseOrderEdit(order);
      setData((current) => ({
        ...current,
        orders: current.orders.map((entry) => entry.id === order.id ? updatedOrder : entry),
      }));
      await refreshInventory();
      setModal(null);
      notify("Draft PO saved");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save Draft PO.", error);
      debugLog("[POSubmitDebug]", { action: "save-draft-po", orderId: order?.id, order, error });
      notify("Failed to update Draft PO", error.message || "Please try again.", "error");
    }
  }

  async function cancelPurchaseOrder(order, reason) {
    try {
      const updatedOrder = await persistRemotePurchaseOrderCancel(order, reason);
      setData((current) => ({
        ...current,
        orders: current.orders.map((entry) => entry.id === order.id ? updatedOrder : entry),
      }));
      await refreshInventory();
      setModal(null);
      notify("PO cancelled");
    } catch (error) {
      console.warn("[InventoryControl] Unable to cancel PO.", error);
      debugLog("[POCancelDebug]", { action: "cancel-po", orderId: order?.id, reason, error });
      notify("Failed to cancel PO", error.message || "Please try again.", "error");
    }
  }

  async function completePurchaseOrder(order, reason = "") {
    try {
      const updatedOrder = await persistRemotePurchaseOrderComplete(order, reason);
      setData((current) => ({
        ...current,
        orders: current.orders.map((entry) => entry.id === order.id ? updatedOrder : entry),
      }));
      await refreshInventory();
      setModal(null);
      notify("PO completed", updatedOrder.completionType === "partial" ? "Remaining quantity marked as unfulfilled." : "PO closed as fully fulfilled.");
    } catch (error) {
      console.warn("[InventoryControl] Unable to complete PO.", error);
      debugLog("[POCompleteDebug]", { action: "complete-po", orderId: order?.id, reason, error });
      notify("Failed to complete PO", error.message || "Please try again.", "error");
    }
  }

  async function receivePurchaseOrder(order, rows, receiptRemark) {
    try {
      const result = await persistRemotePurchaseOrderReceive(order, rows, receiptRemark, auth?.user?.id);
      setData((current) => ({
        ...current,
        orders: current.orders.map((entry) => entry.id === order.id ? result.order : entry),
        movements: [...result.movements, ...current.movements.filter((movement) => !result.movements.some((entry) => entry.id === movement.id))],
      }));
      await refreshInventory();
      setModal(null);
      notify("Inventory received", result.order.status === "fully_received" ? "PO fully received. Inventory movement records were created." : "PO partially received. Inventory movement records were created.");
    } catch (error) {
      console.warn("[InventoryControl] Unable to receive PO.", error);
      debugLog("[POReceiveDebug]", { action: "receive-po", orderId: order?.id, rows, receiptRemark, error });
      notify("Failed to receive inventory", error.message || "Please try again.", "error");
    }
  }

  async function saveMovement(movement) {
    try {
      const selectedItem = itemById.get(movement.itemId);
      const savedMovement = await persistRemoteInventoryMovement({ ...movement, unit: movement.unit || selectedItem?.unit || "" }, auth?.user?.id);
      setData((current) => ({ ...current, movements: [savedMovement, ...current.movements.filter((entry) => entry.id !== savedMovement.id)] }));
      await refreshInventory();
      setModal(null);
      notify("Inventory movement recorded");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save inventory movement.", error);
      debugLog("[InventoryMovementDebug]", { action: "save-movement", movement, error });
      notify("Unable to save movement", error.message || "Please try again.", "error");
    }
  }

  async function saveWaste(waste) {
    try {
      let evidenceUrl = waste.photoUrl || waste.photo_url || "";
      const hasEvidenceFile = typeof File !== "undefined" && waste.photoFile instanceof File;
      let evidenceDebug = {
        wasteRecordId: waste.id || "new",
        uploadSuccess: false,
        evidenceUrl,
        savedEvidenceUrl: "",
        displayEvidenceUrl: "",
      };
      if (hasEvidenceFile) {
        const uploadResult = await uploadWasteEvidencePhoto(waste.photoFile, waste.id || "draft");
        evidenceUrl = uploadResult.publicUrl;
        evidenceDebug = { ...evidenceDebug, uploadSuccess: true, evidenceUrl };
      }
      const result = await persistRemoteWasteRecord({ ...waste, photoUrl: evidenceUrl, photo_url: evidenceUrl }, auth?.user?.id);
      debugLog("[WasteEvidenceDebug]", {
        ...evidenceDebug,
        wasteRecordId: result.waste?.id || waste.id || "new",
        savedEvidenceUrl: result.waste?.photoUrl || result.waste?.photo_url || "",
        displayEvidenceUrl: result.waste?.photoUrl || result.waste?.photo_url || "",
      });
      setData((current) => ({
        ...current,
        waste: [result.waste, ...current.waste.filter((entry) => entry.id !== result.waste.id)],
        movements: [result.movement, ...current.movements.filter((entry) => entry.id !== result.movement.id)],
      }));
      await refreshInventory();
      setModal(null);
      notify("Waste record created", "A waste movement was added to the inventory audit trail.");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save waste record.", error);
      debugLog("[WasteSaveDebug]", { action: "save-waste", payload: waste, error });
      debugLog("[WasteEvidenceDebug]", {
        wasteRecordId: waste?.id || "new",
        uploadSuccess: false,
        evidenceUrl: waste?.photoUrl || waste?.photo_url || "",
        savedEvidenceUrl: "",
        displayEvidenceUrl: "",
        error,
      });
      await refreshInventory();
      if (error?.partialWasteSaved) {
        notify("Waste record created, but movement failed", error.cause?.message || error.message || "Please check Inventory Movements permissions.", "warning");
      } else {
        notify("Failed to create Waste Record", error.message || "Please try again.", "error");
      }
    }
  }

  async function saveRecipe(recipe) {
    try {
      let recipePhotoUrl = recipe.recipePhotoUrl || recipe.recipe_photo_url || "";
      const hasNewPhotoFile = typeof File !== "undefined" && recipe.recipePhotoFile instanceof File;
      if (hasNewPhotoFile) {
        const uploadResult = await uploadRecipePhoto(recipe.recipePhotoFile, isUuid(recipe.id) ? recipe.id : "draft");
        recipePhotoUrl = uploadResult.publicUrl;
        debugLog("[RecipePhotoSaveDebug]", { recipeId: recipe.id || "new", uploadResult, error: null });
      }
      const normalized = {
        ...recipe,
        recipeCode: recipeCode(recipe),
        recipe_code: recipeCode(recipe),
        recipeNameEn: recipeNameEn(recipe),
        recipe_name: recipeNameEn(recipe),
        recipe_name_en: recipeNameEn(recipe),
        recipeNameCn: recipeNameCn(recipe),
        recipe_name_cn: recipeNameCn(recipe),
        recipePhotoUrl,
        recipe_photo_url: recipePhotoUrl,
        sellingPrice: recipe.sellingPrice === "" || recipe.sellingPrice === null || recipe.sellingPrice === undefined ? "" : Number(recipe.sellingPrice),
        selling_price: recipe.sellingPrice === "" || recipe.sellingPrice === null || recipe.sellingPrice === undefined ? "" : Number(recipe.sellingPrice),
        ingredients: (recipe.ingredients || []).map((line) => {
          const item = itemById.get(line.itemId);
          return {
            ...line,
            unit: line.unit || item?.unit || "",
            quantityUsed: Number(line.quantityUsed || 0),
            wastagePercent: Number(line.wastagePercent || 0),
          };
        }),
      };
      const savedRecipe = await persistRemoteRecipe(normalized, auth?.user?.id);
      setData((current) => ({
        ...current,
        recipes: [savedRecipe, ...current.recipes.filter((entry) => entry.id !== savedRecipe.id)],
      }));
      await refreshInventory();
      setModal(null);
      notify(isUuid(recipe.id) ? "Recipe updated" : "Recipe created");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save recipe.", error);
      debugLog("[RecipeSaveDebug]", { action: "save-recipe", payload: recipe, error });
      await refreshInventory();
      const duplicateCodeFailure = /inventory_recipes_recipe_code_unique|duplicate key|recipe_code/i.test(String(`${error?.message || ""} ${error?.details || ""}`));
      notify(
        isUuid(recipe.id) ? "Failed to update Recipe" : "Failed to create Recipe",
        duplicateCodeFailure ? "Recipe code already exists. Please use another code." : error.message || "Please try again.",
        "error",
      );
      throw error;
    }
  }

  async function saveRecipeProductMapping(productName, recipeId) {
    const productKey = normalizeProductRecipeKey(productName);
    if (!activeRecipeOutletId || !productKey || !isUuid(recipeId)) {
      notify("Failed to map Product to Recipe", "Choose a recipe before saving the mapping.", "error");
      return;
    }
    setSavingRecipeMappingKey(productKey);
    try {
      const existing = recipeProductMappings.find((mapping) => normalizeProductRecipeKey(mapping.product_name) === productKey);
      const payload = {
        outlet_id: activeRecipeOutletId,
        product_name: productName,
        recipe_id: recipeId,
        updated_at: new Date().toISOString(),
      };
      const result = existing?.id
        ? await supabase
          .from("product_recipe_mappings")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single()
        : await supabase
          .from("product_recipe_mappings")
          .insert({ ...payload, created_by: isUuid(auth?.profile?.id) ? auth.profile.id : null })
          .select("*")
          .single();
      debugLog("[RecipeMappingSaveDebug]", { productName, recipeId, payload, result: { data: result.data, error: result.error } });
      if (result.error) throw result.error;
      setRecipeProductMappings((current) => [result.data, ...current.filter((mapping) => mapping.id !== result.data.id && normalizeProductRecipeKey(mapping.product_name) !== productKey)]);
      setIgnoredRecipeProductKeys((current) => {
        const next = new Set(current);
        next.delete(productKey);
        return next;
      });
      notify("Product mapped to Recipe");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save recipe product mapping.", error);
      debugLog("[RecipeMappingSaveDebug]", { productName, recipeId, error });
      notify("Failed to map Product to Recipe", error.message || "Please try again.", "error");
    } finally {
      setSavingRecipeMappingKey("");
    }
  }

  async function archiveRecipe(recipeId) {
    if (!requirePermission(can.manageRecipes, "archive recipes")) return;
    try {
      const archivedRecipe = await archiveRemoteRecipe(recipeId);
      setData((current) => ({
        ...current,
        recipes: current.recipes.map((recipe) => recipe.id === recipeId ? { ...recipe, ...archivedRecipe, ingredients: recipe.ingredients || [] } : recipe),
      }));
      await refreshInventory();
      notify("Recipe archived");
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive recipe.", error);
      debugLog("[RecipeSaveDebug]", { action: "archive-recipe", recipeId, error });
      notify("Failed to archive Recipe", error.message || "Please try again.", "error");
    }
  }

  async function saveMenuCategory(category) {
    if (!requirePermission(can.manageRecipes, "manage recipe menu categories")) return;
    try {
      const savedCategory = await persistRemoteMenuCategory({
        ...category,
        sortOrder: Number(category.sortOrder ?? category.sort_order ?? 0)
          || (data.menuCategories?.length ? Math.max(...data.menuCategories.map((entry) => Number(entry.sortOrder || 0))) + 1 : 1),
      });
      setData((current) => ({
        ...current,
        menuCategories: current.menuCategories?.some((entry) => entry.id === savedCategory.id)
          ? current.menuCategories.map((entry) => entry.id === savedCategory.id ? savedCategory : entry)
          : [...(current.menuCategories || []), savedCategory],
      }));
      await refreshInventory();
      setModal({ type: "recipe-menu-categories" });
      notify(isUuid(category.id) ? "Menu category updated" : "Menu category created");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save menu category.", error);
      debugLog("[RecipeMenuCategoryDebug]", { action: "save", payload: category, error });
      notify(isUuid(category.id) ? "Failed to update menu category" : "Failed to create menu category", error.message || "Please try again.", "error");
    }
  }

  async function archiveMenuCategory(category) {
    if (!requirePermission(can.manageRecipes, "archive recipe menu categories")) return;
    try {
      const savedCategory = await persistRemoteMenuCategory({ ...category, status: category.status === "active" ? "inactive" : "active" });
      setData((current) => ({
        ...current,
        menuCategories: (current.menuCategories || []).map((entry) => entry.id === savedCategory.id ? savedCategory : entry),
      }));
      await refreshInventory();
      notify(category.status === "active" ? "Menu category archived" : "Menu category activated");
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive menu category.", error);
      debugLog("[RecipeMenuCategoryDebug]", { action: "archive", payload: category, error });
      notify("Failed to update menu category", error.message || "Please try again.", "error");
    }
  }

  async function sortMenuCategories(draggedId, targetId) {
    if (!requirePermission(can.manageRecipes, "sort recipe menu categories")) return;
    let sortedCategories = [];
    setData((current) => {
      const ordered = [...(current.menuCategories || [])].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name));
      const fromIndex = ordered.findIndex((category) => category.id === draggedId);
      const toIndex = ordered.findIndex((category) => category.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(toIndex, 0, moved);
      sortedCategories = ordered.map((category, index) => ({ ...category, sortOrder: index + 1 }));
      const byId = new Map(sortedCategories.map((category) => [category.id, category]));
      return {
        ...current,
        menuCategories: (current.menuCategories || []).map((category) => byId.get(category.id) || category),
      };
    });
    try {
      const results = await Promise.all(sortedCategories
        .filter((category) => isUuid(category.id))
        .map((category) => supabase
          .from("inventory_menu_categories")
          .update({ sort_order: category.sortOrder, updated_at: new Date().toISOString() })
          .eq("id", category.id)));
      const sortError = results.find((result) => result.error)?.error;
      if (sortError) throw sortError;
      await refreshInventory();
      notify("Menu category order updated");
    } catch (error) {
      console.warn("[InventoryControl] Unable to sort menu categories.", error);
      notify("Failed to update menu category order", error.message || "Please try again.", "error");
      await refreshInventory();
    }
  }

  function exportRecipes() {
    if (!requirePermission(can.exportRecipes, "export recipes")) return;
    const activeRecipeOutletId = selectedOutletId === "all" ? (getAccessibleOutlets(auth, outlets)[0]?.id || outlets[0]?.id || "") : selectedOutletId;
    const rows = data.recipes.filter((recipe) => {
      const searchText = `${recipeCode(recipe)} ${recipeNameEn(recipe)} ${recipeNameCn(recipe)} ${recipe.menuCategory || ""} ${outletById.get(recipe.outletId)?.name || ""}`.toLowerCase();
      return recipe.outletId === activeRecipeOutletId
        && (recipeFilters.category === "all" || recipe.menuCategory === recipeFilters.category)
        && (recipeFilters.status === "all" || recipe.status === recipeFilters.status)
        && (!recipeFilters.search.trim() || searchText.includes(recipeFilters.search.trim().toLowerCase()));
    }).map((recipe) => {
      const outlet = outletById.get(recipe.outletId);
      return {
        recipe_code: recipeCode(recipe),
        recipe_name_en: recipeNameEn(recipe),
        recipe_name_cn: recipeNameCn(recipe),
        Outlet: outlet?.name || "",
        "Menu Category": recipe.menuCategory,
        "Serving Size": recipe.servingSize,
        Ingredients: (recipe.ingredients || []).length,
        Status: recipe.status,
        Notes: recipe.notes || "",
      };
    });
    const columns = ["recipe_code", "recipe_name_en", "recipe_name_cn", "Outlet", "Menu Category", "Serving Size", "Ingredients", "Status", "Notes"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-recipes-${todayInput()}.csv`, csv);
    notify("Recipes exported successfully");
  }

  function renderFilters() {
    const outletOptions = getAccessibleOutletOptions(auth, outlets);
    return (
      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-end">
        <SelectField
          label="Outlet"
          value={selectedOutletId}
          options={outletOptions}
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
      dashboard.varianceRisk ? { title: `${dashboard.varianceRisk} missed stock checks`, reason: "Outlet check groups were not completed on schedule.", tone: "danger", category: "Stock Check" } : null,
      data.orders.some((order) => ["sent", "confirmed", "packing"].includes(order.status)) ? { title: "Supplier delivery pending", reason: "Purchase orders are still open.", tone: "info", category: "Ordering" } : null,
    ].filter(Boolean);

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={Warehouse} label="Inventory Value" value={toCurrency(dashboard.inventoryValue)} helper="Estimated at par level" trend="Monthly" emphasis="primary" />
          <MetricCard icon={AlertTriangle} label="Low Stock Items" value={dashboard.lowStock} helper="Below outlet par level" tone={dashboard.lowStock ? "warning" : "success"} />
          <MetricCard icon={PackagePlus} label="Pending Orders" value={dashboard.pendingOrders} helper="Open supplier orders" tone={dashboard.pendingOrders ? "warning" : "success"} />
          <MetricCard icon={Sparkles} label="Variance Risk" value={dashboard.varianceRisk} helper="Missed checks" tone={dashboard.varianceRisk ? "danger" : "success"} />
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

          <SectionCard title="Smart Alerts" description="AI-style operational signals from stock checks, orders and movements.">
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
    const masterSummary = {
      totalItems: visibleItems.length,
      categories: new Set(visibleItems.map((item) => item.categoryId || item.category_id || item.categoryName || item.category_name).filter(Boolean)).size,
      activeItems: visibleItems.filter((item) => String(item.status || "").toLowerCase() === "active").length,
      outletsLinked: new Set(visibleItems.flatMap((item) => item.linkedOutletIds || [])).size,
    };

    const renderCostCell = (item, mobile = false) => {
      const editing = editingCostItemId === item.id;
      const saving = savingCostItemId === item.id;
      if (editing) {
        return (
          <input
            className={`control h-8 ${mobile ? "w-28 text-right" : "w-32"} text-[13px] font-semibold`}
            type="number"
            min="0"
            step="0.0001"
            value={editingCostValue}
            autoFocus
            disabled={saving}
            placeholder="0.00"
            onFocus={selectInputText}
            onChange={(event) => setEditingCostValue(event.target.value)}
            onBlur={() => {
              if (skipCostBlurSaveRef.current) {
                skipCostBlurSaveRef.current = false;
                return;
              }
              saveInlineCost(item);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                skipCostBlurSaveRef.current = true;
                saveInlineCost(item);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelInlineCostEdit();
              }
            }}
          />
        );
      }
      return (
        <button
          className={`${mobile ? "text-right" : "text-left"} rounded-lg px-2 py-1 text-[13px] font-bold text-text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:text-text-muted`}
          type="button"
          disabled={!can.editMaster || saving}
          onClick={() => beginInlineCostEdit(item)}
          title={can.editMaster ? "Edit cost" : "Editing cost requires inventory master edit permission"}
        >
          {saving ? "Saving..." : formatInventoryCost(item.cost, item.uom_code || item.unit)}
        </button>
      );
    };

    const renderItemRow = (item) => {
      const category = categoryForItem(item, categoryById);
      const photo = item.photo_url || item.photo;
      return (
        <tr key={item.id} className="transition hover:bg-primary/5">
          <td className="py-3.5">
            <div className="flex items-center gap-3">
              {photo ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-50 shadow-sm">
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                </div>
              ) : <InventoryCategoryIcon category={category} />}
              <div>
                <div className="font-bold text-text-primary">{item.name}</div>
                <div className="type-caption text-text-secondary">{item.description || category?.name || "Inventory item"}</div>
              </div>
            </div>
          </td>
          {masterGroupBy === "none" ? <td>{category?.name ?? "Uncategorized"}</td> : null}
          <td className="font-mono text-xs text-text-secondary">{item.sku || "-"}</td>
          <td>{item.uom_code || item.unit}</td>
          <td>
            <LinkedOutletsSummary item={item} outlets={outlets} onConfigure={() => { if (requirePermission(can.editParLevels, "manage par levels")) ui?.navigate?.("inventory_par_levels"); }} />
          </td>
          <td>{renderCostCell(item)}</td>
          <td><Badge tone={statusTone(item.status)}>{toTitle(item.status)}</Badge></td>
          <td>
            <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
              <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.editMaster, "edit inventory items") && setModal({ type: "item", item })}>Edit</button>
              <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => requirePermission(can.deleteMaster, "archive inventory items") && archiveItem(item.id)}>Archive</button>
            </div>
          </td>
        </tr>
      );
    };

    const renderItemCard = (item) => {
      const category = categoryForItem(item, categoryById);
      const photo = item.photo_url || item.photo;
      return (
        <div key={item.id} className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
          <div className="flex gap-3">
            {photo ? (
              <button
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-50 shadow-sm"
                type="button"
                onClick={() => setPhotoPreview({ src: photo, title: item.name })}
                aria-label={`View photo for ${item.name}`}
              >
                <img src={photo} alt="" className="h-full w-full object-cover" />
              </button>
            ) : <InventoryCategoryIcon category={category} />}
            <div className="min-w-0 flex-1">
              <div className="font-bold text-text-primary">{item.name}</div>
              <div className="mt-0.5 type-caption text-text-secondary">{category?.name || "Uncategorized"} · {item.sku || "No SKU"}</div>
              {item.description ? <div className="mt-1 line-clamp-2 type-caption text-text-muted">{item.description}</div> : null}
            </div>
            <Badge tone={statusTone(item.status)}>{toTitle(item.status)}</Badge>
          </div>
          <div className="mt-3 grid gap-2 type-caption text-text-secondary">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">UOM</span>
              <span className="font-bold text-text-primary">{item.uom_code || item.unit || "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Linked Outlets</span>
              <LinkedOutletsSummary item={item} outlets={outlets} onConfigure={() => { if (requirePermission(can.editParLevels, "manage par levels")) ui?.navigate?.("inventory_par_levels"); }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Cost</span>
              {renderCostCell(item, true)}
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3" onClick={(event) => event.stopPropagation()}>
            <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.editMaster, "edit inventory items") && setModal({ type: "item", item })}>Edit</button>
            <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => requirePermission(can.deleteMaster, "archive inventory items") && archiveItem(item.id)}>Archive</button>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Boxes} label="Total Items" value={masterSummary.totalItems} helper="Master records" size="compact" />
          <MetricCard icon={ClipboardList} label="Categories" value={masterSummary.categories} helper="In current list" size="compact" />
          <MetricCard icon={CheckCircle2} label="Active Items" value={masterSummary.activeItems} helper="Available for operations" tone="success" size="compact" />
          <MetricCard icon={Warehouse} label="Outlets Linked" value={masterSummary.outletsLinked} helper="Unique outlet links" tone="info" size="compact" />
        </div>

        <div className="card grid gap-3 p-3 xl:grid-cols-[1.15fr_220px_180px_170px] xl:items-end">
          <label className="min-w-0">
            <div className="mb-1 type-caption font-semibold text-text-secondary">Search item</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
              <input className="control h-9 w-full pl-9 text-[13px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item name or SKU" />
            </div>
          </label>
          <SelectField label="Outlet" value={selectedOutletId} options={getAccessibleOutletOptions(auth, outlets)} onChange={setSelectedOutletId} searchable />
          <SelectField label="Category" value={categoryFilter} options={[{ value: "all", label: "All Categories" }, ...sortedCategories.map((category) => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} searchable />
          <SelectField label="Status" value={statusFilter} options={[{ value: "all", label: "All Status" }, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={setStatusFilter} />
          <div className="xl:col-start-4">
            <SelectField
              label="Group by"
              value={masterGroupBy}
              options={[{ value: "category", label: "Category" }, { value: "none", label: "None" }]}
              onChange={setMasterGroupBy}
            />
          </div>
          {import.meta.env.DEV ? (
            <button
              className="btn-secondary h-9 xl:col-start-4"
              type="button"
              onClick={async () => {
                await refreshInventory();
                notify("Inventory refreshed", "Browser inventory cache cleared and Supabase data reloaded.");
              }}
            >
              <RefreshCw size={15} /> Hard Refresh Inventory
            </button>
          ) : null}
        </div>

        <SectionCard
          title="Inventory Items"
          description="Global item definitions. Outlet par levels are managed in Par Level Setup."
        >
          {visibleItems.length ? (
            <>
            <div className="space-y-3 md:hidden">
              {masterGroupBy === "category" ? visibleItemGroups.map((group) => {
                const collapsed = collapsedCategoryIds.has(group.id);
                return (
                  <div key={group.id} className="space-y-2">
                    <button
                      className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-left transition hover:bg-primary/8"
                      type="button"
                      onClick={() => setCollapsedCategoryIds((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Folder className="shrink-0 text-primary" size={18} strokeWidth={2.2} />
                        <span className="min-w-0">
                          <span className="block text-[15px] font-black leading-tight text-text-primary">{group.category?.name || "Uncategorized"}</span>
                          <span className="type-caption font-semibold text-text-secondary">{group.items.length} item{group.items.length === 1 ? "" : "s"} · {new Set(group.items.flatMap((item) => item.linkedOutletIds || [])).size} outlets linked</span>
                        </span>
                      </span>
                      <ChevronDown className={`shrink-0 text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
                    </button>
                    {collapsed ? null : group.items.map(renderItemCard)}
                  </div>
                );
              }) : visibleItems.map(renderItemCard)}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Item</th>
                    {masterGroupBy === "none" ? <th>Category</th> : null}
                    <th>SKU Code</th>
                    <th>UOM</th>
                    <th>Linked Outlets</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {masterGroupBy === "category" ? visibleItemGroups.map((group) => {
                    const collapsed = collapsedCategoryIds.has(group.id);
                    return (
                      <Fragment key={group.id}>
                        <tr key={`${group.id}-header`} className="bg-primary/5">
                          <td className="py-2.5" colSpan={7}>
                            <button
                              className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-left transition hover:bg-primary/8"
                              type="button"
                              onClick={() => setCollapsedCategoryIds((current) => {
                                const next = new Set(current);
                                if (next.has(group.id)) next.delete(group.id);
                                else next.add(group.id);
                                return next;
                              })}
                            >
                              <span className="flex min-w-0 items-center gap-2.5">
                                <Folder className="shrink-0 text-primary" size={18} strokeWidth={2.2} />
                                <span className="min-w-0">
                                  <span className="block text-[15px] font-black leading-tight text-text-primary">{group.category?.name || "Uncategorized"}</span>
                                  <span className="type-caption font-semibold text-text-secondary">
                                    {group.items.length} item{group.items.length === 1 ? "" : "s"} · {new Set(group.items.flatMap((item) => item.linkedOutletIds || [])).size} outlets linked
                                  </span>
                                </span>
                              </span>
                              <ChevronDown className={`shrink-0 text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
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
            </>
          ) : <EmptyState title="No inventory items match your filters" description="Adjust search, outlet, category or status filters to view more inventory items." />}
        </SectionCard>
        {import.meta.env.DEV ? (
          <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-3 py-2 type-caption font-semibold text-text-secondary">
            Remote Rows: {inventoryMeta.rawItemsCount || 0} · Normalized Rows: {inventoryMeta.normalizedItemsCount || data.items.length} · Visible Rows: {visibleItems.length} · Categories: {data.categories.length} · UOMs: {data.uoms.length} · Outlet Links: {inventoryMeta.outletLinkCount || 0} · Fallback Active: {inventoryMeta.fallbackActive ? "true" : "false"} · Build: {import.meta.env.VITE_APP_VERSION || import.meta.env.MODE} · Source: {inventoryMeta.dataSource}{inventoryMeta.lastFetchedAt ? ` · ${formatDate(inventoryMeta.lastFetchedAt)}` : ""}
          </div>
        ) : null}
      </div>
    );
  }

  function renderParLevels() {
    const activeOutletId = parLevelOutletId || outlets[0]?.id || "";
    const outletScopedItems = data.items.filter((item) => {
      const matchesOutlet = item.linkedOutletIds?.includes(activeOutletId);
      const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
      return matchesOutlet && matchesQuery && matchesCategory;
    });
    const parItems = data.items.filter((item) => {
      const hasLinkedOutlet = item.linkedOutletIds?.length;
      const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
      return hasLinkedOutlet && matchesQuery && matchesCategory;
    });
    const parItemGroups = [...outletScopedItems.reduce((groups, item) => {
      const category = categoryById.get(item.categoryId);
      const key = item.categoryId || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
      return groups;
    }, new Map()).values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
    const matrixOutlets = outlets;
    const matrixItemGroups = [...parItems.reduce((groups, item) => {
      const category = categoryById.get(item.categoryId);
      const key = item.categoryId || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
      return groups;
    }, new Map()).values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
    const visibleMatrixItems = matrixItemGroups.flatMap((group) => group.items);
    const visibleMatrixRowIndex = new Map(visibleMatrixItems.map((item, index) => [item.id, index]));
    const configuredMatrixCount = visibleMatrixItems.reduce((count, item) => count + matrixOutlets.filter((outlet) => {
      if (!item.linkedOutletIds?.includes(outlet.id)) return false;
      const value = outletConfigForItem(item, outlet.id).parLevel;
      return value !== "" && value !== null && value !== undefined;
    }).length, 0);
    const linkedMatrixCount = visibleMatrixItems.reduce((count, item) => count + matrixOutlets.filter((outlet) => item.linkedOutletIds?.includes(outlet.id)).length, 0);
    const matrixValuesByItem = new Map(visibleMatrixItems.map((item) => {
      const values = matrixOutlets
        .filter((outlet) => item.linkedOutletIds?.includes(outlet.id))
        .map((outlet) => Number(outletConfigForItem(item, outlet.id).parLevel))
        .filter((value) => Number.isFinite(value) && value > 0);
      return [item.id, values];
    }));
    const visibleParItems = parLevelGroupBy === "category"
      ? parItemGroups.flatMap((group) => collapsedParCategoryIds.has(group.id) ? [] : group.items)
      : outletScopedItems;
    const visibleParRowIndex = new Map(visibleParItems.map((item, index) => [item.id, index]));

    function handleParGridKeyDown(event, itemId, field) {
      const rowIndex = visibleParRowIndex.get(itemId);
      if (rowIndex === undefined) return;
      const keyMap = {
        Enter: event.shiftKey ? "previous-row" : "next-row",
        Tab: event.shiftKey ? "left" : "right",
        ArrowDown: "next-row",
        ArrowUp: "previous-row",
        ArrowRight: "right",
        ArrowLeft: "left",
      };
      const direction = keyMap[event.key];
      if (!direction) return;
      event.preventDefault();
      focusEditableGridInput(parLevelGridRef, rowIndex, field, direction);
    }

    function handleMatrixKeyDown(event, itemId, outletIndex) {
      const rowIndex = visibleMatrixRowIndex.get(itemId);
      if (rowIndex === undefined) return;
      const keyMap = {
        Enter: event.shiftKey ? "previous-row" : "next-row",
        ArrowDown: "next-row",
        ArrowUp: "previous-row",
        ArrowRight: "right",
        ArrowLeft: "left",
      };
      const direction = keyMap[event.key];
      if (!direction) return;
      event.preventDefault();
      focusMatrixGridInput(parLevelMatrixRef, rowIndex, outletIndex, direction);
    }

    function matrixInputClass(item, outlet) {
      const value = outletConfigForItem(item, outlet.id).parLevel;
      const numericValue = Number(value);
      const values = matrixValuesByItem.get(item.id) || [];
      const positiveValues = values.filter((entry) => entry > 0);
      const average = positiveValues.length ? positiveValues.reduce((sum, entry) => sum + entry, 0) / positiveValues.length : 0;
      const isMissing = value === "" || value === null || value === undefined;
      const isZero = !isMissing && Number(value) === 0;
      const isInvalid = !isMissing && numericValue < 0;
      const isOutlier = positiveValues.length >= 3 && numericValue > 0 && average > 0 && (numericValue > average * 2.2 || numericValue < average * 0.45);
      if (isInvalid) return "border-rose-300 bg-rose-50 text-rose-800 focus:ring-rose-200";
      if (isZero || isMissing) return "border-amber-200 bg-amber-50/60 text-amber-800 placeholder:text-amber-600 focus:ring-amber-100";
      if (isOutlier) return "border-sky-200 bg-sky-50/70 text-sky-800 focus:ring-sky-100";
      return "border-border bg-white text-text-primary";
    }

    const renderParRow = (item) => {
      const category = categoryById.get(item.categoryId);
      const config = outletConfigForItem(item, activeOutletId);
      const photo = item.photo || item.photo_url;
      const rowIndex = visibleParRowIndex.get(item.id) ?? -1;
      return (
        <tr key={item.id} className="transition hover:bg-primary/5">
          <td className="py-3.5">
            <div className="flex items-center gap-3">
              {photo ? (
                <button
                  className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl border border-border bg-slate-50 transition hover:border-primary/40 hover:shadow-sm"
                  type="button"
                  onClick={() => setPhotoPreview({ src: photo, title: item.name })}
                  aria-label={`View photo for ${item.name}`}
                >
                  <img className="h-full w-full object-cover" src={photo} alt={item.name} />
                </button>
              ) : (
                <InventoryCategoryIcon category={category} size="sm" />
              )}
              <div className="min-w-0">
                <div className="truncate font-bold text-text-primary">{item.name}</div>
                <div className="truncate type-caption text-text-secondary">{item.sku || "No SKU"} · {category?.name ?? "Uncategorized"}</div>
              </div>
            </div>
          </td>
          <td className="font-semibold text-text-secondary">{item.unit}</td>
          <td>
            <input
              className="control h-8 w-28 text-[13px]"
              type="number"
              min="0"
              value={config.parLevel ?? ""}
              placeholder="Enter quantity"
              data-grid-row={rowIndex}
              data-grid-field="par"
              onFocus={selectInputText}
              onKeyDown={(event) => handleParGridKeyDown(event, item.id, "par")}
              onChange={(event) => saveParLevelConfig(item.id, activeOutletId, { parLevel: parseNonNegativeNumber(event.target.value) })}
            />
          </td>
          <td>
            <input
              className="control h-8 min-w-44 text-[13px]"
              value={config.storageLocation}
              data-grid-row={rowIndex}
              data-grid-field="storage"
              onFocus={selectInputText}
              onKeyDown={(event) => handleParGridKeyDown(event, item.id, "storage")}
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
        </tr>
      );
    };

    return (
      <div className="space-y-4">
        <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-end">
            {parLevelView === "outlet" ? (
              <SelectField
                label="Outlet"
                value={activeOutletId}
                options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
                onChange={setParLevelOutletId}
                searchable
                className="lg:w-72"
              />
            ) : (
              <div className="lg:w-72">
                <div className="mb-1 type-caption font-semibold text-text-secondary">Outlet Scope</div>
                <div className="control flex h-9 items-center justify-between text-[13px] font-semibold text-text-primary">
                  <span>All accessible outlets</span>
                  <Badge tone="info">{outlets.length}</Badge>
                </div>
              </div>
            )}
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
          <div className="flex min-w-[92px] justify-end">
            <Badge tone={parLevelSaveState === "saving" ? "info" : parLevelSaveState === "error" ? "danger" : "success"}>
              {parLevelSaveState === "saving" ? "Saving..." : parLevelSaveState === "error" ? "Save failed" : "Saved"}
            </Badge>
          </div>
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
              <div className="overflow-x-auto" ref={parLevelGridRef}>
                <table className="w-full min-w-[960px] text-left">
                  <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2">Item</th>
                      <th>UOM</th>
                      <th>Par Level</th>
                      <th>Storage Location</th>
                      <th>Suppliers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {parLevelGroupBy === "category" ? parItemGroups.map((group) => {
                      const collapsed = collapsedParCategoryIds.has(group.id);
                      return (
                        <Fragment key={group.id}>
                          <tr className="bg-primary/5">
                            <td className="py-2.5" colSpan={5}>
                              <button
                                className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-left transition hover:bg-primary/8"
                                type="button"
                                onClick={() => setCollapsedParCategoryIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(group.id)) next.delete(group.id);
                                  else next.add(group.id);
                                  return next;
                                })}
                              >
                                <span className="flex min-w-0 items-center gap-2.5">
                                  <Folder className="shrink-0 text-primary" size={18} strokeWidth={2.2} />
                                  <span className="min-w-0">
                                    <span className="block text-[15px] font-black leading-tight text-text-primary">{group.category?.name || "Uncategorized"}</span>
                                    <span className="block type-caption font-semibold text-text-secondary">{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                                  </span>
                                </span>
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
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <MetricCard label="Items" value={visibleMatrixItems.length} helper="Linked inventory rows" size="compact" />
                  <MetricCard label="Categories" value={matrixItemGroups.length} helper="Grouped for scanning" size="compact" />
                  <MetricCard label="Outlets" value={matrixOutlets.length} helper="All accessible outlets" size="compact" />
                  <MetricCard label="Configured" value={configuredMatrixCount} helper="Cells with par level" tone="success" size="compact" />
                  <MetricCard label="Missing" value={Math.max(0, linkedMatrixCount - configuredMatrixCount)} helper="Linked but not set" tone={linkedMatrixCount - configuredMatrixCount ? "warning" : "success"} size="compact" />
                </div>
                <div className="overflow-x-auto rounded-2xl border border-border" ref={parLevelMatrixRef}>
                  <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
                    <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                      <tr className="border-b border-border">
                        <th className="sticky left-0 z-10 w-[260px] border-b border-border bg-surface px-3 py-2">Item</th>
                        <th className="sticky left-[260px] z-10 w-[120px] border-b border-border bg-surface px-3 py-2">Category / UOM</th>
                        {matrixOutlets.map((outlet) => (
                          <th key={outlet.id} className="min-w-[150px] border-b border-border bg-primary/5 px-3 py-2">
                            <div className="rounded-2xl border border-primary/10 bg-white/80 px-3 py-2 normal-case shadow-sm">
                              <div className="type-body-sm font-black text-text-primary" title={outletDisplayName(outlet)}>{outletDisplayCode(outlet)}</div>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-[13px]">
                      {matrixItemGroups.map((group) => (
                        <Fragment key={group.id}>
                          <tr className="bg-primary/5">
                            <td className="sticky left-0 z-10 border-b border-border bg-primary/5 px-3 py-2.5" colSpan={2}>
                              <div className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3">
                                <Folder className="shrink-0 text-primary" size={18} strokeWidth={2.2} />
                                <div className="min-w-0">
                                  <div className="text-[15px] font-black leading-tight text-text-primary">{group.category?.name || "Uncategorized"}</div>
                                  <div className="type-caption font-semibold text-text-secondary">{group.items.length} item{group.items.length === 1 ? "" : "s"}</div>
                                </div>
                              </div>
                            </td>
                            <td className="border-b border-border bg-primary/5 px-3 py-2.5" colSpan={matrixOutlets.length} />
                          </tr>
                          {group.items.map((item) => {
                            const rowIndex = visibleMatrixRowIndex.get(item.id) ?? -1;
                            return (
                              <tr key={item.id} className="transition hover:bg-primary/5">
                                <td className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-3">
                                  <div className="font-bold text-text-primary">{item.name}</div>
                                  <div className="truncate type-caption text-text-secondary">{item.sku || "No SKU"}</div>
                                </td>
                                <td className="sticky left-[260px] z-10 border-b border-border bg-surface px-3 py-3">
                                  <div className="type-caption font-semibold text-text-secondary">{group.category?.name ?? "Uncategorized"}</div>
                                  <div className="type-body-sm font-black text-text-primary">{item.unit}</div>
                                </td>
                                {matrixOutlets.map((outlet, outletIndex) => {
                                  const linked = item.linkedOutletIds?.includes(outlet.id);
                                  const config = outletConfigForItem(item, outlet.id);
                                  return (
                                    <td key={outlet.id} className="border-b border-border px-3 py-3">
                                      {linked ? (
                                        <input
                                          className={`h-9 w-28 rounded-xl border px-3 text-[13px] font-bold outline-none transition focus:ring-2 ${matrixInputClass(item, outlet)}`}
                                          type="number"
                                          min="0"
                                          value={config.parLevel ?? ""}
                                          placeholder="Not set"
                                          data-matrix-row={rowIndex}
                                          data-matrix-column={outletIndex}
                                          onFocus={selectInputText}
                                          onKeyDown={(event) => handleMatrixKeyDown(event, item.id, outletIndex)}
                                          onChange={(event) => saveParLevelConfig(item.id, outlet.id, { parLevel: parseNonNegativeNumber(event.target.value) })}
                                        />
                                      ) : (
                                        <span className="inline-flex h-9 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 type-body-sm font-black text-text-muted" title={`${item.name} is not linked to ${outlet.name}`}>⊘</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState title="No inventory items found" description="Adjust filters or create inventory items first." />}
          </SectionCard>
        )}
      </div>
    );
  }

  function renderGroups() {
    const outletOptions = getAccessibleOutletOptions(auth, outlets);
    const filteredGroups = data.groups.filter((group) => {
      const outlet = outletById.get(group.outletId);
      const categoryIds = groupCategoryIds(group, data.items);
      const categoryNames = categoryIds.map((id) => categoryById.get(id)?.name).join(" ");
      const matchesOutlet = selectedOutletId === "all" || group.outletId === selectedOutletId;
      const matchesStatus = groupStatusFilter === "all" || group.status === groupStatusFilter;
      const matchesFrequency = groupFrequencyFilter === "all" || group.frequency === groupFrequencyFilter;
      const matchesSearch = !groupSearch.trim() || `${group.name} ${group.description} ${outlet?.name || ""} ${categoryNames}`.toLowerCase().includes(groupSearch.trim().toLowerCase());
      return matchesOutlet && matchesStatus && matchesFrequency && matchesSearch;
    });
    const dueToday = filteredGroups.filter((group) => dueStatus(group, data.checks, date) === "Due Today").length;
    const completedToday = filteredGroups.filter((group) => dueStatus(group, data.checks, date) === "Completed").length;
    const inactiveGroups = filteredGroups.filter((group) => group.status !== "active").length;
    const emptyTitle = selectedOutletId === "all" ? "Create stock check groups so outlets know what to count." : "Create the first stock check group for this outlet.";

    return (
      <div className="space-y-4">
        <div className="card grid gap-3 p-3 lg:grid-cols-[220px_160px_160px_1fr] lg:items-end">
          <SelectField label="Outlet" value={selectedOutletId} options={outletOptions} onChange={setSelectedOutletId} searchable />
          <SelectField label="Status" value={groupStatusFilter} options={[{ value: "all", label: "All Status" }, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={setGroupStatusFilter} />
          <SelectField label="Frequency" value={groupFrequencyFilter} options={[{ value: "all", label: "All Frequency" }, ...frequencies.map((frequency) => ({ value: frequency, label: toTitle(frequency) }))]} onChange={setGroupFrequencyFilter} />
          <label>
            <div className="mb-1 type-caption font-semibold text-text-secondary">Search group</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
              <input className="control h-9 w-full pl-9 text-[13px]" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search group or category" />
            </div>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricCard label="Total Groups" value={filteredGroups.length} helper="Current filter scope" />
          <MetricCard label="Due Today" value={dueToday} helper="Ready to count" tone={dueToday ? "warning" : "success"} />
          <MetricCard label="Completed Today" value={completedToday} helper="Done for selected date" tone="success" />
          <MetricCard label="Inactive Groups" value={inactiveGroups} helper="Archived or inactive" tone={inactiveGroups ? "neutral" : "success"} />
        </div>
        <div className="card p-3">
          {filteredGroups.length ? (
            <div className="space-y-2">
              {filteredGroups.map((group) => {
              const categoryIds = groupCategoryIds(group, data.items);
              const itemCount = stockCheckItemsForGroup(group, data.items).length;
              const categoryNames = categoryIds.map((id) => categoryById.get(id)?.name).filter(Boolean);
              const visibleCategories = categoryNames.slice(0, 3);
              const hiddenCategoryCount = Math.max(0, categoryNames.length - visibleCategories.length);
              const due = dueStatus(group, data.checks, date);
              return (
                <div key={group.id} className="rounded-2xl border border-border bg-white p-3 transition hover:border-primary/25 hover:bg-primary/5">
                  <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate type-title font-bold text-text-primary">{group.name}</div>
                        <Badge tone={statusTone(due.toLowerCase())}>{due}</Badge>
                      </div>
                      <div className="mt-1 type-caption text-text-secondary">{outletById.get(group.outletId)?.name || "Outlet"} · {group.shift} · Last checked {group.lastChecked ? formatDate(group.lastChecked) : "Never"}</div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <MiniPill tone="info"><span title={(group.checkDays || []).join(", ")}>{compactFrequencyLabel(group)}</span></MiniPill>
                        <MiniPill tone={statusTone(group.status)}>{toTitle(group.status)}</MiniPill>
                        <MiniPill>{itemCount} items</MiniPill>
                      </div>
                      <div className="flex flex-wrap gap-1.5" title={categoryNames.join(", ")}>
                        {visibleCategories.map((name) => <span key={name} className="rounded-full border border-border bg-slate-50 px-2 py-0.5 type-caption font-semibold text-text-secondary">{name}</span>)}
                        {hiddenCategoryCount ? <span className="rounded-full border border-border bg-slate-50 px-2 py-0.5 type-caption font-semibold text-text-secondary">+{hiddenCategoryCount} categories</span> : null}
                        {!categoryNames.length ? <span className="type-caption font-semibold text-text-muted">No categories</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageGroups, "edit stock check groups") && setModal({ type: "group", group })}>Edit</button>
                      <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageGroups, "duplicate stock check groups") && setModal({ type: "group", outletId: group.outletId, group: { ...group, id: "", name: `${group.name} Copy`, categoryIds } })}>Duplicate</button>
                      {group.status === "active" ? <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => archiveGroup(group.id)}>Archive</button> : null}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          ) : <EmptyState title={emptyTitle} description="Groups decide which categories appear in custom or monthly checks." />}
        </div>
      </div>
    );
  }

  function renderStockCheck() {
    const auditChecks = data.checks
      .filter((check) => check.stockCheckType === "audit")
      .filter((check) => selectedOutletId === "all" || check.outletId === selectedOutletId)
      .sort((a, b) => new Date(b.submittedAt || b.date || 0) - new Date(a.submittedAt || a.date || 0));

    if (activeCheckGroup) {
      const isAudit = activeCheckGroup.stockCheckType === "audit";
      const activePersistedCheck = activeScheduledCheckId
        ? data.checks.find((check) => check.id === activeScheduledCheckId)
        : activeCheckGroup.existingCheckId
        ? data.checks.find((check) => check.id === activeCheckGroup.existingCheckId)
        : draftCheckForGroupRun(activeCheckGroup, data.checks, activeCheckGroup.date || date, stockCheckShiftFilter);
      const startedByName = activePersistedCheck?.createdBy ? actorNameByAuthUserId(activePersistedCheck.createdBy) : currentCheckerName;
      const submittedByName = activePersistedCheck?.submittedBy ? actorNameByEmployeeId(activePersistedCheck.submittedBy) : "";
      const draftSavedAt = activePersistedCheck?.updatedAt || activePersistedCheck?.createdAt || "";
      const validationIssues = checkValidationAttempted ? stockCheckValidationIssues(checkRows, isAudit) : [];
      const validationIssueByRowIndex = new Map(validationIssues.map((issue) => [issue.rowIndex, issue]));
      const checkRowsWithIndex = checkRows.map((row, index) => ({ ...row, rowIndex: index })).filter((row) => {
        if (!checkSearch.trim()) return true;
        const item = itemById.get(row.itemId);
        return `${item?.name || ""} ${item?.sku || ""}`.toLowerCase().includes(checkSearch.trim().toLowerCase());
      });
      const auditRowGroups = (() => {
        const groups = new Map();
        checkRowsWithIndex.forEach((row) => {
          const item = itemById.get(row.itemId);
          const category = categoryById.get(item?.categoryId);
          const key = item?.categoryId || "uncategorized";
          if (!groups.has(key)) groups.set(key, { id: key, category, rows: [] });
          groups.get(key).rows.push(row);
        });
        return [...groups.values()].filter((group) => group.rows.length).sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
      })();
      const renderCheckRow = (row) => {
        const index = row.rowIndex;
        const item = itemById.get(row.itemId);
        const category = categoryById.get(item?.categoryId);
        const parLevel = parLevelForOutlet(item, activeCheckGroup.outletId);
        const result = row.skipped ? { label: "Skipped", tone: "neutral", variance: 0 } : varianceStatus(parLevel, row.actualCount);
        const validationIssue = validationIssueByRowIndex.get(index);
        return (
          <tr
            key={row.itemId}
            data-check-row-index={index}
            className={`align-middle transition ${validationIssue ? "bg-amber-50/80 ring-1 ring-inset ring-amber-300" : ""}`}
          >
            <td className="py-4">
              <div className="flex min-w-[220px] items-center gap-3">
                <InventoryItemThumbnail item={item} category={category} onPreview={setPhotoPreview} />
                <div className="min-w-0">
                  <div className="font-bold text-text-primary">{item?.name || "Inventory item"}</div>
                  <div className="type-caption text-text-secondary">
                    {category?.name ?? "Uncategorized"}{item?.sku ? ` · ${item.sku}` : ""}
                  </div>
                </div>
              </div>
            </td>
            <td className="py-4 align-middle">{parLevel}</td>
            <td className="py-4 align-middle">
              <div className="flex items-center gap-1">
                <button className="icon-btn h-8 w-8" type="button" disabled={row.skipped} onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Math.max(0, Number(entry.actualCount || 0) - 1), na: false } : entry))}>-</button>
                <input className="control h-8 w-20 text-center text-[13px]" type="number" min="0" disabled={row.skipped} value={row.actualCount ?? ""} placeholder="Qty" onFocus={selectInputText} onChange={(event) => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: parseNonNegativeNumber(event.target.value), na: false } : entry))} />
                <button className="icon-btn h-8 w-8" type="button" disabled={row.skipped} onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Number(entry.actualCount || 0) + 1, na: false } : entry))}>+</button>
              </div>
              {validationIssue ? <div className="mt-2 type-caption font-bold text-amber-700">{validationIssue.reason === "Count not entered" ? "Count required" : validationIssue.reason}</div> : null}
              {!row.skipped ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {[
                    ["Full", parLevel],
                    ["Half", Math.round(Number(parLevel || 0) / 2)],
                    ["Empty", 0],
                    ...(!isAudit ? [["NA", row.actualCount]] : []),
                  ].map(([label, value]) => (
                    <button key={label} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary" type="button" onClick={() => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, actualCount: Number(value || 0), na: label === "NA" } : entry))}>{label}</button>
                  ))}
                </div>
              ) : <div className="mt-2 type-caption font-semibold text-text-muted">Skipped: {row.skipReason}</div>}
            </td>
            <td className="py-4 align-middle font-semibold">{row.skipped ? "Skipped" : row.na ? "NA" : result.variance}</td>
            <td className="py-4 align-middle">{item?.unit}</td>
            <td className="py-4 align-middle"><Badge tone={row.skipped ? "neutral" : row.na ? "neutral" : result.tone}>{row.skipped ? "Skipped" : row.na ? "NA" : result.label}</Badge></td>
            <td className="py-4 align-middle"><input className="control h-8 w-full text-[13px]" value={row.notes} onChange={(event) => setCheckRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, notes: event.target.value } : entry))} placeholder="Optional note" /></td>
            {isAudit ? (
              <td className="py-4 align-middle">
                {row.skipped ? (
                  <div className="space-y-1">
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => unskipCheckRow(index)}>Unskip</button>
                    {validationIssue?.reason === "Skip reason required" ? <div className="type-caption font-bold text-amber-700">Skip reason required</div> : null}
                  </div>
                ) : (
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setModal({ type: "skip-check-row", rowIndex: index, itemName: item?.name })}>Skip</button>
                )}
              </td>
            ) : null}
          </tr>
        );
      };
      const updateCheckRow = (index, updater) => {
        setCheckRows((current) => current.map((entry, rowIndex) => {
          if (rowIndex !== index) return entry;
          return typeof updater === "function" ? updater(entry) : { ...entry, ...updater };
        }));
      };
      const closeActiveCheck = () => {
        setActiveCheckGroupId(null);
        setActiveScheduledCheckId(null);
        setActiveAuditCheck(null);
      };
      if (useStockCheckCardLayout) {
        return (
          <StockCheckMobileView
            activeCheckGroup={activeCheckGroup}
            isAudit={isAudit}
            rows={checkRows.map((row, index) => ({ ...row, rowIndex: index }))}
            itemById={itemById}
            categoryById={categoryById}
            outletName={outletById.get(activeCheckGroup.outletId)?.name || "Outlet"}
            dateLabel={formatDate(activeCheckGroup.date || date)}
            startedByName={startedByName}
            submittedByName={submittedByName}
            draftSavedAt={draftSavedAt}
            activePersistedCheck={activePersistedCheck}
            currentCheckerName={currentCheckerName}
            validationIssues={validationIssues}
            checkSearch={checkSearch}
            onSearchChange={setCheckSearch}
            onPreviewPhoto={setPhotoPreview}
            onUpdateRow={updateCheckRow}
            onSkipRow={(rowIndex, itemName) => setModal({ type: "skip-check-row", rowIndex, itemName })}
            onUnskipRow={unskipCheckRow}
            onBack={closeActiveCheck}
            onSaveDraft={() => requirePermission(can.editCheck, "save stock check drafts") && saveStockCheck("draft")}
            onSubmit={() => requirePermission(can.createCheck, "submit stock checks") && saveStockCheck("submitted")}
          />
        );
      }
      return (
        <div className="space-y-4">
          <SectionCard
            title={activeCheckGroup.name}
            description={`${outletById.get(activeCheckGroup.outletId)?.name} · ${isAudit ? activeCheckGroup.auditType : activeCheckGroup.shift} · ${formatDate(activeCheckGroup.date || date)}`}
            action={<button className="btn-secondary" type="button" onClick={closeActiveCheck}>Back to Due Checks</button>}
          >
            <div className="mb-3 grid gap-2 rounded-2xl border border-border bg-slate-50 p-3 md:grid-cols-3">
              <div>
                <div className="type-micro font-black uppercase text-text-muted">Checked by</div>
                <div className="type-body-sm font-bold text-text-primary">{currentCheckerName}</div>
              </div>
              <div>
                <div className="type-micro font-black uppercase text-text-muted">Started by</div>
                <div className="type-body-sm font-bold text-text-primary">{startedByName}</div>
              </div>
              <div>
                <div className="type-micro font-black uppercase text-text-muted">{activePersistedCheck?.status === "submitted" ? "Submitted" : "Draft saved"}</div>
                <div className="type-body-sm font-bold text-text-primary">
                  {activePersistedCheck?.status === "submitted"
                    ? `${submittedByName || "Unknown User"} · ${formatDateTimeCompact(activePersistedCheck.submittedAt)}`
                    : (draftSavedAt ? formatDateTimeCompact(draftSavedAt) : "Not saved yet")}
                </div>
              </div>
            </div>
            {isAudit ? (
              <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-border bg-slate-50 p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="type-body-sm font-bold text-text-primary">Audit item list</div>
                  <div className="type-caption text-text-secondary">{checkRows.length} generated items · {checkRows.filter((row) => row.skipped).length} skipped</div>
                </div>
                <label className="md:w-80">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
                    <input className="control h-9 w-full pl-9 text-[13px]" value={checkSearch} onChange={(event) => setCheckSearch(event.target.value)} placeholder="Search item" />
                  </div>
                </label>
              </div>
            ) : null}
            {validationIssues.length ? (
              <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
                  <div>
                    <div className="type-body-sm font-black">{isAudit ? "Audit Check cannot be submitted" : "Stock Check cannot be submitted"}</div>
                    <div className="mt-1 type-caption font-semibold">{validationIssues.length} item{validationIssues.length === 1 ? "" : "s"} require attention:</div>
                    <ul className="mt-2 space-y-1 type-caption">
                      {validationIssues.slice(0, 8).map((issue) => (
                        <li key={`${issue.rowIndex}-${issue.reason}`}><span className="font-bold">{issue.itemName}</span> &rarr; {issue.reason}</li>
                      ))}
                      {validationIssues.length > 8 ? <li className="font-semibold">+{validationIssues.length - 8} more item{validationIssues.length - 8 === 1 ? "" : "s"}</li> : null}
                    </ul>
                    <div className="mt-2 type-caption font-semibold">{isAudit ? "Complete count or click Skip." : "Complete the count before submitting."}</div>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Item</th>
                    <th>Par</th>
                    <th>Actual</th>
                    <th>Variance</th>
                    <th>UOM</th>
                    <th>Status</th>
                    <th>Notes</th>
                    {isAudit ? <th>Skip</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {isAudit ? auditRowGroups.map((group) => {
                    const collapsed = collapsedCheckCategoryIds.has(group.id);
                    return (
                      <Fragment key={group.id}>
                        <tr className="bg-slate-50">
                          <td className="py-2" colSpan={8}>
                            <button
                              className="flex w-full items-center justify-between rounded-xl px-2 py-1 text-left transition hover:bg-primary/5"
                              type="button"
                              onClick={() => setCollapsedCheckCategoryIds((current) => {
                                const next = new Set(current);
                                if (next.has(group.id)) next.delete(group.id);
                                else next.add(group.id);
                                return next;
                              })}
                            >
                              <span className="type-body-sm font-black text-text-primary">{group.category?.name || "Uncategorized"} <span className="font-semibold text-text-secondary">· {group.rows.length} item{group.rows.length === 1 ? "" : "s"}</span></span>
                              <ChevronDown className={`text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
                            </button>
                          </td>
                        </tr>
                        {collapsed ? null : group.rows.map(renderCheckRow)}
                      </Fragment>
                    );
                  }) : checkRowsWithIndex.map(renderCheckRow)}
                </tbody>
              </table>
            </div>
          </SectionCard>
          <div className="sticky bottom-4 z-20 flex flex-col gap-2 rounded-2xl border border-border bg-white/95 p-3 shadow-card backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2 type-caption font-semibold text-text-secondary">
              <span>{checkRows.length} items</span>
              <span>·</span>
              <span>{checkRows.filter((row) => row.skipped).length} skipped</span>
              <span>·</span>
              <span>{checkRows.filter((row) => !row.skipped && varianceStatus(parLevelForOutlet(itemById.get(row.itemId), activeCheckGroup.outletId), row.actualCount).tone === "danger").length} critical items</span>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" type="button" onClick={() => requirePermission(can.editCheck, "save stock check drafts") && saveStockCheck("draft")}>Save Draft</button>
              <button className="btn-primary" type="button" onClick={() => requirePermission(can.createCheck, "submit stock checks") && saveStockCheck("submitted")}>{isAudit ? "Submit Audit Check" : "Submit Stock Check"}</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="card flex flex-col gap-3 p-3 md:flex-row md:items-end">
          <SelectField label="Outlet" value={selectedOutletId} options={getAccessibleOutletOptions(auth, outlets)} onChange={setSelectedOutletId} searchable className="md:w-64" />
          <DatePickerField label="Date" value={date} onChange={setDate} />
          <SelectField label="Shift" value={stockCheckShiftFilter} options={[{ value: "all", label: "All Shifts" }, ...shifts.map((shift) => ({ value: shift, label: shift }))]} onChange={setStockCheckShiftFilter} className="md:w-48" />
        </div>
        <SectionCard title="Today's Required Checks" description="Only due groups appear here; outlets are not asked to count every item every day.">
          {dueGroups.length ? (
            <div className="grid gap-3 xl:grid-cols-3">
              {dueGroups.map((group) => {
                const status = dueStatus(group, data.checks, date, stockCheckShiftFilter);
                const submittedCheck = submittedCheckForGroupRun(group, data.checks, date, stockCheckShiftFilter);
                const draftCheck = draftCheckForGroupRun(group, data.checks, date, stockCheckShiftFilter);
                const hasDraft = Boolean(draftCheck);
                const itemCount = stockCheckItemsForGroup(group, data.items).length;
                const latestCheck = submittedCheck || latestCheckForGroup(group);
                const suggestions = latestCheck ? buildPurchaseSuggestions(latestCheck) : [];
                const linkedOrders = latestCheck ? linkedPurchaseOrdersForStockCheck(latestCheck.id) : [];
                const canReviewSuggestions = can.generatePo || can.reviewCheck;
                const cardDebug = {
                  groupId: group.id,
                  groupName: group.name,
                  outletId: group.outletId,
                  shift: group.shift,
                  checkDate: date,
                  selectedShift: stockCheckShiftFilter,
                  submittedCheckId: submittedCheck?.id || "",
                  isDue: isGroupDue(group, date),
                  cardState: stockCheckCardActionState(status),
                };
                debugLog("[StockCheckGroupCardDebug]", cardDebug);
                debugLog("[StockCheckDueDebug]", cardDebug);
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
                      {dueStatusDescription(status) ? <div className="font-semibold text-text-secondary">{dueStatusDescription(status)}</div> : null}
                    </div>
                    {SHOW_STOCK_CHECK_CARD_DEBUG ? (
                      <div className="mt-3 rounded-xl border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold leading-relaxed text-amber-800">
                        <div>groupId: {group.id}</div>
                        <div>matchedCheckId: {submittedCheck?.id || "-"}</div>
                        <div>checkDate: {date}</div>
                        <div>status: {status}</div>
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-2">
                      {status === "Completed" ? (
                        <>
                          <button
                            className="btn-primary w-full"
                            type="button"
                            disabled={(!suggestions.length && !linkedOrders.length) || !canReviewSuggestions}
                            onClick={() => requirePermission(canReviewSuggestions, "review purchase suggestions") && openPurchaseSuggestionsForCheck(latestCheck)}
                          >
                            {linkedOrders.length ? "View Draft PO" : suggestions.length ? "Review Purchase Suggestions" : "No purchase suggestion"}
                          </button>
                          <button className="btn-secondary w-full" type="button" onClick={() => setModal({ type: "check-result", stockCheck: latestCheck, suggestions })}>View Result</button>
                        </>
                      ) : status === "Missed" ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800">
                          This stock check was not completed on schedule.
                        </div>
                      ) : (
                        <button className="btn-primary w-full" type="button" onClick={() => requirePermission(can.createCheck, "start stock checks") && startScheduledStockCheck(group)}>
                          {hasDraft ? "Continue Check" : "Start Check"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No stock check required today." description="Due groups will appear automatically based on each group's frequency and check days." />}
        </SectionCard>
        <SectionCard title="Audit Stock Checks" description="Special non-scheduled checks for month-end closing, surprise audits and control counts.">
          {auditChecks.length ? (
            <div className="grid gap-3 xl:grid-cols-3">
              {auditChecks.slice(0, 9).map((check) => {
                const shortageCount = (check.rows || []).filter((row) => !row.skipped && Number(row.variance || 0) > 0).length;
                const skippedCount = (check.rows || []).filter((row) => row.skipped).length;
                return (
                  <div key={check.id} className="rounded-2xl border border-border bg-white p-4 transition hover:border-primary/30 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="type-title font-bold text-text-primary">{check.auditName || "Audit Stock Check"}</div>
                        <div className="type-caption text-text-secondary">{outletById.get(check.outletId)?.name || "Outlet"} · {formatDate(check.date)}</div>
                      </div>
                      <Badge tone={statusTone(check.status)}>{check.status === "submitted" ? "Completed" : toTitle(check.status)}</Badge>
                    </div>
                    <div className="mt-3 space-y-1 type-caption text-text-secondary">
                      <div>Audit Type: <span className="font-semibold text-text-primary">{check.auditType || "Custom Audit"}</span></div>
                      <div>Items checked: <span className="font-semibold text-text-primary">{check.rows?.length || 0}</span></div>
                      <div>Skipped items: <span className="font-semibold text-text-primary">{skippedCount}</span></div>
                      <div>Variance items: <span className="font-semibold text-text-primary">{shortageCount}</span></div>
                    </div>
                    {check.status === "draft" ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <button className="btn-primary w-full" type="button" onClick={() => continueAuditStockCheck(check)}>Continue Audit</button>
                        <button className="btn-secondary w-full border-rose-200 text-rose-700 hover:bg-rose-50" type="button" onClick={() => deleteAuditDraft(check)}>Delete Draft</button>
                      </div>
                    ) : (
                      <button className="btn-secondary mt-4 w-full" type="button" onClick={() => setModal({ type: "check-result", stockCheck: check, suggestions: [], isAudit: true })}>View Audit Result</button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No audit stock checks yet." description="Use Audit Stock Check for month-end closing, full outlet counts or spot checks." />}
        </SectionCard>
      </div>
    );
  }

  function renderRequests() {
    return (
      <SectionCard title="Feature not available in current version" description="Stock Requests are deferred from the current Inventory Control MVP.">
        <EmptyState
          title="Stock Requests are deferred"
          description="Use scheduled Stock Check purchase suggestions or manual purchase planning in Purchase Orders for the current MVP."
        />
      </SectionCard>
    );
  }

  function renderOrders() {
    const filteredOrders = data.orders.filter((order) => {
      const outletId = order.outletId || order.outletIds?.[0] || "";
      const supplier = suppliers.find((entry) => entry.id === order.supplierId);
      const createdDate = (order.createdAt || order.submittedAt || "").slice(0, 10);
      const searchText = [
        order.poNo,
        supplier?.name,
        ...(order.lines || []).map((line) => itemById.get(line.itemId)?.name),
      ].join(" ").toLowerCase();
      const matchesOutlet = poFilters.outletId === "all" || outletId === poFilters.outletId;
      const matchesSupplier = poFilters.supplierId === "all" || order.supplierId === poFilters.supplierId;
      const matchesStatus = poFilters.status === "all" || order.status === poFilters.status;
      const matchesSource = poFilters.source === "all" || (order.sourceType || "manual") === poFilters.source;
      const matchesSearch = !poFilters.search.trim() || searchText.includes(poFilters.search.trim().toLowerCase());
      const matchesFrom = !poFilters.from || !createdDate || createdDate >= poFilters.from;
      const matchesTo = !poFilters.to || !createdDate || createdDate <= poFilters.to;
      return matchesOutlet && matchesSupplier && matchesStatus && matchesSource && matchesSearch && matchesFrom && matchesTo;
    });
    const updateFilter = (key, value) => setPoFilters((current) => ({ ...current, [key]: value }));
    const primaryAction = (order) => {
      if (order.status === "draft") return { label: "Submit Order", tone: "primary", action: () => requirePermission(can.submitPo, "submit purchase orders") && updatePurchaseOrderStatus(order.id, "submitted") };
      if (["submitted", "supplier_confirmed"].includes(order.status)) return { label: "Receive", tone: "primary", action: () => requirePermission(can.receivePo, "receive inventory") && setModal({ type: "po-receive", order }) };
      if (order.status === "partial_received") return { label: "Receive More", tone: "primary", action: () => requirePermission(can.receivePo, "receive inventory") && setModal({ type: "po-receive", order }) };
      if (order.status === "fully_received") return { label: "Complete PO", tone: "primary", action: () => requirePermission(can.completePo, "complete purchase orders") && setModal({ type: "po-complete", order }) };
      return { label: "View", tone: "secondary", action: () => setModal({ type: "po-detail", order }) };
    };

    return (
      <SectionCard title="Purchase Orders" description="Draft POs are created from reviewed stock check suggestions or manual purchase planning.">
        <div className="mb-4 grid gap-3 lg:grid-cols-6">
          <SelectField label="Outlet" value={poFilters.outletId} options={getAccessibleOutletOptions(auth, outlets)} onChange={(value) => updateFilter("outletId", value)} searchable />
          <SelectField label="Supplier" value={poFilters.supplierId} options={[{ value: "all", label: "All Suppliers" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} onChange={(value) => updateFilter("supplierId", value)} searchable />
          <SelectField label="Status" value={poFilters.status} options={[{ value: "all", label: "All Status" }, ...poStatuses.map((status) => ({ value: status, label: poStatusLabel(status) }))]} onChange={(value) => updateFilter("status", value)} />
          <SelectField label="Source" value={poFilters.source} options={[{ value: "all", label: "All Sources" }, ...poSources.map((source) => ({ value: source, label: poSourceLabel(source) }))]} onChange={(value) => updateFilter("source", value)} />
          <DatePickerField label="From" value={poFilters.from} onChange={(value) => updateFilter("from", value)} />
          <DatePickerField label="To" value={poFilters.to} onChange={(value) => updateFilter("to", value)} />
          <label className="lg:col-span-6">
            <div className="mb-1 type-caption font-semibold text-text-secondary">Search PO / Supplier / Item</div>
            <input className="control h-9 w-full text-[13px]" value={poFilters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search PO no, supplier or item" />
          </label>
        </div>
        {filteredOrders.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left">
              <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                <tr className="border-b border-border">
                  <th className="py-2">PO No.</th>
                  <th>Supplier</th>
                  <th>Outlet</th>
                  <th>Items</th>
                  <th>Received Progress</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Created Date</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-[13px]">
                {filteredOrders.map((order) => {
                  const supplier = suppliers.find((entry) => entry.id === order.supplierId);
                  const outlet = outletById.get(order.outletId || order.outletIds?.[0]);
                  const progress = poProgress(order);
                  const action = primaryAction(order);
                  const canCancelOrder = ["draft", "submitted", "supplier_confirmed"].includes(order.status) && progress.received <= 0;
                  return (
                    <tr key={order.id} className="transition hover:bg-primary/5">
                      <td className="py-3 font-mono text-xs font-bold text-text-primary">{order.poNo}</td>
                      <td className="font-semibold text-text-primary">{supplier?.name ?? "Unassigned Supplier"}</td>
                      <td>{outlet?.name ?? "Outlet"}</td>
                      <td>{order.lines.length}</td>
                      <td>
                        <div className="font-semibold text-text-primary">{progress.received} / {progress.ordered}</div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(progress.percent, 100)}%` }} /></div>
                      </td>
                      <td><Badge tone={statusTone(order.status)}>{poStatusLabel(order.status)}</Badge></td>
                      <td>{poSourceLabel(order.sourceType)}</td>
                      <td>{formatDate(order.createdAt || order.submittedAt || todayInput())}</td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <button className={action.tone === "primary" ? "btn-primary h-8 px-2.5 text-xs" : "btn-secondary h-8 px-2.5 text-xs"} type="button" onClick={action.action}>{action.label}</button>
                          {action.label !== "View" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setModal({ type: "po-detail", order })}>View</button> : null}
                          <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => copyPurchaseOrderText(order)}><Copy size={13} /> Copy Text</button>
                          {order.status === "draft" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.editPo, "edit purchase orders") && setModal({ type: "po-edit", order })}>Edit</button> : null}
                          {order.status === "submitted" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.submitPo, "mark supplier confirmed") && updatePurchaseOrderStatus(order.id, "supplier_confirmed")}>Mark Confirmed</button> : null}
                          {order.status === "partial_received" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.completePo, "complete purchase orders") && setModal({ type: "po-complete", order })}>Complete PO</button> : null}
                          {canCancelOrder ? <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => requirePermission(can.cancelPo, "cancel purchase orders") && setModal({ type: "po-cancel", order })}>Cancel</button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No purchase orders found." description="Adjust filters or create Draft POs from scheduled stock check suggestions or manual purchase planning." />}
      </SectionCard>
    );
  }

  function renderMovements() {
    const movementTypesForFilter = uniqueIds(data.movements.map((movement) => movement.movementType || movement.type).filter(Boolean));
    const updateMovementFilter = (key, value) => setMovementFilters((current) => ({ ...current, [key]: value }));
    const movementTypeKey = (movement) => canonical(movement.movementType || movement.type || "");
    const movementTypeClass = (movement) => {
      const key = movementTypeKey(movement);
      if (key === "purchase") return "border-emerald-200 bg-emerald-50 text-emerald-700";
      if (key === "transfer_in") return "border-blue-200 bg-blue-50 text-blue-700";
      if (key === "transfer_out") return "border-purple-200 bg-purple-50 text-purple-700";
      if (key === "waste") return "border-orange-200 bg-orange-50 text-orange-700";
      if (key === "adjustment") return "border-slate-200 bg-slate-50 text-text-secondary";
      return "border-slate-200 bg-slate-50 text-text-secondary";
    };
    const movementTypeLabel = (movement) => {
      const key = movementTypeKey(movement);
      if (key === "transfer_in") return "Transfer In";
      if (key === "transfer_out") return "Transfer Out";
      return toTitle(movement.movementType || movement.type || "movement");
    };
    const filteredMovements = data.movements.filter((movement) => {
      const item = itemById.get(movement.itemId);
      const movementDate = String(movement.dateTime || movement.date || "").slice(0, 10);
      const searchText = `${item?.name || ""} ${movement.reference || ""} ${movement.notes || ""} ${movement.movementType || movement.type || ""}`.toLowerCase();
      const matchesOutlet = movementFilters.outletId === "all" || movement.outletId === movementFilters.outletId;
      const matchesType = movementFilters.movementType === "all" || canonical(movement.movementType || movement.type) === canonical(movementFilters.movementType);
      const matchesSearch = !movementFilters.search.trim() || searchText.includes(movementFilters.search.trim().toLowerCase());
      const matchesFrom = !movementFilters.from || !movementDate || movementDate >= movementFilters.from;
      const matchesTo = !movementFilters.to || !movementDate || movementDate <= movementFilters.to;
      return matchesOutlet && matchesType && matchesSearch && matchesFrom && matchesTo;
    });
    const movementSummary = filteredMovements.reduce((summary, movement) => {
      const key = movementTypeKey(movement);
      if (key === "purchase") summary.purchase += 1;
      else if (key.includes("transfer")) summary.transfer += 1;
      else if (key === "waste") summary.waste += 1;
      else if (key === "adjustment") summary.adjustment += 1;
      return summary;
    }, { purchase: 0, transfer: 0, waste: 0, adjustment: 0 });
    const openMovementReference = (movement) => {
      const referenceType = canonical(movement.referenceType || "");
      if (referenceType === "purchase_order" || referenceType === "po") {
        const order = data.orders.find((entry) => entry.id === movement.referenceId || entry.poNo === movement.reference);
        if (order) {
          setModal({ type: "po-detail", order });
          return;
        }
      }
      if (referenceType === "waste") {
        const waste = data.waste.find((entry) => entry.id === movement.referenceId);
        if (waste) {
          setModal({ type: "waste-detail", waste });
          return;
        }
      }
      notify("Reference detail unavailable", "No linked detail record is available for this movement.", "info");
    };
    return (
      <div className="space-y-4">
        <SectionCard title="Filters" description="Filter movement records by outlet, type, date range and item/reference search.">
          <div className="grid gap-3 lg:grid-cols-5">
            <SelectField label="Outlet" value={movementFilters.outletId} options={getAccessibleOutletOptions(auth, outlets)} onChange={(value) => updateMovementFilter("outletId", value)} searchable />
            <SelectField label="Movement Type" value={movementFilters.movementType} options={[{ value: "all", label: "All Types" }, ...movementTypesForFilter.map((type) => ({ value: type, label: toTitle(type) }))]} onChange={(value) => updateMovementFilter("movementType", value)} />
            <DatePickerField label="From" value={movementFilters.from} onChange={(value) => updateMovementFilter("from", value)} />
            <DatePickerField label="To" value={movementFilters.to} onChange={(value) => updateMovementFilter("to", value)} />
            <label>
              <div className="mb-1 type-caption font-semibold text-text-secondary">Search Item / Reference</div>
              <input className="control h-9 w-full text-[13px]" value={movementFilters.search} onChange={(event) => updateMovementFilter("search", event.target.value)} placeholder="Search item, PO no, notes" />
            </label>
          </div>
        </SectionCard>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Purchase In" value={movementSummary.purchase} helper="Received inventory records" tone="success" size="compact" />
          <MetricCard label="Transfer" value={movementSummary.transfer} helper="Transfer in/out records" tone="info" size="compact" />
          <MetricCard label="Waste" value={movementSummary.waste} helper="Waste movement records" tone="warning" size="compact" />
          <MetricCard label="Adjustments" value={movementSummary.adjustment} helper="Manual correction records" tone="neutral" size="compact" />
        </div>

        <SectionCard title="Movement Records" description={`Showing ${filteredMovements.length} record${filteredMovements.length === 1 ? "" : "s"}`}>
          {filteredMovements.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Date & Time</th>
                    <th>Outlet</th>
                    <th>Item</th>
                    <th>Movement Type</th>
                    <th>Qty</th>
                    <th>UOM</th>
                    <th>Reference No.</th>
                    <th>Notes</th>
                    <th>Created By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {filteredMovements.map((movement) => {
                    const item = itemById.get(movement.itemId);
                    const hasReference = Boolean(movement.reference || movement.referenceId);
                    return (
                      <tr key={movement.id}>
                        <td className="py-3">{formatDateTimeCompact(movement.dateTime || movement.date)}</td>
                        <td>{outletById.get(movement.outletId)?.name ?? "Unknown outlet"}</td>
                        <td className="font-bold text-text-primary">{item?.name ?? "Inventory item"}</td>
                        <td>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 type-caption font-semibold ${movementTypeClass(movement)}`}>
                            {movementTypeLabel(movement)}
                          </span>
                        </td>
                        <td className="font-semibold text-text-primary">{Number(movement.quantity) > 0 ? "+" : ""}{movement.quantity}</td>
                        <td>{movement.unit || item?.unit || "-"}</td>
                        <td>
                          {hasReference ? (
                            <button className="type-caption font-black text-primary underline-offset-2 hover:underline" type="button" onClick={() => openMovementReference(movement)}>
                              {movement.reference || "Open reference"}
                            </button>
                          ) : "-"}
                        </td>
                        <td>{movement.notes || "-"}</td>
                        <td>{actorNameByAnyId(movement.user || movement.createdBy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No inventory movements found." description={data.movements.length ? "Adjust filters to see more movement records." : "Purchase receiving and manual movements will appear here after they are saved to Supabase."} />}
        </SectionCard>
      </div>
    );
  }

  function renderWaste() {
    if (!can.viewWaste) {
      return <EmptyState title="Permission required" description="You do not have permission to view Waste & Variance." />;
    }
    const outletOptions = getAccessibleOutletOptions(auth, outlets).filter((option) => option.value !== "all");
    const activeWasteOutletId = selectedOutletId === "all" ? (outletOptions[0]?.value || "") : selectedOutletId;
    const filteredWaste = data.waste.filter((row) => {
      const item = itemById.get(row.itemId);
      const category = categoryById.get(item?.categoryId);
      const searchText = `${item?.name || ""} ${item?.sku || ""} ${category?.name || ""} ${row.notes || ""} ${outletById.get(row.outletId)?.name || ""}`.toLowerCase();
      const matchesOutlet = activeWasteOutletId ? row.outletId === activeWasteOutletId : false;
      const matchesType = wasteFilters.wasteType === "all" || row.wasteType === wasteFilters.wasteType;
      const matchesFrom = !wasteFilters.from || row.date >= wasteFilters.from;
      const matchesTo = !wasteFilters.to || row.date <= wasteFilters.to;
      const matchesSearch = !wasteFilters.search.trim() || searchText.includes(wasteFilters.search.trim().toLowerCase());
      return matchesOutlet && matchesType && matchesFrom && matchesTo && matchesSearch;
    });
    const totalWasteQuantity = filteredWaste.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const typeCounts = wasteTypes.map((type) => ({
      type,
      count: filteredWaste.filter((row) => row.wasteType === type).length,
    }));
    const categoryTotals = new Map();
    const itemTotals = new Map();
    filteredWaste.forEach((row) => {
      const item = itemById.get(row.itemId);
      const categoryName = categoryById.get(item?.categoryId)?.name || "Uncategorized";
      categoryTotals.set(categoryName, (categoryTotals.get(categoryName) || 0) + Number(row.quantity || 0));
      itemTotals.set(item?.name || "Inventory item", (itemTotals.get(item?.name || "Inventory item") || 0) + Number(row.quantity || 0));
    });
    const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "No data";
    const topItem = [...itemTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "No data";
    const updateWasteFilter = (key, value) => setWasteFilters((current) => ({ ...current, [key]: value }));
    return (
      <div className="space-y-4">
        <div className="card grid gap-3 p-3 lg:grid-cols-[220px_180px_170px_170px_1fr] lg:items-end">
          <SelectField label="Outlet" value={activeWasteOutletId} options={outletOptions} onChange={setSelectedOutletId} searchable />
          <SelectField label="Waste Type" value={wasteFilters.wasteType} options={[{ value: "all", label: "All Waste Types" }, ...wasteTypes.map((type) => ({ value: type, label: type }))]} onChange={(value) => updateWasteFilter("wasteType", value)} />
          <DatePickerField label="From" value={wasteFilters.from} onChange={(value) => updateWasteFilter("from", value)} />
          <DatePickerField label="To" value={wasteFilters.to} onChange={(value) => updateWasteFilter("to", value)} />
          <label>
            <div className="mb-1 type-caption font-semibold text-text-secondary">Search item/record</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
              <input className="control h-9 w-full pl-9 text-[13px]" value={wasteFilters.search} onChange={(event) => updateWasteFilter("search", event.target.value)} placeholder="Search item, category, note" />
            </div>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Waste Quantity" value={totalWasteQuantity} helper="Total recorded quantity" tone={totalWasteQuantity ? "warning" : "success"} />
          <MetricCard label="Waste Records" value={filteredWaste.length} helper="Matching current filters" tone={filteredWaste.length ? "warning" : "success"} />
          <MetricCard label="Highest Waste Item" value={topItem} helper="Based on quantity recorded" />
          <MetricCard label="Unexplained Loss %" value="0%" helper="No unexplained loss logged" />
        </div>
        <DashboardSection title="Operational Insights" subtitle="Rule-based signals for leakage and stock variance.">
          <div className="grid gap-3 xl:grid-cols-3">
            {[
              "Top wasted items will appear after records are created.",
              "Recurring spoilage patterns will appear after more operational data is collected.",
              "Variance trends will appear after stock checks are completed.",
            ].map((insight) => (
              <div key={insight} className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
                <div className="flex items-center gap-2 type-body-sm font-bold text-text-primary"><Sparkles size={15} className="text-primary" /> Operational signal</div>
                <p className="mt-2 type-body-sm text-text-secondary">{insight}</p>
              </div>
            ))}
          </div>
        </DashboardSection>
        <DashboardSection title="Waste Types" subtitle="Current waste mix across the selected outlet and filter range." density="compact">
          <div className="flex flex-wrap gap-2">{typeCounts.map(({ type, count }) => <Badge key={type} tone={count ? "warning" : "neutral"}>{type} ({count})</Badge>)}</div>
        </DashboardSection>
        <DashboardSection title="Waste Records" subtitle="Outlet-scoped waste entries and future audit trail structure.">
          {filteredWaste.length ? (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Waste Type</th>
                    <th>Qty</th>
                    <th>Outlet</th>
                    <th>Recorded By</th>
                    <th>Notes</th>
                    <th>Evidence</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {filteredWaste.map((row) => {
                const item = itemById.get(row.itemId);
                const category = categoryById.get(item?.categoryId);
                return (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-semibold text-text-primary">{formatDate(row.date)}</td>
                      <td className="font-bold text-text-primary">{item?.name ?? "Inventory item"}</td>
                      <td>{category?.name || "Uncategorized"}</td>
                      <td><Badge tone="warning">{row.wasteType}</Badge></td>
                      <td className="font-semibold">{row.quantity} {row.unit || item?.unit}</td>
                      <td>{outletById.get(row.outletId)?.name || "Outlet"}</td>
                      <td>{actorNameByAnyId(row.recordedBy || row.user)}</td>
                      <td className="max-w-52 truncate">{row.notes || "-"}</td>
                      <td>
                        {row.photoUrl || row.photo_url ? (
                          <button className="type-caption font-black text-primary underline-offset-2 hover:underline" type="button" onClick={() => setPhotoPreview({ src: row.photoUrl || row.photo_url, title: `${item?.name || "Waste"} evidence` })}>
                            📷 View Photo
                          </button>
                        ) : <span className="type-caption text-text-muted">—</span>}
                      </td>
                      <td><button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setModal({ type: "waste-detail", waste: row })}>View</button></td>
                    </tr>
                );
              })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No waste records for this outlet and filter range." description="Record spoilage, expiry or kitchen error to begin tracking operational leakage." />}
        </DashboardSection>
      </div>
    );
  }

  function renderRecipes() {
    if (!can.viewRecipes) {
      return <EmptyState title="Permission required" description="You do not have permission to view Recipes & Usage." />;
    }
    const activeMenuCategories = (data.menuCategories?.length ? data.menuCategories : recipeMenuCategories.map((name, index) => mapRemoteMenuCategory({ id: `default_menu_${index + 1}`, name, sort_order: index + 1, status: "active" })))
      .filter((category) => category.status === "active")
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.name.localeCompare(b.name));
    const updateRecipeFilter = (key, value) => setRecipeFilters((current) => ({ ...current, [key]: value }));
    const filteredRecipes = data.recipes.filter((recipe) => {
      const outlet = outletById.get(recipe.outletId);
      const searchText = `${recipeCode(recipe)} ${recipeNameEn(recipe)} ${recipeNameCn(recipe)} ${recipe.menuCategory || ""} ${outlet?.name || ""} ${(recipe.ingredients || []).map((line) => itemById.get(line.itemId)?.name).join(" ")}`.toLowerCase();
      return recipe.outletId === activeRecipeOutletId
        && (recipeFilters.category === "all" || recipe.menuCategory === recipeFilters.category)
        && (recipeFilters.status === "all" || recipe.status === recipeFilters.status)
        && (!recipeFilters.search.trim() || searchText.includes(recipeFilters.search.trim().toLowerCase()));
    });
    const recipeCostRows = filteredRecipes.map((recipe) => {
      const summary = recipeCostSummary(recipe, data.items);
      const margin = recipeMarginPercent(recipe.sellingPrice ?? recipe.selling_price, summary.totalCost);
      return { recipe, summary, margin };
    });
    const averageRecipeCost = recipeCostRows.length
      ? recipeCostRows.reduce((sum, row) => sum + row.summary.totalCost, 0) / recipeCostRows.length
      : 0;
    const pricedMargins = recipeCostRows.filter((row) => row.margin !== null && Number.isFinite(Number(row.margin)));
    const averageMargin = pricedMargins.length
      ? pricedMargins.reduce((sum, row) => sum + row.margin, 0) / pricedMargins.length
      : null;
    const highestCostRecipe = recipeCostRows.reduce((highest, row) => !highest || row.summary.totalCost > highest.summary.totalCost ? row : highest, null);
    const productSalesByName = recipeProductItems.reduce((totals, item) => {
      const key = normalizeProductRecipeKey(item.product_name);
      if (!key) return totals;
      const current = totals.get(key) || { productName: item.product_name, quantity: 0, revenue: 0 };
      current.quantity += Number(item.quantity || 0);
      current.revenue += Number(item.nett_sales || item.revenue || 0);
      totals.set(key, current);
      return totals;
    }, new Map());
    const recipeCostById = new Map(recipeCostRows.map((row) => [row.recipe.id, row]));
    const mappedProductKeys = new Set(recipeProductMappings.map((mapping) => normalizeProductRecipeKey(mapping.product_name)).filter(Boolean));
    const mappingCandidateRecipes = filteredRecipes.filter((recipe) => recipe.status === "active");
    const unmappedProductRows = [...productSalesByName.entries()]
      .filter(([key]) => !mappedProductKeys.has(key) && !ignoredRecipeProductKeys.has(key))
      .map(([key, product]) => {
        const suggestion = suggestRecipeMatch(product.productName, mappingCandidateRecipes);
        return {
          key,
          productName: product.productName,
          quantity: product.quantity,
          revenue: product.revenue,
          suggestedRecipe: suggestion.recipe,
          confidence: suggestion.confidence,
          matchType: suggestion.matchType,
          selectedRecipeId: recipeMappingSelections[key] || suggestion.recipe?.id || "",
        };
      })
      .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
    const matchedProductKeys = new Set();
    const menuEngineeringRows = recipeProductMappings
      .map((mapping) => {
        const matchKey = normalizeProductRecipeKey(mapping.product_name);
        const recipeRow = recipeCostById.get(mapping.recipe_id);
        if (!matchKey || !recipeRow || !productSalesByName.has(matchKey)) return null;
        matchedProductKeys.add(matchKey);
        const product = productSalesByName.get(matchKey);
        const { recipe, margin } = recipeRow;
        const recipeCost = Number(recipeRow.summary.totalCost || 0);
        const sellingPrice = Number(recipe.sellingPrice ?? recipe.selling_price ?? 0);
        return {
          id: recipe.id,
          label: recipeCode(recipe) || recipeNameEn(recipe) || recipeNameCn(recipe),
          recipe,
          salesVolume: product.quantity,
          revenue: product.revenue,
          margin,
          recipeCost,
          sellingPrice,
          profitPerServing: sellingPrice - recipeCost,
        };
      })
      .filter((row) => row && row.salesVolume > 0 && row.revenue > 0 && row.margin !== null && Number.isFinite(Number(row.margin)));
    const mappedRecipeCount = new Set(recipeProductMappings
      .filter((mapping) => recipeCostById.has(mapping.recipe_id) && productSalesByName.has(normalizeProductRecipeKey(mapping.product_name)))
      .map((mapping) => mapping.recipe_id)).size;
    const unmappedProductCount = [...productSalesByName.keys()].filter((key) => !matchedProductKeys.has(key)).length;
    const topMarginRows = recipeCostRows
      .filter((row) => row.margin !== null && Number.isFinite(Number(row.margin)))
      .sort((a, b) => Number(b.margin) - Number(a.margin))
      .slice(0, 5)
      .map(({ recipe, summary, margin }) => ({
        id: recipe.id,
        recipe,
        label: recipeNameEn(recipe) || recipeNameCn(recipe) || recipeCode(recipe),
        value: Number(margin),
        profitPerServing: Number(recipe.sellingPrice || 0) - Number(summary.totalCost || 0),
      }));
    const topRevenueRows = [...menuEngineeringRows]
      .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
      .slice(0, 5);
    const ingredientCostTotals = recipeCostRows.reduce((totals, { recipe }) => {
      (recipe.ingredients || []).forEach((line) => {
        const item = itemById.get(line.itemId);
        const cost = recipeIngredientCost(line, item);
        const key = line.itemId || line.id || item?.name || "unknown";
        const current = totals.get(key) || { id: key, label: item?.name || "Inventory item", value: 0 };
        current.value += cost.totalCost + cost.wastageCost;
        totals.set(key, current);
      });
      return totals;
    }, new Map());
    const highestCostIngredientRows = [...ingredientCostTotals.values()]
      .filter((row) => Number(row.value || 0) > 0)
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, 5);
    const lowestMarginRows = recipeCostRows
      .filter((row) => row.margin !== null && Number.isFinite(Number(row.margin)))
      .sort((a, b) => Number(a.margin) - Number(b.margin))
      .slice(0, 6);
    const reliableMenuEngineeringRows = mappedRecipeCount >= 10 ? menuEngineeringRows : [];
    return (
      <div className="space-y-4">
        <div className="card grid gap-3 p-3 lg:grid-cols-[220px_190px_170px_1fr] lg:items-end">
          <SelectField label="Outlet" value={activeRecipeOutletId} options={recipeOutletOptions} onChange={setSelectedOutletId} searchable />
          <SelectField label="Category" value={recipeFilters.category} options={[{ value: "all", label: "All Categories" }, ...activeMenuCategories.map((category) => ({ value: category.name, label: category.name }))]} onChange={(value) => updateRecipeFilter("category", value)} />
          <SelectField label="Status" value={recipeFilters.status} options={[{ value: "all", label: "All Status" }, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={(value) => updateRecipeFilter("status", value)} />
          <label>
            <div className="mb-1 type-caption font-semibold text-text-secondary">Search recipe/menu item</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
              <input className="control h-9 w-full pl-9 text-[13px]" value={recipeFilters.search} onChange={(event) => updateRecipeFilter("search", event.target.value)} placeholder="Search recipe, outlet or ingredient" />
            </div>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total Recipes" value={filteredRecipes.length} helper="Current filters" size="compact" />
          <MetricCard label="Average Recipe Cost" value={toCurrency(averageRecipeCost)} helper="Ingredient + wastage" size="compact" />
          <MetricCard label="Average Margin" value={formatRecipeMargin(averageMargin)} helper="Priced recipes only" tone={recipeMarginTone(averageMargin)} size="compact" />
          <MetricCard label="Highest Cost Recipe" value={highestCostRecipe ? recipeDisplayName(highestCostRecipe.recipe) : "—"} helper={highestCostRecipe ? toCurrency(highestCostRecipe.summary.totalCost) : "No recipes"} tone={highestCostRecipe?.summary?.totalCost ? "warning" : "neutral"} size="compact" />
        </div>
        <DashboardSection title="Recipe BOM Setup" subtitle="Link menu/product items to outlet-linked inventory ingredients.">
          {filteredRecipes.length ? (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Recipe</th>
                    <th>Category</th>
                    <th>Ingredients</th>
                    <th>Estimated Cost</th>
                    <th>Selling Price</th>
                    <th>Margin</th>
                    <th>Status</th>
                    <th className="pr-8 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {recipeCostRows.map(({ recipe, summary, margin }) => (
                    <tr key={recipe.id} className="transition hover:bg-primary/5">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-2xl border border-border bg-slate-100">
                            {recipe.recipePhotoUrl || recipe.recipe_photo_url
                              ? <img className="h-full w-full object-cover" src={recipe.recipePhotoUrl || recipe.recipe_photo_url} alt={recipeNameEn(recipe) || recipeNameCn(recipe) || recipeCode(recipe)} />
                              : <div className="flex h-full w-full items-center justify-center text-sm font-black text-text-muted">{String(recipeNameEn(recipe) || recipeNameCn(recipe) || recipeCode(recipe) || "R").slice(0, 1).toUpperCase()}</div>}
                          </div>
                          <div className="min-w-0">
                            <div className="type-caption font-black uppercase tracking-wide text-text-muted">{recipeCode(recipe) || "No code"}</div>
                            <div className="font-bold text-text-primary">{recipeNameEn(recipe) || "Recipe Name EN required"}</div>
                            <div className="type-caption text-text-secondary">{recipeNameCn(recipe) || "Recipe Name CN required"}</div>
                            <div className="type-caption text-text-secondary">{outletById.get(recipe.outletId)?.name || "Outlet"} · {recipe.servingSize || "1 portion"}</div>
                          </div>
                        </div>
                      </td>
                      <td><Badge tone="info">{recipe.menuCategory || "Uncategorized"}</Badge></td>
                      <td>
                        <RecipeIngredientPreviewPill recipe={recipe} itemById={itemById} />
                      </td>
                      <td className="font-black text-text-primary">{toCurrency(summary.totalCost)}</td>
                      <td className="font-bold text-text-secondary">{recipe.sellingPrice !== "" && recipe.sellingPrice !== null && recipe.sellingPrice !== undefined ? toCurrency(recipe.sellingPrice) : "—"}</td>
                      <td><Badge tone={recipeMarginTone(margin)}>{formatRecipeMargin(margin)}</Badge></td>
                      <td><Badge tone={statusTone(recipe.status)}>{toTitle(recipe.status || "active")}</Badge></td>
                      <td className="pr-8">
                        <div className="flex justify-end gap-2">
                          <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setModal({ type: "recipe-detail", recipe })}>View</button>
                          <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageRecipes, "edit recipes") && setModal({ type: "recipe", recipe })}>Edit</button>
                          {recipe.status === "active" ? <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => archiveRecipe(recipe.id)}>Archive</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-3">
              <EmptyState
                title="No recipes set up yet."
                description="Create recipes to connect menu items with inventory ingredients and estimate future usage variance."
              />
              <div className="flex justify-center">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => {
                    if (!requirePermission(can.manageRecipes, "add recipes")) return;
                    if (!activeRecipeOutletId) {
                      notify("Select an outlet before adding a recipe", "Recipes are outlet-specific and use the currently selected outlet context.", "warning");
                      return;
                    }
                    setModal({ type: "recipe", outletId: activeRecipeOutletId });
                  }}
                >
                  Add Recipe
                </button>
              </div>
            </div>
          )}
        </DashboardSection>
        <DashboardSection
          title="Product ↔ Recipe Mapping"
          subtitle="Connect Product Analytics products to recipes so Recipe Intelligence can use real sales volume and revenue."
          density="compact"
        >
          <div className="grid gap-3 lg:grid-cols-3">
            <MetricCard label="Unmapped Products" value={unmappedProductRows.length} helper="Product Analytics products needing review" tone={unmappedProductRows.length ? "warning" : "success"} size="compact" />
            <MetricCard label="Mapped Products" value={mappedProductKeys.size} helper="Saved in product recipe mappings" tone={mappedProductKeys.size ? "success" : "neutral"} size="compact" />
            <MetricCard label="Suggested Matches" value={unmappedProductRows.filter((row) => row.suggestedRecipe).length} helper="Matched by code, EN name or CN name" tone="info" size="compact" />
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            {unmappedProductRows.length ? (
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Unmapped Product</th>
                    <th>Suggested Recipe Match</th>
                    <th>Confidence</th>
                    <th>Manual Mapping</th>
                    <th className="pr-8 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {unmappedProductRows.map((row) => {
                    const selectedRecipe = mappingCandidateRecipes.find((recipe) => recipe.id === row.selectedRecipeId);
                    const confidenceTone = row.confidence >= 90 ? "success" : row.confidence >= 60 ? "warning" : "neutral";
                    return (
                      <tr key={row.key} className="transition hover:bg-primary/5">
                        <td className="px-3 py-3">
                          <div className="font-bold text-text-primary">{row.productName}</div>
                          <div className="type-caption text-text-secondary">{Number(row.quantity || 0).toLocaleString()} sold · {toCurrency(row.revenue)}</div>
                        </td>
                        <td>
                          {row.suggestedRecipe ? (
                            <div>
                              <div className="font-bold text-text-primary">{recipeNameEn(row.suggestedRecipe) || recipeCode(row.suggestedRecipe)}</div>
                              <div className="type-caption text-text-muted">{recipeCode(row.suggestedRecipe)} · {recipeNameCn(row.suggestedRecipe) || "No CN name"}</div>
                            </div>
                          ) : (
                            <span className="type-caption font-semibold text-text-muted">No suggestion</span>
                          )}
                        </td>
                        <td>
                          {row.suggestedRecipe ? <Badge tone={confidenceTone}>{row.confidence}%</Badge> : <Badge tone="neutral">Manual</Badge>}
                        </td>
                        <td>
                          <SelectField
                            value={row.selectedRecipeId}
                            options={[
                              { value: "", label: "Choose recipe" },
                              ...mappingCandidateRecipes.map((recipe) => ({
                                value: recipe.id,
                                label: `${recipeCode(recipe) || "No code"} · ${recipeNameEn(recipe) || recipeNameCn(recipe) || "Recipe"}`,
                              })),
                            ]}
                            onChange={(value) => setRecipeMappingSelections((current) => ({ ...current, [row.key]: value }))}
                            searchable
                          />
                          {selectedRecipe ? <div className="mt-1 type-caption text-text-muted">{recipeNameCn(selectedRecipe) || "No Chinese name"}</div> : null}
                        </td>
                        <td className="pr-8">
                          <div className="flex justify-end gap-2">
                            <button
                              className="btn-primary h-8 px-3 text-xs"
                              type="button"
                              disabled={!row.selectedRecipeId || savingRecipeMappingKey === row.key}
                              onClick={() => saveRecipeProductMapping(row.productName, row.selectedRecipeId)}
                            >
                              {savingRecipeMappingKey === row.key ? "Mapping..." : "Map"}
                            </button>
                            <button
                              className="btn-secondary h-8 px-3 text-xs"
                              type="button"
                              disabled={savingRecipeMappingKey === row.key}
                              onClick={() => setIgnoredRecipeProductKeys((current) => new Set([...current, row.key]))}
                            >
                              Ignore
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title={recipeProductLoading ? "Loading Product Analytics products..." : "No unmapped products"}
                description={recipeProductLoading ? "Recipe mapping suggestions will appear after Product Analytics data loads." : "All Product Analytics products in this period are mapped or ignored for this session."}
              />
            )}
          </div>
        </DashboardSection>
        <DashboardSection
          title="Recipe Intelligence"
          subtitle="Identify profitable menu items, highest cost recipes and key ingredient cost drivers."
        >
          <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
            <RecipeMappingHealth mapped={mappedRecipeCount} unmapped={unmappedProductCount} totalRecipes={mappingCandidateRecipes.length} loading={recipeProductLoading} />
            <SelectField
              label="Analysis Period"
              value={recipeAnalysisPeriod}
              options={recipeAnalysisPeriodOptions.map((option) => ({ value: option.value, label: option.label }))}
              onChange={setRecipeAnalysisPeriod}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
            <RecipeIntelligenceCard
              title="Menu Engineering Matrix"
              description="Product Analytics source: X = Qty Sold, Y = Margin %, bubble size = Revenue."
            >
              {mappedRecipeCount < 10 ? (
                <RecipeIntelligenceLockedState mappedCount={mappedRecipeCount} />
              ) : (
                <RecipeMenuEngineeringMatrix rows={menuEngineeringRows} />
              )}
            </RecipeIntelligenceCard>
            <RecipeInsightsPanel rows={reliableMenuEngineeringRows} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RecipeIntelligenceCard
              title="Top Margin Products"
              description="Highest margin recipes within the selected outlet and filters."
              showViewAll
            >
              <RecipeRankingTable
                rows={topMarginRows}
                columns={[
                  { key: "recipe", label: "Recipe", render: (row) => <div className="font-bold text-text-primary">{row.label}</div> },
                  { key: "margin", label: "Margin %", render: (row) => <Badge tone={recipeMarginTone(row.value)}>{formatRecipeMargin(row.value)}</Badge> },
                  { key: "profit", label: "Profit", render: (row) => <span className="font-black text-text-primary">{toCurrency(row.profitPerServing)}</span> },
                ]}
                emptyTitle="No margin data yet"
                emptyDescription="Add selling prices to recipes to compare product margin."
              />
            </RecipeIntelligenceCard>
            <RecipeIntelligenceCard
              title="Highest Cost Ingredients"
              description="Ingredient cost drivers aggregated across visible recipes."
              showViewAll
            >
              <RecipeRankingTable
                rows={highestCostIngredientRows}
                columns={[
                  { key: "ingredient", label: "Ingredient", render: (row) => <div className="font-bold text-text-primary">{row.label}</div> },
                  { key: "cost", label: "Cost Contribution", render: (row) => <span className="font-black text-text-primary">{toCurrency(row.value)}</span> },
                ]}
                emptyTitle="No ingredient cost data yet"
                emptyDescription="Add recipe ingredients with inventory costs to identify cost drivers."
              />
            </RecipeIntelligenceCard>
            <RecipeIntelligenceCard
              title="Top Revenue Recipes"
              description="Mapped recipes ranked by Product Analytics revenue."
              showViewAll
            >
              <RecipeRankingTable
                rows={topRevenueRows}
                columns={[
                  { key: "recipe", label: "Recipe", render: (row) => <div><div className="font-bold text-text-primary">{recipeNameEn(row.recipe) || row.label}</div><div className="type-caption text-text-muted">{recipeNameCn(row.recipe) || recipeCode(row.recipe)}</div></div> },
                  { key: "revenue", label: "Revenue", render: (row) => <span className="font-black text-text-primary">{toCurrency(row.revenue)}</span> },
                ]}
                emptyTitle="No revenue data yet"
                emptyDescription="Map Product Analytics products to recipes to rank recipe revenue."
              />
            </RecipeIntelligenceCard>
            <RecipeIntelligenceCard
              title="Lowest Margin Products"
              description="Lowest priced margins sorted ascending."
              showViewAll
            >
              <RecipeRankingTable
                rows={lowestMarginRows}
                columns={[
                  { key: "recipe", label: "Recipe", render: ({ recipe }) => <div><div className="font-bold text-text-primary">{recipeNameEn(recipe) || recipeCode(recipe)}</div><div className="type-caption text-text-muted">{recipeNameCn(recipe) || "—"}</div></div> },
                  { key: "cost", label: "Cost", render: ({ summary }) => <span className="font-bold text-text-secondary">{toCurrency(summary.totalCost)}</span> },
                  { key: "price", label: "Price", render: ({ recipe }) => recipe.sellingPrice !== "" && recipe.sellingPrice !== null && recipe.sellingPrice !== undefined ? toCurrency(recipe.sellingPrice) : "—" },
                  { key: "margin", label: "Margin %", render: ({ margin }) => <Badge tone={recipeMarginTone(margin)}>{formatRecipeMargin(margin)}</Badge> },
                  { key: "profit", label: "Profit", render: ({ recipe, summary }) => <span className="font-black text-text-primary">{toCurrency(Number(recipe.sellingPrice || 0) - Number(summary.totalCost || 0))}</span> },
                ]}
                emptyTitle="No margin data yet"
                emptyDescription="Add selling prices and costed ingredients to identify lowest margin recipes."
              />
            </RecipeIntelligenceCard>
          </div>
        </DashboardSection>
        <DashboardSection title="Usage Estimate" subtitle="Future-ready product sales to ingredient usage foundation." density="compact">
          <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
            <div className="type-title font-bold text-text-primary">Product sales quantity × recipe ingredient quantity = estimated inventory usage</div>
            <p className="mt-1 type-body-sm text-text-secondary">Upload product sales reports and connect menu items to recipes to estimate ingredient usage.</p>
          </div>
        </DashboardSection>
      </div>
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
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.importMaster, "import master inventory") && setModal({ type: "inventory-import" })}>
            <Upload size={15} /> Import
          </button>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.exportMaster, "export inventory") && exportMasterInventory()}>
            <Download size={15} /> Export
          </button>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.viewCategories, "view inventory categories") && setModal({ type: "category-settings" })}>
            Category Settings
          </button>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.viewUoms, "view inventory UOM settings") && setModal({ type: "uom-settings" })}>
            UOM Settings
          </button>
          <button className="btn-primary" type="button" onClick={() => requirePermission(can.createMaster, "add inventory items") && setModal({ type: "item" })}>
            <PackagePlus size={15} /> Add Item
          </button>
        </>
      );
    }
    if (activeTab === "par-levels") {
      return (
        <button className="btn-secondary" type="button" onClick={() => requirePermission(can.exportParLevels, "export par levels") && exportParLevels()}>
          <Download size={15} /> Export
        </button>
      );
    }
    if (activeTab === "groups") {
      return <button className="btn-primary" type="button" onClick={openCreateGroup}><PackagePlus size={15} /> Add Group</button>;
    }
    if (activeTab === "stock-check") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.createCheck, "create audit stock checks") && setModal({ type: "audit-stock-check" })}><ClipboardCheck size={15} /> Audit Stock Check</button>;
    }
    if (activeTab === "requests") return null;
    if (activeTab === "orders") {
      return <button className="btn-secondary" type="button" onClick={() => requirePermission(can.exportPo, "export purchase orders") && exportPurchaseOrders()}><Download size={15} /> Export</button>;
    }
    if (activeTab === "movements") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.recordMovement, "record inventory movements") && setModal({ type: "movement" })}><RefreshCw size={15} /> Record Movement</button>;
    }
    if (activeTab === "waste") {
      return <button className="btn-primary" type="button" onClick={openRecordWaste}>Record Waste</button>;
    }
    if (activeTab === "recipes") {
      const openAddRecipe = () => {
        if (!requirePermission(can.manageRecipes, "add recipes")) return;
        const activeRecipeOutletId = selectedOutletId === "all" ? (getAccessibleOutlets(auth, outlets)[0]?.id || outlets[0]?.id || "") : selectedOutletId;
        if (!activeRecipeOutletId) {
          notify("Select an outlet before adding a recipe", "Recipes are outlet-specific and use the currently selected outlet context.", "warning");
          return;
        }
        setModal({ type: "recipe", outletId: activeRecipeOutletId });
      };
      return (
        <>
          <button className="btn-secondary" type="button" onClick={exportRecipes}><Download size={15} /> Export</button>
          <button className="btn-secondary" type="button" onClick={() => requirePermission(can.manageRecipes, "manage recipe menu categories") && setModal({ type: "recipe-menu-categories" })}>Menu Categories</button>
          <button className="btn-primary" type="button" onClick={openAddRecipe}><PackagePlus size={15} /> Add Recipe</button>
        </>
      );
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

      {renderActiveTab()}

      {modal?.type === "item" ? <InventoryItemModal item={modal.item} categories={sortedCategories} outlets={outlets} uoms={sortedUoms} canCreateUom={can.createUom} onAddUom={saveQuickUom} onClose={() => setModal(null)} onSave={saveItem} /> : null}
      {modal?.type === "inventory-import" ? (
        <InventoryImportModal
          categories={sortedCategories}
          outlets={outlets}
          items={data.items}
          uoms={sortedUoms}
          onClose={() => setModal(null)}
          onImport={importInventoryRows}
        />
      ) : null}
      {modal?.type === "category-settings" ? (
        <CategorySettingsModal
          categories={sortedActiveCategories}
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
      {modal?.type === "uom-settings" ? (
        <UomSettingsModal
          uoms={sortedActiveUoms}
          remoteRows={sortedUoms.length}
          visibleRows={sortedActiveUoms.length}
          lastWriteStatus={uomWriteStatus}
          canAdd={can.createUom}
          canEdit={can.editUom}
          canDelete={can.deleteUom}
          requirePermission={requirePermission}
          onClose={() => setModal(null)}
          onAdd={() => setModal({ type: "uom", returnToSettings: true })}
          onEdit={(uom) => setModal({ type: "uom", uom, returnToSettings: true })}
          onArchive={archiveUom}
          onDelete={deleteUom}
        />
      ) : null}
      {modal?.type === "uom" ? <UomModal uom={modal.uom} onClose={() => setModal(modal.returnToSettings ? { type: "uom-settings" } : null)} onSave={saveUom} /> : null}
      {modal?.type === "group" ? <GroupModal group={modal.group} outletId={modal.outletId || selectedOutletId} outlets={outlets} items={data.items} categories={sortedCategories} onClose={() => setModal(null)} onSave={saveGroup} /> : null}
      {modal?.type === "audit-stock-check" ? <AuditStockCheckModal outlets={outlets} categories={sortedCategories} items={data.items} onClose={() => setModal(null)} onStart={startAuditStockCheck} /> : null}
      {modal?.type === "skip-check-row" ? <SkipReasonModal itemName={modal.itemName} onClose={() => setModal(null)} onSave={(reason) => skipCheckRow(modal.rowIndex, reason)} /> : null}
      {modal?.type === "movement" ? <MovementModal outlets={outlets} items={data.items} onClose={() => setModal(null)} onSave={saveMovement} /> : null}
      {modal?.type === "waste-detail" ? (() => {
        const waste = modal.waste || {};
        const item = itemById.get(waste.itemId);
        const outlet = outletById.get(waste.outletId);
        const category = categoryById.get(item?.categoryId);
        const movement = data.movements.find((entry) => entry.referenceType === "waste" && entry.referenceId === waste.id);
        const evidenceUrl = waste.photoUrl || waste.photo_url || "";
        return (
          <Modal
            title="Waste Record Detail"
            description={`${outlet?.name || "Outlet"} · ${formatDate(waste.date || waste.createdAt)}`}
            size="lg"
            onClose={() => setModal(null)}
            footer={<button className="btn-secondary" type="button" onClick={() => setModal(null)}>Close</button>}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard label="Date" value={formatDate(waste.date || waste.createdAt)} helper="Waste date" size="compact" />
              <MetricCard label="Outlet" value={outlet?.name || "Outlet"} helper={outletDisplayCode(outlet)} size="compact" />
              <MetricCard label="Item" value={item?.name || "Inventory item"} helper={item?.sku || "No SKU"} size="compact" />
              <MetricCard label="Category" value={category?.name || "Uncategorized"} helper="Inventory category" size="compact" />
              <MetricCard label="Waste Type" value={toTitle(waste.wasteType || "waste")} helper="Recorded classification" tone="warning" size="compact" />
              <MetricCard label="Quantity" value={`${waste.quantity || 0} ${waste.unit || item?.unit || ""}`.trim()} helper="Recorded waste amount" tone="warning" size="compact" />
              <MetricCard label="Recorded By" value={actorNameByAnyId(waste.recordedBy || waste.user)} helper="Record owner" size="compact" />
              <MetricCard label="Movement Reference" value={movement?.reference || "—"} helper={movement ? "Inventory movement created" : "No movement linked"} size="compact" />
            </div>
            <div className="mt-3 rounded-2xl border border-border bg-slate-50 p-3 type-body-sm text-text-secondary">
              {waste.notes || "No notes recorded."}
            </div>
            <div className="mt-3 rounded-2xl border border-border bg-slate-50 p-3">
              <div className="type-caption font-semibold text-text-secondary">Evidence Photo</div>
              {evidenceUrl ? (
                <button className="mt-2 block overflow-hidden rounded-2xl border border-border bg-white" type="button" onClick={() => setPhotoPreview({ src: evidenceUrl, title: `${item?.name || "Waste"} evidence` })}>
                  <img className="max-h-72 w-full object-cover" src={evidenceUrl} alt="Waste evidence" />
                </button>
              ) : <div className="mt-2 type-body-sm font-semibold text-text-muted">No evidence photo uploaded.</div>}
            </div>
          </Modal>
        );
      })() : null}
      {modal?.type === "waste" ? (
        <WasteModal
          outlet={outletById.get(modal.outletId || selectedOutletId)}
          items={data.items.filter((item) => item.status === "active" && itemHasActiveOutletLink(item, modal.outletId || selectedOutletId))}
          onClose={() => setModal(null)}
          onSave={saveWaste}
        />
      ) : null}
      {modal?.type === "recipe" ? (
        <RecipeModal
          recipe={modal.recipe}
          outletId={modal.recipe?.outletId || modal.outletId || selectedOutletId}
          outlet={outletById.get(modal.recipe?.outletId || modal.outletId || selectedOutletId)}
          items={data.items}
          menuCategories={data.menuCategories || []}
          existingRecipes={data.recipes || []}
          onClose={() => setModal(null)}
          onSave={saveRecipe}
        />
      ) : null}
      {modal?.type === "recipe-menu-categories" ? (
        <MenuCategorySettingsModal
          categories={data.menuCategories || []}
          canManage={can.manageRecipes}
          requirePermission={requirePermission}
          onClose={() => setModal(null)}
          onAdd={() => setModal({ type: "recipe-menu-category", returnToSettings: true })}
          onEdit={(category) => setModal({ type: "recipe-menu-category", category, returnToSettings: true })}
          onArchive={archiveMenuCategory}
          onSort={sortMenuCategories}
        />
      ) : null}
      {modal?.type === "recipe-menu-category" ? (
        <MenuCategoryModal
          category={modal.category}
          onClose={() => setModal(modal.returnToSettings ? { type: "recipe-menu-categories" } : null)}
          onSave={saveMenuCategory}
        />
      ) : null}
      {modal?.type === "recipe-detail" ? (
        <RecipeDetailModal
          recipe={modal.recipe}
          outlet={outletById.get(modal.recipe?.outletId)}
          items={data.items}
          categories={sortedCategories}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ type: "recipe", recipe: modal.recipe })}
        />
      ) : null}
      {modal?.type === "po-edit" ? <PurchaseOrderEditModal order={modal.order} suppliers={suppliers} items={data.items} onClose={() => setModal(null)} onSave={savePurchaseOrder} /> : null}
      {modal?.type === "po-receive" ? (
        <ReceiveInventoryModal
          order={modal.order}
          supplier={suppliers.find((supplier) => supplier.id === modal.order.supplierId)}
          outlet={outletById.get(modal.order.outletId || modal.order.outletIds?.[0])}
          items={data.items}
          onClose={() => setModal(null)}
          onReceive={(rows, remark) => receivePurchaseOrder(modal.order, rows, remark)}
        />
      ) : null}
      {modal?.type === "po-cancel" ? <CancelPurchaseOrderModal order={modal.order} onClose={() => setModal(null)} onCancel={(reason) => cancelPurchaseOrder(modal.order, reason)} /> : null}
      {modal?.type === "po-complete" ? <CompletePurchaseOrderModal order={modal.order} onClose={() => setModal(null)} onComplete={(reason) => completePurchaseOrder(modal.order, reason)} /> : null}
      {modal?.type === "po-copy-text" ? <CopyPoTextModal text={modal.text} onClose={() => setModal(null)} onCopy={copyRawText} /> : null}
      {modal?.type === "purchase-suggestions" ? (
        <PurchaseSuggestionsModal
          suggestions={modal.suggestions}
          suppliers={suppliers}
          outlet={outletById.get(modal.stockCheck.outletId)}
          existingOrders={modal.existingOrders || linkedPurchaseOrdersForStockCheck(modal.stockCheck?.id)}
          onClose={() => setModal(null)}
          onCreateDraftPo={(rows) => createDraftPurchaseOrders(modal.stockCheck, rows)}
          onViewPurchaseOrder={(order) => setModal({ type: "po-detail", order })}
        />
      ) : null}
      {modal?.type === "check-result" ? (() => {
        const stockCheck = modal.stockCheck || {};
        const isAuditResult = modal.isAudit || stockCheck.stockCheckType === "audit";
        const rows = stockCheck.rows || [];
        const summary = rows.reduce((acc, row) => {
          const result = stockCheckResultStatus(row);
          acc.total += 1;
          if (result.label === "Normal") acc.normal += 1;
          if (result.label === "Shortage") acc.shortage += 1;
          if (result.label === "Excess") acc.excess += 1;
          if (result.label === "Skipped") acc.skipped += 1;
          return acc;
        }, { total: 0, normal: 0, shortage: 0, excess: 0, skipped: 0 });
        const submittedByName = stockCheck.submittedBy ? actorNameByEmployeeId(stockCheck.submittedBy) : "Unknown User";
        const outletName = outletById.get(stockCheck.outletId)?.name || "Outlet";
        const shiftLabel = isAuditResult ? (stockCheck.auditType || "Audit") : (stockCheck.shift || "Stock Check");
        return (
          <Modal
            title={isAuditResult ? "Audit Stock Check Result" : "Stock Check Result"}
            description={`${outletName} · ${formatDate(stockCheck.date)} · ${shiftLabel}`}
            size="xl"
            onClose={() => setModal(null)}
            footer={<button className="btn-secondary" type="button" onClick={() => setModal(null)}>Close</button>}
          >
            <div className="mb-4 rounded-2xl border border-border bg-slate-50 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="type-caption font-black uppercase text-text-muted">Checked by</div>
                  <div className="type-section-title font-black text-text-primary">{submittedByName}</div>
                </div>
                <div>
                  <div className="type-caption font-black uppercase text-text-muted">Submitted at</div>
                  <div className="type-section-title font-black text-text-primary">{formatDateTimeCompact(stockCheck.submittedAt)}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                {[
                  ["Total Items", summary.total, "neutral"],
                  ["Normal", summary.normal, "success"],
                  ["Shortage", summary.shortage, "warning"],
                  ["Excess", summary.excess, "info"],
                  ["Skipped", summary.skipped, "neutral"],
                ].map(([label, value, tone]) => (
                  <div key={label} className="rounded-xl border border-border bg-white p-3">
                    <div className="type-micro font-black uppercase text-text-muted">{label}</div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="type-metric font-black text-text-primary">{value}</span>
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[820px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th>Par</th>
                    <th>Actual</th>
                    <th>Variance</th>
                    <th>UOM</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th>Skip Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {rows.map((row) => {
                    const item = itemById.get(row.itemId);
                    const category = categoryById.get(item?.categoryId);
                    const result = stockCheckResultStatus(row);
                    return (
                      <tr key={row.id || row.itemId}>
                        <td className="px-3 py-2">
                          <div className="flex min-w-[240px] items-center gap-3">
                            <InventoryItemThumbnail item={item} category={category} onPreview={setPhotoPreview} size="sm" />
                            <div className="min-w-0">
                              <div className="font-bold text-text-primary">{item?.name || "Inventory item"}</div>
                              <div className="type-caption text-text-secondary">
                                {category?.name ?? "Uncategorized"}{item?.sku ? ` · ${item.sku}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>{row.expectedQty || "-"}</td>
                        <td>{row.skipped ? "Skipped" : row.actualCount}</td>
                        <td>{row.skipped ? "Skipped" : row.variance}</td>
                        <td>{row.unit || item?.unit || "-"}</td>
                        <td><Badge tone={result.tone}>{result.label}</Badge></td>
                        <td className="max-w-[220px] whitespace-pre-wrap py-2 pr-3 text-text-secondary">{row.notes || "-"}</td>
                        <td className="max-w-[220px] whitespace-pre-wrap py-2 pr-3 text-text-secondary">{row.skipReason || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Modal>
        );
      })() : null}
      {modal?.type === "po-detail" ? (() => {
        const order = modal.order;
        const progress = poProgress(order);
        const supplier = suppliers.find((entry) => entry.id === order.supplierId);
        const outlet = outletById.get(order.outletId || order.outletIds?.[0]);
        const sourceCheck = data.checks.find((check) => check.id === order.sourceStockCheckId);
        const balance = Math.max(0, progress.ordered - progress.received);
        const isReceivable = ["submitted", "supplier_confirmed", "partial_received"].includes(order.status) && balance > 0;
        const workflowSteps = [
          { key: "created", label: "Created", date: order.createdAt, complete: Boolean(order.createdAt) },
          { key: "submitted", label: "Submitted", date: order.submittedAt, complete: Boolean(order.submittedAt) || order.status !== "draft" },
          { key: "receiving", label: "Receiving", date: order.receipts?.[0]?.receivedAt, complete: progress.received > 0 || ["fully_received", "completed"].includes(order.status) },
          { key: "completed", label: "Completed", date: order.completedAt, complete: Boolean(order.completedAt) || order.status === "completed" },
        ];
        const workflowIndex = order.status === "draft" ? 0 : ["submitted", "supplier_confirmed"].includes(order.status) ? 1 : ["partial_received", "fully_received"].includes(order.status) ? 2 : order.status === "completed" ? 3 : -1;
        const sourceName = sourceCheck ? `${sourceCheck.auditName || sourceCheck.groupName || "Stock Check"} · ${formatDate(sourceCheck.date)}` : order.sourceStockCheckId || "Manual purchase planning";

        return (
          <Modal
            title="Purchase Order Detail"
            description={`${order.poNo} · ${supplier?.name || "Supplier"} · ${outlet?.name || "Outlet"}`}
            size="xl"
            onClose={() => setModal(null)}
            footer={<button className="btn-secondary" type="button" onClick={() => setModal(null)}>Close</button>}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={order.status === "partial_received" ? "warning" : statusTone(order.status)}>{poStatusLabel(order.status)}</Badge>
                <div className="flex flex-wrap justify-end gap-2">
                  {isReceivable ? <button className="btn-primary" type="button" onClick={() => requirePermission(can.receivePo, "receive inventory") && setModal({ type: "po-receive", order })}><Truck size={15} /> Receive</button> : null}
                  <button className="btn-secondary" type="button" onClick={() => copyPurchaseOrderText(order)}><Copy size={15} /> Copy PO Text</button>
                  <button className="btn-secondary" type="button" onClick={() => { notify("Export PDF", "Use the print dialog to save this PO as PDF."); window.print(); }}><Download size={15} /> Export PDF</button>
                  <button className="btn-secondary" type="button" onClick={() => window.print()}><FileText size={15} /> Print</button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-2xl border border-border bg-surface p-3">
                  <div className="mb-3 type-title font-bold text-text-primary">Generated From</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><div className="type-caption font-semibold text-text-muted">Source Type</div><div className="mt-1 type-body-sm font-bold text-text-primary">{poSourceLabel(order.sourceType)}</div></div>
                    <div><div className="type-caption font-semibold text-text-muted">Source Name</div><div className="mt-1 type-body-sm font-bold text-text-primary">{sourceName}</div></div>
                    <div><div className="type-caption font-semibold text-text-muted">Created Date</div><div className="mt-1 type-body-sm font-bold text-text-primary">{formatDate(order.createdAt)}</div></div>
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-surface p-3">
                  <div className="mb-3 type-title font-bold text-text-primary">Supplier Contact</div>
                  <div className="grid gap-2 type-body-sm">
                    <div className="flex justify-between gap-3"><span className="text-text-secondary">Supplier</span><span className="font-bold text-text-primary">{supplier?.name || "Supplier"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-text-secondary">Phone</span><span className="font-bold text-text-primary">{supplier?.phone || supplier?.contactPhone || "Not configured"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-text-secondary">Email</span><span className="font-bold text-text-primary">{supplier?.email || "Not configured"}</span></div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-3">
                <div className="mb-3 type-title font-bold text-text-primary">Workflow Progress</div>
                <div className="grid gap-2 sm:grid-cols-4">
                  {workflowSteps.map((step, index) => {
                    const active = workflowIndex === index;
                    const complete = step.complete || workflowIndex > index;
                    return (
                      <div key={step.key} className={`rounded-2xl border p-3 ${active ? "border-primary/30 bg-primary/8" : complete ? "border-emerald-200 bg-emerald-50/70" : "border-border bg-slate-50"}`}>
                        <div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black ${complete ? "bg-emerald-600 text-white" : active ? "bg-primary text-white" : "bg-slate-200 text-text-muted"}`}>{index + 1}</span><span className="type-body-sm font-black text-text-primary">{step.label}</span></div>
                        <div className="mt-2 type-caption font-semibold text-text-secondary">{step.date ? formatDate(step.date) : "Pending"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div><div className="type-title font-bold text-text-primary">Fulfillment</div><div className="type-caption text-text-secondary">{progress.received} / {progress.ordered} received</div></div>
                  <Badge tone={order.status === "partial_received" ? "warning" : progress.percent >= 100 ? "success" : "info"}>{progress.percent}% fulfilled</Badge>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${order.status === "partial_received" ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, progress.percent)}%` }} /></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Ordered Qty" value={progress.ordered} helper="Original order" size="compact" />
                  <MetricCard label="Received Qty" value={progress.received} helper="Confirmed received" tone={progress.received ? "success" : "neutral"} size="compact" />
                  <MetricCard label="Balance" value={balance} helper={order.status === "completed" && order.completionType === "partial" ? "Unfulfilled" : "Open balance"} tone={balance ? "warning" : "success"} size="compact" />
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted"><tr><th className="px-3 py-2">Item</th><th>Order Qty</th><th>Received</th><th>Balance</th><th>Unit</th><th>Remark</th></tr></thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {order.lines.map((line) => {
                      const item = itemById.get(line.itemId);
                      return <tr key={line.id || line.itemId}><td className="px-3 py-2 font-bold text-text-primary">{item?.name || "Inventory item"}</td><td>{line.requestedQty}</td><td>{line.receivedQty || 0}</td><td className={remainingQty(line) ? "font-bold text-amber-700" : "font-semibold text-emerald-700"}>{remainingQty(line)}</td><td>{line.unit || item?.unit || ""}</td><td>{line.remark || "-"}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>

              <div className="rounded-2xl border border-border p-3">
                <div className="mb-3 type-title font-bold text-text-primary">Receiving History</div>
                {order.receipts?.length ? (
                  <div className="space-y-3">
                    {order.receipts.map((receipt) => {
                      const receiptQty = (receipt.items || []).reduce((sum, line) => sum + Number(line.receivedQty || 0), 0);
                      return (
                        <div key={receipt.id} className="relative pl-5">
                          <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2"><div className="type-body-sm font-black text-text-primary">{formatDate(receipt.receivedAt)}</div><Badge tone="success">+{receiptQty} qty</Badge></div>
                            <div className="mt-1 type-caption font-semibold text-text-secondary">Received By: {actorNameByAnyId(receipt.receivedBy)}</div>
                            {receipt.remark ? <div className="mt-1 type-caption text-text-secondary">Remark: {receipt.remark}</div> : null}
                            <div className="mt-2 space-y-1">{(receipt.items || []).map((line) => <div key={line.id} className="type-caption text-text-secondary">{itemById.get(line.itemId)?.name || "Inventory item"} · +{line.receivedQty} {line.unit}{line.remark ? ` · ${line.remark}` : ""}</div>)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="type-caption font-semibold text-text-muted">No receiving records yet.</div>}
              </div>

              {order.cancellationReason ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 type-body-sm font-semibold text-rose-800">Cancellation reason: {order.cancellationReason}</div> : null}
            </div>
          </Modal>
        );
      })() : null}
      <InventoryItemPhotoPreview preview={photoPreview} onClose={() => setPhotoPreview(null)} />
    </div>
  );
}

export default InventoryControlPage;
