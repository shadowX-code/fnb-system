import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Bell, Boxes, Building2, CalendarDays, Check, ChevronsDownUp, ChevronsUpDown, ChevronDown, ClipboardCheck, ClipboardList, Download, Eye, EyeOff, Factory, FileText, FlaskConical, KeyRound, LogOut, Menu, Monitor, Moon, PackageCheck, PackagePlus, PieChart, RefreshCw, Settings, Shield, ShoppingCart, Sun, Truck, UserRound, Users, Wallet, Warehouse, X } from "lucide-react";
import Modal from "../components/feedback/Modal.jsx";
import Badge from "../components/ui/Badge.jsx";
import FloatingLayer from "../components/ui/FloatingLayer.jsx";
import { EMPLOYEE_ACCESS_STATE, EMPLOYEE_ACCESS_STATE_LABEL } from "../constants/employeeAccessStates.js";
import { buildAlerts, getPreviousPeriod, getSupplierName, percentageChange, toPercent } from "../features/sales-purchase/utils/analytics.js";
import { formatDateTime } from "../lib/dateTime.js";
import { supabase } from "../lib/supabase";
import { canAccessOutlet, hasPermission } from "../utils/accessControl.js";

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
  "recipe-intelligence": BarChart3,
  "data-import": Download,
  "data-health": BarChart3,
  "audit-logs": KeyRound,
  employees: Users,
  users: Users,
  "job-positions": ClipboardList,
  departments: Building2,
  roles: Shield,
  "factory-dashboard": Factory,
  "factory-job-orders": ClipboardCheck,
  "factory-production": Factory,
  "factory-reports": BarChart3,
  "factory-finished-goods": Boxes,
  "factory-production-planning": CalendarDays,
  "factory-finished-goods-dispatch": PackagePlus,
  "factory-product-movements": RefreshCw,
  "factory-product-stock-check": ClipboardCheck,
  "factory-raw-receiving": Truck,
  "factory-raw-inventory": Warehouse,
  "factory-raw-movements": RefreshCw,
  "factory-raw-stock-check": ClipboardList,
  "factory-product-recipes": FlaskConical,
  "factory-sop": FileText,
  "factory-audit-logs": KeyRound,
  "factory-storage-locations": Warehouse,
  "factory-suppliers": Truck,
  "factory-customers": Building2,
  "factory-settings": Settings,
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

function businessDateInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function notificationDateTime(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function daysFromToday(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((date - startToday) / 86400000);
}

function outletNameById(outlets = [], outletId) {
  return outlets.find((outlet) => outlet.id === outletId)?.name || "";
}

function notificationSeverityTone(severity) {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "info";
}

function notificationPermissionAllowed(auth, permissions = []) {
  if (!permissions.length) return true;
  return permissions.some((permission) => hasPermission(auth, permission));
}

function createNotification(candidate, auth, outlets) {
  if (!notificationPermissionAllowed(auth, candidate.permissions)) return null;
  if (candidate.outletId && !canAccessOutlet(auth, candidate.outletId)) return null;
  return {
    id: candidate.id,
    type: candidate.type || "info",
    category: candidate.category || "Insights",
    severity: candidate.severity || "info",
    title: candidate.title,
    description: candidate.description,
    moduleKey: candidate.moduleKey || "",
    moduleLabel: candidate.moduleLabel || candidate.moduleKey || "FeedX",
    outletId: candidate.outletId || "",
    outletName: candidate.outletId ? outletNameById(outlets, candidate.outletId) : "",
    actionLabel: candidate.actionLabel || "Open",
    actionRoute: candidate.actionRoute || "",
    createdAt: notificationDateTime(candidate.createdAt),
    isRead: false,
  };
}

function stockCheckCompletedForDate(checks, group, date) {
  return checks.some((check) => (
    check.stock_check_type === "scheduled" &&
    check.status === "submitted" &&
    check.group_id === group.id &&
    check.outlet_id === group.outlet_id &&
    String(check.check_date || "").slice(0, 10) === date
  ));
}

function buildNotificationItems(store, auth, context = {}, readIds = new Set()) {
  const outlets = store.outlets || [];
  const today = businessDateInput();
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

  const candidates = [
    ...alerts.slice(0, 6).map((alert) => ({
      id: `alert-${alert.id}`,
      type: alert.priority || "info",
      category: "Alerts",
      severity: alert.priority === "critical" || alert.priority === "high" ? "high" : alert.priority === "medium" ? "medium" : "info",
      title: alert.title,
      description: alert.description,
      moduleKey: "alerts",
      moduleLabel: "Alerts",
      outletId: period.outletId,
      actionLabel: "Review Alert",
      actionRoute: "alerts",
      permissions: ["dashboard.view", "alerts.view", "sales_comparison.view", "purchase_comparison.view"],
    })),
    supplierSpike && supplierSpike.change > 30
      ? {
          id: `supplier-spike-${supplierSpike.record.outlet_id}-${supplierSpike.record.supplier_id}-${period.year}-${period.month}`,
          type: "supplier_purchase_anomaly",
          category: "Alerts",
          severity: supplierSpike.change > 75 ? "high" : "medium",
          title: `${getSupplierName(store.suppliers, supplierSpike.record.supplier_id)} increased ${toPercent(supplierSpike.change)}`,
          description: "Supplier purchase is materially above previous month.",
          moduleKey: "purchase_comparison",
          moduleLabel: "Purchases",
          outletId: supplierSpike.record.outlet_id,
          actionLabel: "View Purchase Comparison",
          actionRoute: "purchase-comparison",
          permissions: ["purchase_comparison.view", "suppliers.view"],
        }
      : null,
    deliveryChange < -15
      ? {
          id: `delivery-sales-slowed-${period.outletId}-${period.year}-${period.month}`,
          type: "sales_drop",
          category: "Insights",
          severity: "medium",
          title: "Delivery sales slowed",
          description: `Delivery platform sales moved ${toPercent(deliveryChange)} vs previous month.`,
          moduleKey: "sales_comparison",
          moduleLabel: "Sales",
          outletId: period.outletId,
          actionLabel: "View Sales Comparison",
          actionRoute: "sales-comparison",
          permissions: ["sales_comparison.view", "dashboard.view"],
        }
      : null,
  ].filter(Boolean);

  (context.stockGroups || [])
    .filter((group) => group.status !== "inactive" && group.status !== "archived")
    .forEach((group) => {
      const completed = stockCheckCompletedForDate(context.stockChecks || [], group, today);
      if (completed) return;
      candidates.push({
        id: `stock-check-due-${group.id}-${today}`,
        type: "stock_check_due",
        category: "Tasks",
        severity: "high",
        title: "Stock check due",
        description: `${group.name || "Stock check"} is due for ${group.shift || "today"} and has not been submitted.`,
        moduleKey: "inventory_stock_check",
        moduleLabel: "Inventory",
        outletId: group.outlet_id,
        actionLabel: "Start Check",
        actionRoute: "inventory_stock_check",
        permissions: ["inventory_stock_check.view"],
      });
    });

  const draftOrders = (context.purchaseOrders || []).filter((order) => order.status === "draft");
  draftOrders.slice(0, 6).forEach((order) => {
    candidates.push({
      id: `draft-po-${order.id}`,
      type: "draft_po",
      category: "Tasks",
      severity: "medium",
      title: "Draft PO pending submit",
      description: `${order.po_no || "Draft PO"} is ready for review before submitting to supplier.`,
      moduleKey: "inventory_orders",
      moduleLabel: "Purchase Orders",
      outletId: order.outlet_id,
      actionLabel: "Review PO",
      actionRoute: "inventory_orders",
      permissions: ["inventory_orders.view", "inventory_orders.submit"],
      createdAt: order.created_at,
    });
  });

  (context.purchaseOrders || [])
    .filter((order) => ["submitted", "supplier_confirmed", "partial_received"].includes(order.status))
    .slice(0, 8)
    .forEach((order) => {
      candidates.push({
        id: `po-receive-${order.id}`,
        type: "po_pending_receive",
        category: "Tasks",
        severity: order.status === "partial_received" ? "high" : "medium",
        title: order.status === "partial_received" ? "PO partially received" : "PO pending receive",
        description: `${order.po_no || "Purchase order"} needs receiving action.`,
        moduleKey: "inventory_orders",
        moduleLabel: "Purchase Orders",
        outletId: order.outlet_id,
        actionLabel: "Receive Inventory",
        actionRoute: "inventory_orders",
        permissions: ["inventory_orders.view", "inventory_orders.receive"],
        createdAt: order.updated_at || order.submitted_at || order.created_at,
      });
    });

  const poByStockCheckId = new Set((context.purchaseOrders || []).filter((order) => order.source_stock_check_id).map((order) => order.source_stock_check_id));
  const shortageItemsByCheck = new Map();
  (context.stockCheckItems || []).forEach((item) => {
    const shortage = Number(item.variance ?? 0) > 0 || Number(item.par_level_quantity ?? 0) > Number(item.actual_count_quantity ?? 0);
    if (!shortage) return;
    shortageItemsByCheck.set(item.stock_check_id, (shortageItemsByCheck.get(item.stock_check_id) || 0) + 1);
  });
  (context.stockChecks || [])
    .filter((check) => check.stock_check_type === "scheduled" && check.status === "submitted" && shortageItemsByCheck.has(check.id) && !poByStockCheckId.has(check.id))
    .slice(0, 6)
    .forEach((check) => {
      candidates.push({
        id: `purchase-suggestions-${check.id}`,
        type: "purchase_suggestion_pending",
        category: "Tasks",
        severity: "high",
        title: "Purchase suggestions pending",
        description: `${shortageItemsByCheck.get(check.id)} shortage item(s) need review before Draft PO creation.`,
        moduleKey: "inventory_stock_check",
        moduleLabel: "Inventory",
        outletId: check.outlet_id,
        actionLabel: "Review Suggestions",
        actionRoute: "inventory_stock_check",
        permissions: ["inventory_stock_check.view", "inventory_orders.create"],
        createdAt: check.submitted_at || check.created_at,
      });
    });

  (context.wasteRecords || []).slice(0, 8).forEach((record) => {
    const quantity = Number(record.quantity || 0);
    candidates.push({
      id: `waste-${record.id}`,
      type: quantity >= 10 ? "high_waste" : "waste_recorded",
      category: quantity >= 10 ? "Alerts" : "Insights",
      severity: quantity >= 10 ? "medium" : "info",
      title: quantity >= 10 ? "High waste quantity recorded" : "Waste recorded today",
      description: `${record.item?.name || "Inventory item"} · ${quantity} ${record.unit || ""} · ${record.waste_type || "Waste"}`,
      moduleKey: "inventory_waste",
      moduleLabel: "Waste",
      outletId: record.outlet_id,
      actionLabel: "View Waste",
      actionRoute: "inventory_waste",
      permissions: ["inventory_waste.view"],
      createdAt: record.created_at || record.waste_date,
    });
  });

  (context.maintenanceRecords || [])
    .filter((record) => record.status !== "completed" && daysFromToday(record.scheduled_date || record.date) !== null && daysFromToday(record.scheduled_date || record.date) <= 1)
    .slice(0, 8)
    .forEach((record) => {
      const days = daysFromToday(record.scheduled_date || record.date);
      candidates.push({
        id: `asset-maintenance-${record.id}`,
        type: "asset_maintenance_due",
        category: "Tasks",
        severity: days < 0 ? "high" : "medium",
        title: days < 0 ? "Asset maintenance overdue" : "Asset maintenance due",
        description: `${record.asset?.name || "Asset"} needs ${String(record.maintenance_type || "maintenance").replace(/_/g, " ")} follow-up.`,
        moduleKey: "asset_tracking",
        moduleLabel: "Assets",
        outletId: record.outlet_id,
        actionLabel: "Open Assets",
        actionRoute: "asset_tracking",
        permissions: ["asset_tracking.view"],
        createdAt: record.scheduled_date || record.date,
      });
    });

  (context.inspections || [])
    .filter((inspection) => ["draft", "in_progress", "pending_review"].includes(inspection.status))
    .slice(0, 6)
    .forEach((inspection) => {
      candidates.push({
        id: `asset-inspection-${inspection.id}`,
        type: "asset_inspection_due",
        category: "Tasks",
        severity: "medium",
        title: "Asset inspection draft open",
        description: "An asset inspection is not yet submitted.",
        moduleKey: "asset_tracking",
        moduleLabel: "Assets",
        outletId: inspection.outlet_id,
        actionLabel: "Open Inspection",
        actionRoute: "asset_tracking",
        permissions: ["asset_tracking.view"],
        createdAt: inspection.updated_at || inspection.created_at,
      });
    });

  (context.employees || []).forEach((employee) => {
    const displayName = employee.nickname || employee.full_name || employee.email || "Employee";
    if (employee.enable_system_login && ["not_sent", "invited"].includes(employee.access_state)) {
      candidates.push({
        id: `employee-login-${employee.id}`,
        type: "employee_login_setup",
        category: "Tasks",
        severity: "medium",
        title: "Employee login setup pending",
        description: `${displayName} has login access enabled but setup is not complete.`,
        moduleKey: "employees",
        moduleLabel: "People",
        actionLabel: "View Employee",
        actionRoute: "employees",
        permissions: ["employees.view", "employees.edit"],
        createdAt: employee.updated_at || employee.created_at,
      });
    }
    if (employee.enable_system_login && !employee.role_id) {
      candidates.push({
        id: `employee-role-missing-${employee.id}`,
        type: "employee_role_missing",
        category: "Data Health",
        severity: "high",
        title: "Employee role missing",
        description: `${displayName} has system login enabled without an assigned role.`,
        moduleKey: "employees",
        moduleLabel: "People",
        actionLabel: "Fix Employee",
        actionRoute: "employees",
        permissions: ["employees.view", "employees.edit"],
        createdAt: employee.updated_at || employee.created_at,
      });
    }
    if (!employee.workplace) {
      candidates.push({
        id: `employee-workplace-missing-${employee.id}`,
        type: "employee_workplace_missing",
        category: "Data Health",
        severity: "medium",
        title: "Employee workplace missing",
        description: `${displayName} has no workplace/outlet assigned.`,
        moduleKey: "employees",
        moduleLabel: "People",
        actionLabel: "Review Employee",
        actionRoute: "employees",
        permissions: ["employees.view", "employees.edit"],
        createdAt: employee.updated_at || employee.created_at,
      });
    }
  });

  return candidates
    .map((candidate) => createNotification(candidate, auth, outlets))
    .filter(Boolean)
    .map((item) => ({ ...item, isRead: readIds.has(item.id) }))
    .sort((first, second) => {
      const severityRank = { critical: 4, high: 3, medium: 2, info: 1 };
      return (severityRank[second.severity] || 0) - (severityRank[first.severity] || 0) ||
        new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
    })
    .slice(0, 40);
}

const notificationTabs = ["All", "Tasks", "Alerts", "Data Health"];

function NotificationPopover({ items, unreadCount, activeTab, onTabChange, onMarkAllRead, onAction, onClose }) {
  const visibleItems = activeTab === "All" ? items : items.filter((item) => item.category === activeTab);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-bold text-text-primary">Notifications</div>
          <div className="text-xs text-text-secondary">{unreadCount} unread · Role-aware tasks and alerts</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-lg px-2 py-1 text-xs font-bold text-text-secondary hover:bg-slate-50" type="button" onClick={onMarkAllRead}>Mark all as read</button>
          <button className="rounded-lg px-2 py-1 text-xs font-bold text-text-secondary hover:bg-slate-50" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-border px-3 py-2">
        {notificationTabs.map((tab) => {
          const count = tab === "All" ? items.length : items.filter((item) => item.category === tab).length;
          return (
            <button
              key={tab}
              className={`rounded-full px-3 py-1 text-xs font-black transition ${activeTab === tab ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"}`}
              type="button"
              onClick={() => onTabChange(tab)}
            >
              {tab} {count ? <span className="ml-1 text-[10px] opacity-70">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="max-h-[430px] overflow-y-auto p-2">
        {visibleItems.length ? (
          <div className="space-y-1">
            {visibleItems.map((item) => (
              <div key={item.id} className={`rounded-xl px-3 py-2 transition hover:bg-slate-50 ${item.isRead ? "opacity-70" : "bg-primary/5"}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    notificationSeverityTone(item.severity) === "danger"
                      ? "bg-rose-100 text-rose-700"
                      : notificationSeverityTone(item.severity) === "warning"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                  }`}>
                    {item.severity.toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.outletName ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{item.outletName}</span> : null}
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{item.moduleLabel}</span>
                      {!item.isRead ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                    </div>
                    <div className="mt-1 text-sm font-bold text-text-primary">{item.title}</div>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{item.description}</p>
                    {item.actionRoute ? (
                      <button className="mt-2 text-xs font-black text-primary hover:underline" type="button" onClick={() => onAction(item)}>
                        {item.actionLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="text-sm font-bold text-text-primary">You're all caught up.</div>
            <p className="mt-1 text-sm text-text-secondary">No visible notifications need your attention.</p>
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
        <button
          className="pointer-events-auto flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-text-secondary transition hover:bg-slate-50 hover:text-text-primary"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => onLogout(event, "top")}
        >
          <LogOut size={15} />
          Sign Out
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

function passwordChecks(password) {
  return {
    minLength: password.length >= 8,
    hasLetter: /[A-Za-z]/.test(password),
    hasNumber: /\d/.test(password),
  };
}

function passwordStrength(password) {
  const checks = passwordChecks(password);
  if (!checks.minLength || !checks.hasLetter || !checks.hasNumber) return "Weak";
  if (password.length >= 12) return "Strong";
  return "Medium";
}

function PasswordInput({ label, value, onChange, autoComplete, error, disabled }) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <div className="relative mt-1">
        <input
          className={`w-full rounded-xl border bg-surface px-3 py-2 pr-11 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${error ? "border-rose-300" : "border-border"}`}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-text-secondary transition hover:bg-slate-100 hover:text-text-primary"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          disabled={disabled}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <div className="mt-1 min-h-[18px] text-xs font-semibold text-rose-600">{error || ""}</div>
    </label>
  );
}

function RequirementRow({ met, children }) {
  return (
    <div className={`flex items-center gap-2 text-xs font-semibold ${met ? "text-emerald-700" : "text-text-secondary"}`}>
      <span className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${met ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-surface text-text-muted"}`}>
        {met ? "✓" : ""}
      </span>
      <span>{children}</span>
    </div>
  );
}

function ChangePasswordModal({ onClose, onSubmit, onError }) {
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const checks = passwordChecks(values.newPassword);
  const strength = passwordStrength(values.newPassword);
  const newPasswordValid = checks.minLength && checks.hasLetter && checks.hasNumber;
  const confirmTouched = values.confirmPassword.length > 0;
  const passwordsMatch = values.confirmPassword === values.newPassword;
  const canSubmit = Boolean(values.currentPassword) && newPasswordValid && passwordsMatch && !saving;
  const confirmError = confirmTouched && !passwordsMatch ? "Passwords do not match." : "";

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!values.currentPassword) {
      setError("Current password is required.");
      return;
    }
    if (!newPasswordValid) {
      setError("New password must be at least 8 characters and include letters and numbers.");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({ currentPassword: values.currentPassword, newPassword: values.newPassword });
    } catch (submitError) {
      const rawMessage = submitError.message || "Unable to change password.";
      const message = /invalid login credentials|invalid credentials/i.test(rawMessage)
        ? "Current password is incorrect."
        : rawMessage;
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
          <button className="btn-primary" type="submit" form="change-password-form" disabled={!canSubmit}>
            {saving ? "Saving..." : "Save Password"}
          </button>
        </>
      )}
    >
      <form id="change-password-form" className="space-y-4" onSubmit={handleSubmit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <PasswordInput
          label="Current Password"
          value={values.currentPassword}
          autoComplete="current-password"
          disabled={saving}
          onChange={(value) => setValues((current) => ({ ...current, currentPassword: value }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <PasswordInput
            label="New Password"
            value={values.newPassword}
            autoComplete="new-password"
            disabled={saving}
            onChange={(value) => setValues((current) => ({ ...current, newPassword: value }))}
          />
          <PasswordInput
            label="Confirm New Password"
            value={values.confirmPassword}
            autoComplete="new-password"
            disabled={saving}
            error={confirmError}
            onChange={(value) => setValues((current) => ({ ...current, confirmPassword: value }))}
          />
        </div>
        <div className="rounded-2xl border border-border bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Password requirements</div>
            <div className={`rounded-full px-2.5 py-1 text-xs font-bold ${
              strength === "Strong"
                ? "bg-emerald-100 text-emerald-700"
                : strength === "Medium"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-rose-100 text-rose-700"
            }`}>
              {strength}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <RequirementRow met={checks.minLength}>At least 8 characters</RequirementRow>
            <RequirementRow met={checks.hasLetter}>Contains letters</RequirementRow>
            <RequirementRow met={checks.hasNumber}>Contains numbers</RequirementRow>
          </div>
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
        <button
          className="pointer-events-auto flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-text-secondary transition hover:bg-slate-50 hover:text-text-primary"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onViewProfile}
        >
          <UserRound size={15} />
          View My Profile
        </button>
        <button
          className="pointer-events-auto flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-text-secondary transition hover:bg-slate-50 hover:text-text-primary"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onChangePassword}
        >
          <KeyRound size={15} />
          Change Password
        </button>
        <button
          className="pointer-events-auto flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => onSignOut(event, "sidebar")}
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default function AppShell({ activeRoute, activeRouteId, sections, workspace = "restaurant", onWorkspaceChange, onNavigate, children, store, auth, onLogout, onNotify }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationTab, setNotificationTab] = useState("All");
  const [notificationContext, setNotificationContext] = useState({});
  const [notificationReadIds, setNotificationReadIds] = useState(() => new Set());
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
  const notificationUserKey = auth?.profile?.id || auth?.user?.id || "anonymous";
  const notificationStorageKey = `feedx.notifications.read.${notificationUserKey}`;
  const notificationItems = useMemo(
    () => buildNotificationItems(store, auth, notificationContext, notificationReadIds),
    [auth, notificationContext, notificationReadIds, store],
  );
  const unreadCount = notificationItems.filter((item) => !item.isRead).length;
  const resolvedTheme = themeChoice === "system" ? systemTheme : themeChoice;

  function userCanNotification(codes = []) {
    return codes.some((code) => hasPermission(auth, code));
  }

  async function safeNotificationQuery(label, query) {
    const { data, error } = await query;
    if (error) {
      if (import.meta.env.DEV) console.warn(`[NotificationCenter] ${label} skipped`, error);
      return [];
    }
    return data ?? [];
  }

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(notificationStorageKey) || "[]");
      setNotificationReadIds(new Set(Array.isArray(stored) ? stored : []));
    } catch {
      setNotificationReadIds(new Set());
    }
  }, [notificationStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(notificationStorageKey, JSON.stringify([...notificationReadIds].slice(-300)));
    } catch {
      // Read state is a local convenience only.
    }
  }, [notificationReadIds, notificationStorageKey]);

  useEffect(() => {
    let ignore = false;
    async function loadNotificationContext() {
      if (!auth?.session || auth.loading || auth.contextLoading) {
        setNotificationContext({});
        return;
      }
      const today = businessDateInput();
      const inventoryWanted = userCanNotification(["inventory_stock_check.view", "inventory_orders.view", "inventory_orders.create", "inventory_waste.view"]);
      const assetWanted = userCanNotification(["asset_tracking.view"]);
      const peopleWanted = userCanNotification(["employees.view", "employees.edit"]);
      const [
        stockGroups,
        stockChecks,
        stockCheckItems,
        purchaseOrders,
        wasteRecords,
        maintenanceRecords,
        inspections,
        employees,
      ] = await Promise.all([
        inventoryWanted
          ? safeNotificationQuery("stock groups", supabase.from("inventory_stock_check_groups").select("id,name,outlet_id,shift,status,last_checked_at,updated_at").neq("status", "inactive").limit(80))
          : [],
        inventoryWanted
          ? safeNotificationQuery("stock checks", supabase.from("inventory_stock_checks").select("id,check_name,group_id,outlet_id,check_date,shift,status,stock_check_type,submitted_at,created_at").gte("check_date", today).limit(120))
          : [],
        inventoryWanted
          ? safeNotificationQuery("stock check items", supabase.from("inventory_stock_check_items").select("id,stock_check_id,par_level_quantity,actual_count_quantity,variance,status").limit(300))
          : [],
        userCanNotification(["inventory_orders.view", "inventory_orders.create", "inventory_orders.receive", "inventory_orders.submit"])
          ? safeNotificationQuery("purchase orders", supabase.from("inventory_purchase_orders").select("id,po_no,outlet_id,status,source_type,source_stock_check_id,created_at,updated_at,submitted_at").in("status", ["draft", "submitted", "supplier_confirmed", "partial_received"]).order("created_at", { ascending: false }).limit(80))
          : [],
        userCanNotification(["inventory_waste.view"])
          ? safeNotificationQuery("waste records", supabase.from("inventory_waste_records").select("id,outlet_id,inventory_item_id,waste_type,quantity,unit,waste_date,created_at").gte("waste_date", today).order("waste_date", { ascending: false }).limit(80))
          : [],
        assetWanted
          ? safeNotificationQuery("asset maintenance", supabase.from("asset_maintenance_records").select("id,asset_id,outlet_id,status,scheduled_date,date,maintenance_type,issue,created_at,updated_at,asset:asset_items(name)").neq("status", "completed").order("date", { ascending: true }).limit(80))
          : [],
        assetWanted
          ? safeNotificationQuery("asset inspections", supabase.from("asset_inspections").select("id,outlet_id,status,inspection_date,created_at,updated_at").in("status", ["draft", "in_progress", "pending_review"]).order("updated_at", { ascending: false }).limit(60))
          : [],
        peopleWanted
          ? safeNotificationQuery("employees", supabase.from("employees").select("id,full_name,nickname,email,role_id,workplace,access_state,enable_system_login,created_at,updated_at").limit(200))
          : [],
      ]);
      if (!ignore) {
        setNotificationContext({
          stockGroups,
          stockChecks,
          stockCheckItems,
          purchaseOrders,
          wasteRecords,
          maintenanceRecords,
          inspections,
          employees,
        });
      }
    }
    loadNotificationContext();
    return () => {
      ignore = true;
    };
  }, [auth?.contextLoading, auth?.loading, auth?.permissions, auth?.profile?.id, auth?.session]);

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

  function markNotificationRead(notificationId) {
    setNotificationReadIds((current) => {
      const next = new Set(current);
      next.add(notificationId);
      return next;
    });
  }

  function markAllNotificationsRead() {
    setNotificationReadIds((current) => {
      const next = new Set(current);
      notificationItems.forEach((item) => next.add(item.id));
      return next;
    });
  }

  function handleNotificationAction(item) {
    markNotificationRead(item.id);
    setNotificationsOpen(false);
    if (item.actionRoute) onNavigate(item.actionRoute);
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
    onNotify?.({ title: "Password updated successfully.", tone: "success" });
  }

  function closeAccountMenus() {
    setProfileMenuOpen(false);
    setSidebarProfileOpen(false);
    setNotificationsOpen(false);
    setMobileSidebarOpen(false);
  }

  function handleViewMyProfileClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!auth?.profile?.id) {
      onNotify?.({
        title: "Unable to open profile",
        message: "Your employee profile could not be loaded. Please refresh or contact admin.",
        tone: "error",
      });
      return;
    }
    closeAccountMenus();
    setMyProfileOpen(true);
  }

  function handleOpenChangePasswordClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!auth?.user?.email) {
      onNotify?.({
        title: "Password change unavailable",
        message: "Your login email could not be loaded. Please use reset password from the login page.",
        tone: "error",
      });
      return;
    }
    closeAccountMenus();
    setChangePasswordOpen(true);
  }

  async function handleSignOutClick(event, source = "top") {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    try {
      console.log(source === "sidebar" ? "[FeedX] Sidebar sign out clicked" : "[FeedX] Sign out clicked");
      await supabase.auth.signOut();
      setProfileMenuOpen(false);
      setSidebarProfileOpen(false);
      setNotificationsOpen(false);
      setMobileSidebarOpen(false);
      window.location.href = "/login";
    } catch (error) {
      console.error("[FeedX] Sign out failed", error);
      alert("Sign out failed. Please try again.");
    }
  }

  const sidebarContent = (isMobile = false) => (
    <>
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl bg-primary text-white shadow-sm">
          <img
            src="/logo-icon.jpg"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
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

      <div className="px-3 pb-2">
        <div className="grid grid-cols-2 rounded-2xl border border-border bg-slate-50 p-1">
          {[
            { id: "restaurant", label: "Restaurant", icon: Building2 },
            { id: "factory", label: "Factory", icon: Factory },
          ].map((option) => {
            const Icon = option.icon;
            const active = workspace === option.id;
            return (
              <button
                key={option.id}
                className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[12px] font-semibold transition ${
                  active ? "bg-white text-primary shadow-sm ring-1 ring-primary/10" : "text-text-secondary hover:bg-white/70 hover:text-text-primary"
                }`}
                type="button"
                onClick={() => onWorkspaceChange?.(option.id)}
              >
                <Icon size={13} />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
        {sections.map((section) => {
          const isOpen = openSections[section.label] ?? section.label === activeSectionLabel;
          return (
            <div key={section.label}>
              <button
                className="mb-1.5 flex w-full items-center justify-between rounded-lg px-2.5 py-0.5 text-left text-[10px] font-semibold uppercase leading-4 tracking-[0.14em] text-text-muted transition hover:bg-slate-50 hover:text-text-secondary"
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
                      <div key={item.id} className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase leading-4 tracking-[0.14em] text-text-muted">
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
                      className={`relative flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-medium leading-5 transition duration-150 ${
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
            <div className="truncate text-[12px] font-medium leading-4">{getProfileDisplayName(auth?.profile, auth?.user)}</div>
            <div className="truncate text-xs text-text-secondary">{auth?.profile?.role_name ?? "Authenticated"}</div>
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
            onViewProfile={handleViewMyProfileClick}
            onChangePassword={handleOpenChangePasswordClick}
            onSignOut={handleSignOutClick}
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
                  setSidebarProfileOpen(false);
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
                <NotificationPopover
                  items={notificationItems}
                  unreadCount={unreadCount}
                  activeTab={notificationTab}
                  onTabChange={setNotificationTab}
                  onMarkAllRead={markAllNotificationsRead}
                  onAction={handleNotificationAction}
                  onClose={() => setNotificationsOpen(false)}
                />
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
                  onLogout={handleSignOutClick}
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
