-- Phase A is dormant until a future whole month is explicitly activated.
create table public.crew_performance_model_periods (
  period_start date primary key,
  calculation_version text not null check (calculation_version = 'performance-v2'),
  configured_at timestamptz not null default now(),
  configured_by uuid references auth.users(id),
  check (period_start = date_trunc('month', period_start)::date)
);
alter table public.crew_performance_model_periods enable row level security;
revoke all on public.crew_performance_model_periods from public, anon, authenticated;

alter table public.crew_performance_results add column peer_score numeric(5,2);
alter table public.crew_performance_results add constraint crew_performance_peer_score_check check (peer_score between 0 and 5);
alter table public.crew_performance_results drop constraint if exists crew_performance_results_customer_score_check;
alter table public.crew_performance_results add constraint crew_performance_customer_model_check check (
  (calculation_version = 'performance-v1' and customer_score between 0 and 15 and peer_score is null)
  or (calculation_version = 'performance-v2' and customer_score between 0 and 20 and conduct_score is null)
);

create table public.crew_peer_review_subjects (
  employee_id uuid not null references public.employees(id) on delete restrict,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null,
  required_count integer not null check (required_count in (0, 2, 3)),
  team_size integer not null check (team_size > 0),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references auth.users(id),
  primary key (employee_id, period_start),
  check (period_start = date_trunc('month', period_start)::date)
);
create index crew_peer_subjects_outlet_period_idx on public.crew_peer_review_subjects(outlet_id, period_start);

create table public.crew_peer_review_assignments (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  reviewer_id uuid not null references public.employees(id) on delete restrict,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null,
  criteria jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subject_id, reviewer_id, period_start),
  foreign key (subject_id, period_start) references public.crew_peer_review_subjects(employee_id, period_start) on delete restrict,
  check (subject_id <> reviewer_id),
  check ((criteria is null) = (submitted_at is null))
);
create index crew_peer_assignments_reviewer_idx on public.crew_peer_review_assignments(reviewer_id, period_start, submitted_at);
create index crew_peer_assignments_subject_idx on public.crew_peer_review_assignments(subject_id, period_start);

