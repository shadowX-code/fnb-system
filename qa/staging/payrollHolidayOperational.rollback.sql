-- All source/master/assignment/benefit writes below roll back. No official dates.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare a uuid:=public.payroll_admin_actor(); company uuid; calendar uuid; newer uuid; policy uuid;
 request uuid:=gen_random_uuid(); manifest jsonb; required uuid; optional uuid; before_assignment text; r jsonb;
begin
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA rollback operational calendar','QA-'||gen_random_uuid(),'Rollback only',a,a) returning id into company;
 manifest:=jsonb_build_object('source_reference','QA ONLY rollback reviewed import; not official','source_complete',true,'holidays',jsonb_build_array(
  jsonb_build_object('date','2097-08-31','name','QA import required','scope','national','kind','required'),
  jsonb_build_object('date','2097-05-01','name','QA import optional','scope','national','kind','gazetted')));
 calendar:=public.payroll_holiday_import(2097,manifest,true,null,request);
 if calendar<>public.payroll_holiday_import(2097,manifest,true,null,request)
  or (select count(*) from public.payroll_holiday_policy_events where calendar_version_id=calendar and event_type='calendar_imported')<>1 then raise exception 'Import retry duplicated evidence'; end if;
 begin
  perform public.payroll_holiday_import(2097,manifest||'{"source_reference":"Changed"}',true,null,request);
  raise exception 'Changed import request accepted';
 exception when invalid_parameter_value then null; end;
 select (e->>'holiday_id')::uuid into required from public.payroll_holiday_calendar_versions c,lateral jsonb_array_elements(c.entries)e where c.id=calendar and e->>'kind'='required';
 select (e->>'holiday_id')::uuid into optional from public.payroll_holiday_calendar_versions c,lateral jsonb_array_elements(c.entries)e where c.id=calendar and e->>'kind'='gazetted';
 begin
  perform public.payroll_paid_holiday_default_save(calendar,array[optional],null,gen_random_uuid());
  raise exception 'Required holiday deselected';
 exception when check_violation then null; end;
 request:=gen_random_uuid();
 policy:=public.payroll_paid_holiday_default_save(calendar,array[required],null,request);
 if policy<>public.payroll_paid_holiday_default_save(calendar,array[required],null,request) then raise exception 'Default retry duplicated policy'; end if;
 if exists(select 1 from public.legal_entities le where le.is_active and not exists(select 1 from public.payroll_paid_holiday_assignments x where x.legal_entity_id=le.id and x.year=2097 and x.outlet_id is null and x.policy_version_id=policy)) then raise exception 'Default omitted active company'; end if;
 select md5(jsonb_agg(to_jsonb(x) order by legal_entity_id)::text) into before_assignment from public.payroll_paid_holiday_assignments x where year=2097;
 newer:=public.payroll_holiday_import(2097,manifest||'{"source_reference":"QA ONLY updated source"}',true,calendar,gen_random_uuid());
 if before_assignment<>(select md5(jsonb_agg(to_jsonb(x) order by legal_entity_id)::text) from public.payroll_paid_holiday_assignments x where year=2097) then raise exception 'Import mutated company selection'; end if;
 begin
  perform public.payroll_holiday_calendar_retire(calendar,'QA retirement while active');
  raise exception 'Active company calendar retired';
 exception when object_not_in_prerequisite_state then null; end;
 perform public.payroll_holiday_calendar_retire(newer,'Rollback unassigned source retirement');
 r:=public.payroll_annual_holiday_read(2097);
 if exists(select 1 from jsonb_array_elements(r->'calendars')e where e->>'id'=newer::text) then raise exception 'Retired calendar leaked operationally'; end if;
 if not exists(select 1 from jsonb_array_elements(r->'history')e where e->>'calendar_version_id'=newer::text and e->>'event_type'='calendar_retired') then raise exception 'Retirement lost history'; end if;
 perform public.payroll_ph_default_policy_save('2097-01-01','replacement_leave','Rollback shared default');
 if exists(select 1 from public.legal_entities le where le.is_active and not exists(select 1 from public.payroll_ph_policy_versions p where p.legal_entity_id=le.id and p.effective_from='2097-01-01' and p.treatment='replacement_leave')) then raise exception 'PH shared benefit omitted company'; end if;
 if has_function_privilege('anon','public.payroll_holiday_import(integer,jsonb,boolean,uuid,uuid)','EXECUTE') then raise exception 'Anonymous import granted'; end if;
 raise notice 'PASS import/retry/changed intent/required lock/shared scope/source update/retirement/history/benefit delegation/anon denial';
end $$;
rollback;
