import { supabase } from "../../../../lib/supabase";
import { throwSupabaseError } from "../../../../services/supabaseError.js";
import { readCompleteInventoryRows } from '../../../../services/inventoryCompleteRead.js';
import { indexStockCheckActors, readStockCheckActors, stockCheckActorNames } from "./inventoryStockCheckActors.js";
import { mapRemoteStockCheck } from './inventoryStockCheckReadModel.js';
import { mapRemoteInventoryItem } from '../inventoryItemModel.js';

// Submitted rows are immutable evidence. Catalog joins supply labels/photos only.
async function readStockCheck(checkId, allowCorrectionDraft, outletIds) {
  const headers = await readCompleteInventoryRows('inventory_stock_checks', { eq: { id: checkId } });
  if (headers.data.length !== 1) throw new Error('No accessible stock check result found.');
  const header = headers.data[0];
  if (outletIds && !outletIds.includes(header.outlet_id)) throw new Error('Stock check result is outside your accessible outlets.');
  if (header.status !== 'submitted' && !(allowCorrectionDraft && header.status === 'draft' && header.correction_of_id)) {
    throw new Error('Only submitted stock checks have a result.');
  }
  const rows = await readCompleteInventoryRows('inventory_stock_check_items', { eq: { stock_check_id: checkId }, order: 'created_at' });
  return mapRemoteStockCheck(header, rows.data);
}

export async function loadSubmittedStockCheck(checkId) {
  return readStockCheck(checkId, false);
}

async function loadAuditCorrections(checkId) {
  const { data, error } = await supabase.rpc("inventory_audit_correction_history", { p_check_id: checkId });
  throwSupabaseError("inventory.audit.correctionHistory", error);
  return data;
}

export async function loadClosingContext(checkId) {
  const { data, error } = await supabase.rpc("inventory_closing_context", { p_check_id: checkId });
  throwSupabaseError("inventory.closing.context", error);
  return data;
}

export async function loadStockCheckResult(checkId, outletIds, allowCorrectionDraft = false) {
  const check = await readStockCheck(checkId, allowCorrectionDraft, outletIds);
  const submitted = check.status === 'submitted';
  const itemIds = [...new Set(check.rows.map(row => row.itemId).filter(Boolean))];
  const items = itemIds.length ? (await readCompleteInventoryRows('inventory_items', { in: { id: itemIds } })).data : [];
  const categoryIds = [...new Set([...check.rows.map(row => row.categoryId), ...items.map(row => row.category_id)].filter(Boolean))];
  const [categories, people, closing, history, source] = await Promise.all([
    categoryIds.length ? readCompleteInventoryRows('inventory_categories', { in: { id: categoryIds } }) : { data: [] },
    readStockCheckActors([check.createdByEmployeeId, check.submittedBy], check.createdByEmployeeId ? [] : [check.createdBy]),
    submitted && check.accountingMonth ? loadClosingContext(check.id) : null,
    submitted && check.stockCheckType === 'audit' ? loadAuditCorrections(check.id) : null,
    check.correctionOfId ? readStockCheck(check.correctionOfId, false, [check.outletId]) : null,
  ]);
  const categoryById = new Map(categories.data.map(row => [row.id, row]));
  return { check, closing, history, source, itemById: new Map(items.map(row => [row.id, mapRemoteInventoryItem(row, [], categoryById)])), categoryById, actors: stockCheckActorNames(check, indexStockCheckActors(people)) };
}
