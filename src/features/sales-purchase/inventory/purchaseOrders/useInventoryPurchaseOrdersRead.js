import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPurchaseOrders, loadStockCheckRestock } from './inventoryPurchaseOrdersReadService.js';
import { subscribeInventoryRevalidation } from '../../../../services/inventoryRevalidation.js';
const noSuppliers = [];

export default function useInventoryPurchaseOrdersRead({ outletIds, scopeKey, enabled, checkId, suppliers = noSuppliers }) {
  const outletsKey = [...outletIds].sort().join('|');
  const key = `${scopeKey}:${outletsKey}:${enabled}:${checkId || ''}`;
  const generation = useRef(0);
  const activeKey = useRef(key);
  activeKey.current = key;
  const [read, setRead] = useState({ key: '', data: null, state: 'loading', error: '' });
  const refresh = useCallback(async () => {
    if (!enabled || activeKey.current !== key) return null;
    const id = ++generation.current;
    setRead(current => ({ key, data: current.key === key ? current.data : null, state: current.key === key && current.data ? 'refreshing' : 'loading', error: '' }));
    try {
      const ids = outletsKey.split('|').filter(Boolean);
      const data = await (checkId ? loadStockCheckRestock(checkId, ids, suppliers) : loadPurchaseOrders(ids));
      if (id !== generation.current || activeKey.current !== key) return null;
      setRead({ key, data, state: 'ready', error: '' });
      return data;
    } catch (error) {
      if (id !== generation.current || activeKey.current !== key) return null;
      setRead({ key, data: null, state: error.readState || 'error', error: error.message });
      return null;
    }
  }, [key, enabled, outletsKey, checkId, suppliers]);
  useEffect(() => { refresh(); return () => { generation.current += 1; }; }, [refresh]);
  useEffect(() => subscribeInventoryRevalidation(context => { if (!context?.outletId || outletIds.includes(context.outletId)) refresh(); }), [refresh, outletsKey]);
  return { ...(read.key === key && enabled ? read : { data: null, state: 'loading', error: '' }), refresh };
}
