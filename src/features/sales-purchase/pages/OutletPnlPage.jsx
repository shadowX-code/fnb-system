import { useMemo, useState } from "react";
import { Download, TrendingDown, TrendingUp } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import { months } from "../data/mockData.js";
import { getSalesBreakdown, percentageChange, sumAmount, toCurrency, toPercent } from "../utils/analytics.js";
import { canExport, notifyPermissionDenied } from "../../../utils/accessControl.js";

function defaultYear(store) {
  const years = [...store.salesRecords, ...store.purchaseRecords, ...(store.operatingExpenses ?? [])]
    .map((record) => Number(record.year))
    .filter(Boolean);
  return years.length ? Math.max(...years) : new Date().getFullYear();
}

function monthPnl(store, outletIds, year, month) {
  return outletIds.reduce((total, outletId) => {
    const sales = getSalesBreakdown(store.salesRecords, store.salesChannels, outletId, month, year).netSales;
    const cogs = sumAmount(store.purchaseRecords.filter((record) => record.outlet_id === outletId && Number(record.year) === Number(year) && Number(record.month) === Number(month)));
    const opex = sumAmount((store.operatingExpenses ?? []).filter((record) => record.outlet_id === outletId && Number(record.year) === Number(year) && Number(record.month) === Number(month)));
    return {
      revenue: total.revenue + sales,
      cogs: total.cogs + cogs,
      opex: total.opex + opex,
    };
  }, { revenue: 0, cogs: 0, opex: 0 });
}

function enrichPnl(row) {
  const grossProfit = row.revenue - row.cogs;
  const netProfit = row.revenue - row.cogs - row.opex;
  const margin = row.revenue > 0 ? (netProfit / row.revenue) * 100 : 0;
  return { ...row, grossProfit, netProfit, margin };
}

function yearlyPnl(store, outletIds, year) {
  const monthly = months.map((month) => enrichPnl({ month: month.value, label: month.label, ...monthPnl(store, outletIds, year, month.value) }));
  const total = enrichPnl(monthly.reduce((sum, item) => ({
    revenue: sum.revenue + item.revenue,
    cogs: sum.cogs + item.cogs,
    opex: sum.opex + item.opex,
  }), { revenue: 0, cogs: 0, opex: 0 }));
  return { monthly, total };
}

function outletRanking(store, year) {
  return store.outlets.map((outlet) => {
    const pnl = yearlyPnl(store, [outlet.id], year).total;
    return { outlet, ...pnl };
  }).sort((a, b) => b.netProfit - a.netProfit);
}

function yoy(current, previous) {
  if (!previous) return "No prior year";
  const change = percentageChange(current, previous);
  return `${change >= 0 ? "+" : ""}${toPercent(change)} YoY`;
}

function pnlInsights({ total, previousTotal, monthly, missingOpex }) {
  const insights = [];
  if (total.netProfit < 0) {
    insights.push({ tone: "danger", label: "Critical", title: "Net profit is negative", body: `${toCurrency(total.netProfit)} YTD net profit. Review COGS and OpEx immediately.` });
  }
  if (total.margin < 10 && total.revenue > 0) {
    insights.push({ tone: "warning", label: "Warning", title: "Net margin below 10%", body: `${toPercent(total.margin)} YTD margin. Management review recommended.` });
  }
  const cogsRatio = total.revenue > 0 ? (total.cogs / total.revenue) * 100 : 0;
  if (cogsRatio > 45) {
    insights.push({ tone: "warning", label: "Warning", title: "COGS above 45%", body: `${toPercent(cogsRatio)} COGS ratio. Check supplier pricing and wastage.` });
  }
  if (previousTotal?.revenue && total.revenue > previousTotal.revenue && total.netProfit < previousTotal.netProfit) {
    insights.push({ tone: "warning", label: "Warning", title: "Revenue grew but profit dropped", body: "Sales improved YoY, but net profit fell. Review cost movement." });
  }
  if (missingOpex) {
    insights.push({ tone: "info", label: "Info", title: "Missing OpEx data", body: "Some months do not have operating expense entered yet. P&L uses RM0 for missing OpEx." });
  }
  if (!insights.length) {
    insights.push({ tone: "success", label: "Healthy", title: "P&L looks stable", body: "No major P&L risk signals detected for this selection." });
  }
  return insights;
}

