-- Read-only dashboard summary over the canonical global cost revisions.
create function public.inventory_dashboard_cost_insights(p_outlet_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_start date := v_today - 29;
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_dashboard.view')
     or not (public.current_user_has_permission('inventory_master.view')
             or public.current_user_has_permission('inventory_control.view')) then
    raise exception 'Inventory Dashboard and standard cost access are required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_outlet_ids), 0) = 0 or exists (
    select 1 from unnest(p_outlet_ids) requested(outlet_id)
    where requested.outlet_id is null or not public.current_user_can_access_outlet(requested.outlet_id)
  ) then
    raise exception 'Inventory outlet scope is unavailable.' using errcode = '42501';
  end if;

  with scoped_items as (
    select item.id, item.item_name, item.cost_revision_id
    from public.inventory_items item
    where coalesce(lower(item.status), 'active') not in ('inactive', 'archived', 'deleted')
      and exists (
        select 1 from public.inventory_item_outlets link
        where link.inventory_item_id = item.id and link.outlet_id = any(p_outlet_ids)
          and link.is_active is not false
      )
  ), latest as (
    select distinct on (revision.item_id)
      revision.item_id, revision.unit, revision.unit_cost, revision.effective_date
    from scoped_items item
    join inventory_authority.item_cost_revisions revision on revision.item_id = item.id
    where revision.effective_date between v_start and v_today
      and not exists (select 1 from inventory_authority.item_cost_revisions successor
        where successor.supersedes_revision_id = revision.id)
    order by revision.item_id, revision.effective_date desc, revision.revision_number desc
  ), changes as (
    -- Compare with the effective cost entering the window. A first configuration
    -- within the window can be a comparison only when a later dated price exists.
    select latest.item_id, item.item_name, latest.unit, latest.effective_date,
      basis.unit_cost as previous_cost, latest.unit_cost,
      latest.unit_cost - basis.unit_cost as delta
    from latest
    join scoped_items item on item.id = latest.item_id
    join lateral (
      select revision.unit_cost, revision.unit
      from inventory_authority.item_cost_revisions revision
      where revision.item_id = latest.item_id
        and (revision.effective_date is null or revision.effective_date <= latest.effective_date)
        and not exists (select 1 from inventory_authority.item_cost_revisions successor
          where successor.supersedes_revision_id = revision.id)
      order by
        coalesce(revision.effective_date >= v_start, false) asc,
        case when revision.effective_date < v_start then revision.effective_date end desc nulls last,
        revision.effective_date asc nulls first,
        revision.revision_number desc
      limit 1
    ) basis on lower(btrim(basis.unit)) = lower(btrim(latest.unit))
    where latest.unit_cost <> basis.unit_cost
  )
  select jsonb_build_object(
    'start_date', v_start, 'end_date', v_today,
    'increases', count(*) filter (where delta > 0),
    'decreases', count(*) filter (where delta < 0),
    'missing_costs', (select count(*) from scoped_items where cost_revision_id is null),
    'largest_increase', (select to_jsonb(peak) from changes peak where peak.delta > 0
      order by peak.delta desc, peak.item_id limit 1),
    'top_changes', coalesce((select jsonb_agg(to_jsonb(ranked) order by abs(ranked.delta) desc, ranked.item_id)
      from (select * from changes order by abs(delta) desc, item_id limit 5) ranked), '[]'::jsonb)
  ) into v_result from changes;
  return v_result;
end;
$$;

revoke all on function public.inventory_dashboard_cost_insights(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.inventory_dashboard_cost_insights(uuid[]) to authenticated;
