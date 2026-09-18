-- Production End is the sole operational completion timestamp. Audit completion
-- metadata remains available separately as the time the record was captured.

create or replace function public.factory_production_operational_completion_at(
  p_end_date date,
  p_end_time time
)
returns timestamptz
language sql
immutable
strict
set search_path = public
as $$
  select (p_end_date + p_end_time) at time zone 'Asia/Kuala_Lumpur';
$$;

comment on function public.factory_production_operational_completion_at(date, time) is
  'Canonical Factory operational completion timestamp from recorded Production End in Asia/Kuala_Lumpur.';

create or replace function public.factory_get_production_operational_snapshot(
  p_operational_date date default current_date,
  p_include_productions boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as materialized (
    select public.factory_get_production_control_snapshot(p_operational_date, false) as payload
  ), completed_productions as materialized (
    select
      production.*,
      public.factory_production_operational_completion_at(production.end_date, production.end_time) as operational_completion_at
    from public.factory_productions production
    where lower(coalesce(production.status, '')) = 'completed'
      and (public.factory_production_operational_completion_at(production.end_date, production.end_time)
        at time zone 'Asia/Kuala_Lumpur')::date = p_operational_date
  ), completed_jobs as (
    select jsonb_agg(
      to_jsonb(job) || jsonb_build_object(
        'operational_completion_at', completed.operational_completion_at,
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
          'uom', finished_good.uom
        ) end
      ) order by completed.operational_completion_at desc, job.id desc
    ) as payload
    from completed_productions completed
    join public.factory_job_orders job on job.id = completed.job_order_id
    left join public.factory_finished_goods finished_good on finished_good.id = job.finished_good_id
  ), production_payloads as (
    select jsonb_agg(
      to_jsonb(production) || jsonb_build_object(
        'operational_completion_at', production.operational_completion_at,
        'finished_good', case when finished_good.id is null then null else jsonb_build_object(
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
          'uom', finished_good.uom
        ) end,
        'job_order', jsonb_build_object('job_order_no', job.job_order_no, 'finished_good_id', job.finished_good_id, 'product_name', job.product_name)
      ) order by production.operational_completion_at desc, production.id desc
    ) as payload
    from completed_productions production
    left join public.factory_finished_goods finished_good on finished_good.id = production.finished_good_id
    left join public.factory_job_orders job on job.id = production.job_order_id
    where p_include_productions
  ), output_by_uom as (
    select coalesce(nullif(btrim(uom), ''), 'unit') as uom,
      sum(coalesce(good_output_qty, actual_output_qty, actual_produced_qty, produced_quantity, 0)) as quantity
    from completed_productions
    group by coalesce(nullif(btrim(uom), ''), 'unit')
  )
  select base.payload || jsonb_build_object(
    'completed_today', coalesce((select payload from completed_jobs), '[]'::jsonb),
    'productions', coalesce((select payload from production_payloads), '[]'::jsonb),
    'summary', coalesce(base.payload -> 'summary', '{}'::jsonb) || jsonb_build_object(
      'completed_today', (select count(*) from completed_productions),
      'completion_rate', case
        when coalesce((base.payload -> 'summary' ->> 'planned_today')::numeric, 0) > 0 then
          (select count(*) from completed_productions) * 100.0 / (base.payload -> 'summary' ->> 'planned_today')::numeric
        when (select count(*) from completed_productions) > 0 then 100
        else 0
      end,
      'output_by_uom', coalesce((select jsonb_agg(jsonb_build_object('uom', uom, 'quantity', quantity) order by uom) from output_by_uom), '[]'::jsonb)
    )
  )
  from base;
$$;

revoke all on function public.factory_get_production_operational_snapshot(date, boolean) from public, anon;
grant execute on function public.factory_get_production_operational_snapshot(date, boolean) to authenticated;

