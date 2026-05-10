import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Bell, Building2, ClipboardList, Download, Settings } from "lucide-react";
import Badge from "../components/ui/Badge.jsx";
import { buildAlerts, getPreviousPeriod, getSupplierName, percentageChange, toPercent } from "../features/sales-purchase/utils/analytics.js";

const iconMap = {
  dashboard: BarChart3,
  "sales-input": ClipboardList,
  "sales-comparison": BarChart3,
  "purchase-input": ClipboardList,
  "purchase-comparison": BarChart3,
  suppliers: Building2,
  outlets: Building2,
  settings: Settings,
  alerts: BarChart3,
  "data-import": Download,
  "data-health": BarChart3,
};

function latestPeriod(store) {
  const records = [...store.salesRecords, ...store.purchaseRecords].filter((record) => record.outlet_id);
  const latest = records.sort((a, b) => (a.year - b.year) || (a.month - b.month)).at(-1);
  return {
    outletId: latest?.outlet_id ?? store.outlets[0]?.id,
    month: latest?.month ?? 1,
    year: latest?.year ?? new Date().getFullYear(),
  };
}

function buildNotificationItems(store) {
  const period = latestPeriod(store);
  const alerts = buildAlerts({
    outletId: period.outletId,
    month: period.month,
    year: period.year,
    salesRecords: store.salesRecords,
    salesChannels: store.salesChannels,
    purchaseRecords: store.purchaseRecords,
    suppliers: store.suppliers,
    outletTaxConfigs: store.outletTaxConfigs,
    specialMonths: store.specialMonths,
  });
  const previous = getPreviousPeriod(period.month, period.year);
  const currentDelivery = store.salesRecords
    .filter((record) => record.outlet_id === period.outletId && record.month === period.month && record.year === period.year)
    .filter((record) => {
      const channel = store.salesChannels.find((item) => item.id === record.channel_id);
      return ["GrabFood", "FoodPanda", "ShopeeFood"].includes(channel?.name);
    })
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const previousDelivery = store.salesRecords
    .filter((record) => record.outlet_id === period.outletId && record.month === previous.month && record.year === previous.year)
    .filter((record) => {
      const channel = store.salesChannels.find((item) => item.id === record.channel_id);
      return ["GrabFood", "FoodPanda", "ShopeeFood"].includes(channel?.name);
    })
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const deliveryChange = percentageChange(currentDelivery, previousDelivery);
  const supplierSpike = store.purchaseRecords
    .filter((record) => record.outlet_id === period.outletId && record.month === period.month && record.year === period.year)
    .map((record) => {
      const previousAmount = store.purchaseRecords
        .filter((item) => item.outlet_id === period.outletId && item.month === previous.month && item.year === previous.year && item.supplier_id === record.supplier_id)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return { record, change: percentageChange(Number(record.amount || 0), previousAmount) };
    })
    .sort((a, b) => b.change - a.change)[0];

  const items = [
    ...alerts.slice(0, 3).map((alert) => ({
      id: alert.id,
      section: "Alerts",
      label: alert.priority?.toUpperCase() ?? "INFO",
      tone: alert.priority === "critical" || alert.priority === "high" ? "danger" : alert.priority === "medium" ? "warning" : "info",
      title: alert.title,
      description: alert.description,
    })),
    supplierSpike && supplierSpike.change > 30
      ? {
          id: "supplier-spike",
          section: "Alerts",
          label: supplierSpike.change > 75 ? "HIGH" : "WARNING",
          tone: supplierSpike.change > 75 ? "danger" : "warning",
          title: `${getSupplierName(store.suppliers, supplierSpike.record.supplier_id)} increased ${toPercent(supplierSpike.change)}`,
          description: "Supplier purchase is materially above previous month.",
        }
      : null,
    {
      id: "delivery-insight",
      section: "Insights",
      label: "INFO",
      tone: "info",
      title: deliveryChange < 0 ? "Delivery sales slowed this month" : "Delivery sales changed this month",
      description: `Delivery platform sales moved ${toPercent(deliveryChange)} vs previous month.`,
    },
    {
      id: "draft-health",
      section: "Data Health",
      label: "INFO",
      tone: "info",
      title: "2 draft purchase rows detected",
      description: "Review draft rows before locking the month.",
    },
  ].filter(Boolean);

  if (!items.length) {
    return [
      {
        id: "caught-up",
        section: "Data Health",
        label: "INFO",
        tone: "success",
        title: "You're all caught up.",
        description: "No alerts, insights, or data health items need attention.",
      },
    ];
  }

  return items;
}

