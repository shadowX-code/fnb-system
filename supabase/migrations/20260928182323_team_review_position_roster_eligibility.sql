-- Position controls participation; retain the previously eligible Service Crew positions.
alter table public.job_positions
  add column participates_in_team_review boolean not null default false;

update public.job_positions
set participates_in_team_review = true
where lower(btrim(name)) = 'service crew';

create or replace function public.crew_team_review_live_subjects(p_outlet_id uuid, p_period date)
returns table(employee_id uuid) language sql stable security definer set search_path=public as $$
  select distinct entry.employee_id
  from public.duty_roster_published_entries entry
  join public.duty_roster_publications publication on publication.id = entry.publication_id
  join public.employees employee on employee.id = entry.employee_id
  join public.job_positions job_position on lower(btrim(job_position.name)) = lower(btrim(employee.position))
  where entry.outlet_id = p_outlet_id
    and entry.roster_date >= date_trunc('month',p_period)::date
    and entry.roster_date < (date_trunc('month',p_period)::date + interval '1 month')::date
    and entry.entry_type = 'working'
    and entry.start_time is not null and entry.end_time is not null
    and publication.id = (
      select latest.id from public.duty_roster_publications latest
      where latest.outlet_id = entry.outlet_id
        and entry.roster_date between latest.week_start_date and latest.week_end_date
      order by latest.revision desc, latest.published_at desc limit 1
    )
    and employee.is_active
    and coalesce(employee.employment_status,'active') not in ('resigned','terminated')
    and job_position.status = 'active' and job_position.participates_in_team_review;
$$;
revoke all on function public.crew_team_review_live_subjects(uuid,date) from public, anon, authenticated;

