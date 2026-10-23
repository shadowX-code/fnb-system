-- Staging only. No provider calls, persistent customers, posts or media objects.
begin;
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

-- All identities, media and provider receipts below are rollback-only authority fixtures.
do $setup$
declare o uuid:=(select id from activity_fixture where key='org');b uuid:=(select id from activity_fixture where key='brand');e uuid:=(select id from activity_fixture where key='employee');fb uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();content jsonb;v uuid:=gen_random_uuid();
begin
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by) values(v,o,b,'rollback.jpg','image/jpeg',100,'rollback-only/'||v,'ready',e);
 content:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,jsonb_build_object('title','Rollback-only publishing','outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel','facebook','format','text','caption','Fixture','asset_ids','[]'::jsonb),jsonb_build_object('channel','instagram','format','image','caption','Fixture IG','asset_ids',jsonb_build_array(v)))));
 insert into activity_fixture values('content',(content->>'id')::uuid);
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,(content->>'id')::uuid,1,'{}');
 perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,(content->>'id')::uuid,1,'{}');
 perform public.marketing_content_command(gen_random_uuid(),'schedule',o,b,(content->>'id')::uuid,1,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));
 -- Two channel jobs emulate an already-approved shared revision; no provider requests occur.
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation) values
 (fb,o,b,'facebook','999999999991','Rollback Page','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["text"]}',e,now(),1),
 (ig,o,b,'instagram','999999999992','Rollback IG','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["image"]}',e,now(),1);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(fb,'rollback-only','{}'),(ig,'rollback-only','{}');
 insert into activity_fixture values('fb_conn',fb),('ig_conn',ig);
 update public.marketing_jobs set state='succeeded',connection_id=fb,connection_generation=1,external_authorized_at=now(),provider_post_id='999999999991_999',provider_state='{"post_id":"999999999991_999"}' where content_id=(content->>'id')::uuid and channel='facebook';
 update public.marketing_jobs set state='failed',due_at=now()-interval '1 minute',error_code='meta_permission_or_token_invalid',connection_id=ig,connection_generation=1,external_authorized_at=now(),provider_state='{"objects":{"container":"999"}}',attempts=7,failures=5 where content_id=(content->>'id')::uuid and channel='instagram';
 update public.marketing_content set status='failed' where id=(content->>'id')::uuid;
 insert into activity_fixture select channel,id from public.marketing_jobs where content_id=(content->>'id')::uuid;
end;$setup$;
set local role authenticated;
do $checks$
declare o uuid:=(select id from activity_fixture where key='org');b uuid:=(select id from activity_fixture where key='brand');c uuid:=(select id from activity_fixture where key='content');ig uuid:=(select id from activity_fixture where key='instagram');j jsonb;d jsonb;request uuid:=gen_random_uuid();p jsonb;result jsonb;failed boolean:=false;
begin
 d:=public.marketing_content_detail(c);assert jsonb_array_length(d->'content'->'channels')=2,'Detail consumes canonical channels';
 assert (select v->>'status'='published' from jsonb_array_elements(d->'content'->'channels') v where v->>'channel'='facebook'),'Successful sibling still published';
 select v into j from jsonb_array_elements(d->'content'->'channels') v where v->>'channel'='instagram';
 assert j->'operations'->>'can_recover'='true','Definite permission failure recoverable';
 p:=jsonb_build_object('job_id',ig,'expected_updated_at',j->>'job_updated_at','confirm',true);
 result:=public.marketing_content_command(request,'recover_channel',o,b,c,1,p);
 assert public.marketing_content_command(request,'recover_channel',o,b,c,1,p)=result,'Exact operation retries idempotent';
 begin perform public.marketing_content_command(gen_random_uuid(),'recover_channel',o,b,c,1,p);exception when sqlstate '40001' then failed:=true;end;assert failed,'Changed job rejects stale action';
