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


set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c jsonb;p jsonb;r jsonb;denied boolean;
begin
 c:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"Disposable authenticated read"}');
 p:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://instagram.com/p/FeedxAuthenticatedRead/','creator_id',c->>'id','confirm_link',true));
 assert jsonb_array_length(public.marketing_creator_workspace(o,b)->'creators')=1;
 assert public.marketing_creator_metric_history(o,(p->>'id')::uuid)->>'total'='0';
 assert jsonb_array_length(public.marketing_dashboard_operations(o,b)->'content')=0;
 assert jsonb_array_length(public.marketing_social_publications(o,b,'2026-10-01','2026-10-31')->'posts')=0;
 assert jsonb_array_length(public.marketing_planner_publishing(o,b,'2026-10-01','2026-11-01')->'rows')=0;
 denied:=false;begin perform public.marketing_creator_workspace(o,(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied;
 assert not has_schema_privilege('authenticated','marketing_private','USAGE'),'Private helper schema remains inaccessible';
 assert not has_function_privilege('anon','public.marketing_creator_workspace(uuid,uuid)','execute');
end;$$;
reset role;
do $$declare r uuid:=gen_random_uuid();begin
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_read_denial_'||r,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code='marketing_workspace.access';
 update public.employees set role_id=r where id=(select id from marketing_qa_ids where key='employee');
end;$$;
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');denied boolean:=false;r jsonb;begin
 begin perform public.marketing_creator_workspace(o,b);exception when insufficient_privilege then denied:=true;end;assert denied;
 r:=public.marketing_dashboard_operations(o,b);assert r->'content'='null'::jsonb and r->'conversations'='null'::jsonb,'Missing module permissions never expose source rows';
end;$$;
reset role;
rollback;
select 'PASS: actual authenticated SQL role, authorized reads, restricted Brand/module denial, private helper and anonymous execution denial; all fixtures rolled back' verification;
