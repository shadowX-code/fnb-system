-- Factory MeSTI Calibration: versioned requirements and immutable verified records.
insert into public.permissions(code,module,description) values
 ('factory_mesti_calibration.view','Factory MeSTI Calibration','View Factory calibration schedules and records.'),
 ('factory_mesti_calibration.create','Factory MeSTI Calibration','Create Factory calibration requirements and records.'),
 ('factory_mesti_calibration.edit','Factory MeSTI Calibration','Edit Factory calibration requirements.'),
 ('factory_mesti_calibration.complete','Factory MeSTI Calibration','Record Factory calibration results.'),
 ('factory_mesti_calibration.review','Factory MeSTI Calibration','Verify Factory calibration records.'),
 ('factory_mesti_calibration.manage','Factory MeSTI Calibration','Manage Factory calibration settings and requirements.')
on conflict (code) do update set module=excluded.module, description=excluded.description;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.code like 'factory_mesti_calibration.%'
where lower(r.name) in ('owner','admin') on conflict do nothing;

create table if not exists public.factory_mesti_calibration_settings (
 singleton boolean primary key default true check(singleton), responsible_role_id uuid not null references public.roles(id), verifier_role_id uuid not null references public.roles(id), updated_by uuid references public.employees(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.factory_mesti_calibration_requirements (
 id uuid primary key default gen_random_uuid(), logical_requirement_id uuid not null default gen_random_uuid(), equipment_id uuid not null references public.factory_equipment(id) on delete restrict,
 calibration_type text not null, interval_months integer not null check(interval_months in (1,3,6,12)), effective_from date not null, effective_until date,
 status text not null default 'active' check(status in ('active','inactive')), version_no integer not null default 1, superseded_by uuid references public.factory_mesti_calibration_requirements(id) on delete set null,
 created_by uuid references public.employees(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(effective_until is null or effective_until > effective_from)
);
create extension if not exists btree_gist;
create unique index if not exists factory_mesti_calibration_current_requirement_key on public.factory_mesti_calibration_requirements(logical_requirement_id) where effective_until is null;
create unique index if not exists factory_mesti_calibration_current_equipment_type_key on public.factory_mesti_calibration_requirements(equipment_id,lower(calibration_type)) where status='active' and effective_until is null;
alter table public.factory_mesti_calibration_requirements
  add constraint factory_mesti_calibration_requirement_effective_range_no_overlap
  exclude using gist (
    logical_requirement_id with =,
    daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)') with &&
  );
create table if not exists public.factory_mesti_calibration_records (
 id uuid primary key default gen_random_uuid(), logical_requirement_id uuid not null, requirement_id uuid not null references public.factory_mesti_calibration_requirements(id) on delete restrict,
 equipment_id uuid not null references public.factory_equipment(id) on delete restrict, scheduled_due_date date not null, calibrated_date date not null,
 result text not null check(result in ('pass','fail')), status text not null default 'awaiting_verification' check(status in ('awaiting_verification','verified')),
 equipment_snapshot jsonb not null, provider_name text, reference_no text, notes text, recorded_by uuid not null references public.employees(id), recorded_at timestamptz not null default now(),
 verified_by uuid references public.employees(id), verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(requirement_id,scheduled_due_date,calibrated_date)
);
create index if not exists factory_mesti_calibration_records_requirement_idx on public.factory_mesti_calibration_records(logical_requirement_id,calibrated_date desc);
alter table public.factory_mesti_calibration_settings enable row level security; alter table public.factory_mesti_calibration_requirements enable row level security; alter table public.factory_mesti_calibration_records enable row level security;
grant select on public.factory_mesti_calibration_settings,public.factory_mesti_calibration_requirements,public.factory_mesti_calibration_records to authenticated;
create policy "calibration settings read" on public.factory_mesti_calibration_settings for select to authenticated using(public.current_user_has_permission('factory_mesti_calibration.view') or public.current_user_has_permission('factory_mesti_calibration.manage'));
create policy "calibration requirements read" on public.factory_mesti_calibration_requirements for select to authenticated using(public.current_user_has_permission('factory_mesti_calibration.view') or public.current_user_has_permission('factory_mesti_calibration.manage'));
create policy "calibration records read" on public.factory_mesti_calibration_records for select to authenticated using(public.current_user_has_permission('factory_mesti_calibration.view') or public.current_user_has_permission('factory_mesti_calibration.manage'));
drop policy if exists "factory equipment view" on public.factory_equipment;
create policy "factory equipment view" on public.factory_equipment for select to authenticated using(public.current_user_has_permission('factory_equipment.view') or public.current_user_has_permission('factory_equipment.manage') or public.current_user_has_permission('factory_production.complete') or public.current_user_has_permission('factory_production.view') or public.current_user_has_permission('factory_mesti_calibration.view') or public.current_user_has_permission('factory_mesti_calibration.manage'));

create or replace function public.factory_mesti_calibration_due_date(p_anchor date,p_interval integer) returns date language sql immutable as $$ select (p_anchor + make_interval(months=>p_interval))::date $$;
create or replace function public.factory_mesti_calibration_snapshot(p_equipment public.factory_equipment) returns jsonb language sql stable as $$
 select jsonb_build_object('equipment_id',p_equipment.id,'equipment_code',p_equipment.equipment_code,'equipment_name',p_equipment.name,'category_name',c.name,'location_id',l.id,'location_name',l.location_name) from public.factory_storage_locations l left join public.factory_equipment_categories c on c.id=p_equipment.category_id where l.id=p_equipment.current_location_id $$;

create or replace function public.factory_save_mesti_calibration_settings(p_settings jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ declare a uuid:=public.factory_current_active_employee_id(); begin
 if not public.current_user_has_permission('factory_mesti_calibration.manage') then raise exception using errcode='42501',message='Missing calibration manage permission.'; end if;
 insert into public.factory_mesti_calibration_settings(singleton,responsible_role_id,verifier_role_id,updated_by) values(true,(p_settings->>'responsible_role_id')::uuid,(p_settings->>'verifier_role_id')::uuid,a) on conflict(singleton) do update set responsible_role_id=excluded.responsible_role_id,verifier_role_id=excluded.verifier_role_id,updated_by=a,updated_at=now();
 return (select to_jsonb(s) from public.factory_mesti_calibration_settings s where singleton); end $$;

create or replace function public.factory_save_mesti_calibration_requirement(p_requirement jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  a uuid := public.factory_current_active_employee_id();
  cur public.factory_mesti_calibration_requirements%rowtype;
  saved public.factory_mesti_calibration_requirements%rowtype;
  v_id uuid := nullif(p_requirement->>'id','')::uuid;
  requested_effective_from date := coalesce(nullif(p_requirement->>'effective_from','')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date);
  effective_from date;
  latest_evidence_date date;
  typ text := btrim(p_requirement->>'calibration_type');
  eq uuid := nullif(p_requirement->>'equipment_id','')::uuid;
  months integer := (p_requirement->>'interval_months')::integer;
  stat text := coalesce(nullif(p_requirement->>'status',''),'active');
  changed boolean;
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.create') or public.current_user_has_permission('factory_mesti_calibration.edit') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode='42501',message='Missing calibration setup permission.'; end if;
  if eq is null or typ = '' or months not in (1,3,6,12) or stat not in ('active','inactive') then raise exception using errcode='22023',message='Equipment, Calibration Type, status and a valid interval are required.'; end if;
  if stat = 'active' and not exists (select 1 from public.factory_equipment where id=eq and status='active') then raise exception using errcode='22023',message='Only active Factory Equipment may have an active calibration requirement.'; end if;
  if v_id is null then
    insert into public.factory_mesti_calibration_requirements(equipment_id,calibration_type,interval_months,effective_from,status,created_by) values(eq,typ,months,requested_effective_from,stat,a) returning * into saved;
    return to_jsonb(saved)||jsonb_build_object('version_created',true);
  end if;
  select * into cur from public.factory_mesti_calibration_requirements where id=v_id;
  if cur.id is null then raise exception using errcode='22023',message='Calibration requirement was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(cur.logical_requirement_id::text, 0));
  select * into cur from public.factory_mesti_calibration_requirements where logical_requirement_id=cur.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
  if cur.id is null then raise exception using errcode='22023',message='Calibration requirement has no current version.'; end if;
  changed := cur.equipment_id is distinct from eq or lower(cur.calibration_type) is distinct from lower(typ) or cur.interval_months is distinct from months or cur.status is distinct from stat or cur.effective_from is distinct from requested_effective_from;
  if not changed then return to_jsonb(cur)||jsonb_build_object('version_created',false); end if;
  select max(calibrated_date) into latest_evidence_date from public.factory_mesti_calibration_records where logical_requirement_id=cur.logical_requirement_id;
  effective_from := greatest(requested_effective_from,(now() at time zone 'Asia/Kuala_Lumpur')::date,cur.effective_from + 1,coalesce(latest_evidence_date + 1,'-infinity'::date));
  update public.factory_mesti_calibration_requirements set effective_until=effective_from,updated_at=now() where id=cur.id;
  insert into public.factory_mesti_calibration_requirements(logical_requirement_id,equipment_id,calibration_type,interval_months,effective_from,status,version_no,created_by) values(cur.logical_requirement_id,eq,typ,months,effective_from,stat,cur.version_no+1,a) returning * into saved;
  update public.factory_mesti_calibration_requirements set superseded_by=saved.id,updated_at=now() where id=cur.id;
  return to_jsonb(saved)||jsonb_build_object('version_created',true);
end $$;

create or replace function public.factory_mesti_calibration_schedule() returns setof jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.view') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode='42501',message='Missing calibration view permission.'; end if;
  return query
  with current_requirements as (select r.* from public.factory_mesti_calibration_requirements r where r.effective_until is null), latest_verified as (select distinct on (logical_requirement_id) * from public.factory_mesti_calibration_records where status='verified' order by logical_requirement_id,verified_at desc,created_at desc), latest_pass as (select distinct on (logical_requirement_id) * from public.factory_mesti_calibration_records where status='verified' and result='pass' order by logical_requirement_id,verified_at desc,created_at desc), rows as (select r,e.equipment_code,e.name equipment_name,c.name category_name,l.location_name,latest_pass.calibrated_date last_calibration,coalesce(public.factory_mesti_calibration_due_date(latest_pass.calibrated_date,r.interval_months),r.effective_from) next_due,latest_verified.result last_result from current_requirements r join public.factory_equipment e on e.id=r.equipment_id left join public.factory_equipment_categories c on c.id=e.category_id left join public.factory_storage_locations l on l.id=e.current_location_id left join latest_pass on latest_pass.logical_requirement_id=r.logical_requirement_id left join latest_verified on latest_verified.logical_requirement_id=r.logical_requirement_id)
  select jsonb_build_object('id',id,'logical_requirement_id',logical_requirement_id,'equipment_id',equipment_id,'equipment_code',equipment_code,'equipment_name',equipment_name,'category_name',category_name,'location_name',location_name,'calibration_type',calibration_type,'interval_months',interval_months,'effective_from',effective_from,'last_calibration',last_calibration,'next_due',next_due,'status',case when status='inactive' then 'inactive' when last_result='fail' then 'failed' when next_due < (now() at time zone 'Asia/Kuala_Lumpur')::date then 'overdue' when next_due = (now() at time zone 'Asia/Kuala_Lumpur')::date then 'due' when next_due <= ((now() at time zone 'Asia/Kuala_Lumpur')::date+7) then 'due_soon' else 'current' end) from rows;
end $$;
revoke all on function public.factory_mesti_calibration_schedule() from public,anon; grant execute on function public.factory_mesti_calibration_schedule() to authenticated;

create or replace function public.factory_mesti_record_calibration(p_requirement_id uuid,p_record jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ declare a uuid:=public.factory_current_active_employee_id(); req public.factory_mesti_calibration_requirements%rowtype; equip public.factory_equipment%rowtype; settings public.factory_mesti_calibration_settings%rowtype; rec public.factory_mesti_calibration_records%rowtype; due date:=(p_record->>'scheduled_due_date')::date; calibrated date:=(p_record->>'calibrated_date')::date; expected_due date; result_value text:=lower(btrim(p_record->>'result')); begin
 if not (public.current_user_has_permission('factory_mesti_calibration.complete') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode='42501',message='Missing calibration record permission.'; end if;
 select * into settings from public.factory_mesti_calibration_settings where singleton; if settings.singleton is not true or (select role_id from public.employees where id=a) is distinct from settings.responsible_role_id then raise exception using errcode='42501',message='Your role is not authorized to record calibration.'; end if;
 select * into req from public.factory_mesti_calibration_requirements where id=p_requirement_id and status='active' and effective_until is null; if req.id is null then raise exception using errcode='22023',message='Active calibration requirement was not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(req.logical_requirement_id::text, 0));
 select * into req from public.factory_mesti_calibration_requirements where logical_requirement_id=req.logical_requirement_id and effective_until is null and status='active' for update;
 if req.id is null then raise exception using errcode='22023',message='Active calibration requirement was not found.'; end if;
 if due is null or calibrated is null or result_value not in ('pass','fail') then raise exception using errcode='22023',message='Scheduled Due, Calibrated Date and a Pass or Fail result are required.'; end if;
 select coalesce(public.factory_mesti_calibration_due_date(r.calibrated_date,req.interval_months),req.effective_from) into expected_due from public.factory_mesti_calibration_records r where r.logical_requirement_id=req.logical_requirement_id and r.status='verified' and r.result='pass' order by r.verified_at desc,r.created_at desc limit 1;
 if due is distinct from coalesce(expected_due,req.effective_from) then raise exception using errcode='22023',message='Scheduled Due no longer matches the canonical calibration schedule.'; end if;
 select * into equip from public.factory_equipment where id=req.equipment_id; if equip.id is null then raise exception using errcode='22023',message='Equipment was not found.'; end if;
 insert into public.factory_mesti_calibration_records(logical_requirement_id,requirement_id,equipment_id,scheduled_due_date,calibrated_date,result,equipment_snapshot,provider_name,reference_no,notes,recorded_by) values(req.logical_requirement_id,req.id,equip.id,due,calibrated,result_value,public.factory_mesti_calibration_snapshot(equip),nullif(btrim(p_record->>'provider_name'),''),nullif(btrim(p_record->>'reference_no'),''),nullif(btrim(p_record->>'notes'),''),a) returning * into rec; return to_jsonb(rec); end $$;
create or replace function public.factory_mesti_verify_calibration(p_record_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ declare a uuid:=public.factory_current_active_employee_id(); rec public.factory_mesti_calibration_records%rowtype; settings public.factory_mesti_calibration_settings%rowtype; begin
 if not (public.current_user_has_permission('factory_mesti_calibration.review') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode='42501',message='Missing calibration verification permission.'; end if; select * into settings from public.factory_mesti_calibration_settings where singleton; if settings.singleton is not true or (select role_id from public.employees where id=a) is distinct from settings.verifier_role_id then raise exception using errcode='42501',message='Your role is not authorized to verify calibration.'; end if; select * into rec from public.factory_mesti_calibration_records where id=p_record_id for update; if rec.id is null or rec.status <> 'awaiting_verification' then raise exception 'Calibration record is not awaiting verification.'; end if; if rec.recorded_by=a then raise exception 'Self-verification is not allowed.'; end if; update public.factory_mesti_calibration_records set status='verified',verified_by=a,verified_at=now(),updated_at=now() where id=rec.id returning * into rec; return to_jsonb(rec); end $$;
create or replace function public.factory_mesti_calibration_records() returns setof jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$ begin
 if not (public.current_user_has_permission('factory_mesti_calibration.view') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode='42501',message='Missing calibration view permission.'; end if;
 return query select jsonb_build_object('id',r.id,'logical_requirement_id',r.logical_requirement_id,'requirement_id',r.requirement_id,'scheduled_due_date',r.scheduled_due_date,'calibrated_date',r.calibrated_date,'result',r.result,'status',r.status,'equipment_snapshot',r.equipment_snapshot,'provider_name',r.provider_name,'reference_no',r.reference_no,'notes',r.notes,'recorded_at',r.recorded_at,'verified_at',r.verified_at,'recorded_by_name',coalesce(e1.nickname,e1.full_name),'verified_by_name',coalesce(e2.nickname,e2.full_name)) from public.factory_mesti_calibration_records r left join public.employees e1 on e1.id=r.recorded_by left join public.employees e2 on e2.id=r.verified_by order by r.calibrated_date desc,r.created_at desc;
end $$;
revoke all on function public.factory_save_mesti_calibration_settings(jsonb),public.factory_save_mesti_calibration_requirement(jsonb),public.factory_mesti_record_calibration(uuid,jsonb),public.factory_mesti_verify_calibration(uuid),public.factory_mesti_calibration_records() from public,anon;
grant execute on function public.factory_save_mesti_calibration_settings(jsonb),public.factory_save_mesti_calibration_requirement(jsonb),public.factory_mesti_record_calibration(uuid,jsonb),public.factory_mesti_verify_calibration(uuid),public.factory_mesti_calibration_records() to authenticated;
