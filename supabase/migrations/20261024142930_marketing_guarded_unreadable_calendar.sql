-- Reversible Calendar policy only: no deletion state, receipt rewrite or scheduler.
alter table marketing_private.publication_availability
 add column calendar_control_at timestamptz,
 add column calendar_control_healthy boolean;

create or replace function marketing_private.advance_calendar_checks(p_checks jsonb,p_observation jsonb,p_lease uuid,p_at timestamptz,p_last_available timestamptz) returns jsonb
language plpgsql immutable set search_path=public as $$
declare isolated boolean:=coalesce(p_observation->'_calendar_isolated_verified'='true',false);kind text;checks jsonb;item jsonb;
begin
 if p_lease is null or p_last_available is null or not(isolated or
  p_observation->>'state'='unavailable' and p_observation->>'source'='object_read' and p_observation->>'reason'='not_public') then return '[]'::jsonb;end if;
 kind:=case when isolated then 'isolated_unreadable' else 'not_public' end;
 select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into checks
 from jsonb_array_elements(p_checks) with ordinality
 where (value->>'at')::timestamptz between p_at-interval '72 hours' and p_at
  and coalesce(value->>'kind','not_public')=kind;
 if exists(select 1 from jsonb_array_elements(checks) x where x->>'lease'=p_lease::text or (x->>'at')::timestamptz>p_at-interval '6 hours') then return checks;end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into checks from
  (select value,ordinality from jsonb_array_elements(checks) with ordinality order by ordinality desc limit 2) kept;
 item:=jsonb_build_object('at',p_at,'lease',p_lease,'kind',kind);
 if isolated then item:=item||jsonb_build_object('control',p_observation->>'calendar_control_id','code',p_observation->'graph_error_code','subcode',p_observation->'graph_error_subcode','published_at',p_last_available);end if;
 return checks||jsonb_build_array(item);
end;$$;
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
    ((state='unavailable' and source='object_read' and reason='not_public' and last_available_at<now()-interval '24 hours') or
    (state in('unavailable','access_restricted') and source='object_read' and calendar_checks->2->>'kind'='isolated_unreadable'
     and (calendar_checks->2->>'published_at')::timestamptz<now()-interval '24 hours'
     and (select coalesce(control.calendar_control_healthy and control.calendar_control_at>now()-interval '24 hours'
       and control.calendar_control_at>=(evidence.calendar_checks->2->>'at')::timestamptz,false)
      from marketing_private.publication_availability control where control.connection_id=p_connection and control.connection_generation=p_generation
       and control.calendar_control_at is not null order by control.calendar_control_at desc limit 1)
     and exists(select 1 from public.marketing_connections current_conn where current_conn.id=p_connection and current_conn.credential_generation=p_generation
      and current_conn.provider_account_id=p_account and current_conn.status in('test_authorized','production_authorized') and current_conn.expires_at>now()
      and current_conn.sync_error_code is null))) and connection_generation=p_generation and not(active and recovered)
    and jsonb_array_length(calendar_checks)=3
    and (calendar_checks->0->>'at')::timestamptz>=now()-interval '72 hours'
    and (calendar_checks->2->>'at')::timestamptz>=now()-interval '24 hours'
    and (calendar_checks->2->>'at')::timestamptz-(calendar_checks->0->>'at')::timestamptz>=interval '12 hours',false),
    'policy',case when calendar_checks->2->>'kind'='isolated_unreadable' then 'isolated_unreadable' else 'repeated_not_public' end,'check_count',coalesce(jsonb_array_length(calendar_checks),0)),
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
declare c public.marketing_connections;o jsonb;a marketing_private.publication_availability;next_state text;next_reason text;next_source text;observed_time timestamptz:=clock_timestamp();can_restore boolean;control_ok boolean;published_anchor timestamptz;
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
  -- Control identity must be another known post of this exact account/generation, in the same guarded batch.
  control_ok:=coalesce(o->>'source'='object_read' and o->>'calendar_control_id'<>o->>'id'
   and ((c.channel='facebook' and o->'graph_error_code'='10'::jsonb and o->>'state'='access_restricted' and o->>'reason'='permission_or_token')
    or(c.channel='instagram' and o->'graph_error_code'='100'::jsonb and o->'graph_error_subcode'='33'::jsonb and o->>'state'='unavailable' and o->>'reason'='object_missing_or_unreadable'))
   and marketing_private.publication_known(c.id,p_generation,o->>'calendar_control_id')
   and (select count(*)=1 from jsonb_array_elements(p_observations) ctl where ctl->>'id'=o->>'calendar_control_id'
    and ctl->'calendar_control_check'='true'::jsonb and ctl->>'state'='available' and ctl->>'source'='object_read' and ctl->>'reason'='provider_observed'),false);
  published_anchor:=null;
  if control_ok then
   select min(at) into published_anchor from (
    select s.published_at at from public.marketing_social_posts s where s.connection_id=c.id and s.organization_id=c.organization_id and s.brand_id=c.brand_id
     and s.provider_post_id=o->>'id' and (s.connection_generation=p_generation or s.provider_account_id=c.provider_account_id)
    union all select j.updated_at from public.marketing_jobs j where j.connection_id=c.id and j.connection_generation=p_generation
     and j.organization_id=c.organization_id and j.brand_id=c.brand_id and j.provider_post_id=o->>'id' and j.state='succeeded' and j.provider_state->>'post_id'=j.provider_post_id
   ) historical where at is not null and at<=observed_time;
   published_anchor:=coalesce(published_anchor,a.last_available_at);
  end if;
  can_restore:=o->>'state'='available' and (a.state<>'deleted' or o->>'source'='object_read' and observed_time>a.last_removal_at);
  -- An ambiguous read cannot erase signed removal proof. A later positive read can.
  next_state:=case when a.state='deleted' and not can_restore then a.state else o->>'state' end;
  next_reason:=case when a.state='deleted' and not can_restore then a.reason else o->>'reason' end;
  next_source:=case when a.state='deleted' and not can_restore then a.source else o->>'source' end;
  update marketing_private.publication_availability set state=next_state,reason=next_reason,source=next_source,
   calendar_checks=marketing_private.advance_calendar_checks(a.calendar_checks,o||jsonb_build_object('_calendar_isolated_verified',control_ok),p_lease,observed_time,case when control_ok then published_anchor else a.last_available_at end),
   calendar_control_at=case when o->'calendar_control_check'='true'::jsonb then observed_time else a.calendar_control_at end,
   calendar_control_healthy=case when o->'calendar_control_check'='true'::jsonb then o->>'state'='available' and o->>'source'='object_read' and o->>'reason'='provider_observed' else a.calendar_control_healthy end,
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
