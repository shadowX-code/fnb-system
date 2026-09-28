-- Team Review owns coworker eligibility, the review window, evidence and moderation.
-- The former Peer tables remain historical; current Performance consumes only
-- crew_team_review_performance_component.
create table public.crew_team_review_launch (
  singleton boolean primary key default true check (singleton),
  first_period date not null check (first_period = date_trunc('month', first_period)::date)
);
insert into public.crew_team_review_launch(singleton, first_period)
values (true, date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date);

create table public.crew_team_review_periods (
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  opens_at timestamptz,
  closes_at timestamptz,
  frozen_at timestamptz,
  primary key (outlet_id, period_start)
);
create table public.crew_team_review_window_events (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null,
  action text not null check (action in ('open_early', 'close_early', 'extend_deadline')),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  before_window jsonb not null,
  after_window jsonb not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (outlet_id, period_start) references public.crew_team_review_periods(outlet_id, period_start)
);
create table public.crew_team_review_subjects (
  outlet_id uuid not null,
  period_start date not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  primary key (outlet_id, period_start, employee_id),
  foreign key (outlet_id, period_start) references public.crew_team_review_periods(outlet_id, period_start)
);
create table public.crew_team_review_eligible_pairs (
  outlet_id uuid not null,
  period_start date not null,
  subject_id uuid not null,
  reviewer_id uuid not null,
  roster_overlap boolean not null,
  attendance_overlap_count integer not null check (attendance_overlap_count > 0),
  primary key (outlet_id, period_start, subject_id, reviewer_id),
  foreign key (outlet_id, period_start) references public.crew_team_review_periods(outlet_id, period_start),
  check (subject_id <> reviewer_id)
);
create table public.crew_team_reviews (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null,
  subject_id uuid not null references public.employees(id) on delete restrict,
  reviewer_id uuid not null references public.employees(id) on delete restrict,
  criteria jsonb not null,
  internal_comment text check (char_length(internal_comment) <= 1000),
  submitted_at timestamptz not null default now(),
  unique (subject_id, reviewer_id, period_start),
  check (subject_id <> reviewer_id),
  check (period_start = date_trunc('month', period_start)::date)
);
create index crew_team_reviews_subject_period_idx on public.crew_team_reviews(subject_id, period_start);
create index crew_team_reviews_reviewer_period_idx on public.crew_team_reviews(reviewer_id, period_start);
create table public.crew_team_review_exclusions (
  review_id uuid primary key references public.crew_team_reviews(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  excluded_by uuid not null references auth.users(id),
  excluded_at timestamptz not null default now()
);
create table public.crew_team_admin_reviews (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null,
  subject_id uuid not null references public.employees(id) on delete restrict,
  criteria jsonb not null,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  unique (subject_id, period_start)
);
alter table public.crew_team_review_launch enable row level security;
alter table public.crew_team_review_periods enable row level security;
alter table public.crew_team_review_window_events enable row level security;
alter table public.crew_team_review_subjects enable row level security;
alter table public.crew_team_review_eligible_pairs enable row level security;
alter table public.crew_team_reviews enable row level security;
alter table public.crew_team_review_exclusions enable row level security;
alter table public.crew_team_admin_reviews enable row level security;
revoke all on public.crew_team_review_launch, public.crew_team_review_periods,
  public.crew_team_review_window_events, public.crew_team_review_subjects,
  public.crew_team_review_eligible_pairs, public.crew_team_reviews,
  public.crew_team_review_exclusions, public.crew_team_admin_reviews
  from public, anon, authenticated;

create function public.crew_team_review_mean(p_criteria jsonb)
returns numeric language plpgsql immutable set search_path=public as $$
declare v_key text; v_total integer := 0;
begin
  if jsonb_typeof(p_criteria) <> 'object' or
    (select array_agg(key order by key) from jsonb_object_keys(p_criteria) key) is distinct from
      array['communication','reliability','teamwork','work_attitude'] then
    raise exception using errcode='22023', message='All four Team Review ratings are required.';
  end if;
  for v_key in select jsonb_object_keys(p_criteria) loop
    if jsonb_typeof(p_criteria->v_key) <> 'number' or (p_criteria->>v_key) !~ '^[1-5]$' then
      raise exception using errcode='22023', message='Team Review ratings must be whole numbers from 1 to 5.';
    end if;
    v_total := v_total + (p_criteria->>v_key)::integer;
  end loop;
  return v_total::numeric / 4;
end; $$;
revoke all on function public.crew_team_review_mean(jsonb) from public, anon, authenticated;
alter table public.crew_team_reviews add constraint crew_team_reviews_criteria_valid
  check (public.crew_team_review_mean(criteria) between 1 and 5);
alter table public.crew_team_admin_reviews add constraint crew_team_admin_reviews_criteria_valid
  check (public.crew_team_review_mean(criteria) between 1 and 5);

create function public.crew_team_review_live_subjects(p_outlet_id uuid, p_period date)
returns table(employee_id uuid) language sql stable security definer set search_path=public as $$
  select distinct a.employee_id from public.crew_attendance_records a
  join public.employees e on e.id=a.employee_id
  join public.crew_access ca on ca.employee_id=e.id
  where a.outlet_id=p_outlet_id and a.status='completed' and a.clock_in_at is not null
    and a.clock_out_at is not null
    and a.clock_in_at < ((date_trunc('month',p_period)::date+interval '1 month') at time zone 'Asia/Kuala_Lumpur')
    and a.clock_out_at > (date_trunc('month',p_period)::date at time zone 'Asia/Kuala_Lumpur')
    and lower(btrim(e.position))='service crew' and e.is_active
    and coalesce(e.employment_status,'active') not in ('resigned','terminated')
    and ca.access_state='active';
$$;
revoke all on function public.crew_team_review_live_subjects(uuid,date) from public, anon, authenticated;

-- Actual overlapping attendance is mandatory. Published roster overlap is
-- retained as supporting evidence, never a roster-only eligibility shortcut.
create function public.crew_team_review_live_pairs(p_outlet_id uuid, p_period date)
returns table(subject_id uuid, reviewer_id uuid, roster_overlap boolean, attendance_overlap_count integer)
language sql stable security definer set search_path=public as $$
  select a.employee_id, b.employee_id,
    bool_or(exists (
      select 1 from public.duty_roster_published_entries ra
      join public.duty_roster_published_entries rb on rb.outlet_id=ra.outlet_id
        and rb.roster_date=ra.roster_date and rb.employee_id=b.employee_id
      where ra.outlet_id=p_outlet_id and ra.employee_id=a.employee_id
        and ra.entry_type='working' and rb.entry_type='working'
        and ra.start_time is not null and rb.start_time is not null
        and ra.roster_date between date_trunc('month',p_period)::date
          and (date_trunc('month',p_period)::date+interval '1 month'-interval '1 day')::date
        and ra.publication_id=(select p.id from public.duty_roster_publications p
          where p.outlet_id=p_outlet_id and ra.roster_date between p.week_start_date and p.week_end_date
          order by p.revision desc,p.published_at desc limit 1)
        and rb.publication_id=ra.publication_id
        and ((ra.roster_date+ra.start_time) at time zone 'Asia/Kuala_Lumpur') <
          ((rb.roster_date+rb.end_time+case when rb.end_time<=rb.start_time then interval '1 day' else interval '0 day' end) at time zone 'Asia/Kuala_Lumpur')
        and ((rb.roster_date+rb.start_time) at time zone 'Asia/Kuala_Lumpur') <
          ((ra.roster_date+ra.end_time+case when ra.end_time<=ra.start_time then interval '1 day' else interval '0 day' end) at time zone 'Asia/Kuala_Lumpur')
    )) as roster_overlap,
    count(*)::integer as attendance_overlap_count
  from public.crew_attendance_records a
  join public.crew_attendance_records b on b.outlet_id=a.outlet_id and b.employee_id<>a.employee_id
    and b.status='completed' and b.clock_in_at is not null and b.clock_out_at is not null
    and b.clock_in_at<a.clock_out_at and b.clock_out_at>a.clock_in_at
  join public.crew_team_review_live_subjects(p_outlet_id,p_period) sa on sa.employee_id=a.employee_id
  join public.crew_team_review_live_subjects(p_outlet_id,p_period) sb on sb.employee_id=b.employee_id
  where a.outlet_id=p_outlet_id and a.status='completed' and a.clock_in_at is not null
    and a.clock_out_at is not null
    and greatest(a.clock_in_at,b.clock_in_at,date_trunc('month',p_period)::date at time zone 'Asia/Kuala_Lumpur') <
      least(a.clock_out_at,b.clock_out_at,(date_trunc('month',p_period)::date+interval '1 month') at time zone 'Asia/Kuala_Lumpur')
  group by a.employee_id,b.employee_id;
$$;
revoke all on function public.crew_team_review_live_pairs(uuid,date) from public, anon, authenticated;

create function public.crew_team_review_window(p_outlet_id uuid,p_period date)
returns table(open_at timestamptz, close_at timestamptz, state text, frozen boolean)
language plpgsql stable security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_first date;
begin
  select first_period into v_first from public.crew_team_review_launch where singleton;
  if v_period<v_first then
    return query select null::timestamptz,null::timestamptz,'unavailable'::text,false;
    return;
  end if;
  return query select
    coalesce(w.opens_at,(v_period+interval '1 month'-interval '3 days') at time zone 'Asia/Kuala_Lumpur'),
    coalesce(w.closes_at,(v_period+interval '1 month'+interval '2 days') at time zone 'Asia/Kuala_Lumpur'),
    case when now()<coalesce(w.opens_at,(v_period+interval '1 month'-interval '3 days') at time zone 'Asia/Kuala_Lumpur') then 'upcoming'
      when now()<coalesce(w.closes_at,(v_period+interval '1 month'+interval '2 days') at time zone 'Asia/Kuala_Lumpur') then 'open'
      else 'closed' end,
    w.frozen_at is not null
  from (select 1) seed left join public.crew_team_review_periods w
    on w.outlet_id=p_outlet_id and w.period_start=v_period;
end; $$;
revoke all on function public.crew_team_review_window(uuid,date) from public, anon, authenticated;

create function public.crew_team_review_freeze(p_outlet_id uuid,p_period date)
returns boolean language plpgsql volatile security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_window record; v_frozen timestamptz; v_subject record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text||v_period::text||'team-review',0));
  select * into v_window from public.crew_team_review_window(p_outlet_id,v_period);
  if v_window.state<>'closed' then return false; end if;
  insert into public.crew_team_review_periods(outlet_id,period_start) values(p_outlet_id,v_period)
    on conflict do nothing;
  select frozen_at into v_frozen from public.crew_team_review_periods
    where outlet_id=p_outlet_id and period_start=v_period for update;
  if v_frozen is not null then return false; end if;
  insert into public.crew_team_review_subjects(outlet_id,period_start,employee_id)
    select p_outlet_id,v_period,s.employee_id from public.crew_team_review_live_subjects(p_outlet_id,v_period) s;
  insert into public.crew_team_review_eligible_pairs(outlet_id,period_start,subject_id,reviewer_id,roster_overlap,attendance_overlap_count)
    select p_outlet_id,v_period,p.subject_id,p.reviewer_id,p.roster_overlap,p.attendance_overlap_count
    from public.crew_team_review_live_pairs(p_outlet_id,v_period) p;
  update public.crew_team_review_periods set frozen_at=now()
    where outlet_id=p_outlet_id and period_start=v_period;
  for v_subject in select employee_id from public.crew_team_review_subjects
    where outlet_id=p_outlet_id and period_start=v_period loop
    perform public.crew_refresh_performance(v_subject.employee_id,v_period);
  end loop;
  return true;
