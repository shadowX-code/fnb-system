import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Cake,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  Factory,
  Gift,
  LineChart,
  PackageSearch,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import { assetTrackingService } from "../../../services/assetTrackingService.js";
import { dutyRosterService } from "../../../services/dutyRosterService.js";
import { employeeService } from "../../../services/employeeService.js";
import { productAnalyticsService } from "../../../services/productAnalyticsService.js";
import { months } from "../data/mockData.js";
import {
  buildAlerts,
  getNetSales,
  getPurchaseTotal,
  getPreviousPeriod,
  percentageChange,
  toCurrency,
  toPercent,
} from "../utils/analytics.js";

const cogsTarget = 35;
const outletColors = ["#16a34a", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"];
const nonWorkingShiftCodes = new Set(["OFF", "AL", "MC", "LEAVE", "ANNUAL_LEAVE", "MEDICAL"]);
const attentionConditions = new Set(["needs_review", "damaged", "missing", "under_maintenance", "low_quantity"]);
const criticalConditions = new Set(["damaged", "missing"]);

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStart(year, month) {
  return new Date(Number(year), Number(month) - 1, 1);
}

function monthEnd(year, month) {
  return new Date(Number(year), Number(month), 0);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthName(month) {
  return months.find((item) => item.value === Number(month))?.label ?? "";
}

function fullMonthName(month) {
  return new Date(2026, Number(month) - 1, 1).toLocaleDateString("en-MY", { month: "long" });
}

function formatMonthYear(month, year) {
  return `${fullMonthName(month)} ${year}`;
}

function formatShortDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

function formatUpdated(date = new Date()) {
  return date.toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function outletCode(outlet) {
  if (outlet?.code) return outlet.code;
  return String(outlet?.name ?? "OUT")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function outletMeta(outlet, index = 0) {
  return {
    id: outlet?.id ?? "",
    name: outlet?.name ?? "Unknown outlet",
    code: outletCode(outlet),
    color: outletColors[index % outletColors.length],
  };
}

function OutletBadge({ outlet }) {
  if (!outlet) return <Badge tone="neutral">Global</Badge>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-bold text-text-secondary">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: outlet.color }} />
      <span className="truncate">{outlet.code}</span>
    </span>
  );
}

function StatusPill({ tone = "neutral", children }) {
  const toneClass = tone === "danger"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : tone === "info"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-border bg-white/80 text-text-secondary";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 type-caption font-bold shadow-sm ${toneClass}`}>{children}</span>;
}

function getTone(status) {
  if (["Critical", "High", "Overdue"].includes(status)) return "danger";
  if (["Watch", "Draft", "Due"].includes(status)) return "warning";
  if (["Good", "Published", "Clear"].includes(status)) return "success";
  return "neutral";
}

function signedPercent(value) {
  if (!Number.isFinite(value) || value === 0) return "0.0%";
  return `${value > 0 ? "+" : ""}${toPercent(value)}`;
}

function metricTone(value, positiveIsGood = true) {
  if (!Number.isFinite(value) || value === 0) return "neutral";
  const good = positiveIsGood ? value >= 0 : value <= 0;
  return good ? "success" : "danger";
}

function trendIcon(value, positiveIsGood = true) {
  const good = positiveIsGood ? value >= 0 : value <= 0;
  return good ? TrendingUp : TrendingDown;
}

function monthOptions() {
  const current = monthStart(new Date().getFullYear(), new Date().getMonth() + 1);
  return Array.from({ length: 18 }, (_, index) => {
    const date = addMonths(current, 5 - index);
    return {
      value: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
      label: formatMonthYear(date.getMonth() + 1, date.getFullYear()),
    };
  });
}

function periodRange(year, month, count = 6) {
  const current = monthStart(year, month);
  return Array.from({ length: count }, (_, index) => {
    const date = addMonths(current, index - count + 1);
    return {
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      label: monthName(date.getMonth() + 1).toUpperCase(),
      fullLabel: formatMonthYear(date.getMonth() + 1, date.getFullYear()),
    };
  });
}

function normalizeProductName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isWorkingShift(roster) {
  const code = String(roster.template?.code || roster.template?.name || "").trim().toUpperCase().replace(/\s+/g, "_");
  const type = String(roster.template?.shift_type || "").toLowerCase();
  return !nonWorkingShiftCodes.has(code) && !["off", "leave", "medical"].includes(type);
}

function birthdayOccurrence(birthday, referenceDate = todayDate()) {
  if (!birthday) return null;
  const birthDate = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return null;
  let next = new Date(referenceDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  if (next < referenceDate) next = new Date(referenceDate.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate());
  const days = Math.round((next - referenceDate) / 86400000);
  return { date: next, days };
}

function aggregateProducts(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const key = `${normalizeProductName(item.product_name)}|${String(item.category_name || "Uncategorized").trim().toLowerCase()}`;
    if (!normalizeProductName(item.product_name)) return;
    const current = map.get(key) ?? {
      product_name: item.product_name,
      category_name: item.category_name || "Uncategorized",
      quantity: 0,
      nett_sales: 0,
      variants: new Set(),
      outlet_id: item.outlet_id,
    };
    current.quantity += Number(item.quantity || 0);
    current.nett_sales += Number(item.nett_sales || 0);
    if (item.variant_name) current.variants.add(item.variant_name);
    map.set(key, current);
  });
  return [...map.values()].map((item) => ({ ...item, variantCount: item.variants.size }));
}

function EmptyState({ title, message, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-slate-50/70 px-4 py-5 text-sm">
      <div className="font-bold text-text-primary">{title}</div>
      <p className="mt-1 text-text-secondary">{message}</p>
      {action}
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-bold text-text-primary">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-text-secondary">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function MiniTile({ icon: Icon, count, label, tone = "neutral", outlet, route, ui }) {
  const toneClass = tone === "danger"
    ? "border-rose-100 bg-rose-50 text-rose-700 hover:border-rose-200 hover:shadow-[0_10px_30px_rgba(244,63,94,0.10)]"
    : tone === "warning"
      ? "border-amber-100 bg-amber-50 text-amber-700 hover:border-amber-200 hover:shadow-[0_10px_30px_rgba(245,158,11,0.10)]"
      : tone === "success"
        ? "border-emerald-100 bg-emerald-50 text-emerald-700 hover:border-emerald-200"
        : "border-border bg-white text-text-secondary hover:border-primary/20";
  const Component = route ? "button" : "div";
  return (
    <Component
      className={`w-full rounded-2xl border p-3 text-left transition duration-150 hover:-translate-y-0.5 ${toneClass} ${route ? "cursor-pointer" : "opacity-80"}`}
      type={route ? "button" : undefined}
      onClick={route ? () => ui?.navigate?.(route) : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/75 shadow-sm">
          <Icon size={16} />
        </span>
        {outlet ? <OutletBadge outlet={outlet} /> : null}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-text-primary">{count}</div>
          <div className="mt-0.5 type-caption font-semibold text-text-secondary">{label}</div>
        </div>
        {route ? <ChevronRight size={15} className="text-text-muted" /> : null}
      </div>
    </Component>
  );
}

function alertTone(alert) {
  if (["critical", "high"].includes(alert.priority) || alert.severity === "danger") return "danger";
  if (["medium", "warning"].includes(alert.priority) || alert.severity === "warning") return "warning";
  return "info";
}

function alertCategory(alert) {
  if (alert.alert_type?.includes("cogs")) return "COGS";
  if (alert.alert_type?.includes("asset")) return "Assets";
  if (alert.alert_type?.includes("roster")) return "Roster";
  if (alert.related_supplier_id || alert.alert_type?.includes("purchase")) return "Purchase";
  if (alert.alert_type?.includes("product")) return "Product";
  return "Sales";
}

export default function DashboardOverviewPage({ store, auth, ui }) {
  const currentDate = new Date();
  const [selectedPeriod, setSelectedPeriod] = useState(`${currentDate.getFullYear()}-${pad(currentDate.getMonth() + 1)}`);
  const [selectedOutletId, setSelectedOutletId] = useState("all");
  const [trendMode, setTrendMode] = useState("sales_purchase");
  const [opsData, setOpsData] = useState({
    assets: [],
    inspections: [],
    maintenance: [],
    rosters: [],
    productReports: [],
    productItems: [],
    employees: [],
    loading: true,
    errors: [],
  });

  const [year, month] = selectedPeriod.split("-").map(Number);
  const activeOutlets = useMemo(
    () => (store.outlets ?? []).filter((outlet) => outlet.status === "active" || outlet.is_active !== false),
    [store.outlets],
  );
  const outletById = useMemo(() => new Map(activeOutlets.map((outlet, index) => [outlet.id, outletMeta(outlet, index)])), [activeOutlets]);
  const scopeOutletIds = useMemo(
    () => selectedOutletId === "all" ? activeOutlets.map((outlet) => outlet.id) : [selectedOutletId].filter(Boolean),
    [activeOutlets, selectedOutletId],
  );
  useEffect(() => {
    if (selectedOutletId !== "all" && activeOutlets.length && !activeOutlets.some((outlet) => outlet.id === selectedOutletId)) {
      setSelectedOutletId("all");
    }
  }, [activeOutlets, selectedOutletId]);

  useEffect(() => {
    if (!scopeOutletIds.length) {
      setOpsData((current) => ({ ...current, loading: false }));
      return undefined;
    }
    let ignore = false;
    async function loadOperationsData() {
      setOpsData((current) => ({ ...current, loading: true, errors: [] }));
      const start = toDateInputValue(monthStart(year, month));
      const end = toDateInputValue(monthEnd(year, month));
      const rosterRequests = scopeOutletIds.map((outletId) => dutyRosterService.listDutyRosters(outletId, start, end));
      const results = await Promise.allSettled([
        assetTrackingService.listAssets(selectedOutletId === "all" ? "all" : selectedOutletId),
        assetTrackingService.listInspections("", selectedOutletId === "all" ? "" : selectedOutletId),
        assetTrackingService.listMaintenanceRecords("", selectedOutletId === "all" ? "" : selectedOutletId),
        productAnalyticsService.listReports({ outletIds: scopeOutletIds }),
        employeeService.listEmployees(),
        Promise.all(rosterRequests),
      ]);
      if (ignore) return;
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message || "Some operational data could not be loaded.");
      const reports = results[3].status === "fulfilled" ? results[3].value : [];
      const current = reports.filter((report) => scopeOutletIds.includes(report.outlet_id) && report.report_month === month && report.report_year === year);
      const previous = getPreviousPeriod(month, year);
      const previousReports = reports.filter((report) => scopeOutletIds.includes(report.outlet_id) && report.report_month === previous.month && report.report_year === previous.year);
      let productItems = [];
      try {
        productItems = await productAnalyticsService.listItemsByReportIds([...current, ...previousReports].map((report) => report.id));
      } catch (error) {
        errors.push(error?.message || "Product analytics details could not be loaded.");
      }
      if (ignore) return;
      const scoped = (rows) => rows.filter((row) => !row.outlet_id || scopeOutletIds.includes(row.outlet_id));
      setOpsData({
        assets: results[0].status === "fulfilled" ? scoped(results[0].value) : [],
        inspections: results[1].status === "fulfilled" ? scoped(results[1].value) : [],
        maintenance: results[2].status === "fulfilled" ? scoped(results[2].value) : [],
        productReports: reports,
        productItems,
        employees: results[4].status === "fulfilled" ? results[4].value.filter((employee) => !employee.workplace || scopeOutletIds.includes(employee.workplace)) : [],
        rosters: results[5].status === "fulfilled" ? results[5].value.flat().filter((row) => scopeOutletIds.includes(row.outlet_id)) : [],
        loading: false,
        errors,
      });
    }
    loadOperationsData();
    return () => {
      ignore = true;
    };
  }, [month, scopeOutletIds.join("|"), selectedOutletId, year]);

  const outletMonthlyRows = useMemo(() => activeOutlets
    .filter((outlet) => scopeOutletIds.includes(outlet.id))
    .map((outlet, index) => {
      const previous = getPreviousPeriod(month, year);
      const netSales = getNetSales(store.salesRecords, outlet.id, month, year, store.salesChannels);
      const totalPurchase = getPurchaseTotal(store.purchaseRecords, outlet.id, month, year);
      const previousNetSales = getNetSales(store.salesRecords, outlet.id, previous.month, previous.year, store.salesChannels);
      const cogs = netSales ? (totalPurchase / netSales) * 100 : null;
      const outletAlerts = buildAlerts({
        outletId: outlet.id,
        month,
        year,
        salesRecords: store.salesRecords,
        salesChannels: store.salesChannels,
        purchaseRecords: store.purchaseRecords,
        suppliers: store.suppliers,
        outletTaxConfigs: store.outletTaxConfigs,
        specialMonths: store.specialMonths,
      }).map((alert) => ({ ...alert, outlet_id: outlet.id, outlet: outletMeta(outlet, index) }));
      const outletAssets = opsData.assets.filter((asset) => asset.outlet_id === outlet.id);
      const seriousAssetIssues = outletAssets.filter((asset) => criticalConditions.has(asset.condition)).length;
      const assetWatch = outletAssets.filter((asset) => attentionConditions.has(asset.condition) || Number(asset.current_quantity || 0) <= Number(asset.minimum_quantity || 0)).length;
      const outletRosters = opsData.rosters.filter((roster) => roster.outlet_id === outlet.id);
      const workingRosters = outletRosters.filter(isWorkingShift);
      const hasDraftRoster = workingRosters.some((roster) => roster.status !== "published" && roster.status !== "locked");
      const hasPublishedRoster = workingRosters.some((roster) => roster.status === "published" || roster.status === "locked");
      const hasCriticalAlert = outletAlerts.some((alert) => ["critical", "high"].includes(alert.priority));
      const hasWatchAlert = outletAlerts.some((alert) => ["medium", "warning"].includes(alert.priority) || alert.severity === "warning");
      const cogsStatus = cogs === null ? "No Data" : cogs > 45 ? "Critical" : cogs > cogsTarget ? "Watch" : "Good";
      let status = "Good";
      const reasons = [];
      if (!netSales) reasons.push("No sales input");
      if (cogs !== null && cogs > 45) reasons.push("COGS above critical threshold");
      else if (cogs !== null && cogs > cogsTarget) reasons.push("COGS above target");
      if (hasCriticalAlert) reasons.push("Critical alert open");
      if (seriousAssetIssues) reasons.push(`${seriousAssetIssues} serious asset issue${seriousAssetIssues === 1 ? "" : "s"}`);
      if (!hasPublishedRoster && workingRosters.length) reasons.push("Roster still in draft");
      if (cogs !== null && cogs > 45 || hasCriticalAlert || seriousAssetIssues) status = "Critical";
      else if (hasWatchAlert || (cogs !== null && cogs > cogsTarget) || assetWatch || hasDraftRoster || !netSales) status = "Watch";
      return {
        outlet: outletMeta(outlet, index),
        netSales,
        totalPurchase,
        cogs,
        cogsStatus,
        vsLastMonth: percentageChange(netSales, previousNetSales),
        alerts: outletAlerts,
        staffing: hasPublishedRoster ? "Published" : workingRosters.length ? "Draft" : "No roster",
        assets: seriousAssetIssues ? "Critical" : assetWatch ? "Watch" : "Good",
        status,
        reasons,
      };
    }), [activeOutlets, month, opsData.assets, opsData.rosters, scopeOutletIds, store, year]);

  const selectedTotals = useMemo(() => {
    const previous = getPreviousPeriod(month, year);
    const currentSales = scopeOutletIds.reduce((sum, outletId) => sum + getNetSales(store.salesRecords, outletId, month, year, store.salesChannels), 0);
    const previousSales = scopeOutletIds.reduce((sum, outletId) => sum + getNetSales(store.salesRecords, outletId, previous.month, previous.year, store.salesChannels), 0);
    const currentPurchase = scopeOutletIds.reduce((sum, outletId) => sum + getPurchaseTotal(store.purchaseRecords, outletId, month, year), 0);
    const previousPurchase = scopeOutletIds.reduce((sum, outletId) => sum + getPurchaseTotal(store.purchaseRecords, outletId, previous.month, previous.year), 0);
    const cogs = currentSales ? (currentPurchase / currentSales) * 100 : null;
    const previousCogs = previousSales ? (previousPurchase / previousSales) * 100 : null;
    const grossProfit = currentSales - currentPurchase;
    return {
      sales: currentSales,
      purchase: currentPurchase,
      cogs,
      grossProfit,
      grossMargin: currentSales ? (grossProfit / currentSales) * 100 : 0,
      salesChange: percentageChange(currentSales, previousSales),
      purchaseChange: percentageChange(currentPurchase, previousPurchase),
      cogsChange: cogs !== null && previousCogs !== null ? cogs - previousCogs : 0,
    };
  }, [month, scopeOutletIds, store.purchaseRecords, store.salesChannels, store.salesRecords, year]);

  const allAlerts = useMemo(() => outletMonthlyRows.flatMap((row) => row.alerts), [outletMonthlyRows]);
  const priorityAlerts = allAlerts.filter((alert) => ["critical", "high"].includes(alert.priority) || alert.severity === "danger");
  const watchAlerts = allAlerts.filter((alert) => !priorityAlerts.includes(alert));

  const topSalesOutlet = outletMonthlyRows.reduce((best, row) => row.netSales > (best?.netSales ?? -1) ? row : best, null);
  const topPurchaseOutlet = outletMonthlyRows.reduce((best, row) => row.totalPurchase > (best?.totalPurchase ?? -1) ? row : best, null);

  const trendPeriods = useMemo(() => periodRange(year, month, 6), [month, year]);
  const trendData = useMemo(() => trendPeriods.map((period) => {
    const sales = scopeOutletIds.reduce((sum, outletId) => sum + getNetSales(store.salesRecords, outletId, period.month, period.year, store.salesChannels), 0);
    const purchase = scopeOutletIds.reduce((sum, outletId) => sum + getPurchaseTotal(store.purchaseRecords, outletId, period.month, period.year), 0);
    const grossProfit = sales - purchase;
    return {
      ...period,
      sales,
      purchase,
      cogs: sales ? (purchase / sales) * 100 : 0,
      grossProfit,
    };
  }), [scopeOutletIds, store.purchaseRecords, store.salesChannels, store.salesRecords, trendPeriods]);

  const currentReportIds = opsData.productReports
    .filter((report) => scopeOutletIds.includes(report.outlet_id) && report.report_month === month && report.report_year === year)
    .map((report) => report.id);
  const previousPeriod = getPreviousPeriod(month, year);
  const previousReportIds = opsData.productReports
    .filter((report) => scopeOutletIds.includes(report.outlet_id) && report.report_month === previousPeriod.month && report.report_year === previousPeriod.year)
    .map((report) => report.id);
  const currentProducts = aggregateProducts(opsData.productItems.filter((item) => currentReportIds.includes(item.report_id)));
  const previousProducts = aggregateProducts(opsData.productItems.filter((item) => previousReportIds.includes(item.report_id)));
  const previousProductByName = new Map(previousProducts.map((item) => [normalizeProductName(item.product_name), item]));
  const topProduct = [...currentProducts].sort((a, b) => b.nett_sales - a.nett_sales)[0];
  const fastestGrowing = currentProducts
    .map((item) => {
      const previous = previousProductByName.get(normalizeProductName(item.product_name));
      return { ...item, change: percentageChange(item.nett_sales, previous?.nett_sales || 0) };
    })
    .filter((item) => item.nett_sales > 0)
    .sort((a, b) => b.change - a.change)[0];
  const needsAttentionProduct = currentProducts
    .filter((item) => item.quantity < 5 || item.nett_sales < 100)
    .sort((a, b) => a.quantity - b.quantity || a.nett_sales - b.nett_sales)[0];

  const today = todayDate();
  const inspectionDrafts = opsData.inspections.filter((inspection) => ["draft", "in_progress", "pending_review"].includes(inspection.status));
  const overdueMaintenance = opsData.maintenance.filter((record) => {
    const scheduled = new Date(`${record.scheduled_date || record.date}T00:00:00`);
    return scheduled < today && !["completed", "cancelled"].includes(record.status);
  });
  const lowQuantityAssets = opsData.assets.filter((asset) => Number(asset.current_quantity || 0) <= Number(asset.minimum_quantity || 0) || asset.condition === "low_quantity");
  const missingAssets = opsData.assets.filter((asset) => asset.condition === "missing" || Number(asset.current_quantity || 0) === 0);
  const rosterIssueOutlets = outletMonthlyRows.filter((row) => row.staffing !== "Published");
  const pendingActions = [
    { label: "Purchase drafts", count: 0, route: "purchase-input" },
    { label: "Inspections incomplete", count: inspectionDrafts.length, route: "asset_tracking" },
    { label: "Alerts unresolved", count: allAlerts.length, route: "alerts" },
    { label: "Supplier not categorized", count: (store.suppliers ?? []).filter((supplier) => !supplier.default_category_id && !supplier.category).length, route: "suppliers" },
    { label: "Low stock items", count: lowQuantityAssets.length, route: "asset_tracking" },
    { label: "Roster not published", count: rosterIssueOutlets.length, route: "duty-roster" },
  ];

  const birthdays = useMemo(() => {
    const scopedEmployees = opsData.employees.filter((employee) => employee.is_active !== false && (!employee.workplace || scopeOutletIds.includes(employee.workplace)));
    const mapped = scopedEmployees
      .map((employee) => ({ employee, birthday: birthdayOccurrence(employee.birthday, today) }))
      .filter((item) => item.birthday)
      .sort((a, b) => a.birthday.days - b.birthday.days);
    return {
      upcoming: mapped.filter((item) => item.birthday.days <= 30),
      next: mapped[0],
    };
  }, [opsData.employees, scopeOutletIds]);

  const statusCounts = outletMonthlyRows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, { Good: 0, Watch: 0, Critical: 0 });
  const operationsHealthScore = outletMonthlyRows.length
    ? Math.round(outletMonthlyRows.reduce((sum, row) => sum + (row.status === "Good" ? 100 : row.status === "Watch" ? 60 : 25), 0) / outletMonthlyRows.length)
    : 0;
  const businessStatus = statusCounts.Critical ? "Critical" : statusCounts.Watch ? "Watch" : "Good";
  const businessReasons = selectedOutletId === "all"
    ? [
        statusCounts.Critical ? `${statusCounts.Critical} outlet${statusCounts.Critical === 1 ? "" : "s"} critical` : "",
        statusCounts.Watch ? `${statusCounts.Watch} outlet${statusCounts.Watch === 1 ? "" : "s"} on watch` : "",
        priorityAlerts.length ? `${priorityAlerts.length} priority alert${priorityAlerts.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean)
    : outletMonthlyRows[0]?.reasons ?? [];

  const greetingName = auth?.profile?.full_name || auth?.profile?.name || auth?.profile?.email?.split("@")[0] || "there";
  const hasMonthlySales = selectedTotals.sales > 0;
  const hasMonthlyPurchase = selectedTotals.purchase > 0;
  const aiSummary = [
    statusCounts.Critical ? `${statusCounts.Critical} critical outlet${statusCounts.Critical === 1 ? "" : "s"} need attention.` : "",
    allAlerts.length ? `${allAlerts.length} unresolved alert${allAlerts.length === 1 ? "" : "s"} detected.` : "No priority alerts detected.",
    overdueMaintenance.length ? `${overdueMaintenance.length} maintenance item${overdueMaintenance.length === 1 ? "" : "s"} overdue.` : "",
    !hasMonthlySales ? "Sales input is missing for this month." : "",
    !currentReportIds.length ? "Product analytics is not uploaded for this month." : "",
  ].filter(Boolean).slice(0, 3).join(" ");

  return (
    <div className="relative mx-auto max-w-[1500px] space-y-4 before:pointer-events-none before:absolute before:-left-8 before:-right-8 before:-top-6 before:h-80 before:rounded-full before:bg-[radial-gradient(circle_at_25%_15%,rgba(34,197,94,0.14),transparent_36rem)] before:content-['']">
      <section className="relative overflow-hidden rounded-[28px] border border-emerald-100/80 bg-white/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(34,197,94,0.18),transparent_20rem),linear-gradient(135deg,rgba(236,253,245,0.82),transparent_42%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(15,23,42,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="type-caption font-black uppercase tracking-[0.16em] text-primary">HQ Operations Command Center</div>
            <h1 className="mt-2 type-heading-xl font-semibold tracking-tight text-text-primary">
              Good morning, {greetingName}
            </h1>
            <p className="mt-2 type-body-sm text-text-secondary">Here&apos;s what needs attention across your outlets.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill tone="success">{scopeOutletIds.length} outlet{scopeOutletIds.length === 1 ? "" : "s"} active</StatusPill>
              <StatusPill tone={allAlerts.length ? "warning" : "success"}>{allAlerts.length} alert{allAlerts.length === 1 ? "" : "s"} need review</StatusPill>
              <StatusPill tone={overdueMaintenance.length ? "danger" : "success"}>{overdueMaintenance.length} maintenance due</StatusPill>
              <StatusPill tone="info">Monthly data view</StatusPill>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[520px]">
            <label className="block">
              <span className="type-micro font-bold uppercase tracking-wide text-text-muted">Viewing</span>
              <select
                className="mt-1 h-10 w-full rounded-2xl border border-border bg-white/80 px-3 text-[13px] font-semibold text-text-primary outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
                value={selectedOutletId}
                onChange={(event) => setSelectedOutletId(event.target.value)}
              >
                <option value="all">All Outlets</option>
                {activeOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="type-micro font-bold uppercase tracking-wide text-text-muted">Month</span>
              <select
                className="mt-1 h-10 w-full rounded-2xl border border-border bg-white/80 px-3 text-[13px] font-semibold text-text-primary outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
                value={selectedPeriod}
                onChange={(event) => setSelectedPeriod(event.target.value)}
              >
                {monthOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="rounded-2xl border border-white/70 bg-white/65 px-3 py-2 type-caption font-semibold text-text-secondary shadow-sm sm:col-span-2">
              Last updated {formatUpdated()} · All amounts are monthly totals.
            </div>
            <div className="hidden items-center justify-end gap-2 lg:flex">
              <button className="icon-btn" type="button" title="Notifications">
                <Bell size={17} />
              </button>
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-sm font-black text-primary">
                {String(greetingName).slice(0, 1).toUpperCase()}
              </span>
            </div>
          </div>
        </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={trendIcon(selectedTotals.salesChange)}
          label="MTD Sales"
          value={hasMonthlySales ? toCurrency(selectedTotals.sales) : "No sales input"}
          helper={selectedOutletId === "all" && topSalesOutlet ? `Top: ${topSalesOutlet.outlet.name}` : `For ${formatMonthYear(month, year)}`}
          trend={signedPercent(selectedTotals.salesChange)}
          tone={metricTone(selectedTotals.salesChange)}
          status="Monthly"
        />
        <MetricCard
          icon={ShoppingCart}
          label="MTD Purchase"
          value={hasMonthlyPurchase ? toCurrency(selectedTotals.purchase) : "No purchase input"}
          helper={selectedOutletId === "all" && topPurchaseOutlet ? `Top: ${topPurchaseOutlet.outlet.name}` : "Monthly supplier purchase"}
          trend={signedPercent(selectedTotals.purchaseChange)}
          tone={metricTone(selectedTotals.purchaseChange, false)}
          status="Monthly"
        />
        <MetricCard
          icon={Factory}
          label="Avg. COGS %"
          value={selectedTotals.cogs === null ? "No sales input" : toPercent(selectedTotals.cogs)}
          helper={`Target <= ${toPercent(cogsTarget, 0)}`}
          trend={selectedTotals.cogs === null ? "No data" : `${selectedTotals.cogs > cogsTarget ? "Above" : "In range"}`}
          tone={selectedTotals.cogs > cogsTarget ? "warning" : "success"}
          status={selectedTotals.cogs > cogsTarget ? "Watch" : "Good"}
        />
        <MetricCard
          icon={LineChart}
          label="Estimated Gross Profit"
          value={hasMonthlySales ? toCurrency(selectedTotals.grossProfit) : "No sales input"}
          helper={`Gross margin ${toPercent(selectedTotals.grossMargin)}`}
          trend={selectedTotals.grossProfit >= 0 ? "Positive" : "Negative"}
          tone={selectedTotals.grossProfit >= 0 ? "success" : "danger"}
          status="Estimate"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Active Alerts"
          value={allAlerts.length}
          helper={`${priorityAlerts.length} Critical / ${watchAlerts.length} Watch`}
          trend={allAlerts.length ? "Review" : "Clear"}
          tone={allAlerts.length ? "warning" : "success"}
          status={priorityAlerts.length ? "Critical" : allAlerts.length ? "Watch" : "Clear"}
          onClick={() => ui?.navigate?.("alerts")}
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <Card
          title="Outlet Health"
          description="Monthly performance snapshot by outlet."
          action={(
            <div className="min-w-[190px]">
              <div className="flex items-center justify-between gap-3 type-caption font-black text-text-secondary">
                <span>Operations Health</span>
                <span className={operationsHealthScore >= 80 ? "text-emerald-700" : operationsHealthScore >= 55 ? "text-amber-700" : "text-rose-700"}>{operationsHealthScore}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${operationsHealthScore >= 80 ? "bg-emerald-500" : operationsHealthScore >= 55 ? "bg-amber-500" : "bg-rose-500"}`}
                  style={{ width: `${operationsHealthScore}%` }}
                />
              </div>
            </div>
          )}
        >
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-text-muted">
                <tr>
                  {["Outlet", "MTD Sales", "COGS %", "vs Last Month", "Alerts", "Staffing", "Assets", "Status"].map((header) => (
                    <th key={header} className="px-4 py-2.5">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {outletMonthlyRows.map((row) => (
                  <tr key={row.outlet.id} className="transition hover:bg-primary/5 hover:shadow-[inset_3px_0_0_rgba(34,197,94,0.5)]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: row.outlet.color }} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-text-primary">{row.outlet.name}</span>
                            <span className="rounded-full border border-border bg-white px-2 py-0.5 type-micro font-black text-text-muted">{row.outlet.code}</span>
                          </div>
                          <div className="type-caption font-semibold text-text-muted">{row.reasons[0] || "Monthly data in range"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-text-primary">{row.netSales ? toCurrency(row.netSales) : "No input"}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={row.cogsStatus === "Critical" ? "danger" : row.cogsStatus === "Watch" ? "warning" : row.cogsStatus === "Good" ? "success" : "neutral"}>
                        {row.cogs === null ? "No Data" : toPercent(row.cogs)}
                      </Badge>
                    </td>
                    <td className={`px-4 py-2.5 font-bold ${row.vsLastMonth >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{signedPercent(row.vsLastMonth)}</td>
                    <td className="px-4 py-2.5"><Badge tone={row.alerts.length ? "warning" : "success"}>{row.alerts.length}</Badge></td>
                    <td className="px-4 py-2.5"><Badge tone={getTone(row.staffing)}>{row.staffing}</Badge></td>
                    <td className="px-4 py-2.5"><Badge tone={getTone(row.assets)}>{row.assets}</Badge></td>
                    <td className="px-4 py-2.5"><Badge tone={getTone(row.status)}>{row.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!outletMonthlyRows.length ? (
            <div className="p-4">
              <EmptyState title="No accessible outlets" message="No outlets are assigned to your role for this dashboard." />
            </div>
          ) : null}
        </Card>

        <Card
          title="Smart Alerts"
          description="Key issues that need your attention."
          action={<button className="text-xs font-bold text-primary" type="button" onClick={() => ui?.navigate?.("alerts")}>View all alerts</button>}
        >
          <div className="space-y-3 p-4">
            {[...allAlerts].sort((a, b) => (alertTone(a) === "danger" ? -1 : alertTone(a) === "warning" ? 0 : 1) - (alertTone(b) === "danger" ? -1 : alertTone(b) === "warning" ? 0 : 1)).slice(0, 5).map((alert) => {
              const tone = alertTone(alert);
              const toneClass = tone === "danger"
                ? "border-rose-200 bg-rose-50/70 hover:shadow-[0_12px_30px_rgba(244,63,94,0.12)]"
                : tone === "warning"
                  ? "border-amber-200 bg-amber-50/70 hover:shadow-[0_12px_30px_rgba(245,158,11,0.12)]"
                  : "border-blue-200 bg-blue-50/70 hover:shadow-[0_12px_30px_rgba(14,165,233,0.12)]";
              return (
                <button
                  key={alert.id}
                  className={`block w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${toneClass}`}
                  type="button"
                  onClick={() => ui?.navigate?.("alerts")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <OutletBadge outlet={alert.outlet} />
                    <Badge tone={tone}>{tone === "danger" ? "Critical" : tone === "warning" ? "Watch" : "Info"}</Badge>
                    <Badge tone="neutral">{alertCategory(alert)}</Badge>
                  </div>
                  <div className="mt-2 font-bold text-text-primary">{alert.title}</div>
                  <div className="mt-1 type-caption font-semibold text-text-secondary">{alert.description}</div>
                </button>
              );
            })}
            {!allAlerts.length ? (
              <EmptyState title="No priority alerts" message="No monthly business alerts were detected for this scope." />
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)_minmax(300px,0.7fr)]">
        <Card
          title="Monthly Trend"
          description="Last 6 months. All amounts are monthly totals."
          action={(
            <select
              className="h-9 rounded-xl border border-border bg-background px-2 text-xs font-bold text-text-secondary"
              value={trendMode}
              onChange={(event) => setTrendMode(event.target.value)}
            >
              <option value="sales_purchase">Sales vs Purchase</option>
              <option value="cogs">COGS %</option>
              <option value="gross_profit">Gross Profit</option>
            </select>
          )}
        >
          <div className="px-4 pb-4 pt-3">
            <TrendChart
              type="area"
              yAxisType={trendMode === "cogs" ? "percent" : "currency"}
              labels={trendData.map((item) => item.label)}
              renderTooltip={({ label, index }) => {
                const item = trendData[index];
                return (
                  <div className="min-w-44">
                    <div className="font-black text-text-primary">{item?.fullLabel || label}</div>
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between gap-6 text-text-secondary"><span>Sales</span><strong className="text-text-primary">{toCurrency(item?.sales || 0)}</strong></div>
                      <div className="flex justify-between gap-6 text-text-secondary"><span>Purchase</span><strong className="text-text-primary">{toCurrency(item?.purchase || 0)}</strong></div>
                      <div className="flex justify-between gap-6 text-text-secondary"><span>COGS</span><strong className="text-text-primary">{toPercent(item?.cogs || 0)}</strong></div>
                      <div className="flex justify-between gap-6 text-text-secondary"><span>Gross Profit</span><strong className="text-text-primary">{toCurrency(item?.grossProfit || 0)}</strong></div>
                    </div>
                  </div>
                );
              }}
              series={trendMode === "sales_purchase" ? [
                { name: "Sales", data: trendData.map((item) => item.sales), stroke: "#16a34a", fill: "#22c55e", area: true, areaOpacity: 0.16, strokeWidth: 2.4, format: toCurrency },
                { name: "Purchase", data: trendData.map((item) => item.purchase), stroke: "#0ea5e9", fill: "#0ea5e9", area: false, strokeWidth: 2.2, format: toCurrency },
              ] : trendMode === "cogs" ? [
                { name: "COGS %", data: trendData.map((item) => item.cogs), stroke: "#f59e0b", fill: "#f59e0b", area: true, areaOpacity: 0.14, strokeWidth: 2.4, format: (value) => toPercent(value) },
              ] : [
                { name: "Gross Profit", data: trendData.map((item) => item.grossProfit), stroke: "#16a34a", fill: "#22c55e", area: true, areaOpacity: 0.16, strokeWidth: 2.4, format: toCurrency },
              ]}
            />
          </div>
        </Card>

        <Card title="Operational Snapshot" description="Current status across key operations.">
          <div className="grid grid-cols-2 gap-3 p-4">
            <MiniTile icon={ClipboardList} count={inspectionDrafts.length} label="Draft Audits" tone={inspectionDrafts.length ? "warning" : "success"} route="asset_tracking" ui={ui} />
            <MiniTile icon={Wrench} count={overdueMaintenance.length} label="Maintenance Due" tone={overdueMaintenance.length ? "danger" : "success"} route="asset_tracking" ui={ui} />
            <MiniTile icon={PackageSearch} count={lowQuantityAssets.length} label="Low Quantity Assets" tone={lowQuantityAssets.length ? "warning" : "success"} route="asset_tracking" ui={ui} />
            <MiniTile icon={AlertTriangle} count={missingAssets.length} label="Missing Stock Items" tone={missingAssets.length ? "danger" : "success"} route="asset_tracking" ui={ui} />
            <MiniTile icon={Bell} count={allAlerts.length} label="Unresolved Alerts" tone={allAlerts.length ? "warning" : "success"} route="alerts" ui={ui} />
            <MiniTile icon={Users} count={rosterIssueOutlets.length} label="Duty Roster Issues" tone={rosterIssueOutlets.length ? "warning" : "success"} route="outlet_duty_roster" ui={ui} />
          </div>
        </Card>

        <Card title="Pending Actions" description="Tasks and drafts waiting for your action.">
          <div className="divide-y divide-border">
            {pendingActions.map((item) => (
              <button
                key={item.label}
                className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] transition hover:bg-primary/5 ${item.count ? "bg-amber-50/30" : "opacity-70"}`}
                type="button"
                onClick={() => ui?.navigate?.(item.route)}
              >
                <span className="font-semibold text-text-secondary">{item.label}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={item.count ? "warning" : "success"}>{item.count}</Badge>
                  <ChevronRight size={14} className="text-text-muted" />
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(330px,0.75fr)_minmax(330px,0.75fr)]">
        <Card
          title="Top Product Signals (MTD)"
          description="Monthly uploaded Product Analytics data."
          action={<button className="text-xs font-bold text-primary" type="button" onClick={() => ui?.navigate?.("product_analytics")}>View Product Analytics</button>}
        >
          <div className="space-y-3 p-4">
            {!currentReportIds.length ? (
              <EmptyState title="No product report uploaded for this month." message="Upload a POS product sales report in Product Analytics to activate product signals." />
            ) : (
              [
                { label: "Top Seller", product: topProduct, helper: topProduct ? `${toCurrency(topProduct.nett_sales)} · ${topProduct.quantity} sold` : "" },
                { label: "Fastest Growing", product: fastestGrowing, helper: fastestGrowing ? `${signedPercent(fastestGrowing.change)} vs compare month` : "" },
                { label: "Needs Attention", product: needsAttentionProduct, helper: needsAttentionProduct ? `${needsAttentionProduct.quantity} sold · ${toCurrency(needsAttentionProduct.nett_sales)}` : "" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-wide text-primary">{item.label}</div>
                      <div className="mt-1 truncate font-bold text-text-primary">{item.product?.product_name ?? "Not enough data"}</div>
                      <div className="mt-0.5 text-xs font-semibold text-text-secondary">{item.product?.category_name ?? "Upload more product data"}</div>
                    </div>
                    {item.product?.outlet_id ? <OutletBadge outlet={outletById.get(item.product.outlet_id)} /> : null}
                  </div>
                  {item.helper ? <div className="mt-2 text-xs font-bold text-text-secondary">{item.helper}</div> : null}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title="Upcoming Celebrations" description="Team birthdays in the next 30 days.">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-primary"><Cake size={16} /><span className="text-xs font-bold">This Month</span></div>
                <div className="mt-2 text-2xl font-semibold text-text-primary">{birthdays.upcoming.length}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-text-secondary"><Gift size={16} /><span className="text-xs font-bold">Outlets</span></div>
                <div className="mt-2 text-2xl font-semibold text-text-primary">
                  {new Set(birthdays.upcoming.map((item) => item.employee.workplace).filter(Boolean)).size}
                </div>
              </div>
            </div>
            {birthdays.upcoming.length ? (
              <>
                <SectionHeader title="This Week" subtitle="Birthdays due within 7 days." />
                <div className="space-y-2">
                  {birthdays.upcoming.filter((item) => item.birthday.days <= 7).slice(0, 4).map(({ employee, birthday }) => (
                    <div key={employee.id} className="rounded-2xl border border-border bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-text-primary">🎂 {employee.nickname || employee.full_name}</div>
                          <div className="mt-1 text-xs font-semibold text-text-secondary">{employee.position || "Team member"} · {outletById.get(employee.workplace)?.name ?? "Outlet team"}</div>
                        </div>
                        <div className="text-right text-xs font-bold text-primary">{formatShortDate(toDateInputValue(birthday.date))}<br />in {birthday.days}d</div>
                      </div>
                    </div>
                  ))}
                </div>
                <SectionHeader title="Next" />
                <div className="space-y-2">
                  {birthdays.upcoming.filter((item) => item.birthday.days > 7).slice(0, 3).map(({ employee, birthday }) => (
                    <div key={employee.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-semibold text-text-secondary">{employee.nickname || employee.full_name}</span>
                      <span className="text-xs font-bold text-text-muted">{formatShortDate(toDateInputValue(birthday.date))} · in {birthday.days}d</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                title="No upcoming birthdays in the next 30 days."
                message={birthdays.next ? `Next celebration: ${birthdays.next.employee.nickname || birthdays.next.employee.full_name} · ${formatShortDate(toDateInputValue(birthdays.next.birthday.date))}` : "Employee birthday reminders will appear after birthdays are saved."}
                action={<div className="mt-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Gift size={18} /></div>}
              />
            )}
            <button className="btn-secondary w-full" type="button" onClick={() => ui?.navigate?.("employees")}>View Employees</button>
          </div>
        </Card>

        <Card title="Business Pulse" description="Overall business health across selected outlet scope.">
          <div className="space-y-4 p-4">
            <div className={`rounded-3xl border p-4 ${businessStatus === "Critical" ? "border-rose-200 bg-rose-50" : businessStatus === "Watch" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-text-muted">Status</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-text-primary">{businessStatus}</div>
                </div>
                {businessStatus === "Good" ? <CheckCircle2 className="text-emerald-600" size={34} /> : <Sparkles className={businessStatus === "Watch" ? "text-amber-600" : "text-rose-600"} size={34} />}
              </div>
              <p className="mt-3 text-sm font-semibold text-text-secondary">
                {businessStatus === "Good" ? "Monthly operations look stable." : "Some areas need attention."}
              </p>
            </div>
            {selectedOutletId === "all" ? (
              <div className="grid grid-cols-3 gap-2">
                {["Good", "Watch", "Critical"].map((status) => (
                  <div key={status} className="rounded-2xl bg-slate-50 p-3 text-center">
                    <div className="text-xl font-semibold text-text-primary">{statusCounts[status] ?? 0}</div>
                    <div className="text-[11px] font-bold text-text-muted">{status}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="rounded-2xl border border-border p-3">
              <div className="text-xs font-black uppercase tracking-wide text-text-muted">Reasons</div>
              <div className="mt-2 space-y-1.5">
                {(businessReasons.length ? businessReasons : ["No priority risk detected."]).map((reason) => (
                  <div key={reason} className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {reason}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
              <div className="flex items-center gap-2 type-caption font-black uppercase tracking-wide text-primary">
                <Sparkles size={14} />
                AI Summary
              </div>
              <p className="mt-2 text-sm font-semibold leading-5 text-text-secondary">{aiSummary || "Monthly operations look stable across the selected outlet scope."}</p>
            </div>
          </div>
        </Card>
      </div>

      {opsData.errors.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Some optional operational data could not be loaded yet. The dashboard is showing available monthly sales and purchase data.
        </div>
      ) : null}
    </div>
  );
}
