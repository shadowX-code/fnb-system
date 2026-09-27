import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInventoryWaste } from './inventoryWasteService.js';

// One verified bundle replaces Waste and its linked Movement context together.
export default function useInventoryWasteRead({ outletId, wasteId, scopeKey = '', enabled = true }) {
  const key = `${scopeKey}:${outletId || ''}:${wasteId || ''}`;
  const request = useRef(0);
  const activeKey = useRef(key);
  activeKey.current = key;
  const [read, setRead] = useState({ key: '', state: 'loading', data: null, error: '' });
  const refresh = useCallback(async () => {
    if (activeKey.current !== key) return null;
    const id = ++request.current;
    if (!enabled) return null;
    setRead(current => ({ ...current, key, state: current.key === key && current.data ? 'refreshing' : 'loading', error: '' }));
    try {
      const data = await loadInventoryWaste({ outletId, wasteId });
      if (id !== request.current) return null;
      setRead({ key, state: 'ready', data, error: '' });
      return data;
    } catch (error) {
      if (id !== request.current) return null;
      setRead({ key, state: error.readState || 'error', data: null, error: error.message || 'Unable to load Wastage.' });
      return null;
    }
  }, [key, enabled, outletId, wasteId]);
  useEffect(() => { activeKey.current = key; refresh(); return () => { request.current += 1; activeKey.current = null; }; }, [refresh]);
  return { ...(read.key === key ? read : { state: 'loading', data: null, error: '' }), refresh };
}
