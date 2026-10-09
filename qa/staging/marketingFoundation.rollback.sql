-- Staging-only L3 rehearsal. Every fixture and mutation is rolled back.
-- Run only against verified ujkzdaaadnvcfayuldmh; no provider call is made.
begin;
-- Do not run the global claim rehearsal alongside configured live accounts.
do $$begin assert not exists(select 1 from public.marketing_connections where status='production_authorized'),'Worker QA requires no configured live Marketing connection';end;$$;
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
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand');
 c uuid; req uuid:=gen_random_uuid(); result jsonb; duplicate jsonb; blocked boolean; configured_role uuid; i integer; media jsonb; body jsonb:='{"title":"QA creative","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"QA approved caption","asset_ids":[]}]}';
begin
 result:=public.marketing_context();
 assert jsonb_array_length(result->'organizations')=1,'Cross-tenant organization leak';
 assert jsonb_array_length(result->'brands')=1,'Brand scope leak';
 result:=public.marketing_read(o,null,'overview');assert (result->'summary'->>'published')::integer=0,'Invented publishing';
 blocked:=false;begin perform public.marketing_read((select id from marketing_qa_ids where key='other_org'),null,'overview');exception when insufficient_privilege then blocked:=true;end;assert blocked,'Other tenant must be denied';
 blocked:=false;begin perform public.marketing_read(o,(select id from marketing_qa_ids where key='other_brand'),'content');exception when insufficient_privilege then blocked:=true;end;assert blocked,'Other brand must be denied';
 blocked:=false;begin perform public.marketing_claim_job();exception when insufficient_privilege then blocked:=true;end;assert blocked,'Browser must never claim external jobs';
 blocked:=false;begin execute 'select * from public.marketing_content';exception when insufficient_privilege then blocked:=true;end;assert blocked,'Direct table reads must be denied';
 blocked:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,'{"title":"Invalid","outlet_ids":[]}');exception when others then blocked:=true;end;assert blocked,'Missing variants must be denied';
 result:=public.marketing_content_command(req,'save',o,b,null,0,body);c:=(result->>'id')::uuid;
 insert into marketing_qa_ids values('content',c);
 duplicate:=public.marketing_content_command(req,'save',o,b,null,0,body);assert duplicate=result,'Create retry must return original result';
 blocked:=false;begin perform public.marketing_content_command(req,'save',o,b,null,0,jsonb_set(body,'{title}','"Changed retry"'));exception when others then blocked:=true;end;assert blocked,'Conflicting retry must fail';
 blocked:=false;begin perform public.marketing_content_command(gen_random_uuid(),'schedule',o,b,c,1,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));exception when others then blocked:=true;end;assert blocked,'Draft scheduling must fail';
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,c,1);
 result:=public.marketing_content_command(gen_random_uuid(),'approve',o,b,c,1);assert result->>'approved_revision'='1','Approval must pin revision';
 result:=public.marketing_content_command(gen_random_uuid(),'save',o,b,c,1,jsonb_set(body,'{title}','"QA revised creative"'));
 assert result->>'revision'='2' and result->>'status'='draft' and result->>'approved_revision' is null,'Material change must invalidate approval';
 blocked:=false;begin perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,c,1);exception when serialization_failure then blocked:=true;end;assert blocked,'Stale revision must fail';
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,c,2);
 perform public.marketing_content_command(gen_random_uuid(),'reject',o,b,c,2,'{"reason":"QA revision requires changes"}');
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,c,2);
 perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,c,2);
 req:=gen_random_uuid();body:=jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur');
 result:=public.marketing_content_command(req,'schedule',o,b,c,2,body);
 assert result->>'status'='scheduled','Approved schedule must persist';
 duplicate:=public.marketing_content_command(req,'schedule',o,b,c,2,body);assert duplicate=result,'Schedule retry must not duplicate jobs';
 result:=public.marketing_read(o,b,'overview');
 assert jsonb_array_length(result->'jobs')=1 and result->'jobs'->0->>'state'='blocked','Unauthorized delivery must be visibly blocked';
 assert result->'jobs'->0->>'provider_post_id' is null and result->'jobs'->0->>'attempts'='0','No simulated provider delivery';
 assert result->'evidence'->>'conversions'='unavailable','Conversions must remain unavailable';
 result:=public.marketing_read(o,b,'calendar',now(),now()+interval '2 days');assert result->>'total'='1','Calendar must include schedule';
 result:=public.marketing_content_detail(c);assert jsonb_array_length(result->'events')>=6,'Audit evidence missing';
 perform public.marketing_content_command(gen_random_uuid(),'cancel',o,b,c,2);
 result:=public.marketing_read(o,b,'content');assert result->'jobs'->0->>'state'='cancelled','Cancellation must stop unexecuted job';
 perform public.marketing_save_knowledge(b,0,'{"voice":{"text":"Warm and clear","provenance":"verified_brand_fact"}}');
 blocked:=false;begin perform public.marketing_save_knowledge(b,0,'{}');exception when serialization_failure then blocked:=true;end;assert blocked,'Knowledge lost update must fail';
 blocked:=false;begin perform public.marketing_save_knowledge(b,1,'{"voice":{"text":"Unverified"}}');exception when others then blocked:=true;end;assert blocked,'Missing provenance must fail';
 blocked:=false;begin perform public.marketing_finalize_asset(gen_random_uuid());exception when others then blocked:=true;end;assert blocked,'Unknown media must fail';
 media:=public.marketing_prepare_asset(o,b,'qa.png','image/png',100);
 assert public.marketing_storage_access(media->>'object_path',true),'Prepared upload must be scoped to uploader';
 assert not public.marketing_storage_access(media->>'object_path',false),'Unfinalized upload must not be readable';
 blocked:=false;begin perform public.marketing_finalize_asset((media->>'id')::uuid);exception when others then blocked:=true;end;assert blocked,'Missing object cannot finalize';
 result:=public.save_role_configuration(gen_random_uuid(),jsonb_build_object('name','qa_marketing_saved_'||req,'is_active',true,'outlet_access_type','none'),array['marketing_workspace.access','marketing_content.view'],'{}'::uuid[]);
 configured_role:=(result->'role'->>'id')::uuid;
 insert into marketing_qa_ids values('configured_role',configured_role);
 assert configured_role is not null and jsonb_array_length(result->'permissions')=2,'Canonical role save must persist exact Marketing permissions';
 perform public.marketing_set_role_scope(o,configured_role,false,array[b]);
 blocked:=false;begin perform public.marketing_set_role_scope(o,configured_role,true,'{}'::uuid[]);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Selected-brand manager cannot grant future all-brand authority';
 for i in 1..25 loop
  result:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,jsonb_build_object('title','QA paged creative '||i,'outlet_ids','[]'::jsonb,'variants','[{"channel":"facebook","format":"text","caption":"QA caption","asset_ids":[]}]'::jsonb));
  perform public.marketing_content_command(gen_random_uuid(),'review',o,b,(result->>'id')::uuid,1);
 end loop;
 result:=public.marketing_listing(o,null,'approvals',1,20);assert result->>'total_count'='25' and jsonb_array_length(result->'rows')=20,'Approval paging requires an authoritative total';
 result:=public.marketing_listing(o,b,'approvals',2,20);assert jsonb_array_length(result->'rows')=5,'Older approvals must remain reachable';
 result:=public.marketing_listing(o,b,'jobs');assert result->>'total_count'='1','Job list total must be canonical';
 result:=public.marketing_setup_options(o);assert jsonb_typeof(result->'roles')='array','Setup options contract';
 assert jsonb_array_length(result->'employees')=1 and result->'employees'->0->>'id'=(select id::text from marketing_qa_ids where key='employee'),'Employee picker must respect canonical People visibility';
 blocked:=false;begin perform public.platform_organization_command('add_member',o,jsonb_build_object('employee_id',(select id from marketing_qa_ids where key='other_employee')));exception when insufficient_privilege then blocked:=true;end;assert blocked,'Membership insertion must enforce target visibility';
 for i in 1..105 loop
  result:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,jsonb_build_object('title','QA calendar job '||i,'outlet_ids','[]'::jsonb,'variants','[{"channel":"facebook","format":"text","caption":"QA calendar caption","asset_ids":[]}]'::jsonb));
  perform public.marketing_content_command(gen_random_uuid(),'review',o,b,(result->>'id')::uuid,1);
  perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,(result->>'id')::uuid,1);
  perform public.marketing_content_command(gen_random_uuid(),'schedule',o,b,(result->>'id')::uuid,1,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));
 end loop;
 result:=public.marketing_read(o,b,'calendar',now(),now()+interval '2 days',6,20);
 assert result->>'total'='106' and jsonb_array_length(result->'rows')=6 and jsonb_array_length(result->'jobs')=6,'Every paged calendar record needs its delivery state beyond 100 jobs';
 assert not exists(select 1 from jsonb_array_elements(result->'jobs') job where not exists(select 1 from jsonb_array_elements(result->'rows') row where row->>'id'=job->>'content_id')),'Calendar jobs must match displayed records';
