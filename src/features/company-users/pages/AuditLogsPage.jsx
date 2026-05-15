import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileDown, FilePenLine, KeyRound, LockKeyhole, Search, ShieldCheck, UserCog, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
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

const moduleTone = {
  authentication: "info",
  "access-control": "warning",
  people: "success",
  sales: "info",
  purchases: "warning",
  operations: "neutral",
};

const auditTypeMeta = {
  authentication: { label: "Security", tone: "info" },
  "access-control": { label: "Access", tone: "warning" },
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

function formatJson(value) {
  if (!value) return "Not applicable";
  return JSON.stringify(value, null, 2);
}

function formatTimestamp(value) {
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
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

function ActionCell({ row }) {
  const Icon = actionIconMap[row.action] ?? FilePenLine;
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="truncate font-bold text-text-primary">{getAuditActionLabel(row.action)}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{getAuditModuleLabel(row.module)}</div>
      </div>
    </div>
  );
}

function UserCell({ row }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-text-secondary">
        {getInitials(row.actor)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-text-primary">{row.actor}</div>
        {row.actorRole ? <Badge tone="neutral">{row.actorRole}</Badge> : null}
      </div>
    </div>
  );
}

function AuditDetailDrawer({ row, onClose }) {
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[1px]" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-primary">{getAuditModuleLabel(row.module)}</div>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{getAuditActionLabel(row.action)}</h2>
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
              ["User", row.actor],
              ["User Role", row.actorRole],
              ["Target", row.target],
              ["Outlet", row.outlet],
              ["Timestamp", formatTimestamp(row.timestamp)],
              ["IP", row.ip],
              ["Device", row.device],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-slate-50/70 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
                <div className="mt-1 text-sm font-semibold text-text-primary">{value || "-"}</div>
              </div>
            ))}
          </section>

          <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
            <div className="text-sm font-bold text-text-primary">Metadata</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{row.metadata}</p>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="text-sm font-bold text-text-primary">Before</div>
              <pre className="mt-3 max-h-[320px] overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-100">{formatJson(row.before)}</pre>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="text-sm font-bold text-text-primary">After</div>
              <pre className="mt-3 max-h-[320px] overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-100">{formatJson(row.after)}</pre>
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

export default function AuditLogsPage({ auth, ui }) {
  const [query, setQuery] = useState("");
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
    if (!search) return auditRowsLive;
    return auditRowsLive.filter((row) =>
      [
        row.actor,
        getAuditActionLabel(row.action),
        getAuditModuleLabel(row.module),
        row.target,
        row.outlet,
        row.metadata,
        row.timestamp,
        row.ip,
        row.device,
      ].some((value) => String(value || "").toLowerCase().includes(search)),
    );
  }, [auditRowsLive, query]);

  const columns = [
    {
      key: "action",
      header: "Action",
      sticky: true,
      width: "230px",
      render: (row) => <ActionCell row={row} />,
    },
    {
      key: "record",
      header: "Record",
      width: "250px",
      render: (row) => (
        <button
          className="max-w-[240px] text-left"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedAudit(row);
          }}
        >
          <div className="truncate text-sm font-bold text-primary hover:underline">{row.target}</div>
          <div className="mt-1 line-clamp-1 text-xs text-text-secondary">{row.metadata}</div>
        </button>
      ),
    },
    { key: "module", header: "Module", render: (row) => <Badge tone={moduleTone[row.module] ?? "neutral"}>{getAuditModuleLabel(row.module)}</Badge> },
    { key: "user", header: "User", width: "210px", render: (row) => <UserCell row={row} /> },
    { key: "outlet", header: "Outlet" },
    { key: "timestamp", header: "Timestamp", render: (row) => <span className="text-sm text-text-secondary">{formatTimestamp(row.timestamp)}</span> },
    {
      key: "type",
      header: "Type",
      render: (row) => {
        const meta = auditTypeMeta[row.module] ?? { label: row.module, tone: "neutral" };
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
  ];

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

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[280px] max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input
              className="control h-10 w-full pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search user, action, module, record, outlet..."
            />
          </div>
          <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">
            Passive navigation, searches, dropdown clicks, and modal opens are intentionally not logged.
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Security Events</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">{rows.filter((row) => row.module === "authentication").length}</div>
          <div className="mt-1 text-xs text-text-secondary">Login, reset, invite and verification</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Access Changes</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">{rows.filter((row) => row.module === "access-control").length}</div>
          <div className="mt-1 text-xs text-text-secondary">Roles, permissions and outlet access</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Data Changes</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">{rows.filter((row) => ["people", "sales", "purchases"].includes(row.module)).length}</div>
          <div className="mt-1 text-xs text-text-secondary">Employee, sales, purchase and master data</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Control Events</div>
          <div className="mt-1 text-2xl font-semibold text-text-primary">{rows.filter((row) => row.module === "operations").length}</div>
          <div className="mt-1 text-xs text-text-secondary">Import, export and data health actions</div>
        </Card>
      </div>

      <Card title="Audit Trail" description="Click a row to inspect metadata, device details, and before/after changes.">
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading audit logs...</div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-700">{loadError}</div>
        ) : rows.length ? (
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            onRowClick={(row) => setSelectedAudit(row)}
            tableClassName="min-w-[1180px]"
          />
        ) : (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">No audit logs found.</div>
        )}
      </Card>

      <AuditDetailDrawer row={selectedAudit} onClose={() => setSelectedAudit(null)} />
    </div>
  );
}
