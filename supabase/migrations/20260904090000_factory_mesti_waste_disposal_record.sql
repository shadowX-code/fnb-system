insert into public.permissions(code, module, description) values
  ('factory_mesti_waste_disposal.view', 'Factory MeSTI Waste Disposal', 'View Factory waste disposal records.'),
  ('factory_mesti_waste_disposal.manage', 'Factory MeSTI Waste Disposal', 'Maintain Factory waste disposal requirements.'),
  ('factory_mesti_waste_disposal.record', 'Factory MeSTI Waste Disposal', 'Record Factory waste disposal events.'),
  ('factory_mesti_waste_disposal.submit', 'Factory MeSTI Waste Disposal', 'Submit daily Factory waste disposal records.'),
  ('factory_mesti_waste_disposal.verify', 'Factory MeSTI Waste Disposal', 'Verify daily Factory waste disposal records.')
on conflict (code) do nothing;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id from public.roles role join public.permissions permission on permission.code like 'factory_mesti_waste_disposal.%'
where lower(role.name) in ('owner', 'admin') on conflict do nothing;

create table public.factory_mesti_waste_disposal_requirements (
  id uuid primary key default gen_random_uuid(),
  logical_requirement_id uuid not null,
  location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  frequency text not null default 'daily' check (frequency = 'daily'),
  required_count integer not null check (required_count > 0),
  effective_from date not null default current_date,
  effective_until date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  version_no integer not null default 1 check (version_no > 0),
  superseded_by uuid references public.factory_mesti_waste_disposal_requirements(id) on delete set null,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from),
  unique (logical_requirement_id, version_no)
);
create unique index factory_mesti_waste_disposal_requirement_current_key on public.factory_mesti_waste_disposal_requirements(logical_requirement_id) where effective_until is null;
create index factory_mesti_waste_disposal_requirement_daily_idx on public.factory_mesti_waste_disposal_requirements(location_id, effective_from, effective_until);

create table public.factory_mesti_waste_disposal_sessions (
  id uuid primary key default gen_random_uuid(),
  disposal_date date not null unique,
  status text not null default 'draft' check (status in ('draft','submitted','verified')),
  submitted_by uuid references public.employees(id), submitted_at timestamptz,
  verified_by uuid references public.employees(id), verified_at timestamptz,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((status = 'draft') = (submitted_by is null and submitted_at is null)),
  check ((status <> 'verified') or (verified_by is not null and verified_at is not null))
);

create table public.factory_mesti_waste_disposal_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.factory_mesti_waste_disposal_sessions(id) on delete restrict,
  location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  location_snapshot jsonb not null,
  disposed_at timestamptz not null,
  completed_by uuid not null references public.employees(id),
  remarks text,
  created_at timestamptz not null default now(),
  unique (id, session_id)
);
create index factory_mesti_waste_disposal_events_session_location_idx on public.factory_mesti_waste_disposal_events(session_id, location_id, disposed_at);