end; $$;
revoke all on function public.crew_team_review_freeze(uuid,date) from public, anon, authenticated;

create function public.crew_team_review_freeze_due()
returns integer language plpgsql volatile security definer set search_path=public as $$
declare v_period date; v_outlet record; v_count integer:=0; v_first date;
begin
  select first_period into v_first from public.crew_team_review_launch where singleton;
  for v_period in select date_trunc('month',timezone('Asia/Kuala_Lumpur',now())::date-(n||' month')::interval)::date
    from generate_series(0,2) n loop
    if v_period<v_first then continue; end if;
    for v_outlet in select id from public.outlets loop
      if public.crew_team_review_freeze(v_outlet.id,v_period) then v_count:=v_count+1; end if;
    end loop;
  end loop;
  for v_outlet in select outlet_id,period_start from public.crew_team_review_periods
    where frozen_at is null loop
    if public.crew_team_review_freeze(v_outlet.outlet_id,v_outlet.period_start) then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end; $$;
revoke all on function public.crew_team_review_freeze_due() from public, anon, authenticated;

create function public.crew_team_review_window_control(p_outlet_id uuid,p_period date,p_action text,p_deadline date,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_before record; v_after record; v_now timestamptz:=now();
begin
  if not public.current_user_has_permission('crew_performance.review')
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Team Review permission is required for this outlet.';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception using errcode='22023',message='A reason of at least 10 characters is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text||v_period::text||'team-review',0));
  select * into v_before from public.crew_team_review_window(p_outlet_id,v_period);
  if v_before.state='unavailable' or v_before.frozen then
    raise exception using errcode='22023',message='This Team Review month is closed.';
  end if;
  insert into public.crew_team_review_periods(outlet_id,period_start) values(p_outlet_id,v_period)
    on conflict do nothing;
  if p_action='open_early' and v_before.state='upcoming' then
    update public.crew_team_review_periods set opens_at=v_now where outlet_id=p_outlet_id and period_start=v_period;
  elsif p_action='close_early' and v_before.state='open' then
    update public.crew_team_review_periods set closes_at=v_now where outlet_id=p_outlet_id and period_start=v_period;
  elsif p_action='extend_deadline' and v_before.state='open' and p_deadline is not null
    and ((p_deadline+1) at time zone 'Asia/Kuala_Lumpur')>v_before.close_at then
    update public.crew_team_review_periods set closes_at=((p_deadline+1) at time zone 'Asia/Kuala_Lumpur')
      where outlet_id=p_outlet_id and period_start=v_period;
  else
    raise exception using errcode='22023',message='The requested Team Review window change is unavailable.';
  end if;
  select * into v_after from public.crew_team_review_window(p_outlet_id,v_period);
  insert into public.crew_team_review_window_events(outlet_id,period_start,action,reason,before_window,after_window,actor_id)
    values(p_outlet_id,v_period,p_action,btrim(p_reason),to_jsonb(v_before),to_jsonb(v_after),auth.uid());
  if p_action='close_early' then perform public.crew_team_review_freeze(p_outlet_id,v_period); end if;
  return to_jsonb(v_after);
