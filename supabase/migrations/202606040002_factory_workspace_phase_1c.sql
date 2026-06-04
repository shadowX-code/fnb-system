-- Factory workspace Phase 1C: raw material and finished goods stock checks
-- with approval-controlled inventory adjustments.

create table if not exists public.factory_raw_material_stock_check_items (
  id uuid primary key default gen_random_uuid(),
  stock_check_id uuid not null references public.factory_raw_material_stock_checks(id) on delete cascade,
  raw_material_id uuid not null references public.factory_raw_materials(id),
  system_qty numeric not null default 0,
  physical_qty numeric not null default 0,
  variance_qty numeric not null default 0,
  variance_percent numeric not null default 0,
  variance_status text not null default 'Normal',
  variance_reason text,
  uom text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_product_stock_check_items (
  id uuid primary key default gen_random_uuid(),
  stock_check_id uuid not null references public.factory_product_stock_checks(id) on delete cascade,
  finished_good_id uuid not null references public.factory_finished_goods(id),
  system_qty numeric not null default 0,
  physical_qty numeric not null default 0,
  variance_qty numeric not null default 0,
  variance_percent numeric not null default 0,
  variance_status text not null default 'Normal',
  variance_reason text,
  uom text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.factory_raw_material_stock_checks
  add column if not exists approved_by uuid references public.employees(id),
  add column if not exists approved_at timestamptz;

alter table public.factory_product_stock_checks
  add column if not exists approved_by uuid references public.employees(id),
  add column if not exists approved_at timestamptz;

insert into public.permissions (code, module, description)
values
  ('factory_product_stock_check.approve', 'Product Stock Check', 'Approve Factory Product Stock Check adjustments.'),
  ('factory_raw_stock_check.approve', 'Raw Material Stock Check', 'Approve Factory Raw Material Stock Check adjustments.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
  and p.code in ('factory_product_stock_check.approve', 'factory_raw_stock_check.approve')
on conflict do nothing;

grant select, insert, update, delete on
  public.factory_raw_material_stock_check_items,
  public.factory_product_stock_check_items
to authenticated;

alter table public.factory_raw_material_stock_check_items enable row level security;
alter table public.factory_product_stock_check_items enable row level security;

drop policy if exists "factory raw stock checks manage" on public.factory_raw_material_stock_checks;
create policy "factory raw stock checks manage" on public.factory_raw_material_stock_checks for all to authenticated
using (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

drop policy if exists "factory product stock checks manage" on public.factory_product_stock_checks;
create policy "factory product stock checks manage" on public.factory_product_stock_checks for all to authenticated
using (
  public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.submit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.submit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
);

drop policy if exists "factory raw stock check items view" on public.factory_raw_material_stock_check_items;
create policy "factory raw stock check items view" on public.factory_raw_material_stock_check_items for select to authenticated
using (public.current_user_has_permission('factory_raw_stock_check.view'));
drop policy if exists "factory raw stock check items manage" on public.factory_raw_material_stock_check_items;
create policy "factory raw stock check items manage" on public.factory_raw_material_stock_check_items for all to authenticated
using (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

drop policy if exists "factory product stock check items view" on public.factory_product_stock_check_items;
create policy "factory product stock check items view" on public.factory_product_stock_check_items for select to authenticated
using (public.current_user_has_permission('factory_product_stock_check.view'));
drop policy if exists "factory product stock check items manage" on public.factory_product_stock_check_items;
create policy "factory product stock check items manage" on public.factory_product_stock_check_items for all to authenticated
using (
  public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.submit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.submit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
);

drop policy if exists "factory raw materials update" on public.factory_raw_materials;
create policy "factory raw materials update" on public.factory_raw_materials for update to authenticated
using (
  public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

drop policy if exists "factory finished goods manage" on public.factory_finished_goods;
create policy "factory finished goods manage" on public.factory_finished_goods for all to authenticated
using (
  public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_product_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_product_stock_check.approve')
);

drop policy if exists "factory raw movements insert" on public.factory_raw_material_movements;
create policy "factory raw movements insert" on public.factory_raw_material_movements for insert to authenticated
with check (
  public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

drop policy if exists "factory product movements manage" on public.factory_product_stock_movements;
create policy "factory product movements manage" on public.factory_product_stock_movements for all to authenticated
using (
  public.current_user_has_permission('factory_product_movements.create')
  or public.current_user_has_permission('factory_product_movements.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_product_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_product_movements.create')
  or public.current_user_has_permission('factory_product_movements.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_product_stock_check.approve')
);

create or replace function public.factory_approve_raw_material_stock_check(
  p_stock_check_id uuid,
  p_approved_by uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  v_check public.factory_raw_material_stock_checks%rowtype;
  v_item record;
begin
  select * into v_check
  from public.factory_raw_material_stock_checks
  where id = p_stock_check_id
  for update;

  if v_check.id is null then
    raise exception 'Raw material stock check not found.';
  end if;

  if v_check.status <> 'submitted' then
    raise exception 'Only submitted stock checks can be approved.';
  end if;

  if not exists (select 1 from public.factory_raw_material_stock_check_items where stock_check_id = p_stock_check_id) then
    raise exception 'Stock check requires at least one counted item.';
  end if;

  for v_item in
    select item.*, material.name
    from public.factory_raw_material_stock_check_items item
    join public.factory_raw_materials material on material.id = item.raw_material_id
    where item.stock_check_id = p_stock_check_id
  loop
    if v_item.variance_status in ('Warning', 'Critical') and coalesce(trim(v_item.variance_reason), '') = '' then
      raise exception 'Variance reason is required for Warning and Critical stock check items.';
    end if;

    if v_item.variance_qty <> 0 then
      perform public.factory_adjust_raw_material_balance(v_item.raw_material_id, v_item.variance_qty);

      insert into public.factory_raw_material_movements (
        raw_material_id,
        movement_type,
        quantity,
        uom,
        reference_type,
        reference_id,
        reference_no,
        movement_date,
        notes,
        created_by
      )
      values (
        v_item.raw_material_id,
        'Stock Check Adjustment',
        v_item.variance_qty,
        v_item.uom,
        'raw_material_stock_check',
        p_stock_check_id,
        v_check.check_no,
        coalesce(v_check.check_date, current_date),
        'Approved raw material stock check adjustment. Physical count variance is separate from production recipe variance.',
        p_approved_by
      );
    end if;
  end loop;

  update public.factory_raw_material_stock_checks
  set status = 'approved',
      approved_by = p_approved_by,
      approved_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
  where id = p_stock_check_id;
end;
$$;

create or replace function public.factory_approve_product_stock_check(
  p_stock_check_id uuid,
  p_approved_by uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  v_check public.factory_product_stock_checks%rowtype;
  v_item record;
begin
  select * into v_check
  from public.factory_product_stock_checks
  where id = p_stock_check_id
  for update;

  if v_check.id is null then
    raise exception 'Finished goods stock check not found.';
  end if;

  if v_check.status <> 'submitted' then
    raise exception 'Only submitted stock checks can be approved.';
  end if;

  if not exists (select 1 from public.factory_product_stock_check_items where stock_check_id = p_stock_check_id) then
    raise exception 'Stock check requires at least one counted item.';
  end if;

  for v_item in
    select item.*, product.product_name
    from public.factory_product_stock_check_items item
    join public.factory_finished_goods product on product.id = item.finished_good_id
    where item.stock_check_id = p_stock_check_id
  loop
    if v_item.variance_status in ('Warning', 'Critical') and coalesce(trim(v_item.variance_reason), '') = '' then
      raise exception 'Variance reason is required for Warning and Critical stock check items.';
    end if;

    if v_item.variance_qty <> 0 then
      perform public.factory_adjust_finished_good_balance(v_item.finished_good_id, v_item.variance_qty);

      insert into public.factory_product_stock_movements (
        finished_good_id,
        product_name,
        movement_type,
        quantity,
        uom,
        reference_type,
        reference_id,
        reference_no,
        movement_date,
        notes,
        created_by
      )
      values (
        v_item.finished_good_id,
        v_item.product_name,
        'Stock Check Adjustment',
        v_item.variance_qty,
        v_item.uom,
        'product_stock_check',
        p_stock_check_id,
        v_check.check_no,
        coalesce(v_check.check_date, current_date),
        'Approved finished goods stock check adjustment. Physical count variance is separate from production recipe variance.',
        p_approved_by
      );
    end if;
  end loop;

  update public.factory_product_stock_checks
  set status = 'approved',
      approved_by = p_approved_by,
      approved_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
  where id = p_stock_check_id;
end;
$$;

grant execute on function public.factory_approve_raw_material_stock_check(uuid, uuid) to authenticated;
grant execute on function public.factory_approve_product_stock_check(uuid, uuid) to authenticated;
