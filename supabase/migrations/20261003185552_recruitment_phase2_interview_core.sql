-- Phase 2 interview state is owned by Recruitment. Realtime provider state is replaceable.
alter table public.recruitment_interview_attempts drop constraint recruitment_interview_attempts_status_check;
alter table public.recruitment_interview_attempts add constraint recruitment_interview_attempts_status_check
  check(status in ('invited','profile_confirmed','consented','ready','starting','interviewing','interrupted','finalizing','completed','partial','failed'));
alter table public.recruitment_interview_attempts
  add column interview_started_at timestamptz,
  add column interview_ended_at timestamptz,
  add column max_ends_at timestamptz,
  add column lease_owner uuid,
  add column lease_expires_at timestamptz,
  add column provider_generation integer not null default 0 check(provider_generation>=0),
  add column provider_reconnects integer not null default 0 check(provider_reconnects>=0),
  add column provider_requested_at timestamptz,
  add column provider_connected_at timestamptz,
  add column last_heartbeat_at timestamptz;

create table public.recruitment_transcript_turns (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.recruitment_interview_attempts(id) on delete restrict,
  turn_number integer not null check(turn_number>0),
  provider_generation integer not null check(provider_generation>0),
  provider_item_id text not null check(length(provider_item_id) between 3 and 200),
  speaker text not null check(speaker in ('candidate','ai')),
  transcript text not null check(length(btrim(transcript)) between 1 and 12000),
  elapsed_start_ms integer check(elapsed_start_ms>=0),
  elapsed_end_ms integer check(elapsed_end_ms>=0),
  received_at timestamptz not null default clock_timestamp(),
  source text not null default 'provider_event_relay' check(source='provider_event_relay'),
  unique(attempt_id,turn_number),
  unique(attempt_id,provider_generation,provider_item_id,speaker),
  check(elapsed_end_ms is null or elapsed_start_ms is null or elapsed_end_ms>=elapsed_start_ms)
);
create index recruitment_turns_attempt_order_idx on public.recruitment_transcript_turns(attempt_id,turn_number);
create trigger recruitment_turn_immutable before update or delete on public.recruitment_transcript_turns
  for each row execute function public.recruitment_immutable_evidence();