end;$checks$;
reset role;
do $assert_recovery$
declare c uuid:=(select id from activity_fixture where key='content');j public.marketing_jobs;d jsonb;
begin
 select * into j from public.marketing_jobs where id=(select id from activity_fixture where key='instagram');
 assert j.state='blocked' and j.external_authorized_at is null and j.attempts=7 and j.failures=0 and j.provider_state='{"objects":{"container":"999"}}'::jsonb,'Recovery preserves preparation and attempts; no send authorization';
 assert (select state='succeeded' and provider_post_id='999999999991_999' from public.marketing_jobs where content_id=c and channel='facebook'),'Receipt unchanged';
 update public.marketing_jobs set state='failed',error_code='meta_permission_or_token_invalid',provider_state='{"pending":"publish","objects":{"container":"999"}}' where id=j.id;
 d:=marketing_private.publishing_job_actions((select x from public.marketing_jobs x where id=j.id));assert d->>'can_recover'='false' and d->>'can_cancel'='false','Uncertain write cannot be retried or cancelled';
 update public.marketing_jobs set provider_state='{}' where id=j.id;
 update public.marketing_connections set credential_generation=2 where id=j.connection_id;
 d:=marketing_private.publishing_job_actions((select x from public.marketing_jobs x where id=j.id));assert d->>'can_recover'='false','Generation drift blocks recovery';
 update public.marketing_connections set credential_generation=1 where id=j.connection_id;
 update public.marketing_jobs set state='queued',failures=0,error_code=null,external_authorized_at=now() where id=j.id;
 update public.marketing_content set status='failed' where id=c;
 d:=public.marketing_claim_job();assert d->>'id'=j.id::text,'Failed aggregate cannot starve an independently authorized sibling';
 update public.marketing_jobs set state='blocked',provider_state='{}',external_authorized_at=now(),updated_at=clock_timestamp() where id=j.id;
 update public.marketing_content set status='scheduled' where id=c;
end;$assert_recovery$;
set local role authenticated;
do $schedule_cancel$
declare o uuid:=(select id from activity_fixture where key='org');b uuid:=(select id from activity_fixture where key='brand');c uuid:=(select id from activity_fixture where key='content');j jsonb;d jsonb;p jsonb;failed boolean:=false;
begin
 d:=public.marketing_content_detail(c);select v into j from jsonb_array_elements(d->'content'->'channels') v where v->>'channel'='instagram';
 p:=jsonb_build_object('job_id',j->>'job_id','expected_updated_at',j->>'job_updated_at','confirm',true,'scheduled_at',now()+interval '3 days','timezone','Asia/Kuala_Lumpur');
 perform public.marketing_content_command(gen_random_uuid(),'reschedule_channel',o,b,c,1,p);
 d:=public.marketing_content_detail(c);select v into j from jsonb_array_elements(d->'content'->'channels') v where v->>'channel'='instagram';
 assert j->>'status'='awaiting_authorization' and (j->>'scheduled_at')::timestamptz>now()+interval '2 days','New time requires execution approval';
 begin perform public.marketing_content_command(gen_random_uuid(),'cancel_channel',o,b,c,0,jsonb_build_object('job_id',j->>'job_id','expected_updated_at',j->>'job_updated_at','confirm',true));exception when sqlstate '40001' then failed:=true;end;assert failed,'Revision checks retained';
 perform public.marketing_content_command(gen_random_uuid(),'cancel_channel',o,b,c,1,jsonb_build_object('job_id',j->>'job_id','expected_updated_at',j->>'job_updated_at','confirm',true));
 d:=public.marketing_content_detail(c);assert (select v->>'status'='published' from jsonb_array_elements(d->'content'->'channels') v where v->>'channel'='facebook'),'Cancellation does not retract successful sibling';
 assert not has_function_privilege('authenticated',(select oid from pg_proc where proname='content_job_operation'),'execute'),'Private mutation helper inaccessible';
 begin perform public.marketing_content_command(gen_random_uuid(),'recover_channel',gen_random_uuid(),b,c,1,'{}');failed:=false;exception when others then failed:=true;end;assert failed,'Tenant authority retained';
end;$schedule_cancel$;
rollback;
select 'PASS: channel recovery/reschedule/cancel, exact retry, receipt/checkpoint retention, generation/revision/tenant guards and failed-sibling claim; all fixtures rolled back' as result;
