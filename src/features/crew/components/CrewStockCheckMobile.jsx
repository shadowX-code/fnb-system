import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Plus, Trash2 } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import { formatCrewDate, formatCrewOperationalDateTime } from "../utils/crewI18n.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import CrewChoicePicker from "./CrewChoicePicker.jsx";
import CrewDatePicker from "./CrewDatePicker.jsx";
import CrewQuantityStepper from "./CrewQuantityStepper.jsx";
import CrewInventoryItemThumb from "./CrewInventoryItemThumb.jsx";
import CrewHistoryControls from "./CrewHistoryControls.jsx";
import useCrewInventoryHistory from "../hooks/useCrewInventoryHistory.js";
import { CrewEmptyState, CrewProgressBar, CrewSearchBar, CrewStatusBadge } from "./CrewMobileUI.jsx";

import AuditCountTimestamps from "../../sales-purchase/inventory/stockChecks/AuditCountTimestamps.jsx";
import { formatClosingError, MONTH_END_CLOSING, updateClosingAuditName } from "../../sales-purchase/inventory/stockChecks/monthEndClosing.js";

const auditTypes = [MONTH_END_CLOSING, "Full Stock Audit", "Spot Check", "Category Audit", "Custom Audit"];
const requestId = () => crypto.randomUUID();
function isCounted(row) {
  const quantity = Number(row.actual_count_quantity);
  return !row.skipped && row.actual_count_quantity != null && row.actual_count_quantity !== "" && Number.isFinite(quantity) && quantity >= 0;
}

function isClosingCount(row) {
  if (!isCounted(row)) return false;
  const quantity = Number(row.actual_count_quantity);
  return quantity <= 99999999999.999 && quantity === Number(quantity.toFixed(3));
}

const asRow = (row) => ({ item_id: row.item_id || row.id, item_name: row.item_name || row.name, sku_code: row.sku_code || row.sku, category_id: row.category_id,
  par_level_quantity: row.par_level_quantity ?? row.par_level ?? null,
  actual_count_quantity: row.skipped ? "" : row.actual_count_quantity ?? "", unit: row.unit || "",
  notes: row.notes || "", skipped: Boolean(row.skipped), skip_reason: row.skip_reason || "", photo_url: row.photo_url || null });
const countStatus = (row, counted = isCounted(row)) => row.skipped ? "skipped" : !counted ? "pending" : row.par_level_quantity == null ? "normal" : Number(row.actual_count_quantity) < Number(row.par_level_quantity) ? "shortage" : Number(row.actual_count_quantity) > Number(row.par_level_quantity) ? "excess" : "normal";
const serializeRows = (rows) => rows.map((row) => ({ item_id: row.item_id, category_id: row.category_id,
  par_level_quantity: row.par_level_quantity, actual_count_quantity: row.skipped || row.actual_count_quantity === "" ? null : Number(row.actual_count_quantity),
  actual_missing: !row.skipped && row.actual_count_quantity === "", variance: row.skipped || row.actual_count_quantity === "" || row.par_level_quantity == null ? null : Number(row.actual_count_quantity) - Number(row.par_level_quantity),
  unit: row.unit, status: countStatus(row), notes: row.notes || null, skipped: row.skipped, skip_reason: row.skipped ? row.skip_reason.trim() : null }));

