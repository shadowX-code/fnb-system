import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleOff, ClipboardCheck, ClipboardList, Clock3, Copy, DollarSign, Factory, FileText, Package, PackageCheck, Play, Plus, RefreshCw, RotateCcw, Tag, Trash2, Truck, Warehouse, X } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FactoryPagination, { FactoryTableLoadState, useFactoryClientPagination, useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import { AccessIssueNotice, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryBulkSelectionModal, { CompactSelect, Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import FactoryAuditTrailPage from "./FactoryAuditTrailPage.jsx";
import FactorySuppliersPage from "./FactorySuppliersPage.jsx";
import FactoryCustomersPage from "./FactoryCustomersPage.jsx";
import FactoryStorageLocationsPage from "./FactoryStorageLocationsPage.jsx";
import FactoryProductionPlanningPage from "./FactoryProductionPlanningPage.jsx";
import FactoryDashboardPage from "./FactoryDashboardPage.jsx";
import FactoryFinishedGoodsPage from "./FactoryFinishedGoodsPage.jsx";
import FactoryRawMaterialInventoryPage from "./FactoryRawMaterialInventoryPage.jsx";
import FactoryProductRecipesPage from "./FactoryProductRecipesPage.jsx";
import FactoryBatchTraceabilityPage from "./FactoryBatchTraceabilityPage.jsx";
import { activeRecipeForSku, finishedGoodParentKey, inheritedRecipeUom, packagingProductionPlan } from "../utils/productionPlanning.js";
import { canEditFinishedGoods, canOpenRawMaterialReceiving } from "../utils/factoryPermissionActions.js";
import FinishedGoodBatchTraceabilityModal from "../modals/FinishedGoodBatchTraceabilityModal.jsx";
import FactoryRawMaterialMovementDetailModal from "../modals/FactoryRawMaterialMovementDetailModal.jsx";
import ProductGroupModal from "../modals/finishedGoods/FactoryProductGroupModal.jsx";
import FinishedGoodMasterModal from "../modals/finishedGoods/FactoryFinishedGoodMasterModal.jsx";
import FinishedGoodCategoryModal from "../modals/finishedGoods/FactoryFinishedGoodCategoryModal.jsx";
import RawMaterialMasterModal from "../modals/rawMaterials/FactoryRawMaterialMasterModal.jsx";
import RawMaterialCostModal from "../modals/rawMaterials/FactoryRawMaterialCostModal.jsx";
import RawMaterialImagePreviewModal from "../modals/rawMaterials/FactoryRawMaterialImagePreviewModal.jsx";
import RawMaterialCategoryModal from "../modals/rawMaterials/FactoryRawMaterialCategoryModal.jsx";
import StorageLocationModal from "../modals/FactoryStorageLocationModal.jsx";
import FactorySupplierModal from "../modals/FactorySupplierModal.jsx";
import FactoryCustomerModal from "../modals/FactoryCustomerModal.jsx";
import ProductionPlanningParModal from "../modals/ProductionPlanningParModal.jsx";
import FactoryProductMovementsPage from "./FactoryProductMovementsPage.jsx";
import FactoryRawMaterialMovementsPage from "./FactoryRawMaterialMovementsPage.jsx";
import { FactoryMasterDataProvider } from "../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../context/FactoryPermissionsContext.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService, productionQcStatus, strictDateTimeValue, strictDateValue, strictTimeValueMinutes } from "../../../services/factoryService.js";
import { IMAGE_UPLOAD_ACCEPT } from "../../../utils/imageUpload.js";
import useFactoryNumberPreview from "../hooks/useFactoryNumberPreview.js";
import { addDaysToFactoryDate, factoryMonthLabel, formatDateDisplay, formatFactoryAuditDateTime, formatFactoryDate, formatFactoryDateTime, formatFactoryReadableDate, isoDate, malaysiaBusinessDateInput, monthStart, productionDurationLabel, timeInput, todayInput } from "../utils/factoryDates.js";
import { ledgerQuantity, ledgerQuantityList, money, percent, productionTimeLabel, quantity, signedQuantity, sopMinutesLabel, sopStepEstimatedMinutes, sopTotalEstimatedMinutes, validSopMinutes } from "../utils/factoryFormatters.js";
import { uniqueReceivingBatchPreview } from "../utils/factoryNumbers.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { jobPriorityTone, jobStatusLabel, rawMovementTypeMeta, statusTone } from "../utils/factoryStatus.js";
import { costDisplay, latestReceivingCostInfo, productionCost, productionCostInfo, recipeCostInfo, usageUnitCost, usageUnitCostInfo } from "../utils/factoryCosting.js";

const priorityOptions = ["Low", "Normal", "High", "Urgent"];
const jobStatusOptions = ["draft", "released", "in_progress", "completed", "cancelled"];
const commonUoms = ["kg", "g", "litre", "ml", "pcs", "carton", "pail", "bottle", "pack"];
const packagingTypes = ["Pack", "Bottle", "Sachet", "Tub", "Pail", "Bag", "Carton", "Tray", "Box"];
const factoryCustomerTypes = ["Outlet", "Distributor", "Retailer", "OEM", "Export", "Other"];
const storageLocationTypes = ["Dry Store", "Chiller", "Freezer", "Production Area", "Finished Goods Area", "Packaging Area"];
const qcStatusOptions = ["Pending", "Pass", "Hold", "Failed"];
const sopQcMeasurementOptions = [
  { value: "numeric", label: "Numeric" },
  { value: "pass_fail", label: "Pass / Fail" },
  { value: "text", label: "Text" },
  { value: "checklist", label: "Checklist" },
];
const varianceThresholdPercent = 5;
const varianceReasonTolerance = 0.000001;
const stockCheckCriticalPercent = 5;

function anchoredRect(anchor, width, height) {
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 16;
  const popoverWidth = Math.min(Math.max(rect.width, width), window.innerWidth - viewportPadding * 2);
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const openUpward = spaceBelow < height && rect.top > height;
  return {
    left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - popoverWidth - viewportPadding)),
    top: openUpward ? Math.max(viewportPadding, rect.top - height - 6) : rect.bottom + 6,
    width: popoverWidth,
    maxHeight: openUpward ? Math.min(height, rect.top - viewportPadding - 8) : Math.min(height, spaceBelow),
  };
}

function employeeDisplayName(auth) {
  return auth?.profile?.nickname || auth?.profile?.full_name || auth?.profile?.email || "";
}

function RawMaterialCellPicker({ value, materials, placeholder, open, onToggle, onClose, onSelect, error, buttonRef }) {
  const [query, setQuery] = useState("");
  const anchorRef = useRef(null);
  const selected = materials.find((material) => material.id === value);
  const visibleMaterials = materials.filter((material) => `${rawMaterialLabel(material)} ${rawMaterialSummary(material)} ${material.storage_location || ""}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function setButtonNode(node) {
    anchorRef.current = node;
    if (typeof buttonRef === "function") buttonRef(node);
    else if (buttonRef) buttonRef.current = node;
  }

  return (
    <div>
      <button
        ref={setButtonNode}
        className={`min-h-[54px] w-full rounded-xl border bg-surface px-3 py-2 text-left outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${error ? "border-rose-300" : "border-border"}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={onToggle}
      >
        {selected ? (
          <span className="block">
            <span className="block truncate text-sm font-semibold text-text-primary">{rawMaterialLabel(selected)}</span>
            <span className="mt-0.5 block truncate text-xs text-text-secondary">{rawMaterialSummary(selected)}</span>
          </span>
        ) : (
          <span className="block text-sm font-semibold text-text-muted">{placeholder}</span>
        )}
      </button>
      <FloatingLayer
        open={open}
        onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
        anchorRef={anchorRef}
        align="start"
        minWidth={280}
        estimatedHeight={360}
        maxHeight={420}
        placement="auto"
        focusOnOpen
      >
          <input
            className="mb-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search raw material"
          />
          <div className="max-h-[280px] overflow-y-auto pr-1" role="listbox" aria-label="Raw Materials">
            {visibleMaterials.length ? visibleMaterials.map((material) => (
              <button
                key={material.id}
                className={`mb-1.5 block w-full rounded-xl border px-3 py-2.5 text-left transition last:mb-0 hover:border-primary hover:bg-primary/5 ${material.id === value ? "border-primary bg-primary/10" : "border-transparent bg-white"}`}
                type="button"
                onClick={() => onSelect(material.id)}
                role="option"
                aria-selected={material.id === value}
              >
                <span className="block truncate text-sm font-bold text-text-primary">{rawMaterialLabel(material)}</span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">{rawMaterialSummary(material)}</span>
                {material.storage_location ? <span className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-text-secondary">{material.storage_location}</span> : null}
              </button>
            )) : <div className="px-3 py-5 text-center text-sm font-semibold text-text-secondary">No matching raw materials</div>}
          </div>
      </FloatingLayer>
    </div>
  );
}

 function focusFirstInvalid(refs, firstKey) {
  setTimeout(() => {
    const node = refs.current?.[firstKey];
    node?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    node?.focus?.({ preventScroll: true });
  }, 0);
}

function focusVisibleFactoryRowField(field, rowId) {
  setTimeout(() => {
    const nodes = [...document.querySelectorAll(`[data-factory-row-field="${field}"]`)];
    const node = nodes.find((candidate) => candidate.dataset.rowId === rowId && candidate.offsetParent !== null)
      || nodes.find((candidate) => candidate.dataset.rowId === rowId);
    node?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    node?.focus?.({ preventScroll: true });
  }, 0);
}

function finishedGoodLabel(product) {
  return product?.product_family_name || product?.product_name_en || product?.product_name || "";
}

function finishedGoodHelper(product) {
  const packSize = Number(product?.pack_size_qty || 0) > 0 ? `${product.pack_size_qty} ${product.pack_size_uom || ""}`.trim() : "";
  return [product?.variant_name, product?.product_code, packSize, packagingTypeLabel(product)].filter(Boolean).join(" · ");
}

function rawMaterialLabel(material) {
  return material?.name_en || material?.name || "";
}

function rawMaterialHelper(material) {
  return [material?.material_code, material?.name_cn || material?.name_bm, material?.uom].filter(Boolean).join(" · ");
}

function rawMaterialSummary(material) {
  return `${material?.material_code || "No SKU"} · Balance ${quantity(material?.current_balance, material?.uom)}`;
}

function WarehouseBarList({ rows, valueLabel }) {
  const maxValue = Math.max(...rows.map((row) => Number(row.value || 0)), 1);
  if (!rows.length) return <EmptyState title="No warehouse data" description="Complete production or stock movements to populate this view." />;
  return (
    <div className="space-y-3 p-4">
      {rows.map((row) => (
        <div key={row.id || row.label}>
          <div className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className="truncate text-text-primary">{row.label}</span>
            <span className="shrink-0 text-text-secondary">{valueLabel ? valueLabel(row.value, row) : row.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(6, (Number(row.value || 0) / maxValue) * 100)}%` }} />
          </div>
          {row.helper ? <div className="mt-1 text-xs text-text-muted">{row.helper}</div> : null}
        </div>
      ))}
    </div>
  );
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
  const variancePercent = system > 0 ? (variance / system) * 100 : null;
  const absVariance = Math.abs(variance);
  const absPercent = Math.abs(Number(variancePercent || 0));
  const status = absVariance === 0
    ? "Normal"
    : system > 0 && absPercent >= stockCheckCriticalPercent
      ? "Critical"
      : system <= 0
        ? "Critical"
        : "Variance";
  return { variance, variancePercent, status };
}

function stockCheckDifferenceLabel(variance, { skipped = false, hasCount = true, uom = "Packs" } = {}) {
  if (skipped) return "Skipped";
  if (!hasCount) return "Not counted";
  const amount = Math.abs(Number(variance || 0));
  const unit = uom || "Packs";
  if (variance < 0) return `Missing ${quantity(amount, unit)}`;
  if (variance > 0) return `Extra ${quantity(amount, unit)}`;
  return "Matched";
}

function stockVarianceTone(status) {
  if (status === "Critical") return "danger";
  if (status === "Warning" || status === "Variance") return "warning";
  return "success";
}

function stockCheckVarianceSummary(items = []) {
  const skippedCount = items.filter((item) => item.variance_status === "Skipped" || item.count_status === "skip").length;
  const varianceItems = items
    .filter((item) => item.variance_status !== "Skipped" && item.count_status !== "skip")
    .map((item) => ({ item, variance: stockCheckVariance(item.system_qty, item.physical_qty) }))
    .filter(({ variance }) => variance.status !== "Normal");
  if (!varianceItems.length) return skippedCount ? { label: "Skipped", tone: "neutral" } : { label: "Normal", tone: "success" };

  const byUom = new Map();
  varianceItems.forEach(({ item, variance }) => {
    const uom = item.uom || "";
    byUom.set(uom, (byUom.get(uom) || 0) + Number(variance.variance || 0));
  });
  const criticalCount = varianceItems.filter(({ variance }) => variance.status === "Critical").length;
  const status = criticalCount ? "Critical" : "Variance";
  if (byUom.size === 1) {
    const [[uom, total]] = [...byUom.entries()];
    return { label: `${signedQuantity(total, uom)} (${status})`, tone: status === "Critical" ? "danger" : "warning" };
  }
  return { label: `${varianceItems.length} mixed (${status})`, tone: status === "Critical" ? "danger" : "warning" };
}

function normalizePackSizeToBase(qty, uom) {
  const amount = Number(qty || 0); const unit = String(uom || "").trim().toLowerCase();
  if (!amount || !unit) return null;
  if (["kg", "kilogram", "kilograms"].includes(unit)) return { amount, uom: "kg" };
  if (["g", "gram", "grams"].includes(unit)) return { amount: amount / 1000, uom: "kg" };
  if (["l", "litre", "liter", "litres", "liters"].includes(unit)) return { amount, uom: "L" };
  if (["ml", "millilitre", "milliliter", "millilitres", "milliliters"].includes(unit)) return { amount: amount / 1000, uom: "L" };
  return null;
}

function packagingPackEstimate(productionQty, productionUom, sku, recipeUom = "") {
  const targetProductionQty = Number(productionQty || 0); const packSizeQty = Number(sku?.pack_size_qty || sku?.base_qty || 0); const packSizeUom = sku?.pack_size_uom || sku?.base_uom || ""; const packBase = normalizePackSizeToBase(packSizeQty, packSizeUom); const productionBase = normalizePackSizeToBase(targetProductionQty, productionUom); const recipeBase = recipeUom ? normalizePackSizeToBase(1, recipeUom) : null;
  if (!targetProductionQty) return { target_pack_qty: 0, target_production_qty: 0, production_uom: productionUom || recipeBase?.uom || packBase?.uom || "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  if (!String(productionUom || "").trim()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM is required." };
  if (!packSizeQty || !packSizeUom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU needs Pack Size before creating Job Order." };

  if (packBase) {
    if (!productionBase) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
    if (productionBase.uom !== packBase.uom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
    if (recipeBase && recipeBase.uom !== productionBase.uom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM must match the active recipe UOM." };
    return { target_pack_qty: productionBase.amount / packBase.amount, target_production_qty: productionBase.amount, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  }

  const normalizedPackUom = String(packSizeUom || "").trim();
  const normalizedProductionUom = String(productionUom || "").trim();
  const normalizedRecipeUom = String(recipeUom || "").trim();
  if (normalizedRecipeUom && normalizedRecipeUom.toLowerCase() !== normalizedProductionUom.toLowerCase()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM must match the active recipe UOM." };
  if (normalizedPackUom.toLowerCase() !== normalizedProductionUom.toLowerCase()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
  return { target_pack_qty: targetProductionQty / packSizeQty, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
}

function packagingBaseBalanceInfo(skus = []) {
  if (!skus.length) return { label: "—", amount: null, uom: "" };
  let total = 0;
  let baseUom = "";
  for (const sku of skus) {
    const base = normalizePackSizeToBase(sku.pack_size_qty || sku.base_qty, sku.pack_size_uom || sku.base_uom);
    if (!base) return { label: "Mixed", amount: null, uom: "" };
    if (baseUom && baseUom !== base.uom) return { label: "Mixed", amount: null, uom: "" };
    baseUom = base.uom;
    total += Number(sku.current_balance || 0) * base.amount;
  }
  return { label: quantity(total, baseUom), amount: total, uom: baseUom };
}

function variantIsPackSize(sku) {
  const variant = compactCompare(sku?.variant_name);
  if (!variant) return true;
  const packSize = compactCompare(packSizeText(sku));
  if (!packSize) return false;
  return variant === packSize || variant === `${packSize}pack` || variant === `${packSize}packing`;
}

function jobProgressPercent(job) {
  if (job?.status === "completed") return 100;
  if (job?.status === "in_progress") return 50;
  return 0;
}

function progressToneClass(percent) {
  if (percent >= 100) return "bg-emerald-500";
  if (percent >= 50) return "bg-amber-500";
  return "bg-blue-500";
}

function jobFinishedGoodName(job) {
  return job?.product_family_name || job?.product_name_en || job?.product_name || "Finished Good";
}

function jobPackagingSkuLabel(job) {
  return [job?.variant_name || packSizeText(job) || "Packaging SKU", job?.product_code || "No SKU"].filter(Boolean).join(" · ");
}

function factoryTimeLabel(value) {
  if (!value) return "—";
  if (/^\d{2}:\d{2}/.test(String(value))) return String(value).slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
}

function factoryTimeAmPmLabel(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ""));
  if (!match) return "—";
  const hours = Number(match[1]);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, "0")}:${minutes} ${period}`;
}

function factorySavedTimeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

function productionQcEditableSignature(execution) {
  return JSON.stringify((execution?.steps || []).flatMap((step) => (step.qc_results || []).map((qc) => ({
    id: qc.id,
    checklist_result: String(qc.checklist_result || "").toLowerCase(),
    remarks: String(qc.remarks || "").trim(),
  }))));
}

function latestProductionQcSavedAt(execution) {
  return (execution?.steps || []).flatMap((step) => step.qc_results || []).map((qc) => qc.checked_at).filter(Boolean).sort().at(-1) || "";
}

function productionQcDisplayLabel(status) {
  const normalized = String(status || "").trim().toLowerCase().replace(/_/g, " ");
  if (normalized === "no production") return "No Production";
  if (["not started", "in progress", "pending", "incomplete"].includes(normalized)) return "QC Incomplete";
  if (["fail", "failed"].includes(normalized)) return "QC Failed";
  if (["pass", "passed"].includes(normalized)) return "QC Passed";
  if (["no qc", "no qc required", "not required"].includes(normalized)) return "No QC Required";
  return "Metadata unavailable";
}

function productionQcTone(status) {
  const normalized = String(status || "").trim().toLowerCase().replace(/_/g, " ");
  if (["fail", "failed"].includes(normalized)) return "danger";
  if (["pass", "passed"].includes(normalized)) return "success";
  if (["not started", "in progress", "pending", "incomplete"].includes(normalized)) return "warning";
  return "neutral";
}

function jobProductionQcState(job) {
  return productionQcStatus((job?.step_executions || []).flatMap((step) => step.qc_results || []));
}

function factoryActivityDateTime(dateValue, timeValue, timestampValue = "") {
  const dateTimestamp = strictDateValue(dateValue);
  const timeMinutes = strictTimeValueMinutes(String(timeValue || "").slice(0, 5));
  if (dateTimestamp !== null && timeMinutes !== null) {
    const [year, month, day] = String(dateValue).split("-");
    const monthLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
    const localDate = new Date(Number(year), Number(month) - 1, Number(day), Math.floor(timeMinutes / 60), timeMinutes % 60);
    return {
      sortValue: localDate.getTime(),
      dateLabel: monthLabel ? `${day} ${monthLabel} ${year}` : "—",
      timeLabel: factoryTimeAmPmLabel(timeValue),
    };
  }
  const timestamp = new Date(timestampValue);
  if (Number.isNaN(timestamp.getTime())) return { sortValue: 0, dateLabel: "—", timeLabel: "—" };
  return {
    sortValue: timestamp.getTime(),
    dateLabel: timestamp.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    timeLabel: timestamp.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase(),
  };
}

function productionActivityReference(job, production) {
  const batchNo = String(production?.batch_no || "").trim();
  if (/^PB/i.test(batchNo)) return batchNo;
  const jobOrderNo = String(job?.job_order_no || production?.job_order_no || "").trim();
  return /^JO/i.test(jobOrderNo) ? jobOrderNo : "—";
}

function productionActivityOperator(value) {
  const name = String(value || "").trim();
  if (!name || name.includes("@") || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(name)) return { name: "—", helper: "" };
  if (name.toLowerCase() === "system") return { name: "System", helper: "Automated" };
  return { name, helper: "" };
}

function productionActivityFinishedGood(job, production) {
  return job?.product_family_name
    || job?.product_name_en
    || job?.product_name
    || production?.product_family_name
    || production?.product_name_en
    || production?.product_name
    || "—";
}

function productionOutputLabel(production) {
  return quantity(production?.good_output_qty || production?.actual_output_qty || production?.actual_produced_qty || production?.produced_quantity, production?.uom);
}

function aggregateProductionOutput(productions = []) {
  if (!productions.length) return "0";
  let total = 0;
  let uom = "";
  for (const production of productions) {
    const rowUom = production.uom || "";
    if (uom && rowUom && uom !== rowUom) return "Mixed";
    if (!uom) uom = rowUom;
    total += Number(production.good_output_qty || production.actual_output_qty || production.actual_produced_qty || production.produced_quantity || 0);
  }
  return quantity(total, uom);
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

function finishedGoodDispatchOperatorError(error, fallback = "Unable to save the Dispatch. Please retry.") {
  if (isFactoryPermissionError(error)) return "Your current role does not allow this Dispatch action.";
  const message = String(error?.message || "").trim();
  const safeMessages = [
    "Select a Customer.",
    "Dispatch Date is required.",
    "Add at least one dispatch item.",
    "Every dispatch item needs a Packaging SKU",
    "Confirm a complete batch allocation",
    "Clear or confirm a complete batch allocation",
    "Allocated Qty must exactly equal Dispatch Qty.",
    "Allocated quantity exceeds available batch balance.",
    "Selected finished-goods batch is unavailable.",
    "Expired finished-goods batches cannot be dispatched.",
    "Selected batch is not in an active Finished Goods storage location.",
    "Only draft dispatches can be",
    "Insufficient finished goods balance",
    "Dispatch request ID is required.",
    "This Dispatch request was already completed with different details.",
    "This Dispatch request is already linked to another Dispatch.",
    "This Dispatch is linked to another request.",
    "Packaging SKU is no longer active.",
  ];
  return safeMessages.some((value) => message.startsWith(value)) ? message : fallback;
}

function productionCompletionOperatorError(error) {
  if (isFactoryPermissionError(error)) return "Your current role does not allow Production completion.";
  const message = String(error?.message || "").trim();
  const safeMessages = [
    "Production completion request ID is required.",
    "This Production request was already completed with different details.",
    "Job Order was not found.",
    "Only In Progress Job Orders can be completed.",
    "This Job Order already has a completed Production record.",
    "Production Packaging SKU must be active and match the Job Order.",
    "Actual Pack Qty must be a whole number greater than 0.",
    "Actual Output Qty does not match Packaging SKU Pack Size.",
    "At least one material usage row is required.",
    "Job Order Production Date and Start Time are required.",
    "Production End Date and Time cannot be earlier than Start Date and Time.",
    "Every Production usage row requires an active Raw Material.",
    "Actual usage cannot be negative.",
    "Variance reason is required when actual usage differs from standard usage.",
    "Raw Material batch allocation must equal Actual Used.",
    "Insufficient Raw Material batch stock for",
    "Unable to complete Job Order because it is no longer In Progress.",
  ];
  return safeMessages.some((value) => message.startsWith(value))
    ? message
    : "Unable to complete Production. Please retry.";
}

function createFinishedGoodDispatchRequestId() {
  return crypto.randomUUID();
}

function createRawMaterialReceivingRequestId() {
  return crypto.randomUUID();
}

function groupedProductionSops(sops) {
  const groups = new Map();
  (sops || []).forEach((sop) => {
    const storedProductName = sop.product_name_en || sop.product_name || "";
    const productName = storedProductName || "Finished Good";
    const legacyIdentity = String(storedProductName).trim().toLocaleLowerCase("en-MY");
    const key = sop.finished_good_id
      ? `finished-good:${sop.finished_good_id}`
      : legacyIdentity
        ? `legacy-product:${legacyIdentity}`
        : `legacy-sop:${sop.id}`;
    if (!groups.has(key)) groups.set(key, {
      id: key,
      productName,
      productNameCn: sop.product_name_cn || "",
      sops: [],
    });
    groups.get(key).sops.push(sop);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sops: group.sops.sort((left, right) => (
        String(right.version || "").localeCompare(String(left.version || ""), "en-MY", { numeric: true, sensitivity: "base" })
        || String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || ""))
        || String(left.id || "").localeCompare(String(right.id || ""))
      )),
    }))
    .sort((left, right) => (
      left.productName.localeCompare(right.productName, "en-MY", { numeric: true, sensitivity: "base" })
      || left.id.localeCompare(right.id)
    ));
}

function productionSopDisplayName(sop) {
  const productName = sop?.product_name_en || sop?.product_name || "Finished Good";
  return `${productName} Production SOP · ${sop?.version || "v1"}`;
}









function CompletedJobOrderResultModal({ job, production, recipes = [], onClose }) {
  const matchingRecipe = production
    ? recipes.find((recipe) => recipe.status === "active" && recipe.product_family_id && recipe.product_family_id === production.product_family_id)
      || recipes.find((recipe) => recipe.status === "active" && recipe.finished_good_id && recipe.finished_good_id === production.finished_good_id)
      || recipes.find((recipe) => String(recipe.product_name || "").toLowerCase() === String(production.product_family_name || production.product_name || job?.product_name || "").toLowerCase())
    : null;
  const outputQty = Number(production?.actual_output_qty || production?.good_output_qty || production?.actual_produced_qty || production?.produced_quantity || 0);
  const recipeBaseQty = Number(matchingRecipe?.yield_quantity || 0);
  const scaleFactor = production && recipeBaseQty ? outputQty / recipeBaseQty : null;
  const materialRows = production?.material_usage || [];
  const processSteps = production?.step_executions || [];
  const processQcResults = processSteps.flatMap((step) => step.qc_results || []);
  const processQcState = productionQcStatus(processQcResults);
  const qcSummary = !processSteps.length
    ? "No QC Snapshot / Legacy Production"
    : productionQcDisplayLabel(processQcState.status);
  const recipeVersion = matchingRecipe?.version || "";
  const sopVersion = production?.sop_version || job?.sop_version || "";
  const productionSopSummary = production?.sop_title
    ? `${production.sop_title}${sopVersion ? ` · ${sopVersion}` : ""}`
    : sopVersion || "No SOP Linked";
  const shelfLifeConfigured = Number(production?.shelf_life_days_snapshot) > 0;
  const productionDuration = production?.production_date && production?.start_time && production?.end_date && production?.end_time
    ? productionDurationLabel(production.production_date, String(production.start_time).slice(0, 5), production.end_date, String(production.end_time).slice(0, 5))
    : "—";
  const expiryDisplay = production?.expiry_date ? formatFactoryDate(production.expiry_date) : shelfLifeConfigured ? "Missing" : "—";
  const summaryItems = [
    ["JO No", job?.job_order_no || "—"],
    ["Finished Good", jobFinishedGoodName(job || production || {})],
    ["Packaging SKU", jobPackagingSkuLabel(job || production || {})],
    ["Target Production Qty", quantity(job?.target_production_qty || job?.target_quantity, job?.uom)],
    ["Estimated Pack Qty", quantity(job?.target_pack_qty || 0, "packs")],
    ["Scheduled Date", formatFactoryDate(job?.planned_date)],
    ["Production SOP", productionSopSummary],
  ];
  const resultRows = production ? [
    [
      { label: "Batch No", value: production.batch_no || "—" },
      { label: "Production Start", value: production.production_date && production.start_time ? `${formatFactoryDate(production.production_date)} ${factoryTimeAmPmLabel(production.start_time)}` : "—" },
      { label: "Production End", value: production.end_date && production.end_time ? `${formatFactoryDate(production.end_date)} ${factoryTimeAmPmLabel(production.end_time)}` : "—" },
      { label: "Duration", value: productionDuration },
    ],
    [
      { label: "Manufacturing Date", value: production.manufacturing_date ? formatFactoryDate(production.manufacturing_date) : "—" },
      { label: "Expiry Date", value: expiryDisplay, secondary: production.expiry_override_reason ? `Override: ${production.expiry_override_reason}` : "" },
      { label: "Storage Location", value: production.storage_location || "—", secondary: production.storage_location ? production.storage_location_type || "—" : "" },
      { label: "Operator", value: production.operator_name || "—" },
    ],
    [
      { label: "Shelf Life Applied", value: shelfLifeConfigured ? `${production.shelf_life_days_snapshot} days` : "—" },
      { label: "Actual Pack Qty", value: quantity(production.actual_pack_qty || production.good_output_qty, "packs") },
      { label: "Actual Output Qty", value: quantity(outputQty, production.uom) },
    ],
  ] : [];

  return (
    <Modal
      title="Completed Job Order Result"
      description="Read-only production completion record for this Job Order."
      size="xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        <Card title="Job Order Summary" description="Original production planning details.">
          <div className="grid gap-3 p-4 md:grid-cols-4">
            {summaryItems.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
                <div className="mt-1 text-sm font-bold text-text-primary">{value || "—"}</div>
              </div>
            ))}
          </div>
        </Card>

        {!production ? (
          <Card title="Production Result" description="No completed production record is linked to this Job Order.">
            <EmptyState title="No completed production record found for this job order." description="Legacy completed Job Orders may not have a saved production completion record." />
          </Card>
        ) : (
          <>
            <Card title="Production Result" description="Saved production completion output.">
              <div className="space-y-3 p-4">
                {resultRows.map((row, rowIndex) => (
                  <div key={`production-result-${rowIndex}`} className={`grid gap-3 ${row.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
                    {row.map((item) => (
                      <div key={item.label} className="rounded-xl border border-border bg-white px-3 py-2">
                        <div className="text-[10.5px] font-semibold text-text-muted">{item.label}</div>
                        <div className="mt-1 text-sm font-bold text-text-primary">{item.value || "—"}</div>
                        {item.secondary ? <div className="mt-0.5 text-xs font-semibold text-text-secondary">{item.secondary}</div> : null}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="rounded-xl border border-border bg-white px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Production Notes</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm font-bold text-text-primary">{production.notes || "—"}</div>
                </div>
              </div>
            </Card>

            <Card title="Production Standard Used" description="Standard reference available for this completed production.">
              <div className="grid gap-3 p-4 md:grid-cols-4">
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 md:col-span-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Production Standard</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">
                    {matchingRecipe ? `${matchingRecipe.recipe_name || matchingRecipe.product_name || "Production Standard"} ${matchingRecipe.version || ""}`.trim() : "Not recorded"}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Recipe Version</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">{recipeVersion || "—"}</div>
                </div>
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">SOP Version</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">{sopVersion || "—"}</div>
                </div>
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Base Recipe Qty</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">{matchingRecipe ? quantity(matchingRecipe.yield_quantity, matchingRecipe.uom) : "—"}</div>
                </div>
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Scale Factor</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">{scaleFactor == null ? "—" : `${scaleFactor.toLocaleString("en-MY", { maximumFractionDigits: 2 })}x`}</div>
                </div>
              </div>
            </Card>

            <Card title="Actual Material Usage" description="Saved standard-vs-actual material usage from production completion.">
              {materialRows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left">
                    <thead>
                      <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold text-text-muted">
                        <th className="px-4 py-2.5">Raw Material</th>
                        <th className="px-4 py-2.5">Standard Qty</th>
                        <th className="px-4 py-2.5">Actual Used</th>
                        <th className="px-4 py-2.5">Batch Allocation</th>
                        <th className="px-4 py-2.5">Difference</th>
                        <th className="px-4 py-2.5">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialRows.map((row) => {
                        const diff = Number(row.actual_usage || 0) - Number(row.standard_usage || 0);
                        return (
                          <tr key={row.id || row.raw_material_id} className="border-b border-border last:border-0">
                            <td className="px-4 py-3"><div className="font-semibold text-text-primary">{row.raw_material_name || "Raw Material"}</div></td>
                            <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.standard_usage, row.uom)}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-text-primary">{quantity(row.actual_usage, row.uom)}</td>
                            <td className="px-4 py-3 text-sm text-text-secondary">{row.allocations?.length ? <div className="space-y-1">{row.allocations.map((allocation) => <div key={allocation.id || allocation.batch_balance_id}><span className="font-bold text-text-primary">{allocation.internal_batch_no || "—"}</span> · {quantity(allocation.allocated_qty, row.uom)}{allocation.supplier_lot_no ? <div className="text-xs text-text-muted">Supplier Lot {allocation.supplier_lot_no}</div> : null}</div>)}</div> : "—"}</td>
                            <td className={`px-4 py-3 text-sm font-bold ${Math.abs(diff) > 0.000001 ? "text-amber-700" : "text-emerald-700"}`}>{diff > 0 ? "+" : ""}{quantity(diff, row.uom)}</td>
                            <td className="px-4 py-3 text-sm text-text-secondary">{row.variance_reason || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No material usage rows" description="This completed production record has no saved material usage rows." />
              )}
            </Card>

            <Card title="Production Process & QC" description="Read-only SOP and QC snapshot saved with this production.">
              {!processSteps.length ? (
                <div className="p-4"><EmptyState title="No QC Snapshot / Legacy Production" description="This production was completed before Production QC execution snapshots were available." /></div>
              ) : (
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-text-primary">SOP operating instructions and recorded QC results</div>
                    <Badge tone={processQcState.status === "Failed" ? "danger" : ["Not Started", "In Progress"].includes(processQcState.status) ? "warning" : processQcState.status === "Passed" ? "success" : "neutral"}>{qcSummary}</Badge>
                  </div>
                  {processSteps.map((step) => (
                    <article key={step.id} className="rounded-xl border border-border bg-white p-3">
                      <div><div className="text-xs font-black text-primary">Step {step.step_no}</div><div className="mt-0.5 text-sm font-bold text-text-primary">{step.step_name}</div>{step.description ? <div className="mt-1 text-xs font-semibold text-text-secondary">{step.description}</div> : null}</div>
                      {step.sub_steps?.length ? <div className="mt-2 space-y-1">{step.sub_steps.map((subStep) => <div key={`${step.id}-${subStep.sequence_no}`} className="text-xs font-semibold text-text-secondary"><span className="mr-1 font-black text-primary">{step.step_no}.{subStep.sequence_no}</span>{subStep.instruction}</div>)}</div> : null}
                      {step.qc_results?.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{step.qc_results.map((result) => {
                        const resultLabel = result.qc_type === "remarks" ? (result.remarks ? "Recorded" : "Not recorded") : result.checklist_result ? result.checklist_result === "na" ? "N/A" : jobStatusLabel(result.checklist_result) : "Not recorded";
                        const resultTone = result.checklist_result === "fail" ? "danger" : result.checklist_result === "pass" || (result.qc_type === "remarks" && result.remarks) ? "success" : "neutral";
                        return <div key={result.id} className="rounded-lg bg-slate-50 px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-bold text-text-primary">{result.qc_name}</div><Badge tone={resultTone}>{resultLabel}</Badge></div>{result.instructions ? <div className="mt-1 text-xs font-semibold text-text-secondary">{result.instructions}</div> : null}{result.remarks ? <div className="mt-1 text-xs text-text-secondary">{result.remarks}</div> : null}{result.checked_at ? <div className="mt-1 text-[10.5px] font-semibold text-text-muted">Checked {factoryTimeLabel(result.checked_at)}</div> : null}</div>;
                      })}</div> : <div className="mt-2 text-xs font-semibold text-text-muted">No QC Required</div>}
                    </article>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </Modal>
  );
}

function dispatchAllocationTotal(allocations = []) {
  return allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
}

function validDispatchPackQty(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0;
}

function DispatchAllocationSummary({ item, sku, onEdit }) {
  const allocations = item.allocations || [];
  const total = dispatchAllocationTotal(allocations);
  const needsUpdate = Boolean(item.allocation_required) || total !== Number(item.quantity || 0);
  const singleAllocationLabel = allocations.length === 1 && allocations[0].batch_type !== "production"
    ? batchTypeLabel(allocations[0].batch_type)
    : allocations[0]?.batch_no || "Batch";
  if (!allocations.length) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-text-muted">{item.batch_no ? `${item.batch_no} · Legacy batch reference` : "No allocation"}</div>
        {onEdit && validDispatchPackQty(item.quantity) ? <button className="text-xs font-bold text-primary hover:underline" type="button" onClick={onEdit}>Allocate batches</button> : null}
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs font-bold text-text-primary">{allocations.length === 1 ? `${singleAllocationLabel} · ${quantity(total, pluralizePackagingType(packagingTypeLabel(sku), total))}` : `${allocations.length} Batches · ${quantity(total, pluralizePackagingType(packagingTypeLabel(sku), total))}`}</div>
      {!item.read_only ? allocations.slice(0, 2).map((allocation) => <div key={allocation.batch_id || allocation.batch_balance_id} className="truncate text-[11px] text-text-secondary">{allocation.batch_no || "Batch"} · {quantity(allocation.quantity)}</div>) : null}
      {allocations.length === 1 && allocations[0].expiry_date ? <div className="text-[11px] text-text-secondary">Expiry {formatFactoryDate(allocations[0].expiry_date)}</div> : null}
      {needsUpdate ? <div className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"><AlertTriangle size={11} /> Allocation update required</div> : null}
      {onEdit ? <button className="block text-xs font-bold text-primary hover:underline" type="button" onClick={onEdit}>{item.read_only ? "View Batch Allocation" : "Edit Allocation"}</button> : null}
    </div>
  );
}

function batchTypeLabel(value) {
  if (value === "adjustment") return "Adjustment";
  if (value === "legacy_unallocated") return "Legacy / Unallocated";
  return "Production";
}

function DispatchStockAvailability({ sku, availability, onRetry }) {
  const label = <div className="text-[10.5px] font-semibold text-text-muted">Stock Available</div>;
  if (!sku) return <div>{label}<div className="mt-1 text-sm font-bold text-text-muted">—</div></div>;
  if (!availability || availability.loading) return <div>{label}<div className="mt-1 text-xs font-semibold text-text-muted">Loading…</div></div>;
  if (!availability.data || availability.isStale || availability.errorKind) return (
    <div className="space-y-1">
      {label}
      <div className="text-sm font-bold text-text-muted">—</div>
      {availability.errorKind === "load" && onRetry ? <button className="text-xs font-bold text-primary hover:underline" type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  );
  const allocatable = Number(availability.data.allocatable_batch_balance || 0);
  const packagingType = pluralizePackagingType(packagingTypeLabel(sku), allocatable);
  return (
    <div className="min-w-[120px]">
      {label}
      <div className={`mt-1 text-sm font-black ${allocatable > 0 ? "text-emerald-700" : "text-rose-700"}`}>{quantity(allocatable, packagingType)}</div>
    </div>
  );
}

function ReadOnlyBatchAllocationModal({ title = "Batch Allocation", subtitle = "", allocations = [], onClose }) {
  return (
    <Modal title={title} description={subtitle} size="lg" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
      <div className="space-y-3">
        {allocations.length ? allocations.map((allocation) => (
          <div key={allocation.id || allocation.allocation_id || allocation.batch_id || allocation.batch_balance_id} className="rounded-xl border border-border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-bold text-text-primary">{allocation.batch_no || batchTypeLabel(allocation.batch_type)}</div>
                <div className="mt-1 text-xs font-semibold text-text-secondary">{batchTypeLabel(allocation.batch_type)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10.5px] font-semibold text-text-muted">Allocated Qty</div>
                <div className="font-black text-text-primary">{quantity(allocation.quantity)}</div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div><span className="font-semibold text-text-muted">Manufacturing Date:</span> <span className="font-semibold text-text-primary">{formatFactoryDate(allocation.manufacturing_date)}</span></div>
              <div><span className="font-semibold text-text-muted">Expiry Date:</span> <span className="font-semibold text-text-primary">{allocation.expiry_date ? formatFactoryDate(allocation.expiry_date) : "No Expiry Recorded"}</span></div>
              <div><span className="font-semibold text-text-muted">Storage:</span> <span className="font-semibold text-text-primary">{allocation.storage_location || "—"}</span></div>
              <div><span className="font-semibold text-text-muted">Current Balance:</span> <span className="font-semibold text-text-primary">{allocation.current_balance == null ? "—" : quantity(allocation.current_balance)}</span></div>
            </div>
            {allocation.location_valid === false ? <div className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-700">Storage location unavailable · {allocation.location_issue}</div> : null}
          </div>
        )) : <EmptyState title="No Batch Allocations" description="No batch allocation rows are linked to this record." />}
      </div>
    </Modal>
  );
}

function DispatchBatchAllocationModal({ item, sku, batches, unavailableBatches = [], batchAvailable = null, availableToThisLine = null, otherLinesAllocated = 0, loading, error, errorKind = "", isStale = false, autoAllocateOnLoad, allowExpired = false, referenceDate = "", purpose = "dispatch", onRetry, onClose, onApply }) {
  const [quantities, setQuantities] = useState(() => Object.fromEntries((item.allocations || []).map((allocation) => [allocation.batch_id || allocation.batch_balance_id, String(allocation.quantity)])));
  const [manualEditing, setManualEditing] = useState(false);
  const autoAllocatedRef = useRef(false);
  const requiredQty = Number(item.quantity || 0);
  const eligibleBatchIds = new Set(batches.map((batch) => batch.batch_id));
  const eligibleBatchCapacity = batches.reduce((sum, batch) => sum + Number(batch.available_qty || 0), 0);
  const explicitBatchAvailable = batchAvailable != null && Number.isFinite(Number(batchAvailable));
  const explicitAvailableToThisLine = availableToThisLine != null && Number.isFinite(Number(availableToThisLine));
  const resolvedBatchAvailable = Math.max(explicitBatchAvailable ? Number(batchAvailable) : eligibleBatchCapacity, 0);
  const resolvedAvailableToThisLine = Math.max(
    explicitAvailableToThisLine
      ? Number(availableToThisLine)
      : explicitBatchAvailable
        ? resolvedBatchAvailable
        : eligibleBatchCapacity,
    0,
  );
  const staleAllocationKeys = Object.entries(quantities).filter(([batchId, value]) => value !== "" && !eligibleBatchIds.has(batchId));
  const allocatedQty = Object.entries(quantities).reduce((sum, [batchId, value]) => eligibleBatchIds.has(batchId) ? sum + Number(value || 0) : sum, 0);
  const shortage = Math.max(requiredQty - resolvedAvailableToThisLine, 0);
  const hasProvisionalReservations = batches.some((batch) => Number(batch.provisional_qty || 0) > 0);
  const invalidQuantity = Object.values(quantities).some((value) => value !== "" && (!Number.isInteger(Number(value)) || Number(value) < 0));
  const exceedsAvailability = batches.some((batch) => Number(quantities[batch.batch_id] || 0) > Number(batch.available_qty || 0));
  const invalidLocationAllocations = (item.allocations || []).filter((allocation) => (
    allocation.location_valid === false && Number(quantities[allocation.batch_id || allocation.batch_balance_id] || 0) > 0
  ));
  const canApply = !loading && !error && !isStale
    && Number.isInteger(requiredQty) && requiredQty > 0
    && requiredQty <= resolvedAvailableToThisLine
    && allocatedQty === requiredQty
    && !staleAllocationKeys.length
    && !invalidQuantity
    && !exceedsAvailability
    && !invalidLocationAllocations.length;
  const isExpired = (batch) => Boolean(referenceDate && batch.expiry_date && batch.expiry_date < referenceDate);
  const isStockCheck = purpose === "stock-check";

  function autoAllocate() {
    let remaining = requiredQty;
    const next = {};
    batches.forEach((batch) => {
      const allocation = Math.min(remaining, Math.floor(Number(batch.available_qty || 0)));
      if (allocation > 0) next[batch.batch_id] = String(allocation);
      remaining -= allocation;
    });
    setQuantities(next);
  }

  useEffect(() => {
    if (!autoAllocateOnLoad || loading || error || autoAllocatedRef.current) return;
    autoAllocatedRef.current = true;
    autoAllocate();
  }, [autoAllocateOnLoad, batches, error, loading]);

  function applyAllocation() {
    if (!canApply) return;
    onApply(batches.flatMap((batch) => {
      const allocationQty = Number(quantities[batch.batch_id] || 0);
      return allocationQty > 0 ? [{ ...batch, quantity: allocationQty }] : [];
    }));
  }

  return (
    <Modal
      title={isStockCheck ? "Suggested Batch Resolution (FEFO)" : "Batch Allocation"}
      description={[sku?.product_family_name || sku?.product_name_en || sku?.product_name, sku?.product_code, sku?.variant_name || packSizeText(sku)].filter(Boolean).join(" · ")}
      size="xl"
      onClose={onClose}
      panelClassName="max-md:h-[calc(100dvh-1rem)] max-md:max-h-none max-md:rounded-xl"
      footerClassName="max-md:sticky"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!canApply} onClick={applyAllocation}>{isStockCheck ? "Accept Suggested Resolution" : "Apply Allocation"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            [isStockCheck ? "Missing Qty" : "Required Qty", requiredQty],
            [isStockCheck ? "Resolved Qty" : "Allocated Qty", allocatedQty],
            ["Stock Available", resolvedAvailableToThisLine],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-slate-50 px-3 py-2">
              <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
              <div className="mt-1 text-sm font-black text-text-primary">{quantity(value, pluralizePackagingType(packagingTypeLabel(sku), value))}</div>
            </div>
          ))}
        </div>
        {otherLinesAllocated > 0 || hasProvisionalReservations ? <div className="text-xs font-semibold text-text-secondary">Availability considers other active Draft Dispatches.</div> : null}

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" type="button" disabled={loading || !batches.length} onClick={autoAllocate}><RefreshCw size={14} /> Auto Allocate FEFO</button>
          {isStockCheck ? <button className="btn-secondary" type="button" disabled={loading} onClick={() => {
            if (manualEditing) autoAllocate();
            setManualEditing((current) => !current);
          }}>{manualEditing ? "Use Suggested Values" : "Edit Manually"}</button> : null}
          <button className="btn-secondary" type="button" disabled={loading} onClick={() => setQuantities({})}>Clear Allocation</button>
        </div>

        {isStockCheck && unavailableBatches.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{unavailableBatches.length} batch balance{unavailableBatches.length === 1 ? " is" : "s are"} excluded: {[...new Set(unavailableBatches.map((batch) => batch.exclusion_reason).filter(Boolean))].join(" · ") || "Storage or reconciliation metadata unavailable"}.</div> : null}

        {loading ? <div className="rounded-xl border border-border bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-text-secondary">Loading available batches...</div> : null}
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            <div>{error}</div>
            {errorKind === "load" ? <button className="mt-2 underline" type="button" onClick={onRetry}>Retry</button> : null}
          </div>
        ) : null}
        {isStale ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800"><div>Unable to load the latest batch availability. Showing the last successfully loaded results.</div><button className="mt-2 underline" type="button" onClick={onRetry}>Retry</button></div> : null}
        {staleAllocationKeys.length ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">One or more selected batches are no longer available. Please reallocate.</div> : null}
        {!loading && invalidLocationAllocations.length ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <div className="font-bold">This batch is not available from an active Finished Goods location.</div>
            <div className="mt-1 text-xs">Clear or auto-allocate again before applying.</div>
          </div>
        ) : null}
        {!loading && !error && !batches.length ? <EmptyState title="No Available Batches" description={allowExpired ? "No active Finished Goods batches have available pack balance." : "No active, unexpired Finished Goods batches have available pack balance."} /> : null}

        {!error && batches.length ? (
          <div className="space-y-3 md:hidden">
            {batches.map((batch) => (
              <div key={batch.batch_id} className="rounded-xl border border-border bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-text-primary">{operatorFinishedGoodBatchNo(batch)}</span><Badge tone={batch.batch_type === "legacy_unallocated" ? "warning" : "neutral"}>{batchTypeLabel(batch.batch_type)}</Badge>{isExpired(batch) ? <Badge tone="danger">Expired</Badge> : null}</div><div className="text-xs text-text-secondary">{batch.storage_location || "—"}</div></div>
                  <div className="text-right text-xs"><div className="font-bold text-text-primary">{quantity(batch.available_qty, pluralizePackagingType(packagingTypeLabel(sku), batch.available_qty))}</div><div className="text-text-muted">Available</div></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-secondary">
                  <div><div className="font-semibold text-text-muted">Manufactured</div>{formatFactoryDate(batch.manufacturing_date)}</div>
                  <div><div className="font-semibold text-text-muted">Expiry</div>{batch.expiry_date ? formatFactoryDate(batch.expiry_date) : <span className="font-semibold text-amber-700">No Expiry Recorded</span>}</div>
                </div>
                {isStockCheck && !manualEditing ? <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><div className="text-xs font-semibold text-text-muted">Suggested Reduction</div><div className="font-bold text-rose-700">-{Number(quantities[batch.batch_id] || 0)}</div></div><div><div className="text-xs font-semibold text-text-muted">Remaining Qty</div><div className="font-bold text-text-primary">{Number(batch.available_qty || 0) - Number(quantities[batch.batch_id] || 0)}</div></div></div> : <div className="mt-3"><Field label={isStockCheck ? "Reduction Qty" : "Allocate Qty"}><input className={inputClass()} type="number" min="0" step="1" value={quantities[batch.batch_id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [batch.batch_id]: event.target.value }))} /></Field></div>}
              </div>
            ))}
          </div>
        ) : null}
        {!error && batches.length ? (
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <table className="w-full min-w-[760px] text-left">
              <thead><tr className="border-b border-border bg-slate-50 text-[11px] font-semibold text-text-muted">
                <th className="px-3 py-2.5">Batch No.</th>{isStockCheck ? <><th className="px-3 py-2.5">Current Qty</th><th className="px-3 py-2.5">Suggested Reduction</th><th className="px-3 py-2.5">Remaining Qty</th></> : <><th className="px-3 py-2.5">Manufacturing Date</th><th className="px-3 py-2.5">Expiry Date</th><th className="px-3 py-2.5">Storage Location</th><th className="px-3 py-2.5">Available Qty</th><th className="px-3 py-2.5">Allocate Qty</th></>}
              </tr></thead>
              <tbody>{batches.map((batch) => (
                <tr key={batch.batch_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 text-sm font-bold text-text-primary"><div className="flex flex-wrap items-center gap-2"><span>{operatorFinishedGoodBatchNo(batch)}</span><Badge tone={batch.batch_type === "legacy_unallocated" ? "warning" : "neutral"}>{batchTypeLabel(batch.batch_type)}</Badge>{isExpired(batch) ? <Badge tone="danger">Expired</Badge> : null}</div></td>
                  {isStockCheck ? <><td className="px-3 py-3 text-sm font-bold text-text-primary">{quantity(batch.available_qty, "Packs")}</td><td className="w-44 px-3 py-3">{manualEditing ? <input className={inputClass()} type="number" min="0" step="1" value={quantities[batch.batch_id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [batch.batch_id]: event.target.value }))} /> : <span className="font-bold text-rose-700">-{Number(quantities[batch.batch_id] || 0)} Packs</span>}</td><td className="px-3 py-3 text-sm font-bold text-text-primary">{quantity(Number(batch.available_qty || 0) - Number(quantities[batch.batch_id] || 0), "Packs")}</td></> : <><td className="whitespace-nowrap px-3 py-3 text-sm text-text-secondary">{formatFactoryDate(batch.manufacturing_date)}</td><td className="whitespace-nowrap px-3 py-3 text-sm text-text-secondary">{batch.expiry_date ? formatFactoryDate(batch.expiry_date) : <span className="font-semibold text-amber-700">No Expiry Recorded</span>}</td><td className="px-3 py-3 text-sm text-text-secondary"><div className="font-semibold text-text-primary">{batch.storage_location || "—"}</div><div className="text-xs">{batch.storage_location_type || "—"}</div></td><td className="px-3 py-3 text-sm font-bold text-text-primary">{quantity(batch.available_qty, pluralizePackagingType(packagingTypeLabel(sku), batch.available_qty))}</td><td className="w-40 px-3 py-3"><input className={inputClass()} type="number" min="0" step="1" value={quantities[batch.batch_id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [batch.batch_id]: event.target.value }))} /></td></>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}

        {!loading && !error && shortage > 0 ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Only {quantity(resolvedAvailableToThisLine, pluralizePackagingType(packagingTypeLabel(sku), resolvedAvailableToThisLine).toLowerCase())} {resolvedAvailableToThisLine === 1 ? "is" : "are"} available. {isStockCheck ? "Review batch reconciliation before submitting." : "Reduce the Dispatch quantity."}</div> : null}
        {!loading && !error && shortage === 0 && allocatedQty !== requiredQty ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Allocate exactly {quantity(requiredQty, pluralizePackagingType(packagingTypeLabel(sku), requiredQty))} before applying.</div> : null}
        {shortage === 0 && exceedsAvailability ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">One or more selected batches exceed the available quantity. Please reallocate.</div> : null}
      </div>
    </Modal>
  );
}

function FinishedGoodDispatchModal({ initialValue, finishedGoods = [], customers = [], onClose, onSave, onComplete, embedded = false, mode = "edit" }) {
  const makeItem = (overrides = {}) => ({ row_id: Math.random().toString(36).slice(2), finished_good_id: "", quantity: "", batch_no: "", remarks: "", allocations: [], allocation_prompted: false, allocation_required: false, ...overrides });
  const [form, setForm] = useState(() => ({
    dispatch_date: malaysiaBusinessDateInput(),
    customer_id: "",
    customer_name: "",
    reference_no: "",
    status: "draft",
    remarks: "",
    ...initialValue,
    completion_request_id: initialValue?.completion_request_id || createFinishedGoodDispatchRequestId(),
    items: initialValue?.items?.length ? initialValue.items.map((item) => ({ ...item, allocations: item.allocations || [], allocation_prompted: Boolean(item.allocations?.length), allocation_required: dispatchAllocationTotal(item.allocations) !== Number(item.quantity || 0), row_id: item.id || Math.random().toString(36).slice(2) })) : [makeItem()],
  }));
  const [submittingAction, setSubmittingAction] = useState("");
  const [error, setError] = useState("");
  const [allocationEditor, setAllocationEditor] = useState(null);
  const [viewAllocation, setViewAllocation] = useState(null);
  const [dispatchBulkSelectOpen, setDispatchBulkSelectOpen] = useState(false);
  const [dispatchNoPreviewState, setDispatchNoPreviewState] = useState(() => ({ value: initialValue?.dispatch_no || "", loading: !initialValue?.dispatch_no, error: "" }));
  const [dispatchNoPreviewRetry, setDispatchNoPreviewRetry] = useState(0);
  const [batchAvailabilityBySku, setBatchAvailabilityBySku] = useState({});
  const batchAvailabilityRequestRef = useRef({});
  const dispatchNoPreviewRequestRef = useRef(0);
  const submissionRef = useRef(false);
  const isViewMode = mode === "view" || (Boolean(initialValue?.id) && initialValue.status !== "draft");
  const isReadOnly = isViewMode;
  const saving = Boolean(submittingAction);
  const dispatchNoDisplay = form.dispatch_no || dispatchNoPreviewState.value || (dispatchNoPreviewState.loading ? "Loading preview..." : isReadOnly ? "—" : "Preview unavailable");
  const activeSkus = finishedGoods.filter((sku) => sku.status === "active" || form.items.some((item) => item.finished_good_id === sku.id));
  const activeCustomers = customers.filter((customer) => customer.status === "active" || customer.id === form.customer_id);
  const customerOptions = activeCustomers.map((customer) => ({
    value: customer.id,
    label: customer.customer_name,
    helper: [customer.customer_code, customer.customer_type, customer.phone].filter(Boolean).join(" · ") || customer.status,
  }));
  const skuOptions = activeSkus.map((sku) => ({
    value: sku.id,
    label: [sku.product_code || "No SKU", sku.product_family_name || sku.product_name_en || sku.product_name, sku.variant_name || packSizeText(sku)].filter(Boolean).join(" · "),
    helper: `Total stock ${skuBalanceLabel(sku)} · ${packSizeText(sku) || "No pack size"}`,
  }));
  const dispatchBulkItems = finishedGoods.map((sku) => ({
    id: sku.id,
    primary: finishedGoodLabel(sku) || "Finished Good",
    secondary: sku.product_family_name_cn || sku.product_name_cn || "",
    code: [sku.product_code || "No SKU", packSizeText(sku) || packagingTypeLabel(sku)].filter(Boolean).join(" · "),
    meta: `Current stock ${skuBalanceLabel(sku)}`,
    category: sku.category || "",
    disabled: sku.status !== "active",
    statusLabel: sku.status === "active" ? "Active" : jobStatusLabel(sku.status),
    source: sku,
  }));
  const showReferenceField = Boolean(initialValue?.reference_no);

  const selectedSkuSignature = Array.from(new Set(form.items.map((item) => item.finished_good_id).filter(Boolean))).sort().join("|");

  useEffect(() => {
    if (dispatchBulkSelectOpen && !finishedGoods.length) setDispatchBulkSelectOpen(false);
  }, [dispatchBulkSelectOpen, finishedGoods.length]);

  useEffect(() => {
    const requestId = dispatchNoPreviewRequestRef.current + 1;
    dispatchNoPreviewRequestRef.current = requestId;
    if (form.dispatch_no) {
      setDispatchNoPreviewState({ value: form.dispatch_no, loading: false, error: "" });
      return undefined;
    }
    if (isReadOnly || !form.dispatch_date) {
      setDispatchNoPreviewState({ value: "", loading: false, error: "" });
      return undefined;
    }

    setDispatchNoPreviewState({ value: "", loading: true, error: "" });
    factoryService.getFinishedGoodDispatchNoPreview(form.dispatch_date)
      .then((value) => {
        if (dispatchNoPreviewRequestRef.current !== requestId) return;
        setDispatchNoPreviewState({ value, loading: false, error: value ? "" : "Unable to load preview." });
      })
      .catch((previewError) => {
        if (dispatchNoPreviewRequestRef.current !== requestId) return;
        console.error("[Factory] Unable to load Dispatch number preview.", previewError);
        setDispatchNoPreviewState({
          value: "",
          loading: false,
          error: isFactoryPermissionError(previewError) ? "Preview hidden by your current role." : "Unable to load preview.",
        });
      });

    return () => {
      if (dispatchNoPreviewRequestRef.current === requestId) dispatchNoPreviewRequestRef.current += 1;
    };
  }, [dispatchNoPreviewRetry, form.dispatch_date, form.dispatch_no, isReadOnly]);

  async function loadBatchAvailability(finishedGoodId) {
    if (!finishedGoodId) return null;
    const requestId = Number(batchAvailabilityRequestRef.current[finishedGoodId] || 0) + 1;
    batchAvailabilityRequestRef.current[finishedGoodId] = requestId;
    setBatchAvailabilityBySku((current) => ({
      ...current,
      [finishedGoodId]: { ...current[finishedGoodId], loading: true, errorKind: "", operatorMessage: "", dispatchDate: form.dispatch_date },
    }));
    try {
      const data = await factoryService.getFinishedGoodBatchAvailability({
        finishedGoodId,
        dispatchId: form.id || null,
        dispatchDate: form.dispatch_date,
      });
      if (batchAvailabilityRequestRef.current[finishedGoodId] !== requestId) return null;
      setBatchAvailabilityBySku((current) => ({
        ...current,
        [finishedGoodId]: { data, loading: false, errorKind: "", isStale: false, operatorMessage: "", dispatchDate: form.dispatch_date },
      }));
      return data;
    } catch (loadError) {
      if (batchAvailabilityRequestRef.current[finishedGoodId] !== requestId) return null;
      const permissionDenied = isFactoryPermissionError(loadError);
      console.error("[Factory] Unable to load Finished Goods batch availability.", loadError);
      setBatchAvailabilityBySku((current) => ({
        ...current,
        [finishedGoodId]: permissionDenied
          ? {
            data: null,
            loading: false,
            errorKind: "permission",
            isStale: false,
            operatorMessage: "Some Finished Goods batch availability data is hidden by your current role.",
            dispatchDate: form.dispatch_date,
          }
          : {
            ...current[finishedGoodId],
            loading: false,
            errorKind: "load",
            isStale: Boolean(current[finishedGoodId]?.data),
            operatorMessage: current[finishedGoodId]?.data
              ? "Unable to load the latest batch availability. Showing the last successfully loaded results."
              : "Unable to load the latest batch availability.",
            dispatchDate: form.dispatch_date,
          },
      }));
      if (permissionDenied) {
        setAllocationEditor((current) => {
          const currentItem = form.items.find((item) => item.row_id === current?.rowId);
          return currentItem?.finished_good_id === finishedGoodId ? null : current;
        });
        setForm((current) => ({
          ...current,
          items: current.items.map((item) => item.finished_good_id === finishedGoodId ? {
            ...item,
            allocations: [],
            batch_no: "",
            allocation_required: validDispatchPackQty(item.quantity),
          } : item),
        }));
      }
      throw loadError;
    }
  }

  useEffect(() => {
    const selectedSkuIds = selectedSkuSignature ? selectedSkuSignature.split("|") : [];
    selectedSkuIds.forEach((finishedGoodId) => {
      const current = batchAvailabilityBySku[finishedGoodId];
      if (current?.dispatchDate === form.dispatch_date && (current.loading || current.data)) return;
      loadBatchAvailability(finishedGoodId).catch(() => {});
    });
  }, [selectedSkuSignature, form.dispatch_date, form.id]);

  if (isViewMode) {
    const isCompleted = form.status === "completed";
    const statusToneValue = form.status === "completed" ? "success" : form.status === "cancelled" ? "neutral" : "warning";
    const completionTiming = factoryActivityDateTime("", "", form.completed_at);
    const completedAtLabel = form.completed_at ? `${completionTiming.dateLabel} · ${completionTiming.timeLabel}` : "Metadata unavailable";
    return (
      <>
      <Modal
        title="Finished Goods Dispatch"
        description={form.status === "completed" ? "Completed finished goods dispatch record." : "Read-only finished goods dispatch record."}
        size="xl"
        onClose={onClose}
        footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
      >
        <div className="space-y-5">
          <div className="grid gap-4 rounded-xl border border-border bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.6fr)_minmax(110px,0.7fr)_minmax(150px,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold text-text-muted">Dispatch No</div>
              <div className="mt-1 text-2xl font-black text-text-primary">{form.dispatch_no || "—"}</div>
            </div>
            <div><div className="text-[10.5px] font-semibold text-text-muted">Total Items</div><div className="mt-1 text-lg font-black text-text-primary">{Number(form.items_count || form.items.length || 0).toLocaleString("en-MY")}</div></div>
            <div><div className="text-[10.5px] font-semibold text-text-muted">Total Dispatch</div><div className="mt-1 text-lg font-black text-text-primary">{dispatchTotalLabel(form)}</div></div>
            <div className="sm:justify-self-end"><Badge tone={statusToneValue}>{jobStatusLabel(form.status)}</Badge></div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-white px-3 py-2">
              <div className="text-[10.5px] font-semibold text-text-muted">{isCompleted ? "Completed At" : "Dispatch Date"}</div>
              <div className="mt-1 text-sm font-bold text-text-primary">{isCompleted ? completedAtLabel : formatFactoryDate(form.dispatch_date)}</div>
              {isCompleted && !form.completed_at ? <div className="mt-0.5 text-[10.5px] font-semibold text-amber-700">Completion time metadata unavailable</div> : null}
            </div>
            <div className="rounded-xl border border-border bg-white px-3 py-2">
              <div className="text-[10.5px] font-semibold text-text-muted">Customer</div>
              <div className="mt-1 line-clamp-2 text-sm font-bold text-text-primary">{form.customer_name || "—"}</div>
            </div>
            <div className="rounded-xl border border-border bg-white px-3 py-2">
              <div className="text-[10.5px] font-semibold text-text-muted">Customer Type</div>
              <div className="mt-1 text-sm font-bold text-text-primary">{form.customer_type || "—"}</div>
            </div>
            {isCompleted ? (
              <div className="rounded-xl border border-border bg-white px-3 py-2">
                <div className="text-[10.5px] font-semibold text-text-muted">Completed By</div>
                <div className="mt-1 text-sm font-bold text-text-primary">{form.completed_by_name || "—"}</div>
              </div>
            ) : null}
            {form.reference_no ? (
              <div className="rounded-xl border border-border bg-white px-3 py-2 md:col-span-2">
                <div className="text-[10.5px] font-semibold text-text-muted">Reference</div>
                <div className="mt-1 text-sm font-bold text-text-primary">{form.reference_no}</div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border bg-white">
            <div className="border-b border-border px-4 py-3">
              <div className="font-bold text-text-primary">Dispatch Items</div>
            </div>
            <div className="space-y-3 p-4 md:hidden">
              {form.items.length ? form.items.map((item) => (
                <div key={item.row_id} className="rounded-xl border border-border bg-slate-50 p-3">
                  <div className="font-bold text-text-primary">{item.product_name || item.sku_product_name || "Finished Good"}</div>
                  <div className="mt-0.5 text-sm font-semibold text-text-secondary">{item.product_code || "No SKU"} · {item.variant_name || packSizeText(item) || "Packaging SKU"}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><div className="text-[10.5px] font-semibold text-text-muted">Dispatch Qty</div><div className="font-bold text-text-primary">{quantity(item.quantity, pluralizePackagingType(packagingTypeLabel(item), item.quantity))}</div></div>
                    <div><div className="text-[10.5px] font-semibold text-text-muted">Pack Size</div><div className="font-bold text-text-primary">{packSizeText(item) || "—"}</div></div>
                    <div className="col-span-2"><div className="text-[10.5px] font-semibold text-text-muted">Batch Allocation</div><DispatchAllocationSummary item={{ ...item, read_only: true }} sku={item} onEdit={() => setViewAllocation(item)} /></div>
                    <div><div className="text-[10.5px] font-semibold text-text-muted">Base Equivalent</div><div className="font-bold text-text-primary">{dispatchLineBaseEquivalentLabel(item)}</div></div>
                    {item.remarks ? <div><div className="text-[10.5px] font-semibold text-text-muted">Remarks</div><div className="font-bold text-text-primary">{item.remarks}</div></div> : null}
                  </div>
                </div>
              )) : <EmptyState title="No Dispatch Items" description="No Packaging SKU items were saved for this Dispatch." />}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold text-text-muted">
                    <th className="px-4 py-2.5">Finished Good</th>
                    <th className="px-4 py-2.5">Packaging SKU</th>
                    <th className="px-4 py-2.5">Dispatch Qty</th>
                    <th className="px-4 py-2.5">Batch Allocation</th>
                    <th className="px-4 py-2.5">Pack Size</th>
                    <th className="px-4 py-2.5">Base Equivalent</th>
                    <th className="px-4 py-2.5">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.length ? form.items.map((item) => (
                    <tr key={item.row_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-sm font-bold text-text-primary">{item.product_name || item.sku_product_name || "—"}</td>
                      <td className="px-4 py-3"><div className="font-bold text-text-primary">{item.product_code || "No SKU"}</div><div className="text-xs text-text-secondary">{item.variant_name || packSizeText(item) || "Packaging SKU"}</div></td>
                      <td className="px-4 py-3 text-sm font-bold text-text-primary">{quantity(item.quantity, pluralizePackagingType(packagingTypeLabel(item), item.quantity))}</td>
                      <td className="max-w-[220px] px-4 py-3"><DispatchAllocationSummary item={{ ...item, read_only: true }} sku={item} onEdit={() => setViewAllocation(item)} /></td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{packSizeText(item) || "—"}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{dispatchLineBaseEquivalentLabel(item)}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{item.remarks || "—"}</td>
                    </tr>
                  )) : (
                    <tr><td className="px-4 py-6 text-center text-sm font-semibold text-text-secondary" colSpan={7}>No Dispatch Items were saved for this Dispatch.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {form.remarks ? (
            <div className="rounded-2xl border border-border bg-white p-4">
              <div className="font-bold text-text-primary">Remarks</div>
              <div className="mt-2 text-sm text-text-secondary">{form.remarks}</div>
            </div>
          ) : null}
        </div>
      </Modal>
      {viewAllocation ? <ReadOnlyBatchAllocationModal title="Dispatch Batch Allocation" subtitle={[form.dispatch_no, viewAllocation.product_code, viewAllocation.product_name].filter(Boolean).join(" · ")} allocations={viewAllocation.allocations || []} onClose={() => setViewAllocation(null)} /> : null}
      </>
    );
  }

  function updateItem(rowId, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.row_id === rowId ? { ...item, ...patch } : item),
    }));
  }

  function updateItemQuantity(rowId, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.row_id !== rowId) return item;
        const matchesAllocation = validDispatchPackQty(value) && dispatchAllocationTotal(item.allocations) === Number(value);
        return { ...item, quantity: value, allocation_required: !matchesAllocation && Boolean(item.allocations?.length) };
      }),
    }));
  }

  function updateItemSku(item, value) {
    const shouldPrompt = validDispatchPackQty(item.quantity);
    const nextItem = { ...item, finished_good_id: value, allocations: [], batch_no: "", allocation_prompted: shouldPrompt, allocation_required: shouldPrompt };
    updateItem(item.row_id, nextItem);
    if (value && shouldPrompt) openBatchAllocation(nextItem, true);
  }

  async function openBatchAllocation(item, autoAllocateOnLoad = false) {
    if (!item?.finished_good_id || !validDispatchPackQty(item.quantity)) return;
    setAllocationEditor((current) => current?.rowId === item.row_id ? {
      ...current,
      loading: true,
      error: "",
      errorKind: "",
      autoAllocateOnLoad,
    } : {
      rowId: item.row_id,
      loading: true,
      error: "",
      errorKind: "",
      isStale: false,
      batches: [],
      unavailableBatches: [],
      aggregateBalance: 0,
      batchAvailable: 0,
      availableToThisLine: 0,
      otherLinesAllocated: 0,
      unavailableBalance: 0,
      autoAllocateOnLoad,
    });
    try {
      const availability = await loadBatchAvailability(item.finished_good_id);
      if (!availability) return;
      const eligibleBatches = new Map(availability.batches.map((batch) => [batch.batch_id, batch]));
      const otherLineUsage = form.items.reduce((usage, line) => {
        if (line.row_id === item.row_id || line.finished_good_id !== item.finished_good_id) return usage;
        (line.allocations || []).forEach((allocation) => {
          const batchId = allocation.batch_id || allocation.batch_balance_id;
          const allocationQty = Number(allocation.quantity || 0);
          const eligibleBatch = eligibleBatches.get(batchId);
          if (!eligibleBatch || !Number.isInteger(allocationQty) || allocationQty <= 0 || allocationQty > Number(eligibleBatch.available_qty || 0)) return;
          usage[batchId] = (usage[batchId] || 0) + allocationQty;
        });
        return usage;
      }, {});
      const otherLinesAllocated = Object.values(otherLineUsage).reduce((sum, value) => sum + Number(value || 0), 0);
      const availableToThisLine = Math.max(Number(availability.allocatable_batch_balance || 0) - otherLinesAllocated, 0);
      const availableBatches = availability.batches.map((batch) => ({
        ...batch,
        available_qty: Math.max(Number(batch.available_qty || 0) - Number(otherLineUsage[batch.batch_id] || 0), 0),
      })).filter((batch) => batch.available_qty > 0);
      setAllocationEditor((current) => current?.rowId === item.row_id ? {
        ...current,
        loading: false,
        batches: availableBatches,
        unavailableBatches: availability.unavailable_batches,
        aggregateBalance: availability.aggregate_balance,
        batchAvailable: availability.allocatable_batch_balance,
        availableToThisLine,
        otherLinesAllocated,
        unavailableBalance: availability.unavailable_balance,
        error: "",
        errorKind: "",
        isStale: false,
      } : current);
    } catch (loadError) {
      const permissionDenied = isFactoryPermissionError(loadError);
      setAllocationEditor((current) => current?.rowId === item.row_id
        ? permissionDenied
          ? null
          : {
            ...current,
            loading: false,
            error: current.batches?.length ? "" : "Unable to load the latest batch availability.",
            errorKind: "load",
            isStale: Boolean(current.batches?.length),
          }
        : current);
    }
  }

  function promptAllocationOnce(rowId) {
    const item = form.items.find((row) => row.row_id === rowId);
    if (!item || item.allocation_prompted || !validDispatchPackQty(item.quantity) || !item.finished_good_id) return;
    updateItem(rowId, { allocation_prompted: true });
    openBatchAllocation({ ...item, allocation_prompted: true }, true);
  }

  function applyBatchAllocation(rowId, allocations) {
    updateItem(rowId, {
      allocations,
      allocation_prompted: true,
      allocation_required: dispatchAllocationTotal(allocations) !== Number(form.items.find((item) => item.row_id === rowId)?.quantity || 0),
      batch_no: allocations.length === 1 ? allocations[0].batch_no : "",
    });
    setAllocationEditor(null);
  }

  function addItem() {
    setForm((current) => ({ ...current, items: [...current.items, makeItem()] }));
  }

  function addSelectedDispatchSkus(selectedItems) {
    const newRows = selectedItems.map((item) => makeItem({ finished_good_id: item.id }));
    if (!newRows.length) return;
    setForm((current) => {
      const hasOnlyBlankRow = current.items.length === 1 && !current.items[0].finished_good_id && !current.items[0].quantity && !current.items[0].remarks;
      return { ...current, items: [...(hasOnlyBlankRow ? [] : current.items), ...newRows] };
    });
    setDispatchBulkSelectOpen(false);
    focusVisibleFactoryRowField("dispatch-qty", newRows[0].row_id);
  }

  function removeItem(rowId) {
    setForm((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((item) => item.row_id !== rowId) : current.items }));
  }

  function requestedQtyForSku(finishedGoodId, rows = form.items) {
    return rows.filter((row) => row.finished_good_id === finishedGoodId)
      .reduce((sum, row) => sum + (validDispatchPackQty(row.quantity) ? Number(row.quantity) : 0), 0);
  }

  function batchAvailabilityExceeded(item, rows = form.items) {
    const availability = batchAvailabilityBySku[item.finished_good_id];
    if (!availability?.data || availability.loading || availability.errorKind || availability.isStale || availability.dispatchDate !== form.dispatch_date) return false;
    return requestedQtyForSku(item.finished_good_id, rows) > Number(availability.data.allocatable_batch_balance || 0);
  }

  function batchAvailabilityMessage(item, rows = form.items) {
    if (!batchAvailabilityExceeded(item, rows)) return "";
    const availability = batchAvailabilityBySku[item.finished_good_id].data;
    const sku = activeSkus.find((row) => row.id === item.finished_good_id);
    const available = Number(availability.allocatable_batch_balance || 0);
    const unit = pluralizePackagingType(packagingTypeLabel(sku), available).toLowerCase();
    return `Only ${quantity(available, unit)} ${available === 1 ? "is" : "are"} available for dispatch.`;
  }

  function dispatchValidationMessage({ requireAllocations = true } = {}) {
    if (!form.customer_id) return "Select a customer.";
    if (strictDateValue(form.dispatch_date) === null) return "Select a valid Dispatch Date.";
    const rows = form.items.filter((item) => item.finished_good_id || item.quantity || item.batch_no || item.remarks);
    if (!rows.length) return "Add at least one Dispatch Line.";
    if (rows.some((item) => !item.finished_good_id)) return "Select a Packaging SKU for every line.";
    if (rows.some((item) => !validDispatchPackQty(item.quantity))) return "Enter a positive whole-number Dispatch Qty for every line.";
    const rowsRequiringAvailability = requireAllocations ? rows : rows.filter((item) => item.allocations?.length);
    const unavailableRow = rowsRequiringAvailability.find((item) => {
      const availability = batchAvailabilityBySku[item.finished_good_id];
      return !availability?.data || availability.loading || availability.errorKind || availability.isStale || availability.dispatchDate !== form.dispatch_date;
    });
    if (unavailableRow) return "Verify current batch availability for every line.";
    if (requireAllocations) {
      const overBatchAvailability = rows.find((item) => batchAvailabilityExceeded(item, rows));
      if (overBatchAvailability) return batchAvailabilityMessage(overBatchAvailability, rows);
      if (rows.some((item) => !item.allocations?.length)) return "Allocate batches for all lines.";
    }

    const allocatedByBatch = new Map();
    for (const item of rows) {
      if (!item.allocations?.length && !requireAllocations) continue;
      const availability = batchAvailabilityBySku[item.finished_good_id]?.data;
      const eligibleById = new Map((availability?.batches || []).map((batch) => [batch.batch_id, batch]));
      if (dispatchAllocationTotal(item.allocations) !== Number(item.quantity)) return "Batch allocation must exactly match every Dispatch Qty.";
      for (const allocation of item.allocations) {
        const batchId = allocation.batch_id || allocation.batch_balance_id;
        const allocationQty = Number(allocation.quantity);
        const eligibleBatch = eligibleById.get(batchId);
        if (!eligibleBatch) return "One or more selected batches are no longer available. Please reallocate.";
        if (allocation.location_valid === false) return "This batch is not available from an active Finished Goods location.";
        if (allocation.expiry_date && allocation.expiry_date < form.dispatch_date) return "This batch has expired and cannot be dispatched.";
        if (!Number.isInteger(allocationQty) || allocationQty <= 0) return "Batch allocations must use positive whole-pack quantities.";
        const nextTotal = Number(allocatedByBatch.get(batchId) || 0) + allocationQty;
        allocatedByBatch.set(batchId, nextTotal);
        if (nextTotal > Number(eligibleBatch.available_qty || 0)) return "One or more selected batches have insufficient available stock.";
      }
    }
    return "";
  }

  const saveDraftBlockReason = isReadOnly ? "" : dispatchValidationMessage({ requireAllocations: false });
  const completeBlockReason = isReadOnly ? "" : dispatchValidationMessage();

  async function submit(event, action = "draft") {
    event?.preventDefault();
    if (submissionRef.current) return;
    setError("");
    if (isReadOnly) return;
    const rows = form.items.filter((item) => item.finished_good_id || item.quantity || item.batch_no || item.remarks);
    const validationMessage = action === "complete" ? completeBlockReason : saveDraftBlockReason;
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    submissionRef.current = true;
    setSubmittingAction(action);
    try {
      if (action === "complete") await onComplete?.({ ...form, items: rows });
      else await onSave({ ...form, items: rows });
      if (embedded) {
        setForm({
          dispatch_date: malaysiaBusinessDateInput(),
          customer_id: "",
          customer_name: "",
          reference_no: "",
          status: "draft",
          remarks: "",
          completion_request_id: createFinishedGoodDispatchRequestId(),
          items: [makeItem()],
        });
        setBatchAvailabilityBySku({});
      }
    } catch (submitError) {
      setError(finishedGoodDispatchOperatorError(submitError, action === "complete" ? "Unable to complete the Dispatch. Please retry." : "Unable to save the Dispatch Draft. Please retry."));
    } finally {
      submissionRef.current = false;
      setSubmittingAction("");
    }
  }

  const formContent = (
    <form id={embedded ? undefined : "factory-finished-good-dispatch-form"} className="space-y-4" onSubmit={(event) => submit(event, "draft")}>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Customer *">
          {isReadOnly && !form.customer_id ? (
            <div className="flex min-h-[42px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-semibold text-text-primary">{form.customer_name || "—"}</div>
          ) : (
            <SearchableSelect
              value={form.customer_id || ""}
              options={customerOptions}
              placeholder={customerOptions.length ? "Select Customer" : "Create a Customer first"}
              searchPlaceholder="Search customers"
              emptyText="No customers"
              disabled={isReadOnly}
              onChange={(value) => {
                const customer = activeCustomers.find((row) => row.id === value);
                setForm((current) => ({ ...current, customer_id: value, customer_name: customer?.customer_name || "" }));
              }}
            />
          )}
        </Field>
        <Field label="Dispatch Date *">
          <FeedXDatePicker
            value={form.dispatch_date || ""}
            required
            disabled={isReadOnly}
            onChange={(nextDate) => setForm((current) => ({ ...current, dispatch_date: nextDate }))}
          />
        </Field>
        <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
          <div className="flex items-center justify-between gap-2"><div className="text-[10.5px] font-semibold text-text-muted">Dispatch No.</div>{form.id && form.status === "draft" ? <Badge tone="warning">Draft</Badge> : null}</div>
          <div className={`mt-1 text-sm font-bold ${form.dispatch_no || dispatchNoPreviewState.value ? "text-text-primary" : "text-text-secondary"}`}>{dispatchNoDisplay}</div>
          {!form.dispatch_no && dispatchNoPreviewState.value ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Preview only</div> : null}
          {!form.dispatch_no && dispatchNoPreviewState.error ? <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline" type="button" onClick={() => setDispatchNoPreviewRetry((current) => current + 1)}><RefreshCw size={11} /> Retry</button> : null}
        </div>
      </div>

      {showReferenceField ? <Field label="Reference / DO No.">
        <input className={inputClass()} value={form.reference_no || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, reference_no: event.target.value }))} />
      </Field> : null}

      <Field label="Remarks">
        <textarea className={inputClass()} rows={3} value={form.remarks || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
      </Field>

      <div className="rounded-2xl border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <div className="font-bold text-text-primary">Dispatch Items</div>
          <div className="text-sm text-text-secondary">Packaging SKU quantities and Batch allocations for this Dispatch.</div>
        </div>
        <div className="space-y-3 p-4">
          <div className="space-y-3 md:hidden">
            {form.items.map((item) => {
              const sku = activeSkus.find((row) => row.id === item.finished_good_id);
              const availability = batchAvailabilityBySku[item.finished_good_id];
              const availabilityMessage = batchAvailabilityMessage(item);
              return (
                <div key={item.row_id} className="space-y-3 rounded-2xl border border-border bg-white p-3">
                  <Field label="Packaging SKU">
                    <SearchableSelect
                      value={item.finished_good_id || ""}
                      options={skuOptions}
                      placeholder="Select Packaging SKU"
                      searchPlaceholder="Search SKU"
                      emptyText="No packaging SKUs"
                      disabled={isReadOnly}
                      onChange={(value) => updateItemSku(item, value)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                      <DispatchStockAvailability sku={sku} availability={availability} onRetry={() => loadBatchAvailability(item.finished_good_id).catch(() => {})} />
                    </div>
                    <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                      <div className="text-[10.5px] font-semibold text-text-muted">Pack Size</div>
                      <div className="mt-1 text-sm font-bold text-text-primary">{sku ? packSizeText(sku) || "—" : "—"}</div>
                    </div>
                  </div>
                  <Field label="Dispatch Qty">
                    <div className="flex items-center gap-2">
                      <input data-factory-row-field="dispatch-qty" data-row-id={item.row_id} className={inputClass()} type="number" min="1" step="1" value={item.quantity || ""} disabled={isReadOnly} onChange={(event) => updateItemQuantity(item.row_id, event.target.value)} onBlur={() => promptAllocationOnce(item.row_id)} />
                      <span className="shrink-0 text-xs font-bold text-text-muted">{pluralizePackagingType(packagingTypeLabel(sku), item.quantity || 0)}</span>
                    </div>
                    {item.quantity !== "" && !validDispatchPackQty(item.quantity) ? <div className="mt-1 text-xs font-semibold text-rose-700">Enter a whole number greater than zero.</div> : null}
                    {availabilityMessage ? <div className="mt-1 text-xs font-bold text-rose-700">{availabilityMessage}</div> : null}
                  </Field>
                  <Field label="Batch Allocation">
                    <div className={`rounded-xl border px-3 py-2 ${item.allocation_required ? "border-amber-300 bg-amber-50" : "border-border bg-slate-50"}`}><DispatchAllocationSummary item={item} sku={sku} onEdit={validDispatchPackQty(item.quantity) && item.finished_good_id ? () => openBatchAllocation(item) : null} /></div>
                  </Field>
                  <Field label="Remarks">
                    <input className={inputClass()} value={item.remarks || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { remarks: event.target.value })} />
                  </Field>
                  {!isReadOnly ? <button className="btn-secondary w-full justify-center px-3 py-1.5 text-xs" type="button" onClick={() => removeItem(item.row_id)}>Remove Item</button> : null}
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1080px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold text-text-muted">
                  <th className="px-3 py-2.5">Packaging SKU</th>
                  <th className="px-3 py-2.5">Stock Available</th>
                  <th className="px-3 py-2.5">Dispatch Qty</th>
                  <th className="px-3 py-2.5">Batch Allocation</th>
                  <th className="px-3 py-2.5">Pack Size</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item) => {
                  const sku = activeSkus.find((row) => row.id === item.finished_good_id);
                  const availability = batchAvailabilityBySku[item.finished_good_id];
                  const availabilityMessage = batchAvailabilityMessage(item);
                  return (
                    <tr key={item.row_id} className="border-b border-border last:border-0">
                      <td className="px-3 py-3">
                        <SearchableSelect
                          value={item.finished_good_id || ""}
                          options={skuOptions}
                          placeholder="Select Packaging SKU"
                          searchPlaceholder="Search SKU"
                          emptyText="No packaging SKUs"
                          disabled={isReadOnly}
                          onChange={(value) => updateItemSku(item, value)}
                        />
                      </td>
                      <td className="px-3 py-3"><DispatchStockAvailability sku={sku} availability={availability} onRetry={() => loadBatchAvailability(item.finished_good_id).catch(() => {})} /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <input data-factory-row-field="dispatch-qty" data-row-id={item.row_id} className={inputClass()} type="number" min="1" step="1" value={item.quantity || ""} disabled={isReadOnly} onChange={(event) => updateItemQuantity(item.row_id, event.target.value)} onBlur={() => promptAllocationOnce(item.row_id)} />
                          <span className="text-xs font-bold text-text-muted">{pluralizePackagingType(packagingTypeLabel(sku), item.quantity || 0)}</span>
                        </div>
                        {item.quantity !== "" && !validDispatchPackQty(item.quantity) ? <div className="mt-1 text-xs font-semibold text-rose-700">Whole packs only.</div> : null}
                        {availabilityMessage ? <div className="mt-1 max-w-xs text-xs font-bold text-rose-700">{availabilityMessage}</div> : null}
                      </td>
                      <td className="max-w-[220px] px-3 py-3"><DispatchAllocationSummary item={item} sku={sku} onEdit={validDispatchPackQty(item.quantity) && item.finished_good_id ? () => openBatchAllocation(item) : null} /></td>
                      <td className="px-3 py-3 text-sm font-semibold text-text-secondary">{sku ? packSizeText(sku) || "—" : "—"}</td>
                      <td className="px-3 py-3"><input className={inputClass()} value={item.remarks || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { remarks: event.target.value })} /></td>
                      <td className="px-3 py-3 text-right">
                        {!isReadOnly ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => removeItem(item.row_id)}>Remove</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!isReadOnly ? <div className="flex flex-wrap items-center gap-2"><button className="btn-secondary h-9 px-3 text-sm" type="button" onClick={addItem}><Plus size={15} /> Add Row</button><button className="btn-secondary h-9 px-3 text-sm" type="button" onClick={() => setDispatchBulkSelectOpen(true)}><ClipboardList size={15} /> Select Multiple</button></div> : null}
        </div>
      </div>

      {embedded && !isReadOnly ? (
        <div className="space-y-2 border-t border-border pt-4">
          {completeBlockReason ? <div className="text-right text-xs font-semibold text-amber-800">{completeBlockReason}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-secondary" type="submit" disabled={saving || Boolean(saveDraftBlockReason)}>{submittingAction === "draft" ? "Saving..." : "Save Draft"}</button>
            {onComplete ? <button className="btn-primary bg-emerald-600 hover:bg-emerald-700" type="button" disabled={saving || Boolean(completeBlockReason)} onClick={() => submit(null, "complete")}>{submittingAction === "complete" ? "Completing..." : "Complete Dispatch"}</button> : null}
          </div>
        </div>
      ) : null}
    </form>
  );

  const allocationItem = allocationEditor ? form.items.find((item) => item.row_id === allocationEditor.rowId) : null;
  const allocationSku = allocationItem ? activeSkus.find((sku) => sku.id === allocationItem.finished_good_id) : null;
  const allocationModal = allocationEditor && allocationItem ? (
    <DispatchBatchAllocationModal
      key={`${allocationItem.row_id}-${allocationEditor.autoAllocateOnLoad ? "auto" : "edit"}`}
      item={allocationItem}
      sku={allocationSku}
      batches={allocationEditor.batches || []}
      batchAvailable={allocationEditor.batchAvailable || 0}
      availableToThisLine={allocationEditor.availableToThisLine || 0}
      otherLinesAllocated={allocationEditor.otherLinesAllocated || 0}
      loading={allocationEditor.loading}
      error={allocationEditor.error}
      errorKind={allocationEditor.errorKind}
      isStale={allocationEditor.isStale}
      autoAllocateOnLoad={allocationEditor.autoAllocateOnLoad}
      onRetry={() => openBatchAllocation(allocationItem, allocationEditor.autoAllocateOnLoad)}
      onClose={() => setAllocationEditor(null)}
      onApply={(allocations) => applyBatchAllocation(allocationItem.row_id, allocations)}
    />
  ) : null;
  const bulkSelectionModal = dispatchBulkSelectOpen ? (
    <FactoryBulkSelectionModal
      title="Select Packaging SKUs"
      description="Choose multiple active Packaging SKUs to add as blank Dispatch rows."
      items={dispatchBulkItems}
      existingIds={form.items.map((item) => item.finished_good_id)}
      onClose={() => setDispatchBulkSelectOpen(false)}
      onAdd={addSelectedDispatchSkus}
    />
  ) : null;

  if (embedded) {
    return <>{formContent}{allocationModal}{bulkSelectionModal}</>;
  }

  return (
    <>
      <Modal
        title={isReadOnly ? "View Finished Goods Dispatch" : initialValue?.id ? "Edit Finished Goods Dispatch" : "Create Finished Goods Dispatch"}
        description="Record outbound Packaging SKU dispatch from Factory warehouse."
        size="xl"
        onClose={saving ? undefined : onClose}
        footer={(
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>{isReadOnly ? "Close" : "Cancel"}</button>
            {!isReadOnly ? <button className="btn-secondary" type="submit" form="factory-finished-good-dispatch-form" disabled={saving || Boolean(saveDraftBlockReason)}>{submittingAction === "draft" ? "Saving..." : "Save Draft"}</button> : null}
            {!isReadOnly && onComplete ? <button className="btn-primary bg-emerald-600 hover:bg-emerald-700" type="button" disabled={saving || Boolean(completeBlockReason)} onClick={() => submit(null, "complete")}>{submittingAction === "complete" ? "Completing..." : "Complete Dispatch"}</button> : null}
            {!isReadOnly && completeBlockReason ? <div className="basis-full text-right text-xs font-semibold text-amber-800">{completeBlockReason}</div> : null}
          </div>
        )}
      >
        {formContent}
      </Modal>
      {allocationModal}
      {bulkSelectionModal}
    </>
  );
}

function JobOrderModal({ initialValue, finishedGoods, rawMaterials = [], recipes = [], readOnly = false, onClose, onSave }) {
  const initialSku = finishedGoods.find((product) => product.id === initialValue?.finished_good_id);
  const initialParentKey = initialSku ? finishedGoodParentKey(initialSku) : "";
  const [form, setForm] = useState(() => ({
    product_family_key: initialParentKey,
    finished_good_id: "",
    product_name: "",
    target_pack_qty: "",
    target_production_qty: "",
    target_quantity: "",
    produced_quantity: 0,
    uom: "",
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
  const normalizedStatus = String(form.status || "draft").toLowerCase();
  const isPlanningStatus = ["draft", "planned"].includes(normalizedStatus);
  const isReadOnly = readOnly || (Boolean(initialValue?.id) && !isPlanningStatus);
  const activeFinishedGoods = finishedGoods.filter((product) => product.status === "active" || product.id === form.finished_good_id);
  const finishedGoodParents = Array.from(activeFinishedGoods.reduce((map, product) => {
    const key = finishedGoodParentKey(product);
    if (!key || map.has(key)) return map;
    map.set(key, {
      key,
      product_family_id: product.product_family_id || "",
      legacy_sku_id: product.product_family_id ? "" : product.id,
      name: product.product_family_name || product.product_name_en || product.product_name || "Finished Good",
      category: product.category_name || product.category || "",
      status: product.status || "active",
    });
    return map;
  }, new Map()).values());
  const finishedGoodOptions = finishedGoodParents.map((product) => ({
    value: product.key,
    label: product.name,
    helper: [product.category || "No category", product.product_family_id ? "Finished Good" : "Legacy SKU"].join(" · "),
  }));
  const selectedParent = finishedGoodParents.find((product) => product.key === form.product_family_key);
  const parentSkus = selectedParent ? activeFinishedGoods.filter((product) => finishedGoodParentKey(product) === selectedParent.key) : [];
  const packagingSkuOptions = parentSkus.map((product) => ({
    value: product.id,
    label: [product.product_code || "No SKU", product.product_family_name || product.product_name_en || product.product_name, product.variant_name || packSizeText(product)].filter(Boolean).join(" · "),
    helper: `Pack size ${packSizeText(product) || "not set"} · Balance ${skuBalanceLabel(product)}`,
  }));
  const selectedProduct = parentSkus.find((product) => product.id === form.finished_good_id) || activeFinishedGoods.find((product) => product.id === form.finished_good_id);
  const parentRecipe = selectedParent?.product_family_id ? recipes.find((recipe) => recipe.status === "active" && recipe.product_family_id === selectedParent.product_family_id) : null;
  const legacyRecipe = selectedProduct ? activeRecipeForSku(recipes, selectedProduct, selectedParent?.name || form.product_name) : null;
  const matchingRecipe = parentRecipe || legacyRecipe;
  const targetProductionQty = Number(form.target_production_qty || form.target_quantity || 0);
  const inheritedProductionUom = matchingRecipe?.uom || inheritedRecipeUom(selectedParent?.product_family_id, activeFinishedGoods, form.uom || selectedProduct?.base_uom || selectedProduct?.pack_size_uom || "");
  const productionUom = form.uom || inheritedProductionUom || "";
  const productionPlan = selectedProduct ? packagingPackEstimate(targetProductionQty, productionUom, selectedProduct, matchingRecipe?.uom) : null;
  const estimatedPackQty = productionPlan && !productionPlan.error ? productionPlan.target_pack_qty : null;
  const normalizedPreviewProductionQty = productionPlan && !productionPlan.error ? productionPlan.target_production_qty : targetProductionQty;
  const normalizedPreviewProductionUom = productionPlan && !productionPlan.error ? productionPlan.production_uom : productionUom;
  const packSizeMissing = selectedProduct && productionPlan?.error === "Packaging SKU needs Pack Size before creating Job Order.";
  const recipeUomMismatch = selectedProduct && (productionPlan?.error === "Production UOM must match the active recipe UOM." || productionPlan?.error === "Production UOM cannot convert to the selected Packaging SKU Pack Size.");
  const activeRecipeVersion = matchingRecipe?.version || "v1";
  const activeRecipeLabel = [selectedParent?.name || selectedProduct?.product_name, activeRecipeVersion].filter(Boolean).join(" · ") || activeRecipeVersion;
  const jobOrderNoPreview = useFactoryNumberPreview({
    assignedValue: form.job_order_no || "",
    previewKey: form.job_order_no || "new-job-order",
    loadPreview: () => factoryService.getJobOrderNoPreview(),
    enabled: !form.job_order_no && !isReadOnly,
    scope: "job_order_no",
  });
  const bomRows = matchingRecipe?.items?.length ? matchingRecipe.items.map((item) => {
    const material = rawMaterials.find((row) => row.id === item.raw_material_id);
    const recipeYield = Number(matchingRecipe.yield_quantity || 1) || 1;
    const requiredQty = (Number(item.quantity_used || 0) * Number(normalizedPreviewProductionQty || 0)) / recipeYield;
    const balance = Number(material?.current_balance || 0);
    return {
      ...item,
      material_name: rawMaterialLabel(material) || "Raw Material",
      material_code: material?.material_code || "",
      required_qty: requiredQty,
      balance,
      enough: balance >= requiredQty,
      uom: item.uom || material?.uom || "",
    };
  }) : [];

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isReadOnly) {
      return;
    }
    if (!form.product_family_key) {
      setError("Select a Finished Good.");
      return;
    }
    if (Number(form.target_production_qty || form.target_quantity || 0) <= 0) {
      setError("Target Production Qty must be greater than 0.");
      return;
    }
    if (!String(productionUom || "").trim()) {
      setError("Production UOM is required.");
      return;
    }
    if (!form.finished_good_id) {
      setError("Select an active Packaging SKU.");
      return;
    }
    if (productionPlan?.error) {
      setError(productionPlan.error);
      return;
    }
    if (!productionPlan?.target_pack_qty || !productionPlan.target_production_qty || !productionPlan.production_uom) {
      setError("Packaging SKU Pack Size UOM cannot be used for production quantity.");
      return;
    }
    setSaving(true);
    try {
      const selectedProduct = activeFinishedGoods.find((product) => product.id === form.finished_good_id);
      await onSave({
        ...form,
        product_name: selectedProduct?.product_name || form.product_name,
        target_pack_qty: productionPlan.target_pack_qty,
        target_production_qty: productionPlan.target_production_qty,
        target_quantity: productionPlan.target_production_qty,
        uom: productionPlan.production_uom,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isReadOnly ? "View Job Order" : initialValue?.id ? "Edit Job Order" : "Create Job Order"}
      description="Plan factory production demand before production execution."
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>{isReadOnly ? "Close" : "Cancel"}</button>
          {!isReadOnly ? <button className="btn-primary" type="submit" form="factory-job-order-form" disabled={saving}>{saving ? "Saving..." : initialValue?.id ? "Save Changes" : form.planned_date ? "Schedule Job Order" : "Save Draft"}</button> : null}
        </>
      )}
    >
      <form id="factory-job-order-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        {isReadOnly ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">This Job Order is {jobStatusLabel(normalizedStatus)} and is read-only. Use the production lifecycle actions for the next step.</div> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Job Order No.">
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
              <div className={`font-mono text-sm font-black ${form.job_order_no || jobOrderNoPreview.value ? "text-text-primary" : "text-text-secondary"}`}>{form.job_order_no || jobOrderNoPreview.value || (jobOrderNoPreview.loading ? "Loading preview..." : "—")}</div>
              {!form.job_order_no && jobOrderNoPreview.value ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Preview only</div> : null}
              {!form.job_order_no && jobOrderNoPreview.error ? <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline" type="button" onClick={jobOrderNoPreview.retry}><RefreshCw size={11} /> Retry</button> : null}
            </div>
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Finished Good *" error={!form.product_family_key && error.includes("Finished Good") ? "Finished Good is required." : ""}>
            <SearchableSelect
              value={form.product_family_key || ""}
              options={finishedGoodOptions}
              placeholder={finishedGoodOptions.length ? "Select Finished Good" : "Create a Finished Good first"}
              searchPlaceholder="Search finished goods"
              emptyText="No matching Finished Goods"
              error={!form.product_family_key && error.includes("Finished Good")}
              disabled={isReadOnly}
              onChange={(parentKey) => {
                const parent = finishedGoodParents.find((item) => item.key === parentKey);
                const recipe = parent?.product_family_id ? recipes.find((item) => item.status === "active" && item.product_family_id === parent.product_family_id) : null;
                setForm((current) => ({
                  ...current,
                  product_family_key: parentKey,
                  finished_good_id: "",
                  product_name: parent?.name || "",
                  uom: recipe?.uom || inheritedRecipeUom(parent?.product_family_id, activeFinishedGoods, current.uom),
                }));
              }}
            />
          </Field>
          <Field label="Packaging SKU *" error={!form.finished_good_id && error.includes("Packaging SKU") ? "Packaging SKU is required." : ""}>
            <SearchableSelect
              value={form.finished_good_id || ""}
              options={packagingSkuOptions}
              placeholder={selectedParent ? "Select Packaging SKU" : "Select Finished Good first"}
              searchPlaceholder="Search packaging SKUs"
              emptyText="No matching packaging SKUs"
              error={!form.finished_good_id && error.includes("Packaging SKU")}
              disabled={isReadOnly || !selectedParent}
              onChange={(finishedGoodId) => {
                const product = parentSkus.find((item) => item.id === finishedGoodId);
                setForm((current) => ({
                  ...current,
                  finished_good_id: finishedGoodId,
                  product_name: product?.product_name || selectedParent?.name || "",
                }));
              }}
            />
          </Field>
          <Field label="Target Production Qty *">
            <div className="flex overflow-hidden rounded-xl border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
              <input className="min-h-[42px] min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-text-primary outline-none disabled:bg-slate-50 disabled:text-text-secondary" type="number" min="0" step="0.01" value={form.target_production_qty || form.target_quantity || ""} disabled={isReadOnly} onChange={(event) => {
                const nextQty = event.target.value;
                setForm((current) => ({ ...current, target_production_qty: nextQty, target_quantity: nextQty }));
              }} />
              <div className="flex min-w-[86px] items-center justify-center border-l border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">{productionUom || "—"}</div>
            </div>
            <div className="mt-1 text-xs font-semibold text-text-secondary">UOM inherited from active recipe / finished good output UOM.</div>
          </Field>
          <Field label="Estimated Pack Qty">
            <div className="flex min-h-[42px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">
              {selectedProduct && targetProductionQty > 0 && estimatedPackQty != null ? quantity(estimatedPackQty, "packs") : "—"}
            </div>
          </Field>
          <Field label="Scheduled Date">
            <FeedXDatePicker
              value={form.planned_date || ""}
              disabled={isReadOnly}
              onChange={(nextDate) => setForm((current) => ({ ...current, planned_date: nextDate }))}
            />
          </Field>
          <Field label="Priority">
            <SearchableSelect
              value={form.priority}
              options={priorityOptions.map((option) => ({ value: option, label: option }))}
              placeholder="Select Priority"
              searchPlaceholder="Search priority"
              disabled={isReadOnly}
              onChange={(priority) => setForm((current) => ({ ...current, priority }))}
            />
          </Field>
        </div>
        {selectedProduct ? (
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard icon={PackageCheck} label="Finished Good" value={selectedProduct.product_family_name || selectedProduct.product_name_en || selectedProduct.product_name} helper={selectedProduct.product_code || "Packaging SKU"} />
            <MetricCard icon={Package} label="Pack Size" value={packSizeText(selectedProduct) || "Missing"} helper={selectedProduct.variant_name || "Packaging variant"} tone={packSizeMissing ? "warning" : "neutral"} />
            <MetricCard icon={Factory} label="Estimated Pack Qty" value={estimatedPackQty == null ? "—" : quantity(estimatedPackQty, "packs")} helper={quantity(normalizedPreviewProductionQty, normalizedPreviewProductionUom)} tone={recipeUomMismatch ? "warning" : "neutral"} />
            <MetricCard icon={BookOpen} label="Active Recipe" value={matchingRecipe ? matchingRecipe.version || "Active" : "—"} helper={matchingRecipe ? matchingRecipe.product_name || selectedProduct.product_family_name || "Finished Good recipe" : "No active recipe"} tone={matchingRecipe ? "success" : "warning"} />
          </div>
        ) : null}
        <Card title="BOM / Recipe Requirement Preview" description="This preview uses the current active recipe. Actual production usage remains captured during completion.">
          {selectedParent && matchingRecipe ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                <div>Active Recipe: {activeRecipeLabel}</div>
                <div className="text-xs">Standard Output: {quantity(matchingRecipe.yield_quantity, matchingRecipe.uom)}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      <th className="px-4 py-2.5">Raw Material</th>
                      <th className="px-4 py-2.5">Required Qty</th>
                      <th className="px-4 py-2.5">Available Balance</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomRows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3"><div className="font-semibold text-text-primary">{row.material_name}</div><div className="text-xs text-text-secondary">{row.material_code || "Raw material"}</div></td>
                        <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.required_qty, row.uom)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.balance, row.uom)}</td>
                        <td className="px-4 py-3"><Badge tone={row.enough ? "success" : "danger"}>{row.enough ? "Enough" : "Shortage"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : selectedParent ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              No active recipe found. You can still create the job order, but material usage must be entered manually during production.
            </div>
          ) : (
            <EmptyState title="Select a Finished Good" description="Choose a Finished Good and production quantity to preview active recipe requirements." />
          )}
        </Card>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}




function RawReceivingEntryPanel({ initialBatch = null, rawMaterials = [], suppliers = [], storageLocations = [], onSave, onComplete, onCancelEdit }) {
  const fieldRefs = useRef({});
  const submissionRef = useRef(false);
  const makeRow = (item = {}) => ({
    id: item.id || null,
    row_id: item.id || Math.random().toString(36).slice(2),
    raw_material_id: item.raw_material_id || "",
    supplier_lot_no: item.supplier_lot_no || "",
    internal_batch_no: item.internal_batch_no || "",
    received_qty: item.received_qty ?? "",
    uom: item.uom || "",
    storage_location_id: item.storage_location_id || "",
    storage_location: item.storage_location || "",
    expiry_date: item.expiry_date || "",
    expiry_source: item.expiry_source || "",
    expiry_confirmed: Boolean(item.expiry_confirmed),
    expiry_tracking_mode: item.expiry_tracking_mode || "optional",
    remarks: item.remarks || "",
  });
  const [form, setForm] = useState(() => ({
    id: initialBatch?.id || null,
    completion_request_id: initialBatch?.completion_request_id || createRawMaterialReceivingRequestId(),
    supplier_id: initialBatch?.supplier_id || "",
    reference_no: initialBatch?.reference_no || "",
    received_date: initialBatch?.received_date || malaysiaBusinessDateInput(),
    remarks: initialBatch?.remarks || "",
    items: initialBatch?.items?.length ? initialBatch.items.map(makeRow) : [makeRow()],
  }));
  const [savingAction, setSavingAction] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [openMaterialRowId, setOpenMaterialRowId] = useState(null);
  const [receivingBulkSelectOpen, setReceivingBulkSelectOpen] = useState(false);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "active" || supplier.id === form.supplier_id);
  const activeRawMaterials = rawMaterials.filter((material) => material.status === "active");
  const activeStorageLocations = storageLocations.filter((location) => location.status === "active");
  const supplierOptions = activeSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.supplier_name, helper: supplier.supplier_code || supplier.status }));
  const storageLocationOptions = activeStorageLocations.map((location) => ({ value: location.id, label: location.location_name, helper: [location.location_code, location.location_type].filter(Boolean).join(" · ") }));
  const receivingBulkItems = rawMaterials.map((material) => ({
    id: material.id,
    primary: rawMaterialLabel(material) || "Raw Material",
    secondary: material.name_cn || "",
    imageUrl: material.image_url || "",
    code: material.material_code || "No material code",
    meta: [material.uom || "No UOM", material.storage_location || "No default storage"].join(" · "),
    category: material.category || "",
    disabled: material.status !== "active",
    statusLabel: material.status === "active" ? "Active" : jobStatusLabel(material.status),
    source: material,
  }));
  const receivingNoPreview = useFactoryNumberPreview({
    assignedValue: initialBatch?.batch_no || "",
    previewKey: initialBatch?.batch_no || form.received_date,
    loadPreview: () => factoryService.getRawMaterialReceivingNoPreview(form.received_date),
    enabled: !initialBatch?.batch_no,
    scope: "raw_receiving_no",
  });

  useEffect(() => {
    if (receivingBulkSelectOpen && !rawMaterials.length) setReceivingBulkSelectOpen(false);
  }, [rawMaterials.length, receivingBulkSelectOpen]);

  function updateItem(rowId, patchValue) {
    setForm((current) => ({ ...current, items: current.items.map((item) => item.row_id === rowId ? { ...item, ...patchValue } : item) }));
  }

  function addReceivingRow() {
    setForm((current) => ({ ...current, items: [...current.items, makeRow()] }));
  }

  function addSelectedRawMaterials(selectedItems) {
    const newRows = selectedItems.map(({ source: material }) => makeRow({
      raw_material_id: material.id,
      uom: material.uom || "",
      storage_location_id: material.storage_location_id || "",
      storage_location: material.storage_location || "",
      expiry_tracking_mode: material.expiry_tracking_mode || "optional",
      expiry_source: material.expiry_tracking_mode === "not_applicable" ? "not_applicable" : "",
      expiry_confirmed: material.expiry_tracking_mode === "not_applicable",
    }));
    if (!newRows.length) return;
    setForm((current) => {
      const first = current.items[0];
      const hasOnlyBlankRow = current.items.length === 1 && !first.raw_material_id && !first.received_qty && !first.supplier_lot_no && !first.expiry_date;
      return { ...current, items: [...(hasOnlyBlankRow ? [] : current.items), ...newRows] };
    });
    setReceivingBulkSelectOpen(false);
    focusVisibleFactoryRowField("receiving-qty", newRows[0].row_id);
  }

  async function selectRawMaterial(rowId, rawMaterialId) {
    const material = activeRawMaterials.find((row) => row.id === rawMaterialId);
    setFieldErrors((current) => ({ ...current, [`${rowId}.raw_material_id`]: "", [`${rowId}.uom`]: "" }));
    updateItem(rowId, {
      raw_material_id: rawMaterialId,
      uom: material?.uom || "",
      storage_location_id: material?.storage_location_id || "",
      storage_location: material?.storage_location || "",
      expiry_tracking_mode: material?.expiry_tracking_mode || "optional",
      internal_batch_no: "",
      expiry_date: "",
      expiry_source: material?.expiry_tracking_mode === "not_applicable" ? "not_applicable" : "",
      expiry_confirmed: material?.expiry_tracking_mode === "not_applicable",
    });
    setOpenMaterialRowId(null);
    if (!rawMaterialId) return;
    try {
      const defaults = await factoryService.getRawMaterialReceivingDefaults(rawMaterialId, form.received_date);
      setForm((current) => ({ ...current, items: current.items.map((item) => item.row_id === rowId && item.raw_material_id === rawMaterialId ? {
        ...item,
        uom: defaults.uom || item.uom,
        storage_location_id: defaults.storage_location_id || item.storage_location_id,
        storage_location: defaults.storage_location || item.storage_location,
        expiry_tracking_mode: defaults.expiry_tracking_mode || item.expiry_tracking_mode,
        expiry_date: defaults.suggested_expiry_date || "",
        expiry_source: defaults.expiry_tracking_mode === "not_applicable" ? "not_applicable" : defaults.suggested_expiry_date ? "calculated" : "",
        expiry_confirmed: defaults.expiry_tracking_mode === "not_applicable",
        internal_batch_no: uniqueReceivingBatchPreview(defaults.internal_batch_no, current.items, rowId),
      } : item) }));
    } catch (loadError) {
      console.error("[Factory] Unable to load Raw Material Receiving defaults.", loadError);
      setError("Some receiving defaults could not be loaded. Review this item before completing.");
    }
  }

  async function submit(action, event) {
    event?.preventDefault?.();
    if (submissionRef.current) return;
    setError("");
    const nextErrors = {
      supplier_id: !form.supplier_id ? "Supplier is required." : "",
      received_date: !form.received_date ? "Received Date is required." : "",
    };
    form.items.forEach((item) => {
      nextErrors[`${item.row_id}.raw_material_id`] = !item.raw_material_id ? "Raw Material is required." : "";
      if (action === "complete") {
        nextErrors[`${item.row_id}.received_qty`] = Number(item.received_qty || 0) <= 0 ? "Qty must be greater than 0." : "";
        nextErrors[`${item.row_id}.uom`] = !item.uom ? "UOM is required." : "";
        nextErrors[`${item.row_id}.storage_location_id`] = !item.storage_location_id ? "Active Storage Location is required." : "";
        nextErrors[`${item.row_id}.expiry_date`] = item.expiry_tracking_mode === "required" && !item.expiry_date
          ? "Expiry Date is required."
          : item.expiry_date && !item.expiry_confirmed
            ? "Confirm the Expiry Date before completing Receiving."
            : "";
      }
    });
    const activeErrors = Object.fromEntries(Object.entries(nextErrors).filter(([, message]) => message));
    setFieldErrors(activeErrors);
    const firstError = Object.keys(activeErrors)[0];
    if (firstError) {
      setError(action === "complete" ? "Complete all required receiving details." : "Complete the Draft header and material selections.");
      focusFirstInvalid(fieldRefs, firstError);
      return;
    }
    submissionRef.current = true;
    setSavingAction(action);
    try {
      if (action === "complete") await onComplete(form);
      else await onSave(form);
    } finally {
      submissionRef.current = false;
      setSavingAction("");
    }
  }

  function renderMaterialPicker(item) {
    return <><RawMaterialCellPicker value={item.raw_material_id} materials={activeRawMaterials} placeholder="Select Raw Material" open={openMaterialRowId === item.row_id} error={Boolean(fieldErrors[`${item.row_id}.raw_material_id`])} buttonRef={(node) => { fieldRefs.current[`${item.row_id}.raw_material_id`] = node; }} onToggle={() => setOpenMaterialRowId((current) => current === item.row_id ? null : item.row_id)} onClose={() => setOpenMaterialRowId(null)} onSelect={(rawMaterialId) => selectRawMaterial(item.row_id, rawMaterialId)} />{fieldErrors[`${item.row_id}.raw_material_id`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.raw_material_id`]}</div> : null}</>;
  }

  function renderInternalBatch(item) {
    return <div className="min-h-[54px] rounded-lg border border-border bg-slate-50 px-3 py-2"><div className="font-mono text-xs font-bold text-text-secondary">{item.internal_batch_no || "Generated on completion"}</div>{item.internal_batch_no && !item.id ? <div className="mt-0.5 text-[10px] font-semibold text-text-muted">Preview only</div> : null}</div>;
  }

  function renderQuantityInput(item) {
    return <><div className="relative"><input data-factory-row-field="receiving-qty" data-row-id={item.row_id} ref={(node) => { fieldRefs.current[`${item.row_id}.received_qty`] = node; }} className={`${inputClass(fieldErrors[`${item.row_id}.received_qty`])} pr-14`} type="number" min="0" step="0.01" value={item.received_qty} onChange={(event) => updateItem(item.row_id, { received_qty: event.target.value })} />{item.uom ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-text-muted">{item.uom}</span> : null}</div>{fieldErrors[`${item.row_id}.received_qty`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.received_qty`]}</div> : null}</>;
  }

  function renderStoragePicker(item) {
    return <><SearchableSelect value={item.storage_location_id} options={storageLocationOptions} placeholder="Select Location" onChange={(locationId) => { const location = activeStorageLocations.find((row) => row.id === locationId); updateItem(item.row_id, { storage_location_id: locationId, storage_location: location?.location_name || "" }); }} />{fieldErrors[`${item.row_id}.storage_location_id`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.storage_location_id`]}</div> : null}</>;
  }

  function renderExpiryPicker(item) {
    return <><FeedXDatePicker value={item.expiry_date} placeholder="Expiry date" disabled={item.expiry_tracking_mode === "not_applicable"} onChange={(expiryDate) => updateItem(item.row_id, { expiry_date: expiryDate, expiry_source: expiryDate ? "supplier_label" : "", expiry_confirmed: Boolean(expiryDate) })} /><div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-text-muted"><span>{item.expiry_tracking_mode === "required" ? "Required" : item.expiry_tracking_mode === "not_applicable" ? "Not applicable" : "Optional"}</span>{item.expiry_source === "calculated" ? <span className="text-amber-700">Suggested from shelf life</span> : null}{item.expiry_date && !item.expiry_confirmed ? <button className="text-primary hover:underline" type="button" onClick={() => updateItem(item.row_id, { expiry_confirmed: true })}>Accept</button> : null}</div>{fieldErrors[`${item.row_id}.expiry_date`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.expiry_date`]}</div> : null}</>;
  }

  return (
    <>
    <Card title={initialBatch?.id ? `Edit ${initialBatch.batch_no}` : "Receive Raw Material"} description="Save preparation as a Draft, then complete once quantities and batch details are confirmed.">
      <form className="space-y-5 p-5" onSubmit={(event) => submit("draft", event)}>
        <div className="grid gap-3 lg:grid-cols-4">
          <Field label="Supplier *" error={fieldErrors.supplier_id}>
            <SearchableSelect value={form.supplier_id} options={supplierOptions} placeholder="Select Supplier" error={Boolean(fieldErrors.supplier_id)} buttonRef={(node) => { fieldRefs.current.supplier_id = node; }} onChange={(supplierId) => setForm((current) => ({ ...current, supplier_id: supplierId }))} />
          </Field>
          <Field label="Receiving No."><div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><div className={`text-sm font-bold ${initialBatch?.batch_no || receivingNoPreview.value ? "text-text-primary" : "text-text-secondary"}`}>{initialBatch?.batch_no || receivingNoPreview.value || (receivingNoPreview.loading ? "Loading preview..." : "—")}</div>{initialBatch?.id ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Assigned</div> : receivingNoPreview.value ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Preview only</div> : null}{!initialBatch?.batch_no && receivingNoPreview.error ? <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline" type="button" onClick={receivingNoPreview.retry}><RefreshCw size={11} /> Retry</button> : null}</div></Field>
          <Field label="Received Date *" error={fieldErrors.received_date}>
            <FeedXDatePicker value={form.received_date} required error={Boolean(fieldErrors.received_date)} buttonRef={(node) => { fieldRefs.current.received_date = node; }} onChange={(receivedDate) => setForm((current) => ({ ...current, received_date: receivedDate }))} />
          </Field>
          <Field label="Supplier DO / Invoice No."><input className={inputClass()} value={form.reference_no} onChange={(event) => setForm((current) => ({ ...current, reference_no: event.target.value }))} placeholder="Optional" /></Field>
        </div>
        <Field label="Remarks"><textarea className={inputClass()} rows={2} value={form.remarks} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} /></Field>

        <div className="rounded-xl border border-border bg-white p-4">
          <div className="rounded-xl border border-border bg-slate-50 px-4 py-3">
            <div><div className="text-sm font-semibold text-text-primary">Receiving Items</div><div className="text-xs text-text-secondary">UOM, storage, internal batch and expiry policy load from the Raw Material master.</div></div>
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,.85fr)_minmax(0,1fr)_minmax(0,.75fr)_minmax(0,1.25fr)_minmax(0,1fr)_56px] border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted xl:grid">
              {['Raw Material *', 'Supplier Lot No.', 'Internal Batch No.', 'Qty *', 'Storage Location *', 'Expiry Date', ''].map((label, index) => <div key={`${label}-${index}`} className="px-3 py-3">{label}</div>)}
            </div>
            <div className="divide-y divide-border">
              {form.items.map((item, index) => (
                <div key={item.row_id} className="grid gap-4 bg-white p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,.85fr)_minmax(0,1fr)_minmax(0,.75fr)_minmax(0,1.25fr)_minmax(0,1fr)_56px] xl:gap-0 xl:p-0">
                  <div className="min-w-0 xl:px-3 xl:py-3"><div className="mb-1 text-xs font-semibold text-text-secondary xl:hidden">Raw Material *</div>{renderMaterialPicker(item)}</div>
                  <div className="min-w-0 xl:px-3 xl:py-3"><div className="mb-1 text-xs font-semibold text-text-secondary xl:hidden">Supplier Lot No.</div><input className={inputClass()} value={item.supplier_lot_no} onChange={(event) => updateItem(item.row_id, { supplier_lot_no: event.target.value })} placeholder="Optional" /></div>
                  <div className="min-w-0 xl:px-3 xl:py-3"><div className="mb-1 text-xs font-semibold text-text-secondary xl:hidden">Internal Batch No.</div>{renderInternalBatch(item)}</div>
                  <div className="min-w-0 xl:px-3 xl:py-3"><div className="mb-1 text-xs font-semibold text-text-secondary xl:hidden">Qty *</div>{renderQuantityInput(item)}</div>
                  <div className="min-w-0 xl:px-3 xl:py-3"><div className="mb-1 text-xs font-semibold text-text-secondary xl:hidden">Storage Location *</div>{renderStoragePicker(item)}</div>
                  <div className="min-w-0 xl:px-3 xl:py-3"><div className="mb-1 text-xs font-semibold text-text-secondary xl:hidden">Expiry Date</div>{renderExpiryPicker(item)}</div>
                  <div className="flex items-end justify-end sm:col-span-2 xl:col-span-1 xl:items-start xl:px-2 xl:py-3"><button className="rounded-lg p-2 text-text-muted transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40" type="button" title="Remove item" aria-label={`Remove item ${index + 1}`} disabled={form.items.length === 1} onClick={() => setForm((current) => ({ ...current, items: current.items.filter((row) => row.row_id !== item.row_id) }))}><Trash2 size={16} /></button></div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-secondary h-9 px-3 text-sm" type="button" onClick={addReceivingRow}><Plus size={15} /> Add Row</button>
            <button className="btn-secondary h-9 px-3 text-sm" type="button" onClick={() => setReceivingBulkSelectOpen(true)}><ClipboardList size={15} /> Select Multiple</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-slate-50 px-4 py-3">
          {error ? <div className="mr-auto text-sm font-semibold text-rose-600">{error}</div> : null}
          {initialBatch?.id ? <button className="btn-secondary" type="button" disabled={Boolean(savingAction)} onClick={onCancelEdit}>Cancel Edit</button> : null}
          <button className="btn-secondary" type="submit" disabled={Boolean(savingAction)}>{savingAction === "draft" ? "Saving..." : "Save Draft"}</button>
          <button className="btn-primary" type="button" disabled={Boolean(savingAction)} onClick={(event) => submit("complete", event)}><PackageCheck size={15} /> {savingAction === "complete" ? "Completing..." : "Complete Receiving"}</button>
        </div>
      </form>
    </Card>
    {receivingBulkSelectOpen ? (
      <FactoryBulkSelectionModal
        title="Select Raw Materials"
        description="Choose multiple active Raw Materials to add as blank Receiving rows."
        items={receivingBulkItems}
        existingIds={form.items.map((item) => item.raw_material_id)}
        showImages
        onClose={() => setReceivingBulkSelectOpen(false)}
        onAdd={addSelectedRawMaterials}
      />
    ) : null}
    </>
  );
}

function ReceivingBatchDetailModal({ batch, onClose }) {
  const itemRows = batch.items || [];
  const quantityTotals = itemRows.reduce((totals, row) => ({
    ...totals,
    [row.uom || "units"]: Number(totals[row.uom || "units"] || 0) + Number(row.received_qty || 0),
  }), {});
  const totalQtyDisplay = Object.entries(quantityTotals).map(([uom, value]) => quantity(value, uom)).join(" · ") || "—";

  return (
    <Modal title="Raw Material Receiving" description="Read-only receiving document" onClose={onClose} size="2xl">
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard icon={FileText} label="Receiving No." value={batch.batch_no || "—"} />
          <MetricCard icon={Package} label="Items Received" value={itemRows.length} />
          <MetricCard icon={Warehouse} label="Quantity" value={totalQtyDisplay} />
          <div className="rounded-lg border border-border bg-white p-4"><div className="text-xs font-semibold text-text-secondary">Status</div><div className="mt-2"><Badge tone={statusTone(batch.status)}>{jobStatusLabel(batch.status)}</Badge></div></div>
        </div>

        <section className="rounded-lg border border-border bg-white p-5">
          <h3 className="text-sm font-black uppercase tracking-[0.08em] text-text-primary">Document Information</h3>
          <div className="mt-4 grid gap-x-12 gap-y-3 md:grid-cols-2">
            {[
              ...(batch.status === "completed"
                ? [
                    ["Completed At", formatFactoryDateTime(batch.completed_at)],
                    ["Completed By", batch.completed_by_name || "—"],
                  ]
                : [["Receiving Date", formatFactoryDate(batch.received_date)]]),
              ["Supplier", batch.supplier_name || "—"],
              ["Supplier DO / Invoice", batch.reference_no || "—"],
            ].map(([label, value]) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-baseline">
                <div className="whitespace-nowrap text-sm font-semibold text-text-secondary">{label}</div>
                <div className="text-sm font-bold text-text-primary">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-white p-5">
          <h3 className="mb-3 text-sm font-black uppercase tracking-[0.08em] text-text-primary">Received Items</h3>
          <FactoryTable
            columns={[
              { key: "raw_material_name", label: "Raw Material", render: (row) => <div className="font-semibold text-text-primary">{row.raw_material_name}</div> },
              { key: "supplier_lot_no", label: "Supplier Lot No.", render: (row) => row.supplier_lot_no || "—" },
              { key: "internal_batch_no", label: "Internal Batch No.", render: (row) => row.internal_batch_no || "—" },
              { key: "qty", label: "Qty", render: (row) => quantity(row.received_qty, row.uom) },
              { key: "storage_location", label: "Storage Location", render: (row) => row.storage_location ? <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-text-secondary">{row.storage_location}</span> : "—" },
              { key: "expiry_date", label: "Expiry Date", render: (row) => formatFactoryDate(row.expiry_date) },
            ]}
            rows={itemRows}
            emptyTitle="No receiving items"
            emptyDescription="This receiving document has no item rows."
          />
        </section>

        {batch.remarks ? <section className="rounded-lg border border-border bg-white p-5"><h3 className="text-sm font-black uppercase tracking-[0.08em] text-text-primary">Remarks</h3><p className="mt-2 text-sm text-text-secondary">{batch.remarks}</p></section> : null}
      </div>
    </Modal>
  );
}

function buildInitialUsageRows(job, rawMaterials, recipes) {
  const matchingRecipe = activeRecipeForSku(recipes, job.finished_good || job, job.product_name);
  if (matchingRecipe?.items?.length) {
    const targetQuantity = Number(job.actual_output_qty || job.target_production_qty || job.actual_produced_qty || job.target_quantity || 0);
    const recipeYield = Number(matchingRecipe.yield_quantity || 1) || 1;
    return matchingRecipe.items.map((item) => {
      const standardUsage = (Number(item.quantity_used || 0) * targetQuantity) / recipeYield;
      return {
        id: `recipe-${item.id}`,
        recipe_item_id: item.id,
        raw_material_id: item.raw_material_id,
        standard_usage: Number(standardUsage.toFixed(4)),
        actual_usage: Number(standardUsage.toFixed(4)),
        raw_material_receiving_id: "",
        raw_material_lot_no: "",
        uom: item.uom || rawMaterials.find((material) => material.id === item.raw_material_id)?.uom || "",
        variance_reason: "",
        notes: item.notes || "",
        allocations: [],
      };
    });
  }
  return [];
}


function StartProductionModal({ job, sops = [], auth, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    production_date: todayInput(),
    start_time: timeInput(),
    remarks: "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const operatorId = auth?.profile?.id || "";
  const operatorName = employeeDisplayName(auth);
  const operatorResolved = Boolean(operatorId && operatorName);
  const activeSop = sops.find((sop) => sop.status === "active" && sop.finished_good_id === job.product_family_id)
    || sops.find((sop) => sop.status === "active" && String(sop.product_name || "").toLowerCase() === String(jobFinishedGoodName(job)).toLowerCase());
  const sopQcCount = (activeSop?.steps || []).reduce((count, step) => count + (step.qc_checks || []).length, 0);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!operatorResolved) {
      setError("Current employee could not be resolved. Sign in again before starting production.");
      return;
    }
    if (!form.production_date) {
      setError("Production date is required.");
      return;
    }
    if (!form.start_time) {
      setError("Start time is required.");
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
      title="Start Production"
      description={`${job.job_order_no} · ${job.product_name}`}
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-start-production-form" disabled={saving || !operatorResolved}>{saving ? "Starting..." : "Start Production"}</button>
        </>
      )}
    >
      <form id="factory-start-production-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <section className="rounded-xl border border-border bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="font-mono text-sm font-black text-text-primary">{job.job_order_no}</div><div className="mt-1 text-lg font-bold text-text-primary">{jobFinishedGoodName(job)}</div></div>
            <div className="text-right text-sm font-semibold text-text-secondary"><div>Target {quantity(job.target_production_qty || job.target_quantity, job.uom)}</div><div className="mt-1">Scheduled {formatFactoryDate(job.planned_date)}</div></div>
          </div>
        </section>

        <section>
          <div className="mb-3"><div className="text-sm font-black text-text-primary">Production Setup</div><div className="mt-1 text-xs font-semibold text-text-secondary">Confirm the authenticated operator and start time before reviewing the process.</div></div>
          <div className="grid gap-3 md:grid-cols-3">
          <Field label="Operator">
            <div className={`${inputClass()} flex items-center bg-slate-50 font-semibold ${operatorResolved ? "text-text-primary" : "border-rose-300 text-rose-700"}`}>
              {operatorName || "Current employee unavailable"}
            </div>
          </Field>
          <Field label="Production Date">
            <FeedXDatePicker
              value={form.production_date || ""}
              onChange={(nextDate) => setForm((current) => ({ ...current, production_date: nextDate }))}
            />
          </Field>
          <Field label="Start Time">
            <input className={inputClass()} type="time" value={form.start_time || ""} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} />
          </Field>
          </div>
          {!operatorResolved ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Current employee could not be resolved. Sign in again before starting production.</div> : null}
        </section>

        <section className="rounded-xl border border-border bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="flex items-center gap-2 text-sm font-black text-text-primary"><BookOpen size={16} /> Production SOP</div>{activeSop ? <div className="mt-1 text-lg font-black text-text-primary">{productionSopDisplayName(activeSop)}</div> : null}</div>
            {activeSop ? <div className="flex flex-wrap gap-2"><Badge tone="info">{activeSop.estimated_minutes || 0} mins</Badge><Badge tone={sopQcCount ? "warning" : "neutral"}>{sopQcCount ? `${sopQcCount} QC checks` : "No QC Required"}</Badge></div> : null}
          </div>
          {activeSop ? (
            <div className="mt-4 space-y-3">
              {(activeSop.steps || []).map((step) => (
                <article key={step.id} className="rounded-xl border border-border bg-slate-50 p-3 sm:p-4">
                  <div className="flex gap-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-white">{step.step_no}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-black text-text-primary">{step.step_name || step.process_name}</div>{step.description ? <div className="mt-1 text-sm font-semibold text-text-secondary">{step.description}</div> : null}</div><span className="text-xs font-bold text-text-secondary">{step.estimated_time_minutes || 0} mins</span></div>
                    {step.sub_steps?.length ? <div className="mt-3 space-y-1.5">{step.sub_steps.map((subStep) => <div key={subStep.id || `${step.id}-${subStep.sequence_no}`} className="flex gap-2 text-xs font-semibold text-text-secondary"><span className="font-black text-primary">{step.step_no}.{subStep.sequence_no}</span><span>{subStep.instruction}</span></div>)}</div> : null}
                    {step.ingredient_references?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{step.ingredient_references.map((ingredient) => <span key={`${step.id}-${ingredient.raw_material_id}`} className="rounded-full border border-border bg-white px-2.5 py-1 text-xs font-bold text-text-secondary">{ingredient.raw_material_name}</span>)}</div> : null}
                    {step.qc_checks?.length ? (
                      <div className="mt-3 border-t border-border pt-3">
                        <div className="text-[10.5px] font-bold text-text-muted">QC during production</div>
                        <div className="mt-2 space-y-2">
                          {step.qc_checks.map((qc) => (
                            <div key={qc.id} className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="text-xs font-black text-text-primary">{qc.qc_name}</div>
                                <Badge tone={qc.is_required ? "warning" : "neutral"}>{qc.is_required ? "Required" : "Optional"}</Badge>
                              </div>
                              {String(qc.instructions || "").trim() ? <div className="mt-1 text-xs font-semibold leading-5 text-text-secondary">{qc.instructions}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div></div>
                </article>
              ))}
            </div>
          ) : <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4"><div className="text-sm font-black text-amber-900">No SOP Linked</div><div className="mt-1 text-sm font-semibold text-amber-800">No SOP is linked. Production will start without SOP steps or QC checks.</div></div>}
        </section>

        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function allocateRawMaterialFefo(requiredQty, batches, reservedByBatch = {}) {
  let remaining = Number(requiredQty || 0);
  const allocations = [];
  (Array.isArray(batches) ? batches : []).forEach((batch) => {
    const available = Math.max(Number(batch.available_qty || 0) - Number(reservedByBatch[batch.batch_balance_id] || 0), 0);
    const allocatedQty = Math.min(remaining, available);
    if (allocatedQty > 0) {
      allocations.push({ ...batch, allocated_qty: allocatedQty });
      reservedByBatch[batch.batch_balance_id] = Number(reservedByBatch[batch.batch_balance_id] || 0) + allocatedQty;
      remaining -= allocatedQty;
    }
  });
  return { allocations, remaining };
}

function RawMaterialBatchAllocationModal({ row, material, batches = [], otherAllocations = [], loading = false, stale = false, error = "", onRetry, onClose, onApply }) {
  const reserved = otherAllocations.reduce((summary, allocation) => ({
    ...summary,
    [allocation.batch_balance_id]: Number(summary[allocation.batch_balance_id] || 0) + Number(allocation.allocated_qty || 0),
  }), {});
  const [quantities, setQuantities] = useState(() => Object.fromEntries((row.allocations || []).map((allocation) => [allocation.batch_balance_id, String(allocation.allocated_qty)])));
  const requiredQty = Number(row.actual_usage || 0);
  const availableQty = batches.reduce((sum, batch) => sum + Math.max(Number(batch.available_qty || 0) - Number(reserved[batch.batch_balance_id] || 0), 0), 0);
  const allocatedQty = Object.values(quantities).reduce((sum, value) => sum + Number(value || 0), 0);
  const invalid = batches.some((batch) => Number(quantities[batch.batch_balance_id] || 0) < 0
    || Number(quantities[batch.batch_balance_id] || 0) > Math.max(Number(batch.available_qty || 0) - Number(reserved[batch.batch_balance_id] || 0), 0));
  const canApply = !loading && !stale && !error && requiredQty > 0 && Math.abs(allocatedQty - requiredQty) <= varianceReasonTolerance && !invalid;

  function autoAllocate() {
    const result = allocateRawMaterialFefo(requiredQty, batches, { ...reserved });
    setQuantities(Object.fromEntries(result.allocations.map((allocation) => [allocation.batch_balance_id, String(allocation.allocated_qty)])));
  }

  return (
    <Modal
      title="Raw Material Batch Allocation"
      description={rawMaterialLabel(material)}
      size="xl"
      onClose={onClose}
      footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={!canApply} onClick={() => onApply(batches.flatMap((batch) => Number(quantities[batch.batch_balance_id] || 0) > 0 ? [{ ...batch, allocated_qty: Number(quantities[batch.batch_balance_id]) }] : []))}>Apply Allocation</button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[["Required Qty", requiredQty], ["Allocated Qty", allocatedQty], ["Available Qty", availableQty]].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-slate-50 px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">{label}</div><div className="mt-1 text-sm font-black text-text-primary">{quantity(value, row.uom || material?.uom)}</div></div>)}
        </div>
        <div className="flex flex-wrap gap-2"><button className="btn-secondary" type="button" disabled={loading || !batches.length} onClick={autoAllocate}><RefreshCw size={14} /> Auto Allocate FEFO</button><button className="btn-secondary" type="button" disabled={loading} onClick={() => setQuantities({})}>Clear Allocation</button></div>
        {stale ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Unable to load the latest Raw Material batch availability. Complete remains disabled. <button className="underline" type="button" onClick={onRetry}>Retry</button></div> : null}
        {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error} {onRetry ? <button className="underline" type="button" onClick={onRetry}>Retry</button> : null}</div> : null}
        {!loading && !error && !batches.length ? <EmptyState title="No eligible batches" description="Complete a Raw Material Receiving or reconcile batch storage before completing Production." /> : null}
        {batches.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase text-text-muted"><th className="px-3 py-2">Internal Batch No.</th><th className="px-3 py-2">Supplier Lot No.</th><th className="px-3 py-2">Received Date</th><th className="px-3 py-2">Expiry Date</th><th className="px-3 py-2">Storage Location</th><th className="px-3 py-2">Available Qty</th><th className="px-3 py-2">Allocate Qty</th></tr></thead><tbody>{batches.map((batch) => {
          const lineAvailable = Math.max(Number(batch.available_qty || 0) - Number(reserved[batch.batch_balance_id] || 0), 0);
          return <tr key={batch.batch_balance_id} className="border-b border-border last:border-0"><td className="px-3 py-3 font-bold">{batch.internal_batch_no || "—"}</td><td className="px-3 py-3">{batch.supplier_lot_no || "—"}</td><td className="px-3 py-3">{formatFactoryDate(batch.received_date)}</td><td className="px-3 py-3">{batch.expiry_date ? formatFactoryDate(batch.expiry_date) : "No expiry"}</td><td className="px-3 py-3"><div className="font-semibold">{batch.storage_location_name || "—"}</div>{batch.storage_location_type ? <div className="text-xs text-text-muted">{batch.storage_location_type}</div> : null}</td><td className="px-3 py-3 font-semibold">{quantity(lineAvailable, batch.uom)}</td><td className="px-3 py-3"><input className={inputClass()} type="number" min="0" step="0.0001" value={quantities[batch.batch_balance_id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [batch.batch_balance_id]: event.target.value }))} /></td></tr>;
        })}</tbody></table></div> : null}
      </div>
    </Modal>
  );
}

function ProductionExecutionModal({ job, rawMaterials = [], receivings = [], recipes = [], sops = [], finishedGoods = [], storageLocations = [], auth, readOnly = false, processOnly = false, notify, onViewProcess, onClose, onSave }) {
  const activeFinishedGoods = finishedGoods.filter((product) => product.status === "active");
  const matchingFinishedGood = activeFinishedGoods.find((product) => product.id === job.finished_good_id) || activeFinishedGoods.find((product) => product.product_name.toLowerCase() === String(job.product_name || "").toLowerCase());
  const matchingRecipe = activeRecipeForSku(recipes, matchingFinishedGood || job, job.product_name);
  const initialPackQty = job.actual_pack_qty || job.target_pack_qty || job.good_output_qty || job.target_quantity || "";
  const initialProductionPlan = packagingProductionPlan(initialPackQty, matchingFinishedGood, matchingRecipe?.uom || job.uom);
  const initialProductionUom = initialProductionPlan.production_uom || matchingRecipe?.uom || job.uom || "";
  const initialOutputQty = initialProductionPlan.error ? Number(job.actual_output_qty || job.target_production_qty || job.target_quantity || 0) : initialProductionPlan.target_production_qty;
  const initialMaterialUsage = buildInitialUsageRows({ ...job, finished_good: matchingFinishedGood, actual_output_qty: initialOutputQty }, rawMaterials, recipes);
  const authoritativeProductionDate = job.production_date || "";
  const authoritativeStartTime = job.start_time ? String(job.start_time).slice(0, 5) : "";
  const defaultEndDate = authoritativeProductionDate && authoritativeProductionDate > todayInput() ? authoritativeProductionDate : todayInput();
  const shelfLifeConfigured = matchingFinishedGood?.shelf_life_days !== "" && matchingFinishedGood?.shelf_life_days !== null && matchingFinishedGood?.shelf_life_days !== undefined;
  const initialCalculatedExpiryDate = shelfLifeConfigured ? addDaysToFactoryDate(defaultEndDate, Number(matchingFinishedGood.shelf_life_days)) : "";
  const finishedGoodsLocations = storageLocations.filter((location) => location.status === "active" && String(location.location_type || "").toLowerCase() === "finished goods area");
  const defaultStorageLocation = storageLocations.find((location) => location.id === matchingFinishedGood?.storage_location_id);
  const defaultStorageLocationId = defaultStorageLocation?.status === "active" && String(defaultStorageLocation.location_type || "").toLowerCase() === "finished goods area" ? defaultStorageLocation.id : "";
  const defaultStorageLocationArchived = defaultStorageLocation && defaultStorageLocation.status !== "active";
  const [form, setForm] = useState(() => ({
    job_order_id: job.id,
    finished_good_id: matchingFinishedGood?.id || job.finished_good_id || "",
    production_no: "",
    product_name: matchingFinishedGood?.product_name || job.product_name || "",
    batch_no: "",
    production_date: defaultEndDate,
    operator_id: job.production_operator_id || auth?.profile?.id || "",
    operator_name: job.production_operator_name || employeeDisplayName(auth),
    start_time: authoritativeStartTime,
    end_date: defaultEndDate,
    end_time: timeInput(),
    expiry_date: initialCalculatedExpiryDate,
    storage_location_id: defaultStorageLocationId,
    expiry_override_reason: "",
    actual_pack_qty: initialPackQty,
    actual_output_qty: initialOutputQty || "",
    actual_produced_qty: initialOutputQty || "",
    good_output_qty: initialOutputQty || "",
    wastage_qty: 0,
    uom: initialProductionUom,
    qc_status: "Pending",
    production_sop_id: "",
    sop_version: "",
    notes: "",
    material_usage: Array.isArray(initialMaterialUsage) ? initialMaterialUsage : [],
  }));
  const [saving, setSaving] = useState(false);
  const [savingQc, setSavingQc] = useState(false);
  const [executionLoading, setExecutionLoading] = useState(true);
  const [execution, setExecution] = useState({ steps: [], snapshotCreatedAt: "", sopId: "", sopVersion: "" });
  const [savedQcSignature, setSavedQcSignature] = useState("");
  const [qcSaveFeedback, setQcSaveFeedback] = useState("idle");
  const [lastQcSavedAt, setLastQcSavedAt] = useState("");
  const qcSaveResetTimerRef = useRef(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [expiryManuallyChanged, setExpiryManuallyChanged] = useState(false);
  const [error, setError] = useState("");
  const [productionBatchAvailability, setProductionBatchAvailability] = useState({ rows: [], loading: true, stale: false, error: "", errorKind: "", hasLoaded: false });
  const [productionBatchEditorRowId, setProductionBatchEditorRowId] = useState("");
  const [productionBatchRetryVersion, setProductionBatchRetryVersion] = useState(0);
  const productionBatchRequestRef = useRef(0);
  const manufacturingDate = strictDateValue(form.end_date) !== null ? form.end_date : "";
  const calculatedExpiryDate = shelfLifeConfigured ? addDaysToFactoryDate(manufacturingDate, Number(matchingFinishedGood.shelf_life_days)) : "";
  const batchNoPreview = useFactoryNumberPreview({
    assignedValue: form.batch_no || "",
    previewKey: form.batch_no || authoritativeProductionDate,
    loadPreview: () => factoryService.getProductionBatchNoPreview(authoritativeProductionDate),
    enabled: !form.batch_no && !readOnly,
    scope: "production_batch_no",
  });
  const currentQcSignature = useMemo(() => productionQcEditableSignature(execution), [execution]);
  const qcDirty = !executionLoading && Boolean(execution.snapshotCreatedAt) && currentQcSignature !== savedQcSignature;

  useEffect(() => {
    if (!shelfLifeConfigured) return;
    setForm((current) => {
      if (!expiryManuallyChanged) return { ...current, expiry_date: calculatedExpiryDate, expiry_override_reason: "" };
      if (current.expiry_date === calculatedExpiryDate) return { ...current, expiry_override_reason: "" };
      return current;
    });
  }, [calculatedExpiryDate, expiryManuallyChanged, shelfLifeConfigured]);

  useEffect(() => {
    let active = true;
    setExecutionLoading(true);
    factoryService.getProductionExecution(job.id)
      .then((nextExecution) => {
        if (!active) return;
        setExecution(nextExecution);
        setSavedQcSignature(productionQcEditableSignature(nextExecution));
        setLastQcSavedAt(latestProductionQcSavedAt(nextExecution));
        setQcSaveFeedback("idle");
      })
      .catch((loadError) => { if (active) setError(loadError.message || "Unable to load Production QC."); })
      .finally(() => { if (active) setExecutionLoading(false); });
    return () => { active = false; };
  }, [job.id]);

  useEffect(() => () => clearTimeout(qcSaveResetTimerRef.current), []);

  const rawMaterialBatchIds = useMemo(() => [...new Set(form.material_usage.map((row) => row.raw_material_id).filter(Boolean))], [form.material_usage]);
  const rawMaterialBatchKey = rawMaterialBatchIds.slice().sort().join(",");
  const productionBatchRetryKey = `${job.id}:${rawMaterialBatchKey}:${productionBatchRetryVersion}`;

  useEffect(() => {
    const requestId = ++productionBatchRequestRef.current;
    if (!rawMaterialBatchIds.length) {
      setProductionBatchAvailability({ rows: [], loading: false, stale: false, error: "", errorKind: "", hasLoaded: true });
      return undefined;
    }
    setProductionBatchAvailability((current) => ({ ...current, loading: true, error: "", errorKind: "" }));
    factoryService.getRawMaterialBatchAvailability(rawMaterialBatchIds, job.id)
      .then((rows) => {
        if (productionBatchRequestRef.current !== requestId) return;
        const safeRows = Array.isArray(rows) ? rows : [];
        setProductionBatchAvailability({ rows: safeRows, loading: false, stale: false, error: "", errorKind: "", hasLoaded: true });
        setForm((current) => {
          const reserved = {};
          return {
            ...current,
            material_usage: current.material_usage.map((usage) => {
              const eligible = safeRows.filter((batch) => batch.batch_balance_id && batch.raw_material_id === usage.raw_material_id
                && String(batch.uom || "").trim().toLowerCase() === String(usage.uom || rawMaterials.find((material) => material.id === usage.raw_material_id)?.uom || "").trim().toLowerCase());
              const eligibleById = new Map(eligible.map((batch) => [batch.batch_balance_id, batch]));
              const existingTotal = (usage.allocations || []).reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0);
              const existingValid = Math.abs(existingTotal - Number(usage.actual_usage || 0)) <= varianceReasonTolerance
                && (usage.allocations || []).every((allocation) => {
                  const batch = eligibleById.get(allocation.batch_balance_id);
                  return batch && Number(allocation.allocated_qty || 0) <= Math.max(Number(batch.available_qty || 0) - Number(reserved[allocation.batch_balance_id] || 0), 0);
                });
              if (existingValid) {
                (usage.allocations || []).forEach((allocation) => { reserved[allocation.batch_balance_id] = Number(reserved[allocation.batch_balance_id] || 0) + Number(allocation.allocated_qty || 0); });
                return { ...usage, allocation_shortage: 0 };
              }
              const allocation = allocateRawMaterialFefo(Number(usage.actual_usage || 0), eligible, reserved);
              return { ...usage, allocations: allocation.allocations, allocation_shortage: allocation.remaining };
            }),
          };
        });
      })
      .catch((loadError) => {
        if (productionBatchRequestRef.current !== requestId) return;
        console.error("factory.production.raw_material_batch_availability", loadError);
        if (isFactoryPermissionError(loadError)) {
          setProductionBatchEditorRowId("");
          setForm((current) => ({ ...current, material_usage: current.material_usage.map((usage) => ({ ...usage, allocations: [] })) }));
          setProductionBatchAvailability({ rows: [], loading: false, stale: false, error: "Raw Material batch availability is hidden by your current role.", errorKind: "permission", hasLoaded: false });
        } else {
          setProductionBatchAvailability((current) => current.hasLoaded
            ? { ...current, loading: false, stale: true, error: "", errorKind: "load" }
            : { rows: [], loading: false, stale: true, error: "Unable to load Raw Material batch availability.", errorKind: "load", hasLoaded: false });
        }
      });
    return () => { if (productionBatchRequestRef.current === requestId) productionBatchRequestRef.current += 1; };
  }, [authoritativeProductionDate, productionBatchRetryKey, rawMaterialBatchKey]);

  function updateExecutionQc(stepId, qcId, patch) {
    clearTimeout(qcSaveResetTimerRef.current);
    setQcSaveFeedback("idle");
    setError("");
    setExecution((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_results: (step.qc_results || []).map((qc) => qc.id === qcId ? { ...qc, ...patch } : qc) } : step) }));
  }

  async function saveQcProgress({ showFeedback = true } = {}) {
    if (readOnly) throw new Error("Production QC is read-only for your account.");
    if (!execution.snapshotCreatedAt) return execution;
    if (!qcDirty) return execution;
    const missingNaReason = execution.steps.flatMap((step) => step.qc_results || []).some((qc) => qc.qc_type === "checklist" && qc.checklist_result === "na" && !String(qc.remarks || "").trim());
    if (missingNaReason) {
      const validationError = new Error("Add a reason when selecting N/A.");
      setError(validationError.message);
      notify?.({ title: "Failed to save Production Process & QC", message: validationError.message, tone: "error" });
      throw validationError;
    }
    setSavingQc(true);
    setQcSaveFeedback("idle");
    try {
      const saved = await factoryService.saveProductionQcProgress(job.id, execution, auth?.profile?.id, employeeDisplayName(auth));
      setExecution(saved);
      setSavedQcSignature(productionQcEditableSignature(saved));
      setLastQcSavedAt(latestProductionQcSavedAt(saved) || new Date().toISOString());
      setError("");
      if (showFeedback) {
        setQcSaveFeedback("saved");
        notify?.({ title: "Production process saved successfully.", tone: "success" });
        clearTimeout(qcSaveResetTimerRef.current);
        qcSaveResetTimerRef.current = setTimeout(() => setQcSaveFeedback("idle"), 2500);
      }
      return saved;
    } catch (saveError) {
      setError(saveError.message || "Unable to save Production Process & QC.");
      notify?.({ title: "Failed to save Production Process & QC", message: saveError.message, tone: "error" });
      throw saveError;
    } finally {
      setSavingQc(false);
    }
  }

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
          allocations: [],
        },
      ],
    }));
  }

  function updateUsageRow(rowId, patch) {
    setForm((current) => {
      const nextRows = current.material_usage.map((row) => row.id === rowId ? { ...row, ...patch } : row);
      if (!Object.prototype.hasOwnProperty.call(patch, "actual_usage") && !Object.prototype.hasOwnProperty.call(patch, "raw_material_id")) return { ...current, material_usage: nextRows };
      const reserved = {};
      nextRows.filter((row) => row.id !== rowId).flatMap((row) => row.allocations || []).forEach((allocation) => { reserved[allocation.batch_balance_id] = Number(reserved[allocation.batch_balance_id] || 0) + Number(allocation.allocated_qty || 0); });
      return {
        ...current,
        material_usage: nextRows.map((row) => {
          if (row.id !== rowId) return row;
          const material = rawMaterials.find((item) => item.id === row.raw_material_id);
          const eligible = productionBatchAvailability.rows.filter((batch) => batch.batch_balance_id && batch.raw_material_id === row.raw_material_id
            && String(batch.uom || "").trim().toLowerCase() === String(row.uom || material?.uom || "").trim().toLowerCase());
          const allocation = productionBatchAvailability.hasLoaded && !productionBatchAvailability.stale && !productionBatchAvailability.error
            ? allocateRawMaterialFefo(Number(row.actual_usage || 0), eligible, reserved)
            : { allocations: [], remaining: Number(row.actual_usage || 0) };
          return { ...row, allocations: allocation.allocations, allocation_shortage: allocation.remaining };
        }),
      };
    });
  }

  function removeUsageRow(rowId) {
    setForm((current) => ({
      ...current,
      material_usage: current.material_usage.filter((row) => row.id !== rowId),
    }));
  }

  function validate() {
    if (!form.job_order_id) return "Select a job order before completing production.";
    const finishedGood = activeFinishedGoods.find((product) => product.id === form.finished_good_id);
    if (!finishedGood) return "Production must start from a job order linked to an active finished good.";
    if (!form.end_date) return "End Date is required.";
    if (!form.end_time) return "End Time is required.";
    const startDateTime = strictDateTimeValue(authoritativeProductionDate, authoritativeStartTime);
    const endDateTime = strictDateTimeValue(form.end_date, form.end_time);
    if (startDateTime === null) return "Job Order Production Date and Start Time are required before completing production.";
    if (endDateTime === null) return "Enter a valid End Date and End Time.";
    if (endDateTime < startDateTime) return "Production End Date and Time cannot be earlier than Start Date and Time.";
    if (!Number.isInteger(Number(form.actual_pack_qty)) || Number(form.actual_pack_qty) <= 0) return "Actual Pack Qty must be a whole number greater than zero.";
    if (shelfLifeConfigured && strictDateValue(form.expiry_date) === null) return "Expiry Date is required for this Packaging SKU.";
    if (form.expiry_date && strictDateValue(form.expiry_date) === null) return "Enter a valid Expiry Date.";
    if (form.expiry_date && strictDateValue(form.expiry_date) < strictDateValue(manufacturingDate)) return "Expiry Date cannot be earlier than Manufacturing Date.";
    if (shelfLifeConfigured && form.expiry_date !== calculatedExpiryDate && !String(form.expiry_override_reason || "").trim()) return "Expiry override reason is required when changing the calculated Expiry Date.";
    if (!form.material_usage.length) return "At least one material usage row is required.";
    const invalidRow = form.material_usage.find((row) => !row.raw_material_id || row.actual_usage === "" || row.actual_usage === null || row.actual_usage === undefined || Number(row.actual_usage) < 0);
    if (invalidRow) return "Every material usage row needs a raw material and actual usage.";
    const missingReason = form.material_usage.find((row) => {
      const { variance } = varianceFor(row.standard_usage, row.actual_usage);
      return Math.abs(variance) > varianceReasonTolerance && !String(row.variance_reason || "").trim();
    });
    if (missingReason) return "Reason is required when actual usage differs from standard usage.";
    if (productionBatchAvailability.loading) return "Wait for Raw Material batch availability to finish loading.";
    if (!productionBatchAvailability.hasLoaded || productionBatchAvailability.stale || productionBatchAvailability.error) return "Refresh Raw Material batch availability before completing Production.";
    const allocatedByBatch = {};
    for (const row of form.material_usage) {
      const actual = Number(row.actual_usage || 0);
      const allocated = (row.allocations || []).reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0);
      if (Math.abs(allocated - actual) > varianceReasonTolerance) {
        const material = rawMaterials.find((item) => item.id === row.raw_material_id);
        const available = productionBatchAvailability.rows.filter((batch) => batch.batch_balance_id && batch.raw_material_id === row.raw_material_id).reduce((sum, batch) => sum + Number(batch.available_qty || 0), 0);
        return `Insufficient Raw Material batch stock for ${material?.name_en || material?.name || "Material"}. Required ${actual}, available ${available}.`;
      }
      for (const allocation of row.allocations || []) allocatedByBatch[allocation.batch_balance_id] = Number(allocatedByBatch[allocation.batch_balance_id] || 0) + Number(allocation.allocated_qty || 0);
    }
    const overAllocated = Object.entries(allocatedByBatch).find(([batchId, allocated]) => allocated > Number(productionBatchAvailability.rows.find((batch) => batch.batch_balance_id === batchId)?.available_qty || 0) + varianceReasonTolerance);
    if (overAllocated) return "Raw Material batch allocation exceeds the latest available balance.";
    if (execution.snapshotCreatedAt) {
      const qcResults = execution.steps.flatMap((step) => step.qc_results || []);
      if (qcResults.some((qc) => qc.qc_type === "checklist" && qc.checklist_result === "na" && !String(qc.remarks || "").trim())) return "Add a reason when selecting N/A.";
      const incompleteQc = qcResults.find((qc) => qc.is_required && (
        (qc.qc_type === "checklist" && (!qc.checklist_result || (qc.checklist_result === "na" && !String(qc.remarks || "").trim())))
        || (qc.qc_type === "remarks" && !String(qc.remarks || "").trim())
      ));
      if (incompleteQc) return "Complete all required QC checks before completing production.";
      if (qcResults.some((qc) => qc.is_required && qc.qc_type === "checklist" && qc.checklist_result === "fail")) return "Production has failed QC checks that require review.";
    }
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
      await saveQcProgress({ showFeedback: false });
      await onSave({
        ...form,
        actual_produced_qty: form.actual_output_qty || form.good_output_qty,
        good_output_qty: form.actual_output_qty || form.good_output_qty,
      });
    } finally {
      setSaving(false);
    }
  }

  const hasRecipeBom = Boolean(matchingRecipe?.items?.length);
  const recipeYieldQty = Number(matchingRecipe?.yield_quantity || 0);
  const currentProductionQty = Number(form.actual_output_qty || form.good_output_qty || 0);
  const scaleFactor = matchingRecipe && recipeYieldQty > 0 ? currentProductionQty / recipeYieldQty : 0;
  const estimatedPackQty = Number(job.target_pack_qty || job.target_quantity || 0);
  const actualPackQty = Number(form.actual_pack_qty || 0);
  const packDifference = actualPackQty - estimatedPackQty;
  const executionQcResults = execution.steps.flatMap((step) => step.qc_results || []);
  const executionQcState = productionQcStatus(executionQcResults);
  const completedQcCount = executionQcState.entered;
  const failedQcCount = executionQcState.failed;
  const remainingQcCount = Math.max(executionQcState.total - executionQcState.entered, 0);
  const executionQcLabel = productionQcDisplayLabel(executionQcState.status);
  const linkedSop = sops.find((sop) => sop.id === (execution.sopId || job.production_sop_id));
  const startDateTime = strictDateTimeValue(authoritativeProductionDate, authoritativeStartTime);
  const authoritativeStartValid = startDateTime !== null;
  const endDateValueValid = strictDateValue(form.end_date) !== null;
  const endTimeValueValid = strictTimeValueMinutes(form.end_time) !== null;
  const endDateTime = strictDateTimeValue(form.end_date, form.end_time);
  const endDateTimeValid = startDateTime !== null && endDateTime !== null && endDateTime >= startDateTime;
  const endDateTimeValidationMessage = !form.end_date
    ? "End Date is required."
    : !endDateValueValid
      ? "Enter a valid End Date."
      : !form.end_time
        ? "End Time is required."
        : !endTimeValueValid
          ? "Enter a valid End Time."
          : startDateTime === null
            ? "Job Order Production Date and Start Time are required before completing production."
            : endDateTime < startDateTime
              ? "Production End Date and Time cannot be earlier than Start Date and Time."
              : "";
  const actualPackQtyValid = Number.isInteger(Number(form.actual_pack_qty)) && Number(form.actual_pack_qty) > 0;
  const expiryDateValid = !shelfLifeConfigured || strictDateValue(form.expiry_date) !== null;
  const expiryOverrideRequired = shelfLifeConfigured && Boolean(form.expiry_date) && form.expiry_date !== calculatedExpiryDate;
  const expiryOverrideValid = !expiryOverrideRequired || Boolean(String(form.expiry_override_reason || "").trim());
  const requiredDetailsRemaining = Number(!endDateValueValid) + Number(!endTimeValueValid || (endDateValueValid && endTimeValueValid && !endDateTimeValid)) + Number(!actualPackQtyValid) + Number(!expiryDateValid) + Number(!expiryOverrideValid);
  const requiredQcIncomplete = executionQcState.requiredCompleted < executionQcState.requiredTotal;
  const requiredQcFailed = executionQcResults.some((qc) => qc.is_required && qc.qc_type === "checklist" && qc.checklist_result === "fail");
  const qcCompletionBlocked = Boolean(execution.snapshotCreatedAt) && (requiredQcIncomplete || requiredQcFailed);
  const batchCompletionBlocked = productionBatchAvailability.loading || productionBatchAvailability.stale || !productionBatchAvailability.hasLoaded || Boolean(productionBatchAvailability.error)
    || form.material_usage.some((row) => Math.abs((row.allocations || []).reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0) - Number(row.actual_usage || 0)) > varianceReasonTolerance);
  const completionDisabled = saving || savingQc || executionLoading || !authoritativeStartValid || requiredDetailsRemaining > 0 || qcCompletionBlocked || batchCompletionBlocked;
  const completionDisabledReason = executionLoading
    ? "Loading Production QC."
    : !authoritativeStartValid
      ? "Job Order Production Date and Start Time are required before completing production."
    : requiredDetailsRemaining > 0
    ? endDateTimeValidationMessage || `Complete ${[!endDateValueValid ? "End Date" : "", !endTimeValueValid || !endDateTimeValid ? "End Time" : "", !actualPackQtyValid ? "Actual Pack Qty" : "", !expiryDateValid ? "Expiry Date" : "", !expiryOverrideValid ? "Expiry Override Reason" : ""].filter(Boolean).join(", ")}.`
    : requiredQcFailed
      ? "Resolve failed required QC checks."
      : requiredQcIncomplete
        ? "Complete required QC checks."
        : productionBatchAvailability.loading
          ? "Loading Raw Material batch availability."
          : productionBatchAvailability.stale || productionBatchAvailability.error || !productionBatchAvailability.hasLoaded
            ? "Refresh Raw Material batch availability before completing Production."
            : batchCompletionBlocked
              ? "Complete every Raw Material batch allocation."
        : "";
  const durationLabel = productionDurationLabel(authoritativeProductionDate, authoritativeStartTime, form.end_date, form.end_time);
  const formatSignedQuantity = (value, unit) => {
    const numericValue = Number(value || 0);
    const prefix = numericValue > 0 ? "+" : "";
    return `${prefix}${quantity(numericValue, unit)}`;
  };
  const productionBatchEditorRow = form.material_usage.find((row) => row.id === productionBatchEditorRowId);
  const productionBatchEditorMaterial = rawMaterials.find((material) => material.id === productionBatchEditorRow?.raw_material_id);
  const productionBatchEditorRows = productionBatchAvailability.rows.filter((batch) => batch.batch_balance_id && batch.raw_material_id === productionBatchEditorRow?.raw_material_id
    && String(batch.uom || "").trim().toLowerCase() === String(productionBatchEditorRow?.uom || productionBatchEditorMaterial?.uom || "").trim().toLowerCase());
  const productionBatchEditorOtherAllocations = form.material_usage.filter((row) => row.id !== productionBatchEditorRowId).flatMap((row) => row.allocations || []);

  function updateActualPackQty(nextPackQty) {
    const nextPlan = packagingProductionPlan(nextPackQty, matchingFinishedGood, matchingRecipe?.uom || form.uom);
    setForm((current) => {
      const outputQty = nextPlan.error ? current.actual_output_qty : nextPlan.target_production_qty;
      const recipeYield = Number(matchingRecipe?.yield_quantity || 1) || 1;
      const nextUsage = matchingRecipe?.items?.length
        ? current.material_usage.map((row) => {
          const recipeItem = matchingRecipe.items.find((item) => item.raw_material_id === row.raw_material_id);
          if (!recipeItem) return row;
          const standardUsage = (Number(recipeItem.quantity_used || 0) * Number(outputQty || 0)) / recipeYield;
          return { ...row, standard_usage: Number(standardUsage.toFixed(4)), actual_usage: row.actual_usage === row.standard_usage ? Number(standardUsage.toFixed(4)) : row.actual_usage };
        })
        : current.material_usage;
      return {
        ...current,
        actual_pack_qty: nextPackQty,
        actual_output_qty: outputQty,
        actual_produced_qty: outputQty,
        good_output_qty: outputQty,
        uom: nextPlan.production_uom || current.uom,
        material_usage: nextUsage,
      };
    });
  }

  if (processOnly) {
    return (
      <Modal
        title="Production Process & QC"
        description={`${job.job_order_no} · ${jobFinishedGoodName(job)}${readOnly ? " · Read-only" : ""}`}
        size="xl"
        onClose={savingQc ? undefined : onClose}
        footer={(
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-text-secondary">
              {qcDirty ? <Badge tone="warning">Unsaved changes</Badge> : lastQcSavedAt ? `Last saved: ${factorySavedTimeLabel(lastQcSavedAt)}` : "All changes saved"}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" type="button" disabled={savingQc} onClick={onClose}>Close</button>
              {!readOnly && execution.snapshotCreatedAt ? <button className="btn-primary" type="button" disabled={savingQc || !qcDirty} onClick={() => saveQcProgress().catch(() => {})}>{savingQc ? "Saving..." : qcDirty ? "Save Changes" : qcSaveFeedback === "saved" ? "Saved ✓" : "Save Process"}</button> : null}
            </div>
          </div>
        )}
      >
        <div className="space-y-4">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="text-sm font-black text-text-primary">{linkedSop?.title || "Production SOP"} · {execution.sopVersion || linkedSop?.version || "—"}</div><div className="mt-1 text-xs font-semibold text-text-secondary">SOP steps are operating instructions. Required QC governs production completion.</div></div>
            <Badge tone={productionQcTone(executionQcState.status)}>{executionQcLabel}</Badge>
          </div>
          {executionLoading ? <div className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-text-secondary">Loading production process...</div> : execution.snapshotCreatedAt ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">QC Completed</div><div className="mt-1 text-lg font-black text-text-primary">{completedQcCount} / {executionQcState.total}</div></div>
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">QC Remaining</div><div className="mt-1 text-lg font-black text-text-primary">{remainingQcCount}</div></div>
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">QC Failed</div><div className={`mt-1 text-lg font-black ${failedQcCount ? "text-rose-700" : "text-text-primary"}`}>{failedQcCount}</div></div>
              </div>
              {execution.steps.length ? <div className="space-y-3">{execution.steps.map((step) => {
                const sopStep = linkedSop?.steps?.find((item) => item.id === step.sop_step_id);
                return (
                  <article key={step.id} className="rounded-xl border border-border bg-white p-4">
                    <div className="flex gap-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-white">{step.step_no}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-base font-black text-text-primary">{step.step_name}</div>{step.description ? <div className="mt-1 max-w-[75ch] text-sm font-semibold text-text-secondary">{step.description}</div> : null}</div>{sopStep?.estimated_time_minutes !== undefined ? <span className="text-xs font-bold text-text-secondary">{sopStep.estimated_time_minutes || 0} mins</span> : null}</div>
                      {step.sub_steps?.length ? <div className="mt-3 space-y-1.5">{step.sub_steps.map((subStep) => <div key={`${step.id}-${subStep.sequence_no}`} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary"><span className="font-black text-primary">{step.step_no}.{subStep.sequence_no}</span><span>{subStep.instruction}</span></div>)}</div> : null}
                      {sopStep?.ingredient_references?.length ? <div className="mt-3"><div className="text-[10.5px] font-bold text-text-muted">Ingredient References</div><div className="mt-1.5 flex flex-wrap gap-1.5">{sopStep.ingredient_references.map((ingredient) => <span key={`${step.id}-${ingredient.raw_material_id}`} className="rounded-full border border-border bg-slate-50 px-2.5 py-1 text-xs font-bold text-text-secondary">{ingredient.raw_material_name}</span>)}</div></div> : null}
                      {step.qc_results?.length ? <div className="mt-4 border-t border-border pt-3"><div className="text-xs font-black text-text-primary">QC Checks</div><div className="mt-2 space-y-2">{step.qc_results.map((qc) => <div key={qc.id} className="rounded-lg bg-slate-50 p-3"><div><div className="text-sm font-bold text-text-primary">{qc.qc_name}{qc.is_required ? <span className="ml-1 text-rose-700">*</span> : null}</div>{qc.instructions ? <div className="mt-0.5 text-xs font-semibold text-text-secondary">{qc.instructions}</div> : null}</div>{qc.qc_type === "checklist" ? <><div className="mt-3 flex flex-wrap gap-2">{[["pass", "Pass"], ["fail", "Fail"], ["na", "N/A"]].map(([value, label]) => <button key={value} className={`rounded-lg border px-3 py-2 text-xs font-bold disabled:cursor-default ${qc.checklist_result === value ? value === "fail" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-primary bg-primary/10 text-primary" : "border-border bg-white text-text-secondary"}`} type="button" disabled={readOnly} onClick={() => updateExecutionQc(step.id, qc.id, { checklist_result: value })}>{label}</button>)}</div>{qc.checklist_result === "na" ? <textarea className={`${inputClass()} mt-2`} rows={2} placeholder="Reason for N/A *" value={qc.remarks || ""} readOnly={readOnly} onChange={(event) => updateExecutionQc(step.id, qc.id, { remarks: event.target.value })} /> : null}</> : <textarea className={`${inputClass()} mt-3`} rows={3} placeholder={qc.is_required ? "Remarks required" : "Add remarks"} value={qc.remarks || ""} readOnly={readOnly} onChange={(event) => updateExecutionQc(step.id, qc.id, { remarks: event.target.value })} />}{!qcDirty && (qc.checked_by_name || qc.checked_by || qc.checked_at) ? <div className="mt-2 text-[10.5px] font-semibold text-text-muted">Checked by {qc.checked_by_name || qc.checked_by || "—"}{qc.checked_at ? ` · Saved at ${factorySavedTimeLabel(qc.checked_at)}` : ""}</div> : null}</div>)}</div></div> : <div className="mt-3 text-xs font-semibold text-text-muted">No QC Required</div>}
                    </div></div>
                  </article>
                );
              })}</div> : <div className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-text-secondary">No SOP steps were linked. Production may continue without QC.</div>}
            </>
          ) : <div className="rounded-xl border border-dashed border-border bg-slate-50 p-4"><div className="text-sm font-bold text-text-primary">No SOP Linked</div><div className="mt-1 text-xs font-semibold text-text-secondary">This production has no SOP or QC execution snapshot.</div></div>}
        </div>
      </Modal>
    );
  }

  return (
    <>
    <Modal
      title="Complete Production"
      description={`${job.job_order_no} · ${job.product_name}`}
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-semibold text-amber-700">{completionDisabledReason}</div>
          <div className="flex justify-end gap-2">
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-production-form" disabled={completionDisabled}>{saving ? "Completing..." : "Complete Production"}</button>
          </div>
        </div>
      )}
    >
      <form id="factory-production-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        {productionBatchAvailability.stale ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"><span>Unable to load the latest Raw Material batch availability. Existing allocations are read-only until refreshed.</span><button className="underline" type="button" onClick={() => setProductionBatchRetryVersion((current) => current + 1)}>Retry</button></div> : null}
        {productionBatchAvailability.error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800"><span>{productionBatchAvailability.error}</span>{productionBatchAvailability.errorKind === "load" ? <button className="underline" type="button" onClick={() => setProductionBatchRetryVersion((current) => current + 1)}>Retry</button> : null}</div> : null}
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="text-sm font-black text-text-primary">Required Completion Details</div><div className="mt-1 text-xs font-semibold text-text-secondary">Complete these fields before confirming production.</div></div>
            <Badge tone={requiredDetailsRemaining ? "warning" : "success"}>{requiredDetailsRemaining ? `${requiredDetailsRemaining} required field${requiredDetailsRemaining === 1 ? "" : "s"} remaining` : "Completion details ready"}</Badge>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
            <Field label="Production End *">
              <div className="grid gap-2 sm:grid-cols-2">
                <FeedXDatePicker
                  value={form.end_date || ""}
                  error={submitAttempted && !endDateValueValid}
                  required
                  onChange={(nextDate) => setForm((current) => ({ ...current, end_date: nextDate }))}
                />
                <input className={`${inputClass(submitAttempted && !endDateTimeValid)} ${endDateTimeValid ? "border-emerald-300 bg-white" : "border-amber-400 bg-white"}`} type="time" value={form.end_time || ""} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} />
              </div>
              {endDateTimeValidationMessage ? <div className="mt-1 text-xs font-semibold text-rose-700">{endDateTimeValidationMessage}</div> : null}
            </Field>
            <Field label="Actual Pack Qty *">
              <div className="relative"><input className={`${inputClass(submitAttempted && !actualPackQtyValid)} ${actualPackQtyValid ? "border-emerald-300 bg-white" : "border-amber-400 bg-white"} pr-16 text-xl font-black`} type="number" min="1" step="1" value={form.actual_pack_qty} onChange={(event) => updateActualPackQty(event.target.value)} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-secondary">packs</span></div>
              {!actualPackQtyValid && form.actual_pack_qty !== "" ? <div className="mt-1 text-xs font-semibold text-rose-700">Enter a whole number greater than 0.</div> : null}
            </Field>
          </div>
          <div className="mt-5 border-t border-amber-200 pt-4">
            <div className="text-sm font-black text-text-primary">Batch & Shelf Life</div>
            <div className="mt-1 text-xs font-semibold text-text-secondary">Expiry is calculated from the Packaging SKU shelf life and saved with this production batch.</div>
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Manufacturing Date">
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">{formatFactoryDate(manufacturingDate)}</div>
              </Field>
              <Field label={shelfLifeConfigured ? "Expiry Date *" : "Expiry Date"}>
                <FeedXDatePicker
                  value={form.expiry_date || ""}
                  error={submitAttempted && !expiryDateValid}
                  required={shelfLifeConfigured}
                  onChange={(nextDate) => {
                    setExpiryManuallyChanged(true);
                    setForm((current) => ({
                      ...current,
                      expiry_date: nextDate,
                      expiry_override_reason: nextDate === calculatedExpiryDate ? "" : current.expiry_override_reason,
                    }));
                  }}
                />
                {expiryOverrideRequired ? <div className="mt-1 text-xs font-semibold text-text-secondary">Calculated expiry: {formatFactoryDate(calculatedExpiryDate)}</div> : null}
                {!shelfLifeConfigured ? <div className="mt-1 text-xs font-semibold text-text-secondary">No Expiry / Not Applicable is allowed.</div> : null}
              </Field>
              <Field label="Storage Location">
                {finishedGoodsLocations.length ? <SearchableSelect value={form.storage_location_id || ""} options={finishedGoodsLocations.map((location) => ({ value: location.id, label: location.location_name }))} placeholder="Select Finished Goods Area" searchPlaceholder="Search finished goods locations" emptyText="No active Finished Goods Area" onChange={(storageLocationId) => setForm((current) => ({ ...current, storage_location_id: storageLocationId }))} /> : null}
                {defaultStorageLocationArchived ? <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">The Packaging SKU default Storage Location, {defaultStorageLocation.location_name}, is archived. Select an active Finished Goods Area.</div> : null}
                {!finishedGoodsLocations.length && !defaultStorageLocationArchived ? <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">No active Finished Goods storage location found.</div> : null}
              </Field>
              <Field label="Shelf Life Applied">
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">{shelfLifeConfigured ? `${matchingFinishedGood.shelf_life_days} days` : "Not configured"}</div>
              </Field>
            </div>
            {expiryOverrideRequired ? (
              <div className="mt-3">
                <Field label="Expiry Override Reason *">
                  <input className={inputClass(submitAttempted && !expiryOverrideValid)} value={form.expiry_override_reason || ""} placeholder="Explain why the calculated expiry was changed" onChange={(event) => setForm((current) => ({ ...current, expiry_override_reason: event.target.value }))} />
                </Field>
              </div>
            ) : null}
            <div className="mt-3">
              <Field label="Batch Remarks">
                <textarea className={inputClass()} rows={2} value={form.notes || ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </Field>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-black text-text-primary">Production QC</div><div className="mt-1 text-xs font-semibold text-text-secondary">{execution.snapshotCreatedAt ? `${executionQcState.requiredCompleted} of ${executionQcState.requiredTotal} required checks complete` : "No QC snapshot is attached to this legacy production."}</div></div>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={productionQcTone(executionQcState.status)}>{executionLoading ? "Loading QC" : executionQcLabel}</Badge><button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={executionLoading} onClick={onViewProcess}>{qcCompletionBlocked ? "Complete QC" : "View QC Details"}</button></div>
          </div>
        </section>
        <div className="rounded-2xl border border-border bg-white p-4">
          <div className="text-sm font-bold text-text-primary">Production Information</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Batch No.">
              <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                <div className={`font-mono text-sm font-black ${form.batch_no || batchNoPreview.value ? "text-text-primary" : "text-text-secondary"}`}>{form.batch_no || batchNoPreview.value || (batchNoPreview.loading ? "Loading preview..." : "—")}</div>
                {!form.batch_no && batchNoPreview.value ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-secondary">Preview only</div> : null}
                {!form.batch_no && batchNoPreview.error ? <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline" type="button" onClick={batchNoPreview.retry}><RefreshCw size={11} /> Retry</button> : null}
              </div>
            </Field>
            <Field label="Production Start">
              <div className={`rounded-xl border px-3 py-2 text-sm font-bold ${authoritativeStartValid ? "border-border bg-slate-50 text-text-primary" : "border-rose-300 bg-rose-50 text-rose-700"}`}>{authoritativeStartValid ? `${formatFactoryDate(authoritativeProductionDate)} ${factoryTimeAmPmLabel(authoritativeStartTime)}` : "Missing on Job Order"}</div>
            </Field>
            <Field label="Operator">
              <input className={inputClass()} value={form.operator_name || ""} readOnly={Boolean(job.started_at)} onChange={(event) => setForm((current) => ({ ...current, operator_name: event.target.value }))} />
            </Field>
            <Field label="Duration">
              <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">{durationLabel}</div>
            </Field>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-sm font-bold text-text-primary">Job Order Summary</div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <MetricCard icon={PackageCheck} label="Finished Good" value={matchingFinishedGood?.product_family_name || matchingFinishedGood?.product_name_en || job.product_name} helper={job.job_order_no} />
            <MetricCard icon={Package} label="Packaging SKU" value={matchingFinishedGood?.product_code || "No SKU"} helper={matchingFinishedGood?.variant_name || packSizeText(matchingFinishedGood) || "Packaging SKU"} />
            <MetricCard icon={ClipboardCheck} label="Target Production Qty" value={quantity(job.target_production_qty || job.target_quantity, job.uom)} helper="Planned output" />
            <MetricCard icon={Factory} label="Estimated Pack Qty" value={quantity(estimatedPackQty, "packs")} helper="Planned stock-in" />
          </div>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="text-sm font-bold text-primary">Actual Packaging Output</div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-primary/20 bg-white px-3 py-3">
              <div className="text-[10.5px] font-semibold text-text-muted">Estimated Pack Qty</div>
              <div className="mt-1 text-lg font-bold text-text-primary">{quantity(estimatedPackQty, "packs")}</div>
            </div>
            <div className="rounded-xl border border-primary/20 bg-white px-3 py-3">
              <div className="text-[10.5px] font-semibold text-text-muted">Difference from Estimate</div>
              <div className={`mt-1 text-lg font-bold ${packDifference > 0 ? "text-amber-700" : packDifference < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatSignedQuantity(packDifference, "packs")}</div>
            </div>
            <div className="rounded-xl border border-primary/20 bg-white px-3 py-3">
              <div className="text-[10.5px] font-semibold text-text-muted">Calculated Output</div>
              <div className="mt-1 text-lg font-bold text-text-primary">{quantity(form.actual_output_qty || form.good_output_qty, form.uom)}</div>
              <div className="mt-1 text-xs font-semibold text-text-secondary">Based on actual packs × pack size</div>
            </div>
          </div>
        </div>
        {matchingRecipe ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-bold text-emerald-800">Production Standard: {matchingRecipe.product_name || finishedGoodLabel(matchingFinishedGood) || job.product_name} {matchingRecipe.version || "v1"}</div>
            <div className="mt-2 grid gap-2 text-sm font-semibold text-emerald-800 md:grid-cols-3">
              <div>Base Recipe Qty: {quantity(matchingRecipe.yield_quantity, matchingRecipe.uom)}</div>
              <div>Current Production Qty: {quantity(currentProductionQty, form.uom)}</div>
              <div>Scale Factor: {scaleFactor ? `${Number(scaleFactor.toFixed(4))}x` : "—"}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            No active recipe found. Manual material usage is allowed for this completion, but create a Production Standard / BOM before future production if possible.
          </div>
        )}
        <Card
          title="Actual Material Usage"
          description={hasRecipeBom ? "Rows are locked to the active Production Standard / BOM. Actual usage is the raw material stock deduction source." : "No active recipe found. Add manual material usage rows for this completion only."}
          action={!hasRecipeBom ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addUsageRow}><Package size={14} /> Add Material</button> : null}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">Raw Material</th>
                  <th className="px-4 py-2.5">Standard</th>
                  <th className="px-4 py-2.5">Actual Used</th>
                  <th className="px-4 py-2.5">Batch Allocation</th>
                  <th className="px-4 py-2.5">Difference</th>
                  <th className="px-4 py-2.5">Reason</th>
                  {!hasRecipeBom ? <th className="px-4 py-2.5 text-right">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {form.material_usage.map((row) => {
                  const material = rawMaterials.find((item) => item.id === row.raw_material_id);
                  const { variance } = varianceFor(row.standard_usage, row.actual_usage);
                  const needsReason = Math.abs(variance) > varianceReasonTolerance;
                  const showReasonError = submitAttempted && needsReason && !String(row.variance_reason || "").trim();
                  const rowUom = row.uom || material?.uom || "";
                  const allocatedQty = (row.allocations || []).reduce((sum, allocation) => sum + Number(allocation.allocated_qty || 0), 0);
                  const allocationComplete = Math.abs(allocatedQty - Number(row.actual_usage || 0)) <= varianceReasonTolerance;
                  return (
                    <tr key={row.id} className={`border-b border-border last:border-0 ${showReasonError ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-3">
                        {hasRecipeBom ? (
                          <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">
                            {material ? rawMaterialLabel(material) : "Raw material"}
                          </div>
                        ) : (
                          <select
                            className={inputClass(submitAttempted && !row.raw_material_id)}
                            value={row.raw_material_id}
                            onChange={(event) => {
                              const nextMaterial = rawMaterials.find((item) => item.id === event.target.value);
                              updateUsageRow(row.id, { raw_material_id: event.target.value, raw_material_receiving_id: "", raw_material_lot_no: "", uom: nextMaterial?.uom || row.uom });
                            }}
                          >
                            <option value="">Select material</option>
                            {rawMaterials.filter((item) => item.status === "active" || item.id === row.raw_material_id).map((item) => (
                              <option key={item.id} value={item.id}>{rawMaterialLabel(item)}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex min-h-[38px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">{quantity(row.standard_usage, rowUom)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative">
                          <input className={`${inputClass()} pr-14 font-bold`} type="number" min="0" step="0.0001" value={row.actual_usage} onChange={(event) => updateUsageRow(row.id, { actual_usage: event.target.value })} />
                          {rowUom ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-secondary">{rowUom}</span> : null}
                        </div>
                      </td>
                      <td className="min-w-[220px] px-4 py-3">
                        <div className={`rounded-lg border px-3 py-2 ${allocationComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                          <div className={`text-xs font-bold ${allocationComplete ? "text-emerald-800" : "text-amber-900"}`}>Allocated {quantity(allocatedQty, rowUom)} of {quantity(row.actual_usage, rowUom)}</div>
                          <button className="mt-1 text-xs font-bold text-primary underline decoration-dotted underline-offset-4 disabled:cursor-not-allowed disabled:text-text-muted" type="button" disabled={!row.raw_material_id || productionBatchAvailability.loading || productionBatchAvailability.errorKind === "permission"} onClick={() => setProductionBatchEditorRowId(row.id)}>{row.allocations?.length ? "Edit Allocation" : "Auto Allocate FEFO"}</button>
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold ${variance > 0 ? "text-amber-600" : variance < 0 ? "text-emerald-600" : "text-text-secondary"}`}>
                        {formatSignedQuantity(variance, rowUom)}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showReasonError)}
                          placeholder={needsReason ? "Required if different" : "Optional"}
                          value={row.variance_reason || ""}
                          onChange={(event) => updateUsageRow(row.id, { variance_reason: event.target.value })}
                        />
                        {showReasonError ? <div className="mt-1 text-xs font-semibold text-amber-700">Required when actual differs from standard.</div> : null}
                      </td>
                      {!hasRecipeBom ? (
                        <td className="px-4 py-3 text-right">
                          <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => removeUsageRow(row.id)}>Remove</button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!form.material_usage.length ? (
            <EmptyState title="No material usage rows" description="Add raw material usage before completing production." />
          ) : null}
        </Card>
        <Card title="Production Summary" description="Review before confirming completion.">
          <div className="grid gap-3 text-sm font-semibold text-text-secondary md:grid-cols-2">
            {[
              ["Finished Good", matchingFinishedGood?.product_family_name || matchingFinishedGood?.product_name_en || job.product_name],
              ["Packaging SKU", `${matchingFinishedGood?.product_code || "No SKU"} · ${matchingFinishedGood?.variant_name || packSizeText(matchingFinishedGood) || "Packaging SKU"}`],
              ["Target Production", quantity(job.target_production_qty || job.target_quantity, job.uom)],
              ["Actual Output", quantity(form.actual_output_qty || form.good_output_qty, form.uom)],
              ["Estimated Packs", quantity(job.target_pack_qty || job.target_quantity, "packs")],
              ["Actual Packs", quantity(form.actual_pack_qty, "packs")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
                <div className="mt-1 font-bold text-text-primary">{value}</div>
              </div>
            ))}
          </div>
        </Card>
      </form>
    </Modal>
    {productionBatchEditorRow && productionBatchEditorMaterial ? <RawMaterialBatchAllocationModal
      row={productionBatchEditorRow}
      material={productionBatchEditorMaterial}
      batches={productionBatchEditorRows}
      otherAllocations={productionBatchEditorOtherAllocations}
      loading={productionBatchAvailability.loading}
      stale={productionBatchAvailability.stale}
      error={productionBatchAvailability.error}
      onRetry={() => setProductionBatchRetryVersion((current) => current + 1)}
      onClose={() => setProductionBatchEditorRowId("")}
      onApply={(allocations) => {
        setForm((current) => ({ ...current, material_usage: current.material_usage.map((usage) => usage.id === productionBatchEditorRow.id ? { ...usage, allocations, allocation_shortage: 0 } : usage) }));
        setProductionBatchEditorRowId("");
      }}
    /> : null}
    </>
  );
}

function emptySopQcCheck(index = 0) {
  return {
    id: `qc-${Date.now()}-${index}`,
    sequence_no: index + 1,
    qc_type: "checklist",
    checklist_template_id: "",
    qc_name: "",
    instructions: "",
    is_required: true,
    legacy_custom: false,
  };
}

function persistedSopStructureId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function emptySopStep(index = 0) {
  return {
    id: `step-${Date.now()}-${index}`,
    step_no: index + 1,
    step_name: "",
    description: "",
    estimated_time_minutes: "",
    ingredient_material_ids: [],
    qc_checks: [],
    remarks: "",
    sub_steps: [],
  };
}

function SopIngredientPicker({ ingredients = [], value = [], disabled = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef(null);
  const selectedIds = new Set(value || []);
  const selectedIngredients = ingredients.filter((item) => selectedIds.has(item.raw_material_id));
  const visibleIngredients = ingredients.filter((item) => `${item.raw_material_name || ""} ${item.uom || ""}`.toLowerCase().includes(query.toLowerCase()));

  function toggleIngredient(rawMaterialId) {
    const next = new Set(value || []);
    if (next.has(rawMaterialId)) next.delete(rawMaterialId);
    else next.add(rawMaterialId);
    onChange([...next]);
  }

  return (
    <div>
      <button ref={anchorRef} className={`${inputClass()} min-h-[42px] text-left disabled:cursor-not-allowed disabled:opacity-70`} type="button" disabled={disabled || !ingredients.length} onClick={() => setOpen((current) => !current)}>
        {selectedIngredients.length ? <span className="flex flex-wrap gap-1.5">{selectedIngredients.map((item) => <span key={item.raw_material_id} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{item.raw_material_name}</span>)}</span> : <span className="text-text-muted">{ingredients.length ? "Select recipe ingredients" : "No recipe ingredients"}</span>}
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" minWidth={300} estimatedHeight={340} maxHeight={380}>
        <input className={inputClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipe ingredients" autoFocus />
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {visibleIngredients.length ? visibleIngredients.map((item) => (
            <label key={item.raw_material_id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-primary/10">
              <input type="checkbox" checked={selectedIds.has(item.raw_material_id)} onChange={() => toggleIngredient(item.raw_material_id)} />
              <span className="min-w-0"><span className="block text-sm font-bold text-text-primary">{item.raw_material_name}</span><span className="block text-xs text-text-secondary">{quantity(item.quantity_used, item.uom)}</span></span>
            </label>
          )) : <div className="px-3 py-4 text-sm font-semibold text-text-secondary">No matching ingredients</div>}
        </div>
      </FloatingLayer>
    </div>
  );
}

function ProductionSopBuilderModal({ initialValue, productFamilies = [], recipes = [], sops = [], qcChecklistTemplates = [], onClose, onSave }) {
  const isEdit = Boolean(initialValue?.id);
  const activeQcTemplates = qcChecklistTemplates.filter((template) => template.is_active !== false);
  const activeQcTemplateIds = new Set(activeQcTemplates.map((template) => template.id));
  const initialSteps = initialValue?.steps?.length
    ? initialValue.steps.map((step, index) => ({
        ...emptySopStep(index),
        ...step,
        id: step.id || `step-${Date.now()}-${index}`,
        step_no: index + 1,
        ingredient_material_ids: step.ingredient_material_ids || [],
        sub_steps: (step.sub_steps || []).map((subStep, subIndex) => ({ ...subStep, id: subStep.id || `sub-${Date.now()}-${index}-${subIndex}`, sequence_no: subIndex + 1 })),
        qc_checks: step.qc_checks?.length
          ? step.qc_checks.map((qc, qcIndex) => ({
              ...emptySopQcCheck(qcIndex),
              ...qc,
              id: qc.id || `qc-${Date.now()}-${index}-${qcIndex}`,
              sequence_no: qcIndex + 1,
              checklist_template_id: activeQcTemplateIds.has(qc.checklist_template_id) ? qc.checklist_template_id : "",
              legacy_custom: !activeQcTemplateIds.has(qc.checklist_template_id) && Boolean(qc.qc_name),
            }))
          : (step.qc_required || step.is_qc_checkpoint)
            ? [{ ...emptySopQcCheck(0), qc_name: step.qc_label || step.control_point || "QC Check", instructions: step.qc_target_value || "", legacy_custom: true }]
            : [],
      }))
    : [emptySopStep(0)];
  const productOptions = productFamilies
    .filter((family) => family.status === "active" || family.id === initialValue?.finished_good_id)
    .map((family) => ({ value: family.id, label: family.name_en, helper: family.name_cn || family.category || "Finished Good" }));
  const [form, setForm] = useState(() => ({
    sop_code: "",
    finished_good_id: "",
    product_name: "",
    recipe_id: "",
    recipe_version: "",
    version: "v1",
    effective_date: todayInput(),
    remarks: "",
    ...initialValue,
    title: initialValue?.title || initialValue?.sop_name || "",
    sop_name: initialValue?.sop_name || initialValue?.title || "",
    status: initialValue?.status || "draft",
    steps: initialSteps,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isLocked = isEdit && form.status !== "draft";
  const activeRecipe = useMemo(() => recipes.find((recipe) => recipe.product_family_id === form.finished_good_id && recipe.status === "active") || null, [recipes, form.finished_good_id]);
  const recipeReference = useMemo(() => {
    if (!form.recipe_id) return null;
    return recipes.find((recipe) => recipe.id === form.recipe_id) || (initialValue?.linked_recipe?.id === form.recipe_id ? initialValue.linked_recipe : null);
  }, [form.recipe_id, recipes, initialValue]);
  const recipeIngredients = recipeReference?.items || [];
  const recipeIngredientIds = new Set(recipeIngredients.map((item) => item.raw_material_id));
  const calculatedMinutes = form.steps.reduce((sum, step) => sum + sopStepEstimatedMinutes(step), 0);
  const qcPresetOptions = activeQcTemplates.map((template) => ({ value: template.id, label: template.name }));

  function nextVersionForFinishedGood(finishedGoodId) {
    const maxVersion = sops.filter((sop) => sop.finished_good_id === finishedGoodId).reduce((max, sop) => Math.max(max, Number(String(sop.version || "").replace(/\D/g, "")) || 0), 0);
    return `v${maxVersion + 1}`;
  }

  const resequenceSteps = (steps) => steps.map((step, index) => ({ ...step, step_no: index + 1 }));

  function updateStep(rowId, patch) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => (step.id === rowId ? { ...step, ...patch } : step)) }));
  }

  function addStep() {
    setForm((current) => ({ ...current, steps: [...current.steps, emptySopStep(current.steps.length)] }));
  }

  function removeStep(rowId) {
    setForm((current) => ({ ...current, steps: resequenceSteps(current.steps.filter((step) => step.id !== rowId)) }));
  }

  function moveStep(rowId, direction) {
    setForm((current) => {
      const index = current.steps.findIndex((step) => step.id === rowId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps: resequenceSteps(steps) };
    });
  }

  function duplicateStep(rowId) {
    setForm((current) => {
      const index = current.steps.findIndex((step) => step.id === rowId);
      if (index < 0) return current;
      const source = current.steps[index];
      const duplicate = {
        ...source,
        id: `step-${Date.now()}-${index}`,
        sub_steps: (source.sub_steps || []).map((subStep, subIndex) => ({ ...subStep, id: `sub-${Date.now()}-${index}-${subIndex}` })),
        qc_checks: (source.qc_checks || []).map((qc, qcIndex) => ({ ...qc, id: `qc-${Date.now()}-${index}-${qcIndex}` })),
      };
      const steps = [...current.steps];
      steps.splice(index + 1, 0, duplicate);
      return { ...current, steps: resequenceSteps(steps) };
    });
  }

  function addSubStep(stepId) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, sub_steps: [...(step.sub_steps || []), { id: `sub-${Date.now()}-${step.sub_steps?.length || 0}`, sequence_no: (step.sub_steps?.length || 0) + 1, instruction: "", estimated_minutes: "", remarks: "" }] } : step),
    }));
  }

  function updateSubStep(stepId, subStepId, patch) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, sub_steps: (step.sub_steps || []).map((subStep) => subStep.id === subStepId ? { ...subStep, ...patch } : subStep) } : step) }));
  }

  function removeSubStep(stepId, subStepId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, sub_steps: (step.sub_steps || []).filter((subStep) => subStep.id !== subStepId).map((subStep, index) => ({ ...subStep, sequence_no: index + 1 })) } : step) }));
  }

  function updateQcCheck(stepId, qcId, patch) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_checks: (step.qc_checks || []).map((qc) => qc.id === qcId ? { ...qc, ...patch } : qc) } : step) }));
  }

  function addQcCheck(stepId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_checks: [...(step.qc_checks || []), emptySopQcCheck(step.qc_checks?.length || 0)] } : step) }));
  }

  function removeQcCheck(stepId, qcId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_checks: (step.qc_checks || []).filter((qc) => qc.id !== qcId).map((qc, index) => ({ ...qc, sequence_no: index + 1 })) } : step) }));
  }

  function moveQcCheck(stepId, qcId, direction) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => {
      if (step.id !== stepId) return step;
      const checks = [...(step.qc_checks || [])];
      const index = checks.findIndex((qc) => qc.id === qcId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= checks.length) return step;
      [checks[index], checks[target]] = [checks[target], checks[index]];
      return { ...step, qc_checks: checks.map((qc, qcIndex) => ({ ...qc, sequence_no: qcIndex + 1 })) };
    }) }));
  }

  function duplicateQcCheck(stepId, qcId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => {
      if (step.id !== stepId) return step;
      const checks = [...(step.qc_checks || [])];
      const index = checks.findIndex((qc) => qc.id === qcId);
      if (index < 0) return step;
      checks.splice(index + 1, 0, { ...checks[index], id: `qc-${Date.now()}-${index}` });
      return { ...step, qc_checks: checks.map((qc, qcIndex) => ({ ...qc, sequence_no: qcIndex + 1 })) };
    }) }));
  }

  function selectQcPreset(stepId, qcId, templateId) {
    const template = activeQcTemplates.find((item) => item.id === templateId);
    if (!template) return;
    updateQcCheck(stepId, qcId, {
      checklist_template_id: template.id,
      qc_name: template.name,
      qc_type: template.result_mode || "checklist",
      instructions: template.description || "",
      legacy_custom: false,
    });
  }

  function selectFinishedGood(finishedGoodId) {
    const product = productFamilies.find((family) => family.id === finishedGoodId);
    const nextRecipe = recipes.find((recipe) => recipe.product_family_id === finishedGoodId && recipe.status === "active") || null;
    setForm((current) => ({ ...current, finished_good_id: finishedGoodId, product_name: product?.name_en || "", version: isEdit ? current.version : nextVersionForFinishedGood(finishedGoodId), recipe_id: nextRecipe?.id || "", recipe_version: nextRecipe?.version || "", steps: current.steps.map((step) => ({ ...step, ingredient_material_ids: [] })) }));
  }

  function linkActiveRecipe() {
    if (!activeRecipe) return;
    setForm((current) => ({ ...current, recipe_id: activeRecipe.id, recipe_version: activeRecipe.version || "", steps: current.steps.map((step) => ({ ...step, ingredient_material_ids: [] })) }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isLocked) return setError("Only draft SOPs can be edited.");
    if (!form.finished_good_id) return setError("Finished Good is required.");
    if (!form.steps.length) return setError("At least one SOP step is required.");
    for (let index = 0; index < form.steps.length; index += 1) {
      const step = form.steps[index];
      if (!String(step.step_name || step.process_name || "").trim()) return setError(`Step ${index + 1} requires a Step Name.`);
      if (!(step.sub_steps || []).length && !validSopMinutes(step.estimated_time_minutes)) return setError(`Step ${index + 1} minutes must be a non-negative whole number.`);
      const invalidQc = (step.qc_checks || []).findIndex((qc) => !["checklist", "remarks"].includes(qc.qc_type) || !String(qc.qc_name || "").trim() || (!qc.checklist_template_id && !persistedSopStructureId(qc.id)));
      if (invalidQc >= 0) return setError(`Step ${index + 1} QC ${invalidQc + 1} requires a QC Check preset.`);
      const emptySubStep = (step.sub_steps || []).findIndex((subStep) => !String(subStep.instruction || "").trim());
      if (emptySubStep >= 0) return setError(`Sub-step ${index + 1}.${emptySubStep + 1} requires an instruction.`);
      const invalidSubStepMinutes = (step.sub_steps || []).findIndex((subStep) => !validSopMinutes(subStep.estimated_minutes));
      if (invalidSubStepMinutes >= 0) return setError(`Sub-step ${index + 1}.${invalidSubStepMinutes + 1} minutes must be a non-negative whole number.`);
      if ((step.ingredient_material_ids || []).some((materialId) => !recipeIngredientIds.has(materialId))) return setError(`Step ${index + 1} contains an ingredient outside the linked Product Recipe.`);
    }
    const product = productFamilies.find((family) => family.id === form.finished_good_id);
    const productName = product?.name_en || form.product_name || "Finished Good";
    const sopName = `${productName} Production SOP · ${form.version || "v1"}`;
    setSaving(true);
    try {
      await onSave({ ...form, title: sopName, sop_name: sopName, product_name: productName, estimated_minutes: calculatedMinutes });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Production SOP" : "Create Production SOP"} description="Build the production process. Ingredient quantities and costing remain controlled by Product Recipes / BOM." size="2xl" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>{!isLocked ? <button className="btn-primary" type="submit" form="factory-sop-builder-form" disabled={saving}>{saving ? "Saving..." : "Save SOP"}</button> : null}</>}>
      <form id="factory-sop-builder-form" className="space-y-6" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <section>
          <div className="mb-3 text-sm font-black text-text-primary">SOP Header</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Finished Good *"><SearchableSelect value={form.finished_good_id || ""} options={productOptions} placeholder="Select Finished Good" searchPlaceholder="Search finished goods" emptyText="No finished goods" disabled={isLocked} onChange={selectFinishedGood} /></Field>
            <Field label="Version"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">{form.version || "v1"}</div></Field>
            <Field label="Estimated Time"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><div className="text-sm font-bold text-text-primary">{sopMinutesLabel(calculatedMinutes)}</div><div className="text-[10.5px] font-semibold text-text-muted">Calculated from process steps</div></div></Field>
            <Field label="Effective Date"><FeedXDatePicker value={form.effective_date || ""} disabled={isLocked} onChange={(nextDate) => setForm((current) => ({ ...current, effective_date: nextDate }))} /></Field>
            <Field label="Status"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><Badge tone={form.status === "active" ? "success" : form.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(form.status)}</Badge></div></Field>
          </div>
          <div className="mt-3"><Field label="Remarks"><textarea className={inputClass()} rows={2} value={form.remarks || form.notes || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value, notes: event.target.value }))} /></Field></div>
        </section>

        <section className="border-y border-border bg-slate-50 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-black text-text-primary">Recipe Reference</div><div className="mt-1 text-xs font-semibold text-text-secondary">Read-only ingredient reference pinned to this SOP version.</div></div>{!recipeReference && isEdit && activeRecipe && !isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={linkActiveRecipe}>Link Active Recipe</button> : null}</div>
          {recipeReference ? <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3"><div><div className="text-[10.5px] font-semibold text-text-muted">Active Recipe</div><div className="mt-1 text-sm font-bold text-text-primary">{recipeReference.version || form.recipe_version || "—"}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Standard Output</div><div className="mt-1 text-sm font-bold text-text-primary">{quantity(recipeReference.yield_quantity, recipeReference.uom)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Ingredients</div><div className="mt-1 text-sm font-bold text-text-primary">{recipeIngredients.length}</div></div></div>
            <div className="hidden overflow-hidden rounded-xl border border-border bg-white sm:block"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border bg-slate-50 text-xs font-semibold text-text-secondary"><th className="px-3 py-2">Ingredient</th><th className="px-3 py-2">Recipe Qty</th><th className="px-3 py-2">UOM</th><th className="px-3 py-2">Wastage</th></tr></thead><tbody>{recipeIngredients.map((item) => <tr key={item.id || item.raw_material_id} className="border-b border-border last:border-0"><td className="px-3 py-2 font-bold text-text-primary">{item.raw_material_name || "Raw Material"}</td><td className="px-3 py-2">{Number(item.quantity_used || 0).toLocaleString("en-MY", { maximumFractionDigits: 4 })}</td><td className="px-3 py-2">{item.uom || "—"}</td><td className="px-3 py-2">{percent(item.wastage_percent)}</td></tr>)}</tbody></table></div>
            <div className="space-y-2 sm:hidden">{recipeIngredients.map((item) => <div key={item.id || item.raw_material_id} className="rounded-xl border border-border bg-white p-3"><div className="font-bold text-text-primary">{item.raw_material_name || "Raw Material"}</div><div className="mt-1 text-xs font-semibold text-text-secondary">{quantity(item.quantity_used, item.uom)} · Wastage {percent(item.wastage_percent)}</div></div>)}</div>
          </div> : <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><div className="text-sm font-bold text-amber-900">No Active Recipe</div><div className="mt-1 text-xs font-semibold text-amber-800">Activate a Product Recipe before using ingredient references in this SOP.</div></div>}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black text-text-primary">SOP Steps</div><div className="mt-1 text-xs font-semibold text-text-secondary">Steps re-sequence automatically after moving or removing.</div></div>{!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addStep}><Plus size={14} /> Add Step</button> : null}</div>
          <div className="space-y-4">{form.steps.map((step, index) => {
            const hasSubSteps = Boolean(step.sub_steps?.length);
            const stepMinutes = sopStepEstimatedMinutes(step);
            return <article key={step.id} className="rounded-xl border border-border bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-black text-white">{index + 1}</span><div><div className="text-sm font-black text-text-primary">Step {index + 1}</div><div className="text-xs font-semibold text-text-secondary">{step.step_name || "Unnamed process step"}</div></div></div>{!isLocked ? <div className="flex flex-wrap gap-1"><button className="icon-btn" title="Move step up" type="button" disabled={index === 0} onClick={() => moveStep(step.id, -1)}><ArrowUp size={15} /></button><button className="icon-btn" title="Move step down" type="button" disabled={index === form.steps.length - 1} onClick={() => moveStep(step.id, 1)}><ArrowDown size={15} /></button><button className="icon-btn" title="Duplicate step" type="button" onClick={() => duplicateStep(step.id)}><Copy size={15} /></button><button className="icon-btn text-rose-600" title="Remove step" type="button" disabled={form.steps.length === 1} onClick={() => removeStep(step.id)}><Trash2 size={15} /></button></div> : null}</div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]"><Field label="Step Name *"><input className={inputClass()} value={step.step_name || step.process_name || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { step_name: event.target.value, process_name: event.target.value })} /></Field><Field label="Estimated Minutes"><input className={inputClass()} type="number" min="0" step="1" value={hasSubSteps ? stepMinutes : step.estimated_time_minutes ?? ""} disabled={isLocked || hasSubSteps} onChange={(event) => updateStep(step.id, { estimated_time_minutes: event.target.value })} />{hasSubSteps ? <div className="mt-1 text-[10.5px] font-semibold text-text-muted">Calculated from sub-steps</div> : null}</Field></div>
              <div className="mt-3"><Field label="Description"><textarea className={inputClass()} rows={3} value={step.description || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { description: event.target.value })} /></Field></div>
              <div className="mt-3"><Field label="Ingredient References"><SopIngredientPicker ingredients={recipeIngredients} value={step.ingredient_material_ids || []} disabled={isLocked || !recipeReference} onChange={(ingredientMaterialIds) => updateStep(step.id, { ingredient_material_ids: ingredientMaterialIds })} /></Field><div className="mt-1 text-[10.5px] font-semibold text-text-muted">Reference only. Recipe quantities, costing and stock movements are unchanged.</div></div>
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black text-text-primary">QC Checks</div><div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">The selected QC preset determines the Production input.</div></div>{!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => addQcCheck(step.id)}><Plus size={13} /> Add QC Check</button> : null}</div>
                {step.qc_checks?.length ? <div className="mt-3 space-y-3">{step.qc_checks.map((qc, qcIndex) => (
                  <div key={qc.id} className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-black text-primary">QC {qcIndex + 1}</div>{!isLocked ? <div className="flex gap-1"><button className="icon-btn" title="Move QC up" type="button" disabled={qcIndex === 0} onClick={() => moveQcCheck(step.id, qc.id, -1)}><ArrowUp size={14} /></button><button className="icon-btn" title="Move QC down" type="button" disabled={qcIndex === step.qc_checks.length - 1} onClick={() => moveQcCheck(step.id, qc.id, 1)}><ArrowDown size={14} /></button><button className="icon-btn" title="Duplicate QC" type="button" onClick={() => duplicateQcCheck(step.id, qc.id)}><Copy size={14} /></button><button className="icon-btn text-rose-600" title="Remove QC" type="button" onClick={() => removeQcCheck(step.id, qc.id)}><Trash2 size={14} /></button></div> : null}</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="QC Check *"><SearchableSelect value={qc.checklist_template_id || (qc.legacy_custom ? `legacy-${qc.id}` : "")} options={qc.legacy_custom ? [{ value: `legacy-${qc.id}`, label: `${qc.qc_name} (Custom / Legacy QC)` }, ...qcPresetOptions] : qcPresetOptions} placeholder="Select QC Check" searchPlaceholder="Search QC checks" emptyText="No active QC presets" disabled={isLocked} onChange={(value) => selectQcPreset(step.id, qc.id, value)} /></Field><Field label="Instructions"><textarea className={inputClass()} rows={2} value={qc.instructions || ""} disabled={isLocked} onChange={(event) => updateQcCheck(step.id, qc.id, { instructions: event.target.value })} /></Field></div>
                    <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-text-secondary"><input type="checkbox" checked={qc.is_required !== false} disabled={isLocked} onChange={(event) => updateQcCheck(step.id, qc.id, { is_required: event.target.checked })} /> Required before production completion</label>
                  </div>
                ))}</div> : <div className="mt-3 text-xs font-semibold text-text-muted">No QC checks for this step.</div>}
              </div>
              <div className="mt-4 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="text-xs font-black text-text-primary">Sub-steps</div>{!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => addSubStep(step.id)}><Plus size={13} /> Add Sub-step</button> : null}</div>{step.sub_steps?.length ? <div className="mt-3 space-y-2">{step.sub_steps.map((subStep, subIndex) => <div key={subStep.id} className="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-[48px_minmax(0,1fr)_140px_minmax(0,0.7fr)_36px]"><div className="pt-2 text-sm font-black text-primary">{index + 1}.{subIndex + 1}</div><input className={inputClass()} placeholder="Instruction *" value={subStep.instruction || ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { instruction: event.target.value })} /><input className={inputClass()} type="number" min="0" step="1" placeholder="Minutes" value={subStep.estimated_minutes ?? ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { estimated_minutes: event.target.value })} /><input className={inputClass()} placeholder="Remarks" value={subStep.remarks || ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { remarks: event.target.value })} />{!isLocked ? <button className="icon-btn text-rose-600" title="Remove sub-step" type="button" onClick={() => removeSubStep(step.id, subStep.id)}><Trash2 size={14} /></button> : null}</div>)}</div> : <div className="mt-3 text-xs font-semibold text-text-muted">No sub-steps added.</div>}</div>
              <div className="mt-4"><Field label="Step Remarks"><textarea className={inputClass()} rows={2} value={step.remarks || step.safety_note || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { remarks: event.target.value, safety_note: event.target.value })} /></Field></div>
            </article>;
          })}</div>
        </section>
      </form>
    </Modal>
  );
}

function ProductionSopModal({ initialValue, productFamilies = [], onClose, onSave }) {
  const isEdit = Boolean(initialValue?.id);
  const activeProductFamilies = productFamilies.filter((family) => String(family.status || "active").toLowerCase() === "active" || family.id === initialValue?.finished_good_id);
  const productOptions = activeProductFamilies.map((family) => ({ value: family.id, label: family.name_en, helper: family.name_cn || family.category || "Finished Good" }));
  const [form, setForm] = useState(() => ({
    sop_code: "",
    finished_good_id: "",
    product_name: "",
    version: "v1",
    effective_date: todayInput(),
    estimated_minutes: "",
    remarks: "",
    steps: [
      {
        id: "step-1",
        step_no: 1,
        step_name: "",
        description: "",
        estimated_time_minutes: "",
        qc_required: false,
        qc_label: "",
        remarks: "",
      },
    ],
    ...initialValue,
    title: initialValue?.title || initialValue?.sop_name || "",
    sop_name: initialValue?.sop_name || initialValue?.title || "",
    status: initialValue?.status || "draft",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isLocked = isEdit && form.status !== "draft";

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
          step_name: "",
          description: "",
          estimated_time_minutes: "",
          qc_required: false,
          qc_label: "",
          remarks: "",
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
    if (isLocked) {
      setError("Only draft SOPs can be edited.");
      return;
    }
    if (!String(form.finished_good_id || "").trim()) {
      setError("Finished Good is required.");
      return;
    }
    if (!form.steps.some((step) => String(step.step_name || step.process_name || step.description || "").trim())) {
      setError("At least one SOP step is required.");
      return;
    }
    const product = productFamilies.find((family) => family.id === form.finished_good_id);
    const productName = product?.name_en || form.product_name || "Finished Good";
    const sopName = `${productName} Production SOP · ${form.version || "v1"}`;
    setSaving(true);
    try {
      await onSave({
        ...form,
        title: sopName,
        sop_name: sopName,
        product_name: productName,
        steps: form.steps.map((step) => ({
          ...step,
          process_name: step.step_name || step.process_name,
          is_qc_checkpoint: step.qc_required,
          control_point: step.qc_label,
          safety_note: step.remarks,
        })),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Production SOP" : "Create Production SOP"}
      description="SOP defines how to make a finished good. BOM and costing stay in Product Recipes."
      size="2xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          {!isLocked ? <button className="btn-primary" type="submit" form="factory-sop-form" disabled={saving}>{saving ? "Saving..." : "Save SOP"}</button> : null}
        </>
      )}
    >
      <form id="factory-sop-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <Card title="SOP Header">
          <div className="grid gap-3 md:grid-cols-3">
          <Field label="Finished Good">
            <SearchableSelect
              value={form.finished_good_id || ""}
              options={productOptions}
              placeholder="Select Finished Good"
              searchPlaceholder="Search finished goods"
              emptyText="No finished goods"
              disabled={isLocked}
              onChange={(finishedGoodId) => {
                const product = productFamilies.find((family) => family.id === finishedGoodId);
                setForm((current) => ({ ...current, finished_good_id: finishedGoodId, product_name: product?.name_en || "" }));
              }}
            />
          </Field>
          <Field label="Version">
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">{form.version || "v1"}</div>
          </Field>
          <Field label="Estimated Minutes">
            <input className={inputClass()} type="number" min="0" value={form.estimated_minutes || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, estimated_minutes: event.target.value }))} />
          </Field>
          <Field label="Effective Date">
            <FeedXDatePicker
              value={form.effective_date || ""}
              disabled={isLocked}
              onChange={(nextDate) => setForm((current) => ({ ...current, effective_date: nextDate }))}
            />
          </Field>
          <Field label="Status">
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><Badge tone={form.status === "active" ? "success" : form.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(form.status)}</Badge></div>
          </Field>
          </div>
          <div className="mt-3">
            <Field label="Remarks">
              <textarea className={inputClass()} rows={2} value={form.remarks || form.notes || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value, notes: event.target.value }))} />
            </Field>
          </div>
        </Card>
        <Card
          title="SOP Steps"
          action={!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addStep}><FileText size={14} /> Add Step</button> : null}
        >
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">Step</th>
                  <th className="px-4 py-2.5">Step Name</th>
                  <th className="px-4 py-2.5">Description</th>
                  <th className="px-4 py-2.5">Est. Time</th>
                  <th className="px-4 py-2.5">QC</th>
                  <th className="px-4 py-2.5">QC Label</th>
                  <th className="px-4 py-2.5">Remarks</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.steps.map((step) => (
                  <tr key={step.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3"><input className={inputClass()} type="number" min="1" value={step.step_no} disabled={isLocked} onChange={(event) => updateStep(step.id, { step_no: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.step_name || step.process_name || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { step_name: event.target.value, process_name: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.description || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { description: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} type="number" min="0" value={step.estimated_time_minutes || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { estimated_time_minutes: event.target.value })} /></td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-secondary">
                        <input type="checkbox" checked={Boolean(step.qc_required ?? step.is_qc_checkpoint)} disabled={isLocked} onChange={(event) => updateStep(step.id, { qc_required: event.target.checked, is_qc_checkpoint: event.target.checked })} />
                        Required
                      </label>
                    </td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.qc_label || step.control_point || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { qc_label: event.target.value, control_point: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.remarks || step.safety_note || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { remarks: event.target.value, safety_note: event.target.value })} /></td>
                    <td className="px-4 py-3 text-right">{!isLocked ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => removeStep(step.id)}>Remove</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 lg:hidden">
            {form.steps.map((step) => (
              <div key={step.id} className="rounded-xl border border-border bg-white p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Step No"><input className={inputClass()} type="number" min="1" value={step.step_no} disabled={isLocked} onChange={(event) => updateStep(step.id, { step_no: event.target.value })} /></Field>
                  <Field label="Step Name"><input className={inputClass()} value={step.step_name || step.process_name || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { step_name: event.target.value, process_name: event.target.value })} /></Field>
                  <Field label="Description"><textarea className={inputClass()} rows={2} value={step.description || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { description: event.target.value })} /></Field>
                  <Field label="Estimated Minutes"><input className={inputClass()} type="number" min="0" value={step.estimated_time_minutes || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { estimated_time_minutes: event.target.value })} /></Field>
                  <Field label="QC Label"><input className={inputClass()} value={step.qc_label || step.control_point || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { qc_label: event.target.value, control_point: event.target.value })} /></Field>
                  <Field label="Remarks"><input className={inputClass()} value={step.remarks || step.safety_note || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { remarks: event.target.value, safety_note: event.target.value })} /></Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-secondary">
                    <input type="checkbox" checked={Boolean(step.qc_required ?? step.is_qc_checkpoint)} disabled={isLocked} onChange={(event) => updateStep(step.id, { qc_required: event.target.checked, is_qc_checkpoint: event.target.checked })} />
                    QC Required
                  </label>
                  {!isLocked ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => removeStep(step.id)}>Remove</button> : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </form>
    </Modal>
  );
}

function ProductionSopDetailModal({ sop, onClose }) {
  const steps = [...(sop.steps || [])].sort((a, b) => Number(a.step_no || 0) - Number(b.step_no || 0));
  const qcCount = steps.filter((step) => step.qc_required || step.is_qc_checkpoint).length;
  return (
    <Modal
      title={productionSopDisplayName(sop)}
      description="Read-only standard process reference"
      size="2xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">Production SOP</div>
              <div className="mt-1 text-2xl font-black text-text-primary">{productionSopDisplayName(sop)}</div>
              <div className="mt-1 text-sm font-semibold text-text-secondary">{sop.product_name || "No Finished Good"} {sop.product_name_cn ? `· ${sop.product_name_cn}` : ""}</div>
            </div>
            <Badge tone={sop.status === "active" ? "success" : sop.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(sop.status)}</Badge>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              ["Version", sop.version || "v1"],
              ["Estimated Time", productionTimeLabel(sop.estimated_minutes)],
              ["Effective Date", formatFactoryDate(sop.effective_date)],
              ["Steps", Number(steps.length || 0).toLocaleString("en-MY")],
              ["QC Points", Number(qcCount || 0).toLocaleString("en-MY")],
              ["Updated", formatFactoryDate(sop.updated_at)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
                <div className="mt-1 text-sm font-bold text-text-primary">{value}</div>
              </div>
            ))}
          </div>
          {sop.remarks || sop.notes ? <div className="mt-4 text-sm font-semibold text-text-secondary">{sop.remarks || sop.notes}</div> : null}
        </div>
        <div>
          <div className="mb-3 text-sm font-black uppercase tracking-[0.08em] text-text-primary">SOP Timeline</div>
          <div className="space-y-3">
            {steps.length ? steps.map((step) => {
              const qcRequired = step.qc_required || step.is_qc_checkpoint;
              return (
                <div key={step.id} className="rounded-2xl border border-border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.08em] text-primary">Step {step.step_no}</div>
                      <div className="mt-1 text-base font-black text-text-primary">{step.step_name || step.process_name || "Unnamed Step"}</div>
                    </div>
                    {qcRequired ? <Badge tone="warning">QC Required</Badge> : <Badge tone="neutral">Process Step</Badge>}
                  </div>
                  {step.description ? <div className="mt-3 text-sm font-semibold text-text-secondary">{step.description}</div> : null}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-text-secondary">
                    <span>{productionTimeLabel(step.estimated_time_minutes)}</span>
                    {qcRequired && (step.qc_label || step.control_point) ? <span>QC: {step.qc_label || step.control_point}</span> : null}
                    {step.remarks || step.safety_note ? <span>Remarks: {step.remarks || step.safety_note}</span> : null}
                  </div>
                </div>
              );
            }) : <EmptyState title="No SOP steps" description="This SOP has no saved process steps." />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ProductionSopDocumentModal({ sop, onClose }) {
  const steps = [...(sop.steps || [])].sort((a, b) => Number(a.step_no || 0) - Number(b.step_no || 0));
  const qcCount = steps.reduce((count, step) => count + (step.qc_checks?.length || ((step.qc_required || step.is_qc_checkpoint) ? 1 : 0)), 0);
  const recipe = sop.linked_recipe;
  const referencedIngredientCount = new Set(steps.flatMap((step) => step.ingredient_material_ids || [])).size;
  const totalEstimatedMinutes = sopTotalEstimatedMinutes({ ...sop, steps });
  return (
    <Modal title={productionSopDisplayName(sop)} description="Read-only standard process reference" size="2xl" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
      <div className="space-y-6">
        <section className="border-b border-border pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-xl font-black text-text-primary">{productionSopDisplayName(sop)}</div>{sop.product_name_cn ? <div className="mt-1 text-sm font-semibold text-text-secondary">{sop.product_name_cn}</div> : null}</div><Badge tone={sop.status === "active" ? "success" : sop.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(sop.status)}</Badge></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[["Version", sop.version || "v1"], ["Estimated Time", sopMinutesLabel(totalEstimatedMinutes)], ["Effective Date", formatFactoryDate(sop.effective_date)], ["Steps", steps.length], ["QC Points", qcCount], ["Updated", formatFactoryDate(sop.updated_at)]].map(([label, value]) => <div key={label}><div className="text-[10.5px] font-semibold text-text-muted">{label}</div><div className="mt-1 text-sm font-bold text-text-primary">{value}</div></div>)}</div>
          {sop.remarks || sop.notes ? <div className="mt-4 max-w-[70ch] text-sm font-semibold text-text-secondary">{sop.remarks || sop.notes}</div> : null}
        </section>

        <section className="bg-slate-50 px-4 py-4 sm:px-5">
          <div className="text-sm font-black text-text-primary">Recipe Reference</div>
          {recipe ? <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><div className="text-[10.5px] font-semibold text-text-muted">Linked Recipe</div><div className="mt-1 text-sm font-bold text-text-primary">{recipe.recipe_name && recipe.recipe_name !== recipe.version ? `${recipe.recipe_name} ${sop.recipe_version || recipe.version}` : sop.recipe_version || recipe.version}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Standard Output</div><div className="mt-1 text-sm font-bold text-text-primary">{quantity(recipe.yield_quantity, recipe.uom)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Referenced Ingredients</div><div className="mt-1 text-sm font-bold text-text-primary">{referencedIngredientCount} of {recipe.items?.length || 0}</div></div></div> : <div className="mt-3"><div className="text-sm font-bold text-text-primary">No Recipe Linked</div><div className="mt-1 text-xs font-semibold text-text-secondary">This SOP predates recipe snapshot linking or was saved without an active recipe.</div></div>}
        </section>

        <section>
          <div className="mb-3 text-sm font-black text-text-primary">SOP Timeline</div>
          <div className="relative space-y-4 before:absolute before:bottom-4 before:left-4 before:top-4 before:w-px before:bg-border sm:before:left-5">
            {steps.length ? steps.map((step) => {
              const qcChecks = step.qc_checks?.length ? step.qc_checks : (step.qc_required || step.is_qc_checkpoint) ? [{ id: `legacy-${step.id}`, qc_type: "checklist", qc_name: step.qc_label || step.control_point || "QC Check", instructions: step.qc_target_value || "", is_required: true, legacy: true }] : [];
              const stepMinutes = sopStepEstimatedMinutes(step);
              return (
                <article key={step.id} className="relative ml-10 rounded-xl border border-border bg-white p-4 sm:ml-12 sm:p-5">
                  <span className="absolute -left-[34px] top-4 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-black text-white sm:-left-[40px]">{step.step_no}</span>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-base font-black text-text-primary">{step.step_name || step.process_name || "Unnamed Step"}</div><div className="mt-1 text-xs font-bold text-text-secondary">Step Time: {sopMinutesLabel(stepMinutes)}</div>{step.sub_steps?.length ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Calculated from {step.sub_steps.length} sub-step{step.sub_steps.length === 1 ? "" : "s"}</div> : null}</div>{qcChecks.length ? <Badge tone="warning">{qcChecks.length} QC {qcChecks.length === 1 ? "Check" : "Checks"}</Badge> : <Badge tone="neutral">Process Step</Badge>}</div>
                  {step.description ? <div className="mt-3 max-w-[75ch] text-sm font-semibold text-text-secondary">{step.description}</div> : null}
                  {step.ingredient_references?.length ? <div className="mt-3"><div className="text-[10.5px] font-semibold text-text-muted">Recipe Ingredients</div><div className="mt-1.5 flex flex-wrap gap-1.5">{step.ingredient_references.map((item) => <span key={item.raw_material_id} className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{item.raw_material_name}</span>)}</div></div> : null}
                  {step.sub_steps?.length ? <div className="mt-4 space-y-2">{step.sub_steps.map((subStep, index) => <div key={subStep.id} className="flex gap-3 rounded-lg bg-slate-50 px-3 py-2"><span className="shrink-0 text-xs font-black text-primary">{step.step_no}.{index + 1}</span><div className="min-w-0"><div className="text-sm font-semibold text-text-primary">{subStep.instruction}</div><div className="mt-0.5 flex flex-wrap gap-3 text-xs font-semibold text-text-secondary"><span>{sopMinutesLabel(subStep.estimated_minutes)}</span>{subStep.remarks ? <span>{subStep.remarks}</span> : null}</div></div></div>)}</div> : null}
                  {qcChecks.length ? <div className="mt-4 border-t border-border pt-3"><div className="text-xs font-black text-text-primary">QC Checks</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{qcChecks.map((qc) => <div key={qc.id} className="rounded-lg bg-slate-50 px-3 py-2"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-bold text-text-primary">{qc.qc_name}</div>{qc.instructions ? <div className="mt-1 text-xs font-semibold text-text-secondary">{qc.instructions}</div> : null}</div>{qc.is_required ? <Badge tone="warning">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</div></div>)}</div></div> : null}
                  {step.remarks || step.safety_note ? <div className="mt-3 text-xs font-semibold text-text-secondary">Remarks: {step.remarks || step.safety_note}</div> : null}
                </article>
              );
            }) : <EmptyState title="No SOP steps" description="This SOP has no saved process steps." />}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function QcChecklistPresetManagerModal({ templates = [], sops = [], onClose, onCreate, onUpdate, onArchive, onRestore, onDelete }) {
  const emptyForm = { id: "", name: "", result_mode: "checklist", description: "", is_active: true };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const referenceCounts = useMemo(() => {
    const counts = new Map();
    sops.forEach((sop) => (sop.steps || []).forEach((step) => (step.qc_checks || []).forEach((qc) => {
      if (qc.checklist_template_id) counts.set(qc.checklist_template_id, (counts.get(qc.checklist_template_id) || 0) + 1);
    })));
    return counts;
  }, [sops]);
  const orderedTemplates = [...templates].sort((a, b) => Number(b.is_active !== false) - Number(a.is_active !== false) || String(a.name || "").localeCompare(String(b.name || "")));
  const resultModeOptions = [
    { value: "checklist", label: "Checklist" },
    { value: "remarks", label: "Remarks" },
  ];

  function beginEdit(template) {
    setError("");
    setForm({
      id: template.id,
      name: template.name || "",
      result_mode: template.result_mode || "checklist",
      description: template.description || "",
      is_active: template.is_active !== false,
    });
  }

  function resetForm() {
    setError("");
    setForm(emptyForm);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name || "").trim()) return setError("QC Check Name is required.");
    setSaving(true);
    try {
      if (form.id) await onUpdate(form);
      else await onCreate(form);
      resetForm();
    } catch (nextError) {
      setError(nextError.message || "Unable to save QC Checklist Preset.");
    } finally {
      setSaving(false);
    }
  }

  async function runLifecycle(action, template) {
    setError("");
    setSaving(true);
    try {
      await action(template);
      if (form.id === template.id) resetForm();
    } catch (nextError) {
      setError(nextError.message || "Unable to update QC Checklist Preset.");
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(template) {
    if (!window.confirm(`Delete unused QC check "${template.name}"?`)) return;
    runLifecycle(onDelete, template);
  }

  return (
    <Modal title="QC Checklist Presets" description="Manage reusable QC checks for Production SOP steps." size="2xl" onClose={saving ? undefined : onClose} footer={<button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <div className="text-sm font-black text-text-primary">{form.id ? "Edit QC Check" : "Create QC Check"}</div>
            <div className="mt-1 text-xs font-semibold text-text-secondary">Preset instructions provide a starting point and remain editable in each Draft SOP.</div>
          </div>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <Field label="QC Check Name *"><input className={inputClass()} value={form.name} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Result Mode"><SearchableSelect value={form.result_mode} options={resultModeOptions} placeholder="Select result mode" disabled={saving} onChange={(value) => setForm((current) => ({ ...current, result_mode: value }))} /></Field>
          <Field label="Default Instructions"><textarea className={inputClass()} rows={4} value={form.description} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
          <Field label="Status"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><Badge tone={form.is_active ? "success" : "neutral"}>{form.is_active ? "Active" : "Archived"}</Badge></div></Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Save QC Check" : "Create QC Check"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={resetForm}>Cancel Edit</button> : null}
          </div>
        </form>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3"><div><div className="text-sm font-black text-text-primary">Preset Records</div><div className="mt-1 text-xs font-semibold text-text-secondary">Archived checks remain visible in historical SOPs.</div></div><Badge tone="neutral">{templates.length}</Badge></div>
          {orderedTemplates.length ? <div className="space-y-2">
            {orderedTemplates.map((template) => {
              const references = referenceCounts.get(template.id) || 0;
              const active = template.is_active !== false;
              return <article key={template.id} className="rounded-xl border border-border bg-white p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><div className="font-bold text-text-primary">{template.name}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-text-secondary"><span>{template.result_mode === "remarks" ? "Remarks" : "Checklist"}</span><span>{references} SOP reference{references === 1 ? "" : "s"}</span></div>{template.description ? <div className="mt-2 text-sm font-semibold text-text-secondary">{template.description}</div> : null}</div>
                  <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Archived"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => beginEdit(template)}>Edit</button>
                  {active ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" disabled={saving} onClick={() => runLifecycle(onArchive, template)}>Archive</button> : <button className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" type="button" disabled={saving} onClick={() => runLifecycle(onRestore, template)}>Restore</button>}
                  {!references ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" disabled={saving} onClick={() => requestDelete(template)}>Delete</button> : null}
                </div>
              </article>;
            })}
          </div> : <EmptyState title="No QC Checklist Presets" description="Create a reusable QC check for Production SOP steps." />}
        </section>
      </div>
    </Modal>
  );
}

function buildStockCheckRows(stockType, stockItems, initialValue, categoryId = "") {
  if (initialValue?.items?.length) {
    return initialValue.items.map((item) => {
      const stockItem = stockItems.find((candidate) => candidate.id === item.raw_material_id || candidate.id === item.finished_good_id) || {};
      return ({
      id: item.id,
      raw_material_id: item.raw_material_id || "",
      finished_good_id: item.finished_good_id || "",
      item_name: item.item_name || "",
      system_qty: initialValue.status === "draft"
        ? Number(stockItems.find((stockItem) => stockItem.id === item.raw_material_id || stockItem.id === item.finished_good_id)?.current_balance ?? item.system_qty ?? 0)
        : item.system_qty,
      physical_qty: item.variance_status === "Skipped" || item.count_status === "pending" ? "" : item.physical_qty,
      count_status: item.variance_status === "Skipped" || item.count_status === "skip" ? "skip" : item.variance_status === "Pending" || item.count_status === "pending" ? "pending" : "counted",
      variance_reason: item.variance_reason || "",
      batch_allocations: item.batch_allocations || [],
      positive_adjustment_confirmed: Boolean(item.positive_adjustment_confirmed),
      product_code: item.product_code || stockItem.product_code || "",
      packaging_type: item.packaging_type || stockItem.packaging_type || "",
      pack_size_qty: item.pack_size_qty ?? stockItem.pack_size_qty ?? null,
      pack_size_uom: item.pack_size_uom || stockItem.pack_size_uom || "",
      base_qty: item.base_qty ?? stockItem.base_qty ?? null,
      base_uom: item.base_uom || stockItem.base_uom || "",
      uom: stockType === "product" ? "Packs" : item.uom || "",
    });
    });
  }
  return stockItems.filter((item) => item.status === "active" && (stockType === "raw" ? item.category_id === categoryId : !categoryId || item.category_id === categoryId)).map((item) => ({
    id: `${stockType}-${item.id}`,
    raw_material_id: stockType === "raw" ? item.id : "",
    finished_good_id: stockType === "product" ? item.id : "",
    item_name: stockType === "raw" ? rawMaterialLabel(item) : item.product_name,
    system_qty: Number(item.current_balance || 0),
    physical_qty: "",
    count_status: stockType === "product" ? "skip" : "counted",
    variance_reason: "",
    batch_allocations: [],
    positive_adjustment_confirmed: false,
    product_code: item.product_code || "",
    packaging_type: item.packaging_type || "",
    pack_size_qty: item.pack_size_qty ?? null,
    pack_size_uom: item.pack_size_uom || "",
    base_qty: item.base_qty ?? null,
    base_uom: item.base_uom || "",
    uom: stockType === "product" ? "Packs" : item.uom || "",
  }));
}

function StockCheckModal({ stockType, title, initialValue, stockItems, rawMaterialCategories = [], finishedGoodCategories = [], readOnly = false, onConfirmSubmit, onClose, onSave }) {
  const inferredCategoryId = initialValue?.category_id || stockItems.find((item) => item.id === initialValue?.items?.[0]?.raw_material_id || item.id === initialValue?.items?.[0]?.finished_good_id)?.category_id || "";
  const [form, setForm] = useState(() => ({
    check_date: malaysiaBusinessDateInput(),
    status: "draft",
    notes: "",
    ...initialValue,
    category_id: initialValue?.category_id || inferredCategoryId,
    items: buildStockCheckRows(stockType, stockItems, initialValue, inferredCategoryId),
  }));
  const [savingAction, setSavingAction] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [lastSubmitAction, setLastSubmitAction] = useState("");
  const [error, setError] = useState("");
  const [batchEditor, setBatchEditor] = useState(null);
  const [reconciliation, setReconciliation] = useState({ rows: [], loading: stockType === "product", error: "" });
  const itemIdKey = stockType === "raw" ? "raw_material_id" : "finished_good_id";
  const itemLabel = stockType === "raw" ? "Raw Material" : "Finished Good";
  const isRaw = stockType === "raw";
  const reconciliationBySku = useMemo(() => new Map((reconciliation.rows || []).map((row) => [row.finished_good_id, row])), [reconciliation.rows]);
  const checkNoPreview = useFactoryNumberPreview({
    assignedValue: form.check_no || "",
    previewKey: form.check_no || `${stockType}:${form.check_date}`,
    loadPreview: () => factoryService.getStockCheckNoPreview(stockType, form.check_date),
    enabled: !form.check_no && !readOnly,
    scope: `${stockType}_stock_check_no`,
  });

  useEffect(() => {
    if (isRaw) return undefined;
    let active = true;
    setReconciliation((current) => ({ ...current, loading: true, error: "" }));
    factoryService.getFinishedGoodInventoryReconciliation()
      .then((rows) => {
        if (active) setReconciliation({ rows, loading: false, error: "" });
      })
      .catch((loadError) => {
        if (active) setReconciliation((current) => ({ ...current, loading: false, error: loadError.message || "Unable to load Finished Goods reconciliation." }));
      });
    return () => { active = false; };
  }, [isRaw]);

  function updateRow(rowId, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  async function openStockCheckBatchAllocation(row) {
    const requiredQty = Math.abs(Math.min(stockCheckVariance(row.system_qty, row.physical_qty).variance, 0));
    if (!row.finished_good_id || !Number.isInteger(requiredQty) || requiredQty <= 0) return;
    setError("");
    setBatchEditor((current) => current?.rowId === row.id ? {
      ...current,
      loading: true,
      error: "",
      errorKind: "",
    } : {
      rowId: row.id,
      loading: true,
      error: "",
      errorKind: "",
      isStale: false,
      batches: [],
      unavailableBatches: [],
      aggregateBalance: 0,
      batchAvailable: null,
      availableToThisLine: null,
      unavailableBalance: 0,
    });
    try {
      const availability = await factoryService.getFinishedGoodBatchAvailability({ finishedGoodId: row.finished_good_id });
      setBatchEditor((current) => current?.rowId === row.id ? {
        ...current,
        loading: false,
        batches: availability.batches,
        unavailableBatches: availability.unavailable_batches,
        aggregateBalance: availability.aggregate_balance,
        batchAvailable: availability.allocatable_batch_balance,
        availableToThisLine: availability.allocatable_batch_balance,
        unavailableBalance: availability.unavailable_balance,
        error: "",
        errorKind: "",
        isStale: false,
      } : current);
    } catch (loadError) {
      const permissionDenied = isFactoryPermissionError(loadError);
      console.error("[Factory] Unable to load Product Stock Check batch availability.", loadError);
      if (permissionDenied) {
        updateRow(row.id, { batch_allocations: [] });
        setBatchEditor(null);
        setError("Batch availability is hidden by your current role.");
        return;
      }
      setBatchEditor((current) => current?.rowId === row.id ? {
        ...current,
        loading: false,
        error: current.batches?.length ? "" : "Unable to load the latest batch availability.",
        errorKind: "load",
        isStale: Boolean(current.batches?.length),
      } : current);
    }
  }

  function selectCategory(categoryId) {
    setForm((current) => ({
      ...current,
      category_id: categoryId,
      items: buildStockCheckRows(stockType, stockItems, null, categoryId),
    }));
    setError("");
  }

  function validate(nextStatus) {
    if (isRaw && !form.category_id) return "Select a category to start stock check.";
    if (!form.items.length) return "Stock check requires at least one counted item.";
    const invalidRow = form.items.find((row) => !row[itemIdKey]);
    if (invalidRow) return "Every row needs an item.";
    if (!isRaw) {
      const invalidWholeQty = form.items.find((row) => row.count_status !== "skip" && row.physical_qty !== "" && row.physical_qty != null
        && (!Number.isFinite(Number(row.physical_qty)) || !Number.isInteger(Number(row.physical_qty))));
      if (invalidWholeQty) return "Physical Qty must be a whole number.";
    }
    if (nextStatus === "submitted") {
      const missingCount = form.items.find((row) => row.count_status !== "skip" && (row.physical_qty === "" || row.physical_qty == null || Number(row.physical_qty) < 0));
      if (missingCount) return "Submit requires every row to be counted or skipped.";
      const missingSkipReason = isRaw && form.items.find((row) => row.count_status === "skip" && !String(row.variance_reason || "").trim());
      if (missingSkipReason) return "Skip reason is required for skipped rows.";
    } else {
      const invalidCount = form.items.find((row) => row.count_status !== "skip" && row.physical_qty !== "" && row.physical_qty != null && Number(row.physical_qty) < 0);
      if (invalidCount) return "Physical count cannot be negative.";
    }
    if (nextStatus === "submitted") {
      const missingReason = form.items.find((row) => {
        if (row.count_status === "skip" || row.physical_qty === "" || row.physical_qty == null) return false;
        const variance = stockCheckVariance(row.system_qty, row.physical_qty);
        return variance.status !== "Normal" && !String(row.variance_reason || "").trim();
      });
      if (missingReason) return "Variance reason is required for variance rows.";
      if (!isRaw) {
        if (reconciliation.loading) return "Finished Goods reconciliation is still loading.";
        if (reconciliation.error) return "Finished Goods reconciliation could not be verified. Retry before submitting.";
        const unsafeReconciliation = form.items.find((row) => row.count_status !== "skip"
          && row.physical_qty !== "" && row.physical_qty != null
          && stockCheckVariance(row.system_qty, row.physical_qty).variance !== 0
          && (reconciliationBySku.get(row.finished_good_id)?.reconciliation_status === "mismatch" || !reconciliationBySku.has(row.finished_good_id)));
        if (unsafeReconciliation) return "Reconcile Finished Goods batch inventory before submitting this Stock Check.";
        const missingAdjustmentDestination = form.items.find((row) => {
          if (row.count_status === "skip" || row.physical_qty === "" || row.physical_qty == null) return false;
          if (stockCheckVariance(row.system_qty, row.physical_qty).variance <= 0) return false;
          const sku = stockItems.find((item) => item.id === row.finished_good_id);
          return !row.positive_adjustment_confirmed || !sku?.storage_location_id || String(sku.storage_location_ref?.status || sku.storage_location_status || "").toLowerCase() !== "active"
            || String(sku.storage_location_ref?.location_type || sku.storage_location_type || "").toLowerCase() !== "finished goods area";
        });
        if (missingAdjustmentDestination) return "Assign an Adjustment Batch before submitting the extra packs.";
        const invalidAllocationLocation = form.items.find((row) => (row.batch_allocations || []).some((allocation) => allocation.location_valid === false));
        if (invalidAllocationLocation) return "Storage location unavailable. Replace invalid batch allocations before submitting.";
        const missingBatchAllocation = form.items.find((row) => {
          if (row.count_status === "skip" || row.physical_qty === "" || row.physical_qty == null) return false;
          const varianceQty = stockCheckVariance(row.system_qty, row.physical_qty).variance;
          return varianceQty < 0 && dispatchAllocationTotal(row.batch_allocations) !== Math.abs(varianceQty);
        });
        if (missingBatchAllocation) {
          const difference = Math.abs(stockCheckVariance(missingBatchAllocation.system_qty, missingBatchAllocation.physical_qty).variance);
          return `Resolve the ${difference}-pack difference before submitting.`;
        }
      }
    }
    return "";
  }

  async function submit(nextStatus) {
    setSubmitAttempted(true);
    setLastSubmitAction(nextStatus);
    const validationError = validate(nextStatus);
    setError(validationError);
    if (validationError) return;
    if (nextStatus === "submitted" && onConfirmSubmit) {
      const counted = form.items.filter((row) => row.count_status !== "skip" && row.physical_qty !== "" && row.physical_qty != null).length;
      const skipped = form.items.filter((row) => row.count_status === "skip").length;
      const variance = form.items.filter((row) => row.count_status !== "skip" && row.physical_qty !== "" && stockCheckVariance(row.system_qty, row.physical_qty).variance !== 0).length;
      const confirmed = await onConfirmSubmit({ counted, skipped, variance });
      if (!confirmed) return;
    }
    setSavingAction(nextStatus);
    try {
      await onSave({ ...form, status: nextStatus });
    } catch (saveError) {
      console.error("[Factory] Stock Check mutation failed.", saveError);
      setError("Unable to save Stock Check.");
    } finally {
      setSavingAction("");
    }
  }

  const countedRows = form.items.filter((row) => row.count_status !== "skip" && row.physical_qty !== "" && row.physical_qty != null);
  const varianceRows = countedRows.filter((row) => stockCheckVariance(row.system_qty, row.physical_qty).status !== "Normal");
  const criticalRows = form.items.filter((row) => row.count_status !== "skip" && row.physical_qty !== "" && stockCheckVariance(row.system_qty, row.physical_qty).status === "Critical");
  const skippedRows = form.items.filter((row) => row.count_status === "skip");
  const isLocked = readOnly || form.status !== "draft";
  const categorySource = isRaw ? rawMaterialCategories : finishedGoodCategories;
  const categoryOptions = [
    ...(isRaw ? [] : [{ value: "", label: "All", helper: "Show all Packaging SKUs" }]),
    ...categorySource
    .filter((category) => category.status === "active" || category.id === form.category_id)
      .map((category) => ({ value: category.id, label: category.name, helper: category.status })),
  ];
  const selectedCategoryLabel = categorySource.find((category) => category.id === form.category_id)?.name || "";

  function rowState(row) {
    const isSkipped = row.count_status === "skip";
    const hasCount = row.physical_qty !== "" && row.physical_qty != null;
    const variance = isSkipped || !hasCount ? { variance: 0, variancePercent: null, status: isSkipped ? "Skipped" : "Normal" } : stockCheckVariance(row.system_qty, row.physical_qty);
    const showReasonError = submitAttempted && lastSubmitAction === "submitted" && ((variance.status !== "Normal" && !isSkipped) || (isRaw && isSkipped)) && !String(row.variance_reason || "").trim();
    const showCountError = submitAttempted && lastSubmitAction === "submitted" && !isSkipped && !hasCount;
    const showWholeError = !isRaw && hasCount && (!Number.isFinite(Number(row.physical_qty)) || !Number.isInteger(Number(row.physical_qty)));
    return { isSkipped, hasCount, variance, showReasonError, showCountError, showWholeError };
  }

  function reconciliationSummary(row) {
    const snapshot = reconciliationBySku.get(row.finished_good_id);
    if (!snapshot) return { label: reconciliation.loading ? "Checking" : "Unavailable", tone: "warning", snapshot: null };
    if (snapshot.reconciliation_status === "reconciled") return { label: "Reconciled", tone: "success", snapshot };
    if (snapshot.reconciliation_status === "legacy_unallocated") return { label: "Legacy / Unallocated", tone: "warning", snapshot };
    if (snapshot.reconciliation_status === "review_required") return { label: "Review Required", tone: "warning", snapshot };
    return { label: "Mismatch", tone: "danger", snapshot };
  }

  function countStatusControl(row, isSkipped) {
    return (
      <div className="inline-flex rounded-lg border border-border bg-white p-1">
        <button className={`rounded-md px-2 py-1 text-xs font-semibold ${!isSkipped ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" disabled={isLocked} onClick={() => updateRow(row.id, { count_status: "counted" })}>Counted</button>
        <button className={`rounded-md px-2 py-1 text-xs font-semibold ${isSkipped ? "bg-amber-500 text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" disabled={isLocked} onClick={() => updateRow(row.id, { count_status: "skip", physical_qty: "", batch_allocations: [], positive_adjustment_confirmed: false })}>Skip</button>
      </div>
    );
  }

  function updatePhysicalCount(row, value) {
    const nextVariance = value === "" ? 0 : stockCheckVariance(row.system_qty, value).variance;
    const existingTotal = dispatchAllocationTotal(row.batch_allocations);
    updateRow(row.id, {
      physical_qty: value,
      batch_allocations: nextVariance < 0 && existingTotal === Math.abs(nextVariance) ? row.batch_allocations : [],
      positive_adjustment_confirmed: nextVariance > 0 && row.positive_adjustment_confirmed,
    });
  }

  return (
    <>
    <Modal
      title={initialValue?.id ? `${readOnly ? "View" : "Edit"} ${title}` : `Create ${title}`}
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
        {!isRaw && reconciliation.error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            <span>Finished Goods batch reconciliation could not be verified.</span>
            <button className="underline" type="button" onClick={async () => {
              setReconciliation((current) => ({ ...current, loading: true, error: "" }));
              try {
                const rows = await factoryService.getFinishedGoodInventoryReconciliation();
                setReconciliation({ rows, loading: false, error: "" });
              } catch (loadError) {
                setReconciliation((current) => ({ ...current, loading: false, error: loadError.message || "Unable to load Finished Goods reconciliation." }));
              }
            }}>Retry</button>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={ClipboardCheck} label="Counted Items" value={countedRows.length} helper={itemLabel} />
          <MetricCard icon={CircleOff} label="Skipped" value={skippedRows.length} helper="Not included in adjustments" tone="neutral" />
          <MetricCard icon={Activity} label="Variance Items" value={varianceRows.length} helper="Physical count differs" tone={varianceRows.length ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Requires Review" value={criticalRows.length} helper="Critical variance items" tone={criticalRows.length ? "danger" : "success"} />
          <MetricCard icon={CheckCircle2} label="Status" value={jobStatusLabel(form.status)} helper="Stock check status" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {isRaw || stockType === "product" ? (
            <Field label={isRaw ? "Category *" : "Category"}>
              <SearchableSelect
                value={form.category_id || ""}
                options={categoryOptions}
                placeholder={isRaw ? "Select category" : "All"}
                searchPlaceholder="Search categories"
                emptyText={isRaw ? "No raw material categories" : "No finished good categories"}
                error={submitAttempted && !form.category_id}
                disabled={isLocked || Boolean(initialValue?.id)}
                onChange={selectCategory}
              />
            </Field>
          ) : null}
          <Field label="Check Date">
            <FeedXDatePicker
              value={form.check_date || ""}
              disabled={isLocked}
              onChange={(nextDate) => setForm((current) => ({ ...current, check_date: nextDate }))}
            />
          </Field>
          <Field label="Reference">
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
              <div className={`text-sm font-bold ${form.check_no || checkNoPreview.value ? "text-text-primary" : "text-text-secondary"}`}>{form.check_no || checkNoPreview.value || (checkNoPreview.loading ? "Loading preview..." : "—")}</div>
              {!form.check_no && checkNoPreview.value ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Preview only</div> : null}
              {!form.check_no && checkNoPreview.error ? <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline" type="button" onClick={checkNoPreview.retry}><RefreshCw size={11} /> Retry</button> : null}
            </div>
          </Field>
        </div>
        {initialValue?.id ? (
          <div className="grid gap-3 rounded-xl border border-border bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <div><div className="text-[10.5px] font-semibold text-text-muted">Created By</div><div className="font-bold text-text-primary">{form.created_by_name || "—"}</div></div>
            <div><div className="text-[10.5px] font-semibold text-text-muted">Submitted By</div><div className="font-bold text-text-primary">{form.submitted_by_name || "—"}</div></div>
            <div><div className="text-[10.5px] font-semibold text-text-muted">Approved By</div><div className="font-bold text-text-primary">{form.approved_by_name || "—"}</div></div>
          </div>
        ) : null}
        <Card title={`${itemLabel} Count`} description={isLocked ? "Submitted and approved checks are locked snapshots." : "Draft system quantity refreshes from current stock before submission. Submit locks the snapshot for approval."}>
          {isRaw && !form.category_id ? <EmptyState title="Select a category to start stock check." description="Choose a raw material category before loading items to count." /> : null}
          {!isRaw && form.category_id ? (
            <div className="mb-3 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-sm font-semibold text-text-primary">
              Showing: <span className="font-black">{selectedCategoryLabel || "Selected Category"}</span>
              <span className="mx-2 text-text-muted">·</span>
              {form.items.length.toLocaleString("en-MY")} Packaging SKU{form.items.length === 1 ? "" : "s"}
            </div>
          ) : null}
          <div className="space-y-3 md:hidden">
            {form.items.map((row) => {
              const { isSkipped, variance, showReasonError, showCountError, showWholeError } = rowState(row);
              const reconciliationState = reconciliationSummary(row);
              const rowSku = stockItems.find((item) => item.id === row.finished_good_id);
              const expiredAllocationCount = (row.batch_allocations || []).filter((allocation) => allocation.expiry_date && allocation.expiry_date < form.check_date).length;
              const invalidLocationAllocation = (row.batch_allocations || []).find((allocation) => allocation.location_valid === false);
              return (
                <div key={row.id} className={`space-y-3 rounded-2xl border border-border bg-white p-3 ${showReasonError ? "ring-1 ring-amber-200" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-text-primary">{row.item_name || "Item"}</div>
                      <div className="text-xs text-text-secondary">{isRaw ? row.uom || "uom" : [row.product_code, packSizeText(row)].filter(Boolean).join(" · ") || "Packaging SKU"}</div>
                    </div>
                    <Badge tone={variance.status === "Skipped" ? "neutral" : stockVarianceTone(variance.status)}>{variance.status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                      <div className="text-[10.5px] font-semibold text-text-muted">Current Stock</div>
                      <div className="mt-1 text-sm font-bold text-text-primary">{quantity(row.system_qty, isRaw ? row.uom : "Packs")}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                      <div className="text-[10.5px] font-semibold text-text-muted">Difference</div>
                      <div className={`mt-1 text-sm font-bold ${variance.variance > 0 ? "text-amber-600" : variance.variance < 0 ? "text-rose-600" : "text-text-primary"}`}>{isRaw ? signedQuantity(variance.variance, row.uom) : stockCheckDifferenceLabel(variance.variance, { skipped: isSkipped, hasCount: row.physical_qty !== "", uom: "Packs" })}</div>
                      {isRaw && variance.variancePercent != null ? <div className="mt-0.5 text-xs font-semibold text-text-muted">{percent(variance.variancePercent)}</div> : null}
                    </div>
                  </div>
                  {!isRaw && variance.variance !== 0 ? (
                    <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-xs text-text-secondary">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-text-primary">Batch Reconciliation</span><Badge tone={reconciliationState.tone}>{reconciliationState.label}</Badge></div>
                      {reconciliationState.snapshot ? <div className="mt-1">Aggregate {quantity(reconciliationState.snapshot.aggregate_balance, row.uom)} · Batch {quantity(reconciliationState.snapshot.batch_balance, row.uom)}</div> : null}
                      {reconciliationState.snapshot && (reconciliationState.snapshot.ambiguous_reference_count || reconciliationState.snapshot.unmatched_reference_count) ? <div className="mt-1 font-semibold text-amber-800">Historical references: {reconciliationState.snapshot.ambiguous_reference_count} ambiguous · {reconciliationState.snapshot.unmatched_reference_count} unmatched</div> : null}
                      {variance.variance > 0 ? <div className="mt-1">Adjustment destination: <span className="font-semibold text-text-primary">{rowSku?.storage_location || "Missing"}</span> · +{quantity(variance.variance, row.uom)}</div> : null}
                      {variance.variance < 0 ? <div className="mt-1">Batch allocation: <span className="font-semibold text-text-primary">{quantity(dispatchAllocationTotal(row.batch_allocations), row.uom)}</span>{expiredAllocationCount ? <span className="ml-2 font-bold text-rose-700">{expiredAllocationCount} expired</span> : null}</div> : null}
                      {invalidLocationAllocation ? <div className="mt-1 font-bold text-rose-700">Storage location unavailable · {invalidLocationAllocation.location_issue}</div> : null}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {countStatusControl(row, isSkipped)}
                    <Field label="Physical Count">
                      <input
                        className={inputClass(showCountError || showWholeError || (submitAttempted && Number(row.physical_qty || 0) < 0))}
                        type="number"
                        min="0"
                        step={isRaw ? "0.01" : "1"}
                        disabled={isLocked || isSkipped}
                        placeholder={isSkipped ? "Skipped" : "Count qty"}
                        value={row.physical_qty}
                        onChange={(event) => updatePhysicalCount(row, event.target.value)}
                      />
                      {showCountError ? <div className="mt-1 text-xs font-semibold text-rose-600">Required before submit.</div> : null}
                      {showWholeError ? <div className="mt-1 text-xs font-semibold text-rose-600">Physical Qty must be a whole number.</div> : null}
                    </Field>
                    <Field label="Reason">
                      <input
                        className={inputClass(showReasonError)}
                        disabled={isLocked}
                        placeholder={isSkipped ? "Optional reason" : variance.status === "Normal" ? "Optional" : "Reason required"}
                        value={row.variance_reason || ""}
                        onChange={(event) => updateRow(row.id, { variance_reason: event.target.value })}
                      />
                      {showReasonError ? <div className="mt-1 text-xs font-semibold text-amber-700">{isSkipped ? "Required when skipped." : "Required for variance rows."}</div> : null}
                    </Field>
                    {!isRaw && variance.variance < 0 ? <button className="btn-secondary w-full" type="button" disabled={isLocked} onClick={() => openStockCheckBatchAllocation(row)}>{dispatchAllocationTotal(row.batch_allocations) === Math.abs(variance.variance) ? "Review Batch Resolution" : "Resolve Batch Difference"}</button> : null}
                    {!isRaw && variance.variance > 0 ? <button className="btn-secondary w-full" type="button" disabled={isLocked || !rowSku?.storage_location_id} onClick={() => updateRow(row.id, { positive_adjustment_confirmed: true })}>{row.positive_adjustment_confirmed ? "Adjustment Batch Assigned" : "Assign Adjustment Batch"}</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">{itemLabel}</th>
                  <th className="px-4 py-2.5">Current Stock</th>
                  <th className="px-4 py-2.5">Physical Count</th>
                  <th className="px-4 py-2.5">Difference</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((row) => {
                  const { isSkipped, variance, showReasonError, showCountError, showWholeError } = rowState(row);
                  const reconciliationState = reconciliationSummary(row);
                  const rowSku = stockItems.find((item) => item.id === row.finished_good_id);
                  const expiredAllocationCount = (row.batch_allocations || []).filter((allocation) => allocation.expiry_date && allocation.expiry_date < form.check_date).length;
                  const invalidLocationAllocation = (row.batch_allocations || []).find((allocation) => allocation.location_valid === false);
                  return (
                    <tr key={row.id} className={`border-b border-border last:border-0 ${showReasonError ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-bold text-text-primary">{row.item_name || "Item"}</div>
                        <div className="text-xs text-text-secondary">{isRaw ? row.uom || "uom" : [row.product_code, packSizeText(row)].filter(Boolean).join(" · ") || "Packaging SKU"}</div>
                        {!isRaw && variance.variance !== 0 ? <div className="mt-2 space-y-1 text-[11px] text-text-secondary"><Badge tone={reconciliationState.tone}>{reconciliationState.label}</Badge>{reconciliationState.snapshot ? <div>Aggregate {quantity(reconciliationState.snapshot.aggregate_balance, row.uom)} · Batch {quantity(reconciliationState.snapshot.batch_balance, row.uom)}</div> : null}{reconciliationState.snapshot && (reconciliationState.snapshot.ambiguous_reference_count || reconciliationState.snapshot.unmatched_reference_count) ? <div className="font-semibold text-amber-800">{reconciliationState.snapshot.ambiguous_reference_count} ambiguous · {reconciliationState.snapshot.unmatched_reference_count} unmatched</div> : null}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.system_qty, isRaw ? row.uom : "Packs")}</td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showCountError || showWholeError || (submitAttempted && Number(row.physical_qty || 0) < 0))}
                          type="number"
                          min="0"
                          step={isRaw ? "0.01" : "1"}
                          disabled={isLocked || isSkipped}
                          placeholder={isSkipped ? "Skipped" : "Count qty"}
                          value={row.physical_qty}
                          onChange={(event) => updatePhysicalCount(row, event.target.value)}
                        />
                        {showCountError ? <div className="mt-1 text-xs font-semibold text-rose-600">Required before submit.</div> : null}
                        {showWholeError ? <div className="mt-1 text-xs font-semibold text-rose-600">Physical Qty must be a whole number.</div> : null}
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold ${variance.variance > 0 ? "text-amber-600" : variance.variance < 0 ? "text-rose-600" : "text-text-secondary"}`}>
                        {isRaw ? signedQuantity(variance.variance, row.uom) : stockCheckDifferenceLabel(variance.variance, { skipped: isSkipped, hasCount: row.physical_qty !== "", uom: "Packs" })}
                        {isRaw && variance.variancePercent != null ? <div className="mt-0.5 text-xs font-semibold text-text-muted">{percent(variance.variancePercent)}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-2">
                          <Badge tone={variance.status === "Skipped" ? "neutral" : stockVarianceTone(variance.status)}>{variance.status}</Badge>
                          {countStatusControl(row, isSkipped)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showReasonError)}
                          disabled={isLocked}
                          placeholder={isSkipped ? "Optional reason" : variance.status === "Normal" ? "Optional" : "Reason required"}
                          value={row.variance_reason || ""}
                          onChange={(event) => updateRow(row.id, { variance_reason: event.target.value })}
                        />
                        {showReasonError ? <div className="mt-1 text-xs font-semibold text-amber-700">{isSkipped ? "Required when skipped." : "Required for variance rows."}</div> : null}
                        {!isRaw && variance.variance > 0 ? <div className="mt-2 text-xs text-text-secondary">Adjustment destination: <span className="font-bold text-text-primary">{rowSku?.storage_location || "Missing"}</span> · +{quantity(variance.variance, "Packs")}</div> : null}
                        {!isRaw && variance.variance < 0 ? <div className="mt-2 text-xs text-text-secondary">Resolved: <span className="font-bold text-text-primary">{quantity(dispatchAllocationTotal(row.batch_allocations), "Packs")}</span>{expiredAllocationCount ? <span className="ml-2 font-bold text-rose-700">{expiredAllocationCount} expired</span> : null}</div> : null}
                        {invalidLocationAllocation ? <div className="mt-1 text-xs font-bold text-rose-700">Storage location unavailable · {invalidLocationAllocation.location_issue}</div> : null}
                        {!isRaw && variance.variance < 0 ? <button className="mt-2 text-xs font-bold text-primary hover:underline" type="button" disabled={isLocked} onClick={() => openStockCheckBatchAllocation(row)}>{dispatchAllocationTotal(row.batch_allocations) === Math.abs(variance.variance) ? "Review Batch Resolution" : "Resolve Batch Difference"}</button> : null}
                        {!isRaw && variance.variance > 0 ? <button className="mt-2 text-xs font-bold text-primary hover:underline disabled:text-text-muted" type="button" disabled={isLocked || !rowSku?.storage_location_id} onClick={() => updateRow(row.id, { positive_adjustment_confirmed: true })}>{row.positive_adjustment_confirmed ? "Adjustment Batch Assigned" : "Assign Adjustment Batch"}</button> : null}
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
    {batchEditor && form.items.find((row) => row.id === batchEditor.rowId) ? (() => {
      const batchItem = form.items.find((row) => row.id === batchEditor.rowId);
      const batchVariance = stockCheckVariance(batchItem.system_qty, batchItem.physical_qty).variance;
      const batchSku = stockItems.find((item) => item.id === batchItem.finished_good_id);
      return <DispatchBatchAllocationModal
        item={{ ...batchItem, quantity: Math.abs(batchVariance), allocations: batchItem.batch_allocations || [] }}
        sku={batchSku}
        batches={batchEditor.batches || []}
        unavailableBatches={batchEditor.unavailableBatches || []}
        batchAvailable={batchEditor.batchAvailable}
        availableToThisLine={batchEditor.availableToThisLine}
        otherLinesAllocated={0}
        loading={batchEditor.loading}
        error={batchEditor.error}
        errorKind={batchEditor.errorKind}
        isStale={batchEditor.isStale}
        autoAllocateOnLoad={!batchItem.batch_allocations?.length}
        allowExpired
        referenceDate={form.check_date}
        purpose="stock-check"
        onRetry={() => openStockCheckBatchAllocation(batchItem)}
        onClose={() => setBatchEditor(null)}
        onApply={(allocations) => {
          updateRow(batchItem.id, { batch_allocations: allocations });
          setBatchEditor(null);
        }}
      />;
    })() : null}
    </>
  );
}

export default function FactoryWorkspacePage({ initialTab = "dashboard", ui, auth }) {
  const [data, setData] = useState({ jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], storageLocations: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [receivingTab, setReceivingTab] = useState("history");
  const [editingReceiving, setEditingReceiving] = useState(null);
  const [dispatchTab, setDispatchTab] = useState("history");
  const [receivingHistoryFilters, setReceivingHistoryFilters] = useState({ dateFrom: "", dateTo: "", supplier: "" });
  const [dispatchHistoryFilters, setDispatchHistoryFilters] = useState({ dateFrom: "", dateTo: "", customer: "", status: "" });
  const [dispatchCustomersTodayUpdating, setDispatchCustomersTodayUpdating] = useState(false);
  const [jobOrderFilters, setJobOrderFilters] = useState({ search: "", status: "", scheduledDateFrom: "", scheduledDateTo: "", manufacturingDateFrom: "", manufacturingDateTo: "", finishedGood: "" });
  const [rawMovementReferenceLoading, setRawMovementReferenceLoading] = useState("");
  const [batchTraceabilityDispatchLoading, setBatchTraceabilityDispatchLoading] = useState("");
  const [auditReferenceLoading, setAuditReferenceLoading] = useState("");
  const [operationalJobs, setOperationalJobs] = useState({ jobs: [], productions: [], summary: {}, hasLoaded: false, loading: false, error: "", errorKind: "" });
  const operationalJobsRequestRef = useRef(0);
  const factoryDataRequestRef = useRef(0);
  const factoryDataAbortRef = useRef(null);
  const dispatchMutationRef = useRef(new Set());
  const receivingMutationRef = useRef(new Set());
  const stockCheckMutationRef = useRef(new Set());
  const previousPermissionSignatureRef = useRef("");
  const can = (code) => Boolean(auth?.hasPermission?.(code));
  const clearPlanningPermission = useCallback(() => setModal((current) => current?.type === "job" ? null : current), []);
  const factoryPermissionSignature = JSON.stringify([...(auth?.permissions || [])].sort());
  const serverListing = initialTab === "raw-receiving" ? "receiving-history"
    : initialTab === "raw-stock-check" ? "raw-stock-checks"
        : initialTab === "job-orders" ? "job-orders"
          : initialTab === "production" ? "production-history"
            : initialTab === "finished-goods-dispatch" ? "dispatch-history"
              : initialTab === "product-stock-check" ? "product-stock-checks"
                    : "";
  const serverListingFilters = serverListing === "receiving-history" ? receivingHistoryFilters
    : serverListing === "dispatch-history" ? dispatchHistoryFilters
        : serverListing === "job-orders" ? jobOrderFilters
          : {};
  const scheduledDateRangeError = jobOrderFilters.scheduledDateFrom && jobOrderFilters.scheduledDateTo && jobOrderFilters.scheduledDateFrom > jobOrderFilters.scheduledDateTo
    ? "From date cannot be later than To date."
    : "";
  const manufacturingDateRangeError = jobOrderFilters.manufacturingDateFrom && jobOrderFilters.manufacturingDateTo && jobOrderFilters.manufacturingDateFrom > jobOrderFilters.manufacturingDateTo
    ? "From date cannot be later than To date."
    : "";
  const jobOrderDateRangeInvalid = Boolean(scheduledDateRangeError || manufacturingDateRangeError);
  const serverListingSignature = JSON.stringify({ listing: serverListing, filters: serverListingFilters, permissions: factoryPermissionSignature });
  const canViewDispatchHistory = can("factory_finished_goods_dispatch.view");
  const canViewReceivingHistory = can("factory_raw_receiving.view");
  const stockCheckListingLabel = serverListing === "raw-stock-checks"
    ? "Raw Material Stock Checks"
    : serverListing === "product-stock-checks" ? "Product Stock Checks" : "";
  const [factoryListingPage, factoryListingActions] = useFactoryPagedQuery({
    storageKey: serverListing || "inactive",
    enabled: Boolean(serverListing)
      && !(serverListing === "job-orders" && jobOrderDateRangeInvalid)
      && !(serverListing === "receiving-history" && receivingTab !== "history")
      && !(serverListing === "dispatch-history" && dispatchTab !== "history")
      && !(serverListing === "dispatch-history" && !canViewDispatchHistory)
      && !(serverListing === "receiving-history" && !canViewReceivingHistory),
    querySignature: serverListingSignature,
    loadPage: ({ page, pageSize }) => factoryService.listFactoryListingPage({ listing: serverListing, page, pageSize, filters: serverListingFilters }),
    onError: (error) => {
      console.error(`[Factory] Unable to load ${serverListing}.`, error);
      const permissionDenied = isFactoryPermissionError(error);
      const message = stockCheckListingLabel
          ? permissionDenied
            ? `Some ${stockCheckListingLabel} are hidden by your current role.`
            : `Unable to load ${stockCheckListingLabel}.`
        : permissionDenied ? "Some Factory data is hidden by your current role." : "Unable to load the latest Factory listing.";
      ui?.notify?.({ title: permissionDenied ? "Factory data hidden" : stockCheckListingLabel ? `Unable to load ${stockCheckListingLabel}` : "Failed to load Factory listing", message, tone: "error" });
    },
    shouldClearOnError: isFactoryPermissionError,
    mapError: (error) => ({
      kind: isFactoryPermissionError(error) ? "permission" : "load",
      message: isFactoryPermissionError(error)
        ? stockCheckListingLabel ? `Some ${stockCheckListingLabel} are hidden by your current role.` : "Some data is hidden by your current role."
        : stockCheckListingLabel ? `Unable to load ${stockCheckListingLabel}.` : "Unable to load the latest data.",
    }),
  });
  useEffect(() => {
    if (serverListing === "dispatch-history" && !canViewDispatchHistory) {
      factoryListingActions.clearForPermission("Some Finished Goods Dispatch data is hidden by your current role.");
      setDispatchCustomersTodayUpdating(false);
      setModal((current) => current?.type === "finished-good-dispatch" ? null : current);
    }
    if (serverListing === "receiving-history" && !canViewReceivingHistory) {
      factoryListingActions.clearForPermission("Some Raw Material Receiving data is hidden by your current role.");
      setEditingReceiving(null);
      setModal((current) => current?.type === "receiving-batch-detail" ? null : current);
    }
  }, [canViewDispatchHistory, canViewReceivingHistory, factoryListingActions, serverListing]);
  useEffect(() => {
    if (factoryListingPage.errorKind === "permission") {
      if (serverListing === "dispatch-history") setDispatchCustomersTodayUpdating(false);
      setModal((current) => {
        if (serverListing === "dispatch-history" && current?.type === "finished-good-dispatch") return null;
        if (serverListing === "receiving-history" && current?.type === "receiving-batch-detail") return null;
        if (["raw-stock-checks", "product-stock-checks"].includes(serverListing) && current?.type === "stock-check") return null;
        return current;
      });
      if (serverListing === "receiving-history") setEditingReceiving(null);
    }
  }, [factoryListingPage.errorKind, serverListing]);
  const sopProductGroups = useMemo(() => groupedProductionSops(data.sops), [data.sops]);
  const sopsPager = useFactoryClientPagination("production-sop", sopProductGroups.length);

  function currentListingRows(listing, fallbackRows) {
    if (serverListing !== listing) return fallbackRows;
    if (factoryListingPage.hasLoaded) return factoryListingPage.rows;
    return factoryListingPage.loading ? fallbackRows : [];
  }

  function listingLoadState(listing, label) {
    if (serverListing !== listing) return null;
    return <FactoryTableLoadState
      state={factoryListingPage}
      label={label}
      onRetry={listing === "dispatch-history"
        ? () => refreshFinishedGoodsDispatches({ page: factoryListingPage.requestedPage, reason: "retry" })
        : factoryListingActions.retry}
      permissionMessage={listing === "job-orders" ? "Some Job Order data is hidden by your current role."
          : listing === "raw-stock-checks" ? "Some Raw Material Stock Checks are hidden by your current role."
            : listing === "product-stock-checks" ? "Some Product Stock Checks are hidden by your current role."
              : listing === "dispatch-history" ? "Some Finished Goods Dispatch data is hidden by your current role."
                : listing === "receiving-history" ? "Some Raw Material Receiving data is hidden by your current role."
                  : undefined}
      staleMessage={listing === "dispatch-history" ? "Dispatch was updated, but the latest list could not be refreshed."
          : listing === "receiving-history" ? "Unable to load the latest Receiving History. Showing the last successfully loaded results." : undefined}
    />;
  }

  function listingPagination(listing) {
    if (serverListing !== listing || !factoryListingPage.hasLoaded) return null;
    return (
      <FactoryPagination
        page={factoryListingPage.loadedPage}
        pageSize={factoryListingPage.loadedPageSize}
        total={factoryListingPage.loadedTotal}
        loading={factoryListingPage.loading}
        onPageChange={factoryListingActions.requestPage}
        onPageSizeChange={factoryListingActions.requestPageSize}
      />
    );
  }

  async function loadOperationalJobs() {
    if (!["production-overview", "production"].includes(initialTab)) return;
    const requestId = operationalJobsRequestRef.current + 1;
    operationalJobsRequestRef.current = requestId;
    setOperationalJobs((current) => ({ ...current, loading: true }));
    try {
      const result = await factoryService.listOperationalJobOrders({
        date: malaysiaBusinessDateInput(),
        includeProductions: can("factory_production.view") || can("factory_production.complete"),
      });
      if (operationalJobsRequestRef.current !== requestId) return;
      setOperationalJobs({
        jobs: result.jobs || [],
        productions: result.productions || [],
        summary: result.summary || {},
        hasLoaded: true,
        loading: false,
        error: "",
        errorKind: "",
      });
    } catch (error) {
      if (operationalJobsRequestRef.current !== requestId) return;
      console.error("[Factory] Unable to load operational Job Orders.", error);
      if (isFactoryPermissionError(error)) {
        setOperationalJobs({
          jobs: [],
          productions: [],
          summary: {},
          hasLoaded: false,
          loading: false,
          error: "Some Production Overview data is hidden by your current role.",
          errorKind: "permission",
        });
        setModal(null);
      } else {
        setOperationalJobs((current) => ({ ...current, loading: false, error: "Unable to load the latest operational Job Orders.", errorKind: "load" }));
      }
    }
  }

  async function loadData({ silent = false } = {}) {
    factoryDataAbortRef.current?.abort();
    const controller = new AbortController();
    factoryDataAbortRef.current = controller;
    const requestId = factoryDataRequestRef.current + 1;
    factoryDataRequestRef.current = requestId;
    setLoading(true);
    const operationalLoad = ["production-overview", "production"].includes(initialTab) ? loadOperationalJobs() : Promise.resolve();
    let refreshSucceeded = true;
    try {
      const nextData = await factoryService.listFactoryData({
        scope: initialTab,
        hasPermission: (code) => auth?.hasPermission?.(code),
        signal: controller.signal,
      });
      if (factoryDataRequestRef.current !== requestId || controller.signal.aborted) return;
      const permissionIssues = nextData.accessIssues.filter((issue) => issue.kind === "permission");
      if (nextData.accessIssues.some((issue) => issue.kind === "load")) refreshSucceeded = false;
      setData((current) => {
        const merged = { ...nextData };
        nextData.accessIssues
          .filter((issue) => issue.kind === "load" && issue.complete && Array.isArray(current[issue.key]))
          .forEach((issue) => {
            merged[issue.key] = current[issue.key];
          });
        if (merged.sops.length && merged.recipes.length) {
          const recipesById = new Map(merged.recipes.map((recipe) => [recipe.id, recipe]));
          merged.sops = merged.sops.map((sop) => ({
            ...sop,
            linked_recipe: recipesById.get(sop.recipe_id) || sop.linked_recipe,
          }));
        }
        return merged;
      });
      if (permissionIssues.length) {
        setModal(null);
      }
    } catch (error) {
      refreshSucceeded = false;
      if (factoryDataRequestRef.current !== requestId || controller.signal.aborted) return;
      console.error("[Factory] Unable to refresh Factory workspace data.", error);
      if (!silent) ui?.notify?.({ title: "Failed to load Factory data", message: error.message, tone: "error" });
    } finally {
      if (factoryDataRequestRef.current === requestId) setLoading(false);
    }
    await Promise.all([operationalLoad]);
    return refreshSucceeded;
  }

  useEffect(() => {
    loadData();
  }, [initialTab, factoryPermissionSignature]);

  useEffect(() => {
    if (previousPermissionSignatureRef.current && previousPermissionSignatureRef.current !== factoryPermissionSignature) {
      setModal(null);
    }
    previousPermissionSignatureRef.current = factoryPermissionSignature;
  }, [factoryPermissionSignature]);

  useEffect(() => {
    if (serverListing !== "job-orders" || factoryListingPage.errorKind !== "permission") return;
    const protectedJobOrderModals = new Set(["job", "start-production", "production-process", "production", "completed-job-result"]);
    setModal((current) => protectedJobOrderModals.has(current?.type) ? null : current);
  }, [factoryListingPage.errorKind, serverListing]);

  useEffect(() => () => {
    operationalJobsRequestRef.current += 1;
    factoryDataRequestRef.current += 1;
    factoryDataAbortRef.current?.abort();
  }, []);

  const metrics = useMemo(() => {
    const openJobs = data.jobOrders.filter((job) => !["completed", "cancelled"].includes(job.status));
    const draftJobs = data.jobOrders.filter((job) => job.status === "draft");
    const releasedJobs = data.jobOrders.filter((job) => job.status === "released" || job.status === "planned");
    const inProgressJobs = data.jobOrders.filter((job) => job.status === "in_progress");
    const today = todayInput();
    const overdueJobs = data.jobOrders.filter((job) => job.due_date && job.due_date < today && !["completed", "cancelled"].includes(job.status));
    const completedJobs = data.jobOrders.filter((job) => job.status === "completed");
    const completedTodayJobs = data.jobOrders.filter((job) => job.status === "completed" && (job.completed_at || job.updated_at || "").slice(0, 10) === today);
    const lowStock = data.rawMaterials.filter((item) => item.status === "active" && Number(item.current_balance || 0) > 0 && Number(item.current_balance || 0) <= Number(item.min_stock_level || 0));
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
    const stockCheckVarianceRows = allStockChecks.flatMap((check) => (check.items || []).map((item) => ({ ...item, check }))).filter((item) => item.variance_status !== "Normal" && item.variance_status !== "Skipped");
    const criticalStockCheckRows = stockCheckVarianceRows.filter((item) => item.variance_status === "Critical");
    const qcAlertBatches = completedProductions.filter((production) => ["Pending", "Hold", "Failed"].includes(production.qc_status));
    const totalActualProduced = completedProductions.reduce((sum, row) => sum + Number(row.actual_produced_qty || row.produced_quantity || 0), 0);
    const productionYield = totalActualProduced ? (totalGoodOutput / totalActualProduced) * 100 : 0;
    const materialVariancePercent = weightedMaterialVariancePercent(completedProductions);
    const estimatedProductionCost = completedProductions.reduce((sum, row) => sum + productionCost(row, data.receivings), 0);
    const recipeCostRows = data.recipes.filter((recipe) => recipe.status === "active").map((recipe) => {
      const cost = recipeCostInfo(recipe, data.receivings);
      return { ...recipe, ...cost };
    });
    const recipeByFinishedGood = new Map(recipeCostRows.filter((recipe) => recipe.finished_good_id).map((recipe) => [recipe.finished_good_id, recipe]));
    const recipeByProductFamily = new Map(recipeCostRows.filter((recipe) => recipe.product_family_id).map((recipe) => [recipe.product_family_id, recipe]));
    const recipeByProduct = new Map(recipeCostRows.map((recipe) => [String(recipe.product_name || "").toLowerCase(), recipe]));
    const productionCostRows = completedProductions.map((production) => {
      const recipe = recipeByProductFamily.get(production.product_family_id) || recipeByFinishedGood.get(production.finished_good_id) || recipeByProduct.get(String(production.product_name || "").toLowerCase());
      const actualCost = productionCostInfo(production, data.receivings);
      const standardCost = recipe ? Number(recipe.costPerUnit || 0) * Number(production.good_output_qty || production.actual_produced_qty || production.produced_quantity || 0) : 0;
      const variance = costVarianceInfo(standardCost, actualCost.cost);
      return {
        ...production,
        standard_cost: standardCost,
        actual_cost: actualCost.cost,
        variance_rm: variance.variance,
        variance_percent: variance.variancePercent,
        missing_cost_rows: actualCost.missingCostRows + (recipe?.missingCostRows || 0),
        unsupported_cost_rows: recipe?.unsupportedCostRows || 0,
      };
    });
    const totalStandardCost = productionCostRows.reduce((sum, row) => sum + Number(row.standard_cost || 0), 0);
    const totalActualCost = productionCostRows.reduce((sum, row) => sum + Number(row.actual_cost || 0), 0);
    const totalMissingCostRows = productionCostRows.reduce((sum, row) => sum + Number(row.missing_cost_rows || 0), 0);
    const totalUnsupportedCostRows = productionCostRows.reduce((sum, row) => sum + Number(row.unsupported_cost_rows || 0), 0);
    const costVariance = costVarianceInfo(totalStandardCost, totalActualCost);
    const mostExpensiveRecipe = [...recipeCostRows].sort((a, b) => Number(b.standardCost || 0) - Number(a.standardCost || 0))[0] || null;
    const receivingByMaterial = new Map();
    data.receivings.forEach((row) => {
      if (Number(row.unit_cost || 0) <= 0) return;
      const rows = receivingByMaterial.get(row.raw_material_id) || [];
      rows.push(row);
      receivingByMaterial.set(row.raw_material_id, rows);
    });
    const costIncreaseRows = [...receivingByMaterial.entries()].map(([rawMaterialId, rows]) => {
      const sorted = rows.sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0));
      const latest = sorted[0];
      const previous = sorted[1];
      const increase = previous ? Number(latest.unit_cost || 0) - Number(previous.unit_cost || 0) : 0;
      const increasePercent = previous && Number(previous.unit_cost || 0) ? (increase / Number(previous.unit_cost || 0)) * 100 : 0;
      return {
        id: rawMaterialId,
        raw_material_name: latest?.raw_material_name || "Raw material",
        latest_cost: Number(latest?.unit_cost || 0),
        previous_cost: Number(previous?.unit_cost || 0),
        increase,
        increase_percent: increasePercent,
        supplier_name: latest?.supplier_name || "",
        received_date: latest?.received_date || "",
      };
    }).filter((row) => row.increase > 0);
    const highestCostIncreaseMaterial = costIncreaseRows.sort((a, b) => b.increase_percent - a.increase_percent || b.increase - a.increase)[0] || null;
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
    return {
      openJobs,
      draftJobs,
      releasedJobs,
      inProgressJobs,
      overdueJobs,
      completedJobs,
      completedTodayJobs,
      lowStock,
      receivingValue,
      completedProductions,
      totalGoodOutput,
      totalWastage,
      highVarianceUsage,
      allStockChecks,
      submittedStockChecks,
      approvedStockChecks,
      stockCheckVarianceRows,
      criticalStockCheckRows,
      qcAlertBatches,
      productionYield,
      materialVariancePercent,
      estimatedProductionCost,
      topVarianceRawMaterials,
      recipeCostRows,
      productionCostRows,
      totalStandardCost,
      totalActualCost,
      totalMissingCostRows,
      totalUnsupportedCostRows,
      costVariance,
      mostExpensiveRecipe,
      highestCostIncreaseMaterial,
    };
  }, [data]);

  async function refreshFactoryAfterMutation({ retryListing = false } = {}) {
    try {
      const refreshed = await loadData({ silent: true });
      if (!refreshed) throw new Error("Factory refresh returned an incomplete result.");
      if (retryListing) await factoryListingActions.retry();
      return true;
    } catch (refreshError) {
      console.error("[Factory] Mutation succeeded but Factory data refresh failed.", refreshError);
      ui?.notify?.({
        title: "Refresh needed",
        message: "Updated successfully, but the latest list could not be refreshed.",
        tone: "warning",
      });
      return false;
    }
  }

  async function saveJobOrder(form) {
    let saved;
    try {
      saved = await factoryService.saveJobOrder(form);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save job order", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Job order updated" : "Job order created", tone: "success" });
    setModal(null);
    if (serverListing === "job-orders" && saved?.id) {
      factoryListingActions.updateLoadedSnapshot(({ rows, total }) => {
        const exists = rows.some((row) => row.id === saved.id);
        return {
          rows: exists ? rows.map((row) => row.id === saved.id ? saved : row) : rows,
          total,
        };
      });
    }
    await refreshFactoryAfterMutation({ retryListing: serverListing === "job-orders" });
  }

  async function savePlanningParLevel(form) {
    try {
      await factoryService.updateFinishedGoodParLevel(form.sku, form.par_level);
    } catch (error) {
      ui?.notify?.({ title: "Failed to update par level", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "Par level updated", tone: "success" });
    setModal(null);
    await refreshFactoryAfterMutation();
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
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete job order", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Job order deleted", tone: "success" });
    await refreshFactoryAfterMutation({ retryListing: serverListing === "job-orders" });
  }

  async function releaseJobOrder(order) {
    const confirmed = await ui?.confirm?.({
      title: "Release Job Order?",
      message: `${order.job_order_no} will become available for production start. Inventory will not be adjusted.`,
      confirmLabel: "Release",
      tone: "info",
    });
    if (!confirmed) return;
    try {
      await factoryService.releaseJobOrder(order);
    } catch (error) {
      ui?.notify?.({ title: "Failed to release job order", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Job order released", tone: "success" });
    await refreshFactoryAfterMutation({ retryListing: serverListing === "job-orders" });
  }

  async function cancelJobOrder(order) {
    const confirmed = await ui?.confirm?.({
      title: "Cancel Job Order?",
      message: `${order.job_order_no} · ${jobFinishedGoodName(order)}. Cancel this Job Order? It will be removed from the production pipeline.`,
      confirmLabel: "Cancel Job Order",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.cancelJobOrder(order);
    } catch (error) {
      ui?.notify?.({ title: "Failed to cancel job order", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Job order cancelled", message: `${order.job_order_no} was removed from the production pipeline.`, tone: "success" });
    await refreshFactoryAfterMutation({ retryListing: serverListing === "job-orders" });
  }

  async function startJobOrder(order, form) {
    try {
      await factoryService.startJobOrder(order, form, auth?.profile);
    } catch (error) {
      ui?.notify?.({ title: "Failed to start production", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "Production started", message: `${order.job_order_no} is now in progress.`, tone: "success" });
    setModal(null);
    await refreshFactoryAfterMutation({ retryListing: serverListing === "job-orders" });
  }

  async function viewCompletedJobOrder(order) {
    try {
      const production = await factoryService.getProductionByJobOrder(order.id);
      setModal({ type: "completed-job-result", job: order, production });
    } catch (error) {
      ui?.notify?.({ title: "Unable to load production result", message: error.message, tone: "error" });
    }
  }

  function receivingMatchesHistoryFilters(batch) {
    if (!batch) return false;
    if (receivingHistoryFilters.dateFrom && batch.received_date < receivingHistoryFilters.dateFrom) return false;
    if (receivingHistoryFilters.dateTo && batch.received_date > receivingHistoryFilters.dateTo) return false;
    if (receivingHistoryFilters.supplier && batch.supplier_id !== receivingHistoryFilters.supplier && batch.supplier_name !== receivingHistoryFilters.supplier) return false;
    return true;
  }

  function compareReceivingBatchesDesc(left, right) {
    return String(right.received_date || "").localeCompare(String(left.received_date || ""))
      || String(right.created_at || "").localeCompare(String(left.created_at || ""))
      || String(right.id || "").localeCompare(String(left.id || ""));
  }

  function applyReceivingMutation(previous, next) {
    const previousMatches = receivingMatchesHistoryFilters(previous);
    const nextMatches = receivingMatchesHistoryFilters(next);
    let refreshPage = factoryListingPage.loadedPage;
    factoryListingActions.updateLoadedSnapshot(({ rows, total, page, pageSize, summary }) => {
      const existingIndex = rows.findIndex((row) => row.id === (next?.id || previous?.id));
      let updatedRows = rows;
      if (existingIndex >= 0) {
        updatedRows = nextMatches ? rows.map((row, index) => index === existingIndex ? next : row) : rows.filter((_, index) => index !== existingIndex);
      } else if (nextMatches && page === 1) {
        updatedRows = [...rows, next];
      }
      updatedRows = updatedRows.sort(compareReceivingBatchesDesc).slice(0, pageSize);
      if (existingIndex >= 0 && !nextMatches && rows.length === 1 && page > 1) refreshPage = page - 1;
      const totalDelta = (nextMatches ? 1 : 0) - (previousMatches ? 1 : 0);
      const previousItems = previousMatches ? Number(previous?.items_count || previous?.items?.length || 0) : 0;
      const nextItems = nextMatches ? Number(next?.items_count || next?.items?.length || 0) : 0;
      const previousQty = previousMatches ? Number(previous?.total_qty || 0) : 0;
      const nextQty = nextMatches ? Number(next?.total_qty || 0) : 0;
      return {
        rows: updatedRows,
        total: Math.max(0, Number(total || 0) + totalDelta),
        summary: {
          ...(summary || {}),
          documents: Math.max(0, Number(summary?.documents || 0) + totalDelta),
          items: Math.max(0, Number(summary?.items || 0) - previousItems + nextItems),
          total_qty: Math.max(0, Number(summary?.total_qty || 0) - previousQty + nextQty),
        },
      };
    });
    return refreshPage;
  }

  async function refreshReceivingHistory(page, reason) {
    try {
      await factoryListingActions.refreshNow({ page, pageSize: factoryListingPage.loadedPageSize, errorMessage: "Receiving was updated, but the latest list could not be refreshed." });
    } catch (refreshError) {
      console.error(`[Factory] Raw Material Receiving ${reason} succeeded but listing refresh failed.`, refreshError);
      ui?.notify?.({ title: "Receiving list refresh needed", message: "Receiving was updated, but the latest list could not be refreshed.", tone: "warning" });
    }
  }

  async function mutateReceiving(form, complete) {
    const mutationKey = form.id || form.completion_request_id;
    if (receivingMutationRef.current.has(mutationKey)) return null;
    receivingMutationRef.current.add(mutationKey);
    const previous = form.id ? factoryListingPage.rows.find((row) => row.id === form.id) || form : null;
    let saved;
    try {
      saved = await factoryService.saveRawMaterialReceivingBatch(form, { complete });
    } catch (error) {
      console.error(`[Factory] Unable to ${complete ? "complete" : "save"} Raw Material Receiving.`, error);
      ui?.notify?.({ title: complete ? "Failed to complete receiving" : "Failed to save receiving Draft", message: isFactoryPermissionError(error) ? "Your current role does not allow this Receiving action." : error.message, tone: "error" });
      throw error;
    } finally {
      receivingMutationRef.current.delete(mutationKey);
    }
    const refreshPage = applyReceivingMutation(previous, saved);
    setEditingReceiving(null);
    setReceivingTab("history");
    ui?.notify?.({ title: complete ? "Receiving completed" : form.id ? "Receiving Draft updated" : "Receiving Draft saved", message: complete ? "Stock and Raw Material Movements were updated." : "No stock or movements were created.", tone: "success" });
    void refreshReceivingHistory(refreshPage, complete ? "completion" : "save");
    if (complete) void loadData({ silent: true });
    return saved;
  }

  async function saveReceivingBatch(form) {
    return mutateReceiving(form, false);
  }

  async function completeReceivingBatch(form) {
    return mutateReceiving(form, true);
  }

  async function cancelReceivingBatch(batch) {
    if (receivingMutationRef.current.has(batch.id)) return;
    receivingMutationRef.current.add(batch.id);
    try {
      const confirmed = await ui?.confirm?.({ title: "Cancel Receiving Draft?", message: `${batch.batch_no} will remain in history and cannot be edited.`, confirmLabel: "Cancel Draft", tone: "warning" });
      if (!confirmed || !receivingMutationRef.current.has(batch.id)) return;
      let cancelled;
      try {
        cancelled = await factoryService.cancelRawMaterialReceivingBatch(batch);
      } catch (error) {
        console.error("[Factory] Unable to cancel Raw Material Receiving.", error);
        ui?.notify?.({ title: "Failed to cancel receiving", message: isFactoryPermissionError(error) ? "Your current role does not allow this Receiving action." : error.message, tone: "error" });
        return;
      }
      const refreshPage = applyReceivingMutation(batch, cancelled);
      setEditingReceiving(null);
      setModal(null);
      ui?.notify?.({ title: "Receiving Draft cancelled", tone: "success" });
      await refreshReceivingHistory(refreshPage, "cancellation");
    } finally {
      receivingMutationRef.current.delete(batch.id);
    }
  }

  async function saveRawMaterial(form) {
    try {
      await factoryService.saveRawMaterial(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save raw material", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Raw material updated" : "Raw material created", tone: "success" });
    setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveRawMaterial(material) {
    if (Number(material.current_balance || 0) > 0) {
      ui?.notify?.({ title: "Cannot archive raw material", message: "Cannot archive while stock balance is greater than zero.", tone: "error" });
      return;
    }
    const confirmed = await ui?.confirm?.({
      title: "Archive Raw Material?",
      message: `${rawMaterialLabel(material)} will no longer be available for receiving, recipe BOM setup or production usage.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveRawMaterial(material);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive raw material", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Raw material archived", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function saveRawMaterialCategory(form, options = {}) {
    try {
      await factoryService.saveRawMaterialCategory(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save raw material category", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Raw material category updated" : "Raw material category created", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveRawMaterialCategory(category, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Raw Material Category?",
      message: `${category.name} will remain on existing raw materials but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveRawMaterialCategory(category);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive raw material category", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Raw material category archived", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function saveStorageLocation(form, options = {}) {
    try {
      await factoryService.saveStorageLocation(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save storage location", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Storage location updated" : "Storage location created", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveStorageLocation(location, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Storage Location?",
      message: `${location.location_name} will remain on existing records but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveStorageLocation(location);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive storage location", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Storage location archived", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function saveFactorySupplier(form, options = {}) {
    try {
      await factoryService.saveFactorySupplier(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Factory supplier", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Factory supplier updated" : "Factory supplier created", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveFactorySupplier(supplier, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Factory Supplier?",
      message: `${supplier.supplier_name} will remain on historical receiving documents but cannot be selected for new receiving.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFactorySupplier(supplier);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Factory supplier", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Factory supplier archived", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function restoreFactorySupplier(supplier) {
    const confirmed = await ui?.confirm?.({
      title: "Restore Factory Supplier?",
      message: `${supplier.supplier_name} will become available for new raw material receiving documents.`,
      confirmLabel: "Restore",
      tone: "info",
    });
    if (!confirmed) return;
    try {
      await factoryService.saveFactorySupplier({ ...supplier, status: "active" }, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to restore Factory supplier", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Factory supplier restored", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function saveFactoryCustomer(form, options = {}) {
    try {
      await factoryService.saveFactoryCustomer(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Factory customer", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Factory customer updated" : "Factory customer created", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveFactoryCustomer(customer, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Factory Customer?",
      message: `${customer.customer_name} will remain on historical dispatch documents but cannot be selected for new dispatch.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFactoryCustomer(customer);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Factory customer", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Factory customer archived", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function restoreFactoryCustomer(customer) {
    const confirmed = await ui?.confirm?.({
      title: "Restore Factory Customer?",
      message: `${customer.customer_name} will become available for new finished goods dispatch documents.`,
      confirmLabel: "Restore",
      tone: "info",
    });
    if (!confirmed) return;
    try {
      await factoryService.saveFactoryCustomer({ ...customer, status: "active" }, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to restore Factory customer", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Factory customer restored", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function completeProduction(form) {
    try {
      await factoryService.completeProduction(form);
    } catch (error) {
      console.error("factory.production.complete", error);
      const operatorMessage = productionCompletionOperatorError(error);
      ui?.notify?.({ title: "Failed to complete production", message: operatorMessage, tone: "error" });
      const safeError = new Error(operatorMessage);
      safeError.code = error?.code;
      throw safeError;
    }
    ui?.notify?.({ title: "Production completed", message: "Exact Raw Material batches were deducted and finished goods were stocked in.", tone: "success" });
    setModal(null);
    try {
      await loadData();
      if (serverListing === "job-orders") factoryListingActions.retry();
    } catch (refreshError) {
      console.error("factory.production.refresh_after_completion", refreshError);
      ui?.notify?.({ title: "Production completed, but the latest Factory data could not be refreshed.", tone: "warning" });
    }
  }

  async function saveStockCheck(stockType, form) {
    const mutationKey = `${stockType}:${form.id || "new"}:${form.status === "submitted" ? "submit" : "save"}`;
    if (stockCheckMutationRef.current.has(mutationKey)) return null;
    stockCheckMutationRef.current.add(mutationKey);
    let saved;
    try {
      saved = await factoryService.saveStockCheck(stockType, form, auth?.profile?.id);
    } catch (error) {
      console.error(`[Factory] Unable to save ${stockType} Stock Check.`, error);
      ui?.notify?.({ title: "Unable to save Stock Check.", tone: "error" });
      stockCheckMutationRef.current.delete(mutationKey);
      throw error;
    }
    try {
      ui?.notify?.({ title: form.status === "submitted" ? "Stock Check submitted." : "Stock Check draft saved.", tone: "success" });
      setModal(null);
      const listing = stockType === "raw" ? "raw-stock-checks" : "product-stock-checks";
      if (serverListing === listing) {
        factoryListingActions.updateLoadedSnapshot(({ rows, total, page, pageSize, summary }) => {
          const existingIndex = rows.findIndex((row) => row.id === saved.id);
          const nextRows = existingIndex >= 0
            ? rows.map((row, index) => index === existingIndex ? saved : row)
            : page === 1 ? [saved, ...rows].slice(0, pageSize) : rows;
          const previous = existingIndex >= 0 ? rows[existingIndex] : null;
          const varianceCount = (check) => (check?.items || []).filter((item) => item.count_status !== "skip" && item.variance_status !== "Skipped" && Number(item.variance_qty || 0) !== 0).length;
          return {
            rows: nextRows,
            total: Math.max(0, Number(total || 0) + (existingIndex < 0 ? 1 : 0)),
            summary: {
              ...(summary || {}),
              checks: Math.max(0, Number(summary?.checks || 0) + (existingIndex < 0 ? 1 : 0)),
              submitted: Math.max(0, Number(summary?.submitted || 0) - (previous?.status === "submitted" ? 1 : 0) + (saved.status === "submitted" ? 1 : 0)),
              variance_rows: Math.max(0, Number(summary?.variance_rows || 0) - varianceCount(previous) + varianceCount(saved)),
            },
          };
        });
        try {
          await factoryListingActions.refreshNow({
            page: factoryListingPage.loadedPage,
            pageSize: factoryListingPage.loadedPageSize,
            errorMessage: "Stock Check was updated, but the latest list could not be refreshed.",
          });
        } catch (refreshError) {
          console.error(`[Factory] ${stockType} Stock Check saved but listing refresh failed.`, refreshError);
          ui?.notify?.({ title: "Stock Check list refresh needed", message: "Stock Check was updated, but the latest list could not be refreshed.", tone: "warning" });
        }
      }
      return saved;
    } finally {
      stockCheckMutationRef.current.delete(mutationKey);
    }
  }

  async function saveProductionSop(form) {
    try {
      await factoryService.saveProductionSop(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Production SOP", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Production SOP updated" : "Production SOP created", tone: "success" });
    setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function activateProductionSop(sop) {
    try {
      await factoryService.activateProductionSop(sop);
    } catch (error) {
      ui?.notify?.({ title: "Failed to activate Production SOP", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Production SOP activated", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function createProductionSopNewVersion(sop) {
    let draft;
    try {
      draft = await factoryService.createProductionSopNewVersion(sop);
    } catch (error) {
      ui?.notify?.({ title: "Failed to create SOP version", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Production SOP draft version created", tone: "success" });
    setModal({ type: "sop", value: draft });
    await refreshFactoryAfterMutation();
  }

  async function archiveProductionSop(sop) {
    try {
      await factoryService.archiveProductionSop(sop);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Production SOP", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Production SOP archived", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function restoreProductionSop(sop) {
    try {
      await factoryService.restoreProductionSop(sop);
    } catch (error) {
      ui?.notify?.({ title: "Failed to restore Production SOP", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Production SOP restored as draft", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function deleteProductionSop(sop) {
    try {
      await factoryService.deleteProductionSop(sop);
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete Production SOP", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Production SOP deleted", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function createQcChecklistTemplate(form) {
    try {
      await factoryService.createQcChecklistTemplate(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to create QC Checklist Preset", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "QC Checklist Preset created", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function updateQcChecklistTemplate(form) {
    try {
      await factoryService.updateQcChecklistTemplate(form);
    } catch (error) {
      ui?.notify?.({ title: "Failed to update QC Checklist Preset", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "QC Checklist Preset updated", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function archiveQcChecklistTemplate(template) {
    try {
      await factoryService.archiveQcChecklistTemplate(template);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive QC Checklist Preset", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "QC Checklist Preset archived", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function restoreQcChecklistTemplate(template) {
    try {
      await factoryService.restoreQcChecklistTemplate(template);
    } catch (error) {
      ui?.notify?.({ title: "Failed to restore QC Checklist Preset", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "QC Checklist Preset restored", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function deleteQcChecklistTemplate(template) {
    try {
      await factoryService.deleteQcChecklistTemplate(template);
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete QC Checklist Preset", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "QC Checklist Preset deleted", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function saveProductRecipe(form) {
    try {
      await factoryService.saveProductRecipe(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save product recipe", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Product recipe updated" : "Product recipe created", tone: "success" });
    setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function openNewRecipeVersion(recipe) {
    let draftCopy;
    try {
      draftCopy = await factoryService.createProductRecipeNewVersion(recipe);
    } catch (error) {
      ui?.notify?.({ title: "Failed to create new version", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Draft version created", tone: "success" });
    await refreshFactoryAfterMutation();
    return draftCopy;
  }

  async function activateProductRecipe(recipe) {
    const confirmed = await ui?.confirm?.({
      title: "Activate Product Recipe?",
      message: `${recipeOperatorIdentity(recipe)} will become the active recipe.`,
      confirmLabel: "Activate",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.activateProductRecipe(recipe);
    } catch (error) {
      ui?.notify?.({ title: "Failed to activate product recipe", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Product recipe activated", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function archiveProductRecipe(recipe) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Product Recipe?",
      message: `${recipeOperatorIdentity(recipe)} will remain readable for history but will not be used as an active recipe.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveProductRecipe(recipe);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive product recipe", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Product recipe archived", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function deleteProductRecipe(recipe) {
    const confirmed = await ui?.confirm?.({
      title: "Delete Draft Standard?",
      message: `${recipeOperatorIdentity(recipe)} is still a draft and will be removed with its BOM rows.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.deleteProductRecipe(recipe);
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete draft standard", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Draft production standard deleted", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function restoreProductRecipe(recipe) {
    const confirmed = await ui?.confirm?.({
      title: "Restore Product Recipe?",
      message: `${recipeOperatorIdentity(recipe)} will be restored as a draft for review before activation.`,
      confirmLabel: "Restore",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.restoreProductRecipe(recipe);
    } catch (error) {
      ui?.notify?.({ title: "Failed to restore product recipe", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Product recipe restored as draft", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  async function saveFinishedGood(form) {
    try {
      await factoryService.saveFinishedGood(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Packaging SKU", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Packaging SKU updated" : "Packaging SKU created", tone: "success" });
    setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveFinishedGood(product) {
    if (Number(product.current_balance || 0) > 0) {
      ui?.notify?.({ title: "Cannot archive Packaging SKU", message: "Cannot archive while stock balance is greater than zero.", tone: "error" });
      return;
    }
    const confirmed = await ui?.confirm?.({
      title: "Archive Packaging SKU?",
      message: `${product.product_code || product.product_name} will no longer be available for production stock-in.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFinishedGood(product);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Packaging SKU", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Packaging SKU archived", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  function dispatchMatchesHistoryFilters(dispatch) {
    if (!dispatch) return false;
    if (dispatchHistoryFilters.dateFrom && dispatch.dispatch_date < dispatchHistoryFilters.dateFrom) return false;
    if (dispatchHistoryFilters.dateTo && dispatch.dispatch_date > dispatchHistoryFilters.dateTo) return false;
    if (dispatchHistoryFilters.status && dispatch.status !== dispatchHistoryFilters.status) return false;
    if (dispatchHistoryFilters.customer) {
      const customerMatches = dispatch.customer_id === dispatchHistoryFilters.customer
        || dispatch.customer_name === dispatchHistoryFilters.customer;
      if (!customerMatches) return false;
    }
    return true;
  }

  function dispatchSummaryAfterMutation(summary, previous, next) {
    const updated = { ...(summary || {}) };
    const today = todayInput();
    const completedToday = (dispatch) => dispatch?.status === "completed"
      && String(dispatch.completed_at || dispatch.dispatch_date || "").slice(0, 10) === today;
    updated.draft = Math.max(0, Number(updated.draft || 0)
      - (previous?.status === "draft" ? 1 : 0)
      + (next?.status === "draft" ? 1 : 0));
    updated.completed_today = Math.max(0, Number(updated.completed_today || 0)
      - (completedToday(previous) ? 1 : 0)
      + (completedToday(next) ? 1 : 0));
    return updated;
  }

  function compareFinishedGoodsDispatchesDesc(left, right) {
    return String(right.dispatch_date || "").localeCompare(String(left.dispatch_date || ""))
      || String(right.created_at || "").localeCompare(String(left.created_at || ""))
      || String(right.id || "").localeCompare(String(left.id || ""));
  }

  function applyFinishedGoodsDispatchMutation({ previous = null, next = null }) {
    const currentRows = factoryListingPage.hasLoaded ? factoryListingPage.rows : [];
    const previousMatches = dispatchMatchesHistoryFilters(previous);
    const nextMatches = dispatchMatchesHistoryFilters(next);
    const existingIndex = currentRows.findIndex((row) => row.id === (next?.id || previous?.id));
    const removesVisibleRow = existingIndex >= 0 && !nextMatches;
    const refreshPage = removesVisibleRow && currentRows.length === 1 && factoryListingPage.loadedPage > 1
      ? factoryListingPage.loadedPage - 1
      : factoryListingPage.loadedPage;
    const today = todayInput();
    const affectsCustomersToday = [previous, next].some((dispatch) => dispatch?.status === "completed"
      && String(dispatch.completed_at || dispatch.dispatch_date || "").slice(0, 10) === today);
    if (affectsCustomersToday) setDispatchCustomersTodayUpdating(true);

    factoryListingActions.updateLoadedSnapshot(({ rows, summary, total, page, pageSize }) => {
      let updatedRows = rows;
      const rowIndex = rows.findIndex((row) => row.id === (next?.id || previous?.id));
      if (rowIndex >= 0) {
        updatedRows = nextMatches
          ? rows.map((row, index) => index === rowIndex ? next : row).sort(compareFinishedGoodsDispatchesDesc)
          : rows.filter((_, index) => index !== rowIndex);
      } else if (nextMatches && page === 1) {
        updatedRows = [...rows, next]
          .sort(compareFinishedGoodsDispatchesDesc)
          .slice(0, pageSize);
      }
      const totalDelta = (nextMatches ? 1 : 0) - (previousMatches ? 1 : 0);
      return {
        rows: updatedRows,
        summary: dispatchSummaryAfterMutation(summary, previous, next),
        total: Math.max(0, Number(total || 0) + totalDelta),
      };
    });
    return refreshPage;
  }

  async function refreshFinishedGoodsDispatches({ page, reason }) {
    try {
      const refreshed = await factoryListingActions.refreshNow({
        page,
        pageSize: factoryListingPage.loadedPageSize,
        errorMessage: "Dispatch was updated, but the latest list could not be refreshed.",
      });
      if (refreshed) setDispatchCustomersTodayUpdating(Boolean(refreshed.summaryError));
    } catch (refreshError) {
      console.error(`[Factory] Finished Goods Dispatch ${reason} succeeded but listing refresh failed.`, refreshError);
      if (isFactoryPermissionError(refreshError)) {
        setDispatchCustomersTodayUpdating(false);
        setModal((current) => current?.type === "finished-good-dispatch" ? null : current);
        ui?.notify?.({ title: "Dispatch data hidden", message: "Some Finished Goods Dispatch data is hidden by your current role.", tone: "error" });
        return;
      }
      ui?.notify?.({
        title: "Dispatch list refresh needed",
        message: "Dispatch was updated, but the latest list could not be refreshed.",
        tone: "warning",
      });
    }
  }

  async function saveFinishedGoodDispatch(form) {
    const previous = form.id ? factoryListingPage.rows.find((row) => row.id === form.id) || form : null;
    let saved;
    try {
      saved = await factoryService.saveFinishedGoodDispatch(form);
    } catch (error) {
      const message = finishedGoodDispatchOperatorError(error, "Unable to save the Dispatch Draft. Please retry.");
      console.error("[Factory] Unable to save Finished Goods Dispatch.", error);
      if (isFactoryPermissionError(error)) {
        setModal(null);
        setDispatchTab("history");
      }
      ui?.notify?.({ title: "Failed to save dispatch", message, tone: "error" });
      throw new Error(message);
    }
    let refreshPage = factoryListingPage.loadedPage;
    try {
      refreshPage = applyFinishedGoodsDispatchMutation({ previous, next: saved });
    } catch (snapshotError) {
      console.error("[Factory] Dispatch Draft saved, but its local listing snapshot could not be updated.", snapshotError);
    }
    setModal(null);
    if (!form.id) setDispatchTab("history");
    ui?.notify?.({ title: form.id ? "Dispatch updated" : "Dispatch draft created", tone: "success" });
    void refreshFinishedGoodsDispatches({ page: refreshPage, reason: form.id ? "save" : "create" });
    return saved;
  }

  async function saveAndCompleteFinishedGoodDispatch(form) {
    let completed;
    try {
      completed = await factoryService.saveAndCompleteFinishedGoodDispatch(form);
    } catch (error) {
      const message = finishedGoodDispatchOperatorError(error, "Unable to complete the Dispatch. Please retry.");
      console.error("[Factory] Unable to save and complete Finished Goods Dispatch.", error);
      if (isFactoryPermissionError(error)) {
        setModal(null);
        setDispatchTab("history");
      }
      ui?.notify?.({ title: "Failed to complete dispatch", message, tone: "error" });
      throw new Error(message);
    }
    let refreshPage = factoryListingPage.loadedPage;
    try {
      refreshPage = applyFinishedGoodsDispatchMutation({ previous: form.id ? form : null, next: completed });
    } catch (snapshotError) {
      console.error("[Factory] Dispatch completed, but its local listing snapshot could not be updated.", snapshotError);
    }
    setDispatchTab("history");
    setModal({ type: "finished-good-dispatch", value: completed, mode: "view" });
    ui?.notify?.({ title: "Dispatch completed successfully.", tone: "success" });
    void refreshFinishedGoodsDispatches({ page: refreshPage, reason: "direct completion" });
    void loadData({ silent: true });
    return completed;
  }

  async function completeFinishedGoodDispatch(dispatch) {
    const actionKey = `dispatch:${dispatch.id}`;
    if (dispatchMutationRef.current.has(actionKey)) return;
    dispatchMutationRef.current.add(actionKey);
    try {
      const confirmed = await ui?.confirm?.({
        title: "Complete Finished Goods Dispatch?",
        message: `${dispatch.dispatch_no} will deduct finished goods stock and create Product Movement stock-out rows.`,
        confirmLabel: "Complete Dispatch",
        tone: "warning",
      });
      if (!confirmed) return;
      let completed;
      try {
        completed = await factoryService.completeFinishedGoodDispatch(dispatch);
      } catch (error) {
        ui?.notify?.({ title: "Failed to complete dispatch", message: error.message, tone: "error" });
        return;
      }
      let refreshPage = factoryListingPage.loadedPage;
      try {
        refreshPage = applyFinishedGoodsDispatchMutation({ previous: dispatch, next: completed });
      } catch (snapshotError) {
        console.error("[Factory] Dispatch completed, but its local listing snapshot could not be updated.", snapshotError);
      }
      setModal((current) => current?.type === "finished-good-dispatch" && current.value?.id === dispatch.id ? null : current);
      ui?.notify?.({ title: "Dispatch completed", message: "Finished goods stock-out movement created.", tone: "success" });
      void refreshFinishedGoodsDispatches({ page: refreshPage, reason: "completion" });
      void loadData({ silent: true });
    } finally {
      dispatchMutationRef.current.delete(actionKey);
    }
  }

  async function cancelFinishedGoodDispatch(dispatch) {
    const actionKey = `dispatch:${dispatch.id}`;
    if (dispatchMutationRef.current.has(actionKey)) return;
    dispatchMutationRef.current.add(actionKey);
    try {
      const confirmed = await ui?.confirm?.({
        title: "Cancel Finished Goods Dispatch?",
        message: `${dispatch.dispatch_no} will be marked cancelled. Stock will not be adjusted.`,
        confirmLabel: "Cancel Dispatch",
        tone: "danger",
      });
      if (!confirmed) return;
      let cancelled;
      try {
        cancelled = await factoryService.cancelFinishedGoodDispatch(dispatch);
      } catch (error) {
        ui?.notify?.({ title: "Failed to cancel dispatch", message: error.message, tone: "error" });
        return;
      }
      let refreshPage = factoryListingPage.loadedPage;
      try {
        refreshPage = applyFinishedGoodsDispatchMutation({ previous: dispatch, next: cancelled });
      } catch (snapshotError) {
        console.error("[Factory] Dispatch cancelled, but its local listing snapshot could not be updated.", snapshotError);
      }
      setModal((current) => current?.type === "finished-good-dispatch" && current.value?.id === dispatch.id ? null : current);
      ui?.notify?.({ title: "Dispatch cancelled", tone: "success" });
      void refreshFinishedGoodsDispatches({ page: refreshPage, reason: "cancellation" });
    } finally {
      dispatchMutationRef.current.delete(actionKey);
    }
  }

  async function saveProductGroup(form) {
    try {
      await factoryService.saveProductFamily(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Finished Good", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Finished Good updated" : "Finished Good created", tone: "success" });
    setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveProductGroup(group) {
    const activeSkus = data.finishedGoods.filter((product) => product.product_family_id === group.id && product.status === "active");
    if (activeSkus.length) {
      ui?.notify?.({ title: "Cannot archive Finished Good", message: "Archive or move active Packaging SKUs before archiving this Finished Good.", tone: "error" });
      return;
    }
    const confirmed = await ui?.confirm?.({
      title: "Archive Finished Good?",
      message: `${group.name_en} will remain on existing Packaging SKUs but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveProductFamily(group);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Finished Good", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Finished Good archived", tone: "success" });
    await refreshFactoryAfterMutation();
  }

  function openPackagingSkuModal(group, sku) {
    const category = data.finishedGoodCategories.find((item) => item.id === group?.category_id);
    setModal({
      type: "finished-good",
      value: sku || {
        product_family_id: group?.id || "",
        product_family_name: group?.name_en || "",
        product_name: group?.name_en || "",
        product_name_en: group?.name_en || "",
        product_name_cn: group?.name_cn || "",
        product_name_bm: group?.name_bm || "",
        category_id: group?.category_id || "",
        category: category?.name || group?.category || "",
        status: "active",
      },
    });
  }

  async function saveFinishedGoodCategory(form, options = {}) {
    try {
      await factoryService.saveFinishedGoodCategory(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save finished good category", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Finished good category updated" : "Finished good category created", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function archiveFinishedGoodCategory(category, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Finished Good Category?",
      message: `${category.name} will remain on existing products but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFinishedGoodCategory(category);
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive finished good category", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Finished good category archived", tone: "success" });
    if (!options.keepOpen) setModal(null);
    await refreshFactoryAfterMutation();
  }

  async function approveStockCheck(stockType, check) {
    const mutationKey = `${stockType}:approve:${check.id}`;
    if (stockCheckMutationRef.current.has(mutationKey)) return;
    stockCheckMutationRef.current.add(mutationKey);
    const label = stockType === "raw" ? "Raw Material Stock Check" : "Finished Goods Stock Check";
    try {
      const confirmed = await ui?.confirm?.({
        title: `Approve ${label}?`,
        message: `${check.check_no} will adjust inventory balances and create movement logs. Draft and submitted checks do not adjust stock until this approval.`,
        confirmLabel: "Approve",
        tone: "warning",
      });
      if (!confirmed) return;
      try {
        await factoryService.approveStockCheck(stockType, check, auth?.profile?.id);
      } catch (error) {
        console.error("[Factory] Unable to approve Stock Check.", error);
        const staleBatch = String(error?.message || "").includes("Batch stock has changed");
        ui?.notify?.({
          title: "Unable to approve Stock Check.",
          message: staleBatch ? "Batch stock has changed. Review the suggested resolution again." : "Review the Stock Check and try again.",
          tone: "error",
        });
        return;
      }

      const approved = {
        ...check,
        status: "approved",
        approved_by: auth?.profile?.id || "",
        approved_by_name: auth?.profile?.nickname || auth?.profile?.full_name || "",
        approved_at: new Date().toISOString(),
      };
      factoryListingActions.updateLoadedSnapshot(({ rows, summary }) => ({
        rows: rows.map((row) => row.id === check.id ? approved : row),
        summary: {
          ...(summary || {}),
          submitted: Math.max(0, Number(summary?.submitted || 0) - 1),
        },
      }));
      setModal((current) => current?.type === "stock-check" && current?.value?.id === check.id ? null : current);
      ui?.notify?.({ title: "Stock check approved", message: "Inventory adjustment movement created.", tone: "success" });

      loadData().catch((refreshError) => console.error("[Factory] Stock Check approved but Factory balance refresh failed.", refreshError));
      try {
        await factoryListingActions.refreshNow({
          page: factoryListingPage.loadedPage,
          pageSize: factoryListingPage.loadedPageSize,
          errorMessage: "Stock Check was updated, but the latest list could not be refreshed.",
        });
      } catch (refreshError) {
        console.error("[Factory] Stock Check approved but listing refresh failed.", refreshError);
        ui?.notify?.({ title: "Stock Check list refresh needed", message: "Stock Check was updated, but the latest list could not be refreshed.", tone: "warning" });
      }
    } finally {
      stockCheckMutationRef.current.delete(mutationKey);
    }
  }

  async function deleteStockCheck(stockType, check) {
    const mutationKey = `${stockType}:delete:${check.id}`;
    if (stockCheckMutationRef.current.has(mutationKey)) return;
    stockCheckMutationRef.current.add(mutationKey);
    try {
      const confirmed = await ui?.confirm?.({
        title: "Delete Draft Stock Check?",
        message: `${check.check_no || "Draft stock check"} will be removed. Submitted and approved stock checks cannot be deleted.`,
        confirmLabel: "Delete Draft",
        tone: "danger",
      });
      if (!confirmed) return;
      try {
        await factoryService.deleteStockCheck(stockType, check);
      } catch (error) {
        console.error("[Factory] Unable to delete Stock Check.", error);
        ui?.notify?.({ title: "Failed to delete stock check", message: "Review the Stock Check and try again.", tone: "error" });
        return;
      }

      factoryListingActions.updateLoadedSnapshot(({ rows, total, summary }) => ({
        rows: rows.filter((row) => row.id !== check.id),
        total: Math.max(0, Number(total || 0) - 1),
        summary: {
          ...(summary || {}),
          checks: Math.max(0, Number(summary?.checks || 0) - 1),
        },
      }));
      setModal((current) => current?.type === "stock-check" && current?.value?.id === check.id ? null : current);
      ui?.notify?.({ title: "Draft stock check deleted", tone: "success" });

      loadData().catch((refreshError) => console.error("[Factory] Stock Check deleted but Factory data refresh failed.", refreshError));
      try {
        await factoryListingActions.refreshNow({
          page: factoryListingPage.loadedPage,
          pageSize: factoryListingPage.loadedPageSize,
          errorMessage: "Stock Check was updated, but the latest list could not be refreshed.",
        });
      } catch (refreshError) {
        console.error("[Factory] Stock Check deleted but listing refresh failed.", refreshError);
        ui?.notify?.({ title: "Stock Check list refresh needed", message: "Stock Check was updated, but the latest list could not be refreshed.", tone: "warning" });
      }
    } finally {
      stockCheckMutationRef.current.delete(mutationKey);
    }
  }

  const jobColumns = [
    { key: "planned_date", label: "Scheduled Date", render: (row) => formatFactoryDate(row.planned_date) },
    { key: "job_order_no", label: "JO No", render: (row) => <div className="font-bold text-text-primary">{row.job_order_no}</div> },
    { key: "finished_good", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{jobFinishedGoodName(row)}</div><div className="text-xs text-text-secondary">{row.product_name_cn || row.product_name_bm || "Finished Good"}</div></div> },
    { key: "product_code", label: "Packaging SKU", render: (row) => <div><div className="font-semibold text-text-primary">{row.variant_name || packSizeText(row) || "Packaging SKU"}</div><div className="text-xs text-text-secondary">{row.product_code || "No SKU"}</div></div> },
    { key: "target", label: "Target Production Qty", render: (row) => <div className="font-semibold text-text-primary">{quantity(row.target_production_qty ?? row.target_quantity, row.uom)}</div> },
    { key: "estimated_pack_qty", label: "Estimated Pack Qty", render: (row) => quantity(row.target_pack_qty, "packs") },
    { key: "manufacturing_date", label: "Manufacturing Date", render: (row) => row.status === "completed" && row.manufacturing_date ? formatFactoryDate(row.manufacturing_date) : "—" },
    { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{jobStatusLabel(row.status)}</Badge> },
    { key: "production_qc", label: "Production / QC", render: (row) => <Badge tone={productionQcTone(row.production_qc_status)}>{productionQcDisplayLabel(row.production_qc_status)}</Badge> },
    { key: "created_by", label: "Created By", render: (row) => row.created_by_name || row.created_by || "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        {["draft", "planned"].includes(row.status) && can("factory_job_orders.edit") ? (
          <button className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" type="button" onClick={() => releaseJobOrder(row)}>Release</button>
        ) : null}
        {row.status === "released" && can("factory_production.complete") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "start-production", job: row })}><Play size={13} /> Start Production</button>
        ) : null}
        {["planned", "released"].includes(row.status) ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row, readOnly: true })}>View</button> : null}
        {row.status === "planned" && can("factory_job_orders.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row, readOnly: false })}>Edit</button> : null}
        {["planned", "released"].includes(row.status) && can("factory_job_orders.cancel") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => cancelJobOrder(row)}>Cancel</button> : null}
        {row.status === "in_progress" && (can("factory_production.view") || can("factory_production.complete")) ? (
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production-process", job: row, readOnly: !can("factory_production.complete") })}>View Process</button>
        ) : null}
        {row.status === "in_progress" && can("factory_production.complete") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production", job: row })}>Complete</button>
        ) : null}
        {row.status === "draft" && can("factory_job_orders.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row, readOnly: false })}>Edit</button> : null}
        {row.status === "completed" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => viewCompletedJobOrder(row)}>View</button> : null}
        {row.status === "cancelled" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row, readOnly: true })}>View</button> : null}
        {row.status === "draft" && can("factory_job_orders.delete") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => deleteJobOrder(row)}>Delete</button> : null}
      </div>
    ) },
  ];

  const receivingBatchColumns = [
    { key: "received_date", label: "Received Date", render: (row) => formatFactoryDate(row.received_date) },
    { key: "batch_no", label: "Receiving No.", render: (row) => <div><div className="font-bold text-text-primary">{row.batch_no || "—"}</div>{row.reference_no ? <div className="text-xs text-text-secondary">DO: {row.reference_no}</div> : null}</div> },
    { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
    { key: "items_count", label: "Items", render: (row) => Number(row.items_count || 0).toLocaleString("en-MY") },
    { key: "total_qty", label: "Quantity", render: (row) => {
      const totals = (row.items || []).reduce((values, item) => ({ ...values, [item.uom || "units"]: Number(values[item.uom || "units"] || 0) + Number(item.received_qty || 0) }), {});
      return Object.entries(totals).map(([uom, value]) => quantity(value, uom)).join(" · ") || "—";
    } },
    { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{jobStatusLabel(row.status)}</Badge> },
    { key: "created_by", label: "Created By", render: (row) => row.created_by_name || "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "receiving-batch-detail", value: row })}>View</button>
        {row.status === "draft" && can("factory_raw_receiving.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => { setEditingReceiving(row); setReceivingTab("receive"); }}>Edit</button> : null}
        {row.status === "draft" && can("factory_raw_receiving.edit") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => completeReceivingBatch(row)}><PackageCheck size={13} /> Complete</button> : null}
        {row.status === "draft" && can("factory_raw_receiving.delete") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => cancelReceivingBatch(row)}>Cancel</button> : null}
      </div>
    ) },
  ];

  const productionColumns = [
    { key: "production", label: "Production Batch", render: (row) => <div><div className="font-bold text-text-primary">{productionBatchReference(row)}</div><div className="text-xs text-text-secondary">{row.product_name} · {productionJobOrderReference(row)}</div></div> },
    { key: "production_date", label: "Date", render: (row) => formatFactoryDate(row.production_date) },
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
    { key: "current_balance", label: "On Hand", render: (row) => skuBalanceLabel(row) },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
  ];

  function renderSopActions(row) {
    return (
      <div className="flex flex-wrap justify-end gap-2" onClick={(event) => event.stopPropagation()}>
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "sop-detail", value: row })}>View</button>
        {row.status === "draft" && can("factory_production_sop.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "sop", value: row })}>Edit</button> : null}
        {row.status === "draft" && (can("factory_production_sop.edit") || can("factory_production_sop.manage")) ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => activateProductionSop(row)}>Activate</button> : null}
        {row.status === "draft" && can("factory_production_sop.delete") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => deleteProductionSop(row)}>Delete</button> : null}
        {row.status === "active" && can("factory_production_sop.create") ? <button className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" type="button" onClick={() => createProductionSopNewVersion(row)}>New Version</button> : null}
        {row.status === "active" && can("factory_production_sop.delete") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => archiveProductionSop(row)}>Archive</button> : null}
        {row.status === "archived" && can("factory_production_sop.edit") ? <button className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" type="button" onClick={() => restoreProductionSop(row)}>Restore</button> : null}
      </div>
    );
  }

  const sopColumns = [
    { key: "version", label: "Version", render: (row) => <Badge tone="info">{row.version || "v1"}</Badge> },
    { key: "steps", label: "Steps", render: (row) => row.steps?.length || 0 },
    { key: "qc", label: "QC Points", render: (row) => { const count = (row.steps || []).reduce((sum, step) => sum + (step.qc_checks?.length || ((step.qc_required || step.is_qc_checkpoint) ? 1 : 0)), 0); return <Badge tone={count ? "warning" : "neutral"}>{count}</Badge>; } },
    { key: "estimated_time", label: "Estimated Time", render: (row) => sopMinutesLabel(sopTotalEstimatedMinutes(row)) },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : row.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(row.status)}</Badge> },
    { key: "updated", label: "Updated", render: (row) => formatFactoryDate(row.updated_at) },
    { key: "actions", label: "Actions", align: "right", render: renderSopActions },
  ];


  function stockCheckColumns(stockType) {
    const renderActions = (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "stock-check", stockType, value: row, readOnly: true })}>View</button>
        {row.status === "draft" && can(stockType === "raw" ? "factory_raw_stock_check.edit" : "factory_product_stock_check.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "stock-check", stockType, value: row })}>Edit</button> : null}
        {row.status === "draft" && can(stockType === "raw" ? "factory_raw_stock_check.submit" : "factory_product_stock_check.submit") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "stock-check", stockType, value: row })}>Submit</button> : null}
        {row.status === "submitted" && can(stockType === "raw" ? "factory_raw_stock_check.approve" : "factory_product_stock_check.approve") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => approveStockCheck(stockType, row)}>Approve</button> : null}
        {row.status === "draft" && can(stockType === "raw" ? "factory_raw_stock_check.delete" : "factory_product_stock_check.edit") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteStockCheck(stockType, row)}>Delete</button> : null}
      </div>
    );
    return [
      { key: "check_date", label: "Date", render: (row) => formatFactoryDate(row.check_date) },
      { key: "created_by", label: "Created By", render: (row) => row.created_by_name || "—" },
      { key: "check_no", label: "Check No.", render: (row) => <div className="font-bold text-text-primary">{row.check_no}</div> },
      { key: "counted", label: "Counted", render: (row) => (row.items || []).filter((item) => item.count_status !== "skip" && item.variance_status !== "Skipped" && item.count_status !== "pending").length },
      { key: "skipped", label: "Skipped", render: (row) => (row.items || []).filter((item) => item.count_status === "skip" || item.variance_status === "Skipped").length },
      { key: "variance", label: "Variance", render: (row) => {
        const summary = stockCheckVarianceSummary(row.items || []);
        return <Badge tone={summary.tone}>{summary.label}</Badge>;
      } },
      { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{jobStatusLabel(row.status)}</Badge> },
      { key: "submitted_by", label: "Submitted By", render: (row) => row.submitted_by_name || "—" },
      { key: "approved_by", label: "Approved By", render: (row) => row.approved_by_name || "—" },
      { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
      { key: "actions", label: "Actions", align: "right", render: renderActions },
    ];
  }

  function stockCheckHistoryList(stockType, rows, emptyTitle, emptyDescription) {
    return (
      <>
        <div className="md:hidden">
          {!rows.length ? (
            <div className="p-4"><EmptyState title={emptyTitle} description={emptyDescription} /></div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((row) => {
                const summary = stockCheckVarianceSummary(row.items || []);
                const actionsColumn = stockCheckColumns(stockType).find((column) => column.key === "actions");
                return (
                  <div key={row.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-text-muted">{formatFactoryDate(row.check_date)}</div>
                        <div className="mt-1 font-bold text-text-primary">{row.check_no || "—"}</div>
                      </div>
                      <Badge tone={statusTone(row.status)}>{jobStatusLabel(row.status)}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><div className="text-[10.5px] font-semibold text-text-muted">Counted Items</div><div className="font-bold text-text-primary">{(row.items || []).filter((item) => item.count_status !== "skip" && item.variance_status !== "Skipped" && item.count_status !== "pending").length}</div></div>
                      <div><div className="text-[10.5px] font-semibold text-text-muted">Skipped Items</div><div className="font-bold text-text-primary">{(row.items || []).filter((item) => item.count_status === "skip" || item.variance_status === "Skipped").length}</div></div>
                      <div><div className="text-[10.5px] font-semibold text-text-muted">Variance</div><Badge tone={summary.tone}>{summary.label}</Badge></div>
                      <div><div className="text-[10.5px] font-semibold text-text-muted">Created By</div><div className="font-bold text-text-primary">{row.created_by_name || "—"}</div></div>
                      <div><div className="text-[10.5px] font-semibold text-text-muted">Submitted By</div><div className="font-bold text-text-primary">{row.submitted_by_name || "—"}</div></div>
                      <div><div className="text-[10.5px] font-semibold text-text-muted">Approved By</div><div className="font-bold text-text-primary">{row.approved_by_name || "—"}</div></div>
                      <div><div className="text-[10.5px] font-semibold text-text-muted">Notes</div><div className="font-semibold text-text-primary">{row.notes || "—"}</div></div>
                    </div>
                    <div className="flex justify-end">{actionsColumn?.render(row)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="hidden md:block">
          <FactoryTable columns={stockCheckColumns(stockType)} rows={rows} emptyTitle={emptyTitle} emptyDescription={emptyDescription} />
        </div>
      </>
    );
  }

  async function openRawMaterialMovementReference(movement) {
    if (!movement.document_id || !movement.document_type || rawMovementReferenceLoading) return;
    setRawMovementReferenceLoading(movement.id);
    try {
      const reference = await factoryService.getRawMaterialMovementReference(movement);
      if (reference.type === "receiving") setModal({ type: "receiving-batch-detail", value: reference.value });
      else if (reference.type === "production") setModal({ type: "completed-job-result", job: reference.job, production: reference.production });
      else if (reference.type === "stock_check") setModal({ type: "stock-check", stockType: reference.stockType, value: reference.value, readOnly: true });
      else if (reference.type === "dispatch") setModal({ type: "finished-good-dispatch", value: reference.value, mode: "view" });
    } catch (referenceError) {
      console.error("[Factory] Unable to open Raw Material Movement reference.", referenceError);
      ui?.notify?.({ title: "Unable to open linked document", message: "The referenced Factory document is unavailable or hidden by your current role.", tone: "error" });
    } finally {
      setRawMovementReferenceLoading("");
    }
  }

  async function openFactoryAuditReference(event) {
    if (!event?.reference_id || !event?.reference_type || auditReferenceLoading) return;
    setAuditReferenceLoading(event.id);
    try {
      const reference = await factoryService.getFactoryAuditReference(event);
      if (reference.type === "job_order") setModal({ type: "job", value: reference.value, readOnly: true });
      else if (reference.type === "batch_traceability") setModal({ type: "audit-batch-traceability-detail", value: reference.value, loading: false, error: "" });
      else if (reference.type === "receiving") setModal({ type: "receiving-batch-detail", value: reference.value });
      else if (reference.type === "production") setModal({ type: "completed-job-result", job: reference.job, production: reference.production });
      else if (reference.type === "stock_check") setModal({ type: "stock-check", stockType: reference.stockType, value: reference.value, readOnly: true });
      else if (reference.type === "dispatch") setModal({ type: "finished-good-dispatch", value: reference.value, mode: "view" });
    } catch (referenceError) {
      console.error("[Factory] Unable to open Audit Trail reference.", referenceError);
      ui?.notify?.({
        title: "Unable to open linked document",
        message: "The referenced Factory document is unavailable or hidden by your current role.",
        tone: "error",
      });
    } finally {
      setAuditReferenceLoading("");
    }
  }

  async function openBatchTraceabilityDispatch(dispatch) {
    if (!dispatch?.dispatch_id || batchTraceabilityDispatchLoading) return;
    setBatchTraceabilityDispatchLoading(dispatch.dispatch_id);
    try {
      const detail = await factoryService.getFinishedGoodDispatchById(dispatch.dispatch_id);
      setModal({ type: "finished-good-dispatch", value: detail, mode: "view" });
    } catch (dispatchError) {
      console.error("[Factory] Unable to open Batch Traceability Dispatch.", dispatchError);
      ui?.notify?.({ title: "Unable to open Dispatch", message: "The Dispatch is unavailable or hidden by your current role.", tone: "error" });
    } finally {
      setBatchTraceabilityDispatchLoading("");
    }
  }

  function receivingHistoryFilterControls() {
    const supplierOptions = data.factorySuppliers.map((supplier) => ({ value: supplier.id, label: supplier.supplier_name, helper: supplier.supplier_code || supplier.status }));
    const fallbackSupplierOptions = [...new Set(factoryListingPage.rows.map((batch) => batch.supplier_name).filter(Boolean))]
      .filter((name) => !data.factorySuppliers.some((supplier) => supplier.supplier_name === name))
      .map((name) => ({ value: name, label: name, helper: "Legacy supplier" }));
    return (
      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 lg:grid-cols-4">
        <Field label="Date From">
          <FeedXDatePicker
            value={receivingHistoryFilters.dateFrom}
            placeholder="Start date"
            onChange={(dateFrom) => setReceivingHistoryFilters((current) => ({ ...current, dateFrom }))}
          />
        </Field>
        <Field label="Date To">
          <FeedXDatePicker
            value={receivingHistoryFilters.dateTo}
            placeholder="End date"
            onChange={(dateTo) => setReceivingHistoryFilters((current) => ({ ...current, dateTo }))}
          />
        </Field>
        <Field label="Supplier">
          <SearchableSelect
            value={receivingHistoryFilters.supplier}
            options={[{ value: "", label: "All" }, ...supplierOptions, ...fallbackSupplierOptions]}
            placeholder="All"
            searchPlaceholder="Search suppliers"
            emptyText="No matching suppliers"
            onChange={(supplier) => setReceivingHistoryFilters((current) => ({ ...current, supplier }))}
          />
        </Field>
        <div className="flex items-end">
          <button className="btn-secondary w-full" type="button" onClick={() => setReceivingHistoryFilters({ dateFrom: "", dateTo: "", supplier: "" })}>Clear</button>
        </div>
      </div>
    );
  }

  function dispatchHistoryFilterControls() {
    const customerOptions = data.factoryCustomers.map((customer) => ({ value: customer.id, label: customer.customer_name, helper: customer.customer_code || customer.customer_type || customer.status }));
    return (
      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 lg:grid-cols-5">
        <Field label="Date From">
          <FeedXDatePicker
            value={dispatchHistoryFilters.dateFrom}
            placeholder="Start date"
            onChange={(dateFrom) => setDispatchHistoryFilters((current) => ({ ...current, dateFrom }))}
          />
        </Field>
        <Field label="Date To">
          <FeedXDatePicker
            value={dispatchHistoryFilters.dateTo}
            placeholder="End date"
            onChange={(dateTo) => setDispatchHistoryFilters((current) => ({ ...current, dateTo }))}
          />
        </Field>
        <Field label="Customer">
          <SearchableSelect
            value={dispatchHistoryFilters.customer}
            options={[{ value: "", label: "All" }, ...customerOptions]}
            placeholder="All"
            searchPlaceholder="Search customers"
            emptyText="No matching customers"
            onChange={(customer) => setDispatchHistoryFilters((current) => ({ ...current, customer }))}
          />
        </Field>
        <Field label="Status">
          <SearchableSelect
            value={dispatchHistoryFilters.status}
            options={[
              { value: "", label: "All" },
              { value: "draft", label: "Draft" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            placeholder="All"
            searchPlaceholder="Search status"
            emptyText="No matching status"
            onChange={(status) => setDispatchHistoryFilters((current) => ({ ...current, status }))}
          />
        </Field>
        <div className="flex items-end">
          <button className="btn-secondary w-full" type="button" onClick={() => setDispatchHistoryFilters({ dateFrom: "", dateTo: "", customer: "", status: "" })}>Clear</button>
        </div>
      </div>
    );
  }

  const recentActivity = useMemo(() => {
    const productionRows = data.productions.map((row) => ({
      id: `production-${row.id}`,
      title: "Production Completed",
      description: `${productionBatchReference(row)} · ${row.product_name}`,
      timestamp: row.completed_at || row.created_at,
      tone: "success",
    }));
    const receivingRows = data.receivingBatches.map((row) => ({
      id: `receiving-${row.id}`,
      title: "Raw Material Received",
      description: `${row.batch_no || "Receiving"} · ${row.supplier_name || `${row.items_count || 0} item(s)`}`,
      timestamp: row.completed_at || row.created_at,
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

  function renderProductionOverview() {
    const operationalJobRows = operationalJobs.hasLoaded ? operationalJobs.jobs : [];
    const completedTodayProductions = operationalJobs.hasLoaded ? operationalJobs.productions : [];
    const productionByJobId = new Map(completedTodayProductions.map((production) => [production.job_order_id, production]));
    const outputTodayLabel = aggregateProductionOutput(operationalJobs.summary.outputByUom || []);
    const scheduledBoardJobs = operationalJobRows.filter((job) => job.status === "planned");
    const releasedBoardJobs = operationalJobRows.filter((job) => job.status === "released");
    const inProgressBoardJobs = operationalJobRows.filter((job) => job.status === "in_progress");
    const completedBoardJobs = operationalJobRows.filter((job) => job.status === "completed");
    const completionRate = Number(operationalJobs.summary.completionRate || 0);
    const jobById = new Map(operationalJobRows.map((job) => [job.id, job]));
    const startedActivities = operationalJobRows.filter((job) => job.production_date && job.start_time).map((job) => {
      const production = productionByJobId.get(job.id);
      return {
        id: `start-${job.id}`,
        ...factoryActivityDateTime(job.production_date, job.start_time, job.started_at),
        label: "Production Started",
        product: productionActivityFinishedGood(job, production),
        reference: productionActivityReference(job, production),
        operator: productionActivityOperator(job.production_operator_name),
        result: "Started",
        tone: "warning",
      };
    });
    const completedActivities = completedTodayProductions.map((production) => {
      const job = jobById.get(production.job_order_id);
      return {
        id: `complete-${production.id}`,
        ...factoryActivityDateTime(production.end_date, production.end_time, production.completed_at || production.created_at),
        label: "Production Completed",
        product: productionActivityFinishedGood(job, production),
        reference: productionActivityReference(job, production),
        operator: productionActivityOperator(production.operator_name || job?.production_operator_name),
        result: "Completed",
        tone: "success",
      };
    });
    const qcActivities = operationalJobRows.flatMap((job) => {
      const checks = (job.step_executions || []).flatMap((step) => step.qc_results || []);
      const recordedChecks = checks.filter((check) => check.checked_at);
      if (!recordedChecks.length) return [];
      const latestCheck = recordedChecks.reduce((latest, check) => new Date(check.checked_at).getTime() > new Date(latest.checked_at).getTime() ? check : latest);
      const qcState = productionQcStatus(checks);
      const production = productionByJobId.get(job.id);
      return [{
        id: `qc-${job.id}-${latestCheck.id}`,
        ...factoryActivityDateTime("", "", latestCheck.checked_at),
        label: qcState.status === "Failed" ? "QC Failed" : "QC Check",
        product: productionActivityFinishedGood(job, production),
        reference: productionActivityReference(job, production),
        operator: productionActivityOperator(latestCheck.checked_by_name || job.production_operator_name),
        result: qcState.status === "Failed" ? "Failed" : qcState.requiredTotal ? `${qcState.requiredCompleted}/${qcState.requiredTotal} Passed` : "Passed",
        tone: qcState.status === "Failed" ? "danger" : qcState.status === "Passed" ? "success" : "warning",
      }];
    });
    const productionActivity = [...startedActivities, ...completedActivities, ...qcActivities]
      .filter((activity) => activity.sortValue > 0)
      .sort((a, b) => b.sortValue - a.sortValue || b.id.localeCompare(a.id))
      .slice(0, 8);
    const productionActivityColumns = [
      { key: "date_time", label: "Date / Time", render: (row) => <div className="whitespace-nowrap"><div className="font-semibold text-text-primary">{row.dateLabel}</div><div className="text-xs text-text-muted">{row.timeLabel}</div></div> },
      { key: "event", label: "Event", render: (row) => <div className="font-semibold text-text-primary">{row.label}</div> },
      { key: "finished_good", label: "Finished Good", render: (row) => <div className="min-w-[180px] font-bold text-text-primary">{row.product}</div> },
      { key: "reference", label: "Reference", render: (row) => <div className="whitespace-nowrap font-mono text-xs font-bold text-text-secondary">{row.reference}</div> },
      { key: "operator", label: "Operator", render: (row) => <div><div className="font-semibold text-text-primary">{row.operator.name}</div>{row.operator.helper ? <div className="text-xs text-text-muted">{row.operator.helper}</div> : null}</div> },
      { key: "result", label: "Result", render: (row) => <Badge tone={row.tone}>{row.result}</Badge> },
    ];
    const overviewCards = [
      { label: "Scheduled", value: operationalJobs.hasLoaded ? Number(operationalJobs.summary.scheduled || 0) : "—", helper: "Scheduled for future production", tone: "border-slate-200 bg-white text-text-primary" },
      { label: "Released", value: operationalJobs.hasLoaded ? Number(operationalJobs.summary.released || 0) : "—", helper: "Ready to start", tone: "border-blue-200 bg-blue-50 text-blue-800" },
      { label: "In Progress", value: operationalJobs.hasLoaded ? Number(operationalJobs.summary.inProgress || 0) : "—", helper: "Currently running", tone: "border-amber-200 bg-amber-50 text-amber-800" },
      { label: "Completed Today", value: operationalJobs.hasLoaded ? Number(operationalJobs.summary.completedToday || 0) : "—", helper: "Finished today", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
      { label: "Output Today", value: operationalJobs.hasLoaded ? outputTodayLabel : "—", helper: "Total kg/L produced today", tone: "border-slate-200 bg-white text-text-primary" },
      { label: "Completion Rate", value: operationalJobs.hasLoaded ? percent(completionRate) : "—", helper: "Completed vs planned", tone: "border-primary/20 bg-primary/5 text-primary" },
    ];
    const boardColumns = [
      { key: "scheduled", title: "Schedule", helper: "Scheduled for future production", jobs: scheduledBoardJobs, accent: "border-slate-200 bg-slate-50", badge: "neutral" },
      { key: "released", title: "Released", helper: "Ready to start", jobs: releasedBoardJobs, accent: "border-blue-200 bg-blue-50", badge: "info" },
      { key: "in_progress", title: "In Progress", helper: "Currently running", jobs: inProgressBoardJobs, accent: "border-amber-200 bg-amber-50", badge: "warning" },
      { key: "completed", title: "Completed Today", helper: "Finished today", jobs: completedBoardJobs, accent: "border-emerald-200 bg-emerald-50", badge: "success" },
    ];
    const renderBoardAction = (job) => {
      if (job.status === "planned") {
        return <div className="grid grid-cols-2 gap-2">
          {can("factory_job_orders.edit") ? <button className="btn-primary justify-center px-3 py-2 text-xs" type="button" onClick={() => releaseJobOrder(job)}>Release</button> : null}
          {can("factory_job_orders.edit") ? <button className="btn-secondary justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "job", value: job, readOnly: false })}>Edit</button> : null}
          <button className="btn-secondary justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "job", value: job, readOnly: true })}>View</button>
          {can("factory_job_orders.cancel") ? <button className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => cancelJobOrder(job)}>Cancel</button> : null}
        </div>;
      }
      if (job.status === "released") {
        return <div className="grid grid-cols-2 gap-2">
          {can("factory_production.complete") ? <button className="btn-primary justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "start-production", job })}><Play size={13} /> Start</button> : null}
          <button className="btn-secondary justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "job", value: job, readOnly: true })}>View</button>
          {can("factory_job_orders.cancel") ? <button className="col-span-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => cancelJobOrder(job)}>Cancel</button> : null}
        </div>;
      }
      if (job.status === "in_progress" && can("factory_production.complete")) {
        return <div className="grid grid-cols-2 gap-2"><button className="btn-secondary justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "production-process", job, readOnly: false })}>View Process</button><button className="btn-primary justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "production", job })}>Complete Production</button></div>;
      }
      if (job.status === "in_progress" && can("factory_production.view")) {
        return <button className="btn-secondary w-full justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "production-process", job, readOnly: true })}>View Process</button>;
      }
      if (job.status === "completed") {
        return <button className="btn-secondary w-full justify-center px-3 py-2 text-xs" type="button" onClick={() => viewCompletedJobOrder(job)}>View Result</button>;
      }
      return null;
    };
    const renderJobCard = (job, columnKey) => {
      const progress = jobProgressPercent(job);
      const production = productionByJobId.get(job.id);
      return (
        <div key={job.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-base font-black leading-5 text-text-primary">{jobFinishedGoodName(job)}</div>
              <div className="mt-1 line-clamp-2 text-xs font-semibold leading-4 text-text-secondary">{jobPackagingSkuLabel(job)}</div>
              <div className="mt-2 font-mono text-[11px] font-bold text-text-muted">{job.job_order_no}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge tone={statusTone(job.status)}>{jobStatusLabel(job.status)}</Badge>
              <Badge tone={jobPriorityTone(job.priority)}>{job.priority || "Normal"}</Badge>
            </div>
          </div>
          {columnKey === "in_progress" ? <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"><span className="text-xs font-semibold text-text-muted">Production QC</span><Badge tone={productionQcTone(jobProductionQcState(job).status)}>{productionQcDisplayLabel(jobProductionQcState(job).status)}</Badge></div> : null}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
            <div className="rounded-xl border border-border px-3 py-2">
              <div className="text-text-muted">Target Production</div>
              <div className="mt-1 text-sm font-black text-text-primary">{quantity(job.target_production_qty || job.target_quantity, job.uom)}</div>
            </div>
            {columnKey === "completed" ? (
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-text-muted">Output Qty</div>
                <div className="mt-1 text-sm font-black text-text-primary">{production ? productionOutputLabel(production) : quantity(job.produced_quantity || job.target_production_qty || job.target_quantity, job.uom)}</div>
              </div>
            ) : columnKey === "in_progress" ? (
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-text-muted">Started</div>
                <div className="mt-1 text-sm font-black text-text-primary">{job.production_date && job.start_time ? `${formatFactoryDate(job.production_date)} · ${factoryTimeAmPmLabel(job.start_time)}` : "—"}</div>
              </div>
            ) : columnKey === "scheduled" ? (
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-text-muted">Scheduled Date</div>
                <div className="mt-1 text-sm font-black text-text-primary">{formatFactoryDate(job.planned_date)}</div>
              </div>
            ) : (
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-text-muted">Scheduled Date</div>
                <div className="mt-1 text-sm font-black text-blue-700">{formatFactoryDate(job.planned_date)}</div>
              </div>
            )}
          </div>
          {columnKey === "completed" ? (
            <div className="mt-3 text-xs font-semibold text-text-secondary">Completed {factoryTimeLabel(job.completed_at || production?.completed_at || production?.end_time)}</div>
          ) : (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${progressToneClass(progress)}`} style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          <div className="mt-3">{renderBoardAction(job)}</div>
        </div>
      );
    };

    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Production Overview"
          description="Monitor, release, start and complete factory production from one operational board."
        />
        {operationalJobs.error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={16} /><span>{operationalJobs.errorKind === "permission" ? operationalJobs.error : operationalJobs.hasLoaded ? "Unable to refresh operational Job Orders. Showing the last successfully loaded pipeline." : "Unable to load operational Job Orders. The production pipeline is unavailable."}</span></div>
            <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={operationalJobs.loading} onClick={loadOperationalJobs}>Retry</button>
          </div>
        ) : operationalJobs.loading ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">{operationalJobs.hasLoaded ? "Refreshing operational Job Orders…" : "Loading operational Job Orders…"}</div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {overviewCards.map((card) => (
            <div key={card.label} className={`rounded-2xl border p-4 shadow-sm ${card.tone}`}>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] opacity-80">{card.label}</div>
              <div className="mt-2 text-3xl font-black">{card.value}</div>
              <div className="mt-1 text-sm font-semibold opacity-85">{card.helper}</div>
            </div>
          ))}
        </div>
        <Card title="Production Pipeline" description="Schedule, release, execute and complete Factory production in lifecycle order.">
            {!operationalJobs.hasLoaded ? (
              <div className="p-4"><EmptyState title={operationalJobs.error ? "Production pipeline unavailable" : "Loading production pipeline"} description={operationalJobs.error ? "Retry the operational Job Order query before continuing production work." : "Loading Scheduled, Released, In Progress and today’s Completed Job Orders."} /></div>
            ) : <div className="overflow-x-auto p-4"><div className="grid min-w-[1120px] grid-cols-4 gap-4">
              {boardColumns.map((column) => (
                <div key={column.key} className={`rounded-2xl border p-3 ${column.accent}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-text-primary">{column.title}</div>
                      <div className="text-xs font-semibold text-text-secondary">{column.helper}</div>
                    </div>
                    <Badge tone={column.badge}>{column.jobs.length}</Badge>
                  </div>
                  <div className="space-y-3">
                    {column.jobs.length ? column.jobs.map((job) => renderJobCard(job, column.key)) : (
                      <div className="rounded-2xl border border-dashed border-border bg-white/80 px-3 py-6 text-center text-sm font-semibold text-text-secondary">
                        No {column.title.toLowerCase()} jobs.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div></div>}
        </Card>
        <Card title="Recent Production Activity" description="Latest production starts, meaningful QC updates and completed output.">
          {!operationalJobs.hasLoaded ? (
            <div className="p-4"><EmptyState title={operationalJobs.error ? "Production activity unavailable" : "Loading production activity"} description="Operational activity appears after the complete pipeline loads." /></div>
          ) : (
            <FactoryTable
              columns={productionActivityColumns}
              rows={productionActivity}
              emptyTitle="No production activity"
              emptyDescription="Production starts, QC updates and completed output will appear here."
            />
          )}
        </Card>
      </div>
    );
  }

  function renderJobOrders() {
    const rows = currentListingRows("job-orders", []);
    const hasFilters = Object.values(jobOrderFilters).some(Boolean);
    const finishedGoodOptions = [
      ...data.productFamilies.map((product) => ({
        value: `family:${product.id}`,
        label: product.name_en || product.product_name || "Finished Good",
        helper: "Finished Good",
      })),
      ...data.finishedGoods.map((sku) => ({
      value: `sku:${sku.id}`,
      label: [sku.product_code, sku.variant_name || packSizeText(sku)].filter(Boolean).join(" · ") || jobFinishedGoodName(sku),
      helper: `${sku.product_family_name || sku.product_name || "Finished Good"} · Packaging SKU`,
      })),
    ];

    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Job Order"
          description="Manage and review Factory production job orders."
          actions={can("factory_job_orders.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "job" })}><ClipboardList size={15} /> Create Job Order</button> : null}
        />
        <div className="grid gap-3 border-y border-border bg-white px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Search">
            <input
              className={inputClass()}
              type="search"
              value={jobOrderFilters.search}
              placeholder="JO no., product, SKU or batch"
              onChange={(event) => setJobOrderFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </Field>
          <Field label="Status">
            <SearchableSelect
              value={jobOrderFilters.status}
              options={[
                { value: "", label: "All" },
                { value: "draft", label: "Draft" },
                { value: "planned", label: "Planned" },
                { value: "released", label: "Released" },
                { value: "in_progress", label: "In Progress" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
              ]}
              placeholder="All"
              searchPlaceholder="Search status"
              onChange={(value) => setJobOrderFilters((current) => ({ ...current, status: value }))}
            />
          </Field>
          <Field label="Finished Good / Packaging SKU">
            <SearchableSelect
              value={jobOrderFilters.finishedGood}
              options={finishedGoodOptions}
              placeholder="All"
              searchPlaceholder="Search Finished Good or SKU"
              onChange={(value) => setJobOrderFilters((current) => ({ ...current, finishedGood: value }))}
            />
          </Field>
          <div className="flex items-end">
            {hasFilters ? <button className="btn-secondary w-full justify-center" type="button" onClick={() => setJobOrderFilters({ search: "", status: "", scheduledDateFrom: "", scheduledDateTo: "", manufacturingDateFrom: "", manufacturingDateTo: "", finishedGood: "" })}><RotateCcw size={14} /> Reset Filters</button> : null}
          </div>
          <Field label="Scheduled From">
            <FeedXDatePicker value={jobOrderFilters.scheduledDateFrom} onChange={(value) => setJobOrderFilters((current) => ({ ...current, scheduledDateFrom: value }))} />
          </Field>
          <Field label="Scheduled To" error={scheduledDateRangeError}>
            <FeedXDatePicker value={jobOrderFilters.scheduledDateTo} error={scheduledDateRangeError} onChange={(value) => setJobOrderFilters((current) => ({ ...current, scheduledDateTo: value }))} />
          </Field>
          <Field label="Manufacturing From">
            <FeedXDatePicker value={jobOrderFilters.manufacturingDateFrom} onChange={(value) => setJobOrderFilters((current) => ({ ...current, manufacturingDateFrom: value }))} />
          </Field>
          <Field label="Manufacturing To" error={manufacturingDateRangeError}>
            <FeedXDatePicker value={jobOrderFilters.manufacturingDateTo} error={manufacturingDateRangeError} onChange={(value) => setJobOrderFilters((current) => ({ ...current, manufacturingDateTo: value }))} />
          </Field>
        </div>
        <Card title="Job Order Records" description={jobOrderDateRangeInvalid ? "Correct the invalid date range to update these records." : factoryListingPage.hasLoaded ? `${factoryListingPage.loadedTotal} job order record(s).` : "Historical and current Job Orders."}>
          {jobOrderDateRangeInvalid ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Correct the date range to update results. Any visible rows are from the last successful query.
            </div>
          ) : listingLoadState("job-orders", "Job Orders")}
          <div className={factoryListingPage.loading && factoryListingPage.hasLoaded ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {jobOrderDateRangeInvalid && !rows.length ? null : <FactoryTable columns={jobColumns} rows={rows} emptyTitle="No Job Orders Found" emptyDescription={hasFilters ? "No Job Orders match the current filters." : "Create a Finished Good product first, then plan production demand with a Job Order."} />}
          </div>
          {!jobOrderDateRangeInvalid ? listingPagination("job-orders") : null}
        </Card>
      </div>
    );
  }

  function renderRawReceiving() {
    const activeSuppliers = data.factorySuppliers.filter((supplier) => supplier.status === "active");
    const receivingRows = currentListingRows("receiving-history", []);
    const receivingSummary = factoryListingPage.summary || {};
    const canCreateReceiving = canOpenRawMaterialReceiving(can);
    const canEditReceiving = can("factory_raw_receiving.edit");
    const showReceivingEntry = receivingTab === "receive" && (editingReceiving ? canEditReceiving : canCreateReceiving);
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Receiving"
          description="Record supplier delivery documents with multiple raw material item rows."
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Truck} label="Receiving Documents" value={factoryListingPage.hasLoaded ? Number(receivingSummary.documents || 0) : "—"} helper="Supplier delivery batches" />
          <MetricCard icon={PackageCheck} label="Items Received" value={factoryListingPage.hasLoaded ? Number(receivingSummary.items || 0) : "—"} helper="Total item rows" />
          <MetricCard icon={Warehouse} label="Total Qty" value={factoryListingPage.hasLoaded ? quantity(receivingSummary.total_qty, "") : "—"} helper="Across received items" />
          <MetricCard icon={Tag} label="Active Suppliers" value={activeSuppliers.length} helper="Available for receiving" />
        </div>
        {!showReceivingEntry ? receivingHistoryFilterControls() : null}

        <div className="inline-flex rounded-xl border border-border bg-white p-1">
          <button className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${!showReceivingEntry ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => { setEditingReceiving(null); setReceivingTab("history"); }}>Receiving History</button>
          {canCreateReceiving ? <button className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${showReceivingEntry && !editingReceiving ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => { setEditingReceiving(null); setReceivingTab("receive"); }}>Receive Raw Material</button> : null}
        </div>

        {showReceivingEntry ? (
          <RawReceivingEntryPanel
            key={editingReceiving?.id || "new-receiving"}
            initialBatch={editingReceiving}
            rawMaterials={data.rawMaterials}
            suppliers={data.factorySuppliers}
            storageLocations={data.storageLocations}
            onSave={saveReceivingBatch}
            onComplete={completeReceivingBatch}
            onCancelEdit={() => { setEditingReceiving(null); setReceivingTab("history"); }}
          />
        ) : (
          <Card title="Receiving History" description={factoryListingPage.hasLoaded ? `${factoryListingPage.loadedTotal} receiving document(s).` : "Supplier receiving documents."}>
            {listingLoadState("receiving-history", "Receiving History")}
            <FactoryTable
              columns={receivingBatchColumns}
              rows={receivingRows}
              emptyTitle="No raw material receiving"
              emptyDescription="Use Receive Raw Material to record a supplier delivery with one or more item rows."
            />
            {listingPagination("receiving-history")}
          </Card>
        )}
      </div>
    );
  }

  function renderRawMaterialMovements() {
    return <FactoryRawMaterialMovementsPage
      onNotify={ui?.notify}
      onOpenDetail={(value) => setModal({ type: "raw-material-movement-detail", value })}
      onCloseDetail={() => setModal((current) => current?.type === "raw-material-movement-detail" ? null : current)}
    />;
  }

  function renderRawStockCheck() {
    const rawStockCheckRows = currentListingRows("raw-stock-checks", data.rawStockChecks);
    const criticalRows = rawStockCheckRows
      .flatMap((check) => check.items || [])
      .filter((item) => item.variance_status !== "Skipped" && item.count_status !== "skip" && stockCheckVariance(item.system_qty, item.physical_qty).status === "Critical");
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Stock Check"
          description="Count raw material stock, submit variance for review and approve inventory adjustments."
          actions={can("factory_raw_stock_check.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "raw" })}><ClipboardCheck size={15} /> New Stock Check</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Warehouse} label="Raw Materials" value={data.rawMaterials.length} helper="Available for count" />
          <MetricCard icon={ClipboardCheck} label="Checks" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.checks || 0) : data.rawStockChecks.length} helper="Raw material checks" />
          <MetricCard icon={Clock3} label="Submitted" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.submitted || 0) : data.rawStockChecks.filter((row) => row.status === "submitted").length} helper="Awaiting approval" tone={Number(factoryListingPage.summary.submitted || data.rawStockChecks.some((row) => row.status === "submitted")) ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Critical Rows" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.critical_rows || 0) : criticalRows.length} helper="Requires review" tone={Number(factoryListingPage.summary.critical_rows || criticalRows.length) ? "danger" : "success"} />
        </div>
        <Card title="Raw Material Stock Checks" description="Draft and submitted checks do not adjust stock. Approval applies the variance adjustment.">
          {listingLoadState("raw-stock-checks", "Raw Material Stock Checks")}
          {stockCheckHistoryList("raw", rawStockCheckRows, "No raw material stock checks", "Create a stock check to capture physical counts.")}
          {listingPagination("raw-stock-checks")}
        </Card>
      </div>
    );
  }

  function renderProductionSop() {
    const qcCheckpointCount = data.sops.flatMap((sop) => sop.steps || []).reduce((sum, step) => sum + (step.qc_checks?.length || ((step.qc_required || step.is_qc_checkpoint) ? 1 : 0)), 0);
    const coveredProducts = new Set(data.sops.map((sop) => sop.finished_good_id || sop.product_name).filter(Boolean)).size;
    const visibleSopGroups = sopProductGroups.slice(sopsPager.from, sopsPager.to);
    return (
      <div className="space-y-5">
        <PageHeader
          section="Master Data"
          title="Production SOP"
          description="Manage standard process references, product steps and QC checkpoint flags."
          actions={<div className="flex flex-wrap gap-2">{can("factory_production_sop.manage") ? <button className="btn-secondary" type="button" onClick={() => setModal({ type: "qc-checklist-presets" })}><ClipboardCheck size={15} /> Manage QC Checks</button> : null}{can("factory_production_sop.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "sop" })}><FileText size={15} /> Create SOP</button> : null}</div>}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="SOPs" value={data.sops.length} helper="Standard process references" />
          <MetricCard icon={Factory} label="Products Covered" value={coveredProducts} helper="Finished goods with SOPs" />
          <MetricCard icon={Activity} label="QC Checkpoints" value={qcCheckpointCount} helper="QC required steps" />
          <MetricCard icon={CheckCircle2} label="Active SOPs" value={data.sops.filter((sop) => sop.status === "active").length} helper="Available for production" />
        </div>
        <Card title="Production SOP Records" description="SOPs are standard process references and do not represent actual production results.">
          {visibleSopGroups.length ? <div className="space-y-4">
            {visibleSopGroups.map((group) => (
              <div key={group.id} className="overflow-hidden rounded-xl border border-border bg-white">
                <div className="flex flex-col gap-1 border-b border-border bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-bold text-text-primary">{group.productName}</div>
                    {group.productNameCn ? <div className="text-sm font-semibold text-text-secondary">{group.productNameCn}</div> : null}
                  </div>
                  <Badge tone="neutral">{group.sops.length} {group.sops.length === 1 ? "Version" : "Versions"}</Badge>
                </div>
                <div className="hidden md:block">
                  <FactoryTable columns={sopColumns} rows={group.sops} />
                </div>
                <div className="divide-y divide-border md:hidden">
                  {group.sops.map((sop) => {
                    const qcPoints = (sop.steps || []).reduce((sum, step) => sum + (step.qc_checks?.length || ((step.qc_required || step.is_qc_checkpoint) ? 1 : 0)), 0);
                    return <div key={sop.id} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><Badge tone="info">{sop.version || "v1"}</Badge><div className="mt-2 text-xs font-semibold text-text-secondary">Updated {formatFactoryDate(sop.updated_at)}</div></div>
                        <Badge tone={sop.status === "active" ? "success" : sop.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(sop.status)}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div><div className="text-[10.5px] font-semibold text-text-muted">Steps</div><div className="font-bold text-text-primary">{sop.steps?.length || 0}</div></div>
                        <div><div className="text-[10.5px] font-semibold text-text-muted">QC Points</div><div className="font-bold text-text-primary">{qcPoints}</div></div>
                        <div><div className="text-[10.5px] font-semibold text-text-muted">Estimated Time</div><div className="font-bold text-text-primary">{sopMinutesLabel(sopTotalEstimatedMinutes(sop))}</div></div>
                      </div>
                      {renderSopActions(sop)}
                    </div>;
                  })}
                </div>
              </div>
            ))}
          </div> : <EmptyState title="No Production SOPs" description="Create SOP steps before attaching a standard process to production batches." />}
          <FactoryPagination page={sopsPager.page} pageSize={sopsPager.pageSize} total={sopProductGroups.length} onPageChange={sopsPager.setPage} onPageSizeChange={sopsPager.setPageSize} />
        </Card>
      </div>
    );
  }


  function renderProduction() {
    const recipeForJob = (job) => activeRecipeForSku(data.recipes, job.finished_good || job, job.product_name);
    const sopForJob = (job) => data.sops.find((sop) => sop.status !== "inactive" && sop.product_name.toLowerCase() === String(job.product_name || "").toLowerCase());
    const readinessForJob = (job) => {
      const recipe = recipeForJob(job);
      if (!recipe?.items?.length) return { label: "No recipe", tone: "warning" };
      const shortages = recipe.items.filter((item) => {
        const material = data.rawMaterials.find((raw) => raw.id === item.raw_material_id);
        const required = (Number(item.quantity_used || 0) * Number(job.target_production_qty || job.target_quantity || 0)) / (Number(recipe.yield_quantity || 1) || 1);
        return Number(material?.current_balance || 0) < required;
      });
      if (shortages.length) return { label: `${shortages.length} shortage`, tone: "danger" };
      return { label: "Ready", tone: "success" };
    };
    const readyJobs = operationalJobs.hasLoaded
      ? operationalJobs.jobs.filter((job) => ["released", "in_progress"].includes(job.status))
      : [];
    const productionHistoryRows = currentListingRows("production-history", data.productions);
    const productionReadyJobColumns = [
      { key: "job", label: "Job Order", render: (row) => <div><div className="font-bold text-text-primary">{row.job_order_no}</div><div className="text-xs text-text-secondary">{row.priority} · {jobStatusLabel(row.status)}</div></div> },
      { key: "finished_good", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{row.product_name}</div><div className="text-xs text-text-secondary">{row.product_code || "No SKU"}</div></div> },
      { key: "target", label: "Target", render: (row) => <div><div className="font-semibold text-text-primary">{quantity(row.target_pack_qty || row.target_quantity, "packs")}</div><div className="text-xs text-text-secondary">{quantity(row.target_production_qty || row.target_quantity, row.uom)}</div></div> },
      { key: "planned_date", label: "Scheduled Date", render: (row) => formatFactoryDate(row.planned_date) },
      { key: "recipe", label: "Recipe", render: (row) => {
        const recipe = recipeForJob(row);
        return <Badge tone={recipe ? "success" : "warning"}>{recipe ? recipeOperatorIdentity(recipe) : "Missing"}</Badge>;
      } },
      { key: "sop", label: "SOP", render: (row) => {
        const sop = sopForJob(row);
        return <Badge tone={sop ? "success" : "neutral"}>{sop ? sop.version || "Available" : "No SOP"}</Badge>;
      } },
      { key: "readiness", label: "RM Readiness", render: (row) => {
        const readiness = readinessForJob(row);
        return <Badge tone={readiness.tone}>{readiness.label}</Badge>;
      } },
      { key: "actions", label: "Actions", align: "right", render: (row) => can("factory_production.complete") ? (
        row.status === "in_progress"
          ? <div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production-process", job: row, readOnly: false })}>View Process</button><button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production", job: row })}>Complete</button></div>
          : <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "start-production", job: row })}><Play size={13} /> Start</button>
      ) : row.status === "in_progress" && can("factory_production.view") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production-process", job: row, readOnly: true })}>View Process</button> : null },
    ];
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Production Records"
          description="Execute job orders, capture actual material usage, deduct raw stock and stock in finished goods."
          actions={readyJobs[0] && can("factory_production.complete") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: readyJobs[0].status === "in_progress" ? "production" : "start-production", job: readyJobs[0] })}><Play size={15} /> Next Production Step</button> : null}
        />
        {operationalJobs.error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={16} /><span>{operationalJobs.hasLoaded ? "Unable to refresh operational Job Orders. Showing the last successfully loaded queue." : "Unable to load operational Job Orders. The production queue is unavailable."}</span></div>
            <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={operationalJobs.loading} onClick={loadOperationalJobs}>Retry</button>
          </div>
        ) : operationalJobs.loading ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">{operationalJobs.hasLoaded ? "Refreshing operational Job Orders…" : "Loading operational Job Orders…"}</div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Factory} label="Completed Runs" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.completed_runs || 0) : metrics.completedProductions.length} helper="Production completions" />
          <MetricCard icon={PackageCheck} label="Good Output" value={quantity(factoryListingPage.hasLoaded ? factoryListingPage.summary.good_output : metrics.totalGoodOutput, "")} helper="Finished goods stocked in" />
          <MetricCard icon={AlertTriangle} label="Wastage Qty" value={quantity(factoryListingPage.hasLoaded ? factoryListingPage.summary.wastage_qty : metrics.totalWastage, "")} helper="Reported production wastage" tone={Number(factoryListingPage.summary.wastage_qty || metrics.totalWastage) ? "warning" : "success"} />
          <MetricCard icon={Activity} label="High Variance" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.high_variance || 0) : metrics.highVarianceUsage.length} helper="Material rows above 5%" tone={Number(factoryListingPage.summary.high_variance || metrics.highVarianceUsage.length) ? "warning" : "success"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card title="Production Queue" description="Released jobs can be started. In Progress jobs can be completed.">
            {operationalJobs.hasLoaded ? <FactoryTable columns={productionReadyJobColumns} rows={readyJobs} emptyTitle="No jobs ready for production" emptyDescription="Release a draft job order before starting production." /> : <div className="p-4"><EmptyState title={operationalJobs.error ? "Production queue unavailable" : "Loading production queue"} description="The queue appears after all operational Job Orders load." /></div>}
          </Card>
          <Card title="Finished Goods Stock" description="Balances created from completed production stock-in movements.">
            <FactoryTable columns={finishedGoodsColumns} rows={data.finishedGoods.slice(0, 8)} emptyTitle="No finished goods stock" emptyDescription="Complete production to stock in finished goods." />
          </Card>
        </div>
        <Card title="Production Completion History" description={factoryListingPage.hasLoaded ? `${factoryListingPage.loadedTotal} production record(s).` : "Completed production records."}>
          {listingLoadState("production-history", "Production History")}
          <FactoryTable columns={productionColumns} rows={productionHistoryRows} emptyTitle="No production records" emptyDescription="Start production from a job order to create the first record." />
          {listingPagination("production-history")}
        </Card>
        <Card title="Finished Goods Movements" description="Stock-in movements created by production completion.">
          <FactoryTable
            columns={[
              { key: "reference_no", label: "Reference", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{formatFactoryDate(row.movement_date)}</div></div> },
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

  function renderReports() {
    const productionRows = data.productions.map((production) => {
      const cost = productionCostInfo(production, data.receivings);
      const goodOutput = Number(production.good_output_qty || 0);
      return {
        ...production,
        cost_per_batch: cost.cost,
        cost_per_unit: goodOutput ? cost.cost / goodOutput : 0,
        missing_cost_rows: cost.missingCostRows,
        unsupported_cost_rows: cost.unsupportedCostRows,
        yield_percent: productionYieldPercent(production),
        material_variance_percent: weightedMaterialVariancePercent([production]),
      };
    });
    const usageRows = data.productions.flatMap((production) => (production.material_usage || []).map((usage) => {
      const unitCost = usageUnitCostInfo(usage, data.receivings);
      return {
        id: `${production.id}-${usage.id}`,
        batch_no: production.batch_no,
        production_date: production.production_date,
        product_name: production.product_name,
        raw_material_name: usage.raw_material_name,
        standard_usage: usage.standard_usage,
        actual_usage: usage.actual_usage,
        variance_qty: usage.variance_qty,
        variance_percent: usage.variance_percent,
        unit_cost: unitCost.unitCost,
        actual_usage_cost: Number(usage.actual_usage || 0) * unitCost.unitCost,
        missing_cost: unitCost.missingCost,
        uom: usage.uom,
      };
    }));
    const yieldRows = productionRows.map((row) => ({
      id: `yield-${row.id}`,
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
    const recipeRows = metrics.recipeCostRows || [];
    const productionCostRows = metrics.productionCostRows || [];
    const costTrendRows = data.receivings.map((row) => {
      const materialReceivings = data.receivings
        .filter((item) => item.raw_material_id === row.raw_material_id && Number(item.unit_cost || 0) > 0)
        .sort((a, b) => new Date(a.received_date || a.created_at || 0) - new Date(b.received_date || b.created_at || 0));
      const index = materialReceivings.findIndex((item) => item.id === row.id);
      const previous = index > 0 ? materialReceivings[index - 1] : null;
      const change = previous ? Number(row.unit_cost || 0) - Number(previous.unit_cost || 0) : 0;
      const changePercent = previous && Number(previous.unit_cost || 0) ? (change / Number(previous.unit_cost || 0)) * 100 : 0;
      return {
        ...row,
        previous_cost: previous ? Number(previous.unit_cost || 0) : null,
        cost_change: change,
        cost_change_percent: changePercent,
      };
    });
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
          <MetricCard icon={CheckCircle2} label="Production Yield" value={percent(metrics.productionYield)} helper="Good output / actual produced" tone={metrics.productionYield >= 90 ? "success" : "warning"} />
          <MetricCard icon={Activity} label="Material Variance" value={percent(metrics.materialVariancePercent)} helper="Usage-row variance; review UOM mix" tone={Math.abs(metrics.materialVariancePercent) > 5 ? "warning" : "success"} />
          <MetricCard icon={PackageCheck} label="Actual Cost" value={money(metrics.estimatedProductionCost)} helper="Known-cost actual usage" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Recipe Costing Report" description="Standard recipe cost is a read-only reference based on recipe quantities and latest receiving cost.">
            <FactoryTable
              columns={[
                { key: "recipe", label: "Recipe", render: (row) => <div className="font-bold text-text-primary">{recipeOperatorIdentity(row)}</div> },
                { key: "yield", label: "Standard Output", render: (row) => quantity(row.yield_quantity, row.uom) },
                { key: "items", label: "Items", render: (row) => row.items?.length || 0 },
                { key: "standardCost", label: "Standard Cost", align: "right", render: (row) => costDisplay(row.standardCost, row.missingCostRows, row.unsupportedCostRows) },
                { key: "costPerUnit", label: "Cost / Unit", align: "right", render: (row) => costDisplay(row.costPerUnit, row.missingCostRows, row.unsupportedCostRows) },
              ]}
              rows={recipeRows}
              emptyTitle="No active recipe costing"
              emptyDescription="Active recipes with item quantities and receiving costs will appear here."
            />
          </Card>
          <Card title="Actual vs Standard Cost Variance" description="Actual production cost remains based on actual material usage; standard cost is recipe reference scaled to output.">
            <FactoryTable
              columns={[
                { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{productionBatchReference(row)}</div><div className="text-xs text-text-secondary">{productionJobOrderReference(row)}</div></div> },
                { key: "product_name", label: "Product", render: (row) => row.product_name },
                { key: "standard_cost", label: "Standard", align: "right", render: (row) => costDisplay(row.standard_cost, row.missing_cost_rows, row.unsupported_cost_rows) },
                { key: "actual_cost", label: "Actual", align: "right", render: (row) => costDisplay(row.actual_cost, row.missing_cost_rows) },
                { key: "variance_rm", label: "Variance", align: "right", render: (row) => costDisplay(row.variance_rm, row.missing_cost_rows, row.unsupported_cost_rows) },
                { key: "variance_percent", label: "Variance %", render: (row) => row.missing_cost_rows ? "Missing Cost" : row.unsupported_cost_rows ? "Incomplete Cost" : percent(row.variance_percent) },
              ]}
              rows={productionCostRows}
              emptyTitle="No production cost variance"
              emptyDescription="Complete production for products with active recipes to compare standard and actual cost."
            />
          </Card>
        </div>
        <Card title="Raw Material Cost Trend Report" description="Receiving records provide raw material cost history and supplier cost trend by material.">
          <FactoryTable
            columns={[
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
              { key: "received_date", label: "Received", render: (row) => formatFactoryDate(row.received_date) },
              { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => Number(row.unit_cost || 0) > 0 ? money(row.unit_cost) : "Missing Cost" },
              { key: "previous_cost", label: "Previous", align: "right", render: (row) => row.previous_cost == null ? "—" : money(row.previous_cost) },
              { key: "cost_change", label: "Change", align: "right", render: (row) => row.previous_cost == null ? "—" : money(row.cost_change) },
              { key: "cost_change_percent", label: "Change %", render: (row) => row.previous_cost == null ? "—" : percent(row.cost_change_percent) },
            ]}
            rows={costTrendRows}
            emptyTitle="No raw material cost history"
            emptyDescription="Raw material receiving records with unit cost will populate this trend report."
          />
        </Card>
        <Card title="Production Summary Report" description="Completed production totals with actual usage costing. Missing receiving cost is shown instead of RM0 where the cost source is unavailable.">
          <FactoryTable
            columns={[
              { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{productionBatchReference(row)}</div><div className="text-xs text-text-secondary">{productionJobOrderReference(row)} · {formatFactoryDate(row.production_date)}</div></div> },
              { key: "product_name", label: "Product", render: (row) => row.product_name },
              { key: "output", label: "Good Output", render: (row) => quantity(row.good_output_qty, row.uom) },
              { key: "yield_percent", label: "Yield", render: (row) => percent(row.yield_percent) },
              { key: "cost_per_batch", label: "Batch Cost", align: "right", render: (row) => costDisplay(row.cost_per_batch, row.missing_cost_rows) },
              { key: "cost_per_unit", label: "Cost / Unit", align: "right", render: (row) => costDisplay(row.cost_per_unit, row.missing_cost_rows) },
            ]}
            rows={productionRows}
            emptyTitle="No production summary"
            emptyDescription="Complete production to populate this read-only report."
          />
        </Card>
        <Card title="Raw Material Usage Report" description="Actual material usage cost uses recorded receiving unit cost when available, otherwise latest receiving cost by raw material. Missing cost is shown when no cost source exists.">
          <FactoryTable
            columns={[
              { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{productionBatchReference(row)}</div><div className="text-xs text-text-secondary">{productionJobOrderReference(row)}</div></div> },
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "actual_usage", label: "Actual Usage", render: (row) => quantity(row.actual_usage, row.uom) },
              { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => row.missing_cost ? "Missing Cost" : money(row.unit_cost) },
              { key: "actual_usage_cost", label: "Actual Usage Cost", align: "right", render: (row) => row.missing_cost ? "Missing Cost" : money(row.actual_usage_cost) },
            ]}
            rows={usageRows}
            emptyTitle="No raw material usage"
            emptyDescription="Complete production with actual material usage to populate this report."
          />
        </Card>
        <Card title="Recipe Standard vs Actual Usage Report" description="Recipe remains the standard reference; compare variance by material/UOM to avoid mixed-unit interpretation.">
          <FactoryTable
            columns={[
              { key: "production", label: "Production", render: (row) => productionBatchReference(row) },
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
                { key: "production", label: "Production", render: (row) => productionBatchReference(row) },
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
                { key: "movement_date", label: "Date", render: (row) => formatFactoryDate(row.movement_date) },
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

  function renderFinishedGoodsDispatch() {
    const dispatchSnapshotReady = factoryListingPage.hasLoaded;
    const dispatchSummaryReady = dispatchSnapshotReady && !factoryListingPage.summaryError;
    const dispatchRows = dispatchSnapshotReady ? factoryListingPage.rows : [];
    const customersTodayUpdating = dispatchCustomersTodayUpdating;
    const renderDispatchActions = (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "finished-good-dispatch", value: row, mode: "view" })}>View</button>
        {row.status === "draft" && can("factory_finished_goods_dispatch.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "finished-good-dispatch", value: row, mode: "edit" })}>Edit</button> : null}
        {row.status === "draft" && can("factory_finished_goods_dispatch.complete") ? <button className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" type="button" onClick={() => completeFinishedGoodDispatch(row)}>Complete</button> : null}
        {row.status === "draft" && can("factory_finished_goods_dispatch.delete") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => cancelFinishedGoodDispatch(row)}>Cancel</button> : null}
      </div>
    );
    const dispatchColumns = [
      { key: "dispatch_date", label: "Date", render: (row) => formatFactoryDate(row.dispatch_date) },
      { key: "dispatch_no", label: "Dispatch No.", render: (row) => <div className="font-bold text-text-primary">{row.dispatch_no}</div> },
      { key: "customer_name", label: "Customer", render: (row) => <div><div className="font-semibold text-text-primary">{row.customer_name || "—"}</div><div className="text-xs text-text-secondary">{row.customer_code || row.customer_type || "Dispatch destination"}</div></div> },
      { key: "items_count", label: "Items", render: (row) => Number(row.items_count || 0).toLocaleString("en-MY") },
      { key: "total_qty", label: "Total Dispatch", render: (row) => dispatchTotalLabel(row) },
      { key: "created_by", label: "Created By", render: (row) => row.created_by_name || row.created_by || "—" },
      { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "completed" ? "success" : row.status === "cancelled" ? "neutral" : "warning"}>{jobStatusLabel(row.status)}</Badge> },
      { key: "actions", label: "Actions", align: "right", render: renderDispatchActions },
    ];

    return (
      <div className="space-y-5">
        <PageHeader
          section="Warehouse"
          title="Finished Goods Dispatch"
          description="Record outbound Packaging SKU dispatches to customers or outlets. Completion creates finished goods stock-out movements."
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="Draft" value={dispatchSummaryReady ? Number(factoryListingPage.summary.draft || 0) : "—"} helper={dispatchSummaryReady ? "Awaiting completion" : "Updating…"} tone={dispatchSummaryReady && Number(factoryListingPage.summary.draft || 0) ? "warning" : "success"} />
          <MetricCard icon={CheckCircle2} label="Completed Today" value={dispatchSummaryReady ? Number(factoryListingPage.summary.completed_today || 0) : "—"} helper={dispatchSummaryReady ? "Finished dispatches" : "Updating…"} tone="success" />
          <MetricCard icon={PackageCheck} label="Dispatched Today" value={dispatchSummaryReady ? Number(factoryListingPage.summary.completed_today || 0) : "—"} helper={dispatchSummaryReady ? "Completed dispatch records" : "Updating…"} />
          <MetricCard icon={Truck} label="Customers Today" value={dispatchSummaryReady && !customersTodayUpdating ? Number(factoryListingPage.summary.customers_today || 0) : "—"} helper={!dispatchSummaryReady || customersTodayUpdating ? "Updating…" : "Unique dispatch customers"} />
        </div>
        {dispatchTab === "history" ? dispatchHistoryFilterControls() : null}
        <Card title="Finished Goods Dispatch" description="Create drafts first, then complete them to deduct Packaging SKU stock and create Product Movement rows.">
          <div className="space-y-4 p-4">
            <div className="inline-flex rounded-xl border border-border bg-white p-1">
              <button className={`rounded-lg px-4 py-2 text-sm font-bold ${dispatchTab === "history" ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => setDispatchTab("history")}>Dispatch History</button>
              <button className={`rounded-lg px-4 py-2 text-sm font-bold ${dispatchTab === "create" ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => setDispatchTab("create")} disabled={!can("factory_finished_goods_dispatch.create")}>Create Dispatch</button>
            </div>
            {dispatchTab === "create" ? (
              can("factory_finished_goods_dispatch.create") ? (
                <FinishedGoodDispatchModal
                  finishedGoods={data.finishedGoods}
                  customers={data.factoryCustomers}
                  onClose={() => setDispatchTab("history")}
                  onSave={saveFinishedGoodDispatch}
                  onComplete={can("factory_finished_goods_dispatch.complete") ? saveAndCompleteFinishedGoodDispatch : undefined}
                  embedded
                />
              ) : (
                <EmptyState title="Create permission required" description="Your role can view dispatch history but cannot create new dispatch drafts." />
              )
            ) : (
              <>
                {listingLoadState("dispatch-history", "Dispatch History")}
                <div className="md:hidden">
                  {!dispatchSnapshotReady ? (
                    <div className="p-4"><EmptyState title={factoryListingPage.errorKind === "permission" ? "Dispatch History hidden" : "Loading Dispatch History"} description={factoryListingPage.errorKind === "permission" ? "Your current role cannot view these records." : "Loading the latest Dispatch records."} /></div>
                  ) : !dispatchRows.length ? (
                    <div className="p-4"><EmptyState title="No finished goods dispatches" description="Create a dispatch draft to record outbound Packaging SKU delivery." /></div>
                  ) : (
                    <div className="divide-y divide-border">
                      {dispatchRows.map((row) => (
                        <div key={row.id} className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-text-muted">{formatFactoryDate(row.dispatch_date)}</div>
                              <div className="mt-1 font-bold text-text-primary">{row.dispatch_no || "—"}</div>
                              <div className="text-sm font-semibold text-text-secondary">{row.customer_name || "—"}</div>
                            </div>
                            <Badge tone={row.status === "completed" ? "success" : row.status === "cancelled" ? "neutral" : "warning"}>{jobStatusLabel(row.status)}</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div><div className="text-[10.5px] font-semibold text-text-muted">Items</div><div className="font-bold text-text-primary">{Number(row.items_count || 0).toLocaleString("en-MY")}</div></div>
                            <div><div className="text-[10.5px] font-semibold text-text-muted">Total Dispatch</div><div className="font-bold text-text-primary">{dispatchTotalLabel(row)}</div></div>
                            <div><div className="text-[10.5px] font-semibold text-text-muted">Created By</div><div className="font-bold text-text-primary">{row.created_by_name || row.created_by || "—"}</div></div>
                          </div>
                          <div className="flex justify-end">{renderDispatchActions(row)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="hidden md:block">
                  {!dispatchSnapshotReady ? (
                    <div className="p-6"><EmptyState title={factoryListingPage.errorKind === "permission" ? "Dispatch History hidden" : "Loading Dispatch History"} description={factoryListingPage.errorKind === "permission" ? "Your current role cannot view these records." : "Loading the latest Dispatch records."} /></div>
                  ) : (
                    <FactoryTable
                      columns={dispatchColumns}
                      rows={dispatchRows}
                      emptyTitle="No finished goods dispatches"
                      emptyDescription="Create a dispatch draft to record outbound Packaging SKU delivery."
                    />
                  )}
                </div>
                {listingPagination("dispatch-history")}
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  function renderProductMovements() {
    return <FactoryProductMovementsPage onNotify={ui?.notify} />;
  }

  function renderProductStockCheck() {
    const productStockCheckRows = currentListingRows("product-stock-checks", data.productStockChecks);
    return (
      <div className="space-y-5">
        <PageHeader
          section="Warehouse"
          title="Product Stock Check"
          description="Count finished goods stock, submit variance for review and approve inventory adjustments."
          actions={can("factory_product_stock_check.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "product" })}><ClipboardCheck size={15} /> New Stock Check</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Finished Goods" value={data.finishedGoods.length} helper="Available for count" />
          <MetricCard icon={ClipboardCheck} label="Checks" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.checks || 0) : data.productStockChecks.length} helper="Finished goods checks" />
          <MetricCard icon={Clock3} label="Submitted" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.submitted || 0) : data.productStockChecks.filter((row) => row.status === "submitted").length} helper="Awaiting approval" tone={Number(factoryListingPage.summary.submitted || data.productStockChecks.some((row) => row.status === "submitted")) ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Variance Rows" value={factoryListingPage.hasLoaded ? Number(factoryListingPage.summary.variance_rows || 0) : data.productStockChecks.flatMap((row) => row.items || []).filter((item) => item.count_status !== "skip" && item.variance_status !== "Skipped" && Number(item.variance_qty || 0) !== 0).length} helper="Counted rows with a difference" tone="warning" />
        </div>
        <Card title="Finished Goods Stock Checks" description="Draft and submitted checks do not adjust stock. Approval applies the variance adjustment.">
          {listingLoadState("product-stock-checks", "Product Stock Checks")}
          {stockCheckHistoryList("product", productStockCheckRows, "No finished goods stock checks", "Create a stock check to capture physical counts.")}
          {listingPagination("product-stock-checks")}
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="card p-6 text-sm font-semibold text-text-secondary">Loading Factory workspace...</div>;
  }

  return (
    <FactoryPermissionsProvider permissionSet={auth?.permissions || []} can={can}>
      <FactoryMasterDataProvider data={{ ...data, productionCosts: metrics.productionCostRows }}>
        <FactoryNavigationProvider
          auditReferenceLoading={auditReferenceLoading}
          openAuditReference={openFactoryAuditReference}
          rawMovementReferenceLoading={rawMovementReferenceLoading}
          openRawMaterialMovementReference={openRawMaterialMovementReference}
          openingBatchTraceabilityDispatchId={batchTraceabilityDispatchLoading}
          openBatchTraceabilityDispatch={canViewDispatchHistory ? openBatchTraceabilityDispatch : undefined}
          openCreateSupplier={() => setModal({ type: "factory-suppliers" })}
          openEditSupplier={(supplier) => setModal({ type: "factory-suppliers", value: supplier })}
          archiveSupplier={archiveFactorySupplier}
          openCreateCustomer={() => setModal({ type: "factory-customers" })}
          openEditCustomer={(customer) => setModal({ type: "factory-customers", value: customer })}
          archiveCustomer={archiveFactoryCustomer}
          openCreateStorageLocation={() => setModal({ type: "storage-locations" })}
          openEditStorageLocation={(location) => setModal({ type: "storage-locations", value: location })}
          archiveStorageLocation={archiveStorageLocation}
          openCreateFinishedGood={() => setModal({ type: "product-group" })}
          openEditFinishedGood={(group) => setModal({ type: "product-group", value: group })}
          archiveFinishedGood={archiveProductGroup}
          openFinishedGoodPackagingSku={openPackagingSkuModal}
          archiveFinishedGoodPackagingSku={archiveFinishedGood}
          openFinishedGoodCategory={() => setModal({ type: "finished-good-category" })}
          openCreateRawMaterial={() => setModal({ type: "raw-material" })}
          openEditRawMaterial={(material) => setModal({ type: "raw-material", value: material })}
          openRawMaterialCost={(material) => setModal({ type: "raw-material-cost", material })}
          openRawMaterialImage={(material) => setModal({ type: "raw-material-image", material })}
          openRawMaterialCategory={() => setModal({ type: "raw-material-category" })}
          openPlanningJobOrderDraft={(draftPayload) => setModal({ type: "job", value: draftPayload })}
          openProductionPlanningPar={(sku) => setModal({ type: "production-planning-par", sku })}
          saveProductRecipe={saveProductRecipe}
          activateProductRecipe={activateProductRecipe}
          archiveProductRecipe={archiveProductRecipe}
          restoreProductRecipe={restoreProductRecipe}
          createProductRecipeNewVersion={openNewRecipeVersion}
          deleteProductRecipe={deleteProductRecipe}
        >
          <>
      <AccessIssueNotice issues={data.accessIssues} onRetry={() => loadData()} />
      {initialTab === "production-overview" ? renderProductionOverview() : initialTab === "job-orders" ? renderJobOrders() : initialTab === "raw-inventory" ? <FactoryRawMaterialInventoryPage /> : initialTab === "raw-receiving" ? renderRawReceiving() : initialTab === "raw-movements" ? renderRawMaterialMovements() : initialTab === "raw-stock-check" ? renderRawStockCheck() : initialTab === "production" ? renderProduction() : initialTab === "reports" ? renderReports() : initialTab === "batch-traceability" ? <FactoryBatchTraceabilityPage onNotify={ui?.notify} /> : initialTab === "finished-goods" ? <FactoryFinishedGoodsPage /> : initialTab === "production-planning" ? <FactoryProductionPlanningPage onNotify={ui?.notify} onPermissionDenied={clearPlanningPermission} /> : initialTab === "finished-goods-dispatch" ? renderFinishedGoodsDispatch() : initialTab === "product-movements" ? renderProductMovements() : initialTab === "product-stock-check" ? renderProductStockCheck() : initialTab === "product-recipes" ? <FactoryProductRecipesPage /> : initialTab === "production-sop" ? renderProductionSop() : initialTab === "audit-logs" ? <FactoryAuditTrailPage onNotify={ui?.notify} /> : initialTab === "storage-locations" ? <FactoryStorageLocationsPage /> : initialTab === "suppliers" ? <FactorySuppliersPage /> : initialTab === "customers" ? <FactoryCustomersPage /> : <FactoryDashboardPage onRefreshFactoryData={loadData} />}
      {modal?.type === "job" ? (
        <JobOrderModal
          initialValue={modal.value}
          finishedGoods={data.finishedGoods}
          rawMaterials={data.rawMaterials}
          recipes={data.recipes}
          readOnly={Boolean(modal.value?.id) && modal.readOnly !== false}
          onClose={() => setModal(null)}
          onSave={saveJobOrder}
        />
      ) : null}
      {modal?.type === "audit-batch-traceability-detail" ? <FinishedGoodBatchTraceabilityModal batch={modal.value} loading={modal.loading} error={modal.error} onClose={() => setModal(null)} /> : null}
      {modal?.type === "completed-job-result" ? (
        <CompletedJobOrderResultModal
          job={modal.job}
          production={modal.production}
          recipes={data.recipes}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "finished-good-dispatch" ? (
        <FinishedGoodDispatchModal
          initialValue={modal.value}
          finishedGoods={data.finishedGoods}
          customers={data.factoryCustomers}
          onClose={() => setModal(null)}
          onSave={saveFinishedGoodDispatch}
          onComplete={can("factory_finished_goods_dispatch.complete") ? saveAndCompleteFinishedGoodDispatch : undefined}
          mode={modal.mode}
        />
      ) : null}
      {modal?.type === "production-planning-par" ? (
        <ProductionPlanningParModal
          sku={modal.sku}
          onClose={() => setModal(null)}
          onSave={savePlanningParLevel}
        />
      ) : null}
      {modal?.type === "receiving-batch-detail" ? (
        <ReceivingBatchDetailModal
          batch={modal.value}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "raw-material-movement-detail" ? (
        <FactoryRawMaterialMovementDetailModal
          movement={modal.value}
          movementMeta={rawMovementTypeMeta(modal.value.movement_type)}
          formatQuantity={ledgerQuantity}
          formatDateTime={formatFactoryDateTime}
          openingReference={rawMovementReferenceLoading === modal.value.id}
          onOpenReference={openRawMaterialMovementReference}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "raw-material" ? (
        <RawMaterialMasterModal
          initialValue={modal.value}
          categories={data.rawMaterialCategories}
          storageLocations={data.storageLocations}
          onClose={() => setModal(null)}
          onSave={saveRawMaterial}
        />
      ) : null}
      {modal?.type === "raw-material-cost" ? (
        <RawMaterialCostModal
          material={modal.material}
          onClose={() => setModal(null)}
          onSave={saveRawMaterial}
        />
      ) : null}
      {modal?.type === "raw-material-image" ? (
        <RawMaterialImagePreviewModal
          material={modal.material}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "raw-material-category" ? (
        <RawMaterialCategoryModal
          categories={data.rawMaterialCategories}
          canEdit={can("factory_raw_inventory.edit")}
          onClose={() => setModal(null)}
          onSave={(form) => saveRawMaterialCategory(form, { keepOpen: true })}
          onArchive={(category) => archiveRawMaterialCategory(category, { keepOpen: true })}
        />
      ) : null}
      {modal?.type === "storage-locations" ? (
        <StorageLocationModal
          initialValue={modal.value}
          onClose={() => setModal(null)}
          onSave={saveStorageLocation}
        />
      ) : null}
      {modal?.type === "factory-suppliers" ? (
        <FactorySupplierModal
          initialValue={modal.value}
          onClose={() => setModal(null)}
          onSave={saveFactorySupplier}
        />
      ) : null}
      {modal?.type === "factory-customers" ? (
        <FactoryCustomerModal
          initialValue={modal.value}
          onClose={() => setModal(null)}
          onSave={saveFactoryCustomer}
        />
      ) : null}
      {modal?.type === "production" ? (
        <ProductionExecutionModal
          job={modal.job}
          rawMaterials={data.rawMaterials}
          receivings={data.receivings}
          recipes={data.recipes}
          sops={data.sops}
          finishedGoods={data.finishedGoods}
          storageLocations={data.storageLocations}
          auth={auth}
          notify={ui?.notify}
          onClose={() => setModal(null)}
          onViewProcess={() => setModal({ type: "production-process", job: modal.job, readOnly: false })}
          onSave={completeProduction}
        />
      ) : null}
      {modal?.type === "production-process" ? (
        <ProductionExecutionModal
          job={modal.job}
          rawMaterials={data.rawMaterials}
          receivings={data.receivings}
          recipes={data.recipes}
          sops={data.sops}
          finishedGoods={data.finishedGoods}
          storageLocations={data.storageLocations}
          auth={auth}
          notify={ui?.notify}
          processOnly
          readOnly={Boolean(modal.readOnly)}
          onClose={() => setModal(null)}
          onSave={completeProduction}
        />
      ) : null}
      {modal?.type === "start-production" ? (
        <StartProductionModal
          job={modal.job}
          sops={data.sops}
          auth={auth}
          onClose={() => setModal(null)}
          onSave={(form) => startJobOrder(modal.job, form)}
        />
      ) : null}
      {modal?.type === "sop" ? (
        <ProductionSopBuilderModal
          initialValue={modal.value}
          productFamilies={data.productFamilies}
          recipes={data.recipes}
          sops={data.sops}
          qcChecklistTemplates={data.qcChecklistTemplates}
          onClose={() => setModal(null)}
          onSave={saveProductionSop}
        />
      ) : null}
      {modal?.type === "sop-detail" ? (
        <ProductionSopDocumentModal
          sop={modal.value}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "qc-checklist-presets" ? (
        <QcChecklistPresetManagerModal
          templates={data.qcChecklistTemplates}
          sops={data.sops}
          onClose={() => setModal(null)}
          onCreate={createQcChecklistTemplate}
          onUpdate={updateQcChecklistTemplate}
          onArchive={archiveQcChecklistTemplate}
          onRestore={restoreQcChecklistTemplate}
          onDelete={deleteQcChecklistTemplate}
        />
      ) : null}
      {modal?.type === "stock-check" ? (
        <StockCheckModal
          stockType={modal.stockType}
          title={modal.stockType === "raw" ? "Raw Material Stock Check" : "Finished Goods Stock Check"}
          initialValue={modal.value}
          stockItems={modal.stockType === "raw" ? data.rawMaterials : data.finishedGoods}
          rawMaterialCategories={data.rawMaterialCategories}
          finishedGoodCategories={data.finishedGoodCategories}
          readOnly={Boolean(modal.readOnly)}
          onConfirmSubmit={({ counted, skipped, variance }) => ui?.confirm?.({
            title: "Submit Stock Check?",
            message: `${counted} Counted · ${skipped} Skipped · ${variance} Variance`,
            confirmLabel: "Submit Check",
            tone: variance ? "warning" : "info",
          })}
          onClose={() => setModal(null)}
          onSave={(form) => saveStockCheck(modal.stockType, form)}
        />
      ) : null}
      {modal?.type === "product-group" ? (
        <ProductGroupModal
          initialValue={modal.value}
          categories={data.finishedGoodCategories}
          onClose={() => setModal(null)}
          onSave={saveProductGroup}
          onArchive={archiveProductGroup}
        />
      ) : null}
      {modal?.type === "finished-good" ? (
        <FinishedGoodMasterModal
          initialValue={modal.value}
          categories={data.finishedGoodCategories}
          storageLocations={data.storageLocations}
          productFamilies={data.productFamilies}
          onClose={() => setModal(null)}
          onSave={saveFinishedGood}
          onArchive={archiveFinishedGood}
        />
      ) : null}
      {modal?.type === "finished-good-category" ? (
        <FinishedGoodCategoryModal
          categories={data.finishedGoodCategories}
          canEdit={can("factory_finished_goods.edit")}
          onClose={() => setModal(null)}
          onSave={(form) => saveFinishedGoodCategory(form, { keepOpen: true })}
          onArchive={(category) => archiveFinishedGoodCategory(category, { keepOpen: true })}
        />
      ) : null}
          </>
        </FactoryNavigationProvider>
      </FactoryMasterDataProvider>
    </FactoryPermissionsProvider>
  );
}
