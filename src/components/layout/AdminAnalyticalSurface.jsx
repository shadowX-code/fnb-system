import { useId } from 'react';
import DashboardSection from './DashboardSection.jsx';
import AdminSegmentedControl from '../forms/AdminSegmentedControl.jsx';

/** Shared Admin analytical frame; domains own visualizations, evidence and selection. */
export default function AdminAnalyticalSurface({ label, title = label, subtitle, modes, value, onChange, actions, children, evidence, readiness, loading = false, loadingLabel = 'Loading analysis…' }) {
  const panelId = useId();
  return <DashboardSection title={title} subtitle={subtitle} action={modes || actions ? <>{modes ? <AdminSegmentedControl label={label} value={value} onChange={onChange} options={modes.map(mode => typeof mode === 'string' ? { value: mode, label: mode, panelId } : { ...mode, panelId })} /> : null}{actions}</> : null} className="min-w-0" contentClassName="min-w-0">
    <div data-admin-analytical-surface="true" aria-busy={loading || undefined} id={panelId} role={modes ? 'tabpanel' : undefined} aria-label={modes ? value : label} className="min-w-0">{children}{loading ? <AdminAnalyticalReadiness title={loadingLabel} /> : readiness}{evidence}</div>
  </DashboardSection>;
}
export function AdminAnalyticalContext({ label, preamble, action, onAction, actions, children, evidence, regionLabel = 'Selected analysis context', controlLabel = 'Analysis actions' }) {
  const panelId = useId();
  return <section data-workspace-surface="context" data-admin-analytical-context="true" aria-label={regionLabel} className="mt-4 min-w-0 border-t border-border pt-4">
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0">{preamble ? <p className="type-caption text-text-secondary">{preamble}</p> : null}<h3 className="type-section-title font-bold text-text-primary">{label}</h3></div><AdminSegmentedControl label={controlLabel} value={action} onChange={onAction} options={actions.map(label => ({ label, value: label, panelId }))} /></div>
    <div id={panelId} role="tabpanel" aria-label={action} className="min-w-0 space-y-2 type-body-sm leading-relaxed text-text-secondary">{children}</div>{evidence}
  </section>;
}
export function AdminEvidenceDisclosure({ label, children, open }) {
  return <details data-admin-evidence="true" open={open} className="my-3 min-w-0 type-caption leading-relaxed text-text-secondary"><summary className="w-fit cursor-pointer py-2 font-medium focus-visible:outline-primary">{label}</summary><div className="min-w-0 space-y-2 py-2">{children}</div></details>;
}
export function AdminAnalyticalReadiness({ title = 'Evidence not ready', children, action }) {
  return <div role="status" data-admin-analytical-readiness="true" className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"><div className="min-w-0"><strong className="type-body-sm text-text-primary">{title}</strong><p className="mt-1 max-w-prose type-body-sm leading-relaxed text-text-secondary">{children}</p></div>{action ? <div className="shrink-0">{action}</div> : null}</div>;
}
