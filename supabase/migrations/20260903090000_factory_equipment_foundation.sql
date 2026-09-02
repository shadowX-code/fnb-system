-- Canonical Factory Equipment master and actual production-use evidence.
-- SOP equipment fields remain planning text; this records only selected instances.

insert into public.permissions(code, module, description) values
  ('factory_equipment.view', 'Factory Equipment', 'View Factory Equipment master records.'),
  ('factory_equipment.create', 'Factory Equipment', 'Create Factory Equipment master records.'),
  ('factory_equipment.edit', 'Factory Equipment', 'Edit Factory Equipment master records.'),
  ('factory_equipment.manage', 'Factory Equipment', 'Manage Factory Equipment categories and lifecycle.'),
  ('factory_production_equipment_usage.view', 'Factory Production', 'View actual Factory production equipment usage evidence.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code in (
  'factory_equipment.view', 'factory_equipment.create', 'factory_equipment.edit',
  'factory_equipment.manage', 'factory_production_equipment_usage.view'
)
where lower(role.name) in ('owner', 'admin')
on conflict do nothing;

create table if not exists public.factory_equipment_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_code text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 100,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create unique index if not exists factory_equipment_categories_code_key
  on public.factory_equipment_categories (lower(category_code))
  where category_code is not null;

create table if not exists public.factory_equipment (
  id uuid primary key default gen_random_uuid(),
  equipment_code text not null,
  name text not null,
  category_id uuid references public.factory_equipment_categories(id) on delete restrict,
  current_location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive', 'maintenance', 'out_of_service')),
  notes text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (equipment_code)
);

create index if not exists factory_equipment_location_idx on public.factory_equipment(current_location_id);
create index if not exists factory_equipment_category_idx on public.factory_equipment(category_id);

create table if not exists public.factory_production_equipment_usage (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.factory_equipment(id) on delete restrict,
  job_order_id uuid not null references public.factory_job_orders(id) on delete restrict,
  production_id uuid not null references public.factory_productions(id) on delete restrict,
  production_step_execution_id uuid references public.factory_production_step_executions(id) on delete restrict,
  used_at timestamptz not null default now(),
  equipment_snapshot jsonb not null,
  production_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_production_equipment_usage_identity unique (production_id, equipment_id)
);

create index if not exists factory_production_equipment_usage_equipment_idx
  on public.factory_production_equipment_usage(equipment_id, used_at desc);
create index if not exists factory_production_equipment_usage_job_idx
  on public.factory_production_equipment_usage(job_order_id, used_at desc);

alter table public.factory_equipment_categories enable row level security;
alter table public.factory_equipment enable row level security;
alter table public.factory_production_equipment_usage enable row level security;

grant select, insert, update on public.factory_equipment_categories to authenticated;
grant select, insert, update on public.factory_equipment to authenticated;
grant select on public.factory_production_equipment_usage to authenticated;
revoke insert, update, delete on public.factory_production_equipment_usage from authenticated;

create policy "factory equipment categories view" on public.factory_equipment_categories for select to authenticated
using (public.current_user_has_permission('factory_equipment.view') or public.current_user_has_permission('factory_equipment.manage'));
create policy "factory equipment categories manage" on public.factory_equipment_categories for all to authenticated
using (public.current_user_has_permission('factory_equipment.manage'))
with check (public.current_user_has_permission('factory_equipment.manage'));
create policy "factory equipment view" on public.factory_equipment for select to authenticated
using (
  public.current_user_has_permission('factory_equipment.view')
  or public.current_user_has_permission('factory_equipment.manage')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production.view')
);
create policy "factory equipment write" on public.factory_equipment for all to authenticated
using (public.current_user_has_permission('factory_equipment.create') or public.current_user_has_permission('factory_equipment.edit') or public.current_user_has_permission('factory_equipment.manage'))
with check (public.current_user_has_permission('factory_equipment.create') or public.current_user_has_permission('factory_equipment.edit') or public.current_user_has_permission('factory_equipment.manage'));
create policy "factory production equipment usage view" on public.factory_production_equipment_usage for select to authenticated
using (
  public.current_user_has_permission('factory_production_equipment_usage.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_batch_traceability.view')
);

drop policy if exists "factory storage locations view" on public.factory_storage_locations;
create policy "factory storage locations view" on public.factory_storage_locations for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_movements.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_job_orders.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_storage_locations.view')
  or public.current_user_has_permission('factory_storage_locations.manage')
  or public.current_user_has_permission('factory_mesti_cleaning.view')
  or public.current_user_has_permission('factory_mesti_cleaning.manage')
  or public.current_user_has_permission('factory_equipment.view')
  or public.current_user_has_permission('factory_equipment.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

-- The pre-existing completion authority is retained and augmented in a later
-- migration body by accepting p_payload.equipment_ids. The production request
-- ID is already its retry boundary; this unique key is a second concurrency guard.
create or replace function public.factory_record_production_equipment_usage(
  p_production_id uuid,
  p_equipment_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.factory_current_active_employee_id();
  v_production public.factory_productions%rowtype;
  v_equipment public.factory_equipment%rowtype;
  v_category public.factory_equipment_categories%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_equipment_id uuid;
begin
  if not public.current_user_has_permission('factory_production.complete') then
    raise exception using errcode = '42501', message = 'Missing permission to record Production equipment usage.';
  end if;
  select * into v_production from public.factory_productions where id = p_production_id for update;
  if v_production.id is null then raise exception 'Production was not found.'; end if;
  foreach v_equipment_id in array coalesce(p_equipment_ids, '{}'::uuid[]) loop
    select * into v_equipment from public.factory_equipment where id = v_equipment_id;
    if v_equipment.id is null or v_equipment.status <> 'active' then raise exception 'Equipment must be active to record new Production usage.'; end if;
    select * into v_category from public.factory_equipment_categories where id = v_equipment.category_id;
    select * into v_location from public.factory_storage_locations where id = v_equipment.current_location_id;
    insert into public.factory_production_equipment_usage(
      equipment_id, job_order_id, production_id, used_at, equipment_snapshot, production_snapshot, created_by
    ) values (
      v_equipment.id, v_production.job_order_id, v_production.id, coalesce(v_production.completed_at, now()),
      jsonb_build_object('equipment_code', v_equipment.equipment_code, 'name', v_equipment.name, 'category_name', v_category.name, 'location_id', v_location.id, 'location_name', v_location.location_name),
      jsonb_build_object('production_no', v_production.production_no, 'batch_no', v_production.batch_no, 'product_name', v_production.product_name, 'production_sop_id', v_production.production_sop_id, 'sop_version', v_production.sop_version),
      v_actor_id
    ) on conflict (production_id, equipment_id) do nothing;
  end loop;
end;
$$;

revoke all on function public.factory_record_production_equipment_usage(uuid, uuid[]) from public, anon;
grant execute on function public.factory_record_production_equipment_usage(uuid, uuid[]) to authenticated;