function NotificationPopover({ items, onClose }) {
  const grouped = ["Alerts", "Insights", "Data Health"].map((section) => ({
    section,
    items: items.filter((item) => item.section === section),
  })).filter((group) => group.items.length);

  return (
    <div className="absolute right-0 top-11 z-50 w-[360px] origin-top-right rounded-2xl border border-border bg-white shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-bold text-text-primary">Notifications</div>
          <div className="text-xs text-text-secondary">Alerts, insights and data health</div>
        </div>
        <button className="rounded-lg px-2 py-1 text-xs font-bold text-text-secondary hover:bg-slate-50" type="button" onClick={onClose}>Close</button>
      </div>
      <div className="max-h-[430px] overflow-y-auto p-2">
        {grouped.length ? grouped.map((group) => (
          <section key={group.section} className="py-2">
            <div className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">{group.section}</div>
            <div className="space-y-1">
              {group.items.map((item) => (
                <div key={item.id} className="rounded-xl px-3 py-2 transition hover:bg-slate-50">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      item.tone === "danger"
                        ? "bg-rose-100 text-rose-700"
                        : item.tone === "warning"
                          ? "bg-amber-100 text-amber-700"
                          : item.tone === "success"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-blue-100 text-blue-700"
                    }`}>
                      {item.label}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-text-primary">{item.title}</div>
                      <p className="mt-1 text-xs leading-5 text-text-secondary">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )) : (
          <div className="p-8 text-center">
            <div className="text-sm font-bold text-text-primary">You're all caught up.</div>
            <p className="mt-1 text-sm text-text-secondary">No alerts, insights, or data health items need attention.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AppShell({ activeRoute, activeRouteId, sections, onNavigate, children, store }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationRef = useRef(null);
  const latestUpdate = [...store.salesRecords, ...store.purchaseRecords]
    .map((record) => record.updated_at)
    .sort()
    .at(-1);
  const notificationItems = useMemo(() => buildNotificationItems(store), [store]);
  const unreadCount = notificationItems.filter((item) => item.id !== "caught-up").length;

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    function handlePointerDown(event) {
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setNotificationsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen]);

  return (
    <div className="min-h-screen bg-app-bg text-text-primary">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-border bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
            <BarChart3 size={18} />
          </div>
          <div>
            <div className="text-sm font-bold text-text-primary">F&B Ops</div>
            <div className="text-xs text-text-secondary">Intelligence</div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="mb-2 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                <span>{section.label}</span>
                {section.items.length > 1 ? <span className="text-xs">⌄</span> : null}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = iconMap[item.id] ?? ClipboardList;
                  const active = activeRouteId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"
                      }`}
                    >
                      <Icon size={16} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
            <div className="h-9 w-9 rounded-full bg-slate-900" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Marcus Lee</div>
              <div className="text-xs text-text-secondary">Owner</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 border-b border-border bg-app-bg/95 backdrop-blur">
          <div className="flex h-12 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Sales & Purchase Management
              </div>
            </div>
            <div className="ml-auto hidden items-center gap-2 xl:flex">
              <Badge tone="success">
                <span className="inline-flex items-center gap-1">Data Healthy</span>
              </Badge>
              <span className="text-xs font-medium text-text-secondary">
                Updated {latestUpdate ? new Date(latestUpdate).toLocaleDateString() : "today"}
              </span>
            </div>
            <div className="relative flex items-center gap-2" ref={notificationRef}>
              <button
                className={`icon-btn relative ${notificationsOpen ? "border-primary/30 bg-primary/5 text-primary" : ""}`}
                type="button"
                aria-label="Notifications"
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen((value) => !value)}
              >
                <Bell size={17} />
                {unreadCount ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>
              <div className="hidden h-7 w-7 rounded-full bg-slate-900 xl:block" aria-label="Profile" />
              {notificationsOpen ? <NotificationPopover items={notificationItems} onClose={() => setNotificationsOpen(false)} /> : null}
            </div>
          </div>
        </header>

        <main className="px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1440px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
