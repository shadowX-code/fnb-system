import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, PackageCheck, ChevronRight } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState } from "./CrewMobileUI.jsx";

export const hasCrewInventoryAccess = (grants = {}) => Boolean(
  grants.can_perform_stock_check || grants.can_create_audit_stock_check
  || grants.can_manage_purchase_orders || grants.can_receive_purchase_orders
);

const hasStock = (grants) => Boolean(grants?.can_perform_stock_check || grants?.can_create_audit_stock_check);
const hasOrders = (grants) => Boolean(grants?.can_manage_purchase_orders || grants?.can_receive_purchase_orders);

function useAttention(token, outletId, grants) {
  const [state, setState] = useState({ outletId: null, loading: true, attention: null, checks: null, orders: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!hasCrewInventoryAccess(grants) || !outletId) {
      setState({ outletId, loading: false, attention: null, checks: null, orders: null, error: "" });
      return undefined;
    }
    let active = true;
    setState({ outletId, loading: true, attention: null, checks: null, orders: null, error: "" });
    Promise.all([
      crewService.inventoryAttention(token, outletId),
      hasStock(grants) ? crewService.inventoryStockChecks(token, outletId) : Promise.resolve(null),
      hasOrders(grants) ? crewService.inventoryPurchaseOrders(token, outletId) : Promise.resolve(null),
    ]).then(([attention, checks, orders]) => {
      if (active) setState({ outletId, loading: false, attention, checks, orders, error: "" });
    }).catch((cause) => {
      if (active) setState({ outletId, loading: false, attention: null, checks: null, orders: null, error: cause.message });
    });
    return () => { active = false; };
  }, [token, outletId, grants, revision]);
  return { ...(state.outletId === outletId ? state : { loading: true, attention: null, checks: null, orders: null, error: "" }), retry: () => setRevision((value) => value + 1) };
}

function AttentionModule({ icon: Icon, title, lines, feature, actionLabel, onOpen, onAction }) {
  return <section className="crew-inventory-home-module">
    <button type="button" className="crew-inventory-home-heading" onClick={onOpen}><Icon size={19} aria-hidden="true" /><strong>{title}</strong><ChevronRight size={17} aria-hidden="true" /></button>
    <div className="crew-inventory-home-copy">{lines.map((line) => <span key={line}>{line}</span>)}</div>
    {feature && <div className="crew-inventory-home-feature"><span><strong>{feature.title}</strong><small>{feature.detail}</small></span><button type="button" onClick={onAction}>{actionLabel}</button></div>}
  </section>;
}

export function CrewInventoryHomeAttention({ token, outletId, grants, onOpenStock, onOpenOrders, onOpenCheck, onOpenOrder }) {
  const { t } = useTranslation();
  const { attention, checks, orders, loading, error, retry } = useAttention(token, outletId, grants);
  if (!hasCrewInventoryAccess(grants)) return null;
  const drafts = (checks?.checks || []).filter((check) => check.status === "draft");
  const due = (checks?.due || []).filter((check) => check.status !== "completed");
  const receiving = (orders?.orders || []).filter((order) => ["supplier_confirmed", "partial_received"].includes(order.status));
  const confirming = (orders?.orders || []).filter((order) => order.status === "submitted");
  const priorityCheck = due.find((check) => check.status === "draft") || due[0] || drafts[0];
  const actionableReceiving = grants?.can_receive_purchase_orders ? receiving : [];
  const actionableConfirming = grants?.can_manage_purchase_orders ? confirming : [];
  const priorityOrder = actionableReceiving[0] || actionableConfirming[0];
  return <section className="crew-v2-home-section crew-inventory-home" aria-label={t("inventory.operations")}>
    {loading ? <p className="crew-inventory-subtle" role="status">{t("common.loading")}</p> : error ? <div className="crew-v2-error" role="alert">{t("inventory.loadError")} <button type="button" onClick={retry}>{t("common.retry")}</button></div> : <div className="crew-inventory-home-modules">
      {hasStock(grants) && <AttentionModule icon={ClipboardCheck} title={t("inventory.stockCheck")} onOpen={onOpenStock}
        lines={due.length || drafts.length ? [due.length > 0 && t("inventory.stockDueCount", { count: attention?.stock_checks_due_today ?? due.length }), drafts.length > 0 && t("inventory.draftsCount", { count: drafts.length })].filter(Boolean) : [t("inventory.stockAllClear")]}
        feature={priorityCheck && { title: priorityCheck.name, detail: `${priorityCheck.shift || priorityCheck.check_date || ""} · ${priorityCheck.items?.length ?? priorityCheck.item_count ?? 0} ${t("inventory.items")}` }}
        actionLabel={priorityCheck?.status === "draft" ? t("inventory.resume") : t("inventory.start")}
        onAction={() => onOpenCheck(priorityCheck)} />}
      {hasOrders(grants) && <AttentionModule icon={PackageCheck} title={t("inventory.purchaseOrders")} onOpen={onOpenOrders}
        lines={actionableReceiving.length || actionableConfirming.length ? [actionableReceiving.length > 0 && t("inventory.receivingCount", { count: attention?.purchase_orders_awaiting_receiving ?? actionableReceiving.length }), actionableConfirming.length > 0 && t("inventory.confirmCount", { count: attention?.purchase_orders_awaiting_confirmation ?? actionableConfirming.length })].filter(Boolean) : [t("inventory.ordersAllClear")]}
        feature={priorityOrder && { title: priorityOrder.po_no || t("inventory.purchaseOrder"), detail: priorityOrder.supplier_name || "" }}
        actionLabel={["supplier_confirmed", "partial_received"].includes(priorityOrder?.status) ? t("inventory.receivePo") : t("inventory.review")}
        onAction={() => onOpenOrder(priorityOrder)} />}
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
