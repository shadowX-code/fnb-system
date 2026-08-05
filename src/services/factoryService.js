import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";
import { uploadOptimizedImage } from "../utils/imageUpload.js";

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function optionalNumber(value) {
  return value === null || value === undefined || value === "" ? "" : normalizeNumber(value);
}

function normalizeJobPriority(value) {
  const priority = String(value || "").trim().toLowerCase();
  if (priority === "urgent") return "Urgent";
  if (priority === "high") return "High";
  if (priority === "low") return "Low";
  return "Normal";
}

function normalizeSopMinutes(value, label, blankValue = 0) {
  if (value === null || value === undefined || value === "") return blankValue;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
  return numeric;
}

function databaseUuid(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function throwFactorySupabaseError(scope, error) {
  if (!error) return;
  try {
    throwSupabaseError(scope, error);
  } catch (wrappedError) {
    wrappedError.code = error.code;
    wrappedError.details = error.details;
    wrappedError.hint = error.hint;
    wrappedError.status = error.status;
    wrappedError.statusCode = error.statusCode;
    throw wrappedError;
  }
}

export function strictTimeValueMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim());
  return match ? (Number(match[1]) * 60) + Number(match[2]) : null;
}

export function strictDateValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? timestamp : null;
}

export function strictDateTimeValue(dateValue, timeValue) {
  const dateTimestamp = strictDateValue(dateValue);
  const timeMinutes = strictTimeValueMinutes(timeValue);
  if (dateTimestamp === null || timeMinutes === null) return null;
  return dateTimestamp + (timeMinutes * 60 * 1000);
}

export function productionQcStatus(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const isEntered = (result) => result.qc_type === "checklist"
    ? Boolean(result.checklist_result)
    : Boolean(String(result.remarks || "").trim());
  const isRequiredComplete = (result) => !result.is_required || (result.qc_type === "checklist"
    ? Boolean(result.checklist_result) && (result.checklist_result !== "na" || Boolean(String(result.remarks || "").trim()))
    : Boolean(String(result.remarks || "").trim()));
  const failed = rows.filter((result) => result.qc_type === "checklist" && result.checklist_result === "fail").length;
  const entered = rows.filter(isEntered).length;
  const requiredRows = rows.filter((result) => result.is_required);
  const requiredCompleted = requiredRows.filter(isRequiredComplete).length;
  const status = !rows.length
    ? "No QC Required"
    : !entered
      ? "Not Started"
      : failed
        ? "Failed"
        : requiredCompleted < requiredRows.length
          ? "In Progress"
          : "Passed";
  return {
    status,
    total: rows.length,
    entered,
    failed,
    requiredTotal: requiredRows.length,
    requiredCompleted,
  };
}

function normalizePackSizeToBase(qty, uom) {
  const amount = Number(qty || 0);
  const unit = String(uom || "").trim().toLowerCase();
  if (!amount || !unit) return null;
  if (["kg", "kilogram", "kilograms"].includes(unit)) return { amount, uom: "kg" };
  if (["g", "gram", "grams"].includes(unit)) return { amount: amount / 1000, uom: "kg" };
  if (["l", "litre", "liter", "litres", "liters"].includes(unit)) return { amount, uom: "L" };
  if (["ml", "millilitre", "milliliter", "millilitres", "milliliters"].includes(unit)) return { amount: amount / 1000, uom: "L" };
  return null;
}

