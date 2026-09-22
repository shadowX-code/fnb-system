import Badge from "./Badge.jsx";
import { lifecycleLabel, normalizeStatus, semanticStatusTone } from "./semanticStatus.js";

export default function PublicationState({ status, unpublishedChanges = false, version, lastPublishedLabel, className = "" }) {
  const normalized = normalizeStatus(status);
  const label = lifecycleLabel(status, { unpublishedChanges });
  const tone = unpublishedChanges ? "warning" : semanticStatusTone(normalized);
  return <span className={`inline-flex flex-wrap items-center gap-2 ${className}`.trim()}><Badge tone={tone}>{label}</Badge>{version ? <span className="text-xs font-semibold text-text-secondary">v{version}</span> : null}{lastPublishedLabel ? <span className="text-xs text-text-secondary">Last published {lastPublishedLabel}</span> : null}</span>;
}
