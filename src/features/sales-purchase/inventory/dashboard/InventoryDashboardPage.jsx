import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, PackagePlus, Sparkles, Warehouse } from "lucide-react";
import PageHeader from "../../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import { getAccessibleOutlets, hasPermission } from "../../../../utils/accessControl.js";
import { navigateAdminRoute } from "../../../../app/routeOwnership.js";
import { SectionCard, getBusinessDateInput } from "../InventorySharedPresentation.jsx";
import { normalizeOutletRecord } from "../inventoryItemModel.js";
import useInventoryDashboardRead from "./useInventoryDashboardRead.js";
import { projectInventoryDashboard } from "./inventoryDashboardProjection.js";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function title(value) { return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()); }
function stockLabel(stock) {
  return stock.belowPar + stock.sufficient ? `${stock.belowPar} below Par` : "—";
}

export default function InventoryDashboardPage({ auth, store }) {
  const outlets = useMemo(() => getAccessibleOutlets(auth, (store?.outlets || []).map(normalizeOutletRecord)), [auth, store?.outlets]);
  const outletIds = outlets.map((outlet) => outlet.id);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const activeOutletId = selectedOutletId === "all" || outletIds.includes(selectedOutletId) ? selectedOutletId : "all";
  const read = useInventoryDashboardRead({ outletIds, actorId: auth?.user?.id || "", enabled: outletIds.length > 0 });
  const date = getBusinessDateInput("Asia/Kuala_Lumpur");
  const visibleOutlets = activeOutletId === "all" ? outlets : outlets.filter((outlet) => outlet.id === activeOutletId);
  const visibleData = read.state !== "error" && read.data && {
    ...read.data,
    orders: read.data.orders.filter((row) => visibleOutlets.some((outlet) => outlet.id === row.outletId)),
    movements: read.data.movements.filter((row) => visibleOutlets.some((outlet) => outlet.id === row.outletId)),
    waste: read.data.waste.filter((row) => visibleOutlets.some((outlet) => outlet.id === row.outletId)),
  };
  const result = visibleData ? projectInventoryDashboard(visibleData, visibleOutlets, date) : null;
  const alerts = result ? [
    result.stock.belowPar ? { title: `${result.stock.belowPar} below Par at last check`, message: "Submitted counts were below configured Par levels.", tone: "warning" } : null,
    result.stock.changed ? { title: `${result.stock.changed} changed since check`, message: "Movement evidence followed the last submitted count.", tone: "warning" } : null,
    result.stock.unverified ? { title: `${result.stock.unverified} stock positions unverified`, message: "A usable submitted count or its sequence is unavailable.", tone: "warning" } : null,
    result.missedCount ? { title: `${result.missedCount} missed stock checks`, message: "Scheduled checks were not completed.", tone: "danger" } : null,
    result.pendingOrders ? { title: `${result.pendingOrders} supplier orders open`, message: "Purchase orders remain in progress.", tone: "info" } : null,
  ].filter(Boolean) : [];

  return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title="Inventory Dashboard" description="Review last-check evidence, ordering activity and check completion." />
    <AdminFilterToolbar outlet={<SelectField label="Outlet" value={activeOutletId} onChange={setSelectedOutletId} options={[{ value: "all", label: "All" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} searchable />} secondaryActions={<button className="btn-secondary" type="button" onClick={read.refresh} disabled={read.state === "loading"}>Refresh</button>} />
    {!outlets.length ? <div className="card p-4" role="alert">Inventory Dashboard is unavailable for your outlet access.</div> : null}
    {read.error ? <div className="card p-4" role="alert"><h2 className="font-semibold">Inventory data unavailable or incomplete</h2><p className="mt-2 text-sm text-text-secondary">{read.error} No partial result is shown as complete.</p><button className="btn-secondary mt-3" type="button" onClick={read.refresh}>Retry</button></div> : null}
    {!read.data && !read.error && outlets.length ? <div className="card p-4" role="status">Loading verified Inventory Dashboard…</div> : null}
    {read.state === "refreshing" ? <p role="status" className="text-sm text-text-secondary">Refreshing. Showing the last verified read for this scope.</p> : null}
    {result ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Warehouse} label="Inventory Value" value="—" helper="Current valuation is unavailable" emphasis="primary" />
        <MetricCard icon={AlertTriangle} label="Below Par at Last Check" value={stockLabel(result.stock)} helper={`${result.stock.sufficient} sufficient · ${result.stock.changed} changed · ${result.stock.unverified} unverified`} tone={result.stock.belowPar || result.stock.changed || result.stock.unverified ? "warning" : "success"} />
        <MetricCard icon={PackagePlus} label="Pending Orders" value={result.pendingOrders} helper="Open supplier orders" tone={result.pendingOrders ? "warning" : "success"} />
        <MetricCard icon={Sparkles} label="Missed Checks" value={result.missedCount} helper="Scheduled checks" tone={result.missedCount ? "danger" : "success"} />
        <MetricCard icon={ClipboardCheck} label="Check Completion" value={result.checkCompletion === null ? "—" : `${result.checkCompletion}%`} helper={result.checkCompletion === null ? "No checks due today" : "Due groups completed"} tone={result.checkCompletion !== null && result.checkCompletion < 80 ? "warning" : "success"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <SectionCard title="Stock Check Evidence by Outlet" description="Last submitted counts, movement changes and check completion.">
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="text-[11px] uppercase tracking-wide text-text-muted"><tr className="border-b border-border"><th className="py-2">Outlet</th><th>Check Completion</th><th>Stock Evidence</th><th>Wastage Records</th><th>Pending Orders</th><th>Status</th><th>Action</th></tr></thead><tbody className="divide-y divide-border text-[13px]">
            {result.outletRows.map((row) => <tr key={row.outlet.id} className="transition hover:bg-primary/5"><td className="py-3 font-bold text-text-primary">{row.outlet.name}</td><td>{row.completion === null ? "—" : `${row.completion}%`}</td><td>{stockLabel(row.stock)}<div className="text-xs text-text-secondary">{row.stock.sufficient} sufficient · {row.stock.changed} changed · {row.stock.unverified} unverified</div></td><td>{row.wasteCount}</td><td>{row.pendingOrders}</td><td><Badge tone={row.status === "Sufficient at Last Check" ? "success" : "warning"}>{row.status}</Badge></td><td><button className="text-xs font-bold text-primary" type="button" onClick={() => navigateAdminRoute("inventory_stock_check", {}, { outletId: row.outlet.id })}>Open checks</button></td></tr>)}
          </tbody></table></div>
        </SectionCard>
        <SectionCard title="Needs Attention" description="Signals from verified stock and workflow evidence.">
          {hasPermission(auth, "inventory_dashboard.view") && alerts.length ? <div className="space-y-2">{alerts.map((alert) => <div className="rounded-lg border border-border p-3" key={alert.title}><div className="flex items-center justify-between gap-2"><span className="type-body-sm font-bold">{alert.title}</span><Badge tone={alert.tone}>{alert.tone === "danger" ? "Missed" : "Review"}</Badge></div><p className="mt-1 type-caption text-text-secondary">{alert.message}</p></div>)}</div> : <EmptyState title="No inventory alerts" description="Verified checks and open orders have no current alert." />}
        </SectionCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Stock Check Groups" description="Schedule across selected outlets."><div className="space-y-2">{result.groups.slice(0, 6).map((group) => <div key={group.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"><div><div className="type-body-sm font-bold">{group.name}</div><div className="type-caption text-text-secondary">{outlets.find((outlet) => outlet.id === group.outletId)?.name} · {result.groupItemCount(group)} items</div></div><Badge tone={result.groupStatus(group) === "Missed" ? "danger" : result.groupStatus(group) === "Completed" ? "success" : "neutral"}>{result.groupStatus(group)}</Badge></div>)}{!result.groups.length ? <EmptyState title="No groups" description="No Stock Check groups are configured for this outlet." /> : null}</div></SectionCard>
        <SectionCard title="Recent Movements" description="Latest inventory movement evidence.">{result.recentMovements.length ? <div className="space-y-2">{result.recentMovements.map((movement) => <div key={movement.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"><div><div className="type-body-sm font-bold">{movement.item?.name || "Inventory item"}</div><div className="type-caption text-text-secondary">{formatDate(movement.date)} · {title(movement.type)} · {movement.outlet?.name}</div></div><span className="font-bold">{Number(movement.quantity) > 0 ? "+" : ""}{movement.quantity} {movement.item?.unit}</span></div>)}</div> : <EmptyState title="No movement yet" description="Inventory movement history will appear here." />}</SectionCard>
      </div>
    </> : null}
  </div>;
}
