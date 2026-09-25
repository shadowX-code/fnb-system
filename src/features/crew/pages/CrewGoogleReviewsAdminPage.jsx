import { useEffect, useState } from "react";
import { ExternalLink, Link2, Settings2, Star } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar, { AdminOutletField } from "../../../components/layout/AdminFilterToolbar.jsx";
import MonthPickerField from "../../../components/forms/MonthPickerField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { crewService } from "../../../services/crewService.js";

const monthNow = () => `${new Date().toISOString().slice(0, 7)}-01`;
const reviewFilters = ["All", "Positive", "Neutral", "Negative"];
const noData = "Not available";
const sentimentFor = (rating) => rating >= 4 ? "Positive" : rating === 3 ? "Neutral" : "Negative";
function googleReviewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com")) ? url.href : null;
  } catch { return null; }
}

export default function CrewGoogleReviewsAdminPage({ auth, store }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [period, setPeriod] = useState(monthNow);
  const [view, setView] = useState("reviews");
  const [filter, setFilter] = useState("All");
  const [order, setOrder] = useState("newest");
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const canEdit = auth.hasPermission("crew_performance.review");

  useEffect(() => {
    let active = true;
    setContext(null);
    setError("");
    setSaveMessage("");
    if (!outletId) return undefined;
    setLoading(true);
    crewService.googleReviewsAdminContext(outletId, period)
      .then((data) => { if (active) { setContext(data); setTargetInput(data.positive_target == null ? "" : String(data.positive_target)); } })
      .catch((cause) => { if (active) setError(cause.message || "Google Reviews context could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [outletId, period]);

  async function saveTarget(event) {
    event.preventDefault();
    const target = Number(targetInput);
    if (!Number.isSafeInteger(target) || target <= 0) { setSaveMessage("Enter a whole number greater than zero."); return; }
    setSaving(true);
    setSaveMessage("");
    try {
      await crewService.setGoogleMonthlyTarget(outletId, period, target);
      const next = await crewService.googleReviewsAdminContext(outletId, period);
      setContext(next);
      setTargetInput(String(next.positive_target));
      setSaveMessage("Monthly target saved. The change is audited.");
    } catch (cause) { setSaveMessage(cause.message || "Target could not be saved."); }
    finally { setSaving(false); }
  }

  const outlet = outlets.find((item) => item.id === outletId);
  const unavailable = context?.api_status === "pending_allowlist";
  const connectionLabel = context?.connection_status === "error" ? "Connection error" : context?.connection_status === "connected" ? "Connected" : "Not connected";
  const visibleReviews = (context?.reviews || [])
    .filter((review) => filter === "All" || sentimentFor(Number(review.rating)) === filter)
    .sort((left, right) => order === "rating_high" ? right.rating - left.rating : order === "rating_low" ? left.rating - right.rating : order === "oldest" ? new Date(left.created_at) - new Date(right.created_at) : new Date(right.created_at) - new Date(left.created_at));
  return <div className="space-y-5">
    <PageHeader section="Crew · Performance" title="Google Reviews" description="Outlet reputation and monthly review context." secondaryActions={<button type="button" className="btn-secondary" onClick={() => setView(view === "reviews" ? "settings" : "reviews")}><Settings2 size={16} /> {view === "reviews" ? "Settings" : "Reviews"}</button>} />
    <AdminFilterToolbar ariaLabel="Google Reviews scope" outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />} period={<MonthPickerField label="Month" value={period.slice(0, 7)} onChange={(value) => setPeriod(`${value}-01`)} />} />
    {loading ? <p className="text-sm text-text-secondary" role="status">Loading Google Reviews context…</p> : null}
    {error ? <div className="rounded-md border border-rose-200 px-4 py-3 text-sm text-rose-700" role="alert">{error}</div> : null}
    {!outletId && !loading ? <p className="text-sm text-text-secondary">Select an outlet to view its review context.</p> : null}
    {context && !loading ? view === "settings" ? <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <section className="space-y-3 border-t border-border pt-4" aria-label="Google Business Profile connection">
        <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-text-primary">Google Business Profile</h2><Badge tone="neutral">API access pending</Badge></div>
        <p className="text-sm text-text-secondary">One organization connection will supply verified business accounts and locations. Google API access is not available yet.</p>
        <p className="text-sm text-text-secondary">Connection: <strong className="text-text-primary">{connectionLabel}</strong> · Last sync: {context.last_synced_at ? new Date(context.last_synced_at).toLocaleString("en-MY") : noData}</p>
        <div className="flex flex-wrap gap-2"><button className="btn-secondary" type="button" disabled title="Available after Google Business Profile API access is approved">Connect</button><button className="btn-secondary" type="button" disabled title="No connection to reconnect">Reconnect</button><button className="btn-secondary" type="button" disabled title="No connection to disconnect">Disconnect</button></div>
      </section>
      <section className="space-y-3 border-t border-border pt-4" aria-label="Outlet mapping">
        <h2 className="text-base font-semibold text-text-primary">Outlet Mapping</h2>
        <p className="text-sm text-text-secondary">{outlet?.name || "Selected outlet"} is {context.location_name ? `mapped to ${context.location_name}` : "not mapped to a Google Location"}.</p>
        <p className="text-sm text-text-secondary">Locations must come from the connected Google account and be mapped explicitly. Outlet names are never matched automatically.</p>
        <button className="btn-secondary" type="button" disabled title="Connect Google Business Profile to load verified locations"><Link2 size={15} /> Choose Google Location</button>
      </section>
      <section className="space-y-3 border-t border-border pt-4 lg:col-span-2" aria-label="Monthly positive review target">
        <div><h2 className="text-base font-semibold text-text-primary">Monthly Positive Review Target</h2><p className="text-sm text-text-secondary">Set for {outlet?.name || "this outlet"} and {new Date(`${period}T12:00:00`).toLocaleDateString("en-MY", { month: "long", year: "numeric" })}. Changes are audited and lock after monthly Performance finalization.</p></div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={saveTarget}><label className="grid gap-1 text-sm font-medium text-text-secondary">Positive reviews<input className="control w-36" type="number" min="1" step="1" inputMode="numeric" value={targetInput} onChange={(event) => setTargetInput(event.target.value)} disabled={!canEdit || context.target_locked || saving} /></label><button className="btn-primary" type="submit" disabled={!canEdit || context.target_locked || saving || !targetInput}>{saving ? "Saving…" : "Save target"}</button></form>
        {context.target_locked ? <p className="text-sm text-text-secondary">Locked: Performance has been finalized for this outlet and month.</p> : !canEdit ? <p className="text-sm text-text-secondary">Performance review permission is required to edit this target.</p> : null}
        {saveMessage ? <p className="text-sm text-text-secondary" role="status">{saveMessage}</p> : null}
      </section>
    </div> : <div className="space-y-5">
      <div className="border-l-2 border-primary bg-primary/5 px-4 py-3"><strong className="text-sm text-text-primary">{context.connection_status === "error" ? "Google Reviews connection needs attention" : unavailable ? "Google Reviews is not connected" : "Google Reviews is unavailable"}</strong><p className="mt-1 text-sm text-text-secondary">{unavailable ? "Business Profile API approval is pending. Review metrics and content are unavailable; no Customer Performance points are calculated." : "Connect and map a verified Google Location to see review activity."}</p></div>
      <section aria-label="Review overview" className="grid gap-x-5 gap-y-4 border-y border-border py-4 sm:grid-cols-2 xl:grid-cols-4">{[
        ["New Reviews", noData], ["Positive / Monthly Target", `${noData} / ${context.positive_target ?? "Not set"}`],
        ["Average Rating", noData], ["Negative / Negative Rate", noData],
      ].map(([label, value]) => <div key={label}><p className="text-xs font-medium text-text-secondary">{label}</p><strong className="mt-1 block text-lg font-semibold text-text-primary">{value}</strong></div>)}</section>
      <div className="grid gap-5 lg:grid-cols-2"><section className="border-t border-border pt-4"><h2 className="text-base font-semibold text-text-primary">Positive Target Progress</h2><p className="mt-2 text-sm text-text-secondary">{context.positive_target ? `Target: ${context.positive_target} positive reviews. Progress is unavailable until Google data is connected.` : "Set a monthly target in Settings. Progress is unavailable until Google data is connected."}</p></section><section className="border-t border-border pt-4"><h2 className="text-base font-semibold text-text-primary">Review Trend</h2><p className="mt-2 text-sm text-text-secondary">No review trend is available yet.</p></section></div>
      <section className="border-t border-border pt-4"><h2 className="text-base font-semibold text-text-primary">Rating Breakdown</h2><div className="mt-3 grid grid-cols-5 gap-2">{[5, 4, 3, 2, 1].map((rating) => <div key={rating} className="text-sm text-text-secondary"><span className="inline-flex items-center gap-1"><Star size={13} /> {rating}</span><strong className="block text-text-primary">—</strong></div>)}</div></section>
      <section className="border-t border-border pt-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-text-primary">Reviews</h2><p className="text-sm text-text-secondary">Review content will appear here after connection and policy approval.</p></div><div className="w-40"><SelectField label="Order" value={order} onChange={setOrder} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "rating_high", label: "Highest rated" }, { value: "rating_low", label: "Lowest rated" }]} /></div></div>
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Review sentiment">{reviewFilters.map((item) => <button key={item} type="button" className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${filter === item ? "bg-primary/10 font-semibold text-primary" : "text-text-secondary hover:bg-slate-100"}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
        {visibleReviews.length ? <div className="mt-4 divide-y divide-border border-t border-border">{visibleReviews.map((review) => <article key={review.id} className="grid gap-1 py-3 sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:gap-4"><span className="inline-flex items-center gap-1 text-sm font-semibold text-text-primary"><Star size={14} /> {review.rating} / 5</span><div className="min-w-0"><time className="text-xs text-text-secondary" dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</time><p className="whitespace-pre-wrap break-words text-sm text-text-primary">{review.content || "No written review"}</p></div>{googleReviewUrl(review.url) ? <a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href={googleReviewUrl(review.url)} target="_blank" rel="noopener noreferrer">View on Google <ExternalLink size={14} /></a> : null}</article>)}</div> : <div className="mt-4 flex min-h-28 items-center justify-center border-t border-border text-center text-sm text-text-secondary">No Google reviews available for this outlet and month.</div>}
      </section>
    </div> : null}
  </div>;
}
