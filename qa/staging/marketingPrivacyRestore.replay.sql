insert into marketing_private.qa_privacy_restore(key,body) select 'replay_http',jsonb_build_object('request',net.http_post(
 url:='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-privacy/restore-replay',
 headers:=jsonb_build_object('Content-Type','application/json','x-marketing-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='feedx_marketing_worker' limit 1)),
 body:='{"quarantineConfirmed":true}',timeout_milliseconds:=120000)) on conflict(key) do update set body=excluded.body;