create table public.crew_peer_review_exclusions (
  assignment_id uuid primary key references public.crew_peer_review_assignments(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  excluded_at timestamptz not null default now(),
  excluded_by uuid not null references auth.users(id)
);
alter table public.crew_peer_review_subjects enable row level security;
alter table public.crew_peer_review_assignments enable row level security;
alter table public.crew_peer_review_exclusions enable row level security;
revoke all on public.crew_peer_review_subjects, public.crew_peer_review_assignments, public.crew_peer_review_exclusions from public, anon, authenticated;

create or replace function public.crew_peer_review_score(p_criteria jsonb)
returns numeric language plpgsql immutable set search_path=public as $$
declare v_key text; v_rating integer; v_total integer := 0;
begin
  if jsonb_typeof(p_criteria) <> 'object' or
     (select array_agg(key order by key) from jsonb_object_keys(p_criteria) key) is distinct from
     array['communication', 'reliability', 'teamwork', 'work_attitude'] then
    raise exception using errcode='22023', message='All four Peer Review ratings are required.';
  end if;
  for v_key in select jsonb_object_keys(p_criteria) loop
    if jsonb_typeof(p_criteria->v_key) <> 'number' or
       (p_criteria->>v_key) !~ '^[1-5]$' then
      raise exception using errcode='22023', message='Peer Review ratings must be whole numbers from 1 to 5.';
    end if;
    v_rating := (p_criteria->>v_key)::integer;
    v_total := v_total + v_rating;
  end loop;
  return v_total::numeric / 4;
end; $$;
revoke all on function public.crew_peer_review_score(jsonb) from public, anon, authenticated;

-- Completed, same-outlet attendance is the sole coworker-overlap evidence.
create or replace function public.crew_peer_worked_overlap(p_outlet_id uuid, p_period date)
returns table(subject_id uuid, reviewer_id uuid, overlap_minutes numeric)
language sql stable security definer set search_path=public as $$
  select a.employee_id, b.employee_id,
    sum(extract(epoch from least(a.clock_out_at, b.clock_out_at,
      (date_trunc('month', p_period)::date + interval '1 month') at time zone 'Asia/Kuala_Lumpur') -
      greatest(a.clock_in_at, b.clock_in_at,
      date_trunc('month', p_period)::date at time zone 'Asia/Kuala_Lumpur')) / 60)::numeric
  from public.crew_attendance_records a
  join public.crew_attendance_records b on b.outlet_id = a.outlet_id and b.employee_id <> a.employee_id
    and b.status = 'completed' and b.clock_out_at is not null
    and b.clock_in_at < a.clock_out_at and b.clock_out_at > a.clock_in_at
  join public.employees subject on subject.id = a.employee_id
  join public.employees reviewer on reviewer.id = b.employee_id
  join public.crew_access subject_access on subject_access.employee_id = subject.id
  join public.crew_access reviewer_access on reviewer_access.employee_id = reviewer.id
  where a.outlet_id = p_outlet_id and a.status = 'completed' and a.clock_out_at is not null
    and a.clock_in_at < (date_trunc('month', p_period)::date + interval '1 month') at time zone 'Asia/Kuala_Lumpur'
    and a.clock_out_at >= date_trunc('month', p_period)::date at time zone 'Asia/Kuala_Lumpur'
    and b.clock_in_at < (date_trunc('month', p_period)::date + interval '1 month') at time zone 'Asia/Kuala_Lumpur'
    and b.clock_out_at >= date_trunc('month', p_period)::date at time zone 'Asia/Kuala_Lumpur'
    and lower(btrim(subject.position)) = 'service crew'
    and lower(btrim(reviewer.position)) = 'service crew'
    and subject.is_active and reviewer.is_active
    and coalesce(subject.employment_status, 'active') not in ('resigned', 'terminated')
    and coalesce(reviewer.employment_status, 'active') not in ('resigned', 'terminated')
    and subject_access.primary_outlet_id = p_outlet_id and reviewer_access.primary_outlet_id = p_outlet_id
    and subject_access.access_state = 'active' and reviewer_access.access_state = 'active'
  group by a.employee_id, b.employee_id
  having sum(extract(epoch from least(a.clock_out_at, b.clock_out_at,
    (date_trunc('month', p_period)::date + interval '1 month') at time zone 'Asia/Kuala_Lumpur') -
    greatest(a.clock_in_at, b.clock_in_at,
      date_trunc('month', p_period)::date at time zone 'Asia/Kuala_Lumpur'))) > 0;
$$;
revoke all on function public.crew_peer_worked_overlap(uuid, date) from public, anon, authenticated;

create or replace function public.crew_peer_worked_team(p_outlet_id uuid, p_period date)
returns table(employee_id uuid) language sql stable security definer set search_path=public as $$
  select distinct a.employee_id from public.crew_attendance_records a
  join public.employees e on e.id = a.employee_id
  join public.crew_access ca on ca.employee_id = e.id
  where a.outlet_id = p_outlet_id and a.status = 'completed' and a.clock_out_at is not null
    and a.clock_in_at < (date_trunc('month', p_period)::date + interval '1 month') at time zone 'Asia/Kuala_Lumpur'
    and a.clock_out_at > date_trunc('month', p_period)::date at time zone 'Asia/Kuala_Lumpur'
    and lower(btrim(e.position)) = 'service crew' and e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and ca.primary_outlet_id = p_outlet_id and ca.access_state = 'active';
$$;
revoke all on function public.crew_peer_worked_team(uuid, date) from public, anon, authenticated;

create or replace function public.crew_peer_open_month(p_outlet_id uuid, p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_period date := date_trunc('month', p_period)::date; v_team_size integer; v_required integer;
  v_subject record; v_reviewer record; v_existing integer; v_added integer := 0;
begin
  if not public.current_user_has_permission('crew_performance.review') or
     not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='Performance review permission is required for this outlet.';
  end if;
  if not exists (select 1 from public.crew_performance_model_periods
      where period_start <= v_period and calculation_version = 'performance-v2') then
    raise exception using errcode='22023', message='Performance V2 is not active for this month.';
  end if;
  if timezone('Asia/Kuala_Lumpur', now())::date < (v_period + interval '1 month' - interval '7 days')::date or
     timezone('Asia/Kuala_Lumpur', now())::date >= (v_period + interval '1 month' + interval '7 days')::date then
    raise exception using errcode='22023', message='Peer Review opens near the end of a worked month.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text || v_period::text || 'peer', 0));
  select count(*) into v_team_size from public.crew_peer_worked_team(p_outlet_id, v_period);
  v_required := case when v_team_size >= 4 then 3 when v_team_size = 3 then 2 else 0 end;
  for v_subject in
    select employee_id from public.crew_peer_worked_team(p_outlet_id, v_period) order by employee_id
  loop
    if public.crew_performance_model(v_subject.employee_id, v_period) <> 'performance-v2' or
       exists (select 1 from public.crew_performance_results
        where employee_id = v_subject.employee_id and period_start = v_period and status = 'finalized') then
      continue;
    end if;
    insert into public.crew_peer_review_subjects(employee_id, outlet_id, period_start, required_count, team_size, opened_by)
    values(v_subject.employee_id, p_outlet_id, v_period, v_required, v_team_size, auth.uid())
    on conflict (employee_id, period_start) do nothing;
  end loop;
  if v_required > 0 then
    for v_subject in
      select s.employee_id, s.required_count from public.crew_peer_review_subjects s
      where s.outlet_id = p_outlet_id and s.period_start = v_period and s.required_count > 0
      order by (select count(*) from public.crew_peer_worked_overlap(p_outlet_id, v_period) o where o.subject_id = s.employee_id), s.employee_id
    loop
      select count(*) into v_existing from public.crew_peer_review_assignments
      where subject_id = v_subject.employee_id and period_start = v_period;
      for v_reviewer in
        select o.reviewer_id from public.crew_peer_worked_overlap(p_outlet_id, v_period) o
        where o.subject_id = v_subject.employee_id
          and not exists (select 1 from public.crew_peer_review_assignments a where a.subject_id = o.subject_id and a.reviewer_id = o.reviewer_id and a.period_start = v_period)
        order by (select count(*) from public.crew_peer_review_assignments a where a.reviewer_id = o.reviewer_id and a.period_start = v_period),
          o.overlap_minutes desc, o.reviewer_id
        limit greatest(0, v_subject.required_count - v_existing)
      loop
        insert into public.crew_peer_review_assignments(subject_id, reviewer_id, outlet_id, period_start)
        values(v_subject.employee_id, v_reviewer.reviewer_id, p_outlet_id, v_period)
        on conflict (subject_id, reviewer_id, period_start) do nothing;
        v_added := v_added + 1;
      end loop;
    end loop;
  end if;
  return jsonb_build_object('team_size', v_team_size, 'required_reviews', v_required, 'assignments_added', v_added);
end; $$;
revoke all on function public.crew_peer_open_month(uuid, date) from public, anon, authenticated;
grant execute on function public.crew_peer_open_month(uuid, date) to authenticated;

create or replace function public.crew_peer_review_mobile(p_token text, p_period date default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee uuid := public.crew_session_employee(p_token); v_period date := date_trunc('month', coalesce(p_period, timezone('Asia/Kuala_Lumpur', now())::date))::date;
  v_assignments jsonb; v_component jsonb; v_due date;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'subject_name', e.full_name,
    'subject_position', e.position, 'submitted', a.submitted_at is not null) order by a.submitted_at nulls first, e.full_name), '[]'::jsonb)
  into v_assignments from public.crew_peer_review_assignments a join public.employees e on e.id = a.subject_id
  where a.reviewer_id = v_employee and a.period_start = v_period;
  v_component := public.crew_peer_review_component(v_employee, v_period);
  v_due := (v_period + interval '1 month' + interval '7 days')::date;
  return jsonb_build_object('period_start', v_period, 'assignments', v_assignments,
    'completed', jsonb_array_length(v_assignments) - (select count(*) from public.crew_peer_review_assignments where reviewer_id = v_employee and period_start = v_period and submitted_at is null),
    'total', jsonb_array_length(v_assignments), 'open', timezone('Asia/Kuala_Lumpur', now())::date < v_due,
    'peer', v_component);
