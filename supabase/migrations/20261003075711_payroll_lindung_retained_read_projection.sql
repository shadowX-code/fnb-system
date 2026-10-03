-- Retain current resolver-verified participation without inventing a later notice.
create or replace function public.payroll_statutory_setup_confirm(
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
 -- An existing resolver-selected revision may be retained, never a later revision or client-selected history.
 if nullif(p_lindung_intent->>'retained_version_id','') is not null then
  if l->'current'->'evidence'->>'id' is distinct from p_lindung_intent->>'retained_version_id'
   or l->'current'->>'issue' is not null or l->'current'->>'status' is distinct from p_lindung_intent->>'status' then
   raise exception using errcode='PT409',message='Recorded LINDUNG coverage changed. Refresh setup.'; end if;
  ordinary:=public.payroll_statutory_setup_confirm(p_profile_id,p_effective_from,p_applicability,p_categories,p_fingerprint,p_source_note,p_reason);
  return public.payroll_statutory_setup_read(p_profile_id,p_effective_from,null)||jsonb_build_object('lindung',l);
 end if;
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
