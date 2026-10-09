-- Extend the same canonical monthly snapshot with its contributing completed runs.
-- No second date, deduplication or aggregation authority; source RLS is preserved.
create or replace function public.factory_get_production_monthly_performance(p_month date)
returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_production.view') then
    raise exception using errcode = '42501', message = 'Missing permission to view Production performance.';
  end if;
  if p_month is null then
    raise exception using errcode = '22023', message = 'Select a valid month.';
  end if;
  with params as (
    select date_trunc('month', p_month)::date as month_start,
      (date_trunc('month', p_month) + interval '1 month')::date as month_end,
      timezone('Asia/Kuala_Lumpur', now())::date as today
  ), completed as materialized (
    select p.id, p.job_order_id, p.finished_good_id, p.product_name,
      p.production_no, p.actual_pack_qty,
      public.factory_production_operational_completion_at(p.end_date, p.end_time) as end_at,
      public.factory_production_operational_completion_at(p.production_date, p.start_time) as start_at,
      coalesce(p.actual_output_qty, p.good_output_qty, p.actual_produced_qty, p.produced_quantity) as output_qty,
      lower(btrim(p.uom)) as uom
    from public.factory_productions p where lower(p.status) = 'completed'
  ), runs as (
    -- A completed JO is one run. Replayed legacy rows must not double-count it.
    select distinct on (coalesce(job_order_id, id)) *
    from completed order by coalesce(job_order_id, id), end_at desc nulls last, id
  ), measured as (
    select runs.*, (end_at at time zone 'Asia/Kuala_Lumpur')::date as day,
      jo.job_order_no,
      coalesce(family.name_en, fg.product_name_en, fg.product_name, runs.product_name, jo.product_name) as finished_good_name,
      family.name_cn as finished_good_name_cn,
      fg.product_code as sku_code, fg.variant_name,
      fg.pack_size_qty, fg.pack_size_uom,
      case when output_qty >= 0 and output_qty::text not in ('NaN','Infinity','-Infinity') then
        case when runs.uom in ('kg','kilogram','kilograms') then output_qty
          when runs.uom in ('g','gram','grams') then output_qty / 1000 end end as output_kg,
      case when end_at > start_at then extract(epoch from end_at - start_at) / 3600 end as jo_hours
    from runs
    left join public.factory_job_orders jo on jo.id = runs.job_order_id
    left join public.factory_finished_goods fg on fg.id = coalesce(runs.finished_good_id, jo.finished_good_id)
    left join public.factory_product_families family on family.id = fg.product_family_id
  ), daily as (
    select day, count(*) as completed_runs, sum(output_kg) as output_kg,
      count(*) filter (where output_kg is null) as missing_output_runs,
      count(*) filter (where jo_hours is null) as invalid_duration_runs,
      count(*) filter (where output_kg is not null and jo_hours is not null) as productivity_runs,
      sum(output_kg) filter (where jo_hours is not null) as productivity_output_kg,
      sum(jo_hours) filter (where output_kg is not null) as jo_hours,
      -- Prior-month days only support the average; send detail for this month alone.
      case when day >= (select month_start from params) then jsonb_agg(jsonb_build_object(
        'production_id', id, 'production_no', production_no,
        'job_order_id', job_order_id, 'job_order_no', job_order_no,
        'finished_good_name', finished_good_name, 'finished_good_name_cn', finished_good_name_cn,
        'sku_code', sku_code, 'variant_name', variant_name,
        'pack_size_qty', pack_size_qty, 'pack_size_uom', pack_size_uom,
        'output_qty', output_qty, 'output_uom', uom, 'output_kg', output_kg,
        'actual_pack_qty', actual_pack_qty, 'start_at', start_at, 'end_at', end_at,
        'jo_hours', jo_hours
      ) order by end_at, id) else '[]'::jsonb end as records
    from measured cross join params
    where day < params.month_end and day <= params.today group by day
  ), prior as (
    select * from daily where day < (select month_start from params) order by day desc limit 6
  ), scope as (
    select * from daily where day >= (select month_start from params)
    union all select * from prior
  ), rolling as (
    select *, count(*) over window_days as average_days,
      case when sum(missing_output_runs) over window_days = 0 then
        avg(output_kg) over window_days end as moving_average_kg
    from scope window window_days as (order by day rows between 6 preceding and current row)
  )
  select jsonb_build_object(
    'month', to_char(params.month_start, 'YYYY-MM'), 'today', params.today,
    'unattributed_runs', (select count(*) from runs where end_at is null),
    'days', coalesce((select jsonb_agg(to_jsonb(rolling) order by day) from rolling
      where day >= params.month_start), '[]'::jsonb)
  ) into result from params;
  return result;
end;
$$;

revoke all on function public.factory_get_production_monthly_performance(date) from public, anon;
grant execute on function public.factory_get_production_monthly_performance(date) to authenticated;
comment on function public.factory_get_production_monthly_performance(date) is
  'Actual completed JO output and valid summed JO-hours by Malaysia Production End date; latest seven production-day average, never Planning targets or factory operating hours.';
