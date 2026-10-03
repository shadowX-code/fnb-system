-- Unified monthly statutory confirmation. No rates, resolver or evidence backfill.
alter table public.payroll_lindung_participation_versions drop constraint payroll_lindung_participation_versions_source_reference_check;
alter table public.payroll_lindung_participation_versions add constraint payroll_lindung_participation_versions_source_reference_check check(length(btrim(source_reference)) between 0 and 1000);
create or replace function public.payroll_lindung_setup_confirm(p_profile_id uuid,p_intent jsonb,p_fingerprint text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payroll_admin_actor(); e public.employees%rowtype;
 prior public.payroll_lindung_participation_versions%rowtype; retry public.payroll_lindung_participation_versions%rowtype;
 current_read jsonb; m date:=(p_intent->>'effective_month')::date; t timestamptz:=(p_intent->>'coverage_from')::timestamptz;
 d date:=(t at time zone 'Asia/Kuala_Lumpur')::date; status text:=p_intent->>'status'; worker text:=p_intent->>'worker_category';
 entity uuid:=nullif(p_intent->>'designated_legal_entity_id','')::uuid; external_name text:=nullif(btrim(p_intent->>'designated_employer_name'),'');
 basis text:=p_intent->>'participation_basis'; registration date:=nullif(p_intent->>'registration_date','')::date;
 reference text:=btrim(p_intent->>'source_reference'); reason text:=btrim(p_intent->>'reason');
 employment_entity uuid; rev integer; v_id uuid; fingerprint text:=md5(p_intent::text);
begin
 perform 1 from public.payroll_profiles where id=p_profile_id for update;
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.manage') then
  raise exception using errcode='42501',message='Payroll LINDUNG setup scope denied.'; end if;
 select * into retry from public.payroll_lindung_participation_versions where request_id=p_request_id;
 if retry.id is not null then
  if retry.profile_id<>p_profile_id or retry.payload_fingerprint<>fingerprint then
   raise exception using errcode='22023',message='A materially changed LINDUNG confirmation requires a new request.'; end if;
  return public.payroll_lindung_setup_read(p_profile_id,m);
 end if;
 employment_entity:=(public.employee_employment_assignment_at(e.id,d)).legal_entity_id;
 current_read:=public.payroll_lindung_setup_read(p_profile_id,m);
 if current_read->>'fingerprint' is distinct from p_fingerprint then
  raise exception using errcode='PT409',message='LINDUNG information was updated. Refresh setup.'; end if;
 if m is null or m<>date_trunc('month',m)::date or m<'2026-06-01' or t is null
  or date_trunc('month',d)::date<>m or t>clock_timestamp()
  or p_request_id is null or length(coalesce(reference,''))>1000
  or length(coalesce(reason,''))>1000
  or status is null or status not in ('mandatory','participating','valid_opt_out','another_designated_employer','unresolved')
  or worker is null or worker not in ('local','local_resident','foreign','unresolved') then
  raise exception using errcode='22023',message='Confirm the contribution month, coverage status and required transition details.'; end if;
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
  if exists(select 1 from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id
    and v.coverage_from<=t and v.status='participating'
    and (v.effective_month>='2026-09-01' or v.participation_basis='rejoin')) then
   raise exception using errcode='22023',message='Once In, Always In: this employee cannot opt out after confirmed continuing participation or rejoin.'; end if;
  -- Do not insert an opt-out before an already-confirmed continuing election.
  if exists(select 1 from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id
    and v.coverage_from>t and v.status='participating' and v.participation_basis<>'rejoin') then
   raise exception using errcode='22023',message='Historical opt-out conflicts with later participation evidence. Review the evidence chronology.'; end if;
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
 -- Serialize against Finalize; append-only setup never rewrites frozen results.
 perform 1 from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id
 where period.period_end>=m and exists(select 1 from public.payroll_run_profile_snapshots s where s.profile_id=p_profile_id and s.run_id=r.id)
 order by r.id for update of r;
 if exists(select 1 from public.payroll_run_statutory_snapshots s join public.payroll_runs r on r.id=s.run_id
   join public.payroll_periods period on period.id=r.period_id where s.employee_id=e.id and period.period_end>=m
   and not exists(select 1 from public.payroll_runs correction where correction.supersedes_run_id=r.id and correction.status not in ('finalized','paid'))) then
  raise exception using errcode='55000',message='Open a governed Payroll correction before confirming setup affecting finalized periods.'; end if;
 select coalesce(max(revision),0)+1 into rev from public.payroll_lindung_participation_versions where profile_id=p_profile_id and effective_month=m;
 select v.id into v_id from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id and v.effective_month=m order by v.revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_lindung_participation_versions(profile_id,effective_month,coverage_from,status,worker_category,
 designated_legal_entity_id,designated_employer_name,participation_basis,employee_evidence,supporting_evidence,source_reference,reason,
 revision,supersedes_id,request_id,payload_fingerprint,confirmed_by_employee_id)
 values(p_profile_id,m,t,status,worker,entity,external_name,basis,
 jsonb_build_object('nationality',e.nationality,'joined_date',e.joined_date,'legal_entity_id',e.legal_entity_id),p_intent,
 reference,reason,rev,v_id,p_request_id,fingerprint,actor) returning payroll_lindung_participation_versions.id into v_id;
 insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
 values('lindung_participation_confirmed',p_profile_id,actor,reason,jsonb_build_object('participation_version_id',v_id,
 'effective_month',m,'status',status,'coverage_from',t,'designated_legal_entity_id',entity,'source_reference',reference));
 return public.payroll_lindung_setup_read(p_profile_id,m);
end $$;
revoke all on function public.payroll_lindung_setup_confirm(uuid,jsonb,text,uuid) from public,anon;

grant execute on function public.payroll_lindung_setup_confirm(uuid,jsonb,text,uuid) to authenticated;

-- Keep the existing seven-argument authority for compatible initialization callers.
-- The UI uses this overload; both established authorities run in one transaction.
create function public.payroll_statutory_setup_confirm(
 p_profile_id uuid,p_effective_from date,p_applicability jsonb,p_categories jsonb,
 p_fingerprint text,p_source_note text,p_reason text,p_lindung_intent jsonb,
 p_lindung_fingerprint text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.employees%rowtype; intent jsonb; l jsonb; ordinary jsonb; coverage timestamptz;
 worker text; basis text; payload text; retry public.payroll_lindung_participation_versions%rowtype;
begin
 perform public.payroll_admin_actor();
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id for update of p;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.manage') then
  raise exception using errcode='42501',message='Payroll statutory setup scope denied.'; end if;
 if p_effective_from is null or p_effective_from<>date_trunc('month',p_effective_from)::date then
  raise exception using errcode='22023',message='Choose an Effective Payroll Month.'; end if;
 if p_effective_from<'2026-06-01' then
  if p_lindung_intent is not null then raise exception using errcode='22023',message='LINDUNG starts in June 2026.'; end if;
  return public.payroll_statutory_setup_confirm(p_profile_id,p_effective_from,p_applicability,p_categories,p_fingerprint,p_source_note,p_reason);
 end if;
 if p_lindung_intent is null or p_request_id is null then
  raise exception using errcode='22023',message='Choose LINDUNG coverage status, including Not Confirmed if evidence is unavailable.'; end if;
 payload:=md5(jsonb_build_object('month',p_effective_from,'applicability',p_applicability,'categories',p_categories,
  'source',p_source_note,'reason',p_reason,'lindung',p_lindung_intent)::text);
 select * into retry from public.payroll_lindung_participation_versions where request_id=p_request_id;
 if retry.id is not null then
  if retry.profile_id<>p_profile_id or retry.supporting_evidence->>'statutory_setup_payload' is distinct from payload then
   raise exception using errcode='22023',message='A changed statutory confirmation requires a new request.'; end if;
  return public.payroll_statutory_setup_read(p_profile_id,p_effective_from,null)||jsonb_build_object('lindung',public.payroll_lindung_setup_read(p_profile_id,p_effective_from));
 end if;
 l:=public.payroll_lindung_setup_read(p_profile_id,p_effective_from);
 if l->>'fingerprint' is distinct from p_lindung_fingerprint then
  raise exception using errcode='PT409',message='LINDUNG information was updated. Refresh setup.'; end if;
 worker:=case when lower(btrim(e.nationality)) in ('malaysia','malaysian') then 'local'
  when nullif(btrim(e.nationality),'') is null then 'unresolved'
  when p_lindung_intent->>'worker_category'='local_resident' then 'local_resident' else 'foreign' end;
 basis:=case p_lindung_intent->>'status' when 'mandatory' then 'mandatory' when 'valid_opt_out' then 'opt_out'
  when 'another_designated_employer' then 'employer_designation' when 'unresolved' then 'unresolved'
  else coalesce(nullif(p_lindung_intent->>'participation_basis',''),'default_enrolment') end;
 coverage:=case when p_lindung_intent->>'status'='valid_opt_out' or basis='rejoin'
  then nullif(p_lindung_intent->>'coverage_from','')::timestamptz
  else (greatest(p_effective_from,e.joined_date)::timestamp at time zone 'Asia/Kuala_Lumpur') end;
 intent:=p_lindung_intent||jsonb_build_object('effective_month',p_effective_from,'worker_category',worker,
  'coverage_from',coverage,'participation_basis',basis,'statutory_setup_payload',payload);
 if p_lindung_intent->>'status' in ('mandatory','participating') and nullif(p_lindung_intent->>'designated_legal_entity_id','') is null then
  intent:=intent||jsonb_build_object('designated_legal_entity_id',(public.employee_employment_assignment_at(e.id,(coverage at time zone 'Asia/Kuala_Lumpur')::date)).legal_entity_id);
 end if;
 ordinary:=public.payroll_statutory_setup_confirm(p_profile_id,p_effective_from,p_applicability,p_categories,p_fingerprint,p_source_note,p_reason);
 -- Covered ordinary Act 4 evidence may establish worker coverage, never participation.
 if p_applicability->>'socso'='true' and nullif(p_categories->>'socso','') is not null then
  intent:=intent||jsonb_build_object('act4_covered',true);
 end if;
 perform public.payroll_lindung_setup_confirm(p_profile_id,intent,p_lindung_fingerprint,p_request_id);
 return public.payroll_statutory_setup_read(p_profile_id,p_effective_from,null)||jsonb_build_object('lindung',public.payroll_lindung_setup_read(p_profile_id,p_effective_from));
end $$;
revoke all on function public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text,jsonb,text,uuid) from public,anon;
grant execute on function public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text,jsonb,text,uuid) to authenticated;
