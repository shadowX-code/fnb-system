-- Restore ONLY disposable fixture rows from the pre-erasure logical snapshot.
-- Its auth-less scope is quarantined; no real project restore or provider operation occurs.
begin;
create function pg_temp.restore_qa(p_table text,p_records jsonb) returns void language plpgsql as $$begin
 if p_records is not null then execute format('insert into %s overriding system value select * from jsonb_populate_recordset(null::%s,$1)',p_table,p_table) using p_records;end if;
end;$$;
do $$
declare o uuid:=(select id from marketing_private.qa_privacy_restore where key='org'); b uuid:=(select id from marketing_private.qa_privacy_restore where key='brand'); snapshot jsonb; ids uuid[]; cases text[]; journal_ids text[];
begin
 select body into snapshot from marketing_private.qa_privacy_restore where key='snapshot';
 select array_agg(id) into ids from public.marketing_connections where organization_id=o;
 select array_agg(id),array_agg(payload->>'case_hash') filter(where payload->>'case_hash' is not null) into journal_ids,cases from marketing_private.privacy_recovery_intents where
 payload->'peers' @> jsonb_build_array(jsonb_build_object('connection_id',(select id from marketing_private.qa_privacy_restore where key='connection')))
 or payload->'grants' @> jsonb_build_array(jsonb_build_object('connection_id',(select id from marketing_private.qa_privacy_restore where key='connection')))
 or payload->>'conversation_id'=(select id::text from marketing_private.qa_privacy_restore where key='held');
 insert into marketing_private.qa_privacy_restore(key,body) select 'journal_objects',jsonb_agg(object_path) from marketing_private.privacy_recovery_intents where id=any(journal_ids);
 assert cardinality(journal_ids)=3,'All three independent durable events must exist before restore';
 delete from public.marketing_reply_outbox where draft_id in(select id from public.marketing_reply_drafts where conversation_id in(select id from public.marketing_conversations where organization_id=o));
 delete from public.marketing_reply_drafts where conversation_id in(select id from public.marketing_conversations where organization_id=o);
 delete from marketing_private.inbox_ai_runs where conversation_id in(select id from public.marketing_conversations where organization_id=o);
 delete from public.marketing_inbox_faqs where brand_id=b;
 delete from public.marketing_inbox_ai_artifacts where conversation_id in(select id from public.marketing_conversations where organization_id=o);
 delete from public.marketing_conversation_messages where conversation_id in(select id from public.marketing_conversations where organization_id=o);
 delete from public.marketing_conversations where organization_id=o;
 delete from public.marketing_requests where request_id=(select id from marketing_private.qa_privacy_restore where key='request');
 delete from public.marketing_events where organization_id=o;
 delete from marketing_private.inbox_events where connection_id=any(ids);
 delete from public.marketing_social_posts where organization_id=o;
 delete from marketing_private.credentials where connection_id=any(ids);
 delete from marketing_private.meta_subjects where connection_id=any(ids);
 delete from marketing_private.inbox_legal_holds where case_hash=any(cases);
 delete from marketing_private.privacy_erasure_journal where case_hash=any(cases);
 delete from marketing_private.privacy_case_receipts where case_hash=any(cases);
 delete from marketing_private.removal_requests where case_hash=any(cases);
 delete from marketing_private.privacy_cases where case_hash=any(cases);
 delete from marketing_private.privacy_recovery_intents where id=any(journal_ids);
 delete from marketing_private.inbox_erased_peers where connection_id=any(ids);
 delete from marketing_private.inbox_erased_ai_usage where brand_id=b;
 delete from public.marketing_connections where organization_id=o;
 perform pg_temp.restore_qa('public.marketing_connections',snapshot->'connections');
 perform pg_temp.restore_qa('marketing_private.credentials',snapshot->'credentials');
 perform pg_temp.restore_qa('marketing_private.meta_subjects',snapshot->'subjects');
 perform pg_temp.restore_qa('public.marketing_conversations',snapshot->'conversations');
 perform pg_temp.restore_qa('public.marketing_conversation_messages',snapshot->'messages');
 perform pg_temp.restore_qa('public.marketing_reply_drafts',snapshot->'drafts');
 perform pg_temp.restore_qa('public.marketing_reply_outbox',snapshot->'outbox');
 perform pg_temp.restore_qa('public.marketing_inbox_ai_artifacts',snapshot->'artifacts');
 perform pg_temp.restore_qa('marketing_private.inbox_ai_runs',snapshot->'runs');
 perform pg_temp.restore_qa('public.marketing_inbox_faqs',snapshot->'faqs');
 perform pg_temp.restore_qa('public.marketing_requests',snapshot->'requests');
 perform pg_temp.restore_qa('public.marketing_events',snapshot->'events');
 perform pg_temp.restore_qa('marketing_private.inbox_events',snapshot->'webhooks');
 perform pg_temp.restore_qa('marketing_private.inbox_legal_holds',snapshot->'holds');
 perform pg_temp.restore_qa('public.marketing_social_posts',snapshot->'posts');
 assert exists(select 1 from public.marketing_conversation_messages where conversation_id=(select id from marketing_private.qa_privacy_restore where key='conversation')),'Pre-erasure snapshot actually restored';
 assert not exists(select 1 from marketing_private.privacy_recovery_intents where id=any(journal_ids)),'Database journal intentionally lost in restore';
end;$$;
commit;
