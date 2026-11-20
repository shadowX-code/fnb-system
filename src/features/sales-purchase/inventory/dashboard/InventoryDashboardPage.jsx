import { useMemo, useState } from "react";
import { ArrowRight, ClipboardCheck, PackageSearch, PackagePlus, TriangleAlert } from "lucide-react";
import PageHeader from "../../../../components/layout/PageHeader.jsx";
import DashboardSection from "../../../../components/layout/DashboardSection.jsx";
import AdminSummaryGrid from "../../../../components/ui/AdminSummaryGrid.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import DataTable from "../../../../components/tables/DataTable.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import { getAccessibleOutlets, hasPermission } from "../../../../utils/accessControl.js";
import { navigateAdminRoute } from "../../../../app/routeOwnership.js";
import { formatOperationalMoment } from "../../../../lib/dateTime.js";
import { getBusinessDateInput } from "../InventorySharedPresentation.jsx";
import { normalizeOutletRecord } from "../inventoryItemModel.js";
import { formatInventoryCost, formatInventoryCostChange } from "../master/inventoryCostPresentation.js";
import { toTitle } from "../movements/inventoryMovementService.js";
import useInventoryDashboardRead from "./useInventoryDashboardRead.js";
import { previousClosingMonth, projectInventoryDashboard } from "./inventoryDashboardProjection.js";

const calendarDate = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const calendarMonth = new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
const displayDate = date => date ? calendarDate.format(new Date(`${date}T00:00:00Z`)) : "—";
const percent = value => value == null ? "—" : `${value}%`;

function OpenChecks({ outletId, date, checkId, children = "Open checks" }) {
  return <button className="type-body-sm font-semibold text-primary hover:underline" type="button"
    onClick={() => checkId
      ? navigateAdminRoute("inventory-stock-check-result", { checkId }, { outletId, date })
      : navigateAdminRoute("inventory_stock_check", {}, { outletId, date })}>{children}</button>;
}

function ActionRequired({ result, evidence, checks, date, canViewChecks, canViewOrders }) {
  const unverified = result.outletRows.find(row => row.stock.unverified > 0);
  const changed = result.outletRows.find(row => row.stock.changed > 0);
  const below = result.outletRows.find(row => row.stock.belowPar > 0);
  const belowCheck = evidence.find(row => row.outlet_id === below?.outlet.id && row.state === "below_par");
  const belowResultId = checks.some(check => check.id === belowCheck?.check_id && check.status === "submitted") ? belowCheck.check_id : undefined;
  const orders = result.outletRows.find(row => row.pendingOrders > 0);
  const actions = [
    unverified && { title: "Verify stock evidence", message: "A usable count or its sequence is missing.", tone: "warning",
      outlet: unverified.outlet, link: canViewChecks && <OpenChecks date={date} outletId={unverified.outlet.id}>Open Stock Check</OpenChecks> },
    changed && { title: "Recheck stock after movements", message: "Stock moved after the last submitted count.", tone: "warning",
      outlet: changed.outlet, link: canViewChecks && <OpenChecks date={date} outletId={changed.outlet.id}>Open Stock Check</OpenChecks> },
    below && { title: "Review below-Par evidence", message: "The last verified count was below Par.", tone: "danger",
      outlet: below.outlet, link: canViewChecks && <OpenChecks date={belowCheck?.check_date || date} outletId={below.outlet.id}
        checkId={belowResultId}>Review count</OpenChecks> },
    orders && { title: "Follow up supplier orders", message: "Review orders that are still open.", tone: "info", outlet: orders.outlet,
      link: canViewOrders && <button type="button" className="type-body-sm font-semibold text-primary hover:underline"
        onClick={() => navigateAdminRoute("inventory_orders", {}, { outletId: orders.outlet.id })}>Open Purchase Orders</button> },
  ].filter(Boolean);
  return <DashboardSection density="compact" title="Action Required">
    {actions.length ? <ul className="divide-y divide-border">{actions.map(action => <li key={action.title} className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="type-body-sm font-semibold">{action.title}</span>
        <Badge tone={action.tone}>{action.outlet.name}</Badge>
      </div>
      <p className="type-caption text-text-secondary">{action.message}</p>
      {action.link}
    </li>)}</ul> : <EmptyState title="No stock exceptions or open orders" />}
  </DashboardSection>;
}

