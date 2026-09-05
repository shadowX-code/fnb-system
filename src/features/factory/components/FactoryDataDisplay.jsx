import { RefreshCw } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";

export function FactoryTable({ columns, rows, emptyTitle, emptyDescription, onRowClick, density = "regular", headerStyle = "uppercase", rowHover = "", loading = false, loadingRows = 4 }) {
  if (!rows.length && !loading) return <div className="p-4"><EmptyState title={emptyTitle} description={emptyDescription} /></div>;
  const compact = density === "compact";
  const headerClass = headerStyle === "sentence"
    ? "text-xs font-semibold text-text-secondary"
    : "text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted";
  const headerPadding = compact ? "px-4 py-2.5" : "px-4 py-2.5";
  const cellPadding = compact ? "px-4 py-2.5" : "px-4 py-3";
  const hoverClass = rowHover === "mint" ? "factory-table-row-mint" : "factory-table-row-neutral";
  return (
    <div className="factory-table overflow-x-auto">
      <table className="w-full min-w-[760px] text-left" aria-busy={loading}>
        <thead>
          <tr className={`factory-table-header border-b border-border ${headerClass}`}>
            {columns.map((column) => (
              <th key={column.key} className={`${column.className || ""} ${headerPadding} ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows.length ? Array.from({ length: loadingRows }, (_, index) => (
            <tr key={`loading-${index}`} className="factory-table-row border-b border-border last:border-0">
              {columns.map((column) => <td key={column.key} className={`${column.className || ""} ${cellPadding}`}><div className="h-3 animate-pulse rounded bg-slate-100" /></td>)}
            </tr>
          )) : rows.map((row) => (
            <tr
              key={row.id}
              className={`factory-table-row border-b border-border last:border-0 ${rowHover ? `transition ${hoverClass}` : ""} ${onRowClick ? "cursor-pointer" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={`${column.className || ""} ${cellPadding} text-sm ${column.align === "right" ? "text-right" : ""}`}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccessIssueNotice({ issues, onRetry }) {
  if (!issues?.length) return null;
  const permissionIssues = issues.filter((issue) => issue.kind === "permission");
  const loadIssues = issues.filter((issue) => issue.kind !== "permission");
  return (
    <div className="space-y-2">
      {permissionIssues.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-bold">Some Factory data is hidden by your current role.</div>
          <div className="mt-1 text-xs font-semibold text-amber-800">{permissionIssues.map((issue) => issue.label).join(", ")}</div>
        </div>
      ) : null}
      {loadIssues.length ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-bold">Some Factory data could not be loaded.</div>
            {onRetry ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button> : null}
          </div>
          <div className="mt-1 text-xs font-semibold text-rose-800">{loadIssues.map((issue) => issue.label).join(", ")}</div>
        </div>
      ) : null}
    </div>
  );
}
