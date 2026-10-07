import { FinanceReadiness } from './FinanceVisualSystem.jsx';
import { FinanceChart, FinanceMark, FinanceChartTip, useFinanceGeometry, placeFinanceLabels } from './FinanceChart.jsx';
import { metricRegistry, compatibleMetricBasis } from './metrics.js';
import { costRatio } from './costs.js';
import { financialValue, movementValue } from './presentation.js';

const profitIds = ['revenue', 'cogs', 'gross_profit', 'labour', 'opex', 'ebitda'];
function ProfitCanvas({ width, dataset, selectedId, onSelect, partitioned }) {
  const left = 12, usable = width - 24;
  const share = id => id === 'revenue' ? 1 : costRatio(dataset, id)?.value / 100;
  const split = partitioned ? share('cogs') : .32;
  const target = {
    revenue: [left, 28, usable, 43],
    cogs: [left, 110, usable * split, 43],
    gross_profit: [left + usable * split, 110, usable * (1 - split), 43],
    labour: [left + usable * split, 198, usable * (partitioned ? share('labour') : .22), 43],
    opex: [left + usable * (split + (partitioned ? share('labour') : .22)), 198, usable * (partitioned ? share('opex') : .22), 43],
    ebitda: [left + usable * (partitioned ? 1 - share('ebitda') : .76), 198, usable * (partitioned ? share('ebitda') : .24), 43],
  };
  const geometry = useFinanceGeometry(target);
  return <>
    <path d={`M${width / 2} 71V92M${left + usable * split / 2} 92H${left + usable * (split + (1 - split) / 2)}M${left + usable * split / 2} 92V110M${left + usable * (split + (1 - split) / 2)} 92V178M${left + usable * split + 10} 178H${width - 24}M${left + usable * split + 10} 178V198M${width - 24} 178V198`} className="chart-link" />
    <text x="12" y="16">Revenue</text><text x="12" y="99">Consumed</text><text x={left + usable * split + 8} y="99">Retained · Gross Profit</text><text x={left + usable * split} y="187">Labour / OPEX → EBITDA</text>
    {profitIds.map(id => {
      const metric = dataset.metrics[id], [x, y, w, h] = geometry[id];
      const label = id === 'gross_profit' ? 'Gross Profit' : id === 'labour' ? 'Labour' : metricRegistry[id].label;
      return <FinanceMark key={id} className={partitioned ? 'is-partitioned' : ''} label={`Explore ${metricRegistry[id].label} flow`} selected={selectedId === id} dimmed={Boolean(selectedId) && selectedId !== id && id !== 'revenue' && !(id === 'gross_profit' && ['labour','opex','ebitda'].includes(selectedId))} onSelect={() => onSelect(id)} transform={`translate(${x} ${y})`}
        tooltip={<FinanceChartTip title={metricRegistry[id].label}>{financialValue(metric)} · {metric.completeness}{id !== 'revenue' && costRatio(dataset, id)?.value !== null ? ` · ${financialValue(costRatio(dataset, id))} of Revenue` : ''}</FinanceChartTip>}>
        <rect width={w} height={h} className={partitioned ? ['cogs', 'labour', 'opex'].includes(id) ? 'chart-pressure' : id === 'ebitda' ? 'chart-cash' : 'chart-support' : 'chart-pending'} opacity={1} />
        <rect x="-3" y="-3" width={w + 6} height={h + 6} rx="3" className="chart-focus" />
        {w > 65 ? <text x={w / 2} y="26" textAnchor="middle" style={{ fill: partitioned ? 'white' : undefined, fontWeight: 600 }}>{label}</text> : <text x={w / 2} y="26" textAnchor="middle" style={{ fill: partitioned ? 'white' : undefined }}>{id === 'labour' ? 'L' : id === 'ebitda' ? 'E' : 'O'}</text>}
        <title>{label} · {financialValue(metric)}</title>
      </FinanceMark>;
    })}
  </>;
}
export function ProfitArchitecture({ dataset, selectedId, onSelect }) {
  const metrics = dataset.metrics, missing = profitIds.every(id => metrics[id].value === null);
  // Draw amount partitions only when supplied compatible inputs actually reconcile. Otherwise slots express structure, never implied amounts.
  const partitioned = metrics.revenue.value > 0 && profitIds.every(id => metrics[id].value >= 0 && metrics[id].value !== null && metrics[id].completeness === 'complete')
    && compatibleMetricBasis(...['revenue','cogs','labour','opex'].map(id=>metrics[id]))
    && Math.abs(metrics.revenue.value - metrics.cogs.value - metrics.gross_profit.value) < .01
    && Math.abs(metrics.gross_profit.value - metrics.labour.value - metrics.opex.value - metrics.ebitda.value) < .01;
  return <div className="finance-profit-structure"><FinanceChart label="Revenue consumption and retained profit structure" dataKey={`${dataset.period.start}:${dataset.scope.id}`} height={260}>{width => <ProfitCanvas width={width} dataset={dataset} selectedId={selectedId} onSelect={onSelect} partitioned={partitioned} />}</FinanceChart>
    <ol className="finance-chart-ledger">{profitIds.map(id => <li key={id}><button type="button" aria-label={`Select ${metricRegistry[id].label} amount`} aria-pressed={selectedId === id} onClick={() => onSelect(id)}><span>{metricRegistry[id].label}</span><strong>{financialValue(metrics[id])}</strong></button></li>)}</ol>
    {missing ? <FinanceReadiness title="Profit Architecture evidence not ready">Revenue and supplied cost evidence are required. Muted layers describe the financial structure only.</FinanceReadiness> : !partitioned ? <p className="finance-analysis-muted">Structural slots only · proportional partitions require complete, compatible inputs that reconcile. Supplied amounts retain their own basis.</p> : <p className="finance-analysis-muted">Partitions use supplied amounts relative to Revenue. COGS is consumed first; Labour and OPEX consume Gross Profit, leaving EBITDA.</p>}
  </div>;
}
function ContributionCanvas({ width, movement, selectedId, onSelect }) {
  const bound = Math.max(1, ...movement.rows.map(row => Math.abs(row.contribution ?? 0)), Math.abs(movement.total.value ?? 0));
  const left = 64, right = width - 18, zero = left + (right - left) / 2, half = (right - left) / 2;
  const rows = [...movement.rows, { id: 'ebitda', contribution: movement.total.value, included: true }];
  const geometry = useFinanceGeometry(Object.fromEntries(rows.map((row, index) => [row.id, [zero + Math.min(0, row.contribution ?? 0) / bound * half, 46 + index * 44, Math.abs(row.contribution ?? 0) / bound * half]])));
  return <><text x={zero - 8} y="16" textAnchor="end">← Reduces</text><text x={zero + 8} y="16">Supports →</text><path d={`M${zero} 27V${46 + rows.length * 44 - 12}`} className="chart-axis" />
    {rows.map((row, index) => {
      const [x, y, length] = geometry[row.id], label = row.id === 'ebitda' ? 'Net EBITDA' : row.id === 'labour' ? 'Labour' : metricRegistry[row.id].label;
      return <FinanceMark key={row.id} label={row.id === 'ebitda' ? 'Explore EBITDA movement' : `Explore ${metricRegistry[row.id].label} driver`} selected={selectedId === row.id} dimmed={Boolean(selectedId) && selectedId !== row.id} onSelect={() => onSelect(row.id)} tooltip={<FinanceChartTip title={label}>{row.contribution === null ? row.included ? 'Comparable contribution evidence required' : 'Outside this EBITDA basis' : `${movementValue({ value: row.contribution })} · ${row.contribution < 0 ? 'Reduces' : 'Supports'} EBITDA`}</FinanceChartTip>}>
        <rect x="0" y={y - 14} width={width} height="42" fill="transparent" />
        <text x="0" y={y + 4} className="chart-label" style={{fontSize:10}}>{label}</text>
        {row.contribution === null ? <rect x={left} y={y - 9} width={right - left} height="18" className="chart-pending" /> : <><rect x={x} y={y - 9} width={Math.max(1, length)} height="18" rx="2" className={row.id === 'ebitda' ? 'chart-cash' : row.contribution < 0 ? 'chart-pressure' : 'chart-support'} /><text x={zero} y={y + 23} textAnchor="middle">{movementValue({value:row.contribution})}</text></>}
        <rect x={left - 3} y={y - 13} width={right - left + 6} height="39" rx="3" className="chart-focus" />
        {index === rows.length - 1 ? <path d={`M0 ${y - 19}H${width}`} className="chart-grid" /> : null}
      </FinanceMark>;
    })}</>;
}
export function DriverContribution({ movement, selectedId, onSelect }) {
  return <FinanceChart label="Driver Contribution" dataKey={JSON.stringify(movement)} height={movement.rows.length * 44 + 100}>{width => <ContributionCanvas width={width} movement={movement} selectedId={selectedId} onSelect={onSelect} />}</FinanceChart>;
}
function PressureCanvas({ width, rows, selectedId, onSelect }) {
  const ready = rows.filter(row => row.growth.value !== null && row.revenueGrowth.value !== null && row.ratioMovement.value !== null);
  const xb = Math.max(.1, ...ready.map(row => Math.abs(row.growth.value - row.revenueGrowth.value))) * 1.2;
  const yb = Math.max(.1, ...ready.map(row => Math.abs(row.ratioMovement.value))) * 1.2;
  const left = 54, right = width - 20, middle = (left + right) / 2, top = 36, bottom = 266, center = (top + bottom) / 2;
  const material = Math.max(1, ...ready.map(row => Math.abs(row.current.value ?? 0)));
  const geometry = useFinanceGeometry(Object.fromEntries(ready.map(row => [row.id, [middle + (row.growth.value - row.revenueGrowth.value) / xb * (right - left) / 2, center - row.ratioMovement.value / yb * (bottom - top) / 2, Math.max(5,15 * Math.sqrt(Math.abs(row.current.value ?? 0) / material))]])));
  const labels = placeFinanceLabels(ready.map(row => ({id:row.id,label:row.label ?? metricRegistry[row.id].label,x:geometry[row.id][0],y:geometry[row.id][1]})), width, top, bottom, selectedId);
  return <><rect x={left} y={top} width={right-left} height={bottom-top} className="chart-surface" /><rect x={middle} y={top} width={right-middle} height={center-top} className="finance-map-pressure"/><rect x={left} y={center} width={middle-left} height={bottom-center} className="finance-map-support"/>
    <text x={left} y="20">Share rises</text><text x={right} y="20" textAnchor="end">Margin pressure</text>
    {[-1,-.5,0,.5,1].map(tick => <g key={tick}><path d={`M${middle+tick*(right-left)/2} ${top}V${bottom}M${left} ${center-tick*(bottom-top)/2}H${right}`} className={tick === 0 ? 'chart-axis' : 'chart-grid'} /><text x={middle+tick*(right-left)/2} y={bottom+18} textAnchor="middle">{ready.length ? `${(tick*xb).toFixed(1)}` : tick === 0 ? '0' : '—'}</text><text x={left-7} y={center-tick*(bottom-top)/2+4} textAnchor="end">{ready.length ? (tick*yb).toFixed(2) : tick === 0 ? '0' : '—'}</text></g>)}
    <text x={middle} y="310" textAnchor="middle">Cost growth − Revenue growth · pp</text><text x="11" y={center} textAnchor="middle" transform={`rotate(-90 11 ${center})`}>Cost share change · pp</text>
    {ready.map(row => { const [x,y,r] = geometry[row.id], label = row.label ?? metricRegistry[row.id].label; return <FinanceMark key={row.id} label={`Investigate ${label} pressure`} selected={row.id === selectedId} dimmed={Boolean(selectedId) && row.id !== selectedId && !row.id.startsWith(`${selectedId}.`)} onSelect={() => onSelect(row.id)} transform={`translate(${x} ${y})`} tooltip={<FinanceChartTip title={label}>{financialValue(row.current)} · cost growth {row.growth.value.toFixed(2)}% · Revenue growth {row.revenueGrowth.value.toFixed(2)}% · share change {row.ratioMovement.value > 0 ? '+' : ''}{row.ratioMovement.value.toFixed(3)} pp</FinanceChartTip>}>
      <circle r={Math.max(22,r+5)} fill="transparent"/><circle r={r} className={`chart-point ${row.direction === 'pressure' ? 'chart-pressure' : row.direction === 'stable' ? 'chart-cash' : 'chart-support'}`}/><circle r={r+4} className="chart-focus"/>{labels[row.id] ? <path d={`M0 0L${labels[row.id].x-x-3} ${labels[row.id].y-y-4}`} className={`chart-link ${row.id===selectedId ? 'is-active' : ''}`}/> : null}{labels[row.id] ? <text x={labels[row.id].x-x} y={labels[row.id].y-y} className="chart-label" style={{fontSize:11,pointerEvents:'none'}}>{label.length > 23 ? `${label.slice(0,21)}…` : label}</text> : null}
    </FinanceMark>; })}</>;
}
export function MarginPressureMap({ rows, selectedId, onSelect }) {
  const ready = rows.filter(row => row.growth.value !== null && row.revenueGrowth.value !== null && row.ratioMovement.value !== null);
  return <section data-workspace-surface="analysis" className="finance-margin-map" aria-labelledby="finance-margin-map-title"><div className="finance-analysis-heading"><div><h2 id="finance-margin-map-title">Margin Pressure Map</h2><p>Cost growth relative to Revenue meets cost-share pressure on margin.</p></div></div>
    <FinanceChart label="Cost growth relative to Revenue and margin impact" dataKey={JSON.stringify(rows.map(row=>[row.id,row.current.value,row.ratioMovement.value]))} height={326}>{width => <PressureCanvas width={width} rows={rows} selectedId={selectedId} onSelect={onSelect}/>}</FinanceChart>
    {!ready.length ? <FinanceReadiness title="Margin pressure evidence not ready">Comparable costs and positive Revenue are required. No cost items have been positioned.</FinanceReadiness> : <p className="finance-analysis-muted">Point area follows supplied cost amount, with a minimum visible radius. Zero compares growth and share, not a target. Coincident points retain their coordinates; every item remains selectable in Cost Movements.</p>}
  </section>;
}
