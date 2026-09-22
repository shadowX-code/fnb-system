import { RefreshCw, WifiOff } from "lucide-react";

export default function CrewRecoverySurface({ mode = "connection", attempts = 1, retrying = false, onRetry, onReload }) {
  const offline = mode === "offline";
  const entryFailure = mode === "entry";
  const title = offline ? "You're offline" : entryFailure ? "We couldn't open FeedX" : "We couldn't connect";
  const body = offline
    ? "Reconnect to the internet and FeedX will try again automatically."
    : entryFailure
      ? "FeedX needs to reload to continue."
      : "Your connection may be unstable. Try again to continue.";

  return <main className="crew-v2-shell"><section className="crew-v2-app crew-recovery-surface">
    <div className="crew-recovery-card" role={offline ? "status" : "alert"} aria-live="polite">
      <span className={`crew-ui-icon-container crew-ui-icon-container--large ${offline ? "is-warning" : "is-info"}`} aria-hidden="true">
        {offline ? <WifiOff size={24} /> : <RefreshCw size={24} className={retrying ? "crew-recovery-spin" : ""} />}
      </span>
      <div>
        <h1 className="crew-type-detail-title">{title}</h1>
        <p className="crew-type-secondary">{body}</p>
      </div>
      {offline ? <p className="crew-recovery-waiting">Waiting for connection…</p> : null}
      {!entryFailure && onRetry ? <button className="crew-mobile-primary" type="button" onClick={onRetry} disabled={retrying || offline}>
        <RefreshCw size={17} aria-hidden="true" />{retrying ? "Trying again…" : "Try again"}
      </button> : null}
      {(entryFailure || attempts >= 2) && onReload ? <button className="crew-mobile-secondary" type="button" onClick={onReload}>Reload FeedX</button> : null}
    </div>
  </section></main>;
}
