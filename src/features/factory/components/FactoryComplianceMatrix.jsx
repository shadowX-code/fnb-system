import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cleaningCalendarPresentation } from "../utils/cleaningCalendarPresentation.js";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";

const cellTone = {
  verified: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  completed: "border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  mixed: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  unsatisfactory: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  missed: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function FactoryComplianceLegend({ completedLabel = "Completed" } = {}) {
  return <div aria-label="Calendar legend" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary"><span className="font-semibold text-text-primary">Legend</span>{[["Verified", "bg-emerald-500"], [completedLabel, "bg-sky-500"], ["Pending", "bg-amber-500"], ["Missed", "bg-rose-500"], ["N/A", "bg-slate-400"]].map(([label, tone]) => <span key={label} title={label === "Review" ? "Awaiting Verification" : undefined} className="inline-flex items-center gap-1.5"><i aria-hidden="true" className={`size-2 rounded-full ${tone}`} />{label}</span>)}</div>;
}

export function FactoryMatrixCell({ cell, label, onClick, title, expanded, cleaningStatuses = false, today }) {
  if (!cell) return <span title={title} className="inline-flex h-8 min-w-10 items-center justify-center text-xs text-text-muted">—</span>;
  if (cleaningStatuses) {
    const presentation = cleaningCalendarPresentation(cell, today);
    label = presentation.label;
    title = `${title} · Calendar: ${presentation.description}`;
    cell = { ...cell, status: presentation.status };
  }
  if (!onClick) return <span title={title} aria-label={title} className={`inline-flex h-8 min-w-10 items-center justify-center rounded-md border px-1 text-[10px] font-semibold ${cellTone[cell.status] || "border-border bg-surface-muted text-text-muted"}`}>{label}</span>;
  return <button className={`inline-flex h-8 min-w-10 items-center justify-center rounded-md border px-1 text-[10px] font-semibold transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-primary/20 ${cellTone[cell.status] || "border-border bg-surface-muted text-text-muted"}`} type="button" title={title} aria-label={title} aria-expanded={expanded} onClick={onClick}>{label}</button>;
}

