-- Exact Raw Material batch allocation for Production Usage.

alter table public.factory_productions
  add column if not exists completion_request_id uuid,
  add column if not exists completion_payload_fingerprint text;

-- Production completion and usage structure are writeable only through trusted RPCs.
revoke insert, update, delete on public.factory_productions from public, anon, authenticated;
revoke insert, update, delete on public.factory_production_material_usage from public, anon, authenticated;

create or replace function public.factory_guard_raw_material_aggregate_balance_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and coalesce(new.current_balance, 0) <> 0 then
      raise exception using errcode = '42501', message = 'Raw Material opening balance must be established through an authorized inventory workflow.';
    end if;
    if tg_op = 'UPDATE' and new.current_balance is distinct from old.current_balance then
      raise exception using errcode = '42501', message = 'Raw Material balance can only be changed through an authorized inventory workflow.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists factory_guard_raw_material_aggregate_balance_write_trigger
  on public.factory_raw_materials;
create trigger factory_guard_raw_material_aggregate_balance_write_trigger
before insert or update of current_balance on public.factory_raw_materials
for each row execute function public.factory_guard_raw_material_aggregate_balance_write();
revoke execute on function public.factory_guard_raw_material_aggregate_balance_write()
from public, anon, authenticated;

create unique index if not exists factory_productions_completion_request_key
  on public.factory_productions (completion_request_id)
  where completion_request_id is not null;

