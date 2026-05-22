import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  FileDown,
  FilePenLine,
  History,
  KeyRound,
  LockKeyhole,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  X,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { getAuditActionLabel, getAuditModuleLabel } from "../../../../config/auditLog.ts";
import { auditLogService } from "../../../services/auditLogService.js";

const auditRows = [
  {
    id: "audit-001",
    actor: "Amanda Tan",
    actorRole: "Admin",
    action: "login_success",
    module: "authentication",
    target: "amanda@hola.local",
    outlet: "Happiness Kopitiam Ipoh",
    before: null,
    after: { session_status: "authenticated" },
    timestamp: "2026-05-14 08:11",
    ip: "175.143.12.88",
    device: "Chrome on macOS",
    metadata: "Successful login from trusted device.",
  },
  {
    id: "audit-002",
    actor: "System",
    actorRole: "System",
    action: "login_failed",
    module: "authentication",
    target: "finance@hola.local",
    outlet: "-",
    before: null,
    after: { failure_reason: "invalid_password" },
    timestamp: "2026-05-14 07:58",
    ip: "115.132.44.20",
    device: "Safari on iPhone",
    metadata: "Failed login attempt. No profile data was changed.",
  },
  {
    id: "audit-003",
    actor: "Marcus Lee",
    actorRole: "Owner",
    action: "employee_updated",
    module: "people",
    target: "Amanda Tan",
    outlet: "Hola Hola Kopitiam Ipoh",
    before: { position: "Supervisor", department: "Operations" },
    after: { position: "Outlet Manager", department: "Operations" },
    timestamp: "2026-05-13 16:42",
    ip: "175.143.12.88",
    device: "Chrome on macOS",
    metadata: "Employee profile changed. Historical records remain linked to the same employee.",
  },
  {
    id: "audit-004",
    actor: "Development Owner",
    actorRole: "Owner",
    action: "permission_changed",
    module: "access-control",
    target: "cashier",
    outlet: "All Outlets",
    before: { permissions: ["dashboard.view"] },
    after: { permissions: ["dashboard.view", "sales_input.view", "sales_input.create"] },
    timestamp: "2026-05-13 15:18",
    ip: "175.143.12.88",
    device: "Chrome on macOS",
    metadata: "Role permission matrix updated.",
  },
  {
    id: "audit-005",
    actor: "Jason Lim",
    actorRole: "Manager",
    action: "purchase_import_completed",
    module: "purchases",
    target: "Purchase Import May 2026",
    outlet: "JYMT Kopitiam",
    before: { purchase_rows: 8, total_purchase: "RM 29,410" },
    after: { purchase_rows: 9, total_purchase: "RM 31,738", updated_rows: 8, skipped_rows: 1 },
    timestamp: "2026-05-13 12:05",
    ip: "10.0.0.42",
    device: "Edge on Windows",
    metadata: "Bulk update mode used. One unknown supplier was skipped.",
  },
  {
    id: "audit-006",
    actor: "Finance Officer",
    actorRole: "Finance",
    action: "purchase_approved",
    module: "purchases",
    target: "May 2026 supplier purchases",
    outlet: "Hola Hola Kopitiam Ipoh",
    before: { approval_status: "pending" },
    after: { approval_status: "approved" },
    timestamp: "2026-05-12 17:31",
    ip: "175.143.91.10",
    device: "Chrome on Windows",
    metadata: "Monthly supplier purchases approved for reporting.",
  },
  {
    id: "audit-007",
    actor: "Marcus Lee",
    actorRole: "Owner",
    action: "tax_setting_updated",
    module: "sales",
    target: "Hola Mont Kiara SST",
    outlet: "Hola Mont Kiara",
    before: { enabled: false, rate: 0, effective_from: "2026-01", effective_until: "2027-06" },
    after: { enabled: true, rate: 6, effective_from: "2027-07", effective_until: null },
    timestamp: "2026-05-11 14:20",
    ip: "175.143.12.88",
    device: "Chrome on macOS",
    metadata: "Future tax configuration added. Historical months were not changed.",
  },
  {
    id: "audit-008",
    actor: "Amanda Tan",
    actorRole: "Admin",
    action: "sales_updated",
    module: "sales",
    target: "May 2026 Sales",
    outlet: "Happiness Kopitiam Ipoh",
    before: { net_sales: "RM 72,463", rows: 6 },
    after: { net_sales: "RM 74,118", rows: 6 },
    timestamp: "2026-05-10 10:44",
    ip: "10.0.0.18",
    device: "Chrome on Windows",
    metadata: "Saved monthly sales records. Net Sales recalculated from Gross Sales minus deductions.",
  },
  {
    id: "audit-009",
    actor: "System",
    actorRole: "System",
    action: "data_health_action",
    module: "operations",
    target: "May 2026 Month Lock",
    outlet: "JYMT Kopitiam",
    before: { lock_status: "unlocked" },
    after: { lock_status: "locked" },
    timestamp: "2026-05-09 19:02",
    ip: "system",
    device: "Month Closing Control Center",
    metadata: "Month locked after completeness checks passed.",
  },
  {
    id: "audit-010",
    actor: "Marcus Lee",
    actorRole: "Owner",
    action: "export_download",
    module: "operations",
    target: "Purchase Comparison Report",
    outlet: "All Outlets",
    before: null,
    after: { file_type: "csv", period: "Jan-May 2026" },
    timestamp: "2026-05-09 11:12",
    ip: "175.143.12.88",
    device: "Chrome on macOS",
    metadata: "Exported business report. No records were changed.",
  },
  {
    id: "audit-011",
    actor: "Amanda Tan",
    actorRole: "Admin",
    action: "employee_access_enabled",
    module: "access-control",
    target: "Jason Lim",
    outlet: "Hola TTDI",
    before: { access_state: "No Access", role: null },
    after: { access_state: "Invitation Pending", role: "purchaser" },
    timestamp: "2026-05-08 15:06",
    ip: "10.0.0.18",
    device: "Chrome on Windows",
    metadata: "System login enabled from employee profile. Verification email sent.",
  },
  {
    id: "audit-012",
    actor: "Marcus Lee",
    actorRole: "Owner",
    action: "employee_access_disabled",
    module: "access-control",
    target: "Lee Wen",
    outlet: "-",
    before: { access_state: "Access Active", employment_status: "Full Time" },
    after: { access_state: "Access Disabled", employment_status: "Resigned" },
    timestamp: "2026-03-15 18:20",
    ip: "175.143.12.88",
    device: "Chrome on macOS",
    metadata: "System access disabled. Historical payroll, KPI and sales records retained.",
  },
];

