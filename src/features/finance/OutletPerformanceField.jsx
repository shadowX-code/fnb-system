import { FinanceReadiness, FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { useState } from 'react';
import { financialPeriod } from './presentation.js';
function rate(value) { return value === null ? 'Unavailable' : `${value.toFixed(1)}%`; }
export default function OutletPerformanceField({ outlets, selectedId, onSelect, lag }) {
  const [showHistory, setShowHistory] = useState(false);
  const plotted = outlets.filter((outlet) => outlet.position?.x !== null && outlet.position?.x !== undefined && outlet.position?.y !== null && outlet.position?.y !== undefined);
  const values = plotted.flatMap((outlet) => showHistory ? outlet.history.filter((point) => point.x !== null && point.y !== null) : [outlet.position]);
  const xBound = Math.max(10, ...values.map((point) => Math.abs(point.x))) * 1.2;
  const yBound = Math.max(10, ...values.map((point) => Math.abs(point.y))) * 1.2;
  const x = (value) => 64 + (value + xBound) / (2 * xBound) * 672;
  const y = (value) => 34 + (yBound - value) / (2 * yBound) * 332;
  return <section className="finance-outlet-field" aria-labelledby="finance-outlet-field-title">
    <div className="finance-analysis-heading"><div><h2 id="finance-outlet-field-title">Outlet Performance Field</h2><p>Revenue growth meets profitability. Select an outlet to investigate its performance.</p></div><label className="finance-analysis-history"><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />Show 3-month trajectories</label></div>
    {<><div className="finance-outlet-canvas">
      <svg viewBox="0 0 800 466" role="group" aria-label="Outlet revenue growth and EBITDA margin field">
        <title>Revenue Growth on the horizontal axis; EBITDA Margin on the vertical axis</title>
        <rect x="64" y="34" width="672" height="332" className="finance-map-base"/><rect x="400" y="34" width="336" height="166" className="finance-map-support"/><rect x="64" y="200" width="336" height="166" className="finance-map-pressure"/>
        <path d="M400 34V366M64 200H736" className="finance-field-axis" />
        <text x="80" y="22" className="finance-field-zone">Profitable but slowing</text><text x="720" y="22" textAnchor="end" className="finance-field-zone">Growing & profitable</text>
        <text x="80" y="423" className="finance-field-zone">Needs attention</text><text x="720" y="423" textAnchor="end" className="finance-field-zone">Growing with margin pressure</text>
        <text x="400" y="455" textAnchor="middle" className="finance-field-axis-label">Revenue Growth →</text><text x="18" y="200" textAnchor="middle" transform="rotate(-90 18 200)" className="finance-field-axis-label">EBITDA Margin →</text>
        <text x="64" y="387" className="finance-field-tick">−{xBound.toFixed(1)}%</text><text x="400" y="387" textAnchor="middle" className="finance-field-tick">0%</text><text x="736" y="387" textAnchor="end" className="finance-field-tick">+{xBound.toFixed(1)}%</text>
        <text x="54" y="40" textAnchor="end" className="finance-field-tick">{yBound.toFixed(1)}%</text><text x="54" y="204" textAnchor="end" className="finance-field-tick">0%</text><text x="54" y="366" textAnchor="end" className="finance-field-tick">−{yBound.toFixed(1)}%</text>
        {plotted.map((outlet) => {
          const active = outlet.id === selectedId;
          // Connect adjacent validated observations only. Never bridge a missing history point.
          const paths = outlet.history.slice(1).flatMap((point, index) => {
            const prior = outlet.history[index];
            return point.x !== null && point.y !== null && prior.x !== null && prior.y !== null ? [`M${x(prior.x)},${y(prior.y)}L${x(point.x)},${y(point.y)}`] : [];
          });
          return <g key={outlet.id} className={active ? 'finance-field-outlet is-selected' : plotted.length === 1 ? 'finance-field-outlet has-label' : 'finance-field-outlet'}>
            {showHistory ? <g aria-hidden="true">{paths.map((path, index) => <path key={index} d={path} className="finance-field-trajectory" />)}{outlet.history.filter((point) => point.x !== null && point.y !== null).slice(0, -1).map((point) => <circle key={point.period.start} cx={x(point.x)} cy={y(point.y)} r="3" className="finance-field-history-point"><title>{financialPeriod(point.period)} · growth {rate(point.x)} · margin {rate(point.y)}</title></circle>)}</g> : null}
            <g role="button" tabIndex="0" aria-pressed={active} aria-label={`${outlet.name}: revenue growth ${rate(outlet.position.x)}, EBITDA margin ${rate(outlet.position.y)}, ${outlet.position.zone}`} onClick={() => onSelect(outlet.id)} onKeyDown={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(outlet.id); } }}>
              <circle cx={x(outlet.position.x)} cy={y(outlet.position.y)} r="26" fill="transparent" />
              <circle cx={x(outlet.position.x)} cy={y(outlet.position.y)} r={active ? '10' : '7'} className="finance-field-point" />
              <text x={x(outlet.position.x) + (x(outlet.position.x) > 600 ? -18 : 18)} y={y(outlet.position.y) + 4} textAnchor={x(outlet.position.x) > 600 ? "end" : "start"} className="finance-field-outlet-name">{outlet.name.length > 25 ? `${outlet.name.slice(0, 23)}…` : outlet.name}</text>
            </g>
          </g>;
        })}
      </svg>
    </div><div className="finance-outlet-zones" aria-label="Outlet operating zones">{['Growing & profitable', 'Profitable but slowing', 'Growing with margin pressure', 'Needs attention', 'On the growth / profit boundary'].filter((zone) => zone !== 'On the growth / profit boundary' || plotted.some((outlet) => outlet.position.zone === zone)).map((zone) => <section key={zone}><h3>{zone}</h3>{plotted.filter((outlet) => outlet.position.zone === zone).map((outlet) => <button type="button" key={outlet.id} aria-pressed={selectedId === outlet.id} onClick={() => onSelect(outlet.id)}><strong>{outlet.name}</strong><span>Growth {rate(outlet.position.x)} · Margin {rate(outlet.position.y)}</span></button>)}{!plotted.some((outlet) => outlet.position.zone === zone) ? <span>No positioned outlets</span> : null}</section>)}</div></> }
    {!plotted.length ? <FinanceReadiness title="No outlets can be positioned yet">Complete current Revenue and EBITDA, plus positive comparison Revenue, are required for each point.</FinanceReadiness> : null}
    <p className="finance-analysis-muted">Zones use zero growth and zero EBITDA margin, not a target. {plotted.length} of {outlets.length} eligible outlets positioned. Trajectories compare each month with {lag} month{lag === 1 ? '' : 's'} earlier; missing observations are not connected. Coincident points keep their true coordinates; select any outlet below.</p>
    <FinanceDisclosure label={`Outlet detail · ${plotted.length} positioned / ${outlets.length} eligible`}>
    <div className="finance-analysis-table-wrap"><table className="finance-analysis-table"><caption>Eligible outlets · select a row to explore</caption><thead><tr><th>Outlet</th><th>Revenue Growth</th><th>EBITDA Margin</th><th>Operating zone / evidence</th></tr></thead><tbody>{outlets.map((outlet) => <tr key={outlet.id} className={outlet.id === selectedId ? 'is-selected' : ''}><th scope="row"><button type="button" disabled={!outlet.pair} aria-pressed={outlet.id === selectedId} onClick={() => onSelect(outlet.id)}>{outlet.name}</button></th><td>{rate(outlet.position?.x ?? null)}</td><td>{rate(outlet.position?.y ?? null)}</td><td>{outlet.error || outlet.position?.reason || outlet.position?.zone}</td></tr>)}</tbody></table></div>
</FinanceDisclosure>
    {!outlets.length ? <p className="finance-analysis-muted">No eligible outlets are available in this scope. Non-outlet dimensions are not plotted as outlets.</p> : null}
    {showHistory && selectedId ? <FinanceDisclosure label="Selected outlet trajectory evidence"><ul>{outlets.find((outlet) => outlet.id === selectedId)?.history.map((point) => <li key={point.period.start}>{financialPeriod(point.period)} · growth {rate(point.x)} · margin {rate(point.y)}{point.reason ? ` · ${point.reason}` : ''}</li>)}</ul></FinanceDisclosure> : null}
  </section>;
}
