-- Separate aggregate Finished Goods stock from inventory that is currently
-- eligible for authoritative batch allocation. This migration changes only the
-- read model; batch balances and stock accounting remain unchanged.

drop function if exists public.factory_get_finished_good_batch_availability(uuid, uuid, date);
create or replace function public.factory_get_finished_good_batch_availability(
  p_finished_good_id uuid, p_dispatch_id uuid default null, p_dispatch_date date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not (
    public.current_user_has_permission('factory_finished_goods_dispatch.view')
    or public.current_user_has_permission('factory_finished_goods_dispatch.create')
    or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
    or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
    or public.current_user_has_permission('factory_product_stock_check.create')
    or public.current_user_has_permission('factory_product_stock_check.edit')
    or public.current_user_has_permission('factory_product_stock_check.approve')
  ) then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Finished Goods batches.';
  end if;

  with finished_good as (
    select finished_good.id, coalesce(finished_good.current_balance, 0) as aggregate_balance
    from public.factory_finished_goods finished_good
    where finished_good.id = p_finished_good_id
  ), provisional as (
    select allocation.batch_balance_id,
      sum(allocation.quantity) filter (
        where dispatch.status = 'draft'
          and (p_dispatch_id is null or dispatch.id <> p_dispatch_id)
      ) as dispatch_qty
    from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
    group by allocation.batch_balance_id
  ), check_provisional as (
    select adjustment.batch_balance_id, sum(adjustment.quantity) as quantity
    from public.factory_product_stock_check_batch_adjustments adjustment
    join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
    join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
    where stock_check.status in ('draft', 'submitted')
    group by adjustment.batch_balance_id
  ), classified as (
    select balance.id as batch_id, balance.production_id, balance.source_type as batch_type,
      balance.batch_no, balance.manufacturing_date, balance.expiry_date,
      balance.storage_location_id, coalesce(location.location_name, balance.storage_location) as storage_location,
      coalesce(location.location_type, balance.storage_location_type) as storage_location_type,
      location.status as storage_location_status, balance.opening_qty as produced_qty,
      balance.opening_qty - balance.current_balance as allocated_qty,
      coalesce(provisional.dispatch_qty, 0) + coalesce(check_provisional.quantity, 0) as provisional_qty,
      balance.current_balance,
      case
        when balance.source_type = 'legacy_unallocated' then 'Reconciliation Required'
        when balance.storage_location_id is null then 'Storage Location Missing'
        when location.id is null then 'Metadata unavailable'
        when lower(coalesce(location.status, '')) <> 'active' then 'Storage Location Archived'
        when lower(coalesce(location.location_type, '')) <> 'finished goods area' then 'Not a Finished Goods Area'
        when p_dispatch_date is not null and balance.expiry_date is not null
          and balance.expiry_date < p_dispatch_date then 'Expired'
        when nullif(btrim(balance.batch_no), '') is null then 'Metadata unavailable'
        else null
      end as exclusion_reason
    from public.factory_finished_good_batch_balances balance
    left join public.factory_storage_locations location on location.id = balance.storage_location_id
    left join provisional on provisional.batch_balance_id = balance.id
    left join check_provisional on check_provisional.batch_balance_id = balance.id
    where balance.finished_good_id = p_finished_good_id
      and balance.current_balance > 0
  ), totals as (
    select coalesce(sum(classified.current_balance) filter (where classified.exclusion_reason is null), 0) as allocatable_balance,
      coalesce(sum(classified.current_balance), 0) as represented_balance
    from classified
  )
  select jsonb_build_object(
    'finished_good_id', finished_good.id,
    'aggregate_balance', finished_good.aggregate_balance,
    'allocatable_batch_balance', totals.allocatable_balance,
    'unavailable_balance', greatest(finished_good.aggregate_balance - totals.allocatable_balance, 0),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', classified.batch_id,
        'production_id', classified.production_id,
        'batch_type', classified.batch_type,
        'batch_no', classified.batch_no,
        'manufacturing_date', classified.manufacturing_date,
        'expiry_date', classified.expiry_date,
        'storage_location_id', classified.storage_location_id,
        'storage_location', classified.storage_location,
        'storage_location_type', classified.storage_location_type,
        'storage_location_status', classified.storage_location_status,
        'produced_qty', classified.produced_qty,
        'allocated_qty', classified.allocated_qty,
        'provisional_qty', classified.provisional_qty,
        'available_qty', classified.current_balance
      ) order by classified.expiry_date asc nulls last,
        classified.manufacturing_date asc nulls last,
        classified.batch_no asc,
        classified.batch_id asc)
      from classified
      where classified.exclusion_reason is null
    ), '[]'::jsonb),
    'unavailable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', classified.batch_id,
        'production_id', classified.production_id,
        'batch_type', classified.batch_type,
        'batch_no', classified.batch_no,
        'manufacturing_date', classified.manufacturing_date,
        'expiry_date', classified.expiry_date,
        'storage_location_id', classified.storage_location_id,
        'storage_location', classified.storage_location,
        'storage_location_type', classified.storage_location_type,
        'storage_location_status', classified.storage_location_status,
        'unavailable_qty', classified.current_balance,
        'exclusion_reason', classified.exclusion_reason
      ) order by classified.expiry_date asc nulls last,
        classified.manufacturing_date asc nulls last,
        classified.batch_no asc,
        classified.batch_id asc)
      from classified
      where classified.exclusion_reason is not null
    ), '[]'::jsonb) || case
      when finished_good.aggregate_balance > totals.represented_balance then jsonb_build_array(jsonb_build_object(
        'batch_id', null,
        'production_id', null,
        'batch_type', 'legacy_unallocated',
        'batch_no', 'Legacy / Unallocated',
        'manufacturing_date', null,
        'expiry_date', null,
        'storage_location_id', null,
        'storage_location', null,
        'storage_location_type', null,
        'storage_location_status', null,
        'unavailable_qty', finished_good.aggregate_balance - totals.represented_balance,
        'exclusion_reason', 'Reconciliation Required'
      ))
      else '[]'::jsonb
    end
  )
  into v_result
  from finished_good
  cross join totals;

  if v_result is null then
    raise exception 'Packaging SKU not found.';
  end if;

  return v_result;
end;
$$;

revoke all on function public.factory_get_finished_good_batch_availability(uuid, uuid, date) from public;
grant execute on function public.factory_get_finished_good_batch_availability(uuid, uuid, date) to authenticated;
