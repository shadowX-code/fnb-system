-- Payroll Phase 2: time evidence and decisions only. No wage or statutory amounts.
-- Source records remain owned by Roster, Attendance and Leave.

create table public.payroll_payable_time_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.payroll_profiles(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  revision integer not null check (revision > 0),
  supersedes_id uuid references public.payroll_payable_time_versions(id) on delete restrict,
  source_fingerprint text not null,
  evidence jsonb not null,
  issue_codes text[] not null default '{}',
  classification text not null check (classification in
    ('regular','overtime','rest_day','public_holiday','public_holiday_ot','non_payable','leave')),
  scheduled_minutes integer check (scheduled_minutes >= 0),
  actual_minutes integer check (actual_minutes >= 0),
  proposed_minutes integer check (proposed_minutes >= 0),
  approved_minutes integer check (approved_minutes >= 0),
  approved_extra_minutes integer not null default 0 check (approved_extra_minutes >= 0),
  status text not null check (status in ('review_required','approved_auto','approved_manual','non_payable')),
  decision_reason text,
  actor_employee_id uuid not null references public.employees(id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  unique (profile_id, work_date, revision),
  check (status = 'review_required' or approved_minutes is not null),
  check (status <> 'non_payable' or (approved_minutes = 0 and approved_extra_minutes = 0)),
  check (status not in ('approved_manual','non_payable') or nullif(btrim(decision_reason),'') is not null)
);
create index payroll_time_employee_date_idx on public.payroll_payable_time_versions(employee_id, work_date desc, revision desc);
create index payroll_time_review_idx on public.payroll_payable_time_versions(status,work_date) where status='review_required';

create table public.payroll_run_time_snapshots (
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  time_version_id uuid not null references public.payroll_payable_time_versions(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  approved_minutes integer not null,
  approved_extra_minutes integer not null,
  classification text not null,
  evidence jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id,employee_id,work_date)
);

alter table public.payroll_payable_time_versions enable row level security;
alter table public.payroll_run_time_snapshots enable row level security;
revoke all on public.payroll_payable_time_versions,public.payroll_run_time_snapshots from public,anon,authenticated;
create trigger payroll_time_command_guard before insert or update or delete on public.payroll_payable_time_versions
  for each row execute function public.payroll_command_guard();
create trigger payroll_run_time_command_guard before insert or update or delete on public.payroll_run_time_snapshots
  for each row execute function public.payroll_command_guard();

-- Extend the existing command guard: both time decisions and run evidence are append-only.
create or replace function public.payroll_command_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('feedx.payroll_command',true) is distinct from 'yes' then
    raise exception using errcode='42501',message='Payroll records require the canonical command authority.';
  end if;
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='Payroll history cannot be deleted.';
  end if;
  if tg_op='UPDATE' and tg_table_name in
    ('payroll_compensation_versions','payroll_recurring_component_versions',
     'payroll_statutory_profile_versions','payroll_run_profile_snapshots','payroll_events',
     'payroll_payable_time_versions','payroll_run_time_snapshots') then
    raise exception using errcode='55000',message='Payroll historical evidence is immutable.';
  end if;
  if tg_op='UPDATE' and tg_table_name='payroll_runs' and old.status in ('finalized','paid') then
    raise exception using errcode='55000',message='Finalized payroll runs are immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.payroll_time_reconcile(
  p_legal_entity_id uuid,p_from date,p_to date
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.payroll_admin_actor();
  v_profile record;
  v_day date;
  v_evidence jsonb;
  v_latest public.payroll_payable_time_versions%rowtype;
  v_issues text[];
  v_status text;
  v_id uuid;
  v_created integer:=0;
  v_unchanged integer:=0;
begin
  if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll time reconciliation authority required.';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+31
    or p_to>timezone('Asia/Kuala_Lumpur',now())::date then
    raise exception using errcode='22023',message='Select a valid elapsed range of at most 32 days.';
  end if;
  for v_profile in select p.id profile_id,p.employee_id from public.payroll_profiles p
    where public.payroll_can_access_employee(p.employee_id,'payroll.manage')
  loop
    for v_day in select generate_series(p_from,p_to,interval '1 day')::date loop
      v_evidence:=public.payroll_time_evidence(v_profile.employee_id,v_day);
      if v_evidence is null then continue; end if;
      if v_evidence->>'legal_entity_id' is distinct from p_legal_entity_id::text then continue; end if;
      select * into v_latest from public.payroll_payable_time_versions t
        where t.profile_id=v_profile.profile_id and t.work_date=v_day
        order by revision desc limit 1 for update;
      if v_latest.id is not null and v_latest.source_fingerprint=v_evidence->>'source_fingerprint' then
        v_unchanged:=v_unchanged+1;
        continue;
      end if;
      if not public.payroll_time_correction_allowed(p_legal_entity_id,v_day) then
        raise exception using errcode='55000',message='Finalized period requires an open correction run before time evidence changes.';
      end if;
      select coalesce(array_agg(issue.code),'{}'::text[]) into v_issues
        from jsonb_array_elements_text(v_evidence->'issue_codes') as issue(code);
      v_status:=case when cardinality(v_issues)=0 and (v_evidence->>'proposed_minutes') is not null
        then 'approved_auto' else 'review_required' end;
      perform set_config('feedx.payroll_command','yes',true);
      insert into public.payroll_payable_time_versions(
        profile_id,employee_id,work_date,revision,supersedes_id,source_fingerprint,evidence,
        issue_codes,classification,scheduled_minutes,actual_minutes,proposed_minutes,
        approved_minutes,status,actor_employee_id)
      values(v_profile.profile_id,v_profile.employee_id,v_day,coalesce(v_latest.revision,0)+1,
        v_latest.id,v_evidence->>'source_fingerprint',v_evidence,v_issues,
        v_evidence->>'classification',(v_evidence->>'scheduled_minutes')::integer,
        (v_evidence->>'actual_minutes')::integer,(v_evidence->>'proposed_minutes')::integer,
        case when v_status='approved_auto' then (v_evidence->>'proposed_minutes')::integer end,
        v_status,v_actor) returning id into v_id;
      insert into public.payroll_events(event_type,profile_id,actor_employee_id,details)
        values('time_reconciled',v_profile.profile_id,v_actor,
          jsonb_build_object('time_version_id',v_id,'work_date',v_day,'status',v_status,
            'source_fingerprint',v_evidence->>'source_fingerprint'));
      v_created:=v_created+1;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged);
