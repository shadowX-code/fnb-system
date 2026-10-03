import { useEffect, useState } from 'react';
import AdminFormField from '../../../components/forms/AdminFormField.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import DatePickerField from '../../../components/forms/DatePickerField.jsx';
import ToggleField from '../../../components/forms/ToggleField.jsx';
import { payrollService } from '../../../services/payrollService.js';
import { lindungStatusLabel } from './payrollStatutoryLabels.js';

// Record known evidence. A displayed current status never populates an earlier month.
export default function PayrollLindungSetup({ profile, month, onSaved, disabled = false }) {
  const [read, setRead] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setRead(null); setDraft(null); setError('');
    payrollService.readLindungSetup(profile.id, month).then(result => {
      if (!active) return;
      setRead(result);
      const local = ['malaysia', 'malaysian'].includes(result.employee.nationality?.toLowerCase());
      const joined = result.employee.joined_date;
      setDraft({ status: 'unresolved', worker_category: local ? 'local' : result.employee.nationality ? 'foreign' : 'unresolved',
        date: joined?.slice(0, 7) === month.slice(0, 7) ? joined : month,
        time: '00:00', designated_legal_entity_id: result.employee.dated_legal_entity_id || result.employee.legal_entity_id || '',
        designated_employer_name: '', participation_basis: 'default_enrolment', registration_date: '',
        act4_covered: false, residency_verified: false, before_first_deduction: false,
        not_receiving_lindung_benefit: false, designation_change_reason: '', source_reference: '', reason: '' });
    }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [profile.id, month, refresh]);
  const patch = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const foreign = draft?.worker_category === 'foreign';
  const june = month === '2026-06-01';
  const another = draft?.status === 'another_designated_employer';
  const optOut = draft?.status === 'valid_opt_out';
  const resolved = draft?.status !== 'unresolved';
  const newOptOut = optOut && draft?.date > '2026-08-31';
  const participating = draft?.status === 'participating';
  const rejoin = participating && draft?.participation_basis === 'rejoin';
  const statuses = [
    ...((foreign || june) ? [{ value: 'mandatory', label: 'Mandatory' }] : [
      { value: 'participating', label: 'Participating' }, { value: 'valid_opt_out', label: 'Valid Opt-Out' }]),
    { value: 'another_designated_employer', label: 'Another Designated Employer' },
    { value: 'unresolved', label: 'Unresolved' },
  ];
  const allowed = read && draft?.date && draft.time && draft.source_reference.trim().length >= 8 && draft.reason.trim().length >= 3
    && (!resolved || (draft.act4_covered && draft.worker_category !== 'unresolved'))
    && (draft.worker_category !== 'local_resident' || draft.residency_verified)
    && (!(participating || draft?.status === 'mandatory') || draft.designated_legal_entity_id)
    && (!another || draft.designated_legal_entity_id || draft.designated_employer_name.trim())
    && (!optOut || draft.not_receiving_lindung_benefit)
    && (!newOptOut || (draft.registration_date && draft.before_first_deduction));
  async function save() {
    setBusy(true); setError('');
    const coverage = `${draft.date}T${draft.time}:00+08:00`;
    const intent = { ...draft, effective_month: month, coverage_from: coverage,
      designated_legal_entity_id: another ? draft.designated_legal_entity_id || null : optOut || !resolved ? null : draft.designated_legal_entity_id,
      designated_employer_name: another ? draft.designated_employer_name : null,
      participation_basis: !resolved ? 'unresolved' : optOut ? 'opt_out' : another ? 'employer_designation'
        : draft.status === 'mandatory' ? 'mandatory' : draft.participation_basis,
      first_contribution_month: newOptOut ? month : null, submission_at: rejoin ? coverage : null };
    try {
      const result = await payrollService.confirmLindungSetup({ profileId: profile.id, intent, fingerprint: read.fingerprint, requestId: crypto.randomUUID() });
      setRead(result); await onSaved(); setRefresh(value => value + 1);
    } catch (cause) { setError(cause.message || 'Unable to confirm LINDUNG evidence.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="LINDUNG 24 Jam setup" className="space-y-3 border-t border-border pt-5">
    <h3 className="font-bold">LINDUNG 24 Jam</h3>
    <p className="text-sm text-text-secondary">Separate employee-funded protection. Confirm PERKESO evidence for this contribution month; current setup does not prove an earlier month.</p>
    {june && <p className="text-sm text-amber-700">June 2026 contributions were mandatory. A later local opt-out does not cancel June obligations.</p>}
    {month < '2026-06-01' ? <p className="text-sm">Not Applicable · before the scheme started on 1 June 2026.</p> : <>
      {!draft && !error && <p role="status">Loading LINDUNG evidence…</p>}
      {read && <p className="text-sm">Recorded for this month: <strong>{lindungStatusLabel(read.current.status)}</strong>{read.current.effective_from && ` · evidence from ${read.current.effective_from}`}</p>}
      {draft && <fieldset disabled={busy || disabled} className="space-y-3">
        <SelectField label="Worker coverage" ariaLabel="Worker coverage" value={draft.worker_category} onChange={value => setDraft(current => ({ ...current, worker_category: value, status: 'unresolved' }))}
          options={[{ value: 'local', label: 'Malaysian employee' }, { value: 'local_resident', label: 'Permanent / temporary resident' }, { value: 'foreign', label: 'Foreign employee' }, { value: 'unresolved', label: 'Not verified' }]} />
        <SelectField label="LINDUNG coverage status" ariaLabel="LINDUNG coverage status" value={draft.status} onChange={value => setDraft(current => ({ ...current, status: value,
          designated_legal_entity_id: value === 'another_designated_employer' ? '' : read.employee.dated_legal_entity_id || read.employee.legal_entity_id || '' }))} options={statuses} />
        {resolved && <ToggleField label="Act 4-covered employment verified" helper={foreign ? 'The evidence includes valid passport / work-pass and covered employment.' : 'Confirm the employee is covered under Act 4; ordinary SOCSO settings do not establish this election.'}
          checked={draft.act4_covered} onChange={value => patch('act4_covered', value)} />}
        {draft.worker_category === 'local_resident' && <ToggleField label="Resident status verified" checked={draft.residency_verified} onChange={value => patch('residency_verified', value)} />}
        {participating && <SelectField label="Participation evidence" ariaLabel="Participation evidence" value={draft.participation_basis} onChange={value => patch('participation_basis', value)} options={[
          { value: 'default_enrolment', label: 'Confirmed default enrollment / continuing participation' },
          { value: 'new_registration', label: 'New employee registration' }, { value: 'rejoin', label: 'Rejoined after a recorded opt-out' }]} />}
        <DatePickerField label={rejoin ? 'PERKESO rejoin submission date' : optOut ? 'PERKESO opt-out notice date' : 'Verified effective date'} value={draft.date} onChange={value => patch('date', value)} />
        {rejoin && <AdminFormField label="Submission time (Malaysia)" required><input type="time" className="control" value={draft.time} onChange={event => patch('time', event.target.value)} /></AdminFormField>}
        {rejoin && <p className="text-sm text-text-secondary">Coverage starts at this submission time. The contribution uses the full month's contributable wages, without day proration.</p>}
        {(participating || draft.status === 'mandatory' || another) && <SelectField label="Designated contributing employer" ariaLabel="Designated contributing employer" value={draft.designated_legal_entity_id} onChange={value => patch('designated_legal_entity_id', value)}
          options={[{ value: '', label: another ? 'Employer outside FeedX' : 'Choose contributing employer' }, ...read.legal_entities.filter(entity => !another || entity.id !== (read.employee.dated_legal_entity_id || read.employee.legal_entity_id)).map(entity => ({ value: entity.id, label: entity.name }))]} />}
        {(another || participating || draft.status === 'mandatory') && read.current.evidence?.designated_legal_entity_id &&
          (read.current.evidence.designated_legal_entity_id !== draft.designated_legal_entity_id) && <SelectField label="Reason for changing contributing employer" ariaLabel="Reason for changing contributing employer" value={draft.designation_change_reason} onChange={value => patch('designation_change_reason', value)} options={[
            { value: '', label: 'Choose the verified PERKESO reason' }, { value: 'resignation', label: 'Resigned from previous employer' },
            { value: 'business_ceased', label: 'Previous employer ceased business' }, { value: 'dormant_no_salary', label: 'Previous employment dormant without salary' },
            { value: 'higher_salary', label: 'Higher salary with the new employer' }]} />}
        {another && !draft.designated_legal_entity_id && <AdminFormField label="Other designated employer" required><input className="control" value={draft.designated_employer_name} onChange={event => patch('designated_employer_name', event.target.value)} /></AdminFormField>}
        {optOut && <ToggleField label="Employee is not receiving LINDUNG benefits" checked={draft.not_receiving_lindung_benefit} onChange={value => patch('not_receiving_lindung_benefit', value)} />}
        {newOptOut && <><DatePickerField label="New PERKESO registration date" value={draft.registration_date} onChange={value => patch('registration_date', value)} />
          <ToggleField label="Notice submitted before the first contribution deduction" checked={draft.before_first_deduction} onChange={value => patch('before_first_deduction', value)} /></>}
        {optOut && <p className="text-sm text-text-secondary">Record an existing valid PERKESO notice. FeedX cannot opt an employee out. Continuing participation / rejoin cannot later be cancelled.</p>}
        <AdminFormField label="PERKESO evidence / reference" required><input className="control" value={draft.source_reference} onChange={event => patch('source_reference', event.target.value)} /></AdminFormField>
        <AdminFormField label="Confirmation reason" required><input className="control" value={draft.reason} onChange={event => patch('reason', event.target.value)} /></AdminFormField>
        <button type="button" className="btn-secondary" disabled={!allowed || busy || disabled} onClick={save}>{busy ? 'Confirming…' : 'Confirm LINDUNG Evidence'}</button>
      </fieldset>}
    </>}
    {error && <div role="alert" className="text-sm text-rose-700">{error} <button type="button" className="underline" onClick={() => setRefresh(value => value + 1)} disabled={busy}>Refresh LINDUNG setup</button></div>}
    {read?.history.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">LINDUNG evidence history</summary>
      {read.history.map(row => <p key={row.id} className="mt-2">{row.effective_month} · {lindungStatusLabel(row.status)} · revision {row.revision} · {row.source_reference} · {row.reason}</p>)}</details>}
  </section>;
}
