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
}) {
  const primaryAction = canComplete && completeStatuses.has(status)
    ? { label: "Complete", icon: Check, onClick: onComplete }
    : canVerify && verifyStatuses.has(status)
      ? { label: "Verify", icon: Check, onClick: onVerify }
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
