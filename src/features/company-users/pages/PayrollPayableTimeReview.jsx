import { canonicalPathForRoute } from '../../../app/routeOwnership.js';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Modal from '../../../components/feedback/Modal.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { payrollTimeNeedsReview } from './payrollRunPresentation.js';
import { DecisionModal, LatestPublishedRoster, timeTreatment } from './PayrollTimeExceptionsTab.jsx';

const hours = value => value == null ? '—' : `${(Number(value) / 60).toFixed(2)} h`;
const money = value => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(value);
const human = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const time = value => value ? new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
const interval = (start, end) => `${time(start)} – ${time(end)}`;
const differences = {
  late_arrival: 'Late arrival', early_departure: 'Early departure',
  missing_clock_in: 'Missing clock in', missing_clock_out: 'Missing clock out',
  missing_punch: 'Missing clock evidence',
  extra_time: 'Extra time / OT candidate',
};

export default function PayrollPayableTimeReview({ employee, month, canManage, canViewLeave = false, frozen = false, onClose, onDecisionSaved, onOpenSynchronization, runId }) {
  const [decisionDate, setDecisionDate] = useState(null);
  const [correcting, setCorrecting] = useState(false);
  const [queue, setQueue] = useState([]);
  const [latestRows, setLatestRows] = useState(null);
  const [filter, setFilter] = useState('All');
  const [expandedId, setExpandedId] = useState(null);
  const [dateDirection, setDateDirection] = useState('asc');
  const toggleDateDirection = () => setDateDirection(direction => direction === 'asc' ? 'desc' : 'asc');
  const isUnsynchronized = row => row.review_state?.state === 'unreconciled';
  const rows = latestRows || employee.time;
  const exceptions = rows.filter(payrollTimeNeedsReview);
  const syncRows = exceptions.filter(isUnsynchronized);
  const actionable = exceptions.filter(row => !isUnsynchronized(row)).sort((a, b) => a.work_date.localeCompare(b.work_date));
  const approved = rows.filter(row => !payrollTimeNeedsReview(row) && ['approved_auto', 'approved_manual'].includes(row.status));
  const groups = { All: rows, 'Needs Review': actionable, Approved: approved, 'Needs Sync': syncRows };
  const priority = row => isUnsynchronized(row) ? 1 : payrollTimeNeedsReview(row) ? 0 : 2;
  const visibleRows = [...groups[filter]].sort((a, b) =>
    priority(a) - priority(b) || (dateDirection === 'asc' ? 1 : -1) * a.work_date.localeCompare(b.work_date));
  const startReview = row => {
    setCorrecting(false);
    setLatestRows(rows);
    setQueue(actionable.map(item => item.work_date));
    setDecisionDate(row.work_date);
  };
  const evidenceIncomplete = !latestRows && (employee.timeExceptionCount ?? 0) > exceptions.length;
  const nonHolidayRows = rows.filter(row => row.review_state?.state !== 'ph_review');
  const sum = (key, items = nonHolidayRows) => items.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const longSpans = nonHolidayRows.filter(row => row.actual_minutes >= 1440);
  const recorded = key => nonHolidayRows.some(row => row[key] != null) ? hours(sum(key)) : '—';
  const regular = (employee.calculation?.lines || []).filter(line => line.kind === 'earning' && line.code === 'regular');
  const rates = [...new Set(regular.map(line => Number(line.rate_per_minute) * 60).filter(Number.isFinite).map(rate => money(rate)))];
  const rate = rates.length ? rates.join(' / ') : employee.pay?.hourly_rate != null ? money(employee.pay.hourly_rate) : '—';
  const rosterLabel = row => row.evidence?.roster_entry_type && row.evidence.roster_entry_type !== 'working'
    ? human(row.evidence.roster_entry_type) : interval(row.evidence?.scheduled_start_at, row.evidence?.scheduled_end_at);
  const canDecide = canManage && !frozen;
  const columns = [
    { key: 'date', header: 'Date', onSort: toggleDateDirection, sortDirection: dateDirection, render: row => {
      const expanded = expandedId === row.id;
      const Chevron = expanded ? ChevronDown : ChevronRight;
      return <button type="button" className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md px-1 text-left font-semibold focus-visible:outline focus-visible:outline-primary md:min-h-8"
        aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} details for ${row.work_date}`} onClick={() => setExpandedId(expanded ? null : row.id)}>
        <Chevron size={16} aria-hidden="true" />{row.work_date}
      </button>;
    } },
    { key: 'roster', header: 'Roster', render: row => <div className="whitespace-nowrap">{rosterLabel(row)}
      {!frozen && row.latest_published_roster && <small className="block text-text-secondary">Newer roster</small>}</div> },
    { key: 'clock', header: 'Clock / Actual', render: row => <div className="whitespace-nowrap tabular-nums">{interval(row.evidence?.clock_in_at, row.evidence?.clock_out_at)}
      {row.actual_minutes != null && <small className="block text-text-secondary">{hours(row.actual_minutes)}{row.actual_minutes >= 1440 ? ' · 24h+ span' : ''}</small>}</div> },
    { key: 'leave', header: 'Leave', render: row => row.evidence?.leave_id ? `Approved ${human(row.evidence.leave_type)} Leave` : '—' },
    { key: 'payable', header: 'Payable', render: row => <strong className="whitespace-nowrap tabular-nums">{row.approved_minutes != null
      ? hours(Number(row.approved_minutes) + Number(row.approved_extra_minutes || 0))
      : isUnsynchronized(row) ? 'Pending sync' : row.review_state?.automatic ? 'Monthly / Leave rules' : 'Pending review'}</strong> },
    { key: 'issue', header: 'Issue', render: row => row.issue_codes?.length
      ? <>{differences[row.issue_codes[0]] || human(row.issue_codes[0])}{row.issue_codes.length > 1 && <small className="ml-1 whitespace-nowrap text-text-secondary">+{row.issue_codes.length - 1}</small>}</> : '—' },
    { key: 'status', header: 'Status', render: row => <Badge tone={payrollTimeNeedsReview(row) ? 'warning' : 'success'}>
      {isUnsynchronized(row) ? 'Needs Sync' : payrollTimeNeedsReview(row) ? row.source_state?.updated ? 'Source Updated' : 'Needs Review'
        : row.review_state?.automatic || row.status === 'approved_auto' ? 'Resolved automatically' : human(row.status)}
    </Badge> },
    { key: 'action', header: 'Action', render: row => {
      if (row.review_state?.state === 'ph_review') return <span className="text-text-secondary">PH review separate</span>;
      if (isUnsynchronized(row)) return onOpenSynchronization && !frozen
        ? <button type="button" className="btn-secondary btn-sm min-h-11 whitespace-nowrap md:min-h-0" onClick={onOpenSynchronization}>Evidence Sync</button> : '—';
      if (!canDecide) return '—';
      if (payrollTimeNeedsReview(row)) return <button type="button" className="btn-secondary btn-sm min-h-11 md:min-h-0"
        aria-label={row.source_state?.updated ? 'Review source changes' : 'Review exception'} onClick={() => startReview(row)}>Review</button>;
      if (row.evidence?.leave_id) return '—';
      return <button type="button" className="btn-secondary btn-sm min-h-11 whitespace-nowrap md:min-h-0" onClick={() => {
        setCorrecting(true); setLatestRows(rows); setDecisionDate(row.work_date);
      }}>{row.status === 'review_required' ? 'Adjust Payable Time' : 'Correct Decision'}</button>;
    } },
  ];
  const renderExpandedRow = row => expandedId === row.id && <div className="grid gap-4 py-2 text-sm md:grid-cols-3">
    <section>
      <h3 className="font-semibold">Roster comparison</h3>
      <p className="mt-1 text-xs text-text-secondary">Roster used for Payroll review</p>
      <p>{rosterLabel(row)}{row.evidence?.roster_break_minutes != null ? ` · ${row.evidence.roster_break_minutes}m unpaid break` : ''}</p>
      {row.scheduled_minutes != null && <p className="text-text-secondary">{hours(row.scheduled_minutes)} scheduled payable</p>}
      {!frozen && <LatestPublishedRoster roster={row.latest_published_roster} />}
    </section>
    <section>
      <h3 className="font-semibold">Payroll review</h3>
      <p className="mt-1">{timeTreatment(row) || 'Classification unavailable'}</p>
      {!!row.issue_codes?.length && <p className="text-text-secondary">{row.issue_codes.map(issue => differences[issue] || human(issue)).join(' · ')}</p>}
      {row.proposed_minutes != null && <p>Proposed {hours(row.proposed_minutes)}</p>}
      {row.evidence?.extra_candidate_minutes > 0 && <p>Extra candidate {hours(row.evidence.extra_candidate_minutes)}</p>}
      {row.approved_extra_minutes > 0 && <p>Approved OT {hours(row.approved_extra_minutes)}</p>}
      {row.review_state?.state === 'ph_review' ? <p>Review PH treatment separately in Employee Review.</p>
        : isUnsynchronized(row) ? <p>Synchronize evidence before recording a Payroll decision.</p>
        : row.source_state?.updated ? <p>Review source changes before recording a new decision.</p>
        : payrollTimeNeedsReview(row) && <p>Review the exception before recording payable time.</p>}
      {row.evidence?.leave_id && canManage && canViewLeave && <a className="inline-flex min-h-11 items-center font-semibold text-primary"
        href={canonicalPathForRoute('crew_leave')} target="_blank" rel="noopener noreferrer">View in Leave</a>}
    </section>
    <section>
      <h3 className="font-semibold">Evidence / History</h3>
      {row.actual_minutes >= 1440 && <p className="mt-1 text-text-secondary">Recorded clock span of {hours(row.actual_minutes)}. This span is included in the clock total.</p>}
      {row.history?.length ? <ul className="mt-1 space-y-1 text-text-secondary">{row.history.map(version => <li key={version.id}>
        {human(version.status)} · {hours(version.approved_minutes)}{version.reason ? ` · ${version.reason}` : ''}{version.at ? ` · ${new Date(version.at).toLocaleString()}` : ''}
      </li>)}</ul> : <p className="mt-1 text-text-secondary">No decision history recorded.</p>}
    </section>
  </div>;
  const decision = rows.find(row => row.work_date === decisionDate);
  const index = queue.indexOf(decisionDate);
  const advance = (updated, savedDate) => {
    const unresolved = updated.filter(row => payrollTimeNeedsReview(row) && !isUnsynchronized(row)).sort((a, b) => a.work_date.localeCompare(b.work_date));
    const next = unresolved.find(row => row.work_date > savedDate) || unresolved[0];
    if (next) {
      setQueue(previous => [...new Set([...previous, ...unresolved.map(row => row.work_date)])].sort());
      setDecisionDate(next.work_date);
    } else onClose();
  };
  if (decision && canManage && !frozen) return <DecisionModal key={decision.id} row={decision} runId={runId} correction={correcting}
    progress={correcting ? "Correct reviewed payable time" : `${index + 1} of ${queue.length} exceptions`}
    saveLabel={correcting ? 'Save Correction' : actionable.some(row => row.work_date !== decisionDate) ? 'Save & Next' : 'Save & Finish'}
    onPrevious={!correcting && index > 0 ? () => setDecisionDate(queue[index - 1]) : null}
    onNext={() => advance(rows, decisionDate)}
    onClose={onClose}
    onReconciled={async result => {
      const updated = await onDecisionSaved(result);
      if (!Array.isArray(updated)) throw new Error('Reconciled evidence unavailable. Reopen the review.');
      setLatestRows(updated); setCorrecting(false);
    }}
    onSaved={async result => {
      const updated = await onDecisionSaved(result);
      if (!Array.isArray(updated)) throw new Error('Decision recorded. Latest payable-time evidence is unavailable; retry refresh.');
      if (updated.some(row => row.work_date === decisionDate && payrollTimeNeedsReview(row)))
        throw new Error('This date still requires review. Refresh the evidence before continuing.');
      setLatestRows(updated);
      if (correcting) { setDecisionDate(null); setCorrecting(false); } else advance(updated, decisionDate);
    }} />;
  const hourly = employee.pay?.pay_basis === 'hourly';
  const hasPending = exceptions.length > 0 || evidenceIncomplete;
  const earningsAvailable = employee.result.earningsAvailable ?? employee.result.earningsCurrent;
  const metrics = [
    ['Scheduled Hours', recorded('scheduled_minutes'), nonHolidayRows.some(row => row.scheduled_minutes == null) ? 'Some dates have no scheduled hours' : null],
    ['Recorded Clock Hours', recorded('actual_minutes'), longSpans.length
      ? `${hours(sum('actual_minutes', longSpans))} across ${longSpans.length} span${longSpans.length === 1 ? '' : 's'} of 24h or more`
      : 'Elapsed clock-in to clock-out'],
    ['Approved Payable Hours', nonHolidayRows.some(row => row.approved_minutes != null) ? hours(sum('approved_minutes') + sum('approved_extra_minutes')) : '—',
      hasPending ? 'Review or sync pending' : null],
    ['Hourly Rate', rate === '—' ? rate : rates.length > 1 ? rate : `${rate} / hour`, rates.length > 1 ? 'Date-effective rates' : null],
    ['Calculated Regular Earnings', earningsAvailable ? money(regular.reduce((total, line) => total + Number(line.amount), 0)) : 'Pending', null],
  ];
  return <Modal title={`Time & Attendance · ${employee.name}`} description={`${month} · ${frozen ? 'Finalized evidence · Read-only' : 'Review daily evidence and payable time'}`}
    size="3xl" onClose={onClose} footerClassName="flex-wrap max-sm:[&>button]:min-h-11" footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Back to Employee Review</button>
      {canDecide && actionable.length > 0 && <button type="button" className="btn-primary" onClick={() => startReview(actionable[0])}>Continue Review</button>}
    </>}>
    <div className="space-y-3 text-sm">
      {hourly && <dl className="grid grid-cols-2 gap-3 border-b border-border pb-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map(([label, value, detail]) => <div key={label}>
          <dt className="text-xs text-text-secondary">{label}</dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
          {detail && <dd className="text-xs text-text-secondary">{detail}</dd>}
        </div>)}
      </dl>}
      <p className="text-xs text-text-secondary">{frozen ? 'Pinned evidence for this Payroll revision.' : evidenceIncomplete
        ? 'Evidence incomplete. Return to Payroll to reload the affected dates.'
        : `${actionable.length} need review · ${syncRows.length} need sync.`} {hourly && 'Dates in separate PH review are excluded from hour totals. Regular earnings use approved regular hours and effective rates.'}</p>
      {rows.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Time status filter" className="flex flex-wrap gap-1.5">
          {Object.entries(groups).map(([label, items]) => <button type="button" key={label} aria-pressed={filter === label}
            className={`${filter === label ? 'btn-primary' : 'btn-secondary'} btn-sm min-h-11 md:min-h-0`} onClick={() => setFilter(label)}>{label} <span className="tabular-nums">{items.length}</span></button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm min-h-11 min-[701px]:hidden" onClick={toggleDateDirection}>
            Date within status · {dateDirection === 'asc' ? 'Oldest first' : 'Newest first'}
          </button>
          {!frozen && syncRows.length > 0 && onOpenSynchronization && <button type="button" className="btn-secondary btn-sm min-h-11 md:min-h-0" onClick={onOpenSynchronization}>Go to Evidence Sync</button>}
        </div>
      </div>}
      {visibleRows.length ? <DataTable density="compact" columnSpacing="compact" mobileLayout="stack" minWidth={800}
        columns={columns} rows={visibleRows} getRowKey={row => row.id} renderExpandedRow={renderExpandedRow} />
        : <p className="py-6 text-text-secondary">{rows.length ? 'No dates match this filter.' : frozen ? 'No frozen daily time evidence is available for this revision.' : 'No daily time evidence is available for this period.'}</p>}
    </div>
  </Modal>;
}
