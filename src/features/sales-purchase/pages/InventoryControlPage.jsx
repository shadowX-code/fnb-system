import InventoryMasterPage from "../inventory/master/InventoryMasterPage.jsx";
import { mapRemoteUom } from "../inventory/master/inventoryMasterService.js";
import InventoryPurchaseOrdersWorkspace from "../inventory/purchaseOrders/InventoryPurchaseOrdersWorkspace.jsx";
import InventoryStockCheckRestockSurface from "../inventory/purchaseOrders/InventoryStockCheckRestockSurface.jsx";
import useAdminLocation from '../../../app/useAdminLocation.js';
import { mapRemotePurchaseOrder, persistRemotePurchaseOrderReceive, persistRemotePurchaseOrderStatus, persistRemotePurchaseOrderEdit, persistRemotePurchaseOrderCancel, persistRemotePurchaseOrderComplete } from "../inventory/purchaseOrders/inventoryPurchaseOrderService.js";
export { ReceiveInventoryModal } from "../inventory/purchaseOrders/ReceiveInventoryModal.jsx";
import { subscribeInventoryRevalidation } from "../../../services/inventoryRevalidation.js";
import InventoryParLevelsPage from "../inventory/parLevels/InventoryParLevelsPage.jsx";
import { mapRemoteInventoryItem, normalizeOutletRecord, normalizeInventoryItem, uniqueIds, mapRemoteCategory, outletConfigForItem, isActiveInventoryItem, outletDisplayCode } from "../inventory/inventoryItemModel.js";
import { SectionCard, todayInput, getBusinessDateInput, toDateInputValue } from "../inventory/InventorySharedPresentation.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardCheck,
  Download,
  PackagePlus,
  Sparkles,
  Warehouse,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { readCompleteInventoryRows } from "../../../services/inventoryCompleteRead.js";
