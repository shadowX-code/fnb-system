import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../../../../components/feedback/Modal.jsx';
import { getAccessibleOutlets, hasPermission } from '../../../../utils/accessControl.js';
import { loadStockCheckResult } from './inventoryStockCheckResultService.js';
import InventoryStockCheckResultModal from './InventoryStockCheckResultModal.jsx';
import AuditCorrectionDraft from './AuditCorrectionDraft.jsx';
import AuditCorrectionHistory from './AuditCorrectionHistory.jsx';
import { inventoryLifecycleService } from '../../../../services/inventoryLifecycleService.js';
import { invalidateInventoryReads } from '../../../../services/inventoryRevalidation.js';
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
  const canStartClosing = canView && hasPermission(auth, 'inventory_stock_check.create');
  const canCorrect = canStartClosing && hasPermission(auth, 'inventory_stock_check.edit');
  const key = `${auth?.user?.id}:${scope}:${canView}:${canCorrect}:${checkId}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const generation = useRef(0);
  const [read, setRead] = useState({ key: '', state: 'loading', data: null, error: '' });
  const [preview, setPreview] = useState(null);
  const [createState, setCreateState] = useState({ key: null, busy: false, error: '' });
  const pending = useRef(null);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setRead({ key, state: 'loading', data: null, error: '' });
    try {
      if (!canView) throw new Error('Permission required to view stock check results.');
      const data = await loadStockCheckResult(checkId, scope.split('|').filter(Boolean), canCorrect);
      if (request !== generation.current || activeKey.current !== key) return;
      setRead({ key, state: 'ready', data, error: '' });
    } catch (error) {
      if (request !== generation.current || activeKey.current !== key) return;
      setRead({ key, state: error.readState || 'error', data: null, error: error.message });
    }
  }, [key, checkId, scope, canView, canCorrect]);
  useEffect(() => { activeKey.current = key; reload(); setPreview(null); return () => { generation.current += 1; activeKey.current = null; }; }, [reload, key]);
  const close = () => { generation.current += 1; activeKey.current = null; onClose(); };
  const data = read.key === key ? read.data : null;
  function openAudit(id) {
    navigateAdminRoute('inventory-stock-check-result', { checkId: id }, resolveAdminLocation(window.location)?.query || {});
  }

  function startNewClosing() {
    const { outletId, accountingMonth } = data.check;
    navigateAdminRoute('inventory_stock_check', {}, {
      startClosingAudit: '1', outletId, accountingMonth: accountingMonth?.slice(0, 7),
    });
  }

  async function createCorrection() {
    if (!canCorrect || (createState.key === key && createState.busy)) return;
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
    setCreateState({ key, busy: true, error: '' });
    try {
      const result = await inventoryLifecycleService.createAuditCorrection({ checkId, requestId: pending.current.requestId });
      if (activeKey.current !== key) return;
      pending.current = null;
      invalidateInventoryReads({ source: 'stock-check', outletId: data.check.outletId, checkId: result.check_id });
      openAudit(result.check_id);
    } catch (cause) {
      if (activeKey.current === key) setCreateState({ key, busy: false, error: cause.message || 'Unable to create a correction draft.' });
    }
  }

  const onRestock = data?.check.stockCheckType === 'scheduled' && (hasPermission(auth, 'inventory_orders.create') || hasPermission(auth, 'inventory_stock_check.review')) ? () => navigateAdminRoute('inventory-stock-check-restock', { checkId }, resolveAdminLocation(window.location)?.query || {}) : undefined;
  if (!data) return <Modal title="Stock Check Result" onClose={close}><p role={read.key === key && read.error ? 'alert' : 'status'}>{read.key === key && read.error ? `${read.state === 'incomplete' ? 'Result incomplete. ' : ''}${read.error}` : 'Loading submitted evidence…'}</p>{read.key === key && read.error ? <button className="btn-secondary mt-3" onClick={reload}>Retry</button> : null}</Modal>;
  if (data.check.status === 'draft') return <AuditCorrectionDraft key={key} check={data.check} source={data.source}
    itemById={data.itemById} onClose={close} onOpenSource={() => openAudit(data.source.id)} onSubmitted={reload} />;
  const history = data.history && <AuditCorrectionHistory check={data.check} history={data.history}
    published={data.closing?.published} canCorrect={canCorrect} canStartClosing={canStartClosing}
    onOpen={openAudit} onCreate={createCorrection} onStartClosing={startNewClosing}
    busy={createState.key === key && createState.busy} error={createState.key === key ? createState.error : ''} />;
  return <><InventoryStockCheckResultModal key={key} onRestock={onRestock} stockCheck={data.check} correctionHistory={history} correctionSource={data.source} closing={data.closing} canApproveClosing={hasPermission(auth, 'inventory_stock_check.approve')} isAuditResult={data.check.stockCheckType === 'audit'} outletName={outlets.find(outlet => outlet.id === data.check.outletId)?.name || 'Outlet'} submittedByName={data.actor ? employeeDisplayName(data.actor) : 'Unknown User'} itemById={data.itemById} categoryById={data.categoryById} formatDate={formatDate} formatDateTimeCompact={formatDateTimeCompact} formatCurrency={formatRestaurantRecipeCurrency} ItemThumbnail={InventoryItemThumbnail} onPhotoPreview={setPreview} onClose={close} /><InventoryItemPhotoPreview preview={preview} onClose={() => setPreview(null)} /></>;
}
