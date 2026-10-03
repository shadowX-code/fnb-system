-- Verified LINDUNG coverage carries forward until a genuine status change.
-- Unresolved is an observation, never a participation transition.
create or replace function public.payroll_lindung_resolve(p_profile_id uuid,p_date date,p_legal_entity_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v public.payroll_lindung_participation_versions%rowtype; e public.employees%rowtype;
 m date:=date_trunc('month',p_date)::date; issue text; applicable boolean; status text; entity uuid;
begin
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 entity:=coalesce(p_legal_entity_id,(public.employee_employment_assignment_at(e.id,greatest(p_date,e.joined_date))).legal_entity_id);
 if m<'2026-06-01' then
  return jsonb_build_object('state','not_applicable','status','before_scheme','applicable',false,'effective_month',m,'issue',null);
 end if;
 select * into v from public.payroll_lindung_participation_versions
 where profile_id=p_profile_id and effective_month<=m and status<>'unresolved' order by effective_month desc,revision desc limit 1;
 status:=coalesce(v.status,'unresolved');
 if v.id is null or status='unresolved' then issue:='lindung_participation_unconfirmed:'||m;
 elsif v.employee_evidence->>'nationality' is distinct from e.nationality then issue:='lindung_employee_evidence_changed';
 elsif v.status='mandatory' and v.worker_category in ('local','local_resident') and m>'2026-06-01' then
  status:='unresolved';issue:='lindung_participation_unconfirmed:'||m; -- June mandatory evidence is not a later local election.
 elsif m='2026-06-01' and status not in ('mandatory','another_designated_employer') then issue:='lindung_june_mandatory_evidence_required';
 elsif status in ('mandatory','participating','another_designated_employer') and
   v.designated_legal_entity_id is null and nullif(btrim(v.designated_employer_name),'') is null then issue:='lindung_designated_employer_missing';
 elsif status in ('mandatory','participating') and v.designated_legal_entity_id is distinct from entity then issue:='lindung_designated_employer_mismatch';
 elsif status='another_designated_employer' and v.designated_legal_entity_id=entity then issue:='lindung_designated_employer_mismatch';
 end if;
 if issue is null and status in ('mandatory','participating') and not exists(select 1 from public.payroll_statutory_schedule_versions pack where pack.scheme='lindung' and pack.effective_from<=m and (pack.effective_to is null or pack.effective_to>=(m+interval '1 month - 1 day')::date)) then issue:='lindung_rate_pack_unavailable'; end if;
 applicable:=case when issue is not null then null else status in ('mandatory','participating') end;
 return jsonb_build_object('state',case when issue is not null then 'setup_required' when applicable then 'confirmed' else 'not_applicable' end,
  'status',status,'applicable',applicable,'category',case when applicable then (select pack.category from public.payroll_statutory_schedule_versions pack where pack.scheme='lindung' and pack.effective_from<=m and (pack.effective_to is null or pack.effective_to>=(m+interval '1 month - 1 day')::date) order by pack.effective_from desc limit 1) else null end,
  'effective_month',m,'effective_from',v.effective_month,'coverage_from',v.coverage_from,
  'issue',issue,'evidence',case when v.id is null then null else to_jsonb(v) end);
end $$;
revoke all on function public.payroll_lindung_resolve(uuid,date,uuid) from public,anon,authenticated;

-- Unconfirmed observations cannot replace valid continuing coverage.
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
 if status='unresolved' and (public.payroll_lindung_resolve(p_profile_id,m)->>'issue') is null
  and (public.payroll_lindung_resolve(p_profile_id,m)->>'status') not in ('unresolved','before_scheme') then
  raise exception using errcode='22023',message='Existing confirmed LINDUNG coverage remains effective. Retain it or record a genuine coverage change.';
 end if;
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
 select * into prior from public.payroll_lindung_participation_versions where profile_id=p_profile_id and coverage_from<=t and status<>'unresolved'
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

create or replace function public.payroll_lindung_setup_read(p_profile_id uuid,p_month date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.employees%rowtype; h jsonb; r jsonb; entities jsonb;
 m date:=date_trunc('month',coalesce(p_month,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date))::date;
begin
 perform public.payroll_admin_actor();
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll LINDUNG view scope denied.'; end if;
 select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('resolution_role',case when v.status='unresolved' then 'unconfirmed_observation' else 'verified_revision' end) order by effective_month desc,revision desc),'[]') into h
 from public.payroll_lindung_participation_versions v where profile_id=p_profile_id;
 r:=public.payroll_lindung_resolve(p_profile_id,m);
 select coalesce(jsonb_agg(jsonb_build_object('id',le.id,'name',le.legal_company_name) order by le.legal_company_name),'[]') into entities
 from public.legal_entities le where public.payroll_can_manage_entity(le.id,'payroll.view') or le.id=e.legal_entity_id;
 return jsonb_build_object('current',r,'history',h,'month',m,'legal_entities',entities,
  'employee',jsonb_build_object('nationality',e.nationality,'joined_date',e.joined_date,'legal_entity_id',e.legal_entity_id,
   'dated_legal_entity_id',(public.employee_employment_assignment_at(e.id,greatest(m,e.joined_date))).legal_entity_id),
  'fingerprint',md5(h::text||jsonb_build_object('nationality',e.nationality,'joined_date',e.joined_date,'legal_entity_id',e.legal_entity_id)::text));
end $$;
revoke all on function public.payroll_lindung_setup_read(uuid,date) from public,anon;
grant execute on function public.payroll_lindung_setup_read(uuid,date) to authenticated;


-- Audited resolution correction only. Original participation rows and Payroll
-- evidence are untouched. A migration actor is identified without impersonating
-- the Admin who originally supplied employment/statutory evidence.
insert into public.audit_logs(action,module,user_name,description,metadata)
select 'payroll_lindung_unresolved_observation_reclassified','payroll','Governed migration',
 'Unconfirmed LINDUNG observation retained as audit evidence; earlier verified coverage continues.',
 jsonb_build_object('migration','20261003101135_payroll_lindung_verified_carry_forward',
  'profile_id',u.profile_id,'observation_version_id',u.id,'observation_month',u.effective_month,
  'governing_version_id',v.id,'governing_effective_month',v.effective_month,'governing_status',v.status,
  'original_actor_employee_id',u.confirmed_by_employee_id,'correction_kind','resolution_only',
  'original_evidence_preserved',true,'finalized_evidence_changed',false)
from public.payroll_lindung_participation_versions u
cross join lateral (select * from public.payroll_lindung_participation_versions v
 where v.profile_id=u.profile_id and v.effective_month<=u.effective_month and v.status<>'unresolved'
 order by v.effective_month desc,v.revision desc limit 1) v
where u.status='unresolved' and v.created_at>u.created_at
 and not exists(select 1 from public.audit_logs a
  where a.action='payroll_lindung_unresolved_observation_reclassified'
   and a.metadata->>'observation_version_id'=u.id::text);
