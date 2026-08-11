-- Prefer the exact linked Production Batch No. in the Raw Material Movement ledger.
-- The applied 050013 implementation remains available internally for composition.

do $$
begin
  if to_regprocedure(
    'public.factory_list_raw_material_movements_v1(uuid,date,date,uuid,text,text,text)'
  ) is null then
    alter function public.factory_list_raw_material_movements(
      uuid, date, date, uuid, text, text, text
    ) rename to factory_list_raw_material_movements_v1;
  end if;
end;
$$;

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
  with enriched as (
    select
      movement.*,
      nullif(btrim(linked_production.production_no), '') as production_no,
      nullif(btrim(linked_job.job_order_no), '') as job_order_no,
      case
        when linked_production.id is not null then coalesce(
          nullif(btrim(linked_production.batch_no), ''),
          nullif(btrim(linked_production.production_no), ''),
          nullif(btrim(linked_job.job_order_no), '')
        )
        else movement.reference_no
      end as display_reference_no
    from public.factory_list_raw_material_movements_v1(
      p_batch_id,
      p_date_from,
      p_date_to,
      p_raw_material_id,
      p_movement_type,
      p_storage_location,
      null
    ) movement
    left join public.factory_productions linked_production
      on lower(coalesce(movement.reference_type, '')) = 'production'
     and linked_production.id = coalesce(
       movement.reference_id,
       nullif(movement.raw_material ->> 'document_id', '')::uuid
     )
    left join public.factory_job_orders linked_job
      on linked_job.id = linked_production.job_order_id
  )
  select
    movement.id,
    movement.raw_material_id,
    movement.movement_type,
    movement.quantity,
    movement.uom,
    movement.reference_type,
    movement.reference_id,
    movement.display_reference_no as reference_no,
    movement.movement_date,
    movement.notes,
    movement.created_by,
    movement.created_at,
    movement.created_by_name,
    movement.storage_location,
    movement.batch_no,
    movement.balance_after,
    movement.raw_material
  from enriched movement
  where nullif(btrim(p_search), '') is null
     or concat_ws(
       ' ',
       movement.display_reference_no,
       movement.production_no,
       movement.job_order_no,
       movement.batch_no,
       movement.raw_material ->> 'supplier_lot_no',
       movement.raw_material ->> 'material_code',
       movement.raw_material ->> 'name',
       movement.raw_material ->> 'name_en',
       movement.notes
     ) ilike '%' || btrim(p_search) || '%'
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

revoke all on function public.factory_list_raw_material_movements_v1(
  uuid, date, date, uuid, text, text, text
) from public, anon;

grant execute on function public.factory_list_raw_material_movements_v1(
  uuid, date, date, uuid, text, text, text
) to authenticated;

revoke all on function public.factory_list_raw_material_movements(
  uuid, date, date, uuid, text, text, text
) from public, anon;

grant execute on function public.factory_list_raw_material_movements(
  uuid, date, date, uuid, text, text, text
) to authenticated;

revoke all on function public.factory_list_raw_material_movements(
  date, date, uuid, text, text, text
) from public, anon;

grant execute on function public.factory_list_raw_material_movements(
  date, date, uuid, text, text, text
) to authenticated;

comment on function public.factory_list_raw_material_movements(
  uuid, date, date, uuid, text, text, text
) is 'Returns the authoritative Raw Material Movement ledger with Production Batch No. preferred for exact linked Production Usage references.';
