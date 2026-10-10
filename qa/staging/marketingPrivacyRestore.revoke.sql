begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- A second disposable connection exercises restored stale credentials independently of the later grant.
do $$declare x uuid:=gen_random_uuid();begin
 insert into public.marketing_connections(id,organization_id,brand_id,channel,status,credential_generation,capabilities)
 select x,(select id from marketing_private.qa_privacy_restore where key='org'),(select id from marketing_private.qa_privacy_restore where key='brand'),'instagram','not_connected',1,'{"execution_enabled":false}';
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id) values(x,'disposable-rehearsal','{}','99999999881');
 insert into marketing_private.meta_subjects values(x,1,'99999999881',now()-interval '2 days');
 insert into marketing_private.qa_privacy_restore(key,id) values('revoked_connection',x);
 update marketing_private.qa_privacy_restore set body=body||jsonb_build_object(
 'connections',(select jsonb_agg(c) from public.marketing_connections c where organization_id=(select id from marketing_private.qa_privacy_restore where key='org')),
 'credentials',(select jsonb_agg(c) from marketing_private.credentials c where connection_id in(select id from public.marketing_connections where organization_id=(select id from marketing_private.qa_privacy_restore where key='org'))),
 'subjects',(select jsonb_agg(s) from marketing_private.meta_subjects s where connection_id in(select id from public.marketing_connections where organization_id=(select id from marketing_private.qa_privacy_restore where key='org')))) where key='snapshot';
end;$$;
insert into marketing_private.qa_privacy_restore(key,body) select 'meta_intent',public.marketing_privacy_prepare_meta(
 encode(extensions.digest('qa-meta:'||(select id::text from marketing_private.qa_privacy_restore where key='connection'),'sha256'),'hex'),'99999999881',
 encode(extensions.digest('qa-meta-case:'||(select id::text from marketing_private.qa_privacy_restore where key='connection'),'sha256'),'hex'),now()-interval '1 day');
-- Uses the existing private scheduler authority, not a secret copied into this file.
select public.marketing_tick();
commit;
