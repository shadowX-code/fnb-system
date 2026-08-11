-- Shared read-only pagination support for growing Factory histories.
-- RLS remains authoritative because every function is SECURITY INVOKER.

create index if not exists factory_raw_material_movements_ledger_order_idx
  on public.factory_raw_material_movements (movement_date desc, created_at desc, id desc);

create index if not exists factory_raw_material_movements_material_ledger_order_idx
  on public.factory_raw_material_movements (raw_material_id, movement_date desc, created_at desc, id desc);

create index if not exists factory_raw_receiving_batches_pagination_order_idx
  on public.factory_raw_material_receiving_batches (received_date desc, created_at desc, id desc);

create index if not exists factory_raw_stock_checks_pagination_order_idx
  on public.factory_raw_material_stock_checks (check_date desc, created_at desc, id desc);

create index if not exists factory_product_stock_checks_pagination_order_idx
  on public.factory_product_stock_checks (check_date desc, created_at desc, id desc);

create index if not exists factory_job_orders_pagination_order_idx
  on public.factory_job_orders (planned_date desc, created_at desc, id desc);

create index if not exists factory_productions_pagination_order_idx
  on public.factory_productions (production_date desc, created_at desc, id desc);

create index if not exists factory_dispatches_pagination_order_idx
  on public.factory_finished_good_dispatches (dispatch_date desc, created_at desc, id desc);

create index if not exists audit_logs_factory_pagination_order_idx
  on public.audit_logs (module, created_at desc, id desc);

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
  with ledger as (
    select
      movement.id,
      movement.raw_material_id,
      movement.movement_type,
      movement.quantity,
      movement.uom,
      movement.reference_type,
      movement.reference_id,
      movement.reference_no,
      movement.movement_date,
      movement.notes,
      movement.created_by,
      movement.created_at,
      coalesce(employee.nickname, employee.full_name, movement.created_by::text) as created_by_name,
      coalesce(receiving_location.location_name, raw_location.location_name, raw_material.storage_location) as storage_location,
      receiving.batch_no,
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
        'storage_location', raw_material.storage_location
      ) as raw_material
    from public.factory_raw_material_movements movement
    left join public.factory_raw_materials raw_material on raw_material.id = movement.raw_material_id
    left join public.employees employee on employee.id = movement.created_by
    left join lateral (
      select receiving_row.id, receiving_row.batch_no, receiving_row.storage_location_id
      from public.factory_raw_material_receivings receiving_row
      where receiving_row.id = movement.reference_id
         or (movement.reference_type = 'raw_material_receiving' and receiving_row.receipt_no = movement.reference_no)
      order by (receiving_row.id = movement.reference_id) desc, receiving_row.created_at desc, receiving_row.id desc
      limit 1
    ) receiving on true
    left join public.factory_storage_locations receiving_location on receiving_location.id = receiving.storage_location_id
    left join public.factory_storage_locations raw_location on raw_location.id = raw_material.storage_location_id
  )
  select *
  from ledger
  where (p_date_from is null or movement_date >= p_date_from)
    and (p_date_to is null or movement_date <= p_date_to)
    and (p_raw_material_id is null or raw_material_id = p_raw_material_id)
    and (nullif(btrim(p_movement_type), '') is null or movement_type = p_movement_type)
    and (nullif(btrim(p_storage_location), '') is null or storage_location = p_storage_location)
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ', reference_no, reference_type, batch_no, notes) ilike '%' || btrim(p_search) || '%'
    )
  order by movement_date desc, created_at desc, id desc;
$$;

