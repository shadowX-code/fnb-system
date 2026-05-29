import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Bell, Boxes, Building2, CalendarDays, Check, ChevronsDownUp, ChevronsUpDown, ChevronDown, ClipboardCheck, ClipboardList, Download, FileText, KeyRound, LogOut, Menu, Monitor, Moon, PackageCheck, PackagePlus, PieChart, RefreshCw, Settings, Shield, ShoppingCart, Sun, Truck, UserRound, Users, Wallet, X } from "lucide-react";
import Modal from "../components/feedback/Modal.jsx";
import Badge from "../components/ui/Badge.jsx";
import FloatingLayer from "../components/ui/FloatingLayer.jsx";
import { EMPLOYEE_ACCESS_STATE, EMPLOYEE_ACCESS_STATE_LABEL } from "../constants/employeeAccessStates.js";
import { buildAlerts, getPreviousPeriod, getSupplierName, percentageChange, toPercent } from "../features/sales-purchase/utils/analytics.js";
import { formatDateTime } from "../lib/dateTime.js";

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
  "outlet-pnl": BarChart3,
  product_analytics: PieChart,
  "operating-expenses": Wallet,
  "duty-roster": CalendarDays,
  "inventory-control": PackageCheck,
  "inventory-master": Boxes,
  "inventory-groups": ClipboardList,
  "inventory-stock-check": ClipboardCheck,
  "inventory-requests": PackagePlus,
  "inventory-orders": Truck,
  "inventory-movements": RefreshCw,
  "inventory-waste": AlertTriangle,
  "inventory-recipes": FileText,
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
    <div>
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
    <div>
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

function getProfileDisplayName(profile, user) {
  return profile?.nickname || profile?.full_name || user?.email || "User";
}

function getProfileFullName(profile, user) {
  return profile?.full_name || user?.email || "User";
}

function getProfileInitials(profile, user) {
  const source = profile?.nickname || profile?.full_name || user?.email || "U";
  const words = String(source).trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return String(source).slice(0, 2).toUpperCase();
}