-- Published roster is primary. Only complete attendance that contradicts that
-- particular scheduled overlap disqualifies a pair; absent clock evidence does not.
create or replace function public.crew_team_review_live_pairs(p_outlet_id uuid, p_period date)
returns table(subject_id uuid, reviewer_id uuid, roster_overlap boolean, attendance_overlap_count integer)
language sql stable security definer set search_path=public as $$
  with scheduled as (
    select a.employee_id subject_id, b.employee_id reviewer_id,
      greatest(
        (a.roster_date + a.start_time) at time zone 'Asia/Kuala_Lumpur',
        (b.roster_date + b.start_time) at time zone 'Asia/Kuala_Lumpur'
      ) overlap_start,
      least(
        (a.roster_date + a.end_time + case when a.end_time <= a.start_time then interval '1 day' else interval '0 day' end) at time zone 'Asia/Kuala_Lumpur',
        (b.roster_date + b.end_time + case when b.end_time <= b.start_time then interval '1 day' else interval '0 day' end) at time zone 'Asia/Kuala_Lumpur'
      ) overlap_end
    from public.duty_roster_published_entries a
    join public.duty_roster_published_entries b on b.publication_id = a.publication_id
      and b.roster_date = a.roster_date and b.employee_id <> a.employee_id
    join public.crew_team_review_live_subjects(p_outlet_id,p_period) subject on subject.employee_id = a.employee_id
    join public.crew_team_review_live_subjects(p_outlet_id,p_period) reviewer on reviewer.employee_id = b.employee_id
    where a.outlet_id = p_outlet_id and a.entry_type = 'working' and b.entry_type = 'working'
      and a.start_time is not null and a.end_time is not null
      and b.start_time is not null and b.end_time is not null
      and a.roster_date >= date_trunc('month',p_period)::date
      and a.roster_date < (date_trunc('month',p_period)::date + interval '1 month')::date
      and a.publication_id = (
        select latest.id from public.duty_roster_publications latest
        where latest.outlet_id = p_outlet_id
          and a.roster_date between latest.week_start_date and latest.week_end_date
        order by latest.revision desc, latest.published_at desc limit 1
      )
  ), eligible as (
    select scheduled.* from scheduled
    where overlap_start < overlap_end
      and not exists (
        select 1 from public.crew_leave_roster_projections leave_projection
        where leave_projection.outlet_id = p_outlet_id
          and leave_projection.roster_date = timezone('Asia/Kuala_Lumpur', overlap_start)::date
          and leave_projection.employee_id in (subject_id, reviewer_id)
      )
      and not exists (
        select 1 from (values (subject_id), (reviewer_id)) member(employee_id)
        where exists (
          select 1 from public.crew_attendance_records attendance
          where attendance.employee_id = member.employee_id and attendance.outlet_id = p_outlet_id
            and attendance.status = 'completed' and attendance.clock_out_at is not null
            and timezone('Asia/Kuala_Lumpur',attendance.clock_in_at)::date = timezone('Asia/Kuala_Lumpur',overlap_start)::date
        ) and not exists (
          select 1 from public.crew_attendance_records attendance
          where attendance.employee_id = member.employee_id and attendance.outlet_id = p_outlet_id
            and attendance.status = 'completed' and attendance.clock_out_at is not null
            and attendance.clock_in_at < overlap_end and attendance.clock_out_at > overlap_start
        )
      )
      and not (
        exists (select 1 from public.crew_attendance_records attendance
          where attendance.employee_id = subject_id and attendance.outlet_id = p_outlet_id
            and attendance.status = 'completed' and attendance.clock_in_at < overlap_end and attendance.clock_out_at > overlap_start)
        and exists (select 1 from public.crew_attendance_records attendance
          where attendance.employee_id = reviewer_id and attendance.outlet_id = p_outlet_id
            and attendance.status = 'completed' and attendance.clock_in_at < overlap_end and attendance.clock_out_at > overlap_start)
        and not exists (
          select 1 from public.crew_attendance_records a
          join public.crew_attendance_records b on b.employee_id = reviewer_id and b.outlet_id = a.outlet_id
            and b.status = 'completed' and b.clock_out_at is not null
            and a.clock_in_at < b.clock_out_at and b.clock_in_at < a.clock_out_at
          where a.employee_id = subject_id and a.outlet_id = p_outlet_id
            and a.status = 'completed' and a.clock_out_at is not null
            and greatest(a.clock_in_at,b.clock_in_at,overlap_start) < least(a.clock_out_at,b.clock_out_at,overlap_end)
        )
      )
  )
  select eligible.subject_id, eligible.reviewer_id, true,
    count(distinct (a.id,b.id)) filter (where a.id is not null and b.id is not null)::integer
  from eligible
  left join public.crew_attendance_records a on a.employee_id = eligible.subject_id and a.outlet_id = p_outlet_id
    and a.status = 'completed' and a.clock_out_at is not null
    and a.clock_in_at < eligible.overlap_end and a.clock_out_at > eligible.overlap_start
  left join public.crew_attendance_records b on b.employee_id = eligible.reviewer_id and b.outlet_id = p_outlet_id
    and b.status = 'completed' and b.clock_out_at is not null
    and b.clock_in_at < a.clock_out_at and a.clock_in_at < b.clock_out_at
    and greatest(a.clock_in_at,b.clock_in_at,eligible.overlap_start) < least(a.clock_out_at,b.clock_out_at,eligible.overlap_end)
  group by eligible.subject_id, eligible.reviewer_id;
$$;
revoke all on function public.crew_team_review_live_pairs(uuid,date) from public, anon, authenticated;

create function public.crew_team_review_admin_dimensions(p_employee_id uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_outlet uuid := public.crew_growth_employee_outlet(p_employee_id);
begin
  if v_outlet is null or not public.current_user_has_permission('crew_performance.review')
    or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501', message='Team Review evidence is unavailable.';
  end if;
  return public.crew_team_review_result(p_employee_id, p_period)->'dimensions';
end; $$;
revoke all on function public.crew_team_review_admin_dimensions(uuid,date) from public, anon, authenticated;
grant execute on function public.crew_team_review_admin_dimensions(uuid,date) to authenticated;
