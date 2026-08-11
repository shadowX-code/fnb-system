-- Ensure live Stock Check permission revocation reaches the UI as SQLSTATE 42501.
-- Existing table RLS also supports aggregate Dashboard/Inventory reads, so the
-- operator-facing listing performs this explicit module-view assertion first.

create or replace function public.factory_assert_stock_check_view(
  p_stock_type text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_stock_type text := lower(nullif(btrim(p_stock_type), ''));
  v_permission text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to view Factory Stock Checks.';
  end if;

  v_permission := case v_stock_type
    when 'raw' then 'factory_raw_stock_check.view'
    when 'product' then 'factory_product_stock_check.view'
    else null
  end;

  if v_permission is null then
    raise exception 'Unsupported Factory Stock Check type.';
  end if;

  if not public.current_user_has_permission(v_permission) then
    raise exception using
      errcode = '42501',
      message = case v_stock_type
        when 'raw' then 'Insufficient permission to view Raw Material Stock Checks.'
        else 'Insufficient permission to view Product Stock Checks.'
      end;
  end if;

  return true;
end;
$$;

revoke all on function public.factory_assert_stock_check_view(text) from public, anon;
grant execute on function public.factory_assert_stock_check_view(text) to authenticated;
