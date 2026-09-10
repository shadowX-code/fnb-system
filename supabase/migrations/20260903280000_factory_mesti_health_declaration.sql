-- Unified, append-only MeSTI health evidence. Employee identity remains owned by
-- the canonical employee master; visitor context belongs to this declaration only.
insert into public.permissions(code, module, description) values
  ('factory_mesti_health_declaration.view', 'Factory MeSTI Health Declaration', 'View Factory MeSTI health declarations.'),
  ('factory_mesti_health_declaration.create', 'Factory MeSTI Health Declaration', 'Record Factory MeSTI health declarations.'),
  ('factory_mesti_health_declaration.manage', 'Factory MeSTI Health Declaration', 'Review employee health declarations and actions.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code like 'factory_mesti_health_declaration.%'
where lower(role.name) in ('owner', 'admin')
on conflict do nothing;

create table if not exists public.factory_mesti_health_declarations (
  id uuid primary key default gen_random_uuid(),
  declaration_type text not null check (declaration_type in ('employee', 'visitor')),
  declared_at timestamptz not null default now(),
  health_status text not null check (health_status in ('fit_for_work', 'health_issue_declared', 'cleared')),
  symptoms text[] not null default '{}'::text[] check (symptoms <@ array['diarrhea','fever','jaundice','visible_skin_infection','ear_nose_eye_infection','other']),
  notes text,
  employee_id uuid references public.employees(id) on delete restrict,
  employee_snapshot jsonb not null default '{}'::jsonb,
  work_action text check (work_action in ('not_allowed_to_work','leave_granted','other_preventive_action')),
  action_notes text,
  reviewed_by uuid references public.employees(id) on delete restrict,
  reviewed_at timestamptz,
  visitor_name text,
  visitor_company text,
  visitor_purpose text,
  visitor_host text,
  visitor_contact text,
  entry_decision text check (entry_decision in ('allowed','entry_restricted')),
  created_by uuid not null references public.employees(id) on delete restrict,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((declaration_type = 'employee' and employee_id is not null and visitor_name is null and entry_decision is null)
      or (declaration_type = 'visitor' and employee_id is null and nullif(btrim(visitor_name), '') is not null and work_action is null)),
  check ((declaration_type = 'employee' and ((health_status = 'fit_for_work' and cardinality(symptoms) = 0) or (health_status = 'health_issue_declared' and cardinality(symptoms) > 0)))
      or (declaration_type = 'visitor' and ((health_status = 'cleared' and cardinality(symptoms) = 0) or (health_status = 'health_issue_declared' and cardinality(symptoms) > 0))))
);

create unique index if not exists factory_mesti_health_declarations_request_key
  on public.factory_mesti_health_declarations(created_by, request_id) where request_id is not null;
create index if not exists factory_mesti_health_declarations_records_idx
  on public.factory_mesti_health_declarations(declared_at desc, declaration_type, health_status);

alter table public.factory_mesti_health_declarations enable row level security;
revoke all on public.factory_mesti_health_declarations from public, anon;
grant select on public.factory_mesti_health_declarations to authenticated;
drop policy if exists "factory health declarations read" on public.factory_mesti_health_declarations;
create policy "factory health declarations read" on public.factory_mesti_health_declarations for select to authenticated
using (public.current_user_has_permission('factory_mesti_health_declaration.view') or public.current_user_has_permission('factory_mesti_health_declaration.manage'));

create or replace function public.factory_mesti_health_declaration_employee_snapshot(p_employee public.employees)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('employee_id', p_employee.id, 'employee_name', coalesce(p_employee.nickname, p_employee.full_name), 'position', p_employee.position, 'employment_status', p_employee.employment_status)
$$;

create or replace function public.factory_mesti_submit_health_declaration(p_declaration jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := public.factory_current_active_employee_id();
  kind text := lower(btrim(p_declaration->>'declaration_type'));
  symptom_values text[] := coalesce(array(select lower(btrim(value)) from jsonb_array_elements_text(coalesce(p_declaration->'symptoms', '[]'::jsonb)) value where btrim(value) <> '' order by lower(btrim(value))), '{}'::text[]);
  employee public.employees%rowtype;
  row public.factory_mesti_health_declarations%rowtype;
  request uuid := nullif(p_declaration->>'request_id','')::uuid;
  visitor text := nullif(left(btrim(p_declaration->>'visitor_name'), 200), '');
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.create') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then
    raise exception using errcode='42501', message='Missing Health Declaration record permission.';
  end if;
  if kind not in ('employee','visitor') then raise exception using errcode='22023', message='Declaration type must be Employee or Visitor.'; end if;
  if symptom_values is not null and not (symptom_values <@ array['diarrhea','fever','jaundice','visible_skin_infection','ear_nose_eye_infection','other']) then
    raise exception using errcode='22023', message='One or more symptoms are invalid.';
  end if;
  if request is not null then
    select * into row from public.factory_mesti_health_declarations where created_by=actor and request_id=request;
    if row.id is not null then return to_jsonb(row) || jsonb_build_object('idempotent', true); end if;
  end if;
  if kind = 'employee' then
    select * into employee from public.employees where id = nullif(p_declaration->>'employee_id','')::uuid and is_active and coalesce(employment_status,'active') = 'active';
    if employee.id is null then raise exception using errcode='22023', message='Select an active canonical Employee.'; end if;
    insert into public.factory_mesti_health_declarations(declaration_type,health_status,symptoms,notes,employee_id,employee_snapshot,created_by,request_id)
    values ('employee', case when cardinality(symptom_values)=0 then 'fit_for_work' else 'health_issue_declared' end, symptom_values, nullif(left(btrim(p_declaration->>'notes'), 2000), ''), employee.id, public.factory_mesti_health_declaration_employee_snapshot(employee), actor, request)
    returning * into row;
  else
    if visitor is null then raise exception using errcode='22023', message='Visitor Name is required.'; end if;
    insert into public.factory_mesti_health_declarations(declaration_type,health_status,symptoms,notes,visitor_name,visitor_company,visitor_purpose,visitor_host,visitor_contact,entry_decision,created_by,request_id)
    values ('visitor', case when cardinality(symptom_values)=0 then 'cleared' else 'health_issue_declared' end, symptom_values, nullif(left(btrim(p_declaration->>'notes'), 2000), ''), visitor, nullif(left(btrim(p_declaration->>'company'),200),''), nullif(left(btrim(p_declaration->>'purpose'),300),''), nullif(left(btrim(p_declaration->>'host'),200),''), nullif(left(btrim(p_declaration->>'contact'),200),''), case when lower(p_declaration->>'entry_decision') = 'entry_restricted' then 'entry_restricted' else 'allowed' end, actor, request)
    returning * into row;
  end if;
  return to_jsonb(row) || jsonb_build_object('idempotent', false);
end $$;

create or replace function public.factory_mesti_action_health_declaration(p_declaration_id uuid, p_action text, p_action_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := public.factory_current_active_employee_id(); row public.factory_mesti_health_declarations%rowtype; action_value text := lower(btrim(p_action));
begin
  if not public.current_user_has_permission('factory_mesti_health_declaration.manage') then raise exception using errcode='42501', message='Missing Health Declaration manage permission.'; end if;
  if action_value not in ('not_allowed_to_work','leave_granted','other_preventive_action') then raise exception using errcode='22023', message='Choose a valid Employee work action.'; end if;
  select * into row from public.factory_mesti_health_declarations where id=p_declaration_id for update;
  if row.id is null or row.declaration_type <> 'employee' or row.health_status <> 'health_issue_declared' then raise exception using errcode='22023', message='Only an Employee Health Issue Declaration can be actioned.'; end if;
  if row.work_action is not null then raise exception using errcode='22023', message='Employee work action is already recorded and declaration evidence is immutable.'; end if;
  update public.factory_mesti_health_declarations set work_action=action_value, action_notes=nullif(left(btrim(p_action_notes),2000),''), reviewed_by=actor, reviewed_at=now(), updated_at=now() where id=row.id returning * into row;
  return to_jsonb(row);
end $$;

create or replace function public.factory_mesti_health_declaration_records(p_date_from date default null, p_date_to date default null, p_type text default null, p_health_status text default null, p_symptom text default null, p_search text default null)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.view') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then raise exception using errcode='42501', message='Missing Health Declaration view permission.'; end if;
  return query select jsonb_build_object('id',d.id,'declaration_type',d.declaration_type,'declared_at',d.declared_at,'health_status',d.health_status,'symptoms',d.symptoms,'notes',d.notes,'employee_id',d.employee_id,'employee_snapshot',d.employee_snapshot,'visitor_name',d.visitor_name,'visitor_company',d.visitor_company,'visitor_purpose',d.visitor_purpose,'visitor_host',d.visitor_host,'visitor_contact',d.visitor_contact,'work_action',d.work_action,'action_notes',d.action_notes,'entry_decision',d.entry_decision,'recorded_by_name',coalesce(recorder.nickname,recorder.full_name),'reviewed_by_name',coalesce(reviewer.nickname,reviewer.full_name),'reviewed_at',d.reviewed_at,'created_at',d.created_at)
  from public.factory_mesti_health_declarations d left join public.employees recorder on recorder.id=d.created_by left join public.employees reviewer on reviewer.id=d.reviewed_by
  where (p_date_from is null or d.declared_at::date >= p_date_from) and (p_date_to is null or d.declared_at::date <= p_date_to) and (p_type is null or d.declaration_type=p_type) and (p_health_status is null or d.health_status=p_health_status) and (p_symptom is null or p_symptom=any(d.symptoms)) and (p_search is null or lower(concat_ws(' ',d.employee_snapshot->>'employee_name',d.visitor_name,d.visitor_company)) like '%'||lower(p_search)||'%')
  order by d.declared_at desc,d.created_at desc;
end $$;

create or replace function public.factory_mesti_health_declaration_options()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.view') or public.current_user_has_permission('factory_mesti_health_declaration.create') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then raise exception using errcode='42501', message='Missing Health Declaration permission.'; end if;
  return jsonb_build_object('employees', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name),'position',e.position) order by coalesce(e.nickname,e.full_name)) from public.employees e where e.is_active and coalesce(e.employment_status,'active')='active'),'[]'::jsonb));
end $$;

revoke all on function public.factory_mesti_submit_health_declaration(jsonb), public.factory_mesti_action_health_declaration(uuid,text,text), public.factory_mesti_health_declaration_records(date,date,text,text,text,text), public.factory_mesti_health_declaration_options() from public, anon;
grant execute on function public.factory_mesti_submit_health_declaration(jsonb), public.factory_mesti_action_health_declaration(uuid,text,text), public.factory_mesti_health_declaration_records(date,date,text,text,text,text), public.factory_mesti_health_declaration_options() to authenticated;
