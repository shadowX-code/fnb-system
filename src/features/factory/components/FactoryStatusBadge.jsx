import StatusBadge from "../../../components/ui/StatusBadge.jsx";

const toneByStatus = {
  available: "green",
  completed: "green",
  verified: "green",
  reconciled: "green",
  active: "green",
  healthy: "green",
  in_stock: "green",
  pending: "amber",
  awaiting: "amber",
  awaiting_verification: "amber",
  low_stock: "amber",
  low_balance: "amber",
  legacy_unallocated: "amber",
  expired: "red",
  incomplete: "red",
  mismatch: "red",
  review_required: "red",
  missed: "red",
  failed: "red",
  out_of_stock: "red",
  critical: "red",
  in_progress: "blue",
  released: "blue",
  informational: "blue",
  depleted: "gray",
  inactive: "gray",
  draft: "gray",
  cancelled: "gray",
  not_applicable: "gray",
};

const toneAliases = {
  success: "green",
  warning: "amber",
  danger: "red",
  info: "blue",
  neutral: "gray",
};

export default function FactoryStatusBadge({ status, tone, children, variant = "compact", className = "" }) {
  const normalizedStatus = String(status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const resolvedTone = toneAliases[tone] || tone || toneByStatus[normalizedStatus];
  return <StatusBadge status={status} tone={resolvedTone} icon={variant === "compact" ? false : undefined} className={`text-[11px] ${className}`}>{children || status}</StatusBadge>;
}
