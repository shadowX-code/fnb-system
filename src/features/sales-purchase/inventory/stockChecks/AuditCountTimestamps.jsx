import { formatOperationalMoment } from "../../../../lib/dateTime.js";

export function AuditCountTimestampFields({
  startedAt, submittedAt,
  startedLabel = "Count Started At (MYT)", submittedLabel = "Count Submitted At (MYT)",
}) {
  return [[startedLabel, startedAt], [submittedLabel, submittedAt]].map(([label, value]) => (
    <div key={label} className="min-w-0">
      <dt className="type-caption text-text-secondary">{label}</dt>
      <dd className="type-body-sm font-semibold tabular-nums text-text-primary">
        {value ? <time dateTime={value}>{formatOperationalMoment(value)}</time> : "—"}
      </dd>
    </div>
  ));
}

export default function AuditCountTimestamps({ className = "", ...timestamps }) {
  return <dl className={`grid grid-cols-2 gap-2 ${className}`}><AuditCountTimestampFields {...timestamps} /></dl>;
}
