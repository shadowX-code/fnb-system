import { AdminAnalyticalContext, AdminAnalyticalReadiness, AdminEvidenceDisclosure } from '../../components/layout/AdminAnalyticalSurface.jsx';
import { ArrowRight } from 'lucide-react';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import './visual-system.css';

/** Presentation only: evidence presence never establishes source authority. */
export function FinanceReadiness({ title = 'Evidence not ready', children }) {
  return <AdminAnalyticalReadiness title={title} action={<button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={14} /></button>}>{children}</AdminAnalyticalReadiness>;
}
export function FinanceDisclosure({ label, children, open }) {
  return <AdminEvidenceDisclosure label={label} open={open}>{children}</AdminEvidenceDisclosure>;
}
export function FinanceMissing({ ids, metrics, registry }) {
  const missing = ids.filter((id) => metrics[id].value === null);
  return missing.length ? <FinanceDisclosure label={`Missing evidence · ${missing.length} measures`}><dl>{missing.map((id) => <div key={id}><dt>{registry[id].label}</dt><dd>{metrics[id].reason || registry[id].definition}</dd></div>)}</dl></FinanceDisclosure> : null;
}

export const financeActions = Object.freeze(['Explain', 'Compare', 'Break down']);
export function FinanceContext({ label, preamble, action, onAction, children, evidence, regionLabel = 'Selected analysis context', controlLabel = 'Analysis actions' }) {
  return <AdminAnalyticalContext label={label} preamble={preamble} action={action} onAction={onAction} actions={financeActions} evidence={evidence} regionLabel={regionLabel} controlLabel={controlLabel}>{children}</AdminAnalyticalContext>;
}

export function FinanceProvenance({ metric }) {
  return metric.provenance.length ? <ul>{metric.provenance.map((source, index) => <li key={index}>{source.demo ? 'Development illustration' : source.semantic === 'OPERATIONAL' ? 'FeedX operational evidence' : source.semantic === 'DERIVED' ? 'Derived from identified input evidence' : 'Provider evidence'} · {source.semantic.toLowerCase()} · {source.evidenceAt ? `Source time ${source.evidenceAt}` : 'Source freshness unverified'} · {source.observedAt ? `Read time ${source.observedAt}` : 'Read time unavailable'}</li>)}</ul> : <p>No validated source evidence.</p>;
}
