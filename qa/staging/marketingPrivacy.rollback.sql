-- Staging-only changed live-delivery authorities, no provider calls.
begin;

-- A synthetic independent receipt is used ONLY in rollback contract QA; live Blob rehearsal is separate.
create function pg_temp.qa_journal_ack(intent jsonb) returns void language plpgsql as $$begin
 perform public.marketing_privacy_journal_ack(intent->>'id',encode(extensions.digest(intent->>'payload','sha256'),'hex'),'feedx/ujkzdaaadnvcfayuldmh/erasure/v1/'||(intent->>'id')||'.json');
end;$$;
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


select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand'); e uuid:=(select id from marketing_qa_ids where key='employee');
 x uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); held uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); internal_case uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 stamp timestamptz:=now()-interval '1 minute'; h text:=repeat('a',64); v text:=repeat('b',64); receipt text:=repeat('c',64); status jsonb; denied boolean;
begin
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,credential_generation)
 values(x,o,b,'facebook','999999999995','QA private erasure','test_authorized',now()+interval '1 day','{"execution_enabled":false}',2);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id) values(x,'rollback-only','{}','999995');
 insert into marketing_private.meta_subjects values(x,1,'999995',stamp-interval '1 day'),(x,2,'999995',now());
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,connection_id,connection_generation,participant_key,title,summary)
 values(c,o,b,'facebook',x,1,'77771','QA old grant','Private summary'),(held,o,b,'facebook',x,1,'77772','QA legal hold','Held summary'),(fresh,o,b,'facebook',x,2,'77771','QA newer grant','Newer summary');
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,title) values(internal_case,o,b,'internal','QA internal preserved');
 insert into public.marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at) values(c,'incoming','QA private body','qa-message',stamp),(c,'note','QA private staff note',null,now());
 insert into public.marketing_reply_drafts(id,conversation_id,body,source_version,provenance,created_by) values(d,c,'QA private reply',1,'human',e);
 insert into public.marketing_reply_outbox(draft_id) values(d);
 insert into public.marketing_inbox_ai_artifacts(id,conversation_id,source_version,knowledge_revision,kind,body,model,created_by) values(a,c,1,1,'faq','{"text":"QA private answer"}','gpt-5-mini',e);
 insert into marketing_private.inbox_ai_runs(request_id,conversation_id,actor_employee_id,fingerprint,source_version,knowledge_revision,kind,state,artifact_id,provider_model,input_tokens,output_tokens,cost)
 values(req,c,e,'qa',1,1,'faq','claimed',a,'gpt-5-mini',10,10,0.1);
 insert into public.marketing_inbox_faqs(id,brand_id,question,answer,language,reference_keys,knowledge_revision,created_by) values(f,b,'QA derived question','QA derived answer','EN','{}',1,e);
 insert into public.marketing_events(organization_id,brand_id,action,details) values(o,b,'inbox_ai_reviewed',jsonb_build_object('artifact_id',a,'faq_id',f));
 assert (select source_conversation_id=c from public.marketing_inbox_faqs where id=f),'Derived FAQ lineage';
 insert into public.marketing_requests values(req,e,'qa-fingerprint',jsonb_build_object('conversation_id',c,'body','QA private cached result'));
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint) values('qa-erasure-old',x,1,'{"peer_id":"77771","body":"QA private webhook"}','qa'),('qa-erasure-unprocessed',x,1,'{"peer_id":"88881","body":"QA unprocessed body"}','qa'),('qa-erasure-new',x,2,'{"peer_id":"77771","body":"QA newer body"}','qa');
 perform public.marketing_privacy_record_hold(o,b,held,'legal_claim',v,now()+interval '1 month');
 insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,channel,caption) values(o,b,x,1,'qa-old-post','facebook','Old projection'),(o,b,x,2,'qa-new-post','facebook','New projection');
 denied:=false;begin perform public.marketing_meta_removal_once(h,'999995',true,receipt,stamp);exception when others then denied:=true;end;assert denied,'Erasure requires independent durable receipt';
 perform pg_temp.qa_journal_ack(public.marketing_privacy_prepare_meta(h,'999995',receipt,stamp));
 perform public.marketing_meta_removal_once(h,'999995',true,receipt,stamp);
 assert not exists(select 1 from public.marketing_conversations where id in(c,held)),'Operational conversations erased';
 assert exists(select 1 from public.marketing_conversations where id=fresh) and exists(select 1 from public.marketing_conversations where id=internal_case),'New grant and internal preserved';
 assert not exists(select 1 from public.marketing_conversation_messages where conversation_id=c),'Messages and notes erased';
 assert not exists(select 1 from public.marketing_reply_drafts where id=d) and not exists(select 1 from public.marketing_reply_outbox where draft_id=d),'Replies and outbox erased';
 assert not exists(select 1 from public.marketing_inbox_ai_artifacts where id=a) and not exists(select 1 from marketing_private.inbox_ai_runs where request_id=req),'AI artifacts and in-flight lease erased';
 assert not exists(select 1 from public.marketing_inbox_faqs where id=f),'Derived FAQ erased';
 assert (select result='{"state":"erased"}'::jsonb from public.marketing_requests where request_id=req),'Cached replay body erased';
 assert not exists(select 1 from marketing_private.inbox_events where connection_id=x and generation=1 and payload<>'{}'::jsonb),'Unprocessed and processed webhook bodies erased';
 assert exists(select 1 from marketing_private.inbox_events where connection_id=x and generation=2 and payload<>'{}'::jsonb),'New-grant webhook preserved';
 assert exists(select 1 from marketing_private.credentials where connection_id=x) and (select credential_generation=2 from public.marketing_connections where id=x),'Later credential preserved';
 assert (select count(*)=1 from public.marketing_social_posts where connection_id=x and connection_generation=2),'Phase 1 later post preserved';
 assert (select calls=1 and input_tokens=10 from marketing_private.inbox_erased_ai_usage where brand_id=b),'Anonymous usage retained once';
 assert (select archive->'conversation'->>'summary'='Held summary' from marketing_private.inbox_legal_holds where conversation_id=held),'Legal copy restricted archive';
 status:=public.marketing_meta_deletion_status(receipt);assert status->>'status'='retained_legal_review' and status->>'completed_at' is null,'Truthful legal status';
 assert not(status ? 'user_id') and not(status ? 'conversation_id') and not(status ? 'counts'),'Public receipt no identity or personal data';
 perform public.marketing_meta_removal_once(h,'999995',true,repeat('d',64),stamp);
 assert public.marketing_meta_deletion_status(repeat('d',64))=status,'Replay receipt bound to same outcome';
 assert (select calls=1 from marketing_private.inbox_erased_ai_usage where brand_id=b),'No duplicate aggregates';
 perform pg_temp.qa_journal_ack(public.marketing_privacy_prepare_release(held,v));
 perform public.marketing_privacy_release_hold(held,v);
 assert public.marketing_meta_deletion_status(receipt)->>'status'='local_completed_followup_pending','Backup and processor pending';
 perform public.marketing_privacy_complete_followup(receipt,'verified_expired','verified_deleted',v);
 assert public.marketing_meta_deletion_status(receipt)->>'status'='completed','Completion requires verified followup';
 denied:=false;begin perform public.marketing_inbox_privacy_erase_verified(gen_random_uuid(),b,fresh,repeat('e',64),v);exception when others then denied:=true;end;assert denied,'Wrong organization denied';
 update public.marketing_conversations set opted_out=true where id=fresh;
 perform pg_temp.qa_journal_ack(public.marketing_privacy_prepare_customer(o,b,fresh,repeat('e',64),v));
 perform public.marketing_inbox_privacy_erase_verified(o,b,fresh,repeat('e',64),v);
 perform public.marketing_inbox_privacy_erase_verified(o,b,fresh,repeat('e',64),v);
 assert not exists(select 1 from public.marketing_conversations where id=fresh),'Verified peer deletion';
 assert exists(select 1 from marketing_private.inbox_erased_peers where connection_id=x and generation=2),'Replay cutoff retained';
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint)
 values('qa-erasure-replayed',x,2,jsonb_build_object('peer_id','77771','body','QA replay must not persist','occurred_at',stamp),'qa');
 assert (select payload='{}'::jsonb and error_code='privacy_erased' from marketing_private.inbox_events where event_key='qa-erasure-replayed'),'Replay body scrubbed before storage';
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,connection_id,connection_generation,participant_key,title,takeover) values(gen_random_uuid(),o,b,'facebook',x,2,'77771','QA later inbound',false);
 assert exists(select 1 from public.marketing_conversations where connection_id=x and connection_generation=2 and opted_out and takeover),'Later inbound preserves minimal opt-out';

 -- The exact new grant callback revokes its credentials, but not internal records.
 perform pg_temp.qa_journal_ack(public.marketing_privacy_prepare_meta(repeat('f',64),'999995',repeat('1',64),now()));
 perform public.marketing_meta_removal_once(repeat('f',64),'999995',true,repeat('1',64),now());
 assert not exists(select 1 from marketing_private.credentials where connection_id=x),'Current credentials removed';
 assert (select capabilities='{}'::jsonb and mc.status='not_connected' from public.marketing_connections mc where id=x),'Connection revoked';
 assert exists(select 1 from public.marketing_conversations where id=internal_case),'No unrelated internal loss';
 insert into marketing_qa_ids values('privacy_fresh',fresh),('privacy_case',internal_case);
end;$$;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$declare denied boolean:=false;begin
 begin perform public.marketing_inbox_privacy_erase_verified(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('2',64),repeat('3',64));exception when insufficient_privilege then denied:=true;end;
 assert denied,'Ordinary staff cannot attest verification or erase';
 assert not has_function_privilege('authenticated','public.marketing_privacy_replay(jsonb)','EXECUTE'),'Staff cannot replay/forge recovery evidence';
 assert not has_table_privilege('authenticated',(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='marketing_private' and c.relname='privacy_recovery_intents'),'SELECT'),'Private recovery ledger inaccessible';
 assert not has_function_privilege('anon','public.marketing_meta_revoke(text,boolean,text,timestamptz)','EXECUTE'),'No anonymous revoke bypass';

end;$$;
reset role;
do $$begin assert not has_function_privilege('service_role','marketing_private.marketing_meta_revoke(text,boolean,text,timestamptz)','EXECUTE'),'No legacy erasure bypass';end;$$;
select 'privacy erasure: scope, lineage, replay, derived data, holds, followup and permissions passed' result;
rollback;
