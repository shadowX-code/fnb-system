import {buildDataHealth} from "../../../../supabase/functions/_shared/restaurant/dataHealth.js";
import { useMemo } from "react";
import { ClipboardList, ShieldCheck, ShoppingCart } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { buildAlerts, getNetSales, getOutletTaxConfig, sumAmount, toCurrency } from "../utils/analytics.js";

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DataHealthPage({ store, auth }) {
  const filters = usePeriodFilters(store);
  const {salesRows,purchaseRows,opexRow,netSales,totalPurchase,hasAnyData,sstConfig,sstEnabled,alerts,highRiskOperationalAlerts,uniqueSalesChannelCount,latestSalesRecord,sstRecord,hasSst,purchaseEmptyRows,warnings,salesScore,purchaseScore,overallScore,monthStatus} = buildDataHealth(store,filters);

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Data Health"
        description="Review loaded source completeness and exceptions. This review does not close or protect a financial month."
      />

      <PeriodFilterBar store={store} filters={filters} auth={auth} compact />

      {!hasAnyData ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-6 text-sm text-text-secondary">
          <div className="font-bold text-text-primary">No records entered for this month.</div>
          <p className="mt-1">Enter Sales and Supplier Purchase evidence to complete source checks.</p>
        </div>
      ) : null}

      <div>

        <Card title="Loaded Source Checks" description="Review indicators for loaded records; not financial approval.">
          <div className="space-y-4 p-4">
            {[
              ["Sales", salesScore],
              ["Purchase", purchaseScore],
              ["Overall", overallScore],
            ].map(([label, score]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm font-semibold"><span>{label}</span><span>{score}%</span></div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${score >= 100 ? "bg-emerald-500" : score >= 80 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${score}%` }} />
                </div>
              </div>
            ))}
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-secondary">Month Status</span>
                <Badge tone={monthStatus.tone}>{monthStatus.label}</Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard icon={ClipboardList} label="Sales Records" value={`${uniqueSalesChannelCount} channels`} helper={salesRows.length ? `Last updated ${formatTime(latestSalesRecord?.updated_at)}` : "Missing"} tone={salesScore === 100 ? "success" : "warning"} />
        <MetricCard icon={ShoppingCart} label="Purchase Records" value={`${purchaseRows.length} suppliers`} helper={purchaseEmptyRows.length ? `${purchaseEmptyRows.length} incomplete rows` : "Required fields complete"} tone={purchaseScore === 100 ? "success" : "warning"} />
        <MetricCard icon={ShieldCheck} label="Month Status" value={monthStatus.label} helper={`${salesRows.length ? toCurrency(netSales) : "Missing"} sales · ${purchaseRows.length ? toCurrency(totalPurchase) : "Missing"} purchase`} tone={monthStatus.tone === "danger" ? "danger" : monthStatus.tone === "success" ? "success" : "warning"} />
      </div>

      {warnings.length ? (
        <Card title="Warnings Detected" description="Review missing or incomplete source evidence.">
          <div className="grid gap-2 p-4 md:grid-cols-2">
            {warnings.map((warning) => (
              <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{warning}</div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck size={16} /> Source checks complete.</div>
          <p className="mt-1">This is a data review, not accounting approval or a protected-month state.</p>
        </div>
      )}

      {!opexRow && hasAnyData ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/35 p-4 text-sm text-blue-800">
          <div className="font-bold text-text-primary">OpEx not entered</div>
          <p className="mt-1">Operating expense has not been saved. EBITDA remains unavailable; missing expense is not RM0.</p>
        </div>
      ) : null}

      {highRiskOperationalAlerts.length ? (
        <Card title="Operational Alerts Detected" description="Advisory risk signals, not financial approval.">
          <div className="grid gap-2 p-4 md:grid-cols-2">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              {highRiskOperationalAlerts.length} high-risk operational alerts detected.
            </div>
            {highRiskOperationalAlerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text-primary">{alert.title}</span>
                  <Badge tone={alert.priority === "critical" ? "danger" : "warning"}>{alert.priority}</Badge>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{alert.description}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

    </div>
  );
}