create or replace function public.factory_listing_summary(
  p_listing text,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_date_from date := nullif(p_filters ->> 'dateFrom', '')::date;
  v_date_to date := nullif(p_filters ->> 'dateTo', '')::date;
  v_filter_id uuid;
begin
  if p_listing = 'receiving-history' then
    v_filter_id := case when coalesce(p_filters ->> 'supplier', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (p_filters ->> 'supplier')::uuid else null end;
    select jsonb_build_object(
      'documents', count(distinct batch.id),
      'items', count(item.id),
      'total_qty', coalesce(sum(item.received_qty), 0)
    ) into v_result
    from public.factory_raw_material_receiving_batches batch
    left join public.factory_raw_material_receivings item on item.batch_id = batch.id
    where (v_date_from is null or batch.received_date >= v_date_from)
      and (v_date_to is null or batch.received_date <= v_date_to)
      and (nullif(p_filters ->> 'supplier', '') is null or batch.supplier_id = v_filter_id or batch.supplier_name = p_filters ->> 'supplier');
  elsif p_listing = 'raw-movements' then
    select jsonb_build_object(
      'movements', count(*),
      'stock_in_qty', coalesce(sum(quantity) filter (where quantity > 0), 0),
      'stock_out_qty', abs(coalesce(sum(quantity) filter (where quantity < 0), 0)),
      'locations', count(distinct storage_location),
      'movement_types', coalesce((select jsonb_agg(value order by value) from (select distinct movement_type as value from public.factory_raw_material_movements where nullif(btrim(movement_type), '') is not null) types), '[]'::jsonb),
      'location_values', coalesce((select jsonb_agg(value order by value) from (select distinct storage_location as value from public.factory_list_raw_material_movements(null, null, null, null, null, null) where nullif(btrim(storage_location), '') is not null) locations), '[]'::jsonb)
    ) into v_result
    from public.factory_list_raw_material_movements(
      v_date_from,
      v_date_to,
      case when coalesce(p_filters ->> 'material', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (p_filters ->> 'material')::uuid else null end,
      nullif(p_filters ->> 'movementType', ''),
      nullif(p_filters ->> 'storageLocation', ''),
      nullif(p_filters ->> 'search', '')
    );
  elsif p_listing = 'raw-stock-checks' then
    select jsonb_build_object(
      'checks', count(distinct stock_check.id),
      'submitted', count(distinct stock_check.id) filter (where stock_check.status = 'submitted'),
      'critical_rows', count(item.id) filter (where item.variance_status = 'Critical')
    ) into v_result
    from public.factory_raw_material_stock_checks stock_check
    left join public.factory_raw_material_stock_check_items item on item.stock_check_id = stock_check.id;
  elsif p_listing = 'product-stock-checks' then
    select jsonb_build_object(
      'checks', count(distinct stock_check.id),
      'submitted', count(distinct stock_check.id) filter (where stock_check.status = 'submitted'),
      'variance_rows', count(item.id) filter (where item.variance_status <> 'Normal')
    ) into v_result
    from public.factory_product_stock_checks stock_check
    left join public.factory_product_stock_check_items item on item.stock_check_id = stock_check.id;
  elsif p_listing = 'job-orders' then
    select jsonb_build_object(
      'jobs', count(*),
      'draft', count(*) filter (where status = 'draft'),
      'released', count(*) filter (where status in ('released', 'planned')),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'completed', count(*) filter (where status = 'completed'),
      'cancelled', count(*) filter (where status = 'cancelled'),
      'completed_today', count(*) filter (where status = 'completed' and coalesce(completed_at::date, updated_at::date) = current_date),
      'planned_today', count(*) filter (where planned_date = current_date and status <> 'cancelled'),
      'output_today', coalesce((select sum(coalesce(actual_pack_qty, 0)) from public.factory_productions where coalesce(end_date, production_date) = current_date and status = 'completed'), 0)
    ) into v_result from public.factory_job_orders;
  elsif p_listing in ('production-history', 'batch-traceability') then
    select jsonb_build_object(
      'completed_runs', (select count(*) from public.factory_productions where status = 'completed'),
      'good_output', (select coalesce(sum(good_output_qty), 0) from public.factory_productions where status = 'completed'),
      'wastage_qty', (select coalesce(sum(wastage_qty), 0) from public.factory_productions where status = 'completed'),
      'high_variance', (select count(*) from public.factory_production_material_usage where abs(coalesce(variance_percent, 0)) > 5),
      'production_batches', (select count(*) from public.factory_productions),
      'raw_material_lots', (select count(*) from public.factory_production_material_usage where raw_material_receiving_id is not null or nullif(btrim(raw_material_lot_no), '') is not null),
      'traceability_gaps', coalesce((
        select sum(
          2
          + case when not exists (
              select 1 from public.factory_product_recipes recipe
              where recipe.status = 'active'
                and (recipe.finished_good_id = production_row.finished_good_id or (recipe.product_family_id is not null and recipe.product_family_id = finished_good.product_family_id))
            ) then 1 else 0 end
          + case when production_row.production_sop_id is null then 1 else 0 end
          + case when not exists (select 1 from public.factory_production_material_usage usage where usage.production_id = production_row.id)
              or exists (
                select 1 from public.factory_production_material_usage usage
                where usage.production_id = production_row.id
                  and usage.raw_material_receiving_id is null
                  and nullif(btrim(usage.raw_material_lot_no), '') is null
              ) then 1 else 0 end
          + case when nullif(btrim(production_row.production_no), '') is null and production_row.job_order_id is null then 1 else 0 end
          + case when not exists (
              select 1 from public.factory_product_stock_movements movement
              where movement.reference_type = 'production' and movement.reference_id = production_row.id
            ) then 1 else 0 end
          + case when production_row.qc_status in ('Failed', 'Not Started', 'In Progress') then 1 else 0 end
        )
        from public.factory_productions production_row
        left join public.factory_finished_goods finished_good on finished_good.id = production_row.finished_good_id
      ), 0),
      'output_groups', coalesce((
        select jsonb_agg(to_jsonb(output_group) order by output_group.unit)
        from (
          select
            coalesce(nullif(btrim(finished_good.packaging_type), ''), 'Pack') as unit,
            coalesce(sum(production_row.actual_pack_qty), 0) as quantity
          from public.factory_productions production_row
          left join public.factory_finished_goods finished_good on finished_good.id = production_row.finished_good_id
          group by coalesce(nullif(btrim(finished_good.packaging_type), ''), 'Pack')
        ) output_group
      ), '[]'::jsonb)
    ) into v_result;
  elsif p_listing = 'dispatch-history' then
    select jsonb_build_object(
      'draft', count(*) filter (where dispatch.status = 'draft'),
      'completed_today', count(*) filter (where dispatch.status = 'completed' and coalesce(dispatch.completed_at::date, dispatch.dispatch_date) = current_date),
      'customers_today', count(distinct coalesce(dispatch.customer_id::text, dispatch.customer_name)) filter (where dispatch.status = 'completed' and coalesce(dispatch.completed_at::date, dispatch.dispatch_date) = current_date)
    ) into v_result from public.factory_finished_good_dispatches dispatch;
  elsif p_listing = 'audit-logs' then
    select jsonb_build_object(
      'events', count(*),
      'today', count(*) filter (where created_at::date = current_date),
      'users', count(distinct coalesce(user_name, 'System')),
      'failed', count(*) filter (where lower(coalesce(metadata ->> 'status', 'success')) in ('failed', 'error')),
      'action_values', coalesce((select jsonb_agg(value order by value) from (select distinct action as value from public.audit_logs where module = 'factory') actions), '[]'::jsonb),
      'user_values', coalesce((select jsonb_agg(value order by value) from (select distinct coalesce(user_name, 'System') as value from public.audit_logs where module = 'factory') users), '[]'::jsonb)
    ) into v_result from public.audit_logs where module = 'factory';
  end if;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.factory_list_audit_logs(
  p_date_from date default null,
  p_date_to date default null,
  p_module_token text default null,
  p_action_token text default null,
  p_user_name text default null,
  p_search text default null
)
returns table (
  id uuid,
  action text,
  module text,
  user_id uuid,
  user_name text,
  description text,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select log.id, log.action, log.module, log.user_id, log.user_name, log.description, log.metadata, log.created_at
  from public.audit_logs log
  where log.module = 'factory'
    and (p_date_from is null or log.created_at::date >= p_date_from)
    and (p_date_to is null or log.created_at::date <= p_date_to)
    and (
      nullif(btrim(p_module_token), '') is null
      or (p_module_token = 'raw_material' and log.action ilike '%raw_material%' and log.action not ilike '%raw_material_receiving%')
      or (p_module_token = 'production' and log.action ilike '%production%' and log.action not ilike '%production_sop%' and log.action not ilike '%production_qc%')
      or (p_module_token not in ('raw_material', 'production') and log.action ilike '%' || btrim(p_module_token) || '%')
    )
    and (nullif(btrim(p_action_token), '') is null or log.action ilike '%' || btrim(p_action_token) || '%')
    and (
      nullif(btrim(p_user_name), '') is null
      or (p_user_name = 'System' and log.user_name is null)
      or log.user_name = p_user_name
    )
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ', log.action, log.description, log.user_name, log.metadata::text) ilike '%' || btrim(p_search) || '%'
    )
  order by log.created_at desc, log.id desc;
$$;

revoke all on function public.factory_list_raw_material_movements(date, date, uuid, text, text, text) from public;
revoke all on function public.factory_listing_summary(text, jsonb) from public;
revoke all on function public.factory_list_audit_logs(date, date, text, text, text, text) from public;
grant execute on function public.factory_list_raw_material_movements(date, date, uuid, text, text, text) to authenticated;
grant execute on function public.factory_listing_summary(text, jsonb) to authenticated;
grant execute on function public.factory_list_audit_logs(date, date, text, text, text, text) to authenticated;
