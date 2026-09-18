-- Restore the canonical Job Order read authorization around the operational
-- pipeline wrapper introduced by the completion-date projection.

create or replace function public.factory_get_production_operational_pipeline_snapshot(
  p_operational_date date default timezone('Asia/Kuala_Lumpur', now())::date,
  p_include_productions boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.current_user_has_permission('factory_job_orders.view') then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Job Orders.';
  end if;

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
  ) into v_result from source;

  return v_result;
end;
$$;

revoke all on function public.factory_get_production_operational_pipeline_snapshot(date, boolean) from public, anon;
grant execute on function public.factory_get_production_operational_pipeline_snapshot(date, boolean) to authenticated;
