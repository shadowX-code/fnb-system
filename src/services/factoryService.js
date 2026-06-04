import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function mapJobOrder(row) {
  return {
    id: row.id,
    job_order_no: row.job_order_no,
    product_name: row.product_name,
    target_quantity: normalizeNumber(row.target_quantity),
    produced_quantity: normalizeNumber(row.produced_quantity),
    uom: row.uom || "",
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
  return {
    id: row.id,
    material_code: row.material_code || "",
    name: row.name,
    category: row.category || "",
    uom: row.uom || "",
    current_balance: normalizeNumber(row.current_balance),
    min_stock_level: normalizeNumber(row.min_stock_level),
    storage_location: row.storage_location || "",
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
    raw_material_name: row.raw_material?.name || row.raw_material_name || "",
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

function mapProductionUsage(row) {
  return {
    id: row.id,
    production_id: row.production_id,
    raw_material_id: row.raw_material_id,
    raw_material_receiving_id: row.raw_material_receiving_id || "",
    raw_material_name: row.raw_material?.name || "",
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
    production_no: row.production_no || "",
    product_name: row.product_name || "",
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
  return {
    id: row.id,
    product_code: row.product_code || "",
    product_name: row.product_name || "",
    category_id: row.category_id || "",
    category: row.category_ref?.name || row.category || "",
    uom: row.uom || "",
    current_balance: normalizeNumber(row.current_balance),
    min_stock_level: normalizeNumber(row.min_stock_level),
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
  return {
    id: row.id,
    recipe_code: row.recipe_code || "",
    product_name: row.product_name || "",
    yield_quantity: normalizeNumber(row.yield_quantity, 1),
    uom: row.uom || "",
    status: row.status || "active",
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      raw_material_id: item.raw_material_id,
      raw_material_name: item.raw_material?.name || "",
      quantity_used: normalizeNumber(item.quantity_used),
      uom: item.uom || item.raw_material?.uom || "",
      wastage_percent: normalizeNumber(item.wastage_percent),
      notes: item.notes || "",
    })),
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
  if (receiving.raw_material_id) return receiving.raw_material_id;
  const name = String(receiving.raw_material_name || receiving.material_name || "").trim();
  if (!name) throw new Error("Raw material name is required.");

  const { data: existing, error: lookupError } = await supabase
    .from("factory_raw_materials")
    .select("id")
    .ilike("name", name)
    .maybeSingle();
  throwSupabaseError("factory.raw_material.lookup", lookupError);
  if (existing?.id) return existing.id;

  const payload = {
    name,
    uom: receiving.uom || "",
    category: receiving.category || "",
    storage_location: receiving.storage_location || "",
    status: "active",
    current_balance: 0,
    min_stock_level: 0,
  };
  const { data, error } = await supabase
    .from("factory_raw_materials")
    .insert(payload)
    .select("id,name,category,uom,current_balance,min_stock_level,storage_location,status,created_at,updated_at")
    .single();
  throwSupabaseError("factory.raw_material.create", error);
  await logFactoryAction({
    action: "factory_raw_material_created",
    target: data.name,
    description: "Factory raw material created from receiving.",
    after: data,
  });
  return data.id;
}

function emptyFactoryData() {
  return {
    jobOrders: [],
    rawMaterials: [],
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

const productionSelectBasic = "id,job_order_id,production_no,product_name,batch_no,produced_quantity,actual_produced_qty,good_output_qty,wastage_qty,uom,production_date,operator_id,operator_name,start_time,end_time,qc_status,production_sop_id,sop_version,status,notes,created_by,completed_at,created_at,updated_at";
const productionSelectDetailed = `${productionSelectBasic},material_usage:factory_production_material_usage(id,production_id,raw_material_id,raw_material_receiving_id,raw_material_lot_no,quantity_used,standard_usage,actual_usage,variance_qty,variance_percent,variance_reason,uom,wastage_quantity,notes,created_at,updated_at,raw_material:factory_raw_materials(name,uom),raw_receiving:factory_raw_material_receivings(receipt_no,batch_no,supplier_name,received_date,unit_cost)),qc_checkpoints:factory_production_qc_checkpoints(id,production_id,production_sop_id,sop_step_id,step_no,process_name,control_point,qc_status,notes,created_at,updated_at)`;

function factoryDataPlan(scope, hasPermission) {
  const can = (code) => !hasPermission || hasPermission(code);
  const isDashboard = scope === "dashboard";
  const isJobOrders = scope === "job-orders";
  const isRawReceiving = scope === "raw-receiving";
  const isRawStockCheck = scope === "raw-stock-check";
  const isProduction = scope === "production";
  const isReports = scope === "reports";
  const isBatchTraceability = scope === "batch-traceability";
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
    rawMaterials: (isDashboard && can("factory_dashboard.view")) || (isRawReceiving && can("factory_raw_receiving.view")) || (isRawStockCheck && can("factory_raw_stock_check.view")) || (isProduction && (can("factory_raw_inventory.view") || can("factory_product_recipes.view") || can("factory_dashboard.view"))),
    receivings: (isDashboard && can("factory_dashboard.view")) || (isRawReceiving && can("factory_raw_receiving.view")) || (isReports && can("factory_production_reports.view")) || ((isProduction || isBatchTraceability) && can("factory_raw_receiving.view")),
    productions: needsProductionSummary && (can("factory_dashboard.view") || can("factory_production.view") || canReadProductionReports || can("factory_finished_goods.view") || can("factory_product_movements.view")),
    productionDetails: needsProductionDetails,
    finishedGoods: (isDashboard && can("factory_dashboard.view")) || ((isProduction || isFinishedGoods || isProductMovements) && can("factory_finished_goods.view")) || (isProduction && can("factory_production.complete")) || (isProductStockCheck && can("factory_product_stock_check.view")),
    finishedGoodCategories: isFinishedGoods && can("factory_finished_goods.view"),
    productMovements: (isDashboard && can("factory_dashboard.view")) || ((isProduction || isProductMovements) && can("factory_product_movements.view")) || (isFinishedGoods && can("factory_finished_goods.view")) || (isReports && can("factory_product_movements.view")) || (isBatchTraceability && canTraceBatches),
    rawStockChecks: isRawStockCheck && can("factory_raw_stock_check.view"),
    productStockChecks: isProductStockCheck && can("factory_product_stock_check.view"),
    recipes: (isDashboard && can("factory_dashboard.view")) || (isProduction && can("factory_product_recipes.view")) || (isReports && can("factory_production_reports.view")),
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
      .select("id,job_order_no,product_name,target_quantity,produced_quantity,uom,planned_date,due_date,priority,status,assigned_team,remarks,created_by,created_at,updated_at")
      .order("planned_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapJobOrder));
    addTask(plan.rawMaterials, "rawMaterials", "Raw Materials", () => supabase
      .from("factory_raw_materials")
      .select("id,material_code,name,category,uom,current_balance,min_stock_level,storage_location,status,created_at,updated_at")
      .order("name", { ascending: true })
      .limit(300), (rows) => rows.map(mapRawMaterial));
    addTask(plan.receivings, "receivings", "Raw Material Receiving", () => supabase
      .from("factory_raw_material_receivings")
      .select("id,receipt_no,raw_material_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location,remarks,received_by,created_at,updated_at,raw_material:factory_raw_materials(name,uom)")
      .order("received_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapReceiving));
    addTask(plan.productions, "productions", "Production Records", () => supabase
      .from("factory_productions")
      .select(plan.productionDetails ? productionSelectDetailed : productionSelectBasic)
      .order("production_date", { ascending: false })
      .limit(150), (rows) => rows.map(mapProduction));
    addTask(plan.finishedGoods, "finishedGoods", "Finished Goods", () => supabase
      .from("factory_finished_goods")
      .select("id,product_code,product_name,category_id,category,uom,current_balance,min_stock_level,status,remarks,created_at,updated_at,category_ref:factory_finished_good_categories(name)")
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
      .select("id,check_no,check_date,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at,items:factory_raw_material_stock_check_items(id,stock_check_id,raw_material_id,system_qty,physical_qty,variance_qty,variance_percent,variance_status,variance_reason,uom,created_at,updated_at,raw_material:factory_raw_materials(name,uom))")
      .order("check_date", { ascending: false })
      .limit(100), (rows) => rows.map((row) => mapStockCheck(row, "raw")));
    addTask(plan.productStockChecks, "productStockChecks", "Product Stock Check", () => supabase
      .from("factory_product_stock_checks")
      .select("id,check_no,check_date,status,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,created_at,updated_at,items:factory_product_stock_check_items(id,stock_check_id,finished_good_id,system_qty,physical_qty,variance_qty,variance_percent,variance_status,variance_reason,uom,created_at,updated_at,finished_good:factory_finished_goods(product_name,uom))")
      .order("check_date", { ascending: false })
      .limit(100), (rows) => rows.map((row) => mapStockCheck(row, "product")));
    addTask(plan.recipes, "recipes", "Product Recipes", () => supabase
      .from("factory_product_recipes")
      .select("id,recipe_code,product_name,yield_quantity,uom,status,items:factory_product_recipe_items(id,raw_material_id,quantity_used,uom,wastage_percent,notes,raw_material:factory_raw_materials(name,uom))")
      .eq("status", "active")
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
    const payload = {
      job_order_no: order.job_order_no || makeFactoryRef("JO"),
      product_name: String(order.product_name || "").trim(),
      target_quantity: normalizeNumber(order.target_quantity),
      produced_quantity: normalizeNumber(order.produced_quantity),
      uom: order.uom || "",
      planned_date: order.planned_date || null,
      due_date: order.due_date || null,
      priority: order.priority || "Normal",
      status: order.status || "draft",
      assigned_team: order.assigned_team || "",
      remarks: order.remarks || "",
      updated_at: new Date().toISOString(),
    };
    if (!payload.product_name) throw new Error("Product name is required.");
    if (payload.target_quantity <= 0) throw new Error("Target quantity must be greater than 0.");
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_job_orders").update(payload).eq("id", order.id)
      : supabase.from("factory_job_orders").insert(payload);

    const { data, error } = await query
      .select("id,job_order_no,product_name,target_quantity,produced_quantity,uom,planned_date,due_date,priority,status,assigned_team,remarks,created_by,created_at,updated_at")
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
      uom: receiving.uom || "",
      unit_cost: unitCost,
      total_cost: qty * unitCost,
      invoice_no: receiving.invoice_no || "",
      received_date: receiving.received_date || new Date().toISOString().slice(0, 10),
      expiry_date: receiving.expiry_date || null,
      storage_location: receiving.storage_location || "",
      remarks: receiving.remarks || "",
      received_by: employeeId || null,
      updated_at: new Date().toISOString(),
    };

    const query = isUpdate
      ? supabase.from("factory_raw_material_receivings").update(payload).eq("id", receiving.id)
      : supabase.from("factory_raw_material_receivings").insert(payload);

    const { data, error } = await query
      .select("id,receipt_no,raw_material_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location,remarks,received_by,created_at,updated_at,raw_material:factory_raw_materials(name,uom)")
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
    const payload = {
      product_code: String(product.product_code || "").trim() || null,
      product_name: String(product.product_name || "").trim(),
      category_id: product.category_id || null,
      category: String(product.category || "").trim(),
      uom: product.uom || "",
      min_stock_level: normalizeNumber(product.min_stock_level),
      status: product.status || "active",
      remarks: String(product.remarks || "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (!payload.product_name) throw new Error("Product name is required.");
    if (!payload.uom) throw new Error("UOM is required.");
    if (!["active", "archived"].includes(payload.status)) payload.status = "active";
    if (!isUpdate) payload.created_by = employeeId || null;

    const query = isUpdate
      ? supabase.from("factory_finished_goods").update(payload).eq("id", product.id)
      : supabase.from("factory_finished_goods").insert(payload);

    const { data, error } = await query
      .select("id,product_code,product_name,category_id,category,uom,current_balance,min_stock_level,status,remarks,created_at,updated_at,category_ref:factory_finished_good_categories(name)")
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
    const { data, error } = await supabase
      .from("factory_finished_goods")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", product.id)
      .select("id,product_code,product_name,category_id,category,uom,current_balance,min_stock_level,status,remarks,created_at,updated_at,category_ref:factory_finished_good_categories(name)")
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
      .select("id,job_order_id,production_no,product_name,batch_no,produced_quantity,actual_produced_qty,good_output_qty,wastage_qty,uom,production_date,operator_id,operator_name,start_time,end_time,qc_status,production_sop_id,sop_version,status,notes,created_by,completed_at,created_at,updated_at,production_sop:factory_production_sops(sop_code,title,version),material_usage:factory_production_material_usage(id,production_id,raw_material_id,raw_material_receiving_id,raw_material_lot_no,quantity_used,standard_usage,actual_usage,variance_qty,variance_percent,variance_reason,uom,wastage_quantity,notes,created_at,updated_at,raw_material:factory_raw_materials(name,uom),raw_receiving:factory_raw_material_receivings(receipt_no,batch_no,supplier_name,received_date)),qc_checkpoints:factory_production_qc_checkpoints(id,production_id,production_sop_id,sop_step_id,step_no,process_name,control_point,qc_status,notes,created_at,updated_at)")
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
