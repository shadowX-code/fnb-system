-- Keep the one-hour send-authority guard; refresh active DM connections before it expires.
-- This is scheduling intent only. Only the existing provider verifier can refresh authority.
create function marketing_private.inbox_active_reply_window(p_connection uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.marketing_connections c
  join marketing_private.inbox_authority a on a.connection_id=c.id and a.generation=c.credential_generation
  where c.id=p_connection and c.channel in ('facebook','instagram')
   and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
   and a.send_verified and a.configuration_verified and a.webhook_verified
   and exists(select 1 from public.marketing_conversations v
    where v.connection_id=c.id and v.connection_generation=c.credential_generation
     and v.organization_id=c.organization_id and v.brand_id=c.brand_id
     and v.channel=c.channel and coalesce(v.medium,'dm')='dm'
     and v.status<>'resolved' and not v.opted_out
     and v.last_inbound_at>now()-interval '24 hours' and v.last_inbound_at<=now())
 );
$$;
revoke all on function marketing_private.inbox_active_reply_window(uuid) from public,anon,authenticated;

create function marketing_private.schedule_inbox_reply_health(p_connection uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not marketing_private.inbox_active_reply_window(p_connection) then return;end if;
 update marketing_private.connection_checks j
 set due_at=least(j.due_at,greatest(now(),a.verified_at+interval '45 minutes',coalesce(j.checked_at+interval '1 minute',now())))
 from public.marketing_connections c,marketing_private.inbox_authority a
 where c.id=p_connection and j.connection_id=c.id and j.generation=c.credential_generation
  and a.connection_id=c.id and a.generation=c.credential_generation
  -- Preserve failures/backoff and live leases; this never resets an attempt or failed check.
  and j.error_code is null and (j.lease_until is null or j.lease_until<now());
end;
$$;
revoke all on function marketing_private.schedule_inbox_reply_health(uuid) from public,anon,authenticated;

create function marketing_private.inbox_reply_health_schedule() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='INSERT' or new.last_inbound_at is distinct from old.last_inbound_at
  or new.status is distinct from old.status or new.opted_out is distinct from old.opted_out then
  perform marketing_private.schedule_inbox_reply_health(new.connection_id);
 end if;
 return new;
end;
$$;
revoke all on function marketing_private.inbox_reply_health_schedule() from public,anon,authenticated;
create trigger marketing_inbox_reply_health_schedule
 after insert or update of last_inbound_at,status,opted_out on public.marketing_conversations
 for each row execute function marketing_private.inbox_reply_health_schedule();

-- Preserve the canonical guard, lease completion, request coalescing and failure backoff.
do $$declare body text; old_fragment text := $old$when p_error is null or attempts>=5 then interval '6 hours'$old$;
begin
 body:=pg_get_functiondef('public.marketing_meta_health_finish(uuid,integer,uuid,text)'::regprocedure);
 if position(old_fragment in body)=0 then raise exception 'Health completion contract changed.';end if;
 body:=replace(body,old_fragment,$new$when p_error is null and marketing_private.inbox_active_reply_window(p_connection) then interval '45 minutes' when p_error is null or attempts>=5 then interval '6 hours'$new$);
 execute body;
end;$$;

-- Coalesce existing active windows into the same bounded queue, without provider calls,
-- credential changes, authority timestamp changes, event replay or outbound intent.
select marketing_private.schedule_inbox_reply_health(c.id)
from public.marketing_connections c where c.channel in ('facebook','instagram');
