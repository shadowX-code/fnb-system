-- Staging-only synthetic authority fixtures. No provider calls or persistent records.
begin;
set local statement_timeout='10s';
create temp table activity_fixture(key text primary key,id uuid);
grant select on activity_fixture to authenticated;
do $fixture$
declare u uuid:=gen_random_uuid();e uuid:=gen_random_uuid();o uuid:=gen_random_uuid();b uuid:=gen_random_uuid();r uuid;
begin
 select id into strict r from public.roles where lower(name)='owner' limit 1;
 insert into auth.users(id,email,aud,role) values(u,'activity-'||u||'@example.invalid','authenticated','authenticated');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,nickname,email,role_id,enable_system_login,access_state,is_active,workplace) values(e,u,'QA Activity Full Name','QA Nick','activity-'||u||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Planner Activity');
 insert into public.organization_memberships(organization_id,employee_id) values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Planner Activity');
 insert into activity_fixture values('user',u),('employee',e),('org',o),('brand',b);
end;$fixture$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from activity_fixture where key='user'),'role','authenticated')::text,true);
do $test$
declare o uuid:=(select id from activity_fixture where key='org');b uuid:=(select id from activity_fixture where key='brand');e uuid:=(select id from activity_fixture where key='employee');m date:=date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))::date;t jsonb;h jsonb;request_id uuid:=gen_random_uuid();same jsonb;denied boolean:=false;i int;
begin
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'create',null,0,jsonb_build_object('title','QA activity','content_type','post','due_date',m,'month',m));
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'transition',(t->>'id')::uuid,1,jsonb_build_object('month',m,'status','in_progress'));
 t:=public.marketing_planner_command(request_id,o,b,'save',(t->>'id')::uuid,2,jsonb_build_object('month',m,'assignee_id',e,'priority','high'));
 same:=public.marketing_planner_command(request_id,o,b,'save',(t->>'id')::uuid,2,jsonb_build_object('month',m,'assignee_id',e,'priority','high'));assert same=t,'Replay must not create activity';
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'transition',(t->>'id')::uuid,(t->>'revision')::int,jsonb_build_object('month',m,'status','in_review'));
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'request_revision',(t->>'id')::uuid,(t->>'revision')::int,jsonb_build_object('month',m,'feedback',E'Full review feedback\n第二行'));
 for i in 1..3 loop
  perform public.marketing_planner_order(gen_random_uuid(),o,m,jsonb_build_array(jsonb_build_object('id',t->>'id','revision',(t->>'revision')::int)));
  select value into t from jsonb_array_elements(public.marketing_planner_read(o,m,b)->'tasks') where value->>'id'=t->>'id';
 end loop;
 select value->'history' into h from jsonb_array_elements(public.marketing_planner_read(o,m,b)->'tasks') where value->>'id'=t->>'id';
 assert jsonb_array_length(h)=8,'Every revision must remain accessible';
 assert h->0->>'action'='ordered' and (h->0->>'revision')::int=8,'Canonical reverse revision chronology';
 assert h->0->>'actor'='QA Nick','Nickname-first actor';
 assert h->0->'state'->>'assignee_name'='QA Nick','Nickname-first historical assignee';
 assert h->0->'state'->>'priority'='high','Historical priority projection';
 assert h->4->>'action'='transition' and h->4->'state'->>'status'='in_review','Review submission state';
 assert h->5->'state'->>'assignee_id'=e::text and h->6->'state'->'assignee_id'='null'::jsonb,'Exact assignment history';
 assert h->3->>'feedback'=E'Full review feedback\n第二行','Full original review feedback';
 begin perform public.marketing_planner_read(gen_random_uuid(),m,b);exception when insufficient_privilege then denied:=true;end;
 assert denied,'Foreign organization stays denied';
 assert not has_function_privilege('anon','public.marketing_planner_read(uuid,date,uuid)','execute'),'Anonymous remains denied';
end;$test$;
reset role;
select 'PASS: exact revisions, nickname, status/assignment/priority, feedback, retry and tenant denial; fixtures rolled back' as result;
rollback;