import InventoryRecipesPage from "../inventory/recipes/InventoryRecipesPage.jsx";
import InventoryRecipeIntelligencePage from "../inventory/recipeIntelligence/InventoryRecipeIntelligencePage.jsx";
import { recipeMenuCategories } from "../inventory/recipes/inventoryRecipeReadModel.js";
import { mapRemoteMenuCategory } from "../inventory/recipes/inventoryRecipeReadModel.js";
import { persistRemoteRecipe } from "../inventory/recipes/inventoryRecipeService.js";
export { RecipeModal } from "../inventory/recipes/InventoryRecipeForms.jsx";
import InventoryWastePage from "../inventory/waste/InventoryWastePage.jsx";
import { mapRemoteWasteRecord, persistRemoteWasteRecord } from "../inventory/waste/inventoryWasteService.js";
import InventoryMovementsPage from "../inventory/movements/InventoryMovementsPage.jsx";
import { mapRemoteInventoryMovement, persistRemoteInventoryMovement, persistRemoteInventoryMovementUpdate } from "../inventory/movements/inventoryMovementService.js";
import InventoryGroupsPage from "../inventory/groups/InventoryGroupsPage.jsx";
import { mapRemoteStockCheckGroup, stockCheckItemsForGroup } from "../inventory/groups/inventoryGroupsModel.js";
import InventoryStockCheckResultSurface from "../inventory/stockChecks/InventoryStockCheckResultSurface.jsx";
import InventoryStockCheckPage from "../inventory/stockChecks/InventoryStockCheckPage.jsx";
import { persistRemoteStockCheck, deleteRemoteStockCheckDraft } from "../inventory/stockChecks/inventoryStockCheckExecutionService.js";
import { mapRemoteStockCheck } from "../inventory/stockChecks/inventoryStockCheckReadModel.js";
import { hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { navigateAdminRoute } from "../../../app/routeOwnership.js";

const STORAGE_KEY = "feedx.inventoryControl.v2";
const LEGACY_STORAGE_KEYS = ["feedx.inventoryControl.v1"];
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




function normalizeBusinessDate(value, fallback = todayInput()) {
  if (value instanceof Date) return toDateInputValue(value) || fallback;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  return toDateInputValue(raw) || fallback;
}

function businessDateToLocalDate(value) {
  const [year, month, day] = normalizeBusinessDate(value).split("-").map(Number);
  return new Date(year, month - 1, day);
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

function isActionableStockCheckStatus(status) {
  return ["Due Today", "Completed", "Draft", "Skipped", "Missed"].includes(status);
}

function latestActualCount(checks = [], itemId, outletId) {
  const rows = checks
    .filter((check) => check.outletId === outletId && ["submitted", "reviewed", "locked"].includes(check.status))
    .flatMap((check) => (check.rows || []).map((row) => ({ ...row, checkDate: check.date, submittedAt: check.submittedAt })))
    .filter((row) => row.itemId === itemId && !row.na)
    .sort((a, b) => new Date(b.submittedAt || b.checkDate || 0) - new Date(a.submittedAt || a.checkDate || 0));
  return Number(rows[0]?.actualCount ?? Number.POSITIVE_INFINITY);
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






function InventoryLegacyRoutes({ store, auth, ui }) {
  const outlets = useMemo(() => (store?.outlets ?? []).map(normalizeOutletRecord), [store?.outlets]);
  const suppliers = useMemo(() => store?.suppliers ?? [], [store?.suppliers]);
  const [data, , inventoryMeta, refreshInventory] = useInventoryData(outlets, suppliers);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const date = getBusinessDateInput("Asia/Kuala_Lumpur");
  const selectedOutletIds = selectedOutletId === "all" ? outlets.map((outlet) => outlet.id) : [selectedOutletId];
  const stockCheckShiftFilter = "all";
  const can = { viewInsights: hasPermission(auth, "inventory_dashboard.view"), export: hasPermission(auth, "inventory_master.export") };
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);
  const scopedGroups = data.groups.filter((group) => selectedOutletIds.includes(group.outletId));
  const dueGroups = scopedGroups.filter((group) => isActionableStockCheckStatus(dueStatus(group, data.checks, date)));
  const dashboard = {
    inventoryValue: data.items.filter((item) => selectedOutletId === "all" || item.linkedOutletIds?.includes(selectedOutletId)).reduce((sum, item) => sum + outletConfigsForScope(item, selectedOutletIds).reduce((total, config) => total + Number(config.parLevel || 0) * 8, 0), 0),
    lowStock: data.items.filter((item) => selectedOutletId === "all" || item.linkedOutletIds?.includes(selectedOutletId)).reduce((count, item) => count + outletConfigsForScope(item, selectedOutletIds).filter((config) => Number(config.parLevel || 0) > 0 && latestActualCount(data.checks, item.id, config.outletId) < Number(config.parLevel || 0)).length, 0),
    pendingOrders: data.orders.filter((order) => selectedOutletIds.includes(order.outletId || order.outletIds?.[0]) && !["completed", "cancelled"].includes(order.status)).length,
    varianceRisk: dueGroups.filter((group) => dueStatus(group, data.checks, date) === "Missed").length,
    checkCompletion: dueGroups.length ? Math.round(dueGroups.filter((group) => dueStatus(group, data.checks, date) === "Completed").length / dueGroups.length * 100) : 100,
  };
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
                      <td><button className="text-xs font-bold text-primary" type="button" onClick={() => navigateAdminRoute("inventory_stock_check", {}, { outletId: row.outlet.id })}>Open checks</button></td>
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

  const meta = pageMeta.dashboard;
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
  return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title={meta.title} description={meta.description} actions={<button className="btn-secondary" type="button" onClick={() => !can.export && notifyPermissionDenied(ui, "export inventory")}><Download size={15} /> Export</button>} />
    {inventoryMeta.dataSource === "refreshing" ? <p role="status" className="text-sm text-text-secondary">Refreshing Inventory. Showing the last verified complete read.</p> : null}
    {renderDashboard()}
  </div>;
}

function InventoryControlPage(props) {
  const route = useAdminLocation();
  if (route?.definitionId === 'inventory-stock-check-restock') return <InventoryStockCheckRestockSurface checkId={route.params.checkId} auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} onClose={() => navigateAdminRoute('inventory_stock_check', {}, route.query)} />;
  if (route?.definitionId === 'inventory-stock-check-result') return <InventoryStockCheckResultSurface checkId={route.params.checkId} auth={props.auth} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} onClose={() => navigateAdminRoute('inventory_stock_check', {}, route.query)} />;
  if (props.initialTab === "stock-check") return <InventoryStockCheckPage auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} />;
  if (props.initialTab === 'orders') return <InventoryPurchaseOrdersWorkspace auth={props.auth} ui={props.ui} outlets={(props.store?.outlets || []).map(normalizeOutletRecord)} suppliers={props.store?.suppliers || []} />;
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
