-- Staging-only L3 rehearsal. Every fixture and mutation is rolled back.
-- Run only against verified ujkzdaaadnvcfayuldmh; no provider call is made.
begin;
-- Do not run the global claim rehearsal alongside configured live accounts.
do $$begin assert not exists(select 1 from public.marketing_connections where capabilities->>'execution_enabled'='true'),'Worker QA requires no configured live Marketing connection';end;$$;
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
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand'); c uuid; result jsonb; body jsonb; req uuid:=gen_random_uuid(); denied boolean;
begin
 body:='{"title":"QA dated concept","planned_at":"2026-05-10T01:00:00Z","planned_timezone":"Asia/Kuala_Lumpur","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"QA caption","asset_ids":[]},{"channel":"instagram","format":"image","caption":"QA IG caption","asset_ids":[]}]}'::jsonb;
 result:=marketing_content_command(req,'save',o,b,null,0,body);c:=(result->>'id')::uuid;
 insert into marketing_qa_ids values('content',c);
 assert marketing_content_command(req,'save',o,b,null,0,body)=result,'Planning retry must preserve one revision';
 perform marketing_content_command(gen_random_uuid(),'save',o,b,null,0,body-'planned_at'-'planned_timezone');
 result:=marketing_content_management(o,b);
 assert result->>'total_count'='1','Unscheduled drafts must stay out of Content Management';
 assert result->'rows'->0->>'planned_at'='2026-05-10T01:00:00+00:00','Planned time must be distinct';
 assert result->'rows'->0->>'scheduled_at' is null and result->'rows'->0->>'actual_at' is null,'Planning must not invent schedule or actual publication';
 assert jsonb_array_length(result->'rows'->0->'channels')=2,'Concept variants must remain grouped';
 denied:=false;begin perform marketing_content_management(o,(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Brand scope bypass';
 denied:=false;begin perform marketing_content_management((select id from marketing_qa_ids where key='other_org'));exception when insufficient_privilege then denied:=true;end;assert denied,'Tenant scope bypass';
 denied:=false;begin perform marketing_content_command(gen_random_uuid(),'save',o,b,c,1,jsonb_set(body,'{planned_timezone}','"Not/A_Zone"'));exception when others then denied:=true;end;assert denied,'Invalid planning timezone';
 result:=marketing_content_management(o,b,p_search=>'caption',p_channel=>'instagram',p_status=>'draft');assert result->>'total_count'='1','Caption/channel/status filters must share records';
 result:=marketing_content_management(o,b,p_from=>'2026-05-09T16:00:00Z',p_to=>'2026-05-10T16:00:00Z',p_view=>'calendar');assert result->>'total_count'='1','KL calendar bounds';
 denied:=false;begin perform marketing_content_management(o,b,p_from=>'2026-05-01T00:00:00Z',p_to=>'2026-08-01T00:00:00Z',p_view=>'calendar');exception when others then denied:=true;end;assert denied,'Unbounded calendar';
 -- Canonical review/approval remains revision-bound when only the planned date changes.
 body:=jsonb_set(body,'{variants}','[{"channel":"facebook","format":"text","caption":"QA approved","asset_ids":[]}]');
 result:=marketing_content_command(gen_random_uuid(),'save',o,b,c,1,body);
 perform marketing_content_command(gen_random_uuid(),'review',o,b,c,2);
 perform marketing_content_command(gen_random_uuid(),'approve',o,b,c,2);
 result:=marketing_content_command(gen_random_uuid(),'save',o,b,c,2,jsonb_set(body,'{planned_at}','"2026-05-10T02:00:00Z"'));
 assert result->>'revision'='3' and result->>'approved_revision' is null and result->>'status'='draft','Plan changes must invalidate approval';
 perform marketing_content_command(gen_random_uuid(),'review',o,b,c,3);
 result:=marketing_content_management(o,b,p_status=>'review');assert result->>'total_count'='1','Dated pending approvals';
 perform marketing_content_command(gen_random_uuid(),'approve',o,b,c,3);
 perform marketing_content_command(gen_random_uuid(),'schedule',o,b,c,3,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));
end;$$;
reset role;
-- Synthetic provider evidence exists only in this rollback transaction; no network calls.
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand'); c uuid:=(select id from marketing_qa_ids where key='content'); conn uuid; i integer; result jsonb;
begin
 insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,credential_generation) values(o,b,'facebook','1001',2) returning id into conn;
 insert into marketing_qa_ids values('connection',conn);
 for i in 1..130 loop
  insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,caption,published_at,metrics)
  values(o,b,conn,2,'1001','1001_'||i,'facebook','QA external '||i,'2026-05-10T03:00:00Z','{"reach":0,"likes":0,"comments":0,"shares":0}');
 end loop;
 -- Same account/post across reconnect generations: one latest observation.
 insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,caption,published_at,metrics,observed_at)
 values(o,b,conn,1,'1001','1001_1','facebook','Older duplicate','2026-05-10T03:00:00Z','{}',now()-interval '1 hour');
 -- Same post ID on a distinct channel account is NOT a duplicate.
 insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,credential_generation) values(o,b,'instagram','1002',2) returning id into conn;
 insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,caption,published_at)
 values(o,b,conn,2,'1002','1001_1','instagram','Different channel account','2026-05-10T04:00:00Z');
 -- Match the existing FeedX receipt rather than duplicating it as an external post.
 update marketing_jobs set state='succeeded',provider_post_id='1001_2',connection_id=(select id from marketing_qa_ids where key='connection'),connection_generation=2 where content_id=c;
 update marketing_content set status='published' where id=c;