const auditTypeMeta = {
  authentication: { label: "Security", tone: "danger" },
  "access-control": { label: "Access", tone: "info" },
  people: { label: "People", tone: "success" },
  sales: { label: "Sales", tone: "info" },
  purchases: { label: "Purchase", tone: "warning" },
  operations: { label: "Operations", tone: "neutral" },
};

const actionIconMap = {
  login_success: CheckCircle2,
  login_failed: AlertTriangle,
  password_reset: KeyRound,
  invite_sent: KeyRound,
  verification_completed: ShieldCheck,
  permission_changed: ShieldCheck,
  role_created: ShieldCheck,
  role_updated: ShieldCheck,
  outlet_access_changed: ShieldCheck,
  employee_access_enabled: ShieldCheck,
  employee_access_disabled: LockKeyhole,
  employee_updated: UserCog,
  employee_created: UserCog,
  sales_updated: FilePenLine,
  sales_created: FilePenLine,
  sales_deleted: AlertTriangle,
  purchase_import_completed: FileDown,
  purchase_import_failed: AlertTriangle,
  purchase_approved: ShieldCheck,
  tax_setting_updated: FilePenLine,
  data_health_action: LockKeyhole,
  export_download: FileDown,
};

const quickFilters = [
  { id: "all", label: "All" },
  { id: "security", label: "Security" },
  { id: "access", label: "Access" },
  { id: "data", label: "Data Changes" },
  { id: "imports", label: "Imports" },
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
];

const kpiMeta = {
  security: {
    label: "Security Events",
    helper: "Login, setup and password activity",
    accent: "border-l-rose-400",
    iconClass: "border-rose-500/15 bg-rose-500/10 text-rose-600",
    Icon: ShieldAlert,
  },
  access: {
    label: "Access Changes",
    helper: "Roles, permissions and outlet access",
    accent: "border-l-blue-400",
    iconClass: "border-blue-500/15 bg-blue-500/10 text-blue-600",
    Icon: ShieldCheck,
  },
  data: {
    label: "Data Changes",
    helper: "Employee, sales and purchase updates",
    accent: "border-l-emerald-400",
    iconClass: "border-emerald-500/15 bg-emerald-500/10 text-emerald-600",
    Icon: FilePenLine,
  },
  controls: {
    label: "Control Events",
    helper: "Imports, exports and month controls",
    accent: "border-l-violet-400",
    iconClass: "border-violet-500/15 bg-violet-500/10 text-violet-600",
    Icon: LockKeyhole,
  },
};

function toTitleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getReadableAction(action) {
  const configured = getAuditActionLabel(action);
  return configured && configured !== action ? configured : toTitleCase(action || "Audit Event");
}

function getReadableModule(module) {
  const configured = getAuditModuleLabel(module);
  return configured && configured !== module ? configured : toTitleCase(module || "General");
}

function parseAuditDate(value) {
  if (!value) return null;
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(date, other) {
  return date?.getFullYear() === other.getFullYear()
    && date.getMonth() === other.getMonth()
    && date.getDate() === other.getDate();
}

function isThisWeek(date) {
  if (!date) return false;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

function formatTimestamp(value) {
  const date = parseAuditDate(value);
  if (!date) return "—";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit" }).format(date);
  if (isSameDay(date, now)) return `Today, ${time}`;
  if (isSameDay(date, yesterday)) return `Yesterday, ${time}`;
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDrawerTimestamp(value) {
  const date = parseAuditDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getInitials(name) {
  return String(name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "U";
}

function cleanDisplayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(cleanDisplayValue).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat("en-MY").format(value);
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${toTitleCase(key)}: ${cleanDisplayValue(nestedValue)}`)
      .join("; ");
  }
  return toTitleCase(String(value).replace(/\bRM\b/gi, "RM"));
}

function displayOutlet(value) {
  const text = String(value || "").trim();
  if (!text || text === "-" || text.toLowerCase() === "null") return "System-wide";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    return "System-wide";
  }
  return text;
}

function getEventGroup(row) {
  if (row.module === "authentication") return "security";
  if (row.module === "access-control" || /role|permission|access/i.test(row.action)) return "access";
  if (/import/i.test(row.action)) return "imports";
  if (["people", "sales", "purchases"].includes(row.module)) return "data";
  return "controls";
}

function getSeverity(row) {
  const action = String(row.action || "").toLowerCase();
  if (/deleted|disabled|failed/.test(action)) return { label: "Critical", tone: "danger" };
  if (/permission|role|access|password|login/.test(action)) return { label: row.module === "authentication" ? "Security" : "Warning", tone: row.module === "authentication" ? "danger" : "warning" };
  if (/import|export|approved|updated|created/.test(action)) return { label: "Normal", tone: "success" };
  return { label: "Normal", tone: "neutral" };
}

function getUserDisplay(row) {
  const actor = String(row.actor || "System");
  const isEmail = actor.includes("@");
  const name = isEmail ? toTitleCase(actor.split("@")[0].replace(/[._-]/g, " ")) : actor;
  const email = isEmail ? actor : "";
  return { name, email };
}

function ActionIcon({ row }) {
  const Icon = actionIconMap[row.action] ?? FilePenLine;
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/10 bg-primary/10 text-primary shadow-sm">
        <Icon size={16} />
      </span>
  );
}

function UserCell({ row }) {
  const user = getUserDisplay(row);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs font-bold text-text-secondary shadow-sm">
        {getInitials(user.name)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-text-primary">{user.name}</div>
        {user.email ? <div className="truncate text-xs text-text-secondary">{user.email}</div> : null}
        {row.actorRole ? <div className="mt-1"><Badge tone="neutral">{row.actorRole}</Badge></div> : null}
      </div>
    </div>
  );
}

function DetailValueList({ value, emptyText }) {
  if (!value || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length)) {
    return <div className="rounded-xl border border-border bg-surface/70 p-3 text-sm text-text-secondary">{emptyText}</div>;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return <div className="rounded-xl border border-border bg-surface/70 p-3 text-sm font-semibold text-text-primary">{cleanDisplayValue(value)}</div>;
  }

  return (
    <div className="space-y-2">
      {Object.entries(value).map(([key, item]) => (
        <div key={key} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface/70 px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted">{toTitleCase(key)}</span>
          <span className="max-w-[65%] text-right text-sm font-semibold text-text-primary">{cleanDisplayValue(item)}</span>
        </div>
      ))}
    </div>
  );
}

function AuditDetailDrawer({ row, onClose }) {
  if (!row) return null;
  const severity = getSeverity(row);
  const typeMeta = auditTypeMeta[row.module] ?? { label: getReadableModule(row.module), tone: "neutral" };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[1px]" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={typeMeta.tone}>{typeMeta.label}</Badge>
                <Badge tone={severity.tone}>{severity.label}</Badge>
              </div>
              <h2 className="mt-3 text-xl font-semibold text-text-primary">{getReadableAction(row.action)}</h2>
              <p className="mt-1 text-sm text-text-secondary">{row.metadata}</p>
            </div>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Close audit detail">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section className="grid gap-3 sm:grid-cols-2">
            {[
              ["Performed By", getUserDisplay(row).name],
              ["Role", row.actorRole || "—"],
              ["Record", row.target],
              ["Outlet", displayOutlet(row.outlet)],
              ["Time", formatDrawerTimestamp(row.timestamp)],
              ["Device", row.device && row.device !== "-" ? row.device : "Device detail not captured yet"],
              ["Network", row.ip && row.ip !== "-" ? row.ip : "Network detail not captured yet"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-background/70 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
                <div className="mt-1 text-sm font-semibold text-text-primary">{value || "-"}</div>
              </div>
            ))}
          </section>

          <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
            <div className="text-sm font-bold text-text-primary">Event Details</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{row.metadata}</p>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="text-sm font-bold text-text-primary">Before</div>
              <div className="mt-3">
                <DetailValueList value={row.before} emptyText="No earlier values captured." />
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="text-sm font-bold text-text-primary">After</div>
              <div className="mt-3">
                <DetailValueList value={row.after} emptyText="No new values captured." />
              </div>
            </div>
          </section>
        </div>

        <footer className="shrink-0 border-t border-border px-5 py-3 text-right">
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

function AuditKpiCard({ type, value }) {
  const meta = kpiMeta[type];
  const Icon = meta.Icon;
  return (
    <Card className={`border-l-4 ${meta.accent} p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{meta.label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">{value}</div>
          <div className="mt-1 text-xs font-medium text-text-secondary">{meta.helper}</div>
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${meta.iconClass}`}>
          <Icon size={18} />
        </span>
      </div>
    </Card>
  );
}

function QuickFilterPill({ active, children, onClick }) {
  return (
    <button
      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
        active
          ? "border-primary/30 bg-primary/10 text-primary shadow-sm"
          : "border-border bg-surface text-text-secondary hover:border-primary/30 hover:text-primary"
      }`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AuditEventRow({ row, onOpen }) {
  const severity = getSeverity(row);
  const typeMeta = auditTypeMeta[row.module] ?? { label: getReadableModule(row.module), tone: "neutral" };
  return (
    <button
      className="group relative w-full rounded-2xl border border-border bg-surface px-4 py-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary/[0.03] hover:shadow-md"
      type="button"
      onClick={() => onOpen(row)}
    >
      <div className="absolute bottom-0 left-[2.15rem] top-12 hidden w-px bg-border/70 last:hidden sm:block" aria-hidden="true" />
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,1.35fr)_minmax(220px,1fr)_170px_170px_130px] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <ActionIcon row={row} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold text-text-primary">{getReadableAction(row.action)}</span>
              <Badge tone={severity.tone}>{severity.label}</Badge>
            </div>
            <div className="mt-1 text-xs font-medium text-text-secondary">{getReadableModule(row.module)}</div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-primary group-hover:underline">{row.target || "Business record"}</div>
          <div className="mt-1 line-clamp-1 text-xs text-text-secondary">{row.metadata || "No additional note captured."}</div>
        </div>

        <div className="min-w-0">
          <UserCell row={row} />
        </div>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">{displayOutlet(row.outlet)}</div>
          <div className="mt-1"><Badge tone={typeMeta.tone}>{typeMeta.label}</Badge></div>
        </div>

        <div className="flex items-center gap-2 text-sm font-semibold text-text-secondary lg:justify-end">
          <Clock3 size={14} className="text-text-muted" />
          <span>{formatTimestamp(row.timestamp)}</span>
        </div>
      </div>
    </button>
  );
}

export default function AuditLogsPage({ auth, ui }) {
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [auditRowsLive, setAuditRowsLive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedAudit, setSelectedAudit] = useState(null);
  const canExport = auth?.hasPermission?.("audit_logs.export") ?? true;

  useEffect(() => {
    let ignore = false;
    async function loadAuditLogs() {
      setLoading(true);
      setLoadError("");
      try {
        const rows = await auditLogService.listAuditLogs();
        if (!ignore) setAuditRowsLive(rows);
      } catch (error) {
        console.error("Unable to load audit logs", error);
        if (!ignore) setLoadError(error.message || "Unable to load audit logs.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadAuditLogs();
    return () => {
      ignore = true;
    };
  }, []);

  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return auditRowsLive.filter((row) => {
      const date = parseAuditDate(row.timestamp);
      const matchesQuickFilter = quickFilter === "all"
        || (quickFilter === "security" && getEventGroup(row) === "security")
        || (quickFilter === "access" && getEventGroup(row) === "access")
        || (quickFilter === "data" && getEventGroup(row) === "data")
        || (quickFilter === "imports" && getEventGroup(row) === "imports")
        || (quickFilter === "today" && date && isSameDay(date, new Date()))
        || (quickFilter === "week" && isThisWeek(date));
      if (!matchesQuickFilter) return false;
      if (!search) return true;
      return [
        row.actor,
        getReadableAction(row.action),
        getReadableModule(row.module),
        row.target,
        displayOutlet(row.outlet),
        row.metadata,
        row.timestamp,
        row.ip,
        row.device,
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [auditRowsLive, query, quickFilter]);

  const kpis = useMemo(() => ({
    security: rows.filter((row) => getEventGroup(row) === "security").length,
    access: rows.filter((row) => getEventGroup(row) === "access").length,
    data: rows.filter((row) => getEventGroup(row) === "data").length,
    controls: rows.filter((row) => ["controls", "imports"].includes(getEventGroup(row))).length,
  }), [rows]);

  return (
    <div className="space-y-4">
      <PageHeader
        section="System"
        title="Audit Logs"
        description="Track only security-sensitive, permission-sensitive, data-changing, and business-critical actions."
        actions={(
          <button
            className="btn-secondary"
            type="button"
            disabled={!canExport}
            onClick={() => ui.notify({ title: "Audit export prepared", message: `${rows.length} audit rows included.` })}
          >
            <Download size={16} /> Export
          </button>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AuditKpiCard type="security" value={kpis.security} />
        <AuditKpiCard type="access" value={kpis.access} />
        <AuditKpiCard type="data" value={kpis.data} />
        <AuditKpiCard type="controls" value={kpis.controls} />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-[280px] max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input
              className="control h-10 w-full pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search user, action, module, record, outlet..."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {quickFilters.map((filter) => (
              <QuickFilterPill
                key={filter.id}
                active={quickFilter === filter.id}
                onClick={() => setQuickFilter(filter.id)}
              >
                {filter.label}
              </QuickFilterPill>
            ))}
          </div>
        </div>
      </Card>

      <Card
        title="Activity Timeline"
        description="Review important security, access, data and control events."
        action={<span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold text-text-secondary"><History size={14} /> {rows.length} events</span>}
      >
        {loading ? (
          <div className="p-10 text-center text-sm font-semibold text-text-secondary">Loading audit activity...</div>
        ) : loadError ? (
          <div className="p-10 text-center text-sm font-semibold text-rose-700">{loadError}</div>
        ) : rows.length ? (
          <div className="space-y-3 p-4">
            <div className="hidden grid-cols-[minmax(300px,1.35fr)_minmax(220px,1fr)_170px_170px_130px] gap-4 px-4 text-[11px] font-bold uppercase tracking-wide text-text-muted lg:grid">
              <span>Action</span>
              <span>Record</span>
              <span>User</span>
              <span>Outlet</span>
              <span className="text-right">Time</span>
            </div>
            {rows.map((row) => (
              <AuditEventRow key={row.id} row={row} onOpen={setSelectedAudit} />
            ))}
          </div>
        ) : (
          <div className="p-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background text-text-muted">
              <ShieldCheck size={20} />
            </div>
            <div className="mt-3 text-sm font-bold text-text-primary">No audit activity found for selected filters.</div>
            <div className="mt-1 text-xs text-text-secondary">Try clearing the search or choosing a different quick filter.</div>
          </div>
        )}
      </Card>

      <AuditDetailDrawer row={selectedAudit} onClose={() => setSelectedAudit(null)} />
    </div>
  );
}
