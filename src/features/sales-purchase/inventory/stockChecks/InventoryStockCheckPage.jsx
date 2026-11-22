import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ClipboardCheck, Eye, Info, Minus, Plus, Trash2 } from "lucide-react";
import PageHeader from "../../../../components/layout/PageHeader.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import InfoTooltip from "../../../../components/ui/InfoTooltip.jsx";
import DataTable from "../../../../components/tables/DataTable.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import DatePickerField from "../../../../components/forms/DatePickerField.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import InventoryItemThumbnail from "../InventoryItemThumbnail.jsx";
import InventoryItemPhotoPreview from "../InventoryItemPhotoPreview.jsx";
import { SectionCard, TextArea, selectInputText, parseNonNegativeNumber, todayInput, getBusinessDateInput, toDateInputValue } from "../InventorySharedPresentation.jsx";
import { normalizeOutletRecord, uniqueIds, outletConfigForItem, isActiveInventoryItem } from "../inventoryItemModel.js";
import { stockCheckGroupDueOnDate, stockCheckItemsForGroup } from "../groups/inventoryGroupsModel.js";
import { linkedPurchaseOrdersForStockCheck } from "../purchaseOrders/inventoryPurchaseOrderHelpers.js";
import { getAccessibleOutletOptions, getAccessibleOutlets, hasPermission, notifyPermissionDenied } from "../../../../utils/accessControl.js";
import { resolveAdminLocation, navigateAdminRoute } from "../../../../app/routeOwnership.js";
import { invalidateInventoryReads, subscribeInventoryRevalidation } from "../../../../services/inventoryRevalidation.js";
import { loadStockCheckExecution, persistRemoteStockCheck, deleteRemoteStockCheckDraft } from "./inventoryStockCheckExecutionService.js";
import FactoryPagination from "../../../factory/components/FactoryPagination.jsx";

const SHOW_STOCK_CHECK_CARD_DEBUG = import.meta.env.DEV && String(import.meta.env.VITE_SHOW_STOCK_CHECK_CARD_DEBUG ?? "false").toLowerCase() === "true";
const shifts = ["Opening", "Mid", "Closing", "Any Shift"];
import MonthPickerField from "../../../../components/forms/MonthPickerField.jsx";
import AuditCountTimestamps, { AuditCountTimestampFields } from "./AuditCountTimestamps.jsx";
import { formatClosingError, formatClosingMonthLabel, isValidClosingQuantity, MONTH_END_CLOSING, updateClosingAuditName, toClosingLocalTime } from "./monthEndClosing.js";
import { STOCK_CHECK_SKIP_REASONS, stockCheckSkipReason } from "./stockCheckSkipReasons.js";
import { indexStockCheckActors, stockCheckActorNames } from "./inventoryStockCheckActors.js";
import { employeeDisplayName } from "../waste/inventoryWasteService.js";
import { formatQuantity, projectStockCheckCount, stockCheckCountState, summarizeAuditRows } from "./inventoryStockCheckReadModel.js";

const auditTypes = [MONTH_END_CLOSING, "Full Stock Audit", "Spot Check", "Category Audit", "Custom Audit"];
const countStatusOptions = [
  { value: "all", label: "All Statuses" }, { value: "pending", label: "Pending" },
  { value: "counted", label: "Counted" }, { value: "skipped", label: "Skipped" },
];
function parLevelForOutlet(item = {}, outletId) { return outletConfigForItem(item, outletId).parLevel; }
function normalizeBusinessDate(value, fallback = todayInput()) {
  if (value instanceof Date) return toDateInputValue(value) || fallback;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  return toDateInputValue(raw) || fallback;
}

function stockCheckDateFromUrl() {
  if (typeof window === "undefined") return "";
  const route = resolveAdminLocation(window.location);
  const candidate = route?.routeId === "inventory_stock_check" || route?.routeId === "inventory_groups"
    ? route.query.date ?? ""
    : "";
  return candidate ? normalizeBusinessDate(candidate, "") : "";
}

function getInitialStockCheckDate() {
  const urlDate = stockCheckDateFromUrl();
  if (urlDate) return { date: urlDate, source: "url" };
  return { date: getBusinessDateInput("Asia/Kuala_Lumpur"), source: "business-today" };
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function debugLog(...args) {
  if (import.meta.env.DEV) console.log(...args);
}

function debugTable(...args) {
  if (import.meta.env.DEV) console.table(...args);
}

function toTitle(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}


function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTimeCompact(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}



function statusTone(status) {
  if (["active", "normal", "completed", "reviewed", "locked", "delivered", "fully_received"].includes(status)) return "success";
  if (["draft", "due today", "scheduled", "partial approved", "partial delivery", "partial_delivered", "partial_received"].includes(status)) return "warning";
  if (["critical", "shortage", "overdue", "missed", "rejected", "archived", "cancelled"].includes(status)) return "danger";
  if (["excess", "sent", "submitted", "confirmed", "supplier_confirmed", "ordered", "packing"].includes(status)) return "info";
  return "neutral";
}

function frequencyLabel(group) {
  if (group.frequency === "custom") return (group.checkDays || []).join(", ") || "Custom";
  if (group.frequency === "monthly") {
    if (group.monthDay === "last") return "Monthly · Last day";
    return `Monthly · Day ${group.monthDay || 1}`;
  }
  return "Custom";
}

function isGroupDue(group, date) {
  return stockCheckGroupDueOnDate(group, normalizeBusinessDate(date));
}

function sameStockCheckDate(left, right) {
  return String(left || "").slice(0, 10) === String(right || "").slice(0, 10);
}

function compareBusinessDates(left, right) {
  return normalizeBusinessDate(left).localeCompare(normalizeBusinessDate(right));
}

function isPastBusinessDate(value, reference = getBusinessDateInput("Asia/Kuala_Lumpur")) {
  return compareBusinessDates(value, reference) < 0;
}

function sameStockCheckShift(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function checkMatchesGroupRun(check = {}, group = {}, date, shiftFilter = "all") {
  const matchesShift = shiftFilter === "all" || !shiftFilter
    ? true
    : sameStockCheckShift(check.shift, shiftFilter);
  return check.stockCheckType !== "audit"
    && check.groupId === group.id
    && check.outletId === group.outletId
    && sameStockCheckDate(check.date, date)
    && matchesShift;
}

function submittedCheckForGroupRun(group = {}, checks = [], date, shiftFilter = "all") {
  return checks
    .filter((check) => checkMatchesGroupRun(check, group, date, shiftFilter) && ["submitted", "reviewed", "locked"].includes(check.status))
    .sort((a, b) => new Date(b.submittedAt || b.updatedAt || b.date || 0) - new Date(a.submittedAt || a.updatedAt || a.date || 0))[0] || null;
}

function draftCheckForGroupRun(group = {}, checks = [], date, shiftFilter = "all") {
  return checks
    .filter((check) => checkMatchesGroupRun(check, group, date, shiftFilter) && check.status === "draft")
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || b.date || 0) - new Date(a.updatedAt || a.createdAt || a.date || 0))[0] || null;
}

function dueStatus(group, checks, date, shiftFilter = "all") {
  if (submittedCheckForGroupRun(group, checks, date, shiftFilter)) return "Completed";
  if (checks.some((check) => checkMatchesGroupRun(check, group, date, shiftFilter) && check.status === "skipped")) return "Skipped";
  const draft = draftCheckForGroupRun(group, checks, date, shiftFilter);
  const due = isGroupDue(group, date);
  if (due && isPastBusinessDate(date)) return "Missed";
  if (draft) return "Draft";
  if (due) return "Due Today";
  return "Not Due";
}

function dueStatusDescription(status) {
  if (status === "Missed") return "This stock check was not completed on schedule.";
  if (status === "Skipped") return "Crew reviewed this requirement and skipped the count.";
  if (status === "Completed") return "Stock check completed for this date.";
  if (status === "Draft") return "Draft saved. Continue counting today.";
  if (status === "Due Today") return "Ready to count on the assigned date.";
  return "";
}

function canStartScheduledStockCheckForDate(group, date) {
  return isGroupDue(group, date) && compareBusinessDates(date, getBusinessDateInput("Asia/Kuala_Lumpur")) === 0;
}

function isActionableStockCheckStatus(status) {
  return ["Due Today", "Completed", "Draft", "Skipped", "Missed"].includes(status);
}

function stockCheckCardActionState(status) {
  if (status === "Completed") return "completed";
  if (status === "Draft") return "draft";
  if (status === "Missed") return "missed";
  if (status === "Skipped") return "skipped";
  if (status === "Due Today") return "start";
  return "none";
}

function enteredActual(value, isClosing) {
  return isClosing && value !== "" ? Number(value) : parseNonNegativeNumber(value);
}

function itemHasActiveOutletLink(item = {}, outletId) {
  return (item.linkedOutletIds || []).includes(outletId);
}


function getStockCheckResponsiveLayout() {
  if (typeof window === "undefined") return "desktop";
  const width = window.innerWidth || document.documentElement?.clientWidth || 1024;
  if (width <= 768) return "mobile";
  if (width < 1024) return "compact";
  return "desktop";
}

