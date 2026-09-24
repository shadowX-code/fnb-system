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
import { CrewEmptyState, CrewSearchBar, CrewStatusBadge } from "./CrewMobileUI.jsx";

const newId = () => crypto.randomUUID();
const isActive = (status) => ["submitted", "supplier_confirmed", "partial_received"].includes(status);
const editableLine = (line) => ({ item_id: line.item_id, requested_qty: String(line.requested_qty ?? ""), unit: line.unit || "", remark: line.remark || "", source_stock_check_item_id: line.source_stock_check_item_id || null });

export default function CrewPurchaseOrdersMobile({ token, outletId, grants, onBack, onFlowChange }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null); const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("active"); const [detail, setDetail] = useState(null); const [mode, setMode] = useState("list");
  const [source, setSource] = useState(null); const [supplierId, setSupplierId] = useState(""); const [lines, setLines] = useState([]); const [remark, setRemark] = useState("");
  const [query, setQuery] = useState(""); const [itemPicker, setItemPicker] = useState(false); const [receiveQty, setReceiveQty] = useState({}); const [copyFallback, setCopyFallback] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [dirty, setDirty] = useState(false); const request = useRef(null); const active = useRef(true);
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
      if (active.current) { setData(orders); setCatalog(choices); }
    } catch (cause) { if (active.current) setError(cause.message || t("inventory.loadError")); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [token, outletId]);
  const itemById = useMemo(() => new Map([
    ...(catalog?.items || []).map((item) => [item.id, item]),
    ...(detail?.lines || []).map((line) => [line.item_id, { id: line.item_id, name: line.item_name, unit: line.unit, sku: line.sku_code }]),
  ]), [catalog, detail]);
  const canManage = Boolean(data?.can_manage_purchase_orders);
  const canReceive = Boolean(data?.can_receive_purchase_orders);
  const filteredOrders = (data?.orders || []).filter((order) => tab === "drafts" ? order.status === "draft" : tab === "completed" ? ["fully_received", "completed", "cancelled"].includes(order.status) : isActive(order.status));

  async function openOrder(id) {
    setBusy(true); setError("");
    try {
      const next = await crewService.inventoryPurchaseOrders(token, outletId, id);
      if (active.current) { setDetail(next.detail); setMode("detail"); setDirty(false); request.current = null; }
    } catch (cause) { if (active.current) setError(cause.message); }
    finally { if (active.current) setBusy(false); }
  }
  function startManual() { setSource(null); setSupplierId(""); setLines([]); setRemark(""); setDetail(null); setMode("editor"); setDirty(false); request.current = null; }
  function startFromCheck(check) { setSource(check); setSupplierId(""); setLines([]); setRemark(""); setDetail(null); setMode("editor"); setDirty(false); request.current = null; }
  function editDraft() { setSource(null); setSupplierId(detail.supplier_id); setLines((detail.lines || []).map(editableLine)); setRemark(detail.remark || ""); setMode("editor"); setDirty(false); request.current = null; }
  function selectSupplier(id) {
    setSupplierId(id); setDirty(true);
    if (source) setLines((source.shortages || []).filter((shortage) => (shortage.suppliers || []).some((supplier) => supplier.id === id)).map((shortage) => ({ item_id: shortage.item_id, requested_qty: String(shortage.shortage_qty), unit: shortage.unit, remark: "", source_stock_check_item_id: shortage.stock_check_item_id })));
    else setLines([]);
  }
  function updateLine(id, patch) { setLines((current) => current.map((line) => line.item_id === id ? { ...line, ...patch } : line)); setDirty(true); }
  function goBack() {
    if (busy) return;
    if (dirty) { setDiscardOpen(true); return; }
    leaveEditor();
  }
  function leaveEditor() {
    if (mode === "editor" && detail) setMode("detail");
    else { setMode("list"); setDetail(null); void load(); }
    setError("");
  }
  function discardChanges() { setDiscardOpen(false); setDirty(false); setLines([]); request.current = null; leaveEditor(); }
  const validLines = lines.length > 0 && lines.every((line) => Number(line.requested_qty) > 0 && line.unit);
  const sourceSuppliers = source ? (catalog?.suppliers || []).filter((supplier) => (source.shortages || []).some((shortage) => (shortage.suppliers || []).some((candidate) => candidate.id === supplier.id))) : detail?.source_stock_check_id ? (catalog?.suppliers || []).filter((supplier) => supplier.id === supplierId) : catalog?.suppliers || [];
  const requestFor = (payload) => { const signature = JSON.stringify(payload); if (request.current?.signature !== signature) request.current = { signature, id: newId() }; return request.current.id; };
  async function saveDraft() {
    if (busy || !supplierId || !validLines) return;
    const payload = { order: { id: detail?.id, outlet_id: outletId, supplier_id: supplierId, source_type: source || detail?.source_stock_check_id ? "stock_check" : "manual", source_stock_check_id: source?.stock_check_id || detail?.source_stock_check_id || null, status: "draft" }, items: lines.map((line) => ({ ...line, requested_qty: Number(line.requested_qty) })) };
    setBusy(true); setError("");
    try {
      const result = source && !detail ? await crewService.createInventoryStockCheckOrders(token, outletId, requestFor(payload), source.stock_check_id, [{ ...payload.order, lines: payload.items }]) : await crewService.saveInventoryPurchaseOrder(token, outletId, requestFor(payload), payload.order, payload.items);
      if (!active.current) return;
      const id = source && !detail ? result?.[0]?.order?.id : result?.order?.id;
      request.current = null; setDirty(false); setNotice(t("inventory.draftSaved")); await load();
      if (id) await openOrder(id); else setMode("list");
    } catch (cause) { if (active.current) setError(cause.message || t("inventory.saveError")); }
    finally { if (active.current) setBusy(false); }
  }
  async function transition(action) {
    if (busy || !detail) return;
    setBusy(true); setError("");
    try { await crewService.transitionInventoryPurchaseOrder(token, outletId, detail.id, requestFor({ id: detail.id, action }), action);
      if (!active.current) return;
      request.current = null; setNotice(t(action === "submit" ? "inventory.poSubmitted" : "inventory.poConfirmed")); await load(); await openOrder(detail.id);
    } catch (cause) { if (active.current) setError(cause.message); }
    finally { if (active.current) setBusy(false); }
  }
  function startReceiving() { setReceiveQty(Object.fromEntries((detail.lines || []).map((line) => [line.id, ""]))); setRemark(""); setMode("receive"); request.current = null; }
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
    { supplierName: detail.supplier_name, outletName: catalog?.outlet_name, itemById, businessPoNo: () => detail.po_no,
      formatDate: (value) => new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value)), today: new Date() });
    try { await navigator.clipboard.writeText(text); setNotice(t("inventory.copied")); }
    catch { setCopyFallback(text); }
  }

  if (mode === "list") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.purchaseOrders")} onBack={onBack} />
    <div className="crew-ui-tabs crew-inventory-tabs" role="tablist">{["active", "drafts", "completed"].map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{t(`inventory.${value}`)}</button>)}</div>
    {notice && <p className="crew-inventory-notice" role="status">{notice}</p>}{error && <p className="crew-v2-error" role="alert">{error}</p>}
    {!grants?.can_manage_purchase_orders && !grants?.can_receive_purchase_orders ? <CrewEmptyState title={t("inventory.noAccess")} /> : loading ? <p className="crew-inventory-state" role="status">{t("common.loading")}</p> : !data ? <button className="crew-mobile-secondary" type="button" onClick={() => void load()}>{t("common.retry")}</button> : <>
      {canManage && <button className="crew-mobile-primary crew-inventory-add" type="button" onClick={() => setMode("create")}><Plus size={18} />{t("inventory.createPo")}</button>}
      <div className="crew-inventory-list">{filteredOrders.map((order) => <button key={order.id} type="button" onClick={() => void openOrder(order.id)}><span><strong>{order.po_no || t("inventory.purchaseOrder")}</strong><small>{order.supplier_name} · {order.line_count} {t("inventory.items")}</small></span><CrewStatusBadge tone={["fully_received", "completed"].includes(order.status) ? "success" : order.status === "draft" ? "neutral" : "warning"}>{t(`inventory.status.${order.status}`)}</CrewStatusBadge><ChevronRight size={18} /></button>)}</div>
      {!filteredOrders.length && <CrewEmptyState title={t("inventory.noOrders")} />}
    </>}{copyFallback && <CrewBottomSheet title={t("inventory.copyText")} onClose={() => setCopyFallback("")}><textarea className="crew-inventory-copy-fallback" readOnly value={copyFallback} onFocus={(event) => event.target.select()} /></CrewBottomSheet>}
  </section>;

  if (mode === "create") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.createPo")} onBack={goBack} /><div className="crew-inventory-hub-list"><button type="button" onClick={() => setMode("sources")}><strong>{t("inventory.fromStockCheck")}</strong><small>{t("inventory.fromStockCheckHelp")}</small><ChevronRight size={18} /></button><button type="button" onClick={startManual}><strong>{t("inventory.manualPo")}</strong><small>{t("inventory.manualPoHelp")}</small><ChevronRight size={18} /></button></div></section>;

  if (mode === "sources") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.fromStockCheck")} onBack={() => setMode("create")} /><div className="crew-inventory-list">{(data?.suggestions || []).map((check) => <button type="button" key={check.stock_check_id} onClick={() => startFromCheck(check)}><span><strong>{check.check_name}</strong><small>{check.check_date} · {check.shortages?.length || 0} {t("inventory.shortages")}</small></span><ChevronRight size={18} /></button>)}</div>{!(data?.suggestions || []).length && <CrewEmptyState title={t("inventory.noSuggestions")} />}</section>;

  if (mode === "editor") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={detail ? t("inventory.editDraft") : t("inventory.createPo")} onBack={goBack} />
    {source && <p className="crew-inventory-context">{t("inventory.fromStockCheck")}: {source.check_name}</p>}
    <div className="crew-inventory-form"><CrewChoicePicker label={t("inventory.supplier")} value={supplierId} options={sourceSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} onChange={selectSupplier} disabled={Boolean(detail?.source_stock_check_id)} />
      {supplierId && !source && <button className="crew-mobile-secondary" type="button" onClick={() => setItemPicker(true)}><Plus size={16} />{t("inventory.addItem")}</button>}
      {lines.map((line) => <article className="crew-inventory-count-row" key={line.item_id}><div className="crew-inventory-row-head"><span><strong>{itemById.get(line.item_id)?.name || t("inventory.item")}</strong><small>{itemById.get(line.item_id)?.sku || ""}</small></span>{!source && <button type="button" aria-label={t("inventory.removeItem")} onClick={() => { setLines((current) => current.filter((row) => row.item_id !== line.item_id)); setDirty(true); }}><Trash2 size={18} /></button>}</div><CrewQuantityStepper value={line.requested_qty} onChange={(value) => updateLine(line.item_id, { requested_qty: value })} label={t("inventory.requestedQuantity")} unit={line.unit} /><label>{t("inventory.remarks")}<input value={line.remark} onChange={(event) => updateLine(line.item_id, { remark: event.target.value })} /></label></article>)}
      {supplierId && !lines.length && <CrewEmptyState title={t("inventory.noItems")} />}
    </div>{error && <p className="crew-v2-error" role="alert">{error}</p>}
    <div className="crew-inventory-sticky"><button className="crew-mobile-primary" type="button" disabled={busy || !supplierId || !validLines} onClick={() => void saveDraft()}>{busy ? t("common.saving") : t("inventory.saveDraft")}</button></div>
    {discardOpen && <CrewMobileModal title={t("inventory.discardChanges")} onClose={() => setDiscardOpen(false)} footer={<><button className="crew-mobile-secondary" type="button" onClick={() => setDiscardOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" onClick={discardChanges}>{t("inventory.discardChanges")}</button></>}><p>{t("inventory.discardChangesBody")}</p></CrewMobileModal>}
    {itemPicker && <CrewBottomSheet title={t("inventory.addItem")} onClose={() => setItemPicker(false)}><CrewSearchBar value={query} onChange={setQuery} placeholder={t("inventory.searchItems")} /><div className="crew-inventory-picker-list">{(catalog?.items || []).filter((item) => !lines.some((line) => line.item_id === item.id) && `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())).map((item) => <button type="button" key={item.id} onClick={() => { setLines((current) => [...current, { item_id: item.id, requested_qty: "1", unit: item.unit, remark: "", source_stock_check_item_id: null }]); setDirty(true); setItemPicker(false); setQuery(""); }}><strong>{item.name}</strong><small>{item.sku} · {item.unit}</small></button>)}</div></CrewBottomSheet>}
  </section>;

  if (!detail) return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.purchaseOrder")} onBack={goBack} /><CrewEmptyState title={t("inventory.noOrders")} /></section>;
  if (mode === "receive") return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.receivePo")} subtitle={detail.po_no} onBack={() => setMode("detail")} />
    <p className="crew-inventory-context">{t("inventory.receiveHelp")}</p><div className="crew-inventory-form">{detail.lines.filter((line) => Number(line.remaining_qty) > 0).map((line) => <article className="crew-inventory-count-row" key={line.id}><strong>{line.item_name}</strong><small>{t("inventory.remaining")}: {line.remaining_qty} {line.unit}</small><CrewQuantityStepper value={receiveQty[line.id] || ""} onChange={(value) => setReceiveQty((current) => ({ ...current, [line.id]: value }))} label={t("inventory.receivedQuantity")} unit={line.unit} /></article>)}<label>{t("inventory.receiptRemark")}<textarea value={remark} onChange={(event) => setRemark(event.target.value)} /></label></div>
    {invalidReceipt && <p className="crew-v2-error" role="alert">{t("inventory.exceedsRemaining")}</p>}{error && <p className="crew-v2-error" role="alert">{error}</p>}
    <div className="crew-inventory-sticky"><button className="crew-mobile-primary" type="button" disabled={busy || !receiptLines.length || invalidReceipt} onClick={() => void receive()}>{busy ? t("common.saving") : t("inventory.recordReceipt")}</button></div>
  </section>;
  return <section className="crew-inventory-page"><CrewMobileDetailHeader title={detail.po_no || t("inventory.purchaseOrder")} subtitle={detail.supplier_name} onBack={goBack} action={<CrewStatusBadge tone={detail.status === "completed" ? "success" : "warning"}>{t(`inventory.status.${detail.status}`)}</CrewStatusBadge>} />
    {notice && <p className="crew-inventory-notice" role="status">{notice}</p>}{error && <p className="crew-v2-error" role="alert">{error}</p>}
    <div className="crew-inventory-detail-actions"><button className="crew-mobile-secondary" type="button" onClick={() => void copyText()}><Copy size={16} />{t("inventory.copyText")}</button>{canManage && detail.status === "draft" && <button className="crew-mobile-secondary" type="button" onClick={editDraft}>{t("inventory.editDraft")}</button>}</div>
    <div className="crew-inventory-detail-lines">{detail.lines.map((line) => <article key={line.id}><span><strong>{line.item_name}</strong><small>{line.remark}</small></span><strong>{line.requested_qty} {line.unit}</strong><small>{t("inventory.received")}: {line.received_qty} · {t("inventory.remaining")}: {line.remaining_qty}</small></article>)}</div>
    {detail.receipts?.length > 0 && <section className="crew-inventory-history"><h2>{t("inventory.receiptHistory")}</h2>{detail.receipts.map((receipt) => <article key={receipt.id}><strong>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(receipt.received_at))}</strong><small>{receipt.lines.map((line) => `${itemById.get(line.item_id)?.name || t("inventory.item")}: ${line.received_qty} ${line.unit}`).join(" · ")}</small>{receipt.remark && <p>{receipt.remark}</p>}</article>)}</section>}
    <div className="crew-inventory-sticky">{canManage && detail.status === "draft" && <button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void transition("submit")}>{t("inventory.submitPo")}</button>}{canManage && detail.status === "submitted" && <button className="crew-mobile-primary" type="button" disabled={busy} onClick={() => void transition("confirm")}>{t("inventory.markConfirmed")}</button>}{canReceive && ["supplier_confirmed", "partial_received"].includes(detail.status) && <button className="crew-mobile-primary" type="button" disabled={busy} onClick={startReceiving}>{detail.status === "partial_received" ? t("inventory.continueReceiving") : t("inventory.receivePo")}</button>}</div>
    {copyFallback && <CrewBottomSheet title={t("inventory.copyText")} onClose={() => setCopyFallback("")}><textarea className="crew-inventory-copy-fallback" readOnly value={copyFallback} onFocus={(event) => event.target.select()} /></CrewBottomSheet>}
  </section>;
}
