set local lock_timeout='3s';
-- Keep the existing thread IDs, turn ordering, evidence and evaluation ledger.
alter table feedx_integrations.native_assistant_sessions
 add column title text check (char_length(title) between 1 and 80),
 add column title_manual boolean not null default false,
 add column last_activity_at timestamptz not null default now(),
 add column deleted_at timestamptz;
alter table feedx_integrations.native_assistant_sessions alter column expires_at set default 'infinity'::timestamptz;

create function feedx_integrations.assistant_title(prompt text)
returns text language sql immutable set search_path=pg_catalog as $$
 select case when char_length(clean) >= 4
  and clean !~* '^(yes[ ,.，。]+)?(hi|hey|hello|thanks|thank you|okay|你好|您好|谢谢)[ !?.。！]*$'
  and clean !~* '(password|api[ _-]?key|secret|token|bearer|sk-[[:alnum:]]|密码|密钥)'
  then left(clean,72) end
 from (select btrim(regexp_replace(prompt,'[[:space:]]+',' ','g')) as clean) t
$$;
revoke all on function feedx_integrations.assistant_title(text) from public,anon,authenticated;

update feedx_integrations.native_assistant_sessions s set expires_at='infinity',
 last_activity_at=coalesce((select greatest(max(r.created_at),max(r.finished_at)) from feedx_integrations.native_assistant_requests r where r.session_id=s.id),s.created_at),
 title=(select feedx_integrations.assistant_title(r.prompt) from feedx_integrations.native_assistant_requests r
  where r.session_id=s.id and r.kind='turn' and r.voice_input_available and feedx_integrations.assistant_title(r.prompt) is not null order by r.seq limit 1);
create index native_assistant_thread_activity on feedx_integrations.native_assistant_sessions(user_id,last_activity_at desc,id desc) where deleted_at is null;

create function feedx_integrations.assistant_thread_activity()
returns trigger language plpgsql set search_path=pg_catalog,feedx_integrations as $$
begin
 if new.error_code='request_timeout' then return new; end if;
 -- The first reply does not wait on a second model call. Derive a title on turn settlement.
 update feedx_integrations.native_assistant_sessions set last_activity_at=clock_timestamp(),
  title=case when not title_manual and title is null and new.voice_input_available
   and new.state not in ('pending','running') then feedx_integrations.assistant_title(new.prompt) else title end
 where id=new.session_id and user_id=new.user_id and deleted_at is null;
 return new;
end $$;
revoke all on function feedx_integrations.assistant_thread_activity() from public,anon,authenticated;
create trigger assistant_thread_activity after insert or update of state,prompt,reply on feedx_integrations.native_assistant_requests
 for each row when (new.session_id is not null and new.kind='turn') execute function feedx_integrations.assistant_thread_activity();

-- Only curated preferences are stored. No arbitrary text, snapshots, credentials or tenant data.
create table feedx_integrations.native_assistant_memory (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 language text check (language in ('english','mandarin','malay','mixed')),
 reply_style text check (reply_style in ('concise','detailed','steps')),
 work_preference text check (work_preference in ('exceptions_first','sources_first','next_steps')),
 updated_at timestamptz not null default now()
);
alter table feedx_integrations.native_assistant_memory enable row level security;
revoke all on feedx_integrations.native_assistant_memory from public,anon,authenticated;

-- Amend the existing authority, retaining its applied budget and voice-history patches.
do $migration$
declare def text := pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure);
 old text; start_at integer; end_at integer;
