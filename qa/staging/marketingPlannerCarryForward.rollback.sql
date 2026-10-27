-- Canonical Staging only (ujkzdaaadnvcfayuldmh); all synthetic fixtures roll back.
begin;
create temporary table planner_carry_qa(key text primary key,id uuid);
grant select on planner_carry_qa to authenticated;
do $fixture$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid(); role_id uuid; row record; tid uuid;
begin
 select id into strict role_id from public.roles where lower(name)='owner' limit 1;
 insert into auth.users(id,email,aud,role) values(u,'planner-carry-'||u||'@example.invalid','authenticated','authenticated');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(e,u,'QA Planner Carry Forward','planner-carry-'||u||'@example.invalid',role_id,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Carry Forward'),(other,'QA Foreign Carry');
 insert into public.organization_memberships(organization_id,employee_id) values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Carry A'),(b2,o,'QA Carry B'),(ob,other,'QA Foreign Carry');
 insert into planner_carry_qa values('user',u),('org',o),('brand',b),('brand2',b2),('foreign_brand',ob);
 for row in select * from (values
  ('old','2026-09-01'::date,'planned','2026-11-15'::date,false,false),
  ('progress','2026-10-01'::date,'in_progress','2026-10-20'::date,false,false),
  ('review','2026-10-01'::date,'in_review','2026-10-21'::date,false,false),
  ('revision','2026-10-01'::date,'revision_needed','2026-10-22'::date,false,false),
  ('done','2026-10-01'::date,'completed','2026-10-23'::date,false,false),
  ('current','2026-11-01'::date,'planned','2026-11-10'::date,false,false),
  ('future','2026-12-01'::date,'planned','2026-12-10'::date,false,false),
  ('deleted','2026-10-01'::date,'planned','2026-10-25'::date,true,false),
  ('brand2task','2026-09-01'::date,'planned','2026-09-15'::date,false,true)
 ) v(key,month,status,due,deleted,second_brand) loop
  tid:=gen_random_uuid();
  insert into public.marketing_creative_tasks(id,organization_id,brand_id,title,content_type,due_date,planning_month,planned_week,status,approved_revision,deleted_at,created_by,updated_by)
   values(tid,o,case when row.second_brand then b2 else b end,'QA '||row.key,'post',row.due,row.month,date_trunc('week',row.month)::date,row.status,case when row.status='completed' then 1 end,case when row.deleted then now() end,e,e);
  insert into marketing_private.creative_task_revisions select tid,1,to_jsonb(t),'create',e,now() from public.marketing_creative_tasks t where id=tid;
  insert into planner_carry_qa values(row.key,tid);
 end loop;
 insert into public.marketing_creative_tasks(organization_id,brand_id,title,content_type,due_date,planning_month,planned_week,created_by,updated_by) values(other,ob,'QA foreign task','post','2026-11-01','2026-11-01','2026-10-26',e,e);
end;$fixture$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from planner_carry_qa where key='user'),'role','authenticated')::text,true);
do $test$
declare o uuid:=(select id from planner_carry_qa where key='org');b uuid:=(select id from planner_carry_qa where key='brand'); t uuid:=(select id from planner_carry_qa where key='old'); v jsonb; before_read jsonb; october jsonb; result jsonb; repeated jsonb; req uuid:=gen_random_uuid(); ordered jsonb; rejected boolean; tpl jsonb; old_occurrence uuid; new_occurrence uuid;
begin
 v:=public.marketing_planner_read(o,'2026-11-01');before_read:=v;
 assert jsonb_array_length(v->'tasks')=6,'November must include5 BrandA tasks and1 BrandB carry';
 assert (select count(*) from jsonb_array_elements(v->'tasks') x where (x->>'carried_forward')::boolean)=5,'Four active states and all earlier months carry';
 assert not exists(select 1 from jsonb_array_elements(v->'tasks') x where x->>'title' in ('QA done','QA future','QA deleted','QA foreign task')),'Terminal, deleted, future and foreign tasks must not carry';
 assert public.marketing_planner_read(o,'2026-11-01')=before_read,'A read cannot alter tasks, schedules or history';
 assert jsonb_array_length(public.marketing_planner_read(o,'2026-11-01',b)->'tasks')=5,'Brand filtering must use the same canonical set';
 october:=public.marketing_planner_read(o,'2026-10-01');
 assert jsonb_array_length(october->'tasks')=6,'October keeps its historical completion and older active work';
 assert not exists(select 1 from jsonb_array_elements(october->'tasks') x where x->>'title' in ('QA current','QA future')),'Later tasks must not appear in October';
 ordered:=jsonb_build_array(jsonb_build_object('id',t,'revision',1),jsonb_build_object('id',(select id from planner_carry_qa where key='current'),'revision',1));
 result:=public.marketing_planner_order(req,o,'2026-11-01',ordered);
 assert result->>'ordered'='2','Mixed-month visible tasks can be ordered';
 assert public.marketing_planner_order(req,o,'2026-11-01',ordered)=result,'Exact ordering retries stay idempotent';
 rejected:=false;begin perform public.marketing_planner_order(gen_random_uuid(),o,'2026-11-01',ordered);exception when others then rejected:=true;end;
 assert rejected,'Stale revision must still fail';
 rejected:=false;begin perform public.marketing_planner_order(gen_random_uuid(),o,'2026-11-01',jsonb_build_array(jsonb_build_object('id',(select id from planner_carry_qa where key='future'),'revision',1)));exception when others then rejected:=true;end;
 assert rejected,'Future-month ordering must stay unavailable';
 rejected:=false;begin perform public.marketing_planner_order(gen_random_uuid(),o,'2026-11-15',jsonb_build_array(jsonb_build_object('id',t,'revision',2)));exception when others then rejected:=true;end;
 assert rejected,'Ordering cannot widen the read model to a noncanonical mid-month scope';
 rejected:=false;begin perform public.marketing_planner_order(gen_random_uuid(),o,'2026-11-01',jsonb_build_array(jsonb_build_object('id',(select id from planner_carry_qa where key='done'),'revision',1)));exception when others then rejected:=true;end;
 assert rejected,'Past terminal task ordering must stay unavailable';
 result:=public.marketing_planner_command(gen_random_uuid(),o,b,'save',t,2,jsonb_build_object('month','2026-11-01','priority','high'));
 assert result->>'planning_month'='2026-09-01' and result->>'due_date'='2026-11-15' and result->>'status'='planned' and result->>'planned_week'='2026-08-31','Workspace month cannot silently replan an edited carried task';
 result:=public.marketing_planner_command(gen_random_uuid(),o,b,'approve',(select id from planner_carry_qa where key='review'),1,jsonb_build_object('month','2026-11-01'));
 assert result->>'status'='completed' and result->>'planning_month'='2026-10-01','Completion keeps original planning month';
 assert not exists(select 1 from jsonb_array_elements(public.marketing_planner_read(o,'2026-11-01')->'tasks') x where x->>'title'='QA review'),'Completed carried task leaves the future operational view';
 assert exists(select 1 from jsonb_array_elements(public.marketing_planner_read(o,'2026-10-01')->'tasks') x where x->>'title'='QA review' and x->>'status'='completed' and jsonb_array_length(x->'history')=2),'Completion remains in original history with its review evidence';
 tpl:=public.marketing_planner_command(gen_random_uuid(),o,b,'template',null,0,'{"month":"2026-10-01","title":"QA Monthly occurrence","content_type":"post","frequency":"monthly","day":5}'::jsonb);
 result:=public.marketing_planner_command(gen_random_uuid(),o,b,'generate',null,0,'{"month":"2026-10-01"}'::jsonb);assert result->>'generated'='1';
 result:=public.marketing_planner_command(gen_random_uuid(),o,b,'generate',null,0,'{"month":"2026-11-01"}'::jsonb);assert result->>'generated'='1';
 repeated:=public.marketing_planner_command(gen_random_uuid(),o,b,'generate',null,0,'{"month":"2026-11-01"}'::jsonb);assert repeated->>'generated'='0','Carry visibility must not recreate recurring occurrences';
 v:=public.marketing_planner_read(o,'2026-11-01',b);
 assert (select count(*) from jsonb_array_elements(v->'tasks') x where x->>'title'='QA Monthly occurrence')=2,'Distinct October/November occurrences each appear once';
 assert (select count(*) from jsonb_array_elements(v->'tasks') x where x->>'title'='QA Monthly occurrence' and (x->>'carried_forward')::boolean)=1;
 assert (select count(*) from jsonb_array_elements(v->'tasks'))=(select count(distinct x->>'id') from jsonb_array_elements(v->'tasks') x),'No duplicated task identities';
 rejected:=false;begin perform public.marketing_planner_read(o,'2026-11-01',(select id from planner_carry_qa where key='foreign_brand'));exception when insufficient_privilege then rejected:=true;end;
 assert rejected,'Foreign Brand must remain denied';
 assert not has_function_privilege('anon','public.marketing_planner_read(uuid,date,uuid)','EXECUTE');
end;$test$;
reset role;
do $preserve$
declare o uuid:=(select id from planner_carry_qa where key='org');
begin
 assert not has_function_privilege('authenticated','marketing_private.creative_task_visible_in_month(public.marketing_creative_tasks,date)','EXECUTE');
 assert (select count(*) from public.marketing_jobs where organization_id=o)=0,'Production completion never publishes';
 assert (select count(*) from marketing_private.creative_occurrences where template_id in (select id from public.marketing_creative_templates where organization_id=o))=2;
 assert (select count(*) from marketing_private.creative_task_revisions h join planner_carry_qa q on h.task_id=q.id where h.revision=1)=9,'Original audit snapshots retained';
end;$preserve$;
select 'PASS: cross-month reads, four active states, history, Brand isolation, same-month/older ordering, stale/replay guards, schedule preservation, completion and recurring deduplication; fixtures rolled back' result;
rollback;