create table if not exists public.factory_raw_material_batch_balances (
  id uuid primary key default gen_random_uuid(),
  receiving_item_id uuid unique references public.factory_raw_material_receivings(id) on delete restrict,
  raw_material_stock_check_item_id uuid unique references public.factory_raw_material_stock_check_items(id) on delete restrict,
  raw_material_id uuid not null references public.factory_raw_materials(id) on delete restrict,
  source_type text not null default 'receiving'
    check (source_type in ('receiving', 'stock_check_adjustment', 'legacy_unallocated')),
  internal_batch_no text,
  supplier_lot_no text,
  received_date date,
  manufacturing_date date,
  expiry_date date,
  storage_location_id uuid references public.factory_storage_locations(id) on delete restrict,
  uom text not null,
  opening_qty numeric not null check (opening_qty >= 0),
  current_balance numeric not null check (current_balance >= 0),
  status text not null default 'active' check (status in ('active', 'reconciliation_required', 'archived')),
  diagnostic text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists factory_raw_material_batch_balances_fefo_idx
  on public.factory_raw_material_batch_balances
  (raw_material_id, expiry_date, received_date, manufacturing_date, internal_batch_no, id);

create unique index if not exists factory_raw_material_batch_balances_legacy_key
  on public.factory_raw_material_batch_balances (raw_material_id)
  where source_type = 'legacy_unallocated';

alter table public.factory_raw_material_batch_balances enable row level security;
grant select on public.factory_raw_material_batch_balances to authenticated;
revoke insert, update, delete on public.factory_raw_material_batch_balances from authenticated;
drop policy if exists "factory raw material batch balances view" on public.factory_raw_material_batch_balances;
create policy "factory raw material batch balances view"
on public.factory_raw_material_batch_balances for select to authenticated
using (
  public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

create table if not exists public.factory_production_material_usage_batch_allocations (
  id uuid primary key default gen_random_uuid(),
  production_material_usage_id uuid not null references public.factory_production_material_usage(id) on delete restrict,
  raw_material_batch_balance_id uuid not null references public.factory_raw_material_batch_balances(id) on delete restrict,
  allocated_qty numeric not null check (allocated_qty > 0),
  created_at timestamptz not null default now(),
  unique (production_material_usage_id, raw_material_batch_balance_id)
);

create index if not exists factory_production_usage_allocations_batch_idx
  on public.factory_production_material_usage_batch_allocations (raw_material_batch_balance_id);

alter table public.factory_production_material_usage_batch_allocations enable row level security;
grant select on public.factory_production_material_usage_batch_allocations to authenticated;
revoke insert, update, delete on public.factory_production_material_usage_batch_allocations from authenticated;
drop policy if exists "factory production usage allocations view" on public.factory_production_material_usage_batch_allocations;
create policy "factory production usage allocations view"
on public.factory_production_material_usage_batch_allocations for select to authenticated
using (
  public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_movements.view')
);

create table if not exists public.factory_raw_material_stock_check_batch_allocations (
  id uuid primary key default gen_random_uuid(),
  stock_check_item_id uuid not null references public.factory_raw_material_stock_check_items(id) on delete restrict,
  raw_material_batch_balance_id uuid not null references public.factory_raw_material_batch_balances(id) on delete restrict,
  allocated_qty numeric not null check (allocated_qty > 0),
  created_at timestamptz not null default now(),
  unique (stock_check_item_id, raw_material_batch_balance_id)
);

create index if not exists factory_raw_stock_check_allocations_batch_idx
  on public.factory_raw_material_stock_check_batch_allocations (raw_material_batch_balance_id);

alter table public.factory_raw_material_stock_check_batch_allocations enable row level security;
grant select on public.factory_raw_material_stock_check_batch_allocations to authenticated;
revoke insert, update, delete on public.factory_raw_material_stock_check_batch_allocations from authenticated;
drop policy if exists "factory raw stock check batch allocations view"
  on public.factory_raw_material_stock_check_batch_allocations;
create policy "factory raw stock check batch allocations view"
on public.factory_raw_material_stock_check_batch_allocations for select to authenticated
using (
  public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
  or public.current_user_has_permission('factory_raw_inventory.view')
);

create table if not exists public.factory_raw_material_batch_reconciliation_diagnostics (
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null references public.factory_raw_materials(id) on delete restrict,
  receiving_item_id uuid references public.factory_raw_material_receivings(id) on delete restrict,
  stock_check_item_id uuid references public.factory_raw_material_stock_check_items(id) on delete restrict,
  diagnostic_type text not null,
  diagnostic_qty numeric,
  details text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists factory_raw_batch_reconciliation_receiving_key
  on public.factory_raw_material_batch_reconciliation_diagnostics (receiving_item_id, diagnostic_type)
  where receiving_item_id is not null;

create unique index if not exists factory_raw_batch_reconciliation_stock_check_key
  on public.factory_raw_material_batch_reconciliation_diagnostics (stock_check_item_id, diagnostic_type)
  where stock_check_item_id is not null;

create unique index if not exists factory_raw_batch_reconciliation_material_key
  on public.factory_raw_material_batch_reconciliation_diagnostics (raw_material_id, diagnostic_type)
  where receiving_item_id is null and stock_check_item_id is null;

alter table public.factory_raw_material_batch_reconciliation_diagnostics enable row level security;
grant select on public.factory_raw_material_batch_reconciliation_diagnostics to authenticated;
revoke insert, update, delete on public.factory_raw_material_batch_reconciliation_diagnostics from authenticated;
drop policy if exists "factory raw batch reconciliation diagnostics view"
  on public.factory_raw_material_batch_reconciliation_diagnostics;
create policy "factory raw batch reconciliation diagnostics view"
on public.factory_raw_material_batch_reconciliation_diagnostics for select to authenticated
using (
  public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
);

alter table public.factory_raw_material_movements
  add column if not exists raw_material_batch_balance_id uuid
    references public.factory_raw_material_batch_balances(id) on delete restrict;

create index if not exists factory_raw_material_movements_batch_balance_idx
  on public.factory_raw_material_movements (raw_material_batch_balance_id)
  where raw_material_batch_balance_id is not null;

drop index if exists public.factory_raw_material_movements_production_usage_idx;
create index if not exists factory_raw_material_movements_production_usage_idx
  on public.factory_raw_material_movements (production_material_usage_id)
  where production_material_usage_id is not null;

-- Seed Receiving batches and migrate direct historical usage only when the complete
-- usage set for a receipt is exact, UOM-compatible and within its opening quantity.
with receiving_sets as (
  select
    receiving.id as receiving_item_id,
    receiving.raw_material_id,
    greatest(coalesce(receiving.received_qty, 0), 0) as received_qty,
    count(usage.id) as usage_count,
    coalesce(sum(coalesce(usage.actual_usage, usage.quantity_used, 0)), 0) as usage_qty,
    coalesce(bool_and(
      usage.raw_material_id = receiving.raw_material_id
      and coalesce(usage.actual_usage, usage.quantity_used, 0) > 0
      and nullif(lower(btrim(usage.uom)), '') is not null
      and nullif(lower(btrim(receiving.uom)), '') is not null
      and lower(btrim(usage.uom)) = lower(btrim(receiving.uom))
      and not exists (
        select 1
        from public.factory_production_material_usage_batch_allocations existing_allocation
        join public.factory_raw_material_batch_balances existing_batch
          on existing_batch.id = existing_allocation.raw_material_batch_balance_id
        where existing_allocation.production_material_usage_id = usage.id
          and (
            existing_batch.receiving_item_id is distinct from receiving.id
            or existing_allocation.allocated_qty is distinct from coalesce(usage.actual_usage, usage.quantity_used)
          )
      )
    ), true) as complete_set_valid
  from public.factory_raw_material_receivings receiving
  join public.factory_raw_material_receiving_batches header
    on header.id = receiving.batch_id and lower(coalesce(header.status, '')) = 'completed'
  left join public.factory_production_material_usage usage
    on usage.raw_material_receiving_id = receiving.id
  where coalesce(receiving.received_qty, 0) > 0
  group by receiving.id, receiving.raw_material_id, receiving.received_qty
), classified_receivings as (
  select receiving_set.*,
    receiving_set.complete_set_valid
      and receiving_set.usage_qty <= receiving_set.received_qty as can_backfill
  from receiving_sets receiving_set
)
insert into public.factory_raw_material_batch_balances (
  receiving_item_id, raw_material_id, source_type, internal_batch_no, supplier_lot_no,
  received_date, manufacturing_date, expiry_date, storage_location_id, uom,
  opening_qty, current_balance, status, diagnostic
)
select
  receiving.id,
  receiving.raw_material_id,
  'receiving',
  coalesce(nullif(btrim(receiving.internal_batch_no), ''), nullif(btrim(receiving.batch_no), '')),
  nullif(btrim(receiving.supplier_lot_no), ''),
  receiving.received_date,
  receiving.manufacturing_date,
  receiving.expiry_date,
  receiving.storage_location_id,
  coalesce(nullif(btrim(receiving.uom), ''), nullif(btrim(material.uom), ''), 'unit'),
  greatest(coalesce(receiving.received_qty, 0), 0),
  case when classified.can_backfill
    then classified.received_qty - classified.usage_qty else classified.received_qty end,
  case when classified.can_backfill then 'active' else 'reconciliation_required' end,
  case
    when classified.can_backfill then null
    when not classified.complete_set_valid then 'Historical usage set is ambiguous or has an incompatible or unknown UOM.'
    else 'Exact historical usage set exceeds the receiving quantity.'
  end
from public.factory_raw_material_receivings receiving
join public.factory_raw_material_receiving_batches header
  on header.id = receiving.batch_id and lower(coalesce(header.status, '')) = 'completed'
join public.factory_raw_materials material on material.id = receiving.raw_material_id
join classified_receivings classified on classified.receiving_item_id = receiving.id
where coalesce(receiving.received_qty, 0) > 0
on conflict (receiving_item_id) do nothing;

with invalid_sets as (
  select
    receiving.id as receiving_item_id,
    receiving.raw_material_id,
    greatest(coalesce(receiving.received_qty, 0), 0) as received_qty,
    coalesce(sum(coalesce(usage.actual_usage, usage.quantity_used, 0)), 0) as usage_qty,
    coalesce(bool_and(
      usage.raw_material_id = receiving.raw_material_id
      and coalesce(usage.actual_usage, usage.quantity_used, 0) > 0
      and nullif(lower(btrim(usage.uom)), '') is not null
      and nullif(lower(btrim(receiving.uom)), '') is not null
      and lower(btrim(usage.uom)) = lower(btrim(receiving.uom))
      and not exists (
        select 1
        from public.factory_production_material_usage_batch_allocations existing_allocation
        join public.factory_raw_material_batch_balances existing_batch
          on existing_batch.id = existing_allocation.raw_material_batch_balance_id
        where existing_allocation.production_material_usage_id = usage.id
          and (
            existing_batch.receiving_item_id is distinct from receiving.id
            or existing_allocation.allocated_qty is distinct from coalesce(usage.actual_usage, usage.quantity_used)
          )
      )
    ), true) as uom_and_identity_valid
  from public.factory_raw_material_receivings receiving
  join public.factory_raw_material_receiving_batches header
    on header.id = receiving.batch_id and lower(coalesce(header.status, '')) = 'completed'
  left join public.factory_production_material_usage usage on usage.raw_material_receiving_id = receiving.id
  where coalesce(receiving.received_qty, 0) > 0
  group by receiving.id, receiving.raw_material_id, receiving.received_qty
)
insert into public.factory_raw_material_batch_reconciliation_diagnostics (
  raw_material_id, receiving_item_id, diagnostic_type, diagnostic_qty, details
)
select
  invalid_set.raw_material_id,
  invalid_set.receiving_item_id,
  'historical_receiving_usage_unresolved',
  invalid_set.usage_qty,
  case when invalid_set.usage_qty > invalid_set.received_qty
    then 'Historical usage total exceeds the exact Receiving quantity; no usage in this receipt set was backfilled.'
    else 'Historical usage has an incompatible or unknown UOM or material relationship; no usage in this receipt set was backfilled.' end
from invalid_sets invalid_set
where invalid_set.usage_qty > invalid_set.received_qty or not invalid_set.uom_and_identity_valid
on conflict (receiving_item_id, diagnostic_type) where receiving_item_id is not null do nothing;

insert into public.factory_production_material_usage_batch_allocations (
  production_material_usage_id, raw_material_batch_balance_id, allocated_qty
)
select usage.id, balance.id, coalesce(usage.actual_usage, usage.quantity_used)
from public.factory_production_material_usage usage
join public.factory_raw_material_batch_balances balance
  on balance.receiving_item_id = usage.raw_material_receiving_id
where coalesce(usage.actual_usage, usage.quantity_used, 0) > 0
  and balance.status = 'active'
  and lower(btrim(usage.uom)) = lower(btrim(balance.uom))
  and not exists (
    select 1 from public.factory_production_material_usage sibling
    where sibling.raw_material_receiving_id = usage.raw_material_receiving_id
    group by sibling.raw_material_receiving_id
    having sum(coalesce(sibling.actual_usage, sibling.quantity_used, 0)) > balance.opening_qty
      or bool_or(
        sibling.raw_material_id is distinct from balance.raw_material_id
        or coalesce(sibling.actual_usage, sibling.quantity_used, 0) <= 0
        or nullif(lower(btrim(sibling.uom)), '') is null
        or lower(btrim(sibling.uom)) <> lower(btrim(balance.uom))
      )
  )
on conflict (production_material_usage_id, raw_material_batch_balance_id) do nothing;

update public.factory_raw_material_movements movement
set raw_material_batch_balance_id = allocation.raw_material_batch_balance_id
from public.factory_production_material_usage_batch_allocations allocation
where allocation.production_material_usage_id = movement.production_material_usage_id
  and movement.raw_material_batch_balance_id is null;

-- Represent only positive aggregate stock that has no exact batch authority. This
-- bucket has no invented batch or location and is never eligible for allocation.
with represented as (
  select balance.raw_material_id, coalesce(sum(balance.current_balance), 0) as represented_qty
  from public.factory_raw_material_batch_balances balance
  where balance.source_type <> 'legacy_unallocated'
  group by balance.raw_material_id
), gaps as (
  select material.id as raw_material_id,
    greatest(coalesce(material.current_balance, 0) - coalesce(represented.represented_qty, 0), 0) as gap_qty
  from public.factory_raw_materials material
  left join represented on represented.raw_material_id = material.id
)
insert into public.factory_raw_material_batch_balances (
  raw_material_id, source_type, internal_batch_no, uom, opening_qty,
  current_balance, status, diagnostic
)
select
  gap.raw_material_id, 'legacy_unallocated', null,
  coalesce(nullif(btrim(material.uom), ''), 'unit'), gap.gap_qty,
  gap.gap_qty, 'reconciliation_required',
  'Aggregate stock has no exact Receiving or Stock Check batch relationship.'
from gaps gap
join public.factory_raw_materials material on material.id = gap.raw_material_id
where gap.gap_qty > 0
on conflict (raw_material_id) where source_type = 'legacy_unallocated' do nothing;

with represented as (
  select balance.raw_material_id, coalesce(sum(balance.current_balance), 0) as represented_qty
  from public.factory_raw_material_batch_balances balance
  group by balance.raw_material_id
)
insert into public.factory_raw_material_batch_reconciliation_diagnostics (
  raw_material_id, diagnostic_type, diagnostic_qty, details
)
select
  material.id, 'aggregate_below_batch_balance',
  represented.represented_qty - greatest(coalesce(material.current_balance, 0), 0),
  'Known Raw Material batch balances exceed the aggregate balance; allocation is capped by aggregate stock.'
from public.factory_raw_materials material
join represented on represented.raw_material_id = material.id
where represented.represented_qty > greatest(coalesce(material.current_balance, 0), 0)
  and not exists (
    select 1 from public.factory_raw_material_batch_reconciliation_diagnostics diagnostic
    where diagnostic.raw_material_id = material.id
      and diagnostic.receiving_item_id is null
      and diagnostic.stock_check_item_id is null
      and diagnostic.diagnostic_type = 'aggregate_below_batch_balance'
  );

create or replace function public.factory_capture_completed_raw_receiving_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.status, '')) <> 'completed' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if lower(coalesce(old.status, '')) = 'completed' then return new; end if;
  end if;

  insert into public.factory_raw_material_batch_balances (
    receiving_item_id, raw_material_id, internal_batch_no, supplier_lot_no,
    received_date, manufacturing_date, expiry_date, storage_location_id, uom,
    opening_qty, current_balance
  )
  select
    receiving.id, receiving.raw_material_id,
    coalesce(nullif(btrim(receiving.internal_batch_no), ''), nullif(btrim(receiving.batch_no), '')),
    nullif(btrim(receiving.supplier_lot_no), ''), receiving.received_date,
    receiving.manufacturing_date, receiving.expiry_date, receiving.storage_location_id,
    coalesce(nullif(btrim(receiving.uom), ''), 'unit'),
    receiving.received_qty, receiving.received_qty
  from public.factory_raw_material_receivings receiving
  where receiving.batch_id = new.id and receiving.received_qty > 0
  on conflict (receiving_item_id) do nothing;
  return new;
end;
$$;

drop trigger if exists factory_capture_completed_raw_receiving_batch_trigger
on public.factory_raw_material_receiving_batches;
create trigger factory_capture_completed_raw_receiving_batch_trigger
after insert or update of status on public.factory_raw_material_receiving_batches
for each row execute function public.factory_capture_completed_raw_receiving_batch();
revoke execute on function public.factory_capture_completed_raw_receiving_batch()
from public, anon, authenticated;

create or replace function public.factory_get_raw_material_batch_reconciliation(
  p_raw_material_ids uuid[] default null
)
returns table (
  raw_material_id uuid,
  aggregate_balance numeric,
  receiving_batch_balance numeric,
  stock_check_adjustment_balance numeric,
  legacy_unallocated_balance numeric,
  total_represented_balance numeric,
  variance numeric,
  reconciliation_status text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    material.id,
    greatest(coalesce(material.current_balance, 0), 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'receiving'), 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'stock_check_adjustment'), 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'legacy_unallocated'), 0),
    coalesce(sum(balance.current_balance), 0),
    greatest(coalesce(material.current_balance, 0), 0) - coalesce(sum(balance.current_balance), 0),
    case
      when abs(greatest(coalesce(material.current_balance, 0), 0) - coalesce(sum(balance.current_balance), 0)) > 0.000001
        then 'mismatch'
      when coalesce(bool_or(balance.status = 'reconciliation_required'), false)
        then 'reconciliation_required'
      else 'reconciled'
    end
  from public.factory_raw_materials material
  left join public.factory_raw_material_batch_balances balance
    on balance.raw_material_id = material.id
  where p_raw_material_ids is null or material.id = any(p_raw_material_ids)
  group by material.id, material.current_balance
  order by material.id;
