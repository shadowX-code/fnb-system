-- Independent messaging evidence and explicit staff-only delivery. No publishing changes.
alter table marketing_private.inbox_authority add column page_id text, add column page_tasks text[] not null default '{}', add column granted_scopes text[] not null default '{}', add column signed_inbound_at timestamptz;
alter table public.marketing_reply_outbox drop constraint marketing_reply_outbox_state_check;
alter table public.marketing_reply_outbox drop constraint marketing_reply_outbox_provider_message_id_check;
alter table public.marketing_reply_outbox add constraint marketing_reply_outbox_state_check check(state in ('blocked','prepared','pending','reconciling','failed','sent','delivered','read')),
 add column execution_request uuid unique, add column execution_actor uuid references public.employees(id), add column connection_generation integer,
 add constraint marketing_reply_outbox_receipt_state check ((state in ('sent','delivered','read')) = (provider_message_id is not null)),
 add column source_version integer, add column lease uuid, add column authorized_at timestamptz, add column sent_at timestamptz;
create index marketing_reply_outbox_actor on public.marketing_reply_outbox(execution_actor);
insert into public.permissions(code,module,description,requires_restaurant_outlet_scope) values('marketing_inbox.send','Marketing Inbox','Explicitly send an approved reply within verified messaging authority.',false) on conflict(code) do nothing;

create function public.marketing_inbox_record_verification(p_connection uuid,p_auth_user uuid,p_generation integer,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; a marketing_private.inbox_authority; verified boolean;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.credential_generation<>p_generation or c.provider_account_id<>p_evidence->>'account_id' or c.channel<>p_evidence->>'channel' then raise exception 'Connection changed.';end if;
 verified:=coalesce((p_evidence->>'authorization_verified')::boolean,false);
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,send_verified,webhook_verified,verified_at,page_id,page_tasks,granted_scopes)
 values(c.id,c.credential_generation,verified,verified,verified and coalesce((p_evidence->>'real_inbound_verified')::boolean,false) and coalesce((p_evidence->>'subscriptions_verified')::boolean,false),now(),p_evidence->>'page_id',array(select jsonb_array_elements_text(p_evidence->'page_tasks')),array(select jsonb_array_elements_text(p_evidence->'required_permissions')))
 on conflict(connection_id) do update set generation=excluded.generation,receive_verified=excluded.receive_verified,send_verified=excluded.send_verified,verified_at=now(),page_id=excluded.page_id,page_tasks=excluded.page_tasks,granted_scopes=excluded.granted_scopes,
 webhook_verified=excluded.webhook_verified;
 if verified and coalesce((p_evidence->>'real_inbound_verified')::boolean,false) and coalesce((p_evidence->>'subscriptions_verified')::boolean,false) then
  update marketing_private.inbox_events set state='pending',error_code=null where connection_id=c.id and generation=c.credential_generation and state='blocked' and payload->>'event_id' in (select jsonb_array_elements_text(p_evidence->'verified_inbound_ids'));
 end if;
 return marketing_private.inbox_channel(c.id);
end;$$;

-- Called only after signature verification, from normalized events, never developer dashboard tests.
create function public.marketing_inbox_signed_events(p_events jsonb) returns void language plpgsql security definer set search_path=public as $$
declare item jsonb; c public.marketing_connections;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>1000 then raise exception 'Invalid event batch.';end if;
 for item in select value from jsonb_array_elements(p_events) loop
  if item->>'kind' not in ('incoming','attachment') or coalesce(item->>'medium','dm')<>'dm' then continue;end if;
  select * into c from public.marketing_connections where channel=item->>'channel' and provider_account_id=item->>'account_id';
  update marketing_private.inbox_authority set signed_inbound_at=now() where connection_id=c.id and generation=c.credential_generation and receive_verified and verified_at>now()-interval '1 hour';
 end loop;
end;$$;