export default function FactoryComplianceMatrix({ rows, days, getCell, renderEntity, renderSecondary, renderFrequency = (row) => row.frequency, entityLabel = "Task", frequencyLabel = "Frequency", rowKey = (row) => row.logical_requirement_id, onCellClick, cellLabel, cellTitle, empty, expandedCellKey = "", renderExpanded, getChildren, defaultExpandedLimit = 5, isCellInteractive = () => true, renderCellDetail, showFrequency = true, today, onToday, cleaningStatuses = false }) {
  const [expandedRows, setExpandedRows] = useState({});
  const [selection, setSelection] = useState(null);
  const anchorRef = useRef(null);
  const scrollRef = useRef(null), pendingToday = useRef(false);
  const [todayRequest, setTodayRequest] = useState(0);
  useEffect(() => {
    if (!pendingToday.current) return;
    const target = scrollRef.current?.querySelector(`[data-calendar-day="${today}"]`);
    if (target) {
      const identity = scrollRef.current.querySelector("th");
      scrollRef.current.scrollTo?.({ left: Math.max(0, target.offsetLeft - identity.offsetWidth), behavior: "smooth" });
      pendingToday.current = false;
    }
  }, [days.join(","), todayRequest, rows]);
  if (!rows.length) return <>{onToday ? <button className="btn-secondary m-3" onClick={onToday}>Today</button> : null}{empty}</>;
  const entries = rows.flatMap(row => {
    const key = rowKey(row), children = getChildren?.(row) || [];
    const open = expandedRows[key] ?? rows.length <= defaultExpandedLimit;
    return [{ row, key, children, open, depth: 0 }, ...(open ? children.map(child => ({ row: child, key: rowKey(child), children: [], depth: 1 })) : [])];
  });
  const selectedRow = selection && entries.find(entry => entry.key === selection.key)?.row;
  const selectedCell = selectedRow && getCell(selectedRow, selection.day);
  const selectionCurrent = selectedCell && selectedCell.id === selection.id;
  return <>{onToday ? <div className="flex justify-end border-b border-border p-2"><button type="button" className="btn-secondary" onClick={() => { pendingToday.current = true; onToday(); setTodayRequest(value => value + 1); }}>Today</button></div> : null}<div ref={scrollRef} className="overflow-x-auto [container-type:inline-size]" data-testid="factory-compliance-matrix-scroll"><table className="min-w-[1120px] border-collapse text-left"><thead><tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted"><th className="sticky left-0 z-10 min-w-64 bg-surface px-4 py-2.5">{entityLabel}</th>{showFrequency ? <th className="min-w-36 px-3 py-2.5">{frequencyLabel}</th> : null}{days.map((day) => <th key={day} data-calendar-day={day} title={day} aria-current={day === today ? "date" : undefined} className="w-12 px-1 py-2.5 text-center">{Number(day.slice(-2))}</th>)}</tr></thead><tbody>{entries.flatMap(({ row, key, children, open, depth }) => {
    const expanded = expandedCellKey && renderExpanded ? days.map((day) => ({ cell: getCell(row, day), day })).find(({ cell, day }) => cell && `${key}:${day}` === expandedCellKey) : null;
    return [<tr key={key} data-depth={depth} className="border-b border-border last:border-b-0"><td className="sticky left-0 z-10 h-16 bg-surface px-4 py-3"><div className={`flex items-start gap-2 ${depth ? "pl-6" : ""}`}>
      {children.length ? <button type="button" className="icon-btn shrink-0" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${renderEntity(row)} locations`} title={`${open ? "Collapse" : "Expand"} locations`} onClick={() => setExpandedRows(current => ({ ...current, [key]: !open }))}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : null}
      <div className={`min-w-0 text-sm text-text-primary ${depth ? "" : "font-semibold"}`}>{renderEntity(row)}</div>
    </div>{renderSecondary ? <div className="mt-0.5 text-xs text-text-secondary">{renderSecondary(row)}</div> : null}</td>{showFrequency ? <td className="whitespace-nowrap px-3 py-3 text-sm font-semibold text-text-secondary">{renderFrequency(row)}</td> : null}{days.map((day) => { const cell = getCell(row, day); return <td key={day} className="p-1 text-center"><FactoryMatrixCell cleaningStatuses={cleaningStatuses} today={today} cell={cell} label={cell ? cellLabel?.(cell) : ""} title={cell ? cellTitle(cell, row) : "Not applicable"} expanded={renderCellDetail && cell && isCellInteractive(row) ? selection?.key === key && selection?.day === day && Boolean(selectionCurrent) : cell && renderExpanded ? expandedCellKey === `${key}:${day}` : undefined} onClick={cell && (onCellClick || renderCellDetail) && isCellInteractive(row) ? event => { if (renderCellDetail) { anchorRef.current = event.currentTarget; setSelection({ key, day, id: cell.id }); } else onCellClick(cell, row); } : undefined} /></td>; })}</tr>, expanded ? <tr key={`${key}:expanded`} className="border-b border-border bg-surface-muted/40"><td colSpan={days.length + (showFrequency ? 2 : 1)} className="p-0"><div className="sticky left-0 box-border w-[100cqw] p-3" data-testid="factory-compliance-matrix-expansion">{renderExpanded(expanded.cell, row)}</div></td></tr> : null].filter(Boolean);
  })}</tbody></table></div><FloatingLayer open={Boolean(renderCellDetail && selectionCurrent)} onOpenChange={open => { if (!open) { setSelection(null); anchorRef.current?.focus(); } }} anchorRef={anchorRef} width={360} minWidth={240} maxHeight={400} align="center" focusOnOpen>{selectionCurrent && renderCellDetail ? renderCellDetail(selectedCell, selectedRow) : null}</FloatingLayer></>;
}
