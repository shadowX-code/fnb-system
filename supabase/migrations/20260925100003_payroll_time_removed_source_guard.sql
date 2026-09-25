-- A once-approved day whose Roster/Attendance/Leave source disappears cannot
-- remain silently payable. Retain the original pure source projection and
-- surface a reviewable, versioned source-removed exception instead.
alter function public.payroll_time_evidence(uuid,date) rename to payroll_time_evidence_base;

create or replace function public.payroll_time_evidence(p_employee_id uuid,p_work_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_evidence jsonb; v_latest public.payroll_payable_time_versions%rowtype; v_payload jsonb;
begin
  v_evidence:=public.payroll_time_evidence_base(p_employee_id,p_work_date);
  if v_evidence is not null then return v_evidence; end if;
  select * into v_latest from public.payroll_payable_time_versions
    where employee_id=p_employee_id and work_date=p_work_date
    order by revision desc limit 1;
  if v_latest.id is null then return null; end if;
  v_payload:=jsonb_build_object(
    'employee_id',p_employee_id,'profile_id',v_latest.profile_id,'work_date',p_work_date,
    'compensation_version_id',v_latest.evidence->>'compensation_version_id',
    'pay_basis',v_latest.evidence->>'pay_basis',
    'legal_entity_id',v_latest.evidence->>'legal_entity_id',
    'outlet_id',v_latest.evidence->>'outlet_id',
    'roster_entry_id',null,'roster_publication_id',null,'roster_entry_type',null,
    'scheduled_start_at',null,'scheduled_end_at',null,'roster_break_minutes',null,
    'attendance_id',null,'attendance_count',0,'clock_in_at',null,'clock_out_at',null,
    'leave_id',null,'leave_type',null,'holiday_id',null,
    'scheduled_minutes',null,'actual_minutes',null,'proposed_minutes',null,
    'extra_candidate_minutes',0,'classification','non_payable',
    'issue_codes',jsonb_build_array('source_removed'),
    'calculation_version','payable-time-v1-source-removed');
  return v_payload || jsonb_build_object('source_fingerprint',md5(v_payload::text));
end; $$;

revoke all on function public.payroll_time_evidence_base(uuid,date) from public,anon,authenticated;
revoke all on function public.payroll_time_evidence(uuid,date) from public,anon,authenticated;