create function public.marketing_inbox_verification_events(p_connection uuid,p_auth_user uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 return (select coalesce(jsonb_agg(payload),'[]') from (select e.payload from marketing_private.inbox_events e join public.marketing_connections c on c.id=e.connection_id where e.connection_id=p_connection and e.generation=c.credential_generation and e.created_at>now()-interval '24 hours' and e.payload->>'kind' in ('incoming','attachment') and coalesce(e.payload->>'medium','dm')='dm' order by e.created_at desc limit 50) x);
end;$$;

create function public.marketing_inbox_prepare_send(p_request uuid,p_draft uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketing_reply_drafts; c public.marketing_conversations; o public.marketing_reply_outbox; conn public.marketing_connections; a marketing_private.inbox_authority; actor uuid;
begin
 select * into d from public.marketing_reply_drafts where id=p_draft;
 select * into c from public.marketing_conversations where id=d.conversation_id for update;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.send');
 select * into o from public.marketing_reply_outbox where draft_id=d.id for update;
 if o.execution_request is not null then
  if o.execution_request<>p_request or o.execution_actor<>actor then raise exception 'Execution request changed.';end if;
  return jsonb_build_object('state',o.state,'provider_message_id',o.provider_message_id);
 end if;
 select * into conn from public.marketing_connections where id=c.connection_id;
 select * into a from marketing_private.inbox_authority where connection_id=conn.id;
 if p_request is null or d.status<>'approved' or d.source_version<>c.version or c.channel='internal' or c.medium<>'dm' or c.opted_out or c.status='resolved' or length(d.body)>2000 or
  c.last_inbound_at is null or c.last_inbound_at>now() or c.last_inbound_at<=now()-interval '24 hours' or
  a.generation is distinct from conn.credential_generation or not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour' or
  conn.status<>'test_authorized' or conn.expires_at<=now() then raise exception 'Messaging authority or approved reply unavailable.';end if;
 if d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision) then raise exception 'Approved knowledge changed.';end if;
 update public.marketing_reply_outbox set execution_request=p_request,execution_actor=actor,connection_generation=conn.credential_generation,source_version=c.version,authorized_at=now(),state='prepared',reason='staff_execution_requested' where draft_id=d.id;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_authorize_send',actor,jsonb_build_object('draft_id',d.id,'request_id',p_request));
 return jsonb_build_object('state','prepared');
end;$$;

create function public.marketing_inbox_send_material(p_draft uuid,p_auth_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketing_reply_drafts; c public.marketing_conversations; o public.marketing_reply_outbox; conn public.marketing_connections; a marketing_private.inbox_authority; actor uuid; v jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 select * into d from public.marketing_reply_drafts where id=p_draft;
 select * into c from public.marketing_conversations where id=d.conversation_id;
 select id into actor from public.employees where auth_user_id=p_auth_user;
 if actor is null or not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.send') then raise exception 'Inbox send scope denied.';end if;
 select * into o from public.marketing_reply_outbox where draft_id=p_draft;
 select * into conn from public.marketing_connections where id=c.connection_id;
 select * into a from marketing_private.inbox_authority where connection_id=conn.id;
 if o.execution_actor is distinct from actor or o.execution_request is null then raise exception 'Staff execution approval unavailable.';end if;
 if o.state in ('prepared','pending') and (d.status<>'approved' or d.source_version<>c.version or o.source_version<>c.version or c.opted_out or c.status='resolved' or c.medium<>'dm' or
  c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' or c.last_inbound_at>now() or conn.credential_generation<>o.connection_generation or
  a.generation is distinct from conn.credential_generation or not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour' or conn.expires_at<=now() or conn.status<>'test_authorized' or
  (d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision))) then raise exception 'Messaging authority changed.';end if;
 select to_jsonb(conn)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id) into v from marketing_private.credentials s where s.connection_id=conn.id;
 return jsonb_build_object('connection',v,'recipient',c.participant_key,'text',d.body,'state',o.state,'receipt',o.provider_message_id,'lease',o.lease,'authority',jsonb_build_object('execution_enabled',true,'send_verified',a.send_verified,'webhook_verified',a.webhook_verified,'exact_authorizer_verified',a.send_verified,'page_tasks',array['MESSAGE'],'granted_scopes',a.granted_scopes,'last_inbound_at',c.last_inbound_at,'page_id',a.page_id,'opted_out',c.opted_out,'medium',c.medium));
