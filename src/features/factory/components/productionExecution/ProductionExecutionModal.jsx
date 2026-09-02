import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Factory, Package, PackageCheck, RefreshCw } from "lucide-react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import Card from "../../../../components/ui/Card.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import { Field, inputClass } from "../FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../FeedXDatePicker.jsx";
import SearchableSelect from "../SearchableSelect.jsx";
import { factoryService, productionQcStatus, strictDateTimeValue, strictDateValue, strictTimeValueMinutes } from "../../../../services/factoryService.js";
import useFactoryNumberPreview from "../../hooks/useFactoryNumberPreview.js";
import { addDaysToFactoryDate, formatFactoryDate, productionDurationLabel, timeInput, todayInput } from "../../utils/factoryDates.js";
import { finishedGoodLabel, packSizeText, quantity, rawMaterialLabel } from "../../utils/factoryFormatters.js";
import { isFactoryPermissionError } from "../../utils/factoryPermissions.js";
import { activeRecipeForSku, packagingProductionPlan } from "../../utils/productionPlanning.js";
import {
  allocateRawMaterialFefo,
  buildInitialUsageRows,
  factorySavedTimeLabel,
  factoryTimeAmPmLabel,
  formatSignedQuantity,
  jobFinishedGoodName,
  latestProductionQcSavedAt,
  productionQcDisplayLabel,
  productionQcEditableSignature,
  productionQcTone,
} from "./productionExecutionHelpers.js";
import RawMaterialBatchAllocationModal from "./RawMaterialBatchAllocationModal.jsx";

const varianceReasonTolerance = 0.000001;

function employeeDisplayName(auth) {
  return auth?.profile?.nickname || auth?.profile?.full_name || auth?.profile?.email || "";
}

function varianceFor(standardUsage, actualUsage) {
  const standard = Number(standardUsage || 0);
  const actual = Number(actualUsage || 0);
  const variance = actual - standard;
  const variancePercent = standard === 0 ? (actual === 0 ? 0 : 100) : (variance / standard) * 100;
  return { variance, variancePercent };
}

export default function ProductionExecutionModal({ job, rawMaterials = [], receivings = [], recipes = [], sops = [], finishedGoods = [], storageLocations = [], equipment = [], auth, readOnly = false, processOnly = false, notify, onViewProcess, onClose, onSave }) {
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
    equipment_ids: [],
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
    } catch {
      // Workspace owns completion errors and notifications; keep this modal retryable.
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
        <section className="rounded-2xl border border-border bg-white p-4 sm:p-5">
          <div className="text-sm font-black text-text-primary">Actual Equipment Used</div>
          <div className="mt-1 text-xs font-semibold text-text-secondary">Select the equipment instances used for this production. SOP equipment descriptions remain planning guidance.</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {equipment.filter((item) => item.status === "active").map((item) => {
              const selected = form.equipment_ids.includes(item.id);
              return <label key={item.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm font-semibold ${selected ? "border-primary bg-primary/5" : "border-border bg-slate-50"}`}>
                <input type="checkbox" checked={selected} onChange={() => setForm((current) => ({ ...current, equipment_ids: selected ? current.equipment_ids.filter((id) => id !== item.id) : [...current.equipment_ids, item.id] }))} />
                <span className="min-w-0"><span className="block font-bold text-text-primary">{item.name}</span><span className="block text-xs text-text-secondary">{item.equipment_code} · {item.category?.name || "Uncategorised"} · {item.location?.location_name || "Location"}</span></span>
              </label>;
            })}
            {!equipment.filter((item) => item.status === "active").length ? <div className="text-sm font-semibold text-text-secondary">No active Equipment is available.</div> : null}
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