end; $$;
revoke all on function public.crew_team_review_window_control(uuid,date,text,date,text) from public, anon, authenticated;
grant execute on function public.crew_team_review_window_control(uuid,date,text,date,text) to authenticated;

create function public.crew_team_review_result(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_outlet uuid;
  v_window record; v_count integer:=0; v_eligible integer:=0; v_score numeric;
  v_dimensions jsonb; v_admin public.crew_team_admin_reviews%rowtype; v_status text;
begin
  v_outlet:=public.crew_growth_employee_outlet(p_employee_id);
  if v_outlet is null then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','no_outlet');
  end if;
  select * into v_window from public.crew_team_review_window(v_outlet,v_period);
  if v_window.state='unavailable' then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','window_not_open','completed',0);
  end if;
  if v_window.state='closed' and not v_window.frozen then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','freeze_pending','completed',0);
  end if;
  if v_window.frozen and not exists(select 1 from public.crew_team_review_subjects
    where outlet_id=v_outlet and period_start=v_period and employee_id=p_employee_id) then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','no_work_evidence','completed',0);
  end if;
  if not v_window.frozen and not exists(select 1 from public.crew_team_review_live_subjects(v_outlet,v_period)
    where employee_id=p_employee_id) then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','no_work_evidence','completed',0);
  end if;
  if v_window.frozen then
    select count(*) into v_eligible from public.crew_team_review_eligible_pairs
      where outlet_id=v_outlet and period_start=v_period and subject_id=p_employee_id;
  else
    select count(*) into v_eligible from public.crew_team_review_live_pairs(v_outlet,v_period)
      where subject_id=p_employee_id;
  end if;
  if v_window.state='upcoming' then
    return jsonb_build_object('score',null,'max_score',5,'status','pending',
      'reason','window_not_open','completed',0,'eligible_teammates',v_eligible);
  end if;
  with eligible as (
    select reviewer_id from public.crew_team_review_eligible_pairs
      where v_window.frozen and outlet_id=v_outlet and period_start=v_period and subject_id=p_employee_id
    union all
    select reviewer_id from public.crew_team_review_live_pairs(v_outlet,v_period)
      where not v_window.frozen and subject_id=p_employee_id
  ), valid as (
    select r.criteria from public.crew_team_reviews r join eligible e on e.reviewer_id=r.reviewer_id
    left join public.crew_team_review_exclusions x on x.review_id=r.id
    where r.subject_id=p_employee_id and r.outlet_id=v_outlet and r.period_start=v_period
      and x.review_id is null
  )
  select count(*)::integer,round(avg(public.crew_team_review_mean(criteria)),2),
    jsonb_build_object('teamwork',round(avg((criteria->>'teamwork')::numeric),2),
      'reliability',round(avg((criteria->>'reliability')::numeric),2),
      'communication',round(avg((criteria->>'communication')::numeric),2),
      'work_attitude',round(avg((criteria->>'work_attitude')::numeric),2))
    into v_count,v_score,v_dimensions from valid;
  if v_window.state='open' then v_status:='provisional';
  elsif v_count>0 then v_status:='ready';
  else v_status:='admin_review_required'; end if;
  if v_window.state='closed' and v_count=0 then
    select * into v_admin from public.crew_team_admin_reviews
      where subject_id=p_employee_id and period_start=v_period and outlet_id=v_outlet;
    if found then
      v_status:='ready'; v_score:=public.crew_team_review_mean(v_admin.criteria);
      v_dimensions:=v_admin.criteria; -- One Admin assessment is its dimension aggregate.
    end if;
  end if;
  return jsonb_build_object('score',v_score,'max_score',5,'status',v_status,
    'source',case when v_admin.id is not null then 'admin' when v_count>0 then 'crew' else null end,
    'completed',v_count,'eligible_teammates',v_eligible,'dimensions',v_dimensions,
    'calculation_version','team-review-v1');
end; $$;
revoke all on function public.crew_team_review_result(uuid,date) from public, anon, authenticated;

-- The Performance adapter deliberately withholds provisional points.
create function public.crew_team_review_performance_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb:=public.crew_team_review_result(p_employee_id,p_period);
begin
  return jsonb_build_object('score',case when v_result->>'status'='ready' then v_result->'score' else 'null'::jsonb end,
    'max_score',5,'status',case when v_result->>'status'='ready' then 'scored' else 'pending' end,
    'reason',case when v_result->>'status'='ready' then null else v_result->>'status' end,
    'dimensions',case when v_result->>'status'='ready' then v_result->'dimensions' else null end,
    'calculation_version','team-review-v1');
end; $$;
revoke all on function public.crew_team_review_performance_component(uuid,date) from public, anon, authenticated;

create function public.crew_team_review_mobile(p_token text,p_period date default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee uuid:=public.crew_session_employee(p_token);
  v_period date:=date_trunc('month',coalesce(p_period,timezone('Asia/Kuala_Lumpur',now())::date))::date;
  v_outlet uuid:=public.crew_growth_employee_outlet(v_employee); v_window record;
  v_teammates jsonb:='[]'::jsonb; v_completed integer:=0; v_total integer:=0;
begin
  if v_outlet is null then return jsonb_build_object('open',false,'teammates','[]'::jsonb,'completed',0,'total',0); end if;
  if p_period is null then
    select candidate.period_start into v_period from (
      select date_trunc('month',timezone('Asia/Kuala_Lumpur',now())::date)::date period_start
      union select date_trunc('month',timezone('Asia/Kuala_Lumpur',now())::date-interval '1 month')::date
      union select period_start from public.crew_team_review_periods where outlet_id=v_outlet
    ) candidate cross join lateral public.crew_team_review_window(v_outlet,candidate.period_start) window_state
    where window_state.state='open'
    order by case when exists(select 1 from public.crew_team_review_live_pairs(v_outlet,candidate.period_start) pair
      where pair.reviewer_id=v_employee and not exists(select 1 from public.crew_team_reviews review
        where review.subject_id=pair.subject_id and review.reviewer_id=v_employee
          and review.period_start=candidate.period_start)) then 0 else 1 end,
      candidate.period_start limit 1;
    v_period:=coalesce(v_period,date_trunc('month',timezone('Asia/Kuala_Lumpur',now())::date)::date);
  end if;
  select * into v_window from public.crew_team_review_window(v_outlet,v_period);
  if v_window.state='open' then
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,
      'position',e.position,'reviewed',r.id is not null) order by e.full_name),'[]'::jsonb),
      count(*) filter(where r.id is not null)::integer,count(*)::integer
      into v_teammates,v_completed,v_total
      from public.crew_team_review_live_pairs(v_outlet,v_period) p
      join public.employees e on e.id=p.subject_id
      left join public.crew_team_reviews r on r.subject_id=p.subject_id
        and r.reviewer_id=v_employee and r.period_start=v_period
      where p.reviewer_id=v_employee;
  end if;
  return jsonb_build_object('period_start',v_period,'open',v_window.state='open',
    'deadline',v_window.close_at,'teammates',v_teammates,'completed',v_completed,'total',v_total);
