import { FinanceReadiness, FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { FinanceChart, FinanceMark, FinanceChartTip, useFinanceGeometry, placeFinanceLabels, financeChartMoney } from './FinanceChart.jsx';
import { financialValue } from './presentation.js';

const eventMetric = (event) => ({ value: event.amount, unit: 'money' });
export default function LiquidityTimeline({ model, selectedEventId, onEvent, onCash, embedded = false }) {
  const { cash, schedule, rows, lowest, constrained, largestCollection, largestCommitment } = model;
  // Coordinate projection of validated checkpoints; no additional financial forecast is calculated here.
  const points = model.projected ? [{date:schedule.asOf, position:cash}, ...rows, ...(rows.at(-1)?.date !== schedule.horizon.end ? [{date:schedule.horizon.end,position:rows.at(-1)?.position ?? cash}] : [])] : [];
  return <section className="finance-cash-section finance-liquidity" aria-labelledby="finance-liquidity-title">
    <div className="finance-analysis-heading"><div>{!embedded ? <h2 id="finance-liquidity-title">Liquidity timeline</h2> : null}<p id={embedded ? "finance-liquidity-title" : undefined}>{schedule ? `${schedule.horizon.start} to ${schedule.horizon.end} · ${schedule.completeness} schedule coverage` : 'Opening position → dated collections & commitments → expected cash'}</p></div><span className="finance-cash-basis">{model.projected ? 'Forecast · end-of-day checkpoints' : 'Expected positions unavailable'}</span></div>
    <FinanceChart label="Horizontal Liquidity Timeline" dataKey={JSON.stringify([schedule, cash.value])} height={390}>{width => <TimelineCanvas width={width} model={model} points={points} selectedEventId={selectedEventId} onEvent={onEvent} onCash={onCash}/>}</FinanceChart>
    {model.projected ? <dl className="finance-timeline-readout"><div><dt>Expected lowest point</dt><dd>{financialValue(lowest.position)}<small>{lowest.date} · Forecast</small></dd></div><div><dt>Closing expected cash</dt><dd>{financialValue(points.at(-1).position)}<small>{schedule.horizon.end} · Forecast</small></dd></div></dl> : null}
    <div className="finance-timeline-selectors" aria-label="Select dated cash evidence">{rows.flatMap(row=>row.events).map(event=><button type="button" key={event.id} aria-pressed={selectedEventId===event.id} onClick={()=>onEvent(event)}><span>{event.date.slice(5)} · {event.kind}</span><strong>{event.direction==='inflow'?'+':'−'}{financialValue(eventMetric(event))}</strong></button>)}</div>
    {!rows.length && !model.projected ? <FinanceReadiness title="Dated liquidity evidence not ready">Opening book cash and validated collection / payment dates are required. The muted timeline does not imply a cash projection.</FinanceReadiness> : null}
    <FinanceDisclosure label="Dated checkpoints & schedule evidence">
    <p className="finance-analysis-muted">{model.reason}</p>
    <div className="finance-liquidity-opening"><button type="button" onClick={onCash}>Opening book cash <strong>{financialValue(cash)}</strong></button><span>As at {cash.period.end} · {cash.completeness}</span></div>
    {rows.length ? <ol className="finance-liquidity-dates" aria-label="Dated liquidity checkpoints">{rows.map((row) => <li key={row.date}><time dateTime={row.date}>{row.date}</time><div className="finance-liquidity-events">{row.events.map((event) => <button type="button" key={event.id} aria-pressed={selectedEventId === event.id} aria-label={`Investigate ${event.label}`} onClick={() => onEvent(event)}><span>{event.label}<small>{event.kind} · Forecast · {event.completeness}</small></span><strong>{event.direction === 'inflow' ? '+' : '−'}{financialValue(eventMetric(event))}<small>{event.direction === 'inflow' ? 'Expected in' : 'Expected out'}</small></strong></button>)}</div><div className="finance-liquidity-position"><span>Expected book cash</span><strong>{financialValue(row.position)}</strong><small>{row.position ? 'Forecast' : 'Incomplete coverage / opening evidence'}</small></div></li>)}</ol> : model.projected ? <p>No dated events in the supplied complete horizon. Expected book cash remains at the opening position.</p> : null}
    <dl className="finance-liquidity-summary"><div><dt>Lowest checkpoint evidence</dt><dd>{lowest ? <><strong>{financialValue(lowest.position)}</strong><span>{lowest.date} · supplied-schedule model</span></> : 'Unavailable'}</dd></div><div><dt>Largest known collection</dt><dd>{largestCollection ? <button type="button" onClick={() => onEvent(largestCollection)}>{financialValue(eventMetric(largestCollection))}<span>{largestCollection.date} · Forecast · {largestCollection.completeness} · {largestCollection.label}</span></button> : 'Unavailable / no supplied events'}</dd></div><div><dt>Largest known commitment</dt><dd>{largestCommitment ? <button type="button" onClick={() => onEvent(largestCommitment)}>{financialValue(eventMetric(largestCommitment))}<span>{largestCommitment.date} · Forecast · {largestCommitment.completeness} · {largestCommitment.label}</span></button> : 'Unavailable / no supplied events'}</dd></div></dl>
    </FinanceDisclosure>
    {model.projected ? <p className="finance-analysis-muted">{constrained.length ? `At or below zero at checkpoints: ${constrained.map((period) => `${period.start} until ${period.end}`).join('; ')}. Between-checkpoint changes and intraday availability are unknown.` : 'No at-or-below-zero checkpoint in the supplied horizon. This does not establish available bank funds or cover unrecorded events.'}</p> : null}
  </section>;
}

function TimelineCanvas({ width, model, points, selectedEventId, onEvent, onCash }) {
  const { schedule, rows, lowest } = model;
  const values = points.map(point => point.position.value), minimum = values.length ? Math.min(...values) : 0, maximum = values.length ? Math.max(...values) : 1, range = Math.max(1, maximum-minimum);
  const low = minimum-range*.15, high = maximum+range*.15;
  const left = 58, right = width-20, top = 40, bottom = 228;
  const start = schedule ? Date.parse(schedule.asOf) : 0, end = schedule ? Date.parse(schedule.horizon.end) : 1;
  const x = date => left+(Date.parse(date)-start)/(end-start)*(right-left);
  const y = value => bottom-(value-low)/(high-low)*(bottom-top);
  const events = rows.flatMap(row => row.events);
  const target = Object.fromEntries(points.map((point,index) => [`checkpoint:${index}`, [x(point.date),y(point.position.value)]]));
  for (const row of rows) row.events.forEach((event,index) => { target[event.id] = [x(event.date), 292+(index%2)*48, model.projected ? y(row.position.value) : bottom]; });
  const geometry = useFinanceGeometry(target);
  const path = points.map((point,index) => { const [px,py] = geometry[`checkpoint:${index}`]; return `${index ? 'H'+px+'V' : 'M'+px+','}${py}`; }).join(' ');
  const lowestIndex = points.findIndex(point => point.date === lowest?.date), lowestPoint = geometry[`checkpoint:${lowestIndex}`];
  const annotations = placeFinanceLabels(events.filter(event => event.id === selectedEventId || event.id === model.largestCollection?.id || event.id === model.largestCommitment?.id).map(event => ({id:event.id,label:event.label,x:geometry[event.id][0],y:geometry[event.id][1]})),width,258,384,selectedEventId);
  return <><path d={`M${left} ${top}V${bottom}H${right}`} className="chart-axis"/>
    {model.projected ? <>
      {[0,.5,1].map(tick => <g key={tick}><path d={`M${left} ${bottom-tick*(bottom-top)}H${right}`} className="chart-grid"/><text x={left-8} y={bottom-tick*(bottom-top)+4} textAnchor="end" style={{fontSize:10}}>{financeChartMoney(low+tick*(high-low))}</text></g>)}
      <path d={`${path}V${bottom}H${left}Z`} className="finance-timeline-area"/><path d={path} className="finance-timeline-path"/>
      {points.map((point,index) => { const [px,py] = geometry[`checkpoint:${index}`]; return <circle key={point.date} cx={px} cy={py} r="3" className="chart-cash"/>; })}
      <FinanceMark label="Explore opening book cash" onSelect={onCash} tooltip={<FinanceChartTip title="Opening book cash">{schedule.asOf} · {financialValue(model.cash)} · Accounting position</FinanceChartTip>} transform={`translate(${geometry['checkpoint:0'].join(' ')})`}><circle r="22" fill="transparent"/><circle r="4" className="chart-cash"/><circle r="8" className="chart-focus"/></FinanceMark>
      {lowestPoint ? <g aria-label={`Lowest expected cash ${financialValue(lowest.position)} on ${lowest.date}`}><circle cx={lowestPoint[0]} cy={lowestPoint[1]} r="7" className="chart-cash"/><path d={`M${lowestPoint[0]} ${lowestPoint[1]+10}V${bottom}`} className="chart-grid"/><text x={Math.max(left+8,Math.min(right-98,lowestPoint[0]-42))} y={Math.max(24,lowestPoint[1]-18)} className="chart-annotation">Lowest · {financeChartMoney(lowest.position.value)}</text></g> : null}
    </> : <><path d={`M${left} 130H${right}`} className="chart-grid"/><text x={left} y="68">Opening position</text><text x={right} y="218" textAnchor="end">Expected position</text></>}
    {schedule ? [0,.25,.5,.75,1].map(tick => { const date = new Date(start+tick*(end-start)).toISOString().slice(0,10); return <g key={tick}><path d={`M${left+tick*(right-left)} ${bottom}v5`} className="chart-axis"/><text x={left+tick*(right-left)} y="249" textAnchor="middle">{date.slice(5)}</text></g>; }) : <><text x={left} y="249">Opening</text><text x={right} y="249" textAnchor="end">Horizon</text></>}
    {events.map(event => { const [px,py,checkpointY] = geometry[event.id], active = event.id === selectedEventId; return <FinanceMark key={event.id} label={`Select ${event.label} on timeline`} selected={active} dimmed={Boolean(selectedEventId) && !active} onSelect={() => onEvent(event)} tooltip={<FinanceChartTip title={event.label}>{event.date} · {event.direction === 'inflow' ? '+' : '−'}{financialValue(eventMetric(event))} · Forecast · {event.completeness}</FinanceChartTip>}>
      <path d={`M${px} ${checkpointY}V${py-9}`} className={`chart-link ${active ? 'is-active' : ''}`}/><circle cx={px} cy={py} r="22" fill="transparent"/><circle cx={px} cy={py} r="7" className={`chart-point ${event.direction === 'inflow' ? 'chart-support' : 'chart-pressure'}`}/><circle cx={px} cy={py} r="12" className="chart-focus"/>
      <text x={px} y={py+4} textAnchor="middle" style={{fill:'white',fontSize:10,pointerEvents:'none'}}>{event.direction === 'inflow' ? '+' : '−'}</text>
      {annotations[event.id] ? <text x={annotations[event.id].x} y={annotations[event.id].y} className="chart-label" style={{fontSize:10,pointerEvents:'none'}}>{event.kind}</text> : null}
    </FinanceMark>; })}
    <text x={left} y="380">Dated events · + collections / − payments</text>
  </>;
}
