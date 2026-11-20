import { supabase } from "../../../../lib/supabase";
import { throwSupabaseError } from "../../../../services/supabaseError.js";
import { readCompleteInventoryRows } from '../../../../services/inventoryCompleteRead.js';
import { mapRemoteStockCheck } from './inventoryStockCheckReadModel.js';
import { mapRemoteInventoryItem } from '../inventoryItemModel.js';

// Submitted rows are immutable evidence. Catalog joins supply labels/photos only.
export async function loadSubmittedStockCheck(checkId) {
  const headers = await readCompleteInventoryRows('inventory_stock_checks', { eq: { id: checkId } });
  if (headers.data.length !== 1) throw new Error('No accessible stock check result found.');
  if (headers.data[0].status !== 'submitted') throw new Error('Only submitted stock checks have a result.');
  const rows = await readCompleteInventoryRows('inventory_stock_check_items', { eq: { stock_check_id: checkId }, order: 'created_at' });
  return mapRemoteStockCheck(headers.data[0], rows.data);
}

async function loadClosingContext(checkId) {
  const { data, error } = await supabase.rpc("inventory_closing_context", { p_check_id: checkId });
  throwSupabaseError("inventory.closing.context", error);
  return data;
}

export async function loadStockCheckResult(checkId, outletIds) {
  const check = await loadSubmittedStockCheck(checkId);
  if (!outletIds.includes(check.outletId)) throw new Error('Stock check result is outside your accessible outlets.');
  const itemIds = [...new Set(check.rows.map(row => row.itemId).filter(Boolean))];
  const items = itemIds.length ? (await readCompleteInventoryRows('inventory_items', { in: { id: itemIds } })).data : [];
  const categoryIds = [...new Set([...check.rows.map(row => row.categoryId), ...items.map(row => row.category_id)].filter(Boolean))];
  const [categories, people, closing] = await Promise.all([
    categoryIds.length ? readCompleteInventoryRows('inventory_categories', { in: { id: categoryIds } }) : { data: [] },
    check.submittedBy ? readCompleteInventoryRows('employees', { select: 'id, full_name, nickname, email', eq: { id: check.submittedBy } }) : { data: [] },
    check.accountingMonth ? loadClosingContext(check.id) : null,
  ]);
  const categoryById = new Map(categories.data.map(row => [row.id, row]));
  return { check, closing, itemById: new Map(items.map(row => [row.id, mapRemoteInventoryItem(row, [], categoryById)])), categoryById, actor: people.data[0] };
}