end; $$;
revoke all on function public.crew_team_review_mobile(text,date) from public, anon, authenticated;
grant execute on function public.crew_team_review_mobile(text,date) to anon, authenticated;

create function public.crew_team_review_submit(p_token text,p_period date,p_subject_id uuid,p_criteria jsonb,p_comment text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_reviewer uuid:=public.crew_session_employee(p_token);
  v_outlet uuid:=public.crew_growth_employee_outlet(v_reviewer);
  v_period date:=date_trunc('month',p_period)::date;
  v_window record; v_id uuid;
begin
  if v_outlet is null or p_subject_id=v_reviewer then
    raise exception using errcode='42501',message='Team Review teammate is unavailable.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_outlet::text||v_period::text||'team-review',0));
  select * into v_window from public.crew_team_review_window(v_outlet,v_period);
  if v_window.state<>'open' then raise exception using errcode='22023',message='Team Review is closed.'; end if;
  if not exists(select 1 from public.crew_team_review_live_pairs(v_outlet,v_period)
    where subject_id=p_subject_id and reviewer_id=v_reviewer) then
    raise exception using errcode='42501',message='This teammate is not eligible for review.';
  end if;
  if exists(select 1 from public.crew_performance_results
    where employee_id=p_subject_id and period_start=v_period and status='finalized') then
    raise exception using errcode='55000',message='Finalized Performance evidence cannot be changed.';
  end if;
  perform public.crew_team_review_mean(p_criteria);
  if char_length(coalesce(p_comment,''))>1000 then
    raise exception using errcode='22023',message='Comment is too long.';
  end if;
  insert into public.crew_team_reviews(outlet_id,period_start,subject_id,reviewer_id,criteria,internal_comment)
    values(v_outlet,v_period,p_subject_id,v_reviewer,p_criteria,nullif(btrim(p_comment),''))
    on conflict(subject_id,reviewer_id,period_start) do nothing returning id into v_id;
  if v_id is null then raise exception using errcode='22023',message='You have already reviewed this teammate.'; end if;
  return jsonb_build_object('id',v_id,'submitted',true);
end; $$;
revoke all on function public.crew_team_review_submit(text,date,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.crew_team_review_submit(text,date,uuid,jsonb,text) to anon, authenticated;

create function public.crew_team_review_admin(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_window record;
  v_rows jsonb; v_reviews jsonb; v_admin_reviews jsonb; v_events jsonb; v_eligible integer; v_received integer;
  v_ready integer; v_needs_admin integer;
begin
  if not public.current_user_has_permission('crew_performance.review')
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Team Review evidence is unavailable.';
  end if;
  select * into v_window from public.crew_team_review_window(p_outlet_id,v_period);
  with subjects as (
    select employee_id from public.crew_team_review_subjects
      where v_window.frozen and outlet_id=p_outlet_id and period_start=v_period
    union all select employee_id from public.crew_team_review_live_subjects(p_outlet_id,v_period)
      where not v_window.frozen
  ), scored as (
    select e.id,e.full_name,public.crew_team_review_result(e.id,v_period) result
    from subjects s join public.employees e on e.id=s.employee_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',id,'employee_name',full_name,
      'eligible_teammates',coalesce((result->>'eligible_teammates')::integer,0),
      'reviews_received',coalesce((result->>'completed')::integer,0),
      'score',result->'score','source',result->'source','status',result->>'status')
      order by full_name),'[]'::jsonb),count(*)::integer,
    coalesce(sum((result->>'completed')::integer),0)::integer,
    count(*) filter(where result->>'status'='ready')::integer,
    count(*) filter(where result->>'status'='admin_review_required')::integer
    into v_rows,v_eligible,v_received,v_ready,v_needs_admin from scored;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'subject_id',r.subject_id,
    'subject_name',s.full_name,'reviewer_name',reviewer.full_name,'criteria',r.criteria,
    'comment',r.internal_comment,'submitted_at',r.submitted_at,
    'excluded_at',x.excluded_at,'exclusion_reason',x.reason,
    'excluded_by_name',case when x.review_id is not null then coalesce(excluded_actor.full_name,'Admin') end,
    'eligible',case when v_window.frozen then exists(select 1 from public.crew_team_review_eligible_pairs p
      where p.outlet_id=p_outlet_id and p.period_start=v_period and p.subject_id=r.subject_id and p.reviewer_id=r.reviewer_id)
      else exists(select 1 from public.crew_team_review_live_pairs(p_outlet_id,v_period) p
        where p.subject_id=r.subject_id and p.reviewer_id=r.reviewer_id) end,
    'work_evidence',case when v_window.frozen then
      (select jsonb_build_object('attendance_overlaps',p.attendance_overlap_count,'roster_overlap',p.roster_overlap)
        from public.crew_team_review_eligible_pairs p where p.outlet_id=p_outlet_id and p.period_start=v_period
          and p.subject_id=r.subject_id and p.reviewer_id=r.reviewer_id)
      else (select jsonb_build_object('attendance_overlaps',p.attendance_overlap_count,'roster_overlap',p.roster_overlap)
        from public.crew_team_review_live_pairs(p_outlet_id,v_period) p
        where p.subject_id=r.subject_id and p.reviewer_id=r.reviewer_id) end)
    order by s.full_name,reviewer.full_name),'[]'::jsonb)
    into v_reviews from public.crew_team_reviews r
    join public.employees s on s.id=r.subject_id
    join public.employees reviewer on reviewer.id=r.reviewer_id
    left join public.crew_team_review_exclusions x on x.review_id=r.id
    left join public.employees excluded_actor on excluded_actor.auth_user_id=x.excluded_by
    where r.outlet_id=p_outlet_id and r.period_start=v_period;
  select coalesce(jsonb_agg(jsonb_build_object('subject_id',a.subject_id,'criteria',a.criteria,
    'reviewed_at',a.reviewed_at,'reviewed_by_name',coalesce(actor.full_name,'Admin'))
    order by a.reviewed_at),'[]'::jsonb) into v_admin_reviews
    from public.crew_team_admin_reviews a
    left join public.employees actor on actor.auth_user_id=a.reviewed_by
    where a.outlet_id=p_outlet_id and a.period_start=v_period;
  select coalesce(jsonb_agg(jsonb_build_object('action',w.action,'reason',w.reason,
    'actor_name',coalesce(actor.full_name,'Admin'),'created_at',w.created_at,
    'before',w.before_window,'after',w.after_window)
    order by w.created_at),'[]'::jsonb) into v_events
    from public.crew_team_review_window_events w
    left join public.employees actor on actor.auth_user_id=w.actor_id
    where w.outlet_id=p_outlet_id and w.period_start=v_period;
  return jsonb_build_object('period_start',v_period,
    'window',jsonb_build_object('opens_at',v_window.open_at,'closes_at',v_window.close_at,
      'status',v_window.state,'frozen',v_window.frozen),
    'summary',jsonb_build_object('eligible_crew',v_eligible,'reviews_received',v_received,
      'ready',v_ready,'admin_required',v_needs_admin),
    'employees',v_rows,'reviews',v_reviews,'admin_reviews',v_admin_reviews,'window_events',v_events);
