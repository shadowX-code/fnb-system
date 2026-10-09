-- Do not attribute a prior opt-out/participation reference to a new non-applicability assertion.
create or replace function public.payroll_lindung_normalize_intent(p_profile_id uuid,p_month date,p_intent jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.employees%rowtype;worker text;basis text;coverage timestamptz;intent jsonb;recorded jsonb;
begin
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 worker:=case when lower(btrim(e.nationality)) in ('malaysia','malaysian') then 'local'
  when nullif(btrim(e.nationality),'') is null then 'unresolved'
  when p_intent->>'worker_category'='local_resident' then 'local_resident' else 'foreign' end;
 basis:=case p_intent->>'status' when 'mandatory' then 'mandatory' when 'valid_opt_out' then 'opt_out'
  when 'another_designated_employer' then 'employer_designation' when 'unresolved' then 'unresolved' when 'not_applicable' then 'not_applicable'
  else coalesce(nullif(p_intent->>'participation_basis',''),'default_enrolment') end;
 coverage:=case when p_intent->>'status'='valid_opt_out' or basis='rejoin'
  then nullif(p_intent->>'coverage_from','')::timestamptz
  else (greatest(p_month,e.joined_date)::timestamp at time zone 'Asia/Kuala_Lumpur') end;
 intent:=p_intent||jsonb_build_object('effective_month',p_month,'worker_category',worker,
  'coverage_from',coverage,'participation_basis',basis,'statutory_setup_payload',p_intent->>'statutory_setup_payload');
 if p_intent->>'status' in ('mandatory','participating') and nullif(p_intent->>'designated_legal_entity_id','') is null then
  intent:=intent||jsonb_build_object('designated_legal_entity_id',(public.employee_employment_assignment_at(e.id,(coverage at time zone 'Asia/Kuala_Lumpur')::date)).legal_entity_id);
 end if;

 -- Reuse applicable recorded supporting facts only; later evidence cannot prove earlier months.
 recorded:=public.payroll_lindung_setup_read(p_profile_id,p_month)->'current'->'evidence';
 if recorded->>'effective_month'<=p_month::text then
  intent:=coalesce(recorded->'supporting_evidence','{}')||intent;
 end if;
 if p_intent->>'status'='not_applicable' then
  intent:=intent - array['registration_date','before_first_deduction','not_receiving_lindung_benefit','designation_change_reason','submission_at','residency_verified','act4_covered'] || jsonb_build_object('participation_basis','not_applicable','designated_legal_entity_id',null,'designated_employer_name',null,'source_reference',coalesce(p_intent->>'source_reference',''),'reason',nullif(p_intent->>'reason',''));
 end if;
 return intent;
end $$;
revoke all on function public.payroll_lindung_normalize_intent(uuid,date,jsonb) from public,anon,authenticated;
