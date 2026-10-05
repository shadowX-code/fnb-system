import { canonicalPathForRoute } from '../../../app/routeOwnership.js';
import { useState } from 'react';
import Modal from '../../../components/feedback/Modal.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { payrollTimeNeedsReview } from './payrollRunPresentation.js';
import { DecisionModal } from './PayrollTimeExceptionsTab.jsx';

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

export default function PayrollPayableTimeReview({ employee, month, canManage, canViewLeave = false, frozen = false, onClose, onDecisionSaved, runId }) {
  const [decisionDate, setDecisionDate] = useState(null);
  const [correcting, setCorrecting] = useState(false);
  const [queue, setQueue] = useState([]);
  const [latestRows, setLatestRows] = useState(null);
  const startReview = row => {
    setCorrecting(false);
    setLatestRows(rows);
    setQueue(exceptions.map(item => item.work_date));
    setDecisionDate(row.work_date);
  };
  const rows = [...(latestRows || employee.time)].sort((a,b) => Number(payrollTimeNeedsReview(b)) - Number(payrollTimeNeedsReview(a)) || a.work_date.localeCompare(b.work_date));
  const exceptions = rows.filter(row => payrollTimeNeedsReview(row));
  const sum = key => rows.filter(row => row.review_state?.state !== 'ph_review').reduce((total,row) => total + Number(row[key] || 0), 0);
  const total = key => `${hours(sum(key))}${rows.some(row=>row[key] == null) ? ' · incomplete' : ''}`;
  const regular = (employee.calculation?.lines || []).filter(line => line.kind === 'earning' && line.code === 'regular');
  const rates = [...new Set(regular.map(line => Number(line.rate_per_minute) * 60).filter(Number.isFinite).map(rate => money(rate)))];
  const rate = rates.length ? rates.join(' / ') : employee.pay?.hourly_rate != null ? money(employee.pay.hourly_rate) : '—';
  const columns = [
    { key:'date',header:'Date',render:row => <span className="whitespace-nowrap">{row.work_date}</span> },
    { key:'roster',header:'Duty Roster',render:row => <div>{interval(row.evidence?.scheduled_start_at,row.evidence?.scheduled_end_at)}
      <small className="block text-text-secondary">{hours(row.scheduled_minutes)} payable · {row.evidence?.roster_break_minutes == null ? 'Break not established' : `${row.evidence.roster_break_minutes}m unpaid break`}</small></div> },
    { key:'clock',header:'Clock In–Out',render:row => interval(row.evidence?.clock_in_at,row.evidence?.clock_out_at) },
    { key:'leave',header:'Leave',render:row => <div>{row.evidence?.leave_id ? `Approved ${human(row.evidence.leave_type)} Leave` : 'No approved Leave'}{row.evidence?.leave_id && <small className="block text-text-secondary">Leave-owned evidence{canManage && canViewLeave && <a className="mt-1 block font-semibold text-primary" href={canonicalPathForRoute('crew_leave')} target="_blank" rel="noopener noreferrer">View in Leave</a>}</small>}</div> },
    { key:'actual',header:'Actual',align:'right',render:row => <span className="whitespace-nowrap tabular-nums">{hours(row.actual_minutes)}</span> },
    { key:'difference',header:'Difference',render:row => <div className="max-w-44">{row.issue_codes?.length ? row.issue_codes.map(issue => differences[issue] || human(issue)).join(' · ') : 'No discrepancy'}
      {Number(row.evidence?.extra_candidate_minutes) > 0 && <small className="block text-text-secondary">Extra candidate {hours(row.evidence.extra_candidate_minutes)}</small>}
      {Number(row.approved_extra_minutes) > 0 && <small className="block text-text-secondary">Approved OT {hours(row.approved_extra_minutes)}</small>}</div> },
    { key:'payable',header:'Payable',align:'right',render:row => <div className="whitespace-nowrap tabular-nums"><strong>{row.approved_minutes == null ? row.review_state?.automatic ? 'Monthly salary / Leave rules' : 'Awaiting review' : hours(Number(row.approved_minutes) + Number(row.approved_extra_minutes || 0))}</strong>
      <small className="block text-text-secondary">Proposed {hours(row.proposed_minutes)}</small><small className="block text-text-secondary">{human(row.classification)}</small></div> },
    { key:'status',header:'Status',render:row => <div><Badge tone={payrollTimeNeedsReview(row) ? 'warning' : 'success'}>{payrollTimeNeedsReview(row) && row.source_state?.updated ? 'Source Updated' : payrollTimeNeedsReview(row) ? 'Review Required' : row.review_state?.automatic || row.status === 'approved_auto' ? 'Resolved automatically' : human(row.status)}</Badge>
      {canManage && !frozen && (payrollTimeNeedsReview(row)) && <button type="button" className="mt-1 block font-semibold text-primary" onClick={()=>startReview(row)}>{row.source_state?.updated ? 'Review source changes' : 'Review exception'}</button>}
      {row.review_state?.state === 'ph_review' && <small className="mt-1 block text-text-secondary">PH treatment is separate in Employee Review.</small>}
      {canManage && !frozen && row.review_state?.state !== 'ph_review' && !payrollTimeNeedsReview(row) && !row.evidence?.leave_id && <button type="button" className="mt-1 block font-semibold text-primary" onClick={() => { setCorrecting(true); setLatestRows(rows); setDecisionDate(row.work_date); }}>{row.status === 'review_required' ? 'Adjust Payable Time' : 'Correct Decision'}</button>}
      {!!row.history?.length && <details className="mt-1 text-xs text-text-secondary"><summary>Evidence / history</summary>{row.history.map(version => <p key={version.id} className="mt-1">{human(version.status)} · {hours(version.approved_minutes)}{version.reason ? ` · ${version.reason}` : ''}{version.at ? ` · ${new Date(version.at).toLocaleString()}` : ''}</p>)}</details>}</div> },
  ];
  const decision = rows.find(row => row.work_date === decisionDate);
  const index = queue.indexOf(decisionDate);
  const advance = (updated, savedDate) => {
    const unresolved = updated.filter(row => payrollTimeNeedsReview(row)).sort((a, b) => a.work_date.localeCompare(b.work_date));
    const next = unresolved.find(row => row.work_date > savedDate) || unresolved[0];
    if (next) {
      setQueue(previous => [...new Set([...previous, ...unresolved.map(row => row.work_date)])].sort());
      setDecisionDate(next.work_date);
    } else onClose();
  };
  if (decision && canManage && !frozen) return <DecisionModal key={decision.id} row={decision} runId={runId} correction={correcting}
    progress={correcting ? "Correct reviewed payable time" : `${index + 1} of ${queue.length} exceptions`}
    saveLabel={correcting ? 'Save Correction' : exceptions.some(row => row.work_date !== decisionDate) ? 'Save & Next' : 'Save & Finish'}
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
  return <Modal title={`Time & Attendance · ${employee.name}`} description={`${month} · ${frozen ? "Finalized evidence · Read-only; changes require a Correction Revision." : "Roster, clock and approved Leave evidence. Corrections retain the original evidence."}`}
    size="xl" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Back to Employee Review</button>{canManage && !frozen && exceptions.length > 0 && <button type="button" className="btn-primary" onClick={() => startReview(exceptions[0])}>Continue Review</button>}</>}>
    <div className="space-y-4 text-sm">
      {employee.pay?.pay_basis === 'hourly' && <dl className="grid grid-cols-2 gap-3 border-b border-border pb-4 lg:grid-cols-5">
        {[["Scheduled Hours",total('scheduled_minutes')],["Actual Hours",total('actual_minutes')],
          ["Approved Payable Hours",`${hours(sum('approved_minutes') + sum('approved_extra_minutes'))}${exceptions.length ? ' · review pending' : ''}`],
          ["Hourly Rate",employee.pay?.pay_basis === 'hourly' ? `${rate}${rates.length > 1 ? ' · Date-effective rates' : ' / hour'}` : 'Monthly pay rules'],
          ["Calculated Regular Earnings",employee.pay?.pay_basis !== 'hourly' ? 'Included in monthly salary' : (employee.result.earningsAvailable ?? employee.result.earningsCurrent) ? money(regular.reduce((total,line)=>total+Number(line.amount),0)) : 'Pending calculation']].map(([label,value])=>
          <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 font-bold tabular-nums">{value}</dd></div>)}
      </dl>}
      <p className="text-xs text-text-secondary">{frozen ? "Pinned time evidence only; current Roster, Attendance and Leave are not read." : exceptions.length ? `${exceptions.length} pay-impacting exception${exceptions.length === 1 ? '' : 's'} require review.` : "Time & Attendance — Ready. Complete evidence requires no approval."} Public Holiday treatment is reviewed separately.</p>
      {canManage && !frozen && <p className="text-xs text-text-secondary">Use Adjust Payable Time / Correct Decision only for a genuine Payroll treatment correction. Approved Leave must be corrected through Leave; Payroll cannot create or change a Leave record.</p>}
      {employee.pay?.pay_basis === 'hourly' && <p className="text-xs text-text-secondary">Hour totals exclude PH; its treatment is separate. Regular earnings use approved Regular hours and date-effective rates with canonical per-day rounding—not raw clock duration. OT, rest-day and public-holiday work use separate approved classifications and existing pay rules.</p>}
      {rows.length ? <DataTable density="compact" columns={columns} rows={rows} getRowKey={row=>row.id} /> : <p className="py-6 text-text-secondary">{frozen ? "No frozen daily time evidence is available for this revision." : "No recorded daily time evidence. Reconcile source evidence in Prepare Payroll when required."}</p>}
    </div>
  </Modal>;
}
