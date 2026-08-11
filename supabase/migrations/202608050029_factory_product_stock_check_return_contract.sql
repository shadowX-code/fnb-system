-- Return the authoritative Product Stock Check reference after the transactional
-- structure save. The previous SQL wrapper joined the newly inserted header in
-- the same statement snapshot and could therefore return no row after a
-- successful insert.
create or replace function public.factory_save_product_stock_check_structure(
  p_stock_check_id uuid,
  p_check_date date,
  p_notes text,
  p_target_status text,
  p_created_by uuid,
  p_rows jsonb
)
returns table (id uuid, check_no text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved_id uuid;
begin
  select saved.id
  into v_saved_id
  from public.factory_save_product_stock_check_structure_business_no_v1(
    p_stock_check_id,
    p_check_date,
    p_notes,
    p_target_status,
    p_created_by,
    p_rows
  ) saved;

  if v_saved_id is null then
    raise exception 'Product Stock Check save did not return a record.';
  end if;

  return query
  select stock_check.id, stock_check.check_no
  from public.factory_product_stock_checks stock_check
  where stock_check.id = v_saved_id;

  if not found then
    raise exception 'Saved Product Stock Check could not be reloaded.';
  end if;
end;
$$;

revoke execute on function public.factory_save_product_stock_check_structure(
  uuid, date, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.factory_save_product_stock_check_structure(
  uuid, date, text, text, uuid, jsonb
) to authenticated;

notify pgrst, 'reload schema';
