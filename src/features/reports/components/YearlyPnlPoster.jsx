import { compactMonth, money, statusLabel } from "./reportingFormatters.js";
import { MetricValue, PosterFooter, PosterShell } from "./reportingPosterPrimitives.jsx";

const REVENUE = "#147d70";
const PROFIT = "#375e86";

function percent(metric, revenue, { revenueMetric = false, net = false } = {}) {
  if (revenueMetric && metric?.presence === "present") return "100%";
  if (metric?.presence !== "present" || revenue?.presence !== "present" || !Number(revenue.amount)) return "—";
  return `${(Number(metric.amount) / Number(revenue.amount) * 100).toFixed(1)}%${net ? " Net Margin" : " of Revenue"}`;
}

function negative(metric) { return metric?.presence === "present" && Number(metric.amount) < 0; }
function hasRevenue(month) { return month.financials.revenue?.presence === "present"; }
function hasProfit(month) { return month.financials.netProfit?.presence === "present"; }
function shortMoney(value) { return `${value < 0 ? "-" : ""}RM ${(Math.abs(value) / 1000).toFixed(value % 1000 ? 1 : 0)}k`; }

function YearlyHeader({ dataset, outlet, logoUrl, reported }) {
  const name = outlet?.name ?? dataset.outlet?.name ?? "Outlet";
  const period = dataset.periodMode === "ytd" ? `${dataset.year} YTD` : `${dataset.year}`;
  const incomplete = dataset.completeness !== "complete";
  return <header className="poster-yearly-head">
    <div className="poster-yearly-head__identity">{logoUrl ? <img src={logoUrl} alt={`${name} logo`} /> : <span>{name}</span>}</div>
    <span className={`report-poster__status ${incomplete ? "is-incomplete" : ""}`}>{statusLabel(dataset.completeness, dataset.periodMode)}</span>
    <div className="poster-yearly-head__type">Annual Financial Performance</div>
    <h2>{period}</h2>
    <h3>{name}</h3>
    <p>Jan – Dec {dataset.year} <b>·</b> {reported} / {dataset.months.length} months reported</p>
  </header>;
}

function Chart({ months }) {
  const revenues = months.map((month) => hasRevenue(month) ? Number(month.financials.revenue.amount) : null);
  const profits = months.map((month) => hasProfit(month) ? Number(month.financials.netProfit.amount) : null);
  const values = [...revenues, ...profits].filter((value) => value !== null);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  const step = maxValue > 100000 ? 50000 : 25000;
  const chartMax = Math.max(step, Math.ceil(maxValue / step) * step);
  const chartMin = minValue < 0 ? Math.floor(minValue / step) * step : 0;
  const top = 28;
  const bottom = 184;
  const left = 64;
  const right = 978;
  const chartHeight = bottom - top;
  const chartWidth = right - left;
  const y = (value) => bottom - ((value - chartMin) / Math.max(chartMax - chartMin, 1)) * chartHeight;
  const zero = y(0);
  const x = (index) => left + ((index + 0.5) / months.length) * chartWidth;
  const ticks = Array.from({ length: 5 }, (_, index) => chartMin + ((chartMax - chartMin) / 4) * index);

  return <div className="poster-yearly-chart">
    <div className="poster-yearly-chart__head"><h3>Monthly Performance</h3><div className="poster-legend"><span><i/>Revenue</span><span><i className="is-profit"/>Net Profit</span></div></div>
    <svg className="poster-trend" viewBox="0 0 1000 250" role="img" aria-label="Monthly Financial Performance: revenue bars and net profit line">
      {ticks.map((tick) => <g key={tick}><line className="poster-chart-grid" x1={left} x2={right} y1={y(tick)} y2={y(tick)}/><text className="poster-chart-axis-label" x={left - 12} y={y(tick) + 4} textAnchor="end">{shortMoney(tick)}</text></g>)}
      <line className="poster-chart-zero" x1={left} x2={right} y1={zero} y2={zero}/>
      {revenues.map((value, index) => value === null ? null : <g key={`revenue-${index}`}><rect className="revenue-bar" fill={REVENUE} x={x(index) - 13} y={Math.min(y(value), zero)} width="26" height={Math.abs(zero - y(value))} rx="2"/><text className="poster-chart-value" x={x(index)} y={Math.min(y(value), zero) - 6} textAnchor="middle">{shortMoney(value).replace("RM ", "")}</text></g>)}
      {profits.map((value, index) => value !== null && profits[index + 1] !== null ? <line key={`profit-line-${index}`} className="profit-line" stroke={PROFIT} x1={x(index)} y1={y(value)} x2={x(index + 1)} y2={y(profits[index + 1])}/> : null)}
      {profits.map((value, index) => value === null ? null : <g key={`profit-point-${index}`}><circle className="profit-point" fill={value < 0 ? "#a34b4b" : PROFIT} cx={x(index)} cy={y(value)} r="3.6"/><text className={`poster-profit-value ${value < 0 ? "is-negative" : ""}`} x={x(index)} y={y(value) - 7} textAnchor="middle">{shortMoney(value).replace("RM ", "")}</text></g>)}
      {months.map((month, index) => <text className="poster-chart-month" key={month.month} x={x(index)} y="222" textAnchor="middle">{compactMonth(month.month)}</text>)}
    </svg>
  </div>;
}

