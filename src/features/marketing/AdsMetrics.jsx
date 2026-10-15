import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import { adsMetric, adsMetricNames, adsMetricDefinitions, metricComparison, adsResultGroups, adsResultLabel } from './adsPresentation.js';
const primary = ['spend', 'reach', 'clicks', 'cpc'];
export function MetricGrid({row, previous, currency}) {
  return <div className="ads-kpis">
    <AdminSummaryGrid variant="compact" mobileColumns={2} ariaLabel="Advertising performance" items={primary.map(key => ({key, label: adsMetricNames[key], value: adsMetric(row?.metrics?.[key], key, currency), title: adsMetricDefinitions[key], helper: row?.metrics?.[key]?.state === 'estimated' ? 'Estimated by Meta' : row?.metrics?.[key]?.state === 'derived' ? 'Calculated from confirmed campaigns' : undefined, delta: metricComparison(row?.metrics?.[key], previous?.metrics?.[key]) ? `${metricComparison(row.metrics[key], previous.metrics[key])} vs previous period` : undefined}))}/>
    <dl className="ads-supporting-metrics">{['impressions','ctr','cpm'].map(key => <div key={key}><dt title={adsMetricDefinitions[key]}>{adsMetricNames[key]}{row?.metrics?.[key]?.state === "derived" ? " · calculated" : row?.metrics?.[key]?.state === "estimated" ? " · estimated" : ""}</dt><dd>{adsMetric(row?.metrics?.[key],key,currency)}</dd><small>{metricComparison(row?.metrics?.[key],previous?.metrics?.[key]) ? `${metricComparison(row.metrics[key],previous.metrics[key])} vs previous period` : 'Comparison unavailable'}</small></div>)}</dl>
  </div>;
}
export function Results({row}) {
  if (!row?.actions?.length) return <p className="text-sm text-text-secondary">Results unavailable for this period.</p>;
  const groups = adsResultGroups.map(group => ({...group, actions: group.types.map(type => row.actions.find(a => a.type === type)).filter(Boolean)})).filter(group => group.actions.length);
  const value = action => <><strong>{adsMetric({value:action.value},'clicks')}</strong><small>{row.cost_per_action_type?.find(a => a.type === action.type)?.value != null ? `${adsMetric({value:row.cost_per_action_type.find(a=>a.type===action.type).value},'spend',row.currency)} / result` : 'Cost unavailable'}</small></>;
  return <section className="ads-results" aria-label="Results summaries">
    <div className="ads-section-heading"><h3>Results</h3><span>Separate Meta action counts · may overlap</span></div>
    <div className="ads-result-groups">{groups.map(group => <section key={group.label}><h4>{group.label}</h4><dl>{group.actions.map(action => <div key={action.type}><dt>{adsResultLabel(action.type)}</dt><dd>{value(action)}</dd></div>)}</dl></section>)}</div>
    <details className="ads-advanced"><summary>Advanced Details · all Meta actions ({row.actions.length})</summary><dl>{row.actions.map(action => <div className="ads-raw-result" key={action.type}><dt>{action.type}</dt><dd>{value(action)}</dd></div>)}</dl><p>{row.attribution || 'Meta attribution settings apply. Conversions are not verified FeedX sales.'}</p></details>
  </section>;
}
