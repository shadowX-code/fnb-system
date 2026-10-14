-- Only this Staging URL is scheduled. Vault holds a Marketing-only scheduler key.
create extension if not exists pg_net with schema extensions;
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;
create function public.marketing_tick() returns void language plpgsql security definer set search_path=public as $$
declare worker_key text;
begin
 select decrypted_secret into worker_key from vault.decrypted_secrets where name='feedx_marketing_worker' limit 1;
 if worker_key is null then return;end if;
 perform net.http_post(url:='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-worker/tick',
 headers:=jsonb_build_object('Content-Type','application/json','x-marketing-worker-secret',worker_key),body:='{}',timeout_milliseconds:=120000);
end;$$;
revoke all on function public.marketing_tick() from public,anon,authenticated;
grant execute on function public.marketing_tick() to service_role;
select cron.schedule('feedx_marketing_meta_worker','* * * * *','select public.marketing_tick()');
