import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import Timeline from "../../../components/ui/Timeline.jsx";
import TagList from "../../../components/ui/TagList.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import FactoryStatusBadge from "./FactoryStatusBadge.jsx";
import useFactoryLatestRequest from "../hooks/useFactoryLatestRequest.js";
import { formatFactoryDate, formatFactoryDateTime } from "../utils/factoryDates.js";

export default function FactoryMestiRequirementHistory({ logicalRequirementId, loadVersions, formatSchedule }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const runLatest = useFactoryLatestRequest();
  const load = useCallback(() => runLatest(() => loadVersions(logicalRequirementId), {
    onStart: () => { setLoading(true); setError(""); }, onSuccess: setVersions,
    onError: failure => setError(failure.message || "Unable to load requirement history."), onFinally: () => setLoading(false),
  }), [logicalRequirementId, loadVersions, runLatest]);
  useEffect(() => { load(); }, [load]);
  if (loading) return <p role="status" className="py-6 text-sm text-text-secondary">Loading requirement history...</p>;
  if (error) return <div role="alert"><p className="text-sm text-[var(--factory-danger-text)]">{error}</p><button type="button" className="btn-secondary mt-2" onClick={load}>Retry</button></div>;
  if (!versions.length) return <EmptyState title="No requirement versions" description="" />;
  return <section aria-label="Requirement history"><Timeline variant="activity" newestFirst={false} showTimestamp={false} events={versions.map(version => ({
    id: version.id, icon: History, type: "audit", title: `Version ${version.version_no} · ${version.task_name}`,
    status: !version.superseded_by && !version.effective_until ? "Current" : undefined,
    description: <span>Effective From {formatFactoryDate(version.effective_from)}{version.effective_until ? ` · Until ${formatFactoryDate(version.effective_until)} (exclusive)` : ""}</span>,
    metadata: <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><span>{formatSchedule(version)}</span><FactoryStatusBadge tone={version.status === "active" ? "success" : "neutral"}>{version.status === "active" ? "Active" : "Inactive"}</FactoryStatusBadge></div>
      <TagList tags={version.location_names || []} />
      {version.created_at ? <p>Created {formatFactoryDateTime(version.created_at)}{version.created_by_name ? ` · ${version.created_by_name}` : ""}</p> : null}
      {version.updated_at && version.updated_at !== version.created_at ? <p>Updated {formatFactoryDateTime(version.updated_at)}</p> : null}
    </div>,
  }))} /></section>;
}