function CostInsights({ insight, canOpenMaster }) {
  const data = insight?.data;
  const peak = data?.largest_increase;
  const columns = [
    { key: "item", header: "Item", render: row => <strong className="font-semibold">{row.item_name}</strong> },
    { key: "previous", header: "Previous", align: "right", render: row => formatInventoryCost(row.previous_cost) },
    { key: "current", header: "Standard Cost", align: "right", render: row => formatInventoryCost(row.unit_cost, row.unit) },
    { key: "change", header: "Change", align: "right", render: row => <Badge tone={row.delta > 0 ? "danger" : "success"}>
      {formatInventoryCostChange(row.unit_cost, row.previous_cost).amount}
    </Badge> },
  ];
  return <DashboardSection density="compact" title="Cost Insights"
    subtitle={data ? `Standard Cost · Last 30 days · ${displayDate(data.start_date)} – ${displayDate(data.end_date)}` : "Standard Cost"}
    action={canOpenMaster && <button className="btn-secondary h-8 min-h-8 px-2.5 text-xs" type="button"
      onClick={() => navigateAdminRoute("inventory_master")}>Master Inventory <ArrowRight size={14} /></button>}>
    {insight?.state === "ready" ? <>
      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border p-2.5 lg:grid-cols-4">
        {[
          { label: "Increases", value: data.increases, tone: "text-rose-700" },
          { label: "Decreases", value: data.decreases, tone: "text-emerald-700" },
          { label: "Largest increase", value: peak ? formatInventoryCostChange(peak.unit_cost, peak.previous_cost).amount : "—", detail: peak ? `${peak.item_name} / ${peak.unit}` : "" },
          { label: "Missing costs", value: data.missing_costs },
        ].map(metric => <div key={metric.label} className="min-w-0">
          <dt className="type-caption text-text-secondary">{metric.label}</dt>
          <dd className={`type-title font-semibold tabular-nums ${metric.tone || "text-text-primary"}`}>{metric.value}</dd>
          {metric.detail && <dd className="type-caption text-text-secondary">{metric.detail}</dd>}
        </div>)}
      </dl>
      <h3 className="mb-1 type-body-sm font-semibold">Top 5 Cost Changes</h3>
      <p className="mb-1 type-caption text-text-secondary">Net change per item, ranked by absolute RM per unit.</p>
      {data.top_changes.length ? <DataTable columns={columns} rows={data.top_changes} getRowKey={row => row.item_id}
        density="compact" columnSpacing="compact" mobileLayout="stack" minWidth={0} />
        : <EmptyState title="No comparable standard cost changes in this period" />}
    </> : <EmptyState title={insight?.state === "restricted" ? "Standard cost access required" : "Cost insights unavailable"}
      description={insight?.state === "unavailable" ? "Refresh to retry the standard cost read." : undefined} />}
  </DashboardSection>;
}

function OutletHealth({ rows, closingMonth, date, canViewChecks }) {
  const columns = [
    { key: "outlet", header: "Outlet", render: row => <strong className="font-semibold">{row.outlet.name}</strong> },
    { key: "completion", header: "Check completion", align: "right", render: row => percent(row.completion) },
    { key: "below", header: "Below Par", align: "right", render: row => row.stock.belowPar + row.stock.sufficient ? row.stock.belowPar : "—" },
    { key: "changed", header: "Changed since check", align: "right", render: row => row.stock.changed },
    { key: "unverified", header: "Unverified", align: "right", render: row => row.stock.unverified },
  ];
  if (canViewChecks) columns.push(
    { key: "closing", header: "Month-End Closing", render: row => {
      const closing = row.closing;
      const badge = <Badge tone={closing?.status === "Published" ? "success" : closing?.status === "Submitted" ? "info" : "neutral"}>{closing?.status || "Unavailable"}</Badge>;
      return closing?.checkId ? <OpenChecks outletId={row.outlet.id} checkId={closing.checkId}>{badge}</OpenChecks> : badge;
    } },
    { key: "action", header: "", align: "right", render: row => <OpenChecks outletId={row.outlet.id} date={date} /> },
  );
  return <DashboardSection density="compact" title="Outlet Inventory Health"
    subtitle={canViewChecks ? `Closing status for ${calendarMonth.format(new Date(`${closingMonth}T00:00:00Z`))}` : undefined}>
    <DataTable columns={columns} rows={rows} getRowKey={row => row.outlet.id}
      density="compact" columnSpacing="compact" mobileLayout="stack" minWidth={0} />
  </DashboardSection>;
}

