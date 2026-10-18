-- Optional narrowing, not a second ownership or sending authority.
alter table public.marketing_inbox_policies add column ai_conversation_ids uuid[] check(ai_conversation_ids is null or cardinality(ai_conversation_ids) between 1 and 20);
do $m$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_configure(uuid,uuid,integer,text,jsonb)'::regprocedure);
 needle:='  insert into public.marketing_inbox_policies(';
 if position(needle in f)=0 then raise exception 'Policy baseline differs';end if;
 f:=replace(f,needle,$n$  if p_payload ? 'ai_conversation_ids' and p_payload->'ai_conversation_ids'<>'null'::jsonb then
   if jsonb_typeof(p_payload->'ai_conversation_ids')<>'array' or jsonb_array_length(p_payload->'ai_conversation_ids') not between 1 and 20 then raise exception 'Choose up to 20 conversations';end if;
   if exists(select 1 from jsonb_array_elements_text(p_payload->'ai_conversation_ids') x where not exists(select 1 from marketing_conversations c where c.id=x::uuid and c.brand_id=p_brand and c.organization_id=org and c.channel in('facebook','instagram'))) then raise exception 'Conversation scope differs';end if;
  end if;
$n$||needle);
 f:=replace(f,'ai_authorized_by,ai_enabled_at) values','ai_authorized_by,ai_enabled_at,ai_conversation_ids) values');
 needle:='coalesce(policy.ai_enabled_at,now()) end)';
 if position(needle in f)=0 then raise exception 'Activation baseline differs';end if;
 f:=replace(f,needle,$n$coalesce(policy.ai_enabled_at,now()) end,case when p_payload ? 'ai_conversation_ids' then case when p_payload->'ai_conversation_ids'='null'::jsonb then null else array(select jsonb_array_elements_text(p_payload->'ai_conversation_ids'))::uuid[] end else policy.ai_conversation_ids end)$n$);
 f:=replace(f,'ai_enabled_at=excluded.ai_enabled_at,','ai_enabled_at=excluded.ai_enabled_at,ai_conversation_ids=excluded.ai_conversation_ids,');execute f;
 f:=pg_get_functiondef('marketing_private.inbox_auto_issue(public.marketing_conversations,public.marketing_inbox_policies)'::regprocedure);
 f:=replace(f,' if c.takeover or', $n$ if p.ai_conversation_ids is not null and not c.id=any(p.ai_conversation_ids) then return 'outside_automatic_scope';end if;
 if c.takeover or$n$);execute f;
 f:=pg_get_functiondef('marketing_private.inbox_auto_new_conversation()'::regprocedure);
 f:=replace(f,'if new.created_by is null and','if (p.ai_conversation_ids is null or new.id=any(p.ai_conversation_ids)) and new.created_by is null and');execute f;
 f:=pg_get_functiondef('marketing_private.inbox_auto_enqueue()'::regprocedure);
 f:=replace(f,'if p.ai_allowed and', $n$if (p.ai_conversation_ids is null or new.conversation_id=any(p.ai_conversation_ids)) and p.ai_allowed and$n$);execute f;
end;$m$;

-- Finite source-preserving translations; never ask a model to certify its own invented facts.
create function marketing_private.inbox_auto_translation(p_text text,p_language text) returns text language plpgsql immutable set search_path=public as $$
declare name_ text;source_language text;begin
 if p_language not in('EN','ZH','BM') or p_text is null then return null;end if;
 name_:=substring(p_text from '^Our brand name is ([^.\n]+)\.$');
 if name_ is not null then return case p_language when 'ZH' then '我们的品牌是'||name_||'。' when 'BM' then 'Nama jenama kami ialah '||name_||'.' else p_text end;end if;
 if p_text='Please tell our team how we can help.' then return case p_language when 'ZH' then '请告诉我们的团队你需要什么帮助。' when 'BM' then 'Sila beritahu pasukan kami bagaimana kami boleh membantu.' else p_text end;end if;
 source_language:=case when p_text ~ '[一-鿿]' then 'ZH' when p_text ~* '\m(boleh|saya|kami|anda|masih|buka|tutup|cawangan|terima|kasih|tempah|bayaran|makanan|kedai|promosi|aduan|sila)\M' then 'BM' else 'EN' end;
 if source_language=p_language then return p_text;end if;
 return null;
end;$$;
revoke all on function marketing_private.inbox_auto_translation(text,text) from public,anon,authenticated,service_role;
do $m$ declare f text;needle text;begin
 f:=pg_get_functiondef('marketing_private.inbox_auto_answer(public.marketing_inbox_ai_artifacts,jsonb,text)'::regprocedure);
 f:=replace(f,$x$lang:=a.body->>'language';$x$,$n$lang:=case when q ~ '[一-鿿]' then 'ZH' when q ~* '\m(boleh|nak|saya|masih|buka|tutup|mana|pukul|tempah|bayaran|cawangan|berapa|promosi)\M' then 'BM' else a.body->>'language' end;$n$);
 needle:='  if part is null or cardinality(marketing_private.inbox_risk(part))>0';
 if position(needle in f)=0 then raise exception 'Source renderer baseline differs';end if;
 f:=replace(f,needle,$n$  if part is not null and not(ref like 'outlet:%' and intent in('locations','operating_hours')) then
   part:=marketing_private.inbox_auto_translation(part,lang);
   if part is null then return jsonb_build_object('kind','handoff','reason','safe_translation_unavailable');end if;
  end if;
$n$||needle);execute f;
end;$m$;

-- A failure may also hand off; report failures from their evidence, not only current queue state.
do $m$ declare f text;needle text:=$n$ 'handoffs',(select count(*)$n$;begin
 f:=pg_get_functiondef('public.marketing_inbox_ai_performance(uuid,integer)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Performance baseline differs';end if;
 f:=replace(f,needle,$n$ 'failed_automatic',(select count(*) from marketing_private.inbox_automatic_turns t join marketing_conversations c on c.id=t.conversation_id where c.brand_id=p_brand and t.created_at>=since_ and (t.state='failed' or t.reason in('generation_expired','automatic_processing_failed','delivery_uncertain','provider_rejected','generation_quota_or_authority') or exists(select 1 from marketing_reply_outbox o where o.automatic_turn_id=t.id and o.state='failed'))), 'handoffs',(select count(*)$n$);execute f;
end;$m$;
