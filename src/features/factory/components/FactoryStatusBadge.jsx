import StatusBadge from "../../../components/ui/StatusBadge.jsx";
import { semanticStatusTone } from "../../../components/ui/semanticStatus.js";

const toneAliases = {
  success: "green",
  warning: "amber",
  danger: "red",
  info: "blue",
  neutral: "gray",
};

export default function FactoryStatusBadge({ status, tone, children, variant = "compact", className = "" }) {
  const resolvedTone = toneAliases[tone] || tone || semanticStatusTone(status);
  return <StatusBadge status={status} tone={resolvedTone} icon={variant === "compact" ? false : undefined} className={`text-[11px] ${className}`}>{children || status}</StatusBadge>;
}
