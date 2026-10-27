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


-- Isolated fixtures only; no worker sees these uncommitted rows and no provider calls occur.
do $matrix$
declare o uuid:=(select id from activity_fixture where key='org');e uuid:=(select id from activity_fixture where key='employee');b uuid;fb uuid;ig uuid;pic uuid;vid uuid;content jsonb;payload jsonb;conn public.marketing_connections;channel_name text;format_name text;label text;case_no integer;idx integer:=0;job public.marketing_jobs;lease uuid;request uuid;result jsonb;denied boolean;other_fb uuid;passed integer:=0;
begin
 foreach label in array array['Happiness','Hola','JYMT','Friends Corner','Idamans'] loop
  idx:=idx+1;b:=gen_random_uuid();fb:=gen_random_uuid();ig:=gen_random_uuid();pic:=gen_random_uuid();vid:=gen_random_uuid();
  insert into public.brands(id,organization_id,name) values(b,o,'QA Normal Formats '||label);
  insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by) values
   (pic,o,b,'normal.jpg','image/jpeg',100,'rollback-only/'||pic,'ready',e),
   (vid,o,b,'normal.mp4','video/mp4',1000,'rollback-only/'||vid,'ready',e);
  insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation) values
   (fb,o,b,'facebook','999981'||idx,'QA FB '||label,'test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["text","image","carousel","video","reel"]}',e,now(),1),
   (ig,o,b,'instagram','999982'||idx,'QA IG '||label,'test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["image","carousel","reel"]}',e,now(),1);
  insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(fb,'rollback-only','{}'),(ig,'rollback-only','{}');
  select * into conn from public.marketing_connections where id=fb;
  assert marketing_private.format_authorizations(conn)->'normal_formats' ?& array['facebook_video','facebook_reel'];
  assert marketing_private.format_authorizations(conn)->>'facebook_reel' is null,'No legacy grant added';
  conn.capabilities:=conn.capabilities||'{"execution_enabled":false}';assert marketing_private.format_authorizations(conn)->'normal_formats'='[]'::jsonb;
  conn.capabilities:=conn.capabilities||'{"execution_enabled":true}';conn.expires_at:=now()-interval '1 minute';assert marketing_private.format_authorizations(conn)->'normal_formats'='[]'::jsonb;
  select * into conn from public.marketing_connections where id=ig;
  assert marketing_private.format_authorizations(conn)->'normal_formats'='["instagram_mixed_carousel"]'::jsonb;
  assert not marketing_private.format_authorizations(conn)->'normal_formats' ? 'instagram_story';
  for case_no in 1..5 loop
   channel_name:=case when case_no in(3,5) then 'instagram' else 'facebook' end;
   format_name:=case case_no when 1 then 'video' when 2 then 'reel' when 3 then 'carousel' when 4 then 'text' else 'image' end;
   select * into conn from public.marketing_connections where id=case when channel_name='facebook' then fb else ig end;
   payload:=jsonb_build_object('title','Rollback normal '||label||' '||case_no,'outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel',channel_name,'format',format_name,'caption','Controlled rollback fixture','asset_ids',case when case_no=4 then '[]'::jsonb when case_no=3 then jsonb_build_array(pic,vid) when case_no=5 then jsonb_build_array(pic) else jsonb_build_array(vid) end)));
   content:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,payload);
   payload:=jsonb_build_object('confirm',true,'timezone','Asia/Kuala_Lumpur','scheduled_at',now()+interval '1 day','accounts',jsonb_build_array(jsonb_build_object('connection_id',conn.id,'generation',1,'provider_account_id',conn.provider_account_id,'channel',channel_name)));
   if other_fb is not null and channel_name='facebook' then
    denied:=false;begin perform public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,(content->>'id')::uuid,1,jsonb_set(payload,'{accounts,0,connection_id}',to_jsonb(other_fb)));exception when others then denied:=true;end;assert denied,'Another Brand account rejected';
   end if;
   request:=gen_random_uuid();result:=public.marketing_content_command(request,'schedule_publish',o,b,(content->>'id')::uuid,1,payload);
   assert public.marketing_content_command(request,'schedule_publish',o,b,(content->>'id')::uuid,1,payload)=result,'Exact retry is idempotent';
   assert (select count(*)=1 from public.marketing_jobs where content_id=(content->>'id')::uuid),'No duplicate job';
   select * into job from public.marketing_jobs where content_id=(content->>'id')::uuid;
   lease:=gen_random_uuid();update public.marketing_jobs set state='leased',lease_token=lease,lease_expires_at=now()+interval '2 minutes' where id=job.id;
   if case_no<=3 then
    perform public.marketing_job_checkpoint(job.id,lease,'{"format_authorization_kind":"routine"}');
    perform public.marketing_job_guard(job.id,lease,true);
    denied:=false;begin perform public.marketing_job_checkpoint(job.id,lease,'{"format_authorization_kind":"temporary"}');exception when others then denied:=true;end;assert denied,'Pinned kind cannot transfer';
    update public.marketing_connections set credential_generation=2 where id=conn.id;
    denied:=false;begin perform public.marketing_job_guard(job.id,lease,true);exception when others then denied:=true;end;assert denied,'Job generation is pinned';
    update public.marketing_connections set credential_generation=1,capabilities=capabilities||'{"execution_enabled":false}' where id=conn.id;
    denied:=false;begin perform public.marketing_job_guard(job.id,lease,true);exception when others then denied:=true;end;assert denied,'Account revocation blocks admission';
    update public.marketing_connections set capabilities=capabilities||'{"execution_enabled":true}' where id=conn.id;
   else perform public.marketing_job_guard(job.id,lease,true);end if;
   passed:=passed+1;
  end loop;
  other_fb:=fb;
 end loop;
 assert passed=25;
 assert not has_function_privilege('authenticated','marketing_private.format_authorizations(public.marketing_connections)','execute');
 assert not has_function_privilege('authenticated','public.marketing_job_guard(uuid,uuid,boolean)','execute');
end;$matrix$;
rollback;
select 'PASS: five Brands x five formats, canonical scheduling/retry, Brand/generation/lease authority and revocation; all fixtures rolled back' result;
