import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import EmptyState from "./EmptyState.jsx";
import LoadingSkeleton from "./LoadingSkeleton.jsx";

export default function AsyncDataSurface({
  loading = false,
  error = "",
  hasData = false,
  isEmpty = false,
  errorTitle,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyActions,
  onRetry,
  permissionLimited = false,
  warning = "",
  loadingRows = 4,
  children,
  className = "",
}) {
  const showContent = hasData || (!loading && !error && !isEmpty);
  return (
    <section className={`overflow-hidden ${className}`.trim()} aria-busy={loading || undefined}>
      {permissionLimited ? <Notice icon={ShieldAlert} tone="warning">Some data is hidden by your current role.</Notice> : null}
      {warning ? <Notice icon={AlertTriangle} tone="warning">{warning}</Notice> : null}
      {error ? <Notice icon={AlertTriangle} tone="danger" action={onRetry ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={loading} onClick={onRetry}><RefreshCw size={13} /> Retry</button> : null}>{hasData ? "Unable to load the latest results. Showing the last successfully loaded data." : errorTitle ? <><span>{errorTitle}</span><span className="block text-xs font-medium">{error}</span></> : error}</Notice> : null}
      {loading && !hasData ? <div role="status" aria-label="Loading data"><LoadingSkeleton rows={loadingRows} /></div> : null}
      {!loading && !error && isEmpty ? <div className="p-4"><EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} actions={emptyActions} /></div> : null}
      {showContent ? children : null}
    </section>
  );
}

function Notice({ icon: Icon, tone, children, action }) {
  const classes = tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900";
  return <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 ${classes}`} role="alert"><div className="flex min-w-0 items-start gap-2 text-sm font-semibold"><Icon className="mt-0.5 shrink-0" size={16} /><span>{children}</span></div>{action}</div>;
}
