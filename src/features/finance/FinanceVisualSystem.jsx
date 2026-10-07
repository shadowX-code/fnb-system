import { useId } from 'react';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import { ArrowRight } from 'lucide-react';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import './visual-system.css';

/** Presentation only: evidence presence never establishes source authority. */
export function FinanceReadiness({ title = 'Evidence not ready', children }) {
  return <div className="finance-readiness" role="status"><div><strong>{title}</strong><p>{children}</p></div><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={14} /></button></div>;
}
export function FinanceDisclosure({ label, children, open }) {
  return <details className="finance-disclosure" open={open}><summary>{label}</summary><div>{children}</div></details>;
}
export function FinanceMissing({ ids, metrics, registry }) {
  const missing = ids.filter((id) => metrics[id].value === null);
  return missing.length ? <FinanceDisclosure label={`Missing evidence · ${missing.length} measures`}><dl>{missing.map((id) => <div key={id}><dt>{registry[id].label}</dt><dd>{metrics[id].reason || registry[id].definition}</dd></div>)}</dl></FinanceDisclosure> : null;
}

export const financeActions = Object.freeze(['Explain', 'Compare', 'Break down']);
export function FinanceContext({ label, preamble, action, onAction, children, evidence, regionLabel = 'Selected analysis context', controlLabel = 'Analysis actions' }) {
  const panelId = useId();
  return <section data-workspace-surface="context" className="finance-analysis-context" aria-label={regionLabel}><div className="finance-analysis-heading"><div>{preamble ? <p className="finance-analysis-muted">{preamble}</p> : null}<h3>{label}</h3></div><AdminSegmentedControl label={controlLabel} className="finance-analysis-actions" value={action} onChange={onAction} options={financeActions.map((label) => ({ label, value: label, panelId }))} /></div><div id={panelId} role="tabpanel" aria-label={action} className="finance-analysis-action-content">{children}</div>{evidence}</section>;
}

export function FinanceProvenance({ metric }) {
  return metric.provenance.length ? <ul>{metric.provenance.map((source, index) => <li key={index}>{source.demo ? 'Development illustration' : source.semantic === 'OPERATIONAL' ? 'FeedX operational evidence' : source.semantic === 'DERIVED' ? 'Derived from identified input evidence' : 'Provider evidence'} · {source.semantic.toLowerCase()} · {source.evidenceAt ? `Source time ${source.evidenceAt}` : 'Source freshness unverified'} · {source.observedAt ? `Read time ${source.observedAt}` : 'Read time unavailable'}</li>)}</ul> : <p>No validated source evidence.</p>;
}
