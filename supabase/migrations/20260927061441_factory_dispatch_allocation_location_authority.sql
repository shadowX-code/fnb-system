-- Saved allocations use the same storage authority as Dispatch availability and completion.
-- Location type is display taxonomy, not inventory eligibility.
create or replace function public.factory_get_finished_good_dispatch_allocation_details(p_dispatch_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.view') then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Dispatch batch allocations.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'dispatch_id', item.dispatch_id,
    'dispatch_item_id', item.id,
    'allocation_id', allocation.id,
    'batch_balance_id', allocation.batch_balance_id,
    'production_id', allocation.production_id,
    'quantity', allocation.quantity,
    'batch_no', coalesce(balance.batch_no, allocation.batch_no),
    'batch_type', coalesce(balance.source_type, 'production'),
    'manufacturing_date', coalesce(balance.manufacturing_date, allocation.manufacturing_date),
    'expiry_date', coalesce(balance.expiry_date, allocation.expiry_date),
    'storage_location_id', coalesce(balance.storage_location_id, allocation.storage_location_id),
    'storage_location', coalesce(location.location_name, balance.storage_location, allocation.storage_location),
    'storage_location_type', coalesce(location.location_type, balance.storage_location_type, allocation.storage_location_type),
    'storage_location_status', location.status,
    'current_balance', balance.current_balance,
    'location_valid', location.id is not null
      and lower(coalesce(location.status, '')) = 'active'
      and coalesce(location.is_storage_location, false),
    'location_issue', case
      when coalesce(balance.storage_location_id, allocation.storage_location_id) is null or location.id is null then 'Storage location missing'
      when lower(coalesce(location.status, '')) <> 'active' then 'Storage location archived'
      when coalesce(location.is_storage_location, false) is not true then 'Storage location is not storage-enabled'
      else '' end
  ) order by item.dispatch_id, item.created_at, item.id, allocation.created_at, allocation.id), '[]'::jsonb)
  into v_result
  from public.factory_finished_good_dispatch_batch_allocations allocation
  join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
  left join public.factory_finished_good_batch_balances balance on balance.id = allocation.batch_balance_id
  left join public.factory_storage_locations location on location.id = coalesce(balance.storage_location_id, allocation.storage_location_id)
  where item.dispatch_id = any(coalesce(p_dispatch_ids, array[]::uuid[]));
  return v_result;
end;
$$;

revoke all on function public.factory_get_finished_good_dispatch_allocation_details(uuid[]) from public;
grant execute on function public.factory_get_finished_good_dispatch_allocation_details(uuid[]) to authenticated;
