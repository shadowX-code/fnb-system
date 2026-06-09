import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function mapJobOrder(row) {
  const finishedGood = row.finished_good || {};
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
    target_quantity: normalizeNumber(row.target_quantity),
    produced_quantity: normalizeNumber(row.produced_quantity),
    uom: row.uom || finishedGood.uom || "",
    planned_date: row.planned_date || "",
    due_date: row.due_date || "",
    priority: row.priority || "Normal",
    status: row.status || "draft",
    assigned_team: row.assigned_team || "",
    remarks: row.remarks || "",
    created_by: row.created_by || "",
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
    category_id: row.category_id || "",
    category: categoryName,
    uom: row.uom || "",
    current_balance: normalizeNumber(row.current_balance),
    min_stock_level: normalizeNumber(row.min_stock_level),
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

function mapReceiving(row) {
  return {
    id: row.id,
    receipt_no: row.receipt_no,
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
    storage_location: row.storage_location || "",
    remarks: row.remarks || "",
    received_by: row.received_by || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRawMaterialMovement(row) {
  return {
    id: row.id,
    raw_material_id: row.raw_material_id || "",
    raw_material_name: row.raw_material?.name_en || row.raw_material?.name || "",
    movement_type: row.movement_type || "",
    quantity: normalizeNumber(row.quantity),
    uom: row.uom || row.raw_material?.uom || "",
    reference_type: row.reference_type || "",
    reference_id: row.reference_id || "",
    reference_no: row.reference_no || "",
    movement_date: row.movement_date || "",
    notes: row.notes || "",
    created_by: row.created_by || "",
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
    job_order_no: row.job_order?.job_order_no || "",
    batch_no: row.batch_no || "",
    produced_quantity: normalizeNumber(row.produced_quantity),
    actual_produced_qty: normalizeNumber(row.actual_produced_qty || row.produced_quantity),
    good_output_qty: normalizeNumber(row.good_output_qty || row.produced_quantity),
    wastage_qty: normalizeNumber(row.wastage_qty),
    uom: row.uom || "",
    production_date: row.production_date || "",
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
  };
}

function mapFinishedGood(row) {
  const storageLocationName = row.storage_location_ref?.location_name || row.storage_location || "";
  return {
    id: row.id,
    product_code: row.product_code || "",
    product_name: row.product_name || "",
    product_name_en: row.product_name_en || row.product_name || "",
    product_name_cn: row.product_name_cn || "",
    product_name_bm: row.product_name_bm || "",
    category_id: row.category_id || "",
    category: row.category_ref?.name || row.category || "",
    uom: row.uom || "",
    current_balance: normalizeNumber(row.current_balance),
    min_stock_level: normalizeNumber(row.min_stock_level),
    storage_location_id: row.storage_location_id || "",
    storage_location: storageLocationName,
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
  return {
    id: row.id,
    finished_good_id: row.finished_good_id || "",
    product_name: row.finished_good?.product_name || row.product_name || "",
    movement_type: row.movement_type || "",
    quantity: normalizeNumber(row.quantity),
    uom: row.uom || row.finished_good?.uom || "",
    reference_type: row.reference_type || "",
    reference_id: row.reference_id || "",
    reference_no: row.reference_no || "",
    movement_date: row.movement_date || "",
    notes: row.notes || "",
    created_by: row.created_by || "",
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
    variance_status: row.variance_status || "Normal",
    variance_reason: row.variance_reason || "",
    uom: row.uom || row.raw_material?.uom || row.finished_good?.uom || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapStockCheck(row, stockType) {
  return {
    id: row.id,
    check_no: row.check_no || "",
    check_date: row.check_date || "",
    status: row.status || "draft",
    notes: row.notes || "",
    created_by: row.created_by || "",
    submitted_by: row.submitted_by || "",
    submitted_at: row.submitted_at || "",
    approved_by: row.approved_by || "",
    approved_at: row.approved_at || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: (row.items ?? []).map((item) => normalizeStockCheckItem(item, stockType)),
  };
}

function mapRecipe(row) {
  const finishedGood = row.finished_good || {};
  return {
    id: row.id,
    recipe_code: row.recipe_code || "",
    finished_good_id: row.finished_good_id || "",
    product_code: finishedGood.product_code || "",
    recipe_name: row.recipe_name || row.recipe_code || "",
    product_name: finishedGood.product_name || row.product_name || "",
    product_name_en: finishedGood.product_name_en || finishedGood.product_name || row.product_name || "",
    product_name_cn: finishedGood.product_name_cn || "",
    product_name_bm: finishedGood.product_name_bm || "",
    version: row.version || "v1",
    yield_quantity: normalizeNumber(row.yield_quantity, 1),
    uom: row.uom || "",
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
  return {
    id: row.id,
    sop_code: row.sop_code || "",
    title: row.title || "",
    product_name: row.product_name || "",
    version: row.version || "v1",
    effective_date: row.effective_date || "",
    equipment: row.equipment || "",
    status: row.status || "active",
    notes: row.notes || "",
    created_by: row.created_by || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    steps: (row.steps ?? []).map((step) => ({
      id: step.id,
      sop_id: step.sop_id,
      step_no: normalizeNumber(step.step_no),
      process_name: step.process_name || step.instruction || "",
      description: step.description || step.instruction || "",
      control_point: step.control_point || "",
      materials: step.materials || "",
      equipment: step.equipment || "",
      estimated_time_minutes: normalizeNumber(step.estimated_time_minutes || step.expected_duration_minutes),
      is_qc_checkpoint: Boolean(step.is_qc_checkpoint),
      safety_note: step.safety_note || "",
      created_at: step.created_at,
      updated_at: step.updated_at,
    })).sort((a, b) => a.step_no - b.step_no),
  };
}

function makeFactoryRef(prefix) {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

function stockCheckVariance(systemQty, physicalQty) {
  const system = normalizeNumber(systemQty);
  const physical = normalizeNumber(physicalQty);
  const varianceQty = physical - system;
  const variancePercent = system === 0 ? (physical === 0 ? 0 : 100) : (varianceQty / system) * 100;
  const absPercent = Math.abs(variancePercent);
  const varianceStatus = absPercent > 5 ? "Critical" : absPercent > 2 ? "Warning" : "Normal";
  return { varianceQty, variancePercent, varianceStatus };
}

function validateStockCheckItems(items) {
  if (!items.length) throw new Error("Stock check requires at least one counted item.");
  const invalid = items.find((item) => !item.itemId || normalizeNumber(item.physical_qty, -1) < 0);
  if (invalid) throw new Error("Every stock check row needs an item and physical count.");
  const missingReason = items.find((item) => {
    const { varianceStatus } = stockCheckVariance(item.system_qty, item.physical_qty);
    return varianceStatus !== "Normal" && !String(item.variance_reason || "").trim();
  });
  if (missingReason) throw new Error("Variance reason is required for Warning and Critical stock check items.");
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
    storageLocations: [],
    rawMaterialMovements: [],
    receivings: [],
    productions: [],
    finishedGoods: [],
    finishedGoodCategories: [],
    productMovements: [],
    rawStockChecks: [],
    productStockChecks: [],
    recipes: [],
    sops: [],
    accessIssues: [],
  };
}

const finishedGoodSelect = "id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,uom,status";
const storageLocationSelect = "id,location_name,location_code,location_type,status,remarks,created_at,updated_at";
const rawMaterialSelect = `id,material_code,name,name_en,name_cn,name_bm,category_id,category,uom,current_balance,min_stock_level,preferred_supplier,storage_location_id,storage_location,status,remarks,created_at,updated_at,category_ref:factory_raw_material_categories(name),storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status)`;
const rawMaterialRelationSelect = "name,name_en,name_cn,name_bm,material_code,uom";
const jobOrderSelect = `id,job_order_no,finished_good_id,product_name,target_quantity,produced_quantity,uom,planned_date,due_date,priority,status,assigned_team,remarks,created_by,created_at,updated_at,finished_good:factory_finished_goods(${finishedGoodSelect})`;
const productionSelectBasic = `id,job_order_id,finished_good_id,production_no,product_name,batch_no,produced_quantity,actual_produced_qty,good_output_qty,wastage_qty,uom,production_date,operator_id,operator_name,start_time,end_time,qc_status,production_sop_id,sop_version,status,notes,created_by,completed_at,created_at,updated_at,finished_good:factory_finished_goods(${finishedGoodSelect}),job_order:factory_job_orders(job_order_no,finished_good_id,product_name,finished_good:factory_finished_goods(product_code,product_name))`;
const productionSelectDetailed = `${productionSelectBasic},material_usage:factory_production_material_usage(id,production_id,raw_material_id,raw_material_receiving_id,raw_material_lot_no,quantity_used,standard_usage,actual_usage,variance_qty,variance_percent,variance_reason,uom,wastage_quantity,notes,created_at,updated_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect}),raw_receiving:factory_raw_material_receivings(receipt_no,batch_no,supplier_name,received_date,unit_cost)),qc_checkpoints:factory_production_qc_checkpoints(id,production_id,production_sop_id,sop_step_id,step_no,process_name,control_point,qc_status,notes,created_at,updated_at)`;

function factoryDataPlan(scope, hasPermission) {
  const can = (code) => !hasPermission || hasPermission(code);
  const isDashboard = scope === "dashboard";
  const isJobOrders = scope === "job-orders";
  const isRawInventory = scope === "raw-inventory";
  const isRawReceiving = scope === "raw-receiving";
  const isRawStockCheck = scope === "raw-stock-check";
  const isProduction = scope === "production";
  const isReports = scope === "reports";
  const isBatchTraceability = scope === "batch-traceability";
  const isProductRecipes = scope === "product-recipes";
  const isStorageLocations = scope === "storage-locations";
  const isFinishedGoods = scope === "finished-goods";
  const isProductMovements = scope === "product-movements";
  const isProductStockCheck = scope === "product-stock-check";
  const isProductionSop = scope === "production-sop";
  const needsProductionSummary = isDashboard || isProduction || isReports || isBatchTraceability || isFinishedGoods || isProductMovements;
  const canTraceBatches = can("factory_batch_traceability.view");
  const canReadProductionReports = can("factory_production_reports.view") || canTraceBatches;
  const needsProductionDetails = isProduction || isReports || isBatchTraceability || (isDashboard && (can("factory_production.view") || canReadProductionReports));
  return {
    jobOrders: (isDashboard && can("factory_dashboard.view")) || (isJobOrders && can("factory_job_orders.view")) || ((isProduction || isReports || isBatchTraceability) && (can("factory_production.view") || canReadProductionReports)),
    rawMaterials: (isDashboard && can("factory_dashboard.view")) || (isRawInventory && can("factory_raw_inventory.view")) || (isRawReceiving && can("factory_raw_receiving.view")) || (isRawStockCheck && can("factory_raw_stock_check.view")) || (isProductRecipes && can("factory_product_recipes.view")) || (isProduction && (can("factory_raw_inventory.view") || can("factory_product_recipes.view") || can("factory_production.complete") || can("factory_dashboard.view"))),
    rawMaterialCategories: isRawInventory && can("factory_raw_inventory.view"),
    storageLocations: (isStorageLocations && can("factory_storage_locations.view")) || ((isRawInventory || isRawReceiving || isFinishedGoods) && (can("factory_storage_locations.view") || can("factory_raw_inventory.view") || can("factory_raw_receiving.view") || can("factory_finished_goods.view"))),
    rawMaterialMovements: isRawInventory && can("factory_raw_inventory.view"),
    receivings: (isDashboard && can("factory_dashboard.view")) || (isRawInventory && can("factory_raw_inventory.view")) || (isRawReceiving && can("factory_raw_receiving.view")) || (isReports && can("factory_production_reports.view")) || ((isProduction || isBatchTraceability) && can("factory_raw_receiving.view")),
    productions: needsProductionSummary && (can("factory_dashboard.view") || can("factory_production.view") || canReadProductionReports || can("factory_finished_goods.view") || can("factory_product_movements.view")),
    productionDetails: needsProductionDetails,
    finishedGoods: (isDashboard && can("factory_dashboard.view")) || (isJobOrders && (can("factory_job_orders.view") || can("factory_job_orders.create") || can("factory_job_orders.edit"))) || (isProductRecipes && can("factory_product_recipes.view")) || ((isProduction || isFinishedGoods || isProductMovements) && can("factory_finished_goods.view")) || (isProduction && can("factory_production.complete")) || (isProductStockCheck && can("factory_product_stock_check.view")),
    finishedGoodCategories: isFinishedGoods && can("factory_finished_goods.view"),
    productMovements: (isDashboard && can("factory_dashboard.view")) || ((isProduction || isProductMovements) && can("factory_product_movements.view")) || (isFinishedGoods && can("factory_finished_goods.view")) || (isReports && can("factory_product_movements.view")) || (isBatchTraceability && canTraceBatches),
    rawStockChecks: (isRawInventory && can("factory_raw_inventory.view")) || (isRawStockCheck && can("factory_raw_stock_check.view")),
    productStockChecks: isProductStockCheck && can("factory_product_stock_check.view"),
    recipes: (isDashboard && can("factory_dashboard.view")) || (isRawInventory && can("factory_raw_inventory.view")) || (isProductRecipes && can("factory_product_recipes.view")) || (isProduction && (can("factory_product_recipes.view") || can("factory_production.complete"))) || (isReports && can("factory_production_reports.view")),
    sops: (isProduction || isProductionSop) && can("factory_production_sop.view"),
  };
}

export const factoryService = {
  async listFactoryData({ scope = "dashboard", hasPermission } = {}) {
    const data = emptyFactoryData();
    const plan = factoryDataPlan(scope, hasPermission);
    const tasks = [];
    const addTask = (enabled, key, label, query, mapper) => {
      if (!enabled) return;
      tasks.push({ key, label, query, mapper });
    };

    addTask(plan.jobOrders, "jobOrders", "Job Orders", () => supabase
      .from("factory_job_orders")
      .select(jobOrderSelect)
      .order("planned_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapJobOrder));
    addTask(plan.rawMaterials, "rawMaterials", "Raw Materials", () => supabase
      .from("factory_raw_materials")
      .select(rawMaterialSelect)
      .order("name", { ascending: true })
      .limit(300), (rows) => rows.map(mapRawMaterial));
    addTask(plan.rawMaterialCategories, "rawMaterialCategories", "Raw Material Categories", () => supabase
      .from("factory_raw_material_categories")
      .select("id,name,description,status,created_at,updated_at")
      .order("name", { ascending: true })
      .limit(150), (rows) => rows.map(mapRawMaterialCategory));
    addTask(plan.storageLocations, "storageLocations", "Storage Locations", () => supabase
      .from("factory_storage_locations")
      .select(storageLocationSelect)
      .order("location_name", { ascending: true })
      .limit(200), (rows) => rows.map(mapStorageLocation));
    addTask(plan.rawMaterialMovements, "rawMaterialMovements", "Raw Material Movements", () => supabase
      .from("factory_raw_material_movements")
      .select(`id,raw_material_id,movement_type,quantity,uom,reference_type,reference_id,reference_no,movement_date,notes,created_by,created_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect})`)
      .order("movement_date", { ascending: false })
      .limit(200), (rows) => rows.map(mapRawMaterialMovement));
    addTask(plan.receivings, "receivings", "Raw Material Receiving", () => supabase
      .from("factory_raw_material_receivings")
      .select(`id,receipt_no,raw_material_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location,remarks,received_by,created_at,updated_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect})`)
      .order("received_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapReceiving));
    addTask(plan.productions, "productions", "Production Records", () => supabase
      .from("factory_productions")
      .select(plan.productionDetails ? productionSelectDetailed : productionSelectBasic)
      .order("production_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapProduction));
    addTask(plan.finishedGoods, "finishedGoods", "Finished Goods", () => supabase
      .from("factory_finished_goods")
      .select("id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,category_id,category,uom,current_balance,min_stock_level,storage_location_id,storage_location,status,remarks,created_at,updated_at,category_ref:factory_finished_good_categories(name),storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status)")
      .order("product_name", { ascending: true })
      .limit(300), (rows) => rows.map(mapFinishedGood));
    addTask(plan.finishedGoodCategories, "finishedGoodCategories", "Finished Good Categories", () => supabase
      .from("factory_finished_good_categories")
      .select("id,name,description,status,created_at,updated_at")
      .order("name", { ascending: true })
      .limit(150), (rows) => rows.map(mapFinishedGoodCategory));
    addTask(plan.productMovements, "productMovements", "Product Movements", () => supabase
      .from("factory_product_stock_movements")
      .select("id,finished_good_id,product_name,movement_type,quantity,uom,reference_type,reference_id,reference_no,movement_date,notes,created_by,created_at,finished_good:factory_finished_goods(product_name,uom)")
      .order("movement_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapProductMovement));
    addTask(plan.rawStockChecks, "rawStockChecks", "Raw Material Stock Check", () => supabase
      .from("factory_raw_material_stock_checks")
      .select(`id,check_no,check_date,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at,items:factory_raw_material_stock_check_items(id,stock_check_id,raw_material_id,system_qty,physical_qty,variance_qty,variance_percent,variance_status,variance_reason,uom,created_at,updated_at,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`)
      .order("check_date", { ascending: false })
      .limit(100), (rows) => rows.map((row) => mapStockCheck(row, "raw")));
    addTask(plan.productStockChecks, "productStockChecks", "Product Stock Check", () => supabase
      .from("factory_product_stock_checks")
      .select("id,check_no,check_date,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at,items:factory_product_stock_check_items(id,stock_check_id,finished_good_id,system_qty,physical_qty,variance_qty,variance_percent,variance_status,variance_reason,uom,created_at,updated_at,finished_good:factory_finished_goods(product_name,uom))")
      .order("check_date", { ascending: false })
      .limit(100), (rows) => rows.map((row) => mapStockCheck(row, "product")));
    addTask(plan.recipes, "recipes", "Product Recipes", () => supabase
      .from("factory_product_recipes")
      .select(`id,recipe_code,finished_good_id,recipe_name,product_name,version,yield_quantity,uom,status,notes,remarks,created_by,created_at,updated_at,finished_good:factory_finished_goods(${finishedGoodSelect}),items:factory_product_recipe_items(id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`)
      .order("product_name", { ascending: true })
      .limit(150), (rows) => rows.map(mapRecipe));
    addTask(plan.sops, "sops", "Production SOP", () => supabase
      .from("factory_production_sops")
      .select("id,sop_code,title,product_name,version,effective_date,equipment,status,notes,created_by,created_at,updated_at,steps:factory_production_sop_steps(id,sop_id,step_no,instruction,process_name,description,control_point,materials,equipment,expected_duration_minutes,estimated_time_minutes,is_qc_checkpoint,safety_note,created_at,updated_at)")
      .order("product_name", { ascending: true })
      .limit(150), (rows) => rows.map(mapProductionSop));

    const results = await Promise.allSettled(tasks.map((task) => task.query()));
    results.forEach((result, index) => {
      const task = tasks[index];
      if (result.status === "rejected") {
        data.accessIssues.push({ key: task.key, label: task.label, message: result.reason?.message || "Unable to load this Factory dataset." });
        return;
      }
      if (result.value.error) {
        data.accessIssues.push({ key: task.key, label: task.label, message: result.value.error.message || "Unable to load this Factory dataset." });
        return;
      }
      data[task.key] = task.mapper(result.value.data ?? []);
    });
    return data;
  },

  async saveJobOrder(order, employeeId) {
    const isUpdate = Boolean(order.id);
    let finishedGood = null;
    if (order.finished_good_id) {
      const { data, error } = await supabase
        .from("factory_finished_goods")
        .select("id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,uom,status")
        .eq("id", order.finished_good_id)
        .single();
      throwSupabaseError("factory.job_order.finished_good_lookup", error);
      finishedGood = data;
    }
    if (!finishedGood?.id) throw new Error("Select an active finished good product.");
    if (String(finishedGood.status || "").toLowerCase() !== "active") throw new Error("Archived Finished Goods cannot be selected.");

    if (isUpdate) {
      const { data: current, error: currentError } = await supabase
        .from("factory_job_orders")
        .select("id,status")
        .eq("id", order.id)
        .single();
      throwSupabaseError("factory.job_order.current", currentError);
      if (["completed", "cancelled"].includes(current?.status)) {
        const remarksPayload = {
          remarks: String(order.remarks || "").trim(),
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from("factory_job_orders")
          .update(remarksPayload)
          .eq("id", order.id)
          .select(jobOrderSelect)
          .single();
        throwSupabaseError("factory.job_order.remarks", error);
        await logFactoryAction({
          action: "factory_job_order_remarks_updated",
          target: data.job_order_no,
          description: "Factory job order remarks updated after closure.",
          after: data,
        });
        return mapJobOrder(data);
      }
    }

    const payload = {
      job_order_no: order.job_order_no || makeFactoryRef("JO"),
      finished_good_id: finishedGood.id,
      product_name: finishedGood.product_name,
      target_quantity: normalizeNumber(order.target_quantity),
      produced_quantity: normalizeNumber(order.produced_quantity),
      uom: order.uom || finishedGood.uom || "",
      planned_date: order.planned_date || null,
      due_date: order.due_date || null,
      priority: order.priority || "Normal",
      status: order.status || "draft",
      assigned_team: order.assigned_team || "",
      remarks: order.remarks || "",
      updated_at: new Date().toISOString(),
    };
    if (payload.target_quantity <= 0) throw new Error("Target quantity must be greater than 0.");
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_job_orders").update(payload).eq("id", order.id)
      : supabase.from("factory_job_orders").insert(payload);

    const { data, error } = await query
      .select(jobOrderSelect)
      .single();
    throwSupabaseError("factory.job_order.save", error);
    await logFactoryAction({
      action: isUpdate ? "factory_job_order_updated" : "factory_job_order_created",
      target: data.job_order_no,
      description: isUpdate ? "Factory job order updated." : "Factory job order created.",
      after: data,
    });
    return mapJobOrder(data);
  },

  async deleteJobOrder(order) {
    const { error } = await supabase.from("factory_job_orders").delete().eq("id", order.id);
    throwSupabaseError("factory.job_order.delete", error);
    await logFactoryAction({
      action: "factory_job_order_deleted",
      target: order.job_order_no || order.product_name,
      description: "Factory job order deleted.",
      before: order,
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
      raw_material_id: rawMaterialId,
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
      category_id: material.category_id || null,
      category: String(material.category || "").trim(),
      uom: String(material.uom || "").trim(),
      min_stock_level: normalizeNumber(material.min_stock_level),
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
      category_id: product.category_id || null,
      category: String(product.category || "").trim(),
      uom: product.uom || "",
      min_stock_level: normalizeNumber(product.min_stock_level),
      storage_location_id: product.storage_location_id || null,
      storage_location: storageLocationName || String(product.storage_location || "").trim(),
      status: product.status || "active",
      remarks: String(product.remarks || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!payload.product_name) throw new Error("Product name is required.");
    if (!payload.category_id) throw new Error("Category is required.");
    if (!payload.uom) throw new Error("UOM is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_finished_goods").update(payload).eq("id", product.id)
      : supabase.from("factory_finished_goods").insert(payload);

    const { data, error } = await query
      .select("id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,category_id,category,uom,current_balance,min_stock_level,storage_location_id,storage_location,status,remarks,created_at,updated_at,category_ref:factory_finished_good_categories(name),storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status)")
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

  async archiveFinishedGood(product) {
    if (normalizeNumber(product.current_balance) > 0) {
      throw new Error("Cannot archive while stock balance is greater than zero.");
    }
    const { data, error } = await supabase
      .from("factory_finished_goods")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", product.id)
      .select("id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,category_id,category,uom,current_balance,min_stock_level,storage_location_id,storage_location,status,remarks,created_at,updated_at,category_ref:factory_finished_good_categories(name),storage_location_ref:factory_storage_locations(location_name,location_code,location_type,status)")
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

    let finishedGood = null;
    if (recipe.finished_good_id) {
      const { data, error } = await supabase
        .from("factory_finished_goods")
        .select("id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,uom,status")
        .eq("id", recipe.finished_good_id)
        .single();
      throwSupabaseError("factory.recipe.finished_good_lookup", error);
      finishedGood = data;
    }
    if (!finishedGood?.id) throw new Error("Select an active finished good product.");
    if (String(finishedGood.status || "").toLowerCase() !== "active") throw new Error("Archived Finished Goods cannot be selected.");

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
    if (normalizeNumber(recipe.yield_quantity) <= 0) throw new Error("Expected yield quantity must be greater than 0.");
    if (!String(recipe.uom || "").trim()) throw new Error("Yield UOM is required.");
    if (!items.length) throw new Error("At least one recipe material row is required.");
    const invalidItem = items.find((item) => !item.raw_material_id || item.quantity_used <= 0);
    if (invalidItem) throw new Error("Every recipe material row needs a raw material and standard quantity greater than 0.");

    const payload = {
      recipe_code: recipe.recipe_code || makeFactoryRef("FGRCP"),
      finished_good_id: finishedGood.id,
      recipe_name: String(recipe.recipe_name || "").trim(),
      product_name: finishedGood.product_name,
      version: String(recipe.version || "v1").trim(),
      yield_quantity: normalizeNumber(recipe.yield_quantity),
      uom: String(recipe.uom || finishedGood.uom || "").trim(),
      status: recipe.status === "active" ? "active" : recipe.status === "archived" ? "archived" : "draft",
      notes: String(recipe.remarks || recipe.notes || "").trim(),
      remarks: String(recipe.remarks || recipe.notes || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!isUpdate) payload.created_by = employeeId || null;

    if (payload.status === "active") {
      const { data: activeRecipe, error: activeError } = await supabase
        .from("factory_product_recipes")
        .select("id")
        .eq("finished_good_id", finishedGood.id)
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
      .select("id,recipe_code,finished_good_id,recipe_name,product_name,version,yield_quantity,uom,status,notes,remarks,created_by,created_at,updated_at")
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
      .select(`id,recipe_code,finished_good_id,recipe_name,product_name,version,yield_quantity,uom,status,notes,remarks,created_by,created_at,updated_at,finished_good:factory_finished_goods(${finishedGoodSelect}),items:factory_product_recipe_items(id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`)
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
    const { data, error } = await supabase
      .from("factory_product_recipes")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", recipe.id)
      .select(`id,recipe_code,finished_good_id,recipe_name,product_name,version,yield_quantity,uom,status,notes,remarks,created_by,created_at,updated_at,finished_good:factory_finished_goods(${finishedGoodSelect}),items:factory_product_recipe_items(id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`)
      .single();
    throwSupabaseError("factory.recipe.activate", error);
    await logFactoryAction({
      action: "factory_product_recipe_activated",
      target: data.recipe_code,
      description: "Factory Product Recipe activated.",
      after: data,
    });
    return mapRecipe(data);
  },

  async archiveProductRecipe(recipe) {
    const { data, error } = await supabase
      .from("factory_product_recipes")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", recipe.id)
      .select(`id,recipe_code,finished_good_id,recipe_name,product_name,version,yield_quantity,uom,status,notes,remarks,created_by,created_at,updated_at,finished_good:factory_finished_goods(${finishedGoodSelect}),items:factory_product_recipe_items(id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,raw_material:factory_raw_materials(${rawMaterialRelationSelect}))`)
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

  async completeProduction(production, employeeId) {
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
    const { data: productionId, error } = await supabase.rpc("factory_complete_production", {
      p_job_order_id: production.job_order_id || null,
      p_finished_good_id: production.finished_good_id || null,
      p_production_no: productionNo,
      p_product_name: String(production.product_name || "").trim(),
      p_batch_no: production.batch_no || "",
      p_production_date: production.production_date || new Date().toISOString().slice(0, 10),
      p_operator_id: production.operator_id || employeeId || null,
      p_operator_name: production.operator_name || "",
      p_start_time: production.start_time || null,
      p_end_time: production.end_time || null,
      p_actual_produced_qty: normalizeNumber(production.actual_produced_qty),
      p_good_output_qty: normalizeNumber(production.good_output_qty),
      p_wastage_qty: normalizeNumber(production.wastage_qty),
      p_uom: production.uom || "",
      p_qc_status: production.qc_status || "Pending",
      p_production_sop_id: production.production_sop_id || null,
      p_sop_version: production.sop_version || "",
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

  async saveProductionSop(sop, employeeId) {
    const isUpdate = Boolean(sop.id);
    const steps = (sop.steps ?? [])
      .map((step, index) => ({
        step_no: normalizeNumber(step.step_no, index + 1),
        process_name: String(step.process_name || "").trim(),
        description: String(step.description || "").trim(),
        control_point: String(step.control_point || "").trim(),
        materials: String(step.materials || "").trim(),
        equipment: String(step.equipment || "").trim(),
        estimated_time_minutes: normalizeNumber(step.estimated_time_minutes),
        is_qc_checkpoint: Boolean(step.is_qc_checkpoint),
        safety_note: String(step.safety_note || "").trim(),
      }))
      .filter((step) => step.process_name || step.description);

    if (!String(sop.title || "").trim()) throw new Error("SOP title is required.");
    if (!String(sop.product_name || "").trim()) throw new Error("Product name is required.");
    if (!steps.length) throw new Error("At least one SOP step is required.");

    const payload = {
      sop_code: sop.sop_code || makeFactoryRef("SOP"),
      title: String(sop.title || "").trim(),
      product_name: String(sop.product_name || "").trim(),
      version: String(sop.version || "v1").trim(),
      effective_date: sop.effective_date || null,
      equipment: String(sop.equipment || "").trim(),
      status: sop.status || "active",
      notes: String(sop.notes || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_production_sops").update(payload).eq("id", sop.id)
      : supabase.from("factory_production_sops").insert(payload);

    const { data, error } = await query
      .select("id,sop_code,title,product_name,version,effective_date,equipment,status,notes,created_by,created_at,updated_at")
      .single();
    throwSupabaseError("factory.sop.save", error);

    if (isUpdate) {
      const deleteResult = await supabase.from("factory_production_sop_steps").delete().eq("sop_id", data.id);
      throwSupabaseError("factory.sop.steps_delete", deleteResult.error);
    }

    const insertResult = await supabase.from("factory_production_sop_steps").insert(steps.map((step) => ({
      sop_id: data.id,
      step_no: step.step_no,
      instruction: step.description || step.process_name,
      process_name: step.process_name,
      description: step.description,
      control_point: step.control_point,
      materials: step.materials,
      equipment: step.equipment,
      expected_duration_minutes: step.estimated_time_minutes,
      estimated_time_minutes: step.estimated_time_minutes,
      is_qc_checkpoint: step.is_qc_checkpoint,
      safety_note: step.safety_note,
      updated_at: new Date().toISOString(),
    })));
    throwSupabaseError("factory.sop.steps_insert", insertResult.error);

    const { data: saved, error: fetchError } = await supabase
      .from("factory_production_sops")
      .select("id,sop_code,title,product_name,version,effective_date,equipment,status,notes,created_by,created_at,updated_at,steps:factory_production_sop_steps(id,sop_id,step_no,instruction,process_name,description,control_point,materials,equipment,expected_duration_minutes,estimated_time_minutes,is_qc_checkpoint,safety_note,created_at,updated_at)")
      .eq("id", data.id)
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
      const variance = stockCheckVariance(item.system_qty, item.physical_qty);
      return {
        itemId,
        [itemIdColumn]: itemId,
        system_qty: normalizeNumber(item.system_qty),
        physical_qty: normalizeNumber(item.physical_qty),
        variance_qty: Number(variance.varianceQty.toFixed(4)),
        variance_percent: Number(variance.variancePercent.toFixed(4)),
        variance_status: variance.varianceStatus,
        variance_reason: item.variance_reason || "",
        uom: item.uom || "",
      };
    });
    validateStockCheckItems(items);

    const payload = {
      check_no: stockCheck.check_no || makeFactoryRef(refPrefix),
      check_date: stockCheck.check_date || new Date().toISOString().slice(0, 10),
      status,
      notes: stockCheck.notes || "",
      updated_at: new Date().toISOString(),
    };
    if (!isUpdate) payload.created_by = employeeId || null;
    if (status === "submitted") {
      payload.submitted_by = employeeId || null;
      payload.submitted_at = new Date().toISOString();
    }

    const query = isUpdate
      ? supabase.from(table).update(payload).eq("id", stockCheck.id)
      : supabase.from(table).insert(payload);
    const { data, error } = await query
      .select("id,check_no,check_date,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at")
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