end; $$;

create or replace function public.payroll_run_time_readiness(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype;
  v_profile record;
  v_day date;
  v_evidence jsonb;
  v_current public.payroll_payable_time_versions%rowtype;
  v_hourly integer:=0;
  v_required integer:=0;
  v_unresolved integer:=0;
  v_missing integer:=0;
  v_stale integer:=0;
  v_future boolean;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority required.';
  end if;
  for v_profile in select p.id profile_id,p.employee_id from public.payroll_profiles p
  loop
    for v_day in select generate_series(v_period.period_start,v_period.period_end,interval '1 day')::date loop
      if not exists(select 1 from public.payroll_compensation_versions c
        where c.profile_id=v_profile.profile_id and c.effective_from<=v_day
          and c.pay_basis='hourly' and c.legal_entity_id=v_period.legal_entity_id
          and not exists(select 1 from public.payroll_compensation_versions later
            where later.profile_id=c.profile_id and later.effective_from<=v_day
              and later.effective_from>c.effective_from)) then continue; end if;
      v_hourly:=v_hourly+1;
      v_evidence:=public.payroll_time_evidence(v_profile.employee_id,v_day);
      if v_evidence is null then continue; end if;
      if v_evidence->>'legal_entity_id' is distinct from v_period.legal_entity_id::text then continue; end if;
      v_required:=v_required+1;
      select * into v_current from public.payroll_payable_time_versions t
        where t.profile_id=v_profile.profile_id and t.work_date=v_day
        order by revision desc limit 1;
      if v_current.id is null then v_missing:=v_missing+1;
      elsif v_current.source_fingerprint is distinct from v_evidence->>'source_fingerprint' then v_stale:=v_stale+1;
      elsif v_current.status='review_required' then v_unresolved:=v_unresolved+1;
      end if;
    end loop;
  end loop;
  v_future:=v_hourly>0 and v_period.period_end>=timezone('Asia/Kuala_Lumpur',now())::date;
  return jsonb_build_object('ready',not v_future and v_missing=0 and v_stale=0 and v_unresolved=0,
    'hourly_profile_days',v_hourly,'required_days',v_required,
    'unreconciled',v_missing,'stale',v_stale,'unresolved',v_unresolved,
    'period_in_progress',v_future);
end; $$;

create or replace function public.payroll_time_run_gate()
returns trigger language plpgsql set search_path=public as $$
declare v_readiness jsonb;
begin
  if new.status in ('ready','finalized') and old.status is distinct from new.status then
    v_readiness:=public.payroll_run_time_readiness(new.id);
    if not (v_readiness->>'ready')::boolean then
      raise exception using errcode='55000',message='Hourly payable time is not ready; reconcile and resolve Time Exceptions first.',
        detail=v_readiness::text;
    end if;
  end if;
  return new;
end; $$;
create trigger payroll_time_run_gate before update on public.payroll_runs
  for each row execute function public.payroll_time_run_gate();

create or replace function public.payroll_time_snapshot_finalized_run()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='finalized' and old.status is distinct from new.status then
    insert into public.payroll_run_time_snapshots(
      run_id,time_version_id,employee_id,work_date,approved_minutes,
      approved_extra_minutes,classification,evidence)
    select new.id,t.id,t.employee_id,t.work_date,t.approved_minutes,
      t.approved_extra_minutes,t.classification,t.evidence
    from public.payroll_payable_time_versions t
    join public.payroll_periods period on period.id=new.period_id
    where t.work_date between period.period_start and period.period_end
      and t.evidence->>'legal_entity_id'=period.legal_entity_id::text
      and t.status in ('approved_auto','approved_manual','non_payable')
      and not exists(select 1 from public.payroll_payable_time_versions later
        where later.profile_id=t.profile_id and later.work_date=t.work_date and later.revision>t.revision);
  end if;
  return new;
end; $$;
create trigger payroll_time_snapshot_finalized_run after update on public.payroll_runs
  for each row execute function public.payroll_time_snapshot_finalized_run();

create or replace function public.payroll_time_decide(
  p_time_version_id uuid,p_action text,p_approved_minutes integer,
  p_extra_minutes integer,p_classification text,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.payroll_admin_actor();
  v_current public.payroll_payable_time_versions%rowtype;
  v_evidence jsonb;
  v_id uuid;
  v_status text;
  v_minutes integer;
  v_extra integer;
begin
  select * into v_current from public.payroll_payable_time_versions
    where id=p_time_version_id for update;
  if v_current.id is null then raise exception using errcode='P0002',message='Payable time not found.'; end if;
  if not public.payroll_can_access_employee(v_current.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll time decision authority required.';
  end if;
  if exists(select 1 from public.payroll_payable_time_versions later
      where later.profile_id=v_current.profile_id and later.work_date=v_current.work_date
        and later.revision>v_current.revision) then
    raise exception using errcode='55000',message='This time result has a newer version. Refresh before deciding.';
  end if;
  if v_current.status<>'review_required' then
    raise exception using errcode='55000',message='Only unresolved time exceptions may be decided.';
  end if;
  v_evidence:=public.payroll_time_evidence(v_current.employee_id,v_current.work_date);
  if v_evidence is null or v_evidence->>'source_fingerprint'<>v_current.source_fingerprint then
    raise exception using errcode='55000',message='Source work evidence changed. Reconcile before deciding.';
  end if;
  if not public.payroll_time_correction_allowed((v_current.evidence->>'legal_entity_id')::uuid,v_current.work_date) then
    raise exception using errcode='55000',message='Finalized period requires an open correction run before time decision.';
  end if;
  if p_action not in ('approve','adjust','reject') or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='A decision and reason are required.';
  end if;
  v_status:=case when p_action='reject' then 'non_payable' else 'approved_manual' end;
  v_minutes:=case when p_action='reject' then 0 else p_approved_minutes end;
  v_extra:=case when p_action='reject' then 0 else coalesce(p_extra_minutes,0) end;
  if v_minutes is null or v_minutes<0 or v_minutes>1440 or v_extra<0 or v_extra>1440
    or v_minutes+v_extra>1440 or p_classification not in
      ('regular','overtime','rest_day','public_holiday','public_holiday_ot','non_payable','leave') then
    raise exception using errcode='22023',message='A valid payable duration and classification are required.';
  end if;
  if p_action='reject' and p_classification<>'non_payable' then
    raise exception using errcode='22023',message='Rejected time must be non-payable.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_payable_time_versions(
    profile_id,employee_id,work_date,revision,supersedes_id,source_fingerprint,evidence,
    issue_codes,classification,scheduled_minutes,actual_minutes,proposed_minutes,
    approved_minutes,approved_extra_minutes,status,decision_reason,actor_employee_id)
  values(v_current.profile_id,v_current.employee_id,v_current.work_date,v_current.revision+1,
    v_current.id,v_current.source_fingerprint,v_current.evidence,v_current.issue_codes,
    p_classification,v_current.scheduled_minutes,v_current.actual_minutes,v_current.proposed_minutes,
    v_minutes,v_extra,v_status,btrim(p_reason),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
    values('time_'||p_action,v_current.profile_id,v_actor,btrim(p_reason),
      jsonb_build_object('time_version_id',v_id,'previous_version_id',v_current.id,
        'work_date',v_current.work_date,'approved_minutes',v_minutes,
        'approved_extra_minutes',v_extra,'classification',p_classification));
  return jsonb_build_object('id',v_id,'status',v_status);
end; $$;

create or replace function public.payroll_time_read(
  p_legal_entity_id uuid,p_from date,p_to date
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_rows jsonb;
begin
  if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll time view authority required.';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+31 then
    raise exception using errcode='22023',message='Select a valid range of at most 32 days.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'employee_id',t.employee_id,'employee_name',e.full_name,
    'employee_code',e.employee_code,'pay_basis',t.evidence->>'pay_basis',
    'work_date',t.work_date,'revision',t.revision,'status',t.status,
    'issue_codes',t.issue_codes,'classification',t.classification,
    'scheduled_minutes',t.scheduled_minutes,'actual_minutes',t.actual_minutes,
    'proposed_minutes',t.proposed_minutes,'approved_minutes',t.approved_minutes,
    'approved_extra_minutes',t.approved_extra_minutes,'evidence',t.evidence,
    'decision_reason',t.decision_reason,'decided_at',t.decided_at,
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'revision',h.revision,
      'status',h.status,'approved_minutes',h.approved_minutes,'approved_extra_minutes',h.approved_extra_minutes,
      'reason',h.decision_reason,'actor_employee_id',h.actor_employee_id,'at',h.decided_at)
      order by h.revision desc) from public.payroll_payable_time_versions h
      where h.profile_id=t.profile_id and h.work_date=t.work_date),'[]'::jsonb))
    order by t.work_date desc,e.full_name),'[]'::jsonb) into v_rows
  from public.payroll_payable_time_versions t
  join public.employees e on e.id=t.employee_id
  where t.evidence->>'legal_entity_id'=p_legal_entity_id::text and t.work_date between p_from and p_to
    and public.payroll_can_access_employee(e.id,'payroll.view')
    and not exists(select 1 from public.payroll_payable_time_versions later
      where later.profile_id=t.profile_id and later.work_date=t.work_date and later.revision>t.revision);
  return v_rows;
