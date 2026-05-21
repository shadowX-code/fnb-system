import { useMemo, useState } from "react";
import { AlertTriangle, Award, BarChart3, Building2, ChevronDown, CircleDollarSign, Download, FileSpreadsheet, FileText, Info, TrendingDown, TrendingUp } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
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

function yoyValue(current, previous) {
  if (!previous) return null;
  return percentageChange(current, previous);
}

function signedCurrency(value) {
  const amount = Math.abs(Number(value) || 0);
  return `${Number(value) < 0 ? "-" : ""}${toCurrency(amount)}`;
}

function marginStatus(margin) {
  if (margin >= 25) return { label: "Excellent", tone: "success", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (margin >= 15) return { label: "Healthy", tone: "success", className: "border-green-200 bg-green-50 text-green-700" };
  if (margin >= 5) return { label: "Warning", tone: "warning", className: "border-amber-200 bg-amber-50 text-amber-700" };
  return { label: "Critical", tone: "danger", className: "border-rose-200 bg-rose-50 text-rose-700" };
}

function latestActiveMonth(monthly) {
  return [...monthly].reverse().find((item) => item.revenue > 0 || item.cogs > 0 || item.opex > 0) ?? monthly[0];
}

function FinanceBadge({ children, tone = "neutral" }) {
  const classes = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
  };

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${classes[tone]}`}>{children}</span>;
}

function monthMarginBadgeClass(item) {
  if (item.revenue <= 0) return "border-slate-200 bg-slate-50 text-slate-500";
  if (item.margin < 0) return "border-rose-200 bg-rose-50 text-rose-700";
  if (item.margin === 0) return "border-slate-200 bg-slate-50 text-slate-500";
  if (item.margin < 10) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function pnlRatio(value, revenue) {
  if (!revenue) return "--";
  return `(${toPercent(Math.abs(value) / revenue * 100)})`;
}

function PnlStatementRow({ label, amount, ratio, muted = false }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-baseline gap-2">
      <span className="min-w-0 text-[11px] font-medium text-text-muted">{label}</span>
      <strong className={`text-right text-xs ${muted ? "text-text-secondary" : "text-text-primary"}`}>{amount}</strong>
      <span className="text-right text-[10px] font-semibold text-text-muted">{ratio}</span>
    </div>
  );
}

function PnlKpiCard({ label, value, helper, icon: Icon, primary = false, tone = "neutral", badge, insight }) {
  const isNegative = tone === "danger";
  return (
    <div
      className={`card min-h-[118px] p-4 transition duration-150 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-card ${
        primary ? "border-primary/25 bg-primary/5 shadow-sm" : "bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${primary ? "bg-primary/10 text-primary" : "bg-slate-100 text-text-secondary"}`}>
              <Icon size={16} />
            </span>
          ) : null}
          <div className="truncate text-[12px] font-bold uppercase tracking-[0.04em] text-text-secondary">{label}</div>
        </div>
        {badge}
      </div>
      <div className={`mt-3 min-w-0 break-words font-semibold leading-tight tracking-tight ${primary ? "text-[clamp(28px,2.2vw,36px)]" : "text-[clamp(22px,1.6vw,28px)]"} ${isNegative ? "text-rose-600" : "text-text-primary"}`}>
        {value}
      </div>
      <div className="mt-2 text-xs font-semibold text-text-secondary">{helper}</div>
      {insight ? <div className="mt-2 text-xs leading-4 text-text-muted">{insight}</div> : null}
    </div>
  );
}

