import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PageHeader from '../../../../components/layout/PageHeader.jsx';
import EmptyState from '../../../../components/feedback/EmptyState.jsx';
import Modal from '../../../../components/feedback/Modal.jsx';
import Badge from '../../../../components/ui/Badge.jsx';
import { getAccessibleOutlets, getAccessibleOutletOptions, hasPermission, notifyPermissionDenied } from '../../../../utils/accessControl.js';
import { inventoryLifecycleService } from '../../../../services/inventoryLifecycleService.js';
import { invalidateInventoryReads } from '../../../../services/inventoryRevalidation.js';
import { canonical, isActiveInventoryItem } from '../inventoryItemModel.js';
import { todayInput, parseNonNegativeNumber } from '../InventorySharedPresentation.jsx';
import InventoryWasteDetail, { wasteActorName } from '../waste/InventoryWasteDetail.jsx';
import InventoryPurchaseOrderSurface from '../purchaseOrders/InventoryPurchaseOrderSurface.jsx';
import { isPurchaseOrderReference } from '../purchaseOrders/inventoryPurchaseOrderHelpers.js';
import InventoryMovementsTable from './InventoryMovementsTable.jsx';
import InventoryManualMovementModal from './InventoryManualMovementModal.jsx';
import useInventoryMovementsRead from './useInventoryMovementsRead.js';
import { toTitle, canEditInventoryMovement, persistRemoteInventoryMovement, persistRemoteInventoryMovementUpdate, resolveMovementPurchaseOrder } from './inventoryMovementService.js';

