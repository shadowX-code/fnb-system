import { createContext, useContext } from 'react';
import PageHeader from './PageHeader.jsx';
import './workspace.css';

const WorkspaceActions = createContext(null);
/** Presentation slots only. Features own scope, period, action callbacks and evidence. */
export function WorkspacePageActionsProvider({ actions, notice, children }) {
  return <WorkspaceActions.Provider value={{ actions, notice }}>{children}</WorkspaceActions.Provider>;
}
export function WorkspaceSurface({ as: Element = 'section', tone = 'analysis', children, ...props }) {
  return <Element {...props} data-workspace-surface={tone}>{children}</Element>;
}
export default function WorkspacePage({ section, title, description, controls, actions, children, className = '' }) {
  const shared = useContext(WorkspaceActions);
  return <div className={`admin-workspace-page ${className}`}>
    <header className="admin-context-header" aria-label={`${title} context`}>
      <PageHeader section={section} title={title} description={description} variant="context" />
      {actions || shared?.actions ? <div className="admin-context-actions">{actions}{shared?.actions}</div> : null}
      {controls ? <div className="admin-context-controls">{controls}</div> : null}
      {shared?.notice ? <p className="admin-context-notice" role="status">{shared.notice}</p> : null}
    </header>
    <div className="admin-workspace-canvas">{children}</div>
  </div>;
}
