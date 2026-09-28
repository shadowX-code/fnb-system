import { useEffect, useRef, useState } from 'react';
import Modal from '../../../../components/feedback/Modal.jsx';
import { getAccessibleOutlets, hasPermission, notifyPermissionDenied } from '../../../../utils/accessControl.js';
import { invalidateInventoryReads } from '../../../../services/inventoryRevalidation.js';
import { PurchaseSuggestionsModal } from './InventoryPurchaseOrderForms.jsx';
import InventoryPurchaseOrderSurface from './InventoryPurchaseOrderSurface.jsx';
import { businessPoNo } from './inventoryPurchaseOrderHelpers.js';
import { persistRemoteDraftPurchaseOrders } from './inventoryPurchaseOrderService.js';
import useInventoryPurchaseOrdersRead from './useInventoryPurchaseOrdersRead.js';

export default function InventoryStockCheckRestockSurface({ checkId, auth, ui, outlets, suppliers, onClose }) {
  const accessible = getAccessibleOutlets(auth, outlets);
  const canReview = hasPermission(auth, 'inventory_orders.create') || hasPermission(auth, 'inventory_stock_check.review');
  const key = `${auth?.user?.id}:${checkId}:${accessible.map(o => o.id).sort().join('|')}:${canReview}`;
  const read = useInventoryPurchaseOrdersRead({ outletIds: accessible.map(o => o.id), scopeKey: key, enabled: canReview, checkId, suppliers });
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const current = useRef(key);
  current.current = key;
  const request = useRef(null);
  useEffect(() => { current.current = key; setDetail(null); setSaving(false); return () => { current.current = null; }; }, [key]);
  async function create(rows) {
    if (busy.current || !read.data) return;
    if (!hasPermission(auth, 'inventory_orders.create')) return notifyPermissionDenied(ui, 'create draft purchase orders');
    busy.current = true; setSaving(true);
    const identity = key;
    const fingerprint = JSON.stringify([checkId, rows]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, requestId: crypto.randomUUID(), poTimestamp: Date.now() };
    try {
      await persistRemoteDraftPurchaseOrders(read.data.check, rows, request.current);
      invalidateInventoryReads({ domain: 'purchase-orders', stockCheckId: checkId, outletId: read.data.check.outletId });
      if (current.current === identity) ui?.notify?.({ title: 'Draft PO created', tone: 'success' });
    } catch (error) {
      if (current.current === identity) { ui?.notify?.({ title: 'Failed to create Draft PO', message: error.message, tone: 'error' }); await read.refresh(); }
    } finally { busy.current = false; if (current.current === identity) setSaving(false); }
  }
  const close = () => { if (!busy.current) { current.current = null; onClose(); } };
  if (!canReview || !read.data) return <Modal title="Purchase Suggestions" onClose={close}><p role={read.error || !canReview ? 'alert' : 'status'}>{!canReview ? 'Permission required to review purchase suggestions.' : read.error ? `${read.state === 'incomplete' ? 'Incomplete evidence. ' : ''}${read.error}` : 'Loading submitted stock check and purchase evidence…'}</p>{read.error ? <button className="btn-secondary" onClick={read.refresh}>Retry</button> : null}</Modal>;
  const data = read.data;
  return <>
    <PurchaseSuggestionsModal key={`${key}:${data.orders.map(o => o.id).join('|')}`} suggestions={data.suggestions} existingOrders={data.orders} suppliers={suppliers} outlet={accessible.find(o => o.id === data.check.outletId)} businessPoNo={businessPoNo} saving={saving} onClose={close} onCreateDraftPo={create} onViewPurchaseOrder={order => setDetail({ key, id: order.id })} />
    {detail?.key === key ? <InventoryPurchaseOrderSurface orderId={detail.id} auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} onClose={() => setDetail(null)} /> : null}
  </>;
}
