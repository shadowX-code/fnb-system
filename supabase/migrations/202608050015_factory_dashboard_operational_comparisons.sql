-- Add canonical-UOM operational comparisons and correct the Receiving and
-- inventory sections inherited from the applied monthly Dashboard snapshot.

create or replace function public.factory_get_dashboard_monthly_analytics(
  p_month date,
  p_finished_good_id uuid,
  p_include_operational_comparisons boolean
)
returns jsonb
language sql
security invoker
stable
set search_path = public
as $$
  with
  params as (
    select
      date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kuala_Lumpur')::date))::date as month_start,
      (date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kuala_Lumpur')::date)) + interval '1 month')::date as month_end,
      (now() at time zone 'Asia/Kuala_Lumpur')::date as business_date,
      p_finished_good_id as finished_good_id
  ),
  permissions as (
    select
      public.current_user_has_permission('factory_production.view')
        or public.current_user_has_permission('factory_production_reports.view') as production,
      public.current_user_has_permission('factory_job_orders.view') as job_orders,
      public.current_user_has_permission('factory_raw_receiving.view') as receiving,
      public.current_user_has_permission('factory_finished_goods.view')
        or public.current_user_has_permission('factory_batch_traceability.view') as finished_inventory
  ),
  base as materialized (
    select public.factory_get_dashboard_monthly_analytics(p_month, p_finished_good_id) as snapshot
  ),
  production_scope as (
    select
      production.id,
      production.job_order_id,
      production.finished_good_id,
      lower(coalesce(nullif(btrim(production.uom), ''), 'unit')) as uom_key,
      lower(coalesce(nullif(btrim(production.uom), ''), 'unit')) as uom,
      coalesce(
        production.actual_output_qty,
        production.good_output_qty,
        production.actual_produced_qty,
        production.produced_quantity,
        0
      ) as output_qty,
      (coalesce(
        production.completed_at,
        production.end_date::timestamptz,
        production.production_date::timestamptz
      ) at time zone 'Asia/Kuala_Lumpur')::date as completed_date
    from public.factory_productions production
    cross join params
    cross join permissions
    where permissions.production
      and lower(coalesce(production.status, '')) = 'completed'
      and (coalesce(
        production.completed_at,
        production.end_date::timestamptz,
        production.production_date::timestamptz
      ) at time zone 'Asia/Kuala_Lumpur')::date >= params.month_start
      and (coalesce(
        production.completed_at,
        production.end_date::timestamptz,
        production.production_date::timestamptz
      ) at time zone 'Asia/Kuala_Lumpur')::date < params.month_end
      and (params.finished_good_id is null or production.finished_good_id = params.finished_good_id)
  ),
  production_output as (
    select uom_key, min(uom) as uom, sum(output_qty) as quantity
    from production_scope
    group by uom_key
  ),
  production_products as (
    select
      finished_good_id,
      uom_key,
      min(uom) as uom,
      sum(output_qty) as output_qty,
      count(*) as batch_count,
      avg(output_qty) as average_batch_qty
    from production_scope
    group by finished_good_id, uom_key
  ),
  due_jobs as (
    select
      job.id,
      job.finished_good_id,
      lower(coalesce(nullif(btrim(job.uom), ''), 'unit')) as uom_key,
      lower(coalesce(nullif(btrim(job.uom), ''), 'unit')) as uom,
      coalesce(job.target_production_qty, job.target_quantity, 0) as planned_qty,
      lower(coalesce(job.status, '')) as status,
      coalesce(job.completed_at, completed_production.completed_at) as authoritative_completed_at
    from public.factory_job_orders job
    cross join params
    cross join permissions
    left join lateral (
      select max(production.completed_at) as completed_at
      from public.factory_productions production
      where production.job_order_id = job.id
        and lower(coalesce(production.status, '')) = 'completed'
    ) completed_production on true
    where permissions.job_orders
      and lower(coalesce(job.status, '')) in ('planned', 'released', 'in_progress', 'completed')
      and job.planned_date >= params.month_start
      and job.planned_date < params.month_end
      and (params.finished_good_id is null or job.finished_good_id = params.finished_good_id)
  ),
  jobs_by_product as (
    select
      finished_good_id,
      count(*) as eligible_due_count,
      count(*) filter (
        where status = 'completed'
          and (authoritative_completed_at at time zone 'Asia/Kuala_Lumpur')::date >= (select month_start from params)
          and (authoritative_completed_at at time zone 'Asia/Kuala_Lumpur')::date < (select month_end from params)
      ) as completed_within_month_count
    from due_jobs
    group by finished_good_id
  ),
  completed_job_output as (
    select
      production.job_order_id,
      production.finished_good_id,
      production.uom_key,
      min(production.uom) as uom,
      sum(production.output_qty) as actual_qty
    from production_scope production
    where production.job_order_id is not null
      and production.finished_good_id is not null
    group by production.job_order_id, production.finished_good_id, production.uom_key
  ),
  planned_actual_by_product as (
    select
      job.finished_good_id,
      job.uom_key,
      min(job.uom) as uom,
      sum(job.planned_qty) as planned_qty,
      sum(coalesce(output.actual_qty, 0)) as actual_qty
    from due_jobs job
    left join completed_job_output output
      on output.job_order_id = job.id
     and output.finished_good_id = job.finished_good_id
     and output.uom_key = job.uom_key
    group by job.finished_good_id, job.uom_key
  ),
  completed_receiving_scope as (
    select
      receiving.id,
      receiving.batch_id,
      receiving.raw_material_id,
      receiving.supplier_id,
      receiving.supplier_name,
      lower(coalesce(nullif(btrim(receiving.uom), ''), nullif(btrim(raw_material.uom), ''), 'unit')) as uom_key,
      lower(coalesce(nullif(btrim(receiving.uom), ''), nullif(btrim(raw_material.uom), ''), 'unit')) as uom,
      receiving.received_qty
    from public.factory_raw_material_receivings receiving
    join public.factory_raw_material_receiving_batches header
      on header.id = receiving.batch_id
     and lower(coalesce(header.status, '')) = 'completed'
    left join public.factory_raw_materials raw_material on raw_material.id = receiving.raw_material_id
    cross join params
    cross join permissions
    where permissions.receiving
      and header.received_date >= params.month_start
      and header.received_date < params.month_end
  ),
  receiving_quantities as (
    select uom_key, min(uom) as uom, sum(received_qty) as quantity
    from completed_receiving_scope
    group by uom_key
  ),
  receiving_summary as (
    select count(distinct batch_id) as record_count, count(distinct raw_material_id) as material_count
    from completed_receiving_scope
  ),
  receiving_materials as (
    select
      raw_material_id,
      uom_key,
      min(uom) as uom,
      sum(received_qty) as received_qty,
      count(distinct batch_id) as receiving_count,
      count(distinct coalesce(supplier_id::text, nullif(btrim(supplier_name), ''))) as supplier_count
    from completed_receiving_scope
    group by raw_material_id, uom_key
  ),
  usage_by_uom as (
    select
      lower(coalesce(nullif(btrim(movement.uom), ''), nullif(btrim(raw_material.uom), ''), 'unit')) as uom_key,
      lower(coalesce(nullif(btrim(movement.uom), ''), nullif(btrim(raw_material.uom), ''), 'unit')) as uom,
      sum(abs(movement.quantity)) as usage_qty
    from public.factory_raw_material_movements movement
    left join public.factory_raw_materials raw_material on raw_material.id = movement.raw_material_id
    cross join params
    cross join permissions
    where permissions.production
      and permissions.receiving
      and lower(btrim(coalesce(movement.movement_type, ''))) = 'production usage'
      and movement.movement_date >= params.month_start
      and movement.movement_date < params.month_end
    group by lower(coalesce(nullif(btrim(movement.uom), ''), nullif(btrim(raw_material.uom), ''), 'unit'))
  ),
  raw_flow as (
    select
      coalesce(receiving.uom_key, usage.uom_key) as uom_key,
      coalesce(receiving.uom, usage.uom, 'unit') as uom,
      coalesce(receiving.quantity, 0) as received_qty,
      coalesce(usage.usage_qty, 0) as production_usage_qty,
      coalesce(receiving.quantity, 0) - coalesce(usage.usage_qty, 0) as net_movement
    from receiving_quantities receiving
    full outer join usage_by_uom usage on usage.uom_key = receiving.uom_key
  ),
  trend_production as (
    select
      date_trunc('month', production.completed_date)::date as month_start,
      production.uom_key,
      min(production.uom) as uom,
      sum(production.output_qty) as quantity
    from (
      select
        (coalesce(item.completed_at, item.end_date::timestamptz, item.production_date::timestamptz)
          at time zone 'Asia/Kuala_Lumpur')::date as completed_date,
        lower(coalesce(nullif(btrim(item.uom), ''), 'unit')) as uom_key,
        lower(coalesce(nullif(btrim(item.uom), ''), 'unit')) as uom,
        coalesce(item.actual_output_qty, item.good_output_qty, item.actual_produced_qty, item.produced_quantity, 0) as output_qty
      from public.factory_productions item
      cross join params
      cross join permissions
      where permissions.production
        and lower(coalesce(item.status, '')) = 'completed'
        and (coalesce(item.completed_at, item.end_date::timestamptz, item.production_date::timestamptz)
          at time zone 'Asia/Kuala_Lumpur')::date >= params.month_start - interval '5 months'
        and (coalesce(item.completed_at, item.end_date::timestamptz, item.production_date::timestamptz)
          at time zone 'Asia/Kuala_Lumpur')::date < params.month_end
        and (params.finished_good_id is null or item.finished_good_id = params.finished_good_id)
    ) production
    group by date_trunc('month', production.completed_date)::date, production.uom_key
  ),
  active_finished_goods as (
    select finished_good.*
    from public.factory_finished_goods finished_good
    cross join params
    cross join permissions
    where permissions.finished_inventory
      and lower(coalesce(finished_good.status, '')) = 'active'
      and (params.finished_good_id is null or finished_good.id = params.finished_good_id)
  ),
  inventory_summary as (
    select
      count(*) filter (where current_balance > min_stock_level) as healthy,
      count(*) filter (where current_balance > 0 and current_balance <= min_stock_level) as low_stock,
      count(*) filter (where current_balance <= 0) as out_of_stock
    from active_finished_goods
  ),
  expiring_batches as (
    select balance.*
    from public.factory_finished_good_batch_balances balance
    join active_finished_goods finished_good on finished_good.id = balance.finished_good_id
    cross join params
    where balance.current_balance > 0
      and balance.expiry_date >= params.business_date
      and balance.expiry_date <= params.business_date + 30
  ),
  batch_balances_by_sku as (
    select
      finished_good.id as finished_good_id,
      coalesce(finished_good.current_balance, 0) as aggregate_balance,
      coalesce(sum(balance.current_balance), 0) as total_batch_balance
    from active_finished_goods finished_good
    left join public.factory_finished_good_batch_balances balance on balance.finished_good_id = finished_good.id
    group by finished_good.id, finished_good.current_balance
  ),
  diagnostics_by_sku as (
    select
      diagnostic.finished_good_id,
      count(*) filter (where diagnostic.diagnostic_status in ('ambiguous_match', 'no_match')) as unresolved_count
    from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
    join active_finished_goods finished_good on finished_good.id = diagnostic.finished_good_id
    group by diagnostic.finished_good_id
  ),
  reconciliation_rows as (
    select
      balance.finished_good_id,
      balance.aggregate_balance - balance.total_batch_balance as variance,
      coalesce(diagnostic.unresolved_count, 0) as unresolved_count
    from batch_balances_by_sku balance
    left join diagnostics_by_sku diagnostic on diagnostic.finished_good_id = balance.finished_good_id
    where abs(balance.aggregate_balance - balance.total_batch_balance) > 0.0001
       or coalesce(diagnostic.unresolved_count, 0) > 0
  ),
  inherited_actions as (
    select
      coalesce((action.value ->> 'severity_rank')::integer, 3) as severity_rank,
      action.value ->> 'severity' as severity,
      action.value ->> 'alert' as alert,
      action.value ->> 'item' as item,
      action.value ->> 'details' as details,
      action.value ->> 'recommended_action' as recommended_action,
      action.value ->> 'link' as link,
      null::text as action_type,
      null::text as inventory_status,
      null::text as entity_type,
      null::uuid as entity_id,
      null::text as route,
      null::uuid as detail_id,
      '{}'::jsonb as route_state
    from base
    cross join lateral jsonb_array_elements(coalesce(base.snapshot -> 'action_required', '[]'::jsonb)) action(value)
    where action.value ->> 'alert' not in ('Finished Goods expiring soon', 'Inventory reconciliation required')
  ),
  finished_inventory_actions as (
    select
      case when finished_good.current_balance <= 0 then 1 else 2 end as severity_rank,
      case when finished_good.current_balance <= 0 then 'Critical' else 'Warning' end as severity,
      case when finished_good.current_balance <= 0 then 'Finished Goods out of stock' else 'Finished Goods low stock' end as alert,
      coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, finished_good.product_code, 'Finished Good') as item,
      'Current balance ' || finished_good.current_balance || '; minimum ' || finished_good.min_stock_level || ' pack(s).' as details,
      'Review Production Planning.' as recommended_action,
      '/factory/finished-goods' as link,
      'inventory' as action_type,
      case when finished_good.current_balance <= 0 then 'out_of_stock' else 'low_stock' end as inventory_status,
      'finished_good' as entity_type,
      finished_good.id as entity_id,
      '/factory/finished-goods' as route,
      finished_good.id as detail_id,
      jsonb_build_object('finished_good_id', finished_good.id) as route_state
    from active_finished_goods finished_good
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    where finished_good.current_balance <= finished_good.min_stock_level
    union all
    select
      2,
      'Warning',
      'Finished Goods expiring soon',
      coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, finished_good.product_code, 'Finished Good'),
      batch.batch_no || ' expires on ' || batch.expiry_date || ' with ' || batch.current_balance || ' pack(s).',
      'Prioritize FEFO Dispatch.',
      '/factory/batch-traceability',
      'inventory',
      'expiring',
      'finished_good_batch',
      batch.id,
      '/factory/batch-traceability',
      batch.id,
      jsonb_build_object('batch_balance_id', batch.id, 'finished_good_id', batch.finished_good_id)
    from expiring_batches batch
    join active_finished_goods finished_good on finished_good.id = batch.finished_good_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    union all
    select
      2,
      'Warning',
      'Inventory reconciliation required',
      coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, finished_good.product_code, 'Finished Good'),
      case when abs(issue.variance) > 0.0001
        then 'Aggregate-to-batch variance is ' || issue.variance || ' pack(s).'
        else issue.unresolved_count || ' unresolved batch reference(s).'
      end,
      'Review Batch Traceability.',
      '/factory/batch-traceability',
      'inventory',
      'reconciliation',
      'finished_good',
      issue.finished_good_id,
      '/factory/batch-traceability',
      issue.finished_good_id,
      jsonb_build_object('finished_good_id', issue.finished_good_id)
    from reconciliation_rows issue
    join active_finished_goods finished_good on finished_good.id = issue.finished_good_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
  ),
  all_actions as (
    select * from inherited_actions
    union all
    select * from finished_inventory_actions
  )
  select base.snapshot || case when coalesce(p_include_operational_comparisons, false) then jsonb_build_object(
    'kpis', (base.snapshot -> 'kpis') || jsonb_build_object(
      'production_output', jsonb_build_object(
        'by_uom', coalesce((select jsonb_agg(jsonb_build_object('uom', uom, 'uom_key', uom_key, 'quantity', quantity) order by uom_key) from production_output), '[]'::jsonb),
        'batch_count', (select count(*) from production_scope)
      ),
      'raw_receiving', jsonb_build_object(
        'record_count', (select record_count from receiving_summary),
        'material_count', (select material_count from receiving_summary),
        'by_uom', coalesce((select jsonb_agg(jsonb_build_object('uom', uom, 'uom_key', uom_key, 'quantity', quantity) order by uom_key) from receiving_quantities), '[]'::jsonb)
      )
    ),
    'production_summary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'finished_good_id', product.finished_good_id,
        'product', coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'),
        'packaging_sku', coalesce(finished_good.product_code, finished_good.variant_name, 'Packaging SKU'),
        'uom', product.uom,
        'uom_key', product.uom_key,
        'output_qty', product.output_qty,
        'batch_count', product.batch_count,
        'average_batch_qty', product.average_batch_qty,
        'eligible_due_count', coalesce(job.eligible_due_count, 0),
        'completed_within_month_count', coalesce(job.completed_within_month_count, 0),
        'completion_rate', coalesce(job.completed_within_month_count * 100.0 / nullif(job.eligible_due_count, 0), 0)
      ) order by product.output_qty desc, product.finished_good_id, product.uom_key)
      from production_products product
      left join public.factory_finished_goods finished_good on finished_good.id = product.finished_good_id
      left join public.factory_product_families family on family.id = finished_good.product_family_id
      left join jobs_by_product job on job.finished_good_id = product.finished_good_id
    ), '[]'::jsonb),
    'top_raw_materials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'raw_material_id', material.raw_material_id,
        'raw_material', coalesce(raw.name_en, raw.name, raw.material_code, 'Raw Material'),
        'uom', material.uom,
        'uom_key', material.uom_key,
        'received_qty', material.received_qty,
        'receiving_count', material.receiving_count,
        'supplier_count', material.supplier_count
      ) order by material.received_qty desc, material.raw_material_id, material.uom_key)
      from receiving_materials material
      left join public.factory_raw_materials raw on raw.id = material.raw_material_id
    ), '[]'::jsonb),
    'planned_vs_actual', coalesce((
      select jsonb_agg(jsonb_build_object(
        'finished_good_id', comparison.finished_good_id,
        'product', coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'),
        'packaging_sku', coalesce(finished_good.product_code, finished_good.variant_name, 'Packaging SKU'),
        'uom', comparison.uom,
        'uom_key', comparison.uom_key,
        'planned_qty', comparison.planned_qty,
        'actual_qty', comparison.actual_qty,
        'variance', comparison.actual_qty - comparison.planned_qty,
        'completion_percent', coalesce(comparison.actual_qty * 100.0 / nullif(comparison.planned_qty, 0), 0)
      ) order by comparison.planned_qty desc, comparison.finished_good_id, comparison.uom_key)
      from planned_actual_by_product comparison
      left join public.factory_finished_goods finished_good on finished_good.id = comparison.finished_good_id
      left join public.factory_product_families family on family.id = finished_good.product_family_id
    ), '[]'::jsonb),
    'raw_material_flow', coalesce((
      select jsonb_agg(to_jsonb(flow) order by flow.uom_key)
      from raw_flow flow
    ), '[]'::jsonb),
    'production_dispatch_trend', jsonb_build_object(
      'months', base.snapshot #> '{production_dispatch_trend,months}',
      'production', coalesce((select jsonb_agg(to_jsonb(trend) order by trend.month_start, trend.uom_key) from trend_production trend), '[]'::jsonb),
      'dispatch', base.snapshot #> '{production_dispatch_trend,dispatch}'
    ),
    'inventory_health', jsonb_build_object(
      'healthy', (select healthy from inventory_summary),
      'low_stock', (select low_stock from inventory_summary),
      'out_of_stock', (select out_of_stock from inventory_summary),
      'expiring_30_days', (select count(*) from expiring_batches),
      'reconciliation_required', (select count(*) from reconciliation_rows)
    ),
    'action_required', coalesce((
      select jsonb_agg(to_jsonb(action) order by action.severity_rank, action.alert, action.item, action.entity_id)
      from all_actions action
    ), '[]'::jsonb)
  ) else '{}'::jsonb end
  from base;
$$;

revoke all on function public.factory_get_dashboard_monthly_analytics(date, uuid, boolean) from public, anon;
grant execute on function public.factory_get_dashboard_monthly_analytics(date, uuid, boolean) to authenticated;

comment on function public.factory_get_dashboard_monthly_analytics(date, uuid, boolean) is
  'Returns a Malaysia-month Factory Dashboard snapshot with completed Receiving only, posted Production Usage, canonical UOM populations, exact-SKU Production comparisons and typed inventory targets.';
