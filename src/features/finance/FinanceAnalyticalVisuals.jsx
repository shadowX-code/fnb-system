import {adminChartScale} from '../../components/ui/AdminChart.jsx';
import { FinanceReadiness } from './FinanceVisualSystem.jsx';
import { FinanceChart, FinanceMark, FinanceChartTip, useFinanceGeometry, placeFinanceLabels, financeChartMoney, financeMetricColor, financeChartColors } from './FinanceChart.jsx';
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
        <rect width={w} height={h} fill={partitioned?financeMetricColor(id):'none'} className={partitioned?'':'chart-pending'} opacity={1} />
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
/** Projection of validated attribution only; never establishes a new profit relationship. */
function ContributionCanvas({ width, movement, pair, selectedId, selectedStage, onSelect, compact }) {
  const previous = pair?.previous.metrics.ebitda.value, current = pair?.current.metrics.ebitda.value;
  const reconciled = movement.attributable && Number.isFinite(previous) && Number.isFinite(current);
  let position = previous;
  const drivers = movement.rows.map(row => {
    const from = position;
    if (reconciled && row.included) position += row.contribution;
    return { ...row, from: reconciled ? from : null, to: reconciled ? position : null };
  });
  const stages = [{ id: 'previous', metricId: 'ebitda', label: 'Previous EBITDA', from: previous, to: Number.isFinite(previous) ? previous : null }, ...drivers.map(row => ({ ...row, metricId: row.id, label: row.id === 'labour' ? 'Labour' : metricRegistry[row.id].label })), { id: 'current', metricId: 'ebitda', label: 'Current EBITDA', from: current, to: Number.isFinite(current) ? current : null }];
  const values = stages.flatMap(stage => stage.to === null ? [] : [stage.from, stage.to]);
  const {min:low,max:high,ticks} = adminChartScale(values, 3, {includeZero:false}), span = high - low;
  const mobile = width < 560, height = mobile ? 414 : compact ? 292 : 346;
  const left = mobile ? 102 : 56, right = width - 12, top = 28, bottom = height - (mobile ? 68 : 100);
  const scale = amount => mobile ? left + (amount - low) / span * (right - left) : bottom - (amount - low) / span * (bottom - top);
  const column = (right - left) / stages.length;
  const geometry = useFinanceGeometry(Object.fromEntries(stages.map((stage,index) => [stage.id, mobile ? [scale(stage.from ?? 0), scale(stage.to ?? 0), 38 + index * 59] : [left + column * index + column * .23, scale(stage.from ?? 0), scale(stage.to ?? 0), column * .54]])));
  return <>
    {mobile ? [ticks[0],ticks.at(-1)].map(tick => <g key={tick}><path d={`M${scale(tick)} 16V${bottom}`} className="chart-grid"/><text x={scale(tick)} y={height-56} textAnchor="middle" style={{fontSize:10}}>{values.length ? financeChartMoney(tick) : '—'}</text></g>) : null}
    {!mobile ? ticks.map(tick => <g key={tick}><path d={`M${left} ${scale(tick)}H${right}`} className="chart-grid"/><text x={left-7} y={scale(tick)+4} textAnchor="end">{values.length ? financeChartMoney(tick) : tick === 0 ? '0' : '—'}</text></g>) : null}
    {reconciled ? stages.slice(0,-1).map((stage,index) => {
      const here = geometry[stage.id], next = geometry[stages[index+1].id];
      return <path key={stage.id} data-bridge-connector="true" d={mobile ? `M${here[1]} ${here[2]+9}V${next[2]-9}` : `M${here[0]+here[3]} ${here[2]}H${next[0]}`} className={`chart-link ${selectedId && (stage.metricId===selectedId || stages[index+1].metricId===selectedId) ? 'is-active' : ''}`}/>;
    }) : null}
    {stages.map(stage => {
      const endpoint = ['previous','current'].includes(stage.id), available = stage.to !== null && (endpoint || stage.included);
      const coordinates = geometry[stage.id], selected = selectedId === stage.metricId && (endpoint ? stage.id === (selectedStage === 'previous' ? 'previous' : 'current') : true);
      const label = stage.id === 'previous' ? 'Explore previous EBITDA' : stage.id === 'current' ? 'Explore EBITDA movement' : `Explore ${metricRegistry[stage.id].label} driver`;
      const value = endpoint ? stage.to : reconciled && stage.included ? stage.contribution : null;
      const description = endpoint ? financialValue({value:stage.to,unit:'money'}) : !stage.included ? 'Outside this EBITDA basis' : value === null ? 'Comparable contribution evidence required' : `${movementValue({value})} · ${value < 0 ? 'Reduces' : 'Supports'} EBITDA · ${financialValue({value:stage.from,unit:'money'})} → ${financialValue({value:stage.to,unit:'money'})}`;
      const color = endpoint ? stage.id === 'previous' ? 'chart-opening' : 'chart-result' : stage.contribution < 0 ? 'chart-pressure' : 'chart-support';
      const [x,y,z,barWidth] = coordinates;
      return <FinanceMark key={stage.id} label={label} selected={selected} dimmed={Boolean(selectedId) && !selected} onSelect={() => onSelect(stage.metricId, endpoint ? stage.id : 'driver')} tooltipAnchor={mobile ? {x:y,y:z} : {x:x+barWidth/2,y:z}} tooltip={<FinanceChartTip title={stage.label} rows={available ? endpoint ? [{label:'EBITDA',value:financialValue({value:stage.to,unit:'money'})}] : [{label:'Contribution',value:movementValue({value})},{label:'Cumulative EBITDA',value:financialValue({value:stage.to,unit:'money'})}] : undefined}>{available ? null : description}</FinanceChartTip>}>
        {mobile ? <>
          <rect x="0" y={z-22} width={width} height="44" fill="transparent" />
          <text x="0" y={z-3} className="chart-label" style={{fontSize:11}}>{endpoint ? stage.id === 'previous' ? 'Previous' : 'Current' : stage.label}</text>
          <text x="0" y={z+13} style={{fontSize:10}}>{value === null ? '—' : endpoint ? financeChartMoney(value) : `${value > 0 ? '+' : value < 0 ? '−' : ''}${financeChartMoney(Math.abs(value))}`}</text>
          {available && endpoint ? <g className={color}><path d={`M${y} ${z-12}V${z+12}`} stroke={stage.id === 'current' ? financeChartColors.ebitda : 'var(--chart-slate)'} strokeWidth="3"/><circle cx={y} cy={z} r={stage.id === 'current' ? 6 : 4}/></g> : available ? <rect x={Math.min(x,y)} y={z-9} width={Math.max(1,Math.abs(y-x))} height="18" rx="3" className={color}/> : <rect x={left} y={z-9} width={right-left} height="18" rx="3" className="chart-pending"/>}
          <rect x="0" y={z-22} width={width} height="44" rx="4" className="chart-focus"/>
        </> : <>
          <rect x={x-4} y="16" width={barWidth+8} height={height-36} fill="transparent"/>
          {available && endpoint ? <g className={color}><rect x={x} y={z-2} width={barWidth} height="4" rx="2"/><circle cx={x+barWidth/2} cy={z} r={stage.id === 'current' ? 6 : 4}/></g> : available ? <rect x={x} y={Math.min(y,z)} width={barWidth} height={Math.max(1,Math.abs(y-z))} rx="3" className={color}/> : <rect x={x} y={top+12} width={barWidth} height={bottom-top-12} rx="3" className="chart-pending"/>}
          <text x={x+barWidth/2} y={available ? Math.max(17,Math.min(y,z)-10) : top} textAnchor="middle" className="chart-value" style={{fontSize:compact ? 11 : 13,...(stage.id === 'current' ? {fill:financeChartColors.ebitda,fontWeight:700} : {})}}>{value === null ? '—' : endpoint ? financeChartMoney(value) : `${value > 0 ? '+' : value < 0 ? '−' : ''}${financeChartMoney(Math.abs(value))}`}</text>
          <text x={x+barWidth/2} y={bottom+24} textAnchor="middle" className="chart-label" style={{fontSize:11}}>{endpoint ? stage.id === 'previous' ? 'Previous' : 'Current' : stage.label}</text>
          {endpoint ? <text x={x+barWidth/2} y={bottom+40} textAnchor="middle">EBITDA</text> : !stage.included ? <text x={x+barWidth/2} y={bottom+40} textAnchor="middle">Outside basis</text> : null}
          <rect x={x-4} y={available ? Math.min(y,z)-4 : top+8} width={barWidth+8} height={available ? Math.max(1,Math.abs(y-z))+8 : bottom-top-4} rx="4" className="chart-focus"/>
        </>}
      </FinanceMark>;
    })}
    <text x={mobile ? 0 : left} y={height-42}>Cumulative EBITDA · RM · focused range</text>
    <text x={mobile ? 0 : left} y={height-24} className="chart-annotation">EBITDA movement {movementValue(movement.total)}</text>{!reconciled ? <text x={mobile ? 0 : left} y={height-8}>Attribution not ready</text> : null}
  </>;
}
export function DriverContribution({ movement, pair, selectedId, selectedStage, onSelect, compact = false }) {
  return <FinanceChart label="Driver Contribution" dataKey={JSON.stringify([movement,pair?.previous.metrics.ebitda.value,pair?.current.metrics.ebitda.value])} height={width => width < 560 ? 414 : compact ? 292 : 346}>{width => <ContributionCanvas width={width} movement={movement} pair={pair} selectedId={selectedId} selectedStage={selectedStage} onSelect={onSelect} compact={compact}/>}</FinanceChart>;
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
    {[-1,-.5,0,.5,1].map(tick => <g key={tick}><path d={`M${middle+tick*(right-left)/2} ${top}V${bottom}M${left} ${center-tick*(bottom-top)/2}H${right}`} className={tick === 0 ? 'chart-axis' : 'chart-grid'} /><text x={middle+tick*(right-left)/2} y={bottom+18} textAnchor="middle">{ready.length ? `${(tick*xb).toFixed(xb < 1 ? 2 : 1)}` : tick === 0 ? '0' : '—'}</text><text x={left-7} y={center-tick*(bottom-top)/2+4} textAnchor="end">{ready.length ? (tick*yb).toFixed(2) : tick === 0 ? '0' : '—'}</text></g>)}
    <text x={middle} y="310" textAnchor="middle">Cost growth − Revenue growth · pp</text><text x="11" y={center} textAnchor="middle" transform={`rotate(-90 11 ${center})`}>Cost share change · pp</text>
    {ready.filter(row => row.id === selectedId).map(row => { const [x,y] = geometry[row.id]; return <g key={`guides:${row.id}`} aria-hidden="true"><path d={`M${left} ${y}H${x}V${bottom}`} className="chart-link is-active"/></g>; })}
    {[...ready].sort((a,b) => Number(a.id === selectedId) - Number(b.id === selectedId)).map(row => { const [x,y,r] = geometry[row.id], label = row.label ?? metricRegistry[row.id].label; return <FinanceMark key={row.id} label={`Investigate ${label} pressure`} selected={row.id === selectedId} dimmed={Boolean(selectedId) && row.id !== selectedId && !row.id.startsWith(`${selectedId}.`)} onSelect={() => onSelect(row.id)} transform={`translate(${x} ${y})`} tooltip={<FinanceChartTip title={label} rows={[{label:'Cost',value:financialValue(row.current),color:financeMetricColor(row.id)},{label:'Cost growth',value:`${row.growth.value.toFixed(2)}%`},{label:'Revenue growth',value:`${row.revenueGrowth.value.toFixed(2)}%`},{label:'Share change',value:`${row.ratioMovement.value>0?'+':''}${row.ratioMovement.value.toFixed(3)} pp`}]} note="Point area reflects cost materiality."/>}>
      <circle r={Math.max(22,r+5)} fill="transparent"/><circle r={r} className="chart-point" fill={financeMetricColor(row.id)}/><circle r={r+4} className="chart-focus"/>{labels[row.id] ? <path d={`M0 0L${labels[row.id].x-x-3} ${labels[row.id].y-y-4}`} className={`chart-link ${row.id===selectedId ? 'is-active' : ''}`}/> : null}{labels[row.id] ? <text x={labels[row.id].x-x} y={labels[row.id].y-y} className="chart-label" style={{fontSize:11,pointerEvents:'none'}}>{label.length > 23 ? `${label.slice(0,21)}…` : label}</text> : null}
    </FinanceMark>; })}</>;
}
export function MarginPressureMap({ rows, selectedId, onSelect, embedded = false }) {
  const ready = rows.filter(row => row.growth.value !== null && row.revenueGrowth.value !== null && row.ratioMovement.value !== null);
  return <section data-workspace-surface="analysis" className="finance-margin-map" aria-labelledby="finance-margin-map-title"><div className="finance-analysis-heading"><div>{!embedded ? <h2 id="finance-margin-map-title">Margin Pressure Map</h2> : null}<p id={embedded ? "finance-margin-map-title" : undefined}>Cost growth relative to Revenue meets cost-share pressure on margin.</p></div></div>
    <FinanceChart label="Cost growth relative to Revenue and margin impact" dataKey={JSON.stringify(rows.map(row=>[row.id,row.current.value,row.ratioMovement.value]))} height={326}>{width => <PressureCanvas width={width} rows={rows} selectedId={selectedId} onSelect={onSelect}/>}</FinanceChart>
    {!ready.length ? <FinanceReadiness title="Margin pressure evidence not ready">Comparable costs and positive Revenue are required. No cost items have been positioned.</FinanceReadiness> : <p className="finance-analysis-muted">Point area follows supplied cost amount, with a minimum visible radius. Zero compares growth and share, not a target. Coincident points retain their coordinates; every item remains selectable in Cost Movements.</p>}
  </section>;
}
