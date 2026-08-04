-- Authoritative Production Control Center snapshot.
-- A single SQL statement keeps operational rows and KPI aggregates consistent
-- without client-side offset pagination or dependence on PostgREST row limits.

create or replace function public.factory_get_production_control_snapshot(
  p_operational_date date default current_date,
  p_include_productions boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with operational_jobs as materialized (
    select
      job.*,
      case
        when lower(coalesce(job.status, '')) in ('planned', 'released') then 'planned'
        when lower(coalesce(job.status, '')) = 'in_progress' then 'in_progress'
        when lower(coalesce(job.status, '')) = 'completed'
          and timezone('Asia/Kuala_Lumpur', coalesce(job.completed_at, job.updated_at))::date = p_operational_date
          then 'completed_today'
        else null
      end as operational_group,
      coalesce(job.completed_at, job.updated_at) as authoritative_completed_at
    from public.factory_job_orders job
    where lower(coalesce(job.status, '')) in ('planned', 'released', 'in_progress')
       or (
         lower(coalesce(job.status, '')) = 'completed'
         and timezone('Asia/Kuala_Lumpur', coalesce(job.completed_at, job.updated_at))::date = p_operational_date
       )
  ),
  job_payloads as materialized (
    select
      job.id,
      job.operational_group,
      job.planned_date,
      job.production_date,
      job.start_time,
      job.created_at,
      job.authoritative_completed_at,
      jsonb_build_object(
        'id', job.id,
        'job_order_no', job.job_order_no,
        'finished_good_id', job.finished_good_id,
        'product_name', job.product_name,
        'target_pack_qty', job.target_pack_qty,
        'target_production_qty', job.target_production_qty,
        'target_quantity', job.target_quantity,
        'produced_quantity', job.produced_quantity,
        'uom', job.uom,
        'planned_date', job.planned_date,
        'due_date', job.due_date,
        'priority', job.priority,
        'status', job.status,
        'assigned_team', job.assigned_team,
        'remarks', job.remarks,
        'created_by', job.created_by,
        'released_at', job.released_at,
        'released_by', job.released_by,
        'started_at', job.started_at,
        'started_by', job.started_by,
        'production_operator_id', job.production_operator_id,
        'production_operator_name', job.production_operator_name,
        'production_date', job.production_date,
        'start_time', job.start_time,
        'production_sop_id', job.production_sop_id,
        'sop_version', job.sop_version,
        'qc_snapshot_created_at', job.qc_snapshot_created_at,
        'completed_at', job.completed_at,
        'completed_by', job.completed_by,
        'created_at', job.created_at,
        'updated_at', job.updated_at,
        'finished_good', case when finished_good.id is null then null else jsonb_build_object(
          'id', finished_good.id,
          'product_code', finished_good.product_code,
          'product_name', finished_good.product_name,
          'product_name_en', finished_good.product_name_en,
          'product_name_cn', finished_good.product_name_cn,
          'product_name_bm', finished_good.product_name_bm,
          'product_family_id', finished_good.product_family_id,
          'variant_name', finished_good.variant_name,
          'packaging_type', finished_good.packaging_type,
          'pack_size_qty', finished_good.pack_size_qty,
          'pack_size_uom', finished_good.pack_size_uom,
          'base_qty', finished_good.base_qty,
          'base_uom', finished_good.base_uom,
          'category_id', finished_good.category_id,
          'category', finished_good.category,
          'uom', finished_good.uom,
          'current_balance', finished_good.current_balance,
          'shelf_life_days', finished_good.shelf_life_days,
          'status', finished_good.status,
          'category_ref', case when category.id is null then null else jsonb_build_object('name', category.name) end,
          'product_family', case when family.id is null then null else jsonb_build_object(
            'name_en', family.name_en,
            'name_cn', family.name_cn,
            'name_bm', family.name_bm,
            'status', family.status
          ) end
        ) end,
        'step_executions', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', step.id,
              'job_order_id', step.job_order_id,
              'production_id', step.production_id,
              'production_sop_id', step.production_sop_id,
              'sop_step_id', step.sop_step_id,
              'step_no', step.step_no,
              'step_name', step.step_name,
              'description', step.description,
              'sub_steps', step.sub_steps,
              'status', step.status,
              'completed_by', step.completed_by,
              'completed_at', step.completed_at,
              'qc_results', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', qc.id,
                    'job_order_id', qc.job_order_id,
                    'production_id', qc.production_id,
                    'production_step_execution_id', qc.production_step_execution_id,
                    'sop_qc_check_id', qc.sop_qc_check_id,
                    'sequence_no', qc.sequence_no,
                    'qc_type', qc.qc_type,
                    'qc_name', qc.qc_name,
                    'instructions', qc.instructions,
                    'is_required', qc.is_required,
                    'checklist_result', qc.checklist_result,
                    'remarks', qc.remarks,
                    'checked_by', qc.checked_by,
                    'checked_by_name', qc.checked_by_name,
                    'checked_at', qc.checked_at
                  ) order by qc.sequence_no asc, qc.id asc
                )
                from public.factory_production_qc_results qc
                where qc.production_step_execution_id = step.id
              ), '[]'::jsonb)
            ) order by step.step_no asc, step.id asc
          )
          from public.factory_production_step_executions step
          where step.job_order_id = job.id
        ), '[]'::jsonb)
      ) as payload
    from operational_jobs job
    left join public.factory_finished_goods finished_good on finished_good.id = job.finished_good_id
    left join public.factory_finished_good_categories category on category.id = finished_good.category_id
    left join public.factory_product_families family on family.id = finished_good.product_family_id
    where job.operational_group is not null
  ),
  completed_productions as materialized (
    select production.*
    from public.factory_productions production
    join operational_jobs job
      on job.id = production.job_order_id
     and job.operational_group = 'completed_today'
    where p_include_productions
      and lower(coalesce(production.status, '')) = 'completed'
  ),
  production_payloads as materialized (
    select
      production.id,
      production.completed_at,
      production.created_at,
      jsonb_build_object(
        'id', production.id,
        'job_order_id', production.job_order_id,
        'finished_good_id', production.finished_good_id,
        'production_no', production.production_no,
        'product_name', production.product_name,
        'batch_no', production.batch_no,
        'actual_pack_qty', production.actual_pack_qty,
        'actual_output_qty', production.actual_output_qty,
        'produced_quantity', production.produced_quantity,
        'actual_produced_qty', production.actual_produced_qty,
        'good_output_qty', production.good_output_qty,
        'wastage_qty', production.wastage_qty,
        'uom', production.uom,
        'production_date', production.production_date,
        'manufacturing_date', production.manufacturing_date,
        'end_date', production.end_date,
        'expiry_date', production.expiry_date,
        'storage_location_id', production.storage_location_id,
        'shelf_life_days_snapshot', production.shelf_life_days_snapshot,
        'expiry_override_reason', production.expiry_override_reason,
        'operator_id', production.operator_id,
        'operator_name', production.operator_name,
        'start_time', production.start_time,
        'end_time', production.end_time,
        'qc_status', production.qc_status,
        'production_sop_id', production.production_sop_id,
        'sop_version', production.sop_version,
        'status', production.status,
        'notes', production.notes,
        'created_by', production.created_by,
        'completed_at', production.completed_at,
        'created_at', production.created_at,
        'updated_at', production.updated_at,
        'storage_location_ref', case when location.id is null then null else jsonb_build_object(
          'location_name', location.location_name,
          'location_code', location.location_code,
          'location_type', location.location_type,
          'status', location.status
        ) end,
        'finished_good', case when finished_good.id is null then null else jsonb_build_object(
          'product_code', finished_good.product_code,
          'product_name', finished_good.product_name,
          'product_name_en', finished_good.product_name_en,
          'product_name_cn', finished_good.product_name_cn,
          'product_name_bm', finished_good.product_name_bm,
          'product_family_id', finished_good.product_family_id,
          'packaging_type', finished_good.packaging_type,
          'pack_size_qty', finished_good.pack_size_qty,
          'pack_size_uom', finished_good.pack_size_uom,
          'base_qty', finished_good.base_qty,
          'base_uom', finished_good.base_uom,
          'uom', finished_good.uom
        ) end,
        'job_order', jsonb_build_object(
          'job_order_no', job.job_order_no,
          'finished_good_id', job.finished_good_id,
          'product_name', job.product_name,
          'target_pack_qty', job.target_pack_qty,
          'target_production_qty', job.target_production_qty
        )
      ) as payload
    from completed_productions production
    join operational_jobs job on job.id = production.job_order_id
    left join public.factory_finished_goods finished_good on finished_good.id = production.finished_good_id
    left join public.factory_storage_locations location on location.id = production.storage_location_id
  ),
  output_by_uom as (
    select
      coalesce(production.uom, '') as uom,
      sum(coalesce(
        production.good_output_qty,
        production.actual_output_qty,
        production.actual_produced_qty,
        production.produced_quantity,
        0
      )) as quantity
    from completed_productions production
    group by coalesce(production.uom, '')
  ),
  summary_values as (
    select
      count(*) filter (where job.operational_group = 'planned')::integer as planned_released,
      count(*) filter (where job.operational_group = 'in_progress')::integer as in_progress,
      count(*) filter (where job.operational_group = 'completed_today')::integer as completed_today,
      (
        select count(*)::integer
        from public.factory_job_orders planned_job
        where planned_job.planned_date = p_operational_date
          and lower(coalesce(planned_job.status, '')) <> 'cancelled'
      ) as planned_today
    from operational_jobs job
  )
  select jsonb_build_object(
    'planned', coalesce((
      select jsonb_agg(payload order by planned_date asc nulls last, created_at asc, id asc)
      from job_payloads
      where operational_group = 'planned'
    ), '[]'::jsonb),
    'in_progress', coalesce((
      select jsonb_agg(payload order by production_date asc nulls last, start_time asc nulls last, created_at asc, id asc)
      from job_payloads
      where operational_group = 'in_progress'
    ), '[]'::jsonb),
    'completed_today', coalesce((
      select jsonb_agg(payload order by authoritative_completed_at desc, id desc)
      from job_payloads
      where operational_group = 'completed_today'
    ), '[]'::jsonb),
    'productions', coalesce((
      select jsonb_agg(payload order by completed_at desc nulls last, created_at desc, id desc)
      from production_payloads
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'planned_released', summary.planned_released,
      'in_progress', summary.in_progress,
      'completed_today', summary.completed_today,
      'planned_today', summary.planned_today,
      'completion_rate', case
        when coalesce(summary.planned_today, 0) > 0
          then (summary.completed_today::numeric / summary.planned_today::numeric) * 100
        when summary.completed_today > 0 then 100
        else 0
      end,
      'output_by_uom', coalesce((
        select jsonb_agg(
          jsonb_build_object('uom', output.uom, 'quantity', output.quantity)
          order by output.uom asc
        )
        from output_by_uom output
      ), '[]'::jsonb)
    )
  )
  from summary_values summary;
$$;

revoke all on function public.factory_get_production_control_snapshot(date, boolean) from public;
grant execute on function public.factory_get_production_control_snapshot(date, boolean) to authenticated;
