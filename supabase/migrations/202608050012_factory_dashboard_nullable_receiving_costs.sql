-- Factory Dashboard compatibility for nullable Raw Material Receiving costs.
-- Replaces the read-only analytics RPC so any NULL-cost Receiving row makes its
-- material/UOM cost aggregate incomplete while preserving quantity analytics.

create or replace function public.factory_get_dashboard_monthly_analytics(
  p_month date default ((now() at time zone 'Asia/Kuala_Lumpur')::date),
  p_finished_good_id uuid default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to view the Factory Dashboard.';
  end if;

  if not public.current_user_has_permission('factory_dashboard.view') then
    raise exception using errcode = '42501', message = 'Insufficient permission to view the Factory Dashboard.';
  end if;

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
      public.current_user_has_permission('factory_finished_goods_dispatch.view') as dispatch,
      public.current_user_has_permission('factory_raw_receiving.view') as receiving,
      public.current_user_has_permission('factory_production.view') as qc,
      public.current_user_has_permission('factory_raw_inventory.view') as raw_inventory,
      public.current_user_has_permission('factory_finished_goods.view')
        or public.current_user_has_permission('factory_batch_traceability.view') as finished_inventory,
      public.current_user_has_permission('factory_raw_stock_check.view') as raw_stock_checks,
      public.current_user_has_permission('factory_product_stock_check.view') as product_stock_checks
  ),
  production_scope as (
    select
      production.id,
      production.job_order_id,
      production.finished_good_id,
      coalesce(nullif(btrim(production.uom), ''), 'unit') as uom,
      coalesce(production.actual_output_qty, production.good_output_qty, production.actual_produced_qty, production.produced_quantity, 0) as output_qty,
      coalesce(production.end_date, production.production_date) as completed_date
    from public.factory_productions production
    cross join params
    cross join permissions
    where permissions.production
      and lower(coalesce(production.status, '')) = 'completed'
      and coalesce(production.end_date, production.production_date) >= params.month_start
      and coalesce(production.end_date, production.production_date) < params.month_end
      and (params.finished_good_id is null or production.finished_good_id = params.finished_good_id)
  ),
  production_output as (
    select uom, sum(output_qty) as quantity
    from production_scope
    group by uom
  ),
  due_jobs as (
    select
      job.id,
      job.finished_good_id,
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
      and job.planned_date >= params.month_start
      and job.planned_date < params.month_end
      and lower(coalesce(job.status, '')) in ('planned', 'released', 'in_progress', 'completed')
      and (params.finished_good_id is null or job.finished_good_id = params.finished_good_id)
  ),
  job_summary as (
    select
      count(*) as eligible_due_count,
      count(*) filter (
        where status = 'completed'
          and (authoritative_completed_at at time zone 'Asia/Kuala_Lumpur')::date >= (select month_start from params)
          and (authoritative_completed_at at time zone 'Asia/Kuala_Lumpur')::date < (select month_end from params)
      ) as completed_within_month_count,
      count(*) filter (
        where status = 'completed'
          and (authoritative_completed_at at time zone 'Asia/Kuala_Lumpur')::date >= (select month_end from params)
      ) as late_completed_count
    from due_jobs
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
  dispatch_scope as (
    select dispatch.id, item.finished_good_id, item.quantity, dispatch.dispatch_date, dispatch.customer_id, dispatch.customer_name
    from public.factory_finished_good_dispatches dispatch
    join public.factory_finished_good_dispatch_items item on item.dispatch_id = dispatch.id
    cross join params
    cross join permissions
    where permissions.dispatch
      and lower(coalesce(dispatch.status, '')) = 'completed'
      and dispatch.dispatch_date >= params.month_start
      and dispatch.dispatch_date < params.month_end
      and (params.finished_good_id is null or item.finished_good_id = params.finished_good_id)
  ),
  dispatch_summary as (
    select coalesce(sum(quantity), 0) as quantity, count(distinct id) as dispatch_count
    from dispatch_scope
  ),
  dispatch_products as (
    select
      scope.finished_good_id,
      sum(scope.quantity) as dispatch_qty,
      count(distinct scope.id) as dispatch_count,
      count(distinct coalesce(scope.customer_id::text, nullif(btrim(scope.customer_name), ''))) as customer_count
    from dispatch_scope scope
    group by scope.finished_good_id
  ),
  dispatch_total as (
    select coalesce(sum(dispatch_qty), 0) as quantity from dispatch_products
  ),
  receiving_scope as (
    select
      receiving.id,
      receiving.batch_id,
      receiving.receipt_no,
      receiving.raw_material_id,
      receiving.supplier_id,
      receiving.supplier_name,
      coalesce(nullif(btrim(receiving.uom), ''), 'unit') as uom,
      receiving.received_qty,
      receiving.unit_cost,
      receiving.total_cost
    from public.factory_raw_material_receivings receiving
    cross join params
    cross join permissions
    where permissions.receiving
      and receiving.received_date >= params.month_start
      and receiving.received_date < params.month_end
  ),
  receiving_quantities as (
    select uom, sum(received_qty) as quantity from receiving_scope group by uom
  ),
  receiving_summary as (
    select
      count(distinct coalesce(batch_id::text, nullif(btrim(receipt_no), ''), id::text)) as record_count,
      count(distinct raw_material_id) as material_count
    from receiving_scope
  ),
  receiving_materials as (
    select
      raw_material_id,
      uom,
      sum(received_qty) as received_qty,
      count(distinct coalesce(batch_id::text, nullif(btrim(receipt_no), ''), id::text)) as receiving_count,
      count(distinct coalesce(supplier_id::text, nullif(btrim(supplier_name), ''))) as supplier_count,
      bool_and(coalesce(unit_cost > 0 and total_cost > 0, false)) as cost_complete,
      case when bool_and(coalesce(unit_cost > 0 and total_cost > 0, false)) then sum(total_cost) / nullif(sum(received_qty), 0) end as average_unit_cost,
      case when bool_and(coalesce(unit_cost > 0 and total_cost > 0, false)) then sum(total_cost) end as total_cost
    from receiving_scope
    group by raw_material_id, uom
  ),
  qc_jobs as (
    select job.id, job.finished_good_id, job.qc_snapshot_created_at
    from public.factory_job_orders job
    cross join params
    cross join permissions
    where permissions.qc
      and job.production_date >= params.month_start
      and job.production_date < params.month_end
      and lower(coalesce(job.status, '')) in ('in_progress', 'completed')
      and (params.finished_good_id is null or job.finished_good_id = params.finished_good_id)
  ),
  qc_required as (
    select
      result.id,
      result.job_order_id,
      result.qc_name,
      result.qc_type,
      result.checklist_result,
      result.remarks,
      job.finished_good_id,
      case
        when result.qc_type = 'checklist' and result.checklist_result = 'fail' then 'failed'
        when result.qc_type = 'checklist' and result.checklist_result in ('pass', 'na') then 'passed'
        when result.qc_type = 'checklist' and result.checklist_result is null then 'pending'
        when result.qc_type = 'remarks' and nullif(btrim(coalesce(result.remarks, '')), '') is not null then 'passed'
        when result.qc_type = 'remarks' and nullif(btrim(coalesce(result.remarks, '')), '') is null then 'pending'
        else 'metadata_unavailable'
      end as result_status
    from public.factory_production_qc_results result
    join qc_jobs job on job.id = result.job_order_id
    where result.is_required
  ),
  qc_summary as (
    select
      count(*) filter (where result_status = 'passed') as passed,
      count(*) filter (where result_status = 'failed') as failed,
      count(*) filter (where result_status = 'pending') as pending,
      count(*) filter (where result_status = 'metadata_unavailable') as metadata_unavailable
    from qc_required
  ),
  qc_no_required as (
    select count(*) as job_count
    from qc_jobs job
    where job.qc_snapshot_created_at is not null
      and not exists (
      select 1 from public.factory_production_qc_results result
      where result.job_order_id = job.id and result.is_required
    )
  ),
  qc_metadata_unavailable_jobs as (
    select count(*) as job_count
    from qc_jobs job
    where job.qc_snapshot_created_at is null
  ),
  qc_failures as (
    select result.qc_name, result.finished_good_id, count(*) as failure_count
    from qc_required result
    where result.result_status = 'failed'
    group by result.qc_name, result.finished_good_id
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
    select balance.id, balance.finished_good_id, balance.batch_no, balance.expiry_date, balance.current_balance
    from public.factory_finished_good_batch_balances balance
    join active_finished_goods finished_good on finished_good.id = balance.finished_good_id
    cross join params
    where balance.current_balance > 0
      and balance.expiry_date >= params.business_date
      and balance.expiry_date <= params.business_date + 30
      and (params.finished_good_id is null or balance.finished_good_id = params.finished_good_id)
  ),
  batch_balances_by_sku as (
    select
      finished_good.id as finished_good_id,
      coalesce(finished_good.current_balance, 0) as aggregate_balance,
      coalesce(sum(balance.current_balance) filter (where balance.source_type = 'production'), 0) as production_batch_balance,
      coalesce(sum(balance.current_balance) filter (where balance.source_type = 'adjustment'), 0) as adjustment_batch_balance,
      coalesce(sum(balance.current_balance) filter (where balance.source_type = 'legacy_unallocated'), 0) as legacy_unallocated_balance,
      coalesce(sum(balance.current_balance), 0) as total_batch_balance
    from active_finished_goods finished_good
    left join public.factory_finished_good_batch_balances balance on balance.finished_good_id = finished_good.id
    group by finished_good.id, finished_good.current_balance
  ),
  reconciliation_diagnostics_by_sku as (
    select
      diagnostic.finished_good_id,
      count(*) filter (where diagnostic.diagnostic_status = 'ambiguous_match') as ambiguous_reference_count,
      count(*) filter (where diagnostic.diagnostic_status = 'no_match') as unmatched_reference_count,
      coalesce(sum(diagnostic.affected_quantity) filter (
        where diagnostic.diagnostic_status in ('ambiguous_match', 'no_match')), 0) as affected_diagnostic_quantity
    from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
    join active_finished_goods finished_good on finished_good.id = diagnostic.finished_good_id
    group by diagnostic.finished_good_id
  ),
  reconciliation_by_sku as (
    select
      balance.finished_good_id,
      balance.aggregate_balance,
      balance.production_batch_balance,
      balance.adjustment_batch_balance,
      balance.legacy_unallocated_balance,
      balance.total_batch_balance,
      balance.aggregate_balance - balance.total_batch_balance as variance,
      coalesce(diagnostic.ambiguous_reference_count, 0) as ambiguous_reference_count,
      coalesce(diagnostic.unmatched_reference_count, 0) as unmatched_reference_count,
      coalesce(diagnostic.affected_diagnostic_quantity, 0) as affected_diagnostic_quantity,
      case
        when abs(balance.aggregate_balance - balance.total_batch_balance) > 0.0001 then 'mismatch'
        when coalesce(diagnostic.ambiguous_reference_count, 0) > 0
          or coalesce(diagnostic.unmatched_reference_count, 0) > 0 then 'review_required'
        when balance.legacy_unallocated_balance > 0 then 'legacy_unallocated'
        else 'reconciled'
      end as reconciliation_status
    from batch_balances_by_sku balance
    left join reconciliation_diagnostics_by_sku diagnostic on diagnostic.finished_good_id = balance.finished_good_id
  ),
  reconciliation_rows as (
    select reconciliation.*
    from reconciliation_by_sku reconciliation
    where reconciliation.reconciliation_status in ('review_required', 'mismatch')
  ),
  raw_alerts as (
    select raw_material.id, raw_material.name, raw_material.material_code, raw_material.current_balance, raw_material.min_stock_level, raw_material.uom
    from public.factory_raw_materials raw_material
    cross join permissions
    where permissions.raw_inventory
      and lower(coalesce(raw_material.status, '')) = 'active'
      and raw_material.current_balance <= raw_material.min_stock_level
  ),
  raw_inventory_summary as (
    select
      count(*) filter (where current_balance > 0 and current_balance <= min_stock_level) as low_stock,
      count(*) filter (where current_balance <= 0) as out_of_stock
    from public.factory_raw_materials raw_material
    cross join permissions
    where permissions.raw_inventory
      and lower(coalesce(raw_material.status, '')) = 'active'
  ),
  production_products as (
    select
      scope.finished_good_id,
      scope.uom,
      sum(scope.output_qty) as output_qty,
      count(*) as batch_count,
      avg(scope.output_qty) as average_batch_qty
    from production_scope scope
    group by scope.finished_good_id, scope.uom
  ),
  trend_months as (
    select generate_series(
      (select month_start from params) - interval '5 months',
      (select month_start from params),
      interval '1 month'
    )::date as month_start
  ),
  trend_production as (
    select
      date_trunc('month', coalesce(production.end_date, production.production_date))::date as month_start,
      coalesce(nullif(btrim(production.uom), ''), 'unit') as uom,
      sum(coalesce(production.actual_output_qty, production.good_output_qty, production.actual_produced_qty, production.produced_quantity, 0)) as quantity
    from public.factory_productions production
    cross join params
    cross join permissions
    where permissions.production
      and lower(coalesce(production.status, '')) = 'completed'
      and coalesce(production.end_date, production.production_date) >= params.month_start - interval '5 months'
      and coalesce(production.end_date, production.production_date) < params.month_end
      and (params.finished_good_id is null or production.finished_good_id = params.finished_good_id)
    group by 1, 2
  ),
  trend_dispatch as (
    select date_trunc('month', dispatch.dispatch_date)::date as month_start, sum(item.quantity) as quantity
    from public.factory_finished_good_dispatches dispatch
    join public.factory_finished_good_dispatch_items item on item.dispatch_id = dispatch.id
    cross join params
    cross join permissions
    where permissions.dispatch
      and lower(coalesce(dispatch.status, '')) = 'completed'
      and dispatch.dispatch_date >= params.month_start - interval '5 months'
      and dispatch.dispatch_date < params.month_end
      and (params.finished_good_id is null or item.finished_good_id = params.finished_good_id)
    group by 1
  ),
  action_rows as (
    select 1 as severity_rank, 'Critical' as severity, 'QC failed' as alert,
      coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good') as item,
      failure.qc_name || ' failed ' || failure.failure_count || ' required check(s).' as details,
      'Review the Production QC result and resolve the failed check.' as recommended_action,
      '/factory/production-overview' as link
    from qc_failures failure
    left join public.factory_finished_goods finished_good on finished_good.id = failure.finished_good_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    union all
    select 1, 'Critical', 'Out of stock', coalesce(raw.name, raw.material_code, 'Raw Material'),
      'Current balance is ' || raw.current_balance || coalesce(' ' || nullif(btrim(raw.uom), ''), '') || '.',
      'Review replenishment or receiving requirements.', '/factory/raw-inventory'
    from raw_alerts raw where raw.current_balance <= 0
    union all
    select 2, 'Warning', 'Low raw material stock', coalesce(raw.name, raw.material_code, 'Raw Material'),
      'Current balance ' || raw.current_balance || '; minimum ' || raw.min_stock_level || coalesce(' ' || nullif(btrim(raw.uom), ''), '') || '.',
      'Plan replenishment before the next Production run.', '/factory/raw-inventory'
    from raw_alerts raw where raw.current_balance > 0
    union all
    select 2, 'Warning', 'Finished Goods expiring soon', coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'),
      batch.batch_no || ' expires on ' || batch.expiry_date || ' with ' || batch.current_balance || ' pack(s).',
      'Prioritize FEFO Dispatch or review disposition.', '/factory/batch-traceability'
    from expiring_batches batch
    left join public.factory_finished_goods finished_good on finished_good.id = batch.finished_good_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    union all
    select 2, 'Warning', 'Inventory reconciliation required',
      coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'),
      case
        when issue.reconciliation_status = 'mismatch' then
          'Aggregate-to-batch variance is ' || issue.variance || ' pack(s).'
        else
          'Unresolved references: ' || (issue.ambiguous_reference_count + issue.unmatched_reference_count)
            || '; affected quantity: ' || issue.affected_diagnostic_quantity || ' pack(s).'
      end,
      'Open Batch Traceability and resolve the reconciliation issue.', '/factory/batch-traceability'
    from reconciliation_rows issue
    left join public.factory_finished_goods finished_good on finished_good.id = issue.finished_good_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    union all
    select 2, 'Warning', 'Scheduled Job Order overdue', job.job_order_no,
      coalesce(family.name_en, finished_good.product_name_en, job.product_name) || ' was scheduled for ' || job.planned_date || '.',
      'Release the Job Order or revise its schedule.', '/factory/production-overview'
    from public.factory_job_orders job
    cross join params
    cross join permissions
    left join public.factory_finished_goods finished_good on finished_good.id = job.finished_good_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    where permissions.job_orders and lower(coalesce(job.status, '')) = 'planned' and job.planned_date < params.business_date
      and (params.finished_good_id is null or job.finished_good_id = params.finished_good_id)
    union all
    select 3, 'Info', 'Released Job Order ready to start', job.job_order_no,
      coalesce(family.name_en, finished_good.product_name_en, job.product_name) || ' is ready for Production.',
      'Open Production Overview and start when the line is ready.', '/factory/production-overview'
    from public.factory_job_orders job
    cross join params
    cross join permissions
    left join public.factory_finished_goods finished_good on finished_good.id = job.finished_good_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    where permissions.job_orders and lower(coalesce(job.status, '')) = 'released'
      and (params.finished_good_id is null or job.finished_good_id = params.finished_good_id)
    union all
    select 3, 'Info', 'Stock Check awaiting approval', check_row.check_no,
      check_row.stock_type || ' Stock Check submitted on ' || check_row.check_date || '.',
      'Review and approve the submitted Stock Check.', check_row.link
    from (
      select check_item.check_no, check_item.check_date, 'Raw Material' as stock_type, '/factory/raw-stock-check' as link
      from public.factory_raw_material_stock_checks check_item cross join permissions
      where permissions.raw_stock_checks and lower(coalesce(check_item.status, '')) = 'submitted'
      union all
      select check_item.check_no, check_item.check_date, 'Finished Goods', '/factory/product-stock-check'
      from public.factory_product_stock_checks check_item cross join permissions
      where permissions.product_stock_checks and lower(coalesce(check_item.status, '')) = 'submitted'
    ) check_row
  ),
  action_limited as (
    select * from action_rows
    order by severity_rank, alert, item, details, link
    limit 50
  )
  select jsonb_build_object(
    'filters', jsonb_build_object(
      'month_start', params.month_start,
      'month_end', params.month_end - 1,
      'business_date', params.business_date,
      'finished_good_id', params.finished_good_id,
      'permissions', to_jsonb(permissions)
    ),
    'kpis', jsonb_build_object(
      'production_output', jsonb_build_object(
        'by_uom', coalesce((select jsonb_agg(jsonb_build_object('uom', uom, 'quantity', quantity) order by uom) from production_output), '[]'::jsonb),
        'batch_count', (select count(*) from production_scope)
      ),
      'dispatch_volume', jsonb_build_object('pack_qty', (select quantity from dispatch_summary), 'dispatch_count', (select dispatch_count from dispatch_summary)),
      'completion_rate', jsonb_build_object(
        'completed_within_month_count', (select completed_within_month_count from job_summary),
        'eligible_due_count', (select eligible_due_count from job_summary),
        'late_completed_count', (select late_completed_count from job_summary),
        'rate', coalesce((select completed_within_month_count * 100.0 / nullif(eligible_due_count, 0) from job_summary), 0)
      ),
      'qc_pass_rate', jsonb_build_object(
        'passed', (select passed from qc_summary),
        'failed', (select failed from qc_summary),
        'pending', (select pending from qc_summary),
        'metadata_unavailable', (select metadata_unavailable from qc_summary),
        'completed_required', (select passed + failed from qc_summary),
        'no_qc_required', (select job_count from qc_no_required),
        'metadata_unavailable_jobs', (select job_count from qc_metadata_unavailable_jobs),
        'rate', coalesce((select passed * 100.0 / nullif(passed + failed, 0) from qc_summary), 0)
      ),
      'raw_receiving', jsonb_build_object(
        'record_count', (select record_count from receiving_summary),
        'material_count', (select material_count from receiving_summary),
        'by_uom', coalesce((select jsonb_agg(jsonb_build_object('uom', uom, 'quantity', quantity) order by uom) from receiving_quantities), '[]'::jsonb)
      ),
      'inventory_alerts', jsonb_build_object(
        'healthy', (select healthy from inventory_summary),
        'low_stock', (select low_stock from inventory_summary) + (select low_stock from raw_inventory_summary),
        'out_of_stock', (select out_of_stock from inventory_summary) + (select out_of_stock from raw_inventory_summary),
        'expiring_soon', (select count(*) from expiring_batches),
        'reconciliation_required', (select count(*) from reconciliation_rows)
      )
    ),
    'production_summary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'finished_good_id', product.finished_good_id,
        'product', coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'),
        'packaging_sku', coalesce(finished_good.product_code, finished_good.variant_name, 'Packaging SKU'),
        'uom', product.uom,
        'output_qty', product.output_qty,
        'batch_count', product.batch_count,
        'average_batch_qty', product.average_batch_qty,
        'eligible_due_count', coalesce(job.eligible_due_count, 0),
        'completed_within_month_count', coalesce(job.completed_within_month_count, 0),
        'completion_rate', coalesce(job.completed_within_month_count * 100.0 / nullif(job.eligible_due_count, 0), 0)
      ) order by product.output_qty desc, product.finished_good_id, product.uom)
      from production_products product
      left join public.factory_finished_goods finished_good on finished_good.id = product.finished_good_id
      left join public.factory_product_families family on family.id = finished_good.product_family_id
      left join jobs_by_product job on job.finished_good_id = product.finished_good_id
    ), '[]'::jsonb),
    'top_dispatch_products', coalesce((
      select jsonb_agg(to_jsonb(ranked) order by ranked.rank)
      from (
        select row_number() over (order by product.dispatch_qty desc, product.finished_good_id) as rank,
          product.finished_good_id,
          coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good') as product,
          coalesce(finished_good.product_code, finished_good.variant_name, 'Packaging SKU') as packaging_sku,
          product.dispatch_qty, product.dispatch_count, product.customer_count,
          coalesce(product.dispatch_qty * 100.0 / nullif(total.quantity, 0), 0) as share_percent
        from dispatch_products product
        cross join dispatch_total total
        left join public.factory_finished_goods finished_good on finished_good.id = product.finished_good_id
        left join public.factory_product_families family on family.id = finished_good.product_family_id
        order by product.dispatch_qty desc, product.finished_good_id
        limit 10
      ) ranked
    ), '[]'::jsonb),
    'top_raw_materials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'raw_material_id', material.raw_material_id,
        'raw_material', coalesce(raw.name_en, raw.name, raw.material_code, 'Raw Material'),
        'uom', material.uom,
        'received_qty', material.received_qty,
        'receiving_count', material.receiving_count,
        'supplier_count', material.supplier_count,
        'cost_complete', material.cost_complete,
        'average_unit_cost', material.average_unit_cost,
        'total_cost', material.total_cost
      ) order by material.received_qty desc, material.raw_material_id, material.uom)
      from receiving_materials material
      left join public.factory_raw_materials raw on raw.id = material.raw_material_id
    ), '[]'::jsonb),
    'production_dispatch_trend', jsonb_build_object(
      'months', (select jsonb_agg(month_start order by month_start) from trend_months),
      'production', coalesce((select jsonb_agg(to_jsonb(row_data) order by month_start, uom) from trend_production row_data), '[]'::jsonb),
      'dispatch', coalesce((select jsonb_agg(to_jsonb(row_data) order by month_start) from trend_dispatch row_data), '[]'::jsonb)
    ),
    'qc_performance', jsonb_build_object(
      'passed', (select passed from qc_summary),
      'failed', (select failed from qc_summary),
      'pending', (select pending from qc_summary),
      'metadata_unavailable', (select metadata_unavailable from qc_summary),
      'no_qc_required', (select job_count from qc_no_required),
      'metadata_unavailable_jobs', (select job_count from qc_metadata_unavailable_jobs),
      'top_failures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'qc_name', failure.qc_name,
          'product', coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'),
          'count', failure.failure_count
        ) order by failure.failure_count desc, failure.qc_name)
        from qc_failures failure
        left join public.factory_finished_goods finished_good on finished_good.id = failure.finished_good_id
        left join public.factory_product_families family on family.id = finished_good.product_family_id
      ), '[]'::jsonb)
    ),
    'inventory_health', jsonb_build_object(
      'healthy', (select healthy from inventory_summary),
      'low_stock', (select low_stock from inventory_summary),
      'out_of_stock', (select out_of_stock from inventory_summary),
      'expiring_30_days', (select count(*) from expiring_batches),
      'reconciliation_required', (select count(*) from reconciliation_rows)
    ),
    'action_required', coalesce((select jsonb_agg(to_jsonb(action_limited) order by severity_rank, alert, item, details, link) from action_limited), '[]'::jsonb)
  )
  into v_result
  from params
  cross join permissions;

  return v_result;
end;
$$;

revoke all on function public.factory_get_dashboard_monthly_analytics(date, uuid) from public, anon;
grant execute on function public.factory_get_dashboard_monthly_analytics(date, uuid) to authenticated;

comment on function public.factory_get_dashboard_monthly_analytics(date, uuid) is
  'Returns one Malaysia-month Factory management analytics snapshot with permission-scoped aggregate sections and UOM-separated quantities.';