end; $$;

create or replace function public.crew_peer_review_submit(p_token text, p_assignment_id uuid, p_criteria jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee uuid := public.crew_session_employee(p_token); v_assignment public.crew_peer_review_assignments%rowtype; v_mean numeric;
begin
  select * into v_assignment from public.crew_peer_review_assignments where id = p_assignment_id for update;
  if not found or v_assignment.reviewer_id <> v_employee or v_assignment.subject_id = v_employee then
    raise exception using errcode='42501', message='Peer Review assignment is unavailable.';
  end if;
  if v_assignment.submitted_at is not null then
    raise exception using errcode='22023', message='Peer Review has already been submitted.';
  end if;
  if timezone('Asia/Kuala_Lumpur', now())::date >= (v_assignment.period_start + interval '1 month' + interval '7 days')::date then
    raise exception using errcode='22023', message='Peer Review is closed.';
  end if;
  if not exists(select 1 from public.crew_peer_worked_overlap(v_assignment.outlet_id, v_assignment.period_start) o
                where o.subject_id = v_assignment.subject_id and o.reviewer_id = v_employee) then
    raise exception using errcode='42501', message='Coworker eligibility is unavailable.';
  end if;
  if exists(select 1 from public.crew_performance_results where employee_id = v_assignment.subject_id
    and period_start = v_assignment.period_start and status = 'finalized') then
    raise exception using errcode='55000', message='Finalized Performance evidence cannot be changed.';
  end if;
  v_mean := public.crew_peer_review_score(p_criteria);
  update public.crew_peer_review_assignments set criteria = p_criteria, submitted_at = now() where id = p_assignment_id;
  perform public.crew_refresh_performance(v_assignment.subject_id, v_assignment.period_start);
  return jsonb_build_object('id', p_assignment_id, 'submitted', true);
end; $$;

create or replace function public.crew_peer_review_component(p_employee_id uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_subject public.crew_peer_review_subjects%rowtype; v_valid integer; v_means jsonb; v_score numeric;
begin
  select * into v_subject from public.crew_peer_review_subjects where employee_id = p_employee_id and period_start = date_trunc('month', p_period)::date;
  if not found then
    return jsonb_build_object('score', null, 'max_score', 5, 'status', 'pending', 'reason', 'assignments_not_open', 'completed', 0, 'required', 0);
  end if;
  select count(*), jsonb_build_object(
    'teamwork', round(avg((a.criteria->>'teamwork')::numeric), 2),
    'reliability', round(avg((a.criteria->>'reliability')::numeric), 2),
    'communication', round(avg((a.criteria->>'communication')::numeric), 2),
    'work_attitude', round(avg((a.criteria->>'work_attitude')::numeric), 2))
  into v_valid, v_means
  from public.crew_peer_review_assignments a left join public.crew_peer_review_exclusions x on x.assignment_id = a.id
  where a.subject_id = p_employee_id and a.period_start = v_subject.period_start and a.submitted_at is not null and x.assignment_id is null;
  if v_subject.required_count = 0 or v_valid < v_subject.required_count then
    return jsonb_build_object('score', null, 'max_score', 5, 'status', 'pending',
      'reason', case when v_subject.required_count = 0 then 'insufficient_peers' else 'insufficient_reviews' end,
      'completed', v_valid, 'required', v_subject.required_count);
  end if;
  select round(5 * (avg(public.crew_peer_review_score(a.criteria)) - 1) / 4, 2) into v_score
  from public.crew_peer_review_assignments a left join public.crew_peer_review_exclusions x on x.assignment_id = a.id
  where a.subject_id = p_employee_id and a.period_start = v_subject.period_start and a.submitted_at is not null and x.assignment_id is null;
  return jsonb_build_object('score', v_score, 'max_score', 5, 'status', 'scored',
    'completed', v_valid, 'required', v_subject.required_count, 'dimensions', v_means, 'calculation_version', 'peer-v1');
end; $$;
revoke all on function public.crew_peer_review_component(uuid, date) from public, anon, authenticated;
revoke all on function public.crew_peer_review_mobile(text, date) from public, anon, authenticated;
grant execute on function public.crew_peer_review_mobile(text, date) to anon, authenticated;
revoke all on function public.crew_peer_review_submit(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crew_peer_review_submit(text, uuid, jsonb) to anon, authenticated;

create or replace function public.crew_peer_review_admin(p_outlet_id uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('crew_performance.review') or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='Peer Review evidence is unavailable.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'subject_id', a.subject_id,
    'subject_name', s.full_name, 'reviewer_id', a.reviewer_id, 'reviewer_name', r.full_name,
    'criteria', a.criteria, 'submitted_at', a.submitted_at,
    'flags', jsonb_build_object(
      'extreme_rating', a.criteria is not null and public.crew_peer_review_score(a.criteria) in (1, 5),
      'reciprocal', exists(select 1 from public.crew_peer_review_assignments reciprocal
        where reciprocal.subject_id = a.reviewer_id and reciprocal.reviewer_id = a.subject_id
          and reciprocal.period_start = a.period_start and reciprocal.submitted_at is not null)
    ),
    'excluded_at', x.excluded_at, 'exclusion_reason', x.reason) order by s.full_name, r.full_name), '[]'::jsonb)
  into v_rows from public.crew_peer_review_assignments a
  join public.employees s on s.id = a.subject_id join public.employees r on r.id = a.reviewer_id
  left join public.crew_peer_review_exclusions x on x.assignment_id = a.id
  where a.outlet_id = p_outlet_id and a.period_start = date_trunc('month', p_period)::date;
  return jsonb_build_object('assignments', v_rows);
end; $$;
revoke all on function public.crew_peer_review_admin(uuid, date) from public, anon, authenticated;
grant execute on function public.crew_peer_review_admin(uuid, date) to authenticated;

create or replace function public.crew_peer_review_exclude(p_assignment_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_assignment public.crew_peer_review_assignments%rowtype;
begin
  select * into v_assignment from public.crew_peer_review_assignments where id = p_assignment_id for update;
  if not found or not public.current_user_has_permission('crew_performance.review') or
     not public.current_user_can_access_outlet(v_assignment.outlet_id) then
    raise exception using errcode='42501', message='Peer Review evidence is unavailable.';
  end if;
  if v_assignment.submitted_at is null or char_length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then
    raise exception using errcode='22023', message='A submitted review and a reason are required.';
  end if;
  if exists(select 1 from public.crew_performance_results where employee_id = v_assignment.subject_id and period_start = v_assignment.period_start and status = 'finalized') then
    raise exception using errcode='55000', message='Finalized Performance evidence cannot be changed.';
  end if;
  insert into public.crew_peer_review_exclusions(assignment_id, reason, excluded_by)
  values(p_assignment_id, btrim(p_reason), auth.uid());
  perform public.crew_refresh_performance(v_assignment.subject_id, v_assignment.period_start);
  return jsonb_build_object('id', p_assignment_id, 'excluded', true);
end; $$;
revoke all on function public.crew_peer_review_exclude(uuid, text) from public, anon, authenticated;
grant execute on function public.crew_peer_review_exclude(uuid, text) to authenticated;

create or replace function public.crew_performance_model(p_employee_id uuid, p_period date)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_model text; v_position text;
begin
  select calculation_version into v_model from public.crew_performance_results
  where employee_id = p_employee_id and period_start = date_trunc('month', p_period)::date;
  if found then return v_model; end if;
  select position into v_position from public.employees where id = p_employee_id;
  if lower(btrim(coalesce(v_position, ''))) <> 'service crew' then return 'performance-v1'; end if;
  select calculation_version into v_model from public.crew_performance_model_periods
  where period_start <= date_trunc('month', p_period)::date order by period_start desc limit 1;
  return coalesce(v_model, 'performance-v1');
end; $$;
revoke all on function public.crew_performance_model(uuid, date) from public, anon, authenticated;

create or replace function public.crew_refresh_performance(p_employee_id uuid, p_period date)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare period date := date_trunc('month', p_period)::date; outlet uuid; attendance jsonb; customer jsonb;
  knowledge jsonb; peer jsonb; service_review public.crew_performance_reviews%rowtype;
  conduct_review public.crew_performance_reviews%rowtype; result_id uuid; total numeric;
  current_total numeric; state text; v_model text; v_components jsonb;
begin
  outlet := public.crew_growth_employee_outlet(p_employee_id);
  if outlet is null then raise exception using errcode='22023', message='Crew outlet is unavailable.'; end if;
  select id into result_id from public.crew_performance_results
  where employee_id = p_employee_id and period_start = period and status = 'finalized';
  if found then return result_id; end if;
  v_model := public.crew_performance_model(p_employee_id, period);
  attendance := public.crew_performance_attendance_component(p_employee_id, period);
  knowledge := public.crew_performance_knowledge_component(p_employee_id, period);
  select * into service_review from public.crew_performance_reviews
  where employee_id = p_employee_id and period_start = period and component = 'service'
  order by reviewed_at desc limit 1;
  if v_model = 'performance-v2' then
    peer := public.crew_peer_review_component(p_employee_id, period);
    customer := jsonb_build_object('score', null, 'max_score', 20, 'status', 'pending',
      'reason', 'google_review_authority_not_available', 'calculation_version', 'performance-v2');
    current_total := round(coalesce((attendance->>'score')::numeric, 0) + coalesce(service_review.score, 0) +
      coalesce((knowledge->>'score')::numeric, 0) + coalesce((peer->>'score')::numeric, 0), 2);
    v_components := jsonb_build_object('attendance', attendance,
      'service', case when service_review.id is null then jsonb_build_object('score', null, 'max_score', 30, 'status', 'review_required')
        else jsonb_build_object('score', service_review.score, 'max_score', 30, 'status', 'reviewed',
          'criteria', service_review.criteria, 'reviewed_at', service_review.reviewed_at,
          'calculation_version', service_review.calculation_version) end,
      'customer', customer, 'knowledge', knowledge, 'peer', peer);
    insert into public.crew_performance_results(employee_id, outlet_id, period_start, status,
      calculation_version, attendance_score, service_score, customer_score, knowledge_score,
      conduct_score, peer_score, current_score, total_score, components, computed_at)
    values(p_employee_id, outlet, period, 'review_required', 'performance-v2',
      (attendance->>'score')::numeric, service_review.score, null, (knowledge->>'score')::numeric,
      null, (peer->>'score')::numeric, current_total, null, v_components, now())
    on conflict(employee_id, period_start) do update set outlet_id = excluded.outlet_id,
      status = excluded.status, attendance_score = excluded.attendance_score,
      service_score = excluded.service_score, customer_score = null,
      knowledge_score = excluded.knowledge_score, conduct_score = null,
      peer_score = excluded.peer_score, current_score = excluded.current_score,
      total_score = null, components = excluded.components, computed_at = now()
    returning id into result_id;
    return result_id;
  end if;
  customer := public.crew_performance_customer_component(p_employee_id, period);
  select * into conduct_review from public.crew_performance_reviews
  where employee_id = p_employee_id and period_start = period and component = 'conduct'
  order by reviewed_at desc limit 1;
  state := case when service_review.id is null or conduct_review.id is null then 'review_required' else 'draft' end;
  current_total := round(coalesce((attendance->>'score')::numeric, 0) + coalesce(service_review.score, 0) +
    coalesce((customer->>'score')::numeric, 0) + coalesce((knowledge->>'score')::numeric, 0) + coalesce(conduct_review.score, 0), 2);
  total := case when service_review.id is null or conduct_review.id is null then null else current_total end;
  v_components := jsonb_build_object('attendance', attendance,
    'service', case when service_review.id is null then jsonb_build_object('score', null, 'max_score', 30, 'status', 'review_required', 'calculation_version', 'performance-v1')
      else jsonb_build_object('score', service_review.score, 'max_score', 30, 'status', 'reviewed',
        'criteria', service_review.criteria, 'reviewed_at', service_review.reviewed_at,
        'calculation_version', service_review.calculation_version) end,
    'customer', customer, 'knowledge', knowledge,
    'conduct', case when conduct_review.id is null then jsonb_build_object('score', null, 'max_score', 10, 'status', 'review_required', 'calculation_version', 'performance-v1')
      else jsonb_build_object('score', conduct_review.score, 'max_score', 10, 'status', 'reviewed',
        'criteria', conduct_review.criteria, 'reviewed_at', conduct_review.reviewed_at,
        'calculation_version', conduct_review.calculation_version) end);
  insert into public.crew_performance_results(employee_id, outlet_id, period_start, status,
    calculation_version, attendance_score, service_score, customer_score, knowledge_score,
    conduct_score, peer_score, current_score, total_score, components, computed_at)
  values(p_employee_id, outlet, period, state, 'performance-v1',
    (attendance->>'score')::numeric, service_review.score, (customer->>'score')::numeric,
    (knowledge->>'score')::numeric, conduct_review.score, null, current_total, total, v_components, now())
  on conflict(employee_id, period_start) do update set outlet_id = excluded.outlet_id,
    status = excluded.status, attendance_score = excluded.attendance_score,
    service_score = excluded.service_score, customer_score = excluded.customer_score,
    knowledge_score = excluded.knowledge_score, conduct_score = excluded.conduct_score,
    peer_score = null, current_score = excluded.current_score, total_score = excluded.total_score,
    components = excluded.components, computed_at = now()
  returning id into result_id;
  return result_id;
end; $$;
revoke all on function public.crew_refresh_performance(uuid, date) from public, anon, authenticated;

create or replace function public.crew_performance_finalize(p_employee_id uuid, p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date := date_trunc('month', p_period)::date; result public.crew_performance_results%rowtype; result_id uuid;
begin
  if not public.current_user_has_permission('crew_performance.finalize') then
    raise exception using errcode='42501', message='Performance finalization permission is required.';
  end if;
  if not public.current_user_can_access_outlet(public.crew_growth_employee_outlet(p_employee_id)) then
    raise exception using errcode='42501', message='Crew member is outside your outlet scope.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || period::text, 0));
  result_id := public.crew_refresh_performance(p_employee_id, period);
  select * into result from public.crew_performance_results where id = result_id for update;
  if result.status = 'finalized' then
    return jsonb_build_object('id', result.id, 'status', result.status,
      'total_score', result.total_score, 'finalized_at', result.finalized_at);
  end if;
  if result.calculation_version = 'performance-v2' then
    raise exception using errcode='22023', message='V2 Customer review evidence is pending; Performance cannot be finalized.';
  end if;
  if result.service_score is null or result.conduct_score is null or result.total_score is null then
    raise exception using errcode='22023', message='Service Standards and Conduct reviews are required before finalization.';
  end if;
  update public.crew_performance_results set status = 'finalized', finalized_at = now(),
    finalized_by = auth.uid() where id = result.id returning * into result;
  return jsonb_build_object('id', result.id, 'status', result.status,
    'total_score', result.total_score, 'finalized_at', result.finalized_at,
    'breakdown', result.components, 'calculation_version', result.calculation_version);
end; $$;
revoke all on function public.crew_performance_finalize(uuid, date) from public, anon, authenticated;
grant execute on function public.crew_performance_finalize(uuid, date) to authenticated;

create or replace function public.crew_performance_mobile(p_token text, p_period date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid; result_id uuid; result public.crew_performance_results%rowtype;
  trend jsonb; safe_components jsonb; scored_components integer := 0;
  total_components constant integer := 5; score_state text; pending_names jsonb;
begin
  employee := public.crew_session_employee(p_token);
  result_id := public.crew_refresh_performance(employee, p_period);
  select * into result from public.crew_performance_results where id = result_id;
  safe_components := jsonb_build_object('attendance', (result.components->'attendance') - 'manager_note',
    'service', (result.components->'service') - 'manager_note',
    'customer', (result.components->'customer') - 'moderation_reason',
    'knowledge', result.components->'knowledge');
  if result.calculation_version = 'performance-v2' then
    safe_components := safe_components || jsonb_build_object('peer', result.components->'peer');
  else
    safe_components := safe_components || jsonb_build_object('conduct', (result.components->'conduct') - 'manager_note');
  end if;
  select count(*) filter (where jsonb_typeof(value->'score') = 'number')::integer,
    coalesce(jsonb_agg(key order by key) filter (where jsonb_typeof(value->'score') is distinct from 'number'), '[]'::jsonb)
  into scored_components, pending_names
  from jsonb_each(safe_components);
  score_state := case when result.status = 'finalized' then 'finalized'
    when result.calculation_version = 'performance-v2' then case when scored_components > 0 then 'partial' else 'unavailable' end
    when result.total_score is not null then 'complete'
    when scored_components > 0 then 'partial' else 'unavailable' end;
  select coalesce(jsonb_agg(jsonb_build_object('period_start', period_start, 'score', total_score,
    'status', status) order by period_start), '[]'::jsonb)
  into trend from (select period_start, total_score, status from public.crew_performance_results
    where employee_id = employee and calculation_version = result.calculation_version
    order by period_start desc limit 6) x;
  return jsonb_build_object('period_start', result.period_start, 'status', result.status,
    'score', case when score_state = 'partial' then result.current_score
      when score_state in ('complete', 'finalized') then result.total_score else null end,
    'current_score', result.current_score, 'total_score', result.total_score,
    'score_state', score_state, 'scored_components', scored_components,
    'pending_components', total_components - scored_components,
    'pending_component_names', pending_names, 'total_components', total_components,
    'calculation_version', result.calculation_version, 'breakdown', safe_components,
    'trend', trend, 'updated_at', result.computed_at);
end; $$;
revoke all on function public.crew_performance_mobile(text, date) from public, anon, authenticated;
grant execute on function public.crew_performance_mobile(text, date) to anon, authenticated;

create or replace function public.crew_performance_admin_page(p_outlet_id uuid, p_period date,
  p_listing text, p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_source jsonb; v_rows jsonb; v_total integer;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_query text := coalesce(p_filters->>'query', '');
  v_position text := coalesce(p_filters->>'position', 'all');
  v_status text := coalesce(p_filters->>'status', 'all');
begin
  if p_listing not in ('review_queue', 'team') then
    raise exception using errcode='22023', message='Unsupported Performance listing.';
  end if;
  v_source := public.crew_performance_admin_data(p_outlet_id, p_period);
  with rows as (select value as row from jsonb_array_elements(coalesce(v_source->'crew', '[]'::jsonb))),
  classified as (
    select row, (row->'result'->'components'->'service'->>'status' = 'reviewed'
      and case when row->'result'->>'calculation_version' = 'performance-v2'
        then jsonb_typeof(row->'result'->'components'->'peer'->'score') = 'number'
        else row->'result'->'components'->'conduct'->>'status' = 'reviewed' end) as reviewed
    from rows
  ), filtered as (
    select row, reviewed from classified where
      (v_query = '' or concat_ws(' ', row->'employee'->>'full_name', row->'employee'->>'employee_code', row->'employee'->>'position') ilike '%' || v_query || '%')
      and (v_position = 'all' or row->'employee'->>'position' = v_position)
      and (v_status = 'all' or (v_status = 'awaiting' and not reviewed)
        or (v_status = 'reviewed' and reviewed)
        or (v_status = 'finalized' and row->'result'->>'status' = 'finalized'))
  ), numbered as (
    select row, row_number() over (order by
      case when p_listing = 'review_queue' then reviewed else false end,
      row->'employee'->>'full_name') as rn from filtered
  )
  select count(*)::integer,
    coalesce(jsonb_agg(row order by rn) filter (where rn > (v_page - 1) * v_size and rn <= v_page * v_size), '[]'::jsonb)
  into v_total, v_rows from numbered;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total,
    'page', v_page, 'page_size', v_size,
    'summary', jsonb_build_object('period_summary', coalesce(v_source->'summary', '{}'::jsonb),
      'scoring_framework', coalesce(v_source->'scoring_framework', '[]'::jsonb)));
end; $$;
revoke all on function public.crew_performance_admin_page(uuid, date, text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.crew_performance_admin_page(uuid, date, text, jsonb, integer, integer) to authenticated;