function BreakdownBar({ total }) {
  const absolute = Math.max(total.cogs + total.opex + Math.max(total.netProfit, 0), 1);
  const parts = [
    { label: "COGS", value: total.cogs, color: "bg-emerald-500" },
    { label: "OpEx", value: total.opex, color: "bg-amber-400" },
    { label: "Net Profit", value: Math.max(total.netProfit, 0), color: "bg-blue-500" },
  ];
  const cogsPct = (parts[0].value / absolute) * 100;
  const opexPct = (parts[1].value / absolute) * 100;
  const profitPct = (parts[2].value / absolute) * 100;
  return (
    <div className="space-y-4">
      <div className="mx-auto grid h-36 w-36 place-items-center rounded-full"
        style={{
          background: `conic-gradient(#22c55e 0 ${cogsPct}%, #f59e0b ${cogsPct}% ${cogsPct + opexPct}%, #3b82f6 ${cogsPct + opexPct}% ${cogsPct + opexPct + profitPct}%, #e5e7eb ${cogsPct + opexPct + profitPct}% 100%)`,
        }}
      >
        <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center shadow-sm">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Margin</div>
            <div className="text-lg font-bold text-text-primary">{toPercent(total.margin)}</div>
          </div>
        </div>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {parts.map((part) => (
          <div key={part.label} className={part.color} style={{ width: `${(part.value / absolute) * 100}%` }} />
        ))}
      </div>
      <div className="grid gap-2 text-xs">
        {parts.map((part) => (
          <div key={part.label} className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-semibold text-text-secondary"><span className={`h-2.5 w-2.5 rounded-full ${part.color}`} />{part.label}</span>
            <span className="font-bold text-text-primary">{toCurrency(part.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OutletPnlPage({ store, ui, auth }) {
  const [outletId, setOutletId] = useState("all");
  const [year, setYear] = useState(defaultYear(store));
  const outletIds = outletId === "all" ? store.outlets.map((outlet) => outlet.id) : [outletId].filter(Boolean);
  const current = useMemo(() => yearlyPnl(store, outletIds, year), [outletIds.join("|"), store, year]);
  const previous = useMemo(() => yearlyPnl(store, outletIds, Number(year) - 1), [outletIds.join("|"), store, year]);
  const missingOpex = current.monthly.some((item) => item.revenue > 0 && item.opex === 0);
  const insights = pnlInsights({ total: current.total, previousTotal: previous.total, monthly: current.monthly, missingOpex });
  const exportAllowed = canExport(auth, "outlet_pnl");
  const rankingRows = outletRanking(store, year);

  const rankingColumns = [
    { key: "outlet", header: "Outlet", render: (row) => <div className="font-semibold text-text-primary">{row.outlet.name}</div> },
    { key: "revenue", header: "Revenue", align: "right", render: (row) => toCurrency(row.revenue) },
    { key: "cogs", header: "COGS", align: "right", render: (row) => toCurrency(row.cogs) },
    { key: "opex", header: "OpEx", align: "right", render: (row) => toCurrency(row.opex) },
    { key: "netProfit", header: "Net Profit", align: "right", render: (row) => <span className={row.netProfit < 0 ? "font-bold text-rose-600" : "font-bold text-text-primary"}>{toCurrency(row.netProfit)}</span> },
    { key: "margin", header: "Margin %", align: "right", render: (row) => toPercent(row.margin) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="Overview"
        title="Outlet P&L Overview"
        description="Management P&L by outlet using saved sales, purchases and monthly operating expenses."
      />

      <FilterBar
        compact
        actions={(
          <>
            <button className="btn-secondary" type="button" onClick={() => { setOutletId("all"); setYear(defaultYear(store)); }}>Reset</button>
            <button className="btn-secondary" type="button" onClick={() => exportAllowed ? ui.notify({ title: "Export queued", message: "Outlet P&L export placeholder." }) : notifyPermissionDenied(ui, "export Outlet P&L")}>
              <Download size={15} /> Export
            </button>
          </>
        )}
      >
        <SelectField
          label="Outlet"
          value={outletId}
          className="min-w-56"
          options={[{ value: "all", label: "All Outlets" }, ...store.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
          onChange={setOutletId}
          searchable
        />
        <SelectField
          label="Year"
          value={year}
          className="min-w-32"
          options={[2024, 2025, 2026, 2027].map((item) => ({ value: item, label: item }))}
          onChange={(nextValue) => setYear(Number(nextValue))}
        />
      </FilterBar>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Revenue" value={toCurrency(current.total.revenue)} helper={yoy(current.total.revenue, previous.total.revenue)} icon={TrendingUp} />
        <MetricCard label="Gross Profit" value={toCurrency(current.total.grossProfit)} helper={yoy(current.total.grossProfit, previous.total.grossProfit)} />
        <MetricCard label="Net Profit" value={toCurrency(current.total.netProfit)} helper={yoy(current.total.netProfit, previous.total.netProfit)} tone={current.total.netProfit < 0 ? "danger" : "success"} icon={current.total.netProfit < 0 ? TrendingDown : TrendingUp} />
        <MetricCard label="Net Profit Margin" value={toPercent(current.total.margin)} helper={yoy(current.total.margin, previous.total.margin)} tone={current.total.margin < 10 ? "warning" : "success"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Revenue Trend" description="Monthly net sales compared with previous year.">
          <div className="p-4">
            <TrendChart
              labels={months.map((month) => month.label)}
              type="area"
              series={[
                { name: `${year} Revenue`, data: current.monthly.map((item) => item.revenue), stroke: "#22c55e", fill: "#22c55e", area: true, format: toCurrency },
                { name: `${year - 1} Revenue`, data: previous.monthly.map((item) => item.revenue), stroke: "#94a3b8", fill: "#94a3b8", strokeWidth: 2, format: toCurrency },
              ]}
              highlightIndex={new Date().getMonth()}
            />
          </div>
        </Card>
        <Card title="Net Profit Trend" description="Net profit after COGS and monthly OpEx.">
          <div className="p-4">
            <TrendChart
              labels={months.map((month) => month.label)}
              type="area"
              series={[
                { name: `${year} Net Profit`, data: current.monthly.map((item) => item.netProfit), stroke: current.total.netProfit < 0 ? "#f43f5e" : "#2563eb", fill: current.total.netProfit < 0 ? "#f43f5e" : "#2563eb", area: true, format: toCurrency },
                { name: `${year - 1} Net Profit`, data: previous.monthly.map((item) => item.netProfit), stroke: "#94a3b8", fill: "#94a3b8", strokeWidth: 2, format: toCurrency },
              ]}
              highlightIndex={new Date().getMonth()}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Monthly P&L Breakdown" description="Hover-ready month cards for management review.">
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {current.monthly.map((item) => (
              <button key={item.month} className="rounded-2xl border border-border bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card" type="button" onClick={() => ui.notify({ title: `${item.label} detail`, message: "Month detail modal will be connected later." })}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-text-primary">{item.label}</div>
                  <Badge tone={item.netProfit < 0 ? "danger" : item.margin < 10 ? "warning" : "success"}>{toPercent(item.margin)}</Badge>
                </div>
                <div className="mt-3 grid gap-1 text-xs">
                  <div className="flex justify-between"><span className="text-text-secondary">Revenue</span><strong>{toCurrency(item.revenue)}</strong></div>
                  <div className="flex justify-between"><span className="text-text-secondary">COGS</span><strong>{toCurrency(item.cogs)}</strong></div>
                  <div className="flex justify-between"><span className="text-text-secondary">OpEx</span><strong>{toCurrency(item.opex)}</strong></div>
                  <div className="flex justify-between border-t border-border pt-1"><span className="text-text-secondary">Net Profit</span><strong className={item.netProfit < 0 ? "text-rose-600" : "text-text-primary"}>{toCurrency(item.netProfit)}</strong></div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="P&L Summary YTD" description="Management cost and profit mix.">
            <div className="p-4">
              <BreakdownBar total={current.total} />
            </div>
          </Card>
          <Card title="Profitability Insights">
            <div className="space-y-2 p-3">
              {insights.map((insight) => (
                <div key={insight.title} className={`rounded-2xl border p-3 ${insight.tone === "danger" ? "border-rose-200 bg-rose-50/55" : insight.tone === "warning" ? "border-amber-200 bg-amber-50/55" : insight.tone === "success" ? "border-emerald-200 bg-emerald-50/45" : "border-blue-200 bg-blue-50/35"}`}>
                  <Badge tone={insight.tone}>{insight.label}</Badge>
                  <div className="mt-2 text-sm font-bold text-text-primary">{insight.title}</div>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">{insight.body}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Outlet Ranking YTD" description={outletId === "all" ? "Profitability ranking across all outlets." : "Select All Outlets to compare outlet ranking."}>
        {outletId === "all" ? (
          <DataTable columns={rankingColumns} rows={rankingRows} getRowKey={(row) => row.outlet.id} density="compact" tableClassName="min-w-[920px]" />
        ) : (
          <div className="p-6 text-sm text-text-secondary">Single outlet selected. Ranking is hidden so the page can focus on monthly performance for this outlet.</div>
        )}
      </Card>
    </div>
  );
}
