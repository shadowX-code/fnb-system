-- Match the shared Conversations Social filter without including internal cases.
create or replace function public.marketing_inbox_analytics(p_org uuid,p_brand uuid default null,p_channel text default '',p_start timestamptz default null,p_end timestamptz default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); result jsonb;
begin
 if p_channel is null or p_channel not in ('','social','internal','facebook','instagram') or (p_start is not null and p_end is not null and p_end<=p_start) then raise exception 'Invalid analytics filters.';end if;
 with scoped as (select * from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id) and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_start is null or c.created_at>=p_start) and (p_end is null or c.created_at<p_end)),
 response as (select c.id, min(m.occurred_at) filter(where m.kind='incoming') inbound,(select min(outgoing.occurred_at) from public.marketing_conversation_messages outgoing where outgoing.conversation_id=c.id and outgoing.kind='echo' and outgoing.occurred_at>=(select min(inbound.occurred_at) from public.marketing_conversation_messages inbound where inbound.conversation_id=c.id and inbound.kind='incoming')) outbound from scoped c join public.marketing_conversation_messages m on m.conversation_id=c.id group by c.id),
 artifacts as (select a.* from public.marketing_inbox_ai_artifacts a join scoped c on c.id=a.conversation_id where a.kind='reply'),
 counts as (select count(*) volume,count(*) filter(where status<>'resolved') unresolved,(select count(distinct e.details->>'conversation_id') from public.marketing_events e where e.action='inbox_handover' and e.details->>'conversation_id' in (select id::text from scoped)) handovers from scoped)
 select jsonb_build_object('volume',volume,'unresolved',unresolved,'human_handovers',handovers,
 'first_response_seconds',(select percentile_cont(0.5) within group(order by extract(epoch from outbound-inbound)) from response where outbound>=inbound),
 'first_response_sample',(select count(*) from response where outbound>=inbound),'ai_reply_proposals',(select count(*) from artifacts),
 'ai_acceptance_rate',(select count(*) filter(where state='approved')::numeric/nullif(count(*) filter(where state in ('approved','rejected')),0) from artifacts),
 'automation_rate',null,'automation_unavailable_reason','messaging_execution_disabled','cohort','conversations_created_in_period') into result from counts;
 return result;
end;$$;

revoke all on function public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz) to authenticated;