$$;

grant execute on function public.factory_get_raw_material_batch_reconciliation(uuid[]) to authenticated;
revoke execute on function public.factory_get_raw_material_batch_reconciliation(uuid[]) from public, anon;

create or replace function public.factory_get_raw_material_batch_availability(
  p_raw_material_ids uuid[],
  p_job_order_id uuid
)
returns table (
  raw_material_id uuid,
  batch_balance_id uuid,
  internal_batch_no text,
  supplier_lot_no text,
  received_date date,
  manufacturing_date date,
  expiry_date date,
  storage_location_id uuid,
  storage_location_name text,
  storage_location_type text,
  uom text,
  available_qty numeric,
  aggregate_balance numeric,
  reconciled_batch_balance numeric,
  allocatable_batch_balance numeric,
  unavailable_qty numeric,
  reconciliation_variance numeric,
  reconciliation_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_production_date date;
begin
  if auth.uid() is null or not (
    public.current_user_has_permission('factory_production.view')
    or public.current_user_has_permission('factory_production.complete')
  ) then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Raw Material batch availability.';
  end if;

  select job.production_date into v_production_date
  from public.factory_job_orders job
  where job.id = p_job_order_id;
  if v_production_date is null then
    raise exception 'Job Order Production Date is required for Raw Material batch availability.';
  end if;

  return query
  with requested as (
    select material.id as raw_material_id,
      greatest(coalesce(material.current_balance, 0), 0) as aggregate_balance,
      nullif(lower(btrim(material.uom)), '') as canonical_uom
    from public.factory_raw_materials material
    where material.id = any(coalesce(p_raw_material_ids, array[]::uuid[]))
      and lower(coalesce(material.status, '')) = 'active'
  ), totals as (
    select requested.raw_material_id, requested.aggregate_balance, requested.canonical_uom,
      coalesce(sum(balance.current_balance), 0) as represented_balance,
      coalesce(sum(balance.current_balance) filter (where balance.source_type <> 'legacy_unallocated'), 0) as reconciled_balance,
      coalesce(sum(balance.current_balance) filter (
        where balance.status = 'active'
          and balance.source_type = 'receiving'
          and balance.current_balance > 0
          and nullif(lower(btrim(balance.uom)), '') = requested.canonical_uom
          and (balance.expiry_date is null or balance.expiry_date >= v_production_date)
          and exists (
            select 1 from public.factory_storage_locations location
            where location.id = balance.storage_location_id
              and lower(coalesce(location.status, '')) = 'active'
          )
      ), 0) as eligible_balance,
      bool_or(balance.status = 'reconciliation_required') as has_reconciliation_rows
    from requested
    left join public.factory_raw_material_batch_balances balance
      on balance.raw_material_id = requested.raw_material_id
    group by requested.raw_material_id, requested.aggregate_balance, requested.canonical_uom
  ), summary as (
    select totals.*,
      least(totals.aggregate_balance, totals.eligible_balance) as allocatable_balance,
      totals.aggregate_balance - totals.represented_balance as variance
    from totals
  ), eligible as (
    select
      balance.*,
      location.location_name,
      location.location_type,
      summary.aggregate_balance,
      summary.reconciled_balance,
      summary.allocatable_balance,
      summary.variance,
      summary.has_reconciliation_rows,
      coalesce(sum(balance.current_balance) over (
        partition by balance.raw_material_id
        order by balance.expiry_date asc nulls last, balance.received_date asc nulls last,
          balance.manufacturing_date asc nulls last, balance.internal_batch_no asc, balance.id asc
        rows between unbounded preceding and 1 preceding
      ), 0) as earlier_balance
    from public.factory_raw_material_batch_balances balance
    join summary on summary.raw_material_id = balance.raw_material_id
    join public.factory_storage_locations location
      on location.id = balance.storage_location_id and lower(coalesce(location.status, '')) = 'active'
    where balance.status = 'active'
      and balance.source_type = 'receiving'
      and balance.current_balance > 0
      and nullif(lower(btrim(balance.uom)), '') = summary.canonical_uom
      and (balance.expiry_date is null or balance.expiry_date >= v_production_date)
  ), capped as (
    select eligible.*,
      greatest(least(eligible.current_balance, eligible.allocatable_balance - eligible.earlier_balance), 0) as capped_available
    from eligible
  )
  select
    summary.raw_material_id,
    capped.id,
    capped.internal_batch_no,
    capped.supplier_lot_no,
    capped.received_date,
    capped.manufacturing_date,
    capped.expiry_date,
    capped.storage_location_id,
    capped.location_name,
    capped.location_type,
    coalesce(capped.uom, summary.canonical_uom, 'unit'),
    coalesce(capped.capped_available, 0),
    summary.aggregate_balance,
    summary.reconciled_balance,
    summary.allocatable_balance,
    greatest(summary.aggregate_balance - summary.allocatable_balance, 0),
    summary.variance,
    case
      when abs(summary.variance) > 0.000001 then 'mismatch'
      when summary.has_reconciliation_rows or summary.aggregate_balance > summary.allocatable_balance then 'reconciliation_required'
      else 'reconciled'
    end
  from summary
  left join capped on capped.raw_material_id = summary.raw_material_id and capped.capped_available > 0
  order by summary.raw_material_id,
    capped.expiry_date asc nulls last,
    capped.received_date asc nulls last,
    capped.manufacturing_date asc nulls last,
    capped.internal_batch_no asc,
    capped.id asc;
end;
$$;

grant execute on function public.factory_get_raw_material_batch_availability(uuid[], uuid) to authenticated;
revoke execute on function public.factory_get_raw_material_batch_availability(uuid[], uuid) from public, anon;

create or replace function public.factory_complete_production_with_raw_batch_allocations(
  p_request_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_existing public.factory_productions%rowtype;
  v_job public.factory_job_orders%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_production_id uuid;
  v_usage_id uuid;
  v_usage jsonb;
  v_allocation jsonb;
  v_material public.factory_raw_materials%rowtype;
  v_batch public.factory_raw_material_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_canonical jsonb;
  v_items jsonb;
  v_allocations jsonb;
  v_fingerprint text;
  v_actual numeric;
  v_standard numeric;
  v_variance numeric;
  v_allocation_qty numeric;
  v_allocated numeric;
  v_available numeric;
  v_actual_pack_qty numeric;
  v_actual_output_qty numeric;
  v_expected_output_qty numeric;
  v_expected_output_uom text;
  v_production_no text;
  v_production_date date;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if p_request_id is null then raise exception 'Production completion request ID is required.'; end if;
  if not public.current_user_has_permission('factory_production.complete') then
    raise exception using errcode = '42501', message = 'Insufficient permission to complete Production.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid() and lower(coalesce(employee.status, '')) = 'active'
  order by employee.id
  limit 1;
  if v_actor.id is null then raise exception using errcode = '42501', message = 'An active employee profile is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('factory-production-complete:' || p_request_id::text, 0));

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'raw_material_id', (item->>'raw_material_id')::uuid,
      'standard_usage', coalesce(nullif(item->>'standard_usage', '')::numeric, 0),
      'actual_usage', coalesce(nullif(item->>'actual_usage', '')::numeric, 0),
      'uom', nullif(lower(btrim(item->>'uom')), ''),
      'variance_reason', nullif(btrim(item->>'variance_reason'), ''),
      'wastage_quantity', coalesce(nullif(item->>'wastage_quantity', '')::numeric, 0),
      'notes', nullif(btrim(item->>'notes'), ''),
      'allocations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'batch_balance_id', (allocation->>'batch_balance_id')::uuid,
          'allocated_qty', (allocation->>'allocated_qty')::numeric
        ) order by (allocation->>'batch_balance_id')::uuid, (allocation->>'allocated_qty')::numeric)
        from jsonb_array_elements(coalesce(item->'allocations', '[]'::jsonb)) allocation
      ), '[]'::jsonb)
    ) order by (item->>'raw_material_id')::uuid,
      coalesce(nullif(item->>'actual_usage', '')::numeric, 0),
      coalesce(nullif(item->>'standard_usage', '')::numeric, 0),
      coalesce(nullif(lower(btrim(item->>'uom')), ''), ''),
      coalesce(nullif(btrim(item->>'variance_reason'), ''), ''),
      coalesce(nullif(item->>'wastage_quantity', '')::numeric, 0),
      coalesce(nullif(btrim(item->>'notes'), ''), ''),
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'batch_balance_id', (allocation->>'batch_balance_id')::uuid,
          'allocated_qty', (allocation->>'allocated_qty')::numeric
        ) order by (allocation->>'batch_balance_id')::uuid, (allocation->>'allocated_qty')::numeric)::text
        from jsonb_array_elements(coalesce(item->'allocations', '[]'::jsonb)) allocation
      ), '[]')
  ), '[]'::jsonb) into v_items
  from jsonb_array_elements(coalesce(p_payload->'usage_items', '[]'::jsonb)) item;

  v_canonical := jsonb_build_object(
    'job_order_id', (p_payload->>'job_order_id')::uuid,
    'finished_good_id', (p_payload->>'finished_good_id')::uuid,
    'batch_no', nullif(btrim(p_payload->>'batch_no'), ''),
    'end_date', (p_payload->>'end_date')::date,
    'end_time', (p_payload->>'end_time')::time,
    'expiry_date', nullif(p_payload->>'expiry_date', '')::date,
    'storage_location_id', nullif(p_payload->>'storage_location_id', '')::uuid,
    'operator_id', nullif(p_payload->>'operator_id', '')::uuid,
    'operator_name', nullif(btrim(p_payload->>'operator_name'), ''),
    'expiry_override_reason', nullif(btrim(p_payload->>'expiry_override_reason'), ''),
    'actual_pack_qty', (p_payload->>'actual_pack_qty')::numeric,
    'actual_output_qty', (p_payload->>'actual_output_qty')::numeric,
    'uom', nullif(lower(btrim(p_payload->>'uom')), ''),
    'notes', nullif(btrim(p_payload->>'notes'), ''),
    'usage_items', v_items
  );
  v_fingerprint := encode(digest(v_canonical::text, 'sha256'), 'hex');

  select production.* into v_existing
  from public.factory_productions production
  where production.completion_request_id = p_request_id
  for update;
  if v_existing.id is not null then
    if v_existing.completion_payload_fingerprint is distinct from v_fingerprint then
      raise exception 'This Production request was already completed with different details.';
    end if;
    return v_existing.id;
  end if;

  select job.* into v_job from public.factory_job_orders job
  where job.id = (p_payload->>'job_order_id')::uuid for update;
  if v_job.id is null then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job.status, '')) <> 'in_progress' then raise exception 'Only In Progress Job Orders can be completed.'; end if;
  if exists (select 1 from public.factory_productions production where production.job_order_id = v_job.id and lower(coalesce(production.status, '')) = 'completed') then
    raise exception 'This Job Order already has a completed Production record.';
  end if;

  select finished_good.* into v_finished_good from public.factory_finished_goods finished_good
  where finished_good.id = (p_payload->>'finished_good_id')::uuid for update;
  if v_finished_good.id is null or lower(coalesce(v_finished_good.status, '')) <> 'active'
     or v_finished_good.id is distinct from v_job.finished_good_id then
    raise exception 'Production Packaging SKU must be active and match the Job Order.';
  end if;

  v_actual_pack_qty := (p_payload->>'actual_pack_qty')::numeric;
  if v_actual_pack_qty <= 0 or v_actual_pack_qty <> trunc(v_actual_pack_qty) then raise exception 'Actual Pack Qty must be a whole number greater than 0.'; end if;
  select plan.target_production_qty, plan.production_uom into v_expected_output_qty, v_expected_output_uom
  from public.factory_packaging_production_plan(
    v_actual_pack_qty, coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty),
    coalesce(v_finished_good.pack_size_uom, v_finished_good.base_uom), p_payload->>'uom'
  ) plan;
  v_actual_output_qty := (p_payload->>'actual_output_qty')::numeric;
  if abs(v_actual_output_qty - v_expected_output_qty) > 0.000001 then raise exception 'Actual Output Qty does not match Packaging SKU Pack Size.'; end if;
  if coalesce(jsonb_array_length(p_payload->'usage_items'), 0) = 0 then raise exception 'At least one material usage row is required.'; end if;

  -- Acquire shared inventory locks in one deterministic order to avoid cross-Production deadlocks.
  perform material.id
  from public.factory_raw_materials material
  where material.id in (
    select distinct (usage_row->>'raw_material_id')::uuid
    from jsonb_array_elements(p_payload->'usage_items') usage_row
  )
  order by material.id
  for update;
  perform balance.id
  from public.factory_raw_material_batch_balances balance
  where balance.id in (
    select distinct (allocation->>'batch_balance_id')::uuid
    from jsonb_array_elements(p_payload->'usage_items') usage_row
    cross join lateral jsonb_array_elements(coalesce(usage_row->'allocations', '[]'::jsonb)) allocation
  )
  order by balance.id
  for update;

  v_production_date := v_job.production_date;
  if v_production_date is null or v_job.start_time is null then raise exception 'Job Order Production Date and Start Time are required.'; end if;
  if (p_payload->>'end_date')::date < v_production_date
     or ((p_payload->>'end_date')::date = v_production_date and (p_payload->>'end_time')::time < v_job.start_time) then
    raise exception 'Production End Date and Time cannot be earlier than Start Date and Time.';
  end if;

  perform set_config('feedx.production_end_date', p_payload->>'end_date', true);
  perform set_config('feedx.production_expiry_date', coalesce(p_payload->>'expiry_date', ''), true);
  perform set_config('feedx.production_storage_location_id', coalesce(p_payload->>'storage_location_id', ''), true);
  perform set_config('feedx.production_expiry_override_reason', coalesce(p_payload->>'expiry_override_reason', ''), true);
  v_production_no := coalesce(nullif(btrim(p_payload->>'production_no'), ''), 'PRD-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'));

  insert into public.factory_productions (
    job_order_id, finished_good_id, production_no, product_name, batch_no,
    actual_pack_qty, actual_output_qty, produced_quantity, actual_produced_qty, good_output_qty,
    wastage_qty, uom, production_date, operator_id, operator_name, start_time, end_time,
    qc_status, production_sop_id, sop_version, status, notes, created_by, completed_at, updated_at,
    completion_request_id, completion_payload_fingerprint
  ) values (
    v_job.id, v_finished_good.id, v_production_no, v_finished_good.product_name,
    nullif(btrim(p_payload->>'batch_no'), ''), v_actual_pack_qty, v_expected_output_qty,
    v_expected_output_qty, v_expected_output_qty, v_expected_output_qty, 0, v_expected_output_uom,
    v_production_date, coalesce(nullif(p_payload->>'operator_id', '')::uuid, v_job.production_operator_id, v_actor.id),
    coalesce(nullif(btrim(p_payload->>'operator_name'), ''), v_job.production_operator_name),
    v_job.start_time, (p_payload->>'end_time')::time, 'Pending', null, '', 'completed',
    nullif(btrim(p_payload->>'notes'), ''), v_actor.id, now(), now(), p_request_id, v_fingerprint
  ) returning id into v_production_id;

  for v_usage in select value from jsonb_array_elements(p_payload->'usage_items') loop
    select material.* into v_material from public.factory_raw_materials material
    where material.id = (v_usage->>'raw_material_id')::uuid for update;
    if v_material.id is null or lower(coalesce(v_material.status, '')) <> 'active' then raise exception 'Every Production usage row requires an active Raw Material.'; end if;
    v_standard := coalesce(nullif(v_usage->>'standard_usage', '')::numeric, 0);
    v_actual := coalesce(nullif(v_usage->>'actual_usage', '')::numeric, 0);
    if v_actual < 0 then raise exception 'Actual usage cannot be negative.'; end if;
    v_variance := v_actual - v_standard;
    if abs(v_variance) > 0.000001 and nullif(btrim(v_usage->>'variance_reason'), '') is null then raise exception 'Variance reason is required when actual usage differs from standard usage.'; end if;
    select coalesce(sum((entry->>'allocated_qty')::numeric), 0) into v_allocated
    from jsonb_array_elements(coalesce(v_usage->'allocations', '[]'::jsonb)) entry;
    if abs(v_allocated - v_actual) > 0.000001 then raise exception 'Raw Material batch allocation must equal Actual Used.'; end if;
    select least(
      greatest(coalesce(v_material.current_balance, 0), 0),
      coalesce(sum(balance.current_balance), 0)
    ) into v_available
    from public.factory_raw_material_batch_balances balance
    join public.factory_storage_locations location
      on location.id = balance.storage_location_id and lower(coalesce(location.status, '')) = 'active'
    where balance.raw_material_id = v_material.id
      and balance.source_type = 'receiving'
      and balance.status = 'active'
      and balance.current_balance > 0
      and nullif(lower(btrim(balance.uom)), '') = nullif(lower(btrim(coalesce(v_usage->>'uom', v_material.uom))), '')
      and (balance.expiry_date is null or balance.expiry_date >= v_production_date);
    if v_available < v_actual then
      raise exception 'Insufficient Raw Material batch stock for %. Required %, available %.', v_material.name, v_actual, v_available;
    end if;

    insert into public.factory_production_material_usage (
      production_id, raw_material_id, quantity_used, standard_usage, actual_usage,
      variance_qty, variance_percent, variance_reason, uom, wastage_quantity, notes, updated_at
    ) values (
      v_production_id, v_material.id, v_actual, v_standard, v_actual, v_variance,
      case when v_standard = 0 then case when v_actual = 0 then 0 else 100 end else (v_variance / v_standard) * 100 end,
      nullif(btrim(v_usage->>'variance_reason'), ''), coalesce(nullif(v_usage->>'uom', ''), v_material.uom),
      coalesce(nullif(v_usage->>'wastage_quantity', '')::numeric, 0), nullif(btrim(v_usage->>'notes'), ''), now()
    ) returning id into v_usage_id;

    for v_allocation in select value from jsonb_array_elements(coalesce(v_usage->'allocations', '[]'::jsonb)) loop
      v_allocation_qty := (v_allocation->>'allocated_qty')::numeric;
      select balance.* into v_batch from public.factory_raw_material_batch_balances balance
      where balance.id = (v_allocation->>'batch_balance_id')::uuid for update;
      select location.* into v_location from public.factory_storage_locations location where location.id = v_batch.storage_location_id;
      with eligible as (
        select candidate.id, candidate.current_balance,
          coalesce(sum(candidate.current_balance) over (
            partition by candidate.raw_material_id
            order by candidate.expiry_date asc nulls last, candidate.received_date asc nulls last,
              candidate.manufacturing_date asc nulls last, candidate.internal_batch_no asc, candidate.id asc
            rows between unbounded preceding and 1 preceding
          ), 0) as earlier_balance
        from public.factory_raw_material_batch_balances candidate
        join public.factory_storage_locations candidate_location
          on candidate_location.id = candidate.storage_location_id
         and lower(coalesce(candidate_location.status, '')) = 'active'
        where candidate.raw_material_id = v_material.id
          and candidate.source_type = 'receiving'
          and candidate.status = 'active'
          and candidate.current_balance > 0
          and nullif(lower(btrim(candidate.uom)), '') = nullif(lower(btrim(coalesce(v_usage->>'uom', v_material.uom))), '')
          and (candidate.expiry_date is null or candidate.expiry_date >= v_production_date)
      )
      select greatest(least(eligible.current_balance,
        greatest(coalesce(v_material.current_balance, 0), 0) - eligible.earlier_balance), 0)
      into v_available
      from eligible where eligible.id = v_batch.id;
      if v_allocation_qty <= 0 or v_batch.id is null or v_batch.raw_material_id is distinct from v_material.id
         or v_batch.source_type <> 'receiving' or v_batch.status <> 'active'
         or coalesce(v_available, 0) < v_allocation_qty
         or lower(btrim(v_batch.uom)) <> lower(btrim(coalesce(v_usage->>'uom', v_material.uom)))
         or v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
         or (v_batch.expiry_date is not null and v_batch.expiry_date < v_production_date) then
        select least(greatest(coalesce(v_material.current_balance, 0), 0), coalesce(sum(balance.current_balance), 0)) into v_available
        from public.factory_raw_material_batch_balances balance
        join public.factory_storage_locations location on location.id = balance.storage_location_id and lower(coalesce(location.status, '')) = 'active'
        where balance.raw_material_id = v_material.id and balance.source_type = 'receiving'
          and balance.status = 'active' and balance.current_balance > 0
          and lower(btrim(balance.uom)) = lower(btrim(coalesce(v_usage->>'uom', v_material.uom)))
          and (balance.expiry_date is null or balance.expiry_date >= v_production_date);
        raise exception 'Insufficient Raw Material batch stock for %. Required %, available %.', v_material.name, v_actual, v_available;
      end if;

      insert into public.factory_production_material_usage_batch_allocations (
        production_material_usage_id, raw_material_batch_balance_id, allocated_qty
      ) values (v_usage_id, v_batch.id, v_allocation_qty);
      update public.factory_raw_material_batch_balances
      set current_balance = current_balance - v_allocation_qty, updated_at = now()
      where id = v_batch.id;
      update public.factory_raw_materials
      set current_balance = current_balance - v_allocation_qty, updated_at = now()
      where id = v_material.id and current_balance >= v_allocation_qty;
      if not found then
        raise exception 'Insufficient Raw Material batch stock for %. Required %, available %.', v_material.name, v_actual, greatest(coalesce(v_material.current_balance, 0), 0);
      end if;
      v_material.current_balance := v_material.current_balance - v_allocation_qty;
      insert into public.factory_raw_material_movements (
        raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
        reference_no, movement_date, notes, created_by, storage_location_id,
        production_material_usage_id, raw_material_batch_balance_id
      ) values (
        v_material.id, 'Production Usage', -v_allocation_qty, coalesce(nullif(v_usage->>'uom', ''), v_material.uom),
        'production', v_production_id, v_production_no, v_production_date,
        'Raw material deducted from exact Production batch allocation.', v_actor.id, v_batch.storage_location_id,
        v_usage_id, v_batch.id
      );
    end loop;
  end loop;

  perform public.factory_adjust_finished_good_balance(v_finished_good.id, v_actual_pack_qty);
  insert into public.factory_product_stock_movements (
    finished_good_id, product_name, movement_type, quantity, uom, reference_type,
    reference_id, reference_no, movement_date, notes, created_by
  ) values (
    v_finished_good.id, v_finished_good.product_name, 'Production Stock In', v_actual_pack_qty,
    coalesce(v_finished_good.uom, 'packs'), 'production', v_production_id, v_production_no,
    v_production_date, 'Finished goods Packaging SKU stocked in from completed Production.', v_actor.id
  );
  update public.factory_job_orders
  set status = 'completed', produced_quantity = v_expected_output_qty,
      product_name = v_finished_good.product_name, uom = v_expected_output_uom,
      completed_at = now(), completed_by = v_actor.id, updated_at = now()
  where id = v_job.id and lower(status) = 'in_progress';
  if not found then raise exception 'Unable to complete Job Order because it is no longer In Progress.'; end if;
  return v_production_id;
