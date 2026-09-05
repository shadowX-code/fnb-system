import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleOff, ClipboardCheck, ClipboardList, Clock3, Copy, DollarSign, Factory, FileText, Package, PackageCheck, Play, Plus, RefreshCw, RotateCcw, Tag, Trash2, Truck, Warehouse, X } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FactoryPagination, { FactoryTableLoadState, useFactoryClientPagination, useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import JobOrderModal from "../components/JobOrderModal.jsx";
import { createJobOrdersListingBridge } from "../hooks/jobOrdersListingBridge.js";
import { AccessIssueNotice, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import FactoryRowAction from "../components/FactoryRowAction.jsx";
import FactoryBulkSelectionModal, { CompactSelect, Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import FactoryAuditTrailPage from "./FactoryAuditTrailPage.jsx";
import FactorySuppliersPage from "./FactorySuppliersPage.jsx";
import FactoryCustomersPage from "./FactoryCustomersPage.jsx";
import FactoryStorageLocationsPage from "./FactoryStorageLocationsPage.jsx";
import FactoryEquipmentPage from "./FactoryEquipmentPage.jsx";
import FactoryProductionPlanningPage from "./FactoryProductionPlanningPage.jsx";
import FactoryDashboardPage from "./FactoryDashboardPage.jsx";
import FactoryFinishedGoodsPage from "./FactoryFinishedGoodsPage.jsx";
import FactoryRawMaterialInventoryPage from "./FactoryRawMaterialInventoryPage.jsx";
import FactoryMestiCleaningPage from "./FactoryMestiCleaningPage.jsx";
import FactoryMestiEquipmentCleaningPage from "./FactoryMestiEquipmentCleaningPage.jsx";
import FactoryMestiCalibrationPage from "./FactoryMestiCalibrationPage.jsx";
import FactoryMestiHealthDeclarationPage from "./FactoryMestiHealthDeclarationPage.jsx";
import FactoryMestiOperatorHygienePage from "./FactoryMestiOperatorHygienePage.jsx";
import FactoryMestiWasteDisposalPage from "./FactoryMestiWasteDisposalPage.jsx";
import FactoryMestiRawMaterialControlPage from "./FactoryMestiRawMaterialControlPage.jsx";
import FactoryMestiFoodProcessingControlPage from "./FactoryMestiFoodProcessingControlPage.jsx";
import FactoryMestiFinishedProductStorageControlPage from "./FactoryMestiFinishedProductStorageControlPage.jsx";
import FactoryProductRecipesPage from "./FactoryProductRecipesPage.jsx";
import FactoryProductionSopPage from "./FactoryProductionSopPage.jsx";
import FactoryProductionOverviewPage from "./FactoryProductionOverviewPage.jsx";
import FactoryJobOrdersPage from "./FactoryJobOrdersPage.jsx";
import FactoryBatchTraceabilityPage from "./FactoryBatchTraceabilityPage.jsx";
import { activeRecipeForSku, finishedGoodParentKey, inheritedRecipeUom } from "../utils/productionPlanning.js";
import { productionSopDisplayName } from "../utils/productionSop.js";
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
import FactoryEquipmentModal, { FactoryEquipmentCategoryModal } from "../modals/FactoryEquipmentModal.jsx";
import ProductionPlanningParModal from "../modals/ProductionPlanningParModal.jsx";
import FactoryProductMovementsPage from "./FactoryProductMovementsPage.jsx";
import FactoryRawMaterialMovementsPage from "./FactoryRawMaterialMovementsPage.jsx";
import { FactoryMasterDataProvider } from "../context/FactoryMasterDataContext.jsx";
import { FactoryNavigationProvider } from "../context/FactoryNavigationContext.jsx";
import { FactoryPermissionsProvider } from "../context/FactoryPermissionsContext.jsx";
import { FactoryOperationalJobsProvider } from "../context/FactoryOperationalJobsContext.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService, productionQcStatus, strictDateValue, strictTimeValueMinutes } from "../../../services/factoryService.js";
import { IMAGE_UPLOAD_ACCEPT } from "../../../utils/imageUpload.js";
import useFactoryNumberPreview from "../hooks/useFactoryNumberPreview.js";
import { addDaysToFactoryDate, factoryMonthLabel, formatDateDisplay, formatFactoryAuditDateTime, formatFactoryDate, formatFactoryDateTime, formatFactoryReadableDate, isoDate, malaysiaBusinessDateInput, monthStart, productionDurationLabel, timeInput, todayInput } from "../utils/factoryDates.js";
import { compactCompare, dispatchLineBaseEquivalentLabel, dispatchTotalLabel, ledgerQuantity, ledgerQuantityList, money, normalizePackSizeToBase, packSizeText, packagingTypeLabel, percent, pluralizePackagingType, productionTimeLabel, quantity, rawMaterialLabel, recipeOperatorIdentity, signedQuantity, skuBalanceLabel, sopMinutesLabel, sopStepEstimatedMinutes, sopTotalEstimatedMinutes, validSopMinutes } from "../utils/factoryFormatters.js";
import { operatorFinishedGoodBatchNo, productionBatchReference, productionJobOrderReference } from "../utils/factoryReferences.js";
import { uniqueReceivingBatchPreview } from "../utils/factoryNumbers.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { jobPriorityTone, jobStatusLabel, rawMovementTypeMeta, statusTone } from "../utils/factoryStatus.js";
import { costDisplay, costVarianceInfo, latestReceivingCostInfo, productionCost, productionCostInfo, recipeCostInfo, usageUnitCost, usageUnitCostInfo } from "../utils/factoryCosting.js";
import { factoryTimeAmPmLabel, jobFinishedGoodName, productionQcDisplayLabel, productionQcTone } from "../components/productionExecution/productionExecutionHelpers.js";
import ProductionExecutionModal from "../components/productionExecution/ProductionExecutionModal.jsx";
import { focusVisibleFactoryRowField } from "../utils/factoryDom.js";
import { dispatchAllocationTotal } from "../components/allocation/finishedGoodBatchAllocationHelpers.js";
import DispatchBatchAllocationModal from "../components/allocation/DispatchBatchAllocationModal.jsx";
import { finishedGoodDispatchOperatorError } from "../components/dispatch/finishedGoodDispatchHelpers.js";
import FinishedGoodDispatchModal from "../components/dispatch/FinishedGoodDispatchModal.jsx";
import StockCheckModal from "../components/stockCheck/StockCheckModal.jsx";
import { stockCheckDifferenceLabel, stockCheckVariance, stockVarianceTone } from "../components/stockCheck/stockCheckHelpers.js";

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

function finishedGoodHelper(product) {
  const packSize = Number(product?.pack_size_qty || 0) > 0 ? `${product.pack_size_qty} ${product.pack_size_uom || ""}`.trim() : "";
  return [product?.variant_name, product?.product_code, packSize, packagingTypeLabel(product)].filter(Boolean).join(" · ");
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



function jobProductionQcState(job) {
  return productionQcStatus((job?.step_executions || []).flatMap((step) => step.qc_results || []));
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

function createRawMaterialReceivingRequestId() {
  return crypto.randomUUID();
}

function CompletedJobOrderResultModal({ job, production, recipes = [], canVerify = false, onVerify, onClose }) {
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
      { label: "Verification", value: production.verification_status === "verified" ? "Verified" : production.verification_status === "awaiting_verification" ? "Awaiting Verification" : "—", secondary: production.verified_at ? formatFactoryDateTime(production.verified_at) : "" },
    ],
  ] : [];

  return (
    <Modal
      title="Completed Job Order Result"
      description="Read-only production completion record for this Job Order."
      size="xl"
      onClose={onClose}
      footer={<div className="flex gap-2"><button className="btn-secondary" type="button" onClick={onClose}>Close</button>{canVerify && production?.verification_status === "awaiting_verification" ? <button className="btn-primary" type="button" onClick={onVerify}>Verify Production Record</button> : null}</div>}
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
  const activeStorageLocations = storageLocations.filter((location) => location.status === "active" && location.is_storage_location !== false);
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
    } catch {
      // Workspace owns receiving errors and notifications; keep the entry panel retryable.
    } finally {
      submissionRef.current = false;
      setSavingAction("");
    }
  }

  function renderMaterialPicker(item) {
    const material = activeRawMaterials.find((row) => row.id === item.raw_material_id);
    return <><RawMaterialCellPicker value={item.raw_material_id} materials={activeRawMaterials} placeholder="Select Raw Material" open={openMaterialRowId === item.row_id} error={Boolean(fieldErrors[`${item.row_id}.raw_material_id`])} buttonRef={(node) => { fieldRefs.current[`${item.row_id}.raw_material_id`] = node; }} onToggle={() => setOpenMaterialRowId((current) => current === item.row_id ? null : item.row_id)} onClose={() => setOpenMaterialRowId(null)} onSelect={(rawMaterialId) => selectRawMaterial(item.row_id, rawMaterialId)} />{material?.acceptance_procedure ? <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-900"><span className="font-bold">Acceptance:</span> {material.acceptance_procedure}</div> : null}{fieldErrors[`${item.row_id}.raw_material_id`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.raw_material_id`]}</div> : null}</>;
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
              ...(batch.status === "completed" || batch.status === "awaiting_verification" || batch.status === "verified"
                ? [
                    ["Receive Time", formatFactoryDateTime(batch.completed_at)],
                    ["Received By", batch.completed_by_name || "—"],
                    ["Verified By", batch.verified_by_name || (batch.status === "awaiting_verification" ? "Awaiting Verification" : "—")],
                    ["Verified At", batch.verified_at ? formatFactoryDateTime(batch.verified_at) : "—"],
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
              { key: "acceptance_procedure_snapshot", label: "Acceptance Procedure", render: (row) => row.acceptance_procedure_snapshot || "—" },
              { key: "control_methods_snapshot", label: "Control Methods", render: (row) => row.control_methods_snapshot || "—" },
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
    } catch {
      // Workspace startJobOrder already owns user-facing error feedback.
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


// Production SOP builder, document, and QC preset presentation live in modals/sop.

export default function FactoryWorkspacePage({ initialTab = "dashboard", ui, auth }) {
  const [data, setData] = useState({ jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], storageLocations: [], equipment: [], equipmentCategories: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [], mestiCleaningRequirements: [], mestiEquipmentCleaningRequirements: [], mestiCalibrationRequirements: [], auditLogs: [], accessIssues: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [receivingTab, setReceivingTab] = useState("history");
  const [editingReceiving, setEditingReceiving] = useState(null);
  const [dispatchTab, setDispatchTab] = useState("history");
  const [receivingHistoryFilters, setReceivingHistoryFilters] = useState({ dateFrom: "", dateTo: "", supplier: "" });
  const [dispatchHistoryFilters, setDispatchHistoryFilters] = useState({ dateFrom: "", dateTo: "", customer: "", status: "" });
  const [dispatchCustomersTodayUpdating, setDispatchCustomersTodayUpdating] = useState(false);
  const [rawMovementReferenceLoading, setRawMovementReferenceLoading] = useState("");
  const [batchTraceabilityDispatchLoading, setBatchTraceabilityDispatchLoading] = useState("");
  const [auditReferenceLoading, setAuditReferenceLoading] = useState("");
  const factoryDataRequestRef = useRef(0);
  const factoryDataAbortRef = useRef(null);
  const dispatchMutationRef = useRef(new Set());
  const receivingMutationRef = useRef(new Set());
  const stockCheckMutationRef = useRef(new Set());
  const previousPermissionSignatureRef = useRef("");
  const can = (code) => Boolean(auth?.hasPermission?.(code));
  const clearPlanningPermission = useCallback(() => setModal((current) => current?.type === "job" ? null : current), []);
  const clearOperationalPermission = useCallback(() => setModal(null), []);
  const clearJobOrdersListingPermission = useCallback(() => {
    const protectedJobOrderModals = new Set(["job", "start-production", "production-process", "production", "completed-job-result"]);
    setModal((current) => protectedJobOrderModals.has(current?.type) ? null : current);
  }, []);
  const factoryPermissionSignature = JSON.stringify([...(auth?.permissions || [])].sort());
  const serverListing = initialTab === "raw-receiving" ? "receiving-history"
    : initialTab === "raw-stock-check" ? "raw-stock-checks"
        : initialTab === "production" ? "production-history"
          : initialTab === "finished-goods-dispatch" ? "dispatch-history"
            : initialTab === "product-stock-check" ? "product-stock-checks"
              : "";
  const serverListingFilters = serverListing === "receiving-history" ? receivingHistoryFilters
    : serverListing === "dispatch-history" ? dispatchHistoryFilters
      : {};
  const serverListingSignature = JSON.stringify({ listing: serverListing, filters: serverListingFilters, permissions: factoryPermissionSignature });
  const canViewDispatchHistory = can("factory_finished_goods_dispatch.view");
  const canViewReceivingHistory = can("factory_raw_receiving.view");
  const stockCheckListingLabel = serverListing === "raw-stock-checks"
    ? "Raw Material Stock Checks"
    : serverListing === "product-stock-checks" ? "Product Stock Checks" : "";
  const [factoryListingPage, factoryListingActions] = useFactoryPagedQuery({
    storageKey: serverListing || "inactive",
    enabled: Boolean(serverListing)
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
  const jobOrdersListingRetryRef = useRef(null);
  const jobOrdersListingSnapshotRef = useRef(null);
  const jobOrdersListingBridge = useMemo(
    () => createJobOrdersListingBridge(jobOrdersListingRetryRef, jobOrdersListingSnapshotRef),
    [],
  );
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

  async function loadData({ silent = false } = {}) {
    factoryDataAbortRef.current?.abort();
    const controller = new AbortController();
    factoryDataAbortRef.current = controller;
    const requestId = factoryDataRequestRef.current + 1;
    factoryDataRequestRef.current = requestId;
    setLoading(true);
    const operationalLoad = Promise.resolve();
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

  useEffect(() => () => {
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
      if (retryListing) await jobOrdersListingBridge.retry();
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
    if (initialTab === "job-orders" && saved?.id) {
      jobOrdersListingBridge.updateLoadedSnapshot(({ rows, total }) => {
        const exists = rows.some((row) => row.id === saved.id);
        return {
          rows: exists ? rows.map((row) => row.id === saved.id ? saved : row) : rows,
          total,
        };
      });
    }
    await refreshFactoryAfterMutation({ retryListing: initialTab === "job-orders" });
  }

  async function savePlanningParLevel(form) {
    try {
      await factoryService.updateFinishedGoodParLevel(form.sku, form.par_level);
    } catch (error) {
      ui?.notify?.({ title: "Failed to update par level", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: "Par level updated", tone: "success" });
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
    await refreshFactoryAfterMutation({ retryListing: initialTab === "job-orders" });
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
    await refreshFactoryAfterMutation({ retryListing: initialTab === "job-orders" });
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
    await refreshFactoryAfterMutation({ retryListing: initialTab === "job-orders" });
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
    await refreshFactoryAfterMutation({ retryListing: initialTab === "job-orders" });
  }

  async function viewCompletedJobOrder(order) {
    try {
      const production = await factoryService.getProductionByJobOrder(order.id);
      setModal({ type: "completed-job-result", job: order, production });
    } catch (error) {
      ui?.notify?.({ title: "Unable to load production result", message: error.message, tone: "error" });
    }
  }

  async function verifyProductionRecord(production) {
    try {
      await factoryService.verifyProductionRecord(production);
    } catch (error) {
      ui?.notify?.({ title: "Unable to verify Production Record", message: error.message, tone: "error" });
      return;
    }
    ui?.notify?.({ title: "Production Record verified", tone: "success" });
    setModal(null);
    await loadData();
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

  async function verifyReceivingBatch(batch) {
    if (receivingMutationRef.current.has(batch.id)) return;
    receivingMutationRef.current.add(batch.id);
    try {
      const verified = await factoryService.verifyRawMaterialReceivingBatch(batch);
      const refreshPage = applyReceivingMutation(batch, verified);
      ui?.notify?.({ title: "Receiving verified", tone: "success" });
      await refreshReceivingHistory(refreshPage, "verification");
      void loadData({ silent: true });
    } catch (error) {
      ui?.notify?.({ title: "Failed to verify receiving", message: isFactoryPermissionError(error) ? "Your current role does not allow this Receiving action." : error.message, tone: "error" });
    } finally {
      receivingMutationRef.current.delete(batch.id);
    }
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

  async function saveRawMaterial(form, { refresh = true, closeModal = true } = {}) {
    let saved;
    try {
      saved = await factoryService.saveRawMaterial(form, auth?.profile?.id);
    } catch (error) {
      ui?.notify?.({ title: "Failed to save raw material", message: error.message, tone: "error" });
      throw error;
    }
    ui?.notify?.({ title: form.id ? "Raw material updated" : "Raw material created", tone: "success" });
    if (closeModal) setModal(null);
    if (refresh) await refreshFactoryAfterMutation();
    return saved;
  }

  async function importRawMaterials(materials = []) {
    const result = { created: 0, skipped: 0, failed: 0, failures: [] };
    for (const material of materials) {
      try {
        await factoryService.saveRawMaterial(material, auth?.profile?.id);
        result.created += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push({ code: material.material_code, reason: error.message || "Unable to create raw material." });
      }
    }
    if (result.created) await refreshFactoryAfterMutation();
    ui?.notify?.({ title: "Raw material import complete", message: `Created ${result.created}. Failed ${result.failed}.`, tone: result.failed ? "warning" : "success" });
    return { ...result, skipped: materials.length - result.created - result.failed };
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

  async function saveFactoryEquipment(form) {
    try { await factoryService.saveFactoryEquipment(form, auth?.profile?.id); } catch (error) { ui?.notify?.({ title: "Failed to save Equipment", message: error.message, tone: "error" }); throw error; }
    ui?.notify?.({ title: form.id ? "Equipment updated" : "Equipment created", tone: "success" }); setModal(null); await refreshFactoryAfterMutation();
  }

  async function saveFactoryEquipmentCategory(form) {
    try { await factoryService.saveFactoryEquipmentCategory(form, auth?.profile?.id); } catch (error) { ui?.notify?.({ title: "Failed to save Equipment category", message: error.message, tone: "error" }); throw error; }
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
      if (initialTab === "job-orders") jobOrdersListingBridge.retry();
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
    await refreshFactoryAfterMutation();
    return draft;
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
    { key: "received_by", label: "Received By", render: (row) => row.completed_by_name || row.created_by_name || "—" },
    { key: "verified_by", label: "Verified By", render: (row) => row.verified_by_name || (row.status === "awaiting_verification" ? "Awaiting Verification" : "—") },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <FactoryRowAction onClick={() => setModal({ type: "receiving-batch-detail", value: row })} />
        {row.status === "draft" && can("factory_raw_receiving.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => { setEditingReceiving(row); setReceivingTab("receive"); }}>Edit</button> : null}
        {row.status === "draft" && can("factory_raw_receiving.edit") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => completeReceivingBatch(row)}><PackageCheck size={13} /> Complete</button> : null}
        {row.status === "awaiting_verification" && can("factory_raw_receiving.verify") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => verifyReceivingBatch(row)}><Check size={13} /> Verify</button> : null}
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

  function stockCheckColumns(stockType) {
    const renderActions = (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <FactoryRowAction onClick={() => setModal({ type: "stock-check", stockType, value: row, readOnly: true })} />
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
      <FactoryFilterBar
        activeFilters={[
          receivingHistoryFilters.dateFrom && { key: "date-from", label: "Date", value: receivingHistoryFilters.dateFrom, onRemove: () => setReceivingHistoryFilters((current) => ({ ...current, dateFrom: "" })) },
          receivingHistoryFilters.dateTo && { key: "date-to", label: "To", value: receivingHistoryFilters.dateTo, onRemove: () => setReceivingHistoryFilters((current) => ({ ...current, dateTo: "" })) },
          receivingHistoryFilters.supplier && { key: "supplier", label: "Supplier", value: (supplierOptions.find((option) => option.value === receivingHistoryFilters.supplier) || fallbackSupplierOptions.find((option) => option.value === receivingHistoryFilters.supplier))?.label || receivingHistoryFilters.supplier, onRemove: () => setReceivingHistoryFilters((current) => ({ ...current, supplier: "" })) },
        ].filter(Boolean)}
        onClear={() => setReceivingHistoryFilters({ dateFrom: "", dateTo: "", supplier: "" })}
      >
        <Field label="Date">
          <FeedXDatePicker
            value={receivingHistoryFilters.dateFrom}
            placeholder="From"
            onChange={(dateFrom) => setReceivingHistoryFilters((current) => ({ ...current, dateFrom }))}
          />
        </Field>
        <Field label="To">
          <FeedXDatePicker
            value={receivingHistoryFilters.dateTo}
            placeholder="To"
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
      </FactoryFilterBar>
    );
  }

  function dispatchHistoryFilterControls() {
    const customerOptions = data.factoryCustomers.map((customer) => ({ value: customer.id, label: customer.customer_name, helper: customer.customer_code || customer.customer_type || customer.status }));
    return (
      <FactoryFilterBar
        activeFilters={[
          dispatchHistoryFilters.dateFrom && { key: "date-from", label: "Date", value: dispatchHistoryFilters.dateFrom, onRemove: () => setDispatchHistoryFilters((current) => ({ ...current, dateFrom: "" })) },
          dispatchHistoryFilters.dateTo && { key: "date-to", label: "To", value: dispatchHistoryFilters.dateTo, onRemove: () => setDispatchHistoryFilters((current) => ({ ...current, dateTo: "" })) },
          dispatchHistoryFilters.customer && { key: "customer", label: "Customer", value: customerOptions.find((option) => option.value === dispatchHistoryFilters.customer)?.label || dispatchHistoryFilters.customer, onRemove: () => setDispatchHistoryFilters((current) => ({ ...current, customer: "" })) },
          dispatchHistoryFilters.status && { key: "status", label: "Status", value: dispatchHistoryFilters.status, onRemove: () => setDispatchHistoryFilters((current) => ({ ...current, status: "" })) },
        ].filter(Boolean)}
        onClear={() => setDispatchHistoryFilters({ dateFrom: "", dateTo: "", customer: "", status: "" })}
        moreFilters={<Field label="Status"><SearchableSelect value={dispatchHistoryFilters.status} options={[{ value: "", label: "All" }, { value: "draft", label: "Draft" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }]} placeholder="All" searchPlaceholder="Search status" emptyText="No matching status" onChange={(status) => setDispatchHistoryFilters((current) => ({ ...current, status }))} /></Field>}
      >
        <Field label="Date">
          <FeedXDatePicker
            value={dispatchHistoryFilters.dateFrom}
            placeholder="From"
            onChange={(dateFrom) => setDispatchHistoryFilters((current) => ({ ...current, dateFrom }))}
          />
        </Field>
        <Field label="To">
          <FeedXDatePicker
            value={dispatchHistoryFilters.dateTo}
            placeholder="To"
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
      </FactoryFilterBar>
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
          actions={!showReceivingEntry && canCreateReceiving ? <button className="btn-primary" type="button" onClick={() => { setEditingReceiving(null); setReceivingTab("receive"); }}><Plus size={15} /> Receive Raw Material</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Truck} label="Receiving Documents" value={factoryListingPage.hasLoaded ? Number(receivingSummary.documents || 0) : "—"} helper="Supplier delivery batches" />
          <MetricCard icon={PackageCheck} label="Items Received" value={factoryListingPage.hasLoaded ? Number(receivingSummary.items || 0) : "—"} helper="Total item rows" />
          <MetricCard icon={Warehouse} label="Total Qty" value={factoryListingPage.hasLoaded ? quantity(receivingSummary.total_qty, "") : "—"} helper="Across received items" />
          <MetricCard icon={Tag} label="Active Suppliers" value={activeSuppliers.length} helper="Available for receiving" />
        </div>
        {!showReceivingEntry ? receivingHistoryFilterControls() : null}

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
          <Card>
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
        <Card>
          {listingLoadState("raw-stock-checks", "Raw Material Stock Checks")}
          {stockCheckHistoryList("raw", rawStockCheckRows, "No raw material stock checks", "Create a stock check to capture physical counts.")}
          {listingPagination("raw-stock-checks")}
        </Card>
      </div>
    );
  }

  function renderProduction(operationalJobs) {
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
            <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={operationalJobs.loading} onClick={operationalJobs.retry}>Retry</button>
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
        <FactoryRowAction onClick={() => setModal({ type: "finished-good-dispatch", value: row, mode: "view" })} />
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
          actions={dispatchTab === "history" ? <button className="btn-primary" type="button" disabled={!can("factory_finished_goods_dispatch.create")} onClick={() => setDispatchTab("create")}><Plus size={15} /> Create Dispatch</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="Draft" value={dispatchSummaryReady ? Number(factoryListingPage.summary.draft || 0) : "—"} helper={dispatchSummaryReady ? "Awaiting completion" : "Updating…"} tone={dispatchSummaryReady && Number(factoryListingPage.summary.draft || 0) ? "warning" : "success"} />
          <MetricCard icon={CheckCircle2} label="Completed Today" value={dispatchSummaryReady ? Number(factoryListingPage.summary.completed_today || 0) : "—"} helper={dispatchSummaryReady ? "Finished dispatches" : "Updating…"} tone="success" />
          <MetricCard icon={PackageCheck} label="Dispatched Today" value={dispatchSummaryReady ? Number(factoryListingPage.summary.completed_today || 0) : "—"} helper={dispatchSummaryReady ? "Completed dispatch records" : "Updating…"} />
          <MetricCard icon={Truck} label="Customers Today" value={dispatchSummaryReady && !customersTodayUpdating ? Number(factoryListingPage.summary.customers_today || 0) : "—"} helper={!dispatchSummaryReady || customersTodayUpdating ? "Updating…" : "Unique dispatch customers"} />
        </div>
        {dispatchTab === "history" ? dispatchHistoryFilterControls() : null}
        <Card>
          <div className={dispatchTab === "create" ? "p-4" : ""}>
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
        <Card>
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
          saveRawMaterial={saveRawMaterial}
          importRawMaterials={importRawMaterials}
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
          saveProductionSop={saveProductionSop}
          activateProductionSop={activateProductionSop}
          archiveProductionSop={archiveProductionSop}
          restoreProductionSop={restoreProductionSop}
          createProductionSopNewVersion={createProductionSopNewVersion}
          deleteProductionSop={deleteProductionSop}
          createQcChecklistTemplate={createQcChecklistTemplate}
          updateQcChecklistTemplate={updateQcChecklistTemplate}
          archiveQcChecklistTemplate={archiveQcChecklistTemplate}
          restoreQcChecklistTemplate={restoreQcChecklistTemplate}
          deleteQcChecklistTemplate={deleteQcChecklistTemplate}
        >
          <>
      <FactoryOperationalJobsProvider route={initialTab} auth={auth} refreshKey={data} onPermissionDenied={clearOperationalPermission}>{(operationalJobs) => <>
      <AccessIssueNotice issues={data.accessIssues} onRetry={() => loadData()} />
      {initialTab === "mesti-equipment-cleaning" ? <FactoryMestiEquipmentCleaningPage auth={auth} onNotify={ui?.notify} /> : initialTab === "mesti-food-processing-control" ? <FactoryMestiFoodProcessingControlPage /> : <>
      {initialTab === "mesti-calibration" ? <FactoryMestiCalibrationPage onNotify={ui?.notify} onRefreshFactoryData={loadData} /> : initialTab === "mesti-operator-hygiene" ? <FactoryMestiOperatorHygienePage auth={auth} onNotify={ui?.notify} /> : initialTab === "mesti-waste-disposal" ? <FactoryMestiWasteDisposalPage auth={auth} onNotify={ui?.notify} /> : initialTab === "mesti-raw-material-control" ? <FactoryMestiRawMaterialControlPage /> : initialTab === "mesti-health-declaration" ? <FactoryMestiHealthDeclarationPage onNotify={ui?.notify} /> : initialTab === "mesti-finished-product-storage-control" ? <FactoryMestiFinishedProductStorageControlPage onNotify={ui?.notify} /> : initialTab === "equipment" ? <FactoryEquipmentPage onCreate={() => setModal({ type: "equipment" })} onEdit={(value) => setModal({ type: "equipment", value })} onManageCategories={() => setModal({ type: "equipment-categories" })} /> : initialTab === "production-overview" ? <FactoryProductionOverviewPage route={initialTab} auth={auth} openJob={(job, options) => setModal({ type: "job", value: job, readOnly: options?.readOnly })} startJob={(job) => setModal({ type: "start-production", job })} completeProduction={(job, options) => setModal(options?.processOnly ? { type: "production-process", job, readOnly: Boolean(options.readOnly) } : { type: "production", job })} viewCompletedResult={viewCompletedJobOrder} releaseJob={releaseJobOrder} cancelJob={cancelJobOrder} /> : initialTab === "job-orders" ? <FactoryJobOrdersPage data={data} auth={auth} can={can} onCreate={() => setModal({ type: "job" })} onView={(job) => setModal({ type: "job", value: job, readOnly: true })} onEdit={(job) => setModal({ type: "job", value: job, readOnly: false })} onRelease={releaseJobOrder} onDelete={deleteJobOrder} onCancel={cancelJobOrder} onStart={(job) => setModal({ type: "start-production", job })} onViewProcess={(job, readOnly) => setModal({ type: "production-process", job, readOnly })} onComplete={(job) => setModal({ type: "production", job })} onViewResult={viewCompletedJobOrder} jobOrdersListingBridge={jobOrdersListingBridge} onPermissionDenied={clearJobOrdersListingPermission} onNotify={ui?.notify} jobFinishedGoodName={jobFinishedGoodName} productionQcTone={productionQcTone} productionQcDisplayLabel={productionQcDisplayLabel} /> : initialTab === "raw-inventory" ? <FactoryRawMaterialInventoryPage /> : initialTab === "raw-receiving" ? renderRawReceiving() : initialTab === "raw-movements" ? renderRawMaterialMovements() : initialTab === "raw-stock-check" ? renderRawStockCheck() : initialTab === "production" ? renderProduction(operationalJobs) : initialTab === "reports" ? renderReports() : initialTab === "batch-traceability" ? <FactoryBatchTraceabilityPage onNotify={ui?.notify} /> : initialTab === "finished-goods" ? <FactoryFinishedGoodsPage /> : initialTab === "production-planning" ? <FactoryProductionPlanningPage onNotify={ui?.notify} onPermissionDenied={clearPlanningPermission} /> : initialTab === "finished-goods-dispatch" ? renderFinishedGoodsDispatch() : initialTab === "product-movements" ? renderProductMovements() : initialTab === "product-stock-check" ? renderProductStockCheck() : initialTab === "mesti-cleaning" ? <FactoryMestiCleaningPage auth={auth} onNotify={ui?.notify} /> : initialTab === "product-recipes" ? <FactoryProductRecipesPage /> : initialTab === "production-sop" ? <FactoryProductionSopPage /> : initialTab === "audit-logs" ? <FactoryAuditTrailPage onNotify={ui?.notify} /> : initialTab === "storage-locations" ? <FactoryStorageLocationsPage /> : initialTab === "suppliers" ? <FactorySuppliersPage /> : initialTab === "customers" ? <FactoryCustomersPage /> : <FactoryDashboardPage onRefreshFactoryData={loadData} />}
      </>}
      </>}</FactoryOperationalJobsProvider>
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
          canVerify={can("factory_production.verify")}
          onVerify={() => verifyProductionRecord(modal.production)}
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
      {modal?.type === "equipment" ? <FactoryEquipmentModal initialValue={modal.value} categories={data.equipmentCategories} locations={data.storageLocations} onClose={() => setModal(null)} onSave={saveFactoryEquipment} /> : null}
      {modal?.type === "equipment-categories" ? <FactoryEquipmentCategoryModal categories={data.equipmentCategories} onClose={() => setModal(null)} onSave={saveFactoryEquipmentCategory} /> : null}
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
          equipment={data.equipment}
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