function formatDateForProfile(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}`;
}

function formatValue(value) {
  return value || "—";
}

function accessTone(accessState) {
  if (accessState === EMPLOYEE_ACCESS_STATE.ACTIVE) return "success";
  if (accessState === EMPLOYEE_ACCESS_STATE.INVITED || accessState === EMPLOYEE_ACCESS_STATE.NOT_SENT) return "warning";
  if (accessState === EMPLOYEE_ACCESS_STATE.DISABLED) return "neutral";
  return "neutral";
}

function ReadOnlyProfileField({ label, value, children }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 min-h-5 text-sm font-semibold text-text-primary">{children ?? formatValue(value)}</div>
    </div>
  );
}

function ProfileSection({ title, icon: Icon, children }) {
  return (
    <section className="rounded-2xl border border-border bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary">
        {Icon ? <Icon size={16} className="text-primary" /> : null}
        {title}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function MyProfileModal({ auth, onClose }) {
  const profile = auth?.profile ?? {};
  const accessState = profile.access_state ?? EMPLOYEE_ACCESS_STATE.NO_ACCESS;
  const workplace = profile.workplace || profile.outlet_name || profile.workplace_name || "—";

  return (
    <Modal
      title="My Profile"
      description={`${getProfileDisplayName(profile, auth?.user)} · ${profile.role_name ?? "No role"}`}
      size="xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-base font-bold text-primary">
            {getProfileInitials(profile, auth?.user)}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-text-primary">{getProfileFullName(profile, auth?.user)}</div>
            <div className="mt-1 text-sm text-text-secondary">{profile.nickname ? `${profile.nickname} · ` : ""}{profile.email || auth?.user?.email || "No email"}</div>
          </div>
          <Badge tone={accessTone(accessState)}>{EMPLOYEE_ACCESS_STATE_LABEL[accessState] ?? "No Access"}</Badge>
        </div>

        <ProfileSection title="Personal Info" icon={UserRound}>
          <ReadOnlyProfileField label="Full Name" value={profile.full_name} />
          <ReadOnlyProfileField label="Nickname" value={profile.nickname} />
          <ReadOnlyProfileField label="Gender" value={profile.gender} />
          <ReadOnlyProfileField label="Nationality" value={profile.nationality} />
          <ReadOnlyProfileField label="IC / Passport" value={profile.ic_no} />
          <ReadOnlyProfileField label="Contact" value={profile.contact} />
          <ReadOnlyProfileField label="Birthday" value={formatDateForProfile(profile.birthday)} />
        </ProfileSection>

        <ProfileSection title="Employment Info" icon={Building2}>
          <ReadOnlyProfileField label="Department" value={profile.department} />
          <ReadOnlyProfileField label="Job Position" value={profile.position} />
          <ReadOnlyProfileField label="Work Place / Outlet" value={workplace} />
          <ReadOnlyProfileField label="Employment Status" value={String(profile.employment_status || "—").replace(/_/g, " ")} />
          <ReadOnlyProfileField label="Joined Date" value={formatDateForProfile(profile.joined_date)} />
          <ReadOnlyProfileField label="Resigned Date" value={formatDateForProfile(profile.resigned_date)} />
        </ProfileSection>

        <ProfileSection title="System Access" icon={Shield}>
          <ReadOnlyProfileField label="Email" value={profile.email || auth?.user?.email} />
          <ReadOnlyProfileField label="Role">
            <Badge tone="info">{profile.role_name ?? "No role"}</Badge>
          </ReadOnlyProfileField>
          <ReadOnlyProfileField label="Access State">
            <Badge tone={accessTone(accessState)}>{EMPLOYEE_ACCESS_STATE_LABEL[accessState] ?? "No Access"}</Badge>
          </ReadOnlyProfileField>
          <ReadOnlyProfileField label="Last Login" value={formatDateTime(profile.last_login_at)} />
          <ReadOnlyProfileField label="Email Verified" value={profile.email_verified ? "Verified" : "Not verified"} />
        </ProfileSection>
      </div>
    </Modal>
  );
}

function ChangePasswordModal({ onClose, onSubmit, onError }) {
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!values.currentPassword) {
      setError("Current password is required.");
      return;
    }
    if (values.newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (values.newPassword !== values.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({ currentPassword: values.currentPassword, newPassword: values.newPassword });
    } catch (submitError) {
      const message = submitError.message || "Unable to change password.";
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Change Password"
      description="Update the password for your current FeedX login."
      size="md"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="change-password-form" disabled={saving}>
            {saving ? "Saving..." : "Save Password"}
          </button>
        </>
      )}
    >
      <form id="change-password-form" className="space-y-4" onSubmit={handleSubmit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Current Password</span>
          <input
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            type="password"
            autoComplete="current-password"
            value={values.currentPassword}
            onChange={(event) => setValues((current) => ({ ...current, currentPassword: event.target.value }))}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">New Password</span>
            <input
              className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              type="password"
              autoComplete="new-password"
              value={values.newPassword}
              onChange={(event) => setValues((current) => ({ ...current, newPassword: event.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Confirm Password</span>
            <input
              className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={(event) => setValues((current) => ({ ...current, confirmPassword: event.target.value }))}
            />
          </label>
        </div>
      </form>
    </Modal>
  );
}

function SidebarProfilePopover({ auth, onViewProfile, onChangePassword, onSignOut }) {
  const profile = auth?.profile ?? {};
  const accessState = profile.access_state ?? EMPLOYEE_ACCESS_STATE.NO_ACCESS;
  const workplace = profile.workplace || profile.outlet_name || profile.workplace_name || "—";

  return (
    <div>
      <div className="flex items-start gap-3 border-b border-border pb-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-sm font-bold text-primary">
          {getProfileInitials(profile, auth?.user)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-text-primary">{getProfileDisplayName(profile, auth?.user)}</div>
          <div className="truncate text-xs font-medium text-text-secondary">{profile.email || auth?.user?.email || "No email"}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="info">{profile.role_name ?? "No role"}</Badge>
            <Badge tone={accessTone(accessState)}>{EMPLOYEE_ACCESS_STATE_LABEL[accessState] ?? "No Access"}</Badge>
          </div>
        </div>
      </div>
      <div className="space-y-2 border-b border-border py-3 text-xs text-text-secondary">
        <div className="flex items-center gap-2">
          <Building2 size={13} />
          <span className="truncate">{workplace}</span>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays size={13} />
          <span>Last login: {formatDateTime(profile.last_login_at)}</span>
        </div>
      </div>
      <div className="pt-2">
        <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-text-secondary transition hover:bg-slate-50 hover:text-text-primary" type="button" onClick={onViewProfile}>
          <UserRound size={15} />
          View My Profile
        </button>
        <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-text-secondary transition hover:bg-slate-50 hover:text-text-primary" type="button" onClick={onChangePassword}>
          <KeyRound size={15} />
          Change Password
        </button>
        <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50" type="button" onClick={onSignOut}>
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default function AppShell({ activeRoute, activeRouteId, sections, onNavigate, children, store, auth, onLogout, onNotify }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [sidebarProfileOpen, setSidebarProfileOpen] = useState(false);
  const [myProfileOpen, setMyProfileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
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
  const notificationButtonRef = useRef(null);
  const profileButtonRef = useRef(null);
  const sidebarProfileButtonRef = useRef(null);
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
    setSidebarProfileOpen(false);
  }

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

  async function handleChangePassword({ currentPassword, newPassword }) {
    await auth.changePassword({ currentPassword, newPassword });
    setChangePasswordOpen(false);
    onNotify?.({ title: "Password changed", message: "Your FeedX login password was updated." });
  }

  async function handleSignOut(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setNotificationsOpen(false);
    setProfileMenuOpen(false);
    setSidebarProfileOpen(false);
    setMobileSidebarOpen(false);
    try {
      await onLogout?.();
    } catch (error) {
      console.error("Unable to sign out", error);
      onNotify?.({
        title: "Unable to sign out",
        message: error?.message || "Please try again.",
        tone: "error",
      });
    }
  }

  const sidebarContent = (isMobile = false) => (
    <>
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
          <BarChart3 size={16} />
        </div>
        <div className="min-w-0">
          <div className="type-body-sm font-bold text-text-primary">FeedX</div>
          <div className="type-micro text-text-secondary">F&amp;B Intelligence</div>
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

      <nav className="flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
        {sections.map((section) => {
          const isOpen = openSections[section.label] ?? section.label === activeSectionLabel;
          return (
            <div key={section.label}>
              <button
                className="mb-1.5 flex w-full items-center justify-between rounded-lg px-2.5 py-0.5 text-left type-micro font-semibold uppercase tracking-[0.1em] text-text-muted transition hover:bg-slate-50 hover:text-text-secondary"
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
                      <div key={item.id} className="px-3 pb-1 pt-2 type-micro font-bold uppercase tracking-wide text-text-muted">
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
                      className={`relative flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-semibold transition duration-150 ${
                        active
                          ? "bg-gradient-to-r from-primary/9 to-primary/4 text-primary shadow-[inset_0_0_0_1px_rgba(34,197,94,0.08)]"
                          : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"
                      } ${item.indent ? "pl-7" : ""}`}
                    >
                      {active ? <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary/80 shadow-[0_0_8px_rgba(34,197,94,0.22)]" /> : null}
                      <Icon size={16} className={active ? "opacity-100" : "opacity-70"} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="relative border-t border-border p-3" data-sidebar-profile-menu>
        <button
          ref={sidebarProfileButtonRef}
          className={`flex w-full items-center gap-2.5 rounded-2xl p-2.5 text-left transition ${
            sidebarProfileOpen ? "bg-primary/10 ring-1 ring-primary/20" : "bg-slate-50 hover:bg-primary/5"
          }`}
          type="button"
          aria-haspopup="menu"
          aria-expanded={sidebarProfileOpen}
          onClick={() => {
            setNotificationsOpen(false);
            setProfileMenuOpen(false);
            setSidebarProfileOpen((value) => !value);
          }}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 type-caption font-bold text-primary">
            {getProfileInitials(auth?.profile, auth?.user)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{getProfileDisplayName(auth?.profile, auth?.user)}</div>
            <div className="truncate type-caption text-text-secondary">{auth?.profile?.role_name ?? "Authenticated"}</div>
          </div>
          <ChevronDown size={15} className={`ml-auto text-text-muted transition-transform ${sidebarProfileOpen ? "rotate-180" : ""}`} />
        </button>
        <FloatingLayer
          open={sidebarProfileOpen}
          onOpenChange={setSidebarProfileOpen}
          anchorRef={sidebarProfileButtonRef}
          align="start"
          placement="top"
          offset={8}
          width={260}
          minWidth={240}
          estimatedHeight={300}
          className="p-3"
        >
          <SidebarProfilePopover
            auth={auth}
            onViewProfile={() => {
              setSidebarProfileOpen(false);
              setMobileSidebarOpen(false);
              setMyProfileOpen(true);
            }}
            onChangePassword={() => {
              setSidebarProfileOpen(false);
              setMobileSidebarOpen(false);
              setChangePasswordOpen(true);
            }}
            onSignOut={() => {
              handleSignOut();
            }}
          />
        </FloatingLayer>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-app-bg text-text-primary">
      {myProfileOpen ? <MyProfileModal auth={auth} onClose={() => setMyProfileOpen(false)} /> : null}
      {changePasswordOpen ? (
        <ChangePasswordModal
          onClose={() => setChangePasswordOpen(false)}
          onSubmit={handleChangePassword}
          onError={(message) => onNotify?.({ title: "Unable to change password", message, tone: "error" })}
        />
      ) : null}
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-border bg-sidebar lg:flex lg:flex-col">
        {sidebarContent(false)}
      </aside>

      <div className="lg:pl-[236px]">
        <header className="sticky top-0 z-20 border-b border-border bg-app-bg/95 backdrop-blur">
          <div className="flex h-11 items-center justify-between gap-4 px-4 sm:px-5 lg:px-6">
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
              <div className="type-caption font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Smart Operations Workspace
              </div>
            </div>
            <div className="relative ml-auto flex items-center gap-2">
              <button
                ref={notificationButtonRef}
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
                ref={profileButtonRef}
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
              <FloatingLayer
                open={notificationsOpen}
                onOpenChange={setNotificationsOpen}
                anchorRef={notificationButtonRef}
                align="end"
                offset={8}
                width={360}
                minWidth={320}
                estimatedHeight={500}
                maxHeight={560}
                className="p-0"
              >
                <NotificationPopover items={notificationItems} onClose={() => setNotificationsOpen(false)} />
              </FloatingLayer>
              <FloatingLayer
                open={profileMenuOpen}
                onOpenChange={setProfileMenuOpen}
                anchorRef={profileButtonRef}
                align="end"
                offset={8}
                width={260}
                minWidth={240}
                estimatedHeight={320}
                className="p-2"
              >
                <ThemeMenu
                  themeChoice={themeChoice}
                  resolvedTheme={resolvedTheme}
                  onThemeChange={(nextTheme) => {
                    setThemeChoice(nextTheme);
                    setProfileMenuOpen(false);
                  }}
                  onLogout={handleSignOut}
                />
              </FloatingLayer>
            </div>
          </div>
        </header>

        <main className="px-4 py-3 sm:px-5 lg:px-6">
          <div className="mx-auto max-w-[1440px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
