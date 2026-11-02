import { useEffect, useState } from 'react';
import { readNetworkEvidence } from './networkEvidence.js';

export default function useNetworkEvidence(auth, modules, live) {
  const scopeKey = JSON.stringify([auth.user?.id, auth.permissions, auth.isProtectedRole, auth.profile, modules.map(module => module.id)]);
  const [state, setState] = useState({ key: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setActive(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    let disposed = false, busy = false;
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const value = await readNetworkEvidence({ auth, modules });
        if (!disposed) setState({ key: scopeKey, loading: false, ...value });
      } catch {
        if (!disposed) setState({ key: scopeKey, loading: false, error: 'Network evidence could not be loaded. Retry to check the sources.' });
      } finally { busy = false; }
    }
    refresh();
    const timer = live && active ? window.setInterval(refresh, 30000) : null;
    const foreground = () => { if (live) refresh(); };
    window.addEventListener('focus', foreground);
    return () => { disposed = true; if (timer) window.clearInterval(timer); window.removeEventListener('focus', foreground); };
  }, [scopeKey, live, active, attempt]);
  // Old authorization snapshots are never displayed while a replacement read is pending.
  return { ...(state.key === scopeKey ? state : { loading: true }), active, refresh: () => setAttempt(value => value + 1) };
}
