import { FinanceChart, FinanceMark, FinanceChartTip, financeChartMoney } from './FinanceChart.jsx';
import { financialValue } from './presentation.js';
import { metricRegistry } from './metrics.js';
const days = {inventory:'inventory_days', ar:'ar_days', ap:'ap_days', cash:'cash_coverage'};
/** Investigation relationships only. No balance amount is represented as a flow or bridge. */
export default function WorkingCapitalFlow({ metrics, schedule, selectedId, selectedStage = selectedId, onSelect }) {
  return <FinanceChart label="Working Capital Flow relationships" dataKey={JSON.stringify(Object.values(metrics).map(metric=>metric.value))} height={260}>{width => {
    const positions = {inventory:[width*.17,72],ar:[width*.5,72],cash:[width*.83,72],ap:[width*.26,202],cash_out:[width*.75,202]}, radius = Math.min(43,width*.13);
    const links = [['inventory','ar'],['ar','cash'],['ap','cash_out']];
    return <>{links.map(([from,to]) => { const [x1,y1] = positions[from], [x2,y2] = positions[to], active = selectedStage === from || selectedStage === to; return <g key={from}><path d={`M${x1+radius+3} ${y1}H${x2-radius-6}l-5 -4m5 4l-5 4`} className={`chart-link ${active ? 'is-active' : ''}`}/></g>; })}
      {Object.entries(positions).map(([stage,[x,y]]) => { const id = stage === 'cash_out' ? 'cash' : stage, label = stage === 'cash_out' ? 'Cash Out' : id === 'ar' ? 'Receivables' : id === 'ap' ? 'Supplier / Payable' : metricRegistry[id].label;
        return <FinanceMark key={stage} transform={`translate(${x} ${y})`} label={`Explore ${stage === 'cash_out' ? 'Cash Out' : metricRegistry[id].label} stage`} selected={selectedStage === stage} dimmed={Boolean(positions[selectedStage]) && selectedStage !== stage} onSelect={() => onSelect(id,stage)} tooltip={<FinanceChartTip title={label}>{stage === 'cash_out' ? `${schedule?.completeness ?? 'Missing'} dated payment schedule · not the Cash balance` : `${financialValue(metrics[id])} · ${metricRegistry[days[id]].label} ${financialValue(metrics[days[id]])}`}</FinanceChartTip>}>
          <circle r="22" fill="transparent"/><circle r={radius} className={metrics[id].value === null ? 'chart-pending' : 'chart-surface'} /><circle r={radius+3} className="chart-focus" />
          <text y="-9" textAnchor="middle" className="chart-label" style={{fontSize:width < 380 ? 9 : 11}}>{label}</text><text y="12" textAnchor="middle" className="chart-value" style={{fontSize:width < 380 ? 10 : 12}}>{stage === 'cash_out' ? 'Dated payments' : financeChartMoney(metrics[id].value)}</text>
          <text y={radius+17} textAnchor="middle">{stage === 'cash_out' ? `${schedule?.completeness ?? 'Pending'} schedule` : financialValue(metrics[days[id]])}</text>
        </FinanceMark>;
      })}</>;
  }}</FinanceChart>;
}
