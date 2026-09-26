-- Isolated source fixtures are deliberately NOT official calendar data. Every
-- mutation, including publication and audit, rolls back at the end.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e
  join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login
  and e.access_state='active' limit 1),true);
do $$
<<qa>>
declare a uuid:=public.payroll_admin_actor(); le uuid; outlet_a uuid; outlet_b uuid;
  required_id uuid; optional_id uuid; state_id uuid; calendar_id uuid; policy_id uuid;
  request_id uuid:=gen_random_uuid(); entries jsonb; r jsonb; first_hash text;
  employee_id uuid; profile_id uuid; publication_id uuid; roster_id uuid; source_hash text;
begin
  select md5(coalesce(jsonb_agg(to_jsonb(h) order by id),'[]')::text) into first_hash from public.payroll_public_holidays h;
  insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,
    created_by_employee_id,updated_by_employee_id) values('QA rollback holiday company',
    'QA-'||gen_random_uuid(),'Rollback only',a,a) returning id into le;
  insert into public.outlets(name,code,state_code) values('QA holiday outlet A','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet_a;
  insert into public.outlets(name,code,state_code) values('QA holiday outlet B','QA-'||substr(gen_random_uuid()::text,1,8),'MY-09') returning id into outlet_b;
  required_id:=public.payroll_holiday_save('2098-08-31','QA isolated required','national','Rollback source boundary test');
  optional_id:=public.payroll_holiday_save('2098-05-01','QA isolated optional','national','Rollback source boundary test');
  state_id:=public.payroll_holiday_save('2098-06-01','QA isolated state','state','Rollback source boundary test',null,'MY-08');
  entries:=jsonb_build_array(jsonb_build_object('holiday_id',required_id,'kind','required','source_reference','QA source'),
    jsonb_build_object('holiday_id',optional_id,'kind','gazetted','source_reference','QA source'),
    jsonb_build_object('holiday_id',state_id,'kind','special','source_reference','QA source'));
  begin
    perform public.payroll_holiday_calendar_save(2098,entries,'QA source',false,true,null,gen_random_uuid());
    raise exception 'Incomplete calendar publication unexpectedly succeeded';
  exception when check_violation then null; end;
  calendar_id:=public.payroll_holiday_calendar_save(2098,entries,'QA source',true,true,null,request_id);
  if calendar_id<>public.payroll_holiday_calendar_save(2098,entries,'QA source',true,true,null,request_id)
    or (select count(*) from public.payroll_holiday_policy_events where calendar_version_id=calendar_id)<>1 then
    raise exception 'Calendar retry duplicated evidence'; end if;
  begin
    perform public.payroll_holiday_calendar_save(2098,entries,'QA changed',true,true,null,request_id);
    raise exception 'Changed payload reused request';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.payroll_holiday_calendar_save(2098,entries,'QA source',true,true,null,gen_random_uuid());
    raise exception 'Stale calendar save unexpectedly succeeded';
  exception when serialization_failure then null; end;
  begin
    perform public.payroll_paid_holiday_policy_save('QA paid holidays',calendar_id,array[optional_id],array[le],
      '{}',null,true,null,gen_random_uuid());
    raise exception 'Required holiday deselection succeeded';
  exception when check_violation then null; end;
  request_id:=gen_random_uuid();
  policy_id:=public.payroll_paid_holiday_policy_save('QA paid holidays',calendar_id,array[required_id,state_id],
    array[le],'{}',null,true,null,request_id);
  if policy_id<>public.payroll_paid_holiday_policy_save('QA paid holidays',calendar_id,array[required_id,state_id],
    array[le],'{}',null,true,null,request_id)
    or (select count(*) from public.payroll_holiday_policy_events where policy_version_id=policy_id)<>1 then
    raise exception 'Policy retry duplicated evidence'; end if;
  r:=public.payroll_paid_holiday_resolve(le,outlet_a,'2098-08-31');
  if r->>'status'<>'paid_holiday' or r->>'policy_version_id'<>policy_id::text then raise exception 'Required holiday not resolved: %',r; end if;
  r:=public.payroll_paid_holiday_resolve(le,outlet_a,'2098-05-01');
  if r->>'status'<>'not_selected' then raise exception 'Non-selected gazetted holiday became paid: %',r; end if;
  if public.payroll_paid_holiday_resolve(le,outlet_a,'2098-06-01')->>'status'<>'paid_holiday'
    or public.payroll_paid_holiday_resolve(le,outlet_b,'2098-06-01')->>'status'<>'not_selected' then
    raise exception 'Geographic applicability leaked'; end if;
  if public.payroll_paid_holiday_resolve(gen_random_uuid(),outlet_a,'2098-08-31')->>'status'<>'policy_required' then
    raise exception 'Missing company policy guessed'; end if;
  insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date)
    values('QA rollback paid-holiday employee','QA-'||substr(gen_random_uuid()::text,1,8),le,
      'QA holiday outlet A','2026-01-01') returning id into employee_id;
  profile_id:=public.payroll_profile_create(employee_id,'2026-01-01','hourly',15,'MYR',
    'QA rollback pay setup',null,null,false,false,false,false);
  insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by)
    values(outlet_a,'2098-04-28','2098-05-04',1,auth.uid()) returning id into publication_id;
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,
    start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
    values(publication_id,outlet_a,employee_id,'2098-05-01','09:00','18:00',60,'working',
      'QA holiday outlet A',now()) returning id into roster_id;
  select md5(to_jsonb(s)::text) into source_hash from public.duty_roster_published_entries s where id=roster_id;
  r:=public.payroll_time_evidence(employee_id,'2098-05-01');
  if r->>'classification'<>'regular' or r->>'holiday_id' is not null then
    raise exception 'Non-selected gazetted holiday classified PH in actual time owner: %',r; end if;
  -- Source setup, not a lifecycle mutation: a second published day verifies the
  -- selected holiday branch without creating payable decisions or payroll.
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,
    start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
    values(publication_id,outlet_a,employee_id,'2098-08-31','09:00','18:00',60,'working',
      'QA holiday outlet A',now());
  r:=public.payroll_time_evidence(employee_id,'2098-08-31');
  if r->>'classification'<>'public_holiday' or r->>'holiday_id'<>required_id::text
    or r->'paid_holiday_policy'->>'policy_version_id'<>policy_id::text then
    raise exception 'Selected holiday lost policy evidence: %',r; end if;
  if source_hash<>(select md5(to_jsonb(s)::text) from public.duty_roster_published_entries s where id=roster_id) then
    raise exception 'Paid holiday resolver rewrote roster evidence'; end if;
  begin
    perform public.payroll_paid_holiday_policy_save('QA unintended conflicting policy',calendar_id,array[required_id],
      array[le],'{}',null,true,null,gen_random_uuid());
    raise exception 'Competing company assignment succeeded';
  exception when unique_violation then null; end;
  perform public.payroll_paid_holiday_policy_save('QA explicit override',calendar_id,array[required_id],
    array[le],array[outlet_a],'Different QA source selection',true,null,gen_random_uuid());
  if public.payroll_paid_holiday_resolve(le,outlet_a,'2098-06-01')->>'status'<>'not_selected' then
    raise exception 'Explicit outlet override was not selected'; end if;
  begin
    update public.payroll_public_holidays set name='Changed source' where id=required_id;
    raise exception 'Published calendar source changed';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    update public.payroll_paid_holiday_policy_versions set name='Changed policy' where id=qa.policy_id;
    raise exception 'Published policy changed';
  exception when object_not_in_prerequisite_state then null; end;
  if exists(select 1 from public.payroll_public_holidays where id=required_id and name<>'QA isolated required') then
    raise exception 'Original calendar evidence changed'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.payroll_annual_holiday_read(2098);
    raise exception 'Unauthenticated read succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select 'ANNUAL HOLIDAY ROLLBACK CONTRACTS PASS' as result;
rollback;
