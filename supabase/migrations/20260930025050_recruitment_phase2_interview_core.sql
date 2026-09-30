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
  if v_attempt.status not in ('ready','starting','interviewing','interrupted') or not exists(select 1 from public.recruitment_consents where attempt_id=v_attempt.id) then
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
    if v_attempt.max_ends_at<=v_now then raise exception using errcode='55000',message='Interview duration has ended.'; end if;
    update public.recruitment_interview_attempts set status=case when status='interrupted' or lease_expires_at<=v_now then 'starting' else status end,lease_owner=p_client_id,lease_expires_at=v_now+interval '45 seconds',last_heartbeat_at=v_now where id=v_attempt.id;
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
  if p_client_id is null or v_attempt.lease_owner is distinct from p_client_id or p_generation is distinct from v_attempt.provider_generation then raise exception using errcode='42501',message='Interview session is unavailable.'; end if;
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
