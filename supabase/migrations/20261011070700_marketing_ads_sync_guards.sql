-- Bounded retries terminalize abandoned leases; duplicate requests reuse their active job.
create or replace function public.marketing_ads_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare j marketing_private.ads_sync_jobs;
begin
 update marketing_private.ads_sync_jobs set state='failed',error_code='sync_retry_limit',lease=null,lease_until=null where state='leased' and lease_until<now() and attempts>=4;
 select * into j from marketing_private.ads_sync_jobs where ((state in ('queued','retry') and (retry_at is null or retry_at<=now())) or (state='leased' and lease_until<now())) and attempts<4 order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 update marketing_private.ads_sync_jobs set state='leased',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=j.id returning * into j;
 return to_jsonb(j);
end;$$;
create or replace function public.marketing_ads_request_sync(p_connection uuid,p_from date,p_to date) returns uuid
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;actor uuid;job uuid;
begin
 select * into c from public.marketing_connections where id=p_connection for share;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_ads.view');
 if c.channel is distinct from 'ad_account' or c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() or p_from is null or p_to is null or p_to<p_from or p_to-p_from>93 then raise exception 'Ad connection or period unavailable.';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,14));
 select id into job from marketing_private.ads_sync_jobs where connection_id=c.id and generation=c.credential_generation and date_from=p_from and date_to=p_to and state in ('queued','leased','retry');
 if job is not null then return job;end if;
 if (select count(*) from marketing_private.ads_sync_jobs where connection_id=c.id and created_at>now()-interval '1 hour')>=20 then raise exception 'Please wait before requesting more advertising synchronization.';end if;
 insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to) values(c.id,c.credential_generation,actor,p_from,p_to) returning id into job;
 return job;
end;$$;
