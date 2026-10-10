-- Worker credential is read only inside the trusted server; never returned in QA output.
insert into marketing_private.qa_privacy_restore(key,body)
select 'erase_http',jsonb_build_object('request',net.http_post(
 url:='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-privacy/erase-customer',
 headers:=jsonb_build_object('Content-Type','application/json','x-marketing-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='feedx_marketing_worker' limit 1)),
 body:=jsonb_build_object('organizationId',(select id from marketing_private.qa_privacy_restore where key='org'),'brandId',(select id from marketing_private.qa_privacy_restore where key='brand'),'conversationId',(select id from marketing_private.qa_privacy_restore where key='conversation'),
 'caseHash',encode(extensions.digest('qa-restore:'||(select id::text from marketing_private.qa_privacy_restore where key='conversation'),'sha256'),'hex'),'verificationHash',repeat('6',64)),timeout_milliseconds:=120000)) on conflict(key) do update set body=excluded.body;
