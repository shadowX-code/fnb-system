-- Crew Duty Roster ownership migration.
-- Keeps the existing Duty Roster tables and trusted week authorities as the
-- single source of truth, while adding a durable published projection for
-- Crew-safe reads and downstream evidence consumers.

insert into public.permissions (code, module, description)
values
  ('crew_roster.view', 'Crew Duty Roster', 'View outlet-scoped Crew Duty Roster.'),
  ('crew_roster.manage', 'Crew Duty Roster', 'Manage roster drafts, templates, and ordering.'),
  ('crew_roster.publish', 'Crew Duty Roster', 'Publish, republish, and lock outlet rosters.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

-- Preserve existing role behavior while making Crew permissions canonical.
insert into public.role_permissions (role_id, permission_id)
select distinct rp.role_id, target.id
from public.role_permissions rp
join public.permissions legacy on legacy.id = rp.permission_id
join public.permissions target on target.code = case
  when legacy.code in ('duty_roster.view', 'outlet_duty_roster.view') then 'crew_roster.view'
  when legacy.code in ('duty_roster.create', 'duty_roster.edit', 'duty_roster.delete') then 'crew_roster.manage'
  when legacy.code = 'duty_roster.manage' then 'crew_roster.publish'
end
where legacy.code in (
  'duty_roster.view', 'outlet_duty_roster.view', 'duty_roster.create',
  'duty_roster.edit', 'duty_roster.delete', 'duty_roster.manage'
)
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select distinct rp.role_id, target.id
from public.role_permissions rp
join public.permissions legacy on legacy.id=rp.permission_id and legacy.code='duty_roster.manage'
join public.permissions target on target.code='crew_roster.manage'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code in ('crew_roster.view', 'crew_roster.manage', 'crew_roster.publish')
on conflict do nothing;

-- Compatibility bridge: the established roster authorities continue to ask
-- for their legacy domain permissions. Crew permissions satisfy those checks
-- without duplicating mutation RPCs or table ownership.
create or replace function public.current_user_has_permission(permission_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with current_identity as (
    select auth.uid() as user_id, lower(coalesce(auth.jwt() ->> 'email', '')) as email
  ),
  current_subject_roles as (
    select e.role_id
    from current_identity ci
    join public.employees e on (
      e.auth_user_id = ci.user_id
      or e.id = ci.user_id
      or (ci.email <> '' and lower(e.email) = ci.email)
    )
    where e.enable_system_login = true
      and e.access_state = 'active'
      and coalesce(e.is_active, true) = true
    union
    select up.role_id
    from current_identity ci
    join public.user_profiles up on up.id = ci.user_id
    where coalesce(up.is_active, true) = true
      and coalesce(up.access_state, 'active') <> 'disabled'
  ),
  accepted_codes as (
    select permission_code as code
    union all select 'crew_roster.view' where permission_code in ('duty_roster.view', 'outlet_duty_roster.view')
    union all select 'crew_roster.manage' where permission_code in ('duty_roster.create', 'duty_roster.edit', 'duty_roster.delete')
    union all select 'crew_roster.publish' where permission_code = 'duty_roster.manage'
  )
  select exists (
    select 1 from current_subject_roles csr join public.roles r on r.id = csr.role_id
    where lower(r.name) in ('owner', 'admin')
  ) or exists (
    select 1
    from current_subject_roles csr
    join public.role_permissions rp on rp.role_id = csr.role_id
    join public.permissions p on p.id = rp.permission_id
    where p.code in (select code from accepted_codes)
  );
$$;
revoke all on function public.current_user_has_permission(text) from public, anon, authenticated;
grant execute on function public.current_user_has_permission(text) to authenticated;

create or replace function public.current_user_has_direct_permission(permission_code text)
returns boolean language sql stable security definer set search_path=public as $$
  with current_identity as (
    select auth.uid() user_id,lower(coalesce(auth.jwt()->>'email','')) email
  ), subject_roles as (
    select e.role_id from current_identity ci join public.employees e on e.auth_user_id=ci.user_id or e.id=ci.user_id or (ci.email<>'' and lower(e.email)=ci.email)
    where e.enable_system_login and e.access_state='active' and coalesce(e.is_active,true)
    union
    select up.role_id from current_identity ci join public.user_profiles up on up.id=ci.user_id
    where coalesce(up.is_active,true) and coalesce(up.access_state,'active')<>'disabled'
  )
  select exists(select 1 from subject_roles sr join public.roles r on r.id=sr.role_id where lower(r.name) in ('owner','admin'))
    or exists(select 1 from subject_roles sr join public.role_permissions rp on rp.role_id=sr.role_id join public.permissions p on p.id=rp.permission_id where p.code=permission_code);
$$;
revoke all on function public.current_user_has_direct_permission(text) from public,anon,authenticated;
grant execute on function public.current_user_has_direct_permission(text) to authenticated;

-- Re-state table policies with Crew ownership and the existing outlet scope.
drop policy if exists "duty rosters scoped select" on public.duty_rosters;
create policy "duty rosters scoped select" on public.duty_rosters for select to authenticated
using ((public.current_user_has_permission('duty_roster.view') or public.current_user_has_permission('outlet_duty_roster.view')) and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "duty rosters scoped insert" on public.duty_rosters;
create policy "duty rosters scoped insert" on public.duty_rosters for insert to authenticated
with check ((public.current_user_has_permission('duty_roster.create') or public.current_user_has_permission('crew_roster.manage')) and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "duty rosters scoped update" on public.duty_rosters;
create policy "duty rosters scoped update" on public.duty_rosters for update to authenticated
using ((public.current_user_has_permission('duty_roster.edit') or public.current_user_has_permission('crew_roster.manage')) and public.current_user_can_access_outlet(outlet_id))
with check ((public.current_user_has_permission('duty_roster.edit') or public.current_user_has_permission('crew_roster.manage')) and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "duty rosters scoped delete" on public.duty_rosters;
create policy "duty rosters scoped delete" on public.duty_rosters for delete to authenticated
using ((public.current_user_has_permission('duty_roster.delete') or public.current_user_has_permission('crew_roster.manage')) and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "roster periods scoped select" on public.roster_periods;
create policy "roster periods scoped select" on public.roster_periods for select to authenticated
using ((public.current_user_has_permission('duty_roster.view') or public.current_user_has_permission('outlet_duty_roster.view')) and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "roster periods scoped insert" on public.roster_periods;
create policy "roster periods scoped insert" on public.roster_periods for insert to authenticated
with check ((public.current_user_has_permission('crew_roster.manage') or public.current_user_has_direct_permission('duty_roster.manage')) and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "roster periods scoped update" on public.roster_periods;
create policy "roster periods scoped update" on public.roster_periods for update to authenticated
using ((public.current_user_has_permission('crew_roster.manage') or public.current_user_has_direct_permission('duty_roster.manage')) and public.current_user_can_access_outlet(outlet_id))
with check ((public.current_user_has_permission('crew_roster.manage') or public.current_user_has_direct_permission('duty_roster.manage')) and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "shift templates scoped select" on public.shift_templates;
create policy "shift templates scoped select" on public.shift_templates for select to authenticated
using ((public.current_user_has_permission('duty_roster.view') or public.current_user_has_permission('crew_roster.view')) and outlet_id is not null and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "shift templates scoped insert" on public.shift_templates;
create policy "shift templates scoped insert" on public.shift_templates for insert to authenticated
with check ((public.current_user_has_direct_permission('duty_roster.manage') or public.current_user_has_permission('crew_roster.manage')) and outlet_id is not null and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "shift templates scoped update" on public.shift_templates;
create policy "shift templates scoped update" on public.shift_templates for update to authenticated
using ((public.current_user_has_direct_permission('duty_roster.manage') or public.current_user_has_permission('crew_roster.manage')) and outlet_id is not null and public.current_user_can_access_outlet(outlet_id))
with check ((public.current_user_has_direct_permission('duty_roster.manage') or public.current_user_has_permission('crew_roster.manage')) and outlet_id is not null and public.current_user_can_access_outlet(outlet_id));
drop policy if exists "shift templates scoped delete" on public.shift_templates;
create policy "shift templates scoped delete" on public.shift_templates for delete to authenticated
using ((public.current_user_has_direct_permission('duty_roster.manage') or public.current_user_has_permission('crew_roster.manage')) and outlet_id is not null and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "duty roster viewers can view position group mappings" on public.roster_position_groups;
create policy "duty roster viewers can view position group mappings" on public.roster_position_groups for select to authenticated
using (public.current_user_has_permission('duty_roster.view') or public.current_user_has_permission('crew_roster.view'));
drop policy if exists "duty roster managers can manage position group mappings" on public.roster_position_groups;
create policy "duty roster managers can manage position group mappings" on public.roster_position_groups for all to authenticated
using (public.current_user_has_permission('crew_roster.manage') or public.current_user_has_direct_permission('duty_roster.manage'))
with check (public.current_user_has_permission('crew_roster.manage') or public.current_user_has_direct_permission('duty_roster.manage'));

-- Immutable publication history. Draft edits remain in duty_rosters while the
-- last published projection remains available to Crew until a republish.
create table if not exists public.duty_roster_publications (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  week_start_date date not null,
  week_end_date date not null,
  revision integer not null check (revision > 0),
  source_period_id uuid references public.roster_periods(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (outlet_id, week_start_date, revision)
);
create table if not exists public.duty_roster_published_entries (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.duty_roster_publications(id) on delete restrict,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  roster_date date not null,
  start_time time,
  end_time time,
  break_minutes integer not null default 0,
  entry_type text not null,
  template_code text,
  template_name text,
  position_snapshot text,
  group_snapshot text,
  outlet_name_snapshot text not null,
  shift_snapshot jsonb not null default '{}'::jsonb,
  published_at timestamptz not null,
  unique (publication_id, employee_id, roster_date)
);
create index if not exists duty_roster_publications_current_idx on public.duty_roster_publications(outlet_id, week_start_date, revision desc);
create index if not exists duty_roster_published_employee_date_idx on public.duty_roster_published_entries(employee_id, roster_date, published_at desc);
create index if not exists duty_roster_published_outlet_date_idx on public.duty_roster_published_entries(outlet_id, roster_date, published_at desc);
alter table public.duty_roster_publications enable row level security;
alter table public.duty_roster_published_entries enable row level security;
revoke all on table public.duty_roster_publications from public, anon, authenticated;
revoke all on table public.duty_roster_published_entries from public, anon, authenticated;

-- Bootstrap one immutable projection for every existing published/locked week.
do $$
declare v_period public.roster_periods%rowtype; v_publication_id uuid; v_revision integer;
begin
  for v_period in
    select * from public.roster_periods p
    where p.status in ('published', 'locked')
      and exists (select 1 from public.duty_rosters r where r.outlet_id=p.outlet_id and r.roster_date between p.week_start_date and p.week_end_date and r.status in ('published','locked'))
      and not exists (select 1 from public.duty_roster_publications x where x.outlet_id=p.outlet_id and x.week_start_date=p.week_start_date)
  loop
    select coalesce(max(revision),0)+1 into v_revision from public.duty_roster_publications where outlet_id=v_period.outlet_id and week_start_date=v_period.week_start_date;
    insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,source_period_id,published_by,published_at)
    values(v_period.outlet_id,v_period.week_start_date,v_period.week_end_date,v_revision,v_period.id,v_period.published_by,coalesce(v_period.published_at,now())) returning id into v_publication_id;
    insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,template_code,template_name,position_snapshot,group_snapshot,outlet_name_snapshot,shift_snapshot,published_at)
    select v_publication_id,r.outlet_id,r.employee_id,r.roster_date,r.start_time,r.end_time,r.break_minutes,
      coalesce(t.shift_type,r.shift_snapshot->>'shift_type','working'),coalesce(t.code,r.shift_snapshot->>'code'),coalesce(t.name,r.shift_snapshot->>'name'),
      coalesce(r.position_snapshot,e.position,''),coalesce((select g.group_name from public.job_positions jp join public.roster_position_groups g on g.position_id=jp.id where lower(jp.name)=lower(coalesce(r.position_snapshot,e.position,'')) limit 1),case when lower(coalesce(e.department,'')) like '%kitchen%' then 'kitchen' when lower(coalesce(e.department,'')) in ('service','floor','front of house') then 'floor' else 'other' end),
      coalesce(r.outlet_snapshot,o.name),coalesce(r.shift_snapshot,jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'start_time',r.start_time,'end_time',r.end_time,'break_minutes',r.break_minutes,'shift_type',t.shift_type,'color',t.color)),coalesce(r.publish_timestamp,v_period.published_at,now())
    from public.duty_rosters r
    join public.employees e on e.id=r.employee_id
    join public.outlets o on o.id=r.outlet_id
    left join public.shift_templates t on t.id=r.shift_template_id
    where r.outlet_id=v_period.outlet_id and r.roster_date between v_period.week_start_date and v_period.week_end_date and r.status in ('published','locked');
  end loop;
end $$;

-- Existing publish authority, extended atomically with an immutable revision.
create or replace function public.publish_roster_week(p_request_id uuid,p_outlet_id uuid,p_week_start_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_operation constant text:='publish_roster_week'; v_end date; v_fingerprint text; v_request public.duty_roster_lifecycle_requests%rowtype; v_period public.roster_periods%rowtype; v_result jsonb; v_now timestamptz:=now(); v_publication_id uuid; v_revision integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null or p_week_start_date is null or extract(isodow from p_week_start_date)<>1 then raise exception 'A request ID, outlet, and Monday week start are required.'; end if;
  if not public.current_user_has_permission('duty_roster.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Missing permission to publish this outlet roster.'; end if;
  v_end:=p_week_start_date+6; perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:'||p_outlet_id::text||':'||p_week_start_date::text)); v_fingerprint:=md5(jsonb_build_object('operation',v_operation,'outlet_id',p_outlet_id,'week_start_date',p_week_start_date)::text);
  select * into v_request from public.duty_roster_lifecycle_requests where request_id=p_request_id for update;
  if found then
    if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.outlet_id=p_outlet_id and v_request.week_start_date=p_week_start_date and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if;
    raise exception 'Request ID was already used for a different roster publish intent.';
  end if;
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_week_start_date,v_fingerprint);
  select * into v_period from public.roster_periods where outlet_id=p_outlet_id and week_start_date=p_week_start_date for update;
  if not found then insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status,published_by,published_at) values(p_outlet_id,p_week_start_date,v_end,'published',v_actor,v_now) returning * into v_period;
  else update public.roster_periods set status='published',published_by=v_actor,published_at=v_now,locked_at=null,updated_at=v_now where id=v_period.id returning * into v_period; end if;
  update public.duty_rosters r set status='published',updated_by=v_actor,updated_at=v_now,employee_name_snapshot=coalesce(employee.nickname,employee.full_name,r.employee_name_snapshot,''),position_snapshot=coalesce(employee.position,r.position_snapshot,''),department_snapshot=coalesce(employee.department,r.department_snapshot,''),outlet_snapshot=outlet.name,shift_snapshot=(select jsonb_build_object('id',template.id,'name',template.name,'code',template.code,'start_time',r.start_time,'end_time',r.end_time,'break_minutes',r.break_minutes,'shift_type',template.shift_type,'color',template.color) from public.shift_templates template where template.id=r.shift_template_id),publish_timestamp=v_now from public.employees employee,public.outlets outlet where outlet.id=p_outlet_id and r.employee_id=employee.id and r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end;
  select coalesce(max(revision),0)+1 into v_revision from public.duty_roster_publications where outlet_id=p_outlet_id and week_start_date=p_week_start_date;
  insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,source_period_id,published_by,published_at) values(p_outlet_id,p_week_start_date,v_end,v_revision,v_period.id,v_actor,v_now) returning id into v_publication_id;
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,template_code,template_name,position_snapshot,group_snapshot,outlet_name_snapshot,shift_snapshot,published_at)
  select v_publication_id,r.outlet_id,r.employee_id,r.roster_date,r.start_time,r.end_time,r.break_minutes,coalesce(t.shift_type,'working'),t.code,t.name,coalesce(r.position_snapshot,e.position,''),coalesce((select g.group_name from public.job_positions jp join public.roster_position_groups g on g.position_id=jp.id where lower(jp.name)=lower(coalesce(r.position_snapshot,e.position,'')) limit 1),case when lower(coalesce(e.department,'')) like '%kitchen%' then 'kitchen' when lower(coalesce(e.department,'')) in ('service','floor','front of house') then 'floor' else 'other' end),coalesce(r.outlet_snapshot,o.name),coalesce(r.shift_snapshot,'{}'::jsonb),v_now
  from public.duty_rosters r join public.employees e on e.id=r.employee_id join public.outlets o on o.id=r.outlet_id left join public.shift_templates t on t.id=r.shift_template_id
  where r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end and r.status='published';
  select jsonb_build_object('period',to_jsonb(v_period),'rows',coalesce(jsonb_agg(to_jsonb(r) order by r.roster_date,r.employee_id),'[]'::jsonb),'publication',jsonb_build_object('id',v_publication_id,'revision',v_revision,'published_at',v_now)) into v_result from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end;
  update public.duty_roster_lifecycle_requests set result=v_result,completed_at=now() where request_id=p_request_id; return v_result;
end; $$;

-- Private employee/date context used by Attendance, Operations, and evidence.
create or replace function public.crew_roster_employee_day(p_employee_id uuid,p_business_date date)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((
    select jsonb_build_object('entry_id',e.id,'publication_id',e.publication_id,'date',e.roster_date,'outlet_id',e.outlet_id,'outlet_name',e.outlet_name_snapshot,'start_time',e.start_time,'end_time',e.end_time,'break_minutes',e.break_minutes,'entry_type',e.entry_type,'template_code',e.template_code,'template_name',e.template_name,'position',e.position_snapshot,'group',e.group_snapshot,'published_at',e.published_at)
    from public.duty_roster_published_entries e
    join public.duty_roster_publications p on p.id=e.publication_id
    where e.employee_id=p_employee_id and e.roster_date=p_business_date
      and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date)
    order by e.published_at desc,e.id limit 1
  ),'null'::jsonb);
$$;
revoke all on function public.crew_roster_employee_day(uuid,date) from public,anon,authenticated;

create or replace function public.crew_my_roster(p_token text,p_from date default timezone('Asia/Kuala_Lumpur',now())::date,p_to date default (timezone('Asia/Kuala_Lumpur',now())::date+13))
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid; v_from date:=coalesce(p_from,timezone('Asia/Kuala_Lumpur',now())::date); v_to date:=coalesce(p_to,v_from+13); v_entries jsonb;
begin
  v_employee_id:=public.crew_session_employee(p_token);
  if v_to<v_from or v_to-v_from>62 then raise exception using errcode='22023',message='Schedule range must be between 1 and 63 days.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'date',x.roster_date,'outlet',jsonb_build_object('id',x.outlet_id,'name',x.outlet_name_snapshot),'start_time',x.start_time,'end_time',x.end_time,'break_minutes',x.break_minutes,'entry_type',x.entry_type,'template',jsonb_build_object('code',x.template_code,'name',x.template_name),'position',x.position_snapshot,'group',x.group_snapshot,'status','published','published_at',x.published_at) order by x.roster_date,x.start_time nulls last,x.id),'[]'::jsonb) into v_entries
  from (
    select e.* from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id
    where e.employee_id=v_employee_id and e.roster_date between v_from and v_to
      and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date)
  ) x;
  return jsonb_build_object('from',v_from,'to',v_to,'today',public.crew_roster_employee_day(v_employee_id,timezone('Asia/Kuala_Lumpur',now())::date),'entries',v_entries);
end; $$;
revoke all on function public.crew_my_roster(text,date,date) from public,anon,authenticated;
grant execute on function public.crew_my_roster(text,date,date) to anon,authenticated;

-- Attendance context prefers today's published working outlet, while retaining
-- the existing primary-outlet fallback when no roster exists.
create or replace function public.crew_attendance_context(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid; v_outlet public.outlets%rowtype; v_schedule jsonb; v_outlet_id uuid;
begin
  v_employee_id:=public.crew_session_employee(p_token); v_schedule:=public.crew_roster_employee_day(v_employee_id,timezone('Asia/Kuala_Lumpur',now())::date);
  v_outlet_id:=case when v_schedule is not null and coalesce(v_schedule->>'entry_type','working')='working' then (v_schedule->>'outlet_id')::uuid else null end;
  if v_outlet_id is null then select a.primary_outlet_id into v_outlet_id from public.crew_access a where a.employee_id=v_employee_id; end if;
  select o.* into v_outlet from public.outlets o where o.id=v_outlet_id;
  if v_outlet.id is null then raise exception using errcode='22023',message='Your Crew Access has no assigned outlet. Ask your manager to confirm your workplace.'; end if;
  if v_outlet.attendance_location_enabled and (v_outlet.attendance_latitude is null or v_outlet.attendance_longitude is null) then raise exception using errcode='22023',message='This outlet has location verification enabled but is not configured. Ask your manager to update Outlet settings.'; end if;
  return jsonb_build_object('outlet_id',v_outlet.id,'outlet_name',v_outlet.name,'location_enabled',v_outlet.attendance_location_enabled,'latitude',v_outlet.attendance_latitude,'longitude',v_outlet.attendance_longitude,'radius_meters',v_outlet.attendance_radius_meters,'schedule',v_schedule,'shift_start',v_schedule->>'start_time','shift_end',v_schedule->>'end_time','scheduled_position',v_schedule->>'position','scheduled_entry_type',v_schedule->>'entry_type');
end; $$;
revoke all on function public.crew_attendance_context(text) from public,anon,authenticated;
grant execute on function public.crew_attendance_context(text) to anon,authenticated;

create or replace function public.crew_clock(p_token text,p_action text,p_location jsonb default null,p_exception_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_employee_id uuid; v_record public.crew_attendance_records%rowtype; v_outlet public.outlets%rowtype; v_action text:=lower(btrim(p_action)); v_schedule jsonb; v_outlet_id uuid;
  v_lat numeric; v_lon numeric; v_accuracy numeric; v_distance numeric; v_has_location boolean:=false; v_verified boolean:=false; v_exception boolean:=false; v_reason text:=nullif(left(btrim(coalesce(p_exception_reason,'')),280),'');
begin
  v_employee_id:=public.crew_session_employee(p_token);
  if v_action='out' then
    select * into v_record from public.crew_attendance_records where employee_id=v_employee_id and status='open' for update;
    if not found then raise exception using errcode='22023',message='There is no open shift to clock out.'; end if;
    v_outlet_id:=v_record.outlet_id;
  else
    v_schedule:=public.crew_roster_employee_day(v_employee_id,timezone('Asia/Kuala_Lumpur',now())::date);
    v_outlet_id:=case when v_schedule is not null and coalesce(v_schedule->>'entry_type','working')='working' then (v_schedule->>'outlet_id')::uuid else null end;
    if v_outlet_id is null then select a.primary_outlet_id into v_outlet_id from public.crew_access a where a.employee_id=v_employee_id; end if;
  end if;
  select o.* into v_outlet from public.outlets o where o.id=v_outlet_id;
  if v_outlet.id is null then raise exception using errcode='22023',message='Your Crew Access has no assigned outlet. Ask your manager to confirm your workplace.'; end if;
  if v_outlet.attendance_location_enabled and (v_outlet.attendance_latitude is null or v_outlet.attendance_longitude is null) then raise exception using errcode='22023',message='This outlet has location verification enabled but is not configured. Ask your manager to update Outlet settings.'; end if;
  if p_location is not null then
    v_lat:=nullif(p_location->>'latitude','')::numeric; v_lon:=nullif(p_location->>'longitude','')::numeric; v_accuracy:=nullif(p_location->>'accuracy_meters','')::numeric;
    if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 then raise exception using errcode='22023',message='The supplied location is invalid.'; end if;
    if v_accuracy is not null and (v_accuracy<0 or v_accuracy>100000) then raise exception using errcode='22023',message='The supplied location accuracy is invalid.'; end if;
    v_has_location:=true;
    if v_outlet.attendance_location_enabled then v_distance:=round(public.crew_haversine_meters(v_lat,v_lon,v_outlet.attendance_latitude,v_outlet.attendance_longitude),2); v_verified:=v_distance<=v_outlet.attendance_radius_meters; end if;
  end if;
  if v_action='in' then
    select * into v_record from public.crew_attendance_records where employee_id=v_employee_id and status='open' for update;
    if found then raise exception using errcode='23505',message='You are already on shift.'; end if;
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location then raise exception using errcode='22023',message=format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to continue.',v_distance,v_outlet.attendance_radius_meters); end if;
        raise exception using errcode='22023',message='Location permission is required to verify this clock-in. Choose an exception reason to continue.';
      end if;
      v_exception:=true;
    end if;
    insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,status,clock_in_latitude,clock_in_longitude,clock_in_accuracy_meters,clock_in_distance_meters,clock_in_location_verified,clock_in_location_exception,clock_in_exception_reason,clock_in_verification_method)
    values(v_employee_id,v_outlet.id,now(),'open',v_lat,v_lon,v_accuracy,v_distance,v_verified,v_exception,case when v_exception then v_reason else null end,'gps') returning * into v_record;
  elsif v_action='out' then
    if v_outlet.attendance_location_enabled and not v_verified then
      if v_reason is null then
        if v_has_location then raise exception using errcode='22023',message=format('You are outside the outlet area (%s m away; allowed %s m). Choose an exception reason to clock out.',v_distance,v_outlet.attendance_radius_meters); end if;
        raise exception using errcode='22023',message='Location could not be verified. Choose an exception reason to clock out.';
      end if;
      v_exception:=true;
    end if;
    update public.crew_attendance_records set clock_out_at=now(),clock_out_source='mobile',status='completed',clock_out_latitude=v_lat,clock_out_longitude=v_lon,clock_out_accuracy_meters=v_accuracy,clock_out_distance_meters=v_distance,clock_out_location_verified=v_verified,clock_out_location_exception=v_exception,clock_out_exception_reason=case when v_exception then v_reason else null end,clock_out_verification_method='gps',updated_at=now() where id=v_record.id returning * into v_record;
  else raise exception using errcode='22023',message='Unsupported attendance action.'; end if;
  return jsonb_build_object('record',to_jsonb(v_record),'outlet',jsonb_build_object('id',v_outlet.id,'name',v_outlet.name,'location_enabled',v_outlet.attendance_location_enabled,'radius_meters',v_outlet.attendance_radius_meters),'schedule',v_schedule);
end; $$;
revoke all on function public.crew_clock(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crew_clock(text,text,jsonb,text) to anon,authenticated;

-- Admin-safe scheduled-vs-actual evidence. No score or disciplinary outcome is
-- produced here; downstream Performance can consume the versioned evidence.
create or replace function public.crew_attendance_admin_with_roster(p_from date default (timezone('Asia/Kuala_Lumpur',now())::date-31),p_to date default timezone('Asia/Kuala_Lumpur',now())::date,p_outlet_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('crew_attendance.view') then raise exception using errcode='42501',message='Attendance permission is required.'; end if;
  if p_outlet_id is not null and not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Attendance is outside your outlet scope.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.clock_in_at desc),'[]'::jsonb) into v_rows from (
    select a.*,jsonb_build_object('id',e.id,'full_name',e.full_name,'nickname',e.nickname,'position',e.position,'workplace',e.workplace) employee,
      jsonb_build_object('id',o.id,'name',o.name) outlet,s.schedule,
      case when s.schedule is null then 'no_roster' when s.schedule->>'entry_type'<>'working' then 'not_required' when a.status='open' then 'open' else 'completed' end roster_evidence_state,
      case when s.schedule is not null and s.schedule->>'entry_type'='working' and s.schedule->>'start_time' is not null then round(extract(epoch from (a.clock_in_at-(((s.schedule->>'date')::date+(s.schedule->>'start_time')::time) at time zone 'Asia/Kuala_Lumpur')))/60)::integer else null end clock_in_variance_minutes,
      'roster-attendance-evidence-v1' evidence_version
    from public.crew_attendance_records a join public.employees e on e.id=a.employee_id left join public.outlets o on o.id=a.outlet_id
    left join lateral(select public.crew_roster_employee_day(a.employee_id,timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date) schedule)s on true
    where timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date between p_from and p_to and (p_outlet_id is null or a.outlet_id=p_outlet_id) and public.current_user_can_access_outlet(a.outlet_id)
  ) x;
  return v_rows;
end; $$;
revoke all on function public.crew_attendance_admin_with_roster(date,date,uuid) from public,anon,authenticated;
grant execute on function public.crew_attendance_admin_with_roster(date,date,uuid) to authenticated;

create or replace function public.crew_performance_roster_attendance_evidence(p_employee_id uuid,p_period date)
returns jsonb language sql stable security definer set search_path=public as $$
  with days as (select generate_series(date_trunc('month',p_period)::date,(date_trunc('month',p_period)+interval '1 month'-interval '1 day')::date,interval '1 day')::date d),
  roster as (select d.d,public.crew_roster_employee_day(p_employee_id,d.d) schedule from days d),
  attendance as (select timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date d,count(*) records,count(*) filter(where a.status='completed') completed from public.crew_attendance_records a where a.employee_id=p_employee_id and a.clock_in_at>=date_trunc('month',p_period) and a.clock_in_at<date_trunc('month',p_period)+interval '1 month' group by 1)
  select jsonb_build_object('scheduled_working_days',count(*) filter(where schedule->>'entry_type'='working'),'non_working_roster_days',count(*) filter(where schedule is not null and schedule->>'entry_type'<>'working'),'completed_scheduled_days',count(*) filter(where schedule->>'entry_type'='working' and coalesce(attendance.completed,0)>0),'missing_after_day_end',count(*) filter(where schedule->>'entry_type'='working' and roster.d<timezone('Asia/Kuala_Lumpur',now())::date and coalesce(attendance.records,0)=0),'calculation_version','roster-attendance-evidence-v1') from roster left join attendance using(d);
$$;
revoke all on function public.crew_performance_roster_attendance_evidence(uuid,date) from public,anon,authenticated;

-- Daily Operations uses a published working roster as preferred outlet and
-- position context. With no roster it keeps the established primary-outlet and
-- employee-position behavior.
create or replace function public.crew_operations_today(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; outlet uuid; employee uuid; role_id uuid; position text; instances jsonb; tasks jsonb; shift jsonb; schedule jsonb;
begin
  ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; role_id:=nullif(ctx->>'role_id','')::uuid; schedule:=public.crew_roster_employee_day(employee,p_business_date);
  outlet:=case when schedule is not null and schedule->>'entry_type'='working' then (schedule->>'outlet_id')::uuid else (ctx->>'outlet_id')::uuid end;
  position:=case when schedule is not null and schedule->>'entry_type'='working' then coalesce(nullif(schedule->>'position',''),ctx->>'position') else ctx->>'position' end;
  perform public.crew_operations_ensure_instances(outlet,p_business_date);
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'type',i.operation_type,'status',public.crew_operations_refresh_instance(i.id),'available_from',i.available_from,'available_until',i.available_until,'completed_at',i.completed_at,'item_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id),'completed_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id and x.status not in ('pending','not_checked')),'exception_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id and x.status in ('exception','needs_attention'))) order by case i.operation_type when 'opening' then 1 when 'daily' then 2 when 'health' then 3 else 4 end,i.name),'[]'::jsonb) into instances from public.crew_operation_instances i where i.outlet_id=outlet and i.business_date=p_business_date and public.crew_operations_applicable(role_id,position,i.applicable_role_ids,i.applicable_positions);
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'priority',t.priority,'due_at',t.due_at,'status',case when t.status='pending' and t.due_at<now() then 'overdue' else t.status end,'sop_reference',t.sop_snapshot,'completed_at',t.completed_at) order by case t.priority when 'high' then 1 when 'normal' then 2 else 3 end,t.due_at nulls last,t.title),'[]'::jsonb) into tasks from public.crew_daily_tasks t where t.outlet_id=outlet and t.task_date=p_business_date and public.crew_operations_applicable(role_id,position,t.applicable_role_ids,t.applicable_positions);
  select jsonb_build_object('on_shift',exists(select 1 from public.crew_attendance_records a where a.employee_id=employee and a.outlet_id=outlet and a.status='open'),'clock_in_at',(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=employee and a.outlet_id=outlet and a.status='open')) into shift;
  return jsonb_build_object('date',p_business_date,'outlet',jsonb_build_object('id',outlet,'name',(select name from public.outlets where id=outlet)),'employee',jsonb_build_object('id',employee,'name',ctx->>'employee_name','position',position),'roster_context',schedule,'attendance_context',shift,'checklists',instances,'daily_tasks',tasks);
end; $$;
revoke all on function public.crew_operations_today(text,date) from public,anon,authenticated;
grant execute on function public.crew_operations_today(text,date) to anon,authenticated;

-- Correct the pre-existing broad execute drift on roster admin authorities.
revoke all on function public.save_roster_week_snapshot(uuid,uuid,date,jsonb) from public,anon,authenticated;
revoke all on function public.copy_roster_week(uuid,uuid,date,date,boolean) from public,anon,authenticated;
revoke all on function public.publish_roster_week(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.unpublish_roster_week(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.lock_roster_week(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.save_roster_week_snapshot(uuid,uuid,date,jsonb) to authenticated;
grant execute on function public.copy_roster_week(uuid,uuid,date,date,boolean) to authenticated;
grant execute on function public.publish_roster_week(uuid,uuid,date) to authenticated;
grant execute on function public.unpublish_roster_week(uuid,uuid,date) to authenticated;
grant execute on function public.lock_roster_week(uuid,uuid,date) to authenticated;
