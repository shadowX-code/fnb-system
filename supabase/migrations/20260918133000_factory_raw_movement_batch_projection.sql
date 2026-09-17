-- Keep Raw Material Movement batch display anchored to the immutable batch-balance
-- relationship. Later business-reference formatting must not discard this authority.
-- The projection is read-only: it neither creates batches nor changes ledger evidence.
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
      nullif(btrim(linked_job.job_order_no), '') as job_order_no,
      case
        when lower(coalesce(source.reference_type, '')) = 'production' then coalesce(
          nullif(btrim(linked_production.batch_no), ''),
          nullif(btrim(linked_job.job_order_no), '')
        )
        else ledger.reference_no
      end as display_reference_no
    from public.factory_list_raw_material_movements_v1(
      null, p_date_from, p_date_to, p_raw_material_id, p_movement_type, null, null
    ) ledger
    join public.factory_raw_material_movements source on source.id = ledger.id
    left join public.factory_raw_material_batch_balances exact_batch
      on exact_batch.id = source.raw_material_batch_balance_id
    left join public.factory_storage_locations exact_location
      on exact_location.id = exact_batch.storage_location_id
    left join public.factory_productions linked_production
      on lower(coalesce(source.reference_type, '')) = 'production'
     and linked_production.id = coalesce(
       source.reference_id,
       nullif(ledger.raw_material ->> 'document_id', '')::uuid
     )
    left join public.factory_job_orders linked_job
      on linked_job.id = linked_production.job_order_id
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
          '{production_material_usage_id}',
          to_jsonb(coalesce(base.raw_material ->> 'production_material_usage_id', '')),
          true
        )
      end as raw_material,
      base.raw_material_batch_balance_id,
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
      or concat_ws(' ', movement.reference_no, movement.job_order_no,
        movement.batch_no, movement.raw_material ->> 'supplier_lot_no',
        movement.raw_material ->> 'material_code', movement.raw_material ->> 'name',
        movement.raw_material ->> 'name_en', movement.notes
      ) ilike '%' || btrim(p_search) || '%'
    )
  order by movement.movement_date desc, movement.created_at desc, movement.id desc;
$$;

comment on function public.factory_list_raw_material_movements(
  uuid, date, date, uuid, text, text, text
) is 'Returns Raw Material Movements with business references and exact immutable batch-balance projection for Receiving, Production, Stock Check Adjustment, and Transfer evidence.';
