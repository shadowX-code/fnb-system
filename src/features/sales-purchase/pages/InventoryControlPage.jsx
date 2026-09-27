import InventoryPurchaseOrderSurface from "../inventory/purchaseOrders/InventoryPurchaseOrderSurface.jsx";
import { mapRemotePurchaseOrder, persistRemotePurchaseOrderReceive, fetchRemotePurchaseOrder } from "../inventory/purchaseOrders/inventoryPurchaseOrderService.js";
export { ReceiveInventoryModal } from "../inventory/purchaseOrders/ReceiveInventoryModal.jsx";
import { subscribeInventoryRevalidation } from "../../../services/inventoryRevalidation.js";
import { TextArea } from "../inventory/InventorySharedPresentation.jsx";
import InventoryParLevelsPage from "../inventory/parLevels/InventoryParLevelsPage.jsx";
import { mapRemoteInventoryItem, normalizeOutletRecord, normalizeInventoryItem, uniqueIds, buildOutletConfig, mapRemoteCategory, outletConfigForItem, isActiveInventoryItem, categoryForItem, canonical, isUuid, outletDisplayName, outletDisplayCode } from "../inventory/inventoryItemModel.js";
import { InventoryCategoryIcon, SectionCard, selectInputText, parseNonNegativeNumber, csvEscape, downloadTextFile, todayInput, getBusinessDateInput, toDateInputValue } from "../inventory/InventorySharedPresentation.jsx";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
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
  Upload,
  Warehouse,
  X,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import DashboardSection from "../../../components/layout/DashboardSection.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../components/forms/AdminSearchField.jsx";
import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { supabase } from "../../../lib/supabase.ts";
import { inventoryLifecycleService } from "../../../services/inventoryLifecycleService.js";
import { readCompleteInventoryRows } from "../../../services/inventoryCompleteRead.js";
import InventoryRecipesPage from "../inventory/recipes/InventoryRecipesPage.jsx";
import { recipeMenuCategories } from "../inventory/recipes/inventoryRecipeReadModel.js";
import { Field } from "../inventory/InventorySharedPresentation.jsx";
import { formatRestaurantRecipeCurrency, mapRemoteMenuCategory, recipeCode, recipeNameEn, recipeNameCn, normalizeProductRecipeKey, monthSerial, serialToMonthParts, businessMonthSerial, mapRemoteRecipe, recipeMarginTone, formatRecipeMargin, createRecipeWorkspaceProjection } from "../inventory/recipes/inventoryRecipeReadModel.js";
import { persistRemoteRecipe } from "../inventory/recipes/inventoryRecipeService.js";
export { RecipeModal } from "../inventory/recipes/InventoryRecipeForms.jsx";
import InventoryWastePage from "../inventory/waste/InventoryWastePage.jsx";
import InventoryItemPhotoPreview from "../inventory/InventoryItemPhotoPreview.jsx";
import { mapRemoteWasteRecord, persistRemoteWasteRecord } from "../inventory/waste/inventoryWasteService.js";
import InventoryMovementsPage from "../inventory/movements/InventoryMovementsPage.jsx";
import { mapRemoteInventoryMovement, persistRemoteInventoryMovement, persistRemoteInventoryMovementUpdate } from "../inventory/movements/inventoryMovementService.js";
import InventoryGroupsPage from "../inventory/groups/InventoryGroupsPage.jsx";
import { groupCategoryIds, mapRemoteStockCheckGroup, stockCheckItemsForGroup } from "../inventory/groups/inventoryGroupsModel.js";
import InventoryStockCheckResultModal from "../inventory/stockChecks/InventoryStockCheckResultModal.jsx";
import InventoryPurchaseOrdersPage from "../inventory/purchaseOrders/InventoryPurchaseOrdersPage.jsx";
import { orderedQty, poProgress, poSourceLabel, poStatusLabel, remainingQty } from "../inventory/purchaseOrders/inventoryPurchaseOrderHelpers.js";
import { productAnalyticsService } from "../../../services/productAnalyticsService.js";
import { getAccessibleOutletOptions, getAccessibleOutlets, hasAllOutletAccess, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { resolveAdminLocation } from "../../../app/routeOwnership.js";
import { IMAGE_UPLOAD_ACCEPT, isImageDataUrl as isStandardImageDataUrl, optimizeImageFileForPreview, removeStorageObjectFromPublicUrl, uploadOptimizedImage } from "../../../utils/imageUpload.js";

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
    title: "Wastage",
    description: "Record spoilage, expiry, damaged inventory and kitchen wastage.",
  },
  recipes: {
    title: "Recipes & Usage",
    description: "Link menu items to ingredients and estimate consumption.",
  },
  "recipe-intelligence": {
    title: "Recipe Intelligence",
    description: "Analyze recipe profit, mapped product performance, and ingredient demand.",
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
const auditTypes = ["Month-End Closing", "Full Stock Audit", "Spot Check", "Category Audit", "Custom Audit"];




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
  const route = resolveAdminLocation(window.location);
  const candidate = route?.routeId === "inventory_stock_check" || route?.routeId === "inventory_groups"
    ? route.query.date ?? ""
    : "";
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
  if (checks.some((check) => checkMatchesGroupRun(check, group, date, shiftFilter) && check.status === "skipped")) return "Skipped";
  const draft = draftCheckForGroupRun(group, checks, date, shiftFilter);
  const due = isGroupDue(group, date);
  if (due && isPastBusinessDate(date)) return "Missed";
  if (draft) return "Draft";
  if (due) return "Due Today";
  return "Not Due";
}

function dueStatusDescription(status) {
  if (status === "Missed") return "This stock check was not completed on schedule.";
  if (status === "Skipped") return "Crew reviewed this requirement and skipped the count.";
  if (status === "Completed") return "Stock check completed for this date.";
  if (status === "Draft") return "Draft saved. Continue counting today.";
  if (status === "Due Today") return "Ready to count on the assigned date.";
  return "";
}

function canStartScheduledStockCheckForDate(group, date) {
  return isGroupDue(group, date) && compareBusinessDates(date, getBusinessDateInput("Asia/Kuala_Lumpur")) === 0;
}

function isActionableStockCheckStatus(status) {
  return ["Due Today", "Completed", "Draft", "Skipped", "Missed"].includes(status);
}

