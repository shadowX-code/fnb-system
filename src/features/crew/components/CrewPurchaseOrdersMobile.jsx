import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import { formatPurchaseOrderText } from "../../sales-purchase/inventory/purchaseOrders/purchaseOrderText.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import CrewChoicePicker from "./CrewChoicePicker.jsx";
import CrewQuantityStepper from "./CrewQuantityStepper.jsx";
import CrewInventoryItemThumb from "./CrewInventoryItemThumb.jsx";
import { CrewEmptyState, CrewSearchBar, CrewStatusBadge } from "./CrewMobileUI.jsx";

const newId = () => crypto.randomUUID();
const isActive = (status) => ["submitted", "supplier_confirmed", "partial_received"].includes(status);
const editableLine = (line) => ({ item_id: line.item_id, requested_qty: String(line.requested_qty ?? ""), unit: line.unit || "", remark: line.remark || "", source_stock_check_item_id: line.source_stock_check_item_id || null });
const displayPoNo = (order) => order?.business_po_no || "";
const relevantDate = (order) => order?.completed_at || order?.confirmed_at || order?.submitted_at || order?.created_at;
const categorySummary = (names, t) => names?.length ? names.length === 1 ? names[0] : t("inventory.homeMoreCategories", { name: names[0], count: names.length - 1 }) : t("inventory.items");
const sourceRows = (check, orders) => {
  const usedSuppliers = new Set(orders.filter((order) => order.source_stock_check_id === check.stock_check_id && order.status !== "cancelled").map((order) => order.supplier_id));
  return (check.shortages || []).map((shortage) => {
    const suppliers = (shortage.suppliers || []).filter((supplier) => !usedSuppliers.has(supplier.id));
    return { ...shortage, suppliers, supplier_id: suppliers[0]?.id || "", included: Boolean(suppliers.length), requested_qty: String(shortage.shortage_qty) };
  });
};

