import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CalendarDays, ClipboardCheck, Download, Eye, MoreHorizontal, PackageCheck, Plus, Search, Settings2, SlidersHorizontal, UploadCloud, Wrench, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import Drawer from "../../../components/ui/Drawer.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import ActivityTimeline from "../../../components/ui/Timeline.jsx";
import DashboardSection from "../../../components/layout/DashboardSection.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { supabase } from "../../../lib/supabase.js";
import { assetTrackingService } from "../../../services/assetTrackingService.js";
import { canCreate, canDelete, canEdit, canExport, canManage, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { getEmployeeDisplayName, isUuidLike } from "../../../utils/userDisplay.js";
import { IMAGE_UPLOAD_ACCEPT, optimizeImageFileForPreview } from "../../../utils/imageUpload.js";

const assetConditions = ["healthy", "needs_attention", "under_maintenance", "low_quantity", "damaged", "missing", "disposed"];
const inspectionConditionOptions = ["healthy", "needs_attention", "damaged", "missing"];
const reduceReasons = ["broken", "missing", "disposed", "stolen", "transferred", "correction", "other"];
const maintenancePriorities = ["low", "medium", "high", "critical"];
const maintenanceTypes = ["preventive", "repair", "inspection", "cleaning", "calibration", "replacement", "emergency"];
const maintenanceStatuses = ["scheduled", "in_progress", "completed"];
const inspectionTypeOptions = [
  { value: "routine_check", label: "Routine Check", helper: "Standard operational checklist for the selected scope." },
  { value: "opening_check", label: "Opening Check", helper: "Start-of-day readiness check for active outlet assets." },
  { value: "closing_check", label: "Closing Check", helper: "End-of-day verification for active outlet assets." },
  { value: "spot_check", label: "Spot Check", helper: "Starts empty so you can add only the assets being audited." },
  { value: "maintenance_verification", label: "Maintenance Verification", helper: "Prioritizes maintainable assets and items under service." },
  { value: "incident_follow_up", label: "Incident Follow-up", helper: "Prioritizes assets that need attention, are damaged, missing, or low quantity." },
];
const quickFilterLabels = {
  all: "All Assets",
  scheduled_maintenance: "Scheduled Maintenance",
  maintenance_due: "Maintenance Due",
  under_maintenance: "Under Maintenance",
  needs_attention: "Needs Attention",
  low_quantity: "Low Quantity",
  missing: "Missing",
  disposed: "Disposed",
  inspected_today: "Recently Inspected",
  high_variance: "High Variance",
  no_photo: "No Photo",
};

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatFullDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatFullDate(value)}, ${formatTime(value)}`;
}

function formatRelativeDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday - startDate) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 14) return "1 week ago";
  if (diffDays < 31) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatFullDate(value);
}

function assetConditionTone(condition) {
  if (condition === "healthy") return "success";
  if (condition === "under_maintenance") return "info";
  if (condition === "needs_attention" || condition === "low_quantity") return "warning";
  if (condition === "damaged" || condition === "missing") return "danger";
  return "neutral";
}

function assetConditionLabel(condition) {
  if (condition === "healthy") return "Good";
  if (condition === "under_maintenance") return "Under Maintenance";
  if (condition === "needs_attention") return "Needs Attention";
  if (condition === "low_quantity") return "Low Quantity";
  return titleCase(condition || "healthy");
}

function maintenanceTypeLabel(type) {
  const labels = {
    preventive: "Preventive Maintenance",
    repair: "Repair",
    inspection: "Inspection",
    cleaning: "Cleaning",
    calibration: "Calibration",
    replacement: "Replacement",
    emergency: "Emergency",
  };
  return labels[type] || titleCase(type || "repair");
}

function maintenanceTypeIcon(type) {
  const icons = {
    preventive: "PM",
    repair: "RP",
    inspection: "IN",
    cleaning: "CL",
    calibration: "CA",
    replacement: "RE",
    emergency: "EM",
  };
  return icons[type] || "MT";
}

function priorityTone(priority) {
  if (priority === "critical") return "danger";
  if (priority === "high") return "warning";
  if (priority === "medium") return "warning";
  return "info";
}

function maintenanceStatusLabel(status) {
  if (status === "in_progress") return "In Progress";
  if (status === "completed") return "Completed";
  return "Scheduled";
}

function maintenanceStatusTone(status) {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  return "warning";
}

function maintenanceStatusDateLabel(record) {
  if (record.status === "completed") return ["Completed", record.completed_date || record.date];
  if (record.status === "in_progress") return ["Started", record.scheduled_date || record.date];
  return ["Scheduled", record.scheduled_date || record.date];
}

function LifecycleProgress({ status }) {
  const currentIndex = Math.max(0, maintenanceStatuses.indexOf(status));
  return (
    <div className="flex items-center gap-1.5">
      {maintenanceStatuses.map((step, index) => {
        const completed = index < currentIndex;
        const current = index === currentIndex;
        return (
        <Fragment key={step}>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black transition ${
            completed
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
              : current
                ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                : "bg-slate-50 text-text-muted ring-1 ring-border"
          }`}>
            {maintenanceStatusLabel(step)}
          </span>
          {index < maintenanceStatuses.length - 1 ? <span className={`h-px w-4 ${index < currentIndex ? "bg-emerald-300" : "bg-border"}`} /> : null}
        </Fragment>
      );})}
    </div>
  );
}

function isMaintenanceOverdue(record) {
  if (!record?.scheduled_date || record.status === "completed") return false;
  const scheduled = new Date(record.scheduled_date);
  const today = new Date();
  return scheduled < new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startDate - startToday) / 86400000);
}

function maintenanceRelevantDate(record) {
  return record?.completed_date || record?.scheduled_date || record?.date || record?.created_at || record?.updated_at || null;
}

function maintenanceSortTime(record) {
  const candidates = [
    record?.completed_date,
    record?.scheduled_date,
    record?.date,
    record?.created_at,
    record?.updated_at,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const time = new Date(candidate).getTime();
    if (!Number.isNaN(time)) return time;
  }
  return 0;
}

function sortMaintenanceNewestFirst(first, second) {
  return maintenanceSortTime(second) - maintenanceSortTime(first);
}

function maintenanceTimelineGroup(record) {
  const value = maintenanceRelevantDate(record);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Older";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startDate - startToday) / 86400000);
  if (record.status !== "completed" && diffDays > 0) return "Upcoming";
  if (diffDays === 0) return "Today";
  return "Older";
}

function normalizeAssetCondition(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "good" || normalized === "active") return "healthy";
  if (["needs_review", "review", "need_repair", "need_repairs"].includes(normalized)) return "needs_attention";
  if (normalized === "inactive") return "disposed";
  return assetConditions.includes(normalized) ? normalized : "healthy";
}

function assetConditionInsight(condition) {
  const insights = {
    healthy: "No active operational issues.",
    needs_attention: "Minor issue detected and needs follow-up.",
    damaged: "Maintenance attention required.",
    missing: "Asset unavailable during latest inspection.",
    under_maintenance: "Maintenance work is currently required.",
    low_quantity: "Quantity is below the preferred operating level.",
    disposed: "Asset has been removed from active operations.",
  };
  return insights[condition || "healthy"] || insights.healthy;
}

function assetDisplayId(asset) {
  const source = String(asset?.id || "").replace(/-/g, "");
  const number = parseInt(source.slice(-6), 16);
  if (Number.isNaN(number)) return "AST-00000";
  return `AST-${String((number % 99999) + 1).padStart(5, "0")}`;
}

function getQuantityHealth(asset) {
  const quantity = Number(asset.current_quantity || 0);
  const minimum = Number(asset.minimum_quantity || 0);
  const condition = asset.condition || "healthy";
  if (condition === "disposed") return { label: "Disposed", tone: "neutral", dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-100", border: "border-slate-200" };
  if (condition === "missing" || quantity <= 0) return { label: "Missing", tone: "danger", dot: "bg-rose-800", text: "text-rose-800", bg: "bg-rose-50", border: "border-rose-100" };
  if (condition === "damaged") return { label: "Damaged", tone: "danger", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50", border: "border-red-100" };
  if (condition === "under_maintenance") return { label: "Maintenance", tone: "info", dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-100" };
  if (condition === "needs_attention") return { label: "Attention", tone: "warning", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-100" };
  if (condition === "low_quantity" || (minimum > 0 && quantity <= minimum)) return { label: "Low", tone: "warning", dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50", border: "border-orange-100" };
  return { label: "Good", tone: "success", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-100" };
}

function assetNeedsAttention(asset) {
  const condition = normalizeAssetCondition(asset.condition);
  if (condition === "disposed" || asset.status === "archived") return false;
  return condition !== "healthy" ||
    Number(asset.current_quantity || 0) <= 0 ||
    (Number(asset.minimum_quantity || 0) > 0 && Number(asset.current_quantity || 0) <= Number(asset.minimum_quantity || 0));
}

function latestMovementSummary(movement) {
  if (!movement) return "—";
  const amount = Math.abs(Number(movement.quantity_change || 0));
  if (movement.reason === "import") return `Asset Imported · ${amount ? `${movement.quantity_change > 0 ? "+" : ""}${movement.quantity_change}` : "Recorded"}`;
  if (movement.movement_type === "add") return `Quantity Adjusted · +${amount}`;
  if (movement.movement_type === "reduce") return `Quantity Adjusted · -${amount}`;
  if (movement.movement_type === "correction") return "Inspection update";
  if (movement.movement_type === "transfer_in") return "Transfer · Received";
  if (movement.movement_type === "transfer_out") return "Transfer · Sent";
  return "Quantity adjusted";
}

function nextMaintenanceInfo(records = []) {
  const candidates = records
    .filter((record) => record.status !== "completed")
    .map((record) => ({ record, date: record.scheduled_date || record.date }))
    .filter((entry) => entry.date)
    .sort((first, second) => new Date(first.date) - new Date(second.date));
  if (!candidates.length) return { label: "No schedule", tone: "neutral", days: null, date: null };
  const next = candidates[0];
  const days = daysUntil(next.date);
  if (days === null) return { label: "No schedule", tone: "neutral", days: null, date: null };
  if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, tone: "danger", days, date: next.date };
  if (days === 0) return { label: "Due Today", tone: "warning", days, date: next.date };
  if (days === 1) return { label: "Tomorrow", tone: "warning", days, date: next.date };
  if (days <= 7) return { label: formatFullDate(next.date).replace(/\s\d{4}$/, ""), tone: "warning", days, date: next.date };
  return { label: formatFullDate(next.date).replace(/\s\d{4}$/, ""), tone: "success", days, date: next.date };
}

function maintenanceCompletedDate(record) {
  return record?.completed_date || (record?.status === "completed" ? record?.date : null) || record?.updated_at || record?.created_at || null;
}

function latestCompletedMaintenanceRecord(records = []) {
  return records
    .filter((record) => record.status === "completed")
    .sort((first, second) => new Date(maintenanceCompletedDate(second) || 0) - new Date(maintenanceCompletedDate(first) || 0))[0] || null;
}

function currentNextServiceDate(records = []) {
  const latestCompleted = latestCompletedMaintenanceRecord(records);
  if (!latestCompleted?.next_service_date) return null;
  const completedDate = maintenanceCompletedDate(latestCompleted);
  const nextDate = new Date(latestCompleted.next_service_date);
  const serviceDate = new Date(completedDate || 0);
  if (Number.isNaN(nextDate.getTime())) return null;
  if (!Number.isNaN(serviceDate.getTime()) && nextDate < serviceDate) return null;
  return latestCompleted.next_service_date;
}

function assetNameById(assets = [], assetId) {
  return assets.find((asset) => asset.id === assetId)?.name || "Asset";
}

function activityTimestamp(row) {
  return row?.created_at || row?.updated_at || row?.completed_date || row?.movement_date || row?.date || "";
}

function actorNameFromAuth(auth, actorId) {
  const currentActorIds = [auth?.user?.id, auth?.profile?.auth_user_id, auth?.profile?.id].filter(Boolean);
  if (actorId && currentActorIds.includes(actorId)) return getEmployeeDisplayName(auth?.profile, { fallback: auth?.user?.email || "Current user" });
  return "Unknown User";
}

function activityActorLabel(prefix, actorId, auth, actorNameResolver = null) {
  return `${prefix} by ${actorNameResolver ? actorNameResolver(actorId) : actorNameFromAuth(auth, actorId)}`;
}

function inspectionActorLabel(inspection, authOrProfile, actorNameResolver = null) {
  const checkedBy = String(inspection?.checked_by || "").trim();
  if (checkedBy && !isUuidLike(checkedBy)) return `Inspected by ${checkedBy}`;
  const actorId = inspection?.checked_by_employee_id || checkedBy || inspection?.created_by || inspection?.last_edited_by;
  return activityActorLabel("Inspected", actorId, authOrProfile, actorNameResolver);
}

function movementActivityMeta(movement, assetName) {
  const quantity = Number(movement.quantity_change || 0);
  const quantityText = `${quantity > 0 ? "+" : ""}${quantity}`;
  if (movement.reason === "import") {
    return {
      title: "Asset Imported",
      description: `${assetName} imported${quantity ? ` · ${quantityText}` : ""}`,
      type: "created",
      actorPrefix: "Imported",
    };
  }
  if (movement.reason === "inspection" || movement.movement_type === "correction") {
    return {
      title: "Inspection Completed",
      description: `${assetName} inspection correction${quantity ? ` · ${quantityText}` : ""}`,
      type: "inspection",
      actorPrefix: "Inspected",
    };
  }
  return {
    title: "Quantity Adjusted",
    description: `${assetName} · ${quantityText} · ${movement.quantity_before} → ${movement.quantity_after}`,
    type: "movement",
    actorPrefix: "Adjusted",
  };
}

function assetHoverInsight(asset, lastMovement, lastInspection) {
  if (!asset.image_url && !asset.thumbnail_url) return "Photo missing";
  if (lastInspection?.summary?.critical_alerts) return "Latest inspection has issues";
  if (assetNeedsAttention(asset)) return assetConditionInsight(asset.condition);
  if (lastMovement) return latestMovementSummary(lastMovement);
  return "No recent operational issue";
}

function FloatingActionItem({ children, icon, tone = "default", onClick }) {
  const toneClass = tone === "warning"
    ? "text-amber-700 hover:bg-amber-50"
    : "text-text-secondary hover:bg-primary/5 hover:text-primary";
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-bold transition ${toneClass}`}
      type="button"
      onClick={onClick}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function FloatingPreviewLayer({ anchor, width = 300, children }) {
  if (!anchor) return null;
  const margin = 12;
  const top = Math.min(anchor.bottom + 8, window.innerHeight - margin);
  const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
  return createPortal(
    <div className="pointer-events-none fixed z-[9970]" style={{ top, left, width }}>
      {children}
    </div>,
    document.body,
  );
}

function categoryIcon(categoryName) {
  const name = String(categoryName || "").toLowerCase();
  if (name.includes("pos")) return "POS";
  if (name.includes("dining") || name.includes("furniture")) return "FN";
  if (name.includes("electrical")) return "EL";
  if (name.includes("cleaning")) return "CL";
  if (name.includes("utensil")) return "UT";
  if (name.includes("sign")) return "SG";
  if (name.includes("kitchen")) return "KT";
  return "AS";
}

function AssetThumbnail({ asset, size = "md", interactive = false }) {
  const [failed, setFailed] = useState(false);
  const sizeClass = size === "lg" ? "h-28 w-28 rounded-3xl" : "h-14 w-14 rounded-xl";
  const iconSize = size === "lg" ? 30 : 18;
  const imageUrl = asset.thumbnail_url || asset.image_url;
  if (imageUrl && !failed) {
    return (
      <span className={`group relative block shrink-0 overflow-hidden ${sizeClass}`}>
        <img className="h-full w-full bg-slate-100 object-cover shadow-sm" src={imageUrl} alt={asset.name} onError={() => setFailed(true)} />
        {interactive ? <span className="absolute inset-0 flex items-center justify-center bg-slate-950/45 text-[11px] font-black text-white opacity-0 transition group-hover:opacity-100">View Image</span> : null}
      </span>
    );
  }
  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-slate-100 text-primary shadow-sm ${interactive ? "transition group-hover:ring-2 group-hover:ring-primary/20" : ""}`}>
      <PackageCheck size={iconSize} strokeWidth={2.2} />
      <span className="sr-only">{categoryIcon(asset.category_name)}</span>
    </div>
  );
}

function DateText({ value }) {
  return <span title={formatRelativeDate(value)}>{formatFullDate(value)}</span>;
}

function inspectionProgress(inspection) {
  const summary = inspection?.summary || {};
  if (Number.isFinite(Number(inspection?.completion_percentage)) && Number(inspection.completion_percentage) > 0) return Math.round(Number(inspection.completion_percentage));
  if (Number.isFinite(Number(summary.completion_percentage))) return Math.round(Number(summary.completion_percentage));
  const total = Number(summary.total_assets || summary.totalAssets || 0);
  const checked = Number(summary.checked_assets || summary.checkedAssets || summary.matched_assets || 0);
  return total ? Math.round((checked / total) * 100) : 0;
}

function draftStatusLabel(status) {
  if (status === "in_progress") return "In Progress";
  if (status === "pending_review") return "Pending Review";
  return titleCase(status || "draft");
}

function isDraftInspection(inspection) {
  return ["draft", "in_progress", "pending_review"].includes(inspection.status);
}

function canonical(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeOutletRecord(outlet = {}) {
  const source = Array.isArray(outlet.outlets) ? outlet.outlets[0] : (outlet.outlets || outlet.outlet || outlet);
  const id = source?.id ?? outlet.outlet_id ?? outlet.id ?? "";
  const code = source?.code ?? source?.outlet_code ?? source?.shortCode ?? source?.short_code ?? source?.abbreviation ?? outlet.code ?? outlet.outlet_code ?? outlet.short_code ?? "";
  const name = source?.name ?? source?.outlet_name ?? source?.outletName ?? outlet.name ?? outlet.outlet_name ?? "";
  return { ...outlet, ...source, id, code: String(code || "").trim(), name: String(name || "").trim() };
}

function outletDisplayCode(outlet = {}) {
  const normalized = normalizeOutletRecord(outlet);
  return normalized.code || normalized.name || normalized.id || "Outlet";
}

function parseCsvLine(line = "") {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] || "");
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return headers.reduce((record, header, cellIndex) => ({ ...record, [header]: cells[cellIndex] ?? "" }), { __row: index + 2 });
  });
  return { headers, rows };
}

function readUInt16(view, offset) {
  return view.getUint16(offset, true);
}

function readUInt32(view, offset) {
  return view.getUint32(offset, true);
}

