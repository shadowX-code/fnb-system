import { FinanceReadiness, FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { useState } from 'react';
import { FinanceChart, FinanceMark, FinanceChartTip, useFinanceGeometry, placeFinanceLabels, financeChartColors } from './FinanceChart.jsx';
import { financialPeriod } from './presentation.js';
function rate(value) { return value === null ? 'Unavailable' : `${value.toFixed(1)}%`; }
export default function OutletPerformanceField({ outlets, selectedId, onSelect, lag, embedded = false }) {
  const [showHistory, setShowHistory] = useState(false);
  const plotted = outlets.filter((outlet) => outlet.position?.x !== null && outlet.position?.x !== undefined && outlet.position?.y !== null && outlet.position?.y !== undefined);
  return <section data-workspace-surface="analysis" className="finance-outlet-field" aria-labelledby="finance-outlet-field-title">
    <div className="finance-analysis-heading"><div>{!embedded ? <h2 id="finance-outlet-field-title">Outlet Performance Field</h2> : null}<p id={embedded ? "finance-outlet-field-title" : undefined}>Revenue growth meets profitability. Select an outlet to investigate its performance.</p></div><label className="finance-analysis-history"><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />Show 3-month trajectories</label></div>
    <div className="finance-outlet-canvas"><FinanceChart label="Outlet revenue growth and EBITDA margin field" dataKey={JSON.stringify(plotted.map(outlet=>[outlet.id,outlet.position.x,outlet.position.y]))} height={344}>{width => <PerformanceCanvas width={width} plotted={plotted} selectedId={selectedId} onSelect={onSelect} showHistory={showHistory} />}</FinanceChart></div>
    {!plotted.length ? <FinanceReadiness title="No outlets can be positioned yet">Complete current Revenue and EBITDA, plus positive comparison Revenue, are required for each point.</FinanceReadiness> : null}
    <FinanceDisclosure label={`Outlet detail · ${plotted.length} positioned / ${outlets.length} eligible`}>

    <p className="finance-analysis-muted">Zones use zero growth and zero EBITDA margin, not a target. {plotted.length} of {outlets.length} eligible outlets positioned. Trajectories compare each month with {lag} month{lag === 1 ? '' : 's'} earlier; missing observations are not connected. Coincident points keep their true coordinates; select any outlet below.</p>
    <div className="finance-analysis-table-wrap"><table className="finance-analysis-table"><caption>Eligible outlets · select a row to explore</caption><thead><tr><th>Outlet</th><th>Revenue Growth</th><th>EBITDA Margin</th><th>Operating zone / evidence</th></tr></thead><tbody>{outlets.map((outlet) => <tr key={outlet.id} className={outlet.id === selectedId ? 'is-selected' : ''}><th scope="row"><button type="button" disabled={!outlet.pair} aria-pressed={outlet.id === selectedId} onClick={() => onSelect(outlet.id)}>{outlet.name}</button></th><td>{rate(outlet.position?.x ?? null)}</td><td>{rate(outlet.position?.y ?? null)}</td><td>{outlet.error || outlet.position?.reason || outlet.position?.zone}</td></tr>)}</tbody></table></div>
</FinanceDisclosure>
    {!outlets.length ? <p className="finance-analysis-muted">No eligible outlets are available in this scope. Non-outlet dimensions are not plotted as outlets.</p> : null}
    {showHistory && selectedId ? <FinanceDisclosure label="Selected outlet trajectory evidence"><ul>{outlets.find((outlet) => outlet.id === selectedId)?.history.map((point) => <li key={point.period.start}>{financialPeriod(point.period)} · growth {rate(point.x)} · margin {rate(point.y)}{point.reason ? ` · ${point.reason}` : ''}</li>)}</ul></FinanceDisclosure> : null}
  </section>;
}

function PerformanceCanvas({ width, plotted, selectedId, onSelect, showHistory }) {
  const values = plotted.flatMap(outlet => showHistory ? outlet.history.filter(point => point.x !== null && point.y !== null) : [outlet.position]);
  const xb = Math.max(10, ...values.map(point => Math.abs(point.x))) * 1.2;
  const yb = Math.max(10, ...values.map(point => Math.abs(point.y))) * 1.2;
  const left = 52, right = width - 20, top = 40, bottom = 270, cx = (left + right) / 2, cy = (top + bottom) / 2;
  const x = value => cx + value / xb * (right - left) / 2, y = value => cy - value / yb * (bottom - top) / 2;
  const target = Object.fromEntries(plotted.flatMap(outlet => [[outlet.id, [x(outlet.position.x), y(outlet.position.y)]], ...outlet.history.flatMap((point,index) => point.x !== null && point.y !== null ? [[`${outlet.id}:history:${index}`, [x(point.x), y(point.y)]]] : [])]));
  const geometry = useFinanceGeometry(target);
  const labels = placeFinanceLabels(plotted.map(outlet => ({id:outlet.id,label:outlet.name,x:geometry[outlet.id][0],y:geometry[outlet.id][1]})), width, top, bottom, selectedId);
  return <><rect x={left} y={top} width={right-left} height={bottom-top} className="chart-surface"/><rect x={cx} y={top} width={right-cx} height={cy-top} className="finance-map-support"/><rect x={left} y={cy} width={cx-left} height={bottom-cy} className="finance-map-pressure"/>
    <text x={left} y="22">{width < 400 ? 'Profitable / slowing' : 'Profitable but slowing'}</text><text x={right} y="22" textAnchor="end">{width < 400 ? 'Growing / profitable' : 'Growing & profitable'}</text>
    {[-1,-.5,0,.5,1].map(tick => <g key={tick}><path d={`M${x(tick*xb)} ${top}V${bottom}M${left} ${y(tick*yb)}H${right}`} className={tick === 0 ? 'chart-axis' : 'chart-grid'}/><text x={x(tick*xb)} y={bottom+18} textAnchor="middle">{plotted.length ? `${(tick*xb).toFixed(0)}%` : tick === 0 ? '0%' : '—'}</text><text x={left-7} y={y(tick*yb)+4} textAnchor="end">{plotted.length ? `${(tick*yb).toFixed(0)}%` : tick === 0 ? '0%' : '—'}</text></g>)}
    <text x={left} y="312">Needs attention</text><text x={right} y="312" textAnchor="end">{width < 400 ? 'Growing / pressure' : 'Growing with margin pressure'}</text><text x={cx} y="336" textAnchor="middle">Revenue Growth →</text><text x="11" y={cy} transform={`rotate(-90 11 ${cy})`} textAnchor="middle">EBITDA Margin →</text>
    {[...plotted].sort((a,b) => Number(a.id === selectedId)-Number(b.id === selectedId)).map(outlet => {
      const active = outlet.id === selectedId, [px,py] = geometry[outlet.id];
      const paths = outlet.history.slice(1).flatMap((point,index) => {
        const prior = geometry[`${outlet.id}:history:${index}`], current = geometry[`${outlet.id}:history:${index+1}`];
        return prior && current ? [`M${prior.join(',')}L${current.join(',')}`] : [];
      });
      return <FinanceMark key={outlet.id} label={`${outlet.name}: revenue growth ${rate(outlet.position.x)}, EBITDA margin ${rate(outlet.position.y)}, ${outlet.position.zone}`} selected={active} dimmed={Boolean(selectedId) && !active} onSelect={() => onSelect(outlet.id)} tooltip={<FinanceChartTip title={outlet.name} rows={[{label:'Revenue growth',value:`${outlet.position.x.toFixed(2)}%`,color:financeChartColors.revenue},{label:'EBITDA margin',value:`${outlet.position.y.toFixed(2)}%`,color:financeChartColors.ebitda}]} note={outlet.position.zone}/>}>
        {showHistory ? <g aria-hidden="true">{paths.map((path,index) => <path key={index} d={path} className={`chart-link ${active ? 'is-active' : ''}`}/>)}{outlet.history.slice(0,-1).map((point,index) => geometry[`${outlet.id}:history:${index}`] ? <circle key={index} cx={geometry[`${outlet.id}:history:${index}`][0]} cy={geometry[`${outlet.id}:history:${index}`][1]} r="3" fill={financeChartColors.ebitda} className="chart-point"/> : null)}</g> : null}
        {active ? <path d={`M${left} ${py}H${px}V${bottom}`} className="chart-grid"/> : null}
        <circle cx={px} cy={py} r="22" fill="transparent"/><circle cx={px} cy={py} r={active ? 9 : 7} className="finance-field-point chart-point" style={{fill:outlet.position.y<0?'var(--chart-coral)':financeChartColors.ebitda}}/><circle cx={px} cy={py} r="13" className="chart-focus"/>
        {labels[outlet.id] ? <path d={`M${px} ${py}L${labels[outlet.id].x-3} ${labels[outlet.id].y-4}`} className={`chart-link ${active ? 'is-active' : ''}`}/> : null}
        {labels[outlet.id] ? <text x={labels[outlet.id].x} y={labels[outlet.id].y} className="chart-label" style={{fontSize:11,pointerEvents:'none'}}>{outlet.name.length > 23 ? `${outlet.name.slice(0,21)}…` : outlet.name}</text> : null}
      </FinanceMark>;
    })}</>;
}
