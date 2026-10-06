import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import { metricRegistry, metricMovement } from './metrics.js';
import { financialPeriod, financialSemantics, financialValue, movementValue } from './presentation.js';
import { profitDriverIds } from './analysis.js';

/** Reusable selected-context grammar. Add actions here only when backed by validated evidence. */
export const analysisActions = Object.freeze(['Explain', 'Compare', 'Break down']);
export default function AnalysisContext({ pair, metricId, outletLabel, action, onAction, onMetric, outlets = [], onOutlet }) {
  const metric = pair.current.metrics[metricId], previous = pair.previous.metrics[metricId];
  const movement = metricMovement(metric, previous);
  const dependencies = metricId === 'ebitda' ? profitDriverIds : metricRegistry[metricId].dependencies;
  return <section className="finance-analysis-context" aria-label="Selected analysis context">
    <div className="finance-analysis-heading"><div><p className="finance-analysis-muted">{outletLabel || 'Selected scope'} · selected context</p><h3>{metricRegistry[metricId].label}</h3></div><AdminSegmentedControl label="Analysis actions" className="finance-analysis-actions" value={action} onChange={onAction} options={analysisActions.map((label) => ({ value: label, label, panelId: 'finance-analysis-action-panel' }))} /></div>
    <div id="finance-analysis-action-panel" role="tabpanel" aria-label={action} className="finance-analysis-action-content">
      {action === 'Explain' ? <>
        <p><strong>{financialValue(metric)}</strong> in {financialPeriod(pair.current.period)}. {movement.value !== null ? `${movementValue(movement, metric.unit)} versus ${financialPeriod(pair.previous.period)}.` : movement.reason}</p>
        <p>{metric.reason || metricRegistry[metricId].definition}</p>
        <p className="finance-analysis-muted">Next investigation: {metric.value === null ? 'review the missing source evidence in Data Sources.' : dependencies.length ? 'break down the validated inputs and compare their period movement.' : 'compare the same measure across eligible outlets below. Outlet evidence does not establish product, supplier or labour causes.'}</p>
      </> : action === 'Compare' ? <div className="finance-analysis-table-wrap"><table className="finance-analysis-table"><caption>Selected measure · {outletLabel || 'selected scope'}</caption><thead><tr><th>Period</th><th>Value</th><th>Evidence</th></tr></thead><tbody>{[pair.previous, pair.current].map((dataset) => <tr key={dataset.period.start}><td>{financialPeriod(dataset.period)}</td><td>{financialValue(dataset.metrics[metricId])}</td><td>{financialSemantics(dataset.metrics[metricId])} · {dataset.metrics[metricId].completeness}</td></tr>)}</tbody></table><p>Movement: {movementValue(movement, metric.unit)}{movement.reason ? ` · ${movement.reason}` : ''}</p></div> : <>
        <p>{dependencies.length ? 'Select an input to continue investigating in this workspace.' : 'Select an outlet in the performance field to examine this measure. Finer source-line breakdown is unavailable.'}</p>
        {dependencies.length ? <div className="finance-analysis-inputs">{dependencies.map((id) => <button key={id} className="btn-secondary" type="button" onClick={() => onMetric(id)}>{metricRegistry[id].label}<span>{financialValue(pair.current.metrics[id])}</span></button>)}</div> : null}
        {!outletLabel && outlets.length ? <div className="finance-analysis-table-wrap"><table className="finance-analysis-table"><caption>Outlet breakdown · {metricRegistry[metricId].label}. Outlet evidence may not exhaust the selected scope.</caption><thead><tr><th>Outlet</th><th>Current</th><th>Comparison</th><th>Movement</th></tr></thead><tbody>{outlets.map((outlet) => <tr key={outlet.id}><th scope="row"><button type="button" disabled={!outlet.pair} onClick={() => onOutlet(outlet.id)}>{outlet.name}</button></th><td>{financialValue(outlet.pair?.current.metrics[metricId])}</td><td>{financialValue(outlet.pair?.previous.metrics[metricId])}</td><td>{outlet.pair ? movementValue(metricMovement(outlet.pair.current.metrics[metricId], outlet.pair.previous.metrics[metricId]), metric.unit) : 'Unavailable'}</td></tr>)}</tbody></table></div> : null}
        <p className="finance-analysis-muted">Accounting classifications and deeper drivers remain unavailable until validated source evidence exists.</p>
      </>}
    </div>
    <details className="finance-analysis-evidence"><summary>Evidence & definition for {metricRegistry[metricId].label}</summary><p>{metricRegistry[metricId].definition}</p>{[pair.current, pair.previous].map((dataset) => {
      const value = dataset.metrics[metricId];
      return <div key={dataset.period.start}><strong>{financialPeriod(dataset.period)} · {financialSemantics(value)} · {value.completeness}</strong><p>{value.reason}</p>{value.provenance.length ? <ul>{value.provenance.map((source, index) => <li key={index}>{source.demo ? 'Development illustration' : source.semantic === 'OPERATIONAL' ? 'FeedX operational evidence' : source.semantic === 'DERIVED' ? 'Derived from identified input evidence' : 'Provider evidence'} · {source.semantic.toLowerCase()} · {source.evidenceAt ? `Source time ${source.evidenceAt}` : 'Source freshness unverified'} · {source.observedAt ? `Read time ${source.observedAt}` : 'Read time unavailable'}</li>)}</ul> : <p>No validated source evidence.</p>}</div>;
    })}</details>
  </section>;
}
