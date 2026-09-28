import { useMemo, useSyncExternalStore } from 'react';
import { resolveAdminLocation } from './routeOwnership.js';

const subscribe = listener => {
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
  };
};
const snapshot = () => window.location.href;

// Nested identity changes need notification even when the Admin module is unchanged.
export default function useAdminLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => resolveAdminLocation(new URL(href)), [href]);
}
