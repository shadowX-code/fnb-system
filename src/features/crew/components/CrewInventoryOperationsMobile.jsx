import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronRight, ClipboardCheck, Package } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState } from "./CrewMobileUI.jsx";

export const hasCrewInventoryAccess = (grants = {}) => Boolean(
  grants.can_perform_stock_check || grants.can_create_audit_stock_check
  || grants.can_manage_purchase_orders || grants.can_receive_purchase_orders
);

const hasStock = (grants) => Boolean(grants?.can_perform_stock_check || grants?.can_create_audit_stock_check);
const hasOrders = (grants) => Boolean(grants?.can_manage_purchase_orders || grants?.can_receive_purchase_orders);
const recent = (a, b) => String(b.updated_at || b.check_date || b.created_at || "").localeCompare(String(a.updated_at || a.check_date || a.created_at || ""));

export function stockHomeRows(data) {
  const due = data?.can_perform_stock_check ? (data?.due || [])
    .filter((check) => check.status === "due" || check.status === "in_progress")
    .map((check) => ({ ...check, homePriority: check.status === "due" ? 0 : 1 })) : [];
  const audits = data?.can_create_audit_stock_check ? (data?.checks || [])
    .filter((check) => check.type === "audit" && check.status === "draft")
    .map((check) => ({ ...check, homePriority: 2 })) : [];
  return [...due, ...audits]
    .sort((a, b) => a.homePriority - b.homePriority || recent(a, b) || String(a.id || a.group_id).localeCompare(String(b.id || b.group_id)));
}

export function orderHomeRows(data) {
  const canManage = Boolean(data?.can_manage_purchase_orders);
  const canReceive = Boolean(data?.can_receive_purchase_orders);
  const priority = { partial_received: 0, supplier_confirmed: 1, submitted: 2, draft: 3 };
  return (data?.orders || []).filter((order) =>
    ((order.status === "draft" || order.status === "submitted") && canManage)
    || ((order.status === "supplier_confirmed" || order.status === "partial_received") && canReceive))
    .sort((a, b) => priority[a.status] - priority[b.status] || recent(a, b));
}

export function orderCategorySummary(order, t) {
  const names = (order.category_names || []).filter(Boolean);
  if (!names.length) return t("inventory.homeItemCount", { count: order.line_count || 0 });
  return names.length === 1 ? names[0] : t("inventory.homeMoreCategories", { name: names[0], count: names.length - 1 });
}

function useAttention(token, outletId, grants) {
  const [state, setState] = useState({ outletId: null, loading: true, checks: null, orders: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!hasCrewInventoryAccess(grants) || !outletId) {
      setState({ outletId, loading: false, checks: null, orders: null, error: "" });
      return undefined;
    }
    let active = true;
    setState({ outletId, loading: true, checks: null, orders: null, error: "" });
    Promise.all([
      hasStock(grants) ? crewService.inventoryStockChecks(token, outletId) : Promise.resolve(null),
      hasOrders(grants) ? crewService.inventoryPurchaseOrders(token, outletId) : Promise.resolve(null),
    ]).then(([checks, orders]) => {
      if (active) setState({ outletId, loading: false, checks, orders, error: "" });
    }).catch((cause) => {
      if (active) setState({ outletId, loading: false, checks: null, orders: null, error: cause.message });
    });
    return () => { active = false; };
  }, [token, outletId, grants, revision]);
  return { ...(state.outletId === outletId ? state : { loading: true, checks: null, orders: null, error: "" }), retry: () => setRevision((value) => value + 1) };
}

function SmartOperationsCard({ domain, icon: Icon, title, summary, rows, onOpen, onAction }) {
  return <section className={`crew-inventory-home-module is-${domain}${rows.length ? "" : " is-clear"}`}>
    <button type="button" className="crew-inventory-home-heading" onClick={onOpen} aria-label={title}>
      <span className="crew-inventory-home-icon"><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="crew-inventory-home-heading-copy"><strong>{title}</strong><small>{summary}</small></span>
      <Icon className="crew-inventory-home-motif" size={88} strokeWidth={1.3} aria-hidden="true" />
      <ChevronRight className="crew-inventory-home-chevron" size={20} aria-hidden="true" />
    </button>
    {rows.length > 0 && <div className="crew-inventory-home-rows">{rows.map((row) =>
      <div className="crew-inventory-home-row" key={row.key}>
        <span className="crew-inventory-home-row-copy"><strong>{row.title}</strong><small>{row.detail}</small></span>
        <button type="button" className="crew-inventory-home-row-action" onClick={() => onAction(row.source)} aria-label={`${row.action}: ${row.title}`}>
          {row.action}<ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>)}</div>}
  </section>;
}

