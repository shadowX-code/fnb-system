-- Authoritative Raw Material Movement audit ledger metadata and UOM-safe KPIs.
-- Read-only listing functions preserve the existing movement ledger and RLS policies.

alter table public.factory_raw_material_movements
  add column if not exists production_material_usage_id uuid
    references public.factory_production_material_usage(id);

create unique index if not exists factory_raw_material_movements_production_usage_idx
  on public.factory_raw_material_movements (production_material_usage_id)
  where production_material_usage_id is not null;

drop trigger if exists factory_guard_raw_material_movement_usage_link_trigger
on public.factory_raw_material_movements;

-- Historical usage links are populated only when both sides are one-to-one and
-- the sole usage row for the Production/material agrees with the movement quantity.
with candidate_pairs as (
  select
    movement.id as movement_id,
    usage.id as usage_id,
    count(*) over (partition by movement.id) as usage_matches,
    count(*) over (partition by usage.id) as movement_matches
  from public.factory_raw_material_movements movement
  join public.factory_production_material_usage usage
    on usage.production_id = movement.reference_id
   and usage.raw_material_id = movement.raw_material_id
   and coalesce(usage.actual_usage, usage.quantity_used) = abs(movement.quantity)
  where lower(coalesce(movement.movement_type, '')) = 'production usage'
    and lower(coalesce(movement.reference_type, '')) = 'production'
    and movement.reference_id is not null
    and movement.production_material_usage_id is null
    and 1 = (
      select count(*)
      from public.factory_production_material_usage material_usage
      where material_usage.production_id = movement.reference_id
        and material_usage.raw_material_id = movement.raw_material_id
    )
)
update public.factory_raw_material_movements movement
set production_material_usage_id = candidate.usage_id
from candidate_pairs candidate
where movement.id = candidate.movement_id
  and candidate.usage_matches = 1
  and candidate.movement_matches = 1
  and movement.production_material_usage_id is null;

-- The trusted Production completion path inserts one usage row immediately before
-- its movement. Link that sole unlinked row, and reject any future ambiguous post.
create or replace function public.factory_link_raw_material_movement_usage()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usage_ids uuid[];
  v_usage public.factory_production_material_usage%rowtype;
begin
  if lower(coalesce(new.movement_type, '')) <> 'production usage' then
    return new;
  end if;

  if lower(coalesce(new.reference_type, '')) <> 'production' or new.reference_id is null then
    raise exception 'Production Usage movement requires an authoritative Production reference.';
  end if;

  if new.production_material_usage_id is not null then
    select usage.* into v_usage
    from public.factory_production_material_usage usage
    where usage.id = new.production_material_usage_id;

    if v_usage.id is null
       or v_usage.production_id is distinct from new.reference_id
       or v_usage.raw_material_id is distinct from new.raw_material_id
       or coalesce(v_usage.actual_usage, v_usage.quantity_used) is distinct from abs(new.quantity) then
      raise exception 'Production Usage movement does not match its authoritative usage row.';
    end if;
    return new;
  end if;

  select array_agg(usage.id order by usage.id::text)
  into v_usage_ids
  from public.factory_production_material_usage usage
  where usage.production_id = new.reference_id
    and usage.raw_material_id = new.raw_material_id
    and coalesce(usage.actual_usage, usage.quantity_used) = abs(new.quantity)
    and not exists (
      select 1
      from public.factory_raw_material_movements linked_movement
      where linked_movement.production_material_usage_id = usage.id
    );

  if coalesce(cardinality(v_usage_ids), 0) <> 1 then
    raise exception 'Production Usage movement could not be linked to exactly one usage row.';
  end if;

  new.production_material_usage_id := v_usage_ids[1];
  return new;
end;
$$;

drop trigger if exists factory_link_raw_material_movement_usage_trigger
on public.factory_raw_material_movements;
create trigger factory_link_raw_material_movement_usage_trigger
before insert on public.factory_raw_material_movements
for each row execute function public.factory_link_raw_material_movement_usage();

revoke execute on function public.factory_link_raw_material_movement_usage()
from public, anon, authenticated;

