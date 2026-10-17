-- Staging only: ujkzdaaadnvcfayuldmh. No provider calls; all fixtures roll back.
begin;
set local statement_timeout = '10s';
create temporary table planner_conflict_qa(key text primary key, id uuid);
grant select on planner_conflict_qa to authenticated;
do $fixture$
declare
  u uuid := gen_random_uuid(); e uuid := gen_random_uuid();
  o uuid := gen_random_uuid(); b uuid := gen_random_uuid(); t uuid := gen_random_uuid(); r uuid;
  m date := date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date;
begin
  select id into strict r from public.roles where lower(name)='owner' limit 1;
  insert into auth.users(id,email,aud,role)
    values(u,'planner-conflict-'||u||'@example.invalid','authenticated','authenticated');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
    values(e,u,'QA Planner Conflict','planner-conflict-'||u||'@example.invalid',r,true,'active',true,'Management');
  insert into public.organizations(id,name) values(o,'QA Planner Conflict');
  insert into public.organization_memberships(organization_id,employee_id) values(o,e);
  insert into public.brands(id,organization_id,name) values(b,o,'QA Planner Conflict');
  insert into public.marketing_creative_tasks(id,organization_id,brand_id,title,content_type,due_date,planning_month,planned_week,created_by,updated_by)
    values(t,o,b,'QA conflict fixture','post',m,m,date_trunc('week',m)::date,e,e);
  insert into planner_conflict_qa values('user',u),('org',o),('brand',b),('task',t);
end;
$fixture$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from planner_conflict_qa where key='user'),'role','authenticated')::text,true);
do $test$
declare
  o uuid := (select id from planner_conflict_qa where key='org');
  b uuid := (select id from planner_conflict_qa where key='brand');
  t uuid := (select id from planner_conflict_qa where key='task');
  request_id uuid := gen_random_uuid();
  payload jsonb := jsonb_build_object('month',date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))::date,'status','in_progress');
  rejected boolean; result jsonb; retry_result jsonb; message text; i integer;
begin
  for i in 1..3 loop
    rejected := false;
    begin
      perform public.marketing_planner_command(gen_random_uuid(),o,b,'transition',t,0,payload);
    exception when sqlstate 'PT409' then
      get stacked diagnostics message = message_text;
      assert message='Task changed. Reload before continuing.';
      rejected := true;
    end;
    assert rejected, 'Stale revision must fail promptly with non-retryable HTTP 409';
  end loop;
  result := public.marketing_planner_command(request_id,o,b,'transition',t,1,payload);
  assert result->>'status'='in_progress' and (result->>'revision')::integer=2,
    'Authorized current revision must retain the canonical transition';
  retry_result := public.marketing_planner_command(request_id,o,b,'transition',t,1,payload);
  assert retry_result=result, 'Exact request replay must retain idempotency';
  rejected := false;
  begin
    perform public.marketing_planner_command(gen_random_uuid(),o,gen_random_uuid(),'transition',t,2,payload);
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Foreign Brand must remain denied';
end;
$test$;
reset role;
select 'PASS: stale conflicts, valid transition, exact replay and Brand denial; fixtures rolled back' as result;
rollback;
