import { money, periodLabel, statusLabel } from "./reportingFormatters.js";
import { MetricValue, PosterFooter, PosterShell } from "./reportingPosterPrimitives.jsx";

function percent(metric, revenue, { revenueMetric = false, net = false } = {}) {
  if (revenueMetric && metric?.presence === "present") return "100%";
  if (metric?.presence !== "present" || revenue?.presence !== "present" || !Number(revenue.amount)) return "—";
  return `${(Number(metric.amount) / Number(revenue.amount) * 100).toFixed(1)}%${net ? " Net Margin" : " of Revenue"}`;
}

function MonthlyHeader({ outlet, logoUrl, period, status, incomplete }) {
  const name = outlet?.name ?? "Outlet";
  return <header className="poster-monthly-head">
    <div className="poster-monthly-head__identity">{logoUrl ? <img src={logoUrl} alt={`${name} logo`} /> : <span>{name}</span>}</div>
    <span className={`report-poster__status ${incomplete ? "is-incomplete" : ""}`}>{status}</span>
    <div className="poster-monthly-head__type">Monthly Profit Report</div>
    <h2>{period}</h2>
    <h3>{name}</h3>
  </header>;
}

function quantity(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-MY", { maximumFractionDigits: 2 }).format(amount) : "—";
}

function Ranking({ title, rows, totalSales }) {
  return <section className="poster-ranking">
    <div className="poster-ranking__head"><h3>{title}</h3><p>Product sales revenue · % of total</p></div>
    <ol>{rows.map((row, index) => {
      const value = Number(row.sales_revenue ?? row.salesRevenue ?? 0);
      const name = row.product_name ?? row.productName ?? "Unnamed product";
      const category = row.category_name ?? row.category;
      const sold = row.quantity;
      const mix = Number(totalSales) > 0 ? `${(value / Number(totalSales) * 100).toFixed(1)}%` : "—";
      return <li key={`${category}-${name}-${index}`} className="poster-rank">
        <span className="poster-rank__number">{index + 1}</span>
        <span className="poster-rank__content"><strong className="poster-rank__name" title={name}>{name}</strong><span className="poster-rank__category">{category || "Uncategorised"}</span><span className="poster-rank__quantity">{quantity(sold)} sold</span></span>
        <span className="poster-rank__figures"><strong>{money({ amount: value, presence: "present" })}</strong><small>{mix}</small></span>
      </li>;
    })}</ol>
  </section>;
}

const categoryColors = ["#087b70", "#4b9a91", "#8dbbb2", "#c0d9d3", "#dbe9e5", "#9cb6b0", "#668b84", "#b3cbc5"];

function CategoryContribution({ rows, totalSales }) {
  const categories = rows.slice(0, 8).map((row) => ({
    name: row.category_name ?? row.category ?? "Uncategorised",
    value: Number(row.sales_revenue ?? row.salesRevenue ?? 0),
  })).filter((row) => row.value > 0);
  let offset = 0;
  return <section className="poster-category-contribution">
    <div className="poster-ranking__head"><h3>Category Contribution</h3><p>Product sales · Share</p></div>
    <div className="poster-category-contribution__summary">
      <svg className="poster-category-donut" viewBox="0 0 120 120" role="img" aria-label="Category contribution by product sales revenue">
        <circle cx="60" cy="60" r="42" pathLength="100" fill="none" stroke="#edf3f1" strokeWidth="17" />
        {categories.map((category, index) => {
          const share = Number(totalSales) > 0 ? category.value / Number(totalSales) * 100 : 0;
          const segment = <circle key={category.name} cx="60" cy="60" r="42" pathLength="100" fill="none" stroke={categoryColors[index % categoryColors.length]} strokeWidth="17" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
          offset += share;
          return segment;
        })}
        <text x="60" y="57" textAnchor="middle" className="poster-category-donut__total">{categories.length}</text>
        <text x="60" y="70" textAnchor="middle" className="poster-category-donut__label">categories</text>
      </svg>
    </div>
    <ol className="poster-category-list">{categories.map((category, index) => {
      const share = Number(totalSales) > 0 ? category.value / Number(totalSales) * 100 : 0;
      return <li key={category.name} className="poster-category-row">
        <span className="poster-category-row__swatch" style={{ backgroundColor: categoryColors[index % categoryColors.length] }} />
        <span className="poster-category-row__name" title={category.name}>{category.name}</span>
        <span className="poster-category-row__figures"><strong>{share.toFixed(1)}%</strong><small>{money({ amount: category.value, presence: "present" })}</small></span>
        <span className="poster-category-row__bar"><i style={{ width: `${share}%` }} /></span>
      </li>;
    })}</ol>
  </section>;
}

export default function MonthlyProfitPoster({ dataset, outlet, logoUrl }) {
  const unavailable = dataset.productDataStatus !== "available";
  const financials = dataset.financials;
  const incomplete = dataset.financialCompleteness !== "complete";
  const period = periodLabel(dataset.period);
  return <PosterShell kind="monthly" label="Monthly Profit Report poster">
    <MonthlyHeader outlet={outlet ?? dataset.outlet} logoUrl={logoUrl} period={period} status={statusLabel(dataset.financialCompleteness)} incomplete={incomplete}/>
    <section className="poster-financial-summary"><MetricValue className="is-revenue" label="Revenue" metric={money(financials.revenue)} percentage={percent(financials.revenue, financials.revenue, { revenueMetric: true })}/><MetricValue label="COGS" qualifier="Purchase-based" metric={money(financials.purchaseBasedCogs)} percentage={percent(financials.purchaseBasedCogs, financials.revenue)}/><MetricValue label="OpEx" metric={money(financials.opex)} percentage={percent(financials.opex, financials.revenue)}/><MetricValue className="is-profit" label="Net Profit" metric={money(financials.netProfit)} percentage={percent(financials.netProfit, financials.revenue, { net: true })}/></section>
    {unavailable ? <section className="poster-product-empty"><div><strong>Product performance unavailable</strong><p>No completed Product Analytics report exists for this period. Financial reporting remains available.</p></div></section> : <section className="poster-rankings"><Ranking title="Top 10 Best Selling" rows={dataset.topProducts ?? []} totalSales={dataset.totalProductSalesRevenue}/><CategoryContribution rows={dataset.categoryContributions ?? []} totalSales={dataset.totalProductSalesRevenue}/></section>}
    <PosterFooter type="Monthly Profit Report" period={period} status={statusLabel(dataset.financialCompleteness)}/>
  </PosterShell>;
}
