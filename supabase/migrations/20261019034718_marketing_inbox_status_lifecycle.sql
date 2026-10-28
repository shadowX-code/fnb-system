-- Inbox owns status; sends and external echoes never establish completion.
alter table public.marketing_conversations
 add column status_changed_at timestamptz,
 add column pending_since timestamptz,
 add column last_activity_at timestamptz,
 add column resolution_hold boolean not null default false,
 add column resolution_checked_at timestamptz;
alter table public.marketing_inbox_policies
 add column auto_resolve_enabled boolean not null default false,
 add column auto_resolve_hours integer not null default 48 check(auto_resolve_hours in (24,48,72));
create index marketing_inbox_pending_expiry on public.marketing_conversations(coalesce(resolution_checked_at,'-infinity'::timestamptz),pending_since,id) where status='pending' and pending_since is not null;

create function marketing_private.inbox_resolution_blocker(p_conversation uuid) returns text
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations;
begin
 select * into c from marketing_conversations where id=p_conversation;
 if c.id is null then return 'Conversation unavailable';end if;
 if c.resolution_hold then return 'An unresolved follow-up or task is recorded';end if;
 if cardinality(c.escalation_reasons)>0 or c.priority='urgent' then return 'Human attention is still required';end if;
 if exists(select 1 from marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','attachment','note') and cardinality(marketing_private.inbox_risk(m.body))>0) then return 'Complaint, refund or safety history requires staff resolution';end if;
 if exists(select 1 from marketing_private.inbox_automatic_turns t where t.conversation_id=c.id and (t.state='handoff' or t.summary like 'Needs staff:%') and t.updated_at>coalesce((select max(e.created_at) from marketing_events e where e.brand_id=c.brand_id and e.action='inbox_clear_escalation' and e.details->>'conversation_id'=c.id::text),'-infinity'::timestamptz)) then return 'An active human handoff requires resolution';end if;
 if exists(select 1 from marketing_reply_drafts d left join marketing_reply_outbox o on o.draft_id=d.id where d.conversation_id=c.id and (o.state in ('prepared','pending','reconciling') or d.status in ('draft','review','approved') and coalesce(o.state,'') not in ('sent','delivered','read'))) or exists(select 1 from marketing_private.inbox_automatic_turns t where t.conversation_id=c.id and t.state in ('queued','generating','prepared','pending','reconciling')) then return 'Unfinished reply work requires staff attention';end if;
 return null;
end;$$;
revoke all on function marketing_private.inbox_resolution_blocker(uuid) from public,anon,authenticated,service_role;

create function marketing_private.inbox_status_transition() returns trigger
language plpgsql security definer set search_path=public as $$
declare issue text;
begin
 if tg_op='INSERT' then
  new.status_changed_at:=now();new.pending_since:=case when new.status='pending' then now() end;return new;
 end if;
 -- Taking ownership is active handling, not waiting for the customer.
 if new.status=old.status and new.status='pending' and (new.assigned_to is distinct from old.assigned_to or not old.takeover and new.takeover or not old.resolution_hold and new.resolution_hold) then new.status:='open';end if;
 if new.status is distinct from old.status then
  if new.status='pending' then
   if new.resolution_hold then raise exception 'An unresolved follow-up or task is recorded. Keep Open until the work is complete.';end if;
   issue:=marketing_private.inbox_resolution_blocker(old.id);
   if issue is not null then raise exception using errcode='22023',message=issue||'. Keep Open until the work is complete.';end if;
  end if;
  new.status_changed_at:=now();new.pending_since:=case when new.status='pending' then now() end;new.resolution_checked_at:=null;
 end if;
 return new;
end;$$;
revoke all on function marketing_private.inbox_status_transition() from public,anon,authenticated,service_role;
create trigger marketing_inbox_status_transition before insert or update on public.marketing_conversations for each row execute function marketing_private.inbox_status_transition();

create function marketing_private.inbox_resolve_pending(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations;p public.marketing_inbox_policies;n integer:=0;checked integer:=0;failed integer:=0;issue text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid resolution limit';end if;
 -- Fair bounded scan: protected work cannot starve later eligible conversations.
 for c in select c0.* from marketing_conversations c0 join marketing_inbox_policies p0 on p0.brand_id=c0.brand_id
  where c0.status='pending' and c0.channel<>'internal' and c0.pending_since is not null and p0.auto_resolve_enabled
   and greatest(c0.pending_since,coalesce(c0.last_activity_at,c0.pending_since))<=now()-make_interval(hours=>p0.auto_resolve_hours)
   and (c0.resolution_checked_at is null or c0.resolution_checked_at<now()-interval '5 minutes')
  order by coalesce(c0.resolution_checked_at,'-infinity'::timestamptz),c0.pending_since,c0.id limit p_limit for update of c0 skip locked loop
  begin
   perform 1 from brands where id=c.brand_id for share;
   select * into p from marketing_inbox_policies where brand_id=c.brand_id for share;
   checked:=checked+1;update marketing_conversations set resolution_checked_at=now() where id=c.id;
   if not p.auto_resolve_enabled or not marketing_private.actor_allowed(p.updated_by,c.organization_id,c.brand_id,'marketing_inbox.configure') or greatest(c.pending_since,coalesce(c.last_activity_at,c.pending_since))>now()-make_interval(hours=>p.auto_resolve_hours) then continue;end if;
   issue:=marketing_private.inbox_resolution_blocker(c.id);if issue is not null then continue;end if;
   update marketing_conversations set status='resolved',version=version+1,updated_at=now() where id=c.id and status='pending';
   insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_auto_resolved',p.updated_by,jsonb_build_object('conversation_id',c.id,'from','pending','to','resolved','pending_since',c.pending_since,'last_activity_at',c.last_activity_at,'hours',p.auto_resolve_hours,'policy_revision',p.revision));n:=n+1;
  exception when others then failed:=failed+1;end;
 end loop;
 return jsonb_build_object('checked',checked,'resolved',n,'failed',failed);
end;$$;
revoke all on function marketing_private.inbox_resolve_pending(integer) from public,anon,authenticated,service_role;

do $migration$ declare f text;needle text;query_ text;counts_query text;begin
 f:=pg_get_functiondef('public.marketing_inbox_configure(uuid,uuid,integer,text,jsonb)'::regprocedure);
 needle:=$n$ elsif p_command in ('save_faq','activate_faq','deactivate_faq','disable_faq') then$n$;
 if position(needle in f)=0 then raise exception 'Policy baseline differs';end if;
 f:=replace(f,needle,$body$
  if p_payload ? 'auto_resolve_enabled' and jsonb_typeof(p_payload->'auto_resolve_enabled') is distinct from 'boolean' then raise exception 'Choose whether Auto Resolve is enabled';end if;
  if p_payload ? 'auto_resolve_hours' and coalesce(p_payload->>'auto_resolve_hours','') not in ('24','48','72') then raise exception 'Choose 24, 48 or 72 hours';end if;
  update marketing_inbox_policies set auto_resolve_enabled=coalesce((p_payload->>'auto_resolve_enabled')::boolean,auto_resolve_enabled),auto_resolve_hours=coalesce((p_payload->>'auto_resolve_hours')::integer,auto_resolve_hours) where brand_id=p_brand returning to_jsonb(marketing_inbox_policies) into result;
$body$||needle);execute f;

 f:=pg_get_functiondef('public.marketing_inbox_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
 needle:=$n$tags=array(select distinct trim(t) from jsonb_array_elements_text(p_payload->'tags') t),takeover=$n$;
 if position(needle in f)=0 then raise exception 'Handling baseline differs';end if;
 f:=replace(f,needle,$n$resolution_hold=coalesce((p_payload->>'resolution_hold')::boolean,resolution_hold),$n$||needle);
 needle:=$n$update public.marketing_conversations set version=version+1,updated_at=now(),escalation_reasons=$n$;
 if position(needle in f)=0 then raise exception 'Note baseline differs';end if;
 execute replace(f,needle,$n$update public.marketing_conversations set status='open',last_activity_at=now(),version=version+1,updated_at=now(),escalation_reasons=$n$);

 f:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 needle:=$n$status=case when ev.evidence_source<>'historical_import' and item->>'kind' in ('incoming','attachment') then 'open' else status end,$n$;
 if position(needle in f)=0 then raise exception 'Inbound baseline differs';end if;
 f:=replace(f,needle,$n$last_activity_at=case when ev.evidence_source<>'historical_import' then greatest(last_activity_at,(item->>'occurred_at')::timestamptz) else last_activity_at end,
      status=case when ev.evidence_source<>'historical_import' and item->>'kind' in ('incoming','attachment') and (item->>'occurred_at')::timestamptz>coalesce(c.status_changed_at,c.updated_at) then 'open' else status end,$n$);
 needle:=$n$ return jsonb_build_object('processed',processed,'blocked',blocked,'retry_or_failed',failed);$n$;
 if position(needle in f)=0 then raise exception 'Drain baseline differs';end if;
 execute replace(f,needle,$n$ return jsonb_build_object('processed',processed,'blocked',blocked,'retry_or_failed',failed,'auto_resolution',marketing_private.inbox_resolve_pending(10));$n$);

 f:=pg_get_functiondef('public.marketing_inbox_send_checkpoint(uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:=$n$ return jsonb_build_object('state',o.state,'lease',o.lease,'receipt',o.provider_message_id);$n$;
 if position(needle in f)=0 then raise exception 'Receipt baseline differs';end if;
 execute replace(f,needle,$n$ if o.state in ('sent','delivered','read') then
  update marketing_conversations c set last_activity_at=greatest(c.last_activity_at,o.sent_at) from marketing_reply_drafts d where d.id=o.draft_id and c.id=d.conversation_id;
 end if;
$n$||needle);

 f:=pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean)'::regprocedure);
 f:=replace(f,'usage jsonb;','usage jsonb; counts jsonb;');
 query_:=substring(f from position(' select count(*) into total from' in f) for position(E';\n select coalesce(jsonb_agg(to_jsonb(x))' in f)-position(' select count(*) into total from' in f)+1);
 if query_ is null or length(query_)<100 then raise exception 'Read baseline differs';end if;
 counts_query:=replace(query_,'select count(*) into total','select jsonb_build_object(''all'',count(*),''open'',count(*) filter(where c.status=''open''),''pending'',count(*) filter(where c.status=''pending''),''resolved'',count(*) filter(where c.status=''resolved'')) into counts');
 counts_query:=replace(counts_query,'(p_status='''' or c.status=p_status) and ','');
 f:=replace(f,query_,counts_query||E'\n'||query_);
 f:=replace(f,'c.last_inbound_at,c.updated_at,c.medium','c.last_inbound_at,c.updated_at,c.pending_since,c.status_changed_at,coalesce(c.last_activity_at,latest.occurred_at,c.created_at) last_activity_at,c.resolution_hold,c.medium');
 needle:=$n$'ai_usage',usage,'rows',rows$n$;
 if position(needle in f)=0 then raise exception 'Count projection differs';end if;
 execute replace(f,needle,$n$'ai_usage',usage,'status_counts',counts,'rows',rows$n$);
end;$migration$;