function packagingProductionPlan(packQty, sku, recipeUom = "") {
  const targetPackQty = normalizeNumber(packQty);
  const packSizeQty = normalizeNumber(sku?.pack_size_qty || sku?.base_qty);
  const packSizeUom = sku?.pack_size_uom || sku?.base_uom || "";
  const packBase = normalizePackSizeToBase(packSizeQty, packSizeUom);
  const recipeBase = recipeUom ? normalizePackSizeToBase(1, recipeUom) : null;

  if (!targetPackQty) return { target_pack_qty: 0, target_production_qty: 0, production_uom: recipeBase?.uom || packBase?.uom || "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  if (!packSizeQty || !packSizeUom) return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU needs Pack Size before creating Job Order." };
  if (packBase) {
    if (recipeBase && recipeBase.uom !== packBase.uom) return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: recipeBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU Pack Size UOM cannot convert to the active recipe UOM." };
    return { target_pack_qty: targetPackQty, target_production_qty: targetPackQty * packBase.amount, production_uom: packBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  }

  const normalizedPackUom = String(packSizeUom || "").trim();
  const normalizedRecipeUom = String(recipeUom || "").trim();
  if (normalizedRecipeUom && normalizedRecipeUom.toLowerCase() !== normalizedPackUom.toLowerCase()) return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: normalizedRecipeUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU Pack Size UOM cannot convert to the active recipe UOM." };
  return { target_pack_qty: targetPackQty, target_production_qty: targetPackQty * packSizeQty, production_uom: normalizedRecipeUom || normalizedPackUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
}

function packagingPackEstimate(productionQty, productionUom, sku, recipeUom = "") {
  const targetProductionQty = normalizeNumber(productionQty);
  const packSizeQty = normalizeNumber(sku?.pack_size_qty || sku?.base_qty);
  const packSizeUom = sku?.pack_size_uom || sku?.base_uom || "";
  const packBase = normalizePackSizeToBase(packSizeQty, packSizeUom);
  const productionBase = normalizePackSizeToBase(targetProductionQty, productionUom);
  const recipeBase = recipeUom ? normalizePackSizeToBase(1, recipeUom) : null;

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

function mapJobOrder(row) {
  const finishedGood = row.finished_good || {
    product_code: row.product_code,
    product_name: row.product_name_en || row.product_name,
    product_name_en: row.product_name_en,
    product_name_cn: row.product_name_cn,
    product_name_bm: row.product_name_bm,
    status: row.finished_good_status,
    product_family_id: row.product_family_id,
    product_family: { name_en: row.product_family_name },
    variant_name: row.variant_name,
    packaging_type: row.packaging_type,
    pack_size_qty: row.pack_size_qty,
    pack_size_uom: row.pack_size_uom,
    base_qty: row.base_qty,
    base_uom: row.base_uom,
    uom: row.finished_good_uom,
  };
  const status = row.status || "draft";
  return {
    id: row.id,
    job_order_no: row.job_order_no,
    finished_good_id: row.finished_good_id || "",
    product_code: finishedGood.product_code || "",
    product_name: finishedGood.product_name || row.product_name || "",
    product_name_en: finishedGood.product_name_en || finishedGood.product_name || row.product_name || "",
    product_name_cn: finishedGood.product_name_cn || "",
    product_name_bm: finishedGood.product_name_bm || "",
    finished_good_status: finishedGood.status || "",
    product_family_id: finishedGood.product_family_id || "",
    product_family_name: finishedGood.product_family?.name_en || "",
    variant_name: finishedGood.variant_name || "",
    pack_size_qty: normalizeNumber(finishedGood.pack_size_qty || finishedGood.base_qty),
    pack_size_uom: finishedGood.pack_size_uom || finishedGood.base_uom || "",
    target_pack_qty: optionalNumber(row.target_pack_qty),
    target_production_qty: optionalNumber(row.target_production_qty),
    target_quantity: normalizeNumber(row.target_quantity),
    produced_quantity: normalizeNumber(row.produced_quantity),
    uom: row.uom || finishedGood.uom || "",
    planned_date: row.planned_date || "",
    due_date: row.due_date || "",
    priority: normalizeJobPriority(row.priority),
    status,
    assigned_team: row.assigned_team || "",
    remarks: row.remarks || "",
    created_by: row.created_by || "",
    released_at: row.released_at || "",
    released_by: row.released_by || "",
    started_at: row.started_at || "",
    started_by: row.started_by || "",
    production_operator_id: row.production_operator_id || "",
    production_operator_name: row.production_operator_name || "",
    production_date: row.production_date || "",
    start_time: row.start_time || "",
    production_sop_id: row.production_sop_id || "",
    sop_version: row.sop_version || "",
    qc_snapshot_created_at: row.qc_snapshot_created_at || "",
    step_executions: (row.step_executions || []).map(mapProductionStepExecution).sort((a, b) => a.step_no - b.step_no),
    completed_at: row.completed_at || "",
    completed_by: row.completed_by || "",
    manufacturing_date: row.manufacturing_date || "",
    completed_production_id: row.completed_production_id || "",
    production_status: row.completed_production_status || "",
    production_qc_status: row.production_qc_status || "",
    batch_no: row.batch_no || "",
    created_by_name: row.created_by_name || row.creator?.nickname || row.creator?.full_name || row.created_by || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRawMaterial(row) {
  const categoryName = row.category_ref?.name || row.category || "";
  const storageLocationName = row.storage_location_ref?.location_name || row.storage_location || "";
  return {
    id: row.id,
    material_code: row.material_code || "",
    name: row.name_en || row.name || "",
    name_en: row.name_en || row.name || "",
    name_cn: row.name_cn || "",
    name_bm: row.name_bm || "",
    image_url: row.image_url || "",
    category_id: row.category_id || "",
    category: categoryName,
    uom: row.uom || "",
    current_balance: normalizeNumber(row.current_balance),
    min_stock_level: normalizeNumber(row.min_stock_level),
    manual_unit_cost: optionalNumber(row.manual_unit_cost),
    manual_cost_uom: row.manual_cost_uom || "",
    preferred_supplier: row.preferred_supplier || "",
    storage_location_id: row.storage_location_id || "",
    storage_location: storageLocationName,
    status: row.status || "active",
    remarks: row.remarks || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapStorageLocation(row) {
  return {
    id: row.id,
    location_name: row.location_name || "",
    location_code: row.location_code || "",
    location_type: row.location_type || "",
    status: row.status || "active",
    remarks: row.remarks || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRawMaterialCategory(row) {
  return {
    id: row.id,
    name: row.name || "",
    description: row.description || "",
    status: row.status || "active",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapFactorySupplier(row) {
  return {
    id: row.id,
    supplier_name: row.supplier_name || "",
    supplier_code: row.supplier_code || "",
    contact_person: row.contact_person || "",
    phone: row.phone || "",
    email: row.email || "",
    status: row.status || "active",
    remarks: row.remarks || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapFactoryCustomer(row) {
  return {
    id: row.id,
    customer_code: row.customer_code || "",
    customer_name: row.customer_name || "",
    customer_type: row.customer_type || "Other",
    contact_person: row.contact_person || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    status: row.status || "active",
    remarks: row.remarks || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapReceivingBatch(row) {
  const items = (row.items ?? []).map(mapReceiving);
  return {
    id: row.id,
    batch_no: row.batch_no || "",
    reference_no: row.reference_no || "",
    supplier_id: row.supplier_id || "",
    supplier_name: row.supplier?.supplier_name || row.supplier_name || "",
    received_date: row.received_date || "",
    remarks: row.remarks || "",
    status: row.status || "active",
    created_by: row.created_by || "",
    created_by_name: row.creator?.nickname || row.creator?.full_name || row.created_by || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    items,
    items_count: items.length,
    total_qty: items.reduce((sum, item) => sum + normalizeNumber(item.received_qty), 0),
    total_cost: items.reduce((sum, item) => sum + normalizeNumber(item.total_cost), 0),
  };
}

function mapReceiving(row) {
  return {
    id: row.id,
    batch_id: row.batch_id || "",
    receipt_no: row.receipt_no,
    reference_no: row.invoice_no || "",
    supplier_id: row.supplier_id || "",
    raw_material_id: row.raw_material_id,
    raw_material_code: row.raw_material?.material_code || "",
    raw_material_name: row.raw_material?.name_en || row.raw_material?.name || row.raw_material_name || "",
    raw_material_name_cn: row.raw_material?.name_cn || "",
    raw_material_name_bm: row.raw_material?.name_bm || "",
    supplier_name: row.supplier_name || "",
    batch_no: row.batch_no || "",
    received_qty: normalizeNumber(row.received_qty),
    uom: row.uom || row.raw_material?.uom || "",
    unit_cost: normalizeNumber(row.unit_cost),
    total_cost: normalizeNumber(row.total_cost),
    invoice_no: row.invoice_no || "",
    received_date: row.received_date || "",
    expiry_date: row.expiry_date || "",
    storage_location_id: row.storage_location_id || "",
    storage_location: row.storage_location_ref?.location_name || row.storage_location || "",
    remarks: row.remarks || "",
    received_by: row.received_by || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRawMaterialMovement(row) {
  const rawMaterial = row.raw_material || {};
  return {
    id: row.id,
    raw_material_id: row.raw_material_id || "",
    raw_material_code: rawMaterial.material_code || "",
    raw_material_name: rawMaterial.name_en || rawMaterial.name || "",
    movement_type: row.movement_type || "",
    quantity: normalizeNumber(row.quantity),
    uom: row.uom || rawMaterial.uom || "",
    storage_location: row.storage_location || rawMaterial.storage_location_ref?.location_name || rawMaterial.storage_location || "",
    batch_no: row.batch_no || "",
    balance_after: row.balance_after == null ? null : normalizeNumber(row.balance_after),
    reference_type: row.reference_type || "",
    reference_id: row.reference_id || "",
    reference_no: row.reference_no || "",
    movement_date: row.movement_date || "",
    notes: row.notes || "",
    created_by: row.created_by || "",
    created_by_name: row.creator?.nickname || row.creator?.full_name || row.created_by_name || row.created_by || "",
    created_at: row.created_at,
  };
}

function mapProductionUsage(row) {
  return {
    id: row.id,
    production_id: row.production_id,
    raw_material_id: row.raw_material_id,
    raw_material_receiving_id: row.raw_material_receiving_id || "",
    raw_material_name: row.raw_material?.name_en || row.raw_material?.name || "",
    raw_material_lot_no: row.raw_material_lot_no || row.raw_receiving?.batch_no || "",
    receiving_ref: row.raw_receiving?.receipt_no || "",
    supplier_name: row.raw_receiving?.supplier_name || "",
    unit_cost: normalizeNumber(row.raw_receiving?.unit_cost),
    standard_usage: normalizeNumber(row.standard_usage),
    actual_usage: normalizeNumber(row.actual_usage || row.quantity_used),
    variance_qty: normalizeNumber(row.variance_qty),
    variance_percent: normalizeNumber(row.variance_percent),
    variance_reason: row.variance_reason || "",
    uom: row.uom || row.raw_material?.uom || "",
    wastage_quantity: normalizeNumber(row.wastage_quantity),
    notes: row.notes || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProductionQcCheckpoint(row) {
  return {
    id: row.id,
    production_id: row.production_id,
    production_sop_id: row.production_sop_id || "",
    sop_step_id: row.sop_step_id || "",
    step_no: normalizeNumber(row.step_no),
    process_name: row.process_name || "",
    control_point: row.control_point || "",
    qc_status: row.qc_status || "Pending",
    notes: row.notes || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProductionQcResult(row) {
  return {
    id: row.id,
    job_order_id: row.job_order_id || "",
    production_id: row.production_id || "",
    production_step_execution_id: row.production_step_execution_id || "",
    sop_qc_check_id: row.sop_qc_check_id || "",
    sequence_no: normalizeNumber(row.sequence_no),
    qc_type: row.qc_type || "checklist",
    qc_name: row.qc_name || "QC Check",
    instructions: row.instructions || "",
    is_required: Boolean(row.is_required),
    checklist_result: row.checklist_result || "",
    remarks: row.remarks || "",
    checked_by: row.checked_by || "",
    checked_by_name: row.checked_by_name || "",
    checked_at: row.checked_at || "",
  };
}

function mapProductionStepExecution(row) {
  return {
    id: row.id,
    job_order_id: row.job_order_id || "",
    production_id: row.production_id || "",
    production_sop_id: row.production_sop_id || "",
    sop_step_id: row.sop_step_id || "",
    step_no: normalizeNumber(row.step_no),
    step_name: row.step_name || "Production Step",
    description: row.description || "",
    sub_steps: Array.isArray(row.sub_steps) ? row.sub_steps : [],
    status: row.status || "pending",
    completed_by: row.completed_by || "",
    completed_at: row.completed_at || "",
    qc_results: (row.qc_results || []).map(mapProductionQcResult).sort((a, b) => a.sequence_no - b.sequence_no),
  };
}

function mapProduction(row) {
  return {
    id: row.id,
    job_order_id: row.job_order_id || "",
    finished_good_id: row.finished_good_id || row.job_order?.finished_good_id || "",
    production_no: row.production_no || "",
    product_code: row.finished_good?.product_code || row.job_order?.finished_good?.product_code || "",
    product_name: row.finished_good?.product_name || row.product_name || row.job_order?.product_name || "",
    product_name_en: row.finished_good?.product_name_en || row.finished_good?.product_name || row.product_name || "",
    product_name_cn: row.finished_good?.product_name_cn || "",
    product_name_bm: row.finished_good?.product_name_bm || "",
    product_family_id: row.finished_good?.product_family_id || row.job_order?.finished_good?.product_family_id || "",
    product_family_name: row.finished_good?.product_family?.name_en || "",
    job_order_no: row.job_order?.job_order_no || "",
    batch_no: row.batch_no || "",
    actual_pack_qty: optionalNumber(row.actual_pack_qty),
    actual_output_qty: optionalNumber(row.actual_output_qty),
    produced_quantity: normalizeNumber(row.produced_quantity),
    actual_produced_qty: normalizeNumber(row.actual_produced_qty || row.produced_quantity),
    good_output_qty: normalizeNumber(row.good_output_qty || row.produced_quantity),
    wastage_qty: normalizeNumber(row.wastage_qty),
    uom: row.uom || "",
    production_date: row.production_date || "",
    manufacturing_date: row.manufacturing_date || "",
    end_date: row.end_date || "",
    expiry_date: row.expiry_date || "",
    storage_location_id: row.storage_location_id || "",
    storage_location: row.storage_location_ref?.location_name || "",
    storage_location_type: row.storage_location_ref?.location_type || "",
    shelf_life_days_snapshot: optionalNumber(row.shelf_life_days_snapshot),
    expiry_override_reason: row.expiry_override_reason || "",
    operator_id: row.operator_id || "",
    operator_name: row.operator_name || "",
    start_time: row.start_time || "",
    end_time: row.end_time || "",
    qc_status: row.qc_status || "Pending",
    production_sop_id: row.production_sop_id || "",
    sop_version: row.sop_version || row.production_sop?.version || "",
    sop_title: row.production_sop?.title || "",
    sop_code: row.production_sop?.sop_code || "",
    status: row.status || "draft",
    notes: row.notes || "",
    created_by: row.created_by || "",
    completed_at: row.completed_at || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    material_usage: (row.material_usage ?? []).map(mapProductionUsage),
    qc_checkpoints: (row.qc_checkpoints ?? []).map(mapProductionQcCheckpoint),
    step_executions: (row.step_executions ?? []).map(mapProductionStepExecution).sort((a, b) => a.step_no - b.step_no),
  };
}

function mapFinishedGood(row) {
  const storageLocationName = row.storage_location_ref?.location_name || row.storage_location || "";
  const productFamily = row.product_family || {};
  return {
    id: row.id,
    product_code: row.product_code || "",
    product_name: row.product_name || "",
    product_name_en: row.product_name_en || row.product_name || "",
    product_name_cn: row.product_name_cn || "",
    product_name_bm: row.product_name_bm || "",
    product_family_id: row.product_family_id || "",
    product_family_name: productFamily.name_en || row.product_family_name || "",
    product_family_name_cn: productFamily.name_cn || "",
    product_family_name_bm: productFamily.name_bm || "",
    variant_name: row.variant_name || "",
    packaging_type: row.packaging_type || "Pack",
    pack_size_qty: optionalNumber(row.pack_size_qty),
    pack_size_uom: row.pack_size_uom || "",
    base_qty: optionalNumber(row.base_qty),
    base_uom: row.base_uom || "",
    category_id: row.category_id || "",
    category: row.category_ref?.name || row.category || "",
    uom: row.uom || "",
    current_balance: normalizeNumber(row.current_balance),
    min_stock_level: normalizeNumber(row.min_stock_level),
    shelf_life_days: optionalNumber(row.shelf_life_days),
    storage_location_id: row.storage_location_id || "",
    storage_location: storageLocationName,
    storage_location_type: row.storage_location_ref?.location_type || "",
    storage_location_status: row.storage_location_ref?.status || "",
    status: row.status || "active",
    remarks: row.remarks || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProductFamily(row) {
  return {
    id: row.id,
    name_en: row.name_en || "",
    name_cn: row.name_cn || "",
    name_bm: row.name_bm || "",
    category_id: row.category_id || "",
    category: row.category?.name || "",
    status: row.status || "active",
    remarks: row.remarks || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapFinishedGoodCategory(row) {
  return {
    id: row.id,
    name: row.name || "",
    description: row.description || "",
    status: row.status || "active",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProductMovement(row) {
  const finishedGood = row.finished_good || {};
  const batchAllocations = Array.isArray(row.batch_allocations) ? row.batch_allocations.map((allocation) => ({
    batch_balance_id: allocation.batch_balance_id || "",
    batch_id: allocation.batch_balance_id || "",
    batch_no: allocation.batch_no || "",
    batch_type: allocation.batch_type || "production",
    quantity: normalizeNumber(allocation.quantity),
    expiry_date: allocation.expiry_date || "",
    storage_location: allocation.storage_location || "",
    storage_location_type: allocation.storage_location_type || "",
  })) : [];
  return {
    id: row.id,
    finished_good_id: row.finished_good_id || "",
    product_code: finishedGood.product_code || "",
    product_name: finishedGood.product_family?.name_en || finishedGood.product_name_en || finishedGood.product_name || row.product_name || "",
    sku_product_name: finishedGood.product_name_en || finishedGood.product_name || row.product_name || "",
    product_family_id: finishedGood.product_family_id || "",
    product_family_name: finishedGood.product_family?.name_en || "",
    category_id: finishedGood.category_id || "",
    category: finishedGood.category_ref?.name || finishedGood.category || "",
    variant_name: finishedGood.variant_name || "",
    packaging_type: finishedGood.packaging_type || "Pack",
    pack_size_qty: optionalNumber(finishedGood.pack_size_qty || finishedGood.base_qty),
    pack_size_uom: finishedGood.pack_size_uom || finishedGood.base_uom || "",
    base_qty: optionalNumber(finishedGood.base_qty),
    base_uom: finishedGood.base_uom || "",
    current_balance: normalizeNumber(finishedGood.current_balance),
    movement_type: row.movement_type || "",
    quantity: normalizeNumber(row.quantity),
    uom: row.uom || finishedGood.uom || "",
    reference_type: row.reference_type || "",
    reference_id: row.reference_id || "",
    dispatch_item_id: row.dispatch_item_id || "",
    reference_no: row.reference_no || "",
    movement_date: row.movement_date || "",
    notes: row.notes || "",
    created_by: row.created_by || "",
    created_at: row.created_at,
    balance_after: row.balance_after == null ? null : normalizeNumber(row.balance_after),
    batch_no: row.batch_no || "",
    batch_count: normalizeNumber(row.batch_count, batchAllocations.length),
    total_allocated_qty: normalizeNumber(row.total_allocated_qty),
    batch_summary: row.batch_summary || row.batch_no || "",
    batch_allocations: batchAllocations,
    source_reference: row.source_reference || "",
  };
}

function mapFinishedGoodDispatchItem(row) {
  const finishedGood = row.finished_good || row || {};
  const allocations = (row.allocations || []).map((allocation) => {
    const batch = allocation.batch || {};
    const currentLocation = batch.storage_location_ref || null;
    const locationIssue = allocation.location_valid === true
      ? ""
      : allocation.location_issue || (!batch.storage_location_id || !currentLocation
      ? "Storage location missing"
      : String(currentLocation.status || "").toLowerCase() !== "active"
        ? "Storage location archived"
        : String(currentLocation.location_type || "").toLowerCase() !== "finished goods area"
          ? "Storage location is not a Finished Goods Area"
          : "");
    return {
    id: allocation.id,
    batch_id: allocation.batch_balance_id || "",
    production_id: allocation.production_id || "",
    quantity: normalizeNumber(allocation.quantity),
    batch_no: allocation.batch_no || "",
    manufacturing_date: allocation.manufacturing_date || "",
    expiry_date: allocation.expiry_date || "",
    storage_location_id: allocation.storage_location_id || "",
    storage_location: currentLocation?.location_name || batch.storage_location || allocation.storage_location || "",
    storage_location_type: currentLocation?.location_type || batch.storage_location_type || allocation.storage_location_type || "",
    batch_type: batch.source_type || allocation.batch_type || "production",
    current_balance: normalizeNumber(batch.current_balance ?? allocation.current_balance),
    location_valid: !locationIssue,
    location_issue: locationIssue,
  };
  });
  return {
    id: row.id,
    dispatch_id: row.dispatch_id || "",
    finished_good_id: row.finished_good_id || "",
    product_code: finishedGood.product_code || "",
    product_name: finishedGood.product_family?.name_en || finishedGood.product_name_en || finishedGood.product_name || "",
    sku_product_name: finishedGood.product_name_en || finishedGood.product_name || "",
    variant_name: finishedGood.variant_name || "",
    packaging_type: finishedGood.packaging_type || "Pack",
    pack_size_qty: optionalNumber(finishedGood.pack_size_qty || finishedGood.base_qty),
    pack_size_uom: finishedGood.pack_size_uom || finishedGood.base_uom || "",
    current_balance: normalizeNumber(finishedGood.current_balance),
    quantity: normalizeNumber(row.quantity),
    batch_no: row.batch_no || "",
    remarks: row.remarks || "",
    created_at: row.created_at,
    allocations,
  };
}

function mapFinishedGoodDispatch(row) {
  const items = (row.items ?? []).map(mapFinishedGoodDispatchItem);
  const completedByName = row.completer?.nickname || row.completer?.full_name || row.completed_by_name || "";
  return {
    id: row.id,
    dispatch_no: row.dispatch_no || "",
    dispatch_date: row.dispatch_date || "",
    customer_id: row.customer_id || "",
    customer_name: row.customer?.customer_name || row.customer_name || "",
    customer_code: row.customer?.customer_code || "",
    customer_type: row.customer?.customer_type || row.customer_type || "",
    reference_no: row.reference_no || "",
    status: row.status || "draft",
    remarks: row.remarks || "",
    created_by: row.created_by || "",
    created_by_name: row.creator?.nickname || row.creator?.full_name || row.created_by_name || "",
    completed_by: row.completed_by || "",
    completed_by_employee: row.completed_by && completedByName ? {
      id: row.completed_by,
      nickname: row.completer?.nickname || "",
      full_name: row.completer?.full_name || "",
      display_name: completedByName,
    } : null,
    completed_by_name: completedByName,
    completion_request_id: row.completion_request_id || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || "",
    cancelled_at: row.cancelled_at || "",
    items,
    items_count: items.length,
    total_qty: items.reduce((sum, item) => sum + normalizeNumber(item.quantity), 0),
  };
}

function mapFinishedGoodBatchTraceability(row) {
  const dispatchAllocations = Array.isArray(row.dispatch_allocations) ? row.dispatch_allocations : [];
  const reconciliationDiagnostics = Array.isArray(row.reconciliation_diagnostics)
    ? row.reconciliation_diagnostics
    : Array.isArray(row.diagnostics) ? row.diagnostics : [];
  return {
    id: row.batch_balance_id || row.id,
    batch_balance_id: row.batch_balance_id || row.id,
    batch_type: row.batch_type || "production",
    finished_good_id: row.finished_good_id || "",
    packaging_sku_code: row.packaging_sku_code || "",
    packaging_sku_name: row.packaging_sku_name || "",
    finished_good_name: row.finished_good_name || "",
    batch_no: row.batch_no || "",
    original_qty: normalizeNumber(row.original_qty),
    completed_dispatch_qty: normalizeNumber(row.completed_dispatch_qty),
    completed_negative_adjustment_qty: normalizeNumber(row.completed_negative_adjustment_qty),
    current_balance: normalizeNumber(row.current_balance),
    provisional_draft_qty: normalizeNumber(row.provisional_draft_qty),
    production_start_date: row.production_start_date || "",
    production_start_time: row.production_start_time || "",
    manufacturing_date: row.manufacturing_date || "",
    expiry_date: row.expiry_date || "",
    storage_location_id: row.storage_location_id || "",
    storage_location_name: row.storage_location_name || "",
    storage_location_type: row.storage_location_type || "",
    storage_location_status: row.storage_location_status || "",
    production_id: row.production_id || "",
    source_reference_id: row.source_reference_id || "",
    source_reference: row.source_reference || "",
    source_reason: row.source_reason || "",
    production_reference: row.production_reference || "",
    recipe_version: row.recipe_version || "",
    sop_name: row.sop_name || "",
    sop_version: row.sop_version || "",
    qc_status: row.qc_status || "",
    operator_name: row.operator_name || "",
    reconciliation_status: row.reconciliation_status || "mismatch",
    dispatch_allocations: dispatchAllocations,
    reconciliation_diagnostics: reconciliationDiagnostics,
    diagnostics: reconciliationDiagnostics,
    qc_checks: Array.isArray(row.qc_checks) ? row.qc_checks : [],
    related_movements: Array.isArray(row.related_movements) ? row.related_movements : [],
    details: Array.isArray(row.details) ? row.details : [],
    timeline: Array.isArray(row.timeline) ? row.timeline : [],
    created_at: row.created_at,
  };
}

function normalizeStockCheckItem(row, stockType) {
  const itemName = stockType === "raw" ? row.raw_material?.name : row.finished_good?.product_name;
  const systemQty = normalizeNumber(row.system_qty);
  const physicalQty = normalizeNumber(row.physical_qty);
  const varianceQty = normalizeNumber(row.variance_qty, physicalQty - systemQty);
  const variancePercent = normalizeNumber(row.variance_percent);
  return {
    id: row.id,
    stock_check_id: row.stock_check_id,
    raw_material_id: row.raw_material_id || "",
    finished_good_id: row.finished_good_id || "",
    item_name: itemName || "",
    system_qty: systemQty,
    physical_qty: physicalQty,
    variance_qty: varianceQty,
    variance_percent: variancePercent,
    count_status: row.count_status || (row.variance_status === "Skipped" ? "skip" : "counted"),
    variance_status: row.variance_status || "Normal",
    variance_reason: row.variance_reason || "",
    adjustment_storage_location_id: row.adjustment_storage_location_id || "",
    batch_allocations: (row.batch_allocations || []).map((allocation) => {
      const batch = allocation.batch || {};
      const currentLocation = batch.storage_location_ref || null;
      const locationIssue = !batch.storage_location_id || !currentLocation
        ? "Storage location missing"
        : String(currentLocation.status || "").toLowerCase() !== "active"
          ? "Storage location archived"
          : String(currentLocation.location_type || "").toLowerCase() !== "finished goods area"
            ? "Storage location is not a Finished Goods Area"
            : "";
      return {
        id: allocation.id,
        batch_id: allocation.batch_balance_id,
        quantity: normalizeNumber(allocation.quantity),
        batch_no: batch.batch_no || "",
        manufacturing_date: batch.manufacturing_date || "",
        expiry_date: batch.expiry_date || "",
        storage_location_id: batch.storage_location_id || "",
        storage_location: currentLocation?.location_name || batch.storage_location || "",
        storage_location_type: currentLocation?.location_type || batch.storage_location_type || "",
        storage_location_status: currentLocation?.status || "",
        location_valid: !locationIssue,
        location_issue: locationIssue,
      };
    }),
    uom: row.uom || row.raw_material?.uom || row.finished_good?.uom || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapStockCheckEmployee(employee) {
  const value = Array.isArray(employee) ? employee[0] : employee;
  if (!value?.id) return null;
  return {
    id: value.id,
    nickname: value.nickname || "",
    full_name: value.full_name || "",
    email: value.email || "",
  };
}

function stockCheckEmployeeName(employee) {
  return employee?.nickname || employee?.full_name || employee?.email || "";
}

function mapStockCheck(row, stockType) {
  const createdByEmployee = mapStockCheckEmployee(row.created_by_employee);
  const submittedByEmployee = mapStockCheckEmployee(row.submitted_by_employee);
  const approvedByEmployee = mapStockCheckEmployee(row.approved_by_employee);
  return {
    id: row.id,
    check_no: row.check_no || "",
    check_date: row.check_date || "",
    category_id: row.category_id || "",
    category_name: row.category?.name || "",
    status: row.status || "draft",
    notes: row.notes || "",
    created_by: row.created_by || "",
    created_by_employee: createdByEmployee,
    created_by_name: stockCheckEmployeeName(createdByEmployee),
    submitted_by: row.submitted_by || "",
    submitted_by_employee: submittedByEmployee,
    submitted_by_name: stockCheckEmployeeName(submittedByEmployee),
    submitted_at: row.submitted_at || "",
    approved_by: row.approved_by || "",
    approved_by_employee: approvedByEmployee,
    approved_by_name: stockCheckEmployeeName(approvedByEmployee),
    approved_at: row.approved_at || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: (row.items ?? []).map((item) => normalizeStockCheckItem(item, stockType)),
  };
}

function mapRecipe(row) {
  const finishedGood = row.finished_good || {};
  const productFamily = row.product_family || finishedGood.product_family || {};
  return {
    id: row.id,
    recipe_code: row.recipe_code || "",
    finished_good_id: row.finished_good_id || "",
    product_family_id: row.product_family_id || finishedGood.product_family_id || "",
    product_family_name: productFamily.name_en || "",
    product_code: finishedGood.product_code || "",
    recipe_name: row.recipe_name || row.recipe_code || "",
    product_name: productFamily.name_en || finishedGood.product_name || row.product_name || "",
    product_name_en: productFamily.name_en || finishedGood.product_name_en || finishedGood.product_name || row.product_name || "",
    product_name_cn: productFamily.name_cn || finishedGood.product_name_cn || "",
    product_name_bm: productFamily.name_bm || finishedGood.product_name_bm || "",
    version: row.version || "v1",
    yield_quantity: normalizeNumber(row.yield_quantity, 1),
    uom: row.uom || "",
    estimated_production_time_minutes: normalizeNumber(row.estimated_production_time_minutes),
    status: row.status || "draft",
    notes: row.notes || "",
    remarks: row.remarks || row.notes || "",
    created_by: row.created_by || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      raw_material_id: item.raw_material_id,
      raw_material_name: item.raw_material?.name_en || item.raw_material?.name || "",
      manual_unit_cost: optionalNumber(item.raw_material?.manual_unit_cost),
      manual_cost_uom: item.raw_material?.manual_cost_uom || "",
      quantity_used: normalizeNumber(item.quantity_used),
      uom: item.uom || item.raw_material?.uom || "",
      wastage_percent: normalizeNumber(item.wastage_percent),
      sort_order: normalizeNumber(item.sort_order),
      notes: item.notes || "",
      remarks: item.remarks || item.notes || "",
    })).sort((a, b) => a.sort_order - b.sort_order),
  };
}

function mapProductionSop(row) {
  const finishedGood = row.finished_good || {};
  const linkedRecipe = row.linked_recipe ? mapRecipe(row.linked_recipe) : null;
  return {
    id: row.id,
    sop_code: row.sop_code || "",
    title: row.title || "",
    sop_name: row.title || "",
    finished_good_id: row.finished_good_id || "",
    recipe_id: row.recipe_id || linkedRecipe?.id || "",
    recipe_version: row.recipe_version || linkedRecipe?.version || "",
    linked_recipe: linkedRecipe,
    product_name: finishedGood.name_en || row.product_name || "",
    product_name_en: finishedGood.name_en || row.product_name || "",
    product_name_cn: finishedGood.name_cn || "",
    product_name_bm: finishedGood.name_bm || "",
    version: row.version || "v1",
    effective_date: row.effective_date || "",
    equipment: row.equipment || "",
    estimated_minutes: normalizeNumber(row.estimated_minutes),
    status: row.status === "inactive" ? "archived" : row.status || "draft",
    notes: row.notes || row.remarks || "",
    remarks: row.remarks || row.notes || "",
    created_by: row.created_by || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    steps: (row.steps ?? []).map((step) => ({
      id: step.id,
      sop_id: step.sop_id,
      step_no: normalizeNumber(step.step_no),
      process_name: step.process_name || step.instruction || "",
      step_name: step.process_name || step.instruction || "",
      description: step.description || step.instruction || "",
      control_point: step.control_point || step.qc_label || "",
      qc_label: step.qc_label || step.control_point || "",
      materials: step.materials || "",
      equipment: step.equipment || "",
      estimated_time_minutes: normalizeNumber(step.estimated_time_minutes || step.expected_duration_minutes),
      is_qc_checkpoint: Boolean(step.is_qc_checkpoint),
      qc_required: Boolean(step.is_qc_checkpoint) || Boolean(step.qc_checks?.length),
      qc_measurement_type: step.qc_measurement_type || "",
      qc_target_value: step.qc_target_value || "",
      qc_minimum: optionalNumber(step.qc_minimum),
      qc_maximum: optionalNumber(step.qc_maximum),
      qc_uom: step.qc_uom || "",
      qc_required_before_completion: Boolean(step.qc_required_before_completion),
      qc_checks: (step.qc_checks || []).map((qc) => ({
        id: qc.id,
        sop_step_id: qc.sop_step_id,
        sequence_no: normalizeNumber(qc.sequence_no),
        qc_type: qc.qc_type || "checklist",
        checklist_template_id: qc.checklist_template_id || "",
        checklist_template_name: qc.checklist_template?.name || "",
        checklist_template_result_mode: qc.checklist_template?.result_mode || "",
        qc_name: qc.qc_name || "QC Check",
        instructions: qc.instructions || "",
        is_required: Boolean(qc.is_required),
      })).sort((a, b) => a.sequence_no - b.sequence_no),
      ingredient_material_ids: (step.ingredient_refs ?? []).map((reference) => reference.raw_material_id).filter(Boolean),
      ingredient_references: (step.ingredient_refs ?? []).map((reference) => ({
        raw_material_id: reference.raw_material_id,
        raw_material_name: reference.raw_material?.name_en || reference.raw_material?.name || "Raw Material",
        uom: reference.raw_material?.uom || "",
      })),
      sub_steps: (step.sub_steps ?? []).map((subStep) => ({
        id: subStep.id,
        sop_step_id: subStep.sop_step_id,
        sequence_no: normalizeNumber(subStep.sequence_no),
        instruction: subStep.instruction || "",
        estimated_minutes: optionalNumber(subStep.estimated_minutes),
        remarks: subStep.remarks || "",
        created_at: subStep.created_at,
        updated_at: subStep.updated_at,
      })).sort((a, b) => a.sequence_no - b.sequence_no),
      safety_note: step.safety_note || step.remarks || "",
      remarks: step.remarks || step.safety_note || "",
      created_at: step.created_at,
      updated_at: step.updated_at,
    })).sort((a, b) => a.step_no - b.step_no),
  };
}

function mapFactoryAuditLog(row) {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    action: row.action || "",
    module: metadata.module || row.module || "factory",
    description: row.description || metadata.message || "",
    target: metadata.target || row.description || "—",
    entity_reference: metadata.target || "",
    actor_id: row.user_id || "",
    actor_name: row.user_name || "System",
    status: metadata.status || row.status || "success",
    metadata,
    before: metadata.before ?? null,
    after: metadata.after ?? null,
    created_at: row.created_at,
  };
}

function makeFactoryRef(prefix) {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

async function makeDailyFactoryRef(table, prefix) {
  const date = new Date();
  const yymmdd = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const pattern = `${prefix}-${yymmdd}-%`;
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .like("check_no", pattern);
  throwSupabaseError(`factory.${table}.ref_count`, error);
  return `${prefix}-${yymmdd}-${String(Number(count || 0) + 1).padStart(3, "0")}`;
}

function stockCheckVariance(systemQty, physicalQty) {
  const system = normalizeNumber(systemQty);
  const physical = normalizeNumber(physicalQty);
  const varianceQty = physical - system;
  const variancePercent = system > 0 ? (varianceQty / system) * 100 : 0;
  const absQty = Math.abs(varianceQty);
  const absPercent = Math.abs(variancePercent);
  const varianceStatus = absQty === 0 ? "Normal" : system > 0 && absPercent >= 5 ? "Critical" : system <= 0 ? "Critical" : "Variance";
  return { varianceQty, variancePercent, varianceStatus };
}

function validateStockCheckItems(items, status) {
  if (!items.length) throw new Error("Stock check requires at least one counted item.");
  const invalid = items.find((item) => !item.itemId);
  if (invalid) throw new Error("Every stock check row needs an item.");
  if (status === "submitted") {
    const missingCount = items.find((item) => !item.is_skipped && item.physical_qty_input === "");
    if (missingCount) throw new Error("Submit requires every stock check row to be counted or skipped.");
    const missingSkipReason = items.find((item) => item.is_skipped && !String(item.variance_reason || "").trim());
    if (missingSkipReason) throw new Error("Skip reason is required for skipped rows.");
  }
  const invalidCount = items.find((item) => !item.is_skipped && item.physical_qty_input !== "" && normalizeNumber(item.physical_qty, -1) < 0);
  if (invalidCount) throw new Error("Physical count cannot be negative.");
  if (status === "submitted") {
    const missingReason = items.find((item) => {
      if (item.is_skipped || item.physical_qty_input === "") return false;
      const { varianceStatus } = stockCheckVariance(item.system_qty, item.physical_qty);
      return varianceStatus !== "Normal" && !String(item.variance_reason || "").trim();
    });
    if (missingReason) throw new Error("Variance reason is required for variance stock check items.");
  }
}

async function logFactoryAction({ action, target, description, after, before }) {
  await auditLogService.createAuditLog({
    action,
    module: "factory",
    target,
    description,
    before,
    after,
  }).catch(() => {});
}

async function ensureRawMaterial(receiving) {
  if (!receiving.raw_material_id) throw new Error("Select an active raw material.");
  const { data, error } = await supabase
    .from("factory_raw_materials")
    .select("id,name,name_en,name_cn,name_bm,uom,status")
    .eq("id", receiving.raw_material_id)
    .single();
  throwSupabaseError("factory.raw_material.lookup", error);
  if (!data?.id) throw new Error("Select an active raw material.");
  if (String(data.status || "").toLowerCase() !== "active") throw new Error("Archived Raw Materials cannot be selected.");
  return data.id;
}

function emptyFactoryData() {
  return {
    jobOrders: [],
    rawMaterials: [],
    rawMaterialCategories: [],
    factorySuppliers: [],
    factoryCustomers: [],
    receivingBatches: [],
    storageLocations: [],
    rawMaterialMovements: [],
    receivings: [],
    productions: [],
    finishedGoods: [],
    finishedGoodCategories: [],
    productFamilies: [],
    productMovements: [],
    finishedGoodDispatches: [],
    rawStockChecks: [],
    productStockChecks: [],
    recipes: [],
    sops: [],
    qcChecklistTemplates: [],
    auditLogs: [],
    accessIssues: [],
  };
}

const finishedGoodSelect = "id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,product_family_id,variant_name,packaging_type,pack_size_qty,pack_size_uom,base_qty,base_uom,category_id,category,uom,current_balance,shelf_life_days,status,category_ref:factory_finished_good_categories(name),product_family:factory_product_families(name_en,name_cn,name_bm,status)";
const finishedGoodFullSelect = "id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,product_family_id,variant_name,packaging_type,pack_size_qty,pack_size_uom,base_qty,base_uom,category_id,category,uom,current_balance,min_stock_level,shelf_life_days,storage_location_id,storage_location,status,remarks,created_at,updated_at,category_ref:factory_finished_good_categories(name),storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status),product_family:factory_product_families(name_en,name_cn,name_bm,status)";
const storageLocationSelect = "id,location_name,location_code,location_type,status,remarks,created_at,updated_at";
const factorySupplierSelect = "id,supplier_name,supplier_code,contact_person,phone,email,status,remarks,created_at,updated_at";
const factoryCustomerSelect = "id,customer_code,customer_name,customer_type,contact_person,phone,email,address,status,remarks,created_at,updated_at";
const rawMaterialSelect = `id,material_code,name,name_en,name_cn,name_bm,image_url,category_id,category,uom,current_balance,min_stock_level,manual_unit_cost,manual_cost_uom,preferred_supplier,storage_location_id,storage_location,status,remarks,created_at,updated_at,category_ref:factory_raw_material_categories(name),storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status)`;
const rawMaterialRelationSelect = "name,name_en,name_cn,name_bm,image_url,material_code,uom,manual_unit_cost,manual_cost_uom,storage_location,storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status)";
const productFamilyRelationSelect = "id,name_en,name_cn,name_bm,status";
const recipeRootSelect = `id,recipe_code,finished_good_id,product_family_id,recipe_name,product_name,version,yield_quantity,uom,estimated_production_time_minutes,status,notes,remarks,created_by,created_at,updated_at,product_family:factory_product_families(${productFamilyRelationSelect}),finished_good:factory_finished_goods(${finishedGoodSelect})`;
const recipeSelect = `${recipeRootSelect},items:factory_product_recipe_items(id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`;
const recipeSummarySelect = `id,recipe_code,finished_good_id,product_family_id,recipe_name,product_name,version,yield_quantity,uom,estimated_production_time_minutes,status,created_at,updated_at,product_family:factory_product_families(${productFamilyRelationSelect}),finished_good:factory_finished_goods(${finishedGoodSelect})`;
const recipeItemSelect = `id,recipe_id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,created_at,updated_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect})`;
const sopRootSelect = `id,sop_code,title,product_name,finished_good_id,recipe_id,recipe_version,version,effective_date,equipment,estimated_minutes,status,notes,remarks,created_by,created_at,updated_at,finished_good:factory_product_families(id,name_en,name_cn,name_bm,status),linked_recipe:factory_product_recipes(id,recipe_code,finished_good_id,product_family_id,recipe_name,product_name,version,yield_quantity,uom,estimated_production_time_minutes,status,notes,remarks,created_by,created_at,updated_at,product_family:factory_product_families(${productFamilyRelationSelect}),finished_good:factory_finished_goods(${finishedGoodSelect}))`;
const sopSelect = `id,sop_code,title,product_name,finished_good_id,recipe_id,recipe_version,version,effective_date,equipment,estimated_minutes,status,notes,remarks,created_by,created_at,updated_at,finished_good:factory_product_families(id,name_en,name_cn,name_bm,status),linked_recipe:factory_product_recipes(id,recipe_code,finished_good_id,product_family_id,recipe_name,product_name,version,yield_quantity,uom,status,notes,remarks,created_by,created_at,updated_at,product_family:factory_product_families(${productFamilyRelationSelect}),items:factory_product_recipe_items(id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))),steps:factory_production_sop_steps(id,sop_id,step_no,instruction,process_name,description,control_point,qc_label,materials,equipment,expected_duration_minutes,estimated_time_minutes,is_qc_checkpoint,qc_measurement_type,qc_target_value,qc_minimum,qc_maximum,qc_uom,qc_required_before_completion,safety_note,remarks,created_at,updated_at,sub_steps:factory_production_sop_sub_steps(id,sop_step_id,sequence_no,instruction,estimated_minutes,remarks,created_at,updated_at),ingredient_refs:factory_production_sop_step_materials(raw_material_id,raw_material:factory_raw_materials(name,name_en,material_code,uom)),qc_checks:factory_production_sop_step_qc_checks(id,sop_step_id,sequence_no,qc_type,checklist_template_id,qc_name,instructions,is_required,checklist_template:factory_qc_checklist_templates(name,result_mode)))`;
const sopStepSelect = "id,sop_id,step_no,instruction,process_name,description,control_point,qc_label,materials,equipment,expected_duration_minutes,estimated_time_minutes,is_qc_checkpoint,qc_measurement_type,qc_target_value,qc_minimum,qc_maximum,qc_uom,qc_required_before_completion,safety_note,remarks,created_at,updated_at";
const sopSubStepSelect = "id,sop_step_id,sequence_no,instruction,estimated_minutes,remarks,created_at,updated_at";
const sopQcCheckSelect = "id,sop_step_id,sequence_no,qc_type,checklist_template_id,qc_name,instructions,is_required,created_at,updated_at,checklist_template:factory_qc_checklist_templates(name,result_mode)";
const rawMaterialStockCheckSelect = `id,check_no,check_date,category_id,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at,created_by_employee:employees!factory_raw_material_stock_checks_created_by_fkey(id,nickname,full_name,email),submitted_by_employee:employees!factory_raw_material_stock_checks_submitted_by_fkey(id,nickname,full_name,email),approved_by_employee:employees!factory_raw_material_stock_checks_approved_by_fkey(id,nickname,full_name,email),category:factory_raw_material_categories(name),items:factory_raw_material_stock_check_items(id,stock_check_id,raw_material_id,system_qty,physical_qty,variance_qty,variance_percent,count_status,variance_status,variance_reason,uom,created_at,updated_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`;
const productStockCheckSelect = `id,check_no,check_date,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at,created_by_employee:employees!factory_product_stock_checks_created_by_fkey(id,nickname,full_name,email),submitted_by_employee:employees!factory_product_stock_checks_submitted_by_fkey(id,nickname,full_name,email),approved_by_employee:employees!factory_product_stock_checks_approved_by_fkey(id,nickname,full_name,email),items:factory_product_stock_check_items(id,stock_check_id,finished_good_id,system_qty,physical_qty,variance_qty,variance_percent,variance_status,variance_reason,uom,adjustment_storage_location_id,created_at,updated_at,finished_good:factory_finished_goods(product_name,uom),batch_allocations:factory_product_stock_check_batch_adjustments(id,batch_balance_id,quantity,batch:factory_finished_good_batch_balances(batch_no,manufacturing_date,expiry_date,storage_location_id,storage_location,storage_location_type,storage_location_ref:factory_storage_locations(location_name,location_type,status))))`;
const jobOrderSelect = `id,job_order_no,finished_good_id,product_name,target_pack_qty,target_production_qty,target_quantity,produced_quantity,uom,planned_date,due_date,priority,status,assigned_team,remarks,created_by,released_at,released_by,started_at,started_by,production_operator_id,production_operator_name,production_date,start_time,production_sop_id,sop_version,qc_snapshot_created_at,completed_at,completed_by,created_at,updated_at,finished_good:factory_finished_goods(${finishedGoodSelect}),step_executions:factory_production_step_executions(id,job_order_id,production_id,production_sop_id,sop_step_id,step_no,step_name,description,sub_steps,status,completed_by,completed_at,qc_results:factory_production_qc_results(id,job_order_id,production_id,production_step_execution_id,sop_qc_check_id,sequence_no,qc_type,qc_name,instructions,is_required,checklist_result,remarks,checked_by,checked_by_name,checked_at))`;
const productionSelectBasic = `id,job_order_id,finished_good_id,production_no,product_name,batch_no,actual_pack_qty,actual_output_qty,produced_quantity,actual_produced_qty,good_output_qty,wastage_qty,uom,production_date,manufacturing_date,end_date,expiry_date,storage_location_id,shelf_life_days_snapshot,expiry_override_reason,operator_id,operator_name,start_time,end_time,qc_status,production_sop_id,sop_version,status,notes,created_by,completed_at,created_at,updated_at,storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status),finished_good:factory_finished_goods(${finishedGoodSelect}),job_order:factory_job_orders(job_order_no,finished_good_id,product_name,target_pack_qty,target_production_qty,finished_good:factory_finished_goods(product_code,product_name,product_family_id,variant_name,packaging_type,pack_size_qty,pack_size_uom,base_qty,base_uom,shelf_life_days))`;
const productionSelectDetailed = `${productionSelectBasic},material_usage:factory_production_material_usage(id,production_id,raw_material_id,raw_material_receiving_id,raw_material_lot_no,quantity_used,standard_usage,actual_usage,variance_qty,variance_percent,variance_reason,uom,wastage_quantity,notes,created_at,updated_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect}),raw_receiving:factory_raw_material_receivings(receipt_no,batch_no,supplier_name,received_date,unit_cost)),qc_checkpoints:factory_production_qc_checkpoints(id,production_id,production_sop_id,sop_step_id,step_no,process_name,control_point,qc_status,notes,created_at,updated_at),step_executions:factory_production_step_executions(id,job_order_id,production_id,production_sop_id,sop_step_id,step_no,step_name,description,sub_steps,status,completed_by,completed_at,qc_results:factory_production_qc_results(id,job_order_id,production_id,production_step_execution_id,sop_qc_check_id,sequence_no,qc_type,qc_name,instructions,is_required,checklist_result,remarks,checked_by,checked_by_name,checked_at))`;
const finishedGoodDispatchSelect = `id,dispatch_no,dispatch_date,customer_id,customer_name,reference_no,status,remarks,created_by,completed_by,completion_request_id,created_at,updated_at,completed_at,cancelled_at,creator:employees!factory_finished_good_dispatches_created_by_fkey(nickname,full_name),completer:employees!factory_finished_good_dispatches_completed_by_fkey(id,nickname,full_name),customer:factory_customers(${factoryCustomerSelect}),items:factory_finished_good_dispatch_items(id,dispatch_id,finished_good_id,quantity,batch_no,remarks,created_at,finished_good:factory_finished_goods(${finishedGoodFullSelect}),allocations:factory_finished_good_dispatch_batch_allocations(id,batch_balance_id,production_id,quantity,batch_no,manufacturing_date,expiry_date,storage_location_id,storage_location,storage_location_type,batch:factory_finished_good_batch_balances(id,source_type,current_balance,batch_no,manufacturing_date,expiry_date,storage_location_id,storage_location,storage_location_type,storage_location_ref:factory_storage_locations(location_name,location_type,status))))`;

const FACTORY_MASTER_ID_BATCH_SIZE = 300;

function factoryLoadError(label, stage, error) {
  if (error?.name === "AbortError") return error;
  console.error(`[Factory] ${label} ${stage} failed.`, error);
  const safeError = new Error(`Unable to load complete ${label}. Please retry.`);
  safeError.code = error?.code;
  safeError.status = error?.status || error?.statusCode;
  safeError.cause = error;
  return safeError;
}

function factoryAbortError() {
  const error = new Error("Factory data load cancelled.");
  error.name = "AbortError";
  return error;
}

function chunkFactoryIds(values, size = FACTORY_MASTER_ID_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function runFactoryQuery(query, { label, stage, signal } = {}) {
  if (signal?.aborted) throw factoryAbortError();
  const result = await (signal ? query.abortSignal(signal) : query);
  if (signal?.aborted) throw factoryAbortError();
  if (result.error) throw factoryLoadError(label, stage, result.error);
  return result.data;
}

function validateSnapshotIds(values, label) {
  if (!Array.isArray(values)) throw factoryLoadError(label, "ID snapshot", new Error("Invalid snapshot response."));
  const ids = values.map((value) => String(value || "")).filter(Boolean);
  if (ids.length !== values.length || new Set(ids).size !== ids.length) {
    throw factoryLoadError(label, "ID snapshot reconciliation", new Error("Invalid or duplicate snapshot ID."));
  }
  return ids;
}

async function fetchFactoryMasterIds(entity, { label, signal } = {}) {
  const data = await runFactoryQuery(
    supabase.rpc("factory_get_master_id_snapshot", { p_entity: entity }),
    { label, stage: "ID snapshot", signal },
  );
  return validateSnapshotIds(data, label);
}

async function fetchFactoryChildSnapshot(entity, parentIds, { label, signal } = {}) {
  const rows = [];
  for (const parentChunk of chunkFactoryIds(parentIds)) {
    const data = await runFactoryQuery(
      supabase.rpc("factory_get_master_child_snapshot", { p_entity: entity, p_parent_ids: parentChunk }),
      { label, stage: `${entity} snapshot`, signal },
    );
    if (!Array.isArray(data)) throw factoryLoadError(label, `${entity} snapshot`, new Error("Invalid child snapshot response."));
    rows.push(...data);
  }
  return rows;
}

async function fetchFactoryRowsBySnapshot(ids, buildQuery, { label, signal } = {}) {
  if (!ids.length) return [];
  const expectedIds = new Set(ids);
  const rowsById = new Map();
  for (const idChunk of chunkFactoryIds(ids)) {
    const data = await runFactoryQuery(buildQuery(idChunk), { label, stage: "detail batch", signal });
    if (!Array.isArray(data)) throw factoryLoadError(label, "detail batch", new Error("Invalid detail response."));
    for (const row of data) {
      const id = String(row?.id || "");
      if (!id || !expectedIds.has(id) || rowsById.has(id)) {
        throw factoryLoadError(label, "detail reconciliation", new Error("Unexpected or duplicate detail row."));
      }
      rowsById.set(id, row);
    }
  }
  const missingIds = ids.filter((id) => !rowsById.has(id));
  if (missingIds.length) {
    throw factoryLoadError(label, "detail reconciliation", new Error(`${missingIds.length} snapshot rows were no longer available.`));
  }
  return ids.map((id) => rowsById.get(id));
}

async function loadFactoryMasterWithRetry(loader, label) {
  let firstError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      firstError ||= error;
      if (attempt === 1) console.warn(`[Factory] Retrying complete ${label} load after snapshot mismatch or query failure.`);
    }
  }
  throw firstError;
}

async function loadFactoryMasterRows({ entity, label, buildQuery, signal }) {
  return loadFactoryMasterWithRetry(async () => {
    const ids = await fetchFactoryMasterIds(entity, { label, signal });
    return fetchFactoryRowsBySnapshot(ids, buildQuery, { label, signal });
  }, label);
}

function validateChildSnapshotRows(rows, label, keyForRow) {
  const seen = new Set();
  for (const row of rows) {
    const key = keyForRow(row);
    if (!key || seen.has(key)) throw factoryLoadError(label, "child snapshot reconciliation", new Error("Invalid or duplicate child identity."));
    seen.add(key);
  }
  return rows;
}

async function loadRecipeRows({ summaryOnly = false, signal }) {
  const label = summaryOnly ? "Active Production Standard Summary" : "Product Recipes";
  return loadFactoryMasterWithRetry(async () => {
    const recipeIds = await fetchFactoryMasterIds(summaryOnly ? "active_product_recipes" : "product_recipes", { label, signal });
    const recipes = await fetchFactoryRowsBySnapshot(recipeIds, (ids) => supabase
      .from("factory_product_recipes")
      .select(summaryOnly ? recipeSummarySelect : recipeRootSelect)
      .in("id", ids), { label, signal });
    if (summaryOnly || !recipeIds.length) return recipes;

    const itemSnapshot = validateChildSnapshotRows(
      await fetchFactoryChildSnapshot("recipe_items", recipeIds, { label, signal }),
      label,
      (row) => row?.id,
    );
    const itemIds = itemSnapshot.map((row) => String(row.id));
    const items = await fetchFactoryRowsBySnapshot(itemIds, (ids) => supabase
      .from("factory_product_recipe_items")
      .select(recipeItemSelect)
      .in("id", ids), { label, signal });
    const itemsByRecipe = new Map();
    itemSnapshot.forEach((snapshot, index) => {
      const item = items[index];
      if (String(item.recipe_id) !== String(snapshot.parent_id)) {
        throw factoryLoadError(label, "Recipe item ownership reconciliation", new Error("A Recipe item changed parents during loading."));
      }
      const group = itemsByRecipe.get(item.recipe_id) || [];
      group.push(item);
      itemsByRecipe.set(item.recipe_id, group);
    });
    return recipes.map((recipe) => ({ ...recipe, items: itemsByRecipe.get(recipe.id) || [] }));
  }, label);
}

async function loadProductionSopRows({ signal }) {
  const label = "Production SOP";
  return loadFactoryMasterWithRetry(async () => {
    const sopIds = await fetchFactoryMasterIds("production_sops", { label, signal });
    const sops = await fetchFactoryRowsBySnapshot(sopIds, (ids) => supabase
      .from("factory_production_sops")
      .select(sopRootSelect)
      .in("id", ids), { label, signal });
    if (!sopIds.length) return sops;

    const stepSnapshot = validateChildSnapshotRows(
      await fetchFactoryChildSnapshot("sop_steps", sopIds, { label, signal }),
      label,
      (row) => row?.id,
    );
    const stepIds = stepSnapshot.map((row) => String(row.id));
    const steps = await fetchFactoryRowsBySnapshot(stepIds, (ids) => supabase
      .from("factory_production_sop_steps")
      .select(sopStepSelect)
      .in("id", ids), { label, signal });
    stepSnapshot.forEach((snapshot, index) => {
      if (String(steps[index].sop_id) !== String(snapshot.parent_id)) {
        throw factoryLoadError(label, "SOP Step ownership reconciliation", new Error("An SOP Step changed parents during loading."));
      }
    });

    const [subStepSnapshotRows, qcSnapshotRows, materialSnapshotRows] = await Promise.all([
      fetchFactoryChildSnapshot("sop_sub_steps", stepIds, { label, signal }),
      fetchFactoryChildSnapshot("sop_qc_checks", stepIds, { label, signal }),
      fetchFactoryChildSnapshot("sop_step_materials", stepIds, { label, signal }),
    ]);
    const subStepSnapshot = validateChildSnapshotRows(subStepSnapshotRows, label, (row) => row?.id);
    const qcSnapshot = validateChildSnapshotRows(qcSnapshotRows, label, (row) => row?.id);
    const materialSnapshot = validateChildSnapshotRows(
      materialSnapshotRows,
      label,
      (row) => row?.sop_step_id && row?.raw_material_id ? `${row.sop_step_id}:${row.raw_material_id}` : "",
    );

    const [subSteps, qcChecks] = await Promise.all([
      fetchFactoryRowsBySnapshot(subStepSnapshot.map((row) => String(row.id)), (ids) => supabase
        .from("factory_production_sop_sub_steps")
        .select(sopSubStepSelect)
        .in("id", ids), { label, signal }),
      fetchFactoryRowsBySnapshot(qcSnapshot.map((row) => String(row.id)), (ids) => supabase
        .from("factory_production_sop_step_qc_checks")
        .select(sopQcCheckSelect)
        .in("id", ids), { label, signal }),
    ]);
    subStepSnapshot.forEach((snapshot, index) => {
      if (String(subSteps[index].sop_step_id) !== String(snapshot.parent_id)) {
        throw factoryLoadError(label, "SOP Sub-step ownership reconciliation", new Error("An SOP Sub-step changed parents during loading."));
      }
    });
    qcSnapshot.forEach((snapshot, index) => {
      if (String(qcChecks[index].sop_step_id) !== String(snapshot.parent_id)) {
        throw factoryLoadError(label, "SOP QC ownership reconciliation", new Error("An SOP QC Check changed parents during loading."));
      }
    });

    const rawMaterialIds = [...new Set(materialSnapshot.map((row) => String(row.raw_material_id)))];
    const rawMaterials = await fetchFactoryRowsBySnapshot(rawMaterialIds, (ids) => supabase
      .from("factory_raw_materials")
      .select("id,name,name_en,material_code,uom")
      .in("id", ids), { label, signal });
    const rawMaterialsById = new Map(rawMaterials.map((row) => [row.id, row]));
    const subStepsByStep = new Map();
    subSteps.forEach((row) => subStepsByStep.set(row.sop_step_id, [...(subStepsByStep.get(row.sop_step_id) || []), row]));
    const qcByStep = new Map();
    qcChecks.forEach((row) => qcByStep.set(row.sop_step_id, [...(qcByStep.get(row.sop_step_id) || []), row]));
    const materialsByStep = new Map();
    materialSnapshot.forEach((row) => {
      const rawMaterial = rawMaterialsById.get(String(row.raw_material_id));
      if (!rawMaterial) throw factoryLoadError(label, "SOP material reconciliation", new Error("A referenced Raw Material was unavailable."));
      const material = { raw_material_id: row.raw_material_id, raw_material: rawMaterial };
      materialsByStep.set(row.sop_step_id, [...(materialsByStep.get(row.sop_step_id) || []), material]);
    });

    const stepsBySop = new Map();
    steps.forEach((step) => {
      const assembled = {
        ...step,
        sub_steps: subStepsByStep.get(step.id) || [],
        ingredient_refs: materialsByStep.get(step.id) || [],
        qc_checks: qcByStep.get(step.id) || [],
      };
      stepsBySop.set(step.sop_id, [...(stepsBySop.get(step.sop_id) || []), assembled]);
    });
    return sops.map((sop) => ({ ...sop, steps: stepsBySop.get(sop.id) || [] }));
  }, label);
}

function factoryDataPlan(scope, hasPermission) {
  const can = (code) => !hasPermission || hasPermission(code);
  const isDashboard = scope === "dashboard";
  const isJobOrders = scope === "job-orders" || scope === "production-overview";
  const isRawInventory = scope === "raw-inventory";
  const isRawReceiving = scope === "raw-receiving";
  const isRawMovements = scope === "raw-movements";
  const isRawStockCheck = scope === "raw-stock-check";
  const isProduction = scope === "production";
  const isReports = scope === "reports";
  const isBatchTraceability = scope === "batch-traceability";
  const isProductRecipes = scope === "product-recipes";
  const isStorageLocations = scope === "storage-locations";
  const isSuppliers = scope === "suppliers";
  const isCustomers = scope === "customers";
  const isFinishedGoods = scope === "finished-goods";
  const isProductionPlanning = scope === "production-planning";
  const isFinishedGoodsDispatch = scope === "finished-goods-dispatch";
  const isProductMovements = scope === "product-movements";
  const isProductStockCheck = scope === "product-stock-check";
  const isProductionSop = scope === "production-sop";
  const isAuditLogs = scope === "audit-logs";
  const needsProductionSummary = isProduction || isReports || isFinishedGoods || isFinishedGoodsDispatch || isProductMovements;
  const canTraceBatches = can("factory_batch_traceability.view");
  const canReadProductionReports = can("factory_production_reports.view") || canTraceBatches;
  const needsProductionDetails = isProduction || isReports;
  return {
    jobOrders: (isJobOrders && can("factory_job_orders.view")) || (isProductionPlanning && can("factory_job_orders.view")) || ((isProduction || isReports) && (can("factory_production.view") || canReadProductionReports)),
    rawMaterials: (isRawInventory && can("factory_raw_inventory.view")) || (isRawReceiving && can("factory_raw_receiving.view")) || (isRawMovements && can("factory_raw_movements.view")) || (isRawStockCheck && can("factory_raw_stock_check.view")) || (isProductRecipes && can("factory_product_recipes.view")) || (isJobOrders && can("factory_product_recipes.view")) || (isProductionPlanning && can("factory_product_recipes.view")) || (isProduction && (can("factory_raw_inventory.view") || can("factory_product_recipes.view") || can("factory_production.complete") || can("factory_dashboard.view"))),
    rawMaterialCategories: (isRawInventory && can("factory_raw_inventory.view")) || (isRawStockCheck && can("factory_raw_stock_check.view")),
    factorySuppliers: (isSuppliers && can("factory_suppliers.view")) || (isRawReceiving && can("factory_raw_receiving.view")),
    factoryCustomers: (isCustomers && can("factory_customers.view")) || (isFinishedGoodsDispatch && (can("factory_customers.view") || can("factory_finished_goods_dispatch.view") || can("factory_finished_goods_dispatch.create") || can("factory_finished_goods_dispatch.edit"))),
    receivingBatches: isRawReceiving && can("factory_raw_receiving.view"),
    storageLocations: (isStorageLocations && can("factory_storage_locations.view")) || (isBatchTraceability && canTraceBatches) || ((isRawInventory || isRawReceiving || isRawMovements || isFinishedGoods || isJobOrders || isProduction) && (can("factory_storage_locations.view") || can("factory_raw_inventory.view") || can("factory_raw_receiving.view") || can("factory_raw_movements.view") || can("factory_finished_goods.view") || can("factory_job_orders.view") || can("factory_production.view") || can("factory_production.complete"))),
    rawMaterialMovements: (isRawInventory && can("factory_raw_inventory.view")) || (isRawMovements && can("factory_raw_movements.view")),
    receivings: (isRawInventory && can("factory_raw_inventory.view")) || (isRawReceiving && can("factory_raw_receiving.view")) || (isRawMovements && can("factory_raw_movements.view")) || (isReports && can("factory_production_reports.view")) || (isProduction && can("factory_raw_receiving.view")),
    productions: needsProductionSummary && (can("factory_dashboard.view") || can("factory_production.view") || canReadProductionReports || can("factory_finished_goods.view") || can("factory_product_movements.view")),
    productionDetails: needsProductionDetails,
    finishedGoods: (isDashboard && can("factory_dashboard.view")) || (isJobOrders && (can("factory_job_orders.view") || can("factory_job_orders.create") || can("factory_job_orders.edit"))) || (isProductRecipes && can("factory_product_recipes.view")) || (isProductionPlanning && can("factory_production_planning.view")) || ((isProduction || isFinishedGoods || isFinishedGoodsDispatch || isProductMovements) && can("factory_finished_goods.view")) || (isFinishedGoodsDispatch && (can("factory_finished_goods_dispatch.view") || can("factory_finished_goods_dispatch.create") || can("factory_finished_goods_dispatch.edit") || can("factory_finished_goods_dispatch.complete"))) || (isProduction && can("factory_production.complete")) || (isProductStockCheck && can("factory_product_stock_check.view")) || (isBatchTraceability && canTraceBatches),
    finishedGoodCategories: (isFinishedGoods && can("factory_finished_goods.view")) || (isProductionPlanning && can("factory_production_planning.view")) || (isProductStockCheck && can("factory_product_stock_check.view")),
    productFamilies: (isFinishedGoods && can("factory_finished_goods.view")) || (isProductRecipes && (can("factory_product_recipes.view") || can("factory_product_recipes.create") || can("factory_product_recipes.edit") || can("factory_product_recipes.manage"))) || (isProductionSop && (can("factory_production_sop.view") || can("factory_production_sop.create") || can("factory_production_sop.edit") || can("factory_production_sop.manage"))) || (isJobOrders && (can("factory_job_orders.view") || can("factory_job_orders.create") || can("factory_job_orders.edit"))) || (isProduction && (can("factory_product_recipes.view") || can("factory_production.complete"))),
    productMovements: ((isProduction || isProductMovements) && can("factory_product_movements.view")) || (isFinishedGoods && can("factory_finished_goods.view")) || (isFinishedGoodsDispatch && can("factory_finished_goods_dispatch.view")) || (isReports && can("factory_product_movements.view")),
    recipes: (isRawInventory && can("factory_raw_inventory.view")) || (isProductRecipes && can("factory_product_recipes.view")) || (isProductionSop && (can("factory_production_sop.view") || can("factory_production_sop.create") || can("factory_production_sop.edit") || can("factory_production_sop.manage"))) || (isJobOrders && can("factory_product_recipes.view")) || (isProductionPlanning && can("factory_product_recipes.view")) || (isProduction && (can("factory_product_recipes.view") || can("factory_production.complete"))) || (isReports && can("factory_production_reports.view")),
    recipeSummaries: isFinishedGoods && can("factory_product_recipes.view"),
    sops: (isProduction || isProductionSop || isJobOrders)
      && (can("factory_production_sop.view") || can("factory_production.view") || can("factory_production.complete")),
    qcChecklistTemplates: isProductionSop && (can("factory_production_sop.view") || can("factory_production_sop.create") || can("factory_production_sop.edit") || can("factory_production_sop.manage")),
    auditLogs: (isAuditLogs || isJobOrders) && can("factory_audit_logs.view"),
  };
}

export const factoryService = {
  async uploadRawMaterialImage(file, material = {}) {
    const safeName = String(material.material_code || material.name_en || material.name || "raw-material")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "raw-material";
    const path = `raw-materials/${material.id || "draft"}/${Date.now()}-${safeName}.webp`;
    return uploadOptimizedImage(file, {
      bucket: "raw-material-images",
      path,
      previousPublicUrl: material.image_url || "",
      metadata: {
        module: "factory",
        entity: "raw_material",
        raw_material_id: material.id || "",
      },
    });
  },

  async listFactoryData({ scope = "dashboard", hasPermission, signal } = {}) {
    const data = emptyFactoryData();
    const plan = factoryDataPlan(scope, hasPermission);
    const tasks = [];
    const addTask = (enabled, key, label, query, mapper, complete = false, loader = null) => {
      if (!enabled) return;
      tasks.push({ key, label, query, mapper, complete, loader });
    };
    const addMasterTask = (enabled, key, label, entity, query, mapper) => addTask(
      enabled,
      key,
      label,
      query,
      mapper,
      true,
      () => loadFactoryMasterRows({ entity, label, buildQuery: query, signal }),
    );
    const addCompleteLoaderTask = (enabled, key, label, loader, mapper) => addTask(
      enabled,
      key,
      label,
      null,
      mapper,
      true,
      loader,
    );

    addTask(plan.jobOrders, "jobOrders", "Job Orders", () => supabase
      .from("factory_job_orders")
      .select(jobOrderSelect)
      .order("planned_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapJobOrder));
    addMasterTask(plan.rawMaterials, "rawMaterials", "Raw Materials", "raw_materials", (ids) => supabase
      .from("factory_raw_materials")
      .select(rawMaterialSelect)
      .in("id", ids), (rows) => rows.map(mapRawMaterial));
    addMasterTask(plan.rawMaterialCategories, "rawMaterialCategories", "Raw Material Categories", "raw_material_categories", (ids) => supabase
      .from("factory_raw_material_categories")
      .select("id,name,description,status,created_at,updated_at")
      .in("id", ids), (rows) => rows.map(mapRawMaterialCategory));
    addMasterTask(plan.factorySuppliers, "factorySuppliers", "Factory Suppliers", "suppliers", (ids) => supabase
      .from("factory_suppliers")
      .select(factorySupplierSelect)
      .in("id", ids), (rows) => rows.map(mapFactorySupplier));
    addMasterTask(plan.factoryCustomers, "factoryCustomers", "Factory Customers", "customers", (ids) => supabase
      .from("factory_customers")
      .select(factoryCustomerSelect)
      .in("id", ids), (rows) => rows.map(mapFactoryCustomer));
    addTask(plan.receivingBatches, "receivingBatches", "Receiving Batches", () => supabase
      .from("factory_raw_material_receiving_batches")
      .select(`id,batch_no,reference_no,supplier_id,supplier_name,received_date,remarks,status,created_by,created_at,updated_at,supplier:factory_suppliers(supplier_name),creator:employees(nickname,full_name),items:factory_raw_material_receivings(id,batch_id,receipt_no,raw_material_id,supplier_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location_id,storage_location,remarks,received_by,created_at,updated_at,storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status),raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`)
      .order("received_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapReceivingBatch));
    addMasterTask(plan.storageLocations, "storageLocations", "Storage Locations", "storage_locations", (ids) => supabase
      .from("factory_storage_locations")
      .select(storageLocationSelect)
      .in("id", ids), (rows) => rows.map(mapStorageLocation));
    addTask(plan.rawMaterialMovements, "rawMaterialMovements", "Raw Material Movements", () => supabase
      .from("factory_raw_material_movements")
      .select(`id,raw_material_id,movement_type,quantity,uom,reference_type,reference_id,reference_no,movement_date,notes,created_by,created_at,creator:employees(nickname,full_name),raw_material:factory_raw_materials(${rawMaterialRelationSelect})`)
      .order("movement_date", { ascending: false })
      .limit(200), (rows) => rows.map(mapRawMaterialMovement));
    addTask(plan.receivings, "receivings", "Raw Material Receiving", () => supabase
      .from("factory_raw_material_receivings")
      .select(`id,batch_id,receipt_no,raw_material_id,supplier_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location_id,storage_location,remarks,received_by,created_at,updated_at,storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status),raw_material:factory_raw_materials(${rawMaterialRelationSelect})`)
      .order("received_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapReceiving));
    addTask(plan.productions, "productions", "Production Records", () => supabase
      .from("factory_productions")
      .select(plan.productionDetails ? productionSelectDetailed : productionSelectBasic)
      .order("production_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapProduction));
    addMasterTask(plan.finishedGoods, "finishedGoods", "Finished Goods", "finished_goods", (ids) => supabase
      .from("factory_finished_goods")
      .select(finishedGoodFullSelect)
      .in("id", ids), (rows) => rows.map(mapFinishedGood));
    addMasterTask(plan.finishedGoodCategories, "finishedGoodCategories", "Finished Good Categories", "finished_good_categories", (ids) => supabase
      .from("factory_finished_good_categories")
      .select("id,name,description,status,created_at,updated_at")
      .in("id", ids), (rows) => rows.map(mapFinishedGoodCategory));
    addMasterTask(plan.productFamilies, "productFamilies", "Product Families", "product_families", (ids) => supabase
      .from("factory_product_families")
      .select("id,name_en,name_cn,name_bm,category_id,status,remarks,created_at,updated_at,category:factory_finished_good_categories(name)")
      .in("id", ids), (rows) => rows.map(mapProductFamily));
    addTask(plan.productMovements && scope !== "product-movements", "productMovements", "Product Movements", () => supabase
      .from("factory_product_stock_movements")
      .select(`id,finished_good_id,product_name,movement_type,quantity,uom,reference_type,reference_id,reference_no,movement_date,notes,created_by,created_at,finished_good:factory_finished_goods(${finishedGoodSelect})`)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(150), (rows) => rows.map(mapProductMovement));
    addCompleteLoaderTask(plan.recipes, "recipes", "Product Recipes", () => loadRecipeRows({ signal }), (rows) => rows.map(mapRecipe));
    addCompleteLoaderTask(!plan.recipes && plan.recipeSummaries, "recipes", "Active Production Standard Summary", () => loadRecipeRows({ summaryOnly: true, signal }), (rows) => rows.map(mapRecipe));
    addCompleteLoaderTask(plan.sops, "sops", "Production SOP", () => loadProductionSopRows({ signal }), (rows) => rows.map(mapProductionSop));
    addMasterTask(plan.qcChecklistTemplates, "qcChecklistTemplates", "QC Checklist Presets", "qc_checklist_templates", (ids) => supabase
      .from("factory_qc_checklist_templates")
      .select("id,name,category,description,result_mode,is_active,created_at,updated_at")
      .in("id", ids), (rows) => rows);
    addTask(plan.auditLogs, "auditLogs", "Factory Audit Logs", () => supabase
      .from("audit_logs")
      .select("id,action,module,user_id,user_name,description,metadata,created_at")
      .eq("module", "factory")
      .order("created_at", { ascending: false })
      .limit(300), (rows) => rows.map(mapFactoryAuditLog));

    const isPermissionDenied = (error) => {
      const code = String(error?.code || "").toUpperCase();
      const status = Number(error?.status || error?.statusCode || 0);
      const message = String(error?.message || "").toLowerCase();
      return code === "42501"
        || status === 401
        || status === 403
        || message.includes("permission denied")
        || message.includes("row-level security")
        || message.includes("not authorized")
        || message.includes("unauthorized")
        || message.includes("forbidden");
    };
    const recordLoadIssue = (task, error) => {
      console.error(`[Factory] Unable to load ${task.label}.`, error);
      data.accessIssues.push({
        key: task.key,
        label: task.label,
        kind: isPermissionDenied(error) ? "permission" : "load",
        complete: task.complete,
      });
    };

    const results = await Promise.allSettled(tasks.map(async (task) => {
      if (task.loader) return { data: await task.loader(), error: null };
      const query = task.query();
      return signal ? query.abortSignal(signal) : query;
    }));
    if (signal?.aborted) {
      const abortError = new Error("Factory data load cancelled.");
      abortError.name = "AbortError";
      throw abortError;
    }
    results.forEach((result, index) => {
      const task = tasks[index];
      if (result.status === "rejected") {
        recordLoadIssue(task, result.reason);
        return;
      }
      if (result.value.error) {
        recordLoadIssue(task, result.value.error);
        return;
      }
      data[task.key] = task.mapper(result.value.data ?? []);
    });
    if (data.sops.length && data.recipes.length) {
      const recipesById = new Map(data.recipes.map((recipe) => [recipe.id, recipe]));
      data.sops = data.sops.map((sop) => ({
        ...sop,
        linked_recipe: recipesById.get(sop.recipe_id) || sop.linked_recipe,
      }));
    }
    return data;
  },

  async listProductMovementsPage({ page = 1, pageSize = 20, filters = {} } = {}) {
    const normalizedPage = Math.max(1, Math.trunc(Number(page) || 1));
    const normalizedPageSize = [20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 20;
    const from = (normalizedPage - 1) * normalizedPageSize;
    const to = from + normalizedPageSize - 1;
    const params = {
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_product_search: String(filters.product || "").trim() || null,
      p_category_id: databaseUuid(filters.category),
      p_movement_type: String(filters.movementType || "").trim() || null,
      p_batch_source_search: String(filters.batch || "").trim() || null,
    };
    const [pageResult, summaryResult] = await Promise.all([
      supabase
        .rpc("factory_list_product_movements", params, { count: "exact" })
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
      supabase.rpc("factory_product_movements_summary", params),
    ]);
    throwSupabaseError("factory.product_movements.page", pageResult.error);
    throwSupabaseError("factory.product_movements.summary", summaryResult.error);
    const summary = summaryResult.data || {};
    return {
      rows: (pageResult.data || []).map(mapProductMovement),
      totalCount: normalizeNumber(pageResult.count),
      summary: {
        stockInCount: normalizeNumber(summary.stock_in_count),
        stockOutCount: normalizeNumber(summary.stock_out_count),
        filteredSkus: Array.isArray(summary.filtered_skus) ? summary.filtered_skus : [],
        movementTypes: Array.isArray(summary.movement_types) ? summary.movement_types : [],
        categories: Array.isArray(summary.categories) ? summary.categories : [],
      },
      page: normalizedPage,
      pageSize: normalizedPageSize,
    };
  },

  async getFactoryDashboardAnalytics({ month, finishedGoodId = null } = {}) {
    const monthValue = String(month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthValue) || strictDateValue(`${monthValue}-01`) === null) {
      throw new Error("Select a valid dashboard month.");
    }
    const { data, error } = await supabase.rpc("factory_get_dashboard_monthly_analytics", {
      p_month: `${monthValue}-01`,
      p_finished_good_id: databaseUuid(finishedGoodId),
    });
    throwFactorySupabaseError("factory.dashboard.monthly_analytics", error);
    const snapshot = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    const filters = snapshot.filters && typeof snapshot.filters === "object" ? snapshot.filters : {};
    const kpis = snapshot.kpis && typeof snapshot.kpis === "object" ? snapshot.kpis : {};
    const normalizeRows = (rows) => Array.isArray(rows) ? rows : [];
    return {
      filters: {
        ...filters,
        permissions: filters.permissions && typeof filters.permissions === "object" ? filters.permissions : {},
      },
      kpis: {
        production_output: { ...(kpis.production_output || {}), by_uom: normalizeRows(kpis.production_output?.by_uom) },
        dispatch_volume: kpis.dispatch_volume || {},
        completion_rate: kpis.completion_rate || {},
        qc_pass_rate: kpis.qc_pass_rate || {},
        raw_receiving: { ...(kpis.raw_receiving || {}), by_uom: normalizeRows(kpis.raw_receiving?.by_uom) },
        inventory_alerts: kpis.inventory_alerts || {},
      },
      production_summary: normalizeRows(snapshot.production_summary),
      top_dispatch_products: normalizeRows(snapshot.top_dispatch_products),
      top_raw_materials: normalizeRows(snapshot.top_raw_materials),
      production_dispatch_trend: {
        ...(snapshot.production_dispatch_trend || {}),
        months: normalizeRows(snapshot.production_dispatch_trend?.months),
        production: normalizeRows(snapshot.production_dispatch_trend?.production),
        dispatch: normalizeRows(snapshot.production_dispatch_trend?.dispatch),
      },
      qc_performance: {
        ...(snapshot.qc_performance || {}),
        top_failures: normalizeRows(snapshot.qc_performance?.top_failures),
      },
      inventory_health: snapshot.inventory_health || {},
      action_required: normalizeRows(snapshot.action_required),
    };
  },

  async listOperationalJobOrders({ date, includeProductions = true } = {}) {
    if (strictDateValue(date) === null) throw new Error("Enter a valid operational date.");
    const dueReleaseResult = await supabase.rpc("factory_release_due_job_orders");
    throwSupabaseError("factory.operational_job_orders.release_due", dueReleaseResult.error);

    const { data, error } = await supabase.rpc("factory_get_production_pipeline_snapshot", {
      p_operational_date: String(date),
      p_include_productions: Boolean(includeProductions),
    });
    throwSupabaseError("factory.operational_job_orders.snapshot", error);

    const snapshot = data && typeof data === "object" ? data : {};
    const scheduled = Array.isArray(snapshot.scheduled) ? snapshot.scheduled.map(mapJobOrder) : [];
    const released = Array.isArray(snapshot.released) ? snapshot.released.map(mapJobOrder) : [];
    const inProgress = Array.isArray(snapshot.in_progress) ? snapshot.in_progress.map(mapJobOrder) : [];
    const completedToday = Array.isArray(snapshot.completed_today) ? snapshot.completed_today.map(mapJobOrder) : [];
    const summary = snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};

    return {
      scheduled,
      released,
      inProgress,
      completedToday,
      jobs: [...scheduled, ...released, ...inProgress, ...completedToday],
      productions: Array.isArray(snapshot.productions) ? snapshot.productions.map(mapProduction) : [],
      summary: {
        scheduled: normalizeNumber(summary.scheduled),
        released: normalizeNumber(summary.released),
        inProgress: normalizeNumber(summary.in_progress),
        completedToday: normalizeNumber(summary.completed_today),
        plannedToday: normalizeNumber(summary.planned_today),
        completionRate: normalizeNumber(summary.completion_rate),
        outputByUom: Array.isArray(summary.output_by_uom)
          ? summary.output_by_uom.map((row) => ({ uom: row.uom || "", good_output_qty: normalizeNumber(row.quantity) }))
          : [],
      },
    };
  },

  async getProductionPlanningOpenJobOrderAggregate() {
    const { data, error } = await supabase.rpc("factory_get_open_job_order_qty_by_sku");
    throwFactorySupabaseError("factory.production_planning.open_job_orders", error);
    const snapshot = data && typeof data === "object" ? data : {};
    const aggregates = Array.isArray(snapshot.aggregates) ? snapshot.aggregates : [];
    const diagnostics = snapshot.diagnostics && typeof snapshot.diagnostics === "object" ? snapshot.diagnostics : {};
    return {
      aggregates: aggregates.map((row) => ({
        packagingSkuId: row.packaging_sku_id,
        openJobOrderQty: normalizeNumber(row.open_job_order_qty),
        openJobOrderCount: normalizeNumber(row.open_job_order_count),
        countedJobOrderCount: normalizeNumber(row.counted_job_order_count),
        invalidJobOrderCount: normalizeNumber(row.invalid_job_order_count),
      })),
      diagnostics: {
        qualifyingJobOrderCount: normalizeNumber(diagnostics.qualifying_job_order_count),
        missingPackagingSkuCount: normalizeNumber(diagnostics.missing_packaging_sku_count),
        invalidQuantityCount: normalizeNumber(diagnostics.invalid_quantity_count),
      },
    };
  },

  async listFactoryListingPage({ listing, page = 1, pageSize = 20, filters = {} } = {}) {
    const normalizedPage = Math.max(1, Math.trunc(Number(page) || 1));
    const normalizedPageSize = [20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 20;
    const from = (normalizedPage - 1) * normalizedPageSize;
    const to = from + normalizedPageSize - 1;
    let query;
    let mapper = (rows) => rows;

    if (listing === "batch-traceability") {
      const params = {
        p_date_from: filters.dateFrom || null,
        p_date_to: filters.dateTo || null,
        p_finished_good_id: databaseUuid(filters.finishedGood),
        p_batch_no: String(filters.batchNo || "").trim() || null,
        p_batch_type: String(filters.batchType || "").trim() || null,
        p_expiry_status: String(filters.expiryStatus || "").trim() || null,
        p_storage_location_id: databaseUuid(filters.storageLocation),
        p_reconciliation_status: String(filters.reconciliationStatus || "").trim() || null,
        p_search: String(filters.search || "").trim() || null,
      };
      const [pageResult, summaryResult] = await Promise.all([
        supabase.rpc("factory_list_finished_good_batch_traceability", params, { count: "exact" })
          .order("manufacturing_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
        supabase.rpc("factory_finished_good_batch_traceability_summary", params),
      ]);
      throwSupabaseError("factory.batch-traceability.page", pageResult.error);
      throwSupabaseError("factory.batch-traceability.summary", summaryResult.error);
      return {
        rows: (pageResult.data || []).map(mapFinishedGoodBatchTraceability),
        totalCount: normalizeNumber(pageResult.count),
        summary: summaryResult.data || {},
        page: normalizedPage,
        pageSize: normalizedPageSize,
      };
    }

    if (listing === "receiving-history") {
      query = supabase
        .from("factory_raw_material_receiving_batches")
        .select(`id,batch_no,reference_no,supplier_id,supplier_name,received_date,remarks,status,created_by,created_at,updated_at,supplier:factory_suppliers(supplier_name),creator:employees(nickname,full_name),items:factory_raw_material_receivings(id,batch_id,receipt_no,raw_material_id,supplier_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location_id,storage_location,remarks,received_by,created_at,updated_at,storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status),raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`, { count: "exact" });
      if (filters.dateFrom) query = query.gte("received_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("received_date", filters.dateTo);
      if (filters.supplier) query = databaseUuid(filters.supplier) ? query.eq("supplier_id", filters.supplier) : query.eq("supplier_name", filters.supplier);
      query = query.order("received_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false });
      mapper = (rows) => rows.map(mapReceivingBatch);
    } else if (listing === "raw-movements") {
      query = supabase
        .rpc("factory_list_raw_material_movements", {
          p_date_from: filters.dateFrom || null,
          p_date_to: filters.dateTo || null,
          p_raw_material_id: databaseUuid(filters.material),
          p_movement_type: String(filters.movementType || "").trim() || null,
          p_storage_location: String(filters.storageLocation || "").trim() || null,
          p_search: String(filters.search || "").trim() || null,
        }, { count: "exact" })
        .order("movement_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false });
      mapper = (rows) => rows.map(mapRawMaterialMovement);
    } else if (listing === "raw-stock-checks" || listing === "product-stock-checks") {
      const raw = listing === "raw-stock-checks";
      query = raw
        ? supabase.from("factory_raw_material_stock_checks").select(rawMaterialStockCheckSelect, { count: "exact" })
        : supabase.from("factory_product_stock_checks").select(productStockCheckSelect, { count: "exact" });
      query = query.order("check_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false });
      mapper = (rows) => rows.map((row) => mapStockCheck(row, raw ? "raw" : "product"));
    } else if (listing === "job-orders") {
      const finishedGoodFilter = String(filters.finishedGood || "").trim();
      const finishedGoodId = finishedGoodFilter.startsWith("sku:") ? finishedGoodFilter.slice(4) : finishedGoodFilter;
      const productFamilyId = finishedGoodFilter.startsWith("family:") ? finishedGoodFilter.slice(7) : "";
      const pageResult = await supabase.rpc("factory_list_job_order_records", {
        p_search: String(filters.search || "").trim() || null,
        p_status: String(filters.status || "").trim() || null,
        p_scheduled_date_from: filters.scheduledDateFrom || null,
        p_scheduled_date_to: filters.scheduledDateTo || null,
        p_manufacturing_date_from: filters.manufacturingDateFrom || null,
        p_manufacturing_date_to: filters.manufacturingDateTo || null,
        p_finished_good_id: productFamilyId ? null : databaseUuid(finishedGoodId),
        p_product_family_id: databaseUuid(productFamilyId),
      }, { count: "exact" })
        .order("planned_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      throwSupabaseError("factory.job-orders.page", pageResult.error);
      return {
        rows: (pageResult.data || []).map(mapJobOrder),
        totalCount: normalizeNumber(pageResult.count),
        summary: {},
        page: normalizedPage,
        pageSize: normalizedPageSize,
      };
    } else if (listing === "production-history") {
      query = supabase.from("factory_productions").select(productionSelectDetailed, { count: "exact" })
        .order("production_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false });
      mapper = (rows) => rows.map(mapProduction);
    } else if (listing === "dispatch-history") {
      query = supabase.from("factory_finished_good_dispatches").select(finishedGoodDispatchSelect, { count: "exact" });
      if (filters.dateFrom) query = query.gte("dispatch_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("dispatch_date", filters.dateTo);
      if (filters.customer) query = databaseUuid(filters.customer) ? query.eq("customer_id", filters.customer) : query.eq("customer_name", filters.customer);
      if (filters.status) query = query.eq("status", filters.status);
      query = query.order("dispatch_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false });
      mapper = (rows) => rows.map(mapFinishedGoodDispatch);
    } else if (listing === "audit-logs") {
      const moduleToken = {
        "Raw Material Receiving": "raw_material_receiving",
        "Raw Material": "raw_material",
        "Finished Goods Dispatch": "finished_goods_dispatch",
        "Product Recipe": "product_recipe",
        "Job Order": "job_order",
        "Production SOP": "production_sop",
        "Production QC": "production_qc",
        "Production": "production",
        "Stock Check": "stock_check",
      }[filters.module] || null;
      query = supabase.rpc("factory_list_audit_logs", {
        p_date_from: filters.dateFrom || null,
        p_date_to: filters.dateTo || null,
        p_module_token: moduleToken,
        p_action_token: filters.action ? String(filters.action).replace(/[^a-z0-9 ]/gi, "").replace(/ /g, "_").toLowerCase() : null,
        p_user_name: filters.user || null,
        p_search: String(filters.search || "").trim() || null,
      }, { count: "exact" });
      query = query.order("created_at", { ascending: false }).order("id", { ascending: false });
      mapper = (rows) => rows.map(mapFactoryAuditLog);
    } else {
      throw new Error(`Unsupported Factory listing: ${listing}`);
    }

    const summaryParams = { p_listing: listing, p_filters: filters || {} };
    const [pageResult, summaryResult] = await Promise.all([
      query.range(from, to),
      supabase.rpc("factory_listing_summary", summaryParams),
    ]);
    throwSupabaseError(`factory.${listing}.page`, pageResult.error);
    const summaryError = summaryResult.error || null;
    if (summaryError && listing !== "dispatch-history") {
      throwSupabaseError(`factory.${listing}.summary`, summaryError);
    }
    if (summaryError) {
      console.error("[Factory] Unable to load Finished Goods Dispatch summary.", summaryError);
    }
    let rows = mapper(pageResult.data || []);
    if (listing === "dispatch-history" && rows.length) {
      const { data: allocationData, error: allocationError } = await supabase.rpc("factory_get_finished_good_dispatch_allocation_details", {
        p_dispatch_ids: rows.map((row) => row.id),
      });
      throwSupabaseError("factory.finished_good_dispatch.allocations", allocationError);
      const allocationsByItem = (Array.isArray(allocationData) ? allocationData : []).reduce((groups, allocation) => {
        const list = groups.get(allocation.dispatch_item_id) || [];
        list.push({
          id: allocation.allocation_id,
          batch_id: allocation.batch_balance_id || "",
          production_id: allocation.production_id || "",
          quantity: normalizeNumber(allocation.quantity),
          batch_no: allocation.batch_no || "",
          batch_type: allocation.batch_type || "production",
          manufacturing_date: allocation.manufacturing_date || "",
          expiry_date: allocation.expiry_date || "",
          storage_location_id: allocation.storage_location_id || "",
          storage_location: allocation.storage_location || "",
          storage_location_type: allocation.storage_location_type || "",
          storage_location_status: allocation.storage_location_status || "",
          current_balance: allocation.current_balance == null ? null : normalizeNumber(allocation.current_balance),
          location_valid: allocation.location_valid !== false,
          location_issue: allocation.location_issue || "",
        });
        groups.set(allocation.dispatch_item_id, list);
        return groups;
      }, new Map());
      rows = rows.map((dispatch) => ({
        ...dispatch,
        items: dispatch.items.map((item) => ({ ...item, allocations: allocationsByItem.get(item.id) || [] })),
      }));
    }
    return {
      rows,
      totalCount: normalizeNumber(pageResult.count),
      summary: summaryError ? {} : summaryResult.data || {},
      summaryError,
      page: normalizedPage,
      pageSize: normalizedPageSize,
    };
  },

  async saveJobOrder(order) {
    const isUpdate = Boolean(order.id);
    let finishedGood = null;
    if (order.finished_good_id) {
      const { data, error } = await supabase
        .from("factory_finished_goods")
      .select("id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,product_family_id,variant_name,packaging_type,pack_size_qty,pack_size_uom,base_qty,base_uom,uom,status")
        .eq("id", order.finished_good_id)
        .single();
      throwSupabaseError("factory.job_order.finished_good_lookup", error);
      finishedGood = data;
    }
    if (!finishedGood?.id) throw new Error("Select an active finished good product.");
    if (String(finishedGood.status || "").toLowerCase() !== "active") throw new Error("Archived Finished Goods cannot be selected.");
    const targetProductionQty = normalizeNumber(order.target_production_qty || order.target_quantity);
    const productionUom = String(order.uom || "").trim();
    let activeRecipeUom = "";
    if (finishedGood.product_family_id) {
      const { data: parentRecipe } = await supabase
        .from("factory_product_recipes")
        .select("uom")
        .eq("product_family_id", finishedGood.product_family_id)
        .eq("status", "active")
        .maybeSingle();
      activeRecipeUom = parentRecipe?.uom || "";
    }
    if (!activeRecipeUom) {
      const { data: skuRecipe } = await supabase
        .from("factory_product_recipes")
        .select("uom")
        .eq("finished_good_id", finishedGood.id)
        .eq("status", "active")
        .maybeSingle();
      activeRecipeUom = skuRecipe?.uom || "";
    }
    const productionPlan = packagingPackEstimate(targetProductionQty, productionUom, finishedGood, activeRecipeUom);
    if (productionPlan.error) throw new Error(productionPlan.error);
    if (!productionPlan.target_pack_qty || !productionPlan.target_production_qty || !productionPlan.production_uom) throw new Error("Packaging SKU Pack Size UOM cannot be used for production quantity.");

    if (isUpdate) {
      const { data: current, error: currentError } = await supabase
        .from("factory_job_orders")
        .select("id,status")
        .eq("id", order.id)
        .single();
      throwSupabaseError("factory.job_order.current", currentError);
      if (!["draft", "planned"].includes(current?.status)) throw new Error("Only Draft or Planned Job Orders can be edited. Use lifecycle actions for released, in-progress, completed or cancelled Job Orders.");
    }

    const payload = {
      finished_good_id: finishedGood.id,
      target_pack_qty: productionPlan.target_pack_qty,
      target_production_qty: productionPlan.target_production_qty,
      target_quantity: productionPlan.target_production_qty,
      uom: productionPlan.production_uom,
      planned_date: order.planned_date || null,
      due_date: order.due_date || null,
      priority: order.priority || "Normal",
      assigned_team: order.assigned_team || "",
      remarks: order.remarks || "",
    };
    if (payload.target_production_qty <= 0) throw new Error("Target Production Qty must be greater than 0.");
    if (payload.target_pack_qty <= 0) throw new Error("Estimated Pack Qty must be greater than 0.");
    const { data: savedRows, error: saveError } = await supabase.rpc("factory_save_job_order_structure", {
      p_job_order_id: order.id || null,
      p_finished_good_id: payload.finished_good_id,
      p_target_quantity: payload.target_quantity,
      p_target_pack_qty: payload.target_pack_qty,
      p_target_production_qty: payload.target_production_qty,
      p_uom: payload.uom,
      p_planned_date: payload.planned_date,
      p_due_date: payload.due_date,
      p_priority: payload.priority,
      p_assigned_team: payload.assigned_team,
      p_remarks: payload.remarks,
    });
    throwSupabaseError("factory.job_order.save_structure", saveError);
    const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
    if (!saved?.job_order_id) throw new Error("Job Order reference was not returned.");

    const { data, error } = await supabase
      .from("factory_job_orders")
      .select(jobOrderSelect)
      .eq("id", saved.job_order_id)
      .single();
    throwSupabaseError("factory.job_order.fetch_saved", error);
    return mapJobOrder(data);
  },

  async deleteJobOrder(order) {
    if (order.status !== "draft") throw new Error("Only Draft Job Orders can be deleted.");
    const { error } = await supabase.rpc("factory_delete_job_order_draft", {
      p_job_order_id: order.id,
    });
    throwSupabaseError("factory.job_order.delete", error);
  },

  async releaseJobOrder(order) {
    const { error } = await supabase.rpc("factory_release_job_order", {
      p_job_order_id: order.id,
    });
    throwSupabaseError("factory.job_order.release", error);
  },

  async cancelJobOrder(order) {
    const { error } = await supabase.rpc("factory_cancel_job_order", {
      p_job_order_id: order.id,
    });
    throwSupabaseError("factory.job_order.cancel", error);
  },

  async startJobOrder(order, startInfo, employee) {
    const operatorId = databaseUuid(employee?.id);
    const operatorName = String(employee?.nickname || employee?.full_name || employee?.email || "").trim();
    if (!operatorId || !operatorName) {
      throw new Error("Current employee could not be resolved. Sign in again before starting production.");
    }
    const { error } = await supabase.rpc("factory_start_job_order", {
      p_job_order_id: order.id,
      p_operator_id: operatorId,
      p_operator_name: operatorName,
      p_production_date: startInfo.production_date || new Date().toISOString().slice(0, 10),
      p_start_time: startInfo.start_time || null,
      p_remarks: startInfo.remarks || "",
      p_started_by: operatorId,
    });
    throwSupabaseError("factory.job_order.start", error);
    await logFactoryAction({
      action: "factory_job_order_started",
      target: order.job_order_no,
      description: "Factory Job Order started production.",
      after: { ...order, ...startInfo, operator_id: operatorId, operator_name: operatorName, started_by: operatorId },
    });
  },

  async saveRawMaterialReceiving(receiving, employeeId) {
    const isUpdate = Boolean(receiving.id);
    const rawMaterialId = await ensureRawMaterial(receiving);
    const { data: selectedMaterial, error: selectedMaterialError } = await supabase
      .from("factory_raw_materials")
      .select("id,name,name_en,uom,storage_location,status")
      .eq("id", rawMaterialId)
      .single();
    throwSupabaseError("factory.receiving.raw_material", selectedMaterialError);
    let previous = null;
    if (isUpdate) {
      const { data, error } = await supabase
        .from("factory_raw_material_receivings")
        .select("id,raw_material_id,received_qty")
        .eq("id", receiving.id)
        .single();
      throwSupabaseError("factory.receiving.previous", error);
      previous = data;
    }

    const qty = normalizeNumber(receiving.received_qty);
    const unitCost = normalizeNumber(receiving.unit_cost);
    if (qty <= 0) throw new Error("Received quantity must be greater than 0.");
    const payload = {
      receipt_no: receiving.receipt_no || makeFactoryRef("RMRCV"),
      batch_id: receiving.batch_id || null,
      raw_material_id: rawMaterialId,
      supplier_id: receiving.supplier_id || null,
      supplier_name: String(receiving.supplier_name || "").trim(),
      batch_no: receiving.batch_no || "",
      received_qty: qty,
      uom: receiving.uom || selectedMaterial?.uom || "",
      unit_cost: unitCost,
      total_cost: qty * unitCost,
      invoice_no: receiving.invoice_no || "",
      received_date: receiving.received_date || new Date().toISOString().slice(0, 10),
      expiry_date: receiving.expiry_date || null,
      storage_location: receiving.storage_location || selectedMaterial?.storage_location || "",
      remarks: receiving.remarks || "",
      received_by: employeeId || null,
      updated_at: new Date().toISOString(),
    };

    const query = isUpdate
      ? supabase.from("factory_raw_material_receivings").update(payload).eq("id", receiving.id)
      : supabase.from("factory_raw_material_receivings").insert(payload);

    const { data, error } = await query
      .select(`id,receipt_no,raw_material_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location,remarks,received_by,created_at,updated_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect})`)
      .single();
    throwSupabaseError("factory.receiving.save", error);

    if (previous?.raw_material_id && previous.raw_material_id !== rawMaterialId) {
      const previousBalanceResult = await supabase.rpc("factory_adjust_raw_material_balance", {
        material_id: previous.raw_material_id,
        quantity_delta: -normalizeNumber(previous.received_qty),
      });
      throwSupabaseError("factory.receiving.balance_previous", previousBalanceResult.error);
      const nextBalanceResult = await supabase.rpc("factory_adjust_raw_material_balance", {
        material_id: rawMaterialId,
        quantity_delta: qty,
      });
      throwSupabaseError("factory.receiving.balance_next", nextBalanceResult.error);
    } else {
      const balanceResult = await supabase.rpc("factory_adjust_raw_material_balance", {
        material_id: rawMaterialId,
        quantity_delta: qty - normalizeNumber(previous?.received_qty),
      });
      throwSupabaseError("factory.receiving.balance", balanceResult.error);
    }

    const movementResult = await supabase.from("factory_raw_material_movements").insert({
      raw_material_id: rawMaterialId,
      movement_type: "Receiving",
      quantity: qty,
      uom: payload.uom,
      reference_type: "raw_material_receiving",
      reference_id: data.id,
      reference_no: data.receipt_no,
      movement_date: payload.received_date,
      notes: isUpdate ? "Raw material receiving updated." : "Raw material receiving recorded.",
      created_by: employeeId || null,
    });
    throwSupabaseError("factory.receiving.movement", movementResult.error);

    await logFactoryAction({
      action: isUpdate ? "factory_raw_receiving_updated" : "factory_raw_receiving_created",
      target: data.receipt_no,
      description: isUpdate ? "Factory raw material receiving updated." : "Factory raw material receiving recorded.",
      after: data,
    });
    return mapReceiving(data);
  },

  async saveRawMaterial(material, employeeId) {
    const isUpdate = Boolean(material.id);
    const materialNameEn = String(material.name_en || material.name || "").trim();
    let storageLocationName = "";
    if (material.storage_location_id) {
      const { data: location, error: locationError } = await supabase
        .from("factory_storage_locations")
        .select("id,location_name,status")
        .eq("id", material.storage_location_id)
        .single();
      throwSupabaseError("factory.raw_material.storage_location", locationError);
      if (!isUpdate && String(location?.status || "").toLowerCase() !== "active") throw new Error("Archived Storage Locations cannot be selected.");
      storageLocationName = location?.location_name || "";
    }
    const payload = {
      material_code: String(material.material_code || "").trim() || null,
      name: materialNameEn,
      name_en: materialNameEn,
      name_cn: String(material.name_cn || "").trim(),
      name_bm: String(material.name_bm || "").trim(),
      image_url: String(material.image_url || "").trim(),
      category_id: material.category_id || null,
      category: String(material.category || "").trim(),
      uom: String(material.uom || "").trim(),
      min_stock_level: normalizeNumber(material.min_stock_level),
      manual_unit_cost: material.manual_unit_cost === "" || material.manual_unit_cost == null ? null : normalizeNumber(material.manual_unit_cost),
      manual_cost_uom: String(material.manual_cost_uom || "").trim() || null,
      preferred_supplier: "",
      storage_location_id: material.storage_location_id || null,
      storage_location: storageLocationName || String(material.storage_location || "").trim(),
      status: material.status || "active",
      remarks: String(material.remarks || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) throw new Error("Raw Material Name EN is required.");
    if (!payload.category_id) throw new Error("Category is required.");
    if (!payload.material_code) throw new Error("SKU Code is required.");
    if (!payload.uom) throw new Error("Default UOM is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) {
      payload.current_balance = 0;
      payload.created_by = employeeId || null;
    }

    if (isUpdate && payload.status === "archived") {
      const { data: current, error: currentError } = await supabase
        .from("factory_raw_materials")
        .select("id,current_balance")
        .eq("id", material.id)
        .single();
      throwSupabaseError("factory.raw_material.current", currentError);
      if (normalizeNumber(current?.current_balance) > 0) throw new Error("Cannot archive while stock balance is greater than zero.");
    }

    const query = isUpdate
      ? supabase.from("factory_raw_materials").update(payload).eq("id", material.id)
      : supabase.from("factory_raw_materials").insert(payload);

    const { data, error } = await query
      .select(rawMaterialSelect)
      .single();
    throwSupabaseError("factory.raw_material.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_raw_material_updated" : "factory_raw_material_created",
      target: data.name_en || data.name,
      description: isUpdate ? "Factory raw material master updated." : "Factory raw material master created.",
      after: data,
    });
    return mapRawMaterial(data);
  },

  async archiveRawMaterial(material) {
    if (normalizeNumber(material.current_balance) > 0) {
      throw new Error("Cannot archive while stock balance is greater than zero.");
    }
    const { data, error } = await supabase
      .from("factory_raw_materials")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", material.id)
      .select(rawMaterialSelect)
      .single();
    throwSupabaseError("factory.raw_material.archive", error);
    await logFactoryAction({
      action: "factory_raw_material_archived",
      target: data.name_en || data.name,
      description: "Factory raw material archived.",
      after: data,
    });
    return mapRawMaterial(data);
  },

  async saveRawMaterialCategory(category, employeeId) {
    const isUpdate = Boolean(category.id);
    const payload = {
      name: String(category.name || "").trim(),
      description: String(category.description || "").trim(),
      status: category.status || "active",
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) throw new Error("Category name is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_raw_material_categories").update(payload).eq("id", category.id)
      : supabase.from("factory_raw_material_categories").insert(payload);

    const { data, error } = await query
      .select("id,name,description,status,created_at,updated_at")
      .single();
    throwSupabaseError("factory.raw_material_category.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_raw_material_category_updated" : "factory_raw_material_category_created",
      target: data.name,
      description: isUpdate ? "Factory raw material category updated." : "Factory raw material category created.",
      after: data,
    });
    return mapRawMaterialCategory(data);
  },

  async archiveRawMaterialCategory(category) {
    const { data, error } = await supabase
      .from("factory_raw_material_categories")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", category.id)
      .select("id,name,description,status,created_at,updated_at")
      .single();
    throwSupabaseError("factory.raw_material_category.archive", error);
    await logFactoryAction({
      action: "factory_raw_material_category_archived",
      target: data.name,
      description: "Factory raw material category archived.",
      after: data,
    });
    return mapRawMaterialCategory(data);
  },

  async saveFactorySupplier(supplier, employeeId) {
    const isUpdate = Boolean(supplier.id);
    const payload = {
      supplier_name: String(supplier.supplier_name || "").trim(),
      supplier_code: String(supplier.supplier_code || "").trim() || null,
      contact_person: String(supplier.contact_person || "").trim(),
      phone: String(supplier.phone || "").trim(),
      email: String(supplier.email || "").trim(),
      status: supplier.status || "active",
      remarks: String(supplier.remarks || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!payload.supplier_name) throw new Error("Supplier name is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_suppliers").update(payload).eq("id", supplier.id)
      : supabase.from("factory_suppliers").insert(payload);

    const { data, error } = await query.select(factorySupplierSelect).single();
    throwSupabaseError("factory.supplier.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_supplier_updated" : "factory_supplier_created",
      target: data.supplier_name,
      description: isUpdate ? "Factory supplier updated." : "Factory supplier created.",
      after: data,
    });
    return mapFactorySupplier(data);
  },

  async archiveFactorySupplier(supplier) {
    const { data, error } = await supabase
      .from("factory_suppliers")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", supplier.id)
      .select(factorySupplierSelect)
      .single();
    throwSupabaseError("factory.supplier.archive", error);
    await logFactoryAction({
      action: "factory_supplier_archived",
      target: data.supplier_name,
      description: "Factory supplier archived.",
      after: data,
    });
    return mapFactorySupplier(data);
  },

  async saveStorageLocation(location, employeeId) {
    const isUpdate = Boolean(location.id);
    const payload = {
      location_name: String(location.location_name || "").trim(),
      location_code: String(location.location_code || "").trim() || null,
      location_type: String(location.location_type || "").trim(),
      status: location.status || "active",
      remarks: String(location.remarks || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!payload.location_name) throw new Error("Location name is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_storage_locations").update(payload).eq("id", location.id)
      : supabase.from("factory_storage_locations").insert(payload);

    const { data, error } = await query
      .select(storageLocationSelect)
      .single();
    throwSupabaseError("factory.storage_location.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_storage_location_updated" : "factory_storage_location_created",
      target: data.location_name,
      description: isUpdate ? "Factory storage location updated." : "Factory storage location created.",
      after: data,
    });
    return mapStorageLocation(data);
  },

  async archiveStorageLocation(location) {
    const { data, error } = await supabase
      .from("factory_storage_locations")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", location.id)
      .select(storageLocationSelect)
      .single();
    throwSupabaseError("factory.storage_location.archive", error);
    await logFactoryAction({
      action: "factory_storage_location_archived",
      target: data.location_name,
      description: "Factory storage location archived.",
      after: data,
    });
    return mapStorageLocation(data);
  },

  async saveRawMaterialReceivingBatch(batch, employeeId) {
    const supplierId = batch.supplier_id || "";
    const items = Array.isArray(batch.items) ? batch.items : [];
    if (!supplierId) throw new Error("Supplier is required.");
    if (!batch.received_date) throw new Error("Received Date is required.");
    if (!items.length) throw new Error("Add at least one received item.");

    const rpcItems = items.map((item) => ({
      raw_material_id: item.raw_material_id || "",
      batch_no: item.batch_no || "",
      received_qty: normalizeNumber(item.received_qty),
      uom: item.uom || "",
      storage_location_id: item.storage_location_id || null,
      storage_location: item.storage_location || "",
      expiry_date: item.expiry_date || null,
      remarks: item.remarks || "",
    }));

    const { data, error } = await supabase.rpc("factory_save_raw_material_receiving_batch", {
      p_supplier_id: supplierId,
      p_reference_no: String(batch.reference_no || "").trim(),
      p_received_date: batch.received_date,
      p_remarks: String(batch.remarks || "").trim(),
      p_items: rpcItems,
    });
    throwSupabaseError("factory.receiving_batch.rpc", error);

    await logFactoryAction({
      action: "factory_raw_receiving_batch_created",
      target: data?.batch_no || "Raw material receiving batch",
      description: "Factory raw material receiving batch created.",
      after: data,
    });
    return data;
  },

  async deleteRawMaterialReceiving(receiving) {
    const { error: balanceError } = await supabase.rpc("factory_adjust_raw_material_balance", {
      material_id: receiving.raw_material_id,
      quantity_delta: -normalizeNumber(receiving.received_qty),
    });
    throwSupabaseError("factory.receiving.balance_delete", balanceError);
    const { error } = await supabase.from("factory_raw_material_receivings").delete().eq("id", receiving.id);
    throwSupabaseError("factory.receiving.delete", error);
    await logFactoryAction({
      action: "factory_raw_receiving_deleted",
      target: receiving.receipt_no,
      description: "Factory raw material receiving deleted.",
      before: receiving,
    });
  },

  async saveFinishedGood(product, employeeId) {
    const isUpdate = Boolean(product.id);
    const productNameEn = String(product.product_name_en || product.product_name || "").trim();
    const productFamilyId = product.product_family_id || null;
    let storageLocationName = "";
    if (product.storage_location_id) {
      const { data: location, error: locationError } = await supabase
        .from("factory_storage_locations")
        .select("id,location_name,status")
        .eq("id", product.storage_location_id)
        .single();
      throwSupabaseError("factory.finished_good.storage_location", locationError);
      if (!isUpdate && String(location?.status || "").toLowerCase() !== "active") throw new Error("Archived Storage Locations cannot be selected.");
      storageLocationName = location?.location_name || "";
    }
    const payload = {
      product_code: String(product.product_code || "").trim() || null,
      product_name: productNameEn,
      product_name_en: productNameEn,
      product_name_cn: String(product.product_name_cn || "").trim(),
      product_name_bm: String(product.product_name_bm || "").trim(),
      product_family_id: productFamilyId,
      variant_name: String(product.variant_name || "").trim(),
      packaging_type: String(product.packaging_type || "Pack").trim() || "Pack",
      pack_size_qty: product.pack_size_qty === "" || product.pack_size_qty == null ? null : normalizeNumber(product.pack_size_qty),
      pack_size_uom: String(product.pack_size_uom || "").trim(),
      base_qty: product.base_qty === "" || product.base_qty == null ? null : normalizeNumber(product.base_qty),
      base_uom: String(product.base_uom || "").trim(),
      category_id: product.category_id || null,
      category: String(product.category || "").trim(),
      uom: product.uom || "",
      min_stock_level: normalizeNumber(product.min_stock_level),
      shelf_life_days: product.shelf_life_days === "" || product.shelf_life_days == null ? null : Number(product.shelf_life_days),
      storage_location_id: product.storage_location_id || null,
      storage_location: storageLocationName || String(product.storage_location || "").trim(),
      status: product.status || "active",
      remarks: String(product.remarks || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!payload.product_name) throw new Error("Product name is required.");
    if (!payload.category_id) throw new Error("Category is required.");
    if (!payload.uom) throw new Error("UOM is required.");
    if (payload.shelf_life_days !== null && (!Number.isInteger(payload.shelf_life_days) || payload.shelf_life_days <= 0)) {
      throw new Error("Shelf Life must be a whole number greater than zero.");
    }
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_finished_goods").update(payload).eq("id", product.id)
      : supabase.from("factory_finished_goods").insert(payload);

    const { data, error } = await query
      .select(finishedGoodFullSelect)
      .single();
    throwSupabaseError("factory.finished_good.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_finished_good_updated" : "factory_finished_good_created",
      target: data.product_name,
      description: isUpdate ? "Factory finished good updated." : "Factory finished good created.",
      after: data,
    });
    return mapFinishedGood(data);
  },

  async updateFinishedGoodParLevel(product, parLevel) {
    if (!product?.id) throw new Error("Packaging SKU is required.");
    const nextParLevel = parLevel === "" || parLevel == null ? 0 : normalizeNumber(parLevel);
    if (nextParLevel < 0) throw new Error("Par Level cannot be negative.");
    const { data, error } = await supabase
      .from("factory_finished_goods")
      .update({
        min_stock_level: nextParLevel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id)
      .select(finishedGoodFullSelect)
      .single();
    throwSupabaseError("factory.finished_good.par_level", error);
    await logFactoryAction({
      action: "factory_finished_good_par_level_updated",
      target: data.product_code || data.product_name,
      description: "Factory finished good Packaging SKU par level updated.",
      before: { id: product.id, min_stock_level: product.min_stock_level },
      after: { id: data.id, min_stock_level: data.min_stock_level },
    });
    return mapFinishedGood(data);
  },

  async archiveFinishedGood(product) {
    if (normalizeNumber(product.current_balance) > 0) {
      throw new Error("Cannot archive while stock balance is greater than zero.");
    }
    const { data, error } = await supabase
      .from("factory_finished_goods")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", product.id)
      .select(finishedGoodFullSelect)
      .single();
    throwSupabaseError("factory.finished_good.archive", error);
    await logFactoryAction({
      action: "factory_finished_good_archived",
      target: data.product_name,
      description: "Factory finished good archived.",
      after: data,
    });
    return mapFinishedGood(data);
  },

  async saveProductFamily(family, employeeId) {
    const isUpdate = Boolean(family.id);
    const payload = {
      name_en: String(family.name_en || "").trim(),
      name_cn: String(family.name_cn || "").trim(),
      name_bm: String(family.name_bm || "").trim(),
      category_id: family.category_id || null,
      status: family.status || "active",
      remarks: String(family.remarks || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!payload.name_en) throw new Error("Finished Good name is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_product_families").update(payload).eq("id", family.id)
      : supabase.from("factory_product_families").insert(payload);

    const { data, error } = await query
      .select("id,name_en,name_cn,name_bm,category_id,status,remarks,created_at,updated_at,category:factory_finished_good_categories(name)")
      .single();
    throwSupabaseError("factory.product_group.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_product_group_updated" : "factory_product_group_created",
      target: data.name_en,
      description: isUpdate ? "Factory Finished Good parent updated." : "Factory Finished Good parent created.",
      after: data,
    });
    return mapProductFamily(data);
  },

  async archiveProductFamily(family) {
    const { data, error } = await supabase
      .from("factory_product_families")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", family.id)
      .select("id,name_en,name_cn,name_bm,category_id,status,remarks,created_at,updated_at,category:factory_finished_good_categories(name)")
      .single();
    throwSupabaseError("factory.product_group.archive", error);
    await logFactoryAction({
      action: "factory_product_group_archived",
      target: data.name_en,
      description: "Factory Finished Good parent archived.",
      after: data,
    });
    return mapProductFamily(data);
  },

  async saveFinishedGoodCategory(category, employeeId) {
    const isUpdate = Boolean(category.id);
    const payload = {
      name: String(category.name || "").trim(),
      description: String(category.description || "").trim(),
      status: category.status || "active",
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) throw new Error("Category name is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_finished_good_categories").update(payload).eq("id", category.id)
      : supabase.from("factory_finished_good_categories").insert(payload);

    const { data, error } = await query
      .select("id,name,description,status,created_at,updated_at")
      .single();
    throwSupabaseError("factory.finished_good_category.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_finished_good_category_updated" : "factory_finished_good_category_created",
      target: data.name,
      description: isUpdate ? "Factory finished good category updated." : "Factory finished good category created.",
      after: data,
    });
    return mapFinishedGoodCategory(data);
  },

  async archiveFinishedGoodCategory(category) {
    const { data, error } = await supabase
      .from("factory_finished_good_categories")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", category.id)
      .select("id,name,description,status,created_at,updated_at")
      .single();
    throwSupabaseError("factory.finished_good_category.archive", error);
    await logFactoryAction({
      action: "factory_finished_good_category_archived",
      target: data.name,
      description: "Factory finished good category archived.",
      after: data,
    });
    return mapFinishedGoodCategory(data);
  },

  async saveProductRecipe(recipe, employeeId) {
    const isUpdate = Boolean(recipe.id);
    if (isUpdate && recipe.status !== "draft") {
      throw new Error("Only draft recipes can be edited. Archive or create a new draft version for changes.");
    }

    let productFamily = null;
    if (recipe.product_family_id) {
      const { data, error } = await supabase
        .from("factory_product_families")
        .select("id,name_en,name_cn,name_bm,status")
        .eq("id", recipe.product_family_id)
        .single();
      throwSupabaseError("factory.recipe.product_family_lookup", error);
      productFamily = data;
    }
    if (!productFamily?.id) throw new Error("Select an active Finished Good.");
    if (String(productFamily.status || "").toLowerCase() !== "active") throw new Error("Archived Finished Goods cannot be selected.");

    const items = (recipe.items ?? [])
      .map((item, index) => ({
        raw_material_id: item.raw_material_id,
        quantity_used: normalizeNumber(item.quantity_used),
        uom: String(item.uom || "").trim(),
        wastage_percent: normalizeNumber(item.wastage_percent),
        sort_order: normalizeNumber(item.sort_order, index + 1) || index + 1,
        notes: String(item.remarks || item.notes || "").trim(),
      }))
      .filter((item) => item.raw_material_id || item.quantity_used > 0 || item.uom || item.notes);

    if (!String(recipe.recipe_name || "").trim()) throw new Error("Recipe name is required.");
    if (normalizeNumber(recipe.yield_quantity) <= 0) throw new Error("Standard Output must be greater than 0.");
    if (!String(recipe.uom || "").trim()) throw new Error("UOM is required.");
    if (!items.length) throw new Error("At least one recipe material row is required.");
    const invalidItem = items.find((item) => !item.raw_material_id || item.quantity_used <= 0);
    if (invalidItem) throw new Error("Every recipe material row needs a raw material and standard quantity greater than 0.");

    let version = String(recipe.version || "").trim();
    if (!version) version = "v1";

    const payload = {
      finished_good_id: recipe.finished_good_id || null,
      product_family_id: productFamily.id,
      recipe_name: String(recipe.recipe_name || "").trim(),
      product_name: productFamily.name_en,
      version,
      yield_quantity: normalizeNumber(recipe.yield_quantity),
      uom: String(recipe.uom || "").trim(),
      estimated_production_time_minutes: recipe.estimated_production_time_minutes === "" || recipe.estimated_production_time_minutes == null
        ? null
        : normalizeNumber(recipe.estimated_production_time_minutes),
      status: recipe.status === "active" ? "active" : recipe.status === "archived" ? "archived" : "draft",
      notes: String(recipe.remarks || recipe.notes || "").trim(),
      remarks: String(recipe.remarks || recipe.notes || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!isUpdate) {
      payload.recipe_code = makeFactoryRef("FGRCP");
      payload.created_by = employeeId || null;
    }

    if (payload.status === "active") {
      const { data: activeRecipe, error: activeError } = await supabase
        .from("factory_product_recipes")
        .select("id")
        .eq("product_family_id", productFamily.id)
        .eq("status", "active")
        .neq("id", recipe.id || "00000000-0000-0000-0000-000000000000")
        .maybeSingle();
      throwSupabaseError("factory.recipe.active_lookup", activeError);
      if (activeRecipe?.id) throw new Error("This Finished Good already has an active recipe version.");
    }

    const query = isUpdate
      ? supabase.from("factory_product_recipes").update(payload).eq("id", recipe.id)
      : supabase.from("factory_product_recipes").insert(payload);

    const { data, error } = await query
      .select(recipeSummarySelect)
      .single();
    throwSupabaseError("factory.recipe.save", error);

    if (isUpdate) {
      const deleteResult = await supabase.from("factory_product_recipe_items").delete().eq("recipe_id", data.id);
      throwSupabaseError("factory.recipe.items_delete", deleteResult.error);
    }

    const insertResult = await supabase.from("factory_product_recipe_items").insert(items.map((item) => ({
      recipe_id: data.id,
      raw_material_id: item.raw_material_id,
      quantity_used: item.quantity_used,
      uom: item.uom,
      wastage_percent: item.wastage_percent,
      sort_order: item.sort_order,
      notes: item.notes,
      remarks: item.notes,
      updated_at: new Date().toISOString(),
    })));
    throwSupabaseError("factory.recipe.items_insert", insertResult.error);

    const { data: saved, error: fetchError } = await supabase
      .from("factory_product_recipes")
      .select(recipeSelect)
      .eq("id", data.id)
      .single();
    throwSupabaseError("factory.recipe.fetch_saved", fetchError);

    await logFactoryAction({
      action: isUpdate ? "factory_product_recipe_updated" : "factory_product_recipe_created",
      target: saved.recipe_code,
      description: isUpdate ? "Factory Product Recipe updated." : "Factory Product Recipe created.",
      after: saved,
    });
    return mapRecipe(saved);
  },

  async activateProductRecipe(recipe) {
    const { data: activated, error: activateError } = await supabase.rpc("factory_activate_product_recipe", {
      p_recipe_id: recipe.id,
    });
    throwSupabaseError("factory.recipe.activate_rpc", activateError);
    const activatedId = Array.isArray(activated) ? activated[0]?.recipe_id : activated?.recipe_id;
    if (!activatedId) throw new Error("Production standard activation did not return a recipe id.");

    const { data, error } = await supabase
      .from("factory_product_recipes")
      .select(recipeSelect)
      .eq("id", activatedId)
      .single();
    throwSupabaseError("factory.recipe.activate_fetch", error);
    await logFactoryAction({
      action: "factory_product_recipe_activated",
      target: data.recipe_code,
      description: "Factory Product Recipe activated.",
      after: data,
    });
    return mapRecipe(data);
  },

  async createProductRecipeNewVersion(recipe) {
    const { data: created, error: createError } = await supabase.rpc("factory_create_product_recipe_new_version", {
      p_source_recipe_id: recipe.id,
    });
    throwSupabaseError("factory.recipe.new_version_rpc", createError);
    const createdId = Array.isArray(created) ? created[0]?.recipe_id : created?.recipe_id;
    if (!createdId) throw new Error("New Product Recipe version was not created.");

    const { data, error } = await supabase
      .from("factory_product_recipes")
      .select(recipeSelect)
      .eq("id", createdId)
      .single();
    throwSupabaseError("factory.recipe.new_version_fetch", error);
    await logFactoryAction({
      action: "factory_product_recipe_new_version_created",
      target: data.recipe_code,
      description: "Factory Product Recipe draft version created.",
      after: data,
    });
    return mapRecipe(data);
  },

  async deleteProductRecipe(recipe) {
    const { data: existing, error: lookupError } = await supabase
      .from("factory_product_recipes")
      .select("id,recipe_code,recipe_name,status")
      .eq("id", recipe.id)
      .single();
    throwSupabaseError("factory.recipe.delete_lookup", lookupError);
    if (String(existing.status || "").toLowerCase() !== "draft") {
      throw new Error("Only draft product recipes can be deleted. Archive active recipes instead.");
    }

    const { error } = await supabase
      .from("factory_product_recipes")
      .delete()
      .eq("id", recipe.id)
      .eq("status", "draft");
    throwSupabaseError("factory.recipe.delete", error);
    await logFactoryAction({
      action: "factory_product_recipe_deleted",
      target: existing.recipe_code,
      description: "Factory Product Recipe draft deleted.",
      before: existing,
    });
    return true;
  },

  async archiveProductRecipe(recipe) {
    const currentStatus = String(recipe.status || "").toLowerCase();
    if (!["active", "draft"].includes(currentStatus)) {
      throw new Error("Only active or draft product recipes can be archived.");
    }
    const { data, error } = await supabase
      .from("factory_product_recipes")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", recipe.id)
      .in("status", ["active", "draft"])
      .select(recipeSelect)
      .single();
    throwSupabaseError("factory.recipe.archive", error);
    await logFactoryAction({
      action: "factory_product_recipe_archived",
      target: data.recipe_code,
      description: "Factory Product Recipe archived.",
      after: data,
    });
    return mapRecipe(data);
  },

  async restoreProductRecipe(recipe) {
    if (String(recipe.status || "").toLowerCase() !== "archived") {
      throw new Error("Only archived product recipes can be restored.");
    }
    const { data, error } = await supabase
      .from("factory_product_recipes")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", recipe.id)
      .eq("status", "archived")
      .select(recipeSelect)
      .single();
    throwSupabaseError("factory.recipe.restore", error);
    await logFactoryAction({
      action: "factory_product_recipe_restored",
      target: data.recipe_code,
      description: "Factory Product Recipe restored as draft.",
      after: data,
    });
    return mapRecipe(data);
  },

  async getProductionExecution(jobOrderId) {
    if (!jobOrderId) return { steps: [], snapshotCreatedAt: "", sopId: "", sopVersion: "" };
    const [{ data: job, error: jobError }, { data: rows, error: rowsError }] = await Promise.all([
      supabase
        .from("factory_job_orders")
        .select("id,production_sop_id,sop_version,qc_snapshot_created_at")
        .eq("id", jobOrderId)
        .single(),
      supabase
        .from("factory_production_step_executions")
        .select("id,job_order_id,production_id,production_sop_id,sop_step_id,step_no,step_name,description,sub_steps,status,completed_by,completed_at,qc_results:factory_production_qc_results(id,job_order_id,production_id,production_step_execution_id,sop_qc_check_id,sequence_no,qc_type,qc_name,instructions,is_required,checklist_result,remarks,checked_by,checked_by_name,checked_at)")
        .eq("job_order_id", jobOrderId)
        .order("step_no", { ascending: true }),
    ]);
    throwSupabaseError("factory.production_qc.job", jobError);
    throwSupabaseError("factory.production_qc.execution", rowsError);
    return {
      steps: (rows || []).map(mapProductionStepExecution),
      snapshotCreatedAt: job.qc_snapshot_created_at || "",
      sopId: job.production_sop_id || "",
      sopVersion: job.sop_version || "",
    };
  },

  async saveProductionQcProgress(jobOrderId, execution, employeeId, employeeName = "") {
    const { data, error } = await supabase.rpc("factory_save_production_qc_progress", {
      p_job_order_id: jobOrderId,
      // SOP steps are operating guidance. Production completion is governed by QC only.
      p_steps: [],
      p_results: (execution.steps || []).flatMap((step) => (step.qc_results || []).map((result) => ({
        id: result.id,
        checklist_result: result.checklist_result || "",
        remarks: result.remarks || "",
      }))),
      p_actor_id: employeeId || null,
      p_actor_name: String(employeeName || "").trim() || null,
    });
    throwSupabaseError("factory.production_qc.save", error);
    const summary = data || {};
    if (summary.changed) {
      const currentStatus = summary.current_status || "In Progress";
      const transitioned = summary.previous_status !== summary.current_status;
      const action = transitioned && currentStatus === "Failed"
        ? "factory_production_qc_failed"
        : transitioned && currentStatus === "Passed"
          ? "factory_production_qc_passed"
          : "factory_production_qc_updated";
      await logFactoryAction({
        action,
        target: jobOrderId,
        description: action === "factory_production_qc_failed" ? "Factory Production QC failed." : action === "factory_production_qc_passed" ? "Factory Production QC passed." : "Factory Production QC progress updated.",
        after: summary,
      });
    }
    return factoryService.getProductionExecution(jobOrderId);
  },

  async completeProduction(production, employeeId) {
    if (!String(production.end_date || "").trim()) throw new Error("End Date is required.");
    if (!String(production.end_time || "").trim()) throw new Error("End Time is required.");
    const { data: authoritativeJob, error: jobError } = await supabase
      .from("factory_job_orders")
      .select("id,production_date,start_time")
      .eq("id", production.job_order_id)
      .single();
    throwSupabaseError("factory.production.job_order_time_lookup", jobError);
    const startDateTime = strictDateTimeValue(authoritativeJob?.production_date, String(authoritativeJob?.start_time || "").slice(0, 5));
    const endDateTime = strictDateTimeValue(production.end_date, production.end_time);
    if (startDateTime === null) throw new Error("Job Order Production Date and Start Time are required before completing production.");
    if (endDateTime === null) throw new Error("Enter a valid End Date and End Time.");
    if (endDateTime < startDateTime) throw new Error("Production End Date and Time cannot be earlier than Start Date and Time.");
    const actualPackQty = Number(production.actual_pack_qty);
    if (!Number.isInteger(actualPackQty) || actualPackQty <= 0) {
      throw new Error("Actual Pack Qty must be a whole number greater than zero.");
    }

    const execution = await factoryService.getProductionExecution(production.job_order_id);
    if (execution.snapshotCreatedAt) {
      const results = execution.steps.flatMap((step) => step.qc_results || []);
      const incomplete = results.find((result) => result.is_required && (
        (result.qc_type === "checklist" && (!result.checklist_result || (result.checklist_result === "na" && !String(result.remarks || "").trim())))
        || (result.qc_type === "remarks" && !String(result.remarks || "").trim())
      ));
      if (incomplete) throw new Error("Complete all required QC checks before completing production.");
      if (results.some((result) => result.is_required && result.qc_type === "checklist" && result.checklist_result === "fail")) {
        throw new Error("Production has failed QC checks that require review.");
      }
    }
    let finishedGood = null;
    if (production.finished_good_id) {
      const { data, error } = await supabase
        .from("factory_finished_goods")
        .select("id,product_code,product_name,product_family_id,variant_name,packaging_type,pack_size_qty,pack_size_uom,base_qty,base_uom,uom,shelf_life_days,status")
        .eq("id", production.finished_good_id)
        .single();
      throwSupabaseError("factory.production.finished_good_lookup", error);
      finishedGood = data;
    }
    const shelfLifeConfigured = finishedGood?.shelf_life_days !== null && finishedGood?.shelf_life_days !== undefined && finishedGood?.shelf_life_days !== "";
    if (shelfLifeConfigured && strictDateValue(production.expiry_date) === null) {
      throw new Error("Expiry Date is required for this Packaging SKU.");
    }
    if (production.expiry_date && strictDateValue(production.expiry_date) === null) throw new Error("Enter a valid Expiry Date.");
    if (production.expiry_date && strictDateValue(production.expiry_date) < strictDateValue(production.end_date)) {
      throw new Error("Expiry Date cannot be earlier than Manufacturing Date.");
    }
    const calculatedExpiryTimestamp = shelfLifeConfigured
      ? strictDateValue(production.end_date) + (Number(finishedGood.shelf_life_days) * 86400000)
      : null;
    if (calculatedExpiryTimestamp !== null
        && strictDateValue(production.expiry_date) !== calculatedExpiryTimestamp
        && !String(production.expiry_override_reason || "").trim()) {
      throw new Error("Expiry override reason is required when changing the calculated Expiry Date.");
    }
    let activeRecipeUom = "";
    if (finishedGood?.product_family_id) {
      const { data: parentRecipe } = await supabase
        .from("factory_product_recipes")
        .select("uom")
        .eq("product_family_id", finishedGood.product_family_id)
        .eq("status", "active")
        .maybeSingle();
      activeRecipeUom = parentRecipe?.uom || "";
    }
    if (finishedGood?.id && !activeRecipeUom) {
      const { data: skuRecipe } = await supabase
        .from("factory_product_recipes")
        .select("uom")
        .eq("finished_good_id", finishedGood.id)
        .eq("status", "active")
        .maybeSingle();
      activeRecipeUom = skuRecipe?.uom || "";
    }
    const productionPlan = finishedGood ? packagingProductionPlan(actualPackQty, finishedGood, activeRecipeUom || production.uom) : null;
    if (productionPlan?.error) throw new Error(productionPlan.error);
    if (productionPlan && (!productionPlan.target_production_qty || !productionPlan.production_uom)) throw new Error("Packaging SKU Pack Size UOM cannot be used for production quantity.");
    const actualOutputQty = productionPlan?.target_production_qty || normalizeNumber(production.actual_output_qty || production.actual_produced_qty || production.good_output_qty);
    const productionUom = productionPlan?.production_uom || production.uom || "";
    const usageItems = (production.material_usage ?? []).map((item) => ({
      raw_material_id: item.raw_material_id,
      raw_material_receiving_id: item.raw_material_receiving_id || "",
      raw_material_lot_no: item.raw_material_lot_no || "",
      standard_usage: normalizeNumber(item.standard_usage),
      actual_usage: normalizeNumber(item.actual_usage),
      variance_reason: item.variance_reason || "",
      uom: item.uom || "",
      wastage_quantity: normalizeNumber(item.wastage_quantity),
      notes: item.notes || "",
    }));
    const productionNo = production.production_no || makeFactoryRef("PRD");
    const { data: productionId, error } = await supabase.rpc("factory_complete_production_with_batch", {
      p_job_order_id: production.job_order_id || null,
      p_finished_good_id: production.finished_good_id || null,
      p_production_no: productionNo,
      p_product_name: String(production.product_name || "").trim(),
      p_batch_no: production.batch_no || "",
      p_production_date: authoritativeJob.production_date,
      p_operator_id: production.operator_id || employeeId || null,
      p_operator_name: production.operator_name || "",
      p_start_time: authoritativeJob.start_time || null,
      p_end_date: production.end_date || null,
      p_end_time: production.end_time || null,
      p_expiry_date: production.expiry_date || null,
      p_storage_location_id: production.storage_location_id || null,
      p_expiry_override_reason: String(production.expiry_override_reason || "").trim() || null,
      p_actual_pack_qty: actualPackQty,
      p_actual_output_qty: actualOutputQty,
      p_actual_produced_qty: actualOutputQty,
      p_good_output_qty: actualOutputQty,
      p_wastage_qty: 0,
      p_uom: productionUom,
      p_qc_status: "Pending",
      p_production_sop_id: null,
      p_sop_version: "",
      p_notes: production.notes || "",
      p_created_by: employeeId || null,
      p_usage_items: usageItems,
    });
    throwSupabaseError("factory.production.complete", error);

    const { data, error: fetchError } = await supabase
      .from("factory_productions")
      .select(`${productionSelectDetailed},production_sop:factory_production_sops(sop_code,title,version)`)
      .eq("id", productionId)
      .single();
    throwSupabaseError("factory.production.fetch_completed", fetchError);

    await logFactoryAction({
      action: "factory_production_completed",
      target: data.production_no,
      description: "Factory production completed with actual material usage and finished goods stock-in.",
      after: data,
    });
    return mapProduction(data);
  },

  async getProductionByJobOrder(jobOrderId) {
    if (!jobOrderId) return null;
    const { data, error } = await supabase
      .from("factory_productions")
      .select(`${productionSelectDetailed},production_sop:factory_production_sops(sop_code,title,version)`)
      .eq("job_order_id", jobOrderId)
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwSupabaseError("factory.production.fetch_by_job_order", error);
    return data ? mapProduction(data) : null;
  },

  async saveFinishedGoodDispatch(dispatch) {
    const isUpdate = Boolean(dispatch.id);
    const items = (dispatch.items || []).map((item) => ({
      finished_good_id: item.finished_good_id,
      quantity: normalizeNumber(item.quantity),
      batch_no: item.batch_no || "",
      remarks: item.remarks || "",
      allocations: (item.allocations || []).map((allocation) => ({
        batch_balance_id: allocation.batch_id || allocation.batch_balance_id,
        quantity: normalizeNumber(allocation.quantity),
      })),
    })).filter((item) => item.finished_good_id || item.quantity || item.batch_no || item.remarks);

    if (!dispatch.customer_id) throw new Error("Select a Customer.");
    if (!dispatch.dispatch_date) throw new Error("Dispatch Date is required.");
    if (!items.length) throw new Error("Add at least one dispatch item.");
    const invalidItem = items.find((item) => !item.finished_good_id || item.quantity <= 0);
    if (invalidItem) throw new Error("Every dispatch item needs a Packaging SKU and quantity greater than 0.");
    const invalidAllocation = items.find((item) => (
      !Number.isInteger(item.quantity)
      || (item.allocations.length > 0 && (
        item.allocations.some((allocation) => !(allocation.batch_balance_id) || !Number.isInteger(allocation.quantity) || allocation.quantity <= 0)
        || item.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== item.quantity
      ))
    ));
    if (invalidAllocation) throw new Error("Clear or confirm a complete batch allocation for every dispatch line.");

    if (isUpdate && dispatch.status !== "draft") throw new Error("Only draft dispatches can be edited.");

    if (!dispatch.completion_request_id) throw new Error("Dispatch request ID is required.");
    const { data: dispatchId, error } = await supabase.rpc("factory_save_finished_good_dispatch_draft", {
      p_dispatch_id: dispatch.id || null,
      p_request_id: dispatch.completion_request_id,
      p_customer_id: dispatch.customer_id,
      p_reference_no: dispatch.reference_no || "",
      p_dispatch_date: dispatch.dispatch_date,
      p_remarks: dispatch.remarks || "",
      p_items: items,
    });
    throwSupabaseError("factory.finished_good_dispatch.save", error);
    const saved = mapFinishedGoodDispatch({ ...dispatch, id: dispatchId, status: "draft" });

    await logFactoryAction({
      action: isUpdate ? "factory_finished_good_dispatch_updated" : "factory_finished_good_dispatch_created",
      target: saved.dispatch_no || dispatchId,
      description: isUpdate ? "Factory finished goods dispatch draft updated." : "Factory finished goods dispatch draft created.",
      after: saved,
    });
    return saved;
  },

  async getFinishedGoodBatchAvailability({ finishedGoodId, dispatchId = null, dispatchDate = null }) {
    if (!finishedGoodId) return {
      finished_good_id: "",
      aggregate_balance: 0,
      allocatable_batch_balance: 0,
      unavailable_balance: 0,
      batches: [],
      unavailable_batches: [],
    };
    const { data, error } = await supabase.rpc("factory_get_finished_good_batch_availability", {
      p_finished_good_id: finishedGoodId,
      p_dispatch_id: dispatchId || null,
      p_dispatch_date: dispatchDate || null,
    });
    throwSupabaseError("factory.finished_good_dispatch.batch_availability", error);
    const payload = data && !Array.isArray(data) ? data : {};
    const mapBatch = (row) => ({
      batch_id: row.batch_id,
      production_id: row.production_id,
      batch_type: row.batch_type || "production",
      batch_no: row.batch_no || "",
      manufacturing_date: row.manufacturing_date || "",
      expiry_date: row.expiry_date || "",
      storage_location_id: row.storage_location_id || "",
      storage_location: row.storage_location || "",
      storage_location_type: row.storage_location_type || "",
      storage_location_status: row.storage_location_status || "",
      location_valid: !row.exclusion_reason,
      location_issue: row.exclusion_reason || "",
      produced_qty: normalizeNumber(row.produced_qty),
      allocated_qty: normalizeNumber(row.allocated_qty),
      provisional_qty: normalizeNumber(row.provisional_qty),
      available_qty: normalizeNumber(row.available_qty),
      unavailable_qty: normalizeNumber(row.unavailable_qty),
      exclusion_reason: row.exclusion_reason || "",
    });
    return {
      finished_good_id: payload.finished_good_id || finishedGoodId,
      aggregate_balance: normalizeNumber(payload.aggregate_balance),
      allocatable_batch_balance: normalizeNumber(payload.allocatable_batch_balance),
      unavailable_balance: normalizeNumber(payload.unavailable_balance),
      batches: (Array.isArray(payload.batches) ? payload.batches : []).map(mapBatch),
      unavailable_batches: (Array.isArray(payload.unavailable_batches) ? payload.unavailable_batches : []).map(mapBatch),
    };
  },

  async getFinishedGoodInventoryReconciliation(finishedGoodId = null) {
    const { data, error } = await supabase.rpc("factory_get_finished_good_inventory_reconciliation", {
      p_finished_good_id: finishedGoodId || null,
    });
    throwSupabaseError("factory.finished_goods.inventory_reconciliation", error);
    return (data || []).map((row) => ({
      finished_good_id: row.finished_good_id,
      aggregate_balance: normalizeNumber(row.aggregate_balance),
      production_balance: normalizeNumber(row.production_balance),
      adjustment_balance: normalizeNumber(row.adjustment_balance),
      legacy_unallocated_balance: normalizeNumber(row.legacy_unallocated_balance),
      batch_balance: normalizeNumber(row.batch_balance),
      variance: normalizeNumber(row.variance),
      reconciliation_status: row.reconciliation_status || "mismatch",
      ambiguous_reference_count: normalizeNumber(row.ambiguous_reference_count),
      unmatched_reference_count: normalizeNumber(row.unmatched_reference_count),
      affected_quantity: normalizeNumber(row.affected_quantity),
      affected_dispatch_references: Array.isArray(row.affected_dispatch_references) ? row.affected_dispatch_references : [],
    }));
  },

  async saveFactoryCustomer(customer, employeeId) {
    const isUpdate = Boolean(customer.id);
    const payload = {
      customer_name: String(customer.customer_name || "").trim(),
      customer_code: String(customer.customer_code || "").trim() || null,
      customer_type: customer.customer_type || "Other",
      contact_person: customer.contact_person || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      status: customer.status || "active",
      remarks: customer.remarks || "",
      updated_at: new Date().toISOString(),
    };
    if (!payload.customer_name) throw new Error("Customer name is required.");
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_customers").update(payload).eq("id", customer.id)
      : supabase.from("factory_customers").insert(payload);
    const { data, error } = await query.select(factoryCustomerSelect).single();
    throwSupabaseError("factory.customer.save", error);

    await logFactoryAction({
      action: isUpdate ? "factory_customer_updated" : "factory_customer_created",
      target: data.customer_name,
      description: isUpdate ? "Factory customer master updated." : "Factory customer master created.",
      after: data,
    });
    return mapFactoryCustomer(data);
  },

  async archiveFactoryCustomer(customer) {
    const { data, error } = await supabase
      .from("factory_customers")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", customer.id)
      .select(factoryCustomerSelect)
      .single();
    throwSupabaseError("factory.customer.archive", error);

    await logFactoryAction({
      action: "factory_customer_archived",
      target: data.customer_name,
      description: "Factory customer master archived.",
      after: data,
    });
    return mapFactoryCustomer(data);
  },

  async completeFinishedGoodDispatch(dispatch) {
    const { data: dispatchId, error } = await supabase.rpc("factory_complete_finished_good_dispatch", {
      p_dispatch_id: dispatch.id,
    });
    throwSupabaseError("factory.finished_good_dispatch.complete", error);
    const completed = mapFinishedGoodDispatch({ ...dispatch, id: dispatchId || dispatch.id, status: "completed" });

    await logFactoryAction({
      action: "factory_finished_good_dispatch_completed",
      target: completed.dispatch_no || completed.id,
      description: "Factory finished goods dispatch completed with stock-out movement.",
      after: completed,
    });
    return completed;
  },

  async saveAndCompleteFinishedGoodDispatch(dispatch) {
    const items = (dispatch.items || []).map((item) => ({
      finished_good_id: item.finished_good_id,
      quantity: normalizeNumber(item.quantity),
      batch_no: item.batch_no || "",
      remarks: item.remarks || "",
      allocations: (item.allocations || []).map((allocation) => ({
        batch_balance_id: allocation.batch_id || allocation.batch_balance_id,
        quantity: normalizeNumber(allocation.quantity),
      })),
    })).filter((item) => item.finished_good_id || item.quantity || item.batch_no || item.remarks);

    if (!dispatch.customer_id) throw new Error("Select a Customer.");
    if (!dispatch.dispatch_date) throw new Error("Dispatch Date is required.");
    if (!items.length) throw new Error("Add at least one dispatch item.");
    const invalidItem = items.find((item) => !item.finished_good_id || !Number.isInteger(item.quantity) || item.quantity <= 0);
    if (invalidItem) throw new Error("Every dispatch item needs a Packaging SKU and a whole-number quantity greater than 0.");
    const invalidAllocation = items.find((item) => (
      !item.allocations.length
      || item.allocations.some((allocation) => !allocation.batch_balance_id || !Number.isInteger(allocation.quantity) || allocation.quantity <= 0)
      || item.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== item.quantity
    ));
    if (invalidAllocation) throw new Error("Confirm a complete batch allocation for every dispatch line.");
    if (dispatch.id && dispatch.status !== "draft") throw new Error("Only draft dispatches can be completed.");
    if (!dispatch.completion_request_id) throw new Error("Dispatch request ID is required.");

    const { data, error } = await supabase.rpc("factory_save_and_complete_finished_good_dispatch", {
      p_dispatch_id: dispatch.id || null,
      p_request_id: dispatch.completion_request_id,
      p_customer_id: dispatch.customer_id,
      p_reference_no: dispatch.reference_no || "",
      p_dispatch_date: dispatch.dispatch_date,
      p_remarks: dispatch.remarks || "",
      p_items: items,
    });
    throwSupabaseError("factory.finished_good_dispatch.save_and_complete", error);
    const completed = mapFinishedGoodDispatch(data || {});

    await logFactoryAction({
      action: "factory_finished_good_dispatch_completed",
      target: completed.dispatch_no || completed.id,
      description: "Factory finished goods dispatch saved and completed with stock-out movement.",
      after: completed,
    });
    return completed;
  },

  async cancelFinishedGoodDispatch(dispatch) {
    if (dispatch.status !== "draft") throw new Error("Only draft dispatches can be cancelled.");
    const { data: cancelledId, error } = await supabase.rpc("factory_cancel_finished_goods_dispatch", {
      p_dispatch_id: dispatch.id,
    });
    throwSupabaseError("factory.finished_good_dispatch.cancel", error);
    const cancelled = mapFinishedGoodDispatch({ ...dispatch, id: cancelledId || dispatch.id, status: "cancelled" });

    await logFactoryAction({
      action: "factory_finished_good_dispatch_cancelled",
      target: cancelled.dispatch_no || cancelled.id,
      description: "Factory finished goods dispatch cancelled.",
      after: cancelled,
    });
    return cancelled;
  },

  async createQcChecklistTemplate(template, employeeId) {
    const name = String(template.name || "").trim();
    const resultMode = String(template.result_mode || "checklist").trim().toLowerCase();
    if (!name) throw new Error("QC Check Name is required.");
    if (!["checklist", "remarks"].includes(resultMode)) throw new Error("Result Mode must be Checklist or Remarks.");
    const { data: result, error } = await supabase.rpc("factory_create_qc_checklist_template", {
      p_name: name,
      p_result_mode: resultMode,
      p_description: String(template.description || "").trim() || null,
      p_created_by: employeeId || null,
    });
    throwSupabaseError("factory.qc_template.create", error);
    const templateId = Array.isArray(result) ? result[0]?.template_id : result?.template_id;
    const { data, error: fetchError } = await supabase.from("factory_qc_checklist_templates").select("id,name,category,description,result_mode,is_active,created_at,updated_at").eq("id", templateId).single();
    throwSupabaseError("factory.qc_template.create_fetch", fetchError);
    await logFactoryAction({ action: "factory_qc_template_created", target: data.name, description: "Factory QC Checklist Preset created.", after: data });
    return data;
  },

  async updateQcChecklistTemplate(template) {
    const name = String(template.name || "").trim();
    const resultMode = String(template.result_mode || "checklist").trim().toLowerCase();
    if (!name) throw new Error("QC Check Name is required.");
    if (!["checklist", "remarks"].includes(resultMode)) throw new Error("Result Mode must be Checklist or Remarks.");
    const { data: result, error } = await supabase.rpc("factory_update_qc_checklist_template", {
      p_template_id: template.id,
      p_name: name,
      p_result_mode: resultMode,
      p_description: String(template.description || "").trim() || null,
    });
    throwSupabaseError("factory.qc_template.update", error);
    const templateId = Array.isArray(result) ? result[0]?.template_id : result?.template_id;
    const { data, error: fetchError } = await supabase.from("factory_qc_checklist_templates").select("id,name,category,description,result_mode,is_active,created_at,updated_at").eq("id", templateId).single();
    throwSupabaseError("factory.qc_template.update_fetch", fetchError);
    await logFactoryAction({ action: "factory_qc_template_updated", target: data.name, description: "Factory QC Checklist Preset updated.", before: template, after: data });
    return data;
  },

  async archiveQcChecklistTemplate(template) {
    const { error } = await supabase.rpc("factory_archive_qc_checklist_template", { p_template_id: template.id });
    throwSupabaseError("factory.qc_template.archive", error);
    await logFactoryAction({ action: "factory_qc_template_archived", target: template.name, description: "Factory QC Checklist Preset archived.", before: template });
    return true;
  },

  async restoreQcChecklistTemplate(template) {
    const { error } = await supabase.rpc("factory_restore_qc_checklist_template", { p_template_id: template.id });
    throwSupabaseError("factory.qc_template.restore", error);
    await logFactoryAction({ action: "factory_qc_template_restored", target: template.name, description: "Factory QC Checklist Preset restored.", before: template });
    return true;
  },

  async deleteQcChecklistTemplate(template) {
    const { error } = await supabase.rpc("factory_delete_qc_checklist_template", { p_template_id: template.id });
    throwSupabaseError("factory.qc_template.delete", error);
    await logFactoryAction({ action: "factory_qc_template_deleted", target: template.name, description: "Unused Factory QC Checklist Preset deleted.", before: template });
    return true;
  },

  async saveProductionSop(sop, employeeId) {
    const isUpdate = Boolean(sop.id);
    const steps = (sop.steps ?? []).map((step, index) => {
      const subSteps = (step.sub_steps ?? []).map((subStep, subIndex) => ({
        sequence_no: subIndex + 1,
        instruction: String(subStep.instruction || "").trim(),
        estimated_minutes: normalizeSopMinutes(subStep.estimated_minutes, `Sub-step ${index + 1}.${subIndex + 1} minutes`, ""),
        remarks: String(subStep.remarks || "").trim(),
      }));
      const estimatedMinutes = subSteps.length
        ? subSteps.reduce((sum, subStep) => sum + Number(subStep.estimated_minutes || 0), 0)
        : normalizeSopMinutes(step.estimated_time_minutes, `Step ${index + 1} minutes`);
      return {
        id: databaseUuid(step.id),
        step_no: index + 1,
        step_name: String(step.step_name || step.process_name || "").trim(),
        description: String(step.description || "").trim(),
        estimated_time_minutes: estimatedMinutes,
        qc_checks: (step.qc_checks ?? []).map((qc, qcIndex) => ({
          id: databaseUuid(qc.id),
          sequence_no: qcIndex + 1,
          qc_type: String(qc.qc_type || "checklist").trim().toLowerCase(),
          checklist_template_id: qc.checklist_template_id || "",
          qc_name: String(qc.qc_name || "").trim(),
          instructions: String(qc.instructions || "").trim(),
          is_required: qc.is_required !== false,
        })),
        remarks: String(step.remarks || step.safety_note || "").trim(),
        ingredient_material_ids: [...new Set((step.ingredient_material_ids ?? []).filter(Boolean))],
        sub_steps: subSteps,
      };
    });

    if (!String(sop.title || sop.sop_name || "").trim()) throw new Error("SOP name is required.");
    if (!String(sop.finished_good_id || sop.product_name || "").trim()) throw new Error("Finished Good is required.");
    if (!steps.length) throw new Error("At least one SOP step is required.");

    steps.forEach((step, index) => {
      if (!step.step_name) throw new Error(`Step ${index + 1} requires a Step Name.`);
      step.qc_checks.forEach((qc, qcIndex) => {
        if (!["checklist", "remarks"].includes(qc.qc_type)) throw new Error(`Step ${index + 1} QC ${qcIndex + 1} requires a valid Type.`);
        if (!qc.qc_name) throw new Error(`Step ${index + 1} QC ${qcIndex + 1} requires a QC Name.`);
        if (!qc.checklist_template_id && !qc.id) throw new Error(`Step ${index + 1} QC ${qcIndex + 1} requires a QC Check preset.`);
      });
      const emptySubStep = step.sub_steps.findIndex((subStep) => !subStep.instruction);
      if (emptySubStep >= 0) throw new Error(`Sub-step ${index + 1}.${emptySubStep + 1} requires an instruction.`);
    });

    const { data: result, error } = await supabase.rpc("factory_save_production_sop_structure", {
      p_sop_id: sop.id || null,
      p_finished_good_id: sop.finished_good_id || null,
      p_title: String(sop.title || sop.sop_name || "").trim(),
      p_effective_date: sop.effective_date || null,
      p_remarks: String(sop.remarks || sop.notes || "").trim(),
      p_recipe_id: sop.recipe_id || null,
      p_recipe_version: sop.recipe_version || null,
      p_steps: steps,
      p_created_by: employeeId || null,
    });
    throwSupabaseError("factory.sop.save_structure", error);
    const sopId = Array.isArray(result) ? result[0]?.sop_id : result?.sop_id;
    if (!sopId) throw new Error("Production SOP save did not return an SOP id.");

    const { data: saved, error: fetchError } = await supabase
      .from("factory_production_sops")
      .select(sopSelect)
      .eq("id", sopId)
      .single();
    throwSupabaseError("factory.sop.fetch_saved", fetchError);

    await logFactoryAction({
      action: isUpdate ? "factory_production_sop_updated" : "factory_production_sop_created",
      target: saved.sop_code,
      description: isUpdate ? "Factory Production SOP updated." : "Factory Production SOP created.",
      after: saved,
    });
    return mapProductionSop(saved);
  },

  async activateProductionSop(sop) {
    const { data: activated, error: activateError } = await supabase.rpc("factory_activate_production_sop", {
      p_sop_id: sop.id,
    });
    throwSupabaseError("factory.sop.activate_rpc", activateError);
    const sopId = Array.isArray(activated) ? activated[0]?.sop_id : activated?.sop_id;
    if (!sopId) throw new Error("Production SOP activation did not return an SOP id.");
    const { data, error } = await supabase
      .from("factory_production_sops")
      .select(sopSelect)
      .eq("id", sopId)
      .single();
    throwSupabaseError("factory.sop.activate_fetch", error);
    await logFactoryAction({ action: "factory_production_sop_activated", target: data.sop_code, description: "Factory Production SOP activated.", after: data });
    return mapProductionSop(data);
  },

  async createProductionSopNewVersion(sop) {
    const { data: created, error: createError } = await supabase.rpc("factory_create_production_sop_new_version", {
      p_source_sop_id: sop.id,
    });
    throwSupabaseError("factory.sop.new_version_rpc", createError);
    const sopId = Array.isArray(created) ? created[0]?.sop_id : created?.sop_id;
    if (!sopId) throw new Error("New Production SOP version was not created.");
    const { data, error } = await supabase
      .from("factory_production_sops")
      .select(sopSelect)
      .eq("id", sopId)
      .single();
    throwSupabaseError("factory.sop.new_version_fetch", error);
    await logFactoryAction({ action: "factory_production_sop_new_version_created", target: data.sop_code, description: "Factory Production SOP draft version created.", after: data });
    return mapProductionSop(data);
  },

  async deleteProductionSop(sop) {
    const { data: existing, error: lookupError } = await supabase
      .from("factory_production_sops")
      .select("id,sop_code,title,status")
      .eq("id", sop.id)
      .single();
    throwSupabaseError("factory.sop.delete_lookup", lookupError);
    if (String(existing.status || "").toLowerCase() !== "draft") throw new Error("Only draft Production SOPs can be deleted.");
    const { error } = await supabase.from("factory_production_sops").delete().eq("id", sop.id).eq("status", "draft");
    throwSupabaseError("factory.sop.delete", error);
    await logFactoryAction({ action: "factory_production_sop_deleted", target: existing.sop_code, description: "Factory Production SOP draft deleted.", before: existing });
    return true;
  },

  async archiveProductionSop(sop) {
    if (String(sop.status || "").toLowerCase() !== "active") throw new Error("Only active Production SOPs can be archived.");
    const { data: archived, error: archiveError } = await supabase.rpc("factory_archive_production_sop", {
      p_sop_id: sop.id,
    });
    throwSupabaseError("factory.sop.archive_rpc", archiveError);
    const sopId = Array.isArray(archived) ? archived[0]?.sop_id : archived?.sop_id;
    if (!sopId) throw new Error("Production SOP archive did not return an SOP id.");
    const { data, error } = await supabase
      .from("factory_production_sops")
      .select(sopSelect)
      .eq("id", sopId)
      .single();
    throwSupabaseError("factory.sop.archive", error);
    await logFactoryAction({ action: "factory_production_sop_archived", target: data.sop_code, description: "Factory Production SOP archived.", after: data });
    return mapProductionSop(data);
  },

  async restoreProductionSop(sop) {
    if (String(sop.status || "").toLowerCase() !== "archived") throw new Error("Only archived Production SOPs can be restored.");
    const { data: restored, error: restoreError } = await supabase.rpc("factory_restore_production_sop", {
      p_sop_id: sop.id,
    });
    throwSupabaseError("factory.sop.restore_rpc", restoreError);
    const sopId = Array.isArray(restored) ? restored[0]?.sop_id : restored?.sop_id;
    if (!sopId) throw new Error("Production SOP restore did not return an SOP id.");
    const { data, error } = await supabase
      .from("factory_production_sops")
      .select(sopSelect)
      .eq("id", sopId)
      .single();
    throwSupabaseError("factory.sop.restore", error);
    await logFactoryAction({ action: "factory_production_sop_restored", target: data.sop_code, description: "Factory Production SOP restored as draft.", after: data });
    return mapProductionSop(data);
  },

  async saveStockCheck(stockType, stockCheck, employeeId) {
    const isRaw = stockType === "raw";
    const table = isRaw ? "factory_raw_material_stock_checks" : "factory_product_stock_checks";
    const itemTable = isRaw ? "factory_raw_material_stock_check_items" : "factory_product_stock_check_items";
    const itemIdColumn = isRaw ? "raw_material_id" : "finished_good_id";
    const refPrefix = isRaw ? "RMSC" : "FGSC";
    const isUpdate = Boolean(stockCheck.id);
    const status = stockCheck.status === "submitted" ? "submitted" : "draft";
    const items = (stockCheck.items ?? []).map((item) => {
      const itemId = isRaw ? item.raw_material_id : item.finished_good_id;
      const isSkipped = item.count_status === "skip" || item.variance_status === "Skipped";
      const physicalInput = item.physical_qty === "" || item.physical_qty == null ? "" : item.physical_qty;
      const countStatus = isSkipped ? "skip" : physicalInput === "" ? "pending" : "counted";
      const physicalQty = isSkipped || physicalInput === "" ? normalizeNumber(item.system_qty) : normalizeNumber(item.physical_qty);
      const variance = isSkipped || physicalInput === "" ? { varianceQty: 0, variancePercent: 0, varianceStatus: isSkipped ? "Skipped" : "Normal" } : stockCheckVariance(item.system_qty, physicalQty);
      return {
        itemId,
        is_skipped: isSkipped,
        physical_qty_input: physicalInput,
        count_status: countStatus,
        [itemIdColumn]: itemId,
        system_qty: normalizeNumber(item.system_qty),
        physical_qty: physicalQty,
        variance_qty: Number(variance.varianceQty.toFixed(4)),
        variance_percent: Number(variance.variancePercent.toFixed(4)),
        variance_status: variance.varianceStatus,
        variance_reason: item.variance_reason || "",
        batch_allocations: isRaw ? [] : (item.batch_allocations || []).map((allocation) => ({
          batch_balance_id: allocation.batch_id || allocation.batch_balance_id,
          quantity: normalizeNumber(allocation.quantity),
          location_valid: allocation.location_valid,
          location_issue: allocation.location_issue || "",
        })),
        uom: item.uom || "",
      };
    });
    validateStockCheckItems(items, status);

    if (!isRaw) {
      const invalidWholeQty = items.find((item) => (
        (item.physical_qty_input !== "" && (!Number.isFinite(Number(item.physical_qty_input)) || !Number.isInteger(Number(item.physical_qty_input))))
        || !Number.isFinite(item.system_qty)
        || !Number.isInteger(item.system_qty)
        || (item.physical_qty_input !== "" && !Number.isInteger(item.physical_qty))
        || !Number.isInteger(item.variance_qty)
      ));
      if (invalidWholeQty) throw new Error("Physical Qty must be a whole number.");
      const invalidAllocationLocation = items.find((item) => item.batch_allocations.some((allocation) => allocation.location_valid === false));
      if (invalidAllocationLocation) throw new Error("Storage location unavailable. Replace invalid batch allocations before saving.");
      const invalidAllocation = items.find((item) => item.batch_allocations.some((allocation) => (
        !allocation.batch_balance_id
        || !Number.isFinite(allocation.quantity)
        || !Number.isInteger(allocation.quantity)
        || allocation.quantity <= 0
      )));
      if (invalidAllocation) throw new Error("Batch reduction quantities must be whole numbers greater than zero.");
      const { data: savedRows, error: saveError } = await supabase.rpc("factory_save_product_stock_check_structure", {
        p_stock_check_id: stockCheck.id || null,
        p_check_date: stockCheck.check_date || new Date().toISOString().slice(0, 10),
        p_notes: stockCheck.notes || "",
        p_target_status: status,
        p_created_by: employeeId || null,
        p_rows: items.map((item) => ({
          finished_good_id: item.finished_good_id,
          physical_qty: item.physical_qty_input === "" ? null : item.physical_qty,
          variance_reason: item.variance_reason,
          allocations: item.batch_allocations,
        })),
      });
      throwSupabaseError("factory.product_stock_check.structure_save", saveError);
      const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
      if (!saved?.id || !saved?.check_no) throw new Error("Product Stock Check reference was not returned.");
      const result = { ...stockCheck, ...saved, status, created_by: stockCheck.created_by || employeeId || "", items };
      await logFactoryAction({
        action: status === "submitted" ? "factory_product_stock_check_submitted" : "factory_product_stock_check_saved",
        target: saved.check_no,
        description: status === "submitted" ? "Factory stock check submitted for approval." : "Factory stock check draft saved.",
        after: result,
      });
      return mapStockCheck(result, "product");
    }

    if (isRaw && !isUpdate) {
      const { data: createdRows, error: createError } = await supabase.rpc("factory_create_raw_material_stock_check", {
        p_category_id: stockCheck.category_id || null,
        p_check_date: stockCheck.check_date || new Date().toISOString().slice(0, 10),
        p_notes: stockCheck.notes || "",
        p_rows: items.map((item) => ({
          raw_material_id: item.raw_material_id,
          system_qty: item.system_qty,
          physical_qty: item.physical_qty,
          variance_qty: item.variance_qty,
          variance_percent: item.variance_percent,
          count_status: item.count_status,
          variance_status: item.variance_status,
          variance_reason: item.variance_reason,
          uom: item.uom,
        })),
      });
      throwSupabaseError("factory.raw_stock_check.create_rpc", createError);
      const created = Array.isArray(createdRows) ? createdRows[0] : createdRows;
      if (!created?.id || !created?.check_no) throw new Error("Raw material stock check reference was not returned.");
      const createdStockCheck = {
        ...stockCheck,
        id: created.id,
        check_no: created.check_no,
        check_date: stockCheck.check_date || new Date().toISOString().slice(0, 10),
        status: "draft",
        category_id: stockCheck.category_id || "",
        notes: stockCheck.notes || "",
        created_by: employeeId || "",
        items,
      };
      if (status === "submitted") {
        return factoryService.saveStockCheck(stockType, { ...createdStockCheck, status: "submitted" }, employeeId);
      }
      await logFactoryAction({
        action: "factory_raw_stock_check_saved",
        target: created.check_no,
        description: "Factory stock check draft saved.",
        after: createdStockCheck,
      });
      return mapStockCheck(createdStockCheck, stockType);
    }

    const payload = {
      check_no: stockCheck.check_no || await makeDailyFactoryRef(table, refPrefix),
      check_date: stockCheck.check_date || new Date().toISOString().slice(0, 10),
      status,
      notes: stockCheck.notes || "",
      updated_at: new Date().toISOString(),
    };
    if (isRaw) payload.category_id = stockCheck.category_id || null;
    if (!isUpdate) payload.created_by = employeeId || null;
    if (status === "submitted") {
      payload.submitted_by = employeeId || null;
      payload.submitted_at = new Date().toISOString();
    }

    const query = isUpdate
      ? supabase.from(table).update(payload).eq("id", stockCheck.id)
      : supabase.from(table).insert(payload);
    const { data, error } = await query
      .select(isRaw ? "id,check_no,check_date,category_id,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at" : "id,check_no,check_date,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at")
      .single();
    throwSupabaseError(`factory.${stockType}_stock_check.save`, error);

    if (isUpdate) {
      const deleteResult = await supabase.from(itemTable).delete().eq("stock_check_id", data.id);
      throwSupabaseError(`factory.${stockType}_stock_check.items_delete`, deleteResult.error);
    }

    const insertResult = await supabase.from(itemTable).insert(items.map((item) => ({
      stock_check_id: data.id,
      [itemIdColumn]: item[itemIdColumn],
      system_qty: item.system_qty,
      physical_qty: item.physical_qty,
      variance_qty: item.variance_qty,
      variance_percent: item.variance_percent,
      ...(isRaw ? { count_status: item.count_status } : {}),
      variance_status: item.variance_status,
      variance_reason: item.variance_reason,
      uom: item.uom,
      updated_at: new Date().toISOString(),
    })));
    throwSupabaseError(`factory.${stockType}_stock_check.items_insert`, insertResult.error);

    await logFactoryAction({
      action: status === "submitted" ? `factory_${stockType}_stock_check_submitted` : `factory_${stockType}_stock_check_saved`,
      target: data.check_no,
      description: status === "submitted" ? "Factory stock check submitted for approval." : "Factory stock check draft saved.",
      after: { ...data, items },
    });
    return mapStockCheck({ ...data, items }, stockType);
  },

  async deleteStockCheck(stockType, stockCheck) {
    if (stockCheck.status !== "draft") throw new Error("Only draft stock checks can be deleted.");
    const isRaw = stockType === "raw";
    const { error } = isRaw
      ? await supabase.from("factory_raw_material_stock_checks").delete().eq("id", stockCheck.id).eq("status", "draft")
      : await supabase.rpc("factory_delete_product_stock_check_draft", { p_stock_check_id: stockCheck.id });
    throwSupabaseError(`factory.${stockType}_stock_check.delete`, error);
    await logFactoryAction({
      action: `factory_${stockType}_stock_check_deleted`,
      target: stockCheck.check_no,
      description: "Factory draft stock check deleted.",
      before: stockCheck,
    });
  },

  async approveStockCheck(stockType, stockCheck, employeeId) {
    const rpcName = stockType === "raw" ? "factory_approve_raw_material_stock_check" : "factory_approve_product_stock_check";
    const { error } = await supabase.rpc(rpcName, {
      p_stock_check_id: stockCheck.id,
      p_approved_by: employeeId || null,
    });
    throwSupabaseError(`factory.${stockType}_stock_check.approve`, error);
    await logFactoryAction({
      action: `factory_${stockType}_stock_check_approved`,
      target: stockCheck.check_no,
      description: "Factory stock check approved and inventory adjustment movement created.",
      after: stockCheck,
    });
  },
};