const formatDateTimeCompact = value => value ? new Date(value).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export default function InventoryMovementsPage({ auth, ui, outlets, suppliers }) {
  const accessibleOutlets = getAccessibleOutlets(auth, outlets);
  const canView = hasPermission(auth, 'inventory_movements.view');
  const canRecordMovement = hasPermission(auth, 'inventory_movements.create');
  const read = useInventoryMovementsRead({ outletIds: accessibleOutlets.map(row => row.id), scopeKey: auth?.user?.id || '', enabled: canView && !!accessibleOutlets.length });
  const { movements = [], items = [], people = [] } = read.data || {};
  const itemById = new Map(items.map(row => [row.id, row]));
  const outletById = new Map(accessibleOutlets.map(row => [row.id, row]));
  const [modal, setModal] = useState(null);
  const saving = useRef(false);
  const navigation = useRef(0);
  useEffect(() => () => { navigation.current += 1; }, []);
  const notify = (title, message = '', tone = 'success') => ui?.notify?.({ title, message, tone });
  const close = () => { if (!saving.current) { navigation.current += 1; setModal(null); } };
  async function saveMovement(movement) {
    if (saving.current) return;
    if (!canRecordMovement) return notifyPermissionDenied(ui, 'record inventory movements');
    saving.current = true;
    try {
      if (movement.transfer) {
        await inventoryLifecycleService.transferInventory({ movement: { ...movement, unit: movement.unit || itemById.get(movement.itemId)?.unit || '', reference: movement.reference || `TRF-${Date.now().toString().slice(-8)}`, referenceType: 'transfer', notes: movement.notes } });
      } else {
        const existing = movements.some(entry => entry.id === movement.id);
        const intent = { ...movement, unit: movement.unit || itemById.get(movement.itemId)?.unit || '' };
        await (existing ? persistRemoteInventoryMovementUpdate(intent, auth?.user?.id) : persistRemoteInventoryMovement(intent, auth?.user?.id));
      }
      // Close committed intent before read-back: a read failure cannot resubmit it.
      setModal(null);
      invalidateInventoryReads({ outletId: movement.outletId || movement.fromOutletId, reason: 'movement-saved' });
      notify(movement.id && movements.some(row => row.id === movement.id) ? 'Inventory movement updated' : 'Inventory movement recorded');
    } catch (error) { notify('Unable to save movement', error.message || 'Please try again.', 'error'); }
    finally { saving.current = false; }
  }
  async function openReference(movement) {
    const id = ++navigation.current;
    try {
      if (isPurchaseOrderReference(movement)) {
        setModal({ type: 'reference-loading' });
        const orderId = await resolveMovementPurchaseOrder(movement);
        if (navigation.current === id) setModal({ type: 'po', orderId });
      } else if (canonical(movement.referenceType) === 'waste') setModal({ type: 'waste', wasteId: movement.referenceId });
      else if (canonical(movement.referenceType) === 'transfer') {
        const rows = movements.filter(row => row.reference && row.reference === movement.reference);
        setModal({ type: 'transfer-detail', movement, movements: rows.length ? rows : [movement] });
      } else notify('Reference detail unavailable', 'No linked detail record is available for this movement.', 'info');
    } catch (error) { if (navigation.current === id) setModal({ type: 'reference-error', error: error.message, movement }); }
  }
  if (!canView) return <EmptyState title="Permission required" description="You do not have permission to view Inventory Movements." />;
  return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title="Inventory Movements" description="Track purchases, transfers, waste, usage and adjustments." actions={canRecordMovement ? <button className="btn-primary" disabled={!read.data} onClick={() => setModal({ type: 'movement' })}><RefreshCw size={15} /> Record Movement</button> : null} />
    {read.state === 'refreshing' ? <p role="status">Refreshing Movements. Showing the last verified complete read.</p> : null}
    {!read.data ? <div className="card p-4" role={read.error ? 'alert' : 'status'}><p>{!accessibleOutlets.length ? 'No accessible outlet.' : read.error || 'Loading complete Inventory Movements…'}</p>{read.error ? <><p>No partial results are presented as complete.</p><button className="btn-secondary" onClick={read.refresh}>Retry</button></> : null}</div> :
      <InventoryMovementsTable movements={movements} itemById={itemById} outletById={outletById} outletOptions={getAccessibleOutletOptions(auth, outlets)} actorNameByAnyId={id => wasteActorName(id, people, auth)} formatDateTimeCompact={formatDateTimeCompact} canonical={canonical} toTitle={toTitle} canEditMovement={canEditInventoryMovement} canRecordMovement={canRecordMovement} onEditMovement={movement => setModal({ type: 'movement', movement })} onOpenReference={openReference} />}
    {modal?.type === 'po' ? <InventoryPurchaseOrderSurface orderId={modal.orderId} auth={auth} ui={ui} outlets={outlets} suppliers={suppliers} onClose={close} /> : null}
    {modal?.type === 'waste' ? <InventoryWasteDetail wasteId={modal.wasteId} auth={auth} outlets={outlets} onClose={close} /> : null}
    {modal?.type === 'reference-loading' || modal?.type === 'reference-error' ? <Modal title="Movement Reference" onClose={close}><p role={modal.error ? 'alert' : 'status'}>{modal.error || 'Loading reference…'}</p>{modal.error ? <button className="btn-secondary" onClick={() => openReference(modal.movement)}>Retry</button> : null}</Modal> : null}
      {modal?.type === "movement" ? <InventoryManualMovementModal outlets={accessibleOutlets} items={items} movements={movements} movement={modal.movement} canonical={canonical} isActiveInventoryItem={isActiveInventoryItem} todayInput={todayInput} makeId={makeId} parseNonNegativeNumber={parseNonNegativeNumber} onClose={close} onSave={saveMovement} /> : null}
      {modal?.type === "transfer-detail" ? (() => {
        const rows = modal.movements || [];
        const reference = modal.movement?.reference || rows[0]?.reference || "Transfer";
        return (
          <Modal
            title="Transfer Detail"
            description={reference}
            size="lg"
            onClose={close}
            footer={<button className="btn-secondary" type="button" onClick={() => setModal(null)}>Close</button>}
          >
            <div className="space-y-2">
              {rows.map((row) => {
                const item = itemById.get(row.itemId);
                const quantity = Number(row.quantity || 0);
                return (
                  <div key={row.id} className="rounded-2xl border border-border bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-bold text-text-primary">{quantity < 0 ? "Transfer Out" : "Transfer In"}</div>
                        <div className="mt-1 type-caption text-text-secondary">{outletById.get(row.outletId)?.name || "Outlet"} · {item?.name || "Inventory item"}</div>
                      </div>
                      <Badge tone="info">{quantity > 0 ? "+" : ""}{quantity} {row.unit || item?.unit || ""}</Badge>
                    </div>
                    {row.notes ? <div className="mt-2 type-body-sm text-text-secondary">{row.notes}</div> : null}
                  </div>
                );
              })}
            </div>
          </Modal>
        );
      })() : null}

  </div>;
}
