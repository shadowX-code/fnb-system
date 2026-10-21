-- Production-only dispatch binding. Apply atomically after 20261015163207; never on Staging.
-- The original shared migration is immutable; existing Cron jobs are not rescheduled here.
do $$ begin
 if position('https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/google-business/scheduled-sync' in pg_get_functiondef('google_business_private.sync_tick()'::regprocedure))=0 then raise exception 'Unexpected Google sync dispatch baseline'; end if;
end;$$;
create or replace function google_business_private.sync_tick() returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare w google_business_private.sync_worker;t text;r uuid:=gen_random_uuid();request bigint;
begin
 select * into w from google_business_private.sync_worker where id=true for update;
 if w.lease_until>now() or w.cooldown_until>now() or not exists(select 1 from google_business_private.connection where id=true and status='connected' and sealed_token is not null)
 or not exists(select 1 from public.crew_google_outlet_locations m join public.outlets o on o.id=m.outlet_id where o.is_active) then return null;end if;
 t:=gen_random_uuid()::text||gen_random_uuid()::text;
 update google_business_private.sync_worker set run_id=r,proof_hash=encode(extensions.digest(t,'sha256'),'hex'),lease_until=now()+interval '4 minutes',claimed_at=null,last_started_at=now(),last_error=case when w.lease_until<=now() and w.last_finished_at is distinct from w.last_started_at then 'previous_run_expired' end where id=true;
 request:=net.http_post(url:='https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/google-business/scheduled-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-google-sync-token',t),body:=jsonb_build_object('runId',r),timeout_milliseconds:=120000);
 update google_business_private.sync_worker set request_id=request where id=true;return request;
end;$$;
revoke all on function google_business_private.sync_tick() from public,anon,authenticated,service_role;
