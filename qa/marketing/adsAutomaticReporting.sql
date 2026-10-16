begin;
set local statement_timeout='8s';
-- Existing authorized Staging account only; every fixture change rolls back.
do $$
declare c marketing_connections;a marketing_private.ads_accounts;actor uuid;job uuid;same uuid;before_count int;d date;other uuid:=gen_random_uuid();
begin
 select * into c from marketing_connections where provider_account_id='1547787575646373' and channel='ad_account';actor:=c.connected_by;
 select * into a from marketing_private.ads_accounts where connection_id=c.id;
 d:=(now() at time zone a.timezone)::date;
 delete from marketing_private.ads_sync_jobs where connection_id=c.id;
 if marketing_private.ads_queue_period(c.id,actor,d-110,d-109,false) is not null then raise exception 'Dormant policy queued work';end if;
 update marketing_private.ads_reporting_policy set automatic_history_enabled=true;
 job:=marketing_private.ads_queue_period(c.id,actor,d-110,d-109,false);
 if job is null then raise exception 'Missing eligible range not queued';end if;
 same:=marketing_private.ads_queue_period(c.id,actor,d-110,d-109,false);
 if same is distinct from job then raise exception 'Duplicate request';end if;
 if marketing_private.ads_queue_period(c.id,actor,d-108,d-107,false) is not null then raise exception 'Concurrent history queue expanded';end if;
 update marketing_private.ads_sync_jobs set state='failed',error_code='meta_permission_or_token_invalid' where id=job;
 if marketing_private.ads_queue_period(c.id,actor,d-110,d-109,false) is not null then raise exception 'Terminal failure retried automatically';end if;
 begin perform marketing_private.ads_queue_period(c.id,other,d-110,d-109,false);raise exception 'Unauthorized accepted';exception when insufficient_privilege then null;end;
 update marketing_private.ads_accounts set generation=c.credential_generation+1 where connection_id=c.id;
 begin perform marketing_private.ads_queue_period(c.id,actor,d-110,d-109,false);raise exception 'Generation drift accepted';exception when raise_exception then if sqlerrm='Generation drift accepted' then raise;end if;end;
 update marketing_private.ads_accounts set generation=c.credential_generation where connection_id=c.id;
 begin perform marketing_private.ads_queue_period(c.id,actor,d-1200,d,false);raise exception 'Date floor bypass';exception when raise_exception then if sqlerrm='Date floor bypass' then raise;end if;end;
 insert into marketing_private.ads_snapshots(connection_id,generation,date_from,date_to,payload) values(c.id,c.credential_generation,d-108,d-107,'{"insights":{"campaign":[]},"warnings":{}}') on conflict do nothing;
 if marketing_private.ads_queue_period(c.id,actor,d-108,d-107,false) is not null then raise exception 'Completed range queued again';end if;
 delete from marketing_private.ads_sync_jobs where connection_id=c.id;
 for before_count in 1..20 loop
  insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to,state) values(c.id,c.credential_generation,actor,d-before_count,d-before_count,'failed');
 end loop;
 if marketing_private.ads_queue_period(c.id,actor,d-110,d-109,false) is not null then raise exception 'Hourly cap bypassed';end if;
 delete from marketing_private.ads_sync_jobs where connection_id=c.id;
 -- Isolated scheduler fixture: fresh exact lifetime + annual observations coalesce;
 -- only the original two recent-period refreshes may be created.
 insert into marketing_private.ads_snapshots(connection_id,generation,date_from,date_to,payload) values(c.id,c.credential_generation,(d-interval '37 months')::date,d,'{"configs":{"campaigns":[]}}') on conflict(connection_id,generation,date_from,date_to) do update set observed_at=now(),payload=excluded.payload;
 insert into marketing_private.ads_snapshots(connection_id,generation,date_from,date_to,payload) values(c.id,c.credential_generation,(d-interval '1 year'+interval '1 day')::date,d,'{"configs":{"campaigns":[]}}') on conflict(connection_id,generation,date_from,date_to) do update set observed_at=now(),payload=excluded.payload;
 update marketing_private.ads_accounts set next_sync_at=now()-interval '1 minute' where connection_id=c.id;
 perform public.marketing_ads_schedule(c.id);
 if (select count(*) from marketing_private.ads_sync_jobs where connection_id=c.id)>2 then raise exception 'Unbounded schedule';end if;
 if has_function_privilege('anon','public.marketing_ads_ensure_period(uuid,date,date)','execute') or has_function_privilege('authenticated','marketing_private.ads_queue_period(uuid,uuid,date,date,boolean)','execute') then raise exception 'Authority grants widened';end if;
end;$$;
select 'passed: dormant, deduplication, account queue bound, terminal-stop, actor, generation, range, completed-period reuse, hourly cap, scheduler, grants' acceptance;
rollback;