end; $$;
revoke all on function public.crew_team_review_admin(uuid,date) from public, anon, authenticated;
grant execute on function public.crew_team_review_admin(uuid,date) to authenticated;

create function public.crew_team_review_exclude(p_review_id uuid,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_review public.crew_team_reviews%rowtype;
begin
  select * into v_review from public.crew_team_reviews where id=p_review_id;
  if not found or not public.current_user_has_permission('crew_performance.review')
    or not public.current_user_can_access_outlet(v_review.outlet_id) then
    raise exception using errcode='42501',message='Team Review evidence is unavailable.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_review.outlet_id::text||v_review.period_start::text||'team-review',0));
  select * into v_review from public.crew_team_reviews where id=p_review_id for update;
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception using errcode='22023',message='An exclusion reason is required.';
  end if;
  if exists(select 1 from public.crew_performance_results
    where employee_id=v_review.subject_id and period_start=v_review.period_start and status='finalized') then
    raise exception using errcode='55000',message='Finalized Performance evidence cannot be changed.';
  end if;
  insert into public.crew_team_review_exclusions(review_id,reason,excluded_by)
    values(p_review_id,btrim(p_reason),auth.uid());
  perform public.crew_refresh_performance(v_review.subject_id,v_review.period_start);
  return jsonb_build_object('id',p_review_id,'excluded',true);
end; $$;
revoke all on function public.crew_team_review_exclude(uuid,text) from public, anon, authenticated;
grant execute on function public.crew_team_review_exclude(uuid,text) to authenticated;

create function public.crew_team_review_admin_assess(p_employee_id uuid,p_period date,p_criteria jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_outlet uuid;
  v_window record; v_result jsonb; v_id uuid;
begin
  v_outlet:=public.crew_growth_employee_outlet(p_employee_id);
  if v_outlet is null or not public.current_user_has_permission('crew_performance.review')
    or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='Team Review permission is required for this outlet.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_outlet::text||v_period::text||'team-review',0));
  select * into v_window from public.crew_team_review_window(v_outlet,v_period);
  if v_window.state<>'closed' or not v_window.frozen then
    raise exception using errcode='22023',message='Admin Review is available after the Team Review window closes.';
  end if;
  if not exists(select 1 from public.crew_team_review_subjects
    where outlet_id=v_outlet and period_start=v_period and employee_id=p_employee_id) then
    raise exception using errcode='22023',message='This Crew member has no Team Review work evidence.';
  end if;
  v_result:=public.crew_team_review_result(p_employee_id,v_period);
  if (v_result->>'completed')::integer>0 or v_result->>'status'<>'admin_review_required' then
    raise exception using errcode='22023',message='Admin Review is not required for this Crew member.';
  end if;
  if exists(select 1 from public.crew_performance_results
    where employee_id=p_employee_id and period_start=v_period and status='finalized') then
    raise exception using errcode='55000',message='Finalized Performance evidence cannot be changed.';
  end if;
  perform public.crew_team_review_mean(p_criteria);
  insert into public.crew_team_admin_reviews(outlet_id,period_start,subject_id,criteria,reviewed_by)
    values(v_outlet,v_period,p_employee_id,p_criteria,auth.uid()) returning id into v_id;
  perform public.crew_refresh_performance(p_employee_id,v_period);
  return jsonb_build_object('id',v_id,'submitted',true);
end; $$;
revoke all on function public.crew_team_review_admin_assess(uuid,date,jsonb) from public, anon, authenticated;
grant execute on function public.crew_team_review_admin_assess(uuid,date,jsonb) to authenticated;

-- Existing Peer RPCs cannot remain alternative current write/read authorities.
revoke execute on function public.crew_peer_open_month(uuid,date) from authenticated;
revoke execute on function public.crew_peer_review_mobile(text,date) from anon, authenticated;
revoke execute on function public.crew_peer_review_submit(text,uuid,jsonb) from anon, authenticated;
revoke execute on function public.crew_peer_review_admin(uuid,date) from authenticated;
revoke execute on function public.crew_peer_review_exclude(uuid,text) from authenticated;

create or replace function public.crew_refresh_performance(p_employee_id uuid,p_period date)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; outlet uuid; attendance jsonb;
  knowledge jsonb; team_review jsonb; service_review public.crew_performance_reviews%rowtype;
  result_id uuid; current_total numeric; v_components jsonb;
begin
  if public.crew_performance_model(p_employee_id,period) is distinct from 'performance-v2' then
    return null;
  end if;
  outlet:=public.crew_growth_employee_outlet(p_employee_id);
  if outlet is null then return null; end if;
  select id into result_id from public.crew_performance_results
    where employee_id=p_employee_id and period_start=period and status='finalized';
  if found then return result_id; end if;
  attendance:=public.crew_performance_attendance_component(p_employee_id,period);
  knowledge:=public.crew_performance_knowledge_component(p_employee_id,period);
  team_review:=public.crew_team_review_performance_component(p_employee_id,period);
  select * into service_review from public.crew_performance_reviews
    where employee_id=p_employee_id and period_start=period and component='service'
    order by reviewed_at desc limit 1;
  current_total:=round(coalesce((attendance->>'score')::numeric,0)+coalesce(service_review.score,0)
    +coalesce((knowledge->>'score')::numeric,0)+coalesce((team_review->>'score')::numeric,0),2);
  v_components:=jsonb_build_object('attendance',attendance,
    'service',case when service_review.id is null then
      jsonb_build_object('score',null,'max_score',30,'status','review_required')
      else jsonb_build_object('score',service_review.score,'max_score',30,'status','reviewed',
        'criteria',service_review.criteria,'reviewed_at',service_review.reviewed_at,
        'calculation_version',service_review.calculation_version) end,
    'customer',jsonb_build_object('score',null,'max_score',20,'status','pending',
      'reason','google_review_authority_not_available','calculation_version','performance-v2'),
    'knowledge',knowledge,'peer',team_review);
  insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,
    calculation_version,attendance_score,service_score,customer_score,knowledge_score,
    conduct_score,peer_score,current_score,total_score,components,computed_at)
  values(p_employee_id,outlet,period,'review_required','performance-v2',
    (attendance->>'score')::numeric,service_review.score,null,(knowledge->>'score')::numeric,
    null,(team_review->>'score')::numeric,current_total,null,v_components,now())
  on conflict(employee_id,period_start) do update set outlet_id=excluded.outlet_id,
    status=excluded.status,calculation_version='performance-v2',
    attendance_score=excluded.attendance_score,service_score=excluded.service_score,
    customer_score=null,knowledge_score=excluded.knowledge_score,conduct_score=null,
    peer_score=excluded.peer_score,current_score=excluded.current_score,total_score=null,
    components=excluded.components,computed_at=now()
  returning id into result_id;
  return result_id;
end; $$;
revoke all on function public.crew_refresh_performance(uuid,date) from public, anon, authenticated;

do $$
declare v_job bigint;
begin
  if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron')
    or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
    or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception 'Team Review requires the existing pg_cron scheduler.';
  end if;
  for v_job in execute 'select jobid from cron.job where jobname=$1' using 'feedx_team_review_freeze' loop
    execute 'select cron.unschedule($1)' using v_job;
  end loop;
  execute 'select cron.schedule($1,$2,$3)'
    using 'feedx_team_review_freeze','* * * * *','select public.crew_team_review_freeze_due()';
end; $$;
