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

do $formats$
declare o uuid:=(select id from activity_fixture where key='org');b uuid:=(select id from activity_fixture where key='brand');e uuid:=(select id from activity_fixture where key='employee');u uuid:=(select id from activity_fixture where key='user');pic uuid:=gen_random_uuid();vid uuid:=gen_random_uuid();png uuid:=gen_random_uuid();conn uuid:=gen_random_uuid();body jsonb;content jsonb;failed boolean:=false;counts jsonb;
begin
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by) values(pic,o,b,'rollback.jpg','image/jpeg',100,'rollback/'||pic,'ready',e),(vid,o,b,'rollback.mp4','video/mp4',100,'rollback/'||vid,'ready',e),(png,o,b,'rollback.png','image/png',100,'rollback/'||png,'ready',e);
 body:=jsonb_build_object('title','Mixed carousel fixture','outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel','instagram','format','carousel','caption','Fixture caption','asset_ids',jsonb_build_array(vid,pic))));
 content:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,body);
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,(content->>'id')::uuid,1,'{}');
 assert (select (payload->'variants'->0->'asset_ids'->>0)::uuid=vid from public.marketing_content_revisions where content_id=(content->>'id')::uuid),'Canonical mixed order pinned';
 body:=jsonb_set(body,'{variants,0,channel}','"facebook"');begin perform marketing_private.validate_content(o,b,body,true);exception when others then failed:=true;end;assert failed,'Facebook mixed carousel unsupported';
 body:=jsonb_set(body,'{variants,0,channel}','"instagram"');body:=jsonb_set(body,'{variants,0,asset_ids}',jsonb_build_array(pic,png));failed:=false;begin perform marketing_private.validate_content(o,b,body,true);exception when others then failed:=true;end;assert failed,'Instagram PNG rejected';
 body:=jsonb_set(body,'{variants,0,format}','"story"');body:=jsonb_set(body,'{variants,0,asset_ids}',jsonb_build_array(pic));perform marketing_private.validate_content(o,b,body,true);
 content:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,body);
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation,last_synced_at) values(conn,o,b,'instagram','999999999992','Rollback IG','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":false,"formats":["image","carousel","reel"]}',e,now(),1,now());
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(conn,'rollback-only','{}');
 perform public.marketing_meta_record_formats(conn,u,1,true);
 assert (select capabilities->'formats' ? 'story' and capabilities->>'execution_enabled'='false' from public.marketing_connections where id=conn),'Business Story capability never enables execution';
 failed:=false;begin perform public.marketing_meta_record_formats(conn,u,2,true);exception when others then failed:=true;end;assert failed,'Wrong generation rejected';
 perform public.marketing_meta_record_formats(conn,u,1,false);
 assert (select not(capabilities->'formats' ? 'story') from public.marketing_connections where id=conn),'Unavailable Business evidence revokes Story capability';
 insert into public.marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,provider_post_id,connection_id,connection_generation,provider_state) values(o,b,(content->>'id')::uuid,1,'instagram','succeeded',now(),e,'9999',conn,1,'{"post_id":"9999"}');
 counts:=marketing_private.creative_publication_counts(o,b,date_trunc('month',now())::date);
 assert counts->>'published_posts'='0' and counts->>'published_reels'='0' and counts->>'undated_publications'='0','Stories do not earn Posts/Reels target credit or poison their date coverage';
 assert not has_function_privilege('authenticated',(select oid from pg_proc where proname='marketing_meta_record_formats'),'execute'),'Business format projection service-only';
end;$formats$;
rollback;
select 'PASS: canonical ordered mixed/Story variants, unsupported media, business/generation projection, execution separation and Post/Reel target isolation; rolled back' result;
