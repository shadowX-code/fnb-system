-- Remove only the isolated disposable fixture after its external object cleanup has been verified.
begin;
do $$
declare o uuid:=(select id from marketing_private.qa_privacy_restore where key='org'); b uuid:=(select id from marketing_private.qa_privacy_restore where key='brand'); e uuid:=(select id from marketing_private.qa_privacy_restore where key='employee'); ids uuid[]; cases text[]; journal_ids text[];
begin
 select array_agg(id) into ids from public.marketing_connections where organization_id=o;
 select array_agg(regexp_replace(value,'^feedx/ujkzdaaadnvcfayuldmh/erasure/v1/|\.json$','','g')) into journal_ids from jsonb_array_elements_text((select body from marketing_private.qa_privacy_restore where key='journal_objects'));
 select array_agg(payload->>'case_hash') filter(where payload->>'case_hash' is not null) into cases from marketing_private.privacy_recovery_intents where id=any(journal_ids);
 delete from public.marketing_conversation_messages where conversation_id in(select id from public.marketing_conversations where organization_id=o);
 delete from public.marketing_conversations where organization_id=o;
 delete from public.marketing_requests where request_id=(select id from marketing_private.qa_privacy_restore where key='request');
 delete from public.marketing_events where organization_id=o;
 delete from marketing_private.inbox_events where connection_id=any(ids);
 delete from public.marketing_social_posts where organization_id=o;
 delete from marketing_private.credentials where connection_id=any(ids);
 delete from marketing_private.meta_subjects where connection_id=any(ids);
 delete from marketing_private.inbox_erased_peers where connection_id=any(ids);
 delete from marketing_private.inbox_erased_ai_usage where brand_id=b;
 delete from marketing_private.privacy_erasure_journal where case_hash=any(cases);
 delete from marketing_private.privacy_case_receipts where case_hash=any(cases);
 delete from marketing_private.inbox_legal_holds where case_hash=any(cases);
 delete from marketing_private.removal_requests where case_hash=any(cases);
 delete from marketing_private.privacy_cases where case_hash=any(cases);
 delete from marketing_private.privacy_recovery_intents where id=any(journal_ids);
 delete from public.marketing_connections where organization_id=o;
 delete from public.brands where id=b;
 delete from public.organizations where id=o;
 -- People bootstrap creates an immutable assignment revision. Preserve that authority;
 -- deactivate only this synthetic actor/empty role instead of disabling its evidence guard.
 update public.employees set is_active=false where id=e;
 update public.roles set is_active=false where id=(select id from marketing_private.qa_privacy_restore where key='role');
end;$$;
drop table marketing_private.qa_privacy_restore;
commit;
select 'disposable Marketing fixture removed; synthetic People actor deactivated with immutable history preserved' result;
