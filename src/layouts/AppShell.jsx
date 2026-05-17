import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Bell, Building2, Check, ChevronsDownUp, ChevronsUpDown, ChevronDown, ClipboardList, Download, KeyRound, LogOut, Menu, Monitor, Moon, Settings, Shield, Sun, Users, X } from "lucide-react";
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
  "sales-channels": Settings,
  "tax-settings": Settings,
  "purchase-categories": Settings,
  alerts: BarChart3,
  "data-import": Download,
  "data-health": BarChart3,
  "audit-logs": KeyRound,
  employees: Users,
  users: Users,
  "job-positions": ClipboardList,
  departments: Building2,
  roles: Shield,
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

const themeOptions = [
  { value: "light", label: "Light Mode", icon: Sun },
  { value: "dark", label: "Dark Mode", icon: Moon },
  { value: "system", label: "System Default", icon: Monitor },
];

function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function ThemeMenu({ themeChoice, resolvedTheme, onThemeChange, onLogout }) {
  return (
    <div className="absolute right-0 top-10 z-50 w-[260px] origin-top-right rounded-2xl border border-border bg-surface p-2 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95">
      <div className="px-2 py-2">
        <div className="text-sm font-bold text-text-primary">Workspace Theme</div>
        <div className="mt-1 text-xs text-text-secondary">Current appearance: {resolvedTheme === "dark" ? "Dark" : "Light"}</div>
      </div>
      <div className="space-y-1">
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const active = themeChoice === option.value;
          return (
            <button
              key={option.value}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                active ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"
              }`}
              type="button"
              onClick={() => onThemeChange(option.value)}
            >
              <span className="flex items-center gap-2">
                <Icon size={15} />
                {option.label}
              </span>
              {active ? <Check size={15} strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-text-secondary transition hover:bg-slate-50 hover:text-text-primary" type="button" onClick={onLogout}>
          <LogOut size={15} />
          Logout
        </button>
      </div>
    </div>
  );
}

export default function AppShell({ activeRoute, activeRouteId, sections, onNavigate, children, store, auth, onLogout }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [themeChoice, setThemeChoice] = useState(() => {
    if (typeof window === "undefined") return "system";
    try {
      return localStorage.getItem("fnb.theme") || "system";
    } catch {
      return "system";
    }
  });
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const notificationRef = useRef(null);
  const activeSectionLabel = useMemo(
    () => sections.find((section) => section.items.some((item) => item.id === activeRouteId))?.label,
    [activeRouteId, sections],
  );
  const [openSections, setOpenSections] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("fnb.sidebar.openSections") || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  });
  const latestUpdate = [...store.salesRecords, ...store.purchaseRecords]
    .map((record) => record.updated_at)
    .sort()
    .at(-1);
  const notificationItems = useMemo(() => buildNotificationItems(store), [store]);
  const unreadCount = notificationItems.filter((item) => item.id !== "caught-up").length;
  const resolvedTheme = themeChoice === "system" ? systemTheme : themeChoice;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeChoice;
    root.dataset.resolvedTheme = resolvedTheme;
    try {
      localStorage.setItem("fnb.theme", themeChoice);
    } catch {
      // Theme still applies for the current session if storage is unavailable.
    }
  }, [resolvedTheme, themeChoice]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return undefined;
    function handleChange(event) {
      setSystemTheme(event.matches ? "dark" : "light");
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!activeSectionLabel) return;
    setOpenSections((current) => {
      if (current[activeSectionLabel]) return current;
      return { ...current, [activeSectionLabel]: true };
    });
  }, [activeSectionLabel]);

  useEffect(() => {
    localStorage.setItem("fnb.sidebar.openSections", JSON.stringify(openSections));
  }, [openSections]);

  function toggleSection(sectionLabel) {
    setOpenSections((current) => ({
      ...current,
      [sectionLabel]: !current[sectionLabel],
    }));
  }

  function expandAllSections() {
    setOpenSections(Object.fromEntries(sections.map((section) => [section.label, true])));
  }

  function collapseAllSections() {
    const nextState = Object.fromEntries(sections.map((section) => [section.label, false]));
    if (activeSectionLabel) nextState[activeSectionLabel] = true;
    setOpenSections(nextState);
  }

  const allSectionsExpanded = sections.every((section) => openSections[section.label] ?? section.label === activeSectionLabel);

  function toggleAllSections() {
    if (allSectionsExpanded) {
      collapseAllSections();
    } else {
      expandAllSections();
    }
  }

  function handleNavigate(itemId) {
    onNavigate(itemId);
    setMobileSidebarOpen(false);
  }

  useEffect(() => {
    if (!notificationsOpen && !profileMenuOpen) return undefined;
    function handlePointerDown(event) {
      if (!notificationRef.current?.contains(event.target)) {
        setNotificationsOpen(false);
        setProfileMenuOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen, profileMenuOpen]);

  useEffect(() => {
    if (!mobileSidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [activeRouteId]);

  const sidebarContent = (isMobile = false) => (
    <>
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
          <BarChart3 size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-text-primary">FeedX</div>
          <div className="text-xs text-text-secondary">F&amp;B Intelligence</div>
        </div>
        {isMobile ? (
          <button
            className="icon-btn ml-auto"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <X size={17} />
          </button>
        ) : (
          <button
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-text-muted transition hover:border-primary/20 hover:bg-primary/10 hover:text-primary"
            type="button"
            title={allSectionsExpanded ? "Collapse Navigation" : "Expand Navigation"}
            aria-label={allSectionsExpanded ? "Collapse Navigation" : "Expand Navigation"}
            aria-pressed={allSectionsExpanded}
            onClick={toggleAllSections}
          >
            {allSectionsExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {sections.map((section) => {
          const isOpen = openSections[section.label] ?? section.label === activeSectionLabel;
          return (
            <div key={section.label}>
              <button
                className="mb-2 flex w-full items-center justify-between rounded-lg px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted transition hover:bg-slate-50 hover:text-text-secondary"
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggleSection(section.label)}
              >
                <span>{section.label}</span>
                <ChevronDown size={13} className={`transition-transform duration-200 ${isOpen ? "rotate-0" : "-rotate-90"}`} />
              </button>
              <div className={`space-y-1 overflow-hidden transition-all duration-200 ${isOpen ? "max-h-[520px] opacity-100" : "max-h-0 opacity-0"}`}>
                {section.items.map((item) => {
                  if (item.type === "label") {
                    return (
                      <div key={item.id} className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                        {item.label}
                      </div>
                    );
                  }
                  const Icon = iconMap[item.id] ?? ClipboardList;
                  const active = activeRouteId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavigate(item.id)}
                      className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"
                      } ${item.indent ? "pl-7" : ""}`}
                    >
                      <Icon size={16} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {(auth?.profile?.full_name ?? auth?.user?.email ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{auth?.profile?.full_name ?? auth?.user?.email ?? "User"}</div>
            <div className="text-xs text-text-secondary">{auth?.profile?.role_name ?? "Authenticated"}</div>
          </div>
          <button className="icon-btn ml-auto" type="button" title="Logout" onClick={onLogout}>
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-app-bg text-text-primary">
      <div
        className={`fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px] transition-opacity duration-200 lg:hidden ${
          mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
        onClick={() => setMobileSidebarOpen(false)}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[292px] max-w-[86vw] flex-col border-r border-border bg-sidebar shadow-2xl transition-transform duration-200 ease-out lg:hidden ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Mobile navigation"
        aria-hidden={!mobileSidebarOpen}
      >
        {sidebarContent(true)}
      </aside>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-border bg-sidebar lg:flex lg:flex-col">
        {sidebarContent(false)}
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 border-b border-border bg-app-bg/95 backdrop-blur">
          <div className="flex h-12 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <button
              className="icon-btn lg:hidden"
              type="button"
              aria-label="Open navigation"
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu size={18} />
            </button>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Smart Operations Workspace
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
                onClick={() => {
                  setProfileMenuOpen(false);
                  setNotificationsOpen((value) => !value);
                }}
              >
                <Bell size={17} />
                {unreadCount ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>
              <button
                className={`h-8 w-8 rounded-full text-xs font-bold transition ${profileMenuOpen ? "bg-primary text-white" : "bg-primary/15 text-primary hover:bg-primary/20"}`}
                type="button"
                title={auth?.profile?.full_name ?? auth?.user?.email ?? "Profile"}
                onClick={() => {
                  setNotificationsOpen(false);
                  setProfileMenuOpen((value) => !value);
                }}
              >
                {(auth?.profile?.full_name ?? auth?.user?.email ?? "U").slice(0, 1).toUpperCase()}
              </button>
              {notificationsOpen ? <NotificationPopover items={notificationItems} onClose={() => setNotificationsOpen(false)} /> : null}
              {profileMenuOpen ? (
                <ThemeMenu
                  themeChoice={themeChoice}
                  resolvedTheme={resolvedTheme}
                  onThemeChange={(nextTheme) => {
                    setThemeChoice(nextTheme);
                    setProfileMenuOpen(false);
                  }}
                  onLogout={onLogout}
                />
              ) : null}
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
