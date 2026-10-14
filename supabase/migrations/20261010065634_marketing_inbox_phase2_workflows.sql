-- Forward Phase 2 projection and event contracts. Publishing connections/credentials remain untouched.
alter table public.marketing_conversations add column medium text not null default 'dm' check(medium in ('dm','comment')),
 add column intent text not null default 'unknown', add column language text not null default 'EN' check(language in ('EN','ZH','BM')),
 add column classification_source text not null default 'rules' check(classification_source in ('rules','ai')),
 add column opted_out boolean not null default false;
alter table public.marketing_conversation_messages add column sequence bigint generated always as identity;
create index marketing_messages_unread on public.marketing_conversation_messages(conversation_id,sequence) where kind in ('incoming','attachment');
create table public.marketing_inbox_reads (
 conversation_id uuid not null references public.marketing_conversations(id), employee_id uuid not null references public.employees(id),
 through_sequence bigint not null default 0, read_at timestamptz not null default now(), primary key(conversation_id,employee_id)
);
create index marketing_inbox_reads_employee on public.marketing_inbox_reads(employee_id);
alter table public.marketing_inbox_reads enable row level security;
revoke all on public.marketing_inbox_reads from public,anon,authenticated;
alter table public.marketing_inbox_policies alter column automation_mode set default 'suggest';
-- Separate provider evidence: comments do not inherit DM authority or open a messaging window.
create table marketing_private.inbox_comment_authority (
 connection_id uuid primary key references public.marketing_connections(id), generation integer not null,
 receive_verified boolean not null default false, webhook_verified boolean not null default false, verified_at timestamptz
);
alter table marketing_private.inbox_comment_authority enable row level security;
revoke all on marketing_private.inbox_comment_authority from public,anon,authenticated;
create function marketing_private.inbox_comment_channel(p_connection uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('state',case when c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() then 'unavailable'
 when not coalesce(c.capabilities->'granted_scopes','[]') ? (case c.channel when 'facebook' then 'pages_read_user_content' else 'instagram_manage_comments' end) then 'permission_required'
 when not coalesce(a.generation=c.credential_generation and a.receive_verified and a.webhook_verified,false) then 'connected' else 'operational' end,
 'receiving_verified',coalesce(a.generation=c.credential_generation and a.receive_verified and a.webhook_verified and c.expires_at>now() and c.status in ('test_authorized','production_authorized') and coalesce(c.capabilities->'granted_scopes','[]') ? (case c.channel when 'facebook' then 'pages_read_user_content' else 'instagram_manage_comments' end),false),
 'sending_enabled',false,'required_permission',case c.channel when 'facebook' then 'pages_read_user_content' else 'instagram_manage_comments' end)
 from public.marketing_connections c left join marketing_private.inbox_comment_authority a on a.connection_id=c.id where c.id=p_connection;
$$;
create function marketing_private.inbox_unread(p_conversation uuid,p_actor uuid) returns bigint language sql stable security definer set search_path=public as $$
 select count(*) from public.marketing_conversation_messages m where m.conversation_id=p_conversation and m.kind in ('incoming','attachment') and m.sequence>coalesce((select through_sequence from public.marketing_inbox_reads where conversation_id=p_conversation and employee_id=p_actor),0);
$$;
create function public.marketing_inbox_mark_read(p_conversation uuid,p_through bigint) returns void language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; maximum bigint;
begin
 select * into c from public.marketing_conversations where id=p_conversation for share;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 select coalesce(max(sequence),0) into maximum from public.marketing_conversation_messages where conversation_id=c.id;
 if p_through is null or p_through<0 or p_through>maximum then raise exception 'Read evidence unavailable.';end if;
 insert into public.marketing_inbox_reads values(c.id,actor,p_through,now()) on conflict(conversation_id,employee_id) do update set through_sequence=greatest(marketing_inbox_reads.through_sequence,excluded.through_sequence),read_at=now();
end;$$;
create function marketing_private.inbox_classify(p_text text) returns text language sql immutable set search_path=public as $$
 select case when cardinality(marketing_private.inbox_risk(p_text))>0 then 'sensitive'
 when p_text ~* '(reserv|booking|预订|订位|tempah)' then 'reservations'
 when p_text ~* '(menu|菜单|餐单)' then 'menu'
 when p_text ~* '(price|cost|harga|价格|多少钱)' then 'pricing'
 when p_text ~* '(open|hours|close|营业|几点|waktu|buka|tutup)' then 'operating_hours'
 when p_text ~* '(location|address|where|地址|哪里|lokasi|alamat|mana)' then 'locations'
 when p_text ~* '(promo|discount|offer|优惠|促销|diskaun)' then 'promotions' else 'unknown' end;
$$;
create function marketing_private.inbox_message_classification() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.kind in ('incoming','attachment') then
  update public.marketing_conversations set intent=marketing_private.inbox_classify(new.body),classification_source='rules',
   language=case when new.body ~ '[一-龥]' then 'ZH' when new.body ~* '(harga|waktu|buka|tutup|tempah|alamat|mana|saya|boleh|terima kasih)' then 'BM' else 'EN' end,
   opted_out=opted_out or new.body ~* '(^|[[:space:]])(stop|unsubscribe|opt out|berhenti)([[:space:]]|$)|退订|不要再发',
   takeover=takeover or new.body ~* '(^|[[:space:]])(stop|unsubscribe|opt out|berhenti)([[:space:]]|$)|退订|不要再发'
   where id=new.conversation_id and (last_inbound_at is null or new.occurred_at>=last_inbound_at);
 end if;
 return new;
end;$$;
create trigger marketing_inbox_classify_message after insert on public.marketing_conversation_messages for each row execute function marketing_private.inbox_message_classification();
create function marketing_private.inbox_optout_guard() returns trigger language plpgsql set search_path=public as $$begin if new.opted_out then new.takeover:=true;end if;return new;end;$$;
create trigger marketing_inbox_optout before update on public.marketing_conversations for each row execute function marketing_private.inbox_optout_guard();

drop function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer);
create or replace function public.marketing_inbox_read(p_org uuid,p_brand uuid default null,p_status text default '',p_channel text default '',p_search text default '',p_page integer default 1,p_size integer default 20,p_assignee text default '',p_unread boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); rows jsonb; total integer; channels jsonb; members jsonb; policy jsonb; faqs jsonb; knowledge jsonb; usage jsonb;
begin
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 100 or p_status is null or p_channel is null or p_search is null or p_assignee is null or p_unread is null or (p_assignee not in ('','me','unassigned') and p_assignee !~ '^[0-9a-fA-F-]{36}$') or length(p_search)>100 or p_status not in ('','open','pending','resolved') or p_channel not in ('','internal','facebook','instagram') then raise exception 'Invalid Inbox filters.';end if;
 select count(*) into total from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and position(lower(p_search) in lower(m.body))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select c.id,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at,c.medium,c.intent,c.language,c.opted_out,marketing_private.inbox_unread(c.id,actor) unread_count
 from public.marketing_conversations c join public.brands b on b.id=c.brand_id where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and position(lower(p_search) in lower(m.body))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0) order by c.updated_at desc,c.id limit p_size offset (p_page-1)*p_size)x;
 select coalesce(jsonb_agg(marketing_private.inbox_channel(c.id)||jsonb_build_object('comments',marketing_private.inbox_comment_channel(c.id))),'[]') into channels from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=p_org and e.is_active and exists(select 1 from public.brands b where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id) and marketing_private.actor_allowed(e.id,p_org,b.id,'marketing_inbox.view'));
 if p_brand is not null then
  select to_jsonb(p) into policy from public.marketing_inbox_policies p where p.brand_id=p_brand;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.updated_at desc),'[]') into faqs from (select * from public.marketing_inbox_faqs where brand_id=p_brand order by updated_at desc limit 100) f;
  select jsonb_build_object('revision',k.revision,'profile',k.profile,'approved_for_replies',exists(select 1 from public.marketing_inbox_knowledge s where s.brand_id=k.brand_id and s.knowledge_revision=k.revision)) into knowledge from public.marketing_knowledge k where k.brand_id=p_brand;
 end if;
 select jsonb_build_object('requests',count(*),'input_tokens',sum(r.input_tokens),'output_tokens',sum(r.output_tokens),'usage_unavailable_requests',count(*) filter(where r.input_tokens is null or r.output_tokens is null),'cost',null,'cost_available',false)
 into usage from marketing_private.inbox_ai_runs r join public.marketing_conversations c on c.id=r.conversation_id where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 return jsonb_build_object('ai_usage',usage,'rows',rows,'total',total,'channels',channels,'members',members,'policy',coalesce(policy,'{"revision":0,"automation_mode":"suggest","ai_allowed":false}'),'faqs',coalesce(faqs,'[]'),'knowledge',knowledge,'external_execution_enabled',false);