function PnlTooltip({ label, item, previousItem }) {
  const revenueYoy = yoyValue(item.revenue, previousItem?.revenue);
  return (
    <div className="min-w-[210px]">
      <div className="mb-2 flex items-center justify-between gap-4 border-b border-border pb-2">
        <div className="font-bold text-text-primary">{label}</div>
        <FinanceBadge tone={item.netProfit < 0 ? "danger" : item.margin < 10 ? "warning" : "success"}>{toPercent(item.margin)}</FinanceBadge>
      </div>
      {[
        ["Revenue", toCurrency(item.revenue)],
        ["COGS", `-${toCurrency(item.cogs)}`],
        ["OpEx", `-${toCurrency(item.opex)}`],
        ["Net Profit", signedCurrency(item.netProfit)],
        ["Margin %", toPercent(item.margin)],
        ["YoY %", revenueYoy === null ? "No prior year" : `${revenueYoy >= 0 ? "+" : ""}${toPercent(revenueYoy)}`],
      ].map(([name, value]) => (
        <div key={name} className="mt-1.5 flex justify-between gap-8 text-text-secondary">
          <span>{name}</span>
          <strong className={name === "Net Profit" && item.netProfit < 0 ? "text-rose-600" : "text-text-primary"}>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function pnlInsights({ total, previousTotal, monthly, missingOpexCount, rankingRows }) {
  const insights = [];
  const latest = latestActiveMonth(monthly);
  const previousMonth = monthly[Math.max(0, Number(latest?.month ?? 1) - 2)];
  const latestCogsRatio = latest?.revenue > 0 ? (latest.cogs / latest.revenue) * 100 : 0;
  const previousCogsRatio = previousMonth?.revenue > 0 ? (previousMonth.cogs / previousMonth.revenue) * 100 : 0;
  const revenueGrowth = yoyValue(total.revenue, previousTotal?.revenue);

  if (revenueGrowth !== null && Math.abs(revenueGrowth) > 0.1) {
    insights.push({
      tone: revenueGrowth >= 0 ? "success" : "warning",
      icon: TrendingUp,
      label: "Revenue",
      title: revenueGrowth >= 0 ? `Revenue increased ${toPercent(revenueGrowth)} vs previous year.` : `Revenue declined ${toPercent(Math.abs(revenueGrowth))} vs previous year.`,
      body: revenueGrowth >= 0 ? "Confirm whether profit conversion is keeping pace with sales growth." : "Review outlet traffic, channel mix and operating calendar.",
    });
  }
  if (total.netProfit < 0) {
    insights.push({ tone: "danger", icon: AlertTriangle, label: "Critical", title: "Net profit is negative.", body: `${signedCurrency(total.netProfit)} YTD net profit. Review COGS and OpEx immediately.` });
  }
  if (total.margin < 15 && total.revenue > 0) {
    insights.push({ tone: "warning", icon: TrendingDown, label: "Margin", title: "Net margin dropped below healthy threshold.", body: `${toPercent(total.margin)} YTD margin. Review pricing, wastage and controllable expenses.` });
  }
  const cogsRatio = total.revenue > 0 ? (total.cogs / total.revenue) * 100 : 0;
  if (cogsRatio > 45) {
    insights.push({ tone: "warning", icon: BarChart3, label: "COGS", title: "COGS ratio is above 45%.", body: `${toPercent(cogsRatio)} YTD COGS ratio. Check supplier pricing and wastage.` });
  } else if (latestCogsRatio - previousCogsRatio > 5) {
    insights.push({ tone: "warning", icon: BarChart3, label: "COGS", title: `COGS ratio increased by ${toPercent(latestCogsRatio - previousCogsRatio)} this month.`, body: "Compare purchase invoices against sales movement for the latest active month." });
  }
  if (previousTotal?.revenue && total.revenue > previousTotal.revenue && total.netProfit < previousTotal.netProfit) {
    insights.push({ tone: "warning", icon: CircleDollarSign, label: "Profit", title: "Revenue increased but net profit dropped.", body: "Sales improved YoY, but profit conversion weakened. Review cost movement." });
  }
  if (missingOpexCount) {
    insights.push({ tone: "info", icon: Info, label: "OpEx", title: `Operating expense data missing for ${missingOpexCount} months.`, body: "P&L can render with RM0 OpEx, but management reporting is clearer after entry." });
  }
  const groupNetProfit = rankingRows?.reduce((sum, row) => sum + row.netProfit, 0) ?? 0;
  const topOutlet = rankingRows?.filter((row) => row.netProfit > 0).sort((a, b) => b.netProfit - a.netProfit)[0];
  if (topOutlet && groupNetProfit > 0) {
    const contribution = (topOutlet.netProfit / groupNetProfit) * 100;
    if (contribution >= 50) {
      insights.push({ tone: "info", icon: Building2, label: "Group", title: `${topOutlet.outlet.name} contributes ${toPercent(contribution)} of group net profit.`, body: "Monitor concentration risk and outlet dependency in monthly management review." });
    }
  }
  if (!insights.length) {
    insights.push({ tone: "success", icon: Award, label: "Healthy", title: "P&L looks stable.", body: "No major P&L risk signals detected for this selection." });
  }
  return insights.slice(0, 5);
}

function BreakdownBar({ total }) {
  const absolute = Math.max(total.revenue, total.cogs + total.opex + Math.max(total.netProfit, 0), 1);
  const parts = [
    { label: "Revenue", value: total.revenue, color: "bg-slate-900", ring: "#0f172a", muted: true },
    { label: "COGS", value: total.cogs, color: "bg-emerald-500", ring: "#22c55e" },
    { label: "OpEx", value: total.opex, color: "bg-amber-400", ring: "#f59e0b" },
    { label: "Net Profit", value: Math.max(total.netProfit, 0), color: "bg-blue-500", ring: "#3b82f6" },
  ];
  const cogsPct = (parts[1].value / absolute) * 100;
  const opexPct = (parts[2].value / absolute) * 100;
  const profitPct = (parts[3].value / absolute) * 100;
  const ringBackground = `conic-gradient(
    #22c55e 0 ${cogsPct}%,
    #f59e0b ${cogsPct}% ${cogsPct + opexPct}%,
    #3b82f6 ${cogsPct + opexPct}% ${cogsPct + opexPct + profitPct}%,
    #e2e8f0 ${cogsPct + opexPct + profitPct}% 100%
  )`;
  return (
    <div className="space-y-5">
      <div className="mx-auto grid h-44 w-44 place-items-center rounded-full bg-surface shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <div className="grid h-40 w-40 place-items-center rounded-full p-2" style={{ background: ringBackground }}>
          <div className="grid h-[7.1rem] w-[7.1rem] place-items-center rounded-full bg-surface text-center shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Net Margin</div>
              <div className={`mt-1 text-2xl font-semibold tracking-tight ${total.margin < 0 ? "text-rose-600" : "text-text-primary"}`}>{toPercent(total.margin)}</div>
              <div className="mt-1 text-[10px] font-semibold text-text-muted">YTD</div>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        {parts.map((part) => (
          <div key={part.label} className="rounded-xl border border-border/80 bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                <span className={`h-2 w-2 rounded-full ${part.color}`} />
                {part.label}
              </span>
              <span className="text-sm font-bold text-text-primary">{part.label === "Net Profit" ? signedCurrency(total.netProfit) : toCurrency(part.value)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${part.color}`}
                style={{ width: `${Math.min(100, Math.max(0, part.value / absolute * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OutletPnlPage({ store, ui, auth }) {
  const [outletId, setOutletId] = useState("all");
  const [year, setYear] = useState(defaultYear(store));
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const outletIds = outletId === "all" ? store.outlets.map((outlet) => outlet.id) : [outletId].filter(Boolean);
  const current = useMemo(() => yearlyPnl(store, outletIds, year), [outletIds.join("|"), store, year]);
  const previous = useMemo(() => yearlyPnl(store, outletIds, Number(year) - 1), [outletIds.join("|"), store, year]);
  const exportAllowed = canExport(auth, "outlet_pnl");
  const rankingRows = outletRanking(store, year);
  const totalGroupNetProfit = rankingRows.reduce((sum, row) => sum + row.netProfit, 0);
  const highestRevenue = Math.max(...rankingRows.map((row) => row.revenue), 0);
  const highestMargin = Math.max(...rankingRows.filter((row) => row.revenue > 0).map((row) => row.margin), 0);
  const missingOpexCount = current.monthly.filter((item) => item.revenue > 0 && item.opex === 0).length;
  const insights = pnlInsights({ total: current.total, previousTotal: previous.total, monthly: current.monthly, missingOpexCount, rankingRows });
  const marginHealth = marginStatus(current.total.margin);
  const today = new Date();
  const currentCalendarYear = today.getFullYear();
  const currentCalendarMonth = today.getMonth() + 1;
  const visibleMonthLimit = Number(year) < currentCalendarYear ? 12 : Number(year) === currentCalendarYear ? currentCalendarMonth : 0;
  const visibleMonthly = current.monthly.filter((item) => item.month <= visibleMonthLimit);

  function queueExport(format) {
    if (!exportAllowed) {
      notifyPermissionDenied(ui, `export Outlet P&L ${format}`);
      return;
    }
    setExportMenuOpen(false);
    ui.notify({ title: `${format} export queued`, message: "Outlet P&L export will use the current filter selection." });
  }

  const rankingColumns = [
    {
      key: "outlet",
      header: "Outlet",
      render: (row, index) => (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-text-secondary">#{index + 1}</span>
          <div className="min-w-0">
            <div className="font-semibold text-text-primary">{row.outlet.name}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {row.revenue === highestRevenue && row.revenue > 0 ? <FinanceBadge tone="success">Highest Revenue</FinanceBadge> : null}
              {row.margin === highestMargin && row.revenue > 0 ? <FinanceBadge tone="info">Highest Margin</FinanceBadge> : null}
              {row.margin < 5 && row.revenue > 0 ? <FinanceBadge tone="danger">Loss Risk</FinanceBadge> : null}
            </div>
          </div>
        </div>
      ),
    },
    { key: "revenue", header: "Revenue", align: "right", render: (row) => toCurrency(row.revenue) },
    { key: "cogs", header: "COGS", align: "right", render: (row) => toCurrency(row.cogs) },
    { key: "opex", header: "OpEx", align: "right", render: (row) => toCurrency(row.opex) },
    { key: "netProfit", header: "Net Profit", align: "right", render: (row) => <span className={row.netProfit < 0 ? "font-bold text-rose-600" : "font-bold text-text-primary"}>{toCurrency(row.netProfit)}</span> },
    { key: "margin", header: "Margin %", align: "right", render: (row) => toPercent(row.margin) },
    {
      key: "contribution",
      header: "Contribution %",
      align: "right",
      render: (row) => {
        const contribution = totalGroupNetProfit !== 0 ? (row.netProfit / totalGroupNetProfit) * 100 : 0;
        return (
          <div className="ml-auto w-32">
            <div className="text-xs font-bold text-text-primary">{toPercent(contribution)}</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.max(0, contribution))}%` }} />
            </div>
          </div>
        );
      },
    },
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
            <ActionMenu
              open={exportMenuOpen}
              onOpenChange={setExportMenuOpen}
              width={220}
              trigger={({ toggle, ariaLabel }) => (
                <button className="btn-secondary" type="button" onClick={toggle} aria-label={ariaLabel}>
                  <Download size={15} /> Export <ChevronDown size={14} />
                </button>
              )}
            >
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => queueExport("PDF")}>
                <FileText size={15} /> Export PDF
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => queueExport("Excel")}>
                <FileSpreadsheet size={15} /> Export Excel
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => queueExport("Management Summary")}>
                <BarChart3 size={15} /> Management Summary
              </button>
            </ActionMenu>
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
        <PnlKpiCard label="Total Revenue" value={toCurrency(current.total.revenue)} helper={yoy(current.total.revenue, previous.total.revenue)} icon={TrendingUp} insight="Saved net sales across selected outlets." />
        <PnlKpiCard label="Gross Profit" value={toCurrency(current.total.grossProfit)} helper={yoy(current.total.grossProfit, previous.total.grossProfit)} icon={BarChart3} insight="Revenue after COGS before OpEx." />
        <PnlKpiCard primary label="Net Profit" value={signedCurrency(current.total.netProfit)} helper={yoy(current.total.netProfit, previous.total.netProfit)} tone={current.total.netProfit < 0 ? "danger" : "success"} icon={current.total.netProfit < 0 ? TrendingDown : TrendingUp} insight="Management profit after purchases and OpEx." />
        <PnlKpiCard
          primary
          label="Net Profit Margin"
          value={toPercent(current.total.margin)}
          helper={yoy(current.total.margin, previous.total.margin)}
          tone={current.total.margin < 5 ? "danger" : current.total.margin < 15 ? "warning" : "success"}
          icon={CircleDollarSign}
          badge={<span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${marginHealth.className}`}>{marginHealth.label}</span>}
          insight="Executive profitability health indicator."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Revenue Trend" description="Monthly net sales compared with previous year.">
          <div className="p-4">
            <TrendChart
              labels={months.map((month) => month.label)}
              type="area"
              tension={0.38}
              series={[
                { name: `${year} Revenue`, data: current.monthly.map((item) => item.revenue), stroke: "#16a34a", fill: "#22c55e", area: true, areaOpacity: 0.14, format: toCurrency },
                { name: `${year - 1} Revenue`, data: previous.monthly.map((item) => item.revenue), stroke: "#94a3b8", fill: "#94a3b8", strokeWidth: 2, format: toCurrency },
              ]}
              highlightIndex={new Date().getMonth()}
              renderTooltip={({ label, index }) => <PnlTooltip label={label} item={current.monthly[index]} previousItem={previous.monthly[index]} />}
            />
          </div>
        </Card>
        <Card title="Net Profit Trend" description="Net profit after COGS and monthly OpEx.">
          <div className="p-4">
            <TrendChart
              labels={months.map((month) => month.label)}
              type="area"
              tension={0.38}
              series={[
                { name: `${year} Net Profit`, data: current.monthly.map((item) => item.netProfit), stroke: current.total.netProfit < 0 ? "#e11d48" : "#2563eb", fill: current.total.netProfit < 0 ? "#e11d48" : "#2563eb", area: true, areaOpacity: 0.12, format: toCurrency },
                { name: `${year - 1} Net Profit`, data: previous.monthly.map((item) => item.netProfit), stroke: "#94a3b8", fill: "#94a3b8", strokeWidth: 2, format: toCurrency },
              ]}
              highlightIndex={new Date().getMonth()}
              renderTooltip={({ label, index }) => <PnlTooltip label={label} item={current.monthly[index]} previousItem={previous.monthly[index]} />}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Monthly P&L Breakdown" description="Hover-ready month cards for management review.">
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleMonthly.map((item) => (
              <button key={item.month} className="rounded-2xl border border-border bg-surface p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card" type="button" onClick={() => ui.notify({ title: `${item.label} detail`, message: "Month detail modal will be connected later." })}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-text-primary">{item.label}</div>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${monthMarginBadgeClass(item)}`}>
                    {item.revenue > 0 && item.margin < 0 ? <AlertTriangle size={12} /> : null}
                    {toPercent(item.margin)}
                  </span>
                </div>
                <div className="mt-3 grid gap-1.5">
                  <PnlStatementRow label="Revenue" amount={toCurrency(item.revenue)} ratio="" />
                  <PnlStatementRow label="COGS" amount={`-${toCurrency(item.cogs)}`} ratio={pnlRatio(item.cogs, item.revenue)} />
                  <PnlStatementRow label="OpEx" amount={`-${toCurrency(item.opex)}`} ratio={pnlRatio(item.opex, item.revenue)} />
                  <div className="mt-1.5 flex justify-between border-t border-border pt-2.5"><span className="text-xs font-bold text-text-primary">Net Profit</span><strong className={`text-base font-bold ${item.netProfit < 0 ? "text-rose-500" : "text-text-primary"}`}>{signedCurrency(item.netProfit)}</strong></div>
                </div>
              </button>
            ))}
            {!visibleMonthly.length ? (
              <div className="col-span-full rounded-2xl border border-border bg-slate-50 p-6 text-sm font-semibold text-text-secondary">
                No months are available for this future year yet.
              </div>
            ) : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="P&L Summary YTD" description="Management cost and profit mix.">
            <div className="p-4">
              <BreakdownBar total={current.total} />
            </div>
          </Card>
          <Card title="Profitability Insights">
            <div className="space-y-2.5 p-3">
              {insights.map((insight) => (
                <div key={insight.title} className={`rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-sm ${insight.tone === "danger" ? "border-rose-100 bg-rose-50/40" : insight.tone === "warning" ? "border-amber-100 bg-amber-50/40" : insight.tone === "success" ? "border-emerald-100 bg-emerald-50/30" : "border-blue-100 bg-blue-50/25"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${insight.tone === "danger" ? "bg-rose-100/70 text-rose-700" : insight.tone === "warning" ? "bg-amber-100/70 text-amber-700" : insight.tone === "success" ? "bg-emerald-100/70 text-emerald-700" : "bg-blue-100/60 text-blue-700"}`}>
                      <insight.icon size={15} />
                    </span>
                    <div className="min-w-0">
                      <FinanceBadge tone={insight.tone}>{insight.label}</FinanceBadge>
                      <div className="mt-1.5 text-sm font-bold text-text-primary">{insight.title}</div>
                      <p className="mt-1 text-xs leading-5 text-text-secondary">{insight.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Outlet Ranking YTD" description={outletId === "all" ? "Profitability ranking across all outlets." : "Select All Outlets to compare outlet ranking."}>
        {outletId === "all" ? (
          <DataTable
            columns={rankingColumns}
            rows={rankingRows}
            getRowKey={(row) => row.outlet.id}
            density="compact"
            tableClassName="min-w-[1080px]"
            getRowClassName={() => "hover:bg-primary/5"}
            getRowProps={(row) => ({
              onClick: () => ui.notify({ title: row.outlet.name, message: "Outlet ranking drill-down will be connected later." }),
            })}
          />
        ) : (
          <div className="p-6 text-sm text-text-secondary">Single outlet selected. Ranking is hidden so the page can focus on monthly performance for this outlet.</div>
        )}
      </Card>
    </div>
  );
}
