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
  const [validation, setValidation] = useState(null);
  const [required, setRequired] = useState([]);
  useEffect(() => {
    let active = true;
    setRead(null); setDraft(null); setError(''); setValidation(null); setRequired([]);
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
        retain: verified && !result.current.issue, residency_verified: verified && worker === 'local_resident',
        designation_change_reason: '', source_reference: '', participation_basis: 'default_enrolment' });
    }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [profile.id, month, refreshKey]);
  const patch = (key, value) => { setValidation(null); setDraft(current => ({ ...current, retain: false, [key]: value })); };
  const mandatory = draft?.worker_category === 'foreign' || month === '2026-06-01';
  const another = draft?.status === 'another_designated_employer';
  const optOut = draft?.status === 'valid_opt_out';
  const resolved = draft && !['unresolved','not_applicable'].includes(draft.status);
  const participating = draft?.status === 'participating';
  const retained = Boolean(draft?.retain);
  const rejoin = !retained && participating && draft?.participation_basis === 'rejoin';
  const newOptOut = !retained && optOut && draft.date > '2026-08-31';
  const employer = read?.employee.dated_legal_entity_id || read?.employee.legal_entity_id;
  const intent = draft && read ? { ...draft,
    retained_version_id: retained ? read.current.evidence.id : null, effective_month: month,
    coverage_from: optOut || rejoin ? `${draft.date}T${draft.time}:00+08:00` : null,
    submission_at: rejoin ? `${draft.date}T${draft.time}:00+08:00` : null,
    first_contribution_month: newOptOut ? month : null,
    ...(act4Covered ? { act4_covered: true } : {}),
    designated_legal_entity_id: optOut || !resolved ? null : draft.designated_legal_entity_id || null,
    designated_employer_name: another ? draft.designated_employer_name : null } : null;
  const intentKey = JSON.stringify(intent);
  useEffect(() => {
    let active = true;
    setValidation(null);
    if (!intent || month < '2026-06-01') return;
    const timer = setTimeout(() => {
      payrollService.previewLindungSetup(profile.id, month, intent, act4Covered).then(result => {
        if (!active) return;
        setValidation({ ...result, intentKey });
        setRequired(previous => [...new Set([...previous, ...result.fields])]);
      }).catch(cause => { if (active) setError(cause.message); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [profile.id, month, intentKey, act4Covered]);
  const allowed = Boolean(read && draft && !error && validation?.valid && validation.intentKey === intentKey);
  useEffect(() => {
    onChange(intent && read && !error ? { month, allowed, fingerprint: read.fingerprint, intent, current: read.current } : null);
  }, [intentKey, read, error, month, allowed, onChange]);
  const needs = key => required.includes(key);
  const options = [
    ...(mandatory ? [{ value: 'mandatory', label: 'This employer pays' }] : [{ value: 'participating', label: 'Participating' }, { value: 'valid_opt_out', label: 'Opted Out' }, { value: 'not_applicable', label: 'Not Applicable' }]),
    { value: 'another_designated_employer', label: 'Another Employer Pays' }, { value: 'unresolved', label: 'Not Confirmed' },
  ];
  const context = draft?.worker_category === 'local' ? 'Malaysian employee' : draft?.worker_category === 'local_resident' ? 'Verified resident' : draft?.worker_category === 'foreign' ? 'Foreign employee' : 'Worker coverage not verified';
  return <div aria-label="LINDUNG 24 Jam setup" className="py-3">
    {month < '2026-06-01' ? <div className="grid gap-3 sm:grid-cols-[11rem_1fr]"><span className="text-sm font-semibold">LINDUNG 24 Jam</span><p className="text-sm">Not applicable before June 2026.</p></div> : <>
      {!draft && !error && <p role="status">Loading LINDUNG coverage…</p>}
      {draft && <fieldset disabled={disabled} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
          <SelectField label="LINDUNG 24 Jam" ariaLabel="LINDUNG coverage status" value={draft.status} options={options}
            onChange={value => { setRequired([]); setValidation(null); setDraft(current => ({ ...current, retain: value === read.current.status && Boolean(read.current.evidence) && !read.current.issue, status: value,
              participation_basis: value === 'participating' && read.current.status === 'valid_opt_out' ? 'rejoin' : 'default_enrolment',
              designated_legal_entity_id: value === 'another_designated_employer' ? '' : employer || '' })); }} />
          <div className="self-center space-y-1 text-sm text-text-secondary">
            <p>{context}</p>
            {mandatory && <p className="font-semibold text-text-primary">Mandatory · {month === '2026-06-01' ? 'June 2026 coverage' : 'Foreign employee coverage'}</p>}
            {draft.status === 'not_applicable' && <p>No LINDUNG deduction.</p>}
            {draft.status === 'unresolved' && <p>LINDUNG status has not been confirmed for this month.</p>}
            {retained && <p className="text-xs">Verified coverage retained from {read.current.evidence.effective_month}.</p>}
          </div>
        </div>
        <div className="space-y-3 sm:pl-[11.75rem]">
        {resolved && ['foreign','local_resident'].includes(draft.worker_category) && !retained && <details className="text-sm"><summary className="cursor-pointer">Resident coverage evidence</summary>
          <ToggleField label="Verified permanent / temporary resident" checked={draft.residency_verified} onChange={value => setDraft(current => ({ ...current, retain:false, residency_verified:value, worker_category:value?'local_resident':'foreign', status:'unresolved' }))} /></details>}
        {((optOut && !retained) || rejoin) && <DatePickerField label={rejoin ? 'PERKESO rejoin submission date' : 'PERKESO opt-out notice date'} value={draft.date} onChange={value => patch('date', value)} />}
        {rejoin && <AdminFormField label="Submission time (Malaysia)" required><input type="time" className="control" value={draft.time} onChange={event => patch('time', event.target.value)} /></AdminFormField>}
        {((another && !retained) || needs('designated_legal_entity_id')) && <SelectField label="Contributing employer" ariaLabel="Contributing employer" value={draft.designated_legal_entity_id} onChange={value => patch('designated_legal_entity_id', value)}
          options={[{ value: '', label: another ? 'Employer outside FeedX' : 'Choose employer' }, ...read.legal_entities.filter(entity => !another || entity.id !== employer).map(entity => ({ value: entity.id, label: entity.name }))]} />}
        {another && !retained && !draft.designated_legal_entity_id && <AdminFormField label="Other employer name" required><input className="control" value={draft.designated_employer_name} onChange={event => patch('designated_employer_name', event.target.value)} /></AdminFormField>}
        {needs('designation_change_reason') && <SelectField label="Employer change reason" ariaLabel="Employer change reason" value={draft.designation_change_reason} onChange={value => patch('designation_change_reason', value)} options={[
          { value: '', label: 'Choose PERKESO reason' }, { value: 'resignation', label: 'Resignation' }, { value: 'business_ceased', label: 'Business ceased' },
          { value: 'dormant_no_salary', label: 'Dormant employment without salary' }, { value: 'higher_salary', label: 'Higher salary' }]} />}
        {!retained && resolved && <AdminFormField label={needs('source_reference') ? 'Reference / Notes' : 'Reference / Notes (optional)'} required={needs('source_reference')} helper={needs('source_reference') ? 'PERKESO evidence/reference is required for this transition.' : 'Optional'}><input className="control" maxLength={1000} value={draft.source_reference} onChange={event => patch('source_reference', event.target.value)} /></AdminFormField>}
        {required.some(key => ['act4_covered','not_receiving_lindung_benefit','registration_date','before_first_deduction'].includes(key)) && <section aria-label="Additional information required" className="space-y-3 rounded-lg border border-border p-3">
          <h4 className="text-sm font-semibold">Additional information required</h4>
          {needs('act4_covered') && !act4Covered && <ToggleField label="Act 4-covered employment verified" checked={Boolean(draft.act4_covered)} onChange={value => patch('act4_covered',value)} />}
          {needs('not_receiving_lindung_benefit') && <ToggleField label="Employee is not receiving LINDUNG benefits" checked={Boolean(draft.not_receiving_lindung_benefit)} onChange={value => patch('not_receiving_lindung_benefit',value)} />}
          {needs('registration_date') && <DatePickerField label="New PERKESO registration date" value={draft.registration_date || ''} onChange={value => patch('registration_date', value)} />}
          {needs('before_first_deduction') && <ToggleField label="Notice submitted before the first deduction" checked={Boolean(draft.before_first_deduction)} onChange={value => patch('before_first_deduction',value)} />}
        </section>}
        {validation && !validation.valid && <p role="alert" className="text-sm text-rose-700">{validation.message}</p>}
        {!validation && <p role="status" className="text-xs text-text-secondary">Checking coverage…</p>}

        {resolved && draft.worker_category === 'unresolved' && <p role="alert" className="text-sm text-rose-700">Complete employee nationality to verify worker coverage.</p>}
        </div>
      </fieldset>}
    </>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </div>;
}
