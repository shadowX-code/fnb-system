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

function makeFactoryRef(prefix) {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
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

export const factoryService = {
  async listFactoryData() {
    const [jobOrdersResult, materialsResult, receivingResult] = await Promise.all([
      supabase
        .from("factory_job_orders")
        .select("id,job_order_no,product_name,target_quantity,produced_quantity,uom,planned_date,due_date,priority,status,assigned_team,remarks,created_by,created_at,updated_at")
        .order("planned_date", { ascending: false })
        .limit(150),
      supabase
        .from("factory_raw_materials")
        .select("id,material_code,name,category,uom,current_balance,min_stock_level,storage_location,status,created_at,updated_at")
        .order("name", { ascending: true })
        .limit(300),
      supabase
        .from("factory_raw_material_receivings")
        .select("id,receipt_no,raw_material_id,supplier_name,batch_no,received_qty,uom,unit_cost,total_cost,invoice_no,received_date,expiry_date,storage_location,remarks,received_by,created_at,updated_at,raw_material:factory_raw_materials(name,uom)")
        .order("received_date", { ascending: false })
        .limit(150),
    ]);

    throwSupabaseError("factory.job_orders.list", jobOrdersResult.error);
    throwSupabaseError("factory.raw_materials.list", materialsResult.error);
    throwSupabaseError("factory.receivings.list", receivingResult.error);

    return {
      jobOrders: (jobOrdersResult.data ?? []).map(mapJobOrder),
      rawMaterials: (materialsResult.data ?? []).map(mapRawMaterial),
      receivings: (receivingResult.data ?? []).map(mapReceiving),
    };
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
};
