import { authorityPlan, validateAuthorityPeriods, validatePeriod } from './foundation.js';
import { operationalProvider } from './providers/operationalProvider.js';

export const mappingLabels = Object.freeze({
  account: 'Accounts → financial classifications',
  outlet_dimension: 'Locations / dimensions → outlets / dimensions',
  supplier: 'Suppliers',
  product_uom: 'Products / UOM',
});
export const connectionActions = Object.freeze([
  { id: 'connect', label: 'Connect provider' },
  { id: 'manage', label: 'Manage connection' },
  { id: 'sync', label: 'Sync accounting data' },
  { id: 'deactivate', label: 'Deactivate connection' },
]);

/** Canonical management read seam. No persistent accounting provider is configured in Phase 1.
 * Replace the empty collections only with an authorized trusted read, never browser vendor data.
 * Operational Reporting is a source owner, not an accounting tenant or entity connection.
 */
export async function readFinanceDataSources() {
  return {
    connections: [], authorityPeriods: [], mappingReadiness: [], reconciliations: [],
    operationalSource: { providerId: operationalProvider.id, label: 'FeedX Reporting', capabilities: operationalProvider.capabilities },
  };
}

/** Readiness describes evidence, never a guessed percentage. Historical connections stay in view. */
export function dataSourceReadiness(state, authorityRequest = null) {
  validateAuthorityPeriods(state.authorityPeriods);
  state.mappingReadiness.forEach((entry) => {
    validatePeriod(entry.period);
    if (!Object.hasOwn(mappingLabels, entry.kind) || !Number.isInteger(entry.mapped) || entry.mapped < 0 || !Number.isInteger(entry.unresolved) || entry.unresolved < 0) throw new Error('Invalid mapping readiness evidence');
  });
  const active = state.connections.filter((entry) => entry.status === 'active' && entry.state === 'connected');
  const historical = state.connections.filter((entry) => entry.status === 'historical');
  const coverage = authorityRequest ? authorityPlan(state.authorityPeriods, authorityRequest) : null;
  const mappingKinds = new Set(state.mappingReadiness.map((entry) => entry.kind));
  const unresolved = state.mappingReadiness.some((entry) => entry.unresolved > 0);
  const issues = [];
  if (!active.length) issues.push('No active accounting connection.');
  if (!state.authorityPeriods.length) issues.push('Accounting authority periods have not been assigned.');
  else if (!coverage) issues.push('Authority coverage has not been assessed for a selected entity, resource and period.');
  else if (coverage.gaps.length) issues.push('The selected authority period contains uncovered dates.');
  if (mappingKinds.size < Object.keys(mappingLabels).length) issues.push('Mapping evidence is not available for every mapping type.');
  if (unresolved) issues.push('Unresolved mappings require review.');
  if (!state.reconciliations.length) issues.push('No validated reconciliation evidence is available.');
  else if (state.reconciliations.some((entry) => entry.reconciliation.status !== 'reconciled')) issues.push('Reconciliation review is incomplete.');
  state.connections.forEach((entry) => {
    if (entry.state === 'error' || entry.sync.some((sync) => sync.status === 'failed')) issues.push(`${entry.providerLabel}: connection or sync needs attention.`);
  });
  return {
    coverage, issues,
    summary: [
      { label: 'Connection', value: active.length ? `${active.length} active` : 'Not connected', detail: historical.length ? `${historical.length} historical · retained for history` : 'No historical accounting connections' },
      { label: 'Authority coverage', value: !state.authorityPeriods.length ? 'Not assigned' : coverage ? coverage.gaps.length ? 'Gaps identified' : 'Covered for selected period' : 'Not assessed', detail: coverage ? `${coverage.segments.length} authority segments · ${coverage.gaps.length} gaps` : `${state.authorityPeriods.length} defined resource periods` },
      { label: 'Mapping readiness', value: !state.mappingReadiness.length ? 'Not assessed' : unresolved ? 'Needs review' : mappingKinds.size === Object.keys(mappingLabels).length ? 'Mapped evidence available' : 'Partial evidence', detail: !state.mappingReadiness.length ? 'Awaiting provider records' : 'Counts apply to the source, scope and period shown' },
      { label: 'Reconciliation', value: !state.reconciliations.length ? 'Not assessed' : state.reconciliations.every((entry) => entry.reconciliation.status === 'reconciled') ? 'Reconciled evidence available' : 'Needs review', detail: `${state.reconciliations.length} validated comparison records` },
      { label: 'Unresolved issues', value: issues.length ? 'Assessment incomplete' : 'No identified blockers', detail: 'Known blockers shown below; no completeness score is inferred' },
    ],
  };
}

export function overviewDataStatus(dataset) {
  const metrics = Object.values(dataset.metrics);
  const present = metrics.filter((metric) => metric.value !== null);
  const sources = [...new Set(metrics.flatMap((metric) => metric.provenance.map((source) => source.semantic)))];
  const evidence = present.flatMap((metric) => metric.provenance);
  const timestamps = evidence.map((source) => source.evidenceAt);
  // The oldest source bounds usable freshness; a read timestamp is never source freshness.
  const evidenceAt = timestamps.length && timestamps.every((value) => value && Number.isFinite(Date.parse(value))) ? [...timestamps].sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null;
  return { sourceLabel: dataset.sourceLabel, semantics: sources, evidenceAt, available: present.length, total: metrics.length, completeness: metrics.every((metric) => metric.completeness === 'complete') ? 'Complete' : 'Partial / unavailable', demo: dataset.demo };
}