export default function CrewPurchaseOrdersMobile({ token, outletId, grants, initialTarget, onBack, onFlowChange }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null); const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("active"); const [detail, setDetail] = useState(null); const [mode, setMode] = useState("list");
  const [source, setSource] = useState(null); const [sourceItems, setSourceItems] = useState([]); const [missingSourceId, setMissingSourceId] = useState(null);
  const [supplierId, setSupplierId] = useState(""); const [lines, setLines] = useState([]); const [remark, setRemark] = useState("");
  const [query, setQuery] = useState(""); const [itemPicker, setItemPicker] = useState(false); const [receiveQty, setReceiveQty] = useState({}); const [copyFallback, setCopyFallback] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [dirty, setDirty] = useState(false); const request = useRef(null); const newPoNo = useRef(null); const sourcePoNos = useRef({}); const active = useRef(true);
  const initialOpened = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; onFlowChange?.(false); }; }, [onFlowChange]);
  useEffect(() => { onFlowChange?.(mode !== "list"); }, [mode, onFlowChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function load() {
    if (!grants?.can_manage_purchase_orders && !grants?.can_receive_purchase_orders) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [orders, choices] = await Promise.all([crewService.inventoryPurchaseOrders(token, outletId), crewService.inventoryMobileCatalog(token, outletId)]);
      if (active.current) {
        setData(orders); setCatalog(choices);
        if (!initialOpened.current && initialTarget?.stock_check_id) {
          initialOpened.current = true;
          const check = (orders.suggestions || []).find((entry) => entry.stock_check_id === initialTarget.stock_check_id);
          const existing = (orders.orders || []).find((order) => order.source_stock_check_id === initialTarget.stock_check_id && order.status !== "cancelled");
          if (check) startFromCheck(check, orders.orders || []);
          else if (existing) void openOrder(existing.id);
          else { setMissingSourceId(initialTarget.stock_check_id); setMode("sources"); }
        } else if (initialTarget?.id && !initialOpened.current) { initialOpened.current = true; void openOrder(initialTarget.id, { receive: ["supplier_confirmed", "partial_received"].includes(initialTarget.status), edit: initialTarget.status === "draft" }); }
      }
    } catch (cause) { if (active.current) setError(cause.message || t("inventory.loadError")); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [token, outletId]);
  const itemById = useMemo(() => new Map([
    ...(detail?.lines || []).map((line) => [line.item_id, { id: line.item_id, name: line.item_name, unit: line.unit, sku: line.sku_code, photo_url: line.photo_url }]),
    ...(catalog?.items || []).map((item) => [item.id, item]),
  ]), [catalog, detail]);
  const canManage = Boolean(data?.can_manage_purchase_orders);
  const canReceive = Boolean(data?.can_receive_purchase_orders);
  const filteredOrders = (data?.orders || []).filter((order) => tab === "drafts" ? order.status === "draft" : tab === "completed" ? ["fully_received", "completed", "cancelled"].includes(order.status) : isActive(order.status));

  async function openOrder(id, { receive = false, edit = false } = {}) {
    setBusy(true); setError("");
    try {
      const next = await crewService.inventoryPurchaseOrders(token, outletId, id);
      if (active.current) {
        const canStartReceiving = receive && next.can_receive_purchase_orders && ["supplier_confirmed", "partial_received"].includes(next.detail?.status);
        const canEdit = edit && next.can_manage_purchase_orders && next.detail?.status === "draft";
        setDetail(next.detail); setMode(canStartReceiving ? "receive" : canEdit ? "editor" : "detail"); setDirty(false); request.current = null;
        if (canStartReceiving) { setReceiveQty(Object.fromEntries((next.detail.lines || []).map((line) => [line.id, ""]))); setRemark(""); }
        if (canEdit) { setSource(null); setSupplierId(next.detail.supplier_id); setLines((next.detail.lines || []).map(editableLine)); setRemark(next.detail.remark || ""); }
      }
    } catch (cause) { if (active.current) setError(cause.message); }
    finally { if (active.current) setBusy(false); }
  }
  function startManual() { setSource(null); setSupplierId(""); setLines([]); setRemark(""); setDetail(null); setMode("editor"); setDirty(false); request.current = null; newPoNo.current = null; }
  function startFromCheck(check, existingOrders = data?.orders || []) { setSource(check); setSourceItems(sourceRows(check, existingOrders)); setMissingSourceId(null); setDetail(null); setMode("suggestions"); setDirty(false); request.current = null; sourcePoNos.current = {}; }
  function editDraft() { setSource(null); setSupplierId(detail.supplier_id); setLines((detail.lines || []).map(editableLine)); setRemark(detail.remark || ""); setMode("editor"); setDirty(false); request.current = null; }
  function selectSupplier(id) {
    setSupplierId(id); setDirty(true);
    setLines([]);
  }
  function updateSourceItem(id, patch) { setSourceItems((current) => current.map((item) => item.stock_check_item_id === id ? { ...item, ...patch } : item)); setDirty(true); }
  function updateLine(id, patch) { setLines((current) => current.map((line) => line.item_id === id ? { ...line, ...patch } : line)); setDirty(true); }
  function goBack() {
    if (busy) return;
    if (dirty) { setDiscardOpen(true); return; }
    leaveEditor();
  }
  function leaveEditor() {
    if (mode === "editor" && detail) setMode("detail");
    else if (mode === "suggestions") setMode("sources");
    else { setMode("list"); setDetail(null); void load(); }
    setError("");
  }
  function discardChanges() { setDiscardOpen(false); setDirty(false); setLines([]); request.current = null; newPoNo.current = null; leaveEditor(); }
  const validLines = lines.length > 0 && lines.every((line) => Number(line.requested_qty) > 0 && line.unit);
  const sourceSuppliers = detail?.source_stock_check_id ? (catalog?.suppliers || []).filter((supplier) => supplier.id === supplierId) : catalog?.suppliers || [];
  const selectedSourceItems = sourceItems.filter((item) => item.included && item.supplier_id);
  const sourceGroups = sourceItems.reduce((groups, item) => { (groups[item.supplier_id || "unassigned"] ||= []).push(item); return groups; }, {});
  const requestFor = (payload) => { const signature = JSON.stringify(payload); if (request.current?.signature !== signature) request.current = { signature, id: newId() }; return request.current.id; };
  async function saveDraft() {
    if (busy || !supplierId || !validLines) return;
    if (!detail?.id && !newPoNo.current) newPoNo.current = `PO-${newId().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const payload = { order: { id: detail?.id, po_no: detail?.po_no || newPoNo.current, outlet_id: outletId, supplier_id: supplierId, source_type: detail?.source_stock_check_id ? "stock_check" : "manual", source_stock_check_id: detail?.source_stock_check_id || null, status: "draft" }, items: lines.map((line) => ({ ...line, requested_qty: Number(line.requested_qty) })) };
    setBusy(true); setError("");
    try {
      const result = await crewService.saveInventoryPurchaseOrder(token, outletId, requestFor(payload), payload.order, payload.items);
      if (!active.current) return;
      const id = result?.order?.id;
      request.current = null; setDirty(false); setNotice(t("inventory.draftSaved")); await load();
      if (id) await openOrder(id); else setMode("list");
    } catch (cause) { if (active.current) setError(cause.message || t("inventory.saveError")); }
    finally { if (active.current) setBusy(false); }
  }
  async function saveSourceDrafts() {
    if (busy || !source || !selectedSourceItems.length || selectedSourceItems.some((item) => !Number.isFinite(Number(item.requested_qty)) || Number(item.requested_qty) <= 0)) return;
    const suppliers = [...new Set(selectedSourceItems.map((item) => item.supplier_id))];
    const ordersToCreate = suppliers.map((id) => {
      sourcePoNos.current[id] ||= `PO-${newId().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
      return { po_no: sourcePoNos.current[id], outlet_id: outletId, supplier_id: id, source_type: "stock_check", source_stock_check_id: source.stock_check_id, status: "draft",
        lines: selectedSourceItems.filter((item) => item.supplier_id === id).map((item) => ({ item_id: item.item_id, source_stock_check_item_id: item.stock_check_item_id, requested_qty: Number(item.requested_qty), unit: item.unit, remark: "" })) };
    });
    setBusy(true); setError("");
    try {
      const result = await crewService.createInventoryStockCheckOrders(token, outletId, requestFor(ordersToCreate), source.stock_check_id, ordersToCreate);
      if (!active.current) return;
      request.current = null; sourcePoNos.current = {}; setDirty(false); setSource(null);
      setNotice(t("inventory.sourceDraftsCreated", { count: result.length })); setTab("drafts");
      await load();
      if (result.length === 1 && result[0]?.order?.id) await openOrder(result[0].order.id); else setMode("list");
    } catch (cause) {
      if (active.current) {
        setError(cause.message || t("inventory.saveError"));
        try { const fresh = await crewService.inventoryPurchaseOrders(token, outletId); if (active.current) setData(fresh); } catch { /* Preserve the command error for retry. */ }
      }
    } finally { if (active.current) setBusy(false); }
  }
  async function transition(action) {
    if (busy || !detail) return;
    setBusy(true); setError("");
    try { await crewService.transitionInventoryPurchaseOrder(token, outletId, detail.id, requestFor({ id: detail.id, action }), action);
      if (!active.current) return;
      request.current = null; setReopenOpen(false);
      setNotice(t(action === "submit" ? "inventory.poSubmitted" : action === "confirm" ? "inventory.poConfirmed" : "inventory.poReopened"));
      await load(); await openOrder(detail.id, { edit: action === "reopen_draft" });
    } catch (cause) { if (active.current) setError(cause.message); }
    finally { if (active.current) setBusy(false); }
  }
  function startReceiving() { setReceiveQty(Object.fromEntries((detail.lines || []).map((line) => [line.id, ""]))); setRemark(""); setMode("receive"); request.current = null; }
  function receiveAllRemaining() { setReceiveQty(Object.fromEntries((detail.lines || []).map((line) => [line.id, Number(line.remaining_qty) > 0 ? String(line.remaining_qty) : ""]))); }
  const formatDate = (value) => value ? new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value)) : "";
  const itemFor = (line) => itemById.get(line.item_id) || { name: line.item_name, sku: line.sku_code, photo_url: line.photo_url };
  const receiptLines = (detail?.lines || []).filter((line) => Number(receiveQty[line.id]) > 0).map((line) => ({ purchase_order_item_id: line.id, item_id: line.item_id, received_qty: Number(receiveQty[line.id]), unit: line.unit }));
  const invalidReceipt = (detail?.lines || []).some((line) => Number(receiveQty[line.id]) > Number(line.remaining_qty) || Number(receiveQty[line.id]) < 0);
  async function receive() {
    if (busy || !receiptLines.length || invalidReceipt) return;
    setBusy(true); setError("");
    try { await crewService.receiveInventoryPurchaseOrder(token, outletId, detail.id, requestFor({ id: detail.id, receiptLines, remark }), remark, receiptLines);
      if (!active.current) return;
      request.current = null; setDirty(false); setNotice(t("inventory.receiptSaved")); await load(); await openOrder(detail.id);
    } catch (cause) { if (active.current) setError(cause.message); }
    finally { if (active.current) setBusy(false); }
  }
  async function copyText() {
    if (!detail) return;
    const text = formatPurchaseOrderText({ status: detail.status, createdAt: detail.created_at, remark: detail.remark,
      lines: (detail.lines || []).map((line) => ({ itemId: line.item_id, requestedQty: line.requested_qty, unit: line.unit, remark: line.remark })) },
    { supplierName: detail.supplier_name, outletName: catalog?.outlet_name, itemById, businessPoNo: () => displayPoNo(detail),
      formatDate: (value) => new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value)), today: new Date() });
    try { await navigator.clipboard.writeText(text); setNotice(t("inventory.copied")); }
    catch { setCopyFallback(text); }
  }

  if (mode === "list") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.purchaseOrders")} onBack={onBack} />
    <div className="crew-ui-tabs crew-inventory-tabs" role="tablist">{["active", "drafts", "completed"].map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{t(`inventory.${value}`)}</button>)}</div>
    {notice && <p className="crew-inventory-notice" role="status">{notice}</p>}{error && <p className="crew-v2-error" role="alert">{error}</p>}
    {!grants?.can_manage_purchase_orders && !grants?.can_receive_purchase_orders ? <CrewEmptyState title={t("inventory.noAccess")} /> : loading ? <p className="crew-inventory-state" role="status">{t("common.loading")}</p> : !data ? <button className="crew-mobile-secondary" type="button" onClick={() => void load()}>{t("common.retry")}</button> : <>
      {canManage && tab !== "completed" && <button className="crew-mobile-primary crew-inventory-add" type="button" onClick={() => setMode("create")}><Plus size={18} />{t("inventory.createPo")}</button>}
      <div className="crew-inventory-list crew-inventory-po-list">{filteredOrders.map((order) => <button key={order.id} type="button" onClick={() => void openOrder(order.id)}><span><span className="crew-inventory-po-primary"><strong>{order.supplier_name || t("inventory.supplier")}</strong><CrewStatusBadge tone={["fully_received", "completed"].includes(order.status) ? "success" : order.status === "draft" ? "neutral" : "warning"}>{t(`inventory.status.${order.status}`)}</CrewStatusBadge></span><small>{categorySummary(order.category_names, t)} · {t("inventory.homeItemCount", { count: order.line_count })}</small><small>{displayPoNo(order)} · {formatDate(relevantDate(order))}</small>{Number(order.received_qty) > 0 && <small>{t("inventory.receivingProgress", { received: order.received_qty, ordered: order.requested_qty })}</small>}</span><ChevronRight size={18} /></button>)}</div>
      {!filteredOrders.length && <CrewEmptyState title={t("inventory.noOrders")} />}
    </>}{copyFallback && <CrewBottomSheet title={t("inventory.copyText")} onClose={() => setCopyFallback("")}><textarea className="crew-inventory-copy-fallback" readOnly value={copyFallback} onFocus={(event) => event.target.select()} /></CrewBottomSheet>}
  </section>;

  if (mode === "create") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.createPo")} onBack={goBack} /><div className="crew-inventory-hub-list crew-inventory-po-choices"><button type="button" onClick={() => setMode("sources")}><span><strong>{t("inventory.fromStockCheck")}</strong><small>{t("inventory.fromStockCheckHelp")}</small></span><ChevronRight size={18} /></button><button type="button" onClick={startManual}><span><strong>{t("inventory.manualPo")}</strong><small>{t("inventory.manualPoHelp")}</small></span><ChevronRight size={18} /></button></div></section>;

  if (mode === "sources") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.fromStockCheck")} onBack={() => setMode("create")} />{missingSourceId && <p className="crew-inventory-context">{t("inventory.sourceNoLongerEligible")}</p>}<div className="crew-inventory-list">{(data?.suggestions || []).map((check) => <button type="button" key={check.stock_check_id} onClick={() => startFromCheck(check)}><span><strong>{check.check_name}</strong><small>{check.check_date} · {t("inventory.shortageCount", { count: check.shortages?.length || 0 })}</small></span><ChevronRight size={18} /></button>)}</div>{!(data?.suggestions || []).length && <CrewEmptyState title={t("inventory.noSuggestions")} />}</section>;

  if (mode === "suggestions") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.restockItems")} subtitle={source?.check_name} onBack={goBack} />
    <p className="crew-inventory-context">{t("inventory.suggestionsHelp")}</p>
    {Object.entries(sourceGroups).map(([id, group]) => <section className="crew-inventory-supplier-group" key={id}>
      <h2>{id === "unassigned" ? t("inventory.supplierUnavailable") : group[0].suppliers.find((supplier) => supplier.id === id)?.name || t("inventory.supplier")}</h2>
      {group.map((item) => <article className="crew-inventory-suggestion" key={item.stock_check_item_id}>
        <div className="crew-inventory-suggestion-name"><CrewInventoryItemThumb item={{ name: item.item_name, photo_url: item.photo_url || itemById.get(item.item_id)?.photo_url }} inspectable /><label><input type="checkbox" checked={item.included} disabled={!item.suppliers.length} onChange={(event) => updateSourceItem(item.stock_check_item_id, { included: event.target.checked })} /><span><strong>{item.item_name}</strong><small>{item.sku_code}</small></span></label></div>
        <div className="crew-inventory-suggestion-metrics"><span>{t("inventory.currentQuantity")} <strong>{item.current_qty} {item.unit}</strong></span><span>{t("inventory.parQuantity")} <strong>{item.par_qty} {item.unit}</strong></span><span>{t("inventory.suggestedQuantity")} <strong>{item.shortage_qty} {item.unit}</strong></span></div>
        {item.suppliers.length > 1 && <CrewChoicePicker label={t("inventory.supplier")} value={item.supplier_id} options={item.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} onChange={(value) => updateSourceItem(item.stock_check_item_id, { supplier_id: value })} />}
        {item.included && <CrewQuantityStepper value={item.requested_qty} onChange={(value) => updateSourceItem(item.stock_check_item_id, { requested_qty: value })} label={t("inventory.orderQuantity")} unit={item.unit} />}
        {!item.suppliers.length && <small>{t("inventory.noEligibleSupplier")}</small>}
      </article>)}
    </section>)}
    {error && <p className="crew-v2-error" role="alert">{error}</p>}
    <div className="crew-inventory-sticky"><button className="crew-mobile-primary" type="button" disabled={busy || !selectedSourceItems.length || selectedSourceItems.some((item) => !Number.isFinite(Number(item.requested_qty)) || Number(item.requested_qty) <= 0)} onClick={() => void saveSourceDrafts()}>{busy ? t("common.saving") : t("inventory.createDraftOrders", { count: new Set(selectedSourceItems.map((item) => item.supplier_id)).size })}</button></div>
    {discardOpen && <CrewMobileModal title={t("inventory.discardChanges")} onClose={() => setDiscardOpen(false)} footer={<><button className="crew-mobile-secondary" type="button" onClick={() => setDiscardOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" onClick={discardChanges}>{t("inventory.discardChanges")}</button></>}><p>{t("inventory.discardChangesBody")}</p></CrewMobileModal>}
  </section>;

  if (mode === "editor") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={detail ? t("inventory.editDraft") : t("inventory.createPo")} onBack={goBack} />
    <div className="crew-inventory-form"><CrewChoicePicker label={t("inventory.supplier")} value={supplierId} options={sourceSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} onChange={selectSupplier} disabled={Boolean(detail?.source_stock_check_id)} />
      {supplierId && !detail?.source_stock_check_id && <button className="crew-mobile-secondary" type="button" onClick={() => setItemPicker(true)}><Plus size={16} />{t("inventory.addItem")}</button>}
      {lines.map((line) => <article className="crew-inventory-count-row" key={line.item_id}><div className="crew-inventory-row-head"><span><strong>{itemById.get(line.item_id)?.name || t("inventory.item")}</strong><small>{itemById.get(line.item_id)?.sku || ""}</small></span>{!detail?.source_stock_check_id && <button type="button" aria-label={t("inventory.removeItem")} onClick={() => { setLines((current) => current.filter((row) => row.item_id !== line.item_id)); setDirty(true); }}><Trash2 size={18} /></button>}</div><CrewQuantityStepper value={line.requested_qty} onChange={(value) => updateLine(line.item_id, { requested_qty: value })} label={t("inventory.requestedQuantity")} unit={line.unit} /><label>{t("inventory.remarks")}<input value={line.remark} onChange={(event) => updateLine(line.item_id, { remark: event.target.value })} /></label></article>)}
      {supplierId && !lines.length && <CrewEmptyState title={t("inventory.noItems")} />}
    </div>{error && <p className="crew-v2-error" role="alert">{error}</p>}
    <div className="crew-inventory-sticky"><button className="crew-mobile-primary" type="button" disabled={busy || !supplierId || !validLines} onClick={() => void saveDraft()}>{busy ? t("common.saving") : t("inventory.saveDraft")}</button></div>
    {discardOpen && <CrewMobileModal title={t("inventory.discardChanges")} onClose={() => setDiscardOpen(false)} footer={<><button className="crew-mobile-secondary" type="button" onClick={() => setDiscardOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" onClick={discardChanges}>{t("inventory.discardChanges")}</button></>}><p>{t("inventory.discardChangesBody")}</p></CrewMobileModal>}
    {itemPicker && <CrewBottomSheet title={t("inventory.addItem")} onClose={() => setItemPicker(false)}><CrewSearchBar value={query} onChange={setQuery} placeholder={t("inventory.searchItems")} /><div className="crew-inventory-picker-list">{(catalog?.items || []).filter((item) => !lines.some((line) => line.item_id === item.id) && `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())).map((item) => <button type="button" key={item.id} onClick={() => { setLines((current) => [...current, { item_id: item.id, requested_qty: "1", unit: item.unit, remark: "", source_stock_check_item_id: null }]); setDirty(true); setItemPicker(false); setQuery(""); }}><strong>{item.name}</strong><small>{item.sku} · {item.unit}</small></button>)}</div></CrewBottomSheet>}
  </section>;

  if (!detail) return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.purchaseOrder")} onBack={goBack} /><CrewEmptyState title={t("inventory.noOrders")} /></section>;
  if (mode === "receive") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.receivePo")} subtitle={displayPoNo(detail)} onBack={() => setMode("detail")} />
    <div className="crew-inventory-receive-heading"><p className="crew-inventory-context">{t("inventory.receiveHelp")}</p><button className="crew-mobile-secondary" type="button" onClick={receiveAllRemaining} disabled={busy || !detail.lines.some((line) => Number(line.remaining_qty) > 0)}>{t("inventory.receiveAllRemaining")}</button></div><div className="crew-inventory-form">{detail.lines.map((line) => <article className="crew-inventory-count-row" key={line.id}><div className="crew-inventory-row-head"><CrewInventoryItemThumb item={itemFor(line)} inspectable /><span><strong>{line.item_name}</strong><small>{line.sku_code}</small></span></div><div className="crew-inventory-po-quantities"><span>{t("inventory.ordered")} <strong>{line.requested_qty} {line.unit}</strong></span><span>{t("inventory.received")} <strong>{line.received_qty} {line.unit}</strong></span><span>{t("inventory.remaining")} <strong>{line.remaining_qty} {line.unit}</strong></span></div>{Number(line.remaining_qty) > 0 ? <CrewQuantityStepper value={receiveQty[line.id] || ""} onChange={(value) => setReceiveQty((current) => ({ ...current, [line.id]: value }))} label={t("inventory.receivedNow")} unit={line.unit} /> : <small>{t("inventory.lineComplete")}</small>}</article>)}<label>{t("inventory.receiptRemark")}<textarea value={remark} onChange={(event) => setRemark(event.target.value)} /></label></div>
    {invalidReceipt && <p className="crew-v2-error" role="alert">{t("inventory.exceedsRemaining")}</p>}{error && <p className="crew-v2-error" role="alert">{error}</p>}
    <div className="crew-inventory-sticky"><button className="crew-mobile-primary" type="button" disabled={busy || !receiptLines.length || invalidReceipt} onClick={() => void receive()}>{busy ? t("common.saving") : t("inventory.recordReceipt")}</button></div>
  </section>;
  return <section className="crew-inventory-page"><CrewMobileDetailHeader title={detail.supplier_name || t("inventory.purchaseOrder")} subtitle={displayPoNo(detail)} onBack={goBack} action={<CrewStatusBadge tone={["fully_received", "completed"].includes(detail.status) ? "success" : "warning"}>{t(`inventory.status.${detail.status}`)}</CrewStatusBadge>} />
    {notice && <p className="crew-inventory-notice" role="status">{notice}</p>}{error && <p className="crew-v2-error" role="alert">{error}</p>}
    <p className="crew-inventory-context">{categorySummary(detail.category_names, t)} · {formatDate(relevantDate(detail))}</p>
    <div className="crew-inventory-detail-actions">{detail.status !== "draft" && <button className="crew-mobile-secondary" type="button" onClick={() => void copyText()}><Copy size={16} />{t("inventory.copyText")}</button>}{canManage && detail.status === "draft" && <button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => void transition("submit")}>{t("inventory.submitPo")}</button>}{canManage && detail.status === "submitted" && <button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setReopenOpen(true)}>{t("inventory.editOrder")}</button>}</div>
    <div className="crew-inventory-detail-lines">{detail.lines.map((line) => <article key={line.id}><CrewInventoryItemThumb item={itemFor(line)} inspectable /><span><strong>{line.item_name}</strong><small>{line.sku_code}{line.remark ? ` · ${line.remark}` : ""}</small><small>{t("inventory.ordered")}: {line.requested_qty} {line.unit} · {t("inventory.received")}: {line.received_qty} {line.unit} · {t("inventory.remaining")}: {line.remaining_qty} {line.unit}</small></span></article>)}</div>
    {detail.receipts?.length > 0 && <section className="crew-inventory-history"><h2>{t("inventory.receiptHistory")}</h2>{detail.receipts.map((receipt) => <article key={receipt.id}><strong>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(receipt.received_at))}</strong><small>{receipt.lines.map((line) => `${itemById.get(line.item_id)?.name || t("inventory.item")}: ${line.received_qty} ${line.unit}`).join(" · ")}</small>{receipt.remark && <p>{receipt.remark}</p>}</article>)}</section>}
    <div className="crew-inventory-sticky">{canManage && detail.status === "draft" && <button className="crew-mobile-primary" type="button" disabled={busy} onClick={editDraft}>{t("inventory.continueDraft")}</button>}{canManage && detail.status === "submitted" && <button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void transition("confirm")}>{t("inventory.markConfirmed")}</button>}{canReceive && ["supplier_confirmed", "partial_received"].includes(detail.status) && <button className="crew-mobile-primary" type="button" disabled={busy} onClick={startReceiving}>{detail.status === "partial_received" ? t("inventory.continueReceiving") : t("inventory.receivePo")}</button>}</div>
    {copyFallback && <CrewBottomSheet title={t("inventory.copyText")} onClose={() => setCopyFallback("")}><textarea className="crew-inventory-copy-fallback" readOnly value={copyFallback} onFocus={(event) => event.target.select()} /></CrewBottomSheet>}
    {reopenOpen && <CrewBottomSheet title={t("inventory.editSubmittedTitle")} description={t("inventory.editSubmittedBody")} onClose={() => setReopenOpen(false)} closeDisabled={busy} footer={<><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setReopenOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void transition("reopen_draft")}>{busy ? t("common.saving") : t("inventory.editOrder")}</button></>} />}
  </section>;
}