end;$$;

create or replace function public.marketing_inbox_detail(p_conversation uuid,p_page integer default 1,p_size integer default 30) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; messages jsonb; total integer; drafts jsonb; artifacts jsonb; members jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation;if c.id is null then raise exception 'Conversation unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 50 then raise exception 'Invalid history page.';end if;
 select count(*) into total from public.marketing_conversation_messages where conversation_id=c.id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at,x.id),'[]') into messages from (select m.*,e.full_name actor_name from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id where conversation_id=c.id order by occurred_at desc,m.id desc limit p_size offset (p_page-1)*p_size)x;
 select coalesce(jsonb_agg(to_jsonb(d) order by created_at desc),'[]') into drafts from (select * from public.marketing_reply_drafts where conversation_id=c.id order by created_at desc limit 50) d;
 select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc),'[]') into artifacts from (select * from public.marketing_inbox_ai_artifacts where conversation_id=c.id order by created_at desc limit 50) a;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=c.organization_id and marketing_private.actor_allowed(e.id,c.organization_id,c.brand_id,'marketing_inbox.view');
 return jsonb_build_object('conversation',to_jsonb(c)-'participant_key','messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$$;

create or replace function public.marketing_inbox_enqueue(p_events jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; conn public.marketing_connections; key text; fp text; n integer:=0; duplicates integer:=0; unknown integer:=0; existing text; receiving boolean;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>1000 or octet_length(p_events::text)>1048576 then raise exception 'Invalid event batch.';end if;
 for item in select value from jsonb_array_elements(p_events) loop
  if coalesce(item->>'channel','') not in ('facebook','instagram') or coalesce(item->>'account_id','') !~ '^[0-9]{1,32}$' or coalesce(item->>'peer_id','') !~ '^[0-9]{1,32}$' or coalesce(item->>'kind','') not in ('incoming','echo','attachment','delivery','read') or length(coalesce(item->>'body',''))>8000 or length(coalesce(item->>'event_id','')) not between 1 and 300 or coalesce(item->>'medium','dm') not in ('dm','comment') or (item->>'medium'='comment' and coalesce(item->>'thread_id','') !~ '^[0-9_]{1,80}$') or item->>'occurred_at' is null or (item->>'occurred_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Invalid normalized event.';end if;
  select * into conn from public.marketing_connections where channel=item->>'channel' and provider_account_id=item->>'account_id';
  if conn.id is null then unknown:=unknown+1;continue;end if;
  receiving:=case when item->>'medium'='comment' then (marketing_private.inbox_comment_channel(conn.id)->>'receiving_verified')::boolean else (marketing_private.inbox_channel(conn.id)->>'receiving_verified')::boolean end;
  key:=conn.id::text||':'||conn.credential_generation::text||':'||(item->>'kind')||':'||(item->>'event_id');
  fp:=encode(extensions.digest(item::text,'sha256'),'hex');
  select fingerprint into existing from marketing_private.inbox_events where event_key=key;
  if existing is not null then duplicates:=duplicates+1;continue;end if;
  insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,state,error_code)
  values(key,conn.id,conn.credential_generation,item,fp,case when receiving then 'pending' else 'blocked' end,case when not receiving then 'messaging_authorization_unverified' end)
  on conflict do nothing;
  if found then n:=n+1;else duplicates:=duplicates+1;end if;
 end loop;
 return jsonb_build_object('accepted',n,'duplicates',duplicates,'unbound',unknown);
end;$$;
create or replace function public.marketing_inbox_process_events(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare ev marketing_private.inbox_events; conn public.marketing_connections; c public.marketing_conversations; item jsonb; risks text[]; inserted uuid; processed integer:=0; blocked integer:=0; failed integer:=0; f public.marketing_inbox_faqs; mode text; peer text; event_medium text;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid drain limit.';end if;
 for ev in select * from marketing_private.inbox_events where state in ('pending','retry') and due_at<=now() order by due_at,event_key limit p_limit for update skip locked loop
  begin
   select * into conn from public.marketing_connections where id=ev.connection_id for share;
   item:=ev.payload; event_medium:=coalesce(item->>'medium','dm'); peer:=case when event_medium='comment' then 'comment:'||(item->>'thread_id')||':'||(item->>'peer_id') else item->>'peer_id' end;
   if conn.credential_generation<>ev.generation or not coalesce(case when event_medium='comment' then (marketing_private.inbox_comment_channel(conn.id)->>'receiving_verified')::boolean else (marketing_private.inbox_channel(conn.id)->>'receiving_verified')::boolean end,false) then
    update marketing_private.inbox_events set state='blocked',error_code='messaging_authorization_unverified',attempts=attempts+1 where event_key=ev.event_key;blocked:=blocked+1;continue;
   end if;
   perform 1 from public.brands where id=conn.brand_id for share;
   item:=ev.payload;
   -- Echo/receipt-only events cannot manufacture a new customer conversation.
   select * into c from public.marketing_conversations where connection_id=conn.id and participant_key=peer for update;
   if c.id is null and item->>'kind' in ('incoming','attachment') then
    insert into public.marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title,medium)
    values(conn.organization_id,conn.brand_id,conn.channel,conn.id,peer,conn.account_name||case event_medium when 'comment' then ' comments' else ' conversation' end,event_medium) on conflict(connection_id,participant_key) do nothing;
    select * into c from public.marketing_conversations where connection_id=conn.id and participant_key=peer for update;
   end if;
   if c.id is not null then
    inserted:=null;
    insert into public.marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,delivery_state)
    values(c.id,item->>'kind',coalesce(item->>'body',''),item->>'event_id',(item->>'occurred_at')::timestamptz,case item->>'kind' when 'delivery' then 'delivered' when 'read' then 'read' else 'observed' end) on conflict do nothing returning id into inserted;
    if inserted is not null then
     risks:=marketing_private.inbox_risk(item->>'body');
     update public.marketing_conversations set version=version+1,updated_at=now(),
      last_inbound_at=case when event_medium='dm' and item->>'kind' in ('incoming','attachment') then greatest(last_inbound_at,(item->>'occurred_at')::timestamptz) else last_inbound_at end,
      status=case when item->>'kind' in ('incoming','attachment') then 'open' else status end,
      escalation_reasons=array(select distinct unnest(escalation_reasons||risks)),priority=case when cardinality(risks)>0 then 'urgent' else priority end,takeover=takeover or cardinality(risks)>0 where id=c.id returning * into c;
     if event_medium='dm' and not c.opted_out and item->>'kind' in ('incoming','attachment') and cardinality(c.escalation_reasons)=0 then
      select automation_mode into mode from public.marketing_inbox_policies where brand_id=c.brand_id;
      if coalesce(mode,'suggest')<>'off' and not c.takeover then
       select f0.* into f from public.marketing_inbox_faqs f0 join public.marketing_knowledge k on k.brand_id=f0.brand_id and k.revision=f0.knowledge_revision
       join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision
       where f0.brand_id=c.brand_id and f0.status='approved' and lower(regexp_replace(trim(f0.question),'\s+',' ','g'))=lower(regexp_replace(trim(item->>'body'),'\s+',' ','g')) order by f0.updated_at desc limit 1;
       if f.id is not null and c.last_inbound_at+interval '24 hours'>now() and cardinality(marketing_private.inbox_risk(f.answer))=0 then
        insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references) values(c.id,f.answer,c.version,f.knowledge_revision,'approved_faq',to_jsonb(f.reference_keys));
       else
        update public.marketing_conversations set takeover=true,escalation_reasons=array['uncertain'],priority='high' where id=c.id;
       end if;
      end if;
     end if;
    end if;
   end if;
   update marketing_private.inbox_events set state='processed',attempts=attempts+1,error_code=null where event_key=ev.event_key;processed:=processed+1;
  exception when others then
   update marketing_private.inbox_events set state=case when attempts>=4 then 'failed' else 'retry' end,attempts=attempts+1,due_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),error_code='inbox_processing_failed' where event_key=ev.event_key;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('processed',processed,'blocked',blocked,'retry_or_failed',failed);
