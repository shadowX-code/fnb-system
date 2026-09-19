import { Check, XCircle } from "lucide-react";
import FactoryRowActions from "./FactoryRowActions.jsx";

const completeStatuses = new Set(["pending", "missed", "unsatisfactory"]);
const verifyStatuses = new Set(["completed", "submitted"]);

export default function FactoryMestiOccurrenceActions({
  status,
  canComplete = false,
  canVerify = false,
  onComplete,
  onVerify,
  onMarkUnsatisfactory,
  onView,
  viewLabel = "View details",
  working = false,
}) {
  const primaryAction = canComplete && completeStatuses.has(status)
    ? { label: working ? "Saving..." : "Complete", icon: Check, onClick: onComplete, disabled: working }
    : canVerify && verifyStatuses.has(status)
      ? { label: working ? "Verifying..." : "Verify", icon: Check, onClick: onVerify, disabled: working }
      : null;
  const secondaryActions = canVerify && verifyStatuses.has(status) && onMarkUnsatisfactory
    ? [{ label: "Mark unsatisfactory", icon: XCircle, destructive: true, onClick: onMarkUnsatisfactory }]
    : [];

  return <FactoryRowActions
    onView={onView}
    viewLabel={viewLabel}
    primaryAction={primaryAction}
    secondaryActions={secondaryActions}
  />;
}
