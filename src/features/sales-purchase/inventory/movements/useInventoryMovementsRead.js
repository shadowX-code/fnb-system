import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInventoryMovements } from './inventoryMovementService.js';
import { subscribeInventoryRevalidation } from '../../../../services/inventoryRevalidation.js';

export default function useInventoryMovementsRead({ outletIds, scopeKey, enabled }) {
  const outletsKey = outletIds.join('|');
  const key = `${scopeKey}:${outletsKey}:${enabled}`;
  const generation = useRef(0);
  const activeKey = useRef(key);
  activeKey.current = key;
  const [read, setRead] = useState({ key: '', data: null, state: 'loading', error: '' });
  const refresh = useCallback(async () => {
    if (!enabled || activeKey.current !== key) return null;
    const id = ++generation.current;
    setRead(current => ({ key, data: current.key === key ? current.data : null, state: current.key === key && current.data ? 'refreshing' : 'loading', error: '' }));
    try {
      const data = await loadInventoryMovements(outletsKey.split('|').filter(Boolean));
      if (id !== generation.current || activeKey.current !== key) return null;
      setRead({ key, data, state: 'ready', error: '' });
      return data;
    } catch (error) {
      if (id !== generation.current || activeKey.current !== key) return null;
      setRead({ key, data: null, state: error.readState || 'error', error: error.message || 'Unable to load Inventory Movements.' });
      return null;
    }
  }, [key, outletsKey, enabled]);
  useEffect(() => { activeKey.current = key; refresh(); return () => { generation.current += 1; activeKey.current = null; }; }, [refresh, key]);
  useEffect(() => subscribeInventoryRevalidation(refresh), [refresh]);
  return { ...(read.key === key ? read : { data: null, state: 'loading', error: '' }), refresh };
}
