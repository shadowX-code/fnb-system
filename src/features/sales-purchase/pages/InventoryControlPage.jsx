import InventoryMasterPage from "../inventory/master/InventoryMasterPage.jsx";
import { normalizeUom, mapRemoteUom } from "../inventory/master/inventoryMasterService.js";
import InventoryPurchaseOrdersWorkspace from "../inventory/purchaseOrders/InventoryPurchaseOrdersWorkspace.jsx";
import InventoryStockCheckRestockSurface from "../inventory/purchaseOrders/InventoryStockCheckRestockSurface.jsx";
import useAdminLocation from '../../../app/useAdminLocation.js';
import { mapRemotePurchaseOrder, persistRemotePurchaseOrderReceive, persistRemotePurchaseOrderStatus, persistRemotePurchaseOrderEdit, persistRemotePurchaseOrderCancel, persistRemotePurchaseOrderComplete } from "../inventory/purchaseOrders/inventoryPurchaseOrderService.js";
export { ReceiveInventoryModal } from "../inventory/purchaseOrders/ReceiveInventoryModal.jsx";
import { subscribeInventoryRevalidation } from "../../../services/inventoryRevalidation.js";
import { TextArea } from "../inventory/InventorySharedPresentation.jsx";
import InventoryParLevelsPage from "../inventory/parLevels/InventoryParLevelsPage.jsx";
import { mapRemoteInventoryItem, normalizeOutletRecord, normalizeInventoryItem, uniqueIds, mapRemoteCategory, outletConfigForItem, isActiveInventoryItem, canonical, isUuid, outletDisplayCode } from "../inventory/inventoryItemModel.js";
import { SectionCard, selectInputText, parseNonNegativeNumber, todayInput, getBusinessDateInput, toDateInputValue } from "../inventory/InventorySharedPresentation.jsx";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Download,
  PackagePlus,
  Search,
  ShoppingCart,
  Sparkles,
  Warehouse,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
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
import InventoryRecipeIntelligencePage from "../inventory/recipeIntelligence/InventoryRecipeIntelligencePage.jsx";
import { recipeMenuCategories } from "../inventory/recipes/inventoryRecipeReadModel.js";
import { Field } from "../inventory/InventorySharedPresentation.jsx";
import { mapRemoteMenuCategory } from "../inventory/recipes/inventoryRecipeReadModel.js";
import { persistRemoteRecipe } from "../inventory/recipes/inventoryRecipeService.js";
export { RecipeModal } from "../inventory/recipes/InventoryRecipeForms.jsx";
import InventoryWastePage from "../inventory/waste/InventoryWastePage.jsx";
import InventoryItemPhotoPreview from "../inventory/InventoryItemPhotoPreview.jsx";
import { mapRemoteWasteRecord, persistRemoteWasteRecord } from "../inventory/waste/inventoryWasteService.js";
import InventoryMovementsPage from "../inventory/movements/InventoryMovementsPage.jsx";
import { mapRemoteInventoryMovement, persistRemoteInventoryMovement, persistRemoteInventoryMovementUpdate } from "../inventory/movements/inventoryMovementService.js";
import InventoryGroupsPage from "../inventory/groups/InventoryGroupsPage.jsx";
import { mapRemoteStockCheckGroup, stockCheckItemsForGroup } from "../inventory/groups/inventoryGroupsModel.js";
import InventoryStockCheckResultSurface from "../inventory/stockChecks/InventoryStockCheckResultSurface.jsx";
import { mapRemoteStockCheck } from "../inventory/stockChecks/inventoryStockCheckReadModel.js";
import InventoryItemThumbnail from "../inventory/InventoryItemThumbnail.jsx";
import { linkedPurchaseOrdersForStockCheck } from "../inventory/purchaseOrders/inventoryPurchaseOrderHelpers.js";
import { getAccessibleOutletOptions, getAccessibleOutlets, hasAllOutletAccess, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { resolveAdminLocation, navigateAdminRoute } from "../../../app/routeOwnership.js";

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


















async function loadRemoteInventoryMaster() {
  const itemsResult = await readCompleteInventoryRows("inventory_items", { order: "created_at", ascending: false });
  if (itemsResult.error) throw itemsResult.error;

  const [categoriesResult, uomsResult, itemOutletsResult, itemOutletSuppliersResult, stockGroupsResult, stockGroupCategoriesResult, stockChecksResult, stockCheckItemsResult, purchaseOrdersResult, purchaseOrderItemsResult, purchaseReceiptsResult, purchaseReceiptItemsResult, movementsResult, wasteResult, employeesResult] = await Promise.all([
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
  // Legacy non-recipe routes retain the data shape, not the recipe bootstrap.
  const recipes = [];
  const menuCategories = [];

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

// Compatibility test facade; PO commands are owned by the canonical PO service.
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


function outletConfigsForScope(item = {}, outletIds = []) {
  const allowed = new Set(outletIds);
  return (normalizeInventoryItem(item).outletConfigs || []).filter((config) => (!outletIds.length || allowed.has(config.outletId)));
}

function parLevelForOutlet(item = {}, outletId) {
  return outletConfigForItem(item, outletId).parLevel;
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
      const remote = await loadRemoteInventoryMaster();
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

  useEffect(() => subscribeInventoryRevalidation(() => { refreshInventory(); }), [refreshInventory]);

  return [data, setData, meta, refreshInventory];
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











function InventoryLegacyRoutes({ store, auth, ui, initialTab = "dashboard" }) {
  const initialStockCheckDate = useMemo(getInitialStockCheckDate, []);
  const outlets = useMemo(() => (store?.outlets ?? []).map(normalizeOutletRecord), [store?.outlets]);
  const suppliers = useMemo(() => store?.suppliers ?? [], [store?.suppliers]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [data, setData, inventoryMeta, refreshInventory] = useInventoryData(outlets, suppliers);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const [date, setDateState] = useState(initialStockCheckDate.date);
  const [selectedDateSource, setSelectedDateSource] = useState(initialStockCheckDate.source);
  const selectedDateSourceRef = useRef(initialStockCheckDate.source);
  const [stockCheckShiftFilter, setStockCheckShiftFilter] = useState("all");
  const [modal, setModal] = useState(null);
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


  const can = useMemo(() => ({
    export: hasPermission(auth, "inventory_master.export") || hasPermission(auth, "inventory_par_levels.export") || hasPermission(auth, "inventory_stock_check.export") || hasPermission(auth, "inventory_orders.export") || hasPermission(auth, "inventory_movements.export") || hasPermission(auth, "inventory_waste.export") || hasPermission(auth, "inventory_recipes.export"),
    createCheck: hasPermission(auth, "inventory_stock_check.create") || hasPermission(auth, "inventory_stock_check.audit"),
    editCheck: hasPermission(auth, "inventory_stock_check.edit"),
    reviewCheck: hasPermission(auth, "inventory_stock_check.review"),
    generatePo: hasPermission(auth, "inventory_orders.create"),
    viewInsights: hasPermission(auth, "inventory_dashboard.view"),
  }), [activeTab, auth]);

  const sortedCategories = useMemo(() => [...data.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name)), [data.categories]);
  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);
  const peopleById = useMemo(() => new Map((data.people || []).map((person) => [person.id, person])), [data.people]);
  const peopleByAuthId = useMemo(() => new Map((data.people || []).filter((person) => person.authUserId).map((person) => [person.authUserId, person])), [data.people]);
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

  function latestCheckForGroup(group) {
    return [...data.checks]
      .filter((check) => checkMatchesGroupRun(check, group, date, stockCheckShiftFilter))
      .sort((a, b) => new Date(b.submittedAt || b.updatedAt || b.date || 0) - new Date(a.submittedAt || a.updatedAt || a.date || 0))[0] || null;
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
                const linkedOrders = latestCheck ? linkedPurchaseOrdersForStockCheck(data.orders, latestCheck.id) : [];
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
                            onClick={() => requirePermission(canReviewSuggestions, "review purchase suggestions") && navigateAdminRoute('inventory-stock-check-restock', { checkId: latestCheck.id }, { date })}
                          >
                            {linkedOrders.length ? "View Draft PO" : "Review Purchase Suggestions"}
                          </button>
                          <button className="btn-secondary w-full" type="button" onClick={() => navigateAdminRoute('inventory-stock-check-result', { checkId: latestCheck.id }, { date })}>View Result</button>
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
                      <button className="btn-secondary mt-4 w-full" type="button" onClick={() => navigateAdminRoute('inventory-stock-check-result', { checkId: check.id }, { date })}>View Audit Result</button>
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

  function renderActiveTab() {
    if (activeTab === "dashboard") return renderDashboard();
    if (activeTab === "stock-check") return renderStockCheck();
    if (activeTab === "requests") return renderRequests();
    return null;
  }

  function renderPageActions() {
    if (activeTab === "stock-check") {
      return <button className="btn-primary" type="button" onClick={() => requirePermission(can.createCheck, "create audit stock checks") && setModal({ type: "audit-stock-check" })}><ClipboardCheck size={15} /> Audit Stock Check</button>;
    }
    if (activeTab === "requests") return null;
    return (
      <button className="btn-secondary" type="button" onClick={() => requirePermission(can.export, "export inventory")}>
        <Download size={15} /> Export
      </button>
    );
  }

  const meta = pageMeta[activeTab] ?? pageMeta.dashboard;
  if (!["supabase", "refreshing"].includes(inventoryMeta.dataSource)) {
    const failed = inventoryMeta.dataSource === "remote_error";
    return <div className="space-y-4">
      <PageHeader section="INVENTORY CONTROL" title={meta.title} description={meta.description} />
      <div className="card p-4" role={failed ? "alert" : "status"}>
        <h2 className="font-semibold">{failed ? "Inventory data unavailable or incomplete" : "Loading complete Inventory data…"}</h2>
        {failed ? <><p className="mt-2 text-sm text-text-secondary">{inventoryMeta.purchaseOrdersError} No partial results are presented as complete.</p><button type="button" className="btn-secondary mt-3" onClick={refreshInventory}>Retry</button></> : null}
      </div>
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

      {modal?.type === "audit-stock-check" ? <AuditStockCheckModal outlets={outlets} categories={sortedCategories} items={data.items} onClose={() => setModal(null)} onStart={startAuditStockCheck} /> : null}
      {modal?.type === "skip-check-row" ? <SkipReasonModal itemName={modal.itemName} onClose={() => setModal(null)} onSave={(reason) => skipCheckRow(modal.rowIndex, reason)} /> : null}
      <InventoryItemPhotoPreview preview={photoPreview} onClose={() => setPhotoPreview(null)} />
    </div>
  );
}

function InventoryControlPage(props) {
  const route = useAdminLocation();
  if (route?.definitionId === 'inventory-stock-check-restock') return <InventoryStockCheckRestockSurface checkId={route.params.checkId} auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} onClose={() => navigateAdminRoute('inventory_stock_check', {}, route.query)} />;
  if (props.initialTab === 'orders') return <InventoryPurchaseOrdersWorkspace auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} />;
  if (route?.definitionId === 'inventory-stock-check-result') return <InventoryStockCheckResultSurface checkId={route.params.checkId} auth={props.auth} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} onClose={() => navigateAdminRoute('inventory_stock_check', {}, route.query)} />;
  if (props.initialTab === "recipe-intelligence") return <InventoryRecipeIntelligencePage auth={props.auth} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  if (props.initialTab === "recipes") return <InventoryRecipesPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  if (props.initialTab === "master") return <InventoryMasterPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} />;
  if (props.initialTab === "movements") return <InventoryMovementsPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} />;
  if (props.initialTab === "par-levels") return <InventoryParLevelsPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} />;
  if (props.initialTab === "waste") return <InventoryWastePage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  if (props.initialTab === "groups") return <InventoryGroupsPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  return <InventoryLegacyRoutes {...props} />;
}

export default InventoryControlPage;