create or replace function public.factory_guard_raw_material_movement_usage_link()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.production_material_usage_id is distinct from new.production_material_usage_id then
    raise exception 'Production Usage movement relationship is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists factory_guard_raw_material_movement_usage_link_trigger
on public.factory_raw_material_movements;
create trigger factory_guard_raw_material_movement_usage_link_trigger
before update of production_material_usage_id on public.factory_raw_material_movements
for each row execute function public.factory_guard_raw_material_movement_usage_link();

revoke execute on function public.factory_guard_raw_material_movement_usage_link()
from public, anon, authenticated;

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
  id uuid,
  raw_material_id uuid,
  movement_type text,
  quantity numeric,
  uom text,
  reference_type text,
  reference_id uuid,
  reference_no text,
  movement_date date,
  notes text,
  created_by uuid,
  created_at timestamptz,
  created_by_name text,
  storage_location text,
  batch_no text,
  balance_after numeric,
  raw_material jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with ledger as (
    select
      movement.id,
      movement.raw_material_id,
      movement.movement_type,
      movement.quantity,
      coalesce(nullif(btrim(movement.uom), ''), nullif(btrim(raw_material.uom), ''), 'unit') as uom,
      movement.reference_type,
      movement.reference_id,
      case
        when receiving_item.id is not null then coalesce(receiving_batch.batch_no, receiving_item.receipt_no)
        when production.id is not null then coalesce(nullif(btrim(production.production_no), ''), nullif(btrim(job_order.job_order_no), ''))
        when raw_stock_check.id is not null then raw_stock_check.check_no
        when product_stock_check.id is not null then product_stock_check.check_no
        when dispatch.id is not null then dispatch.dispatch_no
        else null
      end as reference_no,
      movement.movement_date,
      movement.notes,
      movement.created_by,
      movement.created_at,
      coalesce(employee.nickname, employee.full_name) as created_by_name,
      coalesce(
        receiving_location.location_name,
        usage_location.location_name,
        raw_location.location_name,
        raw_material.storage_location
      ) as storage_location,
      coalesce(
        nullif(btrim(receiving_item.internal_batch_no), ''),
        nullif(btrim(usage_receiving.internal_batch_no), '')
      ) as batch_no,
      coalesce(raw_material.current_balance, 0)
        - coalesce(
            sum(movement.quantity) over (
              partition by movement.raw_material_id
              order by movement.movement_date desc, movement.created_at desc, movement.id desc
              rows between unbounded preceding and 1 preceding
            ),
            0
          ) as balance_after,
      jsonb_build_object(
        'id', raw_material.id,
        'material_code', raw_material.material_code,
        'name', raw_material.name,
        'name_en', raw_material.name_en,
        'name_cn', raw_material.name_cn,
        'name_bm', raw_material.name_bm,
        'uom', raw_material.uom,
        'current_balance', raw_material.current_balance,
        'storage_location', raw_material.storage_location,
        'supplier_lot_no', coalesce(
          nullif(btrim(receiving_item.supplier_lot_no), ''),
          nullif(btrim(usage_receiving.supplier_lot_no), ''),
          nullif(btrim(production_usage.raw_material_lot_no), '')
        ),
        'batch_id', coalesce(receiving_item.id, usage_receiving.id),
        'production_material_usage_id', production_usage.id,
        'document_type', case
          when receiving_item.id is not null then 'receiving'
          when production.id is not null then 'production'
          when raw_stock_check.id is not null then 'raw_stock_check'
          when product_stock_check.id is not null then 'product_stock_check'
          when dispatch.id is not null then 'dispatch'
          else null
        end,
        'document_id', coalesce(
          coalesce(receiving_batch.id, receiving_item.id),
          production.id,
          raw_stock_check.id,
          product_stock_check.id,
          dispatch.id
        )
      ) as raw_material
    from public.factory_raw_material_movements movement
    left join public.factory_raw_materials raw_material on raw_material.id = movement.raw_material_id
    left join public.employees employee on employee.id = movement.created_by
    left join lateral (
      select receiving_row.*
      from public.factory_raw_material_receivings receiving_row
      where lower(coalesce(movement.reference_type, '')) = 'raw_material_receiving'
        and (
          (movement.reference_id is not null and receiving_row.id = movement.reference_id)
          or (
            movement.reference_id is null
            and receiving_row.receipt_no = movement.reference_no
            and 1 = (
              select count(*)
              from public.factory_raw_material_receivings fallback_receiving
              where fallback_receiving.receipt_no = movement.reference_no
            )
          )
        )
      limit 1
    ) receiving_item on true
    left join public.factory_raw_material_receiving_batches receiving_batch
      on receiving_batch.id = receiving_item.batch_id
    left join public.factory_storage_locations receiving_location
      on receiving_location.id = receiving_item.storage_location_id
    left join lateral (
      select production_row.id, production_row.production_no, production_row.job_order_id
      from public.factory_productions production_row
      where lower(coalesce(movement.reference_type, '')) = 'production'
        and (
          (movement.reference_id is not null and production_row.id = movement.reference_id)
          or (
            movement.reference_id is null
            and production_row.production_no = movement.reference_no
            and 1 = (
              select count(*)
              from public.factory_productions fallback_production
              where fallback_production.production_no = movement.reference_no
            )
          )
        )
      limit 1
    ) production on true
    left join public.factory_job_orders job_order on job_order.id = production.job_order_id
    left join public.factory_production_material_usage production_usage
      on production_usage.id = movement.production_material_usage_id
     and production_usage.production_id = production.id
     and production_usage.raw_material_id = movement.raw_material_id
    left join public.factory_raw_material_receivings usage_receiving
      on usage_receiving.id = production_usage.raw_material_receiving_id
    left join public.factory_storage_locations usage_location
      on usage_location.id = usage_receiving.storage_location_id
    left join lateral (
      select check_row.id, check_row.check_no
      from public.factory_raw_material_stock_checks check_row
      where lower(coalesce(movement.reference_type, '')) = 'raw_material_stock_check'
        and (
          (movement.reference_id is not null and check_row.id = movement.reference_id)
          or (
            movement.reference_id is null
            and check_row.check_no = movement.reference_no
            and 1 = (
              select count(*)
              from public.factory_raw_material_stock_checks fallback_check
              where fallback_check.check_no = movement.reference_no
            )
          )
        )
      limit 1
    ) raw_stock_check on true
    left join lateral (
      select check_row.id, check_row.check_no
      from public.factory_product_stock_checks check_row
      where lower(coalesce(movement.reference_type, '')) = 'product_stock_check'
        and (
          (movement.reference_id is not null and check_row.id = movement.reference_id)
          or (
            movement.reference_id is null
            and check_row.check_no = movement.reference_no
            and 1 = (
              select count(*)
              from public.factory_product_stock_checks fallback_check
              where fallback_check.check_no = movement.reference_no
            )
          )
        )
      limit 1
    ) product_stock_check on true
    left join lateral (
      select dispatch_row.id, dispatch_row.dispatch_no
      from public.factory_finished_good_dispatches dispatch_row
      where lower(coalesce(movement.reference_type, '')) in ('dispatch', 'finished_good_dispatch')
        and (
          (movement.reference_id is not null and dispatch_row.id = movement.reference_id)
          or (
            movement.reference_id is null
            and dispatch_row.dispatch_no = movement.reference_no
            and 1 = (
              select count(*)
              from public.factory_finished_good_dispatches fallback_dispatch
              where fallback_dispatch.dispatch_no = movement.reference_no
            )
          )
        )
      limit 1
    ) dispatch on true
    left join public.factory_storage_locations raw_location
      on raw_location.id = raw_material.storage_location_id
  )
  select *
  from ledger
  where (p_date_from is null or movement_date >= p_date_from)
    and (p_date_to is null or movement_date <= p_date_to)
    and (p_raw_material_id is null or raw_material_id = p_raw_material_id)
    and (nullif(btrim(p_movement_type), '') is null or movement_type = p_movement_type)
    and (nullif(btrim(p_storage_location), '') is null or storage_location = p_storage_location)
    and (p_batch_id is null or nullif(raw_material ->> 'batch_id', '')::uuid = p_batch_id)
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(
        ' ',
        reference_no,
        batch_no,
        raw_material ->> 'supplier_lot_no',
        raw_material ->> 'material_code',
        raw_material ->> 'name',
        raw_material ->> 'name_en',
        raw_material ->> 'name_cn',
        raw_material ->> 'name_bm',
        notes
      ) ilike '%' || btrim(p_search) || '%'
    )
  order by movement_date desc, created_at desc, id desc;
