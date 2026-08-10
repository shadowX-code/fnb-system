import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requireUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""))) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

async function call(scope, rpc, payload) {
  const { data, error } = await supabase.rpc(rpc, payload);
  throwSupabaseError(scope, error);
  return data || {};
}

export const inventoryLifecycleService = {
  async saveInventoryMovement({ movement, requestId: suppliedRequestId }) {
    return call("inventory.movement.save", "inventory_save_manual_movement", {
      p_request_id: suppliedRequestId || requestId(),
      p_movement: movement,
    });
  },

  async saveInventoryRecipe({ recipe, requestId: suppliedRequestId }) {
    return call("inventory.recipe.save", "inventory_save_recipe", {
      p_request_id: suppliedRequestId || requestId(),
      p_recipe: recipe,
      p_items: recipe.ingredients || recipe.items || [],
    });
  },

  async saveInventoryStockCheck({ check, items, requestId: suppliedRequestId }) {
    return call("inventory.stock_check.save", "inventory_save_stock_check", {
      p_request_id: suppliedRequestId || requestId(),
      p_check: check,
      p_items: items,
    });
  },

  async savePurchaseOrder({ order, requestId: suppliedRequestId }) {
    return call("inventory.purchase_order.save", "inventory_save_purchase_order", {
      p_request_id: suppliedRequestId || requestId(),
      p_order: order,
      p_items: order.lines || [],
    });
  },

  async receivePurchaseOrder({ order, rows, receiptRemark, requestId: suppliedRequestId }) {
    requireUuid(order?.id, "Purchase order");
    const request_id = suppliedRequestId || requestId();
    const items = (rows || []).filter((row) => Number(row.receiveNowQty || 0) > 0).map((row) => ({
      purchase_order_item_id: requireUuid(row.id, "Purchase order item"),
      item_id: requireUuid(row.itemId, "Inventory item"),
      received_qty: Number(row.receiveNowQty || 0),
      unit: row.unit || null,
      remark: row.receiveRemark || null,
    }));
    if (!items.length) throw new Error("Enter received quantity for at least one item.");
    return call("inventory.purchase_order.receive", "inventory_receive_purchase_order", {
      p_purchase_order_id: order.id,
      p_request_id: request_id,
      p_remark: receiptRemark || null,
      p_items: items,
    });
  },

  async saveInventoryWaste({ waste, requestId: suppliedRequestId }) {
    const request_id = suppliedRequestId || requestId();
    return call("inventory.waste.save", "inventory_save_waste", {
      p_request_id: request_id,
      p_outlet_id: requireUuid(waste?.outletId, "Outlet"),
      p_inventory_item_id: requireUuid(waste?.itemId, "Inventory item"),
      p_waste_type: waste.wasteType || "Unknown",
      p_quantity: Number(waste.quantity || 0),
      p_unit: waste.unit || null,
      p_waste_date: waste.date || waste.wasteDate || null,
      p_notes: waste.notes || null,
      p_photo_url: waste.photoUrl || waste.photo_url || null,
    });
  },

  async transferInventory({ movement, requestId: suppliedRequestId }) {
    const request_id = suppliedRequestId || requestId();
    return call("inventory.transfer.save", "inventory_transfer_inventory", {
      p_request_id: request_id,
      p_from_outlet_id: requireUuid(movement?.fromOutletId, "Source outlet"),
      p_to_outlet_id: requireUuid(movement?.toOutletId, "Destination outlet"),
      p_inventory_item_id: requireUuid(movement?.itemId, "Inventory item"),
      p_quantity: Number(movement.quantity || 0),
      p_unit: movement.unit || null,
      p_reference_no: movement.reference || null,
      p_notes: movement.notes || null,
      p_outgoing_movement_id: movement.id || null,
      p_incoming_movement_id: movement.pairMovementId || null,
    });
  },
};
