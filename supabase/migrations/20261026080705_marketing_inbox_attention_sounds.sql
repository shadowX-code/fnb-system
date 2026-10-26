-- Immutable, content-free handoff identity; no backfill and no change to AI execution/ownership.
create unique index marketing_events_inbox_handoff_identity
 on public.marketing_events ((details->>'turn_id')) where action='inbox_ai_handoff';
create function marketing_private.inbox_handoff_observed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details)
 select c.organization_id,c.brand_id,'inbox_ai_handoff',new.actor_employee_id,
  jsonb_build_object('conversation_id',c.id,'turn_id',new.id,'reason',left(new.reason,100))
 from public.marketing_conversations c where c.id=new.conversation_id
 on conflict ((details->>'turn_id')) where action='inbox_ai_handoff' do nothing;
 return new;
end;$$;
revoke all on function marketing_private.inbox_handoff_observed() from public,anon,authenticated,service_role;
create trigger inbox_handoff_observed after update of summary on marketing_private.inbox_automatic_turns
 for each row when (old.summary is null and new.summary is not null)
 execute function marketing_private.inbox_handoff_observed();

-- Bound the recent-message projection without scanning retained conversation history.
create index marketing_messages_sound_candidates on public.marketing_conversation_messages(conversation_id,created_at desc)
 where kind in ('incoming','attachment') and evidence_source='signed_webhook';

create or replace function public.marketing_inbox_reply_count(p_org uuid default null,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=marketing_private.actor(); at_ timestamptz:=statement_timestamp(); n integer; token text; events_ jsonb;
begin
 if not public.current_user_has_permission('marketing_workspace.access') or not public.current_user_has_permission('marketing_inbox.view') then
  raise exception using errcode='42501',message='Conversation access unavailable.';
 end if;
 if p_brand is not null and p_org is null then raise exception 'Organization is required for brand scope.';end if;
 if p_org is not null then perform marketing_private.require_access(p_org,p_brand,'marketing_inbox.view');end if;
 with scoped as not materialized (
  select c.* from public.marketing_conversations c
  where (p_org is null or c.organization_id=p_org) and (p_brand is null or c.brand_id=p_brand)
   and marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.view')
 ), recent_messages as materialized (
  select m.id,m.conversation_id,m.sequence,m.created_at,m.occurred_at
  from scoped c join public.marketing_conversation_messages m on m.conversation_id=c.id
  where m.kind in ('incoming','attachment') and m.evidence_source='signed_webhook' and m.provider_message_id is not null
   and m.created_at>at_-interval '2 minutes' and m.created_at<=at_
   and m.occurred_at>at_-interval '90 seconds' and m.occurred_at<=at_
  order by m.created_at desc,m.id desc limit 100
 ), activity as (
  select 'message:'||m.id id,'inbound' kind,c.id conversation_id,m.created_at,m.occurred_at,
   coalesce(not c.takeover and c.assigned_to is null and p.ai_reply_mode in ('safe_auto','ai_first')
    and marketing_private.inbox_auto_issue(c::public.marketing_conversations,p) is null and exists(
     select 1 from marketing_private.inbox_automatic_turns t join marketing_conversation_messages last_ on last_.id=t.message_id
     where t.conversation_id=c.id and t.state in ('queued','generating','prepared','pending')
      and m.sequence between coalesce(t.batch_first_sequence,last_.sequence) and last_.sequence
      and not exists(select 1 from marketing_conversation_messages newer where newer.conversation_id=c.id and newer.kind in ('incoming','attachment') and newer.sequence>last_.sequence)),false) automatic_candidate
  from scoped c join recent_messages m on m.conversation_id=c.id
  left join public.marketing_inbox_policies p on p.brand_id=c.brand_id
  where marketing_private.inbox_needs_reply(c.id)
  union all
  select 'handoff:'||e.id,'handoff',c.id,e.created_at,e.created_at,false
  from scoped c join public.marketing_events e on e.organization_id=c.organization_id and e.brand_id=c.brand_id
   and e.details->>'conversation_id'=c.id::text
  join marketing_private.inbox_automatic_turns t on t.conversation_id=c.id and t.id::text=e.details->>'turn_id' and t.summary is not null
  where e.action='inbox_ai_handoff' and e.created_at>at_-interval '90 seconds' and e.created_at<=at_
   and marketing_private.inbox_handoff_needed(c.id)
   and not exists(select 1 from public.marketing_events r where r.organization_id=c.organization_id and r.brand_id=c.brand_id
    and r.action='inbox_resume_ai' and r.details->>'conversation_id'=c.id::text and r.created_at>=e.created_at)
 )
 select (select count(*) from scoped c where marketing_private.inbox_needs_reply(c.id)),
  (select count(*)::text||':'||coalesce(sum(c.version),0)::text||':'||coalesce(max(c.updated_at)::text,'') from scoped c),
  (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from
   (select * from activity order by created_at desc,id desc limit 100)x)
 into n,token,events_;
 return jsonb_build_object('needs_reply',n,'change_token',token,'observed_at',at_,'sound_events',events_);
end;$$;
revoke all on function public.marketing_inbox_reply_count(uuid,uuid) from public,anon;
grant execute on function public.marketing_inbox_reply_count(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
