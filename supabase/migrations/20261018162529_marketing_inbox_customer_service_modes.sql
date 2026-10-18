-- Automatic generation, policy authorization and provider delivery remain separate authorities.
alter table public.marketing_inbox_policies
 add column ai_reply_mode text not null default 'suggest_only' check(ai_reply_mode in ('suggest_only','safe_auto','ai_first')),
 add column ai_availability text not null default 'always' check(ai_availability in ('always','scheduled')),
 add column ai_timezone text not null default 'Asia/Kuala_Lumpur',
 add column ai_schedule jsonb not null default '{"days":[0,1,2,3,4,5,6],"start":"09:00","end":"22:00"}',
 add column ai_enabled_at timestamptz,
 add column ai_authorized_by uuid references public.employees(id);

create table marketing_private.inbox_automatic_turns (
 id uuid primary key default gen_random_uuid(),message_id uuid not null unique references public.marketing_conversation_messages(id) on delete cascade,
 conversation_id uuid not null references public.marketing_conversations(id) on delete cascade,policy_revision integer not null,
 state text not null default 'queued' check(state in ('queued','generating','prepared','pending','sent','delivered','read','handoff','blocked','failed','superseded','reconciling')),
 actor_employee_id uuid references public.employees(id),source_version integer,source_hash text,artifact_id uuid references public.marketing_inbox_ai_artifacts(id) on delete set null,
 lease uuid,reason text,summary text check(length(summary)<=1000),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table marketing_private.inbox_automatic_turns enable row level security;
revoke all on marketing_private.inbox_automatic_turns from public,anon,authenticated;
create index inbox_automatic_due on marketing_private.inbox_automatic_turns(created_at) where state='queued';
create index inbox_automatic_conversation on marketing_private.inbox_automatic_turns(conversation_id,created_at desc);
alter table public.marketing_reply_outbox add column automatic_turn_id uuid unique references marketing_private.inbox_automatic_turns(id) on delete set null;
alter table public.marketing_reply_drafts add column automatic boolean not null default false;

create function marketing_private.inbox_ai_schedule_valid(p_zone text,p_window jsonb) returns boolean language sql stable set search_path=public as $$
 select exists(select 1 from pg_timezone_names where name=p_zone) and jsonb_typeof(p_window)='object' and octet_length(p_window::text)<=500
 and jsonb_typeof(p_window->'days')='array' and jsonb_array_length(p_window->'days') between 1 and 7
 and not exists(select 1 from jsonb_array_elements(p_window->'days') d where d::text !~ '^[0-6]$')
 and p_window->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and p_window->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and p_window->>'start'<>p_window->>'end';
$$;
create function marketing_private.inbox_ai_available(p public.marketing_inbox_policies) returns boolean language plpgsql stable set search_path=public as $$
declare local_ timestamp;t text;d int;begin
 if not coalesce(marketing_private.inbox_ai_schedule_valid(p.ai_timezone,p.ai_schedule),false) then return false;end if;
 if p.ai_availability='always' then return true;end if;
 local_:=now() at time zone p.ai_timezone;t:=to_char(local_,'HH24:MI');d:=extract(dow from local_)::int;
 if p.ai_schedule->>'start'<p.ai_schedule->>'end' then return p.ai_schedule->'days' @> to_jsonb(array[d]) and t>=p.ai_schedule->>'start' and t<p.ai_schedule->>'end';end if;
 return (p.ai_schedule->'days' @> to_jsonb(array[d]) and t>=p.ai_schedule->>'start') or (p.ai_schedule->'days' @> to_jsonb(array[(d+6)%7]) and t<p.ai_schedule->>'end');
end;$$;

-- Extend the existing revision/idempotency-bound Brand policy transaction.
do $m$ declare f text;old_ text;new_ text;begin
 f:=pg_get_functiondef('public.marketing_inbox_configure(uuid,uuid,integer,text,jsonb)'::regprocedure);
 old_:='  insert into public.marketing_inbox_policies(brand_id,automation_mode,ai_allowed,updated_by,staff_reply_requires_approval)';
 if position(old_ in f)=0 then raise exception 'Policy baseline differs';end if;
 new_:=$body$  if not coalesce(marketing_private.inbox_ai_schedule_valid(coalesce(p_payload->>'ai_timezone',policy.ai_timezone,'Asia/Kuala_Lumpur'),coalesce(p_payload->'ai_schedule',policy.ai_schedule,'{"days":[0,1,2,3,4,5,6],"start":"09:00","end":"22:00"}'::jsonb)),false) then raise exception 'Choose a valid timezone, days and different start/end times.';end if;
  if coalesce(p_payload->>'ai_reply_mode',policy.ai_reply_mode,'suggest_only')<>'suggest_only' then
   perform marketing_private.require_access(org,p_brand,'marketing_inbox.ai');perform marketing_private.require_access(org,p_brand,'marketing_inbox.send');
   if p_payload->>'automation_mode'<>'suggest' or not coalesce((p_payload->>'ai_allowed')::boolean,false) then raise exception 'Automatic modes require Brand AI consent and enabled matching.';end if;
  end if;
$body$||old_;
 f:=replace(f,old_,new_);
 f:=replace(f,'updated_by,staff_reply_requires_approval) values','updated_by,staff_reply_requires_approval,ai_reply_mode,ai_availability,ai_timezone,ai_schedule,ai_authorized_by,ai_enabled_at) values');
 f:=replace(f,'policy.staff_reply_requires_approval,false))','policy.staff_reply_requires_approval,false),coalesce(p_payload->>''ai_reply_mode'',policy.ai_reply_mode,''suggest_only''),coalesce(p_payload->>''ai_availability'',policy.ai_availability,''always''),coalesce(p_payload->>''ai_timezone'',policy.ai_timezone,''Asia/Kuala_Lumpur''),coalesce(p_payload->''ai_schedule'',policy.ai_schedule,''{"days":[0,1,2,3,4,5,6],"start":"09:00","end":"22:00"}''::jsonb),actor,case when coalesce(p_payload->>''ai_reply_mode'',policy.ai_reply_mode,''suggest_only'')=''suggest_only'' then null else coalesce(policy.ai_enabled_at,now()) end)');
 f:=replace(f,'updated_by=actor,updated_at=now() returning to_jsonb(marketing_inbox_policies)','ai_reply_mode=excluded.ai_reply_mode,ai_availability=excluded.ai_availability,ai_timezone=excluded.ai_timezone,ai_schedule=excluded.ai_schedule,ai_authorized_by=excluded.ai_authorized_by,ai_enabled_at=excluded.ai_enabled_at,updated_by=actor,updated_at=now() returning to_jsonb(marketing_inbox_policies)');
 execute f;
end;$m$;

-- Shared generation authority: callers cannot choose another actor; the worker is policy-bound.
do $m$ declare f text;begin
 f:=pg_get_functiondef('public.marketing_inbox_ai_prepare(uuid,uuid,integer,text)'::regprocedure);
 if position('actor:=marketing_private.require_access(c.organization_id,c.brand_id,''marketing_inbox.ai'');' in f)=0 then raise exception 'AI preparation baseline differs';end if;
 f:=replace(f,'public.marketing_inbox_ai_prepare(p_request uuid,','marketing_private.inbox_ai_prepare_as(p_actor uuid, p_request uuid,');
 f:=replace(f,'actor:=marketing_private.require_access(c.organization_id,c.brand_id,''marketing_inbox.ai'');','actor:=p_actor;if not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,''marketing_inbox.ai'') then raise exception ''Inbox AI scope denied.'';end if;');execute f;
end;$m$;
create or replace function public.marketing_inbox_ai_prepare(p_request uuid,p_conversation uuid,p_version integer,p_kind text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations;actor uuid;begin
 select * into c from marketing_conversations where id=p_conversation;actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.ai');
 return marketing_private.inbox_ai_prepare_as(actor,p_request,p_conversation,p_version,p_kind);
end;$$;

create function marketing_private.inbox_auto_sensitive(p_text text) returns boolean language sql immutable set search_path=public as $$
 select cardinality(marketing_private.inbox_risk(p_text))>0 or p_text ~* '(human|real person|staff member|speak to|talk to|manager|manusia|orang sebenar|cakap dengan|人工|真人|店[员員]|经[理]|經理|客服|compensat|赔偿|補償|pampasan|ganti rugi|special (arrangement|request)|private event|特别安排|特殊要求|permintaan khas|food poison|allerg|過敏|嘔吐|腹瀉|變質|蟑螂|lipas|keracunan|book (me|us|my|our|a table)|reserve (me|us|my|our|a table)|帮我.{0,5}(订|退)|tolong.{0,10}tempah)';
$$;
create function marketing_private.inbox_auto_issue(c public.marketing_conversations,p public.marketing_inbox_policies) returns text language plpgsql stable set search_path=public as $$
declare conn public.marketing_connections;a marketing_private.inbox_authority;begin
 if p.brand_id is null or not p.ai_allowed or p.ai_reply_mode='suggest_only' or p.automation_mode<>'suggest' or p.ai_enabled_at is null or p.ai_authorized_by is null then return 'automatic_mode_disabled';end if;
 if not marketing_private.actor_allowed(p.ai_authorized_by,c.organization_id,c.brand_id,'marketing_inbox.ai') or not marketing_private.actor_allowed(p.ai_authorized_by,c.organization_id,c.brand_id,'marketing_inbox.configure') or not marketing_private.actor_allowed(p.ai_authorized_by,c.organization_id,c.brand_id,'marketing_inbox.send') then return 'activation_authority_changed';end if;
 if c.takeover or c.assigned_to is not null or cardinality(c.escalation_reasons)>0 then return 'human_handling';end if;
 if c.status<>'open' or c.opted_out or c.channel not in ('facebook','instagram') or c.medium<>'dm' then return 'conversation_ineligible';end if;
 if c.last_inbound_at is null or c.last_inbound_at>now() or c.last_inbound_at<=now()-interval '24 hours' then return 'messaging_window_closed';end if;
 if not marketing_private.inbox_ai_available(p) then return 'outside_availability';end if;
 select * into conn from marketing_connections where id=c.connection_id and brand_id=c.brand_id and organization_id=c.organization_id;
 select * into a from marketing_private.inbox_authority where connection_id=conn.id;
 if conn.id is null or conn.status<>'test_authorized' or conn.expires_at is null or conn.expires_at<=now() or conn.credential_generation is distinct from c.connection_generation or a.generation is distinct from conn.credential_generation or not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at is null or a.verified_at<=now()-interval '1 hour' then return 'channel_authority_unavailable';end if;
 if exists(select 1 from marketing_reply_outbox o join marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.automatic_turn_id is null and o.state in ('prepared','pending','reconciling')) then return 'staff_reply_in_progress';end if;
 return null;
end;$$;

create function marketing_private.inbox_auto_new_conversation() returns trigger language plpgsql security definer set search_path=public as $$
declare p public.marketing_inbox_policies;begin
 select * into p from marketing_inbox_policies where brand_id=new.brand_id;
 if new.created_by is null and new.channel in ('facebook','instagram') and p.ai_allowed and p.ai_reply_mode<>'suggest_only' and p.ai_enabled_at<=now() then new.takeover:=false;end if;
 return new;
end;$$;
create trigger inbox_auto_new_conversation before insert on public.marketing_conversations for each row execute function marketing_private.inbox_auto_new_conversation();
create function marketing_private.inbox_auto_enqueue() returns trigger language plpgsql security definer set search_path=public as $$
declare p public.marketing_inbox_policies;begin
 if new.kind<>'incoming' or new.evidence_source<>'signed_webhook' or new.provider_message_id is null then return new;end if;
 select p0.* into p from marketing_inbox_policies p0 join marketing_conversations c on c.brand_id=p0.brand_id where c.id=new.conversation_id;
 if p.ai_allowed and p.ai_reply_mode<>'suggest_only' and new.occurred_at>=p.ai_enabled_at and new.occurred_at>now()-interval '5 minutes' then
  insert into marketing_private.inbox_automatic_turns(message_id,conversation_id,policy_revision) values(new.id,new.conversation_id,p.revision) on conflict(message_id) do nothing;
 end if;return new;
end;$$;
create trigger inbox_auto_enqueue after insert on public.marketing_conversation_messages for each row execute function marketing_private.inbox_auto_enqueue();

-- In-flight provider writes cannot be recalled; retain their durable uncertain state for receipts.
create function marketing_private.inbox_auto_cancel() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.takeover or new.assigned_to is not null or new.status<>'open' or new.opted_out or cardinality(new.escalation_reasons)>0 then
  update marketing_reply_outbox o set state=case when o.state='prepared' then 'blocked' else 'reconciling' end,reason='human_or_conversation_changed' from marketing_private.inbox_automatic_turns t where t.id=o.automatic_turn_id and t.conversation_id=new.id and o.state in ('prepared','pending');
  update marketing_private.inbox_automatic_turns set state='blocked',reason='human_or_conversation_changed',updated_at=now() where conversation_id=new.id and state in ('queued','generating','prepared');
 end if;return new;
end;$$;
create trigger inbox_auto_cancel after update of takeover,assigned_to,status,opted_out,escalation_reasons on public.marketing_conversations for each row execute function marketing_private.inbox_auto_cancel();

create function public.marketing_inbox_auto_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare t marketing_private.inbox_automatic_turns;c public.marketing_conversations;p public.marketing_inbox_policies;m public.marketing_conversation_messages;r jsonb;material jsonb;issue text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only';end if;
 -- Never automatically repeat an uncertain provider generation.
 for t in select q.* from marketing_private.inbox_automatic_turns q join marketing_conversations c0 on c0.id=q.conversation_id where q.state='generating' and q.updated_at<now()-interval '2 minutes' order by q.updated_at limit 10 for update of c0 skip locked loop perform public.marketing_inbox_auto_fail(t.id,t.lease,'generation_expired');end loop;
 -- A committed prepared outbox may survive a lost worker response. Resume its delivery, not generation.
 for t in select q.* from marketing_private.inbox_automatic_turns q join marketing_conversations c0 on c0.id=q.conversation_id join marketing_reply_outbox o on o.automatic_turn_id=q.id where q.state='prepared' and o.state='prepared' order by q.created_at limit 10 for update of c0 skip locked loop
  select * into c from marketing_conversations where id=t.conversation_id;select * into p from marketing_inbox_policies where brand_id=c.brand_id;
  if p.revision<>t.policy_revision or c.version<>t.source_version or t.created_at<=now()-interval '5 minutes' or marketing_private.inbox_auto_issue(c,p) is not null then perform public.marketing_inbox_auto_fail(t.id,t.lease,'automatic_processing_failed');continue;end if;
  return jsonb_build_object('delivery_only',true,'state','prepared','turn_id',t.id,'lease',t.lease,'draft_id',(select draft_id from marketing_reply_outbox where automatic_turn_id=t.id),'auth_user',(select auth_user_id from employees where id=t.actor_employee_id));
 end loop;
 for t in select q.* from marketing_private.inbox_automatic_turns q join marketing_conversations c0 on c0.id=q.conversation_id where q.state='queued' order by q.created_at limit 10 for update of c0 skip locked loop
  select * into c from marketing_conversations where id=t.conversation_id for update;
  select * into p from marketing_inbox_policies where brand_id=c.brand_id;
  select * into m from marketing_conversation_messages where id=t.message_id;
  issue:=marketing_private.inbox_auto_issue(c,p);
  if p.revision<>t.policy_revision then issue:='policy_changed';end if;
  if exists(select 1 from marketing_conversation_messages x where x.conversation_id=c.id and x.kind='incoming' and (x.occurred_at,x.sequence)>(m.occurred_at,m.sequence)) then update marketing_private.inbox_automatic_turns set state='superseded',reason='newer_message',updated_at=now() where id=t.id;continue;end if;
  if m.occurred_at<=now()-interval '5 minutes' then issue:='response_deadline';end if;
  if exists(select 1 from marketing_reply_outbox o join marketing_private.inbox_automatic_turns x on x.id=o.automatic_turn_id where x.conversation_id=c.id and o.state in ('pending','reconciling')) then issue:='previous_delivery_uncertain';end if;
  if (select count(*) from marketing_private.inbox_automatic_turns where conversation_id=c.id and state in ('prepared','pending','sent','delivered','read','reconciling') and created_at>now()-interval '24 hours')>=8 then issue:='conversation_response_limit';end if;
  if marketing_private.inbox_auto_sensitive(m.body) and issue in ('human_handling') or issue is null and marketing_private.inbox_auto_sensitive(m.body) then perform marketing_private.inbox_auto_handoff(t.id,'safety_or_human_request');continue;end if;
  if issue in ('conversation_response_limit','previous_delivery_uncertain','response_deadline') then perform marketing_private.inbox_auto_handoff(t.id,issue);continue;end if;
  if issue is not null then update marketing_private.inbox_automatic_turns set state='blocked',reason=issue,updated_at=now() where id=t.id;continue;end if;
  begin r:=marketing_private.inbox_ai_prepare_as(p.ai_authorized_by,t.id,c.id,c.version,'reply');exception when others then
   update marketing_private.inbox_automatic_turns set state='failed',reason='generation_quota_or_authority',updated_at=now() where id=t.id;perform marketing_private.inbox_auto_handoff(t.id,'generation_quota_or_authority');return null;
  end;
  if r->>'state'='generating' then return null;end if;
  if r->>'state'='prepared' then material:=public.marketing_inbox_ai_claim(t.id,p.ai_authorized_by);
  elsif r->>'state'='completed' and r->>'artifact_id' is not null then material:=marketing_private.inbox_assistant_material(c.id)||jsonb_build_object('cached_artifact',r->>'artifact_id');
  else update marketing_private.inbox_automatic_turns set state='blocked',reason='generation_unavailable',updated_at=now() where id=t.id;return null;end if;
  if material is null then return null;end if;
  update marketing_private.inbox_automatic_turns set state='generating',actor_employee_id=p.ai_authorized_by,source_version=c.version,source_hash=material->>'source_hash',lease=coalesce(nullif(material->>'lease','')::uuid,gen_random_uuid()),updated_at=now() where id=t.id returning * into t;
  return material||jsonb_build_object('turn_id',t.id,'request_id',t.id,'lease',t.lease,'mode',p.ai_reply_mode,'auth_user',(select auth_user_id from employees where id=p.ai_authorized_by),'kind','reply','provider_timeout_ms',12000);
 end loop;return null;
end;$$;

-- Automatic text is rendered from current source values, never trusted free-form model prose.
create function marketing_private.inbox_auto_answer(a public.marketing_inbox_ai_artifacts,material jsonb,p_mode text) returns jsonb language plpgsql stable set search_path=public as $$
declare ref text;f jsonb;h jsonb;item jsonb;part text;parts text[]:='{}';q text;lang text;intent text;keys jsonb:='[]';begin
 q:=coalesce((select x->>'text' from jsonb_array_elements(material->'history') with ordinality h(x,n) where x->>'kind'='incoming' order by n desc limit 1),'');lang:=a.body->>'language';intent:=a.body->>'intent';
 if marketing_private.inbox_auto_sensitive(q) or a.body->'handoff_reasons'<>'[]'::jsonb then return jsonb_build_object('kind','handoff','reason','safety_or_human_request');end if;
 if p_mode='ai_first' and material->'outlet_context'->>'known'='false' and (material->'outlet_context'->>'eligible_count')::int>1 and q ~* '(hours|open|clos|price|address|buka|tutup|harga|alamat|营业|几点|地址|价格)' then
  return jsonb_build_object('kind','clarify','reason','outlet_clarification','keys','[]'::jsonb,'text',case lang when 'ZH' then '请问你指的是哪一家分店？' when 'BM' then 'Cawangan mana yang anda maksudkan?' else 'Which outlet do you mean?' end);
 end if;
 if a.body->>'classification'<>'suggestion_available' or coalesce((a.body->>'human_required')::boolean,true) or a.body->'unresolved_questions'<>'[]'::jsonb then return jsonb_build_object('kind','handoff','reason','insufficient_knowledge');end if;
 if intent is null or intent not in ('brand_identity','menu','pricing','operating_hours','locations','promotions','unknown') then return jsonb_build_object('kind','handoff','reason','business_decision');end if;
 for ref in select jsonb_array_elements_text(a.body->'reference_keys') loop
  part:=null;
  if ref in ('voice','tone','guidelines','communication_guidelines') then continue;end if;
  if ref like 'faq:%' then
   select x into f from jsonb_array_elements(material->'faqs') x where 'faq:'||(x->>'id')||':'||(x->>'revision')=ref and x->>'use_issue' is null;
   if f is not null and f->>'category' not in ('reservations','feedback_complaints') and cardinality(marketing_private.inbox_risk((f->>'question')||' '||(f->>'answer')))=0 then part:=f->>'answer';end if;
  else
   f:=material->'facts'->ref;
   if ref in ('identity','positioning','audience') and intent='brand_identity' and coalesce(f->>'text','') !~* '(open|hours|price|refund|reserv|优惠|营业|价格|harga|buka|tutup)' then part:=f->>'text';
   elsif ref like 'promotion:%' and f->>'source'='manager_confirmed_promotion' then part:=concat_ws(' — ',f->>'label',f->>'text','('||(f->>'starts_on')||' – '||(f->>'ends_on')||')',nullif(f->>'terms',''));
   elsif ref like 'outlet:%' and f->>'outlet_context_confirmed'='true' then
    if intent='locations' then part:=case when nullif(f->>'address','') is not null then f->>'text' end;
    elsif intent='operating_hours' then
     h:=f->'service_profile'->'requested_hours';
     if f->'service_profile'->>'requested_date' is not null then
      if h->>'status'='closed' then part:=(f->>'label')||' · '||(f->'service_profile'->>'requested_date')||case lang when 'ZH' then '：休息。' when 'BM' then ': Tutup.' else ': Closed.' end;
      elsif h->>'status'='open' and jsonb_array_length(h->'periods')>0 then
       select string_agg((x->>'opens')||'–'||(x->>'closes')||case when x->>'overnight'='true' then case lang when 'ZH' then '（次日）' when 'BM' then ' (hari berikutnya)' else ' (next day)' end else '' end,', ' order by n) into part from jsonb_array_elements(h->'periods') with ordinality p(x,n);
       part:=(f->>'label')||' · '||(f->'service_profile'->>'requested_date')||': '||part||' ('||(f->'service_profile'->>'timezone')||').';
      end if;
     end if;
    end if;
   elsif ref='menu:restaurant' and f->>'source'='restaurant_product_sales_with_explicit_recipe_mapping' and intent in ('menu','pricing') then
    -- Only return supplied current, manager-included items; never infer stock from sales.
    select string_agg((x->>'name')||case when x->>'price' is not null and x->>'price_issue' is null then ' · MYR '||(x->>'price') else '' end||case when nullif(x->>'description','') is not null then ' — '||(x->>'description') else '' end,E'\n' order by n) into part from jsonb_array_elements(f->'items') with ordinality i(x,n);
    if intent='pricing' and exists(select 1 from jsonb_array_elements(f->'items') x where x->>'price' is null or x->>'price_issue' is not null) then part:=null;end if;
   end if;
  end if;
  if part is null or cardinality(marketing_private.inbox_risk(part))>0 or part ~* '(we (will|can|have) (book|reserve|refund|confirm)|已(预订|訂位|退款)|sudah (ditempah|dibayar))' then return jsonb_build_object('kind','handoff','reason','unrenderable_or_sensitive_source');end if;
  parts:=array_append(parts,part);keys:=keys||jsonb_build_array(ref);
 end loop;
 part:=array_to_string(parts,E'\n');
 if length(part) not between 1 and 1800 then return jsonb_build_object('kind','handoff','reason','answer_bounds');end if;
 return jsonb_build_object('kind','answer','reason','source_grounded','keys',keys,'text',part);
end;$$;

create function marketing_private.inbox_auto_handoff(p_turn uuid,p_reason text) returns void language plpgsql set search_path=public as $$
declare t marketing_private.inbox_automatic_turns;begin
 select * into t from marketing_private.inbox_automatic_turns where id=p_turn;
 update marketing_private.inbox_automatic_turns set state=case when state in ('pending','reconciling','sent','delivered','read','failed') then state else 'handoff' end,reason=p_reason,summary=left('Needs staff: '||replace(p_reason,'_',' ')||E'. Recent conversation:\n'||(select string_agg(kind||': '||left(body,200),E'\n' order by occurred_at,id) from(select * from marketing_conversation_messages where conversation_id=t.conversation_id and kind in ('incoming','echo') order by occurred_at desc,id desc limit 4)x),1000),updated_at=now() where id=t.id;
 update marketing_conversations set takeover=true,status='open',version=version+1,updated_at=now() where id=t.conversation_id;
end;$$;
create function public.marketing_inbox_auto_finish(p_turn uuid,p_lease uuid,p_body jsonb,p_model text,p_input integer,p_output integer,p_cached uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare t marketing_private.inbox_automatic_turns;c public.marketing_conversations;p public.marketing_inbox_policies;a public.marketing_inbox_ai_artifacts;material jsonb;r jsonb;decision jsonb;d uuid;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only';end if;
 select * into t from marketing_private.inbox_automatic_turns where id=p_turn;
 perform 1 from marketing_conversations where id=t.conversation_id for update;
 perform 1 from marketing_reply_outbox where automatic_turn_id=t.id for update;
 select * into t from marketing_private.inbox_automatic_turns where id=p_turn for update;
 if t.lease is distinct from p_lease then raise exception 'Automatic lease changed';end if;
 if p_cached is null then r:=public.marketing_inbox_ai_finish(t.id,p_lease,p_body,p_model,p_input,p_output);else r:=jsonb_build_object('artifact_id',p_cached);end if;
 if t.state<>'generating' then return jsonb_build_object('state',t.state,'draft_id',(select draft_id from marketing_reply_outbox where automatic_turn_id=t.id),'auth_user',(select auth_user_id from employees where id=t.actor_employee_id));end if;
 select * into c from marketing_conversations where id=t.conversation_id for update;select * into p from marketing_inbox_policies where brand_id=c.brand_id;
 select * into a from marketing_inbox_ai_artifacts where id=(r->>'artifact_id')::uuid and conversation_id=c.id and source_version=t.source_version;
 material:=marketing_private.inbox_assistant_material(c.id);
 if a.id is null or a.body->>'source_hash' is distinct from t.source_hash or c.version<>t.source_version or p.revision<>t.policy_revision or material->>'source_hash' is distinct from t.source_hash or marketing_private.inbox_auto_issue(c,p) is not null then
  update marketing_private.inbox_automatic_turns set state='superseded',reason='decision_changed',updated_at=now() where id=t.id;return jsonb_build_object('state','superseded');end if;
 update marketing_private.inbox_automatic_turns set artifact_id=a.id where id=t.id;
 decision:=marketing_private.inbox_auto_answer(a,material,p.ai_reply_mode);
 if decision->>'kind'='clarify' and exists(select 1 from marketing_private.inbox_automatic_turns where conversation_id=c.id and reason=decision->>'reason' and created_at>now()-interval '24 hours' and id<>t.id) then decision:=jsonb_build_object('kind','handoff','reason','clarification_loop');end if;
 if decision->>'kind'='handoff' then perform marketing_private.inbox_auto_handoff(t.id,decision->>'reason');return jsonb_build_object('state','handoff','reason',decision->>'reason');end if;
 insert into marketing_reply_drafts(conversation_id,body,source_version,provenance,source_references,status,created_by,automatic)
 values(c.id,decision->>'text',c.version,'ai_suggestion',jsonb_build_array(jsonb_build_object('artifact_id',a.id,'automatic_turn_id',t.id,'policy_revision',p.revision,'authorization','brand_automatic_policy','answer_kind',decision->>'kind','reference_keys',decision->'keys')),'approved',t.actor_employee_id,true) returning id into d;
 insert into marketing_reply_outbox(draft_id,state,reason,execution_request,execution_actor,connection_generation,source_version,authorized_at,automatic_turn_id) values(d,'prepared','brand_automatic_policy',t.id,t.actor_employee_id,c.connection_generation,c.version,now(),t.id);
 update marketing_private.inbox_automatic_turns set state='prepared',reason=decision->>'reason',updated_at=now() where id=t.id;
 return jsonb_build_object('state','prepared','draft_id',d,'auth_user',(select auth_user_id from employees where id=t.actor_employee_id));
end;$$;

-- The canonical delivery material/checkpoint remains the only provider delivery authority.
alter function public.marketing_inbox_send_material(uuid,uuid) rename to marketing_inbox_staff_send_material;
revoke all on function public.marketing_inbox_staff_send_material(uuid,uuid) from public,anon,authenticated,service_role;
create function public.marketing_inbox_send_material(p_draft uuid,p_auth_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;t marketing_private.inbox_automatic_turns;c public.marketing_conversations;p public.marketing_inbox_policies;a public.marketing_inbox_ai_artifacts;expected jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only';end if;
 r:=public.marketing_inbox_staff_send_material(p_draft,p_auth_user);
 select x.* into t from marketing_private.inbox_automatic_turns x join marketing_reply_outbox o on o.automatic_turn_id=x.id where o.draft_id=p_draft;
 if t.id is null then if exists(select 1 from marketing_reply_drafts where id=p_draft and automatic) then raise exception 'Automatic evidence unavailable';end if;return r;end if;
 if r->>'state'='blocked' then raise exception 'Automatic delivery blocked';end if;
 select * into c from marketing_conversations where id=t.conversation_id;select * into p from marketing_inbox_policies where brand_id=c.brand_id;
 if r->>'state' in ('prepared','pending','reconciling') then
  if t.state not in ('prepared','pending','reconciling') or p.revision<>t.policy_revision or c.version<>t.source_version or t.created_at<=now()-interval '5 minutes' or marketing_private.inbox_auto_issue(c,p) is not null then raise exception 'Automatic authority changed';end if;
  select * into a from marketing_inbox_ai_artifacts where id=t.artifact_id;
  expected:=marketing_private.inbox_auto_answer(a,marketing_private.inbox_assistant_material(c.id),p.ai_reply_mode);
  if expected->>'text' is distinct from r->>'text' then raise exception 'Automatic evidence changed';end if;
 end if;return r;
end;$$;
create function marketing_private.inbox_auto_receipt() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.automatic_turn_id is not null then
  update marketing_private.inbox_automatic_turns set state=new.state,updated_at=now() where id=new.automatic_turn_id and new.state in ('pending','sent','delivered','read','reconciling','failed');
 end if;return new;
end;$$;
create trigger inbox_auto_receipt after update of state on public.marketing_reply_outbox for each row execute function marketing_private.inbox_auto_receipt();

create function public.marketing_inbox_auto_fail(p_turn uuid,p_lease uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare t marketing_private.inbox_automatic_turns;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only';end if;
 if p_reason not in ('generation_expired','automatic_processing_failed','delivery_uncertain','provider_rejected') then raise exception 'Invalid failure reason';end if;
 select * into t from marketing_private.inbox_automatic_turns where id=p_turn;
 perform 1 from marketing_conversations where id=t.conversation_id for update;
 perform 1 from marketing_reply_outbox where automatic_turn_id=t.id for update;
 select * into t from marketing_private.inbox_automatic_turns where id=p_turn for update;
 if t.lease is distinct from p_lease then raise exception 'Automatic lease changed';end if;
 if t.state in ('sent','delivered','read','handoff','blocked','superseded') then return;end if;
 if t.state='generating' then perform public.marketing_inbox_ai_finish(t.id,p_lease,'{}','',null,null,true);end if;
 perform marketing_private.inbox_auto_handoff(t.id,p_reason);
end;$$;

-- Assignment is human ownership; releasing it cannot silently restart automatic sends.
create function marketing_private.inbox_auto_assignment() returns trigger language plpgsql security definer set search_path=public as $$
begin if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to then new.takeover:=true;end if;return new;end;$$;
create trigger inbox_auto_assignment before update of assigned_to on public.marketing_conversations for each row execute function marketing_private.inbox_auto_assignment();
do $m$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
 needle:=$n$if p_command='update' then$n$;
 if position(needle in f)=0 then raise exception 'Conversation update baseline differs';end if;
 f:=replace(f,needle,needle||$n$ if c.takeover and p_payload->>'takeover'='false' and exists(select 1 from marketing_inbox_policies where brand_id=c.brand_id and ai_reply_mode<>'suggest_only') then raise exception 'Use Resume AI after checking current eligibility.';end if;$n$);execute f;
 f:=pg_get_functiondef('public.marketing_inbox_prepare_staff_reply(uuid,uuid,integer,text,uuid)'::regprocedure);
 needle:=$n$if c.id is null$n$;
 if position(needle in f)=0 then raise exception 'Staff reply baseline differs';end if;
 f:=replace(f,needle,$n$if not c.takeover and exists(select 1 from marketing_inbox_policies where brand_id=c.brand_id and ai_reply_mode<>'suggest_only') then raise exception 'Take over this conversation before sending a staff reply.';end if; $n$||needle);execute f;
end;$m$;

create function public.marketing_inbox_ai_resume(p_request uuid,p_conversation uuid,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations;p public.marketing_inbox_policies;actor uuid;issue text;prior public.marketing_requests;fp text;begin
 select * into c from marketing_conversations where id=p_conversation for update;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.manage');perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.ai');
 fp:=encode(extensions.digest(jsonb_build_array('resume_ai',c.id,p_version)::text,'sha256'),'hex');select * into prior from marketing_requests where request_id=p_request;
 if prior.request_id is not null then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed';end if;return prior.result;end if;
 if c.version<>p_version or cardinality(c.escalation_reasons)>0 then raise exception 'Resolve current escalation before resuming AI';end if;
 select * into p from marketing_inbox_policies where brand_id=c.brand_id;
 c.takeover:=false;c.assigned_to:=null;issue:=marketing_private.inbox_auto_issue(c,p);
 if issue is not null or exists(select 1 from marketing_reply_outbox o join marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('prepared','pending','reconciling')) then raise exception 'AI cannot resume: check mode, schedule, channel, window and pending delivery';end if;
 update marketing_conversations set takeover=false,assigned_to=null,version=version+1,updated_at=now() where id=c.id returning * into c;
 insert into marketing_requests values(p_request,actor,fp,jsonb_build_object('resumed',true,'version',c.version));
 insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_resume_ai',actor,jsonb_build_object('conversation_id',c.id,'version',c.version));
 return jsonb_build_object('resumed',true,'version',c.version);
end;$$;

create function public.marketing_inbox_ai_performance(p_brand uuid,p_days integer default 7) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid;since_ timestamptz;begin
 select organization_id into org from brands where id=p_brand;perform marketing_private.require_access(org,p_brand,'marketing_inbox.ai');
 if p_days not between 1 and 30 then raise exception 'Choose 1–30 days';end if;since_:=now()-make_interval(days=>p_days);
 return jsonb_build_object('days',p_days,'generation',(select jsonb_build_object('requests',count(*),'completed',count(*) filter(where r.state='completed'),'suggestions',count(*) filter(where r.state='completed' and r.kind='reply'),'failed',count(*) filter(where r.state='failed'),'input_tokens',sum(r.input_tokens),'output_tokens',sum(r.output_tokens),'estimated_usd',sum(r.cost),'unknown_cost_requests',count(*) filter(where r.cost is null),'latency_ms',avg(r.latency_ms)) from marketing_private.inbox_ai_runs r join marketing_conversations c on c.id=r.conversation_id where c.brand_id=p_brand and r.created_at>=since_),
 'automatic',(select coalesce(jsonb_object_agg(state,n),'{}') from(select t.state,count(*) n from marketing_private.inbox_automatic_turns t join marketing_conversations c on c.id=t.conversation_id where c.brand_id=p_brand and t.created_at>=since_ group by t.state)s),
 'handoffs',(select count(*) from marketing_private.inbox_automatic_turns t join marketing_conversations c on c.id=t.conversation_id where c.brand_id=p_brand and t.created_at>=since_ and t.summary is not null),'delivery',(select jsonb_build_object('provider_accepted',count(*) filter(where o.provider_message_id is not null),'delivered',count(*) filter(where o.state in ('delivered','read')),'read',count(*) filter(where o.state='read'),'uncertain',count(*) filter(where o.state='reconciling')) from marketing_reply_outbox o join marketing_reply_drafts d on d.id=o.draft_id join marketing_conversations c on c.id=d.conversation_id where c.brand_id=p_brand and o.automatic_turn_id is not null and o.created_at>=since_),
 'feedback',(select jsonb_build_object('total',count(*),'helpful',count(*) filter(where f.helpful)) from marketing_inbox_ai_feedback f join marketing_inbox_ai_artifacts a on a.id=f.artifact_id join marketing_conversations c on c.id=a.conversation_id where c.brand_id=p_brand and f.updated_at>=since_));
end;$$;

-- Context/state projection reuses the existing three-column conversation read.
do $m$ declare f text;needle text:=$n$return jsonb_build_object('outlet_context'$n$;begin
 f:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Inbox detail baseline differs';end if;
 execute replace(f,needle,$r$return jsonb_build_object('ai_handling',jsonb_build_object('mode',coalesce((select ai_reply_mode from marketing_inbox_policies where brand_id=c.brand_id),'suggest_only'),'last_turn',(select jsonb_build_object('state',state,'reason',reason,'summary',summary,'updated_at',updated_at) from marketing_private.inbox_automatic_turns where conversation_id=c.id order by created_at desc limit 1)),'outlet_context'$r$);
end;$m$;

revoke all on function marketing_private.inbox_ai_schedule_valid(text,jsonb),marketing_private.inbox_ai_available(public.marketing_inbox_policies),marketing_private.inbox_ai_prepare_as(uuid,uuid,uuid,integer,text),marketing_private.inbox_auto_issue(public.marketing_conversations,public.marketing_inbox_policies),marketing_private.inbox_auto_new_conversation(),marketing_private.inbox_auto_enqueue(),marketing_private.inbox_auto_cancel(),marketing_private.inbox_auto_answer(public.marketing_inbox_ai_artifacts,jsonb,text),marketing_private.inbox_auto_handoff(uuid,text),marketing_private.inbox_auto_receipt() from public,anon,authenticated,service_role;
revoke all on function public.marketing_inbox_auto_claim(),public.marketing_inbox_auto_finish(uuid,uuid,jsonb,text,integer,integer,uuid),public.marketing_inbox_send_material(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_inbox_auto_claim(),public.marketing_inbox_auto_finish(uuid,uuid,jsonb,text,integer,integer,uuid),public.marketing_inbox_send_material(uuid,uuid) to service_role;
revoke all on function public.marketing_inbox_ai_resume(uuid,uuid,integer),public.marketing_inbox_ai_performance(uuid,integer) from public,anon;
grant execute on function public.marketing_inbox_ai_resume(uuid,uuid,integer),public.marketing_inbox_ai_performance(uuid,integer) to authenticated;

do $m$ declare f text;needle text:=' actor:=marketing_private.require_access(c.organization_id,c.brand_id,''marketing_inbox.send'');';begin
 f:=pg_get_functiondef('public.marketing_inbox_prepare_send(uuid,uuid)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Manual delivery baseline differs';end if;
 execute replace(f,needle,needle||$n$ if d.automatic then raise exception 'Automatic delivery belongs to the shared worker.';end if; if not c.takeover and exists(select 1 from marketing_inbox_policies where brand_id=c.brand_id and ai_reply_mode<>'suggest_only') then raise exception 'Take over this conversation before sending a staff reply.';end if;$n$);
end;$m$;

revoke all on function marketing_private.inbox_auto_assignment() from public,anon,authenticated,service_role;
revoke all on function public.marketing_inbox_auto_fail(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_inbox_auto_fail(uuid,uuid,text) to service_role;

revoke all on function marketing_private.inbox_auto_sensitive(text) from public,anon,authenticated,service_role;

-- Provider timestamps can tie; canonical insertion sequence, never random UUID order, breaks ties.
do $m$ declare f text;target text;begin
 foreach target in array array['marketing_private.inbox_assistant_material_v22(uuid)','marketing_private.inbox_assistant_material(uuid)','marketing_private.inbox_capture_outlet_reference()'] loop
  f:=pg_get_functiondef(target::regprocedure);
  f:=replace(f,'select id,kind,body,occurred_at from','select id,kind,body,occurred_at,sequence from');
  f:=replace(f,'order by occurred_at desc,id desc','order by occurred_at desc,sequence desc');
  f:=replace(f,'order by occurred_at,id','order by occurred_at,sequence');
  f:=replace(f,'(m.occurred_at,m.id)>(new.occurred_at,new.id)','(m.occurred_at,m.sequence)>(new.occurred_at,new.sequence)');execute f;
 end loop;
end;$m$;

-- Existing canonical privacy erasure deletes artifacts before messages; new evidence follows that authority.
alter table public.marketing_inbox_ai_feedback drop constraint marketing_inbox_ai_feedback_artifact_id_fkey;
alter table public.marketing_inbox_ai_feedback add constraint marketing_inbox_ai_feedback_artifact_id_fkey foreign key(artifact_id) references public.marketing_inbox_ai_artifacts(id) on delete cascade;