end;$$;

create function public.marketing_inbox_send_checkpoint(p_draft uuid,p_auth_user uuid,p_lease uuid,p_state jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.marketing_reply_outbox; material jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 select * into o from public.marketing_reply_outbox where draft_id=p_draft for update;
 if coalesce((p_state->>'pending')::boolean,false) then
  material:=public.marketing_inbox_send_material(p_draft,p_auth_user);
  if o.state<>'prepared' then raise exception 'Already attempted.';end if;
  update public.marketing_reply_outbox set state='pending',lease=gen_random_uuid(),sent_at=now(),reason='delivery_in_progress' where draft_id=p_draft returning * into o;
 else
  if p_lease is null or o.lease is distinct from p_lease or o.state not in ('pending','reconciling') then raise exception 'Delivery lease changed.';end if;
  if p_state->>'receipt' is not null and length(p_state->>'receipt') between 1 and 300 then
   update public.marketing_reply_outbox set state='sent',provider_message_id=p_state->>'receipt',reason='provider_accepted' where draft_id=p_draft returning * into o;
   -- A signed receipt may arrive before the Send API response is checkpointed.
   if exists(select 1 from public.marketing_conversation_messages m join public.marketing_reply_drafts d on d.conversation_id=m.conversation_id where d.id=p_draft and m.kind='read' and m.occurred_at>=o.sent_at) then
    update public.marketing_reply_outbox set state='read',reason='provider_read_observed' where draft_id=p_draft returning * into o;
   elsif exists(select 1 from public.marketing_conversation_messages m join public.marketing_reply_drafts d on d.conversation_id=m.conversation_id where d.id=p_draft and m.kind='delivery' and m.provider_message_id=o.provider_message_id) then
    update public.marketing_reply_outbox set state='delivered',reason='provider_delivery_observed' where draft_id=p_draft returning * into o;
   end if;
  elsif p_state->>'failed'='provider_rejected' then
   update public.marketing_reply_outbox set state='failed',reason='provider_rejected' where draft_id=p_draft returning * into o;
  else update public.marketing_reply_outbox set state='reconciling',reason='delivery_receipt_unknown' where draft_id=p_draft returning * into o;end if;
 end if;
 return jsonb_build_object('state',o.state,'lease',o.lease,'receipt',o.provider_message_id);
end;$$;

-- Signed delivery evidence updates only its exact conversation and receipt.
create function marketing_private.inbox_reconcile_receipt() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.kind='delivery' then update public.marketing_reply_outbox o set state=case when state='read' then 'read' else 'delivered' end,reason='provider_delivery_observed'
 from public.marketing_reply_drafts d where o.draft_id=d.id and d.conversation_id=new.conversation_id and o.provider_message_id=new.provider_message_id and o.state in ('sent','delivered','read');
 elsif new.kind='read' then update public.marketing_reply_outbox o set state='read',reason='provider_read_observed' from public.marketing_reply_drafts d
 where o.draft_id=d.id and d.conversation_id=new.conversation_id and o.sent_at<=new.occurred_at and o.state in ('sent','delivered','read');end if;
 return new;
end;$$;
create trigger inbox_reconcile_receipt after insert on public.marketing_conversation_messages for each row execute function marketing_private.inbox_reconcile_receipt();
revoke all on function marketing_private.inbox_reconcile_receipt() from public,anon,authenticated;
revoke all on function public.marketing_inbox_prepare_send(uuid,uuid) from public,anon;
grant execute on function public.marketing_inbox_prepare_send(uuid,uuid) to authenticated;
revoke all on function public.marketing_inbox_record_verification(uuid,uuid,integer,jsonb),public.marketing_inbox_signed_events(jsonb),public.marketing_inbox_verification_events(uuid,uuid),public.marketing_inbox_send_material(uuid,uuid),public.marketing_inbox_send_checkpoint(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_inbox_record_verification(uuid,uuid,integer,jsonb),public.marketing_inbox_signed_events(jsonb),public.marketing_inbox_verification_events(uuid,uuid),public.marketing_inbox_send_material(uuid,uuid),public.marketing_inbox_send_checkpoint(uuid,uuid,uuid,jsonb) to service_role;

-- Public OpenAI GPT-5 mini rates checked 2026-10-10: USD .25/M input, 2/M output.
-- Full-price input estimate does not assume cache discounts or verified billing.
create function marketing_private.inbox_estimate_ai_cost() returns trigger language plpgsql security definer set search_path=public as $$
begin
 new.cost:=case when coalesce(to_jsonb(new)->>'provider_model',to_jsonb(new)->>'model') ~ '^gpt-5-mini(-[0-9]{4}-[0-9]{2}-[0-9]{2})?$' and new.input_tokens>=0 and new.output_tokens>=0 then (new.input_tokens*0.25+new.output_tokens*2.0)/1000000 else null end;
 return new;
end;$$;
create trigger inbox_estimate_run_cost before update of provider_model,input_tokens,output_tokens on marketing_private.inbox_ai_runs for each row execute function marketing_private.inbox_estimate_ai_cost();
create trigger inbox_estimate_artifact_cost before insert on public.marketing_inbox_ai_artifacts for each row execute function marketing_private.inbox_estimate_ai_cost();
revoke all on function marketing_private.inbox_estimate_ai_cost() from public,anon,authenticated;

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
 select jsonb_build_object('requests',count(*),'input_tokens',sum(r.input_tokens),'output_tokens',sum(r.output_tokens),'usage_unavailable_requests',count(*) filter(where r.input_tokens is null or r.output_tokens is null),'cost',sum(r.cost),'cost_available',count(*)>0 and count(r.cost)=count(*),'cost_estimated',true,'cost_currency','USD','cost_pricing_date','2026-10-10','cost_unavailable_requests',count(*) filter(where r.cost is null))
 into usage from marketing_private.inbox_ai_runs r join public.marketing_conversations c on c.id=r.conversation_id where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 return jsonb_build_object('ai_usage',usage,'rows',rows,'total',total,'channels',channels,'members',members,'policy',coalesce(policy,'{"revision":0,"automation_mode":"suggest","ai_allowed":false}'),'faqs',coalesce(faqs,'[]'),'knowledge',knowledge,'external_execution_enabled',false);
end;$$;


create or replace function marketing_private.inbox_classify(p_text text) returns text language sql immutable set search_path=public as $$
 select case when cardinality(marketing_private.inbox_risk(p_text))>0 then 'sensitive'
 when p_text ~* '(reserv|booking|预订|订位|tempah)' then 'reservations'
 when p_text ~* '(brand name|nama (jenama|brand)|品牌名|品牌名称)' then 'brand_identity'
 when p_text ~* '(menu|菜单|餐单)' then 'menu'
 when p_text ~* '(price|cost|harga|价格|多少钱)' then 'pricing'
 when p_text ~* '(open|hours|close|营业|几点|waktu|buka|tutup)' then 'operating_hours'
 when p_text ~* '(location|address|where|地址|哪里|lokasi|alamat|mana)' then 'locations'
 when p_text ~* '(promo|discount|offer|优惠|促销|diskaun)' then 'promotions' else 'unknown' end;
$$;
create or replace function marketing_private.inbox_ai_classification() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.kind='reply' and new.body->>'intent' in ('brand_identity','menu','pricing','operating_hours','locations','promotions','reservations','complaint','refund','allergen','food_safety','sensitive','unknown') then
  update public.marketing_conversations set intent=new.body->>'intent',language=new.body->>'language',classification_source='ai' where id=new.conversation_id and version=new.source_version;
 end if;return new;end;$$;
