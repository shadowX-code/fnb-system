-- Staging-only changed live-delivery authorities, no provider calls.
begin;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code='platform_organizations.manage' or code in ('roles.create','roles.edit','roles.view','employees.view');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
 values(e,u,'QA Marketing Rollback','marketing-rollback-'||u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Marketing Organization'),(other_o,'QA Other Tenant');
 insert into public.organization_memberships values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Authorized Brand'),(other_b,o,'QA Restricted Brand');
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 insert into public.platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;


create temporary table measurements(label text,before_value bigint,after_value bigint);
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');e uuid:=(select id from marketing_qa_ids where key='employee');u uuid:=(select id from marketing_qa_ids where key='user');conn uuid:=gen_random_uuid();c jsonb;p jsonb;old_read jsonb;new_read jsonb;page jsonb;cursor jsonb:=null;seen uuid[]:='{}';s jsonb;payload jsonb;denied boolean;content_id uuid:=gen_random_uuid();a uuid;eligible uuid:=gen_random_uuid();claim jsonb;v1 jsonb;v2 jsonb;started timestamptz;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 c:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"Disposable bounded history"}');
 p:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://www.instagram.com/p/FeedxBoundedQa/','creator_id',c->>'id','confirm_link',true));
 insert into public.marketing_creator_metric_snapshots(post_id,metrics,source,source_note,captured_at,recorded_by,request_id)
 select (p->>'id')::uuid,jsonb_build_object('views',n,'likes',0),'manual','Disposable QA',now()-interval '1 hour',e,gen_random_uuid() from generate_series(1,501) n;
 old_read:=public.marketing_creators_read(o,b);new_read:=public.marketing_creator_workspace(o,b);
 assert jsonb_array_length(old_read->'snapshots')=501 and jsonb_array_length(new_read->'snapshots')=0;
 assert old_read->'posts'=new_read->'posts','Latest metric evidence preserved';
 assert new_read->'posts'->0->>'snapshot_count'='501';
 loop
  page:=public.marketing_creator_metric_history(o,(p->>'id')::uuid,cursor,25);
  assert jsonb_array_length(page->'rows')<=25;
  for s in select * from jsonb_array_elements(page->'rows') loop assert not(s->>'id')::uuid=any(seen),'Cursor must not repeat tied observations';seen:=array_append(seen,(s->>'id')::uuid);end loop;
  cursor:=page->'next';exit when cursor is null or cursor='null';
 end loop;
 assert cardinality(seen)=501,'Complete history available without truncation';
 insert into measurements values('Creator workspace snapshot rows',501,0),('Creator workspace JSON bytes',octet_length(old_read::text),octet_length(new_read::text));
 denied:=false;begin perform public.marketing_creator_metric_history((select id from marketing_qa_ids where key='other_org'),(p->>'id')::uuid);exception when insufficient_privilege then denied:=true;end;assert denied;
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,capabilities,credential_generation) values(conn,o,b,'facebook','999999999998','Disposable read fixture','not_connected','{"execution_enabled":false}',1);
 insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,provider_account_id,channel,caption,published_at,observed_at,metrics)
 select o,b,conn,n,'same-post','same-account','facebook','Disposable metrics','2026-10-11T00:00:00Z','2026-10-12T00:00:00Z'::timestamptz+n*interval '1 second',case when n=500 then '{"views":0}'::jsonb else '{"views":9,"interactions":3}'::jsonb end from generate_series(1,500)n;
 started:=clock_timestamp();new_read:=public.marketing_social_publications(o,b,'2026-10-01','2026-10-31');
 assert jsonb_array_length(new_read->'posts')=1;
 s:=new_read->'posts'->0;assert s->'metrics'->>'views'='0';assert not s->'metrics' ? 'interactions','Old grant metrics cannot supplement current generation';
 assert jsonb_array_length(public.marketing_social_publications(o,b,'2026-09-01','2026-09-30')->'posts')=0;
 insert into measurements values('Social API requests for 500 observations',25,1),('Social returned observation rows',500,1),('Social publication read milliseconds',null,extract(epoch from clock_timestamp()-started)*1000);
 -- Shared content projection retains exact Content Management semantics.
 insert into public.marketing_content(id,organization_id,brand_id,status,created_by) values(content_id,o,b,'review',e);
 insert into public.marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(content_id,1,'{"title":"Disposable review","planned_at":"2026-10-15T02:00:00Z","variants":[{"channel":"facebook","caption":"QA","asset_ids":[]}]}',e);
 old_read:=public.marketing_content_management(o,b);
 new_read:=public.marketing_dashboard_operations(o,b);
 assert jsonb_array_length(new_read->'content')=1;
 assert new_read->'content'->0->>'id'=content_id::text;
 assert jsonb_array_length(new_read->'conversations')=0;
 assert jsonb_array_length(public.marketing_planner_publishing(o,b,'2026-10-01','2026-11-01')->'rows')=2,'Visible month includes one concept and one unique external post';
 denied:=false;begin perform public.marketing_dashboard_operations(o,(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied;
 -- Queue hints change only disposable assets; no object deletion or finish is invoked.
 for i in 1..26 loop
  a:=gen_random_uuid();insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by,storage_policy,cleanup_checked_at,created_at)
  values(a,o,b,'Disposable protected.png','image/png',8,'qa/'||a,'ready',e,'temporary','1900-01-01','2000-01-01'::timestamptz+i*interval '1 second');
  insert into public.marketing_creators(organization_id,name,avatar_asset_id,created_by,updated_by) values(o,'Disposable retention reference',a,e,e);
 end loop;
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by,storage_policy,cleanup_checked_at,created_at)
 values(eligible,o,b,'Disposable reclaimable.png','image/png',8,'qa/'||eligible,'ready',e,'temporary','1900-01-01','2000-02-01');
 update public.marketing_assets set snapshot_verified_at=now() where id=eligible;
 payload:=jsonb_build_object('title','Disposable completed content','variants',jsonb_build_array(jsonb_build_object('channel','facebook','asset_ids',jsonb_build_array(eligible))));
 content_id:=gen_random_uuid();insert into public.marketing_content(id,organization_id,brand_id,status,created_by) values(content_id,o,b,'published',e);
 insert into public.marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(content_id,1,payload,e);
 insert into public.marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,provider_post_id,connection_id,connection_generation)
 values(o,b,content_id,1,'facebook','succeeded',now(),e,'same-post',conn,500);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 claim:=public.marketing_media_cleanup_claim();assert claim is null,'First batch checks only 25 protected fixtures';
 assert (select count(*) from public.marketing_assets where organization_id=o and cleanup_checked_at>'1900-01-02')=25;
 claim:=public.marketing_media_cleanup_claim();assert claim->>'id'=eligible::text,'Later eligible asset progresses past protected head';
 assert (select count(*) from public.marketing_assets where organization_id=o and state='retiring')=1;
 assert not has_function_privilege('authenticated','public.marketing_media_cleanup_claim()','execute');
 insert into measurements values('Cleanup candidates per claim',null,25);
end;$$;
select * from measurements;
rollback;
