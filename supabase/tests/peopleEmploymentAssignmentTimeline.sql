-- Staging-only, rollback-only authority contract. No fixture persists.
begin;
do $$
declare
  v_auth uuid;
  v_employee uuid;
  v_home public.outlets%rowtype;
  v_next public.outlets%rowtype;
  v_baseline uuid;
  v_current uuid;
  v_response jsonb;
  v_today date:=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date;
  v_count integer;
  v_applied boolean;
  v_projected_type text;
  v_access_outlet uuid;
  v_live_sessions integer;
begin
  select e.auth_user_id into v_auth from public.employees e
    join public.roles r on r.id=e.role_id
    where lower(r.name)='owner' and e.auth_user_id is not null and e.is_active limit 1;
  if v_auth is null then raise exception 'No linked Owner for timeline contract'; end if;
  perform set_config('request.jwt.claim.sub',v_auth::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if not public.current_user_has_permission('employees.edit')
    or not public.current_user_has_all_outlet_access() then
    raise exception 'Owner does not have the expected Employee scope';
  end if;
  select * into v_home from public.outlets where is_active order by name limit 1;
  select * into v_next from public.outlets where is_active and id<>v_home.id order by name limit 1;
  if v_home.id is null or v_next.id is null then raise exception 'Two outlets required for rollback fixture'; end if;

  insert into public.employees(full_name,employment_type,employment_status,position,workplace)
    values('QA Timeline Rollback Only','probation','active','Service Crew',v_home.name) returning id into v_employee;
  select id into v_baseline from public.employee_employment_assignment_revisions
    where employee_id=v_employee and source_kind='new_employee';
  if v_baseline is null or (public.employee_employment_assignment_read(v_employee,v_today-1)->>'state')<>'unresolved'
    then raise exception 'Current baseline or pre-cutover unresolved contract failed'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.employee_employment_assignment_read(v_employee,v_today);
    raise exception 'Anonymous assignment read was accepted';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',v_auth::text,true);
  insert into public.crew_access(employee_id,mobile_number,passcode_hash,primary_outlet_id)
    values(v_employee,'+60198887766','rollback-only',v_home.id);
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
    values(v_employee,extensions.gen_random_uuid()::text,now()+interval '1 day');

  v_response:=public.employee_employment_assignment_save(v_employee,v_today+2,
    jsonb_build_object('employment_type','contract','employment_status','active',
      'position','Service Crew','legal_entity_id',null,'workplace',v_next.name),
    'Scheduled QA fixture',v_baseline,null);
  if v_response->>'projection_state'<>'scheduled'
    or (select workplace from public.employees where id=v_employee)<>v_home.name
    or (select primary_outlet_id from public.crew_access where employee_id=v_employee)<>v_home.id
    or exists(select 1 from public.crew_sessions where employee_id=v_employee and revoked_at is not null)
    or (public.employee_employment_assignment_read(v_employee,v_today+2)->'assignment'->>'employment_type')<>'contract'
    then raise exception 'Future change leaked into current Employee/Crew Access'; end if;

  v_response:=public.employee_employment_assignment_save(v_employee,v_today,
    jsonb_build_object('employment_type','full_time','employment_status','active',
      'position','Service Crew','legal_entity_id',null,'workplace',v_next.name),
    'Current QA transfer',v_baseline,null);
  v_current:=(v_response->'revision'->>'id')::uuid;
  if (select workplace from public.employees where id=v_employee)<>v_next.name
    or (select primary_outlet_id from public.crew_access where employee_id=v_employee)<>v_next.id
    or not exists(select 1 from public.crew_sessions where employee_id=v_employee and revoked_at is not null)
    then raise exception 'Current projection or Crew Access transition failed'; end if;
  if (public.employee_employment_assignment_read(v_employee,v_today)->'assignment'->>'id')<>v_current::text
    then raise exception 'As-of resolver selected the wrong revision'; end if;

  -- Simulate the pre-activation projection at the due date, then use the same
  -- private projection function that the scheduled job invokes. All rolled back.
  perform set_config('feedx.people_employment_projection','yes',true);
  update public.employees set employment_type='probation',workplace=v_home.name where id=v_employee;
  perform set_config('feedx.people_employment_projection','',true);
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
    values(v_employee,extensions.gen_random_uuid()::text,now()+interval '1 day');
  v_applied:=public.employee_employment_apply_projection(v_employee);
  select employment_type into v_projected_type from public.employees where id=v_employee;
  select primary_outlet_id into v_access_outlet from public.crew_access where employee_id=v_employee;
  select count(*) into v_live_sessions from public.crew_sessions where employee_id=v_employee and revoked_at is null;
  if not v_applied or v_projected_type<>'full_time' or v_access_outlet<>v_next.id or v_live_sessions<>0
    then raise exception 'Due projection failed: applied %, type %, outlet %, expected %, live %',
      v_applied,v_projected_type,v_access_outlet,v_next.id,v_live_sessions; end if;

  begin
    perform public.employee_employment_assignment_save(v_employee,v_today,
      jsonb_build_object('employment_type','part_time','employment_status','active',
        'position','Service Crew','legal_entity_id',null,'workplace',v_next.name),
      'Stale expected revision',v_baseline,null);
    raise exception 'Conflicting expected revision was accepted';
  exception when sqlstate '40001' then null; end;

  v_response:=public.employee_employment_assignment_save(v_employee,v_today,
    jsonb_build_object('employment_type','part_time','employment_status','active',
      'position','Service Crew','legal_entity_id',null,'workplace',v_next.name),
    'Corrected classification',v_current,'Rollback test evidence');
  if (v_response->'revision'->>'supersedes_revision_id')<>v_current::text
    or (select employment_type from public.employees where id=v_employee)<>'part_time'
    or (select count(*) from public.employee_employment_assignment_revisions where employee_id=v_employee)<>4
    then raise exception 'Append-only same-date correction failed'; end if;
  begin
    update public.employee_employment_assignment_revisions set reason='Tampered' where id=v_baseline;
    raise exception 'Revision update was accepted';
  exception when sqlstate '55000' then null; end;
  begin
    update public.employees set workplace=v_home.name where id=v_employee;
    raise exception 'Direct Employee workplace edit was accepted';
  exception when sqlstate '55000' then null; end;
  select count(*) into v_count from public.employee_employment_assignment_revisions
    where employee_id=v_employee and supersedes_revision_id=v_current;
  if v_count<>1 then raise exception 'Correction lineage lost'; end if;
end $$;
rollback;
