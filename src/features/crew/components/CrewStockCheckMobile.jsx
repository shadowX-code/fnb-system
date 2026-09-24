import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Plus, Trash2 } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import CrewChoicePicker from "./CrewChoicePicker.jsx";
import CrewDatePicker from "./CrewDatePicker.jsx";
import CrewQuantityStepper from "./CrewQuantityStepper.jsx";
import CrewInventoryItemThumb from "./CrewInventoryItemThumb.jsx";
import { CrewEmptyState, CrewProgressBar, CrewSearchBar, CrewStatusBadge } from "./CrewMobileUI.jsx";

const auditTypes = ["Month-End Closing", "Full Stock Audit", "Spot Check", "Category Audit", "Custom Audit"];
const requestId = () => crypto.randomUUID();
const isDone = (row) => row.skipped ? Boolean(row.skip_reason?.trim()) : row.actual_count_quantity !== "" && row.actual_count_quantity !== null && row.actual_count_quantity !== undefined && Number(row.actual_count_quantity) >= 0;
const asRow = (row) => ({ item_id: row.item_id || row.id, item_name: row.item_name || row.name, sku_code: row.sku_code || row.sku, category_id: row.category_id,
  par_level_quantity: row.par_level_quantity ?? row.par_level ?? null,
  actual_count_quantity: row.actual_count_quantity ?? "", unit: row.unit || "",
  notes: row.notes || "", skipped: Boolean(row.skipped), skip_reason: row.skip_reason || "" });
const countStatus = (row) => row.skipped ? "skipped" : !isDone(row) ? "pending" : row.par_level_quantity == null ? "normal" : Number(row.actual_count_quantity) < Number(row.par_level_quantity) ? "shortage" : Number(row.actual_count_quantity) > Number(row.par_level_quantity) ? "excess" : "normal";
const serializeRows = (rows) => rows.map((row) => ({ item_id: row.item_id, category_id: row.category_id,
  par_level_quantity: row.par_level_quantity, actual_count_quantity: row.skipped || row.actual_count_quantity === "" ? null : Number(row.actual_count_quantity),
  actual_missing: !row.skipped && row.actual_count_quantity === "", variance: row.skipped || row.actual_count_quantity === "" || row.par_level_quantity == null ? null : Number(row.actual_count_quantity) - Number(row.par_level_quantity),
  unit: row.unit, status: countStatus(row), notes: row.notes || null, skipped: row.skipped, skip_reason: row.skipped ? row.skip_reason.trim() : null }));

