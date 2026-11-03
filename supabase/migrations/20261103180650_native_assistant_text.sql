-- Native Assistant Phase 1A: user-owned text sessions; no tools/business authority.
create table feedx_integrations.native_assistant_config (
 singleton boolean primary key default true check(singleton), provider text not null default 'openai' check(provider='openai'),
 model text not null default 'gpt-4o-mini' check(model in ('gpt-4o-mini','gpt-4.1-mini')),
 credential_ref text not null default 'native-assistant-openai' check(credential_ref='native-assistant-openai'),
 enabled boolean not null default false, revision bigint not null default 1, provider_revision bigint not null default 1,
 last_test_at timestamptz, last_test_outcome text, last_test_error text, last_success_at timestamptz, tested_provider_revision bigint,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);
insert into feedx_integrations.native_assistant_config(singleton) values(true);
create table feedx_integrations.native_assistant_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours'
);
create index native_assistant_sessions_owner on feedx_integrations.native_assistant_sessions(user_id,created_at desc);
create table feedx_integrations.native_assistant_requests (
 id uuid primary key default gen_random_uuid(), seq bigint generated always as identity,
 user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 session_id uuid references feedx_integrations.native_assistant_sessions(id) on delete cascade,
 kind text not null check(kind in ('turn','test')), prompt text not null check(char_length(prompt) between 1 and 2000),
 reply text check(char_length(reply)<=3000), state text not null default 'pending' check(state in ('pending','running','completed','failed','cancelled')),
 provider_revision bigint not null, model text not null, reserved_tokens integer not null check(reserved_tokens>0),
 lease_id uuid, lease_expires_at timestamptz not null default now()+interval '45 seconds',
 created_at timestamptz not null default now(), finished_at timestamptz,
 input_tokens integer, output_tokens integer, latency_ms integer, error_code text,
 unique(user_id,request_id), check((kind='turn')=(session_id is not null))
);
create index native_assistant_requests_history on feedx_integrations.native_assistant_requests(session_id,seq desc);
create index native_assistant_requests_budget on feedx_integrations.native_assistant_requests(created_at,state);
alter table feedx_integrations.native_assistant_config enable row level security;
alter table feedx_integrations.native_assistant_sessions enable row level security;
alter table feedx_integrations.native_assistant_requests enable row level security;
revoke all on feedx_integrations.native_assistant_config,feedx_integrations.native_assistant_sessions,feedx_integrations.native_assistant_requests from public,anon,authenticated;

