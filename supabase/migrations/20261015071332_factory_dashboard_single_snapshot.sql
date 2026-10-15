-- The wrapper reads the base payload four times; compute the RLS-preserving snapshot once.
CREATE OR REPLACE FUNCTION public.factory_get_dashboard_operational_monthly_analytics(p_month date, p_finished_good_id uuid DEFAULT NULL::uuid, p_include_operational_comparisons boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with params as (
    select date_trunc('month', p_month)::date as month_start,
      (date_trunc('month', p_month) + interval '1 month')::date as month_end
  ), base as materialized (
    select public.factory_get_dashboard_monthly_analytics(p_month, p_finished_good_id, p_include_operational_comparisons) as payload
  ), production_scope as (
    select p.*, public.factory_production_operational_completion_at(p.end_date, p.end_time) as operational_completion_at,
      coalesce(p.actual_output_qty, p.good_output_qty, p.actual_produced_qty, p.produced_quantity, 0) as output_qty,
      lower(coalesce(nullif(btrim(p.uom), ''), 'unit')) as uom_key
    from public.factory_productions p cross join params
    where lower(coalesce(p.status, '')) = 'completed'
      and (public.factory_production_operational_completion_at(p.end_date, p.end_time) at time zone 'Asia/Kuala_Lumpur')::date >= params.month_start
      and (public.factory_production_operational_completion_at(p.end_date, p.end_time) at time zone 'Asia/Kuala_Lumpur')::date < params.month_end
      and (p_finished_good_id is null or p.finished_good_id = p_finished_good_id)
  ), output_by_uom as (
    select uom_key, min(uom) as uom, sum(output_qty) as quantity from production_scope group by uom_key
  ), production_summary as (
    select finished_good_id, uom_key, min(uom) as uom, sum(output_qty) as output_qty, count(*) as batch_count, avg(output_qty) as average_batch_qty
    from production_scope group by finished_good_id, uom_key
  ), due_jobs as (
    select job.id, job.finished_good_id, job.uom, job.target_production_qty, job.target_quantity, lower(coalesce(job.status, '')) as status,
      coalesce(production.operational_completion_at, null) as operational_completion_at
    from public.factory_job_orders job cross join params
    left join lateral (
      select public.factory_production_operational_completion_at(p.end_date, p.end_time) as operational_completion_at
      from public.factory_productions p
      where p.job_order_id = job.id and lower(coalesce(p.status, '')) = 'completed'
      order by public.factory_production_operational_completion_at(p.end_date, p.end_time) desc nulls last limit 1
    ) production on true
    where job.planned_date >= params.month_start and job.planned_date < params.month_end
      and lower(coalesce(job.status, '')) in ('planned', 'released', 'in_progress', 'completed')
      and (p_finished_good_id is null or job.finished_good_id = p_finished_good_id)
  ), completion_rate as (
    select count(*) as eligible_due_count,
      count(*) filter (where status = 'completed' and (operational_completion_at at time zone 'Asia/Kuala_Lumpur')::date >= (select month_start from params) and (operational_completion_at at time zone 'Asia/Kuala_Lumpur')::date < (select month_end from params)) as completed_within_month_count,
      count(*) filter (where status = 'completed' and (operational_completion_at at time zone 'Asia/Kuala_Lumpur')::date >= (select month_end from params)) as late_completed_count
    from due_jobs
  ), jobs_by_product as (
    select finished_good_id, count(*) as eligible_due_count,
      count(*) filter (where status = 'completed' and (operational_completion_at at time zone 'Asia/Kuala_Lumpur')::date >= (select month_start from params) and (operational_completion_at at time zone 'Asia/Kuala_Lumpur')::date < (select month_end from params)) as completed_within_month_count
    from due_jobs group by finished_good_id
  ), planned_actual as (
    select job.finished_good_id, lower(coalesce(nullif(btrim(job.uom), ''), 'unit')) as uom_key, min(coalesce(nullif(btrim(job.uom), ''), 'unit')) as uom,
      sum(coalesce(job.target_production_qty, job.target_quantity, 0)) as planned_qty,
      sum(coalesce(output.output_qty, 0)) as actual_qty
    from due_jobs job
    left join (select job_order_id, finished_good_id, uom_key, sum(output_qty) as output_qty from production_scope group by job_order_id, finished_good_id, uom_key) output
      on output.job_order_id = job.id and output.finished_good_id = job.finished_good_id and output.uom_key = lower(coalesce(nullif(btrim(job.uom), ''), 'unit'))
    group by job.finished_good_id, lower(coalesce(nullif(btrim(job.uom), ''), 'unit'))
  ), production_trend as (
    select date_trunc('month', (public.factory_production_operational_completion_at(p.end_date, p.end_time) at time zone 'Asia/Kuala_Lumpur')::date)::date as month_start,
      lower(coalesce(nullif(btrim(p.uom), ''), 'unit')) as uom_key, min(coalesce(nullif(btrim(p.uom), ''), 'unit')) as uom,
      sum(coalesce(p.actual_output_qty, p.good_output_qty, p.actual_produced_qty, p.produced_quantity, 0)) as quantity
    from public.factory_productions p cross join params
    where lower(coalesce(p.status, '')) = 'completed'
      and (public.factory_production_operational_completion_at(p.end_date, p.end_time) at time zone 'Asia/Kuala_Lumpur')::date >= params.month_start - interval '5 months'
      and (public.factory_production_operational_completion_at(p.end_date, p.end_time) at time zone 'Asia/Kuala_Lumpur')::date < params.month_end
      and (p_finished_good_id is null or p.finished_good_id = p_finished_good_id)
    group by 1, 2
  )
  select base.payload || jsonb_build_object(
    'kpis', coalesce(base.payload -> 'kpis', '{}'::jsonb) || jsonb_build_object(
      'production_output', jsonb_build_object('by_uom', coalesce((select jsonb_agg(jsonb_build_object('uom', uom, 'uom_key', uom_key, 'quantity', quantity) order by uom_key) from output_by_uom), '[]'::jsonb), 'batch_count', (select count(*) from production_scope)),
      'completion_rate', jsonb_build_object('completed_within_month_count', (select completed_within_month_count from completion_rate), 'eligible_due_count', (select eligible_due_count from completion_rate), 'late_completed_count', (select late_completed_count from completion_rate), 'rate', coalesce((select completed_within_month_count * 100.0 / nullif(eligible_due_count, 0) from completion_rate), 0))
    ),
    'production_summary', coalesce((select jsonb_agg(jsonb_build_object('finished_good_id', summary.finished_good_id, 'product', coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'), 'packaging_sku', coalesce(finished_good.product_code, finished_good.variant_name, 'Packaging SKU'), 'uom', summary.uom, 'uom_key', summary.uom_key, 'output_qty', summary.output_qty, 'batch_count', summary.batch_count, 'average_batch_qty', summary.average_batch_qty, 'eligible_due_count', coalesce(job.eligible_due_count, 0), 'completed_within_month_count', coalesce(job.completed_within_month_count, 0), 'completion_rate', coalesce(job.completed_within_month_count * 100.0 / nullif(job.eligible_due_count, 0), 0)) order by summary.output_qty desc) from production_summary summary left join public.factory_finished_goods finished_good on finished_good.id = summary.finished_good_id left join public.factory_product_families family on family.id = finished_good.product_family_id left join jobs_by_product job on job.finished_good_id = summary.finished_good_id), '[]'::jsonb),
    'planned_vs_actual', coalesce((select jsonb_agg(jsonb_build_object('finished_good_id', row.finished_good_id, 'product', coalesce(family.name_en, finished_good.product_name_en, finished_good.product_name, 'Finished Good'), 'packaging_sku', coalesce(finished_good.product_code, finished_good.variant_name, 'Packaging SKU'), 'uom', row.uom, 'uom_key', row.uom_key, 'planned_qty', row.planned_qty, 'actual_qty', row.actual_qty, 'variance', row.actual_qty - row.planned_qty, 'completion_percent', coalesce(row.actual_qty * 100.0 / nullif(row.planned_qty, 0), 0)) order by row.planned_qty desc) from planned_actual row left join public.factory_finished_goods finished_good on finished_good.id = row.finished_good_id left join public.factory_product_families family on family.id = finished_good.product_family_id), '[]'::jsonb),
    'production_dispatch_trend', coalesce(base.payload -> 'production_dispatch_trend', '{}'::jsonb) || jsonb_build_object('production', coalesce((select jsonb_agg(jsonb_build_object('month_start', month_start, 'uom_key', uom_key, 'uom', uom, 'quantity', quantity) order by month_start, uom_key) from production_trend), '[]'::jsonb))
  ) from base;
$function$
;
