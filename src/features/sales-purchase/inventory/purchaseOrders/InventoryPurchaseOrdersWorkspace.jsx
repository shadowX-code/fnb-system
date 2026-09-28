import { useRef, useState } from 'react';
import PageHeader from '../../../../components/layout/PageHeader.jsx';
import { getAccessibleOutlets, getAccessibleOutletOptions, hasPermission, notifyPermissionDenied } from '../../../../utils/accessControl.js';
import { invalidateInventoryReads } from '../../../../services/inventoryRevalidation.js';
import { todayInput, csvEscape, downloadTextFile } from '../InventorySharedPresentation.jsx';
import { formatDate } from '../waste/inventoryWasteService.js';
import InventoryPurchaseOrdersPage from './InventoryPurchaseOrdersPage.jsx';
import InventoryPurchaseOrderSurface from './InventoryPurchaseOrderSurface.jsx';
import { PurchaseOrderEditModal, CancelPurchaseOrderModal, CompletePurchaseOrderModal } from './InventoryPurchaseOrderForms.jsx';
import { businessPoNo, poStatusTone, poProgress, poStatusLabel, poSourceLabel } from './inventoryPurchaseOrderHelpers.js';
import { persistRemotePurchaseOrderEdit, persistRemotePurchaseOrderStatus, persistRemotePurchaseOrderCancel, persistRemotePurchaseOrderComplete } from './inventoryPurchaseOrderService.js';
import useInventoryPurchaseOrdersRead from './useInventoryPurchaseOrdersRead.js';

export default function InventoryPurchaseOrdersWorkspace({ auth, ui, outlets, suppliers }) {
  const accessible = getAccessibleOutlets(auth, outlets);
  const options = getAccessibleOutletOptions(auth, outlets).filter(option => option.value !== 'all');
  const [selected, setSelected] = useState('');
  const outletId = options.some(option => option.value === selected) ? selected : options[0]?.value || '';
  const scopeKey = `${auth?.user?.id}:${outletId}`;
  const canView = hasPermission(auth, 'inventory_orders.view');
  const read = useInventoryPurchaseOrdersRead({ outletIds: outletId ? [outletId] : [], scopeKey, enabled: canView && !!outletId });
  const { orders = [], items = [] } = read.data || {};
  const [modal, setModal] = useState(null);
  const busy = useRef(false);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const notify = (title, message = '', tone = 'success') => ui?.notify?.({ title, message, tone });
  const allowed = (action, label) => hasPermission(auth, `inventory_orders.${action}`) || (notifyPermissionDenied(ui, label), false);
  const open = (type, order, action) => setModal({ type, order, orderId: order.id, action, scopeKey });
  async function mutate(action, order, command, title, failure) {
    if (busy.current || !allowed(action, 'manage purchase orders')) return;
    busy.current = true;
    const scope = scopeKey;
    try {
      const result = await command();
      invalidateInventoryReads({ domain: 'purchase-orders', orderId: order.id, outletId: order.outletId });
      if (activeScope.current === scope) { setModal(null); notify(title); }
      return result;
    } catch (error) {
      if (activeScope.current === scope) notify(failure, error.message || 'Please try again.', 'error');
      throw error;
    } finally { busy.current = false; }
  }
  const transition = (order, status) => mutate('submit', order, () => persistRemotePurchaseOrderStatus(order.id, status), status === 'submitted' ? 'PO submitted' : 'PO supplier confirmed', status === 'submitted' ? 'Failed to submit PO' : 'Failed to update PO').catch(() => {});
  function exportOrders(filtered) {
    if (!allowed('export', 'export purchase orders') || !read.data) return;
    const columns = ['PO No.', 'Internal System ID', 'Supplier', 'Outlet', 'Items', 'Ordered Qty', 'Received Qty', 'Remaining Qty', 'Status', 'Source', 'Created Date', 'Submitted Date', 'Completed Date', 'Completion Type', 'Completion Reason', 'Cancelled Reason'];
    const rows = filtered.map(order => { const progress = poProgress(order); return [businessPoNo(order), order.poNo, suppliers.find(s => s.id === order.supplierId)?.name || '', accessible.find(o => o.id === order.outletId)?.name || '', order.lines.length, progress.ordered, progress.received, Math.max(0, progress.ordered - progress.received), poStatusLabel(order.status), poSourceLabel(order.sourceType), order.createdAt || '', order.submittedAt || '', order.completedAt || '', (order.completionType || '').replace(/\b\w/g, s => s.toUpperCase()), order.completionReason || '', order.cancellationReason || '']; });
    downloadTextFile(`feedx-purchase-orders-${todayInput()}.csv`, [columns, ...rows].map(row => row.map(csvEscape).join(',')).join('\n'));
    notify('Purchase orders exported', `${rows.length} PO${rows.length === 1 ? '' : 's'} exported.`);
  }
  const shown = modal?.scopeKey === scopeKey && read.data ? modal : null;
  if (!canView || !outletId) return <><PageHeader section="INVENTORY CONTROL" title="Purchase Orders" /><p role="alert">{canView ? 'No accessible outlet.' : 'Permission required to view purchase orders.'}</p></>;
  return <>
    <InventoryPurchaseOrdersPage orders={orders} items={items} suppliers={suppliers} outletOptions={options} outletById={new Map(accessible.map(outlet => [outlet.id, outlet]))} getBusinessPoNo={businessPoNo} formatDate={formatDate} todayInput={todayInput} statusTone={poStatusTone}
      selectedOutletId={outletId} onOutletChange={setSelected} onExport={exportOrders}
      loadState={read.state} loadError={read.error} onRetry={read.refresh}
      onRequestEdit={order => allowed('edit', 'edit purchase orders') && open('edit', order)} onSubmit={order => transition(order, 'submitted')} onConfirm={order => transition(order, 'supplier_confirmed')}
      onRequestReceive={order => allowed('receive', 'receive inventory') && open('detail', order, 'receive')}
      onComplete={order => allowed('complete', 'complete purchase orders') && open('complete', order)} onCancel={order => allowed('cancel', 'cancel purchase orders') && open('cancel', order)}
      onView={order => open('detail', order)} onCopyPurchaseOrder={order => open('detail', order, 'copy')} />
    {shown?.type === 'detail' ? <InventoryPurchaseOrderSurface key={shown.orderId + (shown.action || '')} orderId={shown.orderId} initialAction={shown.action || 'detail'} auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} onClose={() => setModal(null)} /> : null}
    {shown?.type === 'edit' ? <PurchaseOrderEditModal order={shown.order} items={items} suppliers={suppliers} onClose={() => setModal(null)} onSave={order => mutate('edit', order, () => persistRemotePurchaseOrderEdit(order), 'Draft PO saved', 'Failed to update Draft PO')} /> : null}
    {shown?.type === 'cancel' ? <CancelPurchaseOrderModal order={shown.order} displayPoNo={businessPoNo(shown.order)} onClose={() => setModal(null)} onCancel={reason => mutate('cancel', shown.order, () => persistRemotePurchaseOrderCancel(shown.order, reason), 'PO cancelled', 'Failed to cancel PO').catch(() => {})} /> : null}
    {shown?.type === 'complete' ? <CompletePurchaseOrderModal order={shown.order} onClose={() => setModal(null)} onComplete={reason => mutate('complete', shown.order, () => persistRemotePurchaseOrderComplete(shown.order, reason), 'PO completed', 'Failed to complete PO').catch(() => {})} /> : null}
  </>;
}
