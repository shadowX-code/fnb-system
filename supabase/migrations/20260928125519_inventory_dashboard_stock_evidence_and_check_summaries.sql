-- Read-only Inventory projections. They aggregate complete canonical evidence in
-- PostgreSQL; the browser does not download historical submitted rows for cards.
create or replace function public.inventory_dashboard_stock_evidence(p_outlet_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_dashboard.view') then
    raise exception 'Inventory Dashboard access is required.' using errcode = '42501';
  end if;
  if p_outlet_ids is null or cardinality(p_outlet_ids) = 0
     or exists (select 1 from unnest(p_outlet_ids) as requested(outlet_id)
                where requested.outlet_id is null or not public.current_user_can_access_outlet(requested.outlet_id)) then
    raise exception 'Inventory outlet scope is unavailable.' using errcode = '42501';
  end if;

  with applicable as (
    select link.outlet_id, link.inventory_item_id as item_id,
           link.par_level as current_par
    from public.inventory_item_outlets link
    join public.inventory_items item on item.id = link.inventory_item_id
    where link.outlet_id = any(p_outlet_ids)
      and link.is_active is not false
      and coalesce(lower(item.status), 'active') not in ('inactive', 'archived', 'deleted')
      and link.par_level > 0
  ),
  latest as (
    select distinct on (check_header.outlet_id, row.item_id)
           check_header.outlet_id, row.item_id, check_header.id as check_id,
           row.id as check_row_id, check_header.check_date,
           check_header.submitted_at, row.actual_count_quantity,
           row.par_level_quantity as submitted_par, row.skipped,
           row.status as row_status
    from public.inventory_stock_checks check_header
    join public.inventory_stock_check_items row on row.stock_check_id = check_header.id
    join applicable position on position.outlet_id = check_header.outlet_id
                            and position.item_id = row.item_id
    where check_header.status in ('submitted', 'reviewed', 'locked')
    order by check_header.outlet_id, row.item_id,
             coalesce(check_header.submitted_at::text, check_header.check_date::text,
                      check_header.created_at::date::text) desc,
             check_header.created_at desc, check_header.id, row.id
  ),
  evaluated as (
    select position.outlet_id, position.item_id, position.current_par,
           evidence.check_id, evidence.check_row_id, evidence.check_date,
           evidence.submitted_at, evidence.actual_count_quantity,
           evidence.submitted_par, evidence.skipped, evidence.row_status,
           coalesce(movement_state.has_after, false) as has_after,
           coalesce(movement_state.has_uncertain, false) as has_uncertain
    from applicable position
    left join latest evidence on evidence.outlet_id = position.outlet_id
                             and evidence.item_id = position.item_id
    left join lateral (
      select bool_or(case
               when movement.created_at is not null and evidence.submitted_at is not null
                 then movement.created_at > evidence.submitted_at
               when movement.created_at is not null and evidence.check_date is not null
                 then (movement.created_at at time zone 'UTC')::date > evidence.check_date
               else false end) as has_after,
             bool_or(case
               when movement.created_at is not null and evidence.submitted_at is not null then false
               when movement.created_at is not null and evidence.check_date is not null
                 then (movement.created_at at time zone 'UTC')::date = evidence.check_date
               else true end) as has_uncertain
      from public.inventory_movements movement
      where evidence.check_id is not null
        and movement.outlet_id = position.outlet_id
        and movement.inventory_item_id = position.item_id
        and movement.quantity is not null and movement.quantity <> 0
    ) movement_state on true
  ),
  classified as (
    select *, case
      when check_id is null or skipped or row_status = 'na' or actual_count_quantity is null
        then 'unverified'
      when has_after then 'changed'
      when has_uncertain then 'unverified'
      when actual_count_quantity < current_par then 'below_par'
      else 'sufficient' end as evidence_state
    from evaluated
  )
  select jsonb_build_object(
    'position_count', count(*),
    'positions', coalesce(jsonb_agg(jsonb_build_object(
      'outlet_id', outlet_id, 'item_id', item_id,
      'state', evidence_state, 'check_id', check_id,
      'check_row_id', check_row_id, 'check_date', check_date,
      'submitted_at', submitted_at, 'actual_count', actual_count_quantity,
      'current_par', current_par, 'submitted_par', submitted_par,
      'movement_relation', case when has_after then 'after'
                                when has_uncertain then 'uncertain' else 'none' end
    ) order by outlet_id, item_id), '[]'::jsonb)
  ) into v_result
  from classified;

  return v_result;
end;
$function$;

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
  summaries as (
    select check_header.id as check_id,
           count(row.id) as total,
           count(row.id) filter (where row.skipped) as skipped,
           count(row.id) filter (where not row.skipped and coalesce(row.variance, 0) > 0) as shortage
    from requested
    join public.inventory_stock_checks check_header on check_header.id = requested.id
    left join public.inventory_stock_check_items row on row.stock_check_id = check_header.id
    group by check_header.id
  )
  select jsonb_build_object(
    'check_count', count(*),
    'summaries', coalesce(jsonb_agg(jsonb_build_object(
      'check_id', check_id, 'total', total, 'skipped', skipped,
      'shortage', shortage
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

revoke all on function public.inventory_dashboard_stock_evidence(uuid[]) from public, anon;
revoke all on function public.inventory_stock_check_row_summaries(uuid[]) from public, anon;
grant execute on function public.inventory_dashboard_stock_evidence(uuid[]) to authenticated;
grant execute on function public.inventory_stock_check_row_summaries(uuid[]) to authenticated;