end; $$;
reset role;
-- Existing grants outside the manager's brands are neither disclosed nor overwritten.
delete from public.marketing_role_brands where role_id=(select id from marketing_qa_ids where key='configured_role');
insert into public.marketing_role_brands select (select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='configured_role'),(select id from marketing_qa_ids where key='other_brand');
set local role authenticated;
do $$declare result jsonb; denied boolean:=false;begin
 result:=public.marketing_read((select id from marketing_qa_ids where key='org'),null,'settings');
 assert not exists(select 1 from jsonb_array_elements(result->'role_scopes') s where s->>'role_id'=(select id::text from marketing_qa_ids where key='configured_role')),'Hidden brand grants cannot leak through Settings';
 begin perform public.marketing_set_role_scope((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='configured_role'),false,array[(select id from marketing_qa_ids where key='brand')]);exception when insufficient_privilege then denied:=true;end;
 assert denied,'A brand manager cannot overwrite role grants outside their management scope';
end;$$;
reset role;
set local role service_role;
do $$begin assert public.marketing_claim_job() is null,'No job may execute without production authorization';end;$$;
reset role;
-- Exercise worker leases without a provider receipt or any network request.
-- Connection/reference values below are rollback-only fixtures, never real credentials.
update public.marketing_content set status='scheduled' where id=(select id from marketing_qa_ids where key='content');
update public.marketing_jobs set state='blocked',due_at=now()-interval '1 minute' where content_id=(select id from marketing_qa_ids where key='content');
insert into public.marketing_connections(organization_id,brand_id,channel,status,capabilities,expires_at)
select (select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),'facebook','test_authorized','{"publishing":true}',now()+interval '1 day';
insert into marketing_private.credentials select id,'rollback-only-unusable-reference' from public.marketing_connections where organization_id=(select id from marketing_qa_ids where key='org');
set local role service_role;
do $$begin assert public.marketing_claim_job() is null,'Test authorization cannot claim live jobs';end;$$;
reset role;
update public.marketing_connections set status='production_authorized',expires_at=now()-interval '1 minute' where organization_id=(select id from marketing_qa_ids where key='org');
set local role service_role;
do $$begin assert public.marketing_claim_job() is null,'Expired authorization cannot claim jobs';end;$$;
reset role;
update public.marketing_connections set expires_at=now()+interval '1 day' where organization_id=(select id from marketing_qa_ids where key='org');
set local role service_role;
do $$declare job jsonb; denied boolean:=false;begin
 job:=public.marketing_claim_job();
 assert job->>'state'='leased' and job->>'attempts'='1','Authorized claim must lease exactly once';
 assert public.marketing_claim_job() is null,'Leased job cannot be claimed again';
 begin perform public.marketing_finish_job((job->>'id')::uuid,(job->>'lease_token')::uuid,'published');exception when others then denied:=true;end;
 assert denied,'Missing provider receipt must never publish';
 job:=public.marketing_finish_job((job->>'id')::uuid,(job->>'lease_token')::uuid,'uncertain',null,'qa_no_network_response');
 assert job->>'state'='reconciling' and job->>'provider_post_id' is null,'Uncertain result must require reconciliation';
 assert public.marketing_claim_job() is null,'Uncertain result cannot trigger a duplicate send';
end;$$;
reset role;
-- Revocation is revalidated on subsequent reads and command retries.
delete from public.organization_memberships where organization_id=(select id from marketing_qa_ids where key='org');
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform public.marketing_read((select id from marketing_qa_ids where key='org'),null,'content');exception when insufficient_privilege then denied:=true;end;
 assert denied,'Revoked membership must be denied';
end;$$;
reset role;
-- Explicit privilege checks include public/anon and service-only execution boundaries.
do $$begin
 assert not has_function_privilege('anon','public.marketing_context()','execute'),'Anonymous context access';
 assert not has_function_privilege('authenticated','public.marketing_finish_job(uuid,uuid,text,text,text)','execute'),'Browser job completion access';
 assert has_function_privilege('service_role','public.marketing_claim_job()','execute'),'Worker claim missing';
 assert not has_table_privilege('authenticated','marketing_private.credentials','select'),'Credential leak';
 assert not exists(select 1 from public.marketing_jobs where organization_id=(select id from marketing_qa_ids where key='org') and provider_post_id is not null),'Provider receipt fabricated during test';
end;$$;
rollback;