end;$$;

create function public.marketing_inbox_analytics(p_org uuid,p_brand uuid default null,p_channel text default '',p_start timestamptz default null,p_end timestamptz default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); result jsonb;
begin
 if p_channel is null or p_channel not in ('','internal','facebook','instagram') or (p_start is not null and p_end is not null and p_end<=p_start) then raise exception 'Invalid analytics filters.';end if;
 with scoped as (select * from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id) and (p_channel='' or c.channel=p_channel) and (p_start is null or c.created_at>=p_start) and (p_end is null or c.created_at<p_end)),
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
-- Every new authority retains the existing explicit grants and brand-derived actor checks.
revoke all on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean),public.marketing_inbox_mark_read(uuid,bigint),public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean),public.marketing_inbox_mark_read(uuid,bigint),public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz) to authenticated;
revoke all on function marketing_private.inbox_comment_channel(uuid),marketing_private.inbox_unread(uuid,uuid),marketing_private.inbox_classify(text),marketing_private.inbox_message_classification(),marketing_private.inbox_optout_guard() from public,anon,authenticated;

create function marketing_private.inbox_ai_classification() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.kind='reply' and new.body->>'intent' in ('menu','pricing','operating_hours','locations','promotions','reservations','complaint','refund','allergen','food_safety','sensitive','unknown') then
  update public.marketing_conversations set intent=new.body->>'intent',language=new.body->>'language',classification_source='ai' where id=new.conversation_id and version=new.source_version;
 end if;return new;end;$$;
