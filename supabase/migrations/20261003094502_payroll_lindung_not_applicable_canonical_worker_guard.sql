-- Preserve the direct confirmation endpoint against forged worker/employer intent.
create or replace function public.payroll_lindung_validate_intent(p_profile_id uuid,p_intent jsonb,p_request_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
declare e public.employees%rowtype; prior public.payroll_lindung_participation_versions%rowtype;
 m date:=(p_intent->>'effective_month')::date;t timestamptz:=(p_intent->>'coverage_from')::timestamptz;
 d date:=(t at time zone 'Asia/Kuala_Lumpur')::date; status text:=p_intent->>'status';worker text:=p_intent->>'worker_category';
 entity uuid:=nullif(p_intent->>'designated_legal_entity_id','')::uuid; external_name text:=nullif(btrim(p_intent->>'designated_employer_name'),'');
 basis text:=p_intent->>'participation_basis';registration date:=nullif(p_intent->>'registration_date','')::date;
 reference text:=btrim(p_intent->>'source_reference');reason text:=btrim(p_intent->>'reason');employment_entity uuid;
begin
 perform public.payroll_admin_actor();
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.manage') then raise exception using errcode='42501',message='Payroll LINDUNG setup scope denied.';end if;
 employment_entity:=(public.employee_employment_assignment_at(e.id,d)).legal_entity_id;
 if m is null or m<>date_trunc('month',m)::date or m<'2026-06-01' or t is null
  or date_trunc('month',d)::date<>m or t>clock_timestamp()
  or p_request_id is null or length(coalesce(reference,''))>1000
  or length(coalesce(reason,''))>1000
  or status is null or status not in ('mandatory','participating','valid_opt_out','another_designated_employer','unresolved','not_applicable')
  or worker is null or worker not in ('local','local_resident','foreign','unresolved') then
  raise exception using errcode='22023',message='Confirm the contribution month, coverage status and required transition details.'; end if;
 -- Explicit non-applicability is not an opt-out and requires no participation facts.
 if status='not_applicable' then
  if basis is distinct from 'not_applicable' then raise exception using errcode='22023',message='Confirm explicit LINDUNG Not Applicable for this payroll month.';end if;
  if m='2026-06-01' or (nullif(btrim(e.nationality),'') is not null and lower(btrim(e.nationality)) not in ('malaysia','malaysian')) then raise exception using errcode='22023',message='Mandatory LINDUNG coverage cannot be marked Not Applicable.';end if;
  if entity is not null or external_name is not null then raise exception using errcode='22023',message='Not Applicable does not use a designated contributing employer.';end if;
  if lower(btrim(e.nationality)) in ('malaysia','malaysian') and worker<>'local' then raise exception using errcode='22023',message='Worker category conflicts with canonical employee nationality.';end if;
  return;
 end if;
 if status='valid_opt_out' then
  if exists(select 1 from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id
    and v.coverage_from<=t and v.status='participating'
    and (v.effective_month>='2026-09-01' or v.participation_basis='rejoin')) then
   raise exception using errcode='22023',message='Once In, Always In: this employee cannot opt out after confirmed continuing participation or rejoin.'; end if;
  -- Do not insert an opt-out before an already-confirmed continuing election.
  if exists(select 1 from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id
    and v.coverage_from>t and v.status='participating' and v.participation_basis<>'rejoin') then
   raise exception using errcode='22023',message='Historical opt-out conflicts with later participation evidence. Review the evidence chronology.'; end if;
 end if;
 -- Ordinary confirmation records its actor/month/transition without requiring invented notes.
 if status in ('valid_opt_out','another_designated_employer') or basis='rejoin'
  or nullif(p_intent->>'designation_change_reason','') is not null then
  if length(coalesce(reference,''))<8 then
   raise exception using errcode='22023',message='PERKESO evidence/reference is required for this transition.'; end if;
 end if;
 reference:=coalesce(reference,'');
 reason:=coalesce(nullif(reason,''),'Admin confirmed LINDUNG payroll-month setup');
 if status<>'unresolved' then
  if e.joined_date is null or d<e.joined_date then
   raise exception using errcode='22023',message='Verify Joined Date; LINDUNG evidence cannot precede employment.'; end if;
  if coalesce((p_intent->>'act4_covered')::boolean,false) is not true or worker='unresolved'
   or nullif(btrim(e.nationality),'') is null then
   raise exception using errcode='22023',message='Confirm Act 4-covered employment and worker category using evidence.'; end if;
  if (worker='local' and lower(e.nationality) not in ('malaysia','malaysian'))
   or (worker='foreign' and lower(e.nationality) in ('malaysia','malaysian')) then
   raise exception using errcode='22023',message='Worker category conflicts with canonical employee nationality.'; end if;
  if worker='local_resident' and coalesce((p_intent->>'residency_verified')::boolean,false) is not true then
   raise exception using errcode='22023',message='Permanent/temporary resident evidence is required.'; end if;
 end if;
 if worker='foreign' and status in ('participating','valid_opt_out') then
  raise exception using errcode='22023',message='Foreign workers require Mandatory participation or another designated employer.'; end if;
 if m='2026-06-01' and status not in ('mandatory','another_designated_employer','unresolved') then
  raise exception using errcode='22023',message='June 2026 contributions are mandatory; a later opt-out does not cancel June.'; end if;
 if status='mandatory' and worker in ('local','local_resident') and m<>'2026-06-01' then
  raise exception using errcode='22023',message='Confirm the local employee participation status for July onward.'; end if;
 if status in ('mandatory','participating') and entity is null then
  raise exception using errcode='22023',message='Designated contributing employer is missing.'; end if;
 if entity is not null and not public.payroll_can_manage_entity(entity,'payroll.manage') then
  raise exception using errcode='42501',message='Designated employer is outside Payroll manage scope.'; end if;
 if status='another_designated_employer' and (entity=employment_entity or (entity is null and external_name is null)) then
  raise exception using errcode='22023',message='Identify the other designated contributing employer using PERKESO evidence.'; end if;
 if status in ('mandatory','participating') and entity<>employment_entity then
  raise exception using errcode='22023',message='Use Another Designated Employer when this employer does not remit LINDUNG.'; end if;
 if status='valid_opt_out' then
  if worker not in ('local','local_resident') or d<'2026-07-08' or basis is distinct from 'opt_out' then
   raise exception using errcode='22023',message='A valid local PERKESO opt-out notice is required.'; end if;
  if d>'2026-08-31' and (registration is null or registration<='2026-07-08' or registration>d
   or nullif(p_intent->>'first_contribution_month','')::date is distinct from m or coalesce((p_intent->>'before_first_deduction')::boolean,false) is not true) then
   raise exception using errcode='22023',message='After August, opt-out requires new-registration evidence and notice before the first deduction.'; end if;
  if coalesce((p_intent->>'not_receiving_lindung_benefit')::boolean,false) is not true then
   raise exception using errcode='22023',message='Employees receiving LINDUNG benefits cannot opt out.'; end if;

 end if;
 select * into prior from public.payroll_lindung_participation_versions where profile_id=p_profile_id and coverage_from<=t
 order by effective_month desc,revision desc limit 1;
 if prior.status in ('mandatory','participating','another_designated_employer') and status in ('mandatory','participating','another_designated_employer')
  and (prior.designated_legal_entity_id is distinct from entity or coalesce(prior.designated_employer_name,'') is distinct from coalesce(external_name,''))
  and coalesce(p_intent->>'designation_change_reason','') not in ('resignation','business_ceased','dormant_no_salary','higher_salary') then
  raise exception using errcode='22023',message='Changing the designated employer requires PERKESO evidence of resignation, business cessation, no-salary dormancy or higher salary.'; end if;
 if status='participating' then
  if basis is null or basis not in ('default_enrolment','rejoin','new_registration') then
   raise exception using errcode='22023',message='Confirm default enrollment, new registration or PERKESO rejoin evidence.'; end if;
  if prior.status='valid_opt_out' and basis<>'rejoin' then
   raise exception using errcode='22023',message='Rejoining after opt-out requires the PERKESO submission date/time.'; end if;
  if basis='rejoin' and (prior.status is distinct from 'valid_opt_out' or
    nullif(p_intent->>'submission_at','')::timestamptz is distinct from t) then
   raise exception using errcode='22023',message='Record the prior valid opt-out and the exact PERKESO rejoin submission date/time.'; end if;
 end if;
 if basis is null or basis not in ('mandatory','default_enrolment','rejoin','new_registration','opt_out','employer_designation','unresolved') then
  raise exception using errcode='22023',message='Participation evidence basis is required.'; end if;
 if (status='mandatory' and basis<>'mandatory') or (status='another_designated_employer' and basis<>'employer_designation')
  or (status='unresolved' and basis<>'unresolved') then
  raise exception using errcode='22023',message='Participation evidence basis must match the confirmed status.'; end if;
end $$;
revoke all on function public.payroll_lindung_validate_intent(uuid,jsonb,uuid) from public,anon,authenticated;
