do $$
declare c uuid:=(select id from marketing_private.qa_privacy_restore where key='conversation'); h uuid:=(select id from marketing_private.qa_privacy_restore where key='held'); x uuid:=(select id from marketing_private.qa_privacy_restore where key='connection'); b uuid:=(select id from marketing_private.qa_privacy_restore where key='brand'); response jsonb;
begin
 select r.content::jsonb into response from net._http_response r join marketing_private.qa_privacy_restore q on q.key='replay_http' and r.id=(q.body->>'request')::bigint where r.status_code=200;
 assert response->>'records'='3' and response->>'erased_conversations'='0','Repeat replay is idempotent';
 assert not exists(select 1 from public.marketing_conversations where id in(c,h)),'Restored erased conversations removed';
 assert not exists(select 1 from public.marketing_conversation_messages where conversation_id=c),'Message/notes not resurrected';
 assert not exists(select 1 from public.marketing_reply_drafts where conversation_id=c),'Reply/outbox not resurrected';
 assert not exists(select 1 from marketing_private.inbox_ai_runs where conversation_id=c),'AI generation leases not resurrected';
 assert not exists(select 1 from public.marketing_inbox_ai_artifacts where conversation_id=c),'AI proposals/summary not resurrected';
 assert not exists(select 1 from public.marketing_inbox_faqs where source_conversation_id=c),'Derived FAQ not resurrected';
 assert (select result='{"state":"erased"}'::jsonb from public.marketing_requests where request_id=(select id from marketing_private.qa_privacy_restore where key='request')),'Cached body scrubbed';
 assert not exists(select 1 from marketing_private.inbox_events where connection_id=x and generation=1 and payload<>'{}'::jsonb),'Webhook bodies not resurrected';
 assert not exists(select 1 from marketing_private.inbox_legal_holds where conversation_id=h),'Released legal archive not resurrected';
 assert exists(select 1 from marketing_private.inbox_erased_peers where connection_id=x and generation=1 and opted_out),'Minimal suppression restored';
 assert (select calls=1 from marketing_private.inbox_erased_ai_usage where brand_id=b),'No duplicate usage on replay';
 assert exists(select 1 from public.marketing_conversations where id=(select id from marketing_private.qa_privacy_restore where key='fresh')),'Later grant preserved';
 assert exists(select 1 from public.marketing_conversations where id=(select id from marketing_private.qa_privacy_restore where key='internal')),'Internal case preserved';
 assert exists(select 1 from marketing_private.credentials where connection_id=x),'Later grant credential preserved';
 assert not exists(select 1 from marketing_private.credentials where connection_id=(select id from marketing_private.qa_privacy_restore where key='revoked_connection')),'Restored revoked credential removed';
 assert (select count(*)=1 from public.marketing_social_posts where connection_id=x and connection_generation=2),'Phase 1 later post preserved';
 assert (select count(*)=3 from marketing_private.privacy_recovery_intents where applied_at is not null),'Recovery receipts restored';
 assert not exists(select 1 from marketing_private.privacy_cases where completed_at is not null),'No fabricated backup/provider completion';
end;$$;
select 'independent Blob logical restore replay, revocation, suppression, hold release and repeat idempotency passed' result;