create trigger marketing_inbox_ai_classify after insert on public.marketing_inbox_ai_artifacts for each row execute function marketing_private.inbox_ai_classification();
revoke all on function marketing_private.inbox_ai_classification() from public,anon,authenticated;

create function marketing_private.inbox_handover_evidence() returns trigger language plpgsql security definer set search_path=public as $$begin
 if (new.takeover and not old.takeover) or (cardinality(new.escalation_reasons)>0 and new.escalation_reasons is distinct from old.escalation_reasons) then
  insert into public.marketing_events(organization_id,brand_id,action,details) values(new.organization_id,new.brand_id,'inbox_handover',jsonb_build_object('conversation_id',new.id,'version',new.version,'reasons',to_jsonb(new.escalation_reasons)));
 end if;return new;end;$$;
create trigger marketing_inbox_handover after update on public.marketing_conversations for each row execute function marketing_private.inbox_handover_evidence();
revoke all on function marketing_private.inbox_handover_evidence() from public,anon,authenticated;
create or replace function public.marketing_inbox_faq_preview(p_conversation uuid,p_text text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; k public.marketing_knowledge; f public.marketing_inbox_faqs; mode text;
begin
 select * into c from public.marketing_conversations where id=p_conversation;actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.reply');
 if length(trim(coalesce(p_text,''))) not between 1 and 500 then raise exception 'Provide a bounded FAQ question.';end if;
 if cardinality(marketing_private.inbox_risk(p_text))>0 or cardinality(c.escalation_reasons)>0 then return jsonb_build_object('state','escalate','sending_enabled',false);end if;
 select automation_mode into mode from public.marketing_inbox_policies where brand_id=c.brand_id;
 if coalesce(mode,'suggest')='off' then return jsonb_build_object('state','off','sending_enabled',false);end if;
 select * into k from public.marketing_knowledge where brand_id=c.brand_id;
 select * into f from public.marketing_inbox_faqs where brand_id=c.brand_id and status='approved' and knowledge_revision=k.revision and lower(regexp_replace(trim(question),'\s+',' ','g'))=lower(regexp_replace(trim(p_text),'\s+',' ','g')) order by updated_at desc limit 1;
 return jsonb_build_object('state',case when f.id is null then 'human_required' when c.takeover then 'human_takeover' when c.channel<>'internal' and (c.last_inbound_at is null or c.last_inbound_at+interval '24 hours'<=now()) then 'window_closed' else 'faq_ready' end,'faq',case when f.id is not null then to_jsonb(f) end,'sending_enabled',false);
end;$$;

