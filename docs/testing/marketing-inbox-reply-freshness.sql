-- Staging only, rollback-only scheduler/authority regression. No provider calls or sends.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare c public.marketing_connections; v public.marketing_conversations; j marketing_private.connection_checks;
 original_authority jsonb; original_connection jsonb; deadline timestamptz; lease_id uuid:=gen_random_uuid();
begin
 select x.* into strict c from public.marketing_connections x
 join marketing_private.inbox_authority a on a.connection_id=x.id
 where a.send_verified and a.configuration_verified and a.webhook_verified and x.expires_at>now()
 and exists(select 1 from public.marketing_conversations q where q.connection_id=x.id) limit 1;
 select * into strict v from public.marketing_conversations where connection_id=c.id limit 1;
 original_connection:=to_jsonb(c);
 -- Synthetic authority freshness is confined to this transaction and always rolled back.
 update marketing_private.inbox_authority set generation=c.credential_generation,verified_at=now()-interval '2 hours' where connection_id=c.id;
 select to_jsonb(a) into original_authority from marketing_private.inbox_authority a where connection_id=c.id;
 update marketing_private.connection_checks set generation=c.credential_generation,due_at=now()+interval '6 hours',checked_at=now()-interval '2 hours',lease_until=null,error_code=null,attempts=0 where connection_id=c.id;
 update public.marketing_conversations set connection_generation=c.credential_generation,last_inbound_at=now()-interval '10 minutes',status='open',opted_out=false,medium='dm' where id=v.id;
 assert marketing_private.inbox_active_reply_window(c.id),'Active DM window not detected';
 assert (select due_at=now() from marketing_private.connection_checks where connection_id=c.id),'Stale authority was not queued';
 assert (select to_jsonb(a)=original_authority from marketing_private.inbox_authority a where connection_id=c.id),'Scheduling fabricated authority';
 -- Repeated inbound/readiness cannot create more queue rows or reset retries.
 perform marketing_private.schedule_inbox_reply_health(c.id);
 assert (select count(*)=1 from marketing_private.connection_checks where connection_id=c.id),'Duplicate check';
 update marketing_private.connection_checks set due_at=now()+interval '10 minutes',error_code='provider_denied',attempts=3 where connection_id=c.id;
 perform marketing_private.schedule_inbox_reply_health(c.id);
 assert (select due_at=now()+interval '10 minutes' and attempts=3 from marketing_private.connection_checks where connection_id=c.id),'Backoff reset';
 update marketing_private.connection_checks set error_code=null,due_at=now()+interval '6 hours',lease=lease_id,lease_until=now()+interval '3 minutes',lease_started_at=now(),requested_at=null,attempts=1 where connection_id=c.id;
 perform marketing_private.schedule_inbox_reply_health(c.id);
 assert (select due_at=now()+interval '6 hours' from marketing_private.connection_checks where connection_id=c.id),'Live lease changed';
 perform public.marketing_meta_health_finish(c.id,c.credential_generation,lease_id,null);
 assert (select due_at=now()+interval '45 minutes' and attempts=0 from marketing_private.connection_checks where connection_id=c.id),'Active success must refresh within one-hour authority';
 -- Error retries and five-attempt cooldown remain canonical.
 update marketing_private.connection_checks set lease_until=now()+interval '3 minutes',attempts=3 where connection_id=c.id;
 perform public.marketing_meta_health_finish(c.id,c.credential_generation,lease_id,'provider_denied');
 assert (select due_at=now()+interval '4 minutes' and attempts=3 from marketing_private.connection_checks where connection_id=c.id),'Retry backoff changed';
 update marketing_private.connection_checks set lease_until=now()+interval '3 minutes',attempts=5 where connection_id=c.id;
 perform public.marketing_meta_health_finish(c.id,c.credential_generation,lease_id,'provider_denied');
 assert (select due_at=now()+interval '6 hours' and attempts=0 from marketing_private.connection_checks where connection_id=c.id),'Failure cooldown changed';
 -- Closed/opted-out/stale-generation/revoked-authority windows never earn refresh eligibility.
 update public.marketing_conversations set last_inbound_at=now()-interval '25 hours' where connection_id=c.id;
 assert not marketing_private.inbox_active_reply_window(c.id),'Closed window accepted';
 update marketing_private.connection_checks set lease_until=now()+interval '3 minutes',attempts=1 where connection_id=c.id;
 perform public.marketing_meta_health_finish(c.id,c.credential_generation,lease_id,null);
 assert (select due_at=now()+interval '6 hours' from marketing_private.connection_checks where connection_id=c.id),'Idle cadence changed';
 update public.marketing_conversations set last_inbound_at=now()-interval '10 minutes',opted_out=true where connection_id=c.id;
 assert not marketing_private.inbox_active_reply_window(c.id),'Opt-out accepted';
 begin
  update public.marketing_conversations set connection_generation=c.credential_generation+1 where id=v.id;
  raise exception 'Conversation generation rewrite accepted';
 exception when raise_exception then if sqlerrm='Conversation generation rewrite accepted' then raise;end if;end;
 update public.marketing_conversations set opted_out=false where connection_id=c.id;
 update marketing_private.inbox_authority set generation=c.credential_generation+1 where connection_id=c.id;
 assert not marketing_private.inbox_active_reply_window(c.id),'Wrong authority generation accepted';
 update marketing_private.inbox_authority set generation=c.credential_generation where connection_id=c.id;
 update marketing_private.inbox_authority set send_verified=false where connection_id=c.id;
 assert not marketing_private.inbox_active_reply_window(c.id),'Revoked authorization accepted';
 assert (select to_jsonb(x)=original_connection from public.marketing_connections x where id=c.id),'Connection changed';
 assert not has_function_privilege('authenticated','marketing_private.schedule_inbox_reply_health(uuid)','EXECUTE'),'Scheduler exposed';
 assert not has_function_privilege('anon','marketing_private.inbox_active_reply_window(uuid)','EXECUTE'),'Private window exposed';
 assert position('interval ''1 hour''' in pg_get_functiondef('public.marketing_inbox_send_material(uuid,uuid)'::regprocedure))>0,'Send freshness guard changed';
end;$$;
rollback;
