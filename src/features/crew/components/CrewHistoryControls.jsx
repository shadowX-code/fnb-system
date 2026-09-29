import { useTranslation } from "react-i18next";
import { CalendarCheck } from "lucide-react";
import { malaysiaDateKey } from "../utils/crewMobile.js";

export function crewHistoryMonths(language) {
  const [year, month] = malaysiaDateKey(new Date()).slice(0, 7).split("-").map(Number);
  return [0, 1].map((offset) => {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    return { value: date.toISOString().slice(0, 7), label: new Intl.DateTimeFormat(language, { month: "short", year: "numeric", timeZone: "UTC" }).format(date) };
  });
}

export default function CrewHistoryControls({ month, onMonthChange, status, onStatusChange, statuses }) {
  const { t, i18n } = useTranslation();
  return <div className="crew-inventory-history-controls">
    <nav className="crew-ui-segmented crew-ui-segmented--mint crew-inventory-month-select" aria-label={t("attendance.month")}>{crewHistoryMonths(i18n.language).map((item) => <button key={item.value} type="button" className={month === item.value ? "is-active" : ""} aria-pressed={month === item.value} onClick={() => onMonthChange(item.value)}><span>{item.label}</span>{month === item.value && <CalendarCheck size={18} aria-hidden="true" />}</button>)}</nav>
    <div className="crew-v2-chips crew-inventory-chips" role="group" aria-label={t("inventory.statusFilter")}>{["all", ...statuses].map((value) => <button key={value} type="button" className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => onStatusChange(value)}>{value === "all" ? t("inventory.all") : t(`inventory.${value}`, { defaultValue: t(`inventory.status.${value}`) })}</button>)}</div>
  </div>;
}
