import { readCompleteInventoryRows } from '../../../../services/inventoryCompleteRead.js';
import { inventoryLifecycleService } from '../../../../services/inventoryLifecycleService.js';
import { isPurchaseOrderReference } from '../purchaseOrders/inventoryPurchaseOrderHelpers.js';
import { canonical, isUuid, mapRemoteInventoryItem } from '../inventoryItemModel.js';
import { normalizeBusinessDate } from '../waste/inventoryWasteService.js';

export function toTitle(value = '') { return String(value).replace(/_/g, ' ').replace(/\b\w/g, match => match.toUpperCase()); }
const businessDateToTimestamp = value => `${normalizeBusinessDate(value)}T12:00:00.000Z`;

export function mapRemoteInventoryMovement(row = {}) {
  return {
    id: row.id,
    date: normalizeBusinessDate(row.movement_date || row.created_at),
    dateTime: row.created_at || "",
    itemId: row.inventory_item_id || row.item_id || "",
    type: String(row.movement_type || "purchase").toLowerCase(),
    movementType: row.movement_type || "Purchase",
    quantity: row.quantity === null || row.quantity === undefined ? 0 : Number(row.quantity),
    unit: row.unit || "",
    outletId: row.outlet_id || "",
    user: row.created_by || "",
    createdBy: row.created_by || "",
    reference: row.reference_no || "",
    referenceType: row.reference_type || "",
    referenceId: row.reference_id || "",
    notes: row.notes || "",
  };
}


export async function persistRemoteInventoryMovement(movement = {}, userId) {
  if (!isUuid(movement.outletId)) throw new Error("Outlet is required.");
  if (!isUuid(movement.itemId)) throw new Error("Inventory item is required.");
  const timestamp = movement.date ? businessDateToTimestamp(movement.date) : new Date().toISOString();
  const movementType = toTitle(movement.type || movement.movementType || "adjustment");
  let quantity = Number(movement.quantity || 0);
  const movementKey = canonical(movementType);
  if (movementKey === "purchase") quantity = Math.abs(quantity);
  if (movementKey === "waste") quantity = -Math.abs(quantity);
  if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Quantity is required.");
  const payload = {
    outlet_id: movement.outletId,
    inventory_item_id: movement.itemId,
    movement_type: movementType,
    quantity,
    unit: movement.unit || null,
    reference_type: movement.referenceType || "manual",
    reference_id: isUuid(movement.referenceId) ? movement.referenceId : null,
    reference_no: movement.reference || movement.referenceNo || null,
    notes: movement.notes || null,
    created_by: userId || null,
    created_at: timestamp,
  };
  const rpcResult = await inventoryLifecycleService.saveInventoryMovement({ movement: payload });
  return mapRemoteInventoryMovement(rpcResult.movement || {});
}

export function canEditInventoryMovement(movement = {}) {
  if (isPurchaseOrderReference(movement)) return false;
  const type = canonical(movement.movementType || movement.type || "");
  return type === "waste" || type === "adjustment" || type.includes("transfer");
}

function movementEditPayload(movement = {}) {
  if (!isUuid(movement.outletId)) throw new Error("Outlet is required.");
  if (!isUuid(movement.itemId)) throw new Error("Inventory item is required.");
  const movementType = toTitle(movement.type || movement.movementType || "adjustment");
  let quantity = Number(movement.quantity || 0);
  const movementKey = canonical(movementType);
  if (movementKey === "purchase") quantity = Math.abs(quantity);
  if (movementKey === "waste") quantity = -Math.abs(quantity);
  if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Quantity is required.");
  return {
    outlet_id: movement.outletId,
    inventory_item_id: movement.itemId,
    movement_type: movementType,
    quantity,
    unit: movement.unit || null,
    reference_type: movement.referenceType || "manual",
    reference_id: isUuid(movement.referenceId) ? movement.referenceId : null,
    reference_no: movement.reference || movement.referenceNo || null,
    notes: movement.notes || null,
  };
}

export async function persistRemoteInventoryMovementUpdate(movement = {}, userId) {
  if (!isUuid(movement.id)) throw new Error("Movement record is required.");
  if (!canEditInventoryMovement(movement)) throw new Error("Purchase receiving movements are read-only.");
  const payload = movementEditPayload(movement);
  const rpcResult = await inventoryLifecycleService.saveInventoryMovement({ movement: { id: movement.id, ...payload } });
  return mapRemoteInventoryMovement(rpcResult.movement || {});
}



export async function loadInventoryMovements(outletIds) {
  if (!outletIds.length) throw new Error('No accessible outlet.');
  const [movements, items, people] = await Promise.all([
    readCompleteInventoryRows('inventory_movements', { in: { outlet_id: outletIds }, order: 'created_at', ascending: false }),
    readCompleteInventoryRows('inventory_items'),
    readCompleteInventoryRows('employees', { select: 'id,auth_user_id,full_name,nickname,email' }),
  ]);
  return { movements: movements.data.map(mapRemoteInventoryMovement), items: items.data.map(row => mapRemoteInventoryItem(row)), people: people.data };
}

// Legacy references resolve on demand; no PO bootstrap or detail duplication.
export async function resolveMovementPurchaseOrder(movement) {
  if (isUuid(movement.referenceId)) return movement.referenceId;
  if (!movement.reference) throw new Error('No linked purchase order identity.');
  const results = await Promise.all(['business_po_no', 'po_no'].map(field => readCompleteInventoryRows('inventory_purchase_orders', { select: 'id', eq: { [field]: movement.reference } })));
  const ids = [...new Set(results.flatMap(result => result.data.map(row => row.id)))];
  if (ids.length !== 1) throw new Error('Purchase order reference is unavailable or ambiguous.');
  return ids[0];
}

export async function loadTransferReference(reference, outletIds) {
  if (!reference || !outletIds.length) return [];
  const result = await readCompleteInventoryRows('inventory_movements', { eq: { reference_no: reference }, in: { outlet_id: outletIds } });
  return result.data.map(mapRemoteInventoryMovement);
}
