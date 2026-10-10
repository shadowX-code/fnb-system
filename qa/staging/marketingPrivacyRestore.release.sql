begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare receipt text;begin
 select id::text into receipt from marketing_private.qa_privacy_restore where key='connection';
 perform public.marketing_meta_removal_once(encode(extensions.digest('qa-meta:'||receipt,'sha256'),'hex'),'99999999881',true,encode(extensions.digest('qa-meta-case:'||receipt,'sha256'),'hex'),now()-interval '1 day');
 assert not exists(select 1 from public.marketing_conversations where id in(select id from marketing_private.qa_privacy_restore where key in('conversation','held'))),'Disposable operational data erased';
 assert not exists(select 1 from marketing_private.credentials where connection_id=(select id from marketing_private.qa_privacy_restore where key='revoked_connection')),'Disposable current credentials revoked';
 assert exists(select 1 from marketing_private.credentials where connection_id=(select id from marketing_private.qa_privacy_restore where key='connection')),'Later grant preserved';
end;$$;
insert into marketing_private.qa_privacy_restore(key,body) select 'release_http',jsonb_build_object('request',net.http_post(
 url:='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-privacy/release-hold',
 headers:=jsonb_build_object('Content-Type','application/json','x-marketing-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='feedx_marketing_worker' limit 1)),
 body:=jsonb_build_object('conversationId',(select id from marketing_private.qa_privacy_restore where key='held'),'evidenceHash',repeat('8',64)),timeout_milliseconds:=120000));
commit;