export default function CrewStockCheckMobile({ token, outletId, grants, initialTarget, onBack, onReviewSuggestions, onOpenPurchaseOrder, onFlowChange }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null); const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [tab, setTab] = useState("required"); const [check, setCheck] = useState(null); const [rows, setRows] = useState([]);
  const [review, setReview] = useState(false); const [query, setQuery] = useState(""); const [category, setCategory] = useState("all");
  const [skippedOnly, setSkippedOnly] = useState(false);
  const [skipItem, setSkipItem] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false); const [deleteTarget, setDeleteTarget] = useState(null);
  const [skipTarget, setSkipTarget] = useState(null); const [skipReason, setSkipReason] = useState("");
  const [auditForm, setAuditForm] = useState({ type: "Spot Check", categoryIds: [], notes: "", closingMonth: "" });
  const [closingMonth, setClosingMonth] = useState("");
  const [notice, setNotice] = useState(""); const [purchase, setPurchase] = useState(null); const pendingRequest = useRef(null); const pendingSkipRequest = useRef(null); const activeRef = useRef(true);
  const historyView = useCrewInventoryHistory(crewService.inventoryStockCheckHistory, token, outletId, tab === "history");
  const [dirty, setDirty] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const initialOpened = useRef(false);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; onFlowChange?.(false); }; }, [onFlowChange]);
  useEffect(() => { onFlowChange?.(Boolean(check)); }, [check, onFlowChange]);
  async function load() {
    if (!grants?.can_perform_stock_check && !grants?.can_create_audit_stock_check) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [nextData, nextCatalog] = await Promise.all([crewService.inventoryStockChecks(token, outletId), crewService.inventoryMobileCatalog(token, outletId)]);
      if (!activeRef.current) return;
      setData(nextData); setCatalog(nextCatalog);
      if (initialTarget && !initialOpened.current) {
        initialOpened.current = true;
        const target = (nextData.due || []).find((group) => group.group_id === initialTarget.group_id);
        if (initialTarget.id || initialTarget.check_id) void openSaved(initialTarget.id || initialTarget.check_id);
        else if (target) startScheduled({ ...target, business_date: nextData.business_date });
      }
    } catch (cause) { if (activeRef.current) setError(cause.message || t("inventory.loadError")); }
    finally { if (activeRef.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [token, outletId]);
  const itemById = useMemo(() => new Map((catalog?.items || []).map((item) => [item.id, item])), [catalog]);
  const categoryById = useMemo(() => new Map((catalog?.categories || []).map((item) => [item.id, item.name])), [catalog]);
  const isClosing = check?.audit_type === MONTH_END_CLOSING;
  const countItem = isClosing ? isClosingCount : isCounted;
  const counted = rows.filter(countItem).length;
  const skipped = rows.filter(row => row.skipped).length;
  const remaining = rows.length - counted - skipped;
  const progress = rows.length ? Math.round(counted / rows.length * 100) : 0;
  const canComplete = rows.length > 0 && (isClosing
    ? Boolean(closingMonth) && counted === rows.length
    : remaining === 0 && rows.every(row => !row.skipped || Boolean(row.skip_reason.trim())));
  const isNewClosing = auditForm.type === MONTH_END_CLOSING;
  const auditItems = (catalog?.items || []).filter(item => isNewClosing || auditForm.categoryIds.includes(item.category_id));
  const canStartAudit = Boolean(auditItems.length && (!isNewClosing || auditForm.closingMonth));
  const visibleRows = rows.filter((row) => {
    const item = itemById.get(row.item_id);
    return (!skippedOnly || row.skipped) && (category === "all" || row.category_id === category)
      && `${item?.name || row.item_name || ""} ${item?.sku || row.sku_code || ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const grouped = Object.entries(visibleRows.reduce((groups, row) => {
    const key = row.category_id || "other";
    (groups[key] ||= []).push(row);
    return groups;
  }, {}));
  const required = (data?.due || []).filter((row) => row.status === "due" || row.status === "in_progress");
  const history = historyView.rows;

  async function loadPurchaseResult(id, type) {
    if (type !== "scheduled" || (!grants?.can_manage_purchase_orders && !grants?.can_receive_purchase_orders)) { setPurchase(null); return; }
    setPurchase({ loading: true });
    try {
      const [result, orders] = await Promise.all([crewService.inventoryPurchaseOrders(token, outletId), crewService.inventoryPurchaseOrdersForCheck(token, outletId, id)]);
      if (!activeRef.current) return;
      setPurchase({ source: (result.suggestions || []).find((entry) => entry.stock_check_id === id) || null, orders: orders || [] });
    } catch (cause) { if (activeRef.current) setPurchase({ error: cause.message || t("inventory.loadError") }); }
  }

  async function openSaved(id) {
    setBusy(true); setError("");
    try {
      const result = await crewService.inventoryStockChecks(token, outletId, id);
      if (!activeRef.current) return;
      const detail = result.detail;
      if (detail.audit_type === MONTH_END_CLOSING && detail.status === "draft" && !detail.accounting_month) {
        setError(t("inventory.legacyClosingDraft"));
        return;
      }
      setClosingMonth(detail.accounting_month?.slice(0, 7) || "");
      setPurchase(null);
      setCheck({ id: detail.id, stock_check_type: detail.type, status: detail.status, group_id: detail.group_id,
        check_name: detail.check_name, audit_name: detail.audit_name, audit_type: detail.audit_type,
        audit_category_ids: detail.audit_category_ids, check_date: detail.check_date, shift: detail.shift, notes: detail.notes,
        accounting_month: detail.accounting_month, created_at: detail.created_at,
        correction_of_id: detail.correction_of_id, correction_reason: detail.correction_reason, superseded: detail.superseded,
        submitted_at: detail.submitted_at, skipped_at: detail.skipped_at,
        skipped_by_employee_id: detail.skipped_by_employee_id, skipped_by_name: detail.skipped_by_name,
        skip_reason: detail.skip_reason });
      setRows((detail.items || []).map(asRow)); resetItemFilters(); pendingRequest.current = null; setDirty(false);
      if (detail.status === "completed") void loadPurchaseResult(detail.id, detail.type);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  function startScheduled(group) {
    if (group.status !== "due" && group.status !== "in_progress") return;
    if (group.check_id) { void openSaved(group.check_id); return; }
    setCheck({ stock_check_type: "scheduled", status: "in_progress", group_id: group.group_id, check_name: group.name,
      check_date: group.business_date || data?.business_date, shift: group.shift });
    setRows((group.items || []).map(asRow)); resetItemFilters(); pendingRequest.current = null; setDirty(false);
  }
  async function persistCheck(payload, items) {
    const signature = JSON.stringify({ payload, items });
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: requestId() };
    const result = await crewService.saveInventoryStockCheck(token, outletId, pendingRequest.current.id, payload, items);
    pendingRequest.current = null;
    return result;
  }

  async function startAudit() {
    if (busy || !canStartAudit) return;
    const payload = {
      outlet_id: outletId, stock_check_type: "audit", status: "draft", audit_type: auditForm.type,
      audit_category_ids: isNewClosing ? [] : auditForm.categoryIds, notes: auditForm.notes,
      ...(isNewClosing ? { accounting_month: `${auditForm.closingMonth}-01` } : {}),
    };
    const initialRows = auditItems.map(asRow);
    setBusy(true); setError("");
    try {
      const result = await persistCheck(payload, serializeRows(initialRows));
      if (!activeRef.current) return;
      setCheck(result.check);
      setClosingMonth(result.check.accounting_month?.slice(0, 7) || "");
      // The canonical write response carries the saved roster; retain catalog names and photos on count rows.
      setRows((result.items || initialRows).map(asRow));
      setAuditOpen(false); resetItemFilters(); setTab("audit"); setDirty(false);
    } catch (cause) { setError(formatClosingError(cause.message, t("inventory.closingDetailsRequired")) || t("inventory.saveError")); }
    finally { setBusy(false); }
  }
  function updateRow(itemId, patch) { setRows((current) => current.map((row) => row.item_id === itemId ? { ...row, ...patch } : row)); setDirty(true); }

  function resetItemFilters() {
    setReview(false);
    setQuery("");
    setCategory("all");
    setSkippedOnly(false);
  }

  function confirmItemSkip() {
    const reason = skipItem.reason.trim();
    if (!reason) return;
    updateRow(skipItem.id, { skipped: true, skip_reason: reason, actual_count_quantity: "" });
    setSkipItem(null);
  }

  async function save(status) {
    if (busy || !check) return;
    if (isClosing && !closingMonth) { setError(t("inventory.closingDetailsRequired")); return; }
    if (status === "submitted" && !canComplete) { setError(t(isClosing ? "inventory.closingCountsRequired" : "inventory.completeCountsFirst")); setReview(false); return; }
    const { id, stock_check_type, group_id, check_name, audit_name, audit_type, audit_category_ids, check_date, shift, notes } = check;
    const payload = { id, stock_check_type, group_id, check_name, audit_name, audit_type, audit_category_ids, check_date, shift, notes, outlet_id: outletId, status };
    if (isClosing) {
      const name = updateClosingAuditName(audit_name, check_date, check.accounting_month?.slice(0, 7), check_date, closingMonth);
      Object.assign(payload, {
        audit_name: name, check_name: name === audit_name ? check_name : name,
        accounting_month: `${closingMonth}-01`,
      });
    }
    const items = serializeRows(rows);
    setBusy(true); setError("");
    try {
      const result = await persistCheck(payload, items);
      if (!activeRef.current) return;
      setDirty(false);
      if (status === "submitted") {
        const completedId = result.check.id;
        setCheck({ ...check, ...payload, ...result.check, status: "completed" }); setReview(false);
        setNotice(t("inventory.checkCompleted")); void loadPurchaseResult(completedId, check.stock_check_type);
      }
      else {
        setExitOpen(false); setCheck(null); setRows([]); setReview(false); setPurchase(null);
        setNotice(t("inventory.draftSaved")); await load();
      }
    } catch (cause) { setError(formatClosingError(cause.message, t("inventory.closingDetailsRequired")) || t("inventory.saveError")); }
    finally { setBusy(false); }
  }
  async function deleteDraft() {
    if (!deleteTarget || busy) return;
    setBusy(true); setError("");
    try {
      await crewService.deleteInventoryAuditDraft(token, outletId, deleteTarget, requestId());
      if (!activeRef.current) return;
      setDeleteTarget(null); setCheck(null); setNotice(t("inventory.draftDeleted")); await load();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function skipScheduled() {
    if (!skipTarget || busy) return;
    const signature = JSON.stringify([outletId, skipTarget.group_id, skipReason || null]);
    if (pendingSkipRequest.current?.signature !== signature) pendingSkipRequest.current = { signature, id: requestId() };
    setBusy(true); setError("");
    try {
      await crewService.skipInventoryStockCheck(token, outletId, pendingSkipRequest.current.id, skipTarget.group_id, skipReason || null);
      if (!activeRef.current) return;
      pendingSkipRequest.current = null;
      setSkipTarget(null); setSkipReason(""); setTab("history"); setNotice(t("inventory.checkSkipped"));
      await load();
    } catch (cause) { setError(cause.message || t("inventory.saveError")); }
    finally { setBusy(false); }
  }
  const backFromCheck = () => {
    if (busy) return;
    if (["draft", "in_progress"].includes(check?.status) && dirty) {
      setExitOpen(true); return;
    }
    leaveCheck();
  };
  function leaveCheck() {
    setExitOpen(false); setDirty(false); pendingRequest.current = null;
    setCheck(null); setRows([]); setReview(false); setPurchase(null); setError(""); void load();
  }

  if (check) return <section className="crew-inventory-page">
    <CrewMobileDetailHeader title={check.audit_name || check.check_name || t("inventory.stockCheck")} subtitle={check.check_date} onBack={review ? () => setReview(false) : backFromCheck} />
    {["draft", "in_progress", "completed"].includes(check.status) && <div className="crew-inventory-progress"><span><strong>{t("inventory.countProgress", { counted, skipped, remaining })}</strong><CrewStatusBadge tone={check.status === "completed" ? "success" : "info"}>{t(`inventory.${check.status}`)}</CrewStatusBadge></span><CrewProgressBar value={progress} /></div>}
    {check.stock_check_type === "audit" && <AuditCountTimestamps className="crew-inventory-audit-timestamps"
      startedAt={check.created_at} submittedAt={check.submitted_at}
      startedLabel={t("inventory.countStartedAt")} submittedLabel={t("inventory.countSubmittedAt")} />}
    {isClosing && closingMonth && (review || check.status === "completed") &&
      <p className="type-body-sm"><strong>{t("inventory.accountingMonth")}</strong>{" · "}
        <time dateTime={closingMonth}>{formatCrewDate(`${closingMonth}-01T12:00:00+08:00`, { month: "long", year: "numeric" })}</time>
      </p>}
    {check.status === "completed" && check.stock_check_type === "audit" && (check.correction_of_id || check.superseded) &&
      <div className="crew-inventory-lifecycle-result">
        {check.superseded && <p>{t("inventory.supersededAuditEvidence")}</p>}
        {check.correction_of_id && <p>{t("inventory.correctedAuditEvidence")}</p>}
        {check.correction_reason && <p>{t("inventory.auditCorrectionReason", { reason: check.correction_reason })}</p>}
      </div>}
    {check.status === "completed" ? <CompletedResult check={check} rows={rows} itemById={itemById} purchase={purchase} canReviewSuggestions={grants?.can_manage_purchase_orders} onRetry={() => void loadPurchaseResult(check.id, check.stock_check_type)} onReview={() => onReviewSuggestions?.(check.id)} onOpenPurchaseOrder={onOpenPurchaseOrder} t={t} language={i18n.language} /> : ["skipped", "missed"].includes(check.status) ? <LifecycleResult check={check} t={t} language={i18n.language} /> : review ? <ReviewRows rows={rows} itemById={itemById} t={t} /> : <>
      {isClosing && <div className="crew-inventory-form">
        <CrewDatePicker monthOnly label={t("inventory.accountingMonth")} placeholder={t("inventory.selectAccountingMonth")}
          value={closingMonth} onChange={month => { setClosingMonth(month); setDirty(true); }} />
      </div>}
      <div className="crew-inventory-count-filters">
        <CrewSearchBar value={query} onChange={setQuery} placeholder={t("inventory.searchItems")} />
        <div className="crew-v2-chips">
          <button type="button" className={skippedOnly ? "active" : ""} aria-pressed={skippedOnly}
            onClick={() => setSkippedOnly(value => !value)}>{t("inventory.skipped")}</button>
        </div>
      </div>
      <div className="crew-v2-chips crew-inventory-chips" role="group" aria-label={t("inventory.categories")}>{[{ id: "all", name: t("inventory.all") }, ...(catalog?.categories || []).filter((item) => rows.some((row) => row.category_id === item.id))].map((item) => <button key={item.id} type="button" className={category === item.id ? "active" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>
      {isClosing && skipped > 0 && <p className="crew-inventory-closing-skip-hint">{t("inventory.closingSkipsRequired")}</p>}
      {grouped.map(([categoryId, groupRows]) => <section className="crew-inventory-count-group" key={categoryId}><h2>{categoryById.get(categoryId) || t("inventory.other")}</h2>{groupRows.map((row) => <CountRow key={row.item_id} row={row} item={itemById.get(row.item_id)} counted={countItem(row)} onSkip={name => setSkipItem({ id: row.item_id, name, reason: "" })} onChange={(patch) => updateRow(row.item_id, patch)} t={t} />)}</section>)}
      {!visibleRows.length && <CrewEmptyState title={t(skippedOnly ? "inventory.noSkippedItems" : "inventory.noItems")}
        body={!skippedOnly || query || category !== "all" ? t("inventory.trySearch") : undefined} />}
    </>}
    {error && <p className="crew-v2-error" role="alert">{error}</p>}
    {["draft", "in_progress"].includes(check.status) && <div className="crew-inventory-sticky"><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => void save("draft")}>{busy ? t("common.saving") : t("inventory.saveDraft")}</button><button className="crew-mobile-primary" type="button" disabled={busy || !canComplete} onClick={() => review ? void save("submitted") : setReview(true)}>{review ? t("inventory.completeCheck") : `${t("inventory.review")} (${counted}/${rows.length})`}</button></div>}
    {skipItem && <CrewBottomSheet title={t("inventory.skipItem")} description={skipItem.name} onClose={() => setSkipItem(null)}
      footer={<button className="crew-mobile-primary" type="button" disabled={!skipItem.reason.trim()} onClick={confirmItemSkip}>{t("inventory.skipItem")}</button>}>
      <div className="crew-inventory-form">
        <label>{t("inventory.itemSkipReason")}<textarea required value={skipItem.reason}
          onChange={event => setSkipItem(current => ({ ...current, reason: event.target.value }))} /></label>
      </div>
    </CrewBottomSheet>}
    {exitOpen && <CrewBottomSheet className="crew-inventory-exit-sheet" title={t("inventory.saveProgressTitle")} description={t("inventory.unsavedCountChanges")} onClose={() => setExitOpen(false)} closeDisabled={busy} footer={<><button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void save("draft")}>{busy ? t("common.saving") : t("inventory.saveAndLeave")}</button><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={leaveCheck}>{t("inventory.discardCountChanges")}</button><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setExitOpen(false)}>{t("inventory.keepCounting")}</button></>}>{error && <p className="crew-v2-error" role="alert">{error}</p>}</CrewBottomSheet>}
  </section>;

  return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.stockCheck")} onBack={onBack} />
    <div className="crew-ui-tabs crew-inventory-tabs" role="tablist" aria-label={t("inventory.stockCheck")}>{["required", "audit", "history"].map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{t(`inventory.${value}`)}</button>)}</div>
    {notice && <p className="crew-inventory-notice" role="status">{notice}</p>}
    {error && !auditOpen && <p className="crew-v2-error" role="alert">{error}</p>}
    {!grants?.can_perform_stock_check && !grants?.can_create_audit_stock_check ? <CrewEmptyState title={t("inventory.noAccess")} /> : loading ? <p className="crew-inventory-state" role="status">{t("common.loading")}</p> : !data ? <button className="crew-mobile-secondary" type="button" onClick={() => void load()}>{t("common.retry")}</button> : <>
      {tab === "required" && (data.can_perform_stock_check ? <>
        {required.length ? <div className="crew-inventory-list">{required.map((group) => <div className="crew-inventory-scheduled-row" key={group.group_id}><CrewInventoryItemThumb item={itemById.get(group.items?.[0]?.item_id)} /><span className="crew-inventory-scheduled-copy"><strong>{group.name}</strong><small>{[group.shift, t("inventory.homeItemCount", { count: group.items?.length || 0 })].filter(Boolean).join(" · ")}</small></span><CrewStatusBadge tone={group.status === "in_progress" ? "info" : "warning"}>{t(`inventory.${group.status}`)}</CrewStatusBadge><div className="crew-inventory-scheduled-actions"><button type="button" className="crew-mobile-secondary" onClick={() => startScheduled(group)}>{group.status === "in_progress" ? t("inventory.resume") : t("inventory.start")}</button>{group.status === "due" && <button type="button" className="crew-inventory-skip-action" onClick={() => { pendingSkipRequest.current = null; setSkipTarget(group); setSkipReason(""); }}>{t("inventory.skip")}</button>}</div></div>)}</div> : <CrewEmptyState title={t("inventory.noRequired")} body={t("inventory.noRequiredBody")} />}
      </> : <CrewEmptyState title={t("inventory.noAccess")} />)}
      {tab === "audit" && (data.can_create_audit_stock_check ? <><button className="crew-mobile-primary crew-inventory-add" type="button" onClick={() => { setAuditForm({ type: "Spot Check", categoryIds: [], notes: "", closingMonth: "" }); pendingRequest.current = null; setError(""); setAuditOpen(true); }}><Plus size={18} />{t("inventory.newAudit")}</button><div className="crew-inventory-list">{(data.checks || []).filter((row) => row.type === "audit" && row.status === "draft").map((row) => <div className="crew-inventory-audit-row" key={row.id}><button type="button" onClick={() => void openSaved(row.id)} aria-label={`${t("inventory.homeContinue")}: ${row.name}`}><CrewInventoryItemThumb item={itemById.get(row.cover_item_id)} /><span><strong>{row.name}</strong><small>{row.audit_type} · {t("inventory.homeItemCount", { count: row.item_count || 0 })}</small><small>{t("inventory.homeContinue")}</small></span><CrewStatusBadge tone="warning">{t("inventory.draft")}</CrewStatusBadge><ChevronRight size={16} /></button><button type="button" aria-label={t("inventory.deleteDraft")} onClick={() => setDeleteTarget(row.id)}><Trash2 size={18} /></button></div>)}</div>{!(data.checks || []).some((row) => row.type === "audit" && row.status === "draft") && <CrewEmptyState title={t("inventory.noAuditDrafts")} />}</> : <CrewEmptyState title={t("inventory.noAccess")} />)}
      {tab === "history" && <><CrewHistoryControls month={historyView.month} onMonthChange={historyView.setMonth} status={historyView.status} onStatusChange={historyView.setStatus} statuses={["completed", "missed", "skipped"]} />{historyView.error && <p className="crew-v2-error" role="alert">{historyView.error}</p>}<div className="crew-inventory-list">{history.map((row) => <div className="crew-inventory-history-entry" key={row.id || `${row.group_id}-${row.check_date}`}><CrewInventoryItemThumb item={itemById.get(row.cover_item_id) || { photo_url: row.cover_photo_url, name: row.name }} inspectable={row.status === "completed"} /><button type="button" onClick={() => row.id ? void openSaved(row.id) : (setCheck({ ...row, stock_check_type: "scheduled", check_name: row.name }), setRows([]))}><span><strong>{row.name}</strong><small>{[row.check_date, t(`inventory.${row.type}`), row.status === "completed" ? t("inventory.homeItemCount", { count: row.item_count || 0 }) : null].filter(Boolean).join(" · ")}</small></span><CrewStatusBadge tone={row.status === "completed" ? "success" : row.status === "missed" ? "danger" : "neutral"}>{t(`inventory.${row.status}`)}</CrewStatusBadge><ChevronRight size={18} /></button></div>)}{!history.length && !historyView.loading && <CrewEmptyState title={t("inventory.noHistory")} />}</div>{historyView.loading && <p className="crew-inventory-state" role="status">{t("common.loading")}</p>}{historyView.hasMore && <button className="crew-mobile-secondary crew-inventory-load-more" type="button" disabled={historyView.loading} onClick={historyView.loadMore}>{t("inventory.loadMore")}</button>}</>}
    </>}
    {auditOpen && <CrewBottomSheet title={t("inventory.newAudit")} onClose={() => setAuditOpen(false)} closeDisabled={busy} footer={<>
      <button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setAuditOpen(false)}>{t("common.cancel")}</button>
      <button className="crew-mobile-primary" type="button" disabled={busy || !canStartAudit} onClick={startAudit}>{t(busy ? "common.saving" : "common.continue")}</button>
    </>}>
      <div className="crew-inventory-form">
        <CrewChoicePicker label={t("inventory.auditType")} value={auditForm.type} options={auditTypes.map((value) => ({ value, label: t(`inventory.auditTypes.${value}`) }))} onChange={(type) => setAuditForm((current) => ({ ...current, type }))} />
        {isNewClosing ? <>
          <CrewDatePicker monthOnly label={t("inventory.accountingMonth")} placeholder={t("inventory.selectAccountingMonth")}
            value={auditForm.closingMonth} onChange={closingMonth => setAuditForm(current => ({ ...current, closingMonth }))} />
          <p>{t("inventory.closingCoverage", { count: auditItems.length })}</p>
        </> : <>
          <fieldset><legend>{t("inventory.categories")}</legend>{(catalog?.categories || []).map((item) => <label key={item.id}>
            <input type="checkbox" checked={auditForm.categoryIds.includes(item.id)} onChange={(event) => setAuditForm((current) => ({ ...current, categoryIds: event.target.checked ? [...current.categoryIds, item.id] : current.categoryIds.filter((id) => id !== item.id) }))} />{item.name}
          </label>)}</fieldset>
        </>}
        <label>{t("inventory.notes")}<textarea value={auditForm.notes} onChange={(event) => setAuditForm((current) => ({ ...current, notes: event.target.value }))} /></label>
        {error && <p className="crew-v2-error" role="alert">{error}</p>}
      </div>
    </CrewBottomSheet>}
    {deleteTarget && <CrewMobileModal title={t("inventory.deleteDraft")} onClose={() => setDeleteTarget(null)} closeDisabled={busy} footer={<><button className="crew-mobile-secondary" type="button" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void deleteDraft()}>{t("inventory.deleteDraft")}</button></>}><p>{t("inventory.deleteDraftBody")}</p></CrewMobileModal>}
    {skipTarget && <CrewBottomSheet title={t("inventory.skipCheckTitle")} description={t("inventory.skipCheckBody")} onClose={() => setSkipTarget(null)} closeDisabled={busy} footer={<><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setSkipTarget(null)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void skipScheduled()}>{t("inventory.confirmSkip")}</button></>}><CrewChoicePicker label={t("inventory.optionalReason")} value={skipReason} options={[{ value: "", label: t("inventory.noReason") }, ...["stock_sufficient", "recently_checked", "other"].map((value) => ({ value, label: t(`inventory.skipReasons.${value}`) }))]} onChange={setSkipReason} />{error && <p className="crew-v2-error" role="alert">{error}</p>}</CrewBottomSheet>}
  </section>;
}

function CountRow({ row, item, counted, onSkip, onChange, t }) {
  const status = countStatus(row, counted);
  const expected = row.par_level_quantity;
  const name = item?.name || row.item_name || t("inventory.item");
  return <article className={`crew-inventory-count-row is-${status}`}>
    <div className="crew-inventory-row-head">
      <CrewInventoryItemThumb item={item || row} inspectable />
      <span><strong>{name}</strong><small>{item?.sku || row.sku_code || ""}</small></span>
      <span className="crew-inventory-count-state">{t(`inventory.${status}`)}</span>
    </div>
    <p>{t("inventory.expectedPar")}: <strong>{expected ?? "—"} {row.unit}</strong></p>
    {row.skipped ? <div className="crew-inventory-row-actions">
      <small>{row.skip_reason}</small>
      <button type="button" onClick={() => onChange({ skipped: false, skip_reason: "" })}>{t("inventory.undoSkip")}</button>
    </div> : <>
      <CrewQuantityStepper value={String(row.actual_count_quantity)} onChange={value => onChange({ actual_count_quantity: value })}
        label={t("inventory.actualCount")} ariaLabel={`${name} · ${t("inventory.actualCount")}`} unit={row.unit} />
      <div className="crew-inventory-row-actions">
        <small>{counted && expected != null ? t("inventory.variance", { value: Number(row.actual_count_quantity) - Number(expected) }) : ""}</small>
        <button type="button" onClick={() => onSkip(name)}>{t("inventory.skipItem")}</button>
      </div>
    </>}
  </article>;
}

function ReviewRows({ rows, itemById, t }) {
  return <div className="crew-inventory-review"><p>{t("inventory.reviewHelp")}</p>{rows.map((row) => <div key={row.item_id}><span><strong>{itemById.get(row.item_id)?.name || row.item_name || t("inventory.item")}</strong><small>{t("inventory.expectedPar")}: {row.par_level_quantity ?? "—"} {row.unit}</small></span><strong>{row.skipped ? t("inventory.skipped") : `${row.actual_count_quantity} ${row.unit}`}</strong>{!row.skipped && row.par_level_quantity != null && Number(row.actual_count_quantity) !== Number(row.par_level_quantity) && <small>{t("inventory.variance", { value: Number(row.actual_count_quantity) - Number(row.par_level_quantity) })}</small>}</div>)}</div>;
}

function LifecycleResult({ check, t }) {
  return <div className="crew-inventory-lifecycle-result">
    <CrewStatusBadge tone={check.status === "missed" ? "danger" : "neutral"}>{t(`inventory.${check.status}`)}</CrewStatusBadge>
    <p>{t(check.status === "missed" ? "inventory.missedEvidence" : "inventory.skippedEvidence")}</p>
    <dl><div><dt>{t("inventory.checkDate")}</dt><dd>{check.check_date}</dd></div>
      {check.skipped_at && <div><dt>{t("inventory.skippedAt")}</dt><dd>{formatCrewOperationalDateTime(check.skipped_at)}</dd></div>}
      {check.skipped_by_name && <div><dt>{t("inventory.skippedBy")}</dt><dd>{check.skipped_by_name}</dd></div>}
      {check.skip_reason && <div><dt>{t("inventory.optionalReason")}</dt><dd>{t(`inventory.skipReasons.${check.skip_reason}`)}</dd></div>}
    </dl>
  </div>;
}

function CompletedResult({ check, rows, itemById, purchase, canReviewSuggestions, onRetry, onReview, onOpenPurchaseOrder, t, language }) {
  const shortages = purchase?.source?.shortages || [];
  const supplierCount = new Set(shortages.flatMap((item) => (item.suppliers || []).map((supplier) => supplier.id))).size;
  const varianceCount = rows.filter((row) => isCounted(row) && row.par_level_quantity != null && Number(row.actual_count_quantity) !== Number(row.par_level_quantity)).length;
  const skippedCount = rows.filter((row) => row.skipped).length;
  const counted = rows.filter(isCounted).length;
  const completedAt = check.stock_check_type !== "audit" && check.submitted_at && new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(check.submitted_at));
  return <div className="crew-inventory-result"><div className="crew-inventory-result-summary"><strong><Check size={18} />{t("inventory.checkCompleted")}</strong>{completedAt && <small>{completedAt}</small>}<span>{t("inventory.resultSummary", { items: rows.length, counted, variances: varianceCount, skipped: skippedCount })}</span><small>{t("inventory.readOnlyEvidence")}</small></div>
    {purchase?.loading ? <p role="status">{t("inventory.loadingSuggestions")}</p> : purchase?.error ? <div className="crew-inventory-purchase-result"><p role="alert">{purchase.error}</p><button className="crew-mobile-secondary" type="button" onClick={onRetry}>{t("common.retry")}</button></div> : shortages.length ? <div className="crew-inventory-purchase-result"><strong>{t("inventory.restockSummary", { items: t("inventory.itemsBelowPar", { count: shortages.length }), suppliers: t("inventory.supplierCount", { count: supplierCount }) })}</strong><small>{t("inventory.suggestedQuantities", { quantities: shortages.map((item) => `${item.shortage_qty} ${item.unit}`).join(" · ") })}</small>{canReviewSuggestions && <button className="crew-mobile-primary" type="button" onClick={onReview}>{t("inventory.reviewPurchaseSuggestions")}</button>}</div> : purchase?.orders?.length ? <p className="crew-inventory-context">{t("inventory.purchaseAlreadyCreated")}</p> : purchase ? <p className="crew-inventory-context">{t("inventory.noRestockNeeded")}</p> : null}
    {purchase?.orders?.map((order) => <button className="crew-inventory-related-order" type="button" key={order.id} onClick={() => onOpenPurchaseOrder?.(order.id)}>{order.business_po_no || t("inventory.purchaseOrder")} · {t(`inventory.status.${order.status}`)} <ChevronRight size={16} /></button>)}
    <div className="crew-inventory-result-items">{rows.map((row) => { const delta = !isCounted(row) || row.par_level_quantity == null ? null : Number(row.actual_count_quantity) - Number(row.par_level_quantity); return <article key={row.item_id} className={delta ? "has-variance" : ""}><CrewInventoryItemThumb item={itemById.get(row.item_id) || row} inspectable /><div><strong>{itemById.get(row.item_id)?.name || row.item_name || t("inventory.item")}</strong><small>{itemById.get(row.item_id)?.sku || row.sku_code || ""}</small><span>{t("inventory.expectedPar")}: {row.par_level_quantity ?? "—"} {row.unit}</span><span>{t("inventory.actualCount")}: {row.skipped ? t("inventory.skipped") : `${row.actual_count_quantity} ${row.unit}`}</span>{row.skipped && row.skip_reason && <small>{row.skip_reason}</small>}</div>{delta !== null && <strong className="crew-inventory-result-variance">{t("inventory.variance", { value: delta > 0 ? `+${delta}` : delta })}</strong>}</article>; })}</div></div>;
}
