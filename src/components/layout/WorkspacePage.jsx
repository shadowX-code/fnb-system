import { createContext, useContext } from 'react';
import PageHeader from './PageHeader.jsx';

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
  const commands = actions || shared?.actions ? <>{actions}{shared?.actions}</> : null;
  return <div className="min-w-0 space-y-5" data-workspace-page>
    <header aria-label={`${title} context`}>
      <PageHeader section={section} title={title} description={description} actions={commands} />
    </header>
    {shared?.notice ? <p className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-text-secondary" role="status">{shared.notice}</p> : null}
    {controls}
    <div className={`min-w-0 space-y-5 ${className}`} data-workspace-content>{children}</div>
  </div>;
}
