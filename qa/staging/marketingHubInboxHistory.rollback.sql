-- Staging-only L3 rehearsal. Every fixture and mutation is rolled back.
-- Run only against verified ujkzdaaadnvcfayuldmh; no provider call is made.
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

do $$declare
 o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');u uuid:=(select id from marketing_qa_ids where key='user');actor uuid:=(select id from marketing_qa_ids where key='employee');
 c uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid();j uuid;v jsonb;p jsonb;denied boolean;ch text;observed date:=(now() at time zone 'UTC')::date;conv uuid;original_delivery boolean;
begin
 for ch in select unnest(array['facebook','instagram']) loop
 c:=gen_random_uuid();lease:=gen_random_uuid();
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,credential_generation,connected_at,sync_lease,sync_lease_until)
 values(c,o,b,ch,case ch when 'facebook' then '999999991' else '999999992' end,'QA rollback','test_authorized',now()+interval '1 day',jsonb_build_object('posts',true,'granted_scopes',jsonb_build_array(case ch when 'facebook' then 'pages_messaging' else 'instagram_manage_messages' end)),actor,1,now()-interval '20 days',lease,now()+interval '5 minutes');
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(c,'rollback-only','{}');
 denied:=false;begin perform marketing_inbox_history_request(c);exception when others then denied:=true;end;assert denied,'No customer import without separate privacy approval';
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,send_verified,webhook_verified,verified_at,page_id,configuration_verified) values(c,1,true,false,false,now(),'999999991',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform marketing_inbox_history_authorize(c,1,repeat('a',64));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 j:=marketing_inbox_history_request(c);
 assert marketing_inbox_history_request(c)=j,'Import request is deduplicated by approval';
 update marketing_private.inbox_history_jobs set state='leased',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j;
 -- Qualify variable to avoid PL/pgSQL ambiguity.
 select x.lease into lease from marketing_private.inbox_history_jobs x where x.id=j;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 assert marketing_inbox_history_guard(j,lease),'Approved current generation accepted';
 assert not marketing_inbox_history_guard(j,gen_random_uuid()),'Wrong lease denied';
 update marketing_private.inbox_history_approvals set expires_at=now()-interval '1 second' where connection_id=c;
 assert not marketing_inbox_history_guard(j,lease),'Expired privacy approval denied';
 update marketing_private.inbox_history_approvals set expires_at=now()+interval '1 day' where connection_id=c;
 update marketing_private.inbox_history_jobs set generation=2 where id=j;
 assert not marketing_inbox_history_guard(j,lease),'Stale import generation denied';
 update marketing_private.inbox_history_jobs set generation=1 where id=j;
 v:=jsonb_build_object('events',jsonb_build_array(jsonb_build_object('channel',ch,'account_id',case ch when 'facebook' then '999999991' else '999999992' end,'peer_id','555555555','kind','incoming','event_id','history-identity','occurred_at',now()-interval '2 days','body','Rollback-only history','medium','dm'),jsonb_build_object('channel',ch,'account_id',case ch when 'facebook' then '999999991' else '999999992' end,'peer_id','777777777','kind','echo','event_id','history-outgoing','occurred_at',now()-interval '3 days','body','Rollback-only outgoing history','medium','dm')),'checkpoint','{}'::jsonb,'done',true,'scanned',2,'omitted',0);
 perform marketing_inbox_history_finish(j,lease,v,null);
 perform marketing_inbox_process_events(20);
 select id into conv from marketing_conversations where connection_id=c and participant_key='555555555';
 assert conv is not null,'History uses existing canonical conversation identity';
 assert (select count(*) from marketing_conversation_messages where conversation_id=conv and evidence_source='historical_import' and occurred_at<now()-interval '1 day')=1,'Original time and history source retained';
 assert exists(select 1 from marketing_conversations x join marketing_conversation_messages m on m.conversation_id=x.id where x.connection_id=c and x.participant_key='777777777' and x.last_inbound_at is null and m.kind='echo' and m.evidence_source='historical_import'),'Outbound history preserves actual identity without opening a reply window';
 assert exists(select 1 from marketing_events where brand_id=b and action='inbox_history_privacy_authorized' and details->>'generation'='1'),'Privacy review evidence is auditable';
 assert not (marketing_private.inbox_channel(c)->>'delivery_verified')::boolean,'History cannot verify webhook delivery';
 assert not exists(select 1 from marketing_reply_drafts where conversation_id=conv),'History cannot start FAQ proposal automation';
 -- Privacy cutoff remains canonical for imported payloads.
 insert into marketing_private.privacy_cases(case_hash,verification_hash,method) values(repeat('b',64),repeat('c',64),'operator_identity_review') on conflict do nothing;
 perform marketing_private.inbox_erase_conversation(conv,repeat('b',64));
 assert not exists(select 1 from marketing_conversation_messages where conversation_id=conv),'Existing erasure removes imported messages';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 denied:=false;begin perform marketing_social_observed_growth((select id from marketing_qa_ids where key='other_org'),null);exception when others then denied:=true;end;assert denied,'Cross-org growth denied';
 assert not has_table_privilege('authenticated','public.marketing_social_daily_observations','SELECT'),'No browser snapshot table access';
 assert not has_function_privilege('authenticated','public.marketing_inbox_history_authorize(uuid,integer,text)','EXECUTE'),'Browser cannot grant privacy approval';
 delete from marketing_social_posts where connection_id=c;
 assert not exists(select 1 from marketing_social_daily_observations where connection_id=c),'Provider grant lineage deletion clears daily observations';
 end loop;
end;$$;
rollback;
