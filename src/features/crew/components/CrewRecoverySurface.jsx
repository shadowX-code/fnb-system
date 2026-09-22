import { RefreshCw, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";

export default function CrewRecoverySurface({ mode = "connection", attempts = 1, retrying = false, onRetry, onReload }) {
  const { t } = useTranslation();
  const offline = mode === "offline";
  const entryFailure = mode === "entry";
  const title = offline ? t("recovery.offlineTitle") : entryFailure ? t("recovery.entryTitle") : t("recovery.connectionTitle");
  const body = offline
    ? t("recovery.offlineBody")
    : entryFailure
      ? t("recovery.entryBody")
      : t("recovery.connectionBody");

  return <main className="crew-v2-shell"><section className="crew-v2-app crew-recovery-surface">
    <div className="crew-recovery-card" role={offline ? "status" : "alert"} aria-live="polite">
      <span className={`crew-ui-icon-container crew-ui-icon-container--large ${offline ? "is-warning" : "is-info"}`} aria-hidden="true">
        {offline ? <WifiOff size={24} /> : <RefreshCw size={24} className={retrying ? "crew-recovery-spin" : ""} />}
      </span>
      <div>
        <h1 className="crew-type-detail-title">{title}</h1>
        <p className="crew-type-secondary">{body}</p>
      </div>
      {offline ? <p className="crew-recovery-waiting">{t("recovery.waiting")}</p> : null}
      {!entryFailure && onRetry ? <button className="crew-mobile-primary" type="button" onClick={onRetry} disabled={retrying || offline}>
        <RefreshCw size={17} aria-hidden="true" />{retrying ? t("recovery.tryingAgain") : t("common.retry")}
      </button> : null}
      {(entryFailure || attempts >= 2) && onReload ? <button className="crew-mobile-secondary" type="button" onClick={onReload}>{t("recovery.reload")}</button> : null}
    </div>
  </section></main>;
}