end;
$$;

-- Raw Material Stock Check approval now shares the same exact batch authority.
-- The legacy actor argument is retained only for API compatibility and is ignored.
create or replace function public.factory_approve_raw_material_stock_check(
  p_stock_check_id uuid,
  p_approved_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_check public.factory_raw_material_stock_checks%rowtype;
  v_item public.factory_raw_material_stock_check_items%rowtype;
  v_material public.factory_raw_materials%rowtype;
  v_batch public.factory_raw_material_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_remaining numeric;
  v_take numeric;
  v_known_available numeric;
  v_adjustment_batch_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if not public.current_user_has_permission('factory_raw_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Insufficient permission to approve Raw Material Stock Checks.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.status, '')) = 'active'
  order by employee.id
  limit 1;
  if v_actor.id is null then
    raise exception using errcode = '42501', message = 'An active employee profile is required.';
  end if;

  select stock_check.* into v_check
  from public.factory_raw_material_stock_checks stock_check
  where stock_check.id = p_stock_check_id
  for update;
  if v_check.id is null then raise exception 'Raw Material Stock Check was not found.'; end if;
  if lower(coalesce(v_check.status, '')) <> 'submitted' then
    raise exception 'Only submitted Raw Material Stock Checks can be approved.';
  end if;
  if not exists (
    select 1 from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
  ) then
    raise exception 'Raw Material Stock Check requires at least one counted item.';
  end if;

  perform material.id
  from public.factory_raw_materials material
  where material.id in (
    select distinct item.raw_material_id
    from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
      and lower(coalesce(item.count_status, 'counted')) <> 'skipped'
  )
  order by material.id
  for update;

  perform balance.id
  from public.factory_raw_material_batch_balances balance
  where balance.raw_material_id in (
    select distinct item.raw_material_id
    from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
      and coalesce(item.variance_qty, 0) < 0
  )
  order by balance.id
  for update;

  for v_item in
    select item.*
    from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
    order by item.raw_material_id, item.id
  loop
    if lower(coalesce(v_item.count_status, 'counted')) = 'pending' then
      raise exception 'All Raw Material Stock Check items must be counted or skipped before approval.';
    end if;
    if lower(coalesce(v_item.count_status, 'counted')) = 'skipped'
       or lower(coalesce(v_item.variance_status, '')) = 'skipped' then
      continue;
    end if;
    if lower(coalesce(v_item.variance_status, '')) in ('warning', 'critical')
       and nullif(btrim(v_item.variance_reason), '') is null then
      raise exception 'Variance reason is required for Warning and Critical Raw Material Stock Check items.';
    end if;

    select material.* into v_material
    from public.factory_raw_materials material
    where material.id = v_item.raw_material_id
    for update;
    if v_material.id is null or lower(coalesce(v_material.status, '')) <> 'active' then
      raise exception 'Every counted Raw Material Stock Check row requires an active Raw Material.';
    end if;
    if nullif(lower(btrim(v_item.uom)), '') is null
       or nullif(lower(btrim(v_material.uom)), '') is null
       or lower(btrim(v_item.uom)) <> lower(btrim(v_material.uom)) then
      raise exception 'Raw Material Stock Check UOM must match the Raw Material UOM.';
    end if;

    if coalesce(v_item.variance_qty, 0) < 0 then
      v_remaining := abs(v_item.variance_qty);
      select coalesce(sum(balance.current_balance), 0) into v_known_available
      from public.factory_raw_material_batch_balances balance
      join public.factory_storage_locations location
        on location.id = balance.storage_location_id
       and lower(coalesce(location.status, '')) = 'active'
      where balance.raw_material_id = v_material.id
        and balance.source_type = 'receiving'
        and balance.status = 'active'
        and balance.current_balance > 0
        and nullif(lower(btrim(balance.uom)), '') = lower(btrim(v_item.uom));
      v_known_available := least(v_known_available, greatest(coalesce(v_material.current_balance, 0), 0));
      if v_known_available < v_remaining then
        raise exception 'Insufficient reconciled Raw Material batch stock for Stock Check adjustment. Required %, available %.', v_remaining, v_known_available;
      end if;

      for v_batch in
        select balance.*
        from public.factory_raw_material_batch_balances balance
        join public.factory_storage_locations location
          on location.id = balance.storage_location_id
         and lower(coalesce(location.status, '')) = 'active'
        where balance.raw_material_id = v_material.id
          and balance.source_type = 'receiving'
          and balance.status = 'active'
          and balance.current_balance > 0
          and nullif(lower(btrim(balance.uom)), '') = lower(btrim(v_item.uom))
        order by balance.expiry_date asc nulls last, balance.received_date asc nulls last,
          balance.manufacturing_date asc nulls last, balance.internal_batch_no asc, balance.id asc
        for update of balance
      loop
        exit when v_remaining <= 0;
        v_take := least(v_batch.current_balance, v_remaining);
        update public.factory_raw_material_batch_balances
        set current_balance = current_balance - v_take, updated_at = now()
        where id = v_batch.id and current_balance >= v_take;
        if not found then raise exception 'Raw Material batch stock changed while approving the Stock Check.'; end if;

        insert into public.factory_raw_material_stock_check_batch_allocations (
          stock_check_item_id, raw_material_batch_balance_id, allocated_qty
        ) values (v_item.id, v_batch.id, v_take);

        update public.factory_raw_materials
        set current_balance = current_balance - v_take, updated_at = now()
        where id = v_material.id and current_balance >= v_take;
        if not found then raise exception 'Raw Material aggregate stock changed while approving the Stock Check.'; end if;
        v_material.current_balance := v_material.current_balance - v_take;

        insert into public.factory_raw_material_movements (
          raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
          reference_no, movement_date, notes, created_by, storage_location_id,
          raw_material_batch_balance_id
        ) values (
          v_material.id, 'Stock Check Adjustment', -v_take, v_item.uom,
          'raw_material_stock_check', v_check.id, v_check.check_no,
          coalesce(v_check.check_date, (now() at time zone 'Asia/Kuala_Lumpur')::date),
          coalesce(nullif(btrim(v_item.variance_reason), ''), 'Approved Raw Material Stock Check reduction.'),
          v_actor.id, v_batch.storage_location_id, v_batch.id
        );
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0.000001 then
        raise exception 'Raw Material Stock Check batch allocation could not be reconciled completely.';
      end if;
    elsif coalesce(v_item.variance_qty, 0) > 0 then
      select location.* into v_location
      from public.factory_storage_locations location
      where location.id = v_material.storage_location_id
        and lower(coalesce(location.status, '')) = 'active';
      if v_location.id is null then
        raise exception 'Select an active Raw Material Storage Location before approving a positive Stock Check adjustment.';
      end if;

      insert into public.factory_raw_material_batch_balances (
        raw_material_stock_check_item_id, raw_material_id, source_type,
        internal_batch_no, storage_location_id, uom, opening_qty, current_balance,
        status, diagnostic
      ) values (
        v_item.id, v_material.id, 'stock_check_adjustment', null,
        v_location.id, v_item.uom, v_item.variance_qty, v_item.variance_qty,
        'reconciliation_required',
        'Positive Stock Check quantity has no supplier Receiving batch and remains unavailable for Production allocation.'
      ) returning id into v_adjustment_batch_id;

      insert into public.factory_raw_material_batch_reconciliation_diagnostics (
        raw_material_id, stock_check_item_id, diagnostic_type, diagnostic_qty, details
      ) values (
        v_material.id, v_item.id, 'stock_check_adjustment_unallocated', v_item.variance_qty,
        'Positive Stock Check quantity is represented in an unavailable adjustment bucket until exact batch provenance is reconciled.'
      );

      update public.factory_raw_materials
      set current_balance = current_balance + v_item.variance_qty, updated_at = now()
      where id = v_material.id;

      insert into public.factory_raw_material_movements (
        raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
        reference_no, movement_date, notes, created_by, storage_location_id,
        raw_material_batch_balance_id
      ) values (
        v_material.id, 'Stock Check Adjustment', v_item.variance_qty, v_item.uom,
        'raw_material_stock_check', v_check.id, v_check.check_no,
        coalesce(v_check.check_date, (now() at time zone 'Asia/Kuala_Lumpur')::date),
        coalesce(nullif(btrim(v_item.variance_reason), ''), 'Approved Raw Material Stock Check increase; batch reconciliation required.'),
        v_actor.id, v_location.id, v_adjustment_batch_id
      );
    end if;
  end loop;

  update public.factory_raw_material_stock_checks
  set status = 'approved', approved_by = v_actor.id, approved_at = now(), updated_at = now()
  where id = v_check.id and lower(status) = 'submitted';
  if not found then raise exception 'Raw Material Stock Check is no longer submitted.'; end if;
end;
$$;

grant execute on function public.factory_approve_raw_material_stock_check(uuid, uuid) to authenticated;
revoke execute on function public.factory_approve_raw_material_stock_check(uuid, uuid) from public, anon;

grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb) to authenticated;
revoke execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb) from public, anon;
revoke execute on function public.factory_complete_production_with_batch(
  uuid, uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, uuid, text, text, uuid, jsonb,
  numeric, numeric, date, date, uuid, text
) from public, anon, authenticated;

