-- Disposable Staging-only logical restore fixture. Never restores the real project or calls Meta/AI.
begin;
do $$begin
 if exists(select 1 from marketing_private.privacy_cases) then raise exception 'Rehearsal requires isolated privacy case inventory review.';end if;
 if to_regclass('marketing_private.qa_privacy_restore') is not null then raise exception 'Rehearsal already exists; review/cleanup first.';end if;
end;$$;
create table marketing_private.qa_privacy_restore(key text primary key,id uuid,body jsonb);
alter table marketing_private.qa_privacy_restore enable row level security;
revoke all on marketing_private.qa_privacy_restore from public,anon,authenticated,service_role;
do $$
declare u uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); held uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); internal_case uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
begin
 insert into public.organizations(id,name) values(o,'QA Disposable Privacy Restore');
 insert into public.brands(id,organization_id,name) values(b,o,'QA Disposable Privacy Restore');
 insert into auth.users(id,email,aud,role) values(u,'privacy-restore-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_privacy_restore_'||r::text,true,'none');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(e,u,'QA Disposable Privacy Restore','privacy-restore-'||e::text||'@example.invalid',r,false,'active',true,'Management');
 insert into public.marketing_connections(id,organization_id,brand_id,channel,status,credential_generation,capabilities) values(x,o,b,'facebook','not_connected',2,'{"execution_enabled":false}');
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id) values(x,'disposable-rehearsal','{}','99999999881');
 insert into marketing_private.meta_subjects values(x,1,'99999999881',now()-interval '2 days'),(x,2,'99999999881',now());
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,connection_id,connection_generation,participant_key,title,summary,opted_out)
 values(c,o,b,'facebook',x,1,'9999998871','QA erasure','QA disposable summary',true),(held,o,b,'facebook',x,1,'9999998872','QA hold','QA held summary',false),(fresh,o,b,'facebook',x,2,'9999998871','QA later grant','QA later summary',false);
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,title) values(internal_case,o,b,'internal','QA internal preserved');
 insert into public.marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at) values(c,'incoming','QA disposable message','qa-restore-message',now()-interval '1 hour'),(c,'note','QA disposable note',null,now());
 insert into public.marketing_reply_drafts(id,conversation_id,body,source_version,provenance,created_by) values(d,c,'QA disposable reply',1,'human',e);
 insert into public.marketing_reply_outbox(draft_id) values(d);
 insert into public.marketing_inbox_ai_artifacts(id,conversation_id,source_version,knowledge_revision,kind,body,model,created_by) values(a,c,1,1,'faq','{"text":"QA disposable AI answer"}','gpt-5-mini',e);
 insert into marketing_private.inbox_ai_runs(request_id,conversation_id,actor_employee_id,fingerprint,source_version,knowledge_revision,kind,state,artifact_id,provider_model,input_tokens,output_tokens,cost) values(req,c,e,'qa',1,1,'faq','completed',a,'gpt-5-mini',10,10,0.1);
 insert into public.marketing_inbox_faqs(id,brand_id,question,answer,language,reference_keys,knowledge_revision,created_by,source_conversation_id) values(f,b,'QA derived','QA derived','EN','{}',1,e,c);
 insert into public.marketing_requests values(req,e,'qa',jsonb_build_object('conversation_id',c,'body','QA disposable cache'));
 insert into public.marketing_events(organization_id,brand_id,action,details) values(o,b,'qa_restore',jsonb_build_object('conversation_id',c));
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint) values('qa-restore-'||x,x,1,jsonb_build_object('peer_id','9999998871','body','QA disposable webhook','occurred_at',now()-interval '1 hour'),'qa');
 insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,channel,caption) values(o,b,x,1,'qa-restore-old','facebook','QA old'),(o,b,x,2,'qa-restore-new','facebook','QA new');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.marketing_privacy_record_hold(o,b,held,'legal_claim',repeat('7',64),now()+interval '1 month');
 insert into marketing_private.qa_privacy_restore(key,id) values('user',u),('role',r),('org',o),('brand',b),('employee',e),('connection',x),('conversation',c),('held',held),('fresh',fresh),('internal',internal_case),('request',req);
end;$$;
-- Snapshot only disposable records. This intentionally predates erasure intents/tombstones.
insert into marketing_private.qa_privacy_restore(key,body) select 'snapshot',jsonb_build_object(
 'conversations',(select jsonb_agg(c) from public.marketing_conversations c where organization_id=(select id from marketing_private.qa_privacy_restore where key='org')),
 'messages',(select jsonb_agg(m) from public.marketing_conversation_messages m where conversation_id=(select id from marketing_private.qa_privacy_restore where key='conversation')),
 'drafts',(select jsonb_agg(d) from public.marketing_reply_drafts d where conversation_id=(select id from marketing_private.qa_privacy_restore where key='conversation')),
 'outbox',(select jsonb_agg(o) from public.marketing_reply_outbox o where draft_id in(select id from public.marketing_reply_drafts where conversation_id=(select id from marketing_private.qa_privacy_restore where key='conversation'))),
 'artifacts',(select jsonb_agg(a) from public.marketing_inbox_ai_artifacts a where conversation_id=(select id from marketing_private.qa_privacy_restore where key='conversation')),
 'runs',(select jsonb_agg(r) from marketing_private.inbox_ai_runs r where conversation_id=(select id from marketing_private.qa_privacy_restore where key='conversation')),
 'faqs',(select jsonb_agg(f) from public.marketing_inbox_faqs f where source_conversation_id=(select id from marketing_private.qa_privacy_restore where key='conversation')),
 'requests',(select jsonb_agg(r) from public.marketing_requests r where request_id=(select id from marketing_private.qa_privacy_restore where key='request')),
 'events',(select jsonb_agg(e) from public.marketing_events e where organization_id=(select id from marketing_private.qa_privacy_restore where key='org')),
 'webhooks',(select jsonb_agg(e) from marketing_private.inbox_events e where connection_id=(select id from marketing_private.qa_privacy_restore where key='connection')),
 'holds',(select jsonb_agg(h) from marketing_private.inbox_legal_holds h where conversation_id=(select id from marketing_private.qa_privacy_restore where key='held')),
 'posts',(select jsonb_agg(p) from public.marketing_social_posts p where connection_id=(select id from marketing_private.qa_privacy_restore where key='connection')),
 'subjects',(select jsonb_agg(s) from marketing_private.meta_subjects s where connection_id=(select id from marketing_private.qa_privacy_restore where key='connection')));
commit;
select 'disposable snapshot prepared; no provider calls' result;
