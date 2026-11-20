-- Classify submitted evidence from stored Actual and Par without relying on legacy variance signs.
create or replace function public.inventory_stock_check_row_summaries(p_check_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_stock_check.view') then
    raise exception 'Stock Check access is required.' using errcode = '42501';
  end if;
  if p_check_ids is null then
    raise exception 'Stock Check identities are required.' using errcode = '22023';
  end if;

  with requested as (select distinct id from unnest(p_check_ids) as input(id) where id is not null),
  scoped_headers as materialized (
    select check_header.id
    from requested
    join public.inventory_stock_checks check_header on check_header.id = requested.id
  ),
  scoped_rows as materialized (
    select row.* from inventory_projection.authorized_stock_check_rows(
      array(select check_header.id from scoped_headers check_header)
    ) row
  ),
  classified_rows as (
    select row.*,
           (row.skipped is true or row.status is not distinct from 'skipped') as explicitly_skipped,
           (row.skipped is not true and coalesce(row.status, '') not in ('skipped', 'na', 'pending')
             and row.actual_count_quantity between 0 and 99999999999.999
             and row.par_level_quantity between 0 and 99999999999.999) as comparable
    from scoped_rows row
  ),
  summaries as (
    select check_header.id as check_id,
           count(row.id) as total,
           count(row.id) filter (where row.explicitly_skipped) as skipped,
           count(row.id) filter (where row.comparable and row.actual_count_quantity < row.par_level_quantity) as shortage,
           count(row.id) filter (where row.comparable and row.actual_count_quantity > row.par_level_quantity) as excess
    from scoped_headers check_header
    left join classified_rows row on row.stock_check_id = check_header.id
    group by check_header.id
  )
  select jsonb_build_object(
    'check_count', count(*),
    'summaries', coalesce(jsonb_agg(jsonb_build_object(
      'check_id', check_id, 'total', total, 'skipped', skipped,
      'shortage', shortage, 'excess', excess
    ) order by check_id), '[]'::jsonb)
  ) into v_result
  from summaries;

  if (v_result->>'check_count')::integer <> (
    select count(distinct id) from unnest(p_check_ids) as input(id)
  ) then
    raise exception 'Stock Check summary scope is incomplete.' using errcode = '42501';
  end if;

  return v_result;
end;
$function$;