-- Only the reviewed Edge service may call this dispatcher. p_actor comes from
-- Auth getUser(), never request JSON. Canonical Admin/RBAC is rechecked per call.
create or replace function public.native_assistant_service(p_actor uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare
 c feedx_integrations.native_assistant_config%rowtype;
 s feedx_integrations.native_assistant_sessions%rowtype;
 t feedx_integrations.native_assistant_requests%rowtype;
 actor_email text; role_id uuid; sid uuid; rid uuid; result jsonb; context jsonb; requested_text text;
 can_view boolean; can_edit boolean; desired_enabled boolean; changed boolean; reserve integer; lease uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501'; end if;
 if p_actor is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 then raise exception 'invalid_request' using errcode='22023'; end if;
 select email into actor_email from auth.users where id=p_actor;
 if not found then raise exception 'admin_required' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated','email',actor_email)::text,true);
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 role_id:=public.current_user_role_id();
 if role_id is null then raise exception 'admin_required' using errcode='42501'; end if;
 can_view:=public.current_user_has_permission('roles.view'); can_edit:=can_view and public.current_user_has_permission('roles.edit');
 if p_action in ('configure','test_record') then
  select * into c from feedx_integrations.native_assistant_config where singleton for update;
 else
  select * into c from feedx_integrations.native_assistant_config where singleton for share;
 end if;
 if p_action in ('configuration','configure','test_record','test_begin') and not can_view then raise exception 'settings_view_required' using errcode='42501'; end if;
 if p_action in ('configure','test_record','test_begin') and not can_edit then raise exception 'settings_edit_required' using errcode='42501'; end if;
 if p_action in ('configuration','status') then
  return jsonb_build_object('config',to_jsonb(c)-'updated_by','can_edit',can_edit);
 end if;
 if p_action='configure' then
  perform pg_advisory_xact_lock(hashtextextended('native-assistant-config',0));
  select * into c from feedx_integrations.native_assistant_config where singleton for update;
  if (p_payload->>'expected_revision')::bigint is distinct from c.revision then raise exception 'configuration_changed' using errcode='40001'; end if;
  if p_payload->>'provider' is distinct from 'openai' or coalesce(p_payload->>'model','') not in ('gpt-4o-mini','gpt-4.1-mini') or p_payload->>'credential_ref' is distinct from 'native-assistant-openai' then raise exception 'configuration_invalid' using errcode='22023'; end if;
  desired_enabled:=coalesce((p_payload->>'enabled')::boolean,false);
  changed:=c.model is distinct from p_payload->>'model' or c.provider is distinct from p_payload->>'provider' or c.credential_ref is distinct from p_payload->>'credential_ref';
  if desired_enabled and (changed or c.tested_provider_revision is distinct from c.provider_revision) then raise exception 'connection_test_required' using errcode='55000'; end if;
  update feedx_integrations.native_assistant_config set model=p_payload->>'model',provider=p_payload->>'provider',credential_ref=p_payload->>'credential_ref',enabled=desired_enabled,
   revision=revision+1,provider_revision=provider_revision+case when changed then 1 else 0 end,updated_by=p_actor,updated_at=now(),
   tested_provider_revision=case when changed then null else tested_provider_revision end where singleton returning * into c;
  return jsonb_build_object('config',to_jsonb(c)-'updated_by','can_edit',can_edit);
 end if;
 if p_action='test_record' then
  if (p_payload->>'provider_revision')::bigint is distinct from c.provider_revision then raise exception 'configuration_changed' using errcode='40001'; end if;
  if coalesce(p_payload->>'outcome','') not in ('verified','unavailable','failed') then raise exception 'invalid_request' using errcode='22023'; end if;
  if p_payload->>'outcome'='verified' and not exists(select 1 from feedx_integrations.native_assistant_requests where id=(p_payload->>'turn_id')::uuid and user_id=p_actor and kind='test' and state='completed' and provider_revision=c.provider_revision) then raise exception 'test_evidence_required' using errcode='42501'; end if;
  update feedx_integrations.native_assistant_config set last_test_at=now(),last_test_outcome=p_payload->>'outcome',last_test_error=left(p_payload->>'error_code',80),
   last_success_at=case when p_payload->>'outcome'='verified' then now() else last_success_at end,
   tested_provider_revision=case when p_payload->>'outcome'='verified' then provider_revision else tested_provider_revision end where singleton;
  return jsonb_build_object('recorded',true);
 end if;
 if p_action='session_list' then
  select coalesce(jsonb_agg(x),'[]'::jsonb) into result from (
   select s.id,s.created_at,coalesce((select left(q.prompt,60) from feedx_integrations.native_assistant_requests q where q.session_id=s.id and q.kind='turn' order by q.seq limit 1),'New conversation') as title
   from feedx_integrations.native_assistant_sessions s where s.user_id=p_actor and s.expires_at>now() order by s.created_at desc limit 6) x;
  return jsonb_build_object('sessions',result);
 end if;
 if p_action='session_new' then
  perform pg_advisory_xact_lock(hashtextextended('native-assistant-user:'||p_actor::text,0));
  delete from feedx_integrations.native_assistant_sessions where user_id=p_actor and expires_at<now()-interval '7 days';
  if (select count(*) from feedx_integrations.native_assistant_sessions where user_id=p_actor and expires_at>now())>=20 then raise exception 'session_limit' using errcode='54000'; end if;
  insert into feedx_integrations.native_assistant_sessions(user_id) values(p_actor) returning * into s;
  return jsonb_build_object('session_id',s.id,'messages','[]'::jsonb);
 end if;
 if p_action<>'test_begin' and not (p_action in ('claim','finish','cancel','turn_status') and p_payload->>'session_id' is null) then
  sid:=(p_payload->>'session_id')::uuid;
  select * into s from feedx_integrations.native_assistant_sessions where id=sid and user_id=p_actor and expires_at>now() for update;
  if not found then raise exception 'session_unavailable' using errcode='42501'; end if;
 end if;
 if p_action='history' then
  update feedx_integrations.native_assistant_requests set state='failed',error_code='request_timeout',finished_at=now() where session_id=s.id and state in ('pending','running') and lease_expires_at<=now();
  select coalesce(jsonb_agg(x order by x.seq),'[]'::jsonb) into result from (
   select id,request_id,seq,prompt,reply,state,error_code from feedx_integrations.native_assistant_requests where session_id=s.id and kind='turn' order by seq desc limit 20) x;
  return jsonb_build_object('session_id',s.id,'turns',result);
 end if;
 if p_action in ('begin','test_begin') then
  rid:=(p_payload->>'request_id')::uuid;
  requested_text:=case when p_action='test_begin' then 'Reply with READY.' else btrim(p_payload->>'text') end;
  if rid is null or requested_text is null or char_length(requested_text) not between 1 and 2000 then raise exception 'invalid_request' using errcode='22023'; end if;
  if p_action='begin' and not c.enabled then raise exception 'assistant_disabled' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('native-assistant-budget',0));
  select * into t from feedx_integrations.native_assistant_requests where user_id=p_actor and request_id=rid;
  if found then
   if t.session_id is distinct from sid or t.prompt is distinct from requested_text or t.kind is distinct from (case when p_action='test_begin' then 'test' else 'turn' end) then raise exception 'request_conflict' using errcode='40001'; end if;
   return jsonb_build_object('turn_id',t.id,'state',t.state,'replayed',true);
  end if;
  update feedx_integrations.native_assistant_requests set state='failed',error_code='request_timeout',finished_at=now() where state in ('pending','running') and lease_expires_at<=now();
  if (select count(*) from feedx_integrations.native_assistant_requests where created_at>now()-interval '1 minute')>=12 or (select count(*) from feedx_integrations.native_assistant_requests where user_id=p_actor and created_at>now()-interval '1 minute')>=6 then raise exception 'request_rate_limit' using errcode='54000'; end if;
  if (select count(*) from feedx_integrations.native_assistant_requests where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=100 then raise exception 'daily_request_limit' using errcode='54000'; end if;
  if (select count(*) from feedx_integrations.native_assistant_requests where state in ('pending','running') and lease_expires_at>now())>=2 or exists(select 1 from feedx_integrations.native_assistant_requests where session_id=sid and state in ('pending','running')) then raise exception 'assistant_busy' using errcode='55000'; end if;
  if p_action='begin' and (select count(*) from feedx_integrations.native_assistant_requests where session_id=sid)>=40 then raise exception 'conversation_limit' using errcode='54000'; end if;
  select least(24000,coalesce(sum(octet_length(q.prompt)+octet_length(coalesce(q.reply,''))),0))::integer+octet_length(requested_text)+2548 into reserve
   from (select prompt,reply from feedx_integrations.native_assistant_requests where session_id=sid and state='completed' order by seq desc limit 6) q;
  if coalesce((select sum(reserved_tokens) from feedx_integrations.native_assistant_requests where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0)+reserve>100000 then raise exception 'daily_token_budget' using errcode='54000'; end if;
  insert into feedx_integrations.native_assistant_requests(user_id,request_id,session_id,kind,prompt,provider_revision,model,reserved_tokens)
   values(p_actor,rid,sid,case when p_action='test_begin' then 'test' else 'turn' end,requested_text,c.provider_revision,c.model,reserve) returning * into t;
  return jsonb_build_object('turn_id',t.id,'state',t.state,'replayed',false);
 end if;
 if p_action in ('claim','finish','cancel','turn_status') then
  select * into t from feedx_integrations.native_assistant_requests where id=(p_payload->>'turn_id')::uuid and user_id=p_actor and session_id is not distinct from sid for update;
  if not found then raise exception 'turn_unavailable' using errcode='42501'; end if;
  if t.kind='test' and not can_edit then raise exception 'settings_edit_required' using errcode='42501'; end if;
  if t.state in ('pending','running') and t.lease_expires_at<=now() then update feedx_integrations.native_assistant_requests set state='failed',error_code='request_timeout',finished_at=now() where id=t.id returning * into t; end if;
  if p_action='cancel' then
   if t.state in ('pending','running') then
    update feedx_integrations.native_assistant_requests set state='cancelled',finished_at=now(),error_code='cancelled' where id=t.id returning * into t;
   end if;
   return jsonb_build_object('state',t.state);
  elsif p_action='turn_status' then return jsonb_build_object('state',t.state,'reply',t.reply,'error_code',t.error_code,'turn_id',t.id);
  elsif p_action='claim' then
   if t.kind='test' and not can_edit then raise exception 'settings_edit_required' using errcode='42501'; end if;
   if t.state<>'pending' then return jsonb_build_object('state',t.state,'reply',t.reply,'error_code',t.error_code,'turn_id',t.id); end if;
   if t.provider_revision<>c.provider_revision or (t.kind='turn' and not c.enabled) then raise exception 'configuration_changed' using errcode='40001'; end if;
   lease:=gen_random_uuid(); update feedx_integrations.native_assistant_requests set state='running',lease_id=lease where id=t.id;
   select coalesce(jsonb_agg(jsonb_build_object('prompt',x.prompt,'reply',x.reply) order by x.seq),'[]'::jsonb) into context from (
    select prompt,reply,seq from feedx_integrations.native_assistant_requests where session_id=sid and state='completed' and seq<t.seq order by seq desc limit 6) x;
   return jsonb_build_object('state','running','lease_id',lease,'turn_id',t.id,'prompt',t.prompt,'kind',t.kind,'model',t.model,'context',context,'provider_revision',t.provider_revision);
  else
   if t.state<>'running' or t.lease_id is distinct from (p_payload->>'lease_id')::uuid then raise exception 'turn_no_longer_active' using errcode='40001'; end if;
   if t.provider_revision<>c.provider_revision or (t.kind='turn' and not c.enabled) then raise exception 'configuration_changed' using errcode='40001'; end if;
   if p_payload->>'error_code' is null and (p_payload->>'reply' is null or char_length(p_payload->>'reply') not between 1 and 3000) then raise exception 'invalid_provider_reply' using errcode='22023'; end if;
   update feedx_integrations.native_assistant_requests set state=case when p_payload->>'error_code' is null then 'completed' else 'failed' end,
    reply=case when p_payload->>'error_code' is null then p_payload->>'reply' else null end,error_code=left(p_payload->>'error_code',80),finished_at=now(),
    input_tokens=case when p_payload->>'input_tokens' is null then null else greatest(0,least(1000000,(p_payload->>'input_tokens')::integer)) end,output_tokens=case when p_payload->>'output_tokens' is null then null else greatest(0,least(1000000,(p_payload->>'output_tokens')::integer)) end,latency_ms=case when p_payload->>'latency_ms' is null then null else greatest(0,least(60000,(p_payload->>'latency_ms')::integer)) end where id=t.id returning * into t;
   return jsonb_build_object('state',t.state,'reply',t.reply,'error_code',t.error_code,'turn_id',t.id,'input_tokens',t.input_tokens,'output_tokens',t.output_tokens,'latency_ms',t.latency_ms);
  end if;
 end if;
 raise exception 'unsupported_action' using errcode='22023';
end $$;
revoke all on function public.native_assistant_service(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.native_assistant_service(uuid,text,jsonb) to service_role;
