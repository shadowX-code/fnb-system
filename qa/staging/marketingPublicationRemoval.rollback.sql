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

do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');e uuid:=(select id from marketing_qa_ids where key='employee');fb uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();c uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();
begin
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,credential_generation,connected_by,connected_at,sync_lease,sync_lease_until)
 values(fb,o,b,'facebook','999999999998','QA removal FB','test_authorized',now()+interval '1 day','{"posts":false,"execution_enabled":false}',1,e,now()-interval '1 day',lease,now()+interval '1 hour'),(ig,o,b,'instagram','999999999997','QA removal IG','test_authorized',now()+interval '1 day','{"posts":false,"execution_enabled":false}',1,e,now()-interval '1 day',null,null);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(fb,'qa-rolled-back','{}','888',now()+interval '1 day');
 insert into marketing_content(id,organization_id,brand_id,status,revision,approved_revision,created_by) values(c,o,b,'published',1,null,e);
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(c,1,'{"title":"QA immutable receipt","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"QA only","asset_ids":[]},{"channel":"instagram","format":"image","caption":"QA only","asset_ids":[]}]}',e);
 update marketing_content set approved_revision=1 where id=c;
 insert into marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,provider_post_id,connection_id,connection_generation)
 values(o,b,c,1,'facebook','succeeded',now(),e,'999999999998_777',fb,1),(o,b,c,1,'instagram','succeeded',now(),e,'999997700',ig,1);
 insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,published_at,metrics)
 values(o,b,fb,1,'999999999998','999999999998_777','facebook',now(),'{"views":17}'),(o,b,ig,1,'999999999997','999997700','instagram',now(),'{"views":23}');
 insert into marketing_qa_ids values('fb',fb),('ig',ig),('content',c),('lease',lease),('manual_request',gen_random_uuid());
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$
declare f uuid:=(select id from marketing_qa_ids where key='fb');i uuid:=(select id from marketing_qa_ids where key='ig');req uuid:=(select id from marketing_qa_ids where key='manual_request');o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');r jsonb; denied boolean:=false;
begin
 r:=marketing_publication_availability_command(req,f,'999999999998_777',0,'mark_removed');
 assert r->>'state'='manually_removed','Manual source distinct';
 assert r->'manual_confirmation'->>'actor_name'='QA Marketing Rollback','Server actor';
 assert r=marketing_publication_availability_command(req,f,'999999999998_777',0,'mark_removed'),'Idempotent request';
 begin perform marketing_publication_availability_command(gen_random_uuid(),f,'999999999998_777',0,'mark_removed');exception when others then denied:=true;end;assert denied,'Stale confirmation denied';
 denied:=false;begin perform marketing_publication_availability_command(req,i,'999997700',0,'mark_removed');exception when others then denied:=true;end;assert denied,'Changed request payload denied';
 denied:=false;begin perform marketing_publication_availability_command(gen_random_uuid(),f,'999999999998_999',0,'mark_removed');exception when insufficient_privilege then denied:=true;end;assert denied,'Unknown identity denied';
 r:=marketing_content_management(o,b,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',false);
 assert (r->>'total_count')::int=1,'Partial removal stays on Calendar';
 perform marketing_publication_availability_command(gen_random_uuid(),i,'999997700',0,'mark_removed');
 r:=marketing_content_management(o,b,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',false);
 assert (r->>'total_count')::int=0 and r->'day_counts'='{}','Fully removed hidden with correct counts';
 r:=marketing_content_management(o,b,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',true);
 assert (r->>'total_count')::int=1,'Show Removed restores history';
 assert (marketing_content_management(o,b)->>'total_count')::int=1,'List retains all';
 perform marketing_publication_availability_command(gen_random_uuid(),i,'999997700',1,'clear_manual');
 assert (marketing_content_management(o,b,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',false)->>'total_count')::int=1,'Clear confirmation restores Calendar';
 perform marketing_publication_availability_command(gen_random_uuid(),i,'999997700',2,'mark_removed');
 r:=marketing_content_detail((select id from marketing_qa_ids where key='content'));
 assert r->'content'->>'status'='published' and r->'content'->'channels'->0->'availability'->>'state'='manually_removed','Detail keeps Published and projects manual evidence';
end;$$;
reset role;
do $$
declare f uuid:=(select id from marketing_qa_ids where key='fb');l uuid:=(select id from marketing_qa_ids where key='lease');r jsonb;
begin
 perform marketing_private.record_publication_availability(f,1,l,'[{"id":"999999999998_777","state":"access_restricted","source":"object_read","reason":"permission_or_token"}]');
 r:=marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777');
 assert r->>'state'='manually_removed' and r->>'provider_state'='access_restricted','Ambiguous provider failure retains manual evidence';
 perform marketing_private.record_publication_availability(f,1,l,'[{"id":"999999999998_777","state":"available","source":"object_read","reason":"provider_observed"}]');
 assert marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777')->>'state'='manually_removed','In-flight pre-confirmation read cannot recover';
 l:=gen_random_uuid();update marketing_connections set sync_lease=l where id=f;
 perform marketing_private.record_publication_availability(f,1,l,'[{"id":"999999999998_777","state":"available","source":"owned_feed","reason":"provider_observed"}]');
 assert marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777')->>'state'='manually_removed','List echo cannot contradict confirmation';
 perform marketing_private.record_publication_availability(f,1,l,'[{"id":"999999999998_777","state":"available","source":"object_read","reason":"provider_observed"}]');
 r:=marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777');
 assert r->>'state'='available' and r->'manual_confirmation'->>'state'='conflict','Fresh exact positive read exposes conflict';
 perform marketing_private.record_publication_availability(f,1,l,'[{"id":"999999999998_777","state":"unavailable","source":"object_read","reason":"object_missing_or_unreadable"}]');
 assert marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777')->>'state'='unavailable','Missing data never becomes deletion';
 assert marketing_meta_publication_events(jsonb_build_array(jsonb_build_object('source','signed_page_feed_remove','account_id','999999999998','id','999999999998_777','fingerprint',repeat('a',64),'occurred_at',extract(epoch from clock_timestamp()+interval '1 second'))))=1,'Signed provider authority remains independent';
 assert marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777')->>'state'='deleted','Provider confirmation distinct';
 update marketing_connections set credential_generation=2 where id=f;
 r:=marketing_private.publication_availability_projection(f,2,'999999999998','999999999998_777');
 assert r->>'state'='deleted' and r->'manual_confirmation'->>'state'='conflict','Same-account history survives generation advance';
 assert not has_function_privilege('anon','public.marketing_publication_availability_command(uuid,uuid,text,integer,text)','execute'),'Anonymous command denied';
 assert not has_table_privilege('authenticated','marketing_private.publication_availability','update'),'No client table mutation';
 assert (select count(*)=2 from marketing_jobs where content_id=(select id from marketing_qa_ids where key='content') and state='succeeded'),'Receipts untouched';
 assert (select sum((metrics->>'views')::int)=40 from marketing_social_posts where brand_id=(select id from marketing_qa_ids where key='brand')),'Historical metrics intact';
end;$$;
set local role authenticated;
do $$declare denied boolean:=false;begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from employees where id=(select id from marketing_qa_ids where key='other_employee')),'role','authenticated')::text,true);
 begin perform marketing_publication_availability_command(gen_random_uuid(),(select id from marketing_qa_ids where key='fb'),'999999999998_777',1,'clear_manual');exception when insufficient_privilege then denied:=true;end;assert denied,'Other employee without Brand grant denied';
end;$$;
reset role;
select 'manual/provider evidence, replay, conflicts, authorization, receipt preservation and Calendar/List/Detail passed' result;
rollback;