alter table public.factory_mesti_waste_disposal_requirements enable row level security;
alter table public.factory_mesti_waste_disposal_sessions enable row level security;
alter table public.factory_mesti_waste_disposal_events enable row level security;
create policy "waste disposal requirement read" on public.factory_mesti_waste_disposal_requirements for select to authenticated using (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage'));
create policy "waste disposal session read" on public.factory_mesti_waste_disposal_sessions for select to authenticated using (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage'));
create policy "waste disposal event read" on public.factory_mesti_waste_disposal_events for select to authenticated using (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage'));
revoke all on public.factory_mesti_waste_disposal_requirements, public.factory_mesti_waste_disposal_sessions, public.factory_mesti_waste_disposal_events from public, anon;
grant select on public.factory_mesti_waste_disposal_requirements, public.factory_mesti_waste_disposal_sessions, public.factory_mesti_waste_disposal_events to authenticated;

create or replace function public.factory_mesti_waste_disposal_location_snapshot(p_location public.factory_storage_locations)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('location_id', p_location.id, 'location_name', p_location.location_name, 'location_code', p_location.location_code, 'location_type', p_location.location_type)
$$;

create or replace function public.factory_save_mesti_waste_disposal_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_current_active_employee_id(); v_id uuid := nullif(p_requirement->>'id','')::uuid;
  v_location uuid := nullif(p_requirement->>'location_id','')::uuid; v_count integer := nullif(p_requirement->>'required_count','')::integer;
  v_effective date := coalesce(nullif(p_requirement->>'effective_from','')::date,current_date); v_status text := coalesce(nullif(p_requirement->>'status',''),'active');
  v_current public.factory_mesti_waste_disposal_requirements%rowtype; v_saved public.factory_mesti_waste_disposal_requirements%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.manage') then raise exception using errcode='42501', message='Missing waste disposal manage permission.'; end if;
  if v_location is null or v_count is null or v_count < 1 or v_status not in ('active','inactive') then raise exception 'Location, Daily frequency, Required Times / Day and Status are required.'; end if;
  if not exists(select 1 from public.factory_storage_locations where id=v_location and status='active') then raise exception 'Selected Location is not active.'; end if;
  if v_id is null then
    insert into public.factory_mesti_waste_disposal_requirements(logical_requirement_id,location_id,required_count,effective_from,status,created_by)
    values(gen_random_uuid(),v_location,v_count,v_effective,v_status,v_actor) returning * into v_saved;
  else
    select * into v_current from public.factory_mesti_waste_disposal_requirements where id=v_id for update;
    if v_current.id is null then raise exception 'Waste disposal requirement not found.'; end if;
    if (v_current.location_id,v_current.required_count,v_current.frequency,v_current.status,v_current.effective_from) = (v_location,v_count,'daily',v_status,v_effective) then return to_jsonb(v_current) || jsonb_build_object('version_created',false); end if;
    v_effective := greatest(v_effective,current_date,v_current.effective_from);
    update public.factory_mesti_waste_disposal_requirements set effective_until=v_effective, updated_at=now() where id=v_current.id;
    insert into public.factory_mesti_waste_disposal_requirements(logical_requirement_id,location_id,required_count,effective_from,status,version_no,created_by)
    values(v_current.logical_requirement_id,v_location,v_count,v_effective,v_status,v_current.version_no+1,v_actor) returning * into v_saved;
    update public.factory_mesti_waste_disposal_requirements set superseded_by=v_saved.id where id=v_current.id;
  end if;
  return to_jsonb(v_saved) || jsonb_build_object('version_created', v_id is not null);
end $$;

create or replace function public.factory_mesti_waste_disposal_record(p_date date, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_current_active_employee_id(); v_session public.factory_mesti_waste_disposal_sessions%rowtype; v_location uuid := nullif(p_event->>'location_id','')::uuid; v_disposed timestamptz := coalesce(nullif(p_event->>'disposed_at','')::timestamptz, now()); v_result jsonb;
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.record') then raise exception using errcode='42501', message='Missing waste disposal record permission.'; end if;
  if v_location is null then raise exception 'Location is required.'; end if;
  if not exists(select 1 from public.factory_mesti_waste_disposal_requirements r where r.location_id=v_location and r.status='active' and r.effective_from<=p_date and (r.effective_until is null or r.effective_until>p_date)) then raise exception 'No active waste disposal requirement applies to this Location.'; end if;
  insert into public.factory_mesti_waste_disposal_sessions(disposal_date,created_by) values(p_date,v_actor) on conflict(disposal_date) do update set updated_at=now() returning * into v_session;
  if v_session.status <> 'draft' then raise exception 'Submitted waste disposal sessions are immutable.'; end if;
  insert into public.factory_mesti_waste_disposal_events(session_id,location_id,location_snapshot,disposed_at,completed_by,remarks)
  select v_session.id,location.id,public.factory_mesti_waste_disposal_location_snapshot(location),v_disposed,v_actor,nullif(btrim(p_event->>'remarks'),'') from public.factory_storage_locations location where location.id=v_location
  returning to_jsonb(factory_mesti_waste_disposal_events.*) into v_result;
  return v_result;
end $$;

create or replace function public.factory_mesti_waste_disposal_submit(p_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_current_active_employee_id(); v_session public.factory_mesti_waste_disposal_sessions%rowtype;
begin
  if not (public.current_user_has_permission('factory_mesti_waste_disposal.submit') or public.current_user_has_permission('factory_mesti_waste_disposal.manage')) then raise exception using errcode='42501', message='Missing waste disposal submit permission.'; end if;
  select * into v_session from public.factory_mesti_waste_disposal_sessions where disposal_date=p_date for update;
  if v_session.id is null then raise exception 'Waste disposal session not found.'; end if;
  if not exists(select 1 from public.factory_mesti_waste_disposal_events where session_id=v_session.id) then raise exception 'Waste disposal session has no disposal events.'; end if;
  if v_session.status='draft' then update public.factory_mesti_waste_disposal_sessions set status='submitted',submitted_by=v_actor,submitted_at=now(),updated_at=now() where id=v_session.id returning * into v_session; end if;
  return to_jsonb(v_session);
end $$;

create or replace function public.factory_mesti_waste_disposal_verify(p_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_current_active_employee_id(); v_session public.factory_mesti_waste_disposal_sessions%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.verify') then raise exception using errcode='42501', message='Missing waste disposal verify permission.'; end if;
  select * into v_session from public.factory_mesti_waste_disposal_sessions where disposal_date=p_date for update;
  if v_session.status <> 'submitted' then raise exception 'Waste disposal is not awaiting verification.'; end if;
  if v_session.submitted_by=v_actor then raise exception 'Self-verification is not allowed.'; end if;
  update public.factory_mesti_waste_disposal_sessions set status='verified',verified_by=v_actor,verified_at=now(),updated_at=now() where id=v_session.id returning * into v_session;
  return to_jsonb(v_session);
end $$;

create or replace function public.factory_mesti_waste_disposal_daily(p_date date)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage')) then raise exception using errcode='42501', message='Missing waste disposal view permission.'; end if;
  return jsonb_build_object('session',(select to_jsonb(s)||jsonb_build_object('submitted_by_name',coalesce(sb.nickname,sb.full_name),'verified_by_name',coalesce(vb.nickname,vb.full_name)) from public.factory_mesti_waste_disposal_sessions s left join public.employees sb on sb.id=s.submitted_by left join public.employees vb on vb.id=s.verified_by where s.disposal_date=p_date),'locations',coalesce((select jsonb_agg(row.value order by row.location_name) from (select l.location_name,jsonb_build_object('requirement_id',r.id,'location_id',l.id,'location_name',l.location_name,'location_snapshot',public.factory_mesti_waste_disposal_location_snapshot(l),'required_count',r.required_count,'completed_count',count(e.id),'events',coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('completed_by_name',coalesce(c.nickname,c.full_name)) order by e.disposed_at) filter(where e.id is not null),'[]'::jsonb)) value from public.factory_mesti_waste_disposal_requirements r join public.factory_storage_locations l on l.id=r.location_id left join public.factory_mesti_waste_disposal_sessions s on s.disposal_date=p_date left join public.factory_mesti_waste_disposal_events e on e.session_id=s.id and e.location_id=l.id left join public.employees c on c.id=e.completed_by where r.status='active' and r.effective_from<=p_date and (r.effective_until is null or r.effective_until>p_date) group by r.id,l.id,l.location_name) row),'[]'::jsonb));
end $$;

create or replace function public.factory_mesti_waste_disposal_monthly(p_month date)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage')) then raise exception using errcode='42501', message='Missing waste disposal view permission.'; end if;
  return query with days as (select d::date as run_date from generate_series(date_trunc('month',p_month),date_trunc('month',p_month)+interval '1 month - 1 day','1 day') d), applicable as (select l.id location_id,l.location_name,d.run_date,r.required_count from days d join public.factory_mesti_waste_disposal_requirements r on r.status='active' and r.effective_from<=d.run_date and (r.effective_until is null or r.effective_until>d.run_date) join public.factory_storage_locations l on l.id=r.location_id), counts as (select a.*,s.status session_status,s.submitted_at,s.verified_at,coalesce(sb.nickname,sb.full_name) submitted_by_name,coalesce(vb.nickname,vb.full_name) verified_by_name,count(e.id) completed_count,jsonb_agg(to_jsonb(e)||jsonb_build_object('completed_by_name',coalesce(c.nickname,c.full_name)) order by e.disposed_at) filter(where e.id is not null) events from applicable a left join public.factory_mesti_waste_disposal_sessions s on s.disposal_date=a.run_date left join public.factory_mesti_waste_disposal_events e on e.session_id=s.id and e.location_id=a.location_id left join public.employees c on c.id=e.completed_by left join public.employees sb on sb.id=s.submitted_by left join public.employees vb on vb.id=s.verified_by group by a.location_id,a.location_name,a.run_date,a.required_count,s.status,s.submitted_at,s.verified_at,sb.nickname,sb.full_name,vb.nickname,vb.full_name) select jsonb_build_object('location_id',location_id,'location_name',location_name,'days',jsonb_object_agg(run_date::text,jsonb_build_object('required_count',required_count,'completed_count',completed_count,'events',coalesce(events,'[]'::jsonb),'session_status',session_status,'state',case when completed_count<required_count then 'incomplete' when session_status='verified' then 'verified_compliant' else 'awaiting_verification' end,'submitted_by_name',submitted_by_name,'submitted_at',submitted_at,'verified_by_name',verified_by_name,'verified_at',verified_at))) from counts group by location_id,location_name order by location_name;
end $$;

create or replace function public.factory_mesti_waste_disposal_requirements()
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage')) then raise exception using errcode='42501', message='Missing waste disposal view permission.'; end if;
  return query select to_jsonb(r)||jsonb_build_object('location_name',l.location_name) from public.factory_mesti_waste_disposal_requirements r join public.factory_storage_locations l on l.id=r.location_id where r.effective_until is null order by l.location_name;
end $$;

create or replace function public.factory_mesti_waste_disposal_locations()
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.manage') then raise exception using errcode='42501', message='Missing waste disposal manage permission.'; end if;
  return query select jsonb_build_object('id',id,'location_name',location_name,'status',status) from public.factory_storage_locations where status='active' order by location_name;
end $$;

revoke all on function public.factory_mesti_waste_disposal_location_snapshot(public.factory_storage_locations), public.factory_save_mesti_waste_disposal_requirement(jsonb), public.factory_mesti_waste_disposal_record(date,jsonb), public.factory_mesti_waste_disposal_submit(date), public.factory_mesti_waste_disposal_verify(date), public.factory_mesti_waste_disposal_daily(date), public.factory_mesti_waste_disposal_monthly(date), public.factory_mesti_waste_disposal_requirements(), public.factory_mesti_waste_disposal_locations() from public, anon;
grant execute on function public.factory_save_mesti_waste_disposal_requirement(jsonb), public.factory_mesti_waste_disposal_record(date,jsonb), public.factory_mesti_waste_disposal_submit(date), public.factory_mesti_waste_disposal_verify(date), public.factory_mesti_waste_disposal_daily(date), public.factory_mesti_waste_disposal_monthly(date), public.factory_mesti_waste_disposal_requirements(), public.factory_mesti_waste_disposal_locations() to authenticated;
