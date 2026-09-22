import { useEffect, useState } from "react";
import { Bell, ChevronRight, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";
import { formatCrewOperationalDateTime } from "../utils/crewI18n.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState, CrewMobilePage, CrewPageSection, CrewStatusBadge } from "./CrewMobileUI.jsx";
import "./CrewNotificationsMobile.css";

function relativeTime(value, t) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return t("notifications.justNow");
  if (seconds < 3600) return t("notifications.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("notifications.hoursAgo", { count: Math.floor(seconds / 3600) });
  return t("notifications.daysAgo", { count: Math.floor(seconds / 86400) });
}

export default function CrewNotificationsMobile({ token, onBack, onOpenNotification, onUnreadChanged }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState("all");
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");

  async function load(nextPage = page, nextMode = mode) {
    setLoading(true); setError("");
    try {
      const result = await crewService.notificationsPage(token, { unreadOnly: nextMode === "unread", page: nextPage, pageSize: 20 });
      setRows(result.rows || []); setTotal(Number(result.total_count) || 0); setPage(Number(result.page) || nextPage);
    } catch { setError(t("notifications.loadError")); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(1, mode); }, [token, mode]);

  async function open(row) {
    setOpeningId(row.id);
    try {
      const result = await crewService.markNotificationRead(token, row.id);
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, is_read: true } : item));
      await onUnreadChanged?.();
      if (result?.source_available) onOpenNotification?.(result.action_descriptor);
      else setError(t("notifications.unavailable"));
    } catch { setError(t("notifications.openError")); }
    finally { setOpeningId(""); }
  }

  const pageCount = Math.max(1, Math.ceil(total / 20));
  return <CrewMobilePage className="crew-notifications-page">
    <CrewMobileDetailHeader title={t("notifications.title")} onBack={onBack} />
    <CrewPageSection>
      <div className="crew-ui-tabs crew-notifications-tabs" role="tablist" aria-label={t("notifications.title")}>
        <button type="button" role="tab" aria-selected={mode === "all"} className={mode === "all" ? "is-active" : ""} onClick={() => setMode("all")}>{t("notifications.all")}</button>
        <button type="button" role="tab" aria-selected={mode === "unread"} className={mode === "unread" ? "is-active" : ""} onClick={() => setMode("unread")}>{t("notifications.unread")}</button>
      </div>
      {loading ? <div className="crew-v2-state" role="status">{t("notifications.loading")}</div> : null}
      {error ? <div className="crew-v2-error" role="alert">{error}<button type="button" onClick={() => load()}>{t("common.retry")}</button></div> : null}
      {!loading && !rows.length ? <CrewEmptyState title={t("notifications.empty")} body={mode === "unread" ? t("notifications.emptyUnread") : undefined} /> : null}
      <div className="crew-notifications-list">{rows.map((row) => <button key={row.id} type="button" className={`crew-notification-row${row.is_read ? " is-read" : ""}`} disabled={openingId === row.id} onClick={() => open(row)}>
        <span className="crew-notification-icon"><Bell size={18} /></span><span className="crew-notification-copy"><span className="crew-notification-title-row"><strong>{row.title}</strong>{row.priority === "important" ? <CrewStatusBadge tone="warning">{t("notifications.important")}</CrewStatusBadge> : null}</span><small>{row.body}</small><em><Clock3 size={13} /><time dateTime={row.created_at} title={formatCrewOperationalDateTime(row.created_at)}>{relativeTime(row.created_at, t)}</time></em></span><ChevronRight size={17} aria-hidden="true" />
      </button>)}</div>
      {total > 20 ? <div className="crew-notifications-pagination"><button type="button" className="crew-mobile-secondary" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>{t("notifications.previous")}</button><span>{t("notifications.page", { page, pageCount })}</span><button type="button" className="crew-mobile-secondary" disabled={page >= pageCount || loading} onClick={() => load(page + 1)}>{t("notifications.next")}</button></div> : null}
    </CrewPageSection>
  </CrewMobilePage>;
}
