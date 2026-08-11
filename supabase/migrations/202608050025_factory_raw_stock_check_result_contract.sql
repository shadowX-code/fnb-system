-- Restore the Raw Material Stock Check create RPC result contract.
--
-- The 050020 SQL wrapper joined the newly inserted row back to the header table
-- within the same statement snapshot. PostgreSQL does not expose the nested
-- function's write to that outer join, so a successful insert returned zero rows.
-- The authoritative legacy function already returns both values; forward them
-- directly so a committed mutation cannot be mistaken for a failed save.

create or replace function public.factory_create_raw_material_stock_check(
  p_category_id uuid,
  p_check_date date,
  p_notes text,
  p_rows jsonb
)
returns table (id uuid, check_no text)
language sql
security invoker
set search_path = public
as $$
  select result.id, result.check_no
  from public.factory_create_raw_material_stock_check_business_no_v1(
    p_category_id,
    p_check_date,
    p_notes,
    p_rows
  ) result;
$$;

revoke all on function public.factory_create_raw_material_stock_check(
  uuid, date, text, jsonb
) from public, anon;
grant execute on function public.factory_create_raw_material_stock_check(
  uuid, date, text, jsonb
) to authenticated;