end;$$;
set local role authenticated;
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand'); result jsonb; c jsonb; denied boolean;
begin
 result:=marketing_content_management(o,b);
 assert result->>'total_count'='131','Account/generation dedupe and FeedX receipt merge must not lose independent posts';
 assert jsonb_array_length(result->'rows')=20,'List must be bounded';
 result:=marketing_content_management(o,b,p_page=>7);
 assert jsonb_array_length(result->'rows')=11,'Final page';
 result:=marketing_content_management(o,b,p_from=>'2026-05-09T16:00:00Z',p_to=>'2026-05-10T16:00:00Z',p_view=>'calendar');
 assert result->'day_counts'->>'2026-05-10'='131','Busy days must count every matching concept, beyond first 100';
 assert jsonb_array_length(result->'rows')=3,'Calendar previews must be bounded per day';
 result:=marketing_content_management(o,b,p_search=>'QA dated');c:=result->'rows'->0;
 assert result->>'total_count'='1' and c->>'origin'='feedx','Published FeedX receipt must remain with concept';
 assert c->>'actual_at'='2026-05-10T03:00:00+00:00' and c->>'planned_at'='2026-05-10T02:00:00+00:00' and c->>'scheduled_at' is not null,'Three timestamps must remain independent';
 result:=marketing_content_management(o,b,p_search=>'Older duplicate');assert result->>'total_count'='0','Latest observation wins';
 result:=marketing_content_management(o,b,p_channel=>'instagram');assert result->>'total_count'='1','Independent account identity survives';
 denied:=false;begin execute 'select * from marketing_social_posts';exception when insufficient_privilege then denied:=true;end;assert denied,'Browser must not bypass projection';
end;$$;
reset role;
-- The read permission remains independent from Content Library actions.
delete from role_permissions where role_id=(select id from marketing_qa_ids where key='role') and permission_id=(select id from permissions where code='marketing_calendar.view');
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform marketing_content_management((select id from marketing_qa_ids where key='org'));exception when insufficient_privilege then denied:=true;end;
 assert denied,'Content permission must not substitute for Management view permission';
end;$$;
reset role;
select 'Marketing Content Management L3 rehearsal passed' as result;
rollback;