export function CrewInventoryHomeAttention({ token, outletId, grants, onOpenStock, onOpenOrders, onOpenCheck, onOpenOrder }) {
  const { t } = useTranslation();
  const { checks, orders, loading, error, retry } = useAttention(token, outletId, grants);
  if (!hasCrewInventoryAccess(grants)) return null;
  const stock = stockHomeRows(checks);
  const purchase = orderHomeRows(orders);
  const dueCount = stock.filter((check) => check.status === "due").length;
  const inProgressCount = stock.filter((check) => check.status === "in_progress").length;
  const stockSummary = dueCount ? t("inventory.stockDueCount", { count: dueCount })
      : inProgressCount ? t("inventory.stockInProgressCount", { count: inProgressCount })
      : stock.length ? t("inventory.draftsCount", { count: stock.length }) : t("inventory.stockAllClear");
  const stockRows = stock.map((check) => ({
    key: check.id || check.check_id || check.group_id,
    source: check,
    title: check.name || t("inventory.stockCheck"),
    detail: [check.status === "due" ? t("inventory.homeDueToday") : check.status === "in_progress" ? t("inventory.in_progress") : check.audit_type,
      check.shift,
      t("inventory.homeItemCount", { count: check.items?.length ?? check.item_count ?? 0 })].filter(Boolean).join(" · "),
    action: check.status === "due" ? t("inventory.start") : t("inventory.resume"),
  }));
  const purchaseRows = purchase.map((order) => ({
    key: order.id,
    source: order,
    title: order.supplier_name || t("inventory.supplier"),
    detail: [orderCategorySummary(order, t),
      t(`inventory.homePoState.${order.status}`)].join(" · "),
    action: order.status === "draft" ? t("inventory.homeContinue")
      : order.status === "partial_received" || order.status === "supplier_confirmed" ? t("inventory.homeReceive") : t("inventory.review"),
  }));
  return <section className="crew-v2-home-section crew-inventory-home" aria-label={t("inventory.operations")}>
    {loading ? <p className="crew-inventory-subtle" role="status">{t("common.loading")}</p> : error ? <div className="crew-v2-error" role="alert">{t("inventory.loadError")} <button type="button" onClick={retry}>{t("common.retry")}</button></div> : <div className="crew-inventory-home-modules">
      {hasStock(grants) && <SmartOperationsCard domain="stock" icon={ClipboardCheck} title={t("inventory.stockCheck")} summary={stockSummary} rows={stockRows} onOpen={onOpenStock} onAction={onOpenCheck} />}
      {hasOrders(grants) && <SmartOperationsCard domain="orders" icon={Package} title={t("inventory.purchaseOrders")} summary={purchase.length ? t("inventory.homeOrdersAttentionCount", { count: purchase.length }) : t("inventory.ordersAllClear")} rows={purchaseRows} onOpen={onOpenOrders} onAction={onOpenOrder} />}
    </div>}
  </section>;
}

// Existing bookmarks remain valid; Home is now the normal operational entry point.
export default function CrewInventoryOperationsMobile({ token, outletId, grants, onBack, onOpenStock, onOpenOrders }) {
  const { t } = useTranslation();
  return <section className="crew-inventory-page"><CrewMobileDetailHeader title={t("inventory.operations")} onBack={onBack} />
    {!hasCrewInventoryAccess(grants) ? <CrewEmptyState title={t("inventory.noAccess")} body={t("inventory.noAccessBody")} /> :
      <CrewInventoryHomeAttention token={token} outletId={outletId} grants={grants} onOpenStock={onOpenStock} onOpenOrders={onOpenOrders} onOpenCheck={onOpenStock} onOpenOrder={onOpenOrders} />}
  </section>;
}
