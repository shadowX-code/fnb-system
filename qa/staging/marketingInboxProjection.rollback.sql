-- Staging-only projection rehearsal: disposable records, no providers or execution changes.
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
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;

do $$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand'); e uuid:=(select id from marketing_qa_ids where key='employee'); conn uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d1 uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();
begin
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,capabilities,credential_generation) values(conn,o,b,'instagram','999999999998','Projection fixture','not_connected','{"execution_enabled":false}',1);
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,connection_id,participant_key,title,assigned_to) values(c,o,b,'instagram',conn,'777','Brand-derived fixture title',e);
 insert into public.marketing_conversations(organization_id,brand_id,channel,title) values(o,b,'internal','Internal projection case');
 insert into public.marketing_reply_drafts(id,conversation_id,body,source_version,provenance,status,created_by) values(d1,c,'First accepted reply',1,'human','approved',e),(d2,c,'Second accepted reply',1,'human','approved',e);
 insert into public.marketing_reply_outbox(draft_id,state,provider_message_id,sent_at) values(d1,'sent','projection-one',now()-interval '2 minutes'),(d2,'sent','projection-two',now()-interval '1 minute');
 insert into public.marketing_conversation_messages(conversation_id,kind,provider_message_id,body,occurred_at) values(c,'incoming','projection-in','Question',now()-interval '3 minutes'),(c,'echo','projection-one','First accepted reply',now()-interval '2 minutes'),(c,'read','projection-one','',now());
 insert into marketing_qa_ids values('social_conversation',c);
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand'); c uuid:=(select id from marketing_qa_ids where key='social_conversation');v jsonb; denied boolean;
begin
 v:=public.marketing_inbox_read(o,b,p_channel=>'social');assert v->>'total'='1','Social view excludes internal cases before pagination';assert v->'rows'->0->>'latest_message'='Second accepted reply','Receipt not used as preview';assert v->'rows'->0->>'assignee_name'='QA Marketing Rollback','Canonical assignment';
 v:=public.marketing_inbox_read(o,b,p_channel=>'internal');assert v->>'total'='1','Internal view retained';
 v:=public.marketing_inbox_detail(c);assert v->>'total'='3' and jsonb_array_length(v->'messages')=3,'Genuine accepted send without echo projected once';assert jsonb_array_length(v->'audit_messages')=1,'Receipt retained in separate audit';assert not exists(select 1 from jsonb_array_elements(v->'messages') m where m->>'kind' in ('read','delivery')),'No receipts in chat';
 assert exists(select 1 from jsonb_array_elements(v->'messages') m where m->>'provider_message_id'='projection-one' and m->>'send_state'='read'),'Exact echo receipt state';assert exists(select 1 from jsonb_array_elements(v->'messages') m where m->>'provider_message_id'='projection-two' and m->>'send_state'='sent'),'Other outbound not marked Read';
 v:=public.marketing_inbox_detail(c,2,2);assert jsonb_array_length(v->'messages')=1,'Message pagination excludes receipt';
 denied:=false;begin perform public.marketing_inbox_read(o,(select id from marketing_qa_ids where key='other_brand'),p_channel=>'social');exception when insufficient_privilege then denied:=true;end;assert denied,'Cross-brand scope preserved';
 denied:=false;begin perform public.marketing_inbox_read((select id from marketing_qa_ids where key='other_org'),null,p_channel=>'social');exception when insufficient_privilege then denied:=true;end;assert denied,'Cross-organization scope preserved';
 denied:=false;begin perform public.marketing_inbox_profile_material(c,(select id from marketing_qa_ids where key='user'));exception when insufficient_privilege then denied:=true;end;assert denied,'Profile material is server-only';
end;$$;
reset role;
do $$ begin
 assert not coalesce(('{}'::jsonb->'page_tasks' ?| array['MODERATE','PROFILE_PLUS_MODERATE']),false),'Missing profile evidence denied';
 assert not ('["MESSAGING"]'::jsonb ?| array['MODERATE','PROFILE_PLUS_MODERATE']),'Messaging never implies MODERATE';
 assert '["MODERATE","MESSAGING"]'::jsonb ?| array['MODERATE','PROFILE_PLUS_MODERATE'],'Explicit profile task retained in full OAuth evidence';
end;$$;
select 'Scoped Inbox projection checks passed; all fixtures rolled back.' result;
rollback;