function Snapshot({ months }) {
  const revenueMonths = months.filter(hasRevenue);
  const profitMonths = months.filter(hasProfit);
  const bestRevenue = revenueMonths.reduce((best, month) => !best || Number(month.financials.revenue.amount) > Number(best.financials.revenue.amount) ? month : best, null);
  const bestProfit = profitMonths.reduce((best, month) => !best || Number(month.financials.netProfit.amount) > Number(best.financials.netProfit.amount) ? month : best, null);
  const lowProfit = profitMonths.reduce((lowest, month) => !lowest || Number(month.financials.netProfit.amount) < Number(lowest.financials.netProfit.amount) ? month : lowest, null);
  const item = (label, month, metric, tone = "") => <div className={`poster-snapshot__item ${tone}`}><span>{label}</span><strong>{month ? compactMonth(month.month) : "—"}</strong><em>{month ? money(month.financials[metric]) : "—"}</em></div>;
  return <section className="poster-snapshot" aria-label="Performance Snapshot"><div className="poster-snapshot__title">Performance Snapshot <span>Reported period</span></div><div className="poster-snapshot__grid">{item("Best Revenue Month", bestRevenue, "revenue")}{item("Best Net Profit Month", bestProfit, "netProfit")}{item("Lowest Net Profit Month", lowProfit, "netProfit", "is-negative")}<div className="poster-snapshot__item"><span>Reported Months</span><strong>{revenueMonths.length} / {months.length}</strong><em>{(revenueMonths.length / months.length * 100).toFixed(1)}% of year</em></div></div></section>;
}

function Completeness({ months }) {
  const reported = months.filter(hasRevenue).length;
  const missing = months.filter((month) => !hasRevenue(month)).map((month) => compactMonth(month.month)).join(", ");
  return <section className="poster-completeness"><div><strong>{reported} / {months.length} months reported</strong><span>Data Completeness</span></div><p>Missing data: {missing || "None"}</p><aside>This report includes financial data for {reported} months only.<br/>Figures may not represent full year performance.</aside></section>;
}

export default function YearlyPnlPoster({ dataset, outlet, logoUrl }) {
  const period = dataset.periodMode === "ytd" ? `${dataset.year} YTD` : `${dataset.year}`;
  const reported = dataset.months.filter(hasRevenue).length;
  return <PosterShell kind="yearly" label="Yearly P&L Report poster">
    <YearlyHeader dataset={dataset} outlet={outlet} logoUrl={logoUrl} reported={reported}/>
    <section className="poster-financial-summary"><MetricValue className="is-revenue" label="Revenue" metric={money(dataset.totals.revenue)} percentage={percent(dataset.totals.revenue, dataset.totals.revenue, { revenueMetric: true })}/><MetricValue label="COGS" qualifier="Purchase-based" metric={money(dataset.totals.purchaseBasedCogs)} percentage={percent(dataset.totals.purchaseBasedCogs, dataset.totals.revenue)}/><MetricValue label="OpEx" metric={money(dataset.totals.opex)} percentage={percent(dataset.totals.opex, dataset.totals.revenue)}/><MetricValue className="is-profit" label="Net Profit" metric={money(dataset.totals.netProfit)} percentage={percent(dataset.totals.netProfit, dataset.totals.revenue, { net: true })}/></section>
    <Completeness months={dataset.months}/><Chart months={dataset.months}/><Snapshot months={dataset.months}/>
    <section className="poster-yearly-details"><div className="poster-yearly-details__head"><h3>Monthly P&amp;L Details</h3><span>— No data available</span></div><div className="poster-financial-table"><div className="poster-table-row poster-table-row--head"><span>Month</span><span>Revenue</span><span>COGS</span><span>OpEx</span><span>Net Profit</span></div>{dataset.months.map((month) => <div className={`poster-table-row ${!hasRevenue(month) ? "is-missing" : ""}`} key={month.month}><span>{compactMonth(month.month)}</span><span>{money(month.financials.revenue)}</span><span>{money(month.financials.purchaseBasedCogs)}</span><span>{money(month.financials.opex)}</span><strong className={negative(month.financials.netProfit) ? "is-negative" : ""}>{money(month.financials.netProfit)}</strong></div>)}</div></section>
    <PosterFooter type="Annual Financial Performance" period={period} status={statusLabel(dataset.completeness, dataset.periodMode)}/>
  </PosterShell>;
}
