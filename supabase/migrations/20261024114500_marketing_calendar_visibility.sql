-- Calendar visibility is a reversible read policy, never deletion or receipt evidence.
alter table marketing_private.publication_availability add column calendar_checks jsonb not null default '[]'
 check(jsonb_typeof(calendar_checks)='array' and jsonb_array_length(calendar_checks)<=3 and octet_length(calendar_checks::text)<=1024);

-- Only successful exact-object not-public responses qualify. All access, identity,
-- transport and ambiguous missing-object failures clear the streak (fail visible).
create function marketing_private.advance_calendar_checks(p_checks jsonb,p_observation jsonb,p_lease uuid,p_at timestamptz,p_last_available timestamptz) returns jsonb
language sql immutable set search_path=public as $$
 with recent as (
  select value,ordinality from jsonb_array_elements(p_checks) with ordinality
  where (value->>'at')::timestamptz between p_at-interval '72 hours' and p_at
 ), eligible as (
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) checks from recent
 )
 select case when p_observation->>'state' is distinct from 'unavailable' or p_observation->>'source' is distinct from 'object_read'
   or p_observation->>'reason' is distinct from 'not_public' or p_last_available is null or p_lease is null then '[]'::jsonb
  when exists(select 1 from recent where value->>'lease'=p_lease::text)
   or exists(select 1 from recent where (value->>'at')::timestamptz>p_at-interval '6 hours') then checks
  else (select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) from
   (select value,ordinality from recent order by ordinality desc limit 2) kept)
   ||jsonb_build_array(jsonb_build_object('at',p_at,'lease',p_lease)) end from eligible;
$$;
revoke all on function marketing_private.advance_calendar_checks(jsonb,jsonb,uuid,timestamptz,timestamptz) from public,anon,authenticated;

create or replace function marketing_private.publication_availability_projection(p_connection uuid,p_generation integer,p_account text,p_post text) returns jsonb
language sql stable security definer set search_path=public as $$
 with scoped as materialized (
  select * from marketing_private.publication_availability where connection_id=p_connection and provider_post_id=p_post
   and (connection_generation=p_generation or p_account is not null and provider_account_id=p_account)
 ), provider as (select * from scoped order by checked_at desc nulls last,connection_generation desc limit 1),
 manual as (select * from scoped where manual_revision>0 order by manual_revision desc limit 1),
 evidence as (
 select p.state,p.source,p.reason,p.checked_at,p.last_available_at,p.last_attempt_at,p.calendar_checks,p.connection_generation,
  m.manual_revision,m.manual_removed_at,m.manual_removed_by,m.manual_cleared_at,
  coalesce(m.manual_removed_at>coalesce(m.manual_cleared_at,'-infinity'),false) active,
  coalesce((select max(last_object_available_at) from scoped)>m.manual_removed_at,false) recovered
 from (select 1) seed left join provider p on true left join manual m on true
 )
 select jsonb_build_object(
  'state',case when active and not recovered and coalesce(state,'unknown')<>'deleted' then 'manually_removed' else coalesce(state,'unknown') end,
  'provider_state',coalesce(state,'unknown'),'source',coalesce(source,'not_checked'),'reason',coalesce(reason,'not_checked'),
  'checked_at',checked_at,'last_available_at',last_available_at,'last_attempt_at',last_attempt_at,
  'calendar_visibility',jsonb_build_object('hidden',coalesce(
    state='unavailable' and source='object_read' and reason='not_public' and connection_generation=p_generation and not(active and recovered)
    and last_available_at<now()-interval '24 hours' and jsonb_array_length(calendar_checks)=3
    and (calendar_checks->0->>'at')::timestamptz>=now()-interval '72 hours'
    and (calendar_checks->2->>'at')::timestamptz>=now()-interval '24 hours'
    and (calendar_checks->2->>'at')::timestamptz-(calendar_checks->0->>'at')::timestamptz>=interval '12 hours',false),
    'policy','repeated_not_public','check_count',coalesce(jsonb_array_length(calendar_checks),0)),
  'manual_revision',coalesce(manual_revision,0),
  'manual_confirmation',case when manual_revision>0 then jsonb_build_object(
    'state',case when not active then 'cleared' when recovered then 'conflict' else 'confirmed' end,
    'at',manual_removed_at,'actor',manual_removed_by,
    'actor_name',(select coalesce(nullif(trim(nickname),''),full_name) from public.employees where id=manual_removed_by),
    'cleared_at',manual_cleared_at,'source','staff_confirmation') end)
 from evidence;
$$;

