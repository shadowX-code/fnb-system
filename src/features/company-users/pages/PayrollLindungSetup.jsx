import { useEffect, useState } from 'react';
import AdminFormField from '../../../components/forms/AdminFormField.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import DatePickerField from '../../../components/forms/DatePickerField.jsx';
import ToggleField from '../../../components/forms/ToggleField.jsx';
import { payrollService } from '../../../services/payrollService.js';
import { lindungStatusLabel } from './payrollStatutoryLabels.js';

export default function PayrollLindungSetup({ profile, month, onChange, act4Covered = false, disabled = false, refreshKey = 0 }) {
  const [read, setRead] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setRead(null); setDraft(null); setError('');
    payrollService.readLindungSetup(profile.id, month).then(result => {
      if (!active) return;
      setRead(result);
      const evidence = result.current.evidence;
      const verified = evidence?.effective_month <= month;
      const local = ['malaysia', 'malaysian'].includes(result.employee.nationality?.trim().toLowerCase());
      const worker = local ? 'local' : result.employee.nationality ? (verified && evidence.worker_category === 'local_resident' ? 'local_resident' : 'foreign') : 'unresolved';
      setDraft({ status: verified ? result.current.status : worker === 'foreign' || month === '2026-06-01' ? 'mandatory' : 'unresolved',
        worker_category: worker, date: month, time: '00:00',
        designated_legal_entity_id: verified ? evidence.designated_legal_entity_id || '' : result.employee.dated_legal_entity_id || result.employee.legal_entity_id || '',
        designated_employer_name: verified ? evidence.designated_employer_name || '' : '',
        act4_covered: verified && Boolean(evidence.supporting_evidence?.act4_covered), retain: verified && !result.current.issue, residency_verified: verified && worker === 'local_resident',
        registration_date: '', before_first_deduction: false, not_receiving_lindung_benefit: false,
        designation_change_reason: '', source_reference: '', participation_basis: 'default_enrolment' });
    }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [profile.id, month, refreshKey]);
  const patch = (key, value) => setDraft(current => ({ ...current, retain: false, [key]: value }));
  const mandatory = draft?.worker_category === 'foreign' || month === '2026-06-01';
  const another = draft?.status === 'another_designated_employer';
  const optOut = draft?.status === 'valid_opt_out';
  const resolved = draft && draft.status !== 'unresolved';
  const participating = draft?.status === 'participating';
  const retained = Boolean(draft?.retain);
  const rejoin = !retained && participating && draft?.participation_basis === 'rejoin';
  const newOptOut = !retained && optOut && draft.date > '2026-08-31';
  const employer = read?.employee.dated_legal_entity_id || read?.employee.legal_entity_id;
  const employerMissing = (participating || draft?.status === 'mandatory') && !draft.designated_legal_entity_id;
  const designationChange = read?.current.evidence?.designated_legal_entity_id && (another || participating || draft?.status === 'mandatory')
    && read.current.evidence.designated_legal_entity_id !== draft.designated_legal_entity_id;
  const evidenceRequired = !retained && (optOut || rejoin || another || Boolean(designationChange));
  const allowed = Boolean(read && draft && !error && (!resolved || (draft.worker_category !== 'unresolved' && (act4Covered || draft.act4_covered)))
    && !employerMissing && (!another || draft.designated_legal_entity_id || draft.designated_employer_name.trim())
    && (retained || !optOut || (draft.date >= '2026-07-08' && draft.not_receiving_lindung_benefit))
    && (!rejoin || (draft.date && draft.time))
    && (!newOptOut || (draft.registration_date && draft.before_first_deduction))
    && (!designationChange || draft.designation_change_reason)
    && (!evidenceRequired || draft.source_reference.trim().length >= 8));
  useEffect(() => {
    if (!draft || !read || error) { onChange(null); return; }
    const coverage = `${draft.date}T${draft.time}:00+08:00`;
    onChange({ month, allowed, fingerprint: read.fingerprint, intent: { ...draft,
      retained_version_id: retained ? read.current.evidence.id : null, effective_month: month, coverage_from: optOut || rejoin ? coverage : null,
      submission_at: rejoin ? coverage : null, first_contribution_month: newOptOut ? month : null,
      act4_covered: act4Covered || draft.act4_covered,
      designated_legal_entity_id: optOut || !resolved ? null : draft.designated_legal_entity_id || null,
      designated_employer_name: another ? draft.designated_employer_name : null } });
  }, [draft, read, error, month, allowed, onChange, act4Covered, optOut, rejoin, newOptOut, another, resolved, retained]);
  const options = [
    ...(mandatory ? [{ value: 'mandatory', label: 'Mandatory' }] : [{ value: 'participating', label: 'Participating' }, { value: 'valid_opt_out', label: 'Opted Out' }]),
    { value: 'another_designated_employer', label: 'Another Employer Pays' }, { value: 'unresolved', label: 'Not Confirmed' },
  ];
  return <section aria-label="LINDUNG 24 Jam setup" className="space-y-3 border-t border-border pt-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold">LINDUNG 24 Jam</h3>
      {draft && <span className="text-sm text-text-secondary">{draft.worker_category === 'local' ? 'Malaysian employee' : draft.worker_category === 'local_resident' ? 'Verified resident' : draft.worker_category === 'foreign' ? 'Foreign employee' : 'Worker coverage not verified'}</span>}</div>
    {month < '2026-06-01' ? <p className="text-sm">Not applicable before June 2026.</p> : <>
      {!draft && !error && <p role="status">Loading coverage…</p>}
      {draft && <fieldset disabled={disabled} className="space-y-3">
        <SelectField label="Coverage status" ariaLabel="LINDUNG coverage status" value={draft.status} options={options}
          onChange={value => setDraft(current => ({ ...current, retain: value === read.current.status && Boolean(read.current.evidence) && !read.current.issue, status: value,
            participation_basis: value === 'participating' && read.current.status === 'valid_opt_out' ? 'rejoin' : 'default_enrolment',
            designated_legal_entity_id: value === 'another_designated_employer' ? '' : employer || '' }))} />
        {mandatory && <p className="text-sm text-text-secondary">{month === '2026-06-01' ? 'June 2026 participation is mandatory.' : 'Foreign employees require mandatory coverage.'}</p>}
        {read && <p className="text-xs text-text-secondary">Recorded: {lindungStatusLabel(read.current.status)} · This confirmation applies to the selected payroll month.</p>}
        {['foreign','local_resident'].includes(draft.worker_category) && !retained && <details className="text-sm"><summary className="cursor-pointer">Resident coverage evidence</summary>
          <ToggleField label="Verified permanent / temporary resident" checked={draft.residency_verified} onChange={value => setDraft(current => ({ ...current, retain:false, residency_verified:value, worker_category:value?'local_resident':'foreign', status:'unresolved' }))} /></details>}
        {resolved && !act4Covered && <ToggleField label="Act 4-covered employment verified" checked={draft.act4_covered} onChange={value => patch('act4_covered', value)} />}
        {participating && !retained && <details className="text-sm"><summary className="cursor-pointer">Participation transition</summary>
          <SelectField label="Participation evidence" ariaLabel="Participation evidence" value={draft.participation_basis} onChange={value => patch('participation_basis', value)} options={[
            { value: 'default_enrolment', label: 'Continuing / default enrollment' }, { value: 'new_registration', label: 'New registration' }, { value: 'rejoin', label: 'Rejoin after opt-out' }]} /></details>}
        {((optOut && !retained) || rejoin) && <DatePickerField label={rejoin ? 'PERKESO rejoin submission date' : 'PERKESO opt-out notice date'} value={draft.date} onChange={value => patch('date', value)} />}
        {rejoin && <AdminFormField label="Submission time (Malaysia)" required><input type="time" className="control" value={draft.time} onChange={event => patch('time', event.target.value)} /></AdminFormField>}
        {((another && !retained) || employerMissing) && <SelectField label="Contributing employer" ariaLabel="Contributing employer" value={draft.designated_legal_entity_id} onChange={value => patch('designated_legal_entity_id', value)}
          options={[{ value: '', label: another ? 'Employer outside FeedX' : 'Choose employer' }, ...read.legal_entities.filter(entity => !another || entity.id !== employer).map(entity => ({ value: entity.id, label: entity.name }))]} />}
        {another && !retained && !draft.designated_legal_entity_id && <AdminFormField label="Other employer name" required><input className="control" value={draft.designated_employer_name} onChange={event => patch('designated_employer_name', event.target.value)} /></AdminFormField>}
        {designationChange && <SelectField label="Employer change reason" ariaLabel="Employer change reason" value={draft.designation_change_reason} onChange={value => patch('designation_change_reason', value)} options={[
          { value: '', label: 'Choose PERKESO reason' }, { value: 'resignation', label: 'Resignation' }, { value: 'business_ceased', label: 'Business ceased' },
          { value: 'dormant_no_salary', label: 'Dormant employment without salary' }, { value: 'higher_salary', label: 'Higher salary' }]} />}
        {optOut && !retained && <ToggleField label="Employee is not receiving LINDUNG benefits" checked={draft.not_receiving_lindung_benefit} onChange={value => patch('not_receiving_lindung_benefit', value)} />}
        {newOptOut && <><DatePickerField label="New PERKESO registration date" value={draft.registration_date} onChange={value => patch('registration_date', value)} />
          <ToggleField label="Notice submitted before the first deduction" checked={draft.before_first_deduction} onChange={value => patch('before_first_deduction', value)} /></>}
        {optOut && <p className="text-xs text-text-secondary">Record a valid PERKESO notice. Confirmed continuing participation or rejoin cannot be cancelled.</p>}
        {!retained && <AdminFormField label={evidenceRequired ? 'PERKESO evidence / reference' : 'Reference / Notes (optional)'} required={evidenceRequired}><input className="control" maxLength={1000} value={draft.source_reference} onChange={event => patch('source_reference', event.target.value)} /></AdminFormField>}
        {retained && <p className="text-xs text-text-secondary">Existing verified coverage will be retained. Choose a different status to record a change.</p>}
        {employerMissing && <p role="alert" className="text-sm text-rose-700">Designated contributing employer is missing.</p>}
        {resolved && draft.worker_category === 'unresolved' && <p role="alert" className="text-sm text-rose-700">Complete employee nationality to verify worker coverage.</p>}
      </fieldset>}
    </>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {read?.history.length > 0 && <details className="text-sm"><summary className="cursor-pointer">LINDUNG history</summary>
      {read.history.map(row => <p key={row.id} className="mt-2">{row.effective_month} · {lindungStatusLabel(row.status)} · revision {row.revision}{row.source_reference && ` · ${row.source_reference}`}</p>)}</details>}
  </section>;
}
