import { useState } from 'react';
import Modal from '../../../components/feedback/Modal.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
import Badge from '../../../components/ui/Badge.jsx';
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

export default function PayrollPayableTimeReview({ employee, month, canManage, onClose, onDecisionSaved }) {
  const [decision, setDecision] = useState(null);
  const rows = [...employee.time].sort((a,b) => Number(b.status === 'review_required') - Number(a.status === 'review_required') || a.work_date.localeCompare(b.work_date));
  const exceptions = rows.filter(row => row.status === 'review_required');
  const sum = key => rows.reduce((total,row) => total + Number(row[key] || 0), 0);
  const total = key => `${hours(sum(key))}${rows.some(row=>row[key] == null) ? ' · incomplete' : ''}`;
  const regular = (employee.calculation?.lines || []).filter(line => line.kind === 'earning' && line.code === 'regular');
  const rates = [...new Set(regular.map(line => Number(line.rate_per_minute) * 60).filter(Number.isFinite).map(rate => money(rate)))];
  const rate = rates.length ? rates.join(' / ') : employee.pay?.hourly_rate != null ? money(employee.pay.hourly_rate) : '—';
  const columns = [
    { key:'date',header:'Date',render:row => <span className="whitespace-nowrap">{row.work_date}</span> },
    { key:'roster',header:'Duty Roster',render:row => <div>{interval(row.evidence?.scheduled_start_at,row.evidence?.scheduled_end_at)}
      <small className="block text-text-secondary">{hours(row.scheduled_minutes)} payable · {row.evidence?.roster_break_minutes == null ? 'Break not established' : `${row.evidence.roster_break_minutes}m unpaid break`}</small></div> },
    { key:'clock',header:'Clock In–Out',render:row => interval(row.evidence?.clock_in_at,row.evidence?.clock_out_at) },
    { key:'actual',header:'Actual',align:'right',render:row => <span className="whitespace-nowrap tabular-nums">{hours(row.actual_minutes)}</span> },
    { key:'difference',header:'Difference',render:row => <div className="max-w-44">{row.issue_codes?.length ? row.issue_codes.map(issue => differences[issue] || human(issue)).join(' · ') : 'No discrepancy'}
      {Number(row.evidence?.extra_candidate_minutes) > 0 && <small className="block text-text-secondary">Extra candidate {hours(row.evidence.extra_candidate_minutes)}</small>}
      {Number(row.approved_extra_minutes) > 0 && <small className="block text-text-secondary">Approved OT {hours(row.approved_extra_minutes)}</small>}</div> },
    { key:'payable',header:'Payable',align:'right',render:row => <div className="whitespace-nowrap tabular-nums"><strong>{row.approved_minutes == null ? 'Awaiting review' : hours(Number(row.approved_minutes) + Number(row.approved_extra_minutes || 0))}</strong>
      <small className="block text-text-secondary">Proposed {hours(row.proposed_minutes)}</small><small className="block text-text-secondary">{human(row.classification)}</small></div> },
    { key:'status',header:'Status',render:row => <div><Badge tone={row.status === 'review_required' ? 'warning' : 'success'}>{row.status === 'review_required' ? 'Review Required' : row.status === 'approved_auto' ? 'Approved automatically' : human(row.status)}</Badge>
      {canManage && row.status === 'review_required' && <button type="button" className="mt-1 block font-semibold text-primary" onClick={()=>setDecision(row)}>Review exception</button>}
      {!!row.history?.length && <details className="mt-1 text-xs text-text-secondary"><summary>Evidence / history</summary>{row.history.map(version => <p key={version.id} className="mt-1">{human(version.status)} · {hours(version.approved_minutes)}{version.reason ? ` · ${version.reason}` : ''}{version.at ? ` · ${new Date(version.at).toLocaleString()}` : ''}</p>)}</details>}</div> },
  ];
  if (decision) return <DecisionModal row={decision} onClose={()=>setDecision(null)} onSaved={onDecisionSaved} />;
  return <Modal title={`Payable Time Review · ${employee.name}`} description={`${month} · Published roster and original clock evidence. Only Payroll payable time can be changed.`}
    size="xl" onClose={onClose} footer={<button type="button" className="btn-secondary" onClick={onClose}>Back to Employee Review</button>}>
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3 border-b border-border pb-4 lg:grid-cols-5">
        {[["Scheduled Hours",total('scheduled_minutes')],["Actual Hours",total('actual_minutes')],
          ["Approved Payable Hours",`${hours(sum('approved_minutes') + sum('approved_extra_minutes'))}${exceptions.length ? ' · review pending' : ''}`],
          ["Hourly Rate",employee.pay?.pay_basis === 'hourly' ? `${rate}${rates.length > 1 ? ' · Date-effective rates' : ' / hour'}` : 'Monthly pay rules'],
          ["Calculated Regular Earnings",employee.pay?.pay_basis !== 'hourly' ? 'Included in monthly salary' : employee.result.earningsCurrent ? money(regular.reduce((total,line)=>total+Number(line.amount),0)) : 'Pending calculation']].map(([label,value])=>
          <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 font-bold tabular-nums">{value}</dd></div>)}
      </dl>
      <p className="text-xs text-text-secondary">Totals cover recorded time results; missing durations are not assumed. {exceptions.length} exception{exceptions.length === 1 ? '' : 's'} require review. Clean days are approved automatically.</p>
      <p className="text-xs text-text-secondary">Regular earnings use approved Regular hours and date-effective rates with canonical per-day rounding—not raw clock duration. OT, rest-day and public-holiday work use separate approved classifications and existing pay rules.</p>
      {rows.length ? <DataTable density="compact" columns={columns} rows={rows} getRowKey={row=>row.id} /> : <p className="py-6 text-text-secondary">No payable-time results yet. Use Refresh time evidence in Prepare Payroll to reconcile the published roster and Attendance.</p>}
    </div>
  </Modal>;
}