function useStockCheckResponsiveLayout() {
  const [layout, setLayout] = useState(getStockCheckResponsiveLayout);

  useEffect(() => {
    if (typeof window === "undefined") {
      setLayout("desktop");
      return undefined;
    }
    const update = () => setLayout(getStockCheckResponsiveLayout());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return layout;
}











const emptyExecution = () => ({ items: [], categories: [], groups: [], checks: [], orders: [], people: [] });
export function useStockCheckExecutionData(auth, outletIds) {
  const scopeKey = `${auth?.user?.id || ""}:${outletIds.join(",")}`;
  const [snapshot, setSnapshot] = useState({ scopeKey: "", data: emptyExecution(), state: "loading", error: "" });
  const request = useRef(0);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const refresh = useCallback(async () => {
    const id = ++request.current;
    setSnapshot((current) => ({ ...current, scopeKey, data: current.scopeKey === scopeKey ? current.data : emptyExecution(), state: current.scopeKey === scopeKey && current.state === "ready" ? "refreshing" : "loading", error: "" }));
    try {
      const data = await loadStockCheckExecution(outletIds);
      if (id !== request.current || currentScope.current !== scopeKey) return null;
      setSnapshot({ scopeKey, data, state: "ready", error: "" });
      return data;
    } catch (error) {
      if (id !== request.current || currentScope.current !== scopeKey) return null;
      setSnapshot((current) => ({ scopeKey, data: current.scopeKey === scopeKey ? current.data : emptyExecution(), state: "error", error: error.message || "Unable to load Stock Check.", completeness: error.readState || "error" }));
      return null;
    }
  }, [scopeKey]);
  useEffect(() => { refresh(); return () => { request.current += 1; }; }, [refresh]);
  useEffect(() => subscribeInventoryRevalidation((event) => { if (event?.source !== "stock-check") refresh(); }), [refresh]);
  const current = snapshot.scopeKey === scopeKey ? snapshot : { scopeKey, data: emptyExecution(), state: "loading", error: "" };
  const setData = useCallback((updater) => setSnapshot((old) => old.scopeKey === currentScope.current ? { ...old, data: typeof updater === "function" ? updater(old.data) : updater } : old), []);
  return [current.data, setData, current, refresh];
}
function StockCheckMobileView({
  activeCheckGroup,
  isAudit,
  totals,
  itemById,
  categoryById,
  outletName,
  dateLabel,
  startedByName,
  submittedByName,
  draftSavedAt,
  activePersistedCheck,
  currentCheckerName,
  validationIssues,
  filteredRows,
  auditFilters,
  onPreviewPhoto,
  onUpdateRow,
  onSkipRow,
  onUnskipRow,
  closingFields,
  closingHandoff,
  readyToSubmit,
  onBack,
  onSaveDraft,
  onSubmit,
}) {
  const issueByRowIndex = new Map((validationIssues || []).map((issue) => [issue.rowIndex, issue]));
  const { total: totalItems, counted, skipped: skippedCount, pending: remainingCount } = totals;
  const progressPercent = totalItems ? Math.round((counted / totalItems) * 100) : 0;

  return (
    <div className="space-y-3 pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <SectionCard
        title={activeCheckGroup.name}
        description={`${outletName} · ${isAudit ? activeCheckGroup.auditType : activeCheckGroup.shift} · ${dateLabel}`}
        action={<button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={onBack}>Back</button>}
      >
        <div className="grid gap-2 rounded-2xl border border-border bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="type-micro font-black uppercase text-text-muted">Checked by</div>
              <div className="type-body-sm font-bold text-text-primary">{currentCheckerName}</div>
            </div>
            <Badge tone={isAudit ? "info" : "warning"}>{isAudit ? "Audit" : "Scheduled"}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="type-micro font-black uppercase text-text-muted">Started by</div>
              <div className="type-caption font-bold text-text-primary">{startedByName}</div>
            </div>
            <div>
              <div className="type-micro font-black uppercase text-text-muted">{activePersistedCheck?.status === "submitted" ? "Submitted" : "Draft saved"}</div>
              <div className="type-caption font-bold text-text-primary">
                {activePersistedCheck?.status === "submitted"
                  ? `${submittedByName || "Unknown User"} · ${formatDateTimeCompact(activePersistedCheck.submittedAt)}`
                  : (draftSavedAt ? formatDateTimeCompact(draftSavedAt) : "Not saved yet")}
              </div>
            </div>
          </div>
          {isAudit && <AuditCountTimestamps startedAt={activePersistedCheck?.createdAt} submittedAt={activePersistedCheck?.submittedAt} />}
        </div>
        {closingFields && <div className="mt-3 max-w-xs">{closingFields}</div>}

        {isAudit && <div className="mt-3">{auditFilters}</div>}

        {validationIssues.length ? (
          <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
              <div>
                <div className="type-body-sm font-black">{isAudit ? "Audit Check cannot be submitted" : "Stock Check cannot be submitted"}</div>
                <div className="mt-1 type-caption font-semibold">{validationIssues.length} item{validationIssues.length === 1 ? "" : "s"} require attention:</div>
                <ul className="mt-2 space-y-1 type-caption">
                  {validationIssues.slice(0, 6).map((issue) => (
                    <li key={`${issue.rowIndex}-${issue.reason}`}><span className="font-bold">{issue.itemName}</span> &rarr; {issue.reason}</li>
                  ))}
                  {validationIssues.length > 6 ? <li className="font-semibold">+{validationIssues.length - 6} more</li> : null}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <div className="space-y-3">
        {isAudit && !filteredRows.length && <EmptyState title="No items match these filters." />}
        {filteredRows.map((row) => {
          const item = itemById.get(row.itemId);
          const category = categoryById.get(item?.categoryId);
          const { count: result, parLevel } = row;
          const issue = issueByRowIndex.get(row.rowIndex);
          const rowCompleted = result.state === "na" || result.state === "counted";
          return (
            <div key={row.itemId} data-check-row-index={row.rowIndex} className={`rounded-2xl border bg-white p-3 shadow-sm transition ${issue ? "border-amber-300 bg-amber-50/70" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <InventoryItemThumbnail item={item} category={category} onPreview={onPreviewPhoto} />
                <div className="min-w-0 flex-1">
                  <div className="font-black text-text-primary">{item?.name || "Inventory item"}</div>
                  <div className="type-caption text-text-secondary">{category?.name ?? "Uncategorized"}{item?.sku ? ` · ${item.sku}` : ""}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={rowCompleted ? "success" : result.tone}>{rowCompleted ? "Recorded" : result.label}</Badge>
                  {rowCompleted && !row.skipped ? <Badge tone={row.na ? "neutral" : result.tone}>{row.na ? "Not Available" : result.label}</Badge> : null}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center">
                <div><div className="type-micro font-black uppercase text-text-muted">Par</div><div className="type-body-sm font-bold text-text-primary">{parLevel}</div></div>
                <div><div className="type-micro font-black uppercase text-text-muted">Variance</div><div className="type-body-sm font-bold text-text-primary">{formatQuantity(result.variance)}</div></div>
                <div><div className="type-micro font-black uppercase text-text-muted">UOM</div><div className="type-body-sm font-bold text-text-primary">{item?.unit || "-"}</div></div>
              </div>

              <div className="mt-3">
                <div className="mb-1 type-caption font-semibold text-text-secondary">Actual Count</div>
                <div className="flex items-center gap-2">
                  <button className="icon-btn h-10 w-10" type="button" disabled={row.skipped} onClick={() => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: Math.max(0, Number(entry.actualCount || 0) - 1), na: false }))}>-</button>
                  <input className="control h-10 min-w-0 flex-1 text-center text-[15px] font-bold" type="number" min="0" disabled={row.skipped} value={row.actualCount ?? ""} placeholder="Qty" onFocus={selectInputText} onChange={(event) => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: enteredActual(event.target.value, Boolean(closingFields)), na: false }))} />
                  <button className="icon-btn h-10 w-10" type="button" disabled={row.skipped} onClick={() => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: Number(entry.actualCount || 0) + 1, na: false }))}>+</button>
                </div>
                {issue ? <div className="mt-2 type-caption font-bold text-amber-700">{issue.reason === "Count not entered" ? "Count required" : issue.reason}</div> : null}
              </div>

              {!row.skipped ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {[
                    ...(closingFields ? [] : [["Full", parLevel], ["Half", Math.round(Number(parLevel || 0) / 2)]]),
                    ["Empty", 0],
                  ].map(([label, value]) => (
                    <button key={label} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary" type="button" onClick={() => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, actualCount: Number(value || 0), na: false }))}>{label}</button>
                  ))}
                  {onSkipRow && <button className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary" type="button" onClick={() => onSkipRow(row.rowIndex, item?.name)}>Skip</button>}
                </div>
              ) : <div className="mt-3 break-words type-caption text-text-secondary">{row.skipReason || "Skip reason required"}</div>}

              <input className="control mt-3 h-10 w-full text-[13px]" value={row.notes} onChange={(event) => onUpdateRow(row.rowIndex, (entry) => ({ ...entry, notes: event.target.value }))} placeholder="Optional note" />

              {row.skipped ? (
                <div className="mt-3 flex justify-end">
                  <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => onUnskipRow(row.rowIndex)}>Undo Skip</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="type-micro font-black uppercase tracking-wide text-text-muted">Progress</div>
            <div className="type-body-sm font-black text-text-primary">{counted} / {totalItems} counted</div>
          </div>
          <Badge tone={readyToSubmit ? "success" : "info"}>{readyToSubmit ? "Ready to submit" : `${progressPercent}%`}</Badge>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all ${readyToSubmit ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 type-caption font-semibold text-text-secondary">
          <div>{skippedCount} skipped</div>
          <div className="text-right">{remainingCount} remaining</div>
        </div>
      </div>

      <div className="sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-border bg-white/95 p-3 shadow-card backdrop-blur">
        <div className="mb-2">
          <div className="type-body-sm font-black text-text-primary">{counted} / {totalItems} counted</div>
          <div className="mt-0.5 flex flex-wrap gap-2 type-caption font-semibold text-text-secondary">
            <span>{skippedCount} skipped</span>
            <span>·</span>
            <span>{remainingCount} remaining</span>
          </div>
        </div>
        {closingHandoff && <p className="mb-2 type-caption text-text-secondary">Save the draft for an authorized Admin to submit.</p>}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secondary" type="button" onClick={onSaveDraft}>Save Draft</button>
          <button className="btn-primary" type="button" disabled={closingHandoff} onClick={onSubmit}>{closingFields ? "Submit & Publish Closing" : isAudit ? "Submit Audit" : "Submit"}</button>
        </div>
      </div>
    </div>
  );
}


function AuditStockCheckModal({ outlets, categories, items, closingSetup, onClose, onStart, starting }) {
  const [form, setForm] = useState({
    outletId: closingSetup ? outlets.find(outlet => outlet.id === closingSetup.outletId)?.id || "" : outlets[0]?.id || "",
    auditType: closingSetup ? MONTH_END_CLOSING : auditTypes[0],
    closingMonth: closingSetup?.accountingMonth || "",
    categoryIds: [],
    notes: "",
  });

  const outletItems = items.filter((item) => isActiveInventoryItem(item) && itemHasActiveOutletLink(item, form.outletId));
  const selectedCategories = new Set(form.categoryIds);
  const selectedLinkedItemCount = outletItems.filter((item) => selectedCategories.has(item.categoryId)).length;
  const isClosing = form.auditType === MONTH_END_CLOSING;
  const canStart = form.outletId && form.auditType
    && (isClosing ? outletItems.length > 0 && form.closingMonth
      : selectedLinkedItemCount > 0);

  function update(key, value) {
    setForm((current) => {
      if (key === "outletId") return { ...current, outletId: value, categoryIds: [] };
      return { ...current, [key]: value };
    });
  }

  function toggleCategory(categoryId) {
    update("categoryIds", selectedCategories.has(categoryId)
      ? form.categoryIds.filter((id) => id !== categoryId)
      : [...form.categoryIds, categoryId]);
  }

  return (
    <Modal
      title="Audit Stock Check"
      description="Run a special non-scheduled stock check for closing, spot checks or control audits."
      size="xl"
      onClose={starting ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={starting} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={starting || !canStart} onClick={() => onStart(form)}>{starting ? "Starting…" : "Start Audit"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField label="Outlet" value={form.outletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => update("outletId", value)} searchable />
          <SelectField label="Audit Type" value={form.auditType} options={auditTypes.map((type) => ({ value: type, label: type }))} onChange={(value) => update("auditType", value)} />
        </div>
        {isClosing && <MonthPickerField className="max-w-xs" label="Closing Month" emptyLabel="Select Closing Month"
          value={form.closingMonth} onChange={value => update("closingMonth", value)} />}
        {isClosing ? <p className="type-caption text-text-secondary">Count all {outletItems.length} active outlet items. Enter zero if an item has no stock.</p> : <div className="rounded-2xl border border-border p-3">
          <div className="type-title font-bold text-text-primary">Category Selection</div>
          <p className="mt-1 type-caption text-text-secondary">Audit setup selects categories only. The full item list is generated next, and individual items can be skipped during counting with a reason.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {categories.filter((category) => category.status === "active").map((category) => {
              const count = outletItems.filter((item) => item.categoryId === category.id).length;
              return (
                <button
                  key={category.id}
                  className={`rounded-2xl border p-3 text-left transition ${selectedCategories.has(category.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                  type="button"
                  disabled={!count}
                  onClick={() => toggleCategory(category.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="type-body-sm font-bold text-text-primary">{category.name}</span>
                    <Badge tone={!count ? "neutral" : selectedCategories.has(category.id) ? "success" : "info"}>{count ? `${count} items` : "No linked items"}</Badge>
                  </div>
                  <div className="mt-1 type-caption text-text-secondary">{category.description || "Inventory category"}</div>
                </button>
              );
            })}
          </div>
        </div>}
        <TextArea label="Notes" value={form.notes} onChange={(value) => update("notes", value)} placeholder="Optional audit objective or instruction" />
      </div>
    </Modal>
  );
}

function SkipReasonModal({ itemName, onClose, onSave }) {
  const [selection, setSelection] = useState("");
  const [explanation, setExplanation] = useState("");
  const reason = stockCheckSkipReason(selection, explanation);
  return (
    <Modal
      title="Skip stock check item"
      description={`Provide a reason before skipping ${itemName || "this item"}.`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!reason} onClick={() => onSave(reason)}>Skip Item</button>
        </>
      )}
    >
      <div className="space-y-3">
        <SelectField label="Skip Reason" placeholder="Select a reason" value={selection} options={STOCK_CHECK_SKIP_REASONS} onChange={setSelection} />
        {selection === "other" && <TextArea label="Explanation (required)" value={explanation} onChange={setExplanation} />}
      </div>
    </Modal>
  );
}











export default function InventoryStockCheckPage({ auth, ui, outlets: suppliedOutlets = [] }) {
  const initialStockCheckDate = useMemo(getInitialStockCheckDate, []);
  const outlets = useMemo(() => suppliedOutlets.map(normalizeOutletRecord), [suppliedOutlets]);
  const [selectedOutletId, setSelectedOutletId] = useState(() => {
    const accessible = getAccessibleOutlets(auth, suppliedOutlets);
    const requested = typeof window === "undefined" ? "" : resolveAdminLocation(window.location)?.query?.outletId;
    return accessible.find((outlet) => String(outlet.id) === requested)?.id || accessible[0]?.id || "";
  });
  const accessibleOutletIds = useMemo(() => getAccessibleOutlets(auth, outlets).map((outlet) => outlet.id), [auth, outlets]);
  const effectiveOutletId = accessibleOutletIds.includes(selectedOutletId) ? selectedOutletId : accessibleOutletIds[0] || "";
  const selectedOutletIds = effectiveOutletId ? [effectiveOutletId] : [];
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [data, setData, executionRead, refreshExecution] = useStockCheckExecutionData(auth, selectedOutletIds);
  const [date, setDateState] = useState(initialStockCheckDate.date);
  const [selectedDateSource, setSelectedDateSource] = useState(initialStockCheckDate.source);
  const selectedDateSourceRef = useRef(initialStockCheckDate.source);
  const [stockCheckShiftFilter, setStockCheckShiftFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [activeCheckGroupId, setActiveCheckGroupId] = useState(null);
  const [activeScheduledCheckId, setActiveScheduledCheckId] = useState(null);
  const [activeAuditCheck, setActiveAuditCheck] = useState(null);
  const [closingMonth, setClosingMonth] = useState("");
  const [actualCountDate, setActualCountDate] = useState("");
  const [invalidCountDate, setInvalidCountDate] = useState(false);
  const pendingAuditRequest = useRef(null);
  const [checkRows, setCheckRows] = useState([]);
  const [savingStockCheck, setSavingStockCheck] = useState(false);
  const [checkValidationAttempted, setCheckValidationAttempted] = useState(false);
  const [checkSearch, setCheckSearch] = useState("");
  const [checkCategory, setCheckCategory] = useState("all");
  const [checkStatus, setCheckStatus] = useState("all");
  const [collapsedCheckCategoryIds, setCollapsedCheckCategoryIds] = useState(() => new Set());
  const [photoPreview, setPhotoPreview] = useState(null);
  const stockCheckResponsiveLayout = useStockCheckResponsiveLayout();
  const useStockCheckCardLayout = stockCheckResponsiveLayout !== "desktop";

  const setDate = useCallback((value, source = "manual") => {
    setDateState(normalizeBusinessDate(value));
    selectedDateSourceRef.current = source;
    setSelectedDateSource(source);
  }, []);

  useEffect(() => {
    debugLog("[BusinessDateDebug]", {
      browserDate: toDateInputValue(new Date()),
      utcDate: new Date().toISOString().slice(0, 10),
      businessDate: getBusinessDateInput("Asia/Kuala_Lumpur"),
      selectedDate: date,
      selectedDateSource,
    });
  }, [date, selectedDateSource]);


  useEffect(() => {
    setCheckValidationAttempted(false);
  }, [activeCheckGroupId, activeScheduledCheckId, activeAuditCheck?.id]);

  useEffect(() => {
    function applyUrlStockCheckDate() {
      const urlDate = stockCheckDateFromUrl();
      if (!urlDate) {
        if (selectedDateSourceRef.current === "url") {
          selectedDateSourceRef.current = "business-today";
          setDateState(getBusinessDateInput("Asia/Kuala_Lumpur"));
          setSelectedDateSource("business-today");
        }
        return;
      }
      selectedDateSourceRef.current = "url";
      setDateState(urlDate);
      setSelectedDateSource("url");
    }
    applyUrlStockCheckDate();
    window.addEventListener("hashchange", applyUrlStockCheckDate);
    window.addEventListener("popstate", applyUrlStockCheckDate);
    return () => {
      window.removeEventListener("hashchange", applyUrlStockCheckDate);
      window.removeEventListener("popstate", applyUrlStockCheckDate);
    };
  }, []);


  const can = useMemo(() => ({
    createCheck: hasPermission(auth, "inventory_stock_check.create") || hasPermission(auth, "inventory_stock_check.audit"),
    editCheck: hasPermission(auth, "inventory_stock_check.edit"),
    reviewCheck: hasPermission(auth, "inventory_stock_check.review"),
    publishClosing: hasPermission(auth, "inventory_stock_check.view") && hasPermission(auth, "inventory_stock_check.approve"),
    correctAudit: hasPermission(auth, "inventory_stock_check.view") && hasPermission(auth, "inventory_stock_check.edit")
      && hasPermission(auth, "inventory_stock_check.create"),
    generatePo: hasPermission(auth, "inventory_orders.create"),
  }), [auth]);

  useEffect(() => {
    const query = resolveAdminLocation(window.location)?.query;
    if (query?.startClosingAudit !== "1") return;
    const { startClosingAudit, accountingMonth, ...listQuery } = query;
    if (hasPermission(auth, "inventory_stock_check.create")) {
      setModal({
        type: "audit-stock-check",
        closingSetup: {
          outletId: listQuery.outletId,
          accountingMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(accountingMonth) ? accountingMonth : "",
        },
      });
    }
    navigateAdminRoute("inventory_stock_check", {}, listQuery, { replace: true });
  }, [auth]);

  const sortedCategories = useMemo(() => [...data.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name)), [data.categories]);
  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);
  const currentCheckerName = employeeDisplayName(auth?.profile || { email: auth?.user?.email });
  const actors = useMemo(() => indexStockCheckActors([
    { id: auth?.profile?.id, authUserId: auth?.user?.id, name: currentCheckerName },
    ...(data.people || []),
  ]), [auth?.profile?.id, auth?.user?.id, currentCheckerName, data.people]);

  const scopedGroups = data.groups.filter((group) => selectedOutletIds.includes(group.outletId) && (stockCheckShiftFilter === "all" || sameStockCheckShift(group.shift, stockCheckShiftFilter)));
  const dueGroups = scopedGroups.filter((group) => isActionableStockCheckStatus(dueStatus(group, data.checks, date, stockCheckShiftFilter)));
  const activeCheckGroup = activeAuditCheck && selectedOutletIds.includes(activeAuditCheck.outletId)
    ? activeAuditCheck
    : data.groups.find((group) => group.id === activeCheckGroupId);

  useEffect(() => {
    if (!activeCheckGroup) return;
    const draft = activeScheduledCheckId
      ? data.checks.find((check) => check.id === activeScheduledCheckId)
      : activeCheckGroup.existingCheckId
        ? data.checks.find((check) => check.id === activeCheckGroup.existingCheckId)
        : draftCheckForGroupRun(activeCheckGroup, data.checks, activeCheckGroup.date || date, stockCheckShiftFilter);
    if (draft?.rows?.length) {
      setCheckRows(draft.rows.map((row) => ({ itemId: row.itemId, actualCount: row.skipped ? "" : row.actualCount, status: row.status ?? "normal", notes: row.notes ?? "", na: Boolean(row.na), skipped: Boolean(row.skipped), skipReason: row.skipReason ?? "" })));
      return;
    }
    setCheckRows(initialStockCheckRowsForGroup(activeCheckGroup));
  }, [activeCheckGroupId, activeScheduledCheckId, activeAuditCheck, activeCheckGroup, data.checks, data.items, date, stockCheckShiftFilter]);

  function notify(title, message = "", tone = "success") {
    ui?.notify?.({ title, message, tone });
  }

  function requirePermission(allowed, action) {
    if (allowed) return true;
    notifyPermissionDenied(ui, action);
    return false;
  }

  function buildStockCheckRowsForGroup(group, sourceRows = checkRows) {
    return sourceRows.map((row) => {
      const item = itemById.get(row.itemId);
      const expectedQty = parLevelForOutlet(item, group.outletId);
      const skipped = Boolean(row.skipped);
      const actualMissing = row.actualCount === "" || row.actualCount === null || row.actualCount === undefined;
      const variance = skipped || row.na || actualMissing ? 0 : Number(expectedQty || 0) - Number(row.actualCount || 0);
      return {
        ...row,
        itemId: row.itemId,
        categoryId: row.categoryId || item?.categoryId || "",
        skipped,
        status: skipped ? "skipped" : row.na ? "na" : row.status ?? "normal",
        id: row.id || makeId("check_item"),
        expectedQty,
        variance,
        unit: item?.unit || "",
      };
    });
  }

  function initialStockCheckRowsForGroup(group) {
    const isClosing = group.auditType === MONTH_END_CLOSING;
    const items = isClosing
      ? data.items.filter((item) => isActiveInventoryItem(item) && itemHasActiveOutletLink(item, group.outletId))
        .sort((a, b) => a.name.localeCompare(b.name))
      : stockCheckItemsForGroup(group, data.items);
    return items.map((item) => ({
      itemId: item.id,
      categoryId: item.categoryId,
      actualCount: isClosing ? "" : parLevelForOutlet(item, group.outletId),
      status: "normal",
      notes: "",
      na: false,
      skipped: false,
      skipReason: "",
    }));
  }

  async function startScheduledStockCheck(group) {
    const status = dueStatus(group, data.checks, date, stockCheckShiftFilter);
    if (status === "Missed") {
      notify("Stock check missed", "This stock check was not completed on schedule.", "warning");
      return;
    }
    if (!canStartScheduledStockCheckForDate(group, date) && status !== "Draft") {
      notify("Stock check locked", "Scheduled stock checks can only be started on their assigned date.", "warning");
      return;
    }
    const existingDraft = draftCheckForGroupRun(group, data.checks, date, stockCheckShiftFilter);
    if (existingDraft) {
      setActiveAuditCheck(null);
      setActiveScheduledCheckId(existingDraft.id);
      setActiveCheckGroupId(group.id);
      return;
    }
    try {
      const initialRows = initialStockCheckRowsForGroup({ ...group, date });
      const savedCheck = await persistRemoteStockCheck({ ...group, date, existingCheckId: "" }, buildStockCheckRowsForGroup({ ...group, date }, initialRows), "draft");
      setData((current) => ({ ...current, checks: [savedCheck, ...current.checks.filter((check) => check.id !== savedCheck.id)] }));
      await refreshExecution();
      setActiveAuditCheck(null);
      setActiveScheduledCheckId(savedCheck.id);
      setActiveCheckGroupId(group.id);
    } catch (error) {
      console.warn("[StockCheckExecution] Unable to start scheduled stock check.", error);
      debugLog("[StockCheckSaveDebug]", { action: "start-scheduled", groupId: group.id, error });
      notify("Unable to start stock check", error.message || "Please try again.", "error");
    }
  }

  async function persistAudit(group, rows, status) {
    const signature = JSON.stringify([group, rows.map(({ id, ...row }) => row), status]);
    if (pendingAuditRequest.current?.signature !== signature) {
      pendingAuditRequest.current = { signature, id: crypto.randomUUID() };
    }
    const saved = await persistRemoteStockCheck(group, rows, status, pendingAuditRequest.current.id);
    pendingAuditRequest.current = null;
    return saved;
  }

  async function startAuditStockCheck(form) {
    if (savingStockCheck) return;
    const auditGroup = {
      outletId: form.outletId,
      description: form.notes || "",
      categoryIds: form.categoryIds,
      itemIds: [],
      frequency: "audit",
      checkDays: [],
      monthDay: "",
      shift: "Audit",
      status: "active",
      stockCheckType: "audit",
      auditType: form.auditType,
      closingMonth: form.closingMonth,
      notes: form.notes,
    };
    try {
      setSavingStockCheck(true);
      const initialRows = initialStockCheckRowsForGroup(auditGroup);
      const savedCheck = await persistAudit(auditGroup, buildStockCheckRowsForGroup(auditGroup, initialRows), "draft");
      setData((current) => ({ ...current, checks: [savedCheck, ...current.checks.filter((check) => check.id !== savedCheck.id)] }));
      await refreshExecution();
      setSelectedOutletId(form.outletId);
      setDate(savedCheck.date);
      setActualCountDate("");
      setInvalidCountDate(false);
      setClosingMonth(savedCheck.accountingMonth?.slice(0, 7) || "");
      setActiveCheckGroupId(null);
      setActiveScheduledCheckId(null);
      setCheckSearch("");
      setCheckCategory("all");
      setCheckStatus("all");
      setActiveAuditCheck({ ...auditGroup, id: savedCheck.id, existingCheckId: savedCheck.id,
        date: savedCheck.date, name: savedCheck.auditName, auditName: savedCheck.auditName });
      setModal(null);
    } catch (error) {
      console.warn("[StockCheckExecution] Unable to start audit stock check.", error);
      debugLog("[AuditStockCheckDebug]", { action: "start-audit", form, error });
      notify("Unable to start audit stock check", formatClosingError(error.message) || "Please try again.", "error");
    } finally {
      setSavingStockCheck(false);
    }
  }

  function continueAuditStockCheck(check) {
    if (check.auditType === MONTH_END_CLOSING && !check.accountingMonth) {
      notify("Start a new closing audit", "This draft was created before closing counts required explicit actuals.", "warning");
      return;
    }
    setActualCountDate(toClosingLocalTime(check.physicalCountCutoff).slice(0, 10));
    setInvalidCountDate(false);
    setClosingMonth(check.accountingMonth?.slice(0, 7) || "");
    setSelectedOutletId(check.outletId);
    setDate(check.date || todayInput());
    setActiveCheckGroupId(null);
    setActiveScheduledCheckId(null);
    setCheckSearch("");
    setCheckCategory("all");
    setCheckStatus("all");
    setActiveAuditCheck({
      id: check.id,
      existingCheckId: check.id,
      outletId: check.outletId,
      name: check.auditName || "Audit Stock Check",
      description: check.notes || "",
      categoryIds: check.categoryIds || check.auditCategoryIds || uniqueIds((check.rows || []).map((row) => itemById.get(row.itemId)?.categoryId).filter(Boolean)),
      itemIds: [],
      frequency: "audit",
      checkDays: [],
      monthDay: "",
      shift: "Audit",
      status: "active",
      stockCheckType: "audit",
      auditType: check.auditType || "Custom Audit",
      auditName: check.auditName || "Audit Stock Check",
      closingMonth: check.accountingMonth?.slice(0, 7) || "",
      date: check.date || todayInput(),
      notes: check.notes || "",
      physicalCountCutoff: check.physicalCountCutoff,
    });
  }

  async function deleteAuditDraft(check) {
    if (!check || check.status !== "draft") {
      notify("Failed to delete audit draft", "Only draft audit stock checks can be deleted.", "error");
      return;
    }
    const confirmed = await ui.confirm({
      title: "Delete Audit Draft?",
      message: "This action cannot be undone.",
      danger: true,
      confirmLabel: "Delete Draft",
    });
    if (!confirmed) return;
    try {
      await deleteRemoteStockCheckDraft(check.id);
      setData((current) => ({ ...current, checks: current.checks.filter((entry) => entry.id !== check.id) }));
      if (activeAuditCheck?.existingCheckId === check.id || activeAuditCheck?.id === check.id) {
        setActiveAuditCheck(null);
      }
      await refreshExecution();
      notify("Audit draft deleted");
    } catch (error) {
      console.warn("[StockCheckExecution] Unable to delete audit draft.", error);
      debugLog("[AuditStockCheckDebug]", { action: "delete-draft", checkId: check?.id, error });
      notify("Failed to delete audit draft", error.message || "Please try again.", "error");
    }
  }

  function skipCheckRow(rowIndex, reason) {
    setCheckRows((current) => current.map((entry, index) => index === rowIndex ? {
      ...entry,
      actualCount: "",
      skipped: true,
      skipReason: reason,
      status: "skipped",
      na: true,
    } : entry));
    setModal(null);
  }

  function unskipCheckRow(rowIndex) {
    setCheckRows((current) => current.map((entry, index) => index === rowIndex ? {
      ...entry,
      skipped: false,
      skipReason: "",
      status: "normal",
      na: false,
    } : entry));
  }

  function stockCheckValidationIssues(rows = checkRows, isClosing = false) {
    return rows
      .map((row, rowIndex) => {
        const countMissing = row.actualCount === "" || row.actualCount === null || row.actualCount === undefined;
        const negative = Number(row.actualCount || 0) < 0;
        const item = itemById.get(row.itemId);
        if (isClosing && (row.skipped || row.na)) {
          return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: row.skipped ? "Undo Skip and enter the actual quantity" : "Closing items must be counted", action: "Enter the actual quantity" };
        }
        if (row.skipped) {
          if (!row.skipReason?.trim()) {
            return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: "Skip reason required", action: "Add a skip reason" };
          }
          return null;
        }
        if (countMissing) return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: "Count not entered", action: isClosing ? "Enter the actual quantity" : "Complete count or click Skip" };
        if (negative) return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: "Count cannot be negative", action: "Enter a non-negative count" };
        if (isClosing && !isValidClosingQuantity(row.actualCount)) {
          return { rowIndex, itemId: row.itemId, itemName: item?.name || "Inventory item", reason: "Invalid closing quantity", action: "Enter a quantity up to 99,999,999,999.999 with no more than three decimal places" };
        }
        return null;
      })
      .filter(Boolean);
  }

  function revealFirstInvalidStockCheckRow(issue) {
    if (!issue) return;
    const item = itemById.get(issue.itemId);
    if (checkSearch.trim()) setCheckSearch("");
    const categoryId = item?.categoryId || "uncategorized";
    if (checkCategory !== "all" && checkCategory !== categoryId) setCheckCategory("all");
    const countState = stockCheckCountState(checkRows[issue.rowIndex], activeCheckGroup?.auditType === MONTH_END_CLOSING);
    if (checkStatus !== "all" && checkStatus !== countState) setCheckStatus("all");
    setCollapsedCheckCategoryIds((current) => {
      if (!current.has(categoryId)) return current;
      const next = new Set(current);
      next.delete(categoryId);
      return next;
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelector(`[data-check-row-index="${issue.rowIndex}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      });
    });
  }

  async function saveStockCheck(status) {
    if (!activeCheckGroup) return;
    if (savingStockCheck) return;
    const isAudit = activeCheckGroup.stockCheckType === "audit";
    const isClosing = activeCheckGroup.auditType === MONTH_END_CLOSING;
    if (isClosing && !closingMonth) {
      notify("Closing Month required", "Select the Closing Month for this audit.", "warning");
      return;
    }
    if (status === "submitted") {
      if (isClosing && !requirePermission(can.publishClosing, "submit and publish Closing Stock")) return;
      const invalidRows = stockCheckValidationIssues(checkRows, isClosing);
      if (invalidRows.length) {
        setCheckValidationAttempted(true);
        revealFirstInvalidStockCheckRow(invalidRows[0]);
        return;
      }
      if (isClosing && (!actualCountDate || invalidCountDate || actualCountDate > todayInput())) {
        notify("Actual count date required", "Enter the date the count took place in Malaysia time.", "warning");
        return;
      }
    }
    const existingDraft = isAudit ? null : activeScheduledCheckId
      ? data.checks.find((check) => check.id === activeScheduledCheckId)
      : draftCheckForGroupRun(activeCheckGroup, data.checks, activeCheckGroup.date || date, stockCheckShiftFilter);
    const checkDate = activeCheckGroup.date || date;
    const persistGroup = {
      ...activeCheckGroup,
      ...(isClosing ? { closingMonth, actualCountDate, auditName: updateClosingAuditName(activeCheckGroup.auditName, checkDate,
        activeCheckGroup.closingMonth, checkDate, closingMonth) } : {}),
      date: checkDate,
      existingCheckId: activeCheckGroup.existingCheckId || existingDraft?.id || activeScheduledCheckId || "",
    };
    const rows = buildStockCheckRowsForGroup(persistGroup);
    try {
      setSavingStockCheck(true);
      const savedCheck = await (isAudit ? persistAudit(persistGroup, rows, status)
        : persistRemoteStockCheck(persistGroup, rows, status));
      const refreshedInventory = await refreshExecution();
      if (status === "submitted") {
        debugLog("[SubmittedScheduledChecksDebug]");
        debugTable((refreshedInventory?.checks || [savedCheck])
          .filter((check) => check.stockCheckType === "scheduled" && ["submitted", "reviewed", "locked"].includes(check.status))
          .map((check) => ({
            id: check.id,
            group_id: check.groupId,
            outlet_id: check.outletId,
            check_date: check.date,
            shift: check.shift,
            status: check.status,
            check_type: check.stockCheckType,
            submitted_at: check.submittedAt,
          })));
      }
      invalidateInventoryReads({ source: "stock-check", outletId: persistGroup.outletId, checkId: savedCheck.id });
      setActiveCheckGroupId(null);
      setActiveScheduledCheckId(null);
      setActiveAuditCheck(null);
      setCheckValidationAttempted(false);
      if (status === "submitted") {
        if (isClosing) notify("Closing Stock published", "The value is available in Outlet P&L for the selected Closing Month.");
        else notify(isAudit ? "Audit Stock Check submitted" : "Stock Check submitted", isAudit ? "Audit result saved without purchase suggestions." : "Review purchase suggestions from the completed check card if shortages exist.");
      } else {
        notify(isAudit ? "Audit Stock Check draft saved" : "Stock Check draft saved");
      }
    } catch (error) {
      console.warn("[StockCheckExecution] Unable to save stock check.", error);
      debugLog(isAudit ? "[AuditStockCheckDebug]" : status === "submitted" ? "[StockCheckSubmitDebug]" : "[StockCheckSaveDebug]", { action: status, activeCheckGroup, rows, error });
      notify(
        status === "submitted"
          ? (isAudit ? "Failed to submit Audit Stock Check" : "Failed to submit Stock Check")
          : (isAudit ? "Failed to save Audit Stock Check draft" : "Failed to save Stock Check draft"),
        formatClosingError(error.message) || "Please try again.",
        "error",
      );
    } finally {
      setSavingStockCheck(false);
    }
  }

  function latestCheckForGroup(group) {
    return [...data.checks]
      .filter((check) => checkMatchesGroupRun(check, group, date, stockCheckShiftFilter))
      .sort((a, b) => new Date(b.submittedAt || b.updatedAt || b.date || 0) - new Date(a.submittedAt || a.updatedAt || a.date || 0))[0] || null;
  }

  function renderStockCheck() {
    const auditChecks = data.checks
      .filter((check) => check.stockCheckType === "audit")
      .filter((check) => check.outletId === effectiveOutletId)
      .sort((a, b) => new Date(b.submittedAt || b.date || 0) - new Date(a.submittedAt || a.date || 0));

    if (activeCheckGroup) {
      const isAudit = activeCheckGroup.stockCheckType === "audit";
      const isClosing = activeCheckGroup.auditType === MONTH_END_CLOSING;
      const closingFields = isClosing && <div className="grid gap-2 sm:grid-cols-2">
        <MonthPickerField label="Closing Month" emptyLabel="Select Closing Month" value={closingMonth} onChange={setClosingMonth} />
        {can.publishClosing && <DatePickerField label="Actual Count Date (MYT)" value={actualCountDate} disabled={Boolean(activeCheckGroup.physicalCountCutoff)}
          onChange={value => { setActualCountDate(value); setInvalidCountDate(false); }}
          onInvalidInput={() => setInvalidCountDate(true)}
          error={invalidCountDate || actualCountDate > todayInput() ? "Enter a valid count date on or before today." : ""} />}
      </div>;
      const activePersistedCheck = activeScheduledCheckId
        ? data.checks.find((check) => check.id === activeScheduledCheckId)
        : activeCheckGroup.existingCheckId
        ? data.checks.find((check) => check.id === activeCheckGroup.existingCheckId)
        : draftCheckForGroupRun(activeCheckGroup, data.checks, activeCheckGroup.date || date, stockCheckShiftFilter);
      const attribution = stockCheckActorNames(activePersistedCheck || {}, actors);
      const startedByName = activePersistedCheck ? attribution.createdByName : currentCheckerName;
      const submittedByName = attribution.submittedByName;
      const draftSavedAt = activePersistedCheck?.updatedAt || activePersistedCheck?.createdAt || "";
      const issues = stockCheckValidationIssues(checkRows, isClosing);
      const validationIssues = checkValidationAttempted ? issues : [];
      const validationIssueByRowIndex = new Map(validationIssues.map((issue) => [issue.rowIndex, issue]));
      const indexedRows = checkRows.map((row, rowIndex) => {
        const item = itemById.get(row.itemId);
        const parLevel = parLevelForOutlet(item, activeCheckGroup.outletId);
        return { ...row, rowIndex, item, parLevel, count: projectStockCheckCount(row, parLevel, isClosing) };
      });
      const totals = indexedRows.reduce((summary, row) => {
        summary[row.count.state] += 1;
        return summary;
      }, { total: indexedRows.length, counted: 0, skipped: 0, pending: 0, na: 0 });
      const readyToSubmit = totals.total > 0 && !issues.length && (!isClosing || Boolean(closingMonth));

      const search = checkSearch.trim().toLowerCase();
      const groupByCategory = new Map();
      if (isAudit) {
        for (const row of indexedRows) {
          const key = row.item?.categoryId || "uncategorized";
          if (!groupByCategory.has(key)) groupByCategory.set(key, { id: key, category: categoryById.get(key), rows: [] });
          const matchesSearch = `${row.item?.name || ""} ${row.item?.sku || ""}`.toLowerCase().includes(search);
          if (matchesSearch && (checkStatus === "all" || checkStatus === row.count.state)) groupByCategory.get(key).rows.push(row);
        }
      }
      const categories = [...groupByCategory.values()].sort((a, b) =>
        Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999)
        || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
      const auditRowGroups = categories.filter(group => group.rows.length && (checkCategory === "all" || checkCategory === group.id));
      const auditFilters = isAudit && <AdminFilterToolbar ariaLabel="Audit item filters" presentation="inline" compact denseFields
        search={<AdminSearchField hideLabel label="Search item" placeholder="Search item" value={checkSearch} onChange={setCheckSearch} />}
        filters={<>
          <SelectField ariaLabel="Category" value={checkCategory} onChange={setCheckCategory}
            options={[{ value: "all", label: "All Categories" }, ...categories.map(group => ({ value: group.id, label: group.category?.name || "Uncategorized" }))]} />
          <SelectField ariaLabel="Status" value={checkStatus} onChange={setCheckStatus} options={countStatusOptions} searchable={false} />
        </>}
      />;
      const updateCheckRow = (index, updater) => {
        setCheckRows(current => current.map((entry, rowIndex) =>
          rowIndex !== index ? entry : typeof updater === "function" ? updater(entry) : { ...entry, ...updater }));
      };
      const openSkipReason = (rowIndex, itemName) => setModal({ type: "skip-check-row", rowIndex, itemName });
      const itemName = row => row.item?.name || "Inventory item";
      const columns = [
        { key: "item", header: "Item", render: row => <div className="flex min-w-0 items-center gap-2.5">
          <InventoryItemThumbnail item={row.item} category={categoryById.get(row.item?.categoryId)} onPreview={setPhotoPreview} size="sm" />
          <div className="min-w-0 break-words">
            <div className="type-body-sm font-semibold text-text-primary">{itemName(row)}</div>
            {row.item?.sku && <small className="type-caption text-text-secondary">{row.item.sku}</small>}
          </div>
        </div> },
        { key: "par", header: "Par", width: 72, align: "right", className: "tabular-nums", render: row => formatQuantity(row.parLevel) },
        { key: "actual", header: "Actual Count", width: 188, render: row => {
          const issue = validationIssueByRowIndex.get(row.rowIndex);
          return <>
            {row.skipped ? <span className="text-text-secondary">—</span> : <>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-1">
                <button className="icon-btn h-8 w-8" type="button" aria-label={`Decrease count for ${itemName(row)}`}
                  onClick={() => updateCheckRow(row.rowIndex, { actualCount: Math.max(0, Number(row.actualCount || 0) - 1), na: false })}><Minus size={14} /></button>
                <input className="control h-8 w-full min-w-0 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  type="number" min="0" step="any" inputMode="decimal" value={row.actualCount ?? ""} placeholder="Qty"
                  aria-label={`Actual Count for ${itemName(row)}`} aria-invalid={issue ? true : undefined} onFocus={selectInputText}
                  onChange={event => updateCheckRow(row.rowIndex, { actualCount: enteredActual(event.target.value, isClosing), na: false })} />
                <button className="icon-btn h-8 w-8" type="button" aria-label={`Increase count for ${itemName(row)}`}
                  onClick={() => updateCheckRow(row.rowIndex, { actualCount: Number(row.actualCount || 0) + 1, na: false })}><Plus size={14} /></button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {[
                  ...(isClosing ? [] : [["Full", row.parLevel], ["Half", Math.round(Number(row.parLevel || 0) / 2)]]),
                  ["Empty", 0],
                  ...(!isAudit ? [["NA", row.actualCount]] : []),
                ].map(([label, value]) => (
                  <button key={label} className="rounded-full border border-border px-2 py-0.5 font-medium text-text-secondary hover:border-primary/30 hover:text-primary"
                    type="button" onClick={() => updateCheckRow(row.rowIndex, { actualCount: Number(value || 0), na: label === "NA" })}>{label}</button>
                ))}
              </div>
            </>}
            {issue && <div className="mt-1 type-caption font-semibold text-amber-800">{issue.reason === "Count not entered" ? "Count required" : issue.reason}</div>}
          </>;
        } },
        { key: "variance", header: "Variance", width: 88, align: "right", className: "tabular-nums", render: row => formatQuantity(row.count.variance) },
        { key: "uom", header: "UOM", width: 64, render: row => row.item?.unit || "—" },
        { key: "status", header: "Status", width: 104, render: row => <Badge tone={row.count.tone}>{row.count.label}</Badge> },
        { key: "notes", header: "Notes", width: "18%", render: row => <input className="control h-8 w-full min-w-0" value={row.notes}
          onChange={event => updateCheckRow(row.rowIndex, { notes: event.target.value })} placeholder="Optional note"
          aria-label={`Notes for ${itemName(row)}`} /> },
        ...(isAudit ? [{ key: "skip", header: "Skip", width: 118, render: row => row.skipped
          ? <div className="flex items-center gap-1">
            <button className="btn-secondary h-8 whitespace-nowrap px-2 text-xs" type="button" onClick={() => unskipCheckRow(row.rowIndex)}>Undo Skip</button>
            <InfoTooltip label={`Skip reason: ${row.skipReason || "Reason required"}`}><Info size={15} aria-hidden="true" /></InfoTooltip>
          </div>
          : <button className="btn-secondary h-8 px-2 text-xs" type="button" onClick={() => openSkipReason(row.rowIndex, itemName(row))}>Skip</button>,
        }] : []),
      ];
      const closeActiveCheck = () => {
        setActiveCheckGroupId(null);
        setActiveScheduledCheckId(null);
        setActiveAuditCheck(null);
      };
      if (useStockCheckCardLayout) {
        return (
          <StockCheckMobileView
            activeCheckGroup={activeCheckGroup}
            isAudit={isAudit}
            totals={totals}
            itemById={itemById}
            categoryById={categoryById}
            outletName={outletById.get(activeCheckGroup.outletId)?.name || "Outlet"}
            dateLabel={formatDate(activeCheckGroup.date || date)}
            startedByName={startedByName}
            submittedByName={submittedByName}
            draftSavedAt={draftSavedAt}
            activePersistedCheck={activePersistedCheck}
            currentCheckerName={currentCheckerName}
            validationIssues={validationIssues}
            filteredRows={isAudit ? auditRowGroups.flatMap(group => group.rows) : indexedRows}
            auditFilters={auditFilters}
            onPreviewPhoto={setPhotoPreview}
            onUpdateRow={updateCheckRow}
            onSkipRow={openSkipReason}
            closingFields={closingFields}
            closingHandoff={isClosing && !can.publishClosing}
            readyToSubmit={readyToSubmit}
            onUnskipRow={unskipCheckRow}
            onBack={closeActiveCheck}
            onSaveDraft={() => requirePermission(can.editCheck, "save stock check drafts") && saveStockCheck("draft")}
            onSubmit={() => requirePermission(can.createCheck, "submit stock checks") && saveStockCheck("submitted")}
          />
        );
      }
      return (
        <div className="space-y-4">
          <SectionCard
            title={activeCheckGroup.name}
            description={`${outletById.get(activeCheckGroup.outletId)?.name} · ${isAudit ? activeCheckGroup.auditType : activeCheckGroup.shift} · ${formatDate(activeCheckGroup.date || date)}`}
            action={<button className="btn-secondary" type="button" onClick={closeActiveCheck}>Back to Due Checks</button>}
          >
            <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-border bg-surface-muted px-3 py-2.5">
              <dl aria-label={isAudit ? "Audit summary" : "Stock Check summary"}
                className={`grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 ${isAudit ? "lg:grid-cols-3 2xl:grid-cols-5" : "md:grid-cols-3"}`}>
                <div className="min-w-0">
                  <dt className="type-caption text-text-secondary">Checked by</dt>
                  <dd className="type-body-sm break-words font-semibold">{currentCheckerName}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="type-caption text-text-secondary">Started by</dt>
                  <dd className="type-body-sm break-words font-semibold">{startedByName}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="type-caption text-text-secondary">{activePersistedCheck?.status === "submitted" ? "Submitted" : "Draft saved"}</dt>
                  <dd className="type-body-sm font-semibold tabular-nums">
                    {activePersistedCheck?.status === "submitted"
                      ? `${submittedByName || "Unknown User"} · ${formatDateTimeCompact(activePersistedCheck.submittedAt)}`
                      : draftSavedAt ? <time dateTime={draftSavedAt}>{formatDateTimeCompact(draftSavedAt)}</time> : "Not saved yet"}
                  </dd>
                </div>
                {isAudit && <AuditCountTimestampFields startedAt={activePersistedCheck?.createdAt} submittedAt={activePersistedCheck?.submittedAt} />}
              </dl>
              {closingFields && <div className="w-full max-w-sm shrink-0">{closingFields}</div>}
            </div>
            {isAudit && <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-2">
              <dl aria-label="Audit item counts" className="flex flex-wrap gap-x-4 gap-y-1 self-center">
                {[["Total", totals.total], ["Counted", totals.counted], ["Skipped", totals.skipped], ["Remaining", totals.pending]].map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-1.5">
                    <dt className="type-caption text-text-secondary">{label}</dt>
                    <dd className="type-body-sm font-semibold tabular-nums text-text-primary">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="min-w-0 flex-[1_1_31rem]">{auditFilters}</div>
            </div>}
            {validationIssues.length ? (
              <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
                  <div>
                    <div className="type-body-sm font-black">{isAudit ? "Audit Check cannot be submitted" : "Stock Check cannot be submitted"}</div>
                    <div className="mt-1 type-caption font-semibold">{validationIssues.length} item{validationIssues.length === 1 ? "" : "s"} require attention:</div>
                    <ul className="mt-2 space-y-1 type-caption">
                      {validationIssues.slice(0, 8).map((issue) => (
                        <li key={`${issue.rowIndex}-${issue.reason}`}><span className="font-bold">{issue.itemName}</span> &rarr; {issue.reason}</li>
                      ))}
                      {validationIssues.length > 8 ? <li className="font-semibold">+{validationIssues.length - 8} more item{validationIssues.length - 8 === 1 ? "" : "s"}</li> : null}
                    </ul>
                    <div className="mt-2 type-caption font-semibold">{isClosing ? "Enter an explicit count for every item before submitting." : isAudit ? "Complete count or click Skip." : "Complete the count before submitting."}</div>
                  </div>
                </div>
              </div>
            ) : null}
            <DataTable columns={columns} density="compact" columnSpacing="compact" tableClassName="table-fixed" minWidth={isAudit ? 948 : 830}
              rows={isAudit ? auditRowGroups.flatMap(group => [{ group }, ...(collapsedCheckCategoryIds.has(group.id) ? [] : group.rows)]) : indexedRows}
              getRowKey={row => row.group ? `category-${row.group.id}` : row.itemId}
              getRowProps={row => ({ "data-check-row-index": row.rowIndex })}
              getRowClassName={row => validationIssueByRowIndex.has(row.rowIndex) ? "!bg-amber-50/80" : ""}
              renderGroupRow={({ group }) => {
                if (!group) return null;
                const collapsed = collapsedCheckCategoryIds.has(group.id);
                return { content: <button type="button" aria-expanded={!collapsed}
                  onClick={() => setCollapsedCheckCategoryIds(current => {
                    const next = new Set(current);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })}>
                  <ChevronDown className={`text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={14} />
                  <span>{group.category?.name || "Uncategorized"}</span>
                  <small>{group.rows.length} item{group.rows.length === 1 ? "" : "s"}</small>
                </button> };
              }}
            />
            {isAudit && !auditRowGroups.length && <EmptyState title="No items match these filters." />}
          </SectionCard>
          <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
            <div aria-label="Stock check progress" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              {totals.total > 0 && <progress className="h-1.5 w-20 accent-primary" aria-label="Counted items" value={totals.counted} max={totals.total} />}
              <div>
                <div className="type-body-sm font-semibold tabular-nums">{totals.counted} / {totals.total} counted</div>
                <div className="type-caption text-text-secondary">{totals.pending} remaining · {totals.skipped} skipped
                  {isClosing && !readyToSubmit && " · Closing requires a valid count for every item."}
                  {isClosing && !can.publishClosing && " · Save the draft for an authorized Admin to submit."}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" type="button" disabled={savingStockCheck} onClick={() => requirePermission(can.editCheck, "save stock check drafts") && saveStockCheck("draft")}>{savingStockCheck ? "Saving…" : "Save Draft"}</button>
              <button className="btn-primary" type="button" disabled={savingStockCheck || (isClosing && !can.publishClosing)} onClick={() => requirePermission(can.createCheck, "submit stock checks") && saveStockCheck("submitted")}>{savingStockCheck ? "Saving…" : isClosing ? "Submit & Publish Closing" : isAudit ? "Submit Audit Check" : "Submit Stock Check"}</button>
            </div>
          </div>
        </div>
      );
    }

    const auditRows = auditChecks.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize)
      .map(check => ({ check, summary: check.rowSummary ?? summarizeAuditRows(check.rows) }));
    const auditColumns = [
      { key: "date", header: "Date", className: "whitespace-nowrap font-semibold", render: ({ check }) => formatDate(check.date) },
      { key: "auditType", header: "Audit Type", render: ({ check }) => {
        const month = check.auditType === MONTH_END_CLOSING ? formatClosingMonthLabel(check.accountingMonth) : "";
        return <>
          <span>{check.auditType || check.auditName || "Custom Audit"}</span>
          {month && <div className="type-caption text-text-secondary">Closing Month · {month}</div>}
          {check.correctionOfId && <div className="type-caption text-text-secondary">Correction</div>}
        </>;
      } },
      { key: "items", header: "Items", align: "right", className: "tabular-nums", render: ({ summary }) => summary.total },
      { key: "shortage", header: "Shortage", align: "right", className: "tabular-nums", render: ({ summary }) =>
        <span className={summary.shortage ? "font-semibold text-rose-700 dark:text-rose-300" : undefined}>{summary.shortage}</span> },
      { key: "excess", header: "Excess", align: "right", className: "tabular-nums", render: ({ summary }) =>
        <span className={summary.excess ? "font-semibold text-emerald-700 dark:text-emerald-300" : undefined}>{summary.excess}</span> },
      { key: "skipped", header: "Skipped", align: "right", className: "tabular-nums max-[700px]:order-1", render: ({ summary }) => summary.skipped },
      { key: "status", header: "Status", render: ({ check }) =>
        <Badge tone={statusTone(check.status)}>{check.status === "submitted" ? "Completed" : toTitle(check.status)}</Badge> },
      { key: "createdBy", header: "Created By", className: "max-[700px]:order-1", render: ({ check }) => stockCheckActorNames(check, actors).createdByName },
      { key: "actions", header: "Actions", align: "right", className: "max-[700px]:order-1", render: ({ check }) => {
        const openResult = () => navigateAdminRoute("inventory-stock-check-result", { checkId: check.id }, { date });
        if (check.status !== "draft") {
          return <button className="icon-btn h-9 w-9" type="button" title="View audit result"
            aria-label={"View audit result " + (check.auditName || check.date)} onClick={openResult}><Eye size={16} /></button>;
        }
        if (check.correctionOfId && !can.correctAudit) return null;
        return <div className="flex flex-wrap items-center justify-end gap-2 max-[700px]:justify-start">
          <button className="btn-primary h-9 px-2.5 text-xs" type="button"
            onClick={check.correctionOfId ? openResult : () => continueAuditStockCheck(check)}>Continue Audit</button>
          <button className="icon-btn h-9 w-9 text-rose-700" type="button"
            title="Delete draft" aria-label={"Delete draft audit " + (check.auditName || check.date)}
            onClick={() => deleteAuditDraft(check)}><Trash2 size={16} /></button>
        </div>;
      } },
    ];

    return (
      <div className="space-y-4">
      <AdminFilterToolbar>
          <SelectField label="Outlet" value={effectiveOutletId} options={getAccessibleOutletOptions(auth, outlets, { includeAll: false })} onChange={(value) => { setSelectedOutletId(value); setAuditPage(1); }} searchable />
          <DatePickerField label="Date" value={date} onChange={setDate} />
          <SelectField label="Shift" value={stockCheckShiftFilter} options={[{ value: "all", label: "All" }, ...shifts.map((shift) => ({ value: shift, label: shift }))]} onChange={setStockCheckShiftFilter} />
        </AdminFilterToolbar>
        <SectionCard title="Today's Required Checks" description="Only due groups appear here; outlets are not asked to count every item every day.">
          {dueGroups.length ? (
            <div className="grid gap-3 xl:grid-cols-3">
              {dueGroups.map((group) => {
                const status = dueStatus(group, data.checks, date, stockCheckShiftFilter);
                const submittedCheck = submittedCheckForGroupRun(group, data.checks, date, stockCheckShiftFilter);
                const draftCheck = draftCheckForGroupRun(group, data.checks, date, stockCheckShiftFilter);
                const hasDraft = Boolean(draftCheck);
                const itemCount = stockCheckItemsForGroup(group, data.items).length;
                const latestCheck = submittedCheck || latestCheckForGroup(group);
                const linkedOrders = latestCheck ? linkedPurchaseOrdersForStockCheck(data.orders, latestCheck.id) : [];
                const canReviewSuggestions = can.generatePo || can.reviewCheck;
                const cardDebug = {
                  groupId: group.id,
                  groupName: group.name,
                  outletId: group.outletId,
                  shift: group.shift,
                  checkDate: date,
                  selectedShift: stockCheckShiftFilter,
                  submittedCheckId: submittedCheck?.id || "",
                  isDue: isGroupDue(group, date),
                  cardState: stockCheckCardActionState(status),
                };
                debugLog("[StockCheckGroupCardDebug]", cardDebug);
                debugLog("[StockCheckDueDebug]", cardDebug);
                return (
                  <div key={group.id} className="rounded-2xl border border-border bg-white p-4 transition hover:border-primary/30 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="type-title font-bold text-text-primary">{group.name}</div>
                        <div className="type-caption text-text-secondary">{outletById.get(group.outletId)?.name} · {itemCount} items</div>
                      </div>
                      <Badge tone={statusTone(status.toLowerCase())}>{status}</Badge>
                    </div>
                    <div className="mt-4 space-y-1 type-caption text-text-secondary">
                      <div>Frequency: <span className="font-semibold text-text-primary">{frequencyLabel(group)}</span></div>
                      <div>Last checked: <span className="font-semibold text-text-primary">{group.lastChecked ? formatDate(group.lastChecked) : "Never"}</span></div>
                      {dueStatusDescription(status) ? <div className="font-semibold text-text-secondary">{dueStatusDescription(status)}</div> : null}
                    </div>
                    {SHOW_STOCK_CHECK_CARD_DEBUG ? (
                      <div className="mt-3 rounded-xl border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold leading-relaxed text-amber-800">
                        <div>groupId: {group.id}</div>
                        <div>matchedCheckId: {submittedCheck?.id || "-"}</div>
                        <div>checkDate: {date}</div>
                        <div>status: {status}</div>
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-2">
                      {status === "Completed" ? (
                        <>
                          <button
                            className="btn-primary w-full"
                            type="button"
                            disabled={!latestCheck || !canReviewSuggestions}
                            onClick={() => requirePermission(canReviewSuggestions, "review purchase suggestions") && navigateAdminRoute('inventory-stock-check-restock', { checkId: latestCheck.id }, { date })}
                          >
                            {linkedOrders.length ? "View Draft PO" : "Review Purchase Suggestions"}
                          </button>
                          <button className="btn-secondary w-full" type="button" onClick={() => navigateAdminRoute('inventory-stock-check-result', { checkId: latestCheck.id }, { date })}>View Result</button>
                        </>
                      ) : status === "Missed" || status === "Skipped" ? (
                        <div className={status === "Missed" ? "rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800" : "rounded-2xl border border-border bg-surface px-3 py-3 text-sm font-semibold text-text-secondary"}>
                          {dueStatusDescription(status)}
                        </div>
                      ) : (
                        <button className="btn-primary w-full" type="button" onClick={() => requirePermission(can.createCheck, "start stock checks") && startScheduledStockCheck(group)}>
                          {hasDraft ? "Continue Check" : "Start Check"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No stock check required today." description="Due groups will appear automatically based on each group's frequency and check days." />}
        </SectionCard>
        <SectionCard title="Audit Stock Checks" description="Special non-scheduled checks for month-end closing, surprise audits and control counts.">
          {auditChecks.length ? (
            <>
              <DataTable columns={auditColumns} rows={auditRows} getRowKey={({ check }) => check.id}
                density="compact" columnSpacing="compact" mobileLayout="stack" minWidth={690} />
              <FactoryPagination page={auditPage} pageSize={auditPageSize} total={auditChecks.length}
                onPageChange={setAuditPage} onPageSizeChange={(value) => { setAuditPageSize(value); setAuditPage(1); }} />
            </>
          ) : <EmptyState title="No audit stock checks yet." description="Use Audit Stock Check for month-end closing, full outlet counts or spot checks." />}
        </SectionCard>
      </div>
    );
  }

  const meta = { title: "Stock Check", description: "Complete scheduled inventory checks by outlet and group." };
  if (executionRead.state === "loading" || executionRead.state === "error") return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title={meta.title} description={meta.description} />
    <div className="card p-4" role={executionRead.state === "error" ? "alert" : "status"}>
      <h2 className="font-semibold">{executionRead.state === "error" ? "Stock Check data unavailable or incomplete" : "Loading complete Stock Check data…"}</h2>
      {executionRead.state === "error" ? <><p className="mt-2 text-sm text-text-secondary">{executionRead.error} No partial results are presented as complete.</p><button type="button" className="btn-secondary mt-3" onClick={refreshExecution}>Retry</button></> : null}
    </div>
  </div>;
  return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title={meta.title} description={meta.description} actions={<button className="btn-primary" type="button" onClick={() => requirePermission(can.createCheck, "create audit stock checks") && setModal({ type: "audit-stock-check" })}><ClipboardCheck size={15} /> Audit Stock Check</button>} />
    {executionRead.state === "refreshing" ? <p role="status" className="text-sm text-text-secondary">Refreshing Stock Checks. Showing the last verified complete read.</p> : null}
    {renderStockCheck()}
    {modal?.type === "audit-stock-check" ? <AuditStockCheckModal outlets={outlets.filter((outlet) => accessibleOutletIds.includes(outlet.id))} categories={sortedCategories} items={data.items} closingSetup={modal.closingSetup} onClose={() => setModal(null)} onStart={startAuditStockCheck} starting={savingStockCheck} /> : null}
    {modal?.type === "skip-check-row" ? <SkipReasonModal itemName={modal.itemName} onClose={() => setModal(null)} onSave={(reason) => skipCheckRow(modal.rowIndex, reason)} /> : null}
    <InventoryItemPhotoPreview preview={photoPreview} onClose={() => setPhotoPreview(null)} />
  </div>;
}