begin
 old := 'access_scope text; actor_email';
 if strpos(def,old)=0 then raise exception 'Native Assistant authority signature changed'; end if;
 def:=replace(def,old,'page_time timestamptz; page_id uuid; has_more boolean; title_text text; access_scope text; actor_email');

 old := ' if p_action in (''configure'',''test_record'',''features'',''voice_test_record'') then';
 if strpos(def,old)=0 then raise exception 'Native Assistant authorization changed'; end if;
 def:=replace(def,old,$body$
 if p_action in ('memory_get','memory_save','memory_delete') then
  if p_action='memory_delete' then
   delete from feedx_integrations.native_assistant_memory where user_id=p_actor;
  elsif p_action='memory_save' then
   if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean'
    or coalesce(p_payload->>'language','english') not in ('english','mandarin','malay','mixed')
    or coalesce(p_payload->>'reply_style','concise') not in ('concise','detailed','steps')
    or coalesce(p_payload->>'work_preference','exceptions_first') not in ('exceptions_first','sources_first','next_steps') then
    raise exception 'memory_invalid' using errcode='22023';
   end if;
   insert into feedx_integrations.native_assistant_memory(user_id,enabled,language,reply_style,work_preference)
    values(p_actor,(p_payload->>'enabled')::boolean,p_payload->>'language',p_payload->>'reply_style',p_payload->>'work_preference')
   on conflict(user_id) do update set enabled=excluded.enabled,language=excluded.language,reply_style=excluded.reply_style,work_preference=excluded.work_preference,updated_at=now();
  end if;
  select to_jsonb(m)-'user_id' into result from feedx_integrations.native_assistant_memory m where m.user_id=p_actor;
  return jsonb_build_object('memory',coalesce(result,'{"enabled":false}'::jsonb));
 end if;
 if p_action='storage_usage' then
  select jsonb_build_object('turns',count(*),'content_bytes',coalesce(sum(octet_length(q.prompt)+coalesce(octet_length(q.reply),0)),0),
   'evidence_bytes',coalesce(sum(octet_length(q.evidence::text)),0)) into result
  from feedx_integrations.native_assistant_requests q join feedx_integrations.native_assistant_sessions ns on ns.id=q.session_id and ns.user_id=q.user_id
  where q.user_id=p_actor and q.kind='turn' and ns.deleted_at is null and (ns.scope_key is null or ns.scope_key=access_scope);
  return result;
 end if;
 if p_action in ('configure','test_record','features','voice_test_record') then$body$);

 start_at:=strpos(def,' if p_action=''session_list'' then');
 end_at:=strpos(def,' if p_action<>''test_begin''');
 old:=case when start_at>0 and end_at>start_at then substring(def from start_at for end_at-start_at+char_length(' if p_action<>''test_begin''')) end;
 if old is null then raise exception 'Native Assistant thread contract changed'; end if;
 def:=replace(def,old,$body$ if p_action='session_list' then
  page_time:=(p_payload->>'before_activity')::timestamptz;
  page_id:=(p_payload->>'before_id')::uuid;
  select count(*)>20,coalesce(jsonb_agg(to_jsonb(x)-'page_row' order by x.last_activity_at desc,x.id desc) filter(where x.page_row<=20),'[]'::jsonb)
   into has_more,result from (
    select ns.id,ns.created_at,ns.last_activity_at,coalesce(ns.title,'New conversation') as title,
     row_number() over(order by ns.last_activity_at desc,ns.id desc) as page_row
    from feedx_integrations.native_assistant_sessions ns
    where ns.user_id=p_actor and ns.deleted_at is null and ns.expires_at>now()
     and (ns.scope_key is null or ns.scope_key=access_scope)
     and (page_id is null or (ns.last_activity_at,ns.id)<(page_time,page_id))
     and (coalesce(p_payload->>'query','')='' or strpos(lower(coalesce(ns.title,'New conversation')),lower(p_payload->>'query'))>0)
    order by ns.last_activity_at desc,ns.id desc limit 21
   ) x;
  return jsonb_build_object('sessions',result,'has_more',has_more);
 end if;
 if p_action='session_new' then
  perform pg_advisory_xact_lock(hashtextextended('native-assistant-user:'||p_actor::text,0));
  if (select count(*) from feedx_integrations.native_assistant_sessions where user_id=p_actor and created_at>now()-interval '24 hours')>=20
   then raise exception 'session_limit' using errcode='54000'; end if;
  if (select count(*) from feedx_integrations.native_assistant_sessions where user_id=p_actor and deleted_at is null)>=200
   then raise exception 'thread_capacity' using errcode='54000'; end if;
  insert into feedx_integrations.native_assistant_sessions(user_id,scope_key) values(p_actor,access_scope) returning * into s;
  return jsonb_build_object('session_id',s.id,'messages','[]'::jsonb);
 end if;
 if p_action<>'test_begin'$body$);

 old:=' if p_action=''voice_begin'' then';
 if strpos(def,old)=0 then raise exception 'Native Assistant scope contract changed'; end if;
 def:=replace(def,old,$body$
 if p_action='session_check' then return '{}'::jsonb; end if;
 if p_action='session_context' then
  select coalesce(jsonb_agg(to_jsonb(x)-'seq' order by x.seq),'[]'::jsonb) into context from (
   select q.seq,q.prompt,case when q.evidence is null then q.reply end as reply,q.evidence is not null as has_evidence
   from feedx_integrations.native_assistant_requests q where q.session_id=sid and q.user_id=p_actor and q.kind='turn'
    and q.state='completed' and q.voice_input_available order by q.seq desc limit 6
  ) x;
  return jsonb_build_object('context',context);
 end if;
 if p_action='session_voice_check' then
  if exists(select 1 from feedx_integrations.native_assistant_requests where session_id=sid and state in ('pending','running') and lease_expires_at>now())
   then raise exception 'assistant_busy' using errcode='55000'; end if;
  return '{}'::jsonb;
 end if;
 if p_action='session_rename' then
  title_text:=btrim(regexp_replace(p_payload->>'title','[[:space:]]+',' ','g'));
  if title_text is null or char_length(title_text) not between 1 and 80 then raise exception 'title_invalid' using errcode='22023'; end if;
  update feedx_integrations.native_assistant_sessions set title=title_text,title_manual=true where id=sid;
  return jsonb_build_object('id',sid,'title',title_text);
 end if;
 if p_action='session_delete' then
  if exists(select 1 from feedx_integrations.native_assistant_requests where session_id=sid and state in ('pending','running') and lease_expires_at>now())
   or exists(select 1 from feedx_integrations.native_assistant_realtime_reservations where actor=p_actor and session_id=sid and ended_at is null and created_at>now()-interval '4 minutes')
   then raise exception 'assistant_busy' using errcode='55000'; end if;
  -- Tombstone blocks all old and new access paths while retaining evidence and budget records.
  update feedx_integrations.native_assistant_sessions set deleted_at=now(),expires_at='-infinity',title=null where id=sid;
  update feedx_integrations.native_assistant_requests set prompt='[Deleted conversation]',reply=null
   where session_id=sid and user_id=p_actor and kind='turn';
  return jsonb_build_object('deleted',true);
 end if;
 if p_action='voice_begin' then$body$);

 start_at:=strpos(def,' if p_action=''history'' then');
 end_at:=strpos(def,' if p_action in (''begin'',''test_begin'') then');
 old:=case when start_at>0 and end_at>start_at then substring(def from start_at for end_at-start_at+char_length(' if p_action in (''begin'',''test_begin'') then')) end;
 if old is null then raise exception 'Native Assistant message projection changed'; end if;
 def:=replace(def,old,$body$ if p_action='history' then
  update feedx_integrations.native_assistant_requests set state='failed',error_code='request_timeout',finished_at=now()
   where session_id=sid and user_id=p_actor and state in ('pending','running') and lease_expires_at<=now();
  select count(*)>20,coalesce(jsonb_agg(to_jsonb(x)-'page_row' order by x.seq) filter(where x.page_row<=20),'[]'::jsonb)
   into has_more,result from (
    select q.id,q.request_id,q.seq,q.prompt,q.reply,q.state,q.error_code,q.evidence,q.tool_state,q.voice_input_available,
      (q.voice_lease_id is not null) as voice,q.created_at,q.finished_at,row_number() over(order by q.seq desc) as page_row
    from feedx_integrations.native_assistant_requests q where q.session_id=sid and q.user_id=p_actor and q.kind='turn'
      and (p_payload->>'before_seq' is null or q.seq<(p_payload->>'before_seq')::bigint)
    order by q.seq desc limit 21
   ) x;
  return jsonb_build_object('session_id',s.id,'title',coalesce(s.title,'New conversation'),'turns',result,'has_more',has_more);
 end if;
 if p_action='begin' and exists(select 1 from feedx_integrations.native_assistant_realtime_reservations
  where actor=p_actor and session_id=sid and ended_at is null and created_at>now()-interval '4 minutes')
  then raise exception 'assistant_busy' using errcode='55000'; end if;
 if p_action in ('begin','test_begin') then$body$);

 old:='where session_id=sid)>=40';
 if strpos(def,old)=0 then raise exception 'Native Assistant turn limit changed'; end if;
 def:=replace(def,old,'where session_id=sid)>=200');
 old:='select prompt,reply,seq,evidence from feedx_integrations.native_assistant_requests where session_id=sid and state=''completed'' and seq<t.seq';
 if strpos(def,old)=0 then raise exception 'Native Assistant context projection changed'; end if;
 def:=replace(def,old,'select prompt,case when evidence is null then reply end as reply,seq,evidence from feedx_integrations.native_assistant_requests where session_id=sid and user_id=p_actor and kind=''turn'' and voice_input_available and state=''completed'' and seq<t.seq');
 old:='''latency_ms'',t.latency_ms)';
 if strpos(def,old)=0 then raise exception 'Native Assistant finish contract changed'; end if;
 execute replace(def,old,'''latency_ms'',t.latency_ms,''thread_title'',(select title from feedx_integrations.native_assistant_sessions where id=sid))');

 -- Keep the same scoped lock, without hydrating a message page on each voice event.
 def:=pg_get_functiondef('public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text)'::regprocedure);
 old:='public.native_assistant_service(p_actor,''history'',jsonb_build_object(''session_id'',p_session))';
 if strpos(def,old)=0 then raise exception 'Native Assistant reservation scope changed'; end if;
 execute replace(def,old,'public.native_assistant_service(p_actor,case when p_action in (''start'',''sdk_baseline'') then ''session_voice_check'' else ''session_check'' end,jsonb_build_object(''session_id'',p_session))');

 def:=pg_get_functiondef('public.native_assistant_voice_history(uuid,jsonb)'::regprocedure);
 old:='public.native_assistant_service(p_actor,''history'',jsonb_build_object(''session_id'',sid))';
 if strpos(def,old)=0 or strpos(def,'where session_id=sid)>=40')=0 then raise exception 'Native Assistant voice history changed'; end if;
 def:=replace(replace(def,old,'public.native_assistant_service(p_actor,''session_check'',jsonb_build_object(''session_id'',sid))'),'where session_id=sid)>=40','where session_id=sid)>=200');
 old:='''voice_input_available'',item.voice_input_available)';
 if strpos(def,old)=0 then raise exception 'Native Assistant voice result contract changed'; end if;
 execute replace(def,old,'''voice_input_available'',item.voice_input_available,''thread_title'',(select title from feedx_integrations.native_assistant_sessions where id=sid))');
end $migration$;
