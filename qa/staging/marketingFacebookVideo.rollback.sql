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

do $fixtures$
declare o uuid:=(select id from activity_fixture where key='org');b uuid:=(select id from activity_fixture where key='brand');e uuid:=(select id from activity_fixture where key='employee');v uuid:=gen_random_uuid();bad uuid:=gen_random_uuid();foreign_brand uuid:=gen_random_uuid();conn uuid:=gen_random_uuid();u uuid:=(select id from activity_fixture where key='user');failed boolean:=false;
begin
 insert into public.brands(id,organization_id,name) values(foreign_brand,o,'QA unrelated Brand');
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by) values(v,o,b,'QA video.mp4','video/mp4',100,'rollback-only/'||v,'ready',e),(bad,o,foreign_brand,'Other Brand.mp4','video/mp4',100,'rollback-only/'||bad,'ready',e);
 insert into activity_fixture values('video',v),('foreign_asset',bad);
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation) values(conn,o,b,'facebook','999999999991','QA Page','test_authorized',now()+interval '1 day','{"formats":["text","image","carousel"],"execution_enabled":false}',e,now(),1);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(conn,'rollback-only','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','service_role')::text,true);
 perform public.marketing_meta_record_eligibility(conn,u,1,null,true);
 assert (select capabilities->'formats' ?& array['video','reel'] and capabilities->>'execution_enabled'='false' and credential_generation=1 from public.marketing_connections where id=conn),'Only fresh same-generation capability projection; execution stays off';
 begin perform public.marketing_meta_record_eligibility(conn,u,2,null,true);exception when others then failed:=true;end;assert failed,'Wrong generation denied';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end;$fixtures$;
set local role authenticated;
do $tests$
declare o uuid:=(select id from activity_fixture where key='org');b uuid:=(select id from activity_fixture where key='brand');a uuid:=(select id from activity_fixture where key='video');body jsonb;content jsonb;request uuid:=gen_random_uuid();failed boolean:=false;
begin
 body:=jsonb_build_object('title','QA shared video','outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel','facebook','format','video','caption','FB independent','asset_ids',jsonb_build_array(a)),jsonb_build_object('channel','instagram','format','reel','caption','IG independent','asset_ids',jsonb_build_array(a))));
 content:=public.marketing_content_command(request,'save',o,b,null,0,body);
 assert public.marketing_content_command(request,'save',o,b,null,0,body)=content,'Save retries idempotent';
 assert (public.marketing_content_detail((content->>'id')::uuid)->'content'->'payload'->'variants'->0->'asset_ids')=(public.marketing_content_detail((content->>'id')::uuid)->'content'->'payload'->'variants'->1->'asset_ids'),'One asset identity reused, independent channels';
 begin perform public.marketing_content_command(gen_random_uuid(),'schedule',o,b,(content->>'id')::uuid,1,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));exception when others then failed:=true;end;assert failed,'Draft cannot schedule';
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,(content->>'id')::uuid,1);
 content:=public.marketing_content_command(gen_random_uuid(),'approve',o,b,(content->>'id')::uuid,1);assert content->>'approved_revision'='1';
 content:=public.marketing_content_command(gen_random_uuid(),'schedule',o,b,(content->>'id')::uuid,1,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));
 assert content->>'status'='scheduled';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,jsonb_set(body,'{variants,1,format}','"video"'));exception when others then failed:=true;end;assert failed,'Instagram standalone Video unsupported';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,jsonb_set(body,'{variants,0,asset_ids}',jsonb_build_array((select id from activity_fixture where key='foreign_asset'))));exception when others then failed:=true;end;assert failed,'Cross-Brand asset denied';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',o,b,(content->>'id')::uuid,0,body);exception when others then failed:=true;end;assert failed,'Stale revision denied';
 content:=public.marketing_content_command(gen_random_uuid(),'save',o,b,(content->>'id')::uuid,1,jsonb_set(body,'{variants,0,caption}','"Changed FB caption"'));
 assert content->>'revision'='2' and content->>'status'='draft' and content->>'approved_revision' is null,'Material edit invalidates only by canonical Save';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',gen_random_uuid(),b,null,0,body);exception when insufficient_privilege then failed:=true;end;assert failed,'Cross-tenant command denied';
end;$tests$;
reset role;
select 'PASS: shared MP4 identity, independent captions, approval/scheduling isolation, retry, generation and Brand/tenant guards; all fixtures rolled back' result;
rollback;