revoke execute on function public.factory_complete_production(
  uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, text, uuid, jsonb
) from public, anon, authenticated;
revoke execute on function public.factory_complete_production(
  uuid, uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;
revoke execute on function public.factory_complete_production(
  uuid, uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, uuid, text, text, uuid, jsonb,
  numeric, numeric
) from public, anon, authenticated;

revoke execute on function public.factory_adjust_raw_material_balance(uuid, numeric)
from public, anon, authenticated;

create or replace function public.factory_link_raw_material_movement_usage()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usage public.factory_production_material_usage%rowtype;
  v_allocation public.factory_production_material_usage_batch_allocations%rowtype;
begin
  if lower(coalesce(new.movement_type, '')) <> 'production usage' then return new; end if;
  if new.production_material_usage_id is null then
    raise exception 'Production Usage movement requires an authoritative usage relationship.';
  end if;
  select usage.* into v_usage from public.factory_production_material_usage usage where usage.id = new.production_material_usage_id;
  if v_usage.id is null or v_usage.production_id is distinct from new.reference_id or v_usage.raw_material_id is distinct from new.raw_material_id then
    raise exception 'Production Usage movement does not match its authoritative usage row.';
  end if;
  if new.raw_material_batch_balance_id is not null then
    select allocation.* into v_allocation
    from public.factory_production_material_usage_batch_allocations allocation
    where allocation.production_material_usage_id = new.production_material_usage_id
      and allocation.raw_material_batch_balance_id = new.raw_material_batch_balance_id;
    if v_allocation.id is null or v_allocation.allocated_qty is distinct from abs(new.quantity) then
      raise exception 'Production Usage movement does not match its exact batch allocation.';
    end if;
  elsif coalesce(v_usage.actual_usage, v_usage.quantity_used) is distinct from abs(new.quantity) then
    raise exception 'Historical Production Usage movement does not match its authoritative usage row.';
  end if;
  return new;
end;
$$;

create or replace function public.factory_guard_raw_material_movement_usage_link()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.production_material_usage_id is distinct from new.production_material_usage_id
     or old.raw_material_batch_balance_id is distinct from new.raw_material_batch_balance_id then
    raise exception 'Production Usage movement relationships are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists factory_guard_raw_material_movement_usage_link_trigger on public.factory_raw_material_movements;
create trigger factory_guard_raw_material_movement_usage_link_trigger
before update of production_material_usage_id, raw_material_batch_balance_id on public.factory_raw_material_movements
for each row execute function public.factory_guard_raw_material_movement_usage_link();

revoke execute on function public.factory_link_raw_material_movement_usage() from public, anon, authenticated;
revoke execute on function public.factory_guard_raw_material_movement_usage_link() from public, anon, authenticated;

-- Enrich the existing authoritative ledger only through the immutable movement batch FK.
create or replace function public.factory_list_raw_material_movements(
  p_batch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_raw_material_id uuid default null,
  p_movement_type text default null,
  p_storage_location text default null,
  p_search text default null
)
returns table (
  id uuid, raw_material_id uuid, movement_type text, quantity numeric, uom text,
  reference_type text, reference_id uuid, reference_no text, movement_date date,
  notes text, created_by uuid, created_at timestamptz, created_by_name text,
  storage_location text, batch_no text, balance_after numeric, raw_material jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      ledger.*,
      source.raw_material_batch_balance_id,
      exact_batch.internal_batch_no as exact_batch_no,
      exact_batch.supplier_lot_no as exact_supplier_lot_no,
      exact_location.location_name as exact_storage_location,
      nullif(btrim(production.production_no), '') as production_no,
      nullif(btrim(job_order.job_order_no), '') as job_order_no,
      case when production.id is not null then coalesce(
        nullif(btrim(production.batch_no), ''),
        nullif(btrim(production.production_no), ''),
        nullif(btrim(job_order.job_order_no), '')
      ) else ledger.reference_no end as display_reference_no
    from public.factory_list_raw_material_movements_v1(
      null, p_date_from, p_date_to, p_raw_material_id, p_movement_type, null, null
    ) ledger
    join public.factory_raw_material_movements source on source.id = ledger.id
    left join public.factory_raw_material_batch_balances exact_batch
      on exact_batch.id = source.raw_material_batch_balance_id
    left join public.factory_storage_locations exact_location
      on exact_location.id = exact_batch.storage_location_id
    left join public.factory_productions production
      on lower(coalesce(source.reference_type, '')) = 'production'
     and production.id = source.reference_id
    left join public.factory_job_orders job_order on job_order.id = production.job_order_id
  ), enriched as (
    select
      base.id, base.raw_material_id, base.movement_type, base.quantity, base.uom,
      base.reference_type, base.reference_id, base.display_reference_no as reference_no,
      base.movement_date, base.notes, base.created_by, base.created_at, base.created_by_name,
      case when base.raw_material_batch_balance_id is null
        then base.storage_location else base.exact_storage_location end as storage_location,
      case when base.raw_material_batch_balance_id is null
        then base.batch_no else base.exact_batch_no end as batch_no,
      base.balance_after,
      case when base.raw_material_batch_balance_id is null then base.raw_material else
        jsonb_set(
          jsonb_set(
            jsonb_set(base.raw_material, '{batch_id}', to_jsonb(base.raw_material_batch_balance_id), true),
            '{supplier_lot_no}', to_jsonb(coalesce(base.exact_supplier_lot_no, '')), true
          ),
          '{production_material_usage_id}', to_jsonb(coalesce(base.raw_material ->> 'production_material_usage_id', '')), true
        )
      end as raw_material,
      base.raw_material_batch_balance_id,
      base.production_no,
      base.job_order_no
    from base
  )
  select
    movement.id, movement.raw_material_id, movement.movement_type, movement.quantity,
    movement.uom, movement.reference_type, movement.reference_id, movement.reference_no,
    movement.movement_date, movement.notes, movement.created_by, movement.created_at,
    movement.created_by_name, movement.storage_location, movement.batch_no,
    movement.balance_after, movement.raw_material
  from enriched movement
  where (p_batch_id is null or movement.raw_material_batch_balance_id = p_batch_id)
    and (nullif(btrim(p_storage_location), '') is null or movement.storage_location = p_storage_location)
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ', movement.reference_no, movement.production_no, movement.job_order_no,
        movement.batch_no, movement.raw_material ->> 'supplier_lot_no',
        movement.raw_material ->> 'material_code', movement.raw_material ->> 'name',
        movement.raw_material ->> 'name_en', movement.notes
      ) ilike '%' || btrim(p_search) || '%'
    )
  order by movement.movement_date desc, movement.created_at desc, movement.id desc;
$$;

create or replace function public.factory_list_raw_material_movements(
  p_date_from date default null,
  p_date_to date default null,
  p_raw_material_id uuid default null,
  p_movement_type text default null,
  p_storage_location text default null,
  p_search text default null
)
returns table (
  id uuid, raw_material_id uuid, movement_type text, quantity numeric, uom text,
  reference_type text, reference_id uuid, reference_no text, movement_date date,
  notes text, created_by uuid, created_at timestamptz, created_by_name text,
  storage_location text, batch_no text, balance_after numeric, raw_material jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select * from public.factory_list_raw_material_movements(
    null, p_date_from, p_date_to, p_raw_material_id, p_movement_type, p_storage_location, p_search
  );
$$;
