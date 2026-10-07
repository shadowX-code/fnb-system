import { lazy, Suspense, useState } from 'react';
import { normalizeRoleName } from '../../auth/rbac.js';
import './approved-system.css';
const enabledBuild = import.meta.env.DEV || __FINANCE_STAGING_PREVIEW__;
const Preview = enabledBuild ? lazy(() => import('./FinanceDesignPreview.jsx')) : null;
export function financePreviewGate({ development, stagingBuild, role, hostname }) {
  return normalizeRoleName(role) === 'owner' && (development || (stagingBuild && hostname === 'fnb-system-staging.vercel.app'));
}
export function financePreviewAllowed(auth, hostname = window.location.hostname) {
  return financePreviewGate({development:import.meta.env.DEV,stagingBuild:__FINANCE_STAGING_PREVIEW__,role:auth?.profile?.role_name ?? auth?.profile?.role?.name,hostname});
}
export default function FinancePreviewBoundary({ auth, section, children }) {
  const allowed = financePreviewAllowed(auth);
  const [active, setActive] = useState(() => allowed && sessionStorage.getItem('feedx-finance-design-preview') === 'on');
  const preview = allowed && active;
  return <div className={`finance-presentation ${preview ? 'is-design-preview' : ''}`}>
    {allowed ? <div className="finance-preview-switch"><button type="button" className="btn-secondary" aria-pressed={preview} onClick={() => {sessionStorage.setItem('feedx-finance-design-preview',preview ? 'off':'on');setActive(!preview);}}>{preview ? 'Exit Design Preview' : 'Design Preview'}</button>{preview ? <span>Simulated evidence · isolated from financial records</span> : null}</div> : null}
    {preview ? <Suspense fallback={<p role="status">Loading simulated design evidence…</p>}><Preview section={section}/></Suspense> : children}
  </div>;
}
