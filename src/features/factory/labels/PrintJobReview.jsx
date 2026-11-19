import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";

export function inspectPrint(job) {
  const events = job.events || [];
  return {
    events,
    inspection: events.findLast((event) => event.usable_quantity != null),
    submission: events.findLast((event) => ["Sent", "Unknown"].includes(event.state)),
  };
}

export function PrintJobDetails({ job, printer, audit = false }) {
  const { events, inspection, submission } = inspectPrint(job);
  const hasSubmission = submission || ["Sent", "Unknown"].includes(job.state);
  const submissionDetail = submission?.detail || (!inspection && hasSubmission ? job.detail : "");
  return (
    <div className="space-y-2 break-words text-sm">
      <p className="text-text-secondary">
        {[job.printer_name || printer || "Printer unavailable", job.operator_name,
          job.template_version && `Template ${job.template_version}`].filter(Boolean).join(" · ")}
      </p>
      {hasSubmission && (
        <p><strong>Submission {submission?.state === "Sent" || job.state === "Sent" ? "accepted" : "uncertain"}.</strong>{" "}
          {submissionDetail || "No additional transport details were recorded."}
        </p>
      )}
      {inspection ? (
        <p><strong>Usable labels {inspection.usable_quantity} of {job.quantity}.</strong>{" "}
          {inspection.state === "Confirmed" ? "Physically confirmed." : inspection.detail}
        </p>
      ) : null}
      {job.detail && job.detail !== submissionDetail && job.detail !== inspection?.detail && <p>{job.detail}</p>}
      {job.reprint_reason && <p>Reprint reason · {job.reprint_reason}</p>}
      {audit && events.length > 0 && (
        <ol className="space-y-1 border-t border-border pt-2 text-xs text-text-secondary" aria-label="Audit events">
          {events.map((event) => <li key={event.id}>
            {event.state} · {new Date(event.created_at).toLocaleString()}
            {event.actor_name && ` · ${event.actor_name}`} · {event.detail || "Recorded"}
            {event.usable_quantity != null && ` · ${event.usable_quantity} usable`}
          </li>)}
        </ol>
      )}
    </div>
  );
}

export function PrintJobActions({ job, busy, allowReprint, onResolve, onReprint }) {
  return (
    <div className="flex flex-wrap gap-2">
      {allowReprint && ["Confirmed", "Failed"].includes(job.state) &&
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onReprint(job)}>Reprint</button>}
      {["Sent", "Unknown"].includes(job.state) && <>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onResolve(job, "Confirmed")}>Confirm Printed</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onResolve(job, "Failed")}>Report Issue</button>
      </>}
      {["Queued", "Printing"].includes(job.state) && (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onResolve(job, job.state === "Queued" ? "Failed" : "Unknown")}>Review Outcome</button>
      )}
    </div>
  );
}

export function PrintOutcomeForm({ resolve, setResolve, issue, busy, canRecordOutcome, resolvePrint }) {
  const h = resolve.job;
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-text-secondary">
        {resolve.state === "Confirmed"
          ? `Have you checked that all ${h.quantity} labels printed and are usable?`
          : issue
            ? "Count the usable labels and clear any held output before recording the issue."
            : h.state === "Queued"
              ? "Cancel this queued print request."
              : "Inspect the printer before continuing. An active submission cannot be cancelled."}
      </p>
      {issue && (
        <Field label="Usable labels">
          <input
            aria-label="Usable labels"
            className={inputClass()}
            type="number"
            min="0"
            max={h.quantity}
            step="1"
            value={resolve.count}
            disabled={busy}
            onChange={(e) => setResolve((r) => ({ ...r, count: e.target.value }))}
          />
        </Field>
      )}
      {resolve.state !== "Confirmed" && (
        <Field label="Inspection / recovery reason">
          <input
            aria-label="Inspection / recovery reason"
            className={inputClass()}
            maxLength={1000}
            value={resolve.reason}
            disabled={busy}
            onChange={(e) => setResolve((r) => ({ ...r, reason: e.target.value }))}
          />
        </Field>
      )}
      {issue && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={resolve.cleared}
            disabled={busy}
            onChange={(e) => setResolve((r) => ({ ...r, cleared: e.target.checked }))}
          />
          I inspected the printer and cleared any held output.
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={busy} onClick={() => setResolve(null)}>
          Back
        </button>
        <button className="btn-primary" disabled={busy || !canRecordOutcome} onClick={resolvePrint}>
          {resolve.state === "Confirmed" ? `Confirm ${h.quantity} usable labels` : "Record Outcome"}
        </button>
      </div>
    </div>
  );
}
