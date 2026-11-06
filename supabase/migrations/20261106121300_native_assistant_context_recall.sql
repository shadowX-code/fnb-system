set local lock_timeout='3s';
-- Derived, versioned cache only. Originals, outcomes, evidence and paid ledgers stay intact.
alter table feedx_integrations.native_assistant_sessions add column context_summary jsonb;
alter table feedx_integrations.native_assistant_requests add column context_usage jsonb;
create function feedx_integrations.assistant_invalidate_summary()
returns trigger language plpgsql set search_path=pg_catalog,feedx_integrations as $$
begin
 if tg_op='DELETE' or old.state='completed' then
  update feedx_integrations.native_assistant_sessions set context_summary=null where id=old.session_id;
 end if;
 return null;
end $$;
revoke all on function feedx_integrations.assistant_invalidate_summary() from public,anon,authenticated;
create trigger assistant_invalidate_summary after delete or update of prompt,reply,state,evidence on feedx_integrations.native_assistant_requests
 for each row execute function feedx_integrations.assistant_invalidate_summary();

do $migration$
declare def text:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure); old text;
begin
 -- Same actor and current canonical permission fingerprint, before any history retrieval.
 old:=' if p_action=''session_list'' then';
 if strpos(def,old)=0 then raise exception 'Assistant session listing changed'; end if;
 def:=replace(def,old,$body$
 if p_action='history_recall' then
  if char_length(btrim(coalesce(p_payload->>'query',''))) not between 2 and 80 then raise exception 'invalid_request' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select ns.id as session_id,coalesce(ns.title,'Conversation') as title,q.seq,q.created_at,
    left(q.prompt,450) as prompt,case when q.evidence is null then left(q.reply,650) else '[Historical business answer withheld; fresh authorized read required]' end as reply
   from feedx_integrations.native_assistant_sessions ns join feedx_integrations.native_assistant_requests q on q.session_id=ns.id and q.user_id=ns.user_id
   where ns.user_id=p_actor and ns.deleted_at is null and ns.expires_at>now() and (ns.scope_key is null or ns.scope_key=access_scope)
    and ns.id is distinct from (p_payload->>'exclude_session_id')::uuid and q.kind='turn' and q.state='completed' and q.voice_input_available
    and exists(select 1 from regexp_split_to_table(lower(btrim(p_payload->>'query')),'[[:space:]]+') term
      where char_length(term)>=2 and strpos(lower(q.prompt||' '||coalesce(q.reply,'')),term)>0)
   order by (strpos(lower(coalesce(ns.title,'')),lower(p_payload->>'query'))>0) desc,q.created_at desc limit 3
  ) x;
  return jsonb_build_object('sources',result);
 end if;
 if p_action='session_list' then$body$);
 old:='and (page_id is null or (ns.last_activity_at,ns.id)<(page_time,page_id))';
 if strpos(def,old)=0 then raise exception 'Assistant cursor changed'; end if;
 def:=replace(def,old,'and exists(select 1 from feedx_integrations.native_assistant_requests q where q.session_id=ns.id and q.user_id=p_actor and q.kind=''turn'') '||old);
 old:='strpos(lower(coalesce(ns.title,''New conversation'')),lower(p_payload->>''query''))>0';
 if strpos(def,old)=0 then raise exception 'Assistant search changed'; end if;
 def:=replace(def,old,'('||old||' or exists(select 1 from feedx_integrations.native_assistant_requests q where q.session_id=ns.id and q.user_id=p_actor and q.kind=''turn'' and strpos(lower(q.prompt||'' ''||coalesce(q.reply,'''')),lower(p_payload->>''query''))>0))');
 old:=' if p_action=''session_check'' then';
 if strpos(def,old)=0 then raise exception 'Assistant scope gate changed'; end if;
 def:=replace(def,old,$body$
 if p_action in ('context_snapshot','context_summary') then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]'::jsonb) into context from (
   select q.seq,q.prompt,case when q.evidence is null then q.reply end as reply,q.evidence is not null as has_evidence
   from feedx_integrations.native_assistant_requests q where q.session_id=sid and q.user_id=p_actor and q.kind='turn'
    and q.state='completed' and q.voice_input_available order by q.seq desc limit 200
  ) x;
  select md5(coalesce(jsonb_agg(value order by (value->>'seq')::bigint),'[]'::jsonb)::text) into requested_text
   from jsonb_array_elements(context) with ordinality x(value,n) where n<=greatest(0,jsonb_array_length(context)-6);
  if p_action='context_summary' then
   if p_payload->>'fingerprint'=requested_text and p_payload->>'version'='extractive-v1' and char_length(p_payload->>'text') between 1 and 3000 then
    update feedx_integrations.native_assistant_sessions set context_summary=jsonb_build_object('version','extractive-v1','fingerprint',requested_text,'text',p_payload->>'text') where id=sid;
   end if;
   return '{}'::jsonb;
  end if;
  return jsonb_build_object('context',context,'fingerprint',requested_text,'summary',s.context_summary);
 end if;
 if p_action='session_check' then$body$);
 old:='if p_action=''session_delete'' then';
 if strpos(def,old)=0 then raise exception 'Assistant deletion changed'; end if;
 def:=replace(def,old,old||' update feedx_integrations.native_assistant_sessions set context_summary=null where id=sid;');
 old:='reply=case when p_payload->>''error_code'' is null then p_payload->>''reply'' else null end,error_code=';
 if strpos(def,old)=0 then raise exception 'Assistant settlement changed'; end if;
 def:=replace(def,old,'context_usage=p_payload->''context_usage'', '||old);
 old:='q.voice_input_available,';
 if strpos(def,old)=0 then raise exception 'Assistant history changed'; end if;
 def:=replace(def,old,'q.voice_input_available,q.input_tokens,q.output_tokens,q.latency_ms,q.model,q.context_usage,');
 old:='''thread_title'',(select title from feedx_integrations.native_assistant_sessions where id=sid))';
 if strpos(def,old)=0 then raise exception 'Assistant usage projection changed'; end if;
 def:=replace(def,old,'''thread_title'',(select title from feedx_integrations.native_assistant_sessions where id=sid),''created_at'',t.created_at,''finished_at'',t.finished_at,''context_usage'',t.context_usage,''model'',t.model)');
 -- Hold a conservative input/tool-continuation allowance, reconciled only to measured usage.
 -- The existing 100,000/day ceiling and request/concurrency limits are unchanged.
 old:='  if coalesce((select sum(case when state=';
 if strpos(def,old)=0 then raise exception 'Assistant token reservation changed'; end if;
 def:=replace(def,old,'  reserve:=greatest(reserve,24000);'||chr(10)||old);
 execute def;
end $migration$;
