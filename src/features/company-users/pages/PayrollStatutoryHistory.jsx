import { useEffect, useState } from 'react';
import { payrollService } from '../../../services/payrollService.js';
import { statutoryName, statutorySchemeLabel } from './payrollStatutoryLabels.js';
import { formatOperationalDateTime } from '../../../lib/dateTime.js';

const schemes = ['epf', 'socso', 'eis', 'pcb', 'lindung'];
export function statutoryHistoryDates(ordinary, lindung) {
  const dates = new Set();
  for (const row of [...ordinary.applicability, ...ordinary.categories]) {
    dates.add(row.effective_from);
    if (row.effective_to) {
      const end = new Date(`${row.effective_to}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      dates.add(end.toISOString().slice(0, 10));
    }
  }
  for (const row of lindung) {
    dates.add(row.effective_month);
    // June's local mandatory evidence cannot establish a July election.
    if (row.effective_month === '2026-06-01' && row.status === 'mandatory' && ['local', 'local_resident'].includes(row.worker_category)) dates.add('2026-07-01');
  }
  if ([...dates].some(date => date < '2026-06-01')) dates.add('2026-06-01');
  return [...dates].sort();
}

// Compose existing authorized reads. Never replay statutory resolution in the browser.
export async function readStatutoryHistory(profileId) {
  const [ordinary, lindung] = await Promise.all([
    payrollService.readStatutorySetup(profileId), payrollService.readLindungSetup(profileId),
  ]);
  const dates = statutoryHistoryDates(ordinary.history, lindung.history);
  return Promise.all(dates.map(async date => {
    const [setup, coverage] = await Promise.all([
      payrollService.readStatutorySetup(profileId, date), payrollService.readLindungSetup(profileId, date),
    ]);
    const evidence = [
      ...ordinary.history.applicability.filter(row => row.effective_from === date).map(row => ({ ...row, authority: 'Applicability' })),
      ...ordinary.history.categories.filter(row => row.effective_from === date).map(row => ({ ...row, authority: 'Contribution categories' })),
      ...lindung.history.filter(row => row.effective_month === date).map(row => ({ ...row, authority: 'LINDUNG coverage' })),
    ];
    return { date, schemes: { ...setup.schemes, lindung: coverage.current }, evidence };
  }));
}

export default function PayrollStatutoryHistory({ profileId }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setRows(null); setError('');
    readStatutoryHistory(profileId).then(result => { if (active) setRows(result); })
      .catch(cause => { if (active) setError(cause.message || 'Unable to read statutory history.'); });
    return () => { active = false; };
  }, [open, profileId, attempt]);
  return <details className="border-t border-border pt-3 text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Statutory History</summary>
    {open && <div className="mt-3 space-y-3">
      {!rows && !error && <p role="status">Reading statutory history…</p>}
      {error && <div><p role="alert">{error}</p><button type="button" className="btn-secondary mt-2" onClick={() => setAttempt(value => value + 1)}>Retry history</button></div>}
      {rows?.length === 0 && <p className="text-text-secondary">No statutory revisions recorded.</p>}
      {rows?.length > 0 && <>
        <p className="text-xs text-text-secondary">Coverage resolved at each effective date. Finalized Payroll evidence stays unchanged.</p>
        <ol className="space-y-3">{rows.map(row => <li key={row.date} className="rounded-lg border border-border p-3">
          <h4 className="font-semibold">{row.date}</h4>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">{schemes.map(scheme => <div key={scheme}>
            <dt className="text-xs text-text-secondary">{statutoryName(scheme)}</dt><dd>{statutorySchemeLabel(scheme, row.schemes[scheme])}</dd>
          </div>)}</dl>
          {row.evidence.length > 0 && <details className="mt-2 text-xs text-text-secondary"><summary className="cursor-pointer">Audit details</summary>
            <ul className="mt-2 space-y-2">{row.evidence.map(evidence => <li key={`${evidence.authority}-${evidence.id}`}>
              <span className="font-semibold">{evidence.authority}</span>
              {evidence.status === 'unresolved' && <p>Not Confirmed observation · does not replace verified coverage.</p>}
              {(evidence.reason || evidence.source_reference) && <p>{[evidence.reason, evidence.source_reference].filter(Boolean).join(' · ')}</p>}
              {evidence.created_at && <p>Recorded {formatOperationalDateTime(evidence.created_at)}</p>}
            </li>)}</ul>
          </details>}
        </li>)}</ol>
      </>}
    </div>}
  </details>;
}
