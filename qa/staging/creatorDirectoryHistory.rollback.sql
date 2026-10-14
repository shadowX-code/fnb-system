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

-- Only disposable fixture membership scope is expanded, then revoked, in this rollback transaction.
insert into platform_member_brands(organization_id,employee_id,brand_id) select (select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='employee'),(select id from marketing_qa_ids where key='other_brand');
insert into marketing_role_brands select (select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='role'),(select id from marketing_qa_ids where key='other_brand');
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');b2 uuid:=(select id from marketing_qa_ids where key='other_brand');c jsonb;empty_c jsonb;hidden_c jsonb;d jsonb;v jsonb;p jsonb;h jsonb;s text;
begin
 c:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"QA Shared History"}');
 empty_c:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"QA Assignment Only"}');
 hidden_c:=public.marketing_creator_command(gen_random_uuid(),o,b2,'save_creator',null,0,'{"name":"QA HIDDEN Brand Creator"}');
 foreach s in array array['completed','cancelled'] loop
 v:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',null,0,jsonb_build_object('title','QA Historical '||s,'creator_id',c->>'id','status','planned','cost_state','estimated','deliverables','[]'::jsonb));
 end loop;
 v:=public.marketing_creator_command(gen_random_uuid(),o,b2,'save_collaboration',null,0,jsonb_build_object('title','QA Other Authorized Brand','creator_id',c->>'id','status','planned','cost_state','estimated','deliverables','[]'::jsonb));
 p:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://instagram.com/p/FeedxBrandHistoryQa/','creator_id',c->>'id','confirm_link',true,'confirm_published',true));
 d:=public.marketing_creator_directory(o,b);
 select x->'collaboration_history' into h from jsonb_array_elements(d->'creators') x where x->>'id'=c->>'id';
 assert jsonb_array_length(h)=2,'Selected Brand lists full authorized Brand history for its visible Creators';
 assert (select x->>'collaboration_count' from jsonb_array_elements(h) x where x->>'brand_id'=b::text)='2','Two distinct historical Collaborations count; organic Post does not';
 assert (select x->>'collaboration_count' from jsonb_array_elements(h) x where x->>'brand_id'=b2::text)='1';
 assert (select x->'collaboration_history' from jsonb_array_elements(d->'creators') x where x->>'id'=empty_c->>'id')='[]'::jsonb,'Brand assignment alone is not Collaboration history';
 d:=public.marketing_creator_workspace(o,b);
 assert jsonb_array_length(d->'collaborations')=2,'Other Brand full records are not loaded by selected-Brand workspace';
 assert (select x->'collaboration_history' from jsonb_array_elements(d->'creators') x where x->>'id'=c->>'id')=h;
 insert into marketing_qa_ids values('creator', (c->>'id')::uuid),('empty_creator',(empty_c->>'id')::uuid),('hidden_creator',(hidden_c->>'id')::uuid);
end;$$;
reset role;
-- Historical status is seeded only on disposable records; current commands no longer create Completed/Cancelled.
update marketing_creator_collaborations set status=case when title='QA Historical completed' then 'completed' else 'cancelled' end where organization_id=(select id from marketing_qa_ids where key='org') and title in ('QA Historical completed','QA Historical cancelled');
delete from platform_member_brands where organization_id=(select id from marketing_qa_ids where key='org') and employee_id=(select id from marketing_qa_ids where key='employee') and brand_id=(select id from marketing_qa_ids where key='other_brand');
delete from marketing_role_brands where organization_id=(select id from marketing_qa_ids where key='org') and role_id=(select id from marketing_qa_ids where key='role') and brand_id=(select id from marketing_qa_ids where key='other_brand');
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');d jsonb;h jsonb;denied boolean:=false;
begin
 d:=public.marketing_creator_directory(o,b);
 select x->'collaboration_history' into h from jsonb_array_elements(d->'creators') x where x->>'id'=(select id::text from marketing_qa_ids where key='creator');
 assert jsonb_array_length(h)=1,'Revoked Brand disappears from existing shared Creator summary';
 assert not (d::text like '%'||(select id::text from marketing_qa_ids where key='other_brand')||'%'),'No unauthorized Brand identity or count in projection';
 assert not (public.marketing_creator_directory(o,null)::text like '%QA HIDDEN Brand Creator%'),'Unauthorized Creator is excluded';
 begin perform public.marketing_creator_directory(o,(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied;
 assert not has_function_privilege('anon','public.marketing_creator_directory(uuid,uuid)','execute');
end;$$;
reset role;
rollback;
select 'PASS: grouped distinct Collaboration counts, historical cancelled/completed inclusion, Post/assignment exclusion, complete authorized history under Brand filter, empty state, revocation and unauthorized Brand/Creator denial; all fixtures rolled back' verification;