function columnIndex(cellRef = "") {
  const letters = String(cellRef).match(/[A-Z]+/i)?.[0] ?? "A";
  return [...letters.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("XLSX parsing requires browser ZIP support. Please use CSV in this browser.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsx(buffer) {
  const view = new DataView(buffer);
  let eocdOffset = -1;
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 66000); offset -= 1) {
    if (readUInt32(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Unable to read XLSX workbook.");
  const entryCount = readUInt16(view, eocdOffset + 10);
  let centralOffset = readUInt32(view, eocdOffset + 16);
  const files = {};
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(view, centralOffset) !== 0x02014b50) break;
    const method = readUInt16(view, centralOffset + 10);
    const compressedSize = readUInt32(view, centralOffset + 20);
    const fileNameLength = readUInt16(view, centralOffset + 28);
    const extraLength = readUInt16(view, centralOffset + 30);
    const commentLength = readUInt16(view, centralOffset + 32);
    const localOffset = readUInt32(view, centralOffset + 42);
    const name = decoder.decode(new Uint8Array(buffer, centralOffset + 46, fileNameLength));
    const localNameLength = readUInt16(view, localOffset + 26);
    const localExtraLength = readUInt16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataOffset, compressedSize);
    const bytes = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (bytes) files[name] = decoder.decode(bytes);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function textFromXlsxCell(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "s") {
    const index = Number(cell.querySelector("v")?.textContent ?? -1);
    return sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") return [...cell.querySelectorAll("t")].map((item) => item.textContent ?? "").join("");
  return cell.querySelector("v")?.textContent ?? "";
}

async function parseXlsx(file) {
  const files = await unzipXlsx(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedStringsXml = files["xl/sharedStrings.xml"];
  const sharedStrings = sharedStringsXml
    ? [...parser.parseFromString(sharedStringsXml, "application/xml").querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((item) => item.textContent ?? "").join(""))
    : [];
  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("No worksheet found in XLSX file.");
  const sheet = parser.parseFromString(files[sheetName], "application/xml");
  const rawRows = [...sheet.querySelectorAll("sheetData row")].map((rowNode) => {
    const values = [];
    [...rowNode.querySelectorAll("c")].forEach((cell) => {
      values[columnIndex(cell.getAttribute("r"))] = textFromXlsxCell(cell, sharedStrings);
    });
    return values;
  }).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const headers = rawRows[0]?.map((cell) => String(cell ?? "").trim()) ?? [];
  const rows = rawRows.slice(1).map((row, index) => headers.reduce((record, header, cellIndex) => ({ ...record, [header]: row[cellIndex] ?? "" }), { __row: index + 2 }));
  return { headers, rows };
}

function readImportValue(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => canonical(key) === canonical(alias));
    if (found) return String(found[1] ?? "").trim();
  }
  return "";
}

function parseImportDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, day, month, year] = slash;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isValidDateInput(value) {
  if (!value) return true;
  const normalized = parseImportDate(value);
  if (!normalized) return false;
  const date = new Date(`${normalized}T00:00:00`);
  return !Number.isNaN(date.getTime()) && normalized === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const assetImportColumns = ["Asset Name", "Asset Code", "Outlet Code", "Category", "Quantity", "Minimum Quantity", "Condition", "Location", "Purchase Date", "Warranty Expiry", "Status", "Description", "Notes"];
const assetImportConditionMap = new Map([
  ["good", "healthy"],
  ["fair", "needs_attention"],
  ["needsattention", "needs_attention"],
  ["damaged", "damaged"],
  ["disposed", "disposed"],
]);
const assetImportStatusMap = new Map([
  ["active", "active"],
  ["inactive", "archived"],
  ["disposed", "archived"],
]);

function buildAssetImportPreview(rows, { assets, outlets, categories }) {
  const outletByCode = new Map(outlets.map((outlet) => {
    const normalized = normalizeOutletRecord(outlet);
    return [canonical(normalized.code || ""), normalized];
  }).filter(([key]) => key));
  const categoryByName = new Map(categories.filter((category) => category.is_active !== false).map((category) => [canonical(category.name), category]));
  const existingByCodeOutlet = new Map();
  const existingByNameOutlet = new Map();
  assets.forEach((asset) => {
    const outletKey = canonical(asset.outlet_id);
    if (asset.asset_code) existingByCodeOutlet.set(`${canonical(asset.asset_code)}:${outletKey}`, asset);
    existingByNameOutlet.set(`${canonical(asset.name)}:${outletKey}`, asset);
  });

  return rows.map((row) => {
    const assetName = readImportValue(row, ["Asset Name", "Name", "Asset"]);
    const assetCode = readImportValue(row, ["Asset Code", "Code"]);
    const outletCode = readImportValue(row, ["Outlet Code", "Outlet"]);
    const categoryName = readImportValue(row, ["Category"]);
    const quantityText = readImportValue(row, ["Quantity", "Current Quantity"]);
    const minimumText = readImportValue(row, ["Minimum Quantity", "Minimum Qty", "Min Quantity"]);
    const conditionText = readImportValue(row, ["Condition"]) || "Good";
    const location = readImportValue(row, ["Location"]);
    const purchaseDateText = readImportValue(row, ["Purchase Date"]);
    const warrantyExpiryText = readImportValue(row, ["Warranty Expiry", "Warranty Expiry Date"]);
    const statusText = readImportValue(row, ["Status"]) || "Active";
    const description = readImportValue(row, ["Description"]);
    const photoUrl = readImportValue(row, ["Photo URL", "Image URL"]);
    const notes = readImportValue(row, ["Notes", "Remark"]);
    const errors = [];

    if (!assetName) errors.push("Missing Asset Name");
    const outlet = outletByCode.get(canonical(outletCode));
    if (!outletCode) errors.push("Missing Outlet Code");
    if (outletCode && !outlet) errors.push(`Unknown Outlet Code: ${outletCode}`);
    const category = categoryByName.get(canonical(categoryName));
    if (!categoryName) errors.push("Missing Category");
    if (categoryName && !category) errors.push("Unknown Category");

    const quantity = quantityText === "" ? NaN : Number(quantityText);
    if (!Number.isFinite(quantity) || quantity < 0) errors.push("Invalid Quantity");
    const minimumQuantity = minimumText === "" ? 0 : Number(minimumText);
    if (!Number.isFinite(minimumQuantity) || minimumQuantity < 0) errors.push("Invalid Minimum Quantity");

    const condition = assetImportConditionMap.get(canonical(conditionText));
    if (!condition) errors.push("Invalid Condition");
    const status = assetImportStatusMap.get(canonical(statusText));
    if (!status) errors.push("Invalid Status");
    if (purchaseDateText && !isValidDateInput(purchaseDateText)) errors.push("Invalid Purchase Date");
    if (warrantyExpiryText && !isValidDateInput(warrantyExpiryText)) errors.push("Invalid Warranty Expiry");
    if (photoUrl && !/^https?:\/\//i.test(photoUrl)) errors.push("Invalid Photo URL");

    const outletKey = canonical(outlet?.id);
    const existing = assetCode
      ? existingByCodeOutlet.get(`${canonical(assetCode)}:${outletKey}`)
      : existingByNameOutlet.get(`${canonical(assetName)}:${outletKey}`);

    const merged = {
      ...emptyAsset(),
      ...(existing || {}),
      id: existing?.id || "",
      asset_code: assetCode || existing?.asset_code || "",
      outlet_id: outlet?.id || "",
      category_id: category?.id || existing?.category_id || "",
      name: assetName,
      description: description || existing?.description || "",
      image_url: photoUrl || existing?.image_url || "",
      thumbnail_url: photoUrl || existing?.thumbnail_url || "",
      condition: canonical(statusText) === "disposed" ? "disposed" : (condition || existing?.condition || "healthy"),
      current_quantity: Number.isFinite(quantity) ? quantity : 0,
      minimum_quantity: Number.isFinite(minimumQuantity) ? minimumQuantity : 0,
      status: status || "active",
      unit: existing?.unit || "unit",
      location: location || existing?.location || "",
      purchase_date: purchaseDateText ? parseImportDate(purchaseDateText) : existing?.purchase_date || null,
      warranty_expiry: warrantyExpiryText ? parseImportDate(warrantyExpiryText) : existing?.warranty_expiry || null,
      notes: notes || existing?.notes || "",
      remark: notes || existing?.remark || "",
    };

    return {
      rowNumber: row.__row,
      source: row,
      action: errors.length ? "error" : existing ? "update" : "create",
      errors,
      existing,
      outlet,
      category,
      asset: merged,
      display: {
        assetName,
        outlet: outlet ? `${outlet.name} (${outletDisplayCode(outlet)})` : outletCode,
        category: category?.name || categoryName,
        quantity: quantityText,
        condition: conditionText,
        status: statusText,
      },
    };
  });
}

function emptyAsset() {
  return {
    outlet_id: "",
    category_id: "",
    asset_code: "",
    name: "",
    description: "",
    location: "",
    purchase_date: null,
    warranty_expiry: null,
    notes: "",
    unit: "unit",
    current_quantity: 0,
    minimum_quantity: 0,
    status: "active",
    condition: "healthy",
    maintenance_override: "inherit",
    image_url: "",
    remark: "",
  };
}

function AssetFormModal({ asset, outlets, categories, onClose, onSubmit, saving }) {
  const [values, setValues] = useState(() => ({ ...emptyAsset(), ...asset }));
  const [imageError, setImageError] = useState("");
  const isEdit = Boolean(asset?.id);
  const selectedCategory = categories.find((category) => category.id === values.category_id);
  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  async function handleImageFile(file) {
    setImageError("");
    if (!file) return;
    try {
      const optimized = await optimizeImageFileForPreview(file);
      update("image_url", optimized.dataUrl);
      update("previous_image_url", asset?.image_url || asset?.thumbnail_url || "");
    } catch (error) {
      setImageError(error.message || "Unable to read image. Please try another file.");
    }
  }
  return (
    <Modal
      title={isEdit ? "Edit Asset" : "Add Asset"}
      description="Create or update an outlet asset record."
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            disabled={saving || !values.name.trim() || !values.outlet_id || !values.category_id}
            onClick={() => onSubmit(values)}
          >
            {isEdit ? "Save Asset" : "Create Asset"}
          </button>
        </>
      )}
    >
      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <div className="rounded-3xl border border-border bg-slate-50 p-4">
          <div className="flex flex-col items-center text-center">
            <AssetThumbnail asset={{ ...values, category_name: categories.find((category) => category.id === values.category_id)?.name }} size="lg" />
            <label className="btn-secondary mt-4 h-9 cursor-pointer px-3 text-xs">
              <UploadCloud size={14} /> Upload Photo
              <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handleImageFile(event.target.files?.[0])} />
            </label>
            {values.image_url ? <button className="mt-2 text-xs font-bold text-text-muted hover:text-rose-600" type="button" onClick={() => { update("previous_image_url", asset?.image_url || asset?.thumbnail_url || ""); update("image_url", ""); update("thumbnail_url", ""); }}>Remove image</button> : null}
            {imageError ? <div className="mt-2 text-xs font-semibold text-rose-600">{imageError}</div> : <div className="mt-2 text-xs text-text-muted">JPG/PNG/WebP · max 5MB. Optimized on upload.</div>}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
        <FieldLabel label="Asset Name">
          <input className="control" value={values.name} onChange={(event) => update("name", event.target.value)} placeholder="2-door chiller" />
        </FieldLabel>
        <FieldLabel label="Outlet">
          <SelectField value={values.outlet_id} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => update("outlet_id", value)} />
        </FieldLabel>
        <FieldLabel label="Category">
          <SelectField value={values.category_id} options={categories.filter((category) => category.is_active).map((category) => ({ value: category.id, label: category.name }))} onChange={(value) => update("category_id", value)} searchable />
        </FieldLabel>
        <FieldLabel label="Condition">
          <SelectField value={values.condition || "healthy"} options={assetConditions.map((condition) => ({ value: condition, label: assetConditionLabel(condition) }))} onChange={(value) => update("condition", value)} />
        </FieldLabel>
        <FieldLabel label="Current Quantity">
          <input className="control" type="number" min="0" value={values.current_quantity} onChange={(event) => update("current_quantity", event.target.value)} disabled={isEdit} />
        </FieldLabel>
        <FieldLabel label="Minimum Quantity">
          <input className="control" type="number" min="0" value={values.minimum_quantity} onChange={(event) => update("minimum_quantity", event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Unit">
          <input className="control" value={values.unit} onChange={(event) => update("unit", event.target.value)} placeholder="unit / set / pcs" />
        </FieldLabel>
        <FieldLabel label="Remark">
          <input className="control" value={values.remark} onChange={(event) => update("remark", event.target.value)} placeholder="Optional" />
        </FieldLabel>
        <FieldLabel label="Description">
          <textarea className="control min-h-24 md:col-span-2" value={values.description} onChange={(event) => update("description", event.target.value)} placeholder="Optional asset details" />
        </FieldLabel>
        <div className="rounded-2xl border border-border bg-slate-50 p-3 md:col-span-2">
          <div className="text-xs font-black uppercase tracking-wide text-text-muted">Maintenance Workflow</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              ["inherit", `Inherit from category${selectedCategory ? selectedCategory.maintenance_enabled ? " (enabled)" : " (disabled)" : ""}`],
              ["enabled", "Enabled for this asset"],
              ["disabled", "Disabled for this asset"],
            ].map(([value, label]) => (
              <label key={value} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${values.maintenance_override === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-white text-text-secondary"}`}>
                <input type="radio" name="maintenance_override" checked={values.maintenance_override === value} onChange={() => update("maintenance_override", value)} />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs font-semibold text-text-secondary">Use maintenance for machines, electrical equipment, POS hardware, aircond, refrigerators, or assets that need repair/service history.</p>
        </div>
        </div>
      </div>
      {isEdit ? <p className="mt-3 text-xs font-semibold text-text-secondary">Use Adjust Quantity for stock changes so a movement log is created.</p> : null}
    </Modal>
  );
}

function AssetImportModal({ assets, outlets, categories, onClose, onImport }) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const validRows = preview.filter((row) => !row.errors.length);
  const failedRows = preview.filter((row) => row.errors.length);

  async function handleFile(file) {
    setError("");
    setComplete(null);
    setPreview([]);
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx"].includes(extension)) {
      setError("Please upload CSV or XLSX only.");
      return;
    }
    try {
      setFileName(file.name);
      const parsed = extension === "xlsx" ? await parseXlsx(file) : parseCsv(await file.text());
      setPreview(buildAssetImportPreview(parsed.rows, { assets, outlets, categories }));
    } catch (parseError) {
      setError(parseError.message || "Unable to parse import file.");
    }
  }

  function downloadTemplate() {
    const text = [
      assetImportColumns.join(","),
      ["Noodle Plate", "AST-PLATE-001", "FC", "Kitchenware", "20", "5", "Good", "Dry rack", "2026-05-30", "", "Active", "Standard noodle plate", ""].map(csvEscape).join(","),
    ].join("\n");
    downloadTextFile("feedx-asset-tracking-template.csv", text);
  }

  async function confirmImport() {
    setError("");
    setIsImporting(true);
    try {
      const result = await onImport(preview);
      setComplete(result);
    } catch (importError) {
      setError(importError.message || "Unable to import asset records.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Modal
      title="Import Assets"
      description="Upload CSV or XLSX, validate rows, preview changes, then import valid asset records."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-primary" type="button" disabled={!validRows.length || Boolean(complete) || isImporting} onClick={confirmImport}>{isImporting ? "Importing..." : "Confirm Import"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center transition hover:bg-primary/10">
            <UploadCloud size={22} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">{fileName || "Upload CSV or XLSX"}</span>
            <span className="type-caption text-text-secondary">Required: Asset Name, Outlet Code, Category, Quantity</span>
            <input className="sr-only" type="file" accept=".csv,.xlsx" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
          <button className="btn-secondary" type="button" onClick={downloadTemplate}><Download size={15} /> Download Template</button>
        </div>
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 type-body-sm font-semibold text-rose-700">{error}</div> : null}
        {preview.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Rows" value={preview.length} helper="Parsed from file" />
              <MetricCard label="Valid" value={validRows.length} helper="Ready to import" tone="success" />
              <MetricCard label="Failed" value={failedRows.length} helper="Can be skipped" tone={failedRows.length ? "danger" : "success"} />
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th>Asset Name</th>
                    <th>Outlet</th>
                    <th>Category</th>
                    <th>Quantity</th>
                    <th>Condition</th>
                    <th>Status</th>
                    <th>Action</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {preview.slice(0, 120).map((row) => (
                    <tr key={row.rowNumber} className={row.errors.length ? "bg-rose-50/60" : "bg-white"}>
                      <td className="px-3 py-2 font-mono text-xs">{row.rowNumber}</td>
                      <td className="font-bold text-text-primary">{row.display.assetName || "-"}</td>
                      <td>{row.display.outlet || "-"}</td>
                      <td>{row.display.category || "-"}</td>
                      <td>{row.display.quantity || "-"}</td>
                      <td>{row.display.condition || "-"}</td>
                      <td>{row.display.status || "-"}</td>
                      <td><Badge tone={row.action === "error" ? "danger" : row.action === "create" ? "success" : "info"}>{row.action === "error" ? "Error" : titleCase(row.action)}</Badge></td>
                      <td className={row.errors.length ? "text-rose-700" : "text-emerald-700"}>{row.errors.length ? row.errors.join("; ") : "Ready"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {complete ? (
              <div className={`rounded-2xl border p-3 type-body-sm font-semibold ${complete.failed ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                Import complete: {complete.created} created · {complete.updated} updated · {complete.skipped} skipped · {complete.failed} failed.
                {complete.failures?.length ? <div className="mt-1 font-medium">{complete.failures.slice(0, 4).map((failure) => `Row ${failure.rowNumber}: ${failure.message}`).join(" · ")}</div> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function CategoryModal({ categories, assets = [], onClose, onSave, onArchive, onReorder, saving, canWrite, canArchive }) {
  const defaultCategoryDraft = { name: "", description: "", sort_order: categories.length + 1, is_active: true, maintenance_enabled: false };
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id || "new");
  const [categoryDraft, setCategoryDraft] = useState(defaultCategoryDraft);
  const [orderedCategories, setOrderedCategories] = useState(categories);
  const [draggedCategoryId, setDraggedCategoryId] = useState("");
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const assetCountByCategory = useMemo(() => assets.reduce((map, asset) => {
    map.set(asset.category_id, (map.get(asset.category_id) || 0) + 1);
    return map;
  }, new Map()), [assets]);
  const presets = [
    { name: "Kitchen Equipment", description: "Maintainable kitchen equipment such as machines and electrical tools.", sort_order: categories.length + 1, maintenance_enabled: true },
    { name: "Electronics", description: "POS, electrical, and connected equipment.", sort_order: categories.length + 1, maintenance_enabled: true },
    { name: "Furniture", description: "Dining area furniture and fixtures.", sort_order: categories.length + 1, maintenance_enabled: false },
    { name: "Generic", description: "General outlet assets.", sort_order: categories.length + 1, maintenance_enabled: false },
  ];

  useEffect(() => {
    setOrderedCategories(categories);
  }, [categories]);

  useEffect(() => {
    if (selectedCategory) {
      setCategoryDraft({
        id: selectedCategory.id,
        name: selectedCategory.name || "",
        description: selectedCategory.description || "",
        sort_order: selectedCategory.sort_order ?? "",
        is_active: selectedCategory.is_active !== false,
        maintenance_enabled: selectedCategory.maintenance_enabled === true,
      });
      return;
    }
    setCategoryDraft(defaultCategoryDraft);
  }, [categories.length, selectedCategory]);

  function selectCategory(categoryId) {
    setSelectedCategoryId(categoryId);
  }

  async function saveCategoryDraft() {
    if (!categoryDraft.name.trim()) return;
    await onSave(categoryDraft);
    if (!categoryDraft.id) setSelectedCategoryId("new");
  }

  async function reorderCategory(targetCategoryId) {
    if (!draggedCategoryId || draggedCategoryId === targetCategoryId || !canWrite) return;
    const fromIndex = orderedCategories.findIndex((category) => category.id === draggedCategoryId);
    const toIndex = orderedCategories.findIndex((category) => category.id === targetCategoryId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...orderedCategories];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setOrderedCategories(next);
    setDraggedCategoryId("");
    await onReorder?.(next);
  }

  async function keyboardReorder(categoryId, direction) {
    const index = orderedCategories.findIndex((category) => category.id === categoryId);
    const nextIndex = index + direction;
    if (!canWrite || index < 0 || nextIndex < 0 || nextIndex >= orderedCategories.length) return;
    const next = [...orderedCategories];
    const [moved] = next.splice(index, 1);
    next.splice(nextIndex, 0, moved);
    setOrderedCategories(next);
    setSelectedCategoryId(categoryId);
    await onReorder?.(next);
  }

  return (
    <Modal title="Asset Category Configuration" description="Manage asset categories used to classify outlet assets." onClose={onClose} size="xl" bodyClassName="p-0">
      <div className="grid h-[min(760px,82vh)] overflow-hidden lg:grid-cols-[340px_1fr]">
        <aside className="sticky top-0 flex min-h-0 flex-col border-b border-border bg-slate-50/80 p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-text-muted">Category List</div>
              <div className="text-sm font-black text-text-primary">{categories.length} categories</div>
            </div>
            {canWrite ? (
              <button className="btn-primary h-9 px-3 text-xs" type="button" onClick={() => selectCategory("new")}>
                <Plus size={14} /> New
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {orderedCategories.map((category) => {
              const isSelected = selectedCategoryId === category.id;
              const assetCount = assetCountByCategory.get(category.id) || 0;
              return (
                <div
                  key={category.id}
                  className={`flex w-full items-center gap-2 rounded-2xl border px-2.5 py-2.5 text-left transition ${draggedCategoryId === category.id ? "scale-[1.01] border-primary/40 bg-white shadow-lg" : isSelected ? "border-primary/25 bg-primary/10 shadow-sm" : "border-transparent hover:border-border hover:bg-white"}`}
                  draggable={canWrite}
                  onDragStart={() => setDraggedCategoryId(category.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderCategory(category.id)}
                  onDragEnd={() => setDraggedCategoryId("")}
                >
                  <button className="cursor-grab rounded-lg px-1.5 py-2 text-text-muted hover:bg-slate-100" type="button" aria-label={`Reorder ${category.name}`} disabled={!canWrite}>⋮⋮</button>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[11px] font-black text-primary shadow-sm">{categoryIcon(category.name)}</span>
                  <button className="min-w-0 flex-1 text-left" type="button" onClick={() => selectCategory(category.id)}>
                    <span className="block whitespace-normal text-sm font-black leading-snug text-text-primary">{category.name}</span>
                    <span className="block text-xs font-semibold text-text-secondary">{assetCount} linked assets</span>
                  </button>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={category.is_active ? "success" : "neutral"}>{category.is_active ? "Active" : "Archived"}</Badge>
                    {category.maintenance_enabled ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">Maintenance</span> : null}
                    <span className="flex gap-0.5">
                      <button className="rounded-md px-1 text-[10px] font-black text-text-muted hover:bg-white hover:text-primary" type="button" disabled={!canWrite} onClick={() => keyboardReorder(category.id, -1)}>↑</button>
                      <button className="rounded-md px-1 text-[10px] font-black text-text-muted hover:bg-white hover:text-primary" type="button" disabled={!canWrite} onClick={() => keyboardReorder(category.id, 1)}>↓</button>
                    </span>
                  </span>
                </div>
              );
            })}
            {!categories.length ? <div className="rounded-2xl border border-dashed border-border bg-white p-4 text-sm font-semibold text-text-secondary">Create the first category to start classifying assets.</div> : null}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-white">
          <div className="sticky top-0 z-10 border-b border-border bg-white/95 p-5 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xs font-black text-primary">{categoryIcon(categoryDraft.name || selectedCategory?.name)}</span>
                  <div>
                    <h3 className="text-lg font-black text-text-primary">{selectedCategory ? selectedCategory.name : "New Category"}</h3>
                    <p className="text-sm text-text-secondary">{selectedCategory?.description || "Configure category details and maintenance scope."}</p>
                  </div>
                </div>
              </div>
              {selectedCategory ? (
                <div className="flex items-center gap-2">
                  <Badge tone={selectedCategory.is_active ? "success" : "neutral"}>{selectedCategory.is_active ? "Active" : "Archived"}</Badge>
                  <Badge tone="info">{assetCountByCategory.get(selectedCategory.id) || 0} assets</Badge>
                </div>
              ) : null}
            </div>
            <div className="mt-4 rounded-2xl border border-border bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">
              Categories classify assets. Maintenance is optional and only appears for assets under maintenance-enabled categories.
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-24">
            <div className="space-y-4">
              <div className="rounded-3xl border border-border bg-slate-50/70 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-text-primary">Category Details</div>
                      <div className="text-xs text-text-secondary">Keep this short and easy for outlet teams to scan.</div>
                    </div>
                    {selectedCategory ? <Badge tone="info">{assetCountByCategory.get(selectedCategory.id) || 0} linked assets</Badge> : null}
                  </div>
                  {!selectedCategory ? (
                    <div className="mb-4 rounded-2xl border border-border bg-white p-3">
                      <div className="text-xs font-black uppercase tracking-wide text-text-muted">Quick Preset</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {presets.map((preset) => (
                          <button key={preset.name} className="rounded-2xl border border-border bg-white p-3 text-left transition hover:border-primary/30 hover:bg-primary/5" type="button" onClick={() => setCategoryDraft((current) => ({ ...current, ...preset, is_active: true }))}>
                            <span className="block text-sm font-black text-text-primary">{preset.name}</span>
                            <span className="mt-1 block text-xs text-text-secondary">{preset.description}</span>
                            <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-black ${preset.maintenance_enabled ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                              {preset.maintenance_enabled ? "Maintenance enabled" : "No maintenance workflow"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-2">
                    <FieldLabel label="Category Name">
                      <input className="control" value={categoryDraft.name} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Kitchen Equipment" disabled={!canWrite} />
                    </FieldLabel>
                    <FieldLabel label="Status">
                      <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-bold text-text-secondary">
                        <input type="checkbox" checked={categoryDraft.is_active} onChange={(event) => setCategoryDraft((current) => ({ ...current, is_active: event.target.checked }))} disabled={!canWrite} />
                        Active category
                      </label>
                    </FieldLabel>
                    <FieldLabel label="Description">
                      <textarea className="control min-h-24 md:col-span-2" value={categoryDraft.description} onChange={(event) => setCategoryDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Optional category description" disabled={!canWrite} />
                    </FieldLabel>
                  </div>
              </div>

              <div className="rounded-3xl border border-border bg-white p-4 shadow-sm">
                <div className="text-sm font-black text-text-primary">Maintenance Setting</div>
                <label className="mt-3 flex items-start gap-3 rounded-2xl border border-border bg-slate-50 px-4 py-3 text-sm text-text-secondary">
                  <input className="mt-1" type="checkbox" checked={categoryDraft.maintenance_enabled === true} onChange={(event) => setCategoryDraft((current) => ({ ...current, maintenance_enabled: event.target.checked }))} disabled={!canWrite} />
                  <span>
                    <span className="block font-black text-text-primary">Enable maintenance workflow for this category</span>
                    <span className="mt-1 block text-xs font-semibold">Use for machines, electrical equipment, POS hardware, aircond, refrigerators, or assets that need repair/service history.</span>
                  </span>
                </label>
              </div>

              {selectedCategory ? <div className="rounded-3xl border border-border bg-white p-4 shadow-sm">
                <div className="text-sm font-black text-text-primary">Category History</div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs font-black uppercase tracking-wide text-text-muted">Created</div>
                    <div className="mt-1 text-sm font-bold text-text-primary">{formatFullDate(selectedCategory.created_at)}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs font-black uppercase tracking-wide text-text-muted">Last Updated</div>
                    <div className="mt-1 text-sm font-bold text-text-primary">{formatFullDate(selectedCategory.updated_at)}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs font-black uppercase tracking-wide text-text-muted">Linked Assets</div>
                    <div className="mt-1 text-sm font-bold text-text-primary">{assetCountByCategory.get(selectedCategory.id) || 0}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs font-black uppercase tracking-wide text-text-muted">Status</div>
                    <div className="mt-1 text-sm font-bold text-text-primary">{selectedCategory.is_active ? "Active" : "Archived"}</div>
                  </div>
                </div>
              </div> : null}
            </div>
          </div>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white/95 p-4 backdrop-blur">
            <div className="text-xs font-semibold text-text-secondary">
              {selectedCategory ? `Linked to ${assetCountByCategory.get(selectedCategory.id) || 0} assets. Archiving hides it from new assets; existing assets remain linked.` : "New categories become available after saving."}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedCategory?.is_active && canArchive ? <button className="btn-secondary text-amber-700" type="button" disabled={saving} onClick={() => {
                const linked = assetCountByCategory.get(selectedCategory.id) || 0;
                if (linked && !window.confirm(`This category has ${linked} linked assets. Archiving will hide it from new assets but existing assets remain linked.`)) return;
                onArchive(selectedCategory);
              }}>Archive Category</button> : null}
              <button className="btn-primary" type="button" disabled={!canWrite || saving || !categoryDraft.name.trim()} onClick={saveCategoryDraft}>
                {categoryDraft.id ? "Save Category" : "Create Category"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function AdjustQuantityModal({ asset, onClose, onSubmit, saving }) {
  const [values, setValues] = useState({ type: "add", quantity: 1, reason: "", remark: "", date: new Date().toISOString().slice(0, 10) });
  const requiresReason = values.type === "reduce";
  const invalid = Number(values.quantity || 0) <= 0 || (requiresReason && !values.reason) || (values.reason === "other" && !values.remark.trim());
  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  return (
    <Modal
      title="Adjust Quantity"
      description={`${asset.name} · Current quantity ${asset.current_quantity} ${asset.unit}`}
      onClose={onClose}
      size="md"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={saving || invalid} onClick={() => onSubmit(values)}>Confirm Adjustment</button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FieldLabel label="Adjustment Type">
          <SelectField value={values.type} options={["add", "reduce", "correction"].map((type) => ({ value: type, label: titleCase(type) }))} onChange={(value) => update("type", value)} />
        </FieldLabel>
        <FieldLabel label="Quantity">
          <input className="control" type="number" min="1" value={values.quantity} onChange={(event) => update("quantity", event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Reason">
          <SelectField value={values.reason} placeholder={requiresReason ? "Required" : "Optional"} options={reduceReasons.map((reason) => ({ value: reason, label: titleCase(reason) }))} onChange={(value) => update("reason", value)} />
        </FieldLabel>
        <DatePickerField label="Date" value={values.date} onChange={(value) => update("date", value)} />
        <FieldLabel label="Remark">
          <textarea className="control min-h-24 md:col-span-2" value={values.remark} onChange={(event) => update("remark", event.target.value)} placeholder={values.reason === "other" ? "Required for Other" : "Optional"} />
        </FieldLabel>
      </div>
    </Modal>
  );
}

function MaintenanceRecordModal({ asset, record, onClose, onSubmit, saving }) {
  const [values, setValues] = useState({
    id: record?.id || "",
    date: record?.date || new Date().toISOString().slice(0, 10),
    scheduled_date: record?.scheduled_date || (record?.status === "completed" ? "" : new Date().toISOString().slice(0, 10)),
    completed_date: record?.completed_date || (record?.status === "completed" ? new Date().toISOString().slice(0, 10) : ""),
    next_service_date: record?.next_service_date || "",
    maintenance_type: record?.maintenance_type || "repair",
    priority: record?.priority || "medium",
    issue: record?.issue || "",
    action_taken: record?.action_taken || "",
    vendor: record?.vendor || "",
    cost: record?.cost ? String(record.cost) : "",
    status: maintenanceStatuses.includes(record?.status) ? record.status : "scheduled",
    remark: record?.remark || "",
    photo_url: record?.photo_url || "",
    set_condition_good: false,
  });
  const [photoError, setPhotoError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const showPriority = values.status !== "completed";
  const showScheduledDate = values.status !== "completed";
  const showCompletedDate = values.status === "completed";
  const showNextServiceDate = values.status === "completed";
  const showActionTaken = values.status !== "scheduled";
  const costLabel = values.status === "completed" ? "Final Cost" : values.status === "in_progress" ? "Current Cost" : "Estimated Cost";
  const ctaLabel = values.status === "completed" ? "Complete Maintenance" : values.status === "in_progress" ? "Update Progress" : "Save Scheduled Record";
  const invalid = !values.issue.trim() ||
    !values.maintenance_type ||
    (showActionTaken && !values.action_taken.trim()) ||
    (showScheduledDate && !values.scheduled_date) ||
    (showCompletedDate && !values.completed_date);

  function update(key, value) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === "status") {
        if (value === "completed") {
          next.scheduled_date = "";
          next.priority = current.priority || "medium";
          next.completed_date = current.completed_date || new Date().toISOString().slice(0, 10);
        } else {
          next.completed_date = "";
          next.next_service_date = "";
          next.scheduled_date = current.scheduled_date || new Date().toISOString().slice(0, 10);
        }
      }
      return next;
    });
  }

  async function handlePhoto(file) {
    setPhotoError("");
    if (!file) return;
    try {
      const optimized = await optimizeImageFileForPreview(file);
      update("photo_url", optimized.dataUrl);
      update("previous_photo_url", record?.photo_url || "");
    } catch (error) {
      setPhotoError(error.message || "Unable to read this image.");
    }
  }

  return (
    <Modal
      title={record ? "Edit Maintenance Record" : "Add Maintenance Record"}
      description={`${asset.name} · ${asset.category_name}`}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={saving || invalid} onClick={() => onSubmit(values)}>{ctaLabel}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-slate-50 p-3">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-text-muted">Maintenance Status</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {maintenanceStatuses.map((status) => (
              <button
                key={status}
                type="button"
                className={`rounded-2xl border px-3 py-2 text-left transition ${values.status === status ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-white text-text-secondary hover:border-primary/20"}`}
                onClick={() => update("status", status)}
              >
                <div className="text-sm font-black">{maintenanceStatusLabel(status)}</div>
                <div className="mt-0.5 text-[11px] font-semibold opacity-75">
                  {status === "scheduled" ? "Plan service work" : status === "in_progress" ? "Track active repair" : "Record completed work"}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <FieldLabel label="Maintenance Type">
            <SelectField value={values.maintenance_type} options={maintenanceTypes.map((type) => ({ value: type, label: maintenanceTypeLabel(type) }))} onChange={(value) => update("maintenance_type", value)} />
          </FieldLabel>
          {showPriority ? (
            <FieldLabel label="Priority">
              <SelectField value={values.priority} options={maintenancePriorities.map((priority) => ({ value: priority, label: titleCase(priority) }))} onChange={(value) => update("priority", value)} />
            </FieldLabel>
          ) : null}
          <FieldLabel label="Issue / Problem">
            <input className="control" value={values.issue} onChange={(event) => update("issue", event.target.value)} placeholder="Compressor noise, leaking pipe..." />
          </FieldLabel>
          <FieldLabel label="Vendor / Technician">
            <input className="control" value={values.vendor} onChange={(event) => update("vendor", event.target.value)} placeholder="Optional" />
          </FieldLabel>
          {showActionTaken ? (
            <FieldLabel label="Action Taken">
              <textarea className="control min-h-24 md:col-span-2" value={values.action_taken} onChange={(event) => update("action_taken", event.target.value)} placeholder={values.status === "completed" ? "Repair or service work performed" : "Current progress or temporary fix"} />
            </FieldLabel>
          ) : null}
          <FieldLabel label={costLabel}>
            <input className="control" type="number" min="0" step="0.01" value={values.cost} onChange={(event) => update("cost", event.target.value)} placeholder="0.00" />
          </FieldLabel>
          {showScheduledDate ? (
            <DatePickerField label="Scheduled Date" value={values.scheduled_date} onChange={(value) => update("scheduled_date", value)} />
          ) : null}
          {showCompletedDate ? (
            <DatePickerField label="Completed Date" value={values.completed_date} onChange={(value) => update("completed_date", value)} />
          ) : null}
          {showNextServiceDate ? (
            <DatePickerField label="Next Service Date" value={values.next_service_date} onChange={(value) => update("next_service_date", value)} />
          ) : null}
        <FieldLabel label="Photo Evidence">
          <div className="flex items-center gap-3">
            <label className="btn-secondary h-10 cursor-pointer px-3 text-xs">
              <UploadCloud size={14} /> Upload Photo
              <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handlePhoto(event.target.files?.[0])} />
            </label>
            {values.photo_url ? (
              <button className="relative h-12 w-12 overflow-hidden rounded-xl border border-border" type="button" onClick={() => setPreviewOpen(true)}>
                <img className="h-full w-full object-cover" src={values.photo_url} alt="Maintenance evidence preview" />
              </button>
            ) : null}
          </div>
          {values.photo_url ? <button className="mt-2 text-xs font-bold text-text-muted hover:text-rose-600" type="button" onClick={() => { update("previous_photo_url", record?.photo_url || ""); update("photo_url", ""); }}>Remove photo</button> : null}
          {photoError ? <div className="mt-1 text-xs font-semibold text-rose-600">{photoError}</div> : null}
        </FieldLabel>
          {values.status === "in_progress" ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 md:col-span-2">Saving as In Progress will set this asset condition to Under Maintenance.</div>
          ) : null}
          {values.status === "completed" ? (
            <label className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 md:col-span-2">
              <input type="checkbox" checked={values.set_condition_good} onChange={(event) => update("set_condition_good", event.target.checked)} />
              Set asset condition back to Good after completion
            </label>
          ) : null}
          <FieldLabel label="Remark">
            <textarea className="control min-h-20 md:col-span-2" value={values.remark} onChange={(event) => update("remark", event.target.value)} placeholder="Optional follow-up notes" />
          </FieldLabel>
        </div>
      </div>
      {previewOpen && values.photo_url ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
          <button className="absolute inset-0" type="button" aria-label="Close preview" onClick={() => setPreviewOpen(false)} />
          <img className="relative max-h-[82vh] max-w-[86vw] rounded-3xl object-contain shadow-2xl" src={values.photo_url} alt="Maintenance evidence preview" />
          <button className="absolute right-5 top-5 rounded-full bg-white p-2 text-slate-700 shadow-xl" type="button" onClick={() => setPreviewOpen(false)}><X size={18} /></button>
        </div>
      ) : null}
    </Modal>
  );
}

function MaintenanceRecordEditorPanel({ asset, record, onBack, onSubmit, saving }) {
  const [values, setValues] = useState({
    id: record?.id || "",
    date: record?.date || new Date().toISOString().slice(0, 10),
    scheduled_date: record?.scheduled_date || (record?.status === "completed" ? "" : new Date().toISOString().slice(0, 10)),
    completed_date: record?.completed_date || (record?.status === "completed" ? new Date().toISOString().slice(0, 10) : ""),
    next_service_date: record?.next_service_date || "",
    maintenance_type: record?.maintenance_type || "repair",
    priority: record?.priority || "medium",
    issue: record?.issue || "",
    action_taken: record?.action_taken || "",
    vendor: record?.vendor || "",
    cost: record?.cost ? String(record.cost) : "",
    status: maintenanceStatuses.includes(record?.status) ? record.status : "scheduled",
    remark: record?.remark || "",
    photo_url: record?.photo_url || "",
    set_condition_good: false,
  });
  const [photoError, setPhotoError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const showPriority = values.status !== "completed";
  const showScheduledDate = values.status !== "completed";
  const showCompletedDate = values.status === "completed";
  const showNextServiceDate = values.status === "completed";
  const showActionTaken = values.status !== "scheduled";
  const costLabel = values.status === "completed" ? "Final Cost" : values.status === "in_progress" ? "Current Cost" : "Estimated Cost";
  const ctaLabel = values.status === "completed" ? "Complete Maintenance" : values.status === "in_progress" ? "Update Progress" : "Save Scheduled Record";
  const invalid = !values.issue.trim() ||
    !values.maintenance_type ||
    (showActionTaken && !values.action_taken.trim()) ||
    (showScheduledDate && !values.scheduled_date) ||
    (showCompletedDate && !values.completed_date);

  function update(key, value) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === "status") {
        if (value === "completed") {
          next.scheduled_date = "";
          next.completed_date = current.completed_date || new Date().toISOString().slice(0, 10);
        } else {
          next.completed_date = "";
          next.next_service_date = "";
          next.scheduled_date = current.scheduled_date || new Date().toISOString().slice(0, 10);
        }
      }
      return next;
    });
  }

  async function handlePhoto(file) {
    setPhotoError("");
    if (!file) return;
    try {
      const optimized = await optimizeImageFileForPreview(file);
      update("photo_url", optimized.dataUrl);
      update("previous_photo_url", record?.photo_url || "");
    } catch (error) {
      setPhotoError(error.message || "Unable to read this image.");
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 border-b border-border bg-white/95 p-5 backdrop-blur">
        <button className="mb-3 text-xs font-black text-primary hover:text-primary/80" type="button" onClick={onBack}>← Back to Maintenance History</button>
        <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">{record ? "Edit Maintenance Record" : "Add Maintenance Record"}</div>
        <h2 className="mt-1 text-2xl font-semibold text-text-primary">{record ? "Update maintenance details" : "Add Maintenance Record"}</h2>
        <p className="mt-1 text-sm font-semibold text-text-secondary">{asset.name} · {asset.category_name}</p>
      </div>

      <div className="flex-1 space-y-4 p-5">
        <div className="rounded-2xl border border-border bg-slate-50 p-3">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-text-muted">Maintenance Status</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {maintenanceStatuses.map((status) => (
              <button
                key={status}
                type="button"
                className={`rounded-2xl border px-3 py-2 text-left transition ${values.status === status ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-white text-text-secondary hover:border-primary/20"}`}
                onClick={() => update("status", status)}
              >
                <div className="text-sm font-black">{maintenanceStatusLabel(status)}</div>
                <div className="mt-0.5 text-[11px] font-semibold opacity-75">
                  {status === "scheduled" ? "Plan service work" : status === "in_progress" ? "Track active repair" : "Record completed work"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <FieldLabel label="Maintenance Type">
            <SelectField value={values.maintenance_type} options={maintenanceTypes.map((type) => ({ value: type, label: maintenanceTypeLabel(type) }))} onChange={(value) => update("maintenance_type", value)} />
          </FieldLabel>
          {showPriority ? (
            <FieldLabel label="Priority">
              <SelectField value={values.priority} options={maintenancePriorities.map((priority) => ({ value: priority, label: titleCase(priority) }))} onChange={(value) => update("priority", value)} />
            </FieldLabel>
          ) : null}
          <FieldLabel label="Issue / Problem">
            <input className="control" value={values.issue} onChange={(event) => update("issue", event.target.value)} placeholder="Compressor noise, leaking pipe..." />
          </FieldLabel>
          <FieldLabel label="Vendor / Technician">
            <input className="control" value={values.vendor} onChange={(event) => update("vendor", event.target.value)} placeholder="Optional" />
          </FieldLabel>
          {showActionTaken ? (
            <FieldLabel label="Action Taken">
              <textarea className="control min-h-24 md:col-span-2" value={values.action_taken} onChange={(event) => update("action_taken", event.target.value)} placeholder={values.status === "completed" ? "Repair or service work performed" : "Current progress or temporary fix"} />
            </FieldLabel>
          ) : null}
          <FieldLabel label={costLabel}>
            <input className="control" type="number" min="0" step="0.01" value={values.cost} onChange={(event) => update("cost", event.target.value)} placeholder="0.00" />
          </FieldLabel>
          {showScheduledDate ? (
            <DatePickerField label="Scheduled Date" value={values.scheduled_date} onChange={(value) => update("scheduled_date", value)} />
          ) : null}
          {showCompletedDate ? (
            <DatePickerField label="Completed Date" value={values.completed_date} onChange={(value) => update("completed_date", value)} />
          ) : null}
          {showNextServiceDate ? (
            <DatePickerField label="Next Service Date" value={values.next_service_date} onChange={(value) => update("next_service_date", value)} />
          ) : null}
          <FieldLabel label="Photo Evidence">
            <div className="flex items-center gap-3">
              <label className="btn-secondary h-10 cursor-pointer px-3 text-xs">
                <UploadCloud size={14} /> Upload Photo
                <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handlePhoto(event.target.files?.[0])} />
              </label>
              {values.photo_url ? (
                <button className="relative h-12 w-12 overflow-hidden rounded-xl border border-border" type="button" onClick={() => setPreviewOpen(true)}>
                  <img className="h-full w-full object-cover" src={values.photo_url} alt="Maintenance evidence preview" />
                </button>
              ) : null}
            </div>
            {values.photo_url ? <button className="mt-2 text-xs font-bold text-text-muted hover:text-rose-600" type="button" onClick={() => { update("previous_photo_url", record?.photo_url || ""); update("photo_url", ""); }}>Remove photo</button> : null}
            {photoError ? <div className="mt-1 text-xs font-semibold text-rose-600">{photoError}</div> : null}
          </FieldLabel>
          {values.status === "in_progress" ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 md:col-span-2">Saving as In Progress will set this asset condition to Under Maintenance.</div>
          ) : null}
          {values.status === "completed" ? (
            <label className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 md:col-span-2">
              <input type="checkbox" checked={values.set_condition_good} onChange={(event) => update("set_condition_good", event.target.checked)} />
              Set asset condition back to Good after completion
            </label>
          ) : null}
          <FieldLabel label="Remark">
            <textarea className="control min-h-20 md:col-span-2" value={values.remark} onChange={(event) => update("remark", event.target.value)} placeholder="Optional follow-up notes" />
          </FieldLabel>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 flex justify-end gap-2 border-t border-border bg-slate-50 p-4">
        <button className="btn-secondary" type="button" onClick={onBack}>Cancel</button>
        <button className="btn-primary" type="button" disabled={saving || invalid} onClick={() => onSubmit(values)}>{ctaLabel}</button>
      </div>

      {previewOpen && values.photo_url ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
          <button className="absolute inset-0" type="button" aria-label="Close preview" onClick={() => setPreviewOpen(false)} />
          <img className="relative max-h-[82vh] max-w-[86vw] rounded-3xl object-contain shadow-2xl" src={values.photo_url} alt="Maintenance evidence preview" />
          <button className="absolute right-5 top-5 rounded-full bg-white p-2 text-slate-700 shadow-xl" type="button" onClick={() => setPreviewOpen(false)}><X size={18} /></button>
        </div>
      ) : null}
    </div>
  );
}

function MaintenanceRecordViewPanel({ asset, record, onBack, onEdit, onUpdateStatus }) {
  const [dateLabel, dateValue] = maintenanceStatusDateLabel(record);
  const photoLabel = record.photo_url ? "1 photo uploaded" : "No photo";
  const costLabel = `RM ${Number(record.cost || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const detailRows = [
    ["Issue", record.issue || "No issue recorded"],
    ["Action Taken", record.action_taken || "No action recorded"],
    ["Vendor", record.vendor || "No vendor"],
    [dateLabel, record.status === "completed" ? <DateText value={dateValue} /> : <DateText value={dateValue} />],
    ["Next Service", record.next_service_date ? <DateText value={record.next_service_date} /> : "No date set"],
    ["Photo", photoLabel],
  ];

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 border-b border-border bg-white/95 p-5 backdrop-blur">
        <button className="mb-3 text-xs font-black text-primary hover:text-primary/80" type="button" onClick={onBack}>← Back to Maintenance History</button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Maintenance Record</div>
            <h2 className="mt-1 text-2xl font-semibold text-text-primary">{maintenanceTypeLabel(record.maintenance_type)}</h2>
            <p className="mt-1 text-sm font-semibold text-text-secondary">{asset.name} · {asset.category_name}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={maintenanceStatusTone(record.status)}>{maintenanceStatusLabel(record.status)}</Badge>
            {record.status !== "completed" ? <Badge tone={priorityTone(record.priority)}>{titleCase(record.priority)}</Badge> : null}
            <div className="text-sm font-black text-text-primary">{costLabel}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 p-5">
        <div className="rounded-3xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-wide text-text-muted">Lifecycle</div>
              <div className="mt-1 text-sm font-bold text-text-primary">{maintenanceStatusLabel(record.status)} · {costLabel}</div>
            </div>
          </div>
          <LifecycleProgress status={record.status} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {detailRows.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border bg-white p-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">{label}</div>
              <div className="mt-1 text-sm font-bold text-text-primary">{value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border-l-4 border-primary/30 bg-slate-50 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Operational Note</div>
          <div className="mt-1 text-sm font-semibold text-text-secondary">{record.remark || "No remark recorded."}</div>
        </div>

        {record.photo_url ? (
          <div className="rounded-3xl border border-border bg-white p-3 shadow-sm">
            <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-text-muted">Photo Evidence</div>
            <img className="max-h-72 w-full rounded-2xl object-cover" src={record.photo_url} alt="Maintenance evidence" />
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 z-20 flex justify-end gap-2 border-t border-border bg-slate-50 p-4">
        <button className="btn-secondary" type="button" onClick={onEdit}>Edit</button>
        {record.status !== "completed" ? <button className="btn-primary" type="button" onClick={onUpdateStatus}>Update Status</button> : null}
      </div>
    </div>
  );
}

function evidenceRecommended(row) {
  const diff = inspectionRowDifference(row);
  return diff !== 0 || (row.condition_status || "healthy") !== "healthy";
}

function DifferenceBadge({ diff }) {
  if (diff === 0) return <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Matched</span>;
  if (diff > 0) return <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">+{diff} Extra</span>;
  return <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">{Math.abs(diff)} Missing</span>;
}

async function readEvidenceFiles(files, onDone, onError) {
  for (const file of Array.from(files || [])) {
    try {
      const optimized = await optimizeImageFileForPreview(file);
      onDone({ image_url: optimized.dataUrl, caption: file.name });
    } catch (error) {
      onError?.(error.message || "Unable to read image.");
    }
  }
}

function safeInspectionAsset(row) {
  const asset = row?.asset ?? {};
  return {
    id: asset.id ?? row?.asset_id ?? "",
    name: asset.name ?? "Unknown Asset",
    description: asset.description ?? "",
    category_id: asset.category_id ?? asset.category?.id ?? null,
    category_name: asset.category_name ?? asset.category?.name ?? "Uncategorized",
    current_quantity: Number(asset.current_quantity ?? row?.expected_quantity ?? row?.expected_qty ?? 0),
    minimum_quantity: Number(asset.minimum_quantity ?? 0),
    unit: asset.unit ?? "unit",
    condition: normalizeAssetCondition(asset.condition ?? row?.condition_status ?? row?.condition ?? "healthy"),
    thumbnail_url: asset.thumbnail_url ?? asset.image_url ?? "",
    image_url: asset.image_url ?? "",
  };
}

function inspectionRowAssetId(row) {
  return safeInspectionAsset(row).id;
}

function inspectionRowDifference(row) {
  const asset = safeInspectionAsset(row);
  return Number(row?.counted_quantity || 0) - Number(asset.current_quantity || 0);
}

function createInspectionChecklistRow(asset, draftRow = {}) {
  const safeAsset = safeInspectionAsset({ asset, ...draftRow });
  return {
    asset: safeAsset,
    asset_id: safeAsset.id,
    counted_quantity: draftRow.counted_quantity ?? safeAsset.current_quantity,
    condition_status: normalizeAssetCondition(draftRow.condition_status || safeAsset.condition || "healthy"),
    evidence: draftRow.evidence || [],
    remark: draftRow.remark || "",
    skipped: draftRow.skipped === true,
  };
}

function normalizeInspectionType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    routine_audit: "routine_check",
    routine: "routine_check",
    maintenance_review: "maintenance_verification",
    maintenance: "maintenance_verification",
    incident: "incident_follow_up",
  };
  return inspectionTypeOptions.some((option) => option.value === normalized) ? normalized : aliases[normalized] || "routine_check";
}

function inspectionTypeLabel(value) {
  return inspectionTypeOptions.find((option) => option.value === normalizeInspectionType(value))?.label || "Routine Check";
}

function isSuggestedForInspectionType(asset, type) {
  const inspectionType = normalizeInspectionType(type);
  const condition = normalizeAssetCondition(asset.condition);
  if (inspectionType === "spot_check") return false;
  if (inspectionType === "maintenance_verification") {
    return asset.maintenance_allowed || asset.maintenance_override === "enabled" || condition === "under_maintenance" || condition === "damaged" || condition === "needs_attention";
  }
  if (inspectionType === "incident_follow_up") {
    return ["needs_attention", "under_maintenance", "low_quantity", "damaged", "missing"].includes(condition) || Number(asset.current_quantity || 0) <= 0;
  }
  return condition !== "disposed";
}

function presetAssetsForInspectionType(scopedAssets, type) {
  const inspectionType = normalizeInspectionType(type);
  const activeScopedAssets = scopedAssets.filter((asset) => normalizeAssetCondition(asset.condition) !== "disposed");
  if (inspectionType === "spot_check") return [];
  if (inspectionType === "maintenance_verification") {
    return activeScopedAssets.filter((asset) => isSuggestedForInspectionType(asset, inspectionType));
  }
  if (inspectionType === "incident_follow_up") {
    return activeScopedAssets.filter((asset) => isSuggestedForInspectionType(asset, inspectionType));
  }
  return activeScopedAssets;
}

function InspectionModal({ outletId, categories, assets, draftInspection, defaultCheckedBy = "", defaultCheckedById = "", onClose, onSubmit, saving }) {
  const draftData = draftInspection?.draft_data || {};
  const initialStep = Math.min(3, Math.max(1, Number(draftInspection?.current_step || draftData.currentStep || 1)));
  const [step, setStep] = useState(initialStep);
  const [inspectionType, setInspectionType] = useState(normalizeInspectionType(draftData.inspectionType || draftInspection?.summary?.inspection_type || "routine_check"));
  const [scopeType, setScopeType] = useState(draftData.scopeType || draftInspection?.category_scope?.type || "all");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState(draftData.selectedCategoryIds || draftInspection?.category_scope?.category_ids || []);
  const checkedBy = defaultCheckedBy || draftData.checkedBy || draftInspection?.checked_by || "";
  const checkedByEmployeeId = defaultCheckedById || draftData.checkedByEmployeeId || draftInspection?.checked_by_employee_id || null;
  const [inspectionDate, setInspectionDate] = useState(draftData.inspectionDate || draftInspection?.inspection_date || new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(draftData.notes || draftInspection?.notes || "");
  const [lightbox, setLightbox] = useState(null);
  const [evidenceError, setEvidenceError] = useState("");
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerQuery, setAssetPickerQuery] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const scopedAssets = useMemo(() => assets.filter((asset) => asset.outlet_id === outletId && (scopeType === "all" || selectedCategoryIds.includes(asset.category_id))), [assets, outletId, scopeType, selectedCategoryIds]);
  const outletAssets = useMemo(() => assets.filter((asset) => asset.outlet_id === outletId && asset.status !== "archived"), [assets, outletId]);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const draftRows = new Map((draftData.rows || []).map((row) => [row.asset_id, row]));
    const sourceAssets = draftRows.size
      ? outletAssets.filter((asset) => draftRows.has(asset.id))
      : presetAssetsForInspectionType(scopedAssets, inspectionType);
    const restoredRows = sourceAssets.map((asset) => {
      const draftRow = draftRows.get(asset.id);
      return createInspectionChecklistRow(asset, draftRow);
    });
    const missingAssetRows = Array.from(draftRows.values())
      .filter((row) => row.asset_id && !sourceAssets.some((asset) => asset.id === row.asset_id))
      .map((row) => createInspectionChecklistRow(null, row));
    setRows([...restoredRows, ...missingAssetRows]);
  }, [scopedAssets, outletAssets, inspectionType, draftInspection?.id]);

  const enrichedRows = rows.map((row) => {
    const asset = safeInspectionAsset(row);
    const diff = inspectionRowDifference(row);
    const needsEvidence = evidenceRecommended(row);
    const evidenceComplete = !needsEvidence || ((row.evidence || []).length > 0 || row.remark.trim());
    return { ...row, asset, asset_id: asset.id, diff, needsEvidence, evidenceComplete };
  });
  const activeRows = enrichedRows.filter((row) => !row.skipped);
  const skippedRows = enrichedRows.filter((row) => row.skipped);
  const missingRows = activeRows.filter((row) => row.diff < 0 || row.condition_status === "missing");
  const extraRows = activeRows.filter((row) => row.diff > 0);
  const damagedRows = activeRows.filter((row) => row.condition_status === "damaged");
  const warningRows = activeRows.filter((row) => ["needs_attention", "low_quantity", "under_maintenance"].includes(row.condition_status));
  const pendingEvidenceRows = activeRows.filter((row) => row.needsEvidence && !row.evidenceComplete);
  const matchedRows = activeRows.filter((row) => row.diff === 0 && row.condition_status === "healthy");
  const criticalRows = activeRows.filter((row) => ["damaged", "missing"].includes(row.condition_status));
  const isIssueRow = (row) => row.skipped || row.diff !== 0 || row.condition_status !== "healthy" || !row.evidenceComplete;
  const issueRows = enrichedRows.filter(isIssueRow);
  const reviewRows = [...enrichedRows].sort((first, second) => Number(isIssueRow(second)) - Number(isIssueRow(first)) || String(safeInspectionAsset(first).name).localeCompare(String(safeInspectionAsset(second).name)));
  const checkedRows = activeRows.filter((row) => row.counted_quantity !== "" && row.counted_quantity !== null && row.counted_quantity !== undefined);
  const completedRows = [...checkedRows, ...skippedRows];
  const remainingRows = Math.max(0, rows.length - completedRows.length);
  const progressPercentage = rows.length ? Math.round((completedRows.length / rows.length) * 100) : 0;
  const categoryScope = scopeType === "all"
    ? { type: "all", category_ids: [] }
    : { type: "selected", category_ids: selectedCategoryIds };
  const availableAssets = useMemo(() => {
    const rowAssetIds = new Set(rows.map((row) => inspectionRowAssetId(row)).filter(Boolean));
    const search = assetPickerQuery.trim().toLowerCase();
    return outletAssets
      .filter((asset) => !rowAssetIds.has(asset.id))
      .filter((asset) => {
        if (!search) return true;
        return [asset.name, asset.category_name, asset.description].some((value) => String(value || "").toLowerCase().includes(search));
      })
      .sort((first, second) => Number(isSuggestedForInspectionType(second, inspectionType)) - Number(isSuggestedForInspectionType(first, inspectionType)))
      .slice(0, 30);
  }, [assetPickerQuery, inspectionType, outletAssets, rows]);
  const summary = {
    total_assets: rows.length,
    checked_assets: checkedRows.length,
    completion_percentage: progressPercentage,
    skipped_items: skippedRows.length,
    matched_assets: matchedRows.length,
    missing_assets: missingRows.length,
    extra_assets: extraRows.length,
    damaged_assets: damagedRows.length,
    critical_alerts: criticalRows.length,
    warning_alerts: warningRows.length,
    pending_evidence: pendingEvidenceRows.length,
    inspection_type: inspectionType,
    inspection_type_label: inspectionTypeLabel(inspectionType),
    preset_behavior: inspectionType === "spot_check" ? "manual_selection" : "preset_suggestions",
  };

  function updateRow(assetId, key, value) {
    setRows((current) => current.map((row) => (inspectionRowAssetId(row) === assetId ? { ...row, [key]: value } : row)));
  }

  function removeRow(assetId) {
    setRows((current) => current.filter((row) => inspectionRowAssetId(row) !== assetId));
  }

  function addSelectedAssetsToChecklist() {
    if (!selectedAssetIds.length) return;
    const selectedAssets = outletAssets.filter((asset) => selectedAssetIds.includes(asset.id));
    setRows((current) => {
      const existingIds = new Set(current.map((row) => inspectionRowAssetId(row)).filter(Boolean));
      const nextRows = selectedAssets
        .filter((asset) => !existingIds.has(asset.id))
        .map((asset) => createInspectionChecklistRow(asset));
      return [...current, ...nextRows];
    });
    setSelectedAssetIds([]);
    setAssetPickerQuery("");
    setAssetPickerOpen(false);
  }

  function addEvidence(assetId, evidence) {
    setRows((current) => current.map((row) => (inspectionRowAssetId(row) === assetId ? { ...row, evidence: [...(row.evidence || []), evidence] } : row)));
  }

  function removeEvidence(assetId, index) {
    setRows((current) => current.map((row) => (inspectionRowAssetId(row) === assetId ? { ...row, evidence: (row.evidence || []).filter((_, itemIndex) => itemIndex !== index) } : row)));
  }

  function submit(status = "completed") {
    const draftRows = enrichedRows.map((row) => ({
      asset_id: inspectionRowAssetId(row),
      counted_quantity: row.counted_quantity,
      condition_status: row.condition_status,
      evidence: row.evidence || [],
      remark: row.remark || "",
      skipped: row.skipped === true,
    }));
    onSubmit({
      draftId: draftInspection?.id || "",
      outletId,
      inspectionDate,
      checkedBy,
      checkedByEmployeeId,
      categoryScope,
      notes,
      remark: notes,
      summary,
      status,
      currentStep: step,
      draftData: {
        currentStep: step,
        inspectionType,
        scopeType,
        selectedCategoryIds,
        checkedBy,
        checkedByEmployeeId,
        inspectionDate,
        notes,
        rows: draftRows,
        savedAt: new Date().toISOString(),
      },
      rows: activeRows.map((row) => ({ ...row, evidence_required: row.needsEvidence })),
    });
  }

  const stepLabels = ["Setup", "Checklist", "Review & Submit"];

  return (
    <Modal
      title="Asset Inspection Audit"
      description={draftInspection ? "Resume saved operational audit workflow." : "Structured outlet asset verification with condition, evidence, and discrepancy tracking."}
      onClose={onClose}
      size="2xl"
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "Cancel" : "Back"}</button>
          {step > 1 ? <button className="btn-secondary" type="button" disabled={saving || !rows.length} onClick={() => submit("draft")}>Save Draft</button> : null}
          {step < 3 ? (
            <button className="btn-primary" type="button" disabled={scopeType === "selected" && selectedCategoryIds.length === 0} onClick={() => setStep((current) => current + 1)}>{step === 2 ? "Review & Submit" : "Continue Checklist"}</button>
          ) : null}
        </>
      )}
    >
      <div className="mb-5 grid grid-cols-3 gap-2">
        {stepLabels.map((label, index) => {
          const active = step >= index + 1;
          return (
            <div key={label} className={`rounded-2xl border px-3 py-2 ${active ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-slate-50 text-text-muted"}`}>
              <div className="text-[10px] font-black uppercase tracking-wide">Step {index + 1}</div>
              <div className="text-xs font-black">{label}</div>
            </div>
          );
        })}
      </div>

      {step > 1 ? (
        <div className="sticky top-0 z-20 mb-5 rounded-3xl border border-border bg-surface/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-text-muted">Inspection Progress</div>
              <div className="mt-1 text-sm font-black text-text-primary">{completedRows.length} / {rows.length} completed</div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold text-text-secondary">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{remainingRows} remaining</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{progressPercentage}%</span>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full transition-all ${progressPercentage === 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${progressPercentage}%` }} />
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <FieldLabel label="Inspection Type">
            <SelectField value={inspectionType} options={inspectionTypeOptions.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => setInspectionType(normalizeInspectionType(value))} />
            <div className="mt-1 text-xs font-semibold text-text-muted">{inspectionTypeOptions.find((option) => option.value === inspectionType)?.helper}</div>
          </FieldLabel>
          <DatePickerField label="Inspection Date" value={inspectionDate} onChange={setInspectionDate} />
          <FieldLabel label="Checked By">
            <div className="rounded-2xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">
              {checkedBy || "Authenticated user"}
              <div className="mt-0.5 text-xs font-semibold text-text-muted">Auto-populated from your login.</div>
            </div>
          </FieldLabel>
          <FieldLabel label="Category Scope">
            <SelectField value={scopeType} options={[{ value: "all", label: "All Categories" }, { value: "selected", label: "Selected Categories" }]} onChange={setScopeType} />
          </FieldLabel>
          <FieldLabel label="Inspection Notes"><input className="control" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional audit notes" /></FieldLabel>
          {scopeType === "selected" ? (
            <div className="md:col-span-2">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">Select Categories</div>
              <div className="flex flex-wrap gap-2">
                {categories.filter((category) => category.is_active).map((category) => {
                  const selected = selectedCategoryIds.includes(category.id);
                  return (
                    <button key={category.id} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${selected ? "border-primary bg-primary text-white" : "border-border bg-surface text-text-secondary"}`} type="button" onClick={() => setSelectedCategoryIds((current) => selected ? current.filter((id) => id !== category.id) : [...current, category.id])}>
                      {category.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <div className="rounded-3xl border border-border bg-slate-50/80 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-text-muted">Checklist Progress</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-text-secondary">
                  <span className="rounded-full bg-white px-2.5 py-1">{checkedRows.length} completed</span>
                  <span className="rounded-full bg-white px-2.5 py-1">{skippedRows.length} skipped</span>
                  <span className="rounded-full bg-white px-2.5 py-1">{remainingRows} remaining</span>
                  <span className="rounded-full bg-white px-2.5 py-1">{rows.length} total</span>
                </div>
              </div>
              <button className="btn-primary h-9 px-3 text-xs" type="button" onClick={() => setAssetPickerOpen((current) => !current)}>+ Add Asset</button>
            </div>
            {assetPickerOpen ? (
              <div className="mt-3 rounded-2xl border border-border bg-white p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <input className="control h-10" value={assetPickerQuery} onChange={(event) => setAssetPickerQuery(event.target.value)} placeholder="Search assets to add into this checklist..." />
                  <button className="btn-secondary h-10 px-3 text-xs" type="button" disabled={!selectedAssetIds.length} onClick={addSelectedAssetsToChecklist}>Add Selected ({selectedAssetIds.length})</button>
                </div>
                <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto md:grid-cols-2">
                  {availableAssets.map((asset) => {
                    const selected = selectedAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition ${selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                        type="button"
                        onClick={() => setSelectedAssetIds((current) => selected ? current.filter((id) => id !== asset.id) : [...current, asset.id])}
                      >
                        <AssetThumbnail asset={asset} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-text-primary">{asset.name}</span>
                          <span className="block truncate text-xs font-semibold text-text-secondary">{asset.category_name || "Uncategorized"} · {asset.current_quantity} {asset.unit}</span>
                          {isSuggestedForInspectionType(asset, inspectionType) ? <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">Suggested for {inspectionTypeLabel(inspectionType)}</span> : null}
                        </span>
                        <span className={`h-4 w-4 rounded border ${selected ? "border-primary bg-primary" : "border-border bg-white"}`} />
                      </button>
                    );
                  })}
                  {!availableAssets.length ? <div className="rounded-2xl border border-dashed border-border p-4 text-center text-sm font-semibold text-text-secondary md:col-span-2">No available assets match this search.</div> : null}
                </div>
              </div>
            ) : null}
          </div>
          {enrichedRows.map((row, index) => {
                const rowAsset = safeInspectionAsset(row);
                const rowAssetId = rowAsset.id || `missing-${row.id || index}`;
                const rowImages = [rowAsset.thumbnail_url || rowAsset.image_url].filter(Boolean);
                const border = row.condition_status === "missing" || row.diff < 0
                  ? "border-l-4 border-l-rose-500 bg-rose-50/40"
                  : row.condition_status !== "healthy" || row.diff !== 0
                    ? "border-l-4 border-l-amber-500 bg-amber-50/30"
                    : "bg-white";
                return (
                  <div key={rowAssetId} className={`rounded-3xl border border-border p-4 shadow-sm ${border}`}>
                    <div className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr_1fr]">
                      <div className="flex gap-3">
                        <button type="button" onClick={() => rowImages.length ? setLightbox({ images: rowImages, index: 0 }) : null}>
                          <AssetThumbnail asset={rowAsset} interactive />
                        </button>
                        <div className="min-w-0">
                          <div className="font-black text-text-primary">{rowAsset.name}</div>
                          <div className="mt-0.5 text-xs text-text-secondary">{rowAsset.description || "No description"}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge tone="info">{rowAsset.category_name || "Uncategorized"}</Badge>
                            {row.skipped ? <Badge tone="neutral">Skipped</Badge> : null}
                            {!row.skipped && row.counted_quantity !== "" ? <Badge tone="success">Recorded</Badge> : null}
                          </div>
                        </div>
                      </div>
                      <div className={`grid grid-cols-3 gap-2 ${row.skipped ? "opacity-55" : ""}`}>
                        <div className="rounded-2xl bg-slate-50 p-3"><div className="text-[10px] font-black uppercase text-text-muted">Expected</div><div className="text-lg font-black">{rowAsset.current_quantity}</div></div>
                        <FieldLabel label="Current Qty"><input className="control h-11" type="number" min="0" value={row.counted_quantity} disabled={row.skipped} onChange={(event) => updateRow(rowAssetId, "counted_quantity", event.target.value)} /></FieldLabel>
                        <div className="flex items-end pb-1"><DifferenceBadge diff={row.diff} /></div>
                      </div>
                      <div className={`space-y-2 ${row.skipped ? "opacity-60" : ""}`}>
                        <FieldLabel label="Condition">
                          <SelectField value={row.condition_status || "healthy"} options={inspectionConditionOptions.map((condition) => ({ value: condition, label: assetConditionLabel(condition) }))} onChange={(value) => updateRow(rowAssetId, "condition_status", value)} disabled={row.skipped} />
                        </FieldLabel>
                        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                          <input className="control h-10" value={row.remark} onChange={(event) => updateRow(rowAssetId, "remark", event.target.value)} placeholder={row.needsEvidence ? "Discrepancy explanation" : "Inspection note"} />
                          <label className="btn-secondary h-10 cursor-pointer px-3 text-xs">
                            Upload Evidence
                            <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} multiple capture="environment" onChange={(event) => readEvidenceFiles(event.target.files, (evidence) => { setEvidenceError(""); addEvidence(rowAssetId, evidence); }, setEvidenceError)} />
                          </label>
                        </div>
                        {evidenceError ? <div className="text-xs font-semibold text-rose-600">{evidenceError}</div> : null}
                        <div className="flex flex-wrap gap-2">
                          {(row.evidence || []).map((evidence, evidenceIndex) => (
                            <button key={`${evidence.image_url}-${evidenceIndex}`} className="group relative" type="button" onClick={() => setLightbox({ images: row.evidence.map((item) => item.image_url), index: evidenceIndex })}>
                              <img className="h-12 w-12 rounded-xl border border-border object-cover" src={evidence.image_url} alt={evidence.caption || "Evidence"} />
                              <span className="absolute -right-1 -top-1 hidden rounded-full bg-rose-600 px-1 text-[10px] font-black text-white group-hover:block" onClick={(event) => { event.stopPropagation(); removeEvidence(rowAssetId, evidenceIndex); }}>×</span>
                            </button>
                          ))}
                          {row.needsEvidence ? <Badge tone={row.evidenceComplete ? "success" : "warning"}>{row.evidenceComplete ? "Evidence or remark added" : "Evidence or remark recommended"}</Badge> : null}
                          <Badge tone={assetConditionTone(row.condition_status)}>{assetConditionLabel(row.condition_status)}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                          <button className={`rounded-full px-2.5 py-1 text-xs font-black ${row.skipped ? "bg-slate-800 text-white" : "bg-slate-100 text-text-secondary hover:bg-slate-200"}`} type="button" onClick={() => updateRow(rowAssetId, "skipped", !row.skipped)}>{row.skipped ? "Unskip" : "Mark Skipped"}</button>
                          <button className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700 hover:bg-rose-100" type="button" onClick={() => removeRow(rowAssetId)}>Remove</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          {!rows.length ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">No assets found for this inspection scope.</div> : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {[["Inspection Summary", `${completedRows.length} / ${rows.length} completed`], ["Issues Found", issueRows.length]].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-background p-4">
                <div className="text-xs font-black uppercase tracking-wide text-text-muted">{label}</div>
                <div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-text-muted">Review & Submit</div>
            <div className="divide-y divide-border">
              {reviewRows.map((row, index) => {
                const rowAsset = safeInspectionAsset(row);
                const rowAssetId = rowAsset.id || `issue-${row.id || index}`;
                const assetImage = rowAsset.thumbnail_url || rowAsset.image_url;
                const evidenceImages = (row.evidence || []).map((item) => item.image_url).filter(Boolean);
                return (
                  <div key={rowAssetId} className={`grid gap-3 p-4 text-sm md:grid-cols-[minmax(0,1fr)_150px_130px_minmax(0,1fr)] ${isIssueRow(row) ? "bg-amber-50/40" : "bg-white"}`}>
                    <div className="flex min-w-0 gap-3">
                      <button type="button" className="shrink-0" onClick={() => assetImage ? setLightbox({ images: [assetImage], index: 0 }) : null}>
                        <AssetThumbnail asset={rowAsset} interactive={Boolean(assetImage)} />
                      </button>
                      <div className="min-w-0">
                        <div className="truncate font-bold text-text-primary">{rowAsset.name}</div>
                        <div className="text-xs font-semibold text-text-secondary">{rowAsset.category_name || "Uncategorized"}</div>
                      </div>
                    </div>
                    {row.skipped ? <Badge tone="neutral">Skipped</Badge> : <DifferenceBadge diff={row.diff} />}
                    <Badge tone={assetConditionTone(row.condition_status)}>{assetConditionLabel(row.condition_status)}</Badge>
                    <div>
                      <div className={row.evidenceComplete || row.skipped ? "text-text-secondary" : "font-bold text-amber-700"}>{row.skipped ? row.remark || "Skipped during this inspection" : row.evidenceComplete ? row.remark || "Evidence or remark added" : "Evidence or remark recommended"}</div>
                      {evidenceImages.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {evidenceImages.slice(0, 4).map((imageUrl, evidenceIndex) => (
                            <button key={`${imageUrl}-${evidenceIndex}`} type="button" onClick={() => setLightbox({ images: evidenceImages, index: evidenceIndex })}>
                              <img className="h-10 w-10 rounded-xl border border-border object-cover" src={imageUrl} alt="Inspection evidence" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!reviewRows.length ? <div className="p-5 text-center text-sm font-semibold text-text-secondary">No assets found for this inspection.</div> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            Quantity differences will create correction movement logs. Asset conditions and last inspected dates will be updated after submission.
          </div>
          {pendingEvidenceRows.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">Some rows have evidence or remark recommendations. You can still submit or save this inspection as a draft.</div>
          ) : null}
          <div className="flex justify-end">
            <button className="btn-primary" type="button" disabled={saving || !rows.length} onClick={() => submit("completed")}>Submit Inspection</button>
          </div>
        </div>
      ) : null}

      {lightbox?.images?.length ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
          <button className="absolute inset-0" type="button" aria-label="Close image preview" onClick={() => setLightbox(null)} />
          <div className="relative max-h-[90vh] max-w-[92vw]">
            <img className="max-h-[86vh] rounded-3xl object-contain shadow-2xl" src={lightbox.images[lightbox.index]} alt="Inspection evidence preview" />
            <button className="absolute -right-3 -top-3 rounded-full bg-white p-2 text-slate-700 shadow-xl" type="button" onClick={() => setLightbox(null)}><X size={18} /></button>
            {lightbox.images.length > 1 ? (
              <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
                <button className="btn-secondary h-8 bg-white px-3 text-xs" type="button" onClick={() => setLightbox((current) => ({ ...current, index: Math.max(0, current.index - 1) }))}>Previous</button>
                <button className="btn-secondary h-8 bg-white px-3 text-xs" type="button" onClick={() => setLightbox((current) => ({ ...current, index: Math.min(current.images.length - 1, current.index + 1) }))}>Next</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function AssetDetailDrawer({ asset, outlet, movements = [], inspections = [], maintenanceRecords = [], currentProfile, actorNameResolver, onClose, onResumeDraft, onDeleteDraft, onArchiveDraft, onSaveMaintenance, saving }) {
  const [tab, setTab] = useState("overview");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(false);
  const [maintenanceEditor, setMaintenanceEditor] = useState(null);
  const safeAsset = asset || {};
  const latestInspection = inspections.find((inspection) => !isDraftInspection(inspection));
  const latestInspectionItem = latestInspection?.items?.find((item) => item.asset_id === safeAsset.id);
  const latestDifference = Number(latestInspectionItem?.difference || 0);
  const latestEvidenceCount = latestInspectionItem?.evidence_status === "complete" ? 1 : 0;
  const latestNotesCount = [latestInspectionItem?.remark, latestInspection?.notes, latestInspection?.remark].filter(Boolean).length;
  const maintenanceEnabled = safeAsset.maintenance_allowed === true;
  const detailTabs = ["overview", "movement", "inspection", ...(maintenanceEnabled ? ["maintenance"] : [])];
  const activeMaintenance = maintenanceRecords.filter((record) => ["scheduled", "in_progress"].includes(record.status));
  const overdueMaintenance = maintenanceRecords.filter(isMaintenanceOverdue);
  const lastCompletedMaintenance = latestCompletedMaintenanceRecord(maintenanceRecords);
  const nextService = currentNextServiceDate(maintenanceRecords);
  const nextServiceDays = daysUntil(nextService);
  const sortedMaintenanceRecords = useMemo(() => [...maintenanceRecords].sort(sortMaintenanceNewestFirst), [maintenanceRecords]);
  const maintenanceGroups = sortedMaintenanceRecords.reduce((groups, record) => {
    const group = maintenanceTimelineGroup(record);
    groups[group] = [...(groups[group] || []), record];
    return groups;
  }, {});
  const nextMaintenance = nextMaintenanceInfo(maintenanceRecords);
  const operationalSignals = [
    latestInspection ? `Last inspected ${formatFullDate(latestInspection.inspection_date)}` : "No inspection yet",
    maintenanceEnabled ? `${activeMaintenance.length} active maintenance` : null,
    overdueMaintenance.length ? "Overdue maintenance" : "No critical alerts",
    nextServiceDays !== null ? nextServiceDays >= 0 ? `Next service due in ${nextServiceDays} days` : "Next service overdue" : null,
  ].filter(Boolean);
  const quantityHint = latestDifference < 0
    ? { text: `↓ ${Math.abs(latestDifference)} from latest inspection`, className: "text-rose-700 bg-rose-50 border-rose-100" }
    : latestDifference > 0
      ? { text: `↑ ${latestDifference} extra from latest inspection`, className: "text-blue-700 bg-blue-50 border-blue-100" }
      : Number(safeAsset.minimum_quantity || 0) > 0 && Number(safeAsset.current_quantity || 0) <= Number(safeAsset.minimum_quantity || 0)
        ? { text: "Below expected stock", className: "text-amber-700 bg-amber-50 border-amber-100" }
        : { text: "Stock level stable", className: "text-emerald-700 bg-emerald-50 border-emerald-100" };
  const operationalSummary = [
    latestDifference !== 0 ? "Last inspection detected quantity mismatch." : "Latest inspection quantity is aligned.",
    maintenanceEnabled
      ? movements.length ? "Recent quantity movement has been recorded." : "No maintenance activity recorded recently."
      : "Maintenance workflow is not required for this asset category.",
    (safeAsset.condition || "healthy") === "healthy" ? "Asset condition stable for recent operations." : assetConditionInsight(safeAsset.condition),
  ];
  const recentActivity = [
    latestInspection ? {
      id: `inspection-${latestInspection.id}`,
      date: activityTimestamp(latestInspection) || latestInspection.inspection_date,
      title: "Inspection completed",
      detail: latestDifference ? `Difference ${latestDifference > 0 ? "+" : ""}${latestDifference}` : `Condition recorded as ${assetConditionLabel(latestInspectionItem?.condition_status || safeAsset.condition)}`,
      actor: inspectionActorLabel(latestInspection, { profile: currentProfile }, actorNameResolver),
    } : null,
    ...movements.slice(0, 3).map((movement) => {
      const meta = movementActivityMeta(movement, safeAsset.name);
      return {
        id: `movement-${movement.id}`,
        date: activityTimestamp(movement),
        title: meta.title,
        detail: meta.description,
        actor: activityActorLabel(meta.actorPrefix, movement.created_by, { profile: currentProfile }, actorNameResolver),
      };
    }),
    ...sortedMaintenanceRecords.slice(0, 2).map((record) => ({
      id: `maintenance-${record.id}`,
      date: activityTimestamp(record) || maintenanceRelevantDate(record),
      title: record.status === "completed" ? "Maintenance completed" : "Maintenance scheduled",
      detail: `${maintenanceStatusLabel(record.status)} · ${record.issue || "No issue recorded"}`,
      actor: activityActorLabel(record.status === "completed" ? "Completed" : "Scheduled", record.created_by, { profile: currentProfile }, actorNameResolver),
    })),
    safeAsset.image_url ? {
      id: "asset-photo",
      date: safeAsset.updated_at,
      title: "Asset photo updated",
      detail: "Image available in asset profile",
      actor: activityActorLabel("Updated", safeAsset.updated_by || safeAsset.created_by, { profile: currentProfile }, actorNameResolver),
    } : null,
  ].filter(Boolean).sort((first, second) => new Date(second.date || 0) - new Date(first.date || 0)).slice(0, 5);

  useEffect(() => {
    if (!maintenanceEnabled && tab === "maintenance") setTab("overview");
  }, [maintenanceEnabled, tab]);

  async function handleMaintenanceSubmit(values) {
    await onSaveMaintenance?.(asset, values);
    setMaintenanceEditor(null);
    setTab("maintenance");
  }

  if (maintenanceEditor) {
    const mode = maintenanceEditor.mode || "edit";
    return (
      <Drawer open onClose={onClose} width="lg" header={false} bodyClassName="p-0">
        {mode === "view" ? (
          <MaintenanceRecordViewPanel
            asset={asset}
            record={maintenanceEditor.record}
            onBack={() => setMaintenanceEditor(null)}
            onEdit={() => setMaintenanceEditor((current) => ({ ...current, mode: "edit" }))}
            onUpdateStatus={() => setMaintenanceEditor((current) => ({ ...current, mode: "edit" }))}
          />
        ) : (
          <MaintenanceRecordEditorPanel
            asset={asset}
            record={maintenanceEditor.record}
            saving={saving}
            onBack={() => setMaintenanceEditor(maintenanceEditor.record ? { mode: "view", record: maintenanceEditor.record } : null)}
            onSubmit={handleMaintenanceSubmit}
          />
        )}
      </Drawer>
    );
  }

  return (
    <Drawer open onClose={onClose} width="lg" header={false} bodyClassName="p-0">
        <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-gradient-to-br from-white to-emerald-50/40 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-4">
              <button className="group shrink-0" type="button" onClick={() => setPreviewOpen(true)} aria-label={`Preview ${asset.name} image`}>
                <AssetThumbnail asset={asset} size="lg" interactive />
              </button>
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Asset Profile</div>
                <h2 className="mt-1 truncate text-3xl font-semibold text-text-primary">{asset.name}</h2>
                <div className="mt-2 space-y-0.5 text-sm font-semibold text-text-secondary">
                  <div>{asset.category_name}</div>
                  <div className="font-mono text-xs tracking-wide text-text-muted">{assetDisplayId(asset)}</div>
                  <div>{outlet?.name || "Outlet not assigned"}</div>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              <Badge tone={assetConditionTone(asset.condition)}>{assetConditionLabel(asset.condition)}</Badge>
              <button className="icon-btn" type="button" onClick={onClose}><X size={18} /></button>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            {detailTabs.map((item) => <button key={item} className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === item ? "bg-primary text-white" : "bg-background text-text-secondary"}`} type="button" onClick={() => setTab(item)}>{item === "movement" ? "Movement Log" : item === "inspection" ? "Inspection History" : item === "maintenance" ? "Maintenance History" : "Overview"}</button>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
            {operationalSignals.map((signal) => (
              <span key={signal} className={`rounded-xl border px-2.5 py-1 text-[11px] font-black shadow-sm ${signal.includes("Overdue") ? "border-rose-100 bg-rose-50 text-rose-700" : signal.includes("active") && !signal.startsWith("0") ? "border-blue-100 bg-blue-50 text-blue-700" : "border-border bg-white/80 text-text-secondary"}`}>{signal}</span>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "overview" ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-3xl border border-primary/15 bg-primary/5 p-5">
                  <div className="text-xs font-black uppercase tracking-wide text-primary">Current Quantity</div>
                  <div className="mt-2 type-kpi-value text-text-primary">{asset.current_quantity} <span className="text-base font-black text-text-muted">{asset.unit}</span></div>
                  <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-black ${quantityHint.className}`}>{quantityHint.text}</div>
                </div>
                <div className="rounded-3xl border border-border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-text-muted">Condition</div>
                      <div className="mt-2 text-2xl font-semibold text-text-primary">{assetConditionLabel(asset.condition)}</div>
                    </div>
                    <Badge tone={assetConditionTone(asset.condition)}>{assetConditionLabel(asset.condition)}</Badge>
                  </div>
                  <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">{assetConditionInsight(asset.condition)}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[["Last Inspected", formatFullDate(latestInspection?.inspection_date || asset.last_inspection_at)], ["Next Maintenance", nextMaintenance.label], ["Last Movement", formatFullDate(movements[0]?.movement_date)], ["Minimum Quantity", `${asset.minimum_quantity} ${asset.unit}`]].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-border bg-background p-4"><div className="text-xs font-black uppercase tracking-wide text-text-muted">{label}</div><div className="mt-1 text-sm font-bold text-text-primary">{value}</div></div>
                ))}
              </div>
              <div className="rounded-3xl border border-border bg-white p-4 shadow-sm">
                <div className="text-sm font-black text-text-primary">Operational Summary</div>
                <div className="mt-3 grid gap-2">
                  {operationalSummary.map((item) => <div key={item} className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">{item}</div>)}
                </div>
              </div>
              <div className="rounded-3xl border border-border bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-black text-text-primary">Latest Inspection</div>
                    <div className="text-xs text-text-secondary">{latestInspection ? <><DateText value={latestInspection.inspection_date} /> · {inspectionDisplayName(latestInspection, currentProfile, actorNameResolver) || "Inspector not recorded"}</> : "No completed inspection yet."}</div>
                  </div>
                  {latestInspection ? <Badge tone={latestDifference === 0 ? "success" : latestDifference < 0 ? "danger" : "info"}>{latestDifference === 0 ? "Matched" : latestDifference > 0 ? `${latestDifference} Extra` : `${Math.abs(latestDifference)} Missing`}</Badge> : null}
                </div>
                {latestInspection ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    {[["Expected", latestInspectionItem?.expected_quantity ?? "—"], ["Counted", latestInspectionItem?.counted_quantity ?? "—"], ["Difference", latestDifference === 0 ? "Matched" : latestDifference > 0 ? `+${latestDifference}` : latestDifference], ["Condition", assetConditionLabel(latestInspectionItem?.condition_status || asset.condition)], ["Notes", latestNotesCount], ["Evidence", latestEvidenceCount]].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-slate-50 p-3">
                        <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">{label}</div>
                        <div className="mt-1 text-sm font-black text-text-primary">{value}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="rounded-2xl border border-dashed border-border p-5 text-center text-sm font-semibold text-text-secondary">No inspection snapshot available.</div>}
              </div>
              <div className="rounded-3xl border border-border bg-white p-4 shadow-sm">
                <div className="text-sm font-black text-text-primary">Recent Activity</div>
                <div className="mt-3 space-y-2">
                  {recentActivity.map((item) => (
                    <div key={item.id} className="flex gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
                      <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-black text-text-primary">{item.title}</div>
                          <div className="text-xs font-semibold text-text-muted"><DateText value={item.date} /></div>
                        </div>
                        <div className="mt-0.5 text-xs font-semibold text-text-secondary">{item.detail}</div>
                        {item.actor ? <div className="mt-0.5 text-[11px] font-semibold text-text-muted">{item.actor}</div> : null}
                      </div>
                    </div>
                  ))}
                  {!recentActivity.length ? <div className="rounded-2xl border border-dashed border-border p-5 text-center text-sm font-semibold text-text-secondary">No recent activity recorded.</div> : null}
                </div>
              </div>
              {asset.remark ? <div className="rounded-2xl border border-border bg-background p-4 text-sm text-text-secondary"><span className="font-bold text-text-primary">Remark: </span>{asset.remark}</div> : null}
            </div>
          ) : null}
          {tab === "movement" ? <Timeline rows={movements} empty="No movement logs yet." /> : null}
          {tab === "inspection" ? <InspectionHistory inspections={inspections} outlet={outlet} currentProfile={currentProfile} actorNameResolver={actorNameResolver} onResumeDraft={onResumeDraft} onDeleteDraft={onDeleteDraft} onArchiveDraft={onArchiveDraft} /> : null}
          {tab === "maintenance" ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-text-primary">Maintenance Summary</div>
                  <div className="text-xs text-text-secondary">Repairs, service work, vendor cost, and follow-up notes.</div>
                </div>
                <button className="btn-primary h-9 px-3 text-xs" type="button" onClick={() => setMaintenanceEditor({ mode: "edit", record: null })}>+ Add Maintenance Record</button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-border bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Wrench size={14} /></div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Last Service Date</div>
                      <div className="mt-1 text-sm font-black text-text-primary">{lastCompletedMaintenance ? formatFullDate(maintenanceCompletedDate(lastCompletedMaintenance)) : "No service yet"}</div>
                    </div>
                  </div>
                </div>
                <div className={`rounded-2xl border p-3 shadow-sm ${activeMaintenance.length ? "border-blue-100 bg-blue-50/60" : "border-border bg-white"}`}>
                  <div className="flex items-start gap-2.5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${activeMaintenance.length ? "bg-blue-100 text-blue-700" : "bg-slate-50 text-text-muted"}`}><AlertTriangle size={14} /></div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Open Maintenance</div>
                      <div className="mt-1 text-sm font-black text-text-primary">{activeMaintenance.length ? `${activeMaintenance.length} open issue${activeMaintenance.length === 1 ? "" : "s"}` : "No active issue"}</div>
                    </div>
                  </div>
                </div>
                <div className={`rounded-2xl border p-3 shadow-sm ${nextServiceDays !== null && nextServiceDays < 0 ? "border-rose-100 bg-rose-50/70" : "border-border bg-white"}`}>
                  <div className="flex items-start gap-2.5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${nextServiceDays !== null && nextServiceDays < 0 ? "bg-rose-100 text-rose-700" : "bg-slate-50 text-text-muted"}`}><CalendarDays size={14} /></div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Next Service Due</div>
                      <div className="mt-1 text-sm font-black text-text-primary">{nextService ? formatFullDate(nextService) : "No due date set"}</div>
                    </div>
                  </div>
                </div>
              </div>
              {maintenanceRecords.length ? (
                <div className="space-y-4">
                  {["Upcoming", "Today", "Older"].filter((group) => maintenanceGroups[group]?.length).map((group) => (
                    <div key={group} className="space-y-2">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{group}</div>
                      {maintenanceGroups[group].map((record) => (
                        <div key={record.id} className={`rounded-2xl border bg-white p-3 shadow-sm transition hover:border-primary/20 hover:shadow-md ${isMaintenanceOverdue(record) ? "border-rose-200" : "border-border"}`}>
                          <div className="grid gap-3 md:grid-cols-[42px_1fr_auto]">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-xs font-black text-primary ring-1 ring-primary/10">{maintenanceTypeIcon(record.maintenance_type)}</div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-black text-text-primary">{maintenanceTypeLabel(record.maintenance_type)}</span>
                                <Badge tone={maintenanceStatusTone(record.status)}>{maintenanceStatusLabel(record.status)}</Badge>
                                {record.status !== "completed" ? <Badge tone={priorityTone(record.priority)}>{titleCase(record.priority)}</Badge> : null}
                                <span className="text-sm font-black text-text-primary">RM {Number(record.cost || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                              <div className="mt-1 line-clamp-2 text-sm font-semibold text-text-secondary">{record.issue || "No issue recorded"}{record.action_taken ? ` · ${record.action_taken}` : " · No action recorded"}</div>
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-text-muted">
                                <span>{record.vendor || "No vendor"}</span>
                                <span>•</span>
                                {(() => {
                                  const [label, value] = maintenanceStatusDateLabel(record);
                                  return <span>{label} <DateText value={value} /></span>;
                                })()}
                                <span>•</span>
                                <span>{record.photo_url ? "1 photo" : "No photo"}</span>
                              </div>
                              <div className="mt-3"><LifecycleProgress status={record.status} /></div>
                            </div>
                            <div className="flex items-start justify-end gap-1">
                              <button className="rounded-full px-2.5 py-1 text-xs font-black text-text-muted hover:bg-slate-100" type="button" onClick={() => setMaintenanceEditor({ mode: "view", record })}>View</button>
                              <button className="rounded-full px-2.5 py-1 text-xs font-black text-primary hover:bg-primary/10" type="button" onClick={() => setMaintenanceEditor({ mode: "edit", record })}>Edit</button>
                            </div>
                          </div>
                          {isMaintenanceOverdue(record) ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">Overdue scheduled maintenance</div> : null}
                          {record.remark ? <div className="mt-2 rounded-xl border-l-4 border-primary/25 bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">{record.remark}</div> : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">
                  <div className="font-black text-text-primary">No maintenance records yet.</div>
                  <p className="mx-auto mt-2 max-w-sm">Track repairs, service work, vendor cost, and follow-up notes for this asset.</p>
                  <button className="btn-primary mt-4 h-9 px-3 text-xs" type="button" onClick={() => setMaintenanceEditor({ mode: "edit", record: null })}>Add Maintenance Record</button>
                </div>
              )}
            </div>
          ) : null}
        </div>
        {previewOpen ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
            <button className="absolute inset-0" type="button" aria-label="Close image preview" onClick={() => { setPreviewOpen(false); setPreviewZoom(false); }} />
            <div className="relative max-w-[92vw] rounded-3xl bg-white p-3 shadow-2xl">
              {asset.image_url || asset.thumbnail_url ? (
                <img className={`${previewZoom ? "max-h-none max-w-none scale-125 cursor-zoom-out" : "max-h-[78vh] max-w-[82vw] cursor-zoom-in"} rounded-2xl object-contain transition`} src={asset.image_url || asset.thumbnail_url} alt={asset.name} onClick={() => setPreviewZoom((current) => !current)} />
              ) : (
                <div className="flex h-72 w-72 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-slate-100 text-3xl font-black text-primary">{categoryIcon(asset.category_name)}</div>
              )}
              <div className="absolute right-3 top-3 flex gap-2">
                {asset.image_url || asset.thumbnail_url ? <button className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-xl" type="button" onClick={() => setPreviewZoom((current) => !current)}>{previewZoom ? "Fit" : "Zoom"}</button> : null}
                <button className="rounded-full bg-white p-2 text-slate-700 shadow-xl" type="button" onClick={() => { setPreviewOpen(false); setPreviewZoom(false); }}><X size={18} /></button>
              </div>
            </div>
          </div>
        ) : null}
    </Drawer>
  );
}

function Timeline({ rows, empty }) {
  return rows.length ? <div className="space-y-2">{rows.map((row) => (
    <div key={row.id} className="rounded-2xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3"><div className="text-sm font-bold text-text-primary">{titleCase(row.movement_type)}</div><div className="text-xs font-semibold text-text-muted"><DateText value={row.movement_date} /></div></div>
      <div className="mt-1 text-xs font-semibold text-text-secondary">{row.quantity_before} → {row.quantity_after} ({row.quantity_change > 0 ? "+" : ""}{row.quantity_change}) · {titleCase(row.reason)}</div>
      {row.remark ? <div className="mt-2 text-xs text-text-secondary">{row.remark}</div> : null}
    </div>
  ))}</div> : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">{empty}</div>;
}

function profileDisplayName(profile) {
  return getEmployeeDisplayName(profile, { fallback: "" });
}

function inspectionActorMeta(inspection, currentProfile) {
  const actorIds = [inspection.created_by, inspection.last_edited_by].filter(Boolean);
  const actorMatchesProfile = Boolean(currentProfile?.id && actorIds.includes(currentProfile.id));
  const checkedBy = String(inspection.checked_by || "").trim();
  const name = checkedBy && !isUuidLike(checkedBy) ? checkedBy : (actorMatchesProfile ? profileDisplayName(currentProfile) : "");
  const role = actorMatchesProfile ? (currentProfile.position || currentProfile.role_name || "") : "";
  const timestamp = inspection.updated_at || inspection.last_edited_at || inspection.created_at || inspection.inspection_date;
  return { name, role, timestamp };
}

function inspectionDisplayName(inspection, currentProfile, actorNameResolver = null) {
  const checkedBy = String(inspection?.checked_by || "").trim();
  if (checkedBy && !isUuidLike(checkedBy)) return checkedBy;
  if (actorNameResolver) {
    const resolved = actorNameResolver(inspection?.checked_by_employee_id || checkedBy || inspection?.created_by || inspection?.last_edited_by);
    if (resolved && resolved !== "Unknown User") return resolved;
  }
  return inspectionActorMeta(inspection || {}, currentProfile).name || "";
}

function CheckedByText({ inspection, currentProfile, actorNameResolver = null }) {
  const actor = inspectionActorMeta(inspection, currentProfile);
  const name = inspectionDisplayName(inspection, currentProfile, actorNameResolver);
  if (!name) return <span>Checked by: Unknown User</span>;
  return (
    <span>
      Checked by {name}
      {actor.role ? <span> · {actor.role}</span> : null}
      {actor.timestamp ? <span> · {formatDateTime(actor.timestamp)}</span> : null}
    </span>
  );
}

function inspectionDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function inspectionDisplayDate(inspection, sameDateCount) {
  const timestamp = inspection.updated_at || inspection.created_at || inspection.inspection_date;
  return sameDateCount > 1 ? `${formatFullDate(inspection.inspection_date)} · ${formatTime(timestamp)}` : formatFullDate(inspection.inspection_date);
}

function inspectionVarianceCount(inspection) {
  return (inspection.items || []).filter((item) => Number(item.difference || 0) !== 0).length;
}

function inspectionSortTime(inspection) {
  const inspectionDate = inspection?.inspection_date ? new Date(inspection.inspection_date).getTime() : 0;
  const createdAt = inspection?.created_at ? new Date(inspection.created_at).getTime() : 0;
  const updatedAt = inspection?.updated_at ? new Date(inspection.updated_at).getTime() : 0;
  return {
    inspectionDate: Number.isNaN(inspectionDate) ? 0 : inspectionDate,
    createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
    updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt,
  };
}

function sortInspectionsNewestFirst(first, second) {
  const firstTime = inspectionSortTime(first);
  const secondTime = inspectionSortTime(second);
  return secondTime.inspectionDate - firstTime.inspectionDate ||
    secondTime.createdAt - firstTime.createdAt ||
    secondTime.updatedAt - firstTime.updatedAt;
}

function InspectionDetailModal({ inspection, outlet, currentProfile, actorNameResolver, onClose }) {
  const rows = inspection.items || [];
  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <button className="absolute inset-0" type="button" aria-label="Close inspection details" onClick={onClose} />
      <div className="relative flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-slate-50 px-5 py-4">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Inspection Details</div>
            <div className="mt-1 text-xl font-semibold text-text-primary">{formatFullDate(inspection.inspection_date)}</div>
            <div className="mt-1 text-xs font-semibold text-text-secondary"><CheckedByText inspection={inspection} currentProfile={currentProfile} actorNameResolver={actorNameResolver} /></div>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close inspection details"><X size={18} /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Outlet", outlet?.name || "Outlet"],
              ["Status", draftStatusLabel(inspection.status)],
              ["Assets Checked", inspection.summary?.checked_assets || rows.length],
              ["Variance", inspectionVarianceCount(inspection)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-background p-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">{label}</div>
                <div className="mt-1 text-sm font-black text-text-primary">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-text-muted">
              <div>Asset</div>
              <div>Expected</div>
              <div>Counted</div>
              <div>Diff</div>
              <div>Condition</div>
            </div>
            <div className="divide-y divide-border">
              {rows.map((item) => (
                <div key={item.id} className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 text-xs font-semibold text-text-secondary">
                  <div className="min-w-0">
                    <div className="truncate font-black text-text-primary">{item.asset?.name || "Unknown Asset"}</div>
                    {item.remark ? <div className="mt-0.5 truncate text-[11px] text-text-muted">{item.remark}</div> : null}
                    {(item.evidence || []).length ? <div className="mt-0.5 text-[11px] font-bold text-primary">{(item.evidence || []).length} evidence uploaded</div> : null}
                  </div>
                  <div>{item.expected_quantity ?? item.expected_qty ?? 0}</div>
                  <div>{item.counted_quantity ?? item.counted_qty ?? 0}</div>
                  <div className={Number(item.difference || 0) === 0 ? "text-emerald-700" : Number(item.difference || 0) > 0 ? "text-blue-700" : "text-rose-700"}>{Number(item.difference || 0) > 0 ? "+" : ""}{Number(item.difference || 0)}</div>
                  <div><Badge tone={assetConditionTone(item.condition_status)}>{assetConditionLabel(item.condition_status)}</Badge></div>
                </div>
              ))}
              {!rows.length ? <div className="px-3 py-5 text-center text-sm font-semibold text-text-secondary">No checked assets recorded.</div> : null}
            </div>
          </div>
          {inspection.notes || inspection.remark ? (
            <div className="rounded-2xl border-l-4 border-primary/30 bg-slate-50 px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Notes</div>
              <div className="mt-1 text-sm font-semibold text-text-secondary">{inspection.notes || inspection.remark}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InspectionHistory({ inspections = [], outlet, currentProfile, actorNameResolver, onResumeDraft, onDeleteDraft, onArchiveDraft }) {
  const [detailInspection, setDetailInspection] = useState(null);
  const sortedInspections = useMemo(() => [...inspections].sort(sortInspectionsNewestFirst), [inspections]);
  const dateCounts = useMemo(() => {
    const counts = new Map();
    sortedInspections.forEach((inspection) => {
      const key = inspectionDateKey(inspection.inspection_date);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [sortedInspections]);

  return sortedInspections.length ? (
    <>
      <div className="space-y-3">{sortedInspections.map((inspection) => {
        const rows = inspection.items || [];
        const checkedCount = inspection.summary?.checked_assets || rows.length;
        const varianceCount = inspectionVarianceCount(inspection);
        const previewRows = rows.slice(0, 3);
        const dateKey = inspectionDateKey(inspection.inspection_date);
        return (
          <div key={inspection.id} className={`rounded-2xl border p-3 ${isDraftInspection(inspection) ? "border-amber-200 bg-amber-50/50" : "border-border bg-background"}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <button className="min-w-0 flex-1 text-left" type="button" onClick={() => isDraftInspection(inspection) && onResumeDraft?.(inspection)}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-black text-text-primary">{inspectionDisplayDate(inspection, dateCounts.get(dateKey) || 0)}</div>
                  <Badge tone={isDraftInspection(inspection) ? "warning" : "success"}>{draftStatusLabel(inspection.status)}</Badge>
                </div>
                <div className="mt-1 text-xs font-semibold text-text-secondary"><CheckedByText inspection={inspection} currentProfile={currentProfile} actorNameResolver={actorNameResolver} /></div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-text-muted">
                  <span>{checkedCount} assets checked</span>
                  <span>{inspection.summary?.critical_alerts || 0} critical</span>
                  <span>{varianceCount} variance</span>
                  <span>Saved {formatDateTime(inspection.last_edited_at || inspection.updated_at || inspection.created_at)}</span>
                </div>
                {isDraftInspection(inspection) ? (
                  <div className="mt-2">
                    <div className="h-2 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${inspectionProgress(inspection)}%` }} />
                    </div>
                    <div className="mt-1 text-xs font-bold text-text-muted">{inspectionProgress(inspection)}% completed</div>
                  </div>
                ) : null}
              </button>
              <div className="flex flex-wrap gap-1.5">
                {!isDraftInspection(inspection) ? <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => setDetailInspection(inspection)}>View Details</button> : null}
                {isDraftInspection(inspection) ? <button className="btn-primary h-8 px-2 text-xs" type="button" onClick={() => onResumeDraft?.(inspection)}>Resume</button> : null}
                {isDraftInspection(inspection) ? <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => onArchiveDraft?.(inspection)}>Archive</button> : null}
                {isDraftInspection(inspection) ? <button className="btn-secondary h-8 px-2 text-xs text-rose-700" type="button" onClick={() => onDeleteDraft?.(inspection)}>Delete</button> : null}
              </div>
            </div>
            {!isDraftInspection(inspection) ? (
              <div className="mt-3 space-y-1.5">
                {previewRows.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary">
                    <div className="font-black text-text-primary">{item.asset?.name || "Unknown Asset"}</div>
                    <div className="mt-0.5">Expected {item.expected_quantity ?? item.expected_qty ?? 0} · Counted {item.counted_quantity ?? item.counted_qty ?? 0} · {Number(item.difference || 0) > 0 ? "+" : ""}{Number(item.difference || 0)} · {assetConditionLabel(item.condition_status)}</div>
                  </div>
                ))}
                {rows.length > previewRows.length ? <div className="px-1 text-[11px] font-bold text-text-muted">+ {rows.length - previewRows.length} more checked assets</div> : null}
              </div>
            ) : null}
          </div>
        );
      })}</div>
      {detailInspection ? <InspectionDetailModal inspection={detailInspection} outlet={outlet} currentProfile={currentProfile} actorNameResolver={actorNameResolver} onClose={() => setDetailInspection(null)} /> : null}
    </>
  ) : <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm font-semibold text-text-secondary">No inspection history yet.</div>;
}

function collectAssetActorIds({ assets = [], movements = [], inspections = [], maintenanceRecords = [] }) {
  const ids = new Set();
  const add = (value) => {
    if (isUuidLike(value)) ids.add(String(value));
  };
  assets.forEach((asset) => {
    add(asset.created_by);
    add(asset.updated_by);
    add(asset.recorded_by);
    add(asset.user_id);
  });
  movements.forEach((movement) => {
    add(movement.created_by);
    add(movement.updated_by);
    add(movement.recorded_by);
    add(movement.user_id);
  });
  maintenanceRecords.forEach((record) => {
    add(record.created_by);
    add(record.updated_by);
    add(record.recorded_by);
    add(record.user_id);
  });
  inspections.forEach((inspection) => {
    add(inspection.created_by);
    add(inspection.updated_by);
    add(inspection.last_edited_by);
    add(inspection.checked_by);
    add(inspection.checked_by_employee_id);
    add(inspection.inspected_by);
    add(inspection.recorded_by);
    add(inspection.user_id);
    (inspection.items || []).forEach((item) => {
      add(item.created_by);
      add(item.updated_by);
      add(item.checked_by);
      add(item.recorded_by);
      add(item.user_id);
    });
  });
  return [...ids];
}

export default function AssetTrackingPage({ store, ui, auth }) {
  const activeOutlets = useMemo(() => (store?.outlets || []).filter((outlet) => outlet.status === "active" || outlet.is_active), [store?.outlets]);
  const currentInspectorName = auth?.profile?.nickname || auth?.profile?.full_name || auth?.user?.email || "";
  const currentInspectorId = auth?.profile?.id || "";
  const [outletId, setOutletId] = useState(activeOutlets[0]?.id ?? "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [movements, setMovements] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState([]);
  const [assetModal, setAssetModal] = useState(null);
  const [assetImportOpen, setAssetImportOpen] = useState(false);
  const [importAssets, setImportAssets] = useState([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [adjustAsset, setAdjustAsset] = useState(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [maintenanceContext, setMaintenanceContext] = useState(null);
  const [detailAsset, setDetailAsset] = useState(null);
  const [imagePreviewAsset, setImagePreviewAsset] = useState(null);
  const [imagePreviewZoom, setImagePreviewZoom] = useState(false);
  const [actionMenu, setActionMenu] = useState(null);
  const [conditionMenu, setConditionMenu] = useState(null);
  const [assetPreview, setAssetPreview] = useState(null);
  const [conditionUpdatingId, setConditionUpdatingId] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actorEmployees, setActorEmployees] = useState([]);

  const canAdd = canCreate(auth, "asset_tracking");
  const canEditAsset = canEdit(auth, "asset_tracking");
  const canDeleteAsset = canDelete(auth, "asset_tracking");
  const canManageAsset = canManage(auth, "asset_tracking");
  const canExportAsset = canExport(auth, "asset_tracking");

  useEffect(() => {
    if (!activeOutlets.length) {
      setOutletId("");
      setAssets([]);
      setMovements([]);
      setInspections([]);
      setMaintenanceRecords([]);
      setLoading(false);
      return;
    }
    if (!activeOutlets.some((outlet) => outlet.id === outletId)) {
      setOutletId(activeOutlets[0].id);
    }
  }, [activeOutlets, outletId]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [categoryRows, assetRows, movementRows, inspectionRows, maintenanceRows] = await Promise.all([
        assetTrackingService.listCategories(),
        assetTrackingService.listAssets(outletId),
        assetTrackingService.listMovementLogs("", outletId),
        assetTrackingService.listInspections("", outletId),
        assetTrackingService.listMaintenanceRecords("", outletId),
      ]);
      setCategories(categoryRows);
      setAssets(assetRows);
      setMovements(movementRows);
      setInspections(inspectionRows);
      setMaintenanceRecords(maintenanceRows);
    } catch (loadError) {
      console.error("Unable to load asset tracking", loadError);
      setError(loadError.message || "Unable to load asset tracking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (outletId) loadData();
  }, [outletId]);

  const assetActorIds = useMemo(() => collectAssetActorIds({ assets, movements, inspections, maintenanceRecords }), [assets, movements, inspections, maintenanceRecords]);
  const assetActorKey = assetActorIds.join(",");

  useEffect(() => {
    let ignore = false;
    async function loadActorEmployees() {
      if (!assetActorIds.length) {
        setActorEmployees([]);
        return;
      }
      const { data, error } = await supabase
        .from("employees")
        .select("id,auth_user_id,nickname,full_name,email")
        .or(`id.in.(${assetActorIds.join(",")}),auth_user_id.in.(${assetActorIds.join(",")})`);
      if (ignore) return;
      if (error) {
        if (import.meta.env.DEV) console.warn("[AssetActorMapDebug]", error);
        setActorEmployees([]);
        return;
      }
      setActorEmployees(data || []);
    }
    loadActorEmployees();
    return () => {
      ignore = true;
    };
  }, [assetActorKey]);

  const employeeActorMap = useMemo(() => {
    const map = new Map();
    actorEmployees.forEach((employee) => {
      const displayName = getEmployeeDisplayName(employee);
      if (employee.id) map.set(employee.id, displayName);
      if (employee.auth_user_id) map.set(employee.auth_user_id, displayName);
    });
    return map;
  }, [actorEmployees]);

  const actorDisplayName = (actorId) => getEmployeeDisplayName(actorId, {
    employeeActorMap,
    employees: actorEmployees,
    currentProfile: auth?.profile,
    currentUser: auth?.user,
  });

  const movementByAsset = useMemo(() => movements.reduce((map, movement) => {
    if (!map.has(movement.asset_id)) map.set(movement.asset_id, movement);
    return map;
  }, new Map()), [movements]);

  const inspectionByAsset = useMemo(() => inspections.reduce((map, inspection) => {
    (inspection.items || []).forEach((item) => {
      if (!map.has(item.asset_id)) map.set(item.asset_id, inspection);
    });
    return map;
  }, new Map()), [inspections]);

  const maintenanceByAsset = useMemo(() => maintenanceRecords.reduce((map, record) => {
    const list = map.get(record.asset_id) || [];
    list.push(record);
    map.set(record.asset_id, list);
    return map;
  }, new Map()), [maintenanceRecords]);

  const assetSignalsById = useMemo(() => assets.reduce((map, asset) => {
    const assetMaintenance = maintenanceByAsset.get(asset.id) || [];
    const latestInspection = inspectionByAsset.get(asset.id);
    map.set(asset.id, {
      nextMaintenance: nextMaintenanceInfo(assetMaintenance),
      maintenanceDue: assetMaintenance.some((record) => {
        const info = nextMaintenanceInfo([record]);
        return info.days !== null && info.days <= 1;
      }),
      overdue: assetMaintenance.some(isMaintenanceOverdue),
      highVariance: (latestInspection?.items || []).some((item) => item.asset_id === asset.id && Math.abs(Number(item.difference || 0)) > 0),
    });
    return map;
  }, new Map()), [assets, inspectionByAsset, maintenanceByAsset]);

  const scopedAssets = useMemo(() => assets
    .filter((asset) => categoryFilter === "all" || asset.category_id === categoryFilter)
    .filter((asset) => statusFilter === "all" || normalizeAssetCondition(asset.condition) === statusFilter)
    .filter((asset) => asset.status !== "archived")
    .filter((asset) => {
      const search = query.trim().toLowerCase();
      if (!search) return true;
      return [asset.name, asset.category_name, asset.remark].some((value) => String(value || "").toLowerCase().includes(search));
    }), [assets, categoryFilter, query, statusFilter]);

  const filteredAssets = useMemo(() => scopedAssets
    .filter((asset) => {
      if (quickFilter === "all") return true;
      if (quickFilter === "scheduled_maintenance") return (maintenanceByAsset.get(asset.id) || []).some((record) => record.status === "scheduled");
      if (quickFilter === "maintenance_due") return assetSignalsById.get(asset.id)?.maintenanceDue === true;
      if (quickFilter === "under_maintenance") return normalizeAssetCondition(asset.condition) === "under_maintenance";
      if (quickFilter === "needs_attention") return normalizeAssetCondition(asset.condition) === "needs_attention";
      if (quickFilter === "low_quantity") return normalizeAssetCondition(asset.condition) === "low_quantity";
      if (quickFilter === "missing") return normalizeAssetCondition(asset.condition) === "missing";
      if (quickFilter === "disposed") return normalizeAssetCondition(asset.condition) === "disposed";
      if (quickFilter === "high_variance") return assetSignalsById.get(asset.id)?.highVariance === true;
      if (quickFilter === "no_photo") return !asset.image_url && !asset.thumbnail_url;
      if (quickFilter === "inspected_today") {
        const latest = asset.last_inspection_at || inspections.find((inspection) => (inspection.items || []).some((item) => item.asset_id === asset.id))?.inspection_date;
        return formatRelativeDate(latest) === "Today";
      }
      return true;
    }), [assetSignalsById, inspections, maintenanceByAsset, quickFilter, scopedAssets]);

  const groupedAssets = useMemo(() => {
    const groups = new Map();
    filteredAssets.forEach((asset) => {
      const key = asset.category_id || "uncategorized";
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          name: asset.category_name || "Uncategorized",
          assets: [],
        });
      }
      groups.get(key).assets.push(asset);
    });
    return Array.from(groups.values()).map((group) => {
      const maintenanceDue = group.assets.filter((asset) => assetSignalsById.get(asset.id)?.maintenanceDue || assetSignalsById.get(asset.id)?.overdue).length;
      const attention = group.assets.filter((asset) => assetNeedsAttention(asset) || assetSignalsById.get(asset.id)?.overdue).length;
      return { ...group, maintenanceDue, attention };
    }).sort((first, second) => first.name.localeCompare(second.name));
  }, [assetSignalsById, filteredAssets]);

  const summary = useMemo(() => {
    const scopedAssetIds = new Set(scopedAssets.map((asset) => asset.id));
    const latestInspection = [...inspections]
      .filter((inspection) => !isDraftInspection(inspection))
      .filter((inspection) => (inspection.items || []).some((item) => scopedAssetIds.has(item.asset_id)))
      .sort(sortInspectionsNewestFirst)[0];
    const inspectedItems = (latestInspection?.items || []).filter((item) => scopedAssetIds.has(item.asset_id));
    const lastChecked = latestInspection?.inspection_date || scopedAssets.find((asset) => asset.last_inspection_at)?.last_inspection_at;
    const lastInspectionDetail = latestInspection
      ? inspectedItems.length === 1
        ? `${inspectedItems[0]?.asset?.name || "Asset"} inspected`
        : `${inspectedItems.length || latestInspection.summary?.checked_assets || latestInspection.summary?.total_assets || 0} assets inspected`
      : "No inspection yet";
    return {
      totalItems: scopedAssets.length,
      lastChecked,
      lastInspectionDetail,
    };
  }, [inspections, scopedAssets]);

  const operationalKpis = useMemo(() => {
    const operationalAssets = scopedAssets.filter((asset) => normalizeAssetCondition(asset.condition) !== "disposed");
    const operationalAssetIds = new Set(operationalAssets.map((asset) => asset.id));
    const scheduledMaintenance = maintenanceRecords.filter((record) => record.status === "scheduled" && operationalAssetIds.has(record.asset_id)).length;
    const activeMaintenanceAssetIds = new Set(maintenanceRecords
      .filter((record) => record.status === "in_progress")
      .map((record) => record.asset_id));
    const underMaintenance = operationalAssets.filter((asset) => normalizeAssetCondition(asset.condition) === "under_maintenance" || activeMaintenanceAssetIds.has(asset.id)).length;
    const missingLowQuantity = operationalAssets.filter((asset) => {
      const quantity = Number(asset.current_quantity || 0);
      const minimum = Number(asset.minimum_quantity || 0);
      const condition = normalizeAssetCondition(asset.condition);
      return condition === "missing" || condition === "low_quantity" || quantity <= 0 || (minimum > 0 && quantity <= minimum);
    }).length;
    const needsAttention = operationalAssets.filter((asset) => normalizeAssetCondition(asset.condition) === "needs_attention").length;
    const inspectedTodayAssetIds = new Set();
    inspections
      .filter((inspection) => formatRelativeDate(inspection.inspection_date) === "Today")
      .forEach((inspection) => {
        (inspection.items || []).forEach((item) => inspectedTodayAssetIds.add(item.asset_id));
      });
    const recentlyInspected = operationalAssets.filter((asset) => inspectedTodayAssetIds.has(asset.id) || formatRelativeDate(asset.last_inspection_at) === "Today").length;
    const missingAssets = operationalAssets.filter((asset) => normalizeAssetCondition(asset.condition) === "missing" || Number(asset.current_quantity || 0) <= 0).length;
    const lowQuantity = operationalAssets.filter((asset) => {
      const quantity = Number(asset.current_quantity || 0);
      const minimum = Number(asset.minimum_quantity || 0);
      return normalizeAssetCondition(asset.condition) === "low_quantity" || (minimum > 0 && quantity <= minimum);
    }).length;
    const disposed = scopedAssets.filter((asset) => normalizeAssetCondition(asset.condition) === "disposed").length;
    return { scheduledMaintenance, underMaintenance, missingLowQuantity, needsAttention, recentlyInspected, missingAssets, lowQuantity, disposed };
  }, [scopedAssets, inspections, maintenanceRecords]);

  const recentActivityRows = useMemo(() => {
    const importedAssetIds = new Set(movements.filter((movement) => movement.reason === "import").map((movement) => movement.asset_id));
    const assetRows = assets
      .filter((asset) => asset.created_at && !importedAssetIds.has(asset.id))
      .slice(0, 6)
      .map((asset) => ({
        id: `asset-created-${asset.id}`,
        date: asset.created_at,
        title: "Asset Added",
        detail: `${asset.name} was added to Asset Tracking.`,
        type: "created",
        actor: activityActorLabel("Created", asset.created_by, auth, actorDisplayName),
      }));
    const movementRows = movements.slice(0, 8).map((movement) => {
      const assetName = assetNameById(assets, movement.asset_id);
      const meta = movementActivityMeta(movement, assetName);
      return {
        id: `movement-${movement.id}`,
        date: activityTimestamp(movement),
        title: meta.title,
        detail: meta.description,
        type: meta.type,
        actor: activityActorLabel(meta.actorPrefix, movement.created_by, auth, actorDisplayName),
      };
    });
    const maintenanceRows = maintenanceRecords.slice(0, 6).map((record) => ({
      id: `maintenance-${record.id}`,
      date: activityTimestamp(record) || record.completed_date || record.scheduled_date || record.date,
      title: record.status === "completed" ? "Maintenance Completed" : "Maintenance Scheduled",
      detail: record.issue || maintenanceTypeLabel(record.maintenance_type),
      type: "maintenance",
      actor: activityActorLabel(record.status === "completed" ? "Completed" : "Scheduled", record.created_by, auth, actorDisplayName),
      metadata: assetNameById(assets, record.asset_id),
    }));
    const inspectionRows = inspections.slice(0, 6).map((inspection) => ({
      id: `inspection-${inspection.id}`,
      date: activityTimestamp(inspection) || inspection.inspection_date,
      title: "Inspection Completed",
      detail: `${inspection.summary?.total_assets || (inspection.items || []).length || 0} assets checked`,
      type: "inspection",
      actor: inspectionActorLabel(inspection, auth, actorDisplayName),
    }));
    return [...movementRows, ...maintenanceRows, ...inspectionRows, ...assetRows]
      .filter((row) => row.date)
      .sort((first, second) => new Date(second.date) - new Date(first.date))
      .slice(0, 8);
  }, [actorEmployees, assets, auth, inspections, maintenanceRecords, movements]);

  async function saveAsset(asset) {
    if ((asset.id && !canEditAsset) || (!asset.id && !canAdd)) {
      notifyPermissionDenied(ui, asset.id ? "edit assets" : "create assets");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.saveAsset(asset);
      setAssetModal(null);
      await loadData();
      ui.notify({ title: asset.id ? "Asset updated" : "Asset created", message: asset.name });
    } catch (saveError) {
      console.error("Unable to save asset", saveError);
      ui.notify({ title: "Unable to save asset", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function openAssetImport() {
    if (!canAdd && !canEditAsset) {
      notifyPermissionDenied(ui, "import assets");
      return;
    }
    try {
      const allAssets = await assetTrackingService.listAssets("all");
      setImportAssets(allAssets);
    } catch (loadImportError) {
      console.warn("Unable to load all assets for import matching; using current outlet list.", loadImportError);
      setImportAssets(assets);
    }
    setAssetImportOpen(true);
  }

  async function importAssetRows(previewRows) {
    if (!canAdd && !canEditAsset) {
      notifyPermissionDenied(ui, "import assets");
      return { created: 0, updated: 0, skipped: 0, failed: previewRows.length, failures: [{ rowNumber: "-", message: "No permission to import assets." }] };
    }
    const invalidRows = previewRows.filter((row) => row.errors.length);
    const validRows = previewRows.filter((row) => !row.errors.length);
    const summary = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: invalidRows.length,
      failures: invalidRows.map((row) => ({ rowNumber: row.rowNumber, message: row.errors.join("; ") })),
    };
    for (const row of validRows) {
      const isUpdate = row.action === "update";
      if ((isUpdate && !canEditAsset) || (!isUpdate && !canAdd)) {
        summary.failed += 1;
        summary.failures.push({ rowNumber: row.rowNumber, message: isUpdate ? "No permission to update asset." : "No permission to create asset." });
        continue;
      }
      try {
        const beforeQuantity = Number(row.existing?.current_quantity ?? 0);
        if (import.meta.env.DEV) {
          console.log("[AssetImportDebug]", {
            rowNumber: row.rowNumber,
            action: row.action,
            payload: row.asset,
          });
        }
        const savedAsset = await assetTrackingService.saveAsset(row.asset);
        await assetTrackingService.logImportMovement(savedAsset, {
          beforeQuantity: isUpdate ? beforeQuantity : 0,
          afterQuantity: Number(savedAsset.current_quantity ?? row.asset.current_quantity ?? 0),
          remark: isUpdate ? "Asset updated from import" : "Asset created from import",
        }).catch((movementError) => {
          if (import.meta.env.DEV) console.warn("[AssetImportMovementDebug]", movementError);
        });
        if (isUpdate) summary.updated += 1;
        else summary.created += 1;
      } catch (importError) {
        console.error("Unable to import asset row", { rowNumber: row.rowNumber, error: importError });
        summary.failed += 1;
        summary.failures.push({ rowNumber: row.rowNumber, message: importError.message || "Supabase write failed." });
      }
    }
    await loadData();
    setImportAssets(await assetTrackingService.listAssets("all").catch(() => assets));
    if (summary.created || summary.updated) {
      ui.notify({ title: "Asset import completed", message: `${summary.created} created, ${summary.updated} updated.` });
    }
    if (!summary.created && !summary.updated && summary.failed) {
      ui.notify({ title: "No assets imported", message: "Fix validation errors and try again.", tone: "error" });
    }
    return summary;
  }

  async function saveCategory(category) {
    if ((category.id && !canEditAsset) || (!category.id && !canAdd)) {
      notifyPermissionDenied(ui, category.id ? "edit asset categories" : "create asset categories");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.saveCategory(category);
      await loadData();
      ui.notify({ title: "Category saved", message: category.name });
    } catch (saveError) {
      console.error("Unable to save category", saveError);
      ui.notify({ title: "Unable to save category", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function archiveCategory(category) {
    if (!canDeleteAsset) {
      notifyPermissionDenied(ui, "archive asset categories");
      return;
    }
    try {
      await assetTrackingService.archiveCategory(category);
      await loadData();
      ui.notify({ title: "Category archived", message: category.name });
    } catch (archiveError) {
      console.error("Unable to archive category", archiveError);
      ui.notify({ title: "Unable to archive category", message: archiveError.message || "Please try again.", tone: "error" });
    }
  }

  async function reorderCategories(nextCategories) {
    if (!canAdd && !canEditAsset) {
      notifyPermissionDenied(ui, "reorder asset categories");
      return;
    }
    try {
      const reordered = await assetTrackingService.reorderCategories(nextCategories);
      setCategories(reordered);
      ui.notify({ title: "Order updated", message: "Category order saved." });
    } catch (reorderError) {
      console.error("Unable to reorder categories", reorderError);
      ui.notify({ title: "Unable to update order", message: reorderError.message || "Please try again.", tone: "error" });
      await loadData();
    }
  }

  async function adjustQuantity(values) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "adjust asset quantity");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.adjustQuantity(adjustAsset, values);
      setAdjustAsset(null);
      await loadData();
      ui.notify({ title: "Quantity adjusted", message: adjustAsset.name });
    } catch (adjustError) {
      console.error("Unable to adjust quantity", adjustError);
      ui.notify({ title: "Unable to adjust quantity", message: adjustError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function submitInspection(payload) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "submit asset inspections");
      return;
    }
    setSaving(true);
    try {
      await assetTrackingService.submitInspection(payload);
      setInspectionOpen(false);
      await loadData();
      ui.notify({ title: payload.status === "draft" ? "Inspection draft saved" : "Inspection submitted" });
    } catch (inspectionError) {
      console.error("Unable to submit inspection", inspectionError);
      ui.notify({ title: "Unable to submit inspection", message: inspectionError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function updateInspectionStatus(inspection, status) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "manage inspection drafts");
      return;
    }
    try {
      await assetTrackingService.updateInspectionStatus(inspection.id, status);
      await loadData();
      ui.notify({ title: status === "archived" ? "Draft archived" : "Inspection updated" });
    } catch (statusError) {
      console.error("Unable to update inspection", statusError);
      ui.notify({ title: "Unable to update inspection", message: statusError.message || "Please try again.", tone: "error" });
    }
  }

  async function deleteInspection(inspection) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "delete inspection drafts");
      return;
    }
    try {
      await assetTrackingService.deleteInspection(inspection.id);
      await loadData();
      ui.notify({ title: "Draft deleted" });
    } catch (deleteError) {
      console.error("Unable to delete inspection", deleteError);
      ui.notify({ title: "Unable to delete draft", message: deleteError.message || "Please try again.", tone: "error" });
    }
  }

  async function archiveAsset(asset) {
    if (!canDeleteAsset) {
      notifyPermissionDenied(ui, "archive assets");
      return;
    }
    try {
      await assetTrackingService.archiveAsset(asset);
      await loadData();
      ui.notify({ title: "Asset archived", message: asset.name });
    } catch (archiveError) {
      console.error("Unable to archive asset", archiveError);
      ui.notify({ title: "Unable to archive asset", message: archiveError.message || "Please try again.", tone: "error" });
    }
  }

  async function saveMaintenanceRecord(values, assetOverride = null) {
    if (!canManageAsset) {
      notifyPermissionDenied(ui, "add maintenance records");
      return;
    }
    const targetAsset = assetOverride || maintenanceContext?.asset;
    if (!targetAsset) return;
    setSaving(true);
    try {
      const result = await assetTrackingService.saveMaintenanceRecord(targetAsset, values);
      setMaintenanceRecords((current) => {
        const withoutCurrent = current.filter((record) => record.id !== result.record.id);
        return [result.record, ...withoutCurrent].sort(sortMaintenanceNewestFirst);
      });
      if (result.condition) {
        setAssets((current) => current.map((asset) => asset.id === targetAsset.id ? { ...asset, condition: result.condition } : asset));
        if (detailAsset?.id === targetAsset.id) setDetailAsset((current) => ({ ...current, condition: result.condition }));
      }
      if (!assetOverride) setMaintenanceContext(null);
      ui.notify({ title: values.id ? "Maintenance record updated" : "Maintenance record added", message: targetAsset.name });
      return result;
    } catch (maintenanceError) {
      console.error("Unable to save maintenance record", maintenanceError);
      ui.notify({ title: "Unable to save maintenance", message: maintenanceError.message || "Please try again.", tone: "error" });
      throw maintenanceError;
    } finally {
      setSaving(false);
    }
  }

  async function quickUpdateCondition(asset, condition) {
    if (!canEditAsset) {
      notifyPermissionDenied(ui, "update asset condition");
      return;
    }
    const nextCondition = normalizeAssetCondition(condition);
    const previousAssets = assets;
    const previousDetailAsset = detailAsset;
    setConditionMenu(null);
    setConditionUpdatingId(asset.id);
    setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, condition: nextCondition } : item));
    if (detailAsset?.id === asset.id) setDetailAsset((current) => ({ ...current, condition: nextCondition }));
    try {
      const updatedAsset = await assetTrackingService.updateAssetCondition(asset, nextCondition);
      setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, ...updatedAsset } : item));
      if (detailAsset?.id === asset.id) setDetailAsset((current) => ({ ...current, ...updatedAsset }));
      ui.notify({ title: "Condition updated", message: `${asset.name} is now ${assetConditionLabel(nextCondition)}.` });
    } catch (conditionError) {
      console.error("Unable to update asset condition", conditionError);
      setAssets(previousAssets);
      setDetailAsset(previousDetailAsset);
      ui.notify({ title: "Unable to update condition", message: conditionError.message || "Please try again.", tone: "error" });
    } finally {
      setConditionUpdatingId("");
    }
  }

  const assetMovements = detailAsset ? movements.filter((movement) => movement.asset_id === detailAsset.id) : [];
  const assetMaintenanceRecords = detailAsset ? maintenanceRecords.filter((record) => record.asset_id === detailAsset.id) : [];
  const assetInspections = detailAsset ? inspections.filter((inspection) => (
    (inspection.items || []).some((item) => item.asset_id === detailAsset.id) ||
    (isDraftInspection(inspection) && (inspection.draft_data?.rows || []).some((row) => row.asset_id === detailAsset.id))
  )).sort(sortInspectionsNewestFirst) : [];
  const draftInspections = inspections.filter(isDraftInspection);
  function applyOperationalFilter(filterValue) {
    setQuickFilter((current) => current === filterValue ? "all" : filterValue);
  }

  function applyConditionFilter(condition) {
    setQuickFilter((current) => current === condition ? "all" : condition);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Asset Tracking"
        description="Track outlet assets, quantities, inspections, and movement logs."
        actions={(
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" type="button" disabled={!canExportAsset} onClick={() => ui.notify({ title: "Export prepared", message: "Asset export will be connected to the export service." })}><Download size={16} /> Export</button>
            <button className="btn-secondary" type="button" onClick={() => setCategoryModalOpen(true)}><Settings2 size={16} /> Categories</button>
            {(canAdd || canEditAsset) ? <button className="btn-secondary" type="button" onClick={openAssetImport}><UploadCloud size={16} /> Import</button> : null}
            {canManageAsset ? <button className="btn-secondary" type="button" onClick={() => setInspectionOpen(true)}><SlidersHorizontal size={16} /> Start Inspection</button> : null}
            {canAdd ? <button className="btn-primary" type="button" onClick={() => setAssetModal({ ...emptyAsset(), outlet_id: outletId })}><Plus size={16} /> Add Asset</button> : null}
          </div>
        )}
      />

      <Card className="p-4">
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr_1.4fr] xl:items-end">
          <FieldLabel label="Outlet"><SelectField value={outletId} options={activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={setOutletId} /></FieldLabel>
          <FieldLabel label="Category"><SelectField value={categoryFilter} options={[{ value: "all", label: "All Categories" }, ...categories.filter((category) => category.is_active).map((category) => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} searchable /></FieldLabel>
          <FieldLabel label="Condition"><SelectField value={statusFilter} options={[{ value: "all", label: "All Conditions" }, ...assetConditions.map((condition) => ({ value: condition, label: assetConditionLabel(condition) }))]} onChange={(value) => { setQuickFilter("all"); setStatusFilter(value); }} /></FieldLabel>
          <FieldLabel label="Search Asset"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} /><input className="control h-10 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset name..." /></div></FieldLabel>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["scheduled_maintenance", "Scheduled Maintenance"],
            ["maintenance_due", "Maintenance Due"],
            ["inspected_today", "Recently Inspected"],
            ["high_variance", "High Variance"],
            ["no_photo", "No Photo"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${quickFilter === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-white text-text-secondary hover:border-primary/30 hover:text-primary"}`}
              type="button"
              onClick={() => applyOperationalFilter(value)}
            >
              {label}
            </button>
          ))}
          {quickFilter !== "all" ? <button className="rounded-full px-3 py-1.5 text-xs font-black text-text-muted hover:text-text-primary" type="button" onClick={() => setQuickFilter("all")}>Clear filter</button> : null}
        </div>
        {quickFilter !== "all" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs font-bold text-text-secondary">
            <span>Viewing:</span>
            <span className="font-black text-primary">{quickFilterLabels[quickFilter] || "Filtered Assets"} assets</span>
            <button className="ml-auto text-xs font-black text-text-muted hover:text-text-primary" type="button" onClick={() => setQuickFilter("all")}>Clear Filter</button>
          </div>
        ) : null}
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}

      {draftInspections.length ? (
        <Card className="border-amber-200 bg-amber-50/60 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Draft Inspections</div>
              <div className="mt-1 text-lg font-black text-text-primary">{draftInspections.length} pending {draftInspections.length === 1 ? "inspection" : "inspections"} require completion.</div>
            </div>
            <div className="grid flex-1 gap-3 lg:max-w-3xl">
              {draftInspections.slice(0, 3).map((inspection) => {
                const outlet = activeOutlets.find((item) => item.id === inspection.outlet_id);
                const progress = inspectionProgress(inspection);
                const scope = inspection.category_scope?.type === "selected"
                  ? `${inspection.category_scope.category_ids?.length || 0} selected categories`
                  : "All Categories";
                return (
                  <div key={inspection.id} className="rounded-2xl border border-amber-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-black text-text-primary">{outlet?.name || "Outlet"}</span>
                          <Badge tone="warning">{draftStatusLabel(inspection.status)}</Badge>
                        </div>
                        <div className="mt-1 text-xs font-semibold text-text-secondary">{scope} · Saved <DateText value={inspection.last_edited_at || inspection.updated_at} /></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="mt-1 text-xs font-bold text-text-muted">{progress}% completed · {inspection.summary?.critical_alerts || 0} critical · {inspection.summary?.pending_evidence || 0} evidence pending</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-primary h-9 px-3 text-xs" type="button" onClick={() => setInspectionOpen(inspection)}>Resume Inspection</button>
                        <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setInspectionOpen({ ...inspection, id: "", status: "draft" })}>Duplicate</button>
                        <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => updateInspectionStatus(inspection, "archived")}>Archive</button>
                        <button className="btn-secondary h-9 px-3 text-xs text-rose-700" type="button" onClick={() => deleteInspection(inspection)}>Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : null}

      {!activeOutlets.length ? (
        <Card className="p-8 text-center">
          <div className="text-sm font-bold uppercase tracking-[0.16em] text-text-muted">No Outlet Access</div>
          <div className="mt-2 text-lg font-semibold text-text-primary">No outlets are assigned to your role.</div>
          <p className="mt-2 text-sm text-text-secondary">Please contact admin to review your outlet access.</p>
        </Card>
      ) : null}

      {activeOutlets.length ? <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-2">
        <MetricCard size="compact" label="Total Asset Items" value={summary.totalItems} helper="Assets in selected scope" />
        <MetricCard size="compact" label="Last Inspection" value={summary.lastChecked ? formatFullDate(summary.lastChecked) : "No inspection yet"} helper={summary.lastInspectionDetail} />
      </div> : null}

      {activeOutlets.length ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.95fr)]">
          <DashboardSection title="Recent Activity" subtitle="Latest operational event stream." density="compact">
            <ActivityTimeline
              events={recentActivityRows.map((row) => ({
                id: row.id,
                date: row.date,
                type: row.type || (row.title?.toLowerCase().includes("maintenance") ? "maintenance" : row.title?.toLowerCase().includes("inspection") ? "inspection" : "movement"),
                title: row.title,
                description: row.detail,
                actor: row.actor,
                metadata: row.metadata,
              }))}
              empty="Operational activity will appear after inspections, movements and maintenance updates."
            />
          </DashboardSection>

          <DashboardSection title="Asset Operations Summary" subtitle="Current asset workflow signals." density="compact">
            <div className="grid gap-1.5">
              {[
                ["Scheduled Maintenance", operationalKpis.scheduledMaintenance, "Upcoming service tasks", { type: "quick", value: "scheduled_maintenance" }, "bg-cyan-50 text-cyan-700 border-cyan-100"],
                ["Under Maintenance", operationalKpis.underMaintenance, "Active repair work", { type: "condition", value: "under_maintenance" }, "bg-blue-50 text-blue-700 border-blue-100"],
                ["Needs Attention", operationalKpis.needsAttention, "Minor issue needs follow-up", { type: "condition", value: "needs_attention" }, "bg-amber-50 text-amber-700 border-amber-100"],
                ["Low Quantity", operationalKpis.lowQuantity, "At or below minimum level", { type: "condition", value: "low_quantity" }, "bg-orange-50 text-orange-700 border-orange-100"],
                ["Missing Asset", operationalKpis.missingAssets, "Unavailable or zero quantity", { type: "condition", value: "missing" }, "bg-rose-50 text-rose-700 border-rose-100"],
                ["Disposed", operationalKpis.disposed, "Written off / no longer operational", { type: "condition", value: "disposed" }, "bg-slate-50 text-slate-600 border-slate-200"],
                ["Recently Inspected", operationalKpis.recentlyInspected, "Checked today", { type: "quick", value: "inspected_today" }, "bg-emerald-50 text-emerald-700 border-emerald-100"],
              ].map(([label, value, helper, filter, className]) => {
                const active = quickFilter === filter.value;
                const muted = Number(value) === 0;
                return (
                <button
                  key={label}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors hover:shadow-sm ${className} ${active ? "ring-2 ring-primary/25 shadow-sm" : ""} ${muted && !active ? "opacity-65" : ""}`}
                  type="button"
                  onClick={() => filter.type === "condition" ? applyConditionFilter(filter.value) : applyOperationalFilter(filter.value)}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-black text-current">{label}</div>
                    <div className="mt-0.5 truncate text-[11px] font-semibold opacity-75">{helper}</div>
                  </div>
                  <div className="shrink-0 text-lg font-black">{value}</div>
                </button>
              );})}
            </div>
          </DashboardSection>
        </div>
      ) : null}

      {activeOutlets.length ? <Card title="Asset List" description="Grouped by category with quick operational updates.">
        {loading ? <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading assets...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="border-b border-border bg-slate-50 text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  {["Asset", "Outlet", "Current Quantity", "Condition", "Last Checked", "Last Movement", "Actions"].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groupedAssets.map((group) => {
                  const isCollapsed = collapsedGroups[group.id] === true;
                  const attentionCount = group.attention;
                  return (
                    <Fragment key={group.id}>
                      <tr key={`${group.id}-header`} className="bg-slate-50/80">
                        <td colSpan={7} className="px-4 py-3">
                          <button className="flex w-full items-center justify-between gap-3 text-left" type="button" onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}>
                            <span className="flex flex-wrap items-center gap-2">
                              <span>
                                <span className="block text-sm font-black text-text-primary">{group.name}</span>
                                <span className="text-xs font-semibold text-text-secondary">{group.assets.length} assets</span>
                              </span>
                              {attentionCount ? <Badge tone="warning">Health Watch</Badge> : null}
                            </span>
                            <span className="rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-black text-text-secondary">{isCollapsed ? "Expand" : "Collapse"}</span>
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed ? group.assets.map((asset) => {
                        const outlet = activeOutlets.find((item) => item.id === asset.outlet_id);
                        const lastMovement = movementByAsset.get(asset.id);
                        const lastInspection = inspectionByAsset.get(asset.id);
                        const quantityHealth = getQuantityHealth(asset);
                        const signals = assetSignalsById.get(asset.id) || {};
                        const latestMaintenance = (maintenanceByAsset.get(asset.id) || [])[0];
                        const movementDate = lastMovement?.movement_date || latestMaintenance?.completed_date || latestMaintenance?.scheduled_date || latestMaintenance?.date;
                        const movementDisplay = lastMovement
                          ? latestMovementSummary(lastMovement)
                          : latestMaintenance
                            ? `Maintenance · ${maintenanceStatusLabel(latestMaintenance.status)}`
                            : "—";
                        return (
                          <tr key={asset.id} className="group table-row-interactive">
                            <td className="px-4 py-3">
                              <div className="flex max-w-[360px] items-center gap-3 text-left">
                                <button type="button" onClick={() => setImagePreviewAsset(asset)} aria-label={`Preview ${asset.name} image`}>
                                  <AssetThumbnail asset={asset} interactive />
                                </button>
                                <span className="min-w-0">
                                  <button className="block truncate text-left font-black text-text-primary transition hover:text-primary" type="button" onClick={() => setDetailAsset(asset)}>{asset.name}</button>
                                  <span className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{asset.description || asset.remark || "No description"}</span>
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-text-secondary">{outlet?.name || "—"}</td>
                            <td className="px-4 py-3">
                              <div className={`inline-flex min-w-[124px] items-center justify-between gap-3 rounded-2xl border px-3 py-2 ${quantityHealth.border} ${quantityHealth.bg}`}>
                                <span className="text-lg font-black text-text-primary">{asset.current_quantity}</span>
                                <span className={`inline-flex items-center gap-1.5 text-[11px] font-black ${quantityHealth.text}`}>{asset.unit}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                className={`transition ${canEditAsset ? "cursor-pointer hover:brightness-95" : "cursor-not-allowed opacity-80"}`}
                                type="button"
                                disabled={!canEditAsset || conditionUpdatingId === asset.id}
                                onClick={(event) => setConditionMenu({ asset, anchor: event.currentTarget.getBoundingClientRect() })}
                              >
                                <Badge tone={assetConditionTone(asset.condition)}>{conditionUpdatingId === asset.id ? "Saving..." : assetConditionLabel(asset.condition)}</Badge>
                              </button>
                            </td>
                            <td className="px-4 py-3 text-text-secondary"><DateText value={lastInspection?.inspection_date || asset.last_inspection_at} /></td>
                            <td className="px-4 py-3 text-text-secondary">
                              {movementDisplay === "—" ? "—" : (
                                <span title={formatRelativeDate(movementDate)}>
                                  <span className="font-bold text-text-primary">{movementDisplay}</span>
                                  <span className="block text-[11px] font-semibold text-text-muted">{formatFullDate(movementDate)}</span>
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="table-action-cell">
                                <button
                                  className="btn-secondary h-8 px-2 text-xs"
                                  type="button"
                                  onMouseEnter={(event) => setAssetPreview({ asset, anchor: event.currentTarget.getBoundingClientRect(), lastInspection, lastMovement, signals })}
                                  onMouseLeave={() => setAssetPreview(null)}
                                  onClick={() => setDetailAsset(asset)}
                                >
                                  <Eye size={13} /> View
                                </button>
                                <button className="icon-btn h-8 w-8" type="button" onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setActionMenu({ asset, anchor: event.currentTarget.getBoundingClientRect() });
                                }} aria-label={`More actions for ${asset.name}`}>
                                  <MoreHorizontal size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!filteredAssets.length ? <div className="p-8 text-center text-sm font-semibold text-text-secondary">No assets found for the selected filters.</div> : null}
          </div>
        )}
      </Card> : null}

      {assetModal ? <AssetFormModal asset={assetModal} outlets={activeOutlets} categories={categories} onClose={() => setAssetModal(null)} onSubmit={saveAsset} saving={saving} /> : null}
      {assetImportOpen ? <AssetImportModal assets={importAssets.length ? importAssets : assets} outlets={activeOutlets} categories={categories} onClose={() => setAssetImportOpen(false)} onImport={importAssetRows} /> : null}
      {categoryModalOpen ? <CategoryModal categories={categories} assets={assets} onClose={() => setCategoryModalOpen(false)} onSave={saveCategory} onArchive={archiveCategory} onReorder={reorderCategories} saving={saving} canWrite={canAdd || canEditAsset} canArchive={canDeleteAsset} /> : null}
      {adjustAsset ? <AdjustQuantityModal asset={adjustAsset} onClose={() => setAdjustAsset(null)} onSubmit={adjustQuantity} saving={saving} /> : null}
      {maintenanceContext ? <MaintenanceRecordModal asset={maintenanceContext.asset} record={maintenanceContext.record} onClose={() => setMaintenanceContext(null)} onSubmit={saveMaintenanceRecord} saving={saving} /> : null}
      {inspectionOpen ? <InspectionModal outletId={inspectionOpen?.outlet_id || outletId} categories={categories} assets={assets} draftInspection={inspectionOpen === true ? null : inspectionOpen} defaultCheckedBy={currentInspectorName} defaultCheckedById={currentInspectorId} onClose={() => setInspectionOpen(false)} onSubmit={submitInspection} saving={saving} /> : null}
      {detailAsset ? <AssetDetailDrawer asset={detailAsset} outlet={activeOutlets.find((outlet) => outlet.id === detailAsset.outlet_id)} movements={assetMovements} inspections={assetInspections} maintenanceRecords={assetMaintenanceRecords} currentProfile={auth?.profile} actorNameResolver={actorDisplayName} onClose={() => setDetailAsset(null)} onResumeDraft={(inspection) => setInspectionOpen(inspection)} onDeleteDraft={deleteInspection} onArchiveDraft={(inspection) => updateInspectionStatus(inspection, "archived")} onSaveMaintenance={(asset, values) => saveMaintenanceRecord(values, asset)} saving={saving} /> : null}
      {assetPreview ? <FloatingPreviewLayer anchor={assetPreview.anchor} width={300}>
        <div className="overflow-hidden rounded-3xl border border-border bg-white shadow-2xl">
          <div className="p-3">
            <div className="flex gap-3">
              <AssetThumbnail asset={assetPreview.asset ?? { name: "Unknown Asset" }} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-text-primary">{assetPreview.asset?.name ?? "Unknown Asset"}</div>
                <div className="mt-0.5 text-xs font-semibold text-text-secondary">{activeOutlets.find((outlet) => outlet.id === assetPreview.asset?.outlet_id)?.name || "Unknown outlet"}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={assetConditionTone(assetPreview.asset?.condition)}>{assetConditionLabel(assetPreview.asset?.condition)}</Badge>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs font-semibold text-text-secondary">
              <div>Last inspection: <span className="font-black text-text-primary">{formatFullDate(assetPreview.lastInspection?.inspection_date || assetPreview.asset?.last_inspection_at)}</span></div>
              <div>Recent issue: <span className="font-black text-text-primary">{assetPreview.asset ? assetHoverInsight(assetPreview.asset, assetPreview.lastMovement, assetPreview.lastInspection) : "No movement yet"}</span></div>
            </div>
          </div>
        </div>
      </FloatingPreviewLayer> : null}
      <FloatingLayer open={Boolean(conditionMenu)} onOpenChange={(open) => { if (!open) setConditionMenu(null); }} anchorRect={conditionMenu?.anchor} width={220} minWidth={220} align="start" estimatedHeight={260} className="p-0">
        <div className="overflow-hidden rounded-2xl border border-border bg-white p-1.5 shadow-2xl">
          <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-text-muted">Update Condition</div>
          {assetConditions.map((condition) => (
            <button
              key={condition}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-black transition hover:bg-primary/5 ${conditionMenu?.asset?.condition === condition ? "text-primary" : "text-text-secondary"}`}
              type="button"
              onClick={() => conditionMenu?.asset ? quickUpdateCondition(conditionMenu.asset, condition) : setConditionMenu(null)}
            >
              <span>{assetConditionLabel(condition)}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${getQuantityHealth({ condition, current_quantity: condition === "missing" ? 0 : 1 }).dot}`} />
            </button>
          ))}
        </div>
      </FloatingLayer>
      <FloatingLayer open={Boolean(actionMenu)} onOpenChange={(open) => { if (!open) setActionMenu(null); }} anchorRect={actionMenu?.anchor} width={220} minWidth={220} estimatedHeight={286} align="end" className="p-0">
        <div className="rounded-2xl border border-border bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
          <FloatingActionItem icon={<Eye size={13} />} onClick={() => { const asset = actionMenu?.asset; setActionMenu(null); if (asset) setDetailAsset(asset); }}>View</FloatingActionItem>
          {canManageAsset ? <FloatingActionItem icon={<Wrench size={13} />} onClick={() => { const asset = actionMenu?.asset; setActionMenu(null); if (asset) setAdjustAsset(asset); }}>Adjust Quantity</FloatingActionItem> : null}
          {canManageAsset ? <FloatingActionItem icon={<ClipboardCheck size={13} />} onClick={() => { setActionMenu(null); setInspectionOpen(true); }}>Start Inspection</FloatingActionItem> : null}
          {(canEditAsset || (canManageAsset && actionMenu?.asset?.maintenance_allowed)) ? <div className="my-1 border-t border-border" /> : null}
          {canEditAsset ? <FloatingActionItem icon={<PackageCheck size={13} />} onClick={() => { const asset = actionMenu?.asset; setActionMenu(null); if (asset) setAssetModal(asset); }}>Edit Asset</FloatingActionItem> : null}
          {canManageAsset && actionMenu?.asset?.maintenance_allowed ? <FloatingActionItem icon={<Wrench size={13} />} onClick={() => { const asset = actionMenu?.asset; setActionMenu(null); if (asset) setMaintenanceContext({ asset, record: null }); }}>Add Maintenance Record</FloatingActionItem> : null}
          {canDeleteAsset ? <div className="my-1 border-t border-border" /> : null}
          {canDeleteAsset ? <FloatingActionItem tone="warning" icon={<AlertTriangle size={13} />} onClick={() => { const asset = actionMenu?.asset; setActionMenu(null); if (asset) archiveAsset(asset); }}>Archive</FloatingActionItem> : null}
        </div>
      </FloatingLayer>
      {imagePreviewAsset ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
          <button className="absolute inset-0" type="button" aria-label="Close image preview" onClick={() => { setImagePreviewAsset(null); setImagePreviewZoom(false); }} />
          <div className="relative max-w-[92vw] rounded-3xl bg-white p-3 shadow-2xl">
            {imagePreviewAsset.image_url || imagePreviewAsset.thumbnail_url ? (
              <img className={`${imagePreviewZoom ? "max-h-none max-w-none scale-125 cursor-zoom-out" : "max-h-[78vh] max-w-[82vw] cursor-zoom-in"} rounded-2xl object-contain transition`} src={imagePreviewAsset.image_url || imagePreviewAsset.thumbnail_url} alt={imagePreviewAsset.name} onClick={() => setImagePreviewZoom((current) => !current)} />
            ) : (
              <div className="flex h-72 w-72 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-slate-100 text-3xl font-black text-primary">{categoryIcon(imagePreviewAsset.category_name)}</div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-text-primary">{imagePreviewAsset.name}</div>
                <div className="text-xs text-text-secondary">{imagePreviewAsset.category_name}</div>
              </div>
              <div className="flex items-center gap-2">
                {imagePreviewAsset.image_url || imagePreviewAsset.thumbnail_url ? <button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={() => setImagePreviewZoom((current) => !current)}>{imagePreviewZoom ? "Fit" : "Zoom"}</button> : null}
                <button className="icon-btn" type="button" onClick={() => { setImagePreviewAsset(null); setImagePreviewZoom(false); }}><X size={18} /></button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
