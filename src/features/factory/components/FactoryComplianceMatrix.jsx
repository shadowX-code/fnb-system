const cellTone = {
  verified: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  completed: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  mixed: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  unsatisfactory: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  missed: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function FactoryMatrixCell({ cell, label, onClick, title }) {
  if (!cell) return <span className="inline-flex h-8 min-w-10 items-center justify-center text-xs text-text-muted">—</span>;
  return <button className={`inline-flex h-8 min-w-10 items-center justify-center rounded-md border px-1 text-[10px] font-semibold transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-primary/20 ${cellTone[cell.status] || "border-border bg-surface-muted text-text-muted"}`} type="button" title={title} aria-label={title} onClick={onClick}>{label}</button>;
}

export default function FactoryComplianceMatrix({ rows, days, getCell, renderEntity, renderSecondary, renderFrequency = (row) => row.frequency, entityLabel = "Task", frequencyLabel = "Frequency", rowKey = (row) => row.logical_requirement_id, onCellClick, cellLabel, cellTitle, empty }) {
  if (!rows.length) return empty;
  return <div className="overflow-x-auto"><table className="min-w-[1120px] border-collapse text-left"><thead><tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted"><th className="sticky left-0 z-10 min-w-64 bg-surface px-4 py-2.5">{entityLabel}</th><th className="min-w-36 px-3 py-2.5">{frequencyLabel}</th>{days.map((day) => <th key={day} className="w-12 px-1 py-2.5 text-center">{Number(day.slice(-2))}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={rowKey(row)} className="border-b border-border last:border-b-0"><td className="sticky left-0 z-10 bg-surface px-4 py-3"><div className="text-sm font-semibold text-text-primary">{renderEntity(row)}</div>{renderSecondary ? <div className="mt-0.5 text-xs text-text-secondary">{renderSecondary(row)}</div> : null}</td><td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-text-secondary">{renderFrequency(row)}</td>{days.map((day) => { const cell = getCell(row, day); return <td key={day} className="p-1 text-center"><FactoryMatrixCell cell={cell} label={cell ? cellLabel(cell) : ""} title={cell ? cellTitle(cell, row) : "Not applicable"} onClick={cell ? () => onCellClick(cell, row) : undefined} /></td>; })}</tr>)}</tbody></table></div>;
}