create or replace function public.factory_get_production_operational_pipeline_snapshot(
  p_operational_date date default timezone('Asia/Kuala_Lumpur', now())::date,
  p_include_productions boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with source as materialized (
    select public.factory_get_production_operational_snapshot(p_operational_date, p_include_productions) as payload
  ), planned as (
    select item.value as payload from source, lateral jsonb_array_elements(coalesce(source.payload -> 'planned', '[]'::jsonb)) item
  ), in_progress as (
    select item.value as payload from source, lateral jsonb_array_elements(coalesce(source.payload -> 'in_progress', '[]'::jsonb)) item
  ), completed as (
    select item.value as payload from source, lateral jsonb_array_elements(coalesce(source.payload -> 'completed_today', '[]'::jsonb)) item
  )
  select jsonb_build_object(
    'scheduled', coalesce((select jsonb_agg(payload order by (payload ->> 'planned_date')::date, (payload ->> 'id')::uuid) from planned where lower(coalesce(payload ->> 'status', '')) = 'planned' and (payload ->> 'planned_date')::date > p_operational_date), '[]'::jsonb),
    'released', coalesce((select jsonb_agg(payload order by (payload ->> 'planned_date')::date, (payload ->> 'id')::uuid) from planned where lower(coalesce(payload ->> 'status', '')) = 'released'), '[]'::jsonb),
    'in_progress', coalesce((select jsonb_agg(payload order by (payload ->> 'production_date')::date, (payload ->> 'start_time')::time, (payload ->> 'id')::uuid) from in_progress), '[]'::jsonb),
    'completed_today', coalesce((select jsonb_agg(payload order by (payload ->> 'operational_completion_at')::timestamptz desc, (payload ->> 'id')::uuid desc) from completed), '[]'::jsonb),
    'productions', source.payload -> 'productions',
    'summary', coalesce(source.payload -> 'summary', '{}'::jsonb) || jsonb_build_object(
      'scheduled', (select count(*) from planned where lower(coalesce(payload ->> 'status', '')) = 'planned' and (payload ->> 'planned_date')::date > p_operational_date),
      'released', (select count(*) from planned where lower(coalesce(payload ->> 'status', '')) = 'released'),
      'in_progress', (select count(*) from in_progress)
    )
  ) from source;
$$;

revoke all on function public.factory_get_production_operational_pipeline_snapshot(date, boolean) from public, anon;
grant execute on function public.factory_get_production_operational_pipeline_snapshot(date, boolean) to authenticated;

create or replace function public.factory_get_dashboard_operational_monthly_analytics(
  p_month date,
  p_finished_good_id uuid default null,
  p_include_operational_comparisons boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select date_trunc('month', p_month)::date as month_start,
      (date_trunc('month', p_month) + interval '1 month')::date as month_end
  ), base as (
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
$$;

revoke all on function public.factory_get_dashboard_operational_monthly_analytics(date, uuid, boolean) from public, anon;
grant execute on function public.factory_get_dashboard_operational_monthly_analytics(date, uuid, boolean) to authenticated;

create or replace function public.factory_mesti_food_processing_control(
  p_date_from date default null, p_date_to date default null, p_finished_good_id uuid default null,
  p_qc_status text default null, p_verification_status text default null, p_search text default null
)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.operational_completion_at desc, r.id desc), '[]'::jsonb) from (
    select p.id, p.job_order_id, p.finished_good_id, j.job_order_no, p.production_no, p.batch_no,
      p.end_date as production_date, coalesce(p.production_date, p.manufacturing_date) as start_date,
      p.end_date as completion_date, p.end_time as completion_time,
      public.factory_production_operational_completion_at(p.end_date, p.end_time) as operational_completion_at,
      coalesce(f.product_name_en, f.product_name, p.product_name) as product_name, f.product_code, f.variant_name, f.packaging_type,
      p.start_time, p.completed_at, p.good_output_qty, p.actual_output_qty, p.uom, p.expiry_date, p.notes, p.qc_status, p.verification_status, p.verified_at,
      coalesce(c.nickname, c.full_name, '') as completed_by_name, coalesce(v.nickname, v.full_name, '') as verified_by_name,
      case when count(q.id)=0 then 'Evidence unavailable' when count(q.id) filter(where q.checklist_result in ('pass','na') or (q.qc_type='remarks' and q.remarks is not null))=count(q.id) then 'Passed · '||count(q.id)||'/'||count(q.id) else 'Complete · '||count(q.id) filter(where q.checked_at is not null)||'/'||count(q.id) end as qc_summary
    from public.factory_productions p left join public.factory_finished_goods f on f.id=p.finished_good_id left join public.factory_job_orders j on j.id=p.job_order_id left join public.employees c on c.id=p.created_by left join public.employees v on v.id=p.verified_by left join public.factory_production_qc_results q on q.production_id=p.id
    where auth.uid() is not null and public.current_user_has_permission('factory_production.view') and p.status='completed'
      and (p_date_from is null or p.end_date >= p_date_from) and (p_date_to is null or p.end_date <= p_date_to)
      and (p_finished_good_id is null or p.finished_good_id=p_finished_good_id) and (p_qc_status is null or p.qc_status=p_qc_status) and (p_verification_status is null or p.verification_status=p_verification_status)
      and (nullif(btrim(p_search),'') is null or concat_ws(' ',p.production_no,p.batch_no,p.product_name,f.product_name_en,f.product_code,j.job_order_no) ilike '%'||btrim(p_search)||'%')
    group by p.id, j.job_order_no, f.product_name_en, f.product_name, f.product_code, f.variant_name, f.packaging_type, c.nickname, c.full_name, v.nickname, v.full_name
  ) r;
