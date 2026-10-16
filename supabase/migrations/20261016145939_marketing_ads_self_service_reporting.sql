-- Dormant by default: enabling each account is a separate operational authorization.
create table marketing_private.ads_reporting_policy(singleton boolean primary key default true check(singleton),automatic_history_enabled boolean not null default false);
insert into marketing_private.ads_reporting_policy default values;
alter table marketing_private.ads_reporting_policy enable row level security;
revoke all on marketing_private.ads_reporting_policy from public,anon,authenticated;

-- Single queue authority for explicit recovery, requested selections and scheduled history.
create function marketing_private.ads_queue_period(p_connection uuid,p_actor uuid,p_from date,p_to date,p_force boolean default false) returns uuid
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;a marketing_private.ads_accounts;job uuid;observed timestamptz;
begin
 select * into c from marketing_connections where id=p_connection for share;
 select * into a from marketing_private.ads_accounts where connection_id=c.id and generation=c.credential_generation;
 if not marketing_private.ads_org_allowed(p_actor,c.organization_id,'marketing_ads.view') then raise exception using errcode='42501',message='Shared-account advertising access required.';end if;
 if c.id is null or c.channel is distinct from 'ad_account' or c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() or not coalesce(a.read_verified,false)
 or not exists(select 1 from marketing_private.credentials where connection_id=c.id and sealed_token is not null)
 or not exists(select 1 from pg_timezone_names where name=a.timezone)
 or p_from is null or p_to is null or p_to<p_from or p_to-p_from>1133
 or p_from<((now() at time zone a.timezone)-interval '37 months')::date or p_to>(now() at time zone a.timezone)::date then raise exception 'Ad connection or period unavailable.';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,14));
 select id into job from marketing_private.ads_sync_jobs where connection_id=c.id and generation=c.credential_generation and date_from=p_from and date_to=p_to and state in ('queued','leased','retry');
 if job is not null then return job;end if;
 if not p_force then
  if not (select automatic_history_enabled from marketing_private.ads_reporting_policy where singleton) then return null;end if;
  select observed_at into observed from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation and date_from=p_from and date_to=p_to;
  -- Closed historical observations are immutable to automatic demand. Recent ranges refresh,
  -- without synthesizing period aggregates from daily rows or overlapping snapshots.
  if observed is not null and (p_to<(now() at time zone a.timezone)::date or observed>now()-case when p_to-p_from>93 then interval '24 hours' else interval '6 hours' end) then return null;end if;
  if exists(select 1 from marketing_private.ads_sync_jobs where connection_id=c.id and generation=c.credential_generation and (state in ('queued','leased','retry') or (date_from=p_from and date_to=p_to and state in ('failed','cancelled')))) then return null;end if;
 end if;
 if (select count(*) from marketing_private.ads_sync_jobs where connection_id=c.id and created_at>now()-interval '1 hour')>=20 then
  if not p_force then return null;end if;
  raise exception 'Please wait before requesting more advertising synchronization.';
 end if;
 -- Completed checkpoints recover locally through the existing canonical finish contract.
 select id into job from marketing_private.ads_sync_jobs where connection_id=c.id and generation=c.credential_generation and date_from=p_from and date_to=p_to and state='failed' and progress->>'step'='8' and progress ? 'report' order by created_at desc limit 1 for update;
 if job is not null then
  update marketing_private.ads_sync_jobs set actor_employee_id=p_actor,state='queued',attempts=0,error_code=null,retry_at=null,lease=null,lease_until=null where id=job;return job;
 end if;
 insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to,source) values(c.id,c.credential_generation,p_actor,p_from,p_to,case when p_force then 'manual' else 'refresh' end) returning id into job;
 return job;
end;$$;

create or replace function public.marketing_ads_request_sync(p_connection uuid,p_from date,p_to date) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor uuid;org uuid;
begin
 select organization_id into org from marketing_connections where id=p_connection;
 actor:=marketing_private.require_access(org,null,'marketing_ads.view');
 return marketing_private.ads_queue_period(p_connection,actor,p_from,p_to,true);