create or replace function marketing_private.record_publication_availability(p_connection uuid,p_generation integer,p_lease uuid,p_observations jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;o jsonb;a marketing_private.publication_availability;next_state text;next_reason text;next_source text;observed_time timestamptz;can_restore boolean;
begin
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 if jsonb_typeof(p_observations) is distinct from 'array' or jsonb_array_length(p_observations)>8 or octet_length(p_observations::text)>8192 then raise exception 'Invalid availability evidence.';end if;
 select * into c from public.marketing_connections where id=p_connection;
 for o in select value from jsonb_array_elements(p_observations) loop
  if not marketing_private.publication_known(c.id,p_generation,o->>'id') then raise exception 'Availability identity is not known to this connection.';end if;
  if o->>'state' not in ('available','unavailable','access_restricted','temporarily_unavailable') or o->>'state' is null
   or coalesce(o->>'source','') not in ('owned_feed','object_read')
   or coalesce(o->>'reason','') not in ('provider_observed','object_missing_or_unreadable','not_public','identity_unverified','permission_or_token','provider_temporary','response_unverified')
   or (o->>'source'='owned_feed' and (o->>'state'<>'available' or o->>'reason'<>'provider_observed')) then raise exception 'Invalid availability classification.';end if;
  insert into marketing_private.publication_availability(connection_id,connection_generation,provider_account_id,provider_post_id,state,source,reason,checked_at,last_available_at,last_removal_at,last_removal_fingerprint)
  select c.id,p_generation,c.provider_account_id,o->>'id',coalesce(prior.state,'unknown'),coalesce(prior.source,'not_checked'),coalesce(prior.reason,'not_checked'),prior.checked_at,prior.last_available_at,prior.last_removal_at,prior.last_removal_fingerprint
  from (select 1) seed left join lateral(select * from marketing_private.publication_availability old where old.connection_id=c.id and old.provider_account_id=c.provider_account_id and old.provider_post_id=o->>'id' order by old.checked_at desc nulls last,old.connection_generation desc limit 1) prior on true on conflict do nothing;
  select * into a from marketing_private.publication_availability where connection_id=c.id and connection_generation=p_generation and provider_post_id=o->>'id' for update;
  observed_time:=clock_timestamp();
  can_restore:=o->>'state'='available' and (a.state<>'deleted' or o->>'source'='object_read' and observed_time>a.last_removal_at);
  -- An ambiguous read cannot erase signed removal proof. A later positive read can.
  next_state:=case when a.state='deleted' and not can_restore then a.state else o->>'state' end;
  next_reason:=case when a.state='deleted' and not can_restore then a.reason else o->>'reason' end;
  next_source:=case when a.state='deleted' and not can_restore then a.source else o->>'source' end;
  update marketing_private.publication_availability set state=next_state,reason=next_reason,source=next_source,
   calendar_checks=marketing_private.advance_calendar_checks(a.calendar_checks,o,p_lease,observed_time,a.last_available_at),
   checked_at=case when a.state='deleted' and not can_restore then a.checked_at else observed_time end,last_attempt_at=observed_time,
   last_available_at=case when can_restore then observed_time else a.last_available_at end,
   last_object_available_at=case when o->>'state'='available' and o->>'source'='object_read'
    and not exists(select 1 from marketing_private.publication_availability manual where manual.connection_id=c.id
      and manual.provider_account_id=c.provider_account_id and manual.provider_post_id=o->>'id' and manual.manual_sync_lease=p_lease)
    then observed_time else a.last_object_available_at end,
   next_check_at=observed_time+case when next_state='temporarily_unavailable' then interval '15 minutes' when next_state='deleted' then interval '24 hours' else interval '6 hours' end
  where connection_id=c.id and connection_generation=p_generation and provider_post_id=o->>'id';
 end loop;
end;$$;
revoke all on function marketing_private.record_publication_availability(uuid,integer,uuid,jsonb) from public,anon,authenticated;


create function marketing_private.publication_calendar_hidden(p_channels jsonb) returns boolean
language sql immutable set search_path=public as $$
 select coalesce(jsonb_array_length(p_channels)>0 and (
  select bool_and(coalesce(v->>'status'='published' and v->>'provider_post_id' is not null
   and coalesce(v->'availability'->'manual_confirmation'->>'state','')<>'conflict'
   and (coalesce(v->'availability'->>'state','unknown') in ('deleted','manually_removed')
    or coalesce((v->'availability'->'calendar_visibility'->>'hidden')::boolean,false)),false))
  from jsonb_array_elements(p_channels) v
 ),false);
$$;
revoke all on function marketing_private.publication_calendar_hidden(jsonb) from public,anon,authenticated;

do $$declare f text;begin
 select pg_get_functiondef('public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text,boolean)'::regprocedure) into f;
 if position('not marketing_private.publication_fully_removed(channels)' in f)=0 then raise exception 'Calendar reader baseline differs';end if;
 execute replace(f,'not marketing_private.publication_fully_removed(channels)','not marketing_private.publication_calendar_hidden(channels)');
end;$$;
