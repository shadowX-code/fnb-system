import StatusBadge from "./StatusBadge.jsx";

const tones = {
  neutral: "border-slate-200 bg-slate-50 text-text-secondary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  fuchsia: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-800",
  orange: "border-orange-200 bg-orange-50 text-orange-800",
  info: "border-blue-200 bg-blue-50 text-blue-700",
};

export default function Badge({ tone = "neutral", children, semantic = false, icon, className = "" }) {
  if (semantic) return <StatusBadge status={children} tone={tone === "neutral" ? undefined : tone} icon={icon} />;
  return (
    <span className={`badge badge-${tone} inline-flex rounded-full border px-2 py-0.5 type-caption font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