$$;

drop function if exists public.factory_mesti_finished_product_storage_control(date, date, uuid, uuid, uuid, text);
create function public.factory_mesti_finished_product_storage_control(
  p_date_from date default null, p_date_to date default null, p_product_family_id uuid default null,
  p_packaging_sku_id uuid default null, p_storage_location_id uuid default null, p_search text default null
)
returns table (
  id uuid, production_id uuid, job_order_id uuid, job_order_no text, production_no text,
  completed_at timestamptz, completion_date date, completion_time time, finished_good_id uuid, finished_good_name text,
  packaging_sku_id uuid, packaging_sku_code text, packaging_sku_name text, completed_qty numeric,
  completed_uom text, storage_location_id uuid, storage_location_name text, batch_no text,
  manufacturing_date date, expiry_date date, completed_by uuid, completed_by_name text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to view Finished Product Storage Control.';
  end if;
  return query
  select balance.id, production.id, job.id, job.job_order_no, production.production_no,
    production.completed_at, production.end_date, production.end_time,
    product_family.id, coalesce(product_family.name_en, finished_good.product_name_en, finished_good.product_name),
    finished_good.id, finished_good.product_code, coalesce(finished_good.product_name_en, finished_good.product_name),
    balance.opening_qty, coalesce(nullif(btrim(finished_good.packaging_type), ''), 'Pack'), balance.storage_location_id,
    coalesce(location.location_name, balance.storage_location), balance.batch_no, balance.manufacturing_date,
    balance.expiry_date, production.created_by, coalesce(completer.nickname, completer.full_name, completer.email)
  from public.factory_finished_good_batch_balances balance
  join public.factory_productions production on production.id = balance.production_id
  join public.factory_finished_goods finished_good on finished_good.id = balance.finished_good_id
  left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
  left join public.factory_job_orders job on job.id = production.job_order_id
  left join public.factory_storage_locations location on location.id = balance.storage_location_id
  left join public.employees completer on completer.id = production.created_by
  where balance.source_type = 'production' and lower(coalesce(production.status, '')) = 'completed'
    and (p_date_from is null or production.end_date >= p_date_from)
    and (p_date_to is null or production.end_date <= p_date_to)
    and (p_product_family_id is null or finished_good.product_family_id = p_product_family_id)
    and (p_packaging_sku_id is null or finished_good.id = p_packaging_sku_id)
    and (p_storage_location_id is null or balance.storage_location_id = p_storage_location_id)
    and (nullif(btrim(p_search), '') is null or concat_ws(' ', job.job_order_no, production.production_no, balance.batch_no, product_family.name_en, finished_good.product_code, finished_good.product_name_en, finished_good.product_name, coalesce(location.location_name, balance.storage_location)) ilike '%' || btrim(p_search) || '%')
  order by production.end_date desc, production.end_time desc, balance.created_at desc, balance.id desc;
end;
$$;

revoke all on function public.factory_mesti_finished_product_storage_control(date, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.factory_mesti_finished_product_storage_control(date, date, uuid, uuid, uuid, text) to authenticated;
