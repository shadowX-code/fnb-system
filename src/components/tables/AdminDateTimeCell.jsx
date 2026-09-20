/** Shared two-line table timestamp anatomy. Formatting remains feature-owned. */
export default function AdminDateTimeCell({ date, time, className = "" }) {
  return (
    <span className={`admin-date-time-cell ${className}`.trim()}>
      <strong>{date || "—"}</strong>
      {time ? <small>{time}</small> : null}
    </span>
  );
}
