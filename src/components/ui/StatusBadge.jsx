import { CheckCircle2, Clock3, Info, MinusCircle, XCircle } from "lucide-react";
import { semanticStatusTone } from "./semanticStatus.js";

const toneClasses = {
  green: "badge-success",
  amber: "badge-warning",
  red: "badge-danger",
  blue: "badge-info",
  gray: "badge-neutral border-slate-200 bg-slate-50 text-slate-600",
};

const toneIcons = {
  green: CheckCircle2,
  amber: Clock3,
  red: XCircle,
  blue: Info,
  gray: MinusCircle,
};

const semanticToneMap = {
  good: "green",
  completed: "green",
  complete: "green",
  positive: "green",
  active: "green",
  success: "green",
  watch: "amber",
  needs_attention: "amber",
  "needs attention": "amber",
  pending: "amber",
  due_soon: "amber",
  "due soon": "amber",
  warning: "amber",
  critical: "red",
  missing: "red",
  error: "red",
  overdue: "red",
  damaged: "red",
  danger: "red",
  scheduled: "blue",
  info: "blue",
  in_progress: "blue",
  "in progress": "blue",
  under_maintenance: "blue",
  "under maintenance": "blue",
  archived: "gray",
  disposed: "gray",
  no_data: "gray",
  "no data": "gray",
  draft: "gray",
  neutral: "gray",
};

export function statusTone(status, fallback = "gray") {
  const sharedTone = semanticStatusTone(status, "");
  if (sharedTone) return { success: "green", warning: "amber", danger: "red", info: "blue", neutral: "gray" }[sharedTone] || fallback;
  const key = String(status || "").trim().toLowerCase().replace(/-/g, "_");
  return semanticToneMap[key] || semanticToneMap[key.replace(/_/g, " ")] || fallback;
}

export default function StatusBadge({ status, children, tone, icon, className = "" }) {
  const resolvedTone = toneClasses[tone] ? tone : statusTone(tone || status);
  const Icon = icon === false ? null : icon || toneIcons[resolvedTone] || null;

  return (
    <span className={`badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5 type-caption font-semibold ${toneClasses[resolvedTone] || toneClasses.gray} ${className}`}>
      {Icon ? <Icon size={11} strokeWidth={2.5} /> : null}
      <span>{children ?? status}</span>
    </span>
  );
}
