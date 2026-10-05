-- Company PH remuneration is separate from genuine OT. Rates and employee
-- applicability remain owned by their existing statutory authorities.
-- KWSP FAQ Q21: holiday work wages are contributable unless attendance is OT.
-- https://www.kwsp.gov.my/en/employer/responsibilities/option-contribute
create or replace function public.payroll_company_ph_statutory_treatment(p_scheme text)
returns text language sql immutable set search_path=public as $$
 select case when p_scheme in ('epf','socso','lindung','eis','pcb') then 'included' else 'undetermined' end
$$;
revoke all on function public.payroll_company_ph_statutory_treatment(text) from public,anon,authenticated;

do $$
declare definition text; old_mapping text; new_mapping text;
begin
 definition:=pg_get_functiondef('public.payroll_statutory_project_pre_epf_oct2025(uuid,uuid)'::regprocedure);
 old_mapping:=$anchor$elsif v_line#>>'{source,formula_version}' in ('my_ph_2023_v1','ph_occurrence_override_v1') and v_line->>'code' in ('public_holiday','public_holiday_ot','company_ph_benefit') then
  v_treatment:=v_line#>>array['source','statutory_treatments',v_scheme];
 
 elsif v_line->>'code'='company_ph_benefit' then
  v_treatment:=case when v_scheme='epf' then 'excluded' when v_scheme in ('socso','eis') then 'included' else 'undetermined' end;$anchor$;
 new_mapping:=$anchor$elsif v_line->>'code'='company_ph_benefit' then
  v_treatment:=public.payroll_company_ph_statutory_treatment(v_scheme);
 elsif v_line#>>'{source,formula_version}' in ('my_ph_2023_v1','ph_occurrence_override_v1') and v_line->>'code' in ('public_holiday','public_holiday_ot') then
  v_treatment:=v_line#>>array['source','statutory_treatments',v_scheme];$anchor$;
 if position(old_mapping in definition)=0 then raise exception 'Canonical Company PH statutory mapping differs; inspect before applying'; end if;
 execute replace(definition,old_mapping,new_mapping);
 definition:=pg_get_functiondef('public.payroll_lindung_wages(jsonb)'::regprocedure);
 old_mapping:=$anchor$elsif line->>'code' in ('monthly_basic','regular','overtime','rest_day','public_holiday','public_holiday_ot','company_ph_benefit','unpaid_time') then treatment:='included';$anchor$;
 new_mapping:=$anchor$elsif line->>'code'='company_ph_benefit' then treatment:=public.payroll_company_ph_statutory_treatment('lindung');
  elsif line->>'code' in ('monthly_basic','regular','overtime','rest_day','public_holiday','public_holiday_ot','unpaid_time') then treatment:='included';$anchor$;
 if position(old_mapping in definition)=0 then raise exception 'Validated LINDUNG system mapping prerequisite missing'; end if;
 execute replace(definition,old_mapping,new_mapping);
end $$;

-- Read-only summary derives from the same mapping used by the calculators.
create or replace function public.payroll_company_ph_statutory_read(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.payroll_admin_actor();
 if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.view') then
  raise exception using errcode='42501',message='Company policy visibility denied.';
 end if;
 return jsonb_build_object('earning_code','company_ph_benefit','treatments',
  (select jsonb_agg(jsonb_build_object('scheme',s,'treatment',public.payroll_company_ph_statutory_treatment(s),
   'method',case when s='pcb' then 'manual_confirmed' else 'official_schedule' end))
   from unnest(array['epf','socso','lindung','eis','pcb']) s),
  'overtime_separate',true,'employee_applicability_separate',true);
end $$;
revoke all on function public.payroll_company_ph_statutory_read(uuid) from public,anon;
grant execute on function public.payroll_company_ph_statutory_read(uuid) to authenticated;
notify pgrst,'reload schema';