function OperationalActivity({ dueRuns, movements, canViewChecks, canViewMovements }) {
  const overdue = dueRuns.filter(run => run.status === "Overdue");
  const current = dueRuns.filter(run => run.status !== "Overdue").slice(0, 6 - Math.min(overdue.length, 3));
  const visibleRuns = [...current, ...overdue.slice(0, 6 - current.length)];
  return <DashboardSection density="compact" title="Operational Activity">
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="min-w-0" aria-label="Due and overdue stock checks">
        <h3 className="type-body-sm font-semibold">Due & overdue stock checks</h3>
        <p className="mb-1 type-caption text-text-secondary">Today and the latest missed run per group in the prior 7 days.</p>
        {visibleRuns.length ? <ul className="divide-y divide-border">{visibleRuns.map(({ group, outlet, date, status }) => (
          <li key={`${group.id}:${date}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              {canViewChecks ? <OpenChecks outletId={outlet.id} date={date}>{group.name}</OpenChecks>
                : <strong className="type-body-sm">{group.name}</strong>}
              <p className="type-caption text-text-secondary">{outlet.name} · {displayDate(date)} · {group.shift}</p>
            </div>
            <Badge tone={status === "Overdue" ? "danger" : "warning"}>{status}</Badge>
          </li>
        ))}</ul> : <EmptyState title="No due or overdue checks in this window" />}
        {dueRuns.length > visibleRuns.length && <p className="pt-1 type-caption text-text-secondary">{dueRuns.length - visibleRuns.length} more scheduled runs in this window.</p>}
      </section>
      <section className="min-w-0" aria-label="Recent inventory movements">
        <h3 className="type-body-sm font-semibold">Recent Movements</h3>
        <p className="mb-1 type-caption text-text-secondary">Latest five recorded movements.</p>
        {movements.length ? <ul className="divide-y divide-border">{movements.map(movement => <li key={movement.id} className="flex items-start justify-between gap-2 py-2">
          <div className="min-w-0">
            {canViewMovements ? <button className="type-body-sm text-left font-semibold text-primary hover:underline" type="button"
              onClick={() => navigateAdminRoute("inventory_movements", {}, { outletId: movement.outletId })}>{movement.item?.name || "Inventory item"}</button>
              : <strong className="type-body-sm">{movement.item?.name || "Inventory item"}</strong>}
            <p className="type-caption text-text-secondary">{movement.outlet.name} · {toTitle(movement.type)} · {movement.dateTime ? formatOperationalMoment(movement.dateTime) : displayDate(movement.date)}</p>
          </div>
          <span className="shrink-0 type-body-sm font-semibold tabular-nums">{movement.quantity > 0 ? "+" : ""}{movement.quantity} {movement.unit || movement.item?.unit}</span>
        </li>)}</ul> : <EmptyState title="No inventory movements in this scope" />}
      </section>
    </div>
  </DashboardSection>;
}

export default function InventoryDashboardPage({ auth, store }) {
  const outlets = useMemo(() => getAccessibleOutlets(auth, (store?.outlets || []).map(normalizeOutletRecord)), [auth, store?.outlets]);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const activeOutletId = outlets.some(outlet => outlet.id === selectedOutletId) ? selectedOutletId : "all";
  const visibleOutlets = activeOutletId === "all" ? outlets : outlets.filter(outlet => outlet.id === activeOutletId);
  const outletIds = visibleOutlets.map(outlet => outlet.id);
  const date = getBusinessDateInput("Asia/Kuala_Lumpur");
  const closingMonth = previousClosingMonth(date);
  const canViewChecks = hasPermission(auth, "inventory_stock_check.view");
  const canViewMaster = hasPermission(auth, "inventory_master.view");
  const canReadCosts = canViewMaster || hasPermission(auth, "inventory_control.view");
  const read = useInventoryDashboardRead({ outletIds, actorId: auth?.user?.id || "", enabled: outletIds.length > 0,
    canReadCosts, closingMonth: canViewChecks ? closingMonth : "" });
  const result = read.state !== "error" && read.data ? projectInventoryDashboard(read.data, visibleOutlets, date) : null;

  return <div className="space-y-3">
    <PageHeader section="INVENTORY CONTROL" title="Inventory Operations & Cost Control" />
    <AdminFilterToolbar compact denseFields outlet={<SelectField label="Outlet" value={activeOutletId} onChange={setSelectedOutletId}
      options={[{ value: "all", label: "All Outlets" }, ...outlets.map(outlet => ({ value: outlet.id, label: outlet.name }))]} searchable />}
      secondaryActions={<button className="btn-secondary" type="button" onClick={read.refresh} disabled={!outlets.length || read.state === "loading" || read.state === "refreshing"}>Refresh</button>} />
    {!outlets.length && <div className="card p-4" role="alert">Inventory Dashboard is unavailable for your outlet access.</div>}
    {read.error && <div className="card p-4" role="alert">
      <h2 className="font-semibold">Inventory data unavailable or incomplete</h2>
      <p className="mt-2 type-body-sm text-text-secondary">{read.error}</p>
      <button className="btn-secondary mt-3" type="button" onClick={read.refresh}>Retry</button>
    </div>}
    {!read.data && !read.error && outlets.length > 0 && <div className="card p-4" role="status">Loading Inventory Dashboard…</div>}
    {read.state === "refreshing" && <p role="status" className="type-caption text-text-secondary">Refreshing the current outlet scope…</p>}
    {result && <>
      <AdminSummaryGrid variant="compact" mobileColumns={2} ariaLabel="Inventory Health KPIs" items={[
        { key: "unverified", label: "Unverified Stock Evidence", icon: PackageSearch, value: result.stock.unverified,
          tone: result.stock.unverified ? "warning" : "neutral", wrapLabel: true, helper: "Outlet-item positions" },
        { key: "below", label: "Below Par", icon: TriangleAlert, value: result.stock.belowPar + result.stock.sufficient ? result.stock.belowPar : "—",
          tone: result.stock.belowPar ? "danger" : "neutral", helper: "At last verified count" },
        { key: "orders", label: "Pending Orders", icon: PackagePlus, value: result.pendingOrders,
          tone: result.pendingOrders ? "info" : "neutral", helper: "Open supplier orders" },
        { key: "checks", label: "Check Completion", icon: ClipboardCheck, value: percent(result.checkCompletion),
          tone: result.dueCount > result.completedCount ? "warning" : "neutral",
          helper: result.dueCount ? `${result.completedCount} of ${result.dueCount} due today` : "No checks due today" },
      ]} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]">
        <ActionRequired result={result} evidence={read.data.stockEvidence} checks={read.data.checks} date={date} canViewChecks={canViewChecks}
          canViewOrders={hasPermission(auth, "inventory_orders.view")} />
        <CostInsights insight={read.data.costInsights} canOpenMaster={canViewMaster} />
      </div>
      <OutletHealth rows={result.outletRows} canViewChecks={canViewChecks} date={date} closingMonth={closingMonth} />
      <OperationalActivity dueRuns={result.dueRuns} movements={result.recentMovements} canViewChecks={canViewChecks}
        canViewMovements={hasPermission(auth, "inventory_movements.view")} />
    </>}
  </div>;
}
