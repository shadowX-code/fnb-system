import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import FinanceComparisonWorkspace from './FinanceComparisonWorkspace.jsx';
import AnalysisContext from './AnalysisContext.jsx';
import CostMovement from './CostMovement.jsx';
import { metricRegistry, metricMovement } from './metrics.js';
import { costChildren, costDiagnostic, costIntelligence, costRatio, costStateIds } from './costs.js';
import { costObservation, financialPeriod, financialSemantics, financialValue, movementValue } from './presentation.js';
import './costs.css';

const flowIds = ['revenue', 'cogs', 'gross_profit', 'labour', 'opex', 'ebitda'];
function CostState({ pair, onSelect }) {
  return <dl className="finance-performance-strip" aria-label="Cost state">{costStateIds.map((id) => <div key={id}><dt><button type="button" onClick={() => onSelect(id)}>{metricRegistry[id].label}</button></dt><dd><strong>{financialValue(pair.current.metrics[id])}</strong><span>{financialValue(costRatio(pair.current, id))}{id === 'ebitda' ? ' margin' : ' of Revenue'}</span><small>{financialSemantics(pair.current.metrics[id])} · {pair.current.metrics[id].completeness}</small></dd></div>)}</dl>;
}
function CostFlow({ pair, selectedId, onSelect, basis }) {
  return <section className="finance-cost-flow" aria-labelledby="finance-cost-flow-title"><div className="finance-analysis-heading"><div><h2 id="finance-cost-flow-title">How Revenue Becomes Profit</h2><p>Select a layer to trace its cost, revenue share and period movement.</p></div></div>
    <ol className="finance-cost-flow-path">{flowIds.map((id) => <li key={id} className={pair.current.metrics[id].value === null ? 'is-unavailable' : ''}><button type="button" aria-label={`Explore ${metricRegistry[id].label} layer`} aria-pressed={selectedId === id} onClick={() => onSelect(id)}><span className="finance-cost-flow-label">{metricRegistry[id].label}</span><strong>{financialValue(pair.current.metrics[id])}</strong><span>{id === 'revenue' ? 'Revenue base' : `${financialValue(costRatio(pair.current, id))} ${id === 'gross_profit' || id === 'ebitda' ? 'retained' : 'consumed'}`}</span><small>{pair.current.metrics[id].value === null ? 'Evidence unavailable' : financialSemantics(pair.current.metrics[id])}</small></button></li>)}</ol>
    <p className="finance-analysis-muted">{basis}. Gross Profit and Labour remain visible when unavailable; the flow does not reconstruct them or subtract Labour a second time from operational EBITDA.</p>
  </section>;
}
function MovementRows({ rows, selectedId, onSelect, title = 'Cost layer movements' }) {
  return <ol className="finance-cost-movement-list" aria-label={title}>{rows.map((row) => <li key={row.id} className={selectedId === row.id ? 'is-selected' : ''}><div className="finance-cost-row-heading"><button type="button" aria-label={`Investigate ${row.label ?? metricRegistry[row.id].label}`} aria-pressed={selectedId === row.id} onClick={() => onSelect(row.id)}><strong>{row.label ?? metricRegistry[row.id].label}</strong><ArrowRight size={14} /></button><span className="finance-cost-amount-pair">{financialValue(row.previous)} <span aria-hidden="true">→</span> {financialValue(row.current)}<strong>{movementValue(row.movement)}</strong></span></div><CostMovement row={row} /><p className="finance-analysis-muted">{costObservation(row, row.label ?? metricRegistry[row.id].label)}</p></li>)}</ol>;
}
export function FinanceCosts({ analysis }) {
  const model = costIntelligence(analysis);
  const [selectedId, setSelectedId] = useState('cogs');
  const [action, setAction] = useState('Explain');
  const parentId = selectedId.includes('.') ? selectedId.split('.')[0] : selectedId;
  const classified = costChildren(analysis, parentId, analysis.profitDriverModel);
  const child = classified.rows.find((row) => row.id === selectedId);
  const pair = child?.pair ?? analysis;
  const label = child?.label ?? metricRegistry[selectedId].label;
  const row = child ?? model.rows.find((entry) => entry.id === selectedId) ?? costDiagnostic(pair, selectedId);
  const select = (id) => setSelectedId(id);
  const rootCost = ['cogs', 'labour', 'opex'].includes(selectedId);
  const isCost = rootCost || Boolean(child) || selectedId === 'prime_cost';
  const definition = child ? { label, definition: `Validated ${label} evidence within ${metricRegistry[parentId].label}; retains the supplied parent cost basis.`, dependencies: [] } : undefined;
  const breakdown = <>
    {rootCost ? <><p>{classified.reason}</p>{classified.rows.length ? <MovementRows title={`${label} classified movements`} rows={classified.rows} selectedId={selectedId} onSelect={select} /> : <p className="finance-analysis-muted">Food, labour and operating classifications require mapped source evidence. No account amounts or operational causes are inferred.</p>}</> : child ? <p>Further source-line, supplier, payroll and recipe evidence is unavailable for this classification.</p> : <><p>Select a supplied input to continue in this workspace. Inputs may not establish a complete financial relationship.</p><div className="finance-analysis-inputs">{(metricRegistry[selectedId]?.dependencies ?? []).filter((id) => metricRegistry[id].unit === 'money').map((id) => <button key={id} type="button" className="btn-secondary" onClick={() => select(id)}>{metricRegistry[id].label}<span>{financialValue(analysis.current.metrics[id])}</span></button>)}</div></>}
  </>;
  const explanation = <><p>{costObservation(row, label)}</p><p>{row.current.reason || definition?.definition || metricRegistry[selectedId].definition}</p>{isCost ? <CostMovement row={row} /> : null}<p className="finance-analysis-muted">Next investigation: {rootCost ? 'break down the available classifications, then compare their cost share.' : child ? 'return to the parent layer to compare the remaining classifications.' : 'select a cost layer in the flow to examine its available evidence.'} Movements describe financial relationships; they do not establish business causes.</p></>;
  const comparison = <><div className="finance-analysis-table-wrap"><table className="finance-analysis-table"><caption>{label} · period comparison</caption><thead><tr><th>Period</th><th>Amount</th><th>Revenue share</th><th>Evidence</th></tr></thead><tbody>{[[pair.previous, row.previous, row.previousRatio], [pair.current, row.current, row.currentRatio]].map(([dataset, metric, ratio]) => <tr key={dataset.period.start}><td>{financialPeriod(dataset.period)}</td><td>{financialValue(metric)}</td><td>{selectedId === 'revenue' ? 'Revenue base' : financialValue(ratio)}</td><td>{financialSemantics(metric)} · {metric.completeness}</td></tr>)}</tbody></table></div><p>Amount movement: {movementValue(row.movement)}</p>{isCost ? <CostMovement row={row} /> : null}</>;
  const total = metricMovement(analysis.current.metrics.ebitda, analysis.previous.metrics.ebitda);
  return <div className="finance-analysis-body finance-costs-body">
    {analysis.current.demo ? <p className="finance-demo" role="status">Development demo · All figures and classifications are illustrative. No business records are used.</p> : null}
    <div className="finance-analysis-heading"><div><p className="finance-analysis-muted">{financialPeriod(analysis.current.period)} compared with {financialPeriod(analysis.previous.period)}</p><h2>Cost & margin state</h2></div><span className="finance-cost-ebitda">EBITDA movement <strong>{movementValue(total)}</strong></span></div>
    <CostState pair={analysis} onSelect={select} />
    <details className="finance-analysis-evidence"><summary>Cost source & completeness</summary><p>{analysis.current.sourceLabel}. Ratios use complete, compatible cost evidence and positive Revenue. Operational purchase-based COGS is not accounting COGS; missing Gross Profit, Labour and Prime Cost are not inferred. Read time does not establish source freshness.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={14} /></button></details>
    <CostFlow pair={analysis} selectedId={parentId} onSelect={select} basis={model.attribution.label} />
    <section className="finance-cost-exploration" aria-label="Cost driver exploration"><nav aria-label="Cost drill path"><button type="button" onClick={() => select('cogs')}>Costs</button><span aria-hidden="true">/</span>{child ? <><button type="button" onClick={() => select(parentId)}>{metricRegistry[parentId].label}</button><span aria-hidden="true">/</span></> : null}<span aria-current="page">{label}</span></nav>
      <AnalysisContext pair={pair} metricId={selectedId} definition={definition} action={action} onAction={setAction} onMetric={select} explanation={isCost ? explanation : undefined} comparison={comparison} breakdown={breakdown} />
    </section>
    <section className="finance-cost-leaks" aria-labelledby="finance-cost-leaks-title"><div className="finance-analysis-heading"><div><h2 id="finance-cost-leaks-title">Margin pressure & improvements</h2><p>Largest absolute revenue-share movements first, then amount movement. Prime Cost overlaps COGS and Labour and is not counted again.</p></div></div>
      <MovementRows rows={model.rows} selectedId={parentId} onSelect={select} />
      <p className="finance-analysis-muted">{model.attribution.reason || 'Signed contributions reconcile to the supplied EBITDA movement; Revenue movement is shown separately.'} Revenue contribution: {movementValue({ value: model.attribution.rows.find((entry) => entry.id === 'revenue')?.contribution ?? null })}. Classification contributions require a complete partition of the parent in both periods. Broadly stable share means less than 0.1pp movement; it is not a margin target.</p>
    </section>
  </div>;
}
export default function FinanceCostsPage(props) {
  return <FinanceComparisonWorkspace {...props} title="Costs" description="Trace margin consumption, understand cost movement, and investigate the pressure behind it.">{(analysis) => <FinanceCosts analysis={analysis} />}</FinanceComparisonWorkspace>;
}
