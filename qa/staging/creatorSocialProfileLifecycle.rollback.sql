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
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c jsonb;a jsonb;v jsonb;p jsonb;r jsonb;before_data jsonb;after_data jsonb;request uuid:=gen_random_uuid();denied boolean:=false;
begin
 c:=marketing_creator_command(gen_random_uuid(),o,null,'save_creator',null,0,'{"name":"QA Social Profile Lifecycle"}');
 a:=marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',c->>'id','platform','instagram','handle','feedx_rollback_profile','profile_url','https://www.instagram.com/feedx_rollback_profile/'));
 v:=marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',null,0,jsonb_build_object('title','Rollback profile-linked Collaboration','creator_id',c->>'id','status','planned','cost_state','estimated'));
 p:=marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://www.instagram.com/p/FeedxSocialLifecycleFixture/','creator_id',c->>'id','account_id',a->>'id','collaboration_id',v->>'id','confirm_link',true,'confirm_published',true));
 perform marketing_creator_command(gen_random_uuid(),o,b,'add_metrics',(p->>'id')::uuid,(p->>'revision')::int,jsonb_build_object('metrics',jsonb_build_object('likes',0),'source_note','Synthetic rollback-only fixture','captured_at',now()));
 before_data:=marketing_creator_workspace(o,b);
 r:=marketing_creator_command(request,o,null,'archive_account',(a->>'id')::uuid,(a->>'revision')::int,jsonb_build_object('creator_id',c->>'id'));
 assert (r->>'archived')::boolean;
 assert marketing_creator_command(request,o,null,'archive_account',(a->>'id')::uuid,(a->>'revision')::int,jsonb_build_object('creator_id',c->>'id'))=r,'Replay returns original archive evidence';
 after_data:=marketing_creator_workspace(o,b);
 assert before_data->'posts'=after_data->'posts' and before_data->'collaborations'=after_data->'collaborations' and before_data->'snapshots'=after_data->'snapshots','Linked history and zero metric retained';
 assert (select count(*) from jsonb_array_elements(marketing_creator_directory(o,null)->'accounts') x where x->>'id'=a->>'id' and not (x->>'archived')::boolean)=0,'Removed account not active';
 begin perform marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',c->>'id','platform','instagram','handle','feedx_rollback_profile','profile_url','https://www.instagram.com/feedx_rollback_profile/')); exception when unique_violation then denied:=true;end;
 assert denied,'Removed identity cannot be duplicated';denied:=false;
 begin perform marketing_creator_command(gen_random_uuid(),o,null,'archive_account',(a->>'id')::uuid,(a->>'revision')::int,jsonb_build_object('creator_id',c->>'id'));exception when serialization_failure then denied:=true;end;
 assert denied,'Stale revision denied';
 r:=marketing_creator_command(gen_random_uuid(),o,null,'save_account',(r->>'id')::uuid,(r->>'revision')::int,jsonb_build_object('creator_id',c->>'id','platform','instagram','handle','feedx_rollback_profile','profile_url','https://www.instagram.com/feedx_rollback_profile/'));
 assert r->>'id'=a->>'id' and not (r->>'archived')::boolean,'Same canonical account restored';
 after_data:=marketing_creator_workspace(o,b);
 assert before_data->'posts'=after_data->'posts' and before_data->'collaborations'=after_data->'collaborations' and before_data->'snapshots'=after_data->'snapshots','Restoration preserves linked history';
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),(select id from marketing_qa_ids where key='other_org'),null,'archive_account',(r->>'id')::uuid,(r->>'revision')::int,jsonb_build_object('creator_id',c->>'id'));exception when insufficient_privilege then denied:=true;end;assert denied,'Cross-tenant mutation rejected';
 denied:=false;begin perform marketing_creator_workspace(o,(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Brand isolation remains enforced';
end;$$;
reset role;
rollback;
select 'PASS: archive/replay, linked Post/Collaboration/metric preservation, stale revision, identity-safe restore, duplicate and tenant/Brand isolation; rollback only' verification;
