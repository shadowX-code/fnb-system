import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, PackageCheck } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewActionRow, CrewEmptyState, CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";

export const hasCrewInventoryAccess = (grants = {}) => Boolean(
  grants.can_perform_stock_check || grants.can_create_audit_stock_check
  || grants.can_manage_purchase_orders || grants.can_receive_purchase_orders
);

const hasStock = (grants) => Boolean(grants?.can_perform_stock_check || grants?.can_create_audit_stock_check);
const hasOrders = (grants) => Boolean(grants?.can_manage_purchase_orders || grants?.can_receive_purchase_orders);

function useAttention(token, outletId, grants) {
  const [state, setState] = useState({ loading: true, attention: null, checks: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!hasCrewInventoryAccess(grants) || !outletId) {
      setState({ loading: false, attention: null, checks: null, error: "" });
      return undefined;
    }
    let active = true;
    setState({ loading: true, attention: null, checks: null, error: "" });
    Promise.all([
      crewService.inventoryAttention(token, outletId),
      hasStock(grants) ? crewService.inventoryStockChecks(token, outletId) : Promise.resolve(null),
    ]).then(([attention, checks]) => {
      if (active) setState({ loading: false, attention, checks, error: "" });
    }).catch((cause) => {
      if (active) setState({ loading: false, attention: null, checks: null, error: cause.message });
    });
    return () => { active = false; };
  }, [token, outletId, grants, revision]);
  return { ...state, retry: () => setRevision((value) => value + 1) };
}

export function CrewInventoryHomeAttention({ token, outletId, grants, onOpen }) {
  const { t } = useTranslation();
  const { attention, checks, loading, error, retry } = useAttention(token, outletId, grants);
  if (!hasCrewInventoryAccess(grants)) return null;
  const drafts = (checks?.checks || []).filter((check) => check.status === "draft").length;
  return <section className="crew-v2-home-section crew-inventory-home">
    <CrewSectionHeader density="operational" title={t("inventory.operations")} action={t("common.viewAll")} onAction={onOpen} />
    {loading ? <p className="crew-inventory-subtle" role="status">{t("common.loading")}</p> : error ? <div className="crew-v2-error" role="alert">{t("inventory.loadError")} <button type="button" onClick={retry}>{t("common.retry")}</button></div> : <div className="crew-inventory-attention" aria-label={t("inventory.operations")}>
      {hasStock(grants) && <span>{t("inventory.stockDueCount", { count: attention?.stock_checks_due_today || 0 })}</span>}
      {hasStock(grants) && drafts > 0 && <span>{t("inventory.draftsCount", { count: drafts })}</span>}
      {grants?.can_receive_purchase_orders && <span>{t("inventory.receivingCount", { count: attention?.purchase_orders_awaiting_receiving || 0 })}</span>}
      {grants?.can_manage_purchase_orders && !grants?.can_receive_purchase_orders && <span>{t("inventory.confirmCount", { count: attention?.purchase_orders_awaiting_confirmation || 0 })}</span>}
    </div>}
  </section>;
}

export default function CrewInventoryOperationsMobile({ token, outletId, grants, onBack, onOpenStock, onOpenOrders }) {
  const { t } = useTranslation();
  const { attention, checks, loading, error, retry } = useAttention(token, outletId, grants);
  const drafts = (checks?.checks || []).filter((check) => check.status === "draft").length;
  return <section className="crew-inventory-page">
    <CrewMobileDetailHeader title={t("inventory.operations")} onBack={onBack} />
    {loading ? <p className="crew-inventory-state" role="status">{t("common.loading")}</p> : error ? <div className="crew-inventory-state" role="alert"><strong>{t("inventory.loadError")}</strong><button className="crew-mobile-secondary" type="button" onClick={retry}>{t("common.retry")}</button></div> : !hasCrewInventoryAccess(grants) ? <CrewEmptyState title={t("inventory.noAccess")} body={t("inventory.noAccessBody")} /> : <div className="crew-inventory-hub-list">
      {hasStock(grants) && <CrewActionRow icon={ClipboardCheck} title={t("inventory.stockCheck")} subtitle={t("inventory.stockSummary", { due: attention?.stock_checks_due_today || 0, drafts })} meta={<CrewStatusBadge tone={(attention?.stock_checks_due_today || 0) ? "warning" : "neutral"}>{attention?.stock_checks_due_today || 0}</CrewStatusBadge>} onClick={onOpenStock} />}
      {hasOrders(grants) && <CrewActionRow icon={PackageCheck} title={t("inventory.purchaseOrders")} subtitle={t("inventory.poSummary", { confirm: attention?.purchase_orders_awaiting_confirmation || 0, receive: attention?.purchase_orders_awaiting_receiving || 0 })} meta={<CrewStatusBadge tone={(attention?.purchase_orders_awaiting_receiving || 0) ? "warning" : "neutral"}>{attention?.purchase_orders_awaiting_receiving || 0}</CrewStatusBadge>} onClick={onOpenOrders} />}
    </div>}
  </section>;
}
