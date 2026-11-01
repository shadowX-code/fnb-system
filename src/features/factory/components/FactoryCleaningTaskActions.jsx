import { useEffect, useState } from "react";
import FactoryStatusBadge from "./FactoryStatusBadge.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { cleaningOccurrenceStatus } from "../utils/cleaningCalendarPresentation.js";

export default function FactoryCleaningTaskActions({ row, cell, disabled, canComplete, canVerify, onRequest, onRefresh }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setPreview(null); setError("");
    factoryService.mestiCleaningTaskAction(row.requirement_id, cell.due_date).then(value => {
      if (current) setPreview(value);
    }).catch(cause => { if (current) setError(cause.message || "Unable to check Location eligibility."); });
    return () => { current = false; };
  }, [row.requirement_id, cell, reload]);
  function request(action) {
    const count = preview[`${action}_count`];
    onRequest({ requirementId: row.requirement_id, dueDate: cell.due_date, action,
      expected: Object.fromEntries(preview.records.map(record => [record.id, record.token])),
      title: `${action === "complete" ? "Complete" : "Verify"} ${row.task_name}?`,
      message: `${formatFactoryDate(cell.due_date)} · ${count} Location record${count === 1 ? "" : "s"} will be affected; ${preview.total_count - count} skipped. Records changed since this check will be skipped. Each Location keeps its own evidence.`,
      confirmLabel: `${action === "complete" ? "Complete" : "Verify"} ${count} record${count === 1 ? "" : "s"}`,
    });
  }
  return <section aria-label="Cleaning task actions" className="space-y-3 p-3 text-sm">
    <div><h3 className="font-semibold text-text-primary">{row.task_name}</h3><p className="text-xs text-text-secondary">{formatFactoryDate(cell.due_date)} · Across Locations</p></div>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="btn-secondary mt-2" onClick={() => setReload(value => value + 1)}>Retry eligibility</button></div> : !preview ? <p role="status">Checking eligible records…</p> : <>
      <ul className="divide-y divide-border">{preview.records.map(record => <li key={record.id} className="flex items-start justify-between gap-3 py-1.5"><span>{record.location_name || "Location"}{record.status === "completed" && record.self_completed ? <span className="block text-xs text-text-secondary">Another verifier required</span> : null}</span><FactoryStatusBadge className="capitalize" status={cleaningOccurrenceStatus({ ...record, due_date: cell.due_date })} /></li>)}</ul>
      <div className="flex flex-wrap gap-2">{canComplete ? <button type="button" className="btn-secondary" disabled={disabled || !preview.complete_count} onClick={() => request("complete")}>Complete eligible ({preview.complete_count})</button> : null}{canVerify ? <button type="button" className="btn-secondary" disabled={disabled || !preview.verify_count} onClick={() => request("verify")}>Verify eligible ({preview.verify_count})</button> : null}</div>
      <p className="text-xs text-text-secondary">Complete: Pending/Missed only. Verify: Completed by another operator only.</p>
    </>}
    {disabled ? <button type="button" className="btn-secondary" onClick={onRefresh}>Refresh calendar</button> : null}
  </section>;
}
