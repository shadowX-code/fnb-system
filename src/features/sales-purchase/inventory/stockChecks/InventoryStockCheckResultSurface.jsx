import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../../../../components/feedback/Modal.jsx';
import { getAccessibleOutlets, hasPermission } from '../../../../utils/accessControl.js';
import { loadStockCheckResult } from './inventoryStockCheckResultService.js';
import InventoryStockCheckResultModal from './InventoryStockCheckResultModal.jsx';
import InventoryItemThumbnail from '../InventoryItemThumbnail.jsx';
import InventoryItemPhotoPreview from '../InventoryItemPhotoPreview.jsx';
import { employeeDisplayName, formatDate } from '../waste/inventoryWasteService.js';
import { formatRestaurantRecipeCurrency } from '../recipes/inventoryRecipeReadModel.js';
import { navigateAdminRoute, resolveAdminLocation } from '../../../../app/routeOwnership.js';

const formatDateTimeCompact = value => value ? new Date(value).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

// One identity-only entry for submitted Scheduled and Audit evidence.
export default function InventoryStockCheckResultSurface({ checkId, auth, outlets, onClose }) {
  const scope = getAccessibleOutlets(auth, outlets).map(outlet => outlet.id).sort().join('|');
  const canView = hasPermission(auth, 'inventory_stock_check.view');
  const key = `${auth?.user?.id}:${scope}:${canView}:${checkId}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const generation = useRef(0);
  const [read, setRead] = useState({ key: '', state: 'loading', data: null, error: '' });
  const [preview, setPreview] = useState(null);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setRead({ key, state: 'loading', data: null, error: '' });
    try {
      if (!canView) throw new Error('Permission required to view stock check results.');
      const data = await loadStockCheckResult(checkId, scope.split('|').filter(Boolean));
      if (request !== generation.current || activeKey.current !== key) return;
      setRead({ key, state: 'ready', data, error: '' });
    } catch (error) {
      if (request !== generation.current || activeKey.current !== key) return;
      setRead({ key, state: error.readState || 'error', data: null, error: error.message });
    }
  }, [key, checkId, scope, canView]);
  useEffect(() => { reload(); setPreview(null); return () => { generation.current += 1; }; }, [reload]);
  const close = () => { generation.current += 1; activeKey.current = null; onClose(); };
  const data = read.key === key ? read.data : null;
  const onRestock = data?.check.stockCheckType === 'scheduled' && (hasPermission(auth, 'inventory_orders.create') || hasPermission(auth, 'inventory_stock_check.review')) ? () => navigateAdminRoute('inventory-stock-check-restock', { checkId }, resolveAdminLocation(window.location)?.query || {}) : undefined;
  if (!data) return <Modal title="Stock Check Result" onClose={close}><p role={read.key === key && read.error ? 'alert' : 'status'}>{read.key === key && read.error ? `${read.state === 'incomplete' ? 'Result incomplete. ' : ''}${read.error}` : 'Loading submitted evidence…'}</p>{read.key === key && read.error ? <button className="btn-secondary mt-3" onClick={reload}>Retry</button> : null}</Modal>;
  return <><InventoryStockCheckResultModal key={key} onRestock={onRestock} stockCheck={data.check} isAuditResult={data.check.stockCheckType === 'audit'} outletName={outlets.find(outlet => outlet.id === data.check.outletId)?.name || 'Outlet'} submittedByName={data.actor ? employeeDisplayName(data.actor) : 'Unknown User'} itemById={data.itemById} categoryById={data.categoryById} formatDate={formatDate} formatDateTimeCompact={formatDateTimeCompact} formatCurrency={formatRestaurantRecipeCurrency} ItemThumbnail={InventoryItemThumbnail} onPhotoPreview={setPreview} onClose={close} /><InventoryItemPhotoPreview preview={preview} onClose={() => setPreview(null)} /></>;
}
