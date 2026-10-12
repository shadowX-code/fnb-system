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

do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');u uuid:=(select id from marketing_qa_ids where key='user');actor uuid:=(select id from marketing_qa_ids where key='employee'); conn uuid;ch text;account text;event jsonb;ev jsonb;job jsonb;v jsonb;denied boolean;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 for ch in select unnest(array['facebook','instagram']) loop
  conn:=gen_random_uuid();account:=case ch when 'facebook' then '999999999991' else '999999999992' end;
  insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation)
  values(conn,o,b,ch,account,'QA rollback','test_authorized',now()+interval '1 day',jsonb_build_object('granted_scopes',jsonb_build_array(case ch when 'facebook' then 'pages_messaging' else 'instagram_manage_messages' end)),actor,now()-interval '1 hour',1);
  insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(conn,'rollback-only','{}'::jsonb);
  job:=public.marketing_meta_health_claim(conn);assert job->>'lease' is not null,'Automatic health scheduled';
  assert public.marketing_meta_health_claim(conn) is null,'No overlapping lease';
  event:=jsonb_build_object('channel',ch,'account_id',account,'peer_id','777','kind','incoming','medium','dm','event_id','qa-first','body','QA rollback','occurred_at',now());
  perform public.marketing_inbox_receive(jsonb_build_array(event));
  assert (select state='blocked' from marketing_private.inbox_events where connection_id=conn),'Initial unconfigured event remains durable';
  ev:=jsonb_build_object('channel',ch,'account_id',account,'page_id',account,'page_tasks',jsonb_build_array('MESSAGING'),'required_permissions',jsonb_build_array(case ch when 'facebook' then 'pages_messaging' else 'instagram_manage_messages' end),'authorization_verified',true,'subscriptions_verified',true);
  v:=public.marketing_inbox_record_verification(conn,u,1,ev);
  assert (v->>'configuration_verified')::boolean and (v->>'delivery_verified')::boolean and (v->>'receiving_verified')::boolean,'Configuration + signed first delivery independently verified';
  assert v->>'sending_enabled'='false','No outbound execution granted';
  perform public.marketing_inbox_process_events(50);
  assert (select count(*) from public.marketing_conversations where connection_id=conn and brand_id=b)=1,'Correct-brand genuine receipt processed';
  assert (select count(*) from public.marketing_conversation_messages m join public.marketing_conversations c on c.id=m.conversation_id where c.connection_id=conn and m.evidence_source='signed_webhook')=1,'Signed provenance';
  assert public.marketing_inbox_receive(jsonb_build_array(event))->>'duplicates'='1','Replay deduplicated';
  -- Reset only the rolled-back fixture to check API fallback independently.
  update marketing_private.inbox_authority set webhook_verified=false where connection_id=conn;
  event:=event||jsonb_build_object('event_id','qa-recovery');
  perform public.marketing_inbox_reconcile(conn,1,(job->>'lease')::uuid,jsonb_build_array(event));
  assert not (marketing_private.inbox_channel(conn)->>'delivery_verified')::boolean,'API adoption never proves webhook delivery';
  perform public.marketing_inbox_process_events(50);
  assert (select count(*) from public.marketing_conversation_messages m join public.marketing_conversations c on c.id=m.conversation_id where c.connection_id=conn and m.evidence_source='recent_api')=1,'Recovery provenance retained';
  perform public.marketing_inbox_receive(jsonb_build_array(event));
  assert (marketing_private.inbox_channel(conn)->>'delivery_verified')::boolean,'Genuine receipt promotes delivery';
  denied:=false;begin perform public.marketing_inbox_reconcile(conn,1,(job->>'lease')::uuid,jsonb_build_array(event||'{"account_id":"111"}'::jsonb));exception when others then denied:=true;end;assert denied,'Cross-account recovery denied';
  denied:=false;begin perform public.marketing_inbox_reconcile(conn,1,(job->>'lease')::uuid,jsonb_build_array(event||jsonb_build_object('occurred_at',now()-interval '2 days')));exception when others then denied:=true;end;assert denied,'Older history denied';
  insert into marketing_private.inbox_erased_peers(connection_id,generation,peer_hash,erased_at) values(conn,1,encode(extensions.digest('888','sha256'),'hex'),now());
  event:=event||jsonb_build_object('event_id','qa-erased','peer_id','888','occurred_at',now()-interval '1 minute');
  perform public.marketing_inbox_reconcile(conn,1,(job->>'lease')::uuid,jsonb_build_array(event));
  perform public.marketing_inbox_process_events(50);
  assert not exists(select 1 from public.marketing_conversations where connection_id=conn and participant_key='888'),'Recovery respects privacy tombstones';
  perform public.marketing_meta_health_finish(conn,1,(job->>'lease')::uuid,'meta_temporarily_unavailable');
  assert (select due_at=now()+interval '1 minute' and attempts=1 from marketing_private.connection_checks where connection_id=conn),'Bounded first retry';
  update public.marketing_connections set credential_generation=2 where id=conn;
  assert not public.marketing_meta_health_guard(conn,1,(job->>'lease')::uuid),'Stale generation lease denied';
  assert not (marketing_private.inbox_channel(conn)->>'configuration_verified')::boolean,'Reconnect resets evidence';
 end loop;
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare denied boolean:=false;begin
 begin perform public.marketing_meta_health_claim(null);exception when insufficient_privilege then denied:=true;end;assert denied,'Browser cannot claim health';
 denied:=false;begin perform public.marketing_inbox_receive('[]');exception when insufficient_privilege then denied:=true;end;assert denied,'Browser cannot forge signed evidence';
 denied:=false;begin perform public.marketing_social_accounts((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Brand-scoped projection';
end;$$;
reset role;
select 'Meta connection reliability: Facebook + Instagram first-delivery, recovery provenance, dedupe, privacy, scope, generation, bounded retries passed.' as result;
rollback;
