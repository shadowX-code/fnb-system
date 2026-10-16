import { useTranslation } from "react-i18next";
import { formatCrewMoney, formatCrewOperationalDateTime } from "../utils/crewI18n.js";

// One audit presentation for Admin and Crew; effective values come from the server.
export default function CrewCashAllocationAudit({ checkout }) {
  const { t } = useTranslation();
  if (!checkout?.allocation_corrections?.length && !checkout?.previous_checkout_id) return null;
  const allocation = (value) => `${t("cash.carryForward")} ${formatCrewMoney(value.carry_forward)} · ${t("cash.forDeposit")} ${formatCrewMoney(value.amount_for_deposit)}`;
  return <section className="crew-cash-detail-section" aria-label={t(checkout.allocation_corrections?.length ? "cash.allocationAudit.title" : "cash.replacementAttempt")}>
    {checkout.previous_checkout_id && <p>{t("cash.replacementAttempt")} · {formatCrewOperationalDateTime(checkout.attempt_created_at)}</p>}
    {checkout.allocation_corrections?.length > 0 && <h3>{t("cash.allocationAudit.title")}</h3>}
    {checkout.allocation_original && <p>{t("cash.allocationAudit.original")}: {allocation(checkout.allocation_original)}</p>}
    {(checkout.allocation_corrections || []).map((correction) => <article key={correction.id} className="mt-3 space-y-1">
      <p>{allocation(correction.before)} → {allocation(correction.after)}</p>
      <p>{correction.actor_name} · {formatCrewOperationalDateTime(correction.created_at)}</p>
      <p>{correction.reason}</p>
    </article>)}
  </section>;
}
