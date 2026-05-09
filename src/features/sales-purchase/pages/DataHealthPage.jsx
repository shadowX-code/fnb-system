import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import { getNetSales, monthLabel } from "../utils/analytics.js";

function getLock(store, outletId, month, year) {
  return store.monthlyLocks.find((lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year);
}

export default function DataHealthPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const salesCount = store.salesRecords.filter((record) => record.outlet_id === filters.outletId && record.month === filters.month && record.year === filters.year).length;
  const purchaseCount = store.purchaseRecords.filter((record) => record.outlet_id === filters.outletId && record.month === filters.month && record.year === filters.year).length;
  const netSales = getNetSales(store.salesRecords, filters.outletId, filters.month, filters.year, store.salesChannels);
  const lock = getLock(store, filters.outletId, filters.month, filters.year);
  const isLocked = Boolean(lock?.is_locked);
  const completeness = Math.round(((salesCount ? 1 : 0) + (purchaseCount ? 1 : 0)) / 2 * 100);

  async function toggleLock() {
    if (isLocked) {
      const ok = await ui.confirm({ title: "Unlock month?", message: "Owner/Admin permission is required to edit locked month data.", confirmLabel: "Unlock" });
      if (!ok) return;
    }
    setStore((current) => operationsService.setMonthLock(current, { outletId: filters.outletId, month: filters.month, year: filters.year, isLocked: !isLocked }));
    ui.notify({ title: isLocked ? "Month unlocked" : "Month locked", message: `${monthLabel(filters.month)} ${filters.year}` });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        section="Controls"
        title="Data Health"
        description="Month lock, completeness checks and data freshness controls."
        actions={<button className="btn-primary" onClick={toggleLock}>{isLocked ? "Unlock" : "Lock Month"}</button>}
      />

      <PeriodFilterBar store={store} filters={filters} compact />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card title="Month Lock" description="Locked months disable normal Sales and Purchase input editing.">
          <div className="p-5">
            <div className={`rounded-2xl border p-5 ${isLocked ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="text-sm font-bold">{monthLabel(filters.month)} {filters.year}</div>
              <p className="mt-1 text-sm text-text-secondary">{isLocked ? `Locked by ${lock.locked_by || "Marcus Lee"}` : "Unlocked and editable for authorized users."}</p>
            </div>
          </div>
        </Card>
        <Card title="Data Completeness">
          <div className="p-5">
            <div className="mb-2 flex justify-between text-sm font-semibold"><span>Completeness</span><span>{completeness}%</span></div>
            <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${completeness}%` }} /></div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-text-secondary">Updated by</span><strong>Marcus Lee</strong></div>
              <div className="flex justify-between"><span className="text-text-secondary">Last updated</span><strong>May 20, 2026</strong></div>
            </div>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Sales Records" value={salesCount} helper={netSales ? "Complete" : "Missing"} tone={salesCount ? "success" : "danger"} />
        <MetricCard label="Purchase Records" value={purchaseCount} helper={purchaseCount ? "Complete" : "Missing"} tone={purchaseCount ? "success" : "danger"} />
        <MetricCard label="Total Records" value={salesCount + purchaseCount} helper="Current month" />
      </div>
    </div>
  );
}