export default function CrewStockCheckMobile({ token, outletId, grants, initialTarget, onBack, onReviewSuggestions, onFlowChange }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null); const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [tab, setTab] = useState("required"); const [check, setCheck] = useState(null); const [rows, setRows] = useState([]);
  const [review, setReview] = useState(false); const [query, setQuery] = useState(""); const [category, setCategory] = useState("all");
  const [auditOpen, setAuditOpen] = useState(false); const [deleteTarget, setDeleteTarget] = useState(null);
  const [auditForm, setAuditForm] = useState({ type: "Spot Check", name: "", date: "", categoryIds: [], notes: "" });
  const [notice, setNotice] = useState(""); const [purchase, setPurchase] = useState(null); const pendingRequest = useRef(null); const activeRef = useRef(true);
  const [dirty, setDirty] = useState(false);
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
  const completed = rows.filter(isDone).length;
  const canComplete = rows.length > 0 && completed === rows.length;
  const visibleRows = rows.filter((row) => {
    const item = itemById.get(row.item_id);
    return (category === "all" || row.category_id === category) && `${item?.name || ""} ${item?.sku || ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const grouped = Object.entries(visibleRows.reduce((groups, row) => {
    const key = row.category_id || "other";
    (groups[key] ||= []).push(row);
    return groups;
  }, {}));
  const scheduledDrafts = (data?.checks || []).filter((row) => row.type === "scheduled" && row.status === "draft" && !(data?.due || []).some((group) => group.check_id === row.id)).sort((a, b) => String(b.updated_at || b.check_date).localeCompare(String(a.updated_at || a.check_date)));

  async function loadPurchaseResult(id, type) {
    if (type !== "scheduled" || !grants?.can_manage_purchase_orders) { setPurchase(null); return; }
    setPurchase({ loading: true });
    try {
      const result = await crewService.inventoryPurchaseOrders(token, outletId);
      if (!activeRef.current) return;
      setPurchase({ source: (result.suggestions || []).find((entry) => entry.stock_check_id === id) || null,
        orders: (result.orders || []).filter((order) => order.source_stock_check_id === id && order.status !== "cancelled") });
    } catch (cause) { if (activeRef.current) setPurchase({ error: cause.message || t("inventory.loadError") }); }
  }

  async function openSaved(id) {
    setBusy(true); setError("");
    try {
      const result = await crewService.inventoryStockChecks(token, outletId, id);
      if (!activeRef.current) return;
      const detail = result.detail;
      setPurchase(null);
      setCheck({ id: detail.id, stock_check_type: detail.type, status: detail.status, group_id: detail.group_id,
        check_name: detail.check_name, audit_name: detail.audit_name, audit_type: detail.audit_type,
        audit_category_ids: detail.audit_category_ids, check_date: detail.check_date, shift: detail.shift, notes: detail.notes });
      setRows((detail.items || []).map(asRow)); setReview(false); setQuery(""); setCategory("all"); pendingRequest.current = null; setDirty(false);
      if (detail.status === "submitted") void loadPurchaseResult(detail.id, detail.type);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  function startScheduled(group) {
    if (group.check_id) { void openSaved(group.check_id); return; }
    setCheck({ stock_check_type: "scheduled", status: "draft", group_id: group.group_id, check_name: group.name,
      check_date: group.business_date || data?.business_date, shift: group.shift });
    setRows((group.items || []).map(asRow)); setReview(false); setQuery(""); setCategory("all"); pendingRequest.current = null; setDirty(false);
  }
  function startAudit() {
    const selected = auditForm.categoryIds;
    if (!auditForm.name.trim() || selected.length === 0 || !(catalog?.items || []).some((item) => selected.includes(item.category_id))) return;
    setCheck({ stock_check_type: "audit", status: "draft", audit_type: auditForm.type,
      audit_name: auditForm.name.trim(), check_name: auditForm.name.trim(), audit_category_ids: selected,
      check_date: auditForm.date || catalog.business_date, notes: auditForm.notes });
    setRows((catalog.items || []).filter((item) => selected.includes(item.category_id)).map(asRow));
    setAuditOpen(false); setReview(false); setTab("audit"); pendingRequest.current = null; setDirty(true);
  }
  function updateRow(itemId, patch) { setRows((current) => current.map((row) => row.item_id === itemId ? { ...row, ...patch } : row)); setDirty(true); }
  async function save(status) {
    if (busy || !check) return;
    if (status === "submitted" && !canComplete) { setError(t("inventory.completeCountsFirst")); setReview(false); return; }
    const payload = { ...check, outlet_id: outletId, status };
    const items = serializeRows(rows);
    const signature = JSON.stringify({ payload, items });
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: requestId() };
    setBusy(true); setError("");
    try {
      const result = await crewService.saveInventoryStockCheck(token, outletId, pendingRequest.current.id, payload, items);
      if (!activeRef.current) return;
      pendingRequest.current = null;
      setDirty(false);
      if (status === "submitted") {
        const completedId = result.check.id;
        setCheck((current) => ({ ...current, id: completedId, status: "submitted" })); setReview(false);
        setNotice(t("inventory.checkCompleted")); void loadPurchaseResult(completedId, check.stock_check_type);
      }
      else {
        setCheck((current) => ({ ...current, id: result.check.id, status: "draft" }));
        setNotice(t("inventory.draftSaved")); await load();
      }
    } catch (cause) { setError(cause.message || t("inventory.saveError")); }
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
  const backFromCheck = () => {
    if (busy) return;
    if (check?.status === "draft" && dirty) {
      setError(t("inventory.saveBeforeLeaving")); return;
    }
    setCheck(null); setRows([]); setReview(false); setPurchase(null); setError(""); void load();
  };

  if (check) return <section className="crew-inventory-page">
    <CrewMobileDetailHeader title={check.audit_name || check.check_name || t("inventory.stockCheck")} subtitle={check.check_date} onBack={review ? () => setReview(false) : backFromCheck} />
    <div className="crew-inventory-progress"><span><strong>{t("inventory.progress", { done: completed, total: rows.length })} <em>{rows.length ? Math.round(completed / rows.length * 100) : 0}%</em></strong><CrewStatusBadge tone={check.status === "submitted" ? "success" : "warning"}>{check.status === "submitted" ? t("inventory.completed") : t("inventory.draft")}</CrewStatusBadge></span><CrewProgressBar value={rows.length ? Math.round(completed / rows.length * 100) : 0} /></div>
    {check.status === "submitted" ? <CompletedResult rows={rows} itemById={itemById} purchase={purchase} onRetry={() => void loadPurchaseResult(check.id, check.stock_check_type)} onReview={() => onReviewSuggestions?.(check.id)} t={t} /> : review ? <ReviewRows rows={rows} itemById={itemById} t={t} /> : <>
      <CrewSearchBar value={query} onChange={setQuery} placeholder={t("inventory.searchItems")} />
      <div className="crew-v2-chips crew-inventory-chips" role="group" aria-label={t("inventory.categories")}>{[{ id: "all", name: t("inventory.all") }, ...(catalog?.categories || []).filter((item) => rows.some((row) => row.category_id === item.id))].map((item) => <button key={item.id} type="button" className={category === item.id ? "active" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>
      {grouped.map(([categoryId, groupRows]) => <section className="crew-inventory-count-group" key={categoryId}><h2>{categoryById.get(categoryId) || t("inventory.other")}</h2>{groupRows.map((row) => <CountRow key={row.item_id} row={row} item={itemById.get(row.item_id)} onChange={(patch) => updateRow(row.item_id, patch)} t={t} />)}</section>)}
      {!visibleRows.length && <CrewEmptyState title={t("inventory.noItems")} body={t("inventory.trySearch")} />}
    </>}
    {error && <p className="crew-v2-error" role="alert">{error}</p>}
    {check.status !== "submitted" && <div className="crew-inventory-sticky"><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => void save("draft")}>{busy ? t("common.saving") : t("inventory.saveDraft")}</button><button className="crew-mobile-primary" type="button" disabled={busy || !canComplete} onClick={() => review ? void save("submitted") : setReview(true)}>{review ? t("inventory.completeCheck") : `${t("inventory.review")} (${completed}/${rows.length})`}</button></div>}
  </section>;

  return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.stockCheck")} onBack={onBack} />
    <div className="crew-ui-tabs crew-inventory-tabs" role="tablist" aria-label={t("inventory.stockCheck")}>{["required", "audit", "history"].map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{t(`inventory.${value}`)}</button>)}</div>
    {notice && <p className="crew-inventory-notice" role="status">{notice}</p>}
    {error && <p className="crew-v2-error" role="alert">{error}</p>}
    {!grants?.can_perform_stock_check && !grants?.can_create_audit_stock_check ? <CrewEmptyState title={t("inventory.noAccess")} /> : loading ? <p className="crew-inventory-state" role="status">{t("common.loading")}</p> : !data ? <button className="crew-mobile-secondary" type="button" onClick={() => void load()}>{t("common.retry")}</button> : <>
      {tab === "required" && (data.can_perform_stock_check ? <>
        {(data.due || []).length ? <div className="crew-inventory-list">{data.due.map((group) => <button key={group.group_id} type="button" onClick={() => startScheduled(group)}><CrewInventoryItemThumb item={itemById.get(group.items?.[0]?.item_id)} /><span><strong>{group.name}</strong><small>{group.shift} · {group.items?.length || 0} {t("inventory.items")}</small></span><CrewStatusBadge tone={group.status === "completed" ? "success" : group.status === "draft" ? "info" : "warning"}>{t(`inventory.${group.status}`)}</CrewStatusBadge><ChevronRight size={18} /></button>)}</div> : <CrewEmptyState title={t("inventory.noRequired")} body={t("inventory.noRequiredBody")} />}
        {scheduledDrafts.length > 0 && <section className="crew-inventory-draft-section"><h2>{t("inventory.resumeDrafts")}</h2><div className="crew-inventory-list">{scheduledDrafts.map((row) => <button key={row.id} type="button" onClick={() => void openSaved(row.id)}><CrewInventoryItemThumb item={itemById.get(row.cover_item_id)} /><span><strong>{row.name}</strong><small>{row.check_date} · {row.item_count} {t("inventory.items")}</small>{row.updated_at && <small>{t("inventory.updatedAt", { date: new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(row.updated_at)) })}</small>}</span><CrewStatusBadge tone="info">{t("inventory.draft")}</CrewStatusBadge><ChevronRight size={18} /></button>)}</div></section>}
      </> : <CrewEmptyState title={t("inventory.noAccess")} />)}
      {tab === "audit" && (data.can_create_audit_stock_check ? <><button className="crew-mobile-primary crew-inventory-add" type="button" onClick={() => { setAuditForm({ type: "Spot Check", name: "", date: catalog.business_date, categoryIds: [], notes: "" }); setAuditOpen(true); }}><Plus size={18} />{t("inventory.newAudit")}</button><div className="crew-inventory-list">{(data.checks || []).filter((row) => row.type === "audit" && row.status === "draft").map((row) => <div className="crew-inventory-audit-row" key={row.id}><button type="button" onClick={() => void openSaved(row.id)}><CrewInventoryItemThumb item={itemById.get(row.cover_item_id)} /><span><strong>{row.name}</strong><small>{row.audit_type} · {row.item_count} {t("inventory.items")}</small></span><CrewStatusBadge tone="warning">{t("inventory.draft")}</CrewStatusBadge><ChevronRight size={18} /></button><button type="button" aria-label={t("inventory.deleteDraft")} onClick={() => setDeleteTarget(row.id)}><Trash2 size={18} /></button></div>)}</div>{!(data.checks || []).some((row) => row.type === "audit" && row.status === "draft") && <CrewEmptyState title={t("inventory.noAuditDrafts")} />}</> : <CrewEmptyState title={t("inventory.noAccess")} />)}
      {tab === "history" && <div className="crew-inventory-list">{(data.checks || []).filter((row) => row.status === "submitted").map((row) => <button key={row.id} type="button" onClick={() => void openSaved(row.id)}><span><strong>{row.name}</strong><small>{row.check_date} · {row.item_count} {t("inventory.items")}</small></span><CrewStatusBadge tone="success">{t("inventory.completed")}</CrewStatusBadge><ChevronRight size={18} /></button>)}{!(data.checks || []).some((row) => row.status === "submitted") && <CrewEmptyState title={t("inventory.noHistory")} />}</div>}
    </>}
    {auditOpen && <CrewBottomSheet title={t("inventory.newAudit")} onClose={() => setAuditOpen(false)} footer={<><button className="crew-mobile-secondary" type="button" onClick={() => setAuditOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={!auditForm.name.trim() || !(catalog?.items || []).some((item) => auditForm.categoryIds.includes(item.category_id))} onClick={startAudit}>{t("common.continue")}</button></>}><div className="crew-inventory-form"><CrewChoicePicker label={t("inventory.auditType")} value={auditForm.type} options={auditTypes.map((value) => ({ value, label: t(`inventory.auditTypes.${value}`) }))} onChange={(type) => setAuditForm((current) => ({ ...current, type }))} /><label>{t("inventory.auditName")}<input value={auditForm.name} onChange={(event) => setAuditForm((current) => ({ ...current, name: event.target.value }))} /></label><CrewDatePicker label={t("inventory.checkDate")} value={auditForm.date} onChange={(date) => setAuditForm((current) => ({ ...current, date }))} /><fieldset><legend>{t("inventory.categories")}</legend>{(catalog?.categories || []).map((item) => <label key={item.id}><input type="checkbox" checked={auditForm.categoryIds.includes(item.id)} onChange={(event) => setAuditForm((current) => ({ ...current, categoryIds: event.target.checked ? [...current.categoryIds, item.id] : current.categoryIds.filter((id) => id !== item.id) }))} />{item.name}</label>)}</fieldset><label>{t("inventory.notes")}<textarea value={auditForm.notes} onChange={(event) => setAuditForm((current) => ({ ...current, notes: event.target.value }))} /></label></div></CrewBottomSheet>}
    {deleteTarget && <CrewMobileModal title={t("inventory.deleteDraft")} onClose={() => setDeleteTarget(null)} closeDisabled={busy} footer={<><button className="crew-mobile-secondary" type="button" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void deleteDraft()}>{t("inventory.deleteDraft")}</button></>}><p>{t("inventory.deleteDraftBody")}</p></CrewMobileModal>}
  </section>;
}

function CountRow({ row, item, onChange, t }) {
  const status = countStatus(row); const expected = row.par_level_quantity;
  const name = item?.name || row.item_name || t("inventory.item");
  return <article className={`crew-inventory-count-row is-${status}`}><div className="crew-inventory-row-head"><CrewInventoryItemThumb item={item} /><span><strong>{name}</strong><small>{item?.sku || row.sku_code || ""}</small></span><span className="crew-inventory-count-state">{t(`inventory.${status}`)}</span></div><p>{t("inventory.expectedPar")}: <strong>{expected ?? "—"} {row.unit}</strong></p>{row.skipped ? <div className="crew-inventory-form"><label>{t("inventory.skipReason")}<input value={row.skip_reason} onChange={(event) => onChange({ skip_reason: event.target.value })} /></label><button className="crew-mobile-secondary" type="button" onClick={() => onChange({ skipped: false, skip_reason: "" })}>{t("inventory.undoSkip")}</button></div> : <><CrewQuantityStepper value={String(row.actual_count_quantity)} onChange={(value) => onChange({ actual_count_quantity: value })} label={t("inventory.actualCount")} ariaLabel={`${name} · ${t("inventory.actualCount")}`} unit={row.unit} /><div className="crew-inventory-row-actions"><small>{isDone(row) && expected != null ? t("inventory.variance", { value: Number(row.actual_count_quantity) - Number(expected) }) : ""}</small><button type="button" onClick={() => onChange({ skipped: true, actual_count_quantity: "" })}>{t("inventory.skip")}</button></div></> }</article>;
}

function ReviewRows({ rows, itemById, t }) {
  return <div className="crew-inventory-review"><p>{t("inventory.reviewHelp")}</p>{rows.map((row) => <div key={row.item_id}><span><strong>{itemById.get(row.item_id)?.name || row.item_name || t("inventory.item")}</strong><small>{t("inventory.expectedPar")}: {row.par_level_quantity ?? "—"} {row.unit}</small></span><strong>{row.skipped ? t("inventory.skipped") : `${row.actual_count_quantity} ${row.unit}`}</strong>{!row.skipped && row.par_level_quantity != null && Number(row.actual_count_quantity) !== Number(row.par_level_quantity) && <small>{t("inventory.variance", { value: Number(row.actual_count_quantity) - Number(row.par_level_quantity) })}</small>}</div>)}</div>;
}

function CompletedResult({ rows, itemById, purchase, onRetry, onReview, t }) {
  const shortages = purchase?.source?.shortages || [];
  const supplierCount = new Set(shortages.flatMap((item) => (item.suppliers || []).map((supplier) => supplier.id))).size;
  return <div className="crew-inventory-result"><p><Check size={18} />{t("inventory.immutableResult")}</p>
    {purchase?.loading ? <p role="status">{t("inventory.loadingSuggestions")}</p> : purchase?.error ? <div className="crew-inventory-purchase-result"><p role="alert">{purchase.error}</p><button className="crew-mobile-secondary" type="button" onClick={onRetry}>{t("common.retry")}</button></div> : shortages.length ? <div className="crew-inventory-purchase-result"><strong>{t("inventory.restockSummary", { items: t("inventory.itemsBelowPar", { count: shortages.length }), suppliers: t("inventory.supplierCount", { count: supplierCount }) })}</strong><small>{t("inventory.suggestedQuantities", { quantities: shortages.map((item) => `${item.shortage_qty} ${item.unit}`).join(" · ") })}</small><button className="crew-mobile-primary" type="button" onClick={onReview}>{t("inventory.reviewPurchaseSuggestions")}</button></div> : purchase?.orders?.length ? <p className="crew-inventory-context">{t("inventory.purchaseAlreadyCreated")}</p> : purchase ? <p className="crew-inventory-context">{t("inventory.noRestockNeeded")}</p> : null}
    <ReviewRows rows={rows} itemById={itemById} t={t} /></div>;
}
