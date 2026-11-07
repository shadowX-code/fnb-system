import { readCompleteInventoryRows } from '../../../../services/inventoryCompleteRead.js';
import { mapRemoteInventoryItem } from '../inventoryItemModel.js';
import { mapRemotePurchaseOrder } from './inventoryPurchaseOrderService.js';
import { loadSubmittedStockCheck } from '../stockChecks/inventoryStockCheckResultService.js';
import { buildPurchaseSuggestions } from './inventoryRestockReadModel.js';

async function readOrders(filters) {
  const headers = (await readCompleteInventoryRows('inventory_purchase_orders', { ...filters, order: 'created_at', ascending: false })).data;
  const ids = headers.map(row => row.id);
  if (!ids.length) return [];
  const [lines, receipts] = await Promise.all([
    readCompleteInventoryRows('inventory_purchase_order_items', { in: { purchase_order_id: ids }, order: 'created_at' }),
    readCompleteInventoryRows('inventory_purchase_receipts', { in: { purchase_order_id: ids }, order: 'received_at', ascending: false }),
  ]);
  const receiptIds = receipts.data.map(row => row.id);
  const receiptItems = receiptIds.length ? (await readCompleteInventoryRows('inventory_purchase_receipt_items', { in: { receipt_id: receiptIds } })).data : [];
  return headers.map(header => mapRemotePurchaseOrder(header, lines.data.filter(row => row.purchase_order_id === header.id), receipts.data.filter(row => row.purchase_order_id === header.id).map(receipt => ({ ...receipt, items: receiptItems.filter(row => row.receipt_id === receipt.id) }))));
}

async function readItems(links, extraIds = []) {
  const ids = [...new Set([...links.map(row => row.inventory_item_id), ...extraIds].filter(Boolean))];
  const items = ids.length ? (await readCompleteInventoryRows('inventory_items', { in: { id: ids } })).data : [];
  return items.map(row => mapRemoteInventoryItem(row, links.filter(link => link.inventory_item_id === row.id)));
}

export async function loadPurchaseOrderSupplierItems(items, outletId) {
  const linkIds = [...new Set(items.flatMap(item => item.outletConfigs || [])
    .filter(config => config.outletId === outletId).map(config => config.id).filter(Boolean))];
  const supplierLinks = linkIds.length ? (await readCompleteInventoryRows('inventory_item_outlet_suppliers', { in: { inventory_item_outlet_id: linkIds } })).data : [];
  const supplierIds = new Map();
  for (const link of supplierLinks) {
    const ids = supplierIds.get(link.inventory_item_outlet_id) || [];
    ids.push(link.supplier_id);
    supplierIds.set(link.inventory_item_outlet_id, ids);
  }
  return items.map(item => ({ ...item, outletConfigs: (item.outletConfigs || []).map(config => ({
    ...config, supplierIds: supplierIds.get(config.id) || [],
  })) }));
}

export async function loadPurchaseOrders(outletIds) {
  const [orders, links] = await Promise.all([
    readOrders({ in: { outlet_id: outletIds } }),
    readCompleteInventoryRows('inventory_item_outlets', { in: { outlet_id: outletIds } }),
  ]);
  const items = await readItems(links.data, orders.flatMap(order => order.lines.map(line => line.itemId)));
  const creatorIds = [...new Set(orders.map(order => order.createdBy).filter(Boolean))];
  const creators = creatorIds.length ? await Promise.all([
    readCompleteInventoryRows('employees', { select: 'id,auth_user_id,full_name,nickname,email', in: { id: creatorIds } }),
    readCompleteInventoryRows('employees', { select: 'id,auth_user_id,full_name,nickname,email', in: { auth_user_id: creatorIds } }),
  ]) : [];
  const creatorById = new Map(creators.flatMap(result => result.data).flatMap(person => [
    [person.id, person], [person.auth_user_id, person],
  ]));
  return { orders: orders.map(order => ({ ...order, createdByName: creatorById.get(order.createdBy)?.nickname || creatorById.get(order.createdBy)?.full_name || creatorById.get(order.createdBy)?.email || 'Unknown User' })), items };
}

export async function loadStockCheckRestock(checkId, outletIds, suppliers) {
  const check = await loadSubmittedStockCheck(checkId);
  if (!outletIds.includes(check.outletId)) throw new Error('Stock check is outside your accessible outlets.');
  if (check.stockCheckType !== 'scheduled') throw new Error('Only submitted scheduled stock checks can supply purchase suggestions.');
  const itemIds = [...new Set(check.rows.map(row => row.itemId).filter(Boolean))];
  const [orders, links] = await Promise.all([
    readOrders({ eq: { source_type: 'stock_check', source_stock_check_id: checkId } }),
    itemIds.length ? readCompleteInventoryRows('inventory_item_outlets', { eq: { outlet_id: check.outletId }, in: { inventory_item_id: itemIds } }) : { data: [] },
  ]);
  const items = await loadPurchaseOrderSupplierItems(await readItems(links.data, itemIds), check.outletId);
  const categoryIds = [...new Set(items.map(item => item.categoryId).filter(Boolean))];
  const categories = categoryIds.length ? (await readCompleteInventoryRows('inventory_categories', { in: { id: categoryIds } })).data : [];
  return { check, orders: orders.filter(order => order.status !== 'cancelled'), items, suggestions: buildPurchaseSuggestions(check, items, categories, suppliers) };
}
