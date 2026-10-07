import { lazy, Suspense, useState } from 'react';
import { normalizeRoleName } from '../../auth/rbac.js';
import './approved-system.css';
import { WorkspacePageActionsProvider } from '../../components/layout/WorkspacePage.jsx';
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
  const actions = allowed ? <button type="button" className="btn-secondary" aria-pressed={preview} onClick={() => {sessionStorage.setItem('feedx-finance-design-preview',preview ? 'off':'on');setActive(!preview);}}>{preview ? 'Exit Design Preview' : 'Design Preview'}</button> : null;
  const sourceAdministration = section === 'data_sources';
  const foundationPage = section === 'planning' || section === 'statements';
  const notice = preview ? foundationPage ? 'Design Preview is on. This page retains its established foundation; simulated analysis does not supply accounting statements or planning evidence.' : sourceAdministration ? 'Design Preview is on. Data Sources shows actual source readiness; simulated analysis does not create connections or authority.' : 'Simulated evidence · isolated from financial records' : null;
  return <WorkspacePageActionsProvider actions={actions} notice={notice}><div className={`finance-presentation ${preview ? 'is-design-preview' : ''}`}>
    {preview && !sourceAdministration && !foundationPage ? <Suspense fallback={<p role="status">Loading simulated design evidence…</p>}><Preview section={section}/></Suspense> : children}
  </div></WorkspacePageActionsProvider>;
}
