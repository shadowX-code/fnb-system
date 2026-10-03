import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import useManagementTodayTeam from "../hooks/useManagementTodayTeam.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState, CrewMetric, CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { formatTime, formatRosterTime } from "../utils/crewMobile.js";

export default function CrewManagementTodayTeam({ token, outletId, full = false, onOpen, onBack }) {
  const { t } = useTranslation();
  const { data, error, refresh } = useManagementTodayTeam(token, outletId);
  const content = error ? <div className="crew-v2-error" role="alert"><p>{t("todayTeam.unavailable")}</p><button type="button" className="crew-mobile-secondary" onClick={refresh}>{t("common.retry")}</button></div>
    : !data ? <div role="status">{t("common.loading")}</div> : <>
      <div className="crew-today-team-metrics">{["scheduled", "clocked_in", "not_clocked_in", "completed"].map((key) => <CrewMetric key={key} value={data.summary[key]} label={t(`todayTeam.${key}`)} />)}</div>
      {full && <><p className="crew-list-secondary">{data.outlet_name} · {t("todayTeam.updated", { time: formatTime(data.as_of) })}</p><div className="crew-home-list">{data.employees.map((row) => <div key={row.employee_id} className="crew-home-task crew-today-team-row"><i className="crew-ui-icon-container crew-ui-icon-container--compact"><Users size={18} /></i><span className="crew-home-task-copy"><strong>{row.nickname || row.employee_name}</strong><small>{formatRosterTime(row.shift.start_time)} – {formatRosterTime(row.shift.end_time)}</small><small>{row.state === "clocked_in" ? t("todayTeam.clockedAt", { time: formatTime(row.clock_in_at) }) : row.state === "completed" ? t("todayTeam.completedAt", { time: formatTime(row.clock_out_at) }) : t(`todayTeam.${row.state}`)}</small></span><CrewStatusBadge tone={row.state === "clocked_in" ? "success" : row.state === "not_clocked_in" ? "warning" : "neutral"}>{t(`todayTeam.${row.state}`)}</CrewStatusBadge></div>)}</div>{!data.employees.length && <CrewEmptyState title={t("todayTeam.noSchedule")} />}</>}
    </>;
  return full ? <section className="crew-ops-mobile"><CrewMobileDetailHeader title={t("todayTeam.title")} onBack={onBack} />{content}</section>
    : <section className="crew-v2-home-section crew-today-team" aria-label={t("todayTeam.title")}><CrewSectionHeader density="operational" title={t("todayTeam.title")} action={t("common.viewAll")} onAction={onOpen} />{content}</section>;
}