function stockCheckCardActionState(status) {
  if (status === "Completed") return "completed";
  if (status === "Draft") return "draft";
  if (status === "Missed") return "missed";
  if (status === "Skipped") return "skipped";
  if (status === "Due Today") return "start";
  return "none";
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


function itemHasActiveOutletLink(item = {}, outletId) {
  return (item.linkedOutletIds || []).includes(outletId);
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

async function uploadInventoryItemPhoto(file, itemId = "draft", previousPublicUrl = "") {
  const bucket = "inventory-item-photos";
  const path = `${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
  return uploadOptimizedImage(file, { bucket, path, previousPublicUrl });
}



function sameIdSet(first = [], second = []) {
  const left = uniqueIds(first).sort();
  const right = uniqueIds(second).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isImageDataUrl(value) {
  return isStandardImageDataUrl(value);
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



function mapRemoteStockCheckItem(row = {}) {
  return {
    id: row.id,
    itemId: row.item_id || "",
    categoryId: row.category_id || "",
    expectedQty: row.par_level_quantity === null || row.par_level_quantity === undefined ? "" : Number(row.par_level_quantity),
    actualCount: row.actual_count_quantity === null || row.actual_count_quantity === undefined ? "" : Number(row.actual_count_quantity),
    variance: row.variance === null || row.variance === undefined ? 0 : Number(row.variance),
    unitCostSnapshot: row.unit_cost_snapshot === null || row.unit_cost_snapshot === undefined ? null : Number(row.unit_cost_snapshot),
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














const recipeAnalysisPeriodOptions = [
  { value: "current", label: "Current Month", months: 1 },
  { value: "last3", label: "Last 3 Months", months: 3 },
  { value: "last6", label: "Last 6 Months", months: 6 },
  { value: "last12", label: "Last 12 Months", months: 12 },
];
const recipeMonthOptions = [
  { value: "1", label: "Jan" },
  { value: "2", label: "Feb" },
  { value: "3", label: "Mar" },
  { value: "4", label: "Apr" },
  { value: "5", label: "May" },
  { value: "6", label: "Jun" },
  { value: "7", label: "Jul" },
  { value: "8", label: "Aug" },
  { value: "9", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];










function formatMonthShort(serial) {
  const { month } = serialToMonthParts(serial);
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels[month - 1] || "—";
}


function formatPercentChange(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}%`;
}

function formatCompactCurrency(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000) return `RM${(amount / 1000).toLocaleString("en-MY", { maximumFractionDigits: 1 })}k`;
  return toCurrency(amount);
}




async function loadRemoteInventoryMaster() {
  const itemsResult = await readCompleteInventoryRows("inventory_items", { order: "created_at", ascending: false });
  if (itemsResult.error) throw itemsResult.error;

  const [categoriesResult, uomsResult, itemOutletsResult, itemOutletSuppliersResult, stockGroupsResult, stockGroupCategoriesResult, stockChecksResult, stockCheckItemsResult, purchaseOrdersResult, purchaseOrderItemsResult, purchaseReceiptsResult, purchaseReceiptItemsResult, movementsResult, wasteResult, menuCategoriesResult, recipesResult, recipeItemsResult, employeesResult] = await Promise.all([
    readCompleteInventoryRows("inventory_categories", { order: "sort_order" }),
    readCompleteInventoryRows("inventory_uoms", { order: "sort_order" }),
    readCompleteInventoryRows("inventory_item_outlets", { select: "*, outlets:outlet_id(*)" }),
    readCompleteInventoryRows("inventory_item_outlet_suppliers"),
    readCompleteInventoryRows("inventory_stock_check_groups", { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_stock_check_group_categories"),
    readCompleteInventoryRows("inventory_stock_checks", { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_stock_check_items", { order: "created_at" }),
    readCompleteInventoryRows("inventory_purchase_orders", { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_purchase_order_items", { order: "created_at" }),
    readCompleteInventoryRows("inventory_purchase_receipts", { order: "received_at", ascending: false }),
    readCompleteInventoryRows("inventory_purchase_receipt_items", { order: "created_at" }),
    readCompleteInventoryRows("inventory_movements", { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_waste_records", { order: "waste_date", ascending: false }),
    readCompleteInventoryRows("inventory_menu_categories", { order: "sort_order" }),
    readCompleteInventoryRows("inventory_recipes", { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_recipe_items", { order: "created_at" }),
    readCompleteInventoryRows("employees", { select: "id, auth_user_id, full_name, nickname, email" }),
  ]);
  const itemOutletRows = itemOutletsResult.data;

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
  const activeItems = normalizedItems.filter(isActiveInventoryItem);
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
  const menuCategories = menuCategoriesResult.data.map(mapRemoteMenuCategory);

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
    purchaseOrdersError: purchaseOrdersResult.error?.message || "",
  };
}

const PURCHASE_ORDER_PAGE_SIZE = 500;

async function loadAllPurchaseOrderRows(createQuery) {
  const rows = [];
  let offset = 0;
  let expectedCount = null;

  while (true) {
    const result = await createQuery(offset, offset + PURCHASE_ORDER_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    if (expectedCount === null && Number.isFinite(result.count)) expectedCount = result.count;
    rows.push(...page);
    if (page.length < PURCHASE_ORDER_PAGE_SIZE) {
      if (expectedCount !== null && rows.length !== expectedCount) {
        throw new Error(`Purchase Order read returned ${rows.length} of ${expectedCount} rows.`);
      }
      return { rows, count: expectedCount ?? rows.length };
    }
    offset += page.length;
  }
}

async function loadRemotePurchaseOrdersReadModel() {
  const [itemsResult, itemOutletsResult, purchaseOrdersResult, purchaseOrderItemsResult, purchaseReceiptsResult, purchaseReceiptItemsResult] = await Promise.all([
    loadAllPurchaseOrderRows((from, to) => supabase.from("inventory_items").select("*").order("created_at", { ascending: false }).range(from, to)),
    loadAllPurchaseOrderRows((from, to) => supabase.from("inventory_item_outlets").select("*").order("created_at", { ascending: false }).range(from, to)),
    loadAllPurchaseOrderRows((from, to) => supabase.from("inventory_purchase_orders").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to)),
    loadAllPurchaseOrderRows((from, to) => supabase.from("inventory_purchase_order_items").select("*").order("created_at", { ascending: true }).range(from, to)),
    loadAllPurchaseOrderRows((from, to) => supabase.from("inventory_purchase_receipts").select("*").order("received_at", { ascending: false }).range(from, to)),
    loadAllPurchaseOrderRows((from, to) => supabase.from("inventory_purchase_receipt_items").select("*").order("created_at", { ascending: true }).range(from, to)),
  ]);

  const configsByItem = new Map();
  itemOutletsResult.rows.forEach((config) => {
    const list = configsByItem.get(config.inventory_item_id) || [];
    list.push(config);
    configsByItem.set(config.inventory_item_id, list);
  });
  const items = itemsResult.rows.map((item) => mapRemoteInventoryItem(item, configsByItem.get(item.id) || []));
  const purchaseItemsByOrderId = new Map();
  purchaseOrderItemsResult.rows.forEach((row) => {
    const list = purchaseItemsByOrderId.get(row.purchase_order_id) || [];
    list.push(row);
    purchaseItemsByOrderId.set(row.purchase_order_id, list);
  });
  const receiptItemsByReceiptId = new Map();
  purchaseReceiptItemsResult.rows.forEach((row) => {
    const list = receiptItemsByReceiptId.get(row.receipt_id) || [];
    list.push(row);
    receiptItemsByReceiptId.set(row.receipt_id, list);
  });
  const receiptsByOrderId = new Map();
  purchaseReceiptsResult.rows.forEach((receipt) => {
    const list = receiptsByOrderId.get(receipt.purchase_order_id) || [];
    list.push({ ...receipt, items: receiptItemsByReceiptId.get(receipt.id) || [] });
    receiptsByOrderId.set(receipt.purchase_order_id, list);
  });

  return {
    items,
    orders: purchaseOrdersResult.rows.map((order) => mapRemotePurchaseOrder(order, purchaseItemsByOrderId.get(order.id) || [], receiptsByOrderId.get(order.id) || [])),
    purchaseOrderCount: purchaseOrdersResult.count,
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

function isDuplicateUomCodeError(error) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "23505" || message.includes("inventory_uoms_code_key");
}

function uomSaveErrorMessage(error) {
  if (isDuplicateUomCodeError(error)) return "UOM code already exists. Please use another code.";
  return error?.message || "Please try again.";
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

  const result = await inventoryLifecycleService.saveInventoryStockCheck({
    check: {
      id: existingId || null,
      ...payload,
    },
    items: rows.map((row) => ({
      item_id: isUuid(row.itemId) ? row.itemId : null,
      category_id: isUuid(row.categoryId) ? row.categoryId : null,
      par_level_quantity: row.expectedQty === "" || row.expectedQty === null || row.expectedQty === undefined ? null : Number(row.expectedQty),
      actual_count_quantity: row.actualCount === "" || row.actualCount === null || row.actualCount === undefined ? null : Number(row.actualCount),
      actual_missing: row.actualCount === "" || row.actualCount === null || row.actualCount === undefined,
      variance: Number(row.variance || 0),
      unit: row.unit || null,
      status: row.skipped ? "skipped" : (row.na ? "na" : row.status || "normal"),
      notes: row.notes || null,
      skipped: Boolean(row.skipped),
      na: Boolean(row.na),
      skip_reason: row.skipped ? (row.skipReason || null) : null,
    })),
  });
  return mapRemoteStockCheck(result.check || {}, result.items || []);
}

async function deleteRemoteStockCheckDraft(checkId) {
  if (!isUuid(checkId)) throw new Error("This audit draft has not been saved to Supabase yet.");
  await inventoryLifecycleService.deleteStockCheckDraft({ checkId });
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

  const supplierGroups = includedRows.reduce((groups, row) => {
    if (!groups.has(row.selectedSupplierId)) groups.set(row.selectedSupplierId, []);
    groups.get(row.selectedSupplierId).push(row);
    return groups;
  }, new Map());
  const orderIntents = [...supplierGroups.entries()].map(([supplierId, rows]) => {
    const poNo = `PO-${Date.now().toString().slice(-6)}-${ordersSuffix(supplierId)}`;
    const itemPayload = rows.map((row) => ({
      item_id: isUuid(row.itemId) ? row.itemId : null,
      requested_qty: Number(row.suggestedOrderQty || 0),
      unit: row.unit || null,
      remark: row.remark || null,
      source_stock_check_item_id: isUuid(row.stockCheckItemId) ? row.stockCheckItemId : null,
    }));
    return {
      po_no: poNo,
      outlet_id: stockCheck.outletId,
      supplier_id: supplierId,
      status: "draft",
      source_type: "stock_check",
      source_stock_check_id: stockCheck.id,
      lines: itemPayload,
    };
  });
  const results = await inventoryLifecycleService.createStockCheckPurchaseOrders({ stockCheckId: stockCheck.id, orders: orderIntents });
  const createdOrders = results.map((result) => mapRemotePurchaseOrder(result.order || {}, result.items || []));

  debugLog("[CreateDraftPODebug]", { action: "created-draft-pos", stockCheckId: stockCheck.id, createdOrders, error: null });
  return createdOrders;
}


async function persistRemotePurchaseOrderStatus(orderId, status) {
  if (!isUuid(orderId)) throw new Error("Valid purchase order is required.");
  const action = status === "submitted" ? "submit" : status === "supplier_confirmed" ? "confirm" : "";
  if (!action) throw new Error("Unsupported purchase order status transition.");
  await inventoryLifecycleService.transitionPurchaseOrder({ orderId, action });
  return fetchRemotePurchaseOrder(orderId);
}

async function persistRemotePurchaseOrderEdit(order = {}) {
  if (!isUuid(order.id)) throw new Error("Valid purchase order is required.");
  if (order.status !== "draft") throw new Error("Only Draft purchase orders can be edited.");
  const result = await inventoryLifecycleService.savePurchaseOrder({
    order: {
      id: order.id,
      outlet_id: order.outletId || order.outletIds?.[0] || null,
      supplier_id: order.supplierId || null,
      status: order.status,
      source_type: order.sourceType || "manual",
      source_stock_check_id: order.sourceStockCheckId || null,
      lines: (order.lines || []).map((line) => ({
        item_id: line.itemId,
        requested_qty: Number(line.requestedQty || 0),
        unit: line.unit || null,
        remark: line.remark || null,
        source_stock_check_item_id: line.sourceStockCheckItemId || null,
      })),
    },
    requestId: undefined,
  });
  return mapRemotePurchaseOrder(result.order || {}, result.items || [], []);
}

async function persistRemotePurchaseOrderCancel(order = {}, reason = "") {
  if (!isUuid(order.id)) throw new Error("Valid purchase order is required.");
  await inventoryLifecycleService.transitionPurchaseOrder({ orderId: order.id, action: "cancel", reason });
  return fetchRemotePurchaseOrder(order.id);
}

async function persistRemotePurchaseOrderComplete(order = {}, reason = "") {
  if (!isUuid(order.id)) throw new Error("Valid purchase order is required.");
  await inventoryLifecycleService.transitionPurchaseOrder({ orderId: order.id, action: "complete", reason });
  return fetchRemotePurchaseOrder(order.id);
}






// Existing persistence contracts exposed for focused lifecycle tests; runtime ownership remains in InventoryControlPage.
export const inventoryLifecycleContracts = {
  persistRemoteStockCheck,
  deleteRemoteStockCheckDraft,
  persistRemotePurchaseOrderStatus,
  persistRemotePurchaseOrderEdit,
  persistRemotePurchaseOrderCancel,
  persistRemotePurchaseOrderComplete,
  persistRemotePurchaseOrderReceive,
  persistRemoteInventoryMovement,
  persistRemoteInventoryMovementUpdate,
  persistRemoteWasteRecord,
  persistRemoteRecipe,
};


function uomOptionLabel(uom = {}) {
  return uom.displayName && canonical(uom.displayName) !== canonical(uom.code)
    ? `${uom.code} · ${uom.displayName}`
    : uom.code;
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

function useInventoryData(outlets, suppliers, readScope = "full") {
  const [data, setData] = useState(() => {
    clearInventoryBrowserCache();
    return normalizeInventoryData({ categories: [], items: [], uoms: [] }, outlets, suppliers, { allowEmptyMaster: true });
  });
  const [meta, setMeta] = useState({ dataSource: "fallback", lastFetchedAt: "", rawItemsCount: 0, normalizedItemsCount: 0, outletLinkCount: 0, fallbackActive: true, purchaseOrdersError: "" });
  const refreshRequestRef = useRef(0);

  useEffect(() => {
    if (!outlets.length) return;
    setData((current) => {
      return normalizeInventoryData({
        ...current,
        categories: current.categories ?? [],
        items: current.items ?? [],
        uoms: current.uoms ?? [],
        groups: current.groups ?? [],
      }, outlets, suppliers, { allowEmptyMaster: true });
    });
  }, [outlets, suppliers, meta.dataSource]);

  const refreshInventory = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    clearInventoryBrowserCache();
    setMeta((current) => ({ ...current, dataSource: current.dataSource === "supabase" ? "refreshing" : "loading" }));
    try {
      const remote = readScope === "orders" ? await loadRemotePurchaseOrdersReadModel() : await loadRemoteInventoryMaster();
      if (requestId !== refreshRequestRef.current) return null;
      const fetchedAt = new Date().toISOString();
      setData((current) => normalizeInventoryData({
        ...current,
        categories: remote.categories ?? current.categories,
        items: remote.items,
        uoms: remote.uoms ?? current.uoms,
        groups: remote.groups ?? current.groups,
        checks: remote.checks ?? current.checks,
        orders: remote.orders,
        movements: remote.movements ?? current.movements,
        waste: remote.waste ?? current.waste,
        menuCategories: remote.menuCategories ?? current.menuCategories,
        recipes: remote.recipes ?? current.recipes,
        people: remote.people ?? current.people,
      }, outlets, suppliers, { allowEmptyMaster: true }));
      setMeta({
        dataSource: "supabase",
        completeness: "complete",
        lastFetchedAt: fetchedAt,
        rawItemsCount: remote.rawItemCount ?? remote.items.length,
        normalizedItemsCount: remote.items.length,
        outletLinkCount: remote.outletLinkCount ?? 0,
        fallbackActive: Boolean(remote.fallbackActive),
        purchaseOrdersError: remote.purchaseOrdersError || "",
      });
      return remote;
    } catch (error) {
      if (requestId !== refreshRequestRef.current) return null;
      console.warn("[InventoryControl] Inventory read unavailable/incomplete. Results are not authoritative until refresh succeeds.", error);
      setMeta((current) => ({ ...current, dataSource: "remote_error", completeness: error.readState || "error", lastFetchedAt: current.lastFetchedAt || "", fallbackActive: true, purchaseOrdersError: error.message || "Unable to load Inventory." }));
      return null;
    }
  }, [outlets, suppliers, readScope]);

  useEffect(() => {
    let cancelled = false;
    refreshInventory().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refreshInventory]);

  useEffect(() => subscribeInventoryRevalidation(() => { refreshInventory(); }), [refreshInventory]);

  return [data, setData, meta, refreshInventory];
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


function ItemPhotoPicker({ value, onChange }) {
  const [error, setError] = useState("");

  async function handleFile(file) {
    setError("");
    if (!file) return;
    try {
      const optimized = await optimizeImageFileForPreview(file);
      onChange(optimized.dataUrl, { localPreview: true, uploadFailed: false, file });
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
                  <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handleFile(event.target.files?.[0])} />
                </label>
                <button className="btn-secondary h-8 px-3 text-xs text-rose-600" type="button" onClick={() => { setError(""); onChange("", { removed: true, uploadFailed: false }); }}>Remove</button>
              </div>
            </div>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 py-5 text-center transition hover:border-primary/40 hover:bg-primary/5">
            <Upload size={18} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">Upload item photo</span>
            <span className="mt-0.5 type-caption text-text-muted">JPG/PNG/WebP · max 5MB</span>
            <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handleFile(event.target.files?.[0])} />
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


function AuditStockCheckModal({ outlets, categories, items, onClose, onStart }) {
  const [form, setForm] = useState({
    outletId: outlets[0]?.id || "",
    date: todayInput(),
    auditName: "",
    auditType: auditTypes[0],
    categoryIds: [],
    notes: "",
  });

  const outletItems = items.filter((item) => isActiveInventoryItem(item) && itemHasActiveOutletLink(item, form.outletId));
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

function RecipeIntelligenceCard({ title, description, children, showViewAll = false, action = null }) {
  return (
    <div className="rounded-3xl border border-border bg-background p-4 shadow-sm dark:bg-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="type-title font-black text-text-primary">{title}</div>
          <p className="mt-1 type-body-sm text-text-secondary">{description}</p>
        </div>
        {action || (showViewAll ? <button className="type-caption font-black text-primary hover:underline" type="button">View All</button> : null)}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function RecipeYearSelector({ year, years = [], onChange }) {
  const options = years.length ? years : [year];
  return <div className="w-32"><SelectField ariaLabel="Trend year" value={String(year)} options={options.map((option) => ({ value: String(option), label: String(option) }))} onChange={(value) => onChange(Number(value))} /></div>;
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

function RecipeInsightsPanel({ rows = [], grossProfitRows = [], ingredientDrivers = [], pendingCount = 0 }) {
  if (!rows.length && !grossProfitRows.length && !ingredientDrivers.length) {
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
        {pendingCount > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-400/30 dark:bg-amber-950/30">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-black text-amber-900 dark:text-amber-100">Mapping coverage warning</div>
                <p className="mt-1 type-body-sm text-amber-800 dark:text-amber-100">{pendingCount} pending products are excluded from profit and ingredient planning.</p>
              </div>
              <Badge tone="warning">Medium impact</Badge>
            </div>
          </div>
        ) : null}
        {grossProfitRows[0] ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-400/30 dark:bg-emerald-950/30">
            <div className="font-black text-emerald-900 dark:text-emerald-100">Top gross profit recipe</div>
            <p className="mt-1 type-body-sm text-emerald-800 dark:text-emerald-100">
              {recipeNameEn(grossProfitRows[0].recipe) || grossProfitRows[0].label} contributes {formatRestaurantRecipeCurrency(grossProfitRows[0].grossProfit)} gross profit.
            </p>
            <div className="mt-2 type-caption font-bold text-emerald-800 dark:text-emerald-100">Action: protect availability and ingredient supply.</div>
          </div>
        ) : null}
        {ingredientDrivers[0] ? (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-400/30 dark:bg-orange-950/30">
            <div className="font-black text-orange-900 dark:text-orange-100">Ingredient cost driver</div>
            <p className="mt-1 type-body-sm text-orange-800 dark:text-orange-100">
              {ingredientDrivers[0].ingredient} is the largest forecast purchase driver at {formatRestaurantRecipeCurrency(ingredientDrivers[0].forecastCost)}.
            </p>
            <div className="mt-2 type-caption font-bold text-orange-800 dark:text-orange-100">Action: check supplier pricing and par level planning.</div>
          </div>
        ) : null}
        {ranked.map((row) => (
          <div key={`${row.id}-${row.classification}`} className="rounded-2xl border border-border bg-slate-50/80 p-3 dark:bg-white/5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-black text-text-primary">{recipeNameEn(row.recipe) || row.label}</div>
                <div className="type-caption text-text-muted">{row.salesVolume.toLocaleString()} sold · {formatRestaurantRecipeCurrency(row.revenue)} revenue</div>
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
          <div className="font-semibold text-text-muted">Pending</div>
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
            title={`${row.label}: ${row.salesVolume} sold, ${formatRestaurantRecipeCurrency(row.revenue)} revenue, ${formatRecipeMargin(row.margin)} margin`}
          >
            <div className="h-full w-full rounded-full border-2 border-white/80 bg-primary shadow-[0_0_22px_rgba(34,197,94,0.55)] ring-4 ring-primary/25" />
            <div className="pointer-events-none absolute left-full top-1/2 ml-2 hidden w-48 -translate-y-1/2 rounded-2xl border border-white/15 bg-slate-900/95 p-3 text-left text-xs text-white shadow-2xl group-hover:block">
              <div className="font-black">{recipeNameEn(row.recipe) || row.label}</div>
              <div className="mt-1 text-slate-300">Qty Sold: {Number(row.salesVolume || 0).toLocaleString()}</div>
              <div className="text-slate-300">Revenue: {formatRestaurantRecipeCurrency(row.revenue)}</div>
              <div className="text-slate-300">Cost: {formatRestaurantRecipeCurrency(cost)}</div>
              <div className="text-slate-300">Price: {formatRestaurantRecipeCurrency(price)}</div>
              <div className="text-slate-300">Profit: {formatRestaurantRecipeCurrency(row.profitPerServing)}</div>
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

const recipeTrendPalette = ["#22c55e", "#38bdf8", "#f59e0b", "#a855f7", "#f43f5e"];

function RecipeTrendChart({ series = [], months = [], valueFormatter = (value) => value, emptyTitle, emptyDescription, height = 280, showLegend = true, tooltipVariant = "default" }) {
  const activeSeries = series.filter((entry) => entry?.values?.some((point) => Number(point.value || 0) > 0)).slice(0, 5);
  if (!activeSeries.length || !months.length) {
    return <RecipeIntelligencePlaceholder title={emptyTitle} description={emptyDescription} />;
  }
  const chartHeight = Math.max(240, Number(height) || 280);
  const values = activeSeries.flatMap((entry) => entry.values.map((point) => Number(point.value || 0)));
  const maxValue = Math.max(...values, 1);
  const trendData = months.map((month) => {
    const row = { month, monthLabel: formatMonthShort(month) };
    activeSeries.forEach((entry) => {
      const point = entry.values.find((candidate) => candidate.month === month) || { value: 0 };
      row[entry.id] = Number(point.value || 0);
      row[`${entry.id}Tooltip`] = point.tooltip || "";
      row[`${entry.id}Meta`] = point.meta || null;
    });
    return row;
  });
  if (!trendData.length) {
    return <RecipeIntelligencePlaceholder title={emptyTitle} description={emptyDescription} />;
  }
  const peakBySeries = Object.fromEntries(activeSeries.map((entry) => [entry.id, Math.max(...entry.values.map((point) => Number(point.value || 0)), 0)]));
  const axisMax = Math.ceil(maxValue * 1.12);
  const tooltipByKey = Object.fromEntries(activeSeries.map((entry) => [entry.id, entry]));
  const gradientId = `recipeTrendArea-${activeSeries.map((entry) => entry.id).join("-")}`.replace(/[^a-zA-Z0-9_-]/g, "");
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const seen = new Set();
    const rows = payload.filter((entry) => {
      if (!tooltipByKey[entry.dataKey] || seen.has(entry.dataKey)) return false;
      seen.add(entry.dataKey);
      return true;
    });
    if (!rows.length) return null;
    return (
      <div className="min-w-56 rounded-2xl border border-white/60 bg-white/95 p-3 text-xs text-slate-800 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-slate-950/95 dark:text-slate-100">
        <div className="font-black">{label}</div>
        <div className="mt-2 space-y-2">
          {rows.map((entry) => {
            if (tooltipVariant === "ingredient-cost") {
              return (
                <div key={entry.dataKey} className="grid grid-cols-[1fr_auto] gap-4">
                  <span className="font-bold" style={{ color: entry.color }}>{tooltipByKey[entry.dataKey]?.label || entry.name}</span>
                  <span className="font-black">{valueFormatter(entry.value)}</span>
                </div>
              );
            }
            return (
              <div key={entry.dataKey}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold" style={{ color: entry.color }}>{tooltipByKey[entry.dataKey]?.label || entry.name}</span>
                  <span className="font-black">{valueFormatter(entry.value)}</span>
                </div>
                {Array.isArray(entry.payload?.[`${entry.dataKey}Meta`]) ? (
                  <div className="mt-1.5 space-y-1 text-slate-500 dark:text-slate-300">
                    {entry.payload[`${entry.dataKey}Meta`].map((item) => (
                      <div key={item.label} className="flex justify-between gap-4">
                        <span>{item.label}</span>
                        <span className="font-bold text-slate-700 dark:text-slate-100">{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : entry.payload?.[`${entry.dataKey}Tooltip`] ? (
                  <div className="mt-1 text-slate-500 dark:text-slate-300">{entry.payload[`${entry.dataKey}Tooltip`]}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const Dot = ({ cx, cy, payload, dataKey, stroke }) => {
    const value = Number(payload?.[dataKey] || 0);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const isPeak = value > 0 && value === peakBySeries[dataKey];
    const radius = isPeak ? 5 : value > 0 ? 3 : 1.5;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={value > 0 ? stroke : "#94a3b8"}
        stroke={value > 0 ? "var(--surface, #fff)" : "#cbd5e1"}
        strokeWidth={isPeak ? 2 : 1.5}
        opacity={value > 0 ? 1 : 0.18}
      />
    );
  };

  return (
    <div>
      <div className="w-full min-w-0 rounded-3xl border border-border bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 p-3 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/20" style={{ height: chartHeight, minHeight: chartHeight }}>
        <ResponsiveContainer width="100%" height={chartHeight - 24} minWidth={1} minHeight={1}>
          <ComposedChart data={trendData} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={recipeTrendPalette[0]} stopOpacity="0.18" />
                <stop offset="100%" stopColor={recipeTrendPalette[0]} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="4 6" className="text-border/70" />
            <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} interval={0} tick={{ fill: "var(--text-muted)", fontSize: 11, fontWeight: 700 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 11, fontWeight: 700 }} tickFormatter={formatCompactCurrency} width={48} domain={[0, axisMax]} />
            <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border-subtle)", strokeWidth: 1, strokeDasharray: "4 4" }} />
            {activeSeries[0] ? <Area type="monotone" dataKey={activeSeries[0].id} fill={`url(#${gradientId})`} stroke="none" isAnimationActive={false} activeDot={false} dot={false} /> : null}
            {activeSeries.map((entry, index) => (
              <Line
                key={entry.id}
                type="monotone"
                dataKey={entry.id}
                name={entry.label}
                stroke={recipeTrendPalette[index % recipeTrendPalette.length]}
                strokeWidth={2}
                dot={<Dot />}
                activeDot={{ r: 6, strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {showLegend ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {activeSeries.map((entry, index) => (
            <span key={entry.id || entry.label} className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 type-caption font-bold text-text-secondary dark:bg-white/5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: recipeTrendPalette[index % recipeTrendPalette.length] }} />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatGrowthPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return "0%";
  return `${numeric > 0 ? "▲" : "▼"}${Math.abs(Math.round(numeric))}%`;
}

function IngredientSelectorPills({ rows = [], selectedIds = [], onToggle, search, onSearch, sort, onSort }) {
  const selectedRows = selectedIds
    .map((id) => rows.find((row) => row.id === id))
    .filter(Boolean);
  const visible = rows
    .filter((row) => !search.trim() || `${row.ingredient} ${row.category}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((row) => !selectedIds.includes(row.id))
    .slice(0, 12);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <label>
          <div className="mb-1 type-caption font-semibold text-text-secondary">Search ingredient</div>
          <input
            className="control h-9 w-full text-[13px]"
            value={search}
            list="recipe-ingredient-trend-options"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Type ingredient name"
          />
          <datalist id="recipe-ingredient-trend-options">
            {rows.slice(0, 30).map((row) => <option key={row.id} value={row.ingredient} />)}
          </datalist>
        </label>
        <SelectField
          label="Sort"
          value={sort}
          options={[
            { value: "cost", label: "Total Cost" },
            { value: "usage", label: "Usage" },
            { value: "growth", label: "Growth %" },
          ]}
          onChange={onSort}
        />
      </div>
      {selectedRows.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedRows.map((row) => (
            <button
              key={row.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 type-caption font-black text-primary transition hover:bg-primary/15 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
              type="button"
              onClick={() => onToggle(row.id)}
              title={`Remove ${row.ingredient}`}
            >
              <span>{row.ingredient}</span>
              <span className={Number(row.growthPercent || 0) >= 0 ? "text-emerald-700 dark:text-emerald-200" : "text-rose-700 dark:text-rose-200"}>
                {formatGrowthPercent(row.growthPercent)}
              </span>
              <X size={12} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((row) => {
          const disabled = selectedIds.length >= 5;
          return (
            <button
              key={row.id}
              className={`rounded-full border border-border bg-background px-2 py-1 type-caption font-bold text-text-secondary transition hover:bg-primary/10 hover:text-text-primary dark:bg-white/5 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(row.id)}
            >
              {row.ingredient}
            </button>
          );
        })}
      </div>
      {selectedIds.length >= 5 ? <div className="type-caption text-text-muted">Up to 5 ingredients can be compared at once.</div> : null}
    </div>
  );
}

function IngredientConsumptionModal({ rows = [], categories = [], filters, onFilter, onClose }) {
  const search = filters.search.trim().toLowerCase();
  const filtered = rows
    .filter((row) => (filters.category === "all" || row.category === filters.category)
      && (!search || `${row.ingredient} ${row.category}`.toLowerCase().includes(search)))
    .sort((a, b) => {
      if (filters.sort === "usage") return Number(b.estimatedUsage || 0) - Number(a.estimatedUsage || 0);
      if (filters.sort === "ingredient") return a.ingredient.localeCompare(b.ingredient);
      if (filters.sort === "category") return a.category.localeCompare(b.category) || a.ingredient.localeCompare(b.ingredient);
      return Number(b.totalCost || 0) - Number(a.totalCost || 0);
    });
  return (
    <Modal
      title="Ingredient Consumption"
      description="Full monthly estimated ingredient consumption from mapped Product Analytics sales and Recipe BOM."
      size="xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <AdminFilterToolbar className="mb-4">
        <AdminSearchField label="Search ingredient" value={filters.search} onChange={(value) => onFilter({ ...filters, search: value })} placeholder="Search ingredient" />
        <SelectField
          label="Category"
          value={filters.category}
          options={[{ value: "all", label: "All" }, ...categories.map((category) => ({ value: category, label: category }))]}
          onChange={(value) => onFilter({ ...filters, category: value })}
        />
        <SelectField
          label="Sort"
          value={filters.sort}
          options={[
            { value: "cost", label: "Total Cost" },
            { value: "usage", label: "Estimated Usage" },
            { value: "ingredient", label: "Ingredient Name" },
            { value: "category", label: "Category" },
          ]}
          onChange={(value) => onFilter({ ...filters, sort: value })}
        />
      </AdminFilterToolbar>
      <RecipeRankingTable
        rows={filtered}
        columns={[
          { key: "ingredient", label: "Ingredient", render: (row) => <div className="font-bold text-text-primary">{row.ingredient}</div> },
          { key: "category", label: "Category", render: (row) => <Badge tone="info">{row.category}</Badge> },
          { key: "usage", label: "Estimated Usage", render: (row) => <span className="font-black text-text-primary">{Number(row.estimatedUsage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}</span> },
          { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
          { key: "unitCost", label: "Unit Cost", render: (row) => formatRestaurantRecipeCurrency(row.unitCost) },
          { key: "totalCost", label: "Total Cost", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.totalCost)}</span> },
          { key: "contribution", label: "Cost Contribution %", render: (row) => <Badge tone="info">{formatRecipeMargin(row.costContribution)}</Badge> },
        ]}
        emptyTitle="No ingredient consumption rows"
        emptyDescription="Try another search or category filter."
      />
    </Modal>
  );
}




function PurchaseSuggestionsModal({ suggestions, suppliers, outlet, existingOrders = [], businessPoNo = (order) => order?.poNo || "PO", onClose, onCreateDraftPo, onViewPurchaseOrder }) {
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
                      <span className="block truncate type-body-sm font-bold text-text-primary" title={`Internal system ID: ${order.poNo}`}>{businessPoNo(order)}</span>
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
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(form);
    } catch {
      // Parent owns the error notification; keeping this modal open preserves retry.
    } finally {
      setSaving(false);
    }
  };
  const updateLine = (index, patch) => setForm((current) => ({
    ...current,
    lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
  }));
  const availableItems = items.filter((item) => isActiveInventoryItem(item) && item.linkedOutletIds?.includes(form.outletId || form.outletIds?.[0]));

  return (
    <Modal
      title="Edit Draft PO"
      description="Draft purchase orders can be adjusted before submission."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={saving || form.status !== "draft" || !form.lines.length} onClick={submit}>{saving ? "Saving…" : "Save Draft PO"}</button>
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


function CancelPurchaseOrderModal({ order, displayPoNo, onClose, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Cancel Purchase Order"
      description={`${displayPoNo || order.poNo} will be preserved for audit history.`}
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



function InventoryLegacyRoutes({ store, auth, ui, initialTab = "dashboard" }) {
  const initialStockCheckDate = useMemo(getInitialStockCheckDate, []);
  const outlets = useMemo(() => (store?.outlets ?? []).map(normalizeOutletRecord), [store?.outlets]);
  const suppliers = useMemo(() => store?.suppliers ?? [], [store?.suppliers]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [data, setData, inventoryMeta, refreshInventory] = useInventoryData(outlets, suppliers, initialTab === "orders" ? "orders" : "full");
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [masterGroupBy, setMasterGroupBy] = useState("category");
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState(() => new Set());
  const [uomWriteStatus, setUomWriteStatus] = useState("Not written");
  const [poFilters, setPoFilters] = useState({ outletId: "all", supplierId: "all", status: "all", source: "all", search: "", from: "", to: "" });
  const recipeFilters = { category: "all", status: "active", search: "" };
  const [recipeAnalysisPeriod] = useState("last3");
  const [recipeTrendYear, setRecipeTrendYear] = useState(() => Number(getBusinessDateInput("Asia/Kuala_Lumpur").slice(0, 4)) || new Date().getFullYear());
  const [recipeReportMonth, setRecipeReportMonth] = useState(() => String(Number(getBusinessDateInput("Asia/Kuala_Lumpur").slice(5, 7)) || 1));
  const [recipeReportYear, setRecipeReportYear] = useState(() => String(Number(getBusinessDateInput("Asia/Kuala_Lumpur").slice(0, 4)) || new Date().getFullYear()));
  const [recipeProductReports, setRecipeProductReports] = useState([]);
  const [recipeProductItems, setRecipeProductItems] = useState([]);
  const [recipeProductMappings, setRecipeProductMappings] = useState([]);
  const [recipeProductLoading, setRecipeProductLoading] = useState(false);
  const [ingredientTrendSearch, setIngredientTrendSearch] = useState("");
  const [ingredientTrendSort, setIngredientTrendSort] = useState("cost");
  const [ingredientTrendSelectedIds, setIngredientTrendSelectedIds] = useState([]);
  const [ingredientConsumptionFilters, setIngredientConsumptionFilters] = useState({ search: "", category: "all", sort: "cost" });
  const [date, setDateState] = useState(initialStockCheckDate.date);
  const [selectedDateSource, setSelectedDateSource] = useState(initialStockCheckDate.source);
  const selectedDateSourceRef = useRef(initialStockCheckDate.source);
  const [stockCheckShiftFilter, setStockCheckShiftFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [editingCostItemId, setEditingCostItemId] = useState(null);
  const [editingCostValue, setEditingCostValue] = useState("");
  const [savingCostItemId, setSavingCostItemId] = useState(null);
  const skipCostBlurSaveRef = useRef(false);
  const [activeCheckGroupId, setActiveCheckGroupId] = useState(null);
  const [activeScheduledCheckId, setActiveScheduledCheckId] = useState(null);
  const [activeAuditCheck, setActiveAuditCheck] = useState(null);
  const [checkRows, setCheckRows] = useState([]);
  const [savingStockCheck, setSavingStockCheck] = useState(false);
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
    if (activeTab !== "recipe-intelligence" || !activeRecipeOutletId) return undefined;
    let cancelled = false;
    const selectedPeriod = recipeAnalysisPeriodOptions.find((option) => option.value === recipeAnalysisPeriod) || recipeAnalysisPeriodOptions[1];
    const analysisStartSerial = businessMonthSerial(-(selectedPeriod.months - 1));
    const analysisEndSerial = businessMonthSerial(0);
    const selectedReportSerial = monthSerial(recipeReportYear, recipeReportMonth);
    const trendStartSerial = monthSerial(recipeTrendYear, 1);
    const trendEndSerial = monthSerial(recipeTrendYear, 12);
    const startSerial = Math.min(analysisStartSerial, selectedReportSerial, trendStartSerial);
    const endSerial = Math.max(analysisEndSerial, selectedReportSerial, trendEndSerial);
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
  }, [activeRecipeOutletId, activeTab, recipeAnalysisPeriod, recipeReportMonth, recipeReportYear, recipeTrendYear]);

  useEffect(() => {
    setIngredientTrendSearch("");
    setIngredientTrendSelectedIds([]);
  }, [activeRecipeOutletId, recipeAnalysisPeriod, recipeReportMonth, recipeReportYear, recipeTrendYear]);

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
    if (activeTab !== "recipes") return;
    if (!outlets.length) return;
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
    viewCategories: hasPermission(auth, "inventory_categories.view") || hasPermission(auth, "inventory_master.view"),
    createCategory: hasPermission(auth, "inventory_categories.create"),
    editCategory: hasPermission(auth, "inventory_categories.edit"),
    deleteCategory: hasPermission(auth, "inventory_categories.delete"),
    viewUoms: hasPermission(auth, "inventory_uoms.view") || hasPermission(auth, "inventory_master.view"),
    createUom: hasPermission(auth, "inventory_uoms.create"),
    editUom: hasPermission(auth, "inventory_uoms.edit"),
    deleteUom: hasPermission(auth, "inventory_uoms.delete"),
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
    viewInsights: hasPermission(auth, "inventory_dashboard.view"),
    viewRecipes: activeTab === "recipe-intelligence" ? hasPermission(auth, "recipe_intelligence.view") : hasPermission(auth, "inventory_recipes.view"),
    manageRecipeIntelligence: hasPermission(auth, "recipe_intelligence.manage"),
    manageRecipes: hasPermission(auth, "inventory_recipes.manage"),
    exportRecipes: hasPermission(auth, "inventory_recipes.export"),
  }), [activeTab, auth]);

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
  const businessPoNo = (order = {}) => order.businessPoNo || order.poNo || "PO";

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
      afterStatusFilterCount: data.items.filter(isActiveInventoryItem).length,
      afterStatusFilterNames: data.items.filter(isActiveInventoryItem).map((item) => item.name),
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
        const uploadResult = await uploadInventoryItemPhoto(item.photoFile, isCreate ? "draft" : item.id, existingItem?.photo || existingItem?.photo_url || "");
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
      if (!hasNewPhotoFile && !normalizedItem.photo && (existingItem?.photo || existingItem?.photo_url)) {
        try {
          await removeStorageObjectFromPublicUrl("inventory-item-photos", existingItem.photo || existingItem.photo_url);
        } catch (removeError) {
          debugLog("[InventoryPhotoSaveDebug]", { ...photoDebug, removeError });
        }
      }
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
      const message = uomSaveErrorMessage(error);
      setUomWriteStatus(`Failed: ${message}`);
      notify("Unable to save UOM", message, "error");
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
      const message = uomSaveErrorMessage(error);
      setUomWriteStatus(`Failed: ${message}`);
      notify("Unable to save UOM", message, "error");
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



  function exportPurchaseOrders() {
    const rows = data.orders.filter((order) => {
      const outletId = order.outletId || order.outletIds?.[0] || "";
      const supplier = suppliers.find((entry) => entry.id === order.supplierId);
      const createdDate = (order.createdAt || order.submittedAt || "").slice(0, 10);
      const searchText = [businessPoNo(order), order.poNo, supplier?.name, ...(order.lines || []).map((line) => itemById.get(line.itemId)?.name)].join(" ").toLowerCase();
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
        "PO No.": businessPoNo(order),
        "Internal System ID": order.poNo,
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
    const columns = ["PO No.", "Internal System ID", "Supplier", "Outlet", "Items", "Ordered Qty", "Received Qty", "Remaining Qty", "Status", "Source", "Created Date", "Submitted Date", "Completed Date", "Completion Type", "Completion Reason", "Cancelled Reason"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-purchase-orders-${todayInput()}.csv`, csv);
    notify("Purchase orders exported", `${rows.length} PO${rows.length === 1 ? "" : "s"} exported.`);
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
    if (savingStockCheck) return;
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
      setSavingStockCheck(true);
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
    } finally {
      setSavingStockCheck(false);
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

  async function hydrateStockCheckRows(check) {
    if (!check?.id) return check;
    const result = await supabase
      .from("inventory_stock_check_items")
      .select("*")
      .eq("stock_check_id", check.id)
      .order("created_at", { ascending: true });
    debugLog("[StockCheckResultDebug]", { action: "hydrate-items", stockCheckId: check.id, result: { data: result.data, error: result.error }, error: result.error });
    if (result.error) throw Object.assign(result.error, { stockCheckItemsLoad: true });
    const hydratedCheck = {
      ...check,
      rows: (result.data || []).map(mapRemoteStockCheckItem),
    };
    setData((current) => ({
      ...current,
      checks: current.checks.map((entry) => (entry.id === hydratedCheck.id ? hydratedCheck : entry)),
    }));
    return hydratedCheck;
  }

  async function openStockCheckResult(check, options = {}) {
    try {
      const hydratedCheck = await hydrateStockCheckRows(check);
      const suggestions = options.suggestions || buildPurchaseSuggestions(hydratedCheck);
      setModal({ type: "check-result", stockCheck: hydratedCheck, suggestions, isAudit: options.isAudit ?? hydratedCheck?.stockCheckType === "audit" });
    } catch (error) {
      console.warn("[InventoryControl] Unable to load stock check items.", error);
      debugLog("[StockCheckResultDebug]", { action: "open-result", stockCheckId: check?.id, error });
      notify("Unable to load stock check items.", error.message || "Please try again.", "error");
    }
  }

  async function openPurchaseSuggestionsForCheck(check) {
    if (!check || check.stockCheckType !== "scheduled" || check.status !== "submitted") {
      openStockCheckResult(check, { suggestions: [], isAudit: check?.stockCheckType === "audit" });
      return;
    }
    try {
      const hydratedCheck = await hydrateStockCheckRows(check);
      const suggestions = buildPurchaseSuggestions(hydratedCheck);
      const existingOrders = await fetchRemotePurchaseOrdersForStockCheck(check.id);
      setData((current) => ({
        ...current,
        orders: [
          ...existingOrders,
          ...current.orders.filter((order) => !existingOrders.some((entry) => entry.id === order.id)),
        ],
      }));
      if (!suggestions.length && !existingOrders.length) {
        setModal({ type: "check-result", stockCheck: hydratedCheck, suggestions });
        return;
      }
      setModal({ type: "purchase-suggestions", stockCheck: hydratedCheck, suggestions, existingOrders });
    } catch (error) {
      console.warn("[InventoryControl] Unable to load purchase suggestions.", error);
      debugLog("[PurchaseSuggestionDebug]", { action: "open-suggestions", stockCheckId: check.id, error });
      notify(error?.stockCheckItemsLoad ? "Unable to load stock check items." : "Unable to load purchase suggestions", error.message || "Please try again.", "error");
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
      notify("Draft PO saved");
      return updatedOrder;
    } catch (error) {
      console.warn("[InventoryControl] Unable to save Draft PO.", error);
      debugLog("[POSubmitDebug]", { action: "save-draft-po", orderId: order?.id, order, error });
      notify("Failed to update Draft PO", error.message || "Please try again.", "error");
      throw error;
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
      activeItems: visibleItems.filter(isActiveInventoryItem).length,
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

      <AdminFilterToolbar>
          <AdminSearchField label="Search item" value={query} onChange={(value) => setQuery(value)} placeholder="Search item name or SKU" />
          <SelectField label="Outlet" value={selectedOutletId} options={getAccessibleOutletOptions(auth, outlets)} onChange={setSelectedOutletId} searchable />
          <SelectField label="Category" value={categoryFilter} options={[{ value: "all", label: "All" }, ...sortedCategories.map((category) => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} searchable />
          <SelectField label="Status" value={statusFilter} options={[{ value: "all", label: "All" }, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={setStatusFilter} />
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
        </AdminFilterToolbar>

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
              <button className="btn-secondary" type="button" disabled={savingStockCheck} onClick={() => requirePermission(can.editCheck, "save stock check drafts") && saveStockCheck("draft")}>{savingStockCheck ? "Saving…" : "Save Draft"}</button>
              <button className="btn-primary" type="button" disabled={savingStockCheck} onClick={() => requirePermission(can.createCheck, "submit stock checks") && saveStockCheck("submitted")}>{savingStockCheck ? "Saving…" : isAudit ? "Submit Audit Check" : "Submit Stock Check"}</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
      <AdminFilterToolbar>
          <SelectField label="Outlet" value={selectedOutletId} options={getAccessibleOutletOptions(auth, outlets)} onChange={setSelectedOutletId} searchable />
          <DatePickerField label="Date" value={date} onChange={setDate} />
          <SelectField label="Shift" value={stockCheckShiftFilter} options={[{ value: "all", label: "All" }, ...shifts.map((shift) => ({ value: shift, label: shift }))]} onChange={setStockCheckShiftFilter} />
        </AdminFilterToolbar>
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
                            disabled={!latestCheck || !canReviewSuggestions}
                            onClick={() => requirePermission(canReviewSuggestions, "review purchase suggestions") && openPurchaseSuggestionsForCheck(latestCheck)}
                          >
                            {linkedOrders.length ? "View Draft PO" : "Review Purchase Suggestions"}
                          </button>
                          <button className="btn-secondary w-full" type="button" onClick={() => openStockCheckResult(latestCheck)}>View Result</button>
                        </>
                      ) : status === "Missed" || status === "Skipped" ? (
                        <div className={status === "Missed" ? "rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800" : "rounded-2xl border border-border bg-surface px-3 py-3 text-sm font-semibold text-text-secondary"}>
                          {dueStatusDescription(status)}
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
                      <button className="btn-secondary mt-4 w-full" type="button" onClick={() => openStockCheckResult(check, { suggestions: [], isAudit: true })}>View Audit Result</button>
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
    return <InventoryPurchaseOrdersPage
      orders={data.orders}
      items={data.items}
      suppliers={suppliers}
      outletOptions={getAccessibleOutletOptions(auth, outlets).filter((option) => option.value !== "all")}
      outletById={outletById}
      getBusinessPoNo={businessPoNo}
      formatDate={formatDate}
      todayInput={todayInput}
      statusTone={statusTone}
      onFiltersChange={setPoFilters}
      loadState={inventoryMeta.dataSource}
      loadError={inventoryMeta.purchaseOrdersError}
      onRetry={refreshInventory}
      onRequestEdit={(order) => requirePermission(can.editPo, "edit purchase orders") && setModal({ type: "po-edit", order })}
      onSubmit={(order) => requirePermission(can.submitPo, "submit purchase orders") && updatePurchaseOrderStatus(order.id, "submitted")}
      onConfirm={(order) => requirePermission(can.submitPo, "mark supplier confirmed") && updatePurchaseOrderStatus(order.id, "supplier_confirmed")}
      onRequestReceive={(order) => requirePermission(can.receivePo, "receive inventory") && setModal({ type: "po-surface", orderId: order.id, action: "receive" })}
      onComplete={(order) => requirePermission(can.completePo, "complete purchase orders") && setModal({ type: "po-complete", order })}
      onCancel={(order) => requirePermission(can.cancelPo, "cancel purchase orders") && setModal({ type: "po-cancel", order })}
      onView={(order) => setModal({ type: "po-surface", orderId: order.id })}
      onCopyPurchaseOrder={(order) => setModal({ type: "po-surface", orderId: order.id, action: "copy" })}
    />;
  }



  function renderRecipes() {
    if (!can.viewRecipes) {
      return <EmptyState title="Permission required" description={`You do not have permission to view ${activeTab === "recipe-intelligence" ? "Recipe Intelligence" : "Recipes & Usage"}.`} />;
    }
    const isRecipeIntelligencePage = activeTab === "recipe-intelligence";
    const {recipeReadModel, activeMenuCategories, filteredRecipes, recipeCostRows, averageRecipeCost, pricedMargins, averageMargin, highestCostRecipe, selectedPeriod, analysisStartSerial, analysisEndSerial, analysisMonths, analysisMonthSet, selectedReportSerial, selectedReportMonthSet, selectedReportLabel, trendMonths, trendMonthSet, availableTrendYears, availableReportYears, reportById, buildProductSalesByName, analysisProductSalesByName, monthlyProductSalesByName, allProductSalesByName, productSalesByName, yearlyProductSalesByName, recipeCostById, mappingByProductKey, mappedMappings, mappingCandidateRecipes, productMappingKeys, productMappingRows, recipeMappingSearch, visibleProductMappingRows} = createRecipeWorkspaceProjection({data, outletById, activeRecipeOutletId, recipeFilters, recipeAnalysisPeriod, recipeReportYear, recipeReportMonth, recipeTrendYear, recipeProductReports, recipeProductItems, recipeProductMappings, isRecipeIntelligencePage});
    const matchedProductKeys = new Set();
    const menuEngineeringRows = mappedMappings
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
    const mappedRecipeCount = new Set(mappedMappings
      .filter((mapping) => recipeCostById.has(mapping.recipe_id) && productSalesByName.has(normalizeProductRecipeKey(mapping.product_name)))
      .map((mapping) => mapping.recipe_id)).size;
    const mappedProductCount = productMappingRows.filter((row) => row.status === "mapped").length;
    const pendingProductCount = productMappingRows.filter((row) => row.status === "pending").length;
    const ignoredProductCount = productMappingRows.filter((row) => row.status === "ignored").length;
    const mappingCoverage = (mappedProductCount + pendingProductCount) ? Math.round((mappedProductCount / (mappedProductCount + pendingProductCount)) * 100) : 0;
    const reliableMenuEngineeringRows = mappedRecipeCount >= 10 ? menuEngineeringRows : [];
    const buildMappedRecipeAnalytics = (salesByName, months) => {
      const monthSet = new Set(months);
      const monthlyGrossProfitBuckets = new Map(months.map((serial) => [serial, { month: serial, quantity: 0, revenue: 0, recipeCost: 0, grossProfit: 0, margin: null }]));
      const ingredientConsumptionByMonth = new Map();
      const addIngredientUsage = ({ line, item, month, usage }) => {
        if (!item || !Number(usage || 0)) return;
        const key = item.id || line.itemId || item.name;
        const unitCost = Number(item.cost || 0);
        const category = categoryById.get(item.categoryId);
        const current = ingredientConsumptionByMonth.get(key) || {
          id: key,
          ingredient: item.name || "Inventory item",
          category: category?.name || "Uncategorized",
          uom: item.unit || line.unit || "",
          unitCost,
          estimatedUsage: 0,
          totalCost: 0,
          monthly: new Map(),
        };
        current.estimatedUsage += usage;
        current.totalCost += usage * unitCost;
        const monthBucket = current.monthly.get(month) || { month, usage: 0, cost: 0 };
        monthBucket.usage += usage;
        monthBucket.cost += usage * unitCost;
        current.monthly.set(month, monthBucket);
        ingredientConsumptionByMonth.set(key, current);
      };
      mappedMappings.forEach((mapping) => {
        const matchKey = normalizeProductRecipeKey(mapping.product_name);
        const product = salesByName.get(matchKey);
        const recipeRow = recipeCostById.get(mapping.recipe_id);
        if (!product || !recipeRow) return;
        const { recipe, summary } = recipeRow;
        const recipeCost = Number(summary.totalCost || 0);
        const sellingPrice = Number(recipe.sellingPrice ?? recipe.selling_price ?? 0);
        const profitPerServing = sellingPrice - recipeCost;
        product.monthly.forEach((monthSale, month) => {
          if (!monthSet.has(month)) return;
          const quantity = Number(monthSale.quantity || 0);
          const gross = monthlyGrossProfitBuckets.get(month) || { month, quantity: 0, revenue: 0, recipeCost: 0, grossProfit: 0, margin: null };
          gross.quantity += quantity;
          gross.revenue += Number(monthSale.revenue || 0);
          gross.recipeCost += quantity * recipeCost;
          gross.grossProfit += quantity * profitPerServing;
          gross.margin = gross.revenue > 0 ? (gross.grossProfit / gross.revenue) * 100 : null;
          monthlyGrossProfitBuckets.set(month, gross);
          (recipe.ingredients || []).forEach((line) => {
            const item = itemById.get(line.itemId);
            const quantityUsed = Number(line.quantityUsed ?? line.quantity_used ?? 0);
            addIngredientUsage({ line, item, month, usage: quantity * quantityUsed });
          });
        });
      });
      return { monthlyGrossProfitBuckets, ingredientConsumptionByMonth };
    };

    const analysisAnalytics = buildMappedRecipeAnalytics(analysisProductSalesByName, analysisMonths);
    const monthlyAnalytics = buildMappedRecipeAnalytics(monthlyProductSalesByName, [selectedReportSerial]);
    const yearlyAnalytics = buildMappedRecipeAnalytics(yearlyProductSalesByName, trendMonths);

    const topGrossProfitRows = [...menuEngineeringRows]
      .map((row) => ({ ...row, grossProfit: Number(row.salesVolume || 0) * Number(row.profitPerServing || 0) }))
      .sort((a, b) => Number(b.grossProfit || 0) - Number(a.grossProfit || 0))
      .slice(0, 8);
    const grossProfitTrendSeries = [{
      id: "gross-profit",
      label: "Gross Profit",
      values: trendMonths.map((month) => {
        const bucket = yearlyAnalytics.monthlyGrossProfitBuckets.get(month) || {};
        return {
          month,
          value: Number(bucket.grossProfit || 0),
          tooltip: `Qty ${Number(bucket.quantity || 0).toLocaleString()} · Revenue ${formatRestaurantRecipeCurrency(bucket.revenue || 0)} · Recipe Cost ${formatRestaurantRecipeCurrency(bucket.recipeCost || 0)} · Margin ${formatRecipeMargin(bucket.margin)}`,
        };
      }),
    }];
    const yearlyGrossProfitRows = [...yearlyAnalytics.monthlyGrossProfitBuckets.values()];
    const currentYearGrossProfit = yearlyGrossProfitRows.reduce((sum, row) => sum + Number(row.grossProfit || 0), 0);
    const bestGrossProfitMonth = yearlyGrossProfitRows.reduce((best, row) => !best || Number(row.grossProfit || 0) > Number(best.grossProfit || 0) ? row : best, null);
    const averageMonthlyGrossProfit = currentYearGrossProfit / 12;
    const ingredientConsumptionRows = [...monthlyAnalytics.ingredientConsumptionByMonth.values()]
      .map((row) => {
        const latestBucket = row.monthly.get(selectedReportSerial) || { usage: 0, cost: 0 };
        const periodCost = [...row.monthly.values()].reduce((sum, bucket) => sum + Number(bucket.cost || 0), 0);
        return {
          ...row,
          estimatedUsage: latestBucket.usage,
          totalCost: latestBucket.cost,
          periodCost,
        };
      })
      .filter((row) => Number(row.estimatedUsage || 0) > 0 || Number(row.totalCost || 0) > 0)
      .sort((a, b) => Number(b.totalCost || 0) - Number(a.totalCost || 0));
    const ingredientConsumptionCategories = [...new Set(ingredientConsumptionRows.map((row) => row.category).filter(Boolean))].sort();
    const totalMonthlyIngredientCost = ingredientConsumptionRows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
    const ingredientConsumptionRowsWithContribution = ingredientConsumptionRows.map((row) => ({
      ...row,
      costContribution: totalMonthlyIngredientCost > 0 ? (Number(row.totalCost || 0) / totalMonthlyIngredientCost) * 100 : null,
    }));
    const ingredientDemandForecastRows = [...analysisAnalytics.ingredientConsumptionByMonth.values()]
      .map((row) => {
        const monthlyBuckets = analysisMonths.map((month) => row.monthly.get(month) || { usage: 0, cost: 0 });
        const forecastUsage = monthlyBuckets.reduce((sum, bucket) => sum + Number(bucket.usage || 0), 0) / Math.max(selectedPeriod.months, 1);
        const latestUsage = monthlyBuckets[monthlyBuckets.length - 1]?.usage || 0;
        const priorBuckets = monthlyBuckets.slice(0, -1);
        const priorAverage = priorBuckets.length ? priorBuckets.reduce((sum, bucket) => sum + Number(bucket.usage || 0), 0) / priorBuckets.length : null;
        const change = priorAverage && priorAverage > 0 ? ((latestUsage - priorAverage) / priorAverage) * 100 : null;
        return {
          ...row,
          forecastUsage,
          forecastCost: forecastUsage * Number(row.unitCost || 0),
          change,
        };
      })
      .filter((row) => Number(row.forecastUsage || 0) > 0)
      .sort((a, b) => Number(b.forecastCost || 0) - Number(a.forecastCost || 0))
      .slice(0, 8);
    const trendIngredientRows = [...yearlyAnalytics.ingredientConsumptionByMonth.values()]
      .map((row) => {
        const monthlyBuckets = trendMonths.map((month) => row.monthly.get(month) || { month, usage: 0, cost: 0 });
        const nonZeroBuckets = monthlyBuckets.filter((bucket) => Number(bucket.cost || 0) > 0);
        const latest = nonZeroBuckets.at(-1);
        const previous = nonZeroBuckets.slice(0, -1).at(-1);
        const growthPercent = previous && Number(previous.cost || 0) > 0
          ? ((Number(latest?.cost || 0) - Number(previous.cost || 0)) / Number(previous.cost || 0)) * 100
          : latest ? 100 : 0;
        return {
          ...row,
          totalUsage: monthlyBuckets.reduce((sum, bucket) => sum + Number(bucket.usage || 0), 0),
          growthPercent,
        };
      })
      .sort((a, b) => {
        if (ingredientTrendSort === "usage") return Number(b.totalUsage || 0) - Number(a.totalUsage || 0);
        if (ingredientTrendSort === "growth") return Number(b.growthPercent || 0) - Number(a.growthPercent || 0);
        return Number(b.totalCost || 0) - Number(a.totalCost || 0);
      });
    const defaultTrendIngredientIds = trendIngredientRows
      .slice(0, 5)
      .map((row) => row.id);
    const activeTrendIngredientIds = (ingredientTrendSelectedIds.length ? ingredientTrendSelectedIds : defaultTrendIngredientIds)
      .filter((id) => yearlyAnalytics.ingredientConsumptionByMonth.has(id))
      .slice(0, 5);
    const ingredientTrendSeries = activeTrendIngredientIds.map((id) => {
      const row = yearlyAnalytics.ingredientConsumptionByMonth.get(id);
      return {
        id,
        label: row?.ingredient || "Ingredient",
        values: trendMonths.map((month) => {
          const bucket = row?.monthly?.get(month) || { usage: 0, cost: 0 };
          return {
            month,
            value: Number(bucket.cost || 0),
            meta: [
              { label: "Ingredient", value: row?.ingredient || "Ingredient" },
              { label: "Estimated Usage", value: Number(bucket.usage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 }) },
              { label: "UOM", value: row?.uom || "—" },
              { label: "Estimated Cost", value: formatRestaurantRecipeCurrency(bucket.cost || 0) },
            ],
          };
        }),
      };
    });
    const highestIngredientCostPoint = trendIngredientRows.reduce((best, row) => {
      const peak = [...row.monthly.values()].reduce((monthBest, bucket) => !monthBest || Number(bucket.cost || 0) > Number(monthBest.cost || 0) ? bucket : monthBest, null);
      if (!peak) return best;
      const candidate = { ...row, peak };
      return !best || Number(candidate.peak.cost || 0) > Number(best.peak.cost || 0) ? candidate : best;
    }, null);
    return (
      <div className="space-y-4">
        {isRecipeIntelligencePage ? (
      <AdminFilterToolbar>
            <SelectField label="Outlet" value={activeRecipeOutletId} options={recipeOutletOptions} onChange={setSelectedOutletId} searchable />
            <SelectField
              label="Month"
              value={String(recipeReportMonth)}
              options={recipeMonthOptions}
              onChange={(value) => setRecipeReportMonth(String(value))}
            />
            <SelectField
              label="Year"
              value={String(recipeReportYear)}
              options={availableReportYears.map((year) => ({ value: String(year), label: String(year) }))}
              onChange={(value) => setRecipeReportYear(String(value))}
            />
          </AdminFilterToolbar>
        ) : null}
        {isRecipeIntelligencePage ? <DashboardSection
          title="Recipe Intelligence"
          subtitle="Identify profitable menu items, highest cost recipes and key ingredient cost drivers."
        >
          <div className="mb-4 grid gap-3">
            <RecipeMappingHealth mapped={mappedProductCount} unmapped={pendingProductCount} totalRecipes={mappingCandidateRecipes.length} loading={recipeProductLoading} />
          </div>
          {pendingProductCount > 0 ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
              <span className="font-black">Some products are not mapped yet.</span> Insights may be incomplete until {pendingProductCount} pending {pendingProductCount === 1 ? "product is" : "products are"} mapped or ignored.
            </div>
          ) : null}
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
            <RecipeInsightsPanel rows={reliableMenuEngineeringRows} grossProfitRows={topGrossProfitRows} ingredientDrivers={ingredientDemandForecastRows} pendingCount={pendingProductCount} />
          </div>
          <div className="mt-4 grid gap-4">
            <RecipeIntelligenceCard
              title="Recipe Gross Profit Trend"
              description={`Jan-Dec ${recipeTrendYear} monthly gross profit from mapped Product Analytics quantity sold × recipe profit per serving.`}
              action={<RecipeYearSelector year={recipeTrendYear} years={availableTrendYears} onChange={setRecipeTrendYear} />}
            >
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <MetricCard label={`${recipeTrendYear} Gross Profit`} value={formatRestaurantRecipeCurrency(currentYearGrossProfit)} helper="Mapped recipe sales only" tone={currentYearGrossProfit ? "success" : "neutral"} size="compact" />
                <MetricCard label="Best Month" value={bestGrossProfitMonth ? formatMonthShort(bestGrossProfitMonth.month) : "—"} helper={bestGrossProfitMonth ? formatRestaurantRecipeCurrency(bestGrossProfitMonth.grossProfit) : "No mapped sales"} tone={bestGrossProfitMonth?.grossProfit ? "success" : "neutral"} size="compact" />
                <MetricCard label="Average Monthly GP" value={formatRestaurantRecipeCurrency(averageMonthlyGrossProfit)} helper="12-month average" size="compact" />
              </div>
              <RecipeTrendChart
                series={grossProfitTrendSeries}
                months={trendMonths}
                valueFormatter={formatRestaurantRecipeCurrency}
                emptyTitle="Map products to recipes to unlock gross profit trend."
                emptyDescription="Gross profit uses Product Analytics qty sold and Recipe BOM costing. No fake trend is shown."
              />
              {bestGrossProfitMonth?.grossProfit ? (
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 type-body-sm text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/30 dark:text-emerald-100">
                  Gross profit peaked in {formatMonthShort(bestGrossProfitMonth.month)} at {formatRestaurantRecipeCurrency(bestGrossProfitMonth.grossProfit)}.
                </div>
              ) : null}
            </RecipeIntelligenceCard>
            <div className="grid gap-4 lg:grid-cols-2">
              <RecipeIntelligenceCard
                title={`Top Gross Profit Recipes - ${selectedReportLabel}`}
                description="Recipes ranked by selected-month gross profit, not just revenue."
              >
                <RecipeRankingTable
                  rows={topGrossProfitRows}
                  columns={[
                    { key: "recipe", label: "Recipe", render: (row) => <div><div className="font-bold text-text-primary">{recipeNameEn(row.recipe) || row.label}</div><div className="type-caption text-text-muted">{recipeNameCn(row.recipe) || recipeCode(row.recipe)}</div></div> },
                    { key: "qty", label: "Qty Sold", render: (row) => <span className="font-black text-text-primary">{Number(row.salesVolume || 0).toLocaleString()}</span> },
                    { key: "revenue", label: "Revenue", render: (row) => formatRestaurantRecipeCurrency(row.revenue) },
                    { key: "grossProfit", label: "Gross Profit", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.grossProfit)}</span> },
                    { key: "margin", label: "Margin %", render: (row) => <Badge tone={recipeMarginTone(row.margin)}>{formatRecipeMargin(row.margin)}</Badge> },
                  ]}
                  emptyTitle="No mapped gross profit yet"
                  emptyDescription="Map Product Analytics products to recipes with selling prices and ingredient costs."
                />
              </RecipeIntelligenceCard>
              <RecipeIntelligenceCard
                title="Ingredient Demand Forecast"
                description={`${selectedPeriod.label} average monthly usage for procurement planning.`}
              >
                <RecipeRankingTable
                  rows={ingredientDemandForecastRows}
                  columns={[
                    { key: "ingredient", label: "Ingredient", render: (row) => <div><div className="font-bold text-text-primary">{row.ingredient}</div><div className="type-caption text-text-muted">{row.category}</div></div> },
                    { key: "usage", label: "Forecast Usage", render: (row) => <span className="font-black text-text-primary">{Number(row.forecastUsage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}</span> },
                    { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
                    { key: "cost", label: "Forecast Cost", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.forecastCost)}</span> },
                    { key: "change", label: "Change", render: (row) => <Badge tone={Number(row.change || 0) > 0 ? "warning" : Number(row.change || 0) < 0 ? "success" : "neutral"}>{formatPercentChange(row.change)}</Badge> },
                  ]}
                  emptyTitle="Map products to recipes to estimate demand."
                  emptyDescription="Ingredient demand forecast needs mapped Product Analytics sales and Recipe BOM quantities."
                />
              </RecipeIntelligenceCard>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <RecipeIntelligenceCard
                title={`Top 10 Ingredient Consumption - ${selectedReportLabel}`}
                description="Estimated monthly usage from mapped Product Analytics sales × Recipe BOM."
                action={(
                  <button
                    className="btn-secondary h-8 px-3 text-xs"
                    type="button"
                    onClick={() => setModal({ type: "ingredient-consumption", rows: ingredientConsumptionRowsWithContribution, categories: ingredientConsumptionCategories })}
                    disabled={!ingredientConsumptionRowsWithContribution.length}
                  >
                    View All
                  </button>
                )}
              >
                <RecipeRankingTable
                  rows={ingredientConsumptionRowsWithContribution.slice(0, 10)}
                  columns={[
                    { key: "ingredient", label: "Ingredient", render: (row) => <div><div className="font-bold text-text-primary">{row.ingredient}</div><div className="type-caption text-text-muted">{row.category}</div></div> },
                    { key: "usage", label: "Estimated Usage", render: (row) => <span className="font-black text-text-primary">{Number(row.estimatedUsage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}</span> },
                    { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
                    { key: "unitCost", label: "Unit Cost", render: (row) => formatRestaurantRecipeCurrency(row.unitCost) },
                    { key: "totalCost", label: "Total Cost", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.totalCost)}</span> },
                    { key: "contribution", label: "Cost Contribution %", render: (row) => <Badge tone="info">{formatRecipeMargin(row.costContribution)}</Badge> },
                  ]}
                  emptyTitle="Map products to recipes to estimate ingredient consumption."
                  emptyDescription="Only mapped products feed ingredient usage. Pending and ignored products are excluded."
                />
              </RecipeIntelligenceCard>
              <RecipeIntelligenceCard
                title="Ingredient Cost Trend"
                description={`Jan-Dec ${recipeTrendYear} estimated procurement cost trend by ingredient.`}
                action={<RecipeYearSelector year={recipeTrendYear} years={availableTrendYears} onChange={setRecipeTrendYear} />}
              >
                <IngredientSelectorPills
                  rows={trendIngredientRows}
                  selectedIds={activeTrendIngredientIds}
                  search={ingredientTrendSearch}
                  onSearch={setIngredientTrendSearch}
                  sort={ingredientTrendSort}
                  onSort={setIngredientTrendSort}
                  onToggle={(id) => setIngredientTrendSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(0, 5))}
                />
                <div className="mt-4">
                  <RecipeTrendChart
                    series={ingredientTrendSeries}
                    months={trendMonths}
                    valueFormatter={formatRestaurantRecipeCurrency}
                    emptyTitle="Map products to recipes to unlock ingredient cost trends."
                    emptyDescription="The trend uses estimated monthly procurement cost, not quantity."
                    showLegend={false}
                    tooltipVariant="ingredient-cost"
                  />
                  {highestIngredientCostPoint?.peak ? (
                    <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-400/30 dark:bg-orange-950/30">
                      <div className="type-caption font-black uppercase tracking-wide text-orange-700 dark:text-orange-200">Top Cost Driver</div>
                      <div className="mt-2 grid gap-3 sm:grid-cols-3">
                        <MetricCard label="Ingredient" value={highestIngredientCostPoint.ingredient} helper={highestIngredientCostPoint.category || "Ingredient"} tone="warning" size="compact" />
                        <MetricCard label="Month" value={formatMonthShort(highestIngredientCostPoint.peak.month)} helper={String(recipeTrendYear)} tone="warning" size="compact" />
                        <MetricCard label="Cost" value={formatRestaurantRecipeCurrency(highestIngredientCostPoint.peak.cost)} helper="Estimated cost" tone="warning" size="compact" />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-border bg-slate-50 p-3 type-body-sm text-text-secondary dark:bg-white/5">
                      No ingredient cost trend available for selected year.
                    </div>
                  )}
                </div>
              </RecipeIntelligenceCard>
            </div>
          </div>
        </DashboardSection> : null}
      </div>
    );
  }

  function renderActiveTab() {
    if (activeTab === "dashboard") return renderDashboard();
    if (activeTab === "master") return renderMasterInventory();
    if (activeTab === "stock-check") return renderStockCheck();
    if (activeTab === "requests") return renderRequests();
    if (activeTab === "orders") return renderOrders();
    if (activeTab === "recipe-intelligence") return renderRecipes();
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
    if (activeTab === "stock-check") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.createCheck, "create audit stock checks") && setModal({ type: "audit-stock-check" })}><ClipboardCheck size={15} /> Audit Stock Check</button>;
    }
    if (activeTab === "requests") return null;
    if (activeTab === "orders") {
      return <button className="btn-secondary" type="button" onClick={() => requirePermission(can.exportPo, "export purchase orders") && exportPurchaseOrders()}><Download size={15} /> Export</button>;
    }
    if (activeTab === "recipe-intelligence") {
      return null;
    }
    return (
      <button className="btn-secondary" type="button" onClick={() => requirePermission(can.export, "export inventory")}>
        <Download size={15} /> Export
      </button>
    );
  }

  const meta = pageMeta[activeTab] ?? pageMeta.dashboard;
  const poSurface = modal?.type === "po-surface" ? <InventoryPurchaseOrderSurface key={modal.orderId + (modal.action || "")} orderId={modal.orderId} initialAction={modal.action || "detail"} auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} onClose={() => setModal(null)} /> : null;

  if (activeTab !== "orders" && !["supabase", "refreshing"].includes(inventoryMeta.dataSource)) {
    const failed = inventoryMeta.dataSource === "remote_error";
    return <div className="space-y-4">
      <PageHeader section="INVENTORY CONTROL" title={meta.title} description={meta.description} />
      <div className="card p-4" role={failed ? "alert" : "status"}>
        <h2 className="font-semibold">{failed ? "Inventory data unavailable or incomplete" : "Loading complete Inventory data…"}</h2>
        {failed ? <><p className="mt-2 text-sm text-text-secondary">{inventoryMeta.purchaseOrdersError} No partial results are presented as complete.</p><button type="button" className="btn-secondary mt-3" onClick={refreshInventory}>Retry</button></> : null}
      </div>
      {poSurface}
    </div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="INVENTORY CONTROL"
        title={meta.title}
        description={meta.description}
        actions={renderPageActions()}
      />

      {inventoryMeta.dataSource === "refreshing" ? <p role="status" className="text-sm text-text-secondary">Refreshing Inventory. Showing the last verified complete read.</p> : null}
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
      {modal?.type === "audit-stock-check" ? <AuditStockCheckModal outlets={outlets} categories={sortedCategories} items={data.items} onClose={() => setModal(null)} onStart={startAuditStockCheck} /> : null}
      {modal?.type === "skip-check-row" ? <SkipReasonModal itemName={modal.itemName} onClose={() => setModal(null)} onSave={(reason) => skipCheckRow(modal.rowIndex, reason)} /> : null}
      {modal?.type === "ingredient-consumption" ? (
        <IngredientConsumptionModal
          rows={modal.rows || []}
          categories={modal.categories || []}
          filters={ingredientConsumptionFilters}
          onFilter={setIngredientConsumptionFilters}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "po-edit" ? <PurchaseOrderEditModal order={modal.order} suppliers={suppliers} items={data.items} onClose={() => setModal(null)} onSave={async (order) => { const result = await savePurchaseOrder(order); setModal(null); return result; }} /> : null}

      {modal?.type === "po-cancel" ? <CancelPurchaseOrderModal order={modal.order} displayPoNo={businessPoNo(modal.order)} onClose={() => setModal(null)} onCancel={(reason) => cancelPurchaseOrder(modal.order, reason)} /> : null}
      {modal?.type === "po-complete" ? <CompletePurchaseOrderModal order={modal.order} onClose={() => setModal(null)} onComplete={(reason) => completePurchaseOrder(modal.order, reason)} /> : null}

      {modal?.type === "purchase-suggestions" ? (
        <PurchaseSuggestionsModal
          suggestions={modal.suggestions}
          suppliers={suppliers}
          outlet={outletById.get(modal.stockCheck.outletId)}
          existingOrders={modal.existingOrders || linkedPurchaseOrdersForStockCheck(modal.stockCheck?.id)}
          businessPoNo={businessPoNo}
          onClose={() => setModal(null)}
          onCreateDraftPo={(rows) => createDraftPurchaseOrders(modal.stockCheck, rows)}
          onViewPurchaseOrder={(order) => setModal({ type: "po-surface", orderId: order.id })}
        />
      ) : null}
      {modal?.type === "check-result" ? <InventoryStockCheckResultModal
        stockCheck={modal.stockCheck || {}}
        isAuditResult={modal.isAudit || modal.stockCheck?.stockCheckType === "audit"}
        outletName={outletById.get(modal.stockCheck?.outletId)?.name || "Outlet"}
        submittedByName={modal.stockCheck?.submittedBy ? actorNameByEmployeeId(modal.stockCheck.submittedBy) : "Unknown User"}
        itemById={itemById}
        categoryById={categoryById}
        formatDate={formatDate}
        formatDateTimeCompact={formatDateTimeCompact}
        formatCurrency={formatRestaurantRecipeCurrency}
        ItemThumbnail={InventoryItemThumbnail}
        onPhotoPreview={setPhotoPreview}
        onClose={() => setModal(null)}
      /> : null}
      {poSurface}
      <InventoryItemPhotoPreview preview={photoPreview} onClose={() => setPhotoPreview(null)} />
    </div>
  );
}

function InventoryControlPage(props) {
  if (props.initialTab === "recipes") return <InventoryRecipesPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  if (props.initialTab === "movements") return <InventoryMovementsPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} />;
  if (props.initialTab === "par-levels") return <InventoryParLevelsPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} />;
  if (props.initialTab === "waste") return <InventoryWastePage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  if (props.initialTab === "groups") return <InventoryGroupsPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  return <InventoryLegacyRoutes {...props} />;
}

export default InventoryControlPage;