end;$$;

create function public.marketing_ads_ensure_period(p_connection uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid;org uuid;job uuid;
begin
 select organization_id into org from marketing_connections where id=p_connection;
 actor:=marketing_private.require_access(org,null,'marketing_ads.view');
 job:=marketing_private.ads_queue_period(p_connection,actor,p_from,p_to,false);
 return jsonb_build_object('state',case when job is not null then 'syncing' else 'unchanged' end);
end;$$;

-- Retain the original 30-day/current comparison scheduler and its six-hour cadence.
alter function public.marketing_ads_schedule(uuid) rename to ads_schedule_recent;
alter function public.ads_schedule_recent(uuid) set schema marketing_private;
create function public.marketing_ads_schedule(p_connection uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;a marketing_private.ads_accounts;day date;floor date;start_date date;job uuid;period_start date;catalog jsonb;
begin
 select x.* into c from marketing_connections x join marketing_private.ads_accounts h on h.connection_id=x.id and h.generation=x.credential_generation
 where (select automatic_history_enabled from marketing_private.ads_reporting_policy where singleton) and h.read_verified and h.next_sync_at<=now() and x.status in ('test_authorized','production_authorized') and x.expires_at>now() and (p_connection is null or x.id=p_connection)
 and not exists(select 1 from marketing_private.ads_sync_jobs j where j.connection_id=x.id and j.generation=x.credential_generation and j.state in ('queued','leased','retry'))
 order by h.next_sync_at,x.id limit 1 for share of x skip locked;
 if c.id is not null and marketing_private.ads_org_allowed(c.connected_by,c.organization_id,'marketing_ads.view') then
  select * into a from marketing_private.ads_accounts where connection_id=c.id for update skip locked;
  if a.connection_id is not null and exists(select 1 from pg_timezone_names where name=a.timezone) then
   day:=(now() at time zone a.timezone)::date;floor:=(day-interval '37 months')::date;
   select payload->'configs' into catalog from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation order by observed_at desc limit 1;
   -- Wait for initial catalog evidence. Provider epoch sentinel dates never prove a start.
   if catalog is not null then
    select min(left(v->>'start_time',10)::date) into start_date from jsonb_array_elements(coalesce(catalog->'campaigns','[]'))v where v->>'start_time' ~ '^[12][0-9]{3}-[01][0-9]-[0-3][0-9]';
    start_date:=greatest(floor,coalesce(start_date,floor));
    -- At most one long-range job per account/invocation. Existing complete ranges coalesce.
    foreach period_start in array array[day-interval '1 year'+interval '1 day',start_date]::date[] loop
     job:=marketing_private.ads_queue_period(c.id,c.connected_by,period_start,day,false);
     if job is not null then
      update marketing_private.ads_accounts set next_sync_at=now()+interval '15 minutes' where connection_id=c.id;
      return 1;
     end if;
    end loop;
   end if;
  end if;
 end if;
 return marketing_private.ads_schedule_recent(p_connection);
end;$$;

revoke all on function marketing_private.ads_queue_period(uuid,uuid,date,date,boolean),marketing_private.ads_schedule_recent(uuid),public.marketing_ads_ensure_period(uuid,date,date),public.marketing_ads_schedule(uuid) from public,anon,authenticated;
grant execute on function public.marketing_ads_ensure_period(uuid,date,date) to authenticated;
grant execute on function public.marketing_ads_schedule(uuid) to service_role;

-- Expose policy state through the existing authorized account-health projection.
do $$ declare f text;begin
 select pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure) into f;
 if position($old$to_jsonb(a)-'connection_id'$old$ in f)=0 then raise exception 'Ads health projection changed';end if;
 f:=replace(f,$old$to_jsonb(a)-'connection_id'$old$,$new$(to_jsonb(a)-'connection_id')||jsonb_build_object('automatic_history_enabled',(select automatic_history_enabled from marketing_private.ads_reporting_policy where singleton))$new$);
 execute f;
end $$;
