import StatusBadge from "../../../components/ui/StatusBadge.jsx";

const toneByStatus = {
  available: "green",
  completed: "green",
  verified: "green",
  reconciled: "green",
  pending: "amber",
  awaiting: "amber",
  low_balance: "amber",
  legacy_unallocated: "amber",
  expired: "red",
  incomplete: "red",
  mismatch: "red",
  review_required: "red",
  in_progress: "blue",
  depleted: "gray",
  inactive: "gray",
  not_applicable: "gray",
};

export default function FactoryStatusBadge({ status, tone, children, className = "" }) {
  const normalizedStatus = String(status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return <StatusBadge status={status} tone={tone || toneByStatus[normalizedStatus]} className={`text-[11px] ${className}`}>{children || status}</StatusBadge>;
}
