import { useEffect, useRef, useState } from "react";
import { ClipboardList, Plus, RefreshCw, Trash2 } from "lucide-react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import FactoryBulkSelectionModal, { Field, inputClass } from "../FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../FeedXDatePicker.jsx";
import SearchableSelect from "../SearchableSelect.jsx";
import { factoryService, strictDateValue } from "../../../../services/factoryService.js";
import { malaysiaBusinessDateInput, formatFactoryDate } from "../../utils/factoryDates.js";
import { dispatchLineBaseEquivalentLabel, dispatchTotalLabel, finishedGoodLabel, packSizeText, packagingTypeLabel, pluralizePackagingType, quantity, skuBalanceLabel } from "../../utils/factoryFormatters.js";
import { isFactoryPermissionError } from "../../utils/factoryPermissions.js";
import { jobStatusLabel } from "../../utils/factoryStatus.js";
import DispatchBatchAllocationModal from "../allocation/DispatchBatchAllocationModal.jsx";
import { DispatchAllocationSummary, DispatchStockAvailability, ReadOnlyBatchAllocationModal } from "./DispatchAllocationPresentation.jsx";
import { createFinishedGoodDispatchRequestId, factoryActivityDateTime, finishedGoodDispatchOperatorError, validDispatchPackQty } from "./finishedGoodDispatchHelpers.js";
import { dispatchAllocationTotal } from "../allocation/finishedGoodBatchAllocationHelpers.js";
import { focusVisibleFactoryRowField } from "../../utils/factoryDom.js";

export default function FinishedGoodDispatchModal({ initialValue, finishedGoods = [], customers = [], onClose, onSave, onComplete, embedded = false, mode = "edit", closeRequestNonce = 0 }) {
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
  const [formDirty, setFormDirty] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const batchAvailabilityRequestRef = useRef({});
  const dispatchNoPreviewRequestRef = useRef(0);
  const submissionRef = useRef(false);
  const closeRequestNonceRef = useRef(closeRequestNonce);
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
    setFormDirty(true);
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.row_id === rowId ? { ...item, ...patch } : item),
    }));
  }

  function updateItemQuantity(rowId, value) {
    setFormDirty(true);
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
    setFormDirty(true);
    setForm((current) => ({ ...current, items: [...current.items, makeItem()] }));
  }

  function addSelectedDispatchSkus(selectedItems) {
    const newRows = selectedItems.map((item) => makeItem({ finished_good_id: item.id }));
    if (!newRows.length) return;
    setFormDirty(true);
    setForm((current) => {
      const hasOnlyBlankRow = current.items.length === 1 && !current.items[0].finished_good_id && !current.items[0].quantity && !current.items[0].remarks;
      return { ...current, items: [...(hasOnlyBlankRow ? [] : current.items), ...newRows] };
    });
    setDispatchBulkSelectOpen(false);
    focusVisibleFactoryRowField("dispatch-qty", newRows[0].row_id);
  }

  function removeItem(rowId) {
    setFormDirty(true);
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
      setFormDirty(false);
    } catch (submitError) {
      setError(finishedGoodDispatchOperatorError(submitError, action === "complete" ? "Unable to complete the Dispatch. Please retry." : "Unable to save the Dispatch Draft. Please retry."));
    } finally {
      submissionRef.current = false;
      setSubmittingAction("");
    }
  }

  function requestClose() {
    if (saving) return;
    if (!isReadOnly && formDirty) {
      setDiscardPrompt(true);
      return;
    }
    onClose?.();
  }

  useEffect(() => {
    if (closeRequestNonce === closeRequestNonceRef.current) return;
    closeRequestNonceRef.current = closeRequestNonce;
    requestClose();
  }, [closeRequestNonce]);

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
                setFormDirty(true);
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
            onChange={(nextDate) => { setFormDirty(true); setForm((current) => ({ ...current, dispatch_date: nextDate })); }}
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
        <input className={inputClass()} value={form.reference_no || ""} disabled={isReadOnly} onChange={(event) => { setFormDirty(true); setForm((current) => ({ ...current, reference_no: event.target.value })); }} />
      </Field> : null}

      <Field label="Remarks">
        <textarea className={inputClass()} rows={3} value={form.remarks || ""} disabled={isReadOnly} onChange={(event) => { setFormDirty(true); setForm((current) => ({ ...current, remarks: event.target.value })); }} />
      </Field>

      <div className="border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <div className="font-bold text-text-primary">Dispatch Items</div>
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
                  {!isReadOnly ? <button className="icon-btn ml-auto flex h-9 w-9 items-center justify-center text-rose-700 hover:bg-rose-50" type="button" aria-label="Remove item" title="Remove item" onClick={() => removeItem(item.row_id)}><Trash2 size={15} /></button> : null}
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1080px] text-left">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2.5">Product / SKU</th>
                  <th className="px-3 py-2.5">Stock Available</th>
                  <th className="px-3 py-2.5">Dispatch Qty</th>
                  <th className="px-3 py-2.5">Batch Allocation</th>
                  <th className="px-3 py-2.5">Pack Size</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="w-12 px-3 py-2.5 text-right">Actions</th>
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
                        {!isReadOnly ? <button className="icon-btn ml-auto flex h-8 w-8 items-center justify-center text-rose-700 hover:bg-rose-50" type="button" aria-label="Remove item" title="Remove item" onClick={() => removeItem(item.row_id)}><Trash2 size={15} /></button> : null}
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

      {discardPrompt ? <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">Discard unsaved Dispatch changes?</span><span className="flex shrink-0 items-center gap-2"><button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={() => setDiscardPrompt(false)}>Keep editing</button><button className="btn-danger h-8 px-3 text-xs" type="button" onClick={onClose}>Discard changes</button></span></div> : null}

      {embedded && !isReadOnly ? (
        <div className="space-y-2 border-t border-border pt-4">
          {completeBlockReason ? <div className="text-right text-xs font-semibold text-amber-800">{completeBlockReason}</div> : null}
          <div className="flex items-center justify-end gap-2 overflow-x-auto whitespace-nowrap">
            <button className="btn-secondary shrink-0" type="button" disabled={saving} onClick={requestClose}>Cancel</button>
            <button className="btn-secondary shrink-0" type="submit" disabled={saving || Boolean(saveDraftBlockReason)}>{submittingAction === "draft" ? "Saving..." : "Save Draft"}</button>
            {onComplete ? <button className="btn-primary shrink-0 bg-emerald-600 hover:bg-emerald-700" type="button" disabled={saving || Boolean(completeBlockReason)} onClick={() => submit(null, "complete")}>{submittingAction === "complete" ? "Completing..." : "Complete Dispatch"}</button> : null}
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
        onClose={saving ? undefined : requestClose}
        footer={(
          <div className="flex w-full items-center justify-end gap-2 overflow-x-auto whitespace-nowrap">
            <button className="btn-secondary shrink-0" type="button" disabled={saving} onClick={requestClose}>{isReadOnly ? "Close" : "Cancel"}</button>
            {!isReadOnly ? <button className="btn-secondary shrink-0" type="submit" form="factory-finished-good-dispatch-form" disabled={saving || Boolean(saveDraftBlockReason)}>{submittingAction === "draft" ? "Saving..." : "Save Draft"}</button> : null}
            {!isReadOnly && onComplete ? <button className="btn-primary shrink-0 bg-emerald-600 hover:bg-emerald-700" type="button" disabled={saving || Boolean(completeBlockReason)} onClick={() => submit(null, "complete")}>{submittingAction === "complete" ? "Completing..." : "Complete Dispatch"}</button> : null}
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