end; $$;

-- Pure evidence projection. 10 minutes matches the existing Crew punctuality
-- noise window; it does not grant payable extra time. Anything beyond it is
-- reviewed, never automatically classified as overtime.
create or replace function public.payroll_time_evidence(p_employee_id uuid,p_work_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_employee public.employees%rowtype;
  v_roster public.duty_roster_published_entries%rowtype;
  v_attendance public.crew_attendance_records%rowtype;
  v_leave public.crew_approved_leaves%rowtype;
  v_holiday public.payroll_public_holidays%rowtype;
  v_state_holiday boolean;
  v_comp public.payroll_compensation_versions%rowtype;
  v_profile_id uuid;
  v_attendance_count integer;
  v_roster_start timestamptz;
  v_roster_end timestamptz;
  v_scheduled integer;
  v_actual integer;
  v_proposed integer;
  v_extra integer := 0;
  v_issues text[] := '{}';
  v_class text := 'regular';
  v_payload jsonb;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  select id into v_profile_id from public.payroll_profiles where employee_id=p_employee_id;
  if v_employee.id is null or v_profile_id is null or p_work_date is null then
    raise exception using errcode='22023',message='Employee Payroll Profile and work date are required.';
  end if;
  select * into v_comp from public.payroll_compensation_versions
    where profile_id=v_profile_id and effective_from<=p_work_date
    order by effective_from desc limit 1;
  if v_comp.id is null then return null; end if;
  -- Attendance pins the published revision seen at clock-in. A later roster
  -- publication must not silently replace that historical schedule evidence.
  select r.* into v_roster from public.duty_roster_published_entries r
    join public.crew_attendance_records a on a.scheduled_roster_entry_id=r.id
    where r.employee_id=p_employee_id and r.roster_date=p_work_date
      and a.employee_id=p_employee_id
    order by a.clock_in_at limit 1;
  if v_roster.id is null then
    select r.* into v_roster from public.duty_roster_published_entries r
      join public.duty_roster_publications pub on pub.id=r.publication_id
      where r.employee_id=p_employee_id and r.roster_date=p_work_date
        and not exists(select 1 from public.duty_roster_publications newer
          where newer.outlet_id=pub.outlet_id and newer.week_start_date=pub.week_start_date
            and newer.revision>pub.revision)
      order by pub.revision desc,pub.published_at desc limit 1;
  end if;
  select count(*) into v_attendance_count from public.crew_attendance_records a
    where a.employee_id=p_employee_id and
      (timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date=p_work_date
       or a.scheduled_roster_entry_id=v_roster.id);
  select * into v_attendance from public.crew_attendance_records a
    where a.employee_id=p_employee_id and
      (timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date=p_work_date
       or a.scheduled_roster_entry_id=v_roster.id)
    order by a.clock_in_at limit 1;
  select * into v_leave from public.crew_approved_leaves
    where employee_id=p_employee_id and p_work_date between start_date and end_date
    order by approved_at desc limit 1;
  select * into v_holiday from public.payroll_public_holidays h
    where h.is_active and h.holiday_date=p_work_date
      and (h.legal_entity_id is null or h.legal_entity_id=v_comp.legal_entity_id)
      and (h.scope='national' or (h.scope='outlet' and h.outlet_id=v_roster.outlet_id))
    order by case h.scope when 'outlet' then 0 else 1 end limit 1;
  select exists(select 1 from public.payroll_public_holidays h
    where h.is_active and h.holiday_date=p_work_date and h.scope='state'
      and (h.legal_entity_id is null or h.legal_entity_id=v_comp.legal_entity_id)) into v_state_holiday;
  if v_roster.id is null and v_attendance.id is null and v_leave.id is null then return null; end if;

  if v_roster.id is not null and v_roster.entry_type='working'
     and v_roster.start_time is not null and v_roster.end_time is not null then
    v_roster_start := (p_work_date + v_roster.start_time) at time zone 'Asia/Kuala_Lumpur';
    v_roster_end := ((p_work_date + v_roster.end_time)
      + case when v_roster.end_time<=v_roster.start_time then interval '1 day' else interval '0 day' end)
      at time zone 'Asia/Kuala_Lumpur';
    v_scheduled := greatest(0,floor(extract(epoch from (v_roster_end-v_roster_start))/60)::integer-v_roster.break_minutes);
  end if;
  if v_roster.id is not null and v_roster.entry_type<>'working'
    and v_attendance.id is null and v_leave.id is null then return null; end if;
  if v_roster_end is not null and v_attendance.id is null
    and v_roster_end>now() then return null; end if;
  if v_attendance.id is not null and v_attendance.clock_out_at is not null then
    v_actual := greatest(0,floor(extract(epoch from (v_attendance.clock_out_at-v_attendance.clock_in_at))/60)::integer);
  end if;

  if v_leave.id is not null then
    v_class := case when v_leave.leave_type='unpaid' then 'non_payable' else 'leave' end;
    if v_attendance.id is not null then v_issues := array_append(v_issues,'leave_conflict'); end if;
    if v_leave.leave_type<>'unpaid' then v_issues := array_append(v_issues,'paid_leave_basis'); end if;
  elsif v_holiday.id is not null then
    v_class := 'public_holiday';
    v_issues := array_append(v_issues,'public_holiday_review');
  elsif v_state_holiday then
    v_issues := array_append(v_issues,'state_holiday_scope_review');
  elsif v_roster.id is not null and v_roster.entry_type<>'working' and v_attendance.id is not null then
    v_class := 'rest_day';
    v_issues := array_append(v_issues,'rest_day_work');
  elsif v_roster.id is null and v_attendance.id is not null then
    v_issues := array_append(v_issues,'unscheduled_work');
  end if;
  if v_roster.id is not null and v_attendance.id is not null
    and v_roster.outlet_id is distinct from v_attendance.outlet_id then
    v_issues := array_append(v_issues,'outlet_mismatch');
  end if;
  if v_attendance_count>1 then v_issues := array_append(v_issues,'overlapping_or_multiple_attendance'); end if;
  if v_attendance.id is not null and v_attendance.clock_in_at is null then
    v_issues := array_append(v_issues,'missing_clock_in');
  end if;
  if v_roster.id is not null and v_roster.entry_type='working'
    and v_attendance.id is null and (v_roster_end is null or v_roster_end<now()) then
    v_issues := array_append(v_issues,'missing_punch');
  end if;
  if v_roster.id is not null and v_roster.entry_type='working' and v_roster_start is null then
    v_issues := array_append(v_issues,'invalid_published_shift');
  end if;
  if v_attendance.id is not null and v_attendance.clock_out_at is null then
    v_issues := array_append(v_issues,'missing_clock_out');
  end if;
  -- Calculate overlapping eligible elapsed minutes, then remove the rostered
  -- unpaid break. This is a proposal, not a claim that the break was observed.
  if v_roster_start is not null and v_attendance.id is not null and v_attendance.clock_out_at is not null then
    v_proposed := greatest(0,floor(extract(epoch from
      (least(v_roster_end,v_attendance.clock_out_at)-greatest(v_roster_start,v_attendance.clock_in_at)))/60)::integer
      -v_roster.break_minutes);
    if v_attendance.clock_in_at>v_roster_start then v_issues := array_append(v_issues,'late_arrival'); end if;
    if v_attendance.clock_out_at<v_roster_end then v_issues := array_append(v_issues,'early_departure'); end if;
    v_extra := greatest(0,floor(extract(epoch from (v_attendance.clock_out_at-v_roster_end))/60)::integer);
    if v_extra>10 then v_issues := array_append(v_issues,'extra_time'); end if;
  elsif v_attendance.id is not null and v_actual is not null then
    v_proposed := null; -- No published schedule/break basis: reviewer must decide.
  end if;
  if v_roster_start is not null and v_roster.break_minutes>=floor(extract(epoch from (v_roster_end-v_roster_start))/60)::integer then
    v_issues := array_append(v_issues,'uncertain_break');
  end if;
  if v_class='non_payable' and v_attendance.id is null then v_proposed := 0; end if;
  v_payload := jsonb_build_object(
    'employee_id',p_employee_id,'profile_id',v_profile_id,'work_date',p_work_date,
    'compensation_version_id',v_comp.id,'pay_basis',v_comp.pay_basis,
    'legal_entity_id',v_comp.legal_entity_id,'outlet_id',coalesce(v_roster.outlet_id,v_attendance.outlet_id,v_leave.employment_outlet_id),
    'roster_entry_id',v_roster.id,'roster_publication_id',v_roster.publication_id,
    'roster_entry_type',v_roster.entry_type,'scheduled_start_at',v_roster_start,
    'scheduled_end_at',v_roster_end,'roster_break_minutes',v_roster.break_minutes,
    'attendance_id',v_attendance.id,'attendance_count',v_attendance_count,
    'clock_in_at',v_attendance.clock_in_at,'clock_out_at',v_attendance.clock_out_at,
    'leave_id',v_leave.id,'leave_type',v_leave.leave_type,'holiday_id',v_holiday.id,
    'scheduled_minutes',v_scheduled,'actual_minutes',v_actual,
    'proposed_minutes',v_proposed,'extra_candidate_minutes',v_extra,
    'classification',v_class,'issue_codes',to_jsonb(v_issues),
    'calculation_version','payable-time-v1');
  return v_payload || jsonb_build_object('source_fingerprint',md5(v_payload::text));
end; $$;

create or replace function public.payroll_time_correction_allowed(p_legal_entity_id uuid,p_work_date date)
returns boolean language sql stable security definer set search_path=public as $$
  select not exists(select 1 from public.payroll_periods period
    where period.legal_entity_id=p_legal_entity_id and p_work_date between period.period_start and period.period_end
      and period.current_finalized_run_id is not null
      and not exists(select 1 from public.payroll_runs r
        where r.period_id=period.id and r.supersedes_run_id=period.current_finalized_run_id
          and r.status in ('draft','review_required','ready')));
$$;

revoke all on function public.payroll_time_evidence(uuid,date) from public,anon,authenticated;
revoke all on function public.payroll_time_correction_allowed(uuid,date) from public,anon,authenticated;
revoke all on function public.payroll_time_run_gate() from public,anon,authenticated;
revoke all on function public.payroll_time_snapshot_finalized_run() from public,anon,authenticated;
revoke all on function public.payroll_time_reconcile(uuid,date,date) from public,anon;
revoke all on function public.payroll_time_decide(uuid,text,integer,integer,text,text) from public,anon;
revoke all on function public.payroll_time_read(uuid,date,date) from public,anon;
revoke all on function public.payroll_run_time_readiness(uuid) from public,anon;
grant execute on function public.payroll_time_reconcile(uuid,date,date) to authenticated;
grant execute on function public.payroll_time_decide(uuid,text,integer,integer,text,text) to authenticated;
grant execute on function public.payroll_time_read(uuid,date,date) to authenticated;
grant execute on function public.payroll_run_time_readiness(uuid) to authenticated;