create table public.recruitment_topic_coverage (
  attempt_id uuid not null references public.recruitment_interview_attempts(id) on delete restrict,
  topic_index integer not null check(topic_index>=0),
  topic text not null,
  state text not null default 'unresolved' check(state in ('unresolved','covered')),
  evidence_turn_id bigint references public.recruitment_transcript_turns(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(attempt_id,topic_index),
  check((state='unresolved' and evidence_turn_id is null) or (state='covered' and evidence_turn_id is not null))
);
create table public.recruitment_scenario_progress (
  attempt_id uuid not null references public.recruitment_interview_attempts(id) on delete restrict,
  scenario_index integer not null check(scenario_index>=0),
  brief text not null,
  state text not null default 'pending' check(state in ('pending','asked','answered')),
  evidence_turn_id bigint references public.recruitment_transcript_turns(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(attempt_id,scenario_index)
);

alter table public.recruitment_transcript_turns enable row level security;
alter table public.recruitment_topic_coverage enable row level security;
alter table public.recruitment_scenario_progress enable row level security;
revoke all on public.recruitment_transcript_turns,public.recruitment_topic_coverage,public.recruitment_scenario_progress from public,anon,authenticated;

create function public.recruitment_public_begin(p_token text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_config public.recruitment_interview_configs%rowtype; v_expiry timestamptz; v_now timestamptz:=clock_timestamp();
begin
  if p_client_id is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.status not in ('ready','starting','interviewing','interrupted','finalizing') or not exists(select 1 from public.recruitment_consents where attempt_id=v_attempt.id) then
    raise exception using errcode='55000',message='Interview is not ready to start.';
  end if;
  if v_attempt.lease_expires_at>v_now and v_attempt.lease_owner is distinct from p_client_id then
    raise exception using errcode='55P03',message='Interview is already open on another device.';
  end if;
  select * into v_config from public.recruitment_interview_configs where id=v_attempt.config_version_id;
  select expires_at into v_expiry from public.recruitment_invitations where id=v_attempt.invitation_id;
  if v_attempt.interview_started_at is null then
    if v_expiry < v_now+make_interval(mins=>v_config.max_minutes+10) then
      raise exception using errcode='22023',message='Interview link expires too soon. Ask for a new link.';
    end if;
    update public.recruitment_interview_attempts set status='starting',interview_started_at=v_now,max_ends_at=v_now+make_interval(mins=>v_config.max_minutes),lease_owner=p_client_id,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
    insert into public.recruitment_topic_coverage(attempt_id,topic_index,topic)
      select v_attempt.id,(ord-1)::integer,value#>>'{}' from jsonb_array_elements(v_config.required_topics) with ordinality as x(value,ord);
    insert into public.recruitment_scenario_progress(attempt_id,scenario_index,brief)
      select v_attempt.id,(ord-1)::integer,value#>>'{}' from jsonb_array_elements(v_config.scenario_briefs) with ordinality as x(value,ord);
    insert into public.recruitment_events(opening_id,application_id,attempt_id,action) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'interview_started');
  else
    if v_attempt.max_ends_at<=v_now then update public.recruitment_interview_attempts set status='finalizing',interview_ended_at=coalesce(interview_ended_at,v_attempt.max_ends_at),completion_reason=coalesce(completion_reason,'max_duration') where id=v_attempt.id; end if;
    update public.recruitment_interview_attempts set status=case when status='finalizing' then status when status='interrupted' or lease_expires_at<=v_now then 'starting' else status end,lease_owner=p_client_id,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
    if v_attempt.status='interrupted' or v_attempt.lease_expires_at<=v_now then
      insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'interview_resumed',jsonb_build_object('prior_heartbeat_at',v_attempt.last_heartbeat_at,'lease_gap',v_attempt.lease_expires_at<=v_now));
    end if;
  end if;
  return jsonb_build_object('status',(select status from public.recruitment_interview_attempts where id=v_attempt.id),'started_at',(select interview_started_at from public.recruitment_interview_attempts where id=v_attempt.id),'max_ends_at',(select max_ends_at from public.recruitment_interview_attempts where id=v_attempt.id));
end $$;

create function public.recruitment_public_heartbeat(p_token text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_client_id is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=v_now or v_attempt.status not in ('starting','interviewing','interrupted','finalizing') then
    raise exception using errcode='42501',message='Interview session is unavailable.';
  end if;
  update public.recruitment_interview_attempts set status=case when max_ends_at<=v_now then 'finalizing' else status end,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
  return jsonb_build_object('status',case when v_attempt.max_ends_at<=v_now then 'finalizing' else v_attempt.status end,'max_ends_at',v_attempt.max_ends_at);
end $$;

-- Called only by the Recruitment Edge Function after validating the candidate token.
create function public.recruitment_realtime_context(p_token text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_config public.recruitment_interview_configs%rowtype; v_now timestamptz:=clock_timestamp(); v_generation integer;
begin
  if p_client_id is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=v_now or v_attempt.max_ends_at<=v_now or v_attempt.status not in ('starting','interviewing','interrupted') then
    raise exception using errcode='42501',message='Interview session is unavailable.';
  end if;
  if v_attempt.provider_generation>=60 or (v_attempt.provider_requested_at is not null and v_attempt.provider_requested_at>v_now-interval '8 seconds') then
    raise exception using errcode='42901',message='Realtime reconnect limit reached. Please wait.';
  end if;
  if not exists(select 1 from public.recruitment_recording_units where attempt_id=v_attempt.id and status='capturing') then raise exception using errcode='55000',message='Recording must start before AI voice.'; end if;
  select * into v_config from public.recruitment_interview_configs where id=v_attempt.config_version_id;
  v_generation:=v_attempt.provider_generation+1;
  update public.recruitment_interview_attempts set provider_generation=v_generation,provider_reconnects=greatest(v_generation-1,0),provider_requested_at=v_now,provider_connected_at=null,status='starting' where id=v_attempt.id;
  if v_generation>1 then insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'provider_reconnect_requested',jsonb_build_object('generation',v_generation)); end if;
  return jsonb_build_object('attempt_id',v_attempt.id,'generation',v_generation,'started_at',v_attempt.interview_started_at,'max_ends_at',v_attempt.max_ends_at,'target_minutes',v_config.target_minutes,'required_topics',v_config.required_topics,'scenario_briefs',v_config.scenario_briefs,'language_guidance',v_config.language_guidance,'interview_instructions',v_config.interview_instructions,
    'turns',coalesce((select jsonb_agg(jsonb_build_object('speaker',t.speaker,'transcript',t.transcript,'turn_number',t.turn_number) order by t.turn_number) from (select * from public.recruitment_transcript_turns where attempt_id=v_attempt.id order by turn_number desc limit 40) t),'[]'::jsonb),
    'topics',coalesce((select jsonb_agg(jsonb_build_object('index',topic_index,'topic',topic,'state',state) order by topic_index) from public.recruitment_topic_coverage where attempt_id=v_attempt.id),'[]'::jsonb),
    'scenarios',coalesce((select jsonb_agg(jsonb_build_object('index',scenario_index,'brief',brief,'state',state) order by scenario_index) from public.recruitment_scenario_progress where attempt_id=v_attempt.id),'[]'::jsonb));
end $$;

create function public.recruitment_public_provider_connected(p_token text,p_client_id uuid,p_generation integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_client_id is null or p_generation is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=v_now or v_attempt.max_ends_at<=v_now or p_generation<>v_attempt.provider_generation or v_attempt.status not in ('starting','interviewing') then
    raise exception using errcode='42501',message='Interview session is unavailable.';
  end if;
  if v_attempt.provider_connected_at is null then
    update public.recruitment_interview_attempts set status='interviewing',provider_connected_at=v_now where id=v_attempt.id;
    insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'provider_connected',jsonb_build_object('generation',p_generation));
  end if;
  return jsonb_build_object('status','interviewing','generation',p_generation);
end $$;

create function public.recruitment_public_provider_disconnected(p_token text,p_client_id uuid,p_generation integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype;
begin
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if p_client_id is null or v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=clock_timestamp() or p_generation is distinct from v_attempt.provider_generation then raise exception using errcode='42501',message='Interview session is unavailable.'; end if;
  if v_attempt.status='interviewing' then
    update public.recruitment_interview_attempts set status='interrupted' where id=v_attempt.id;
    insert into public.recruitment_events(opening_id,application_id,attempt_id,action,details) values(v_attempt.opening_id,v_attempt.application_id,v_attempt.id,'provider_disconnected',jsonb_build_object('generation',p_generation));
  end if;
  return jsonb_build_object('status',(select status from public.recruitment_interview_attempts where id=v_attempt.id));
end $$;

create function public.recruitment_public_transcript_turn(p_token text,p_client_id uuid,p_generation integer,p_provider_order integer,p_item_id text,p_speaker text,p_transcript text,p_start_ms integer default null,p_end_ms integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_attempt public.recruitment_interview_attempts%rowtype; v_turn public.recruitment_transcript_turns%rowtype; v_number integer;
begin
  if p_client_id is null or p_generation is null then raise exception using errcode='22023',message='Interview session identifier is required.'; end if;
  v_attempt:=public.recruitment_public_attempt(p_token);
  if v_attempt.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into v_attempt from public.recruitment_interview_attempts where id=v_attempt.id for update;
  if v_attempt.lease_owner is distinct from p_client_id or v_attempt.lease_expires_at<=clock_timestamp() or v_attempt.status not in ('starting','interviewing','interrupted','finalizing') or p_generation<1 or p_generation>v_attempt.provider_generation then
    raise exception using errcode='42501',message='Interview session is unavailable.';
  end if;
  select * into v_turn from public.recruitment_transcript_turns where attempt_id=v_attempt.id and provider_generation=p_generation and provider_item_id=p_item_id and speaker=p_speaker;
  if v_turn.id is not null then
    if v_turn.transcript is distinct from btrim(p_transcript) then raise exception using errcode='55000',message='Finalized turn cannot change.'; end if;
    return jsonb_build_object('turn_number',v_turn.turn_number,'id',v_turn.id);
  end if;
  if p_provider_order is null or p_provider_order not between 1 and 9999 or length(btrim(coalesce(p_transcript,''))) not between 1 and 12000 or length(coalesce(p_item_id,'')) not between 3 and 200 or p_speaker not in ('candidate','ai') or p_start_ms<0 or p_end_ms<0 or p_end_ms<p_start_ms then
    raise exception using errcode='22023',message='Finalized turn is invalid.';
  end if;
  -- Ordered provider item creation events, not async transcription completion arrival, define conversation order.
  v_number:=(p_generation-1)*10000+p_provider_order;
  insert into public.recruitment_transcript_turns(attempt_id,turn_number,provider_generation,provider_item_id,speaker,transcript,elapsed_start_ms,elapsed_end_ms)
    values(v_attempt.id,v_number,p_generation,p_item_id,p_speaker,btrim(p_transcript),p_start_ms,p_end_ms) returning * into v_turn;
  return jsonb_build_object('turn_number',v_turn.turn_number,'id',v_turn.id);
end $$;

revoke all on function public.recruitment_public_begin(text,uuid),public.recruitment_public_heartbeat(text,uuid),public.recruitment_realtime_context(text,uuid),public.recruitment_public_provider_connected(text,uuid,integer),public.recruitment_public_provider_disconnected(text,uuid,integer),public.recruitment_public_transcript_turn(text,uuid,integer,integer,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.recruitment_public_begin(text,uuid),public.recruitment_public_heartbeat(text,uuid),public.recruitment_public_provider_connected(text,uuid,integer),public.recruitment_public_provider_disconnected(text,uuid,integer),public.recruitment_public_transcript_turn(text,uuid,integer,integer,text,text,text,integer,integer) to anon,authenticated;
grant execute on function public.recruitment_realtime_context(text,uuid) to service_role;

-- Upload transport chunks are never presented as playable recording segments.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('recruitment-evidence','recruitment-evidence',false,134217728,array['video/mp4','application/octet-stream'])
on conflict(id) do nothing;
create table public.recruitment_recording_units (
  id uuid primary key,
  attempt_id uuid not null references public.recruitment_interview_attempts(id) on delete restrict,
  sequence integer not null,
  status text not null default 'capturing' check(status in ('capturing','pending','verified','invalid','interrupted')),
  object_path text not null unique,
  mime_type text not null check(mime_type='video/mp4'),
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  elapsed_start_ms integer not null check(elapsed_start_ms>=0),
  elapsed_end_ms integer check(elapsed_end_ms>=elapsed_start_ms),
  expected_bytes bigint check(expected_bytes between 1 and 134217728),
  verified_bytes bigint,
  video_width integer,
  video_height integer,
  verified_at timestamptz,
  end_reason text,
  unique(attempt_id,sequence)
);
create table public.recruitment_recording_chunks (
  unit_id uuid not null references public.recruitment_recording_units(id) on delete restrict,
  chunk_index integer not null check(chunk_index between 0 and 2000),
  object_path text not null unique,
  expected_bytes integer not null check(expected_bytes between 1 and 12582912),
  acknowledged_at timestamptz,
  primary key(unit_id,chunk_index)
);
create table public.recruitment_transcript_annotations (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.recruitment_interview_attempts(id),
  provider_generation integer not null,
  provider_item_id text not null,
  kind text not null check(kind in ('truncated','transcription_failed')),
  elapsed_ms integer not null check(elapsed_ms>=0),
  received_at timestamptz not null default clock_timestamp(),
  unique(attempt_id,provider_generation,provider_item_id,kind)
);
create trigger recruitment_annotation_immutable before update or delete on public.recruitment_transcript_annotations for each row execute function public.recruitment_immutable_evidence();
alter table public.recruitment_recording_units enable row level security;
alter table public.recruitment_recording_chunks enable row level security;
alter table public.recruitment_transcript_annotations enable row level security;
revoke all on public.recruitment_recording_units,public.recruitment_recording_chunks,public.recruitment_transcript_annotations from public,anon,authenticated;
grant all on public.recruitment_recording_units,public.recruitment_recording_chunks,public.recruitment_transcript_annotations,public.recruitment_transcript_turns,public.recruitment_topic_coverage,public.recruitment_scenario_progress to service_role;
create index recruitment_recording_attempt_idx on public.recruitment_recording_units(attempt_id,sequence);
alter table public.recruitment_interview_attempts add column recording_state text not null default 'not_started' check(recording_state in ('not_started','recording','pending','complete','partial','failed'));
alter table public.recruitment_interview_attempts add column completion_reason text;
alter table public.recruitment_interview_attempts add column coverage_requested_at timestamptz, add column coverage_requests integer not null default 0;

create function public.recruitment_session(p_token text,p_client_id uuid)
returns public.recruitment_interview_attempts language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_public_attempt(p_token);
  if a.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
  select * into a from public.recruitment_interview_attempts where id=a.id for update;
  if p_client_id is null or a.lease_owner is distinct from p_client_id or a.lease_expires_at<=clock_timestamp() or a.status not in ('starting','interviewing','interrupted','finalizing') then raise exception using errcode='42501',message='Interview session is unavailable.'; end if;
  return a;
end $$;

create function public.recruitment_recording_access(p_token text,p_client_id uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; u public.recruitment_recording_units%rowtype; c public.recruitment_recording_chunks%rowtype; n integer; v_path text; v_bytes bigint; v_end integer;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if p_action='open' then
    if a.status='finalizing' or a.max_ends_at<=clock_timestamp() then raise exception using errcode='55000',message='Interview duration has ended.'; end if;
    select * into u from public.recruitment_recording_units where id=(p_payload->>'unit_id')::uuid and attempt_id=a.id;
    if u.id is null then
      -- A stale capture is explicit missing evidence, never silently superseded.
      update public.recruitment_recording_units set status='interrupted',ended_at=clock_timestamp(),end_reason='reload_or_capture_loss' where attempt_id=a.id and status='capturing';
      if found then insert into public.recruitment_events(attempt_id,application_id,opening_id,action) values(a.id,a.application_id,a.opening_id,'recording_gap'); end if;
      select coalesce(max(sequence),0)+1 into n from public.recruitment_recording_units where attempt_id=a.id;
      if n>30 then raise exception using errcode='55000',message='Recording recovery limit reached.'; end if;
      insert into public.recruitment_recording_units(id,attempt_id,sequence,object_path,mime_type,elapsed_start_ms)
      values((p_payload->>'unit_id')::uuid,a.id,n,a.id::text||'/'||(p_payload->>'unit_id')||'/recording.mp4','video/mp4',greatest(0,(extract(epoch from clock_timestamp()-a.interview_started_at)*1000)::integer)) returning * into u;
      update public.recruitment_interview_attempts set recording_state='recording' where id=a.id;
      insert into public.recruitment_events(attempt_id,application_id,opening_id,action,details) values(a.id,a.application_id,a.opening_id,'recording_unit_started',jsonb_build_object('unit_id',u.id,'sequence',n));
    end if;
    return to_jsonb(u);
  end if;
  select * into u from public.recruitment_recording_units where id=(p_payload->>'unit_id')::uuid and attempt_id=a.id for update;
  if u.id is null then raise exception using errcode='42501',message='Recording is unavailable.'; end if;
  if p_action in ('chunk','chunk_ack') then
    n:=(p_payload->>'index')::integer; v_bytes:=(p_payload->>'bytes')::bigint;
    if n is null or n not between 0 and 2000 or v_bytes is null or v_bytes not between 1 and 12582912 then raise exception using errcode='22023',message='Recording chunk is invalid.'; end if;
    v_path:=a.id::text||'/'||u.id::text||'/chunks/'||lpad(n::text,5,'0')||'.part';
    if p_action='chunk' then
      if not exists(select 1 from public.recruitment_recording_chunks where unit_id=u.id and chunk_index=n) and (select coalesce(sum(expected_bytes),0) from public.recruitment_recording_chunks where unit_id=u.id)+v_bytes>134217728 then raise exception using errcode='22023',message='Recording unit storage limit reached.'; end if;
      insert into public.recruitment_recording_chunks(unit_id,chunk_index,object_path,expected_bytes) values(u.id,n,v_path,v_bytes) on conflict(unit_id,chunk_index) do nothing;
      select * into c from public.recruitment_recording_chunks where unit_id=u.id and chunk_index=n;
      if c.expected_bytes<>v_bytes then raise exception using errcode='55000',message='Recording chunk cannot change.'; end if;
      return jsonb_build_object('path',v_path,'acknowledged',c.acknowledged_at is not null);
    end if;
    update public.recruitment_recording_chunks set acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) where unit_id=u.id and chunk_index=n and expected_bytes=v_bytes;
    return jsonb_build_object('acknowledged',found);
  elsif p_action='upload' then
    v_bytes:=(p_payload->>'bytes')::bigint; v_end:=(p_payload->>'elapsed_end_ms')::integer;
    if v_bytes is null or v_bytes not between 1 and 134217728 or v_end is null or v_end<u.elapsed_start_ms or v_end>(extract(epoch from clock_timestamp()-a.interview_started_at)*1000)::integer+10000 then raise exception using errcode='22023',message='Recording file is invalid.'; end if;
    if u.expected_bytes is not null and (u.expected_bytes<>v_bytes or u.elapsed_end_ms is distinct from v_end or u.end_reason is distinct from left(p_payload->>'reason',80)) then raise exception using errcode='55000',message='Recording file cannot change.'; end if;
    update public.recruitment_recording_units set expected_bytes=v_bytes,elapsed_end_ms=v_end,ended_at=coalesce(ended_at,clock_timestamp()),end_reason=coalesce(end_reason,left(p_payload->>'reason',80)),status=case when status='verified' then status else 'pending' end where id=u.id;
    return jsonb_build_object('path',u.object_path,'verified',u.status='verified','bytes',v_bytes);
  elsif p_action='verified' then
    if u.status='verified' then return to_jsonb(u); end if;
    if u.expected_bytes is null or (p_payload->>'bytes')::bigint is distinct from u.expected_bytes or coalesce((p_payload->>'width')::integer,0)<1 or coalesce((p_payload->>'height')::integer,0)<1 then raise exception using errcode='22023',message='Recording verification failed.'; end if;
    update public.recruitment_recording_units set status='verified',verified_bytes=u.expected_bytes,video_width=(p_payload->>'width')::integer,video_height=(p_payload->>'height')::integer,verified_at=clock_timestamp() where id=u.id returning * into u;
    return to_jsonb(u);
  elsif p_action='abandon' then
    update public.recruitment_recording_units set status='interrupted',ended_at=coalesce(ended_at,clock_timestamp()),end_reason='local_evidence_unavailable' where id=u.id and status in ('capturing','pending');
    if found then insert into public.recruitment_events(attempt_id,application_id,opening_id,action,details) values(a.id,a.application_id,a.opening_id,'recording_gap',jsonb_build_object('unit_id',u.id,'reason','local_evidence_unavailable')); end if;
    return jsonb_build_object('status','interrupted');
  elsif p_action='invalid' then
    update public.recruitment_recording_units set status='invalid',ended_at=coalesce(ended_at,clock_timestamp()),end_reason='invalid_media' where id=u.id and status<>'verified';
    return jsonb_build_object('status','invalid');
  end if;
  raise exception using errcode='22023',message='Recording operation is invalid.';
end $$;

create function public.recruitment_public_interruption(p_token text,p_client_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  insert into public.recruitment_events(attempt_id,application_id,opening_id,action,details) values(a.id,a.application_id,a.opening_id,'recording_gap',jsonb_build_object('reason',left(p_reason,80)));
  update public.recruitment_interview_attempts set status='interrupted' where id=a.id and status<>'finalizing';
  return jsonb_build_object('status','interrupted');
end $$;

create function public.recruitment_public_annotation(p_token text,p_client_id uuid,p_generation integer,p_item_id text,p_kind text,p_elapsed_ms integer)
returns void language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if p_generation not between 1 and a.provider_generation or length(coalesce(p_item_id,'')) not between 3 and 200 then raise exception using errcode='22023',message='Transcript event is invalid.'; end if;
  insert into public.recruitment_transcript_annotations(attempt_id,provider_generation,provider_item_id,kind,elapsed_ms) values(a.id,p_generation,p_item_id,p_kind,p_elapsed_ms) on conflict do nothing;
end $$;

create function public.recruitment_assessment_context(p_token text,p_client_id uuid,p_for_coverage boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if p_for_coverage then
    if a.coverage_requests>=300 or a.coverage_requested_at>clock_timestamp()-interval '10 seconds' then raise exception using errcode='55000',message='Coverage check is already pending. Please wait.'; end if;
    update public.recruitment_interview_attempts set coverage_requested_at=clock_timestamp(),coverage_requests=coverage_requests+1 where id=a.id;
  end if;
  return jsonb_build_object('attempt_id',a.id,'status',a.status,'max_ends_at',a.max_ends_at,'topics',(select jsonb_agg(to_jsonb(t) order by topic_index) from public.recruitment_topic_coverage t where attempt_id=a.id),'scenarios',coalesce((select jsonb_agg(to_jsonb(t) order by scenario_index) from public.recruitment_scenario_progress t where attempt_id=a.id),'[]'::jsonb),'turns',coalesce((select jsonb_agg(to_jsonb(t) order by turn_number) from public.recruitment_transcript_turns t where attempt_id=a.id),'[]'::jsonb),'units',coalesce((select jsonb_agg(to_jsonb(t) order by sequence) from public.recruitment_recording_units t where attempt_id=a.id),'[]'::jsonb),'chunks',coalesce((select jsonb_agg(to_jsonb(c) order by c.unit_id,c.chunk_index) from public.recruitment_recording_chunks c join public.recruitment_recording_units u on u.id=c.unit_id where u.attempt_id=a.id),'[]'::jsonb));
end $$;

create function public.recruitment_apply_coverage(p_token text,p_client_id uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; x jsonb; t public.recruitment_transcript_turns%rowtype; v_ready boolean;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  for x in select * from jsonb_array_elements(p_result->'topics') loop
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker='candidate';
    if t.id is not null then update public.recruitment_topic_coverage set state='covered',evidence_turn_id=t.id,updated_at=clock_timestamp() where attempt_id=a.id and topic_index=(x->>'index')::integer and state='unresolved'; end if;
  end loop;
  for x in select * from jsonb_array_elements(p_result->'scenarios') loop
    select * into t from public.recruitment_transcript_turns where attempt_id=a.id and turn_number=(x->>'turn_number')::integer and speaker=case when x->>'state'='asked' then 'ai' else 'candidate' end;
    if x->>'state' not in ('asked','answered') then continue; end if;
    if t.id is not null then update public.recruitment_scenario_progress set state=x->>'state',evidence_turn_id=t.id,updated_at=clock_timestamp() where attempt_id=a.id and scenario_index=(x->>'index')::integer and (state<>'answered' or x->>'state'='answered'); end if;
  end loop;
  v_ready:=not exists(select 1 from public.recruitment_topic_coverage where attempt_id=a.id and state<>'covered') and not exists(select 1 from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered');
  return jsonb_build_object('can_finish',v_ready or a.max_ends_at<=clock_timestamp(),'coverage_complete',v_ready,'max_reached',a.max_ends_at<=clock_timestamp(),'unresolved_topics',coalesce((select jsonb_agg(topic order by topic_index) from public.recruitment_topic_coverage where attempt_id=a.id and state='unresolved'),'[]'::jsonb),'pending_scenarios',coalesce((select jsonb_agg(brief order by scenario_index) from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered'),'[]'::jsonb));
end $$;

create function public.recruitment_public_finish(p_token text,p_client_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if p_reason is null or p_reason not in ('coverage','max_duration','candidate_stop') then raise exception using errcode='22023',message='Completion reason is invalid.'; end if;
  if p_reason='coverage' and (exists(select 1 from public.recruitment_topic_coverage where attempt_id=a.id and state='unresolved') or exists(select 1 from public.recruitment_scenario_progress where attempt_id=a.id and state<>'answered')) then raise exception using errcode='55000',message='Required interview topics remain.'; end if;
  if p_reason='max_duration' and a.max_ends_at>clock_timestamp() then raise exception using errcode='55000',message='Maximum duration has not ended.'; end if;
  update public.recruitment_interview_attempts set status='finalizing',interview_ended_at=coalesce(interview_ended_at,clock_timestamp()),completion_reason=coalesce(completion_reason,p_reason),recording_state='pending' where id=a.id;
  return jsonb_build_object('status','finalizing');
end $$;

create function public.recruitment_finalize(p_token text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; v_recording text; v_status text;
begin
  a:=public.recruitment_session(p_token,p_client_id);
  if a.status<>'finalizing' then raise exception using errcode='55000',message='Interview must end before finalization.'; end if;
  if exists(select 1 from public.recruitment_recording_units where attempt_id=a.id and status in ('pending','capturing')) then return jsonb_build_object('status','finalizing','recording_state','pending'); end if;
  if not exists(select 1 from public.recruitment_recording_units where attempt_id=a.id and status='verified') then v_recording:='failed';
  elsif exists(select 1 from public.recruitment_recording_units where attempt_id=a.id and (status<>'verified' or coalesce(end_reason,'')<>'completed')) or exists(select 1 from public.recruitment_events where attempt_id=a.id and action='recording_gap') or exists(select 1 from (select elapsed_start_ms,lag(elapsed_end_ms) over(order by sequence) prior_end from public.recruitment_recording_units where attempt_id=a.id) gaps where elapsed_start_ms>prior_end+2000) or (select min(elapsed_start_ms) from public.recruitment_recording_units where attempt_id=a.id)>5000 or (select max(elapsed_end_ms) from public.recruitment_recording_units where attempt_id=a.id)<(extract(epoch from a.interview_ended_at-a.interview_started_at)*1000)::integer-5000 then v_recording:='partial';
  else v_recording:='complete'; end if;
  v_status:=case when v_recording='failed' then 'failed' when v_recording='partial' or a.completion_reason='candidate_stop' or not exists(select 1 from public.recruitment_transcript_turns where attempt_id=a.id and speaker='candidate') or exists(select 1 from public.recruitment_transcript_annotations where attempt_id=a.id and kind='transcription_failed') or exists(select 1 from public.recruitment_events where attempt_id=a.id and action='provider_disconnected') then 'partial' else 'completed' end;
  update public.recruitment_interview_attempts set status=v_status,recording_state=v_recording,lease_expires_at=clock_timestamp() where id=a.id;
  insert into public.recruitment_events(attempt_id,application_id,opening_id,action,details) values(a.id,a.application_id,a.opening_id,'interview_finalized',jsonb_build_object('status',v_status,'recording_state',v_recording));
  return jsonb_build_object('status',v_status,'recording_state',v_recording);
end $$;

create function public.recruitment_admin_evidence(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.recruitment_actor('recruitment.view'); a public.recruitment_interview_attempts%rowtype; o public.recruitment_openings%rowtype;
begin
  select op.* into o from public.recruitment_openings op join public.recruitment_applications app on app.opening_id=op.id where app.id=p_application_id;
  if o.id is null or not public.recruitment_opening_in_scope(o.outlet_id) then raise exception using errcode='42501',message='Application is unavailable.'; end if;
  select * into a from public.recruitment_interview_attempts where application_id=p_application_id order by created_at desc limit 1;
  return jsonb_build_object('attempt',to_jsonb(a)-'lease_owner','turns',coalesce((select jsonb_agg(to_jsonb(t) order by turn_number) from public.recruitment_transcript_turns t where attempt_id=a.id),'[]'::jsonb),'units',coalesce((select jsonb_agg(to_jsonb(u) order by sequence) from public.recruitment_recording_units u where attempt_id=a.id),'[]'::jsonb),'topics',coalesce((select jsonb_agg(to_jsonb(t) order by topic_index) from public.recruitment_topic_coverage t where attempt_id=a.id),'[]'::jsonb),'scenarios',coalesce((select jsonb_agg(to_jsonb(t) order by scenario_index) from public.recruitment_scenario_progress t where attempt_id=a.id),'[]'::jsonb),'annotations',coalesce((select jsonb_agg(to_jsonb(t)) from public.recruitment_transcript_annotations t where attempt_id=a.id),'[]'::jsonb),'events',coalesce((select jsonb_agg(jsonb_build_object('action',action,'occurred_at',occurred_at,'details',details) order by occurred_at) from public.recruitment_events where attempt_id=a.id),'[]'::jsonb));
end $$;
revoke all on function public.recruitment_session(text,uuid),public.recruitment_recording_access(text,uuid,text,jsonb),public.recruitment_public_interruption(text,uuid,text),public.recruitment_public_annotation(text,uuid,integer,text,text,integer),public.recruitment_assessment_context(text,uuid,boolean),public.recruitment_apply_coverage(text,uuid,jsonb),public.recruitment_public_finish(text,uuid,text),public.recruitment_finalize(text,uuid),public.recruitment_admin_evidence(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_public_interruption(text,uuid,text),public.recruitment_public_annotation(text,uuid,integer,text,text,integer),public.recruitment_public_finish(text,uuid,text) to anon,authenticated;
grant execute on function public.recruitment_recording_access(text,uuid,text,jsonb),public.recruitment_assessment_context(text,uuid,boolean),public.recruitment_apply_coverage(text,uuid,jsonb),public.recruitment_finalize(text,uuid) to service_role;
grant execute on function public.recruitment_admin_evidence(uuid) to authenticated;
