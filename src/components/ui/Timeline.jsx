import { AlertTriangle, Bell, ClipboardCheck, FileClock, History, PackageCheck, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import Badge from "./Badge.jsx";

const typeMeta = {
  inspection: { icon: ClipboardCheck, dot: "bg-blue-500", tint: "bg-blue-50 text-blue-700" },
  maintenance: { icon: Wrench, dot: "bg-emerald-500", tint: "bg-emerald-50 text-emerald-700" },
  movement: { icon: RefreshCw, dot: "bg-amber-500", tint: "bg-amber-50 text-amber-700" },
  alert: { icon: AlertTriangle, dot: "bg-rose-500", tint: "bg-rose-50 text-rose-700" },
  audit: { icon: ShieldCheck, dot: "bg-slate-500", tint: "bg-slate-100 text-slate-700" },
  created: { icon: PackageCheck, dot: "bg-emerald-500", tint: "bg-emerald-50 text-emerald-700" },
  updated: { icon: FileClock, dot: "bg-blue-500", tint: "bg-blue-50 text-blue-700" },
  default: { icon: Bell, dot: "bg-slate-400", tint: "bg-slate-100 text-slate-700" },
};

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "No date";
  return date.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" });
}

function eventTimestamp(event) {
  return event.date || event.timestamp || event.created_at || event.updated_at || "";
}

export function sortTimelineEvents(events = []) {
  return [...events].sort((first, second) => {
    const firstTime = toDate(eventTimestamp(first))?.getTime() || 0;
    const secondTime = toDate(eventTimestamp(second))?.getTime() || 0;
    return secondTime - firstTime;
  });
}

export default function Timeline({ events = [], variant = "compact", newestFirst = true, empty = "No activity yet.", className = "" }) {
  const sortedEvents = newestFirst ? sortTimelineEvents(events) : events;
  const isCard = variant === "card" || variant === "detailed";

  if (!sortedEvents.length) {
    return <div className={`rounded-2xl border border-dashed border-border p-4 text-center type-body-sm font-semibold text-text-secondary ${className}`}>{empty}</div>;
  }

  return (
    <div className={`relative ${className}`}>
      <div className="absolute bottom-2 left-[11px] top-2 w-px bg-border" />
      <div className="space-y-3">
        {sortedEvents.map((event) => {
          const meta = typeMeta[event.type] ?? typeMeta.default;
          const Icon = meta.icon;
          const timestamp = eventTimestamp(event);
          return (
            <article key={event.id} className={`relative pl-8 ${isCard ? "rounded-2xl border border-border bg-surface p-3 shadow-sm" : ""}`}>
              <span className={`absolute left-0 top-1.5 flex h-5 w-5 items-center justify-center rounded-full ${meta.tint} ring-4 ring-surface`}>
                <Icon size={11} />
              </span>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="type-card-title font-bold text-text-primary">{event.title}</div>
                  {event.description ? <div className="mt-0.5 type-caption text-text-secondary">{event.description}</div> : null}
                </div>
                {event.status ? <Badge tone={event.statusTone || "neutral"}>{event.status}</Badge> : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 type-caption text-text-muted">
                <span>{formatDate(timestamp)}{formatTime(timestamp) ? ` · ${formatTime(timestamp)}` : ""}</span>
                {event.actor ? <span>{event.actor}</span> : null}
                {event.outlet ? <span>{event.outlet}</span> : null}
              </div>
              {event.metadata ? <div className="mt-1 type-caption text-text-secondary">{event.metadata}</div> : null}
              {event.actions ? <div className="mt-2 flex flex-wrap gap-2">{event.actions}</div> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