$$;

-- Compatibility wrapper for existing callers that do not use exact batch filtering.
create or replace function public.factory_list_raw_material_movements(
  p_date_from date default null,
  p_date_to date default null,
  p_raw_material_id uuid default null,
  p_movement_type text default null,
  p_storage_location text default null,
  p_search text default null
)
returns table (
  id uuid,
  raw_material_id uuid,
  movement_type text,
  quantity numeric,
  uom text,
  reference_type text,
  reference_id uuid,
  reference_no text,
  movement_date date,
  notes text,
  created_by uuid,
  created_at timestamptz,
  created_by_name text,
  storage_location text,
  batch_no text,
  balance_after numeric,
  raw_material jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.factory_list_raw_material_movements(
    null, p_date_from, p_date_to, p_raw_material_id,
    p_movement_type, p_storage_location, p_search
  );
$$;

create or replace function public.factory_raw_material_movement_summary(
  p_batch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_raw_material_id uuid default null,
  p_movement_type text default null,
  p_storage_location text default null,
  p_search text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select *
    from public.factory_list_raw_material_movements(
      p_batch_id,
      p_date_from,
      p_date_to,
      p_raw_material_id,
      p_movement_type,
      p_storage_location,
      p_search
    )
  ),
  stock_in as (
    select uom, sum(quantity) as quantity
    from filtered
    where quantity > 0
    group by uom
  ),
  stock_out as (
    select uom, abs(sum(quantity)) as quantity
    from filtered
    where quantity < 0
    group by uom
  )
  select jsonb_build_object(
    'movements', (select count(*) from filtered),
    'stock_in_by_uom', coalesce((
      select jsonb_agg(jsonb_build_object('uom', uom, 'quantity', quantity) order by uom)
      from stock_in
    ), '[]'::jsonb),
    'stock_out_by_uom', coalesce((
      select jsonb_agg(jsonb_build_object('uom', uom, 'quantity', quantity) order by uom)
      from stock_out
    ), '[]'::jsonb),
    'locations', (select count(distinct storage_location) from filtered),
    'movement_types', coalesce((
      select jsonb_agg(value order by value)
      from (
        select distinct movement_type as value
        from public.factory_raw_material_movements
        where nullif(btrim(movement_type), '') is not null
      ) types
    ), '[]'::jsonb),
    'location_values', coalesce((
      select jsonb_agg(value order by value)
      from (
        select distinct storage_location as value
        from public.factory_list_raw_material_movements(null, null, null, null, null, null, null)
        where nullif(btrim(storage_location), '') is not null
      ) locations
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.factory_list_raw_material_movements(uuid, date, date, uuid, text, text, text) from public, anon;
revoke all on function public.factory_list_raw_material_movements(date, date, uuid, text, text, text) from public, anon;
revoke all on function public.factory_raw_material_movement_summary(uuid, date, date, uuid, text, text, text) from public, anon;
grant execute on function public.factory_list_raw_material_movements(uuid, date, date, uuid, text, text, text) to authenticated;
grant execute on function public.factory_list_raw_material_movements(date, date, uuid, text, text, text) to authenticated;
grant execute on function public.factory_raw_material_movement_summary(uuid, date, date, uuid, text, text, text) to authenticated;

comment on column public.factory_raw_material_movements.production_material_usage_id is
  'Immutable exact Production material-usage relationship for Raw Material Movement traceability.';

comment on function public.factory_raw_material_movement_summary(uuid, date, date, uuid, text, text, text) is
  'Returns filtered Raw Material Movement audit KPIs grouped by resolved UOM without mutating ledger data.';
