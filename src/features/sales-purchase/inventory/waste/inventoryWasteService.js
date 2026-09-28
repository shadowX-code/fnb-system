import { readCompleteInventoryRows } from '../../../../services/inventoryCompleteRead.js';
import { inventoryLifecycleService } from '../../../../services/inventoryLifecycleService.js';
import { uploadOptimizedImage } from '../../../../utils/imageUpload.js';
export function toDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getBusinessDateInput(timeZone = "Asia/Kuala_Lumpur", value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (byType.year && byType.month && byType.day) return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    // Fall back to browser local date if the requested timezone is unavailable.
  }
  return toDateInputValue(date);
}

export function todayInput(timeZone = "Asia/Kuala_Lumpur") {
  return getBusinessDateInput(timeZone);
}

export function normalizeBusinessDate(value, fallback = todayInput()) {
  if (value instanceof Date) return toDateInputValue(value) || fallback;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  return toDateInputValue(raw) || fallback;
}

export function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

export function outletDisplayCode(outlet = {}) {
  const normalized = outlet;
  return normalized.code || normalized.name || normalized.id || "Outlet";
}

export function employeeDisplayName(employee = {}) {
  return employee.nickname || employee.full_name || employee.fullName || employee.name || employee.email || "Unknown User";
}

export function parseNonNegativeNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return Math.max(0, parsed);
}

export function mapRemoteWasteRecord(row = {}) {
  return {
    id: row.id,
    date: normalizeBusinessDate(row.waste_date || row.created_at),
    itemId: row.inventory_item_id || "",
    outletId: row.outlet_id || "",
    wasteType: row.waste_type || "Unknown",
    quantity: row.quantity === null || row.quantity === undefined ? 0 : Number(row.quantity),
    unit: row.unit || "",
    notes: row.notes || "",
    photoUrl: row.photo_url || "",
    photo_url: row.photo_url || "",
    user: row.created_by || "",
    recordedBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
    value: 0,
  };
}

export async function persistRemoteWasteRecord(waste = {}) {
  return inventoryLifecycleService.saveInventoryWaste({ waste: { ...waste, date: normalizeBusinessDate(waste.date || waste.wasteDate) } });
}
export async function saveWasteWithEvidence(waste) {
  let evidenceUrl = waste.photoUrl || waste.photo_url || '';
  if (typeof File !== 'undefined' && waste.photoFile instanceof File) {
    const path = `waste_evidence/${waste.id || 'draft'}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.webp`;
    const upload = await uploadOptimizedImage(waste.photoFile, { bucket: 'inventory-item-photos', path, previousPublicUrl: waste.previousPhotoUrl || waste.previous_photo_url || '' });
    evidenceUrl = upload.publicUrl;
  }
  return persistRemoteWasteRecord({ ...waste, photoUrl: evidenceUrl, photo_url: evidenceUrl });
}

export async function loadInventoryWaste({ outletId, wasteId } = {}) {
  const scope = outletId ? { outlet_id: outletId } : {};
  const [waste, movements, items, categories, links, people] = await Promise.all([
    readCompleteInventoryRows('inventory_waste_records', { order: 'waste_date', ascending: false, eq: { ...scope, ...(wasteId ? { id: wasteId } : {}) } }),
    readCompleteInventoryRows('inventory_movements', { order: 'created_at', ascending: false, eq: { ...scope, reference_type: 'waste', ...(wasteId ? { reference_id: wasteId } : {}) } }),
    readCompleteInventoryRows('inventory_items', { select: 'id,item_name,sku_code,category_id,unit,status', order: 'created_at', ascending: false }),
    readCompleteInventoryRows('inventory_categories', { order: 'sort_order' }),
    readCompleteInventoryRows('inventory_item_outlets', { eq: scope }),
    readCompleteInventoryRows('employees', { select: 'id,auth_user_id,full_name,nickname,email' }),
  ]);
  return {
    wasteRecords: waste.data.map(mapRemoteWasteRecord),
    movements: movements.data.map(row => ({ id: row.id, referenceType: row.reference_type, referenceId: row.reference_id, reference: row.reference_no || '' })),
    items: items.data.map(row => ({ id: row.id, name: row.item_name || 'Inventory item', sku: row.sku_code || '', categoryId: row.category_id || '', unit: row.unit || '', status: row.status || 'active', linkedOutletIds: links.data.filter(link => link.inventory_item_id === row.id).map(link => link.outlet_id) })),
    categories: categories.data,
    people: people.data,
  };
}
