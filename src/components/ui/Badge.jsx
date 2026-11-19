import StatusBadge from "./StatusBadge.jsx";

const tones = {
  neutral: "border-slate-200 bg-slate-50 text-text-secondary",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  fuchsia: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-800",
  orange: "border-orange-200 bg-orange-50 text-orange-800",
};

export default function Badge({ tone = "neutral", children, semantic = false, icon, className = "" }) {
  if (semantic) return <StatusBadge status={children} tone={tone === "neutral" ? undefined : tone} icon={icon} />;
  return (
    <span className={`badge badge-${tone} inline-flex rounded-full border px-2 py-0.5 type-caption font-semibold ${tones[tone] ?? ""} ${className}`}>
      {children}
    </span>
  );
}
