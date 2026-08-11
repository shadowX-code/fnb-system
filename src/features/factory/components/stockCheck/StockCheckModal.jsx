import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, CircleOff, ClipboardCheck, RefreshCw } from "lucide-react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import Card from "../../../../components/ui/Card.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import { CompactSelect, Field, inputClass } from "../FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../FeedXDatePicker.jsx";
import SearchableSelect from "../SearchableSelect.jsx";
import { factoryService } from "../../../../services/factoryService.js";
import useFactoryNumberPreview from "../../hooks/useFactoryNumberPreview.js";
import { malaysiaBusinessDateInput } from "../../utils/factoryDates.js";
import { packSizeText, percent, quantity, signedQuantity } from "../../utils/factoryFormatters.js";
import { isFactoryPermissionError } from "../../utils/factoryPermissions.js";
import { jobStatusLabel } from "../../utils/factoryStatus.js";
import DispatchBatchAllocationModal from "../allocation/DispatchBatchAllocationModal.jsx";
import { dispatchAllocationTotal } from "../allocation/finishedGoodBatchAllocationHelpers.js";
import { buildStockCheckRows, stockCheckDifferenceLabel, stockCheckVariance, stockVarianceTone } from "./stockCheckHelpers.js";

export default function StockCheckModal({ stockType, title, initialValue, stockItems, rawMaterialCategories = [], finishedGoodCategories = [], readOnly = false, onConfirmSubmit, onClose, onSave }) {
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
