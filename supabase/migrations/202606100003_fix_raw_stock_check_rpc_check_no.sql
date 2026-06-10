-- Patch deployed raw material stock check RPC.
-- 202606100002 was already applied before check_no was qualified, so this migration replaces the function in-place.

create or replace function public.factory_create_raw_material_stock_check(
  p_category_id uuid,
  p_check_date date,
  p_notes text,
  p_rows jsonb
)
returns table(id uuid, check_no text)
language plpgsql
security invoker
as $$
declare
  v_check_date date := coalesce(p_check_date, current_date);
  v_yymmdd text := to_char(coalesce(p_check_date, current_date), 'YYMMDD');
  v_next integer;
  v_check_id uuid;
  v_check_no text;
  v_created_by uuid;
  v_row jsonb;
begin
  if not public.current_user_has_permission('factory_raw_stock_check.create') then
    raise exception 'Missing permission to create raw material stock checks.';
  end if;

  if p_category_id is null then
    raise exception 'Category is required for raw material stock check.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Stock check requires at least one item row.';
  end if;

  select e.id into v_created_by
  from public.employees e
  where e.auth_user_id = auth.uid()
     or lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by e.created_at desc nulls last
  limit 1;

  perform pg_advisory_xact_lock(hashtextextended('factory_raw_material_stock_check:RMSC:' || v_yymmdd, 0));

  select coalesce(max((substring(rmsc.check_no from ('^RMSC-' || v_yymmdd || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_raw_material_stock_checks rmsc
  where rmsc.check_no ~ ('^RMSC-' || v_yymmdd || '-[0-9]+$');

  v_check_no := 'RMSC-' || v_yymmdd || '-' || lpad(v_next::text, 3, '0');

  insert into public.factory_raw_material_stock_checks (
    check_no,
    check_date,
    category_id,
    status,
    notes,
    created_by,
    updated_at
  )
  values (
    v_check_no,
    v_check_date,
    p_category_id,
    'draft',
    coalesce(p_notes, ''),
    v_created_by,
    now()
  )
  returning factory_raw_material_stock_checks.id into v_check_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    insert into public.factory_raw_material_stock_check_items (
      stock_check_id,
      raw_material_id,
      system_qty,
      physical_qty,
      variance_qty,
      variance_percent,
      count_status,
      variance_status,
      variance_reason,
      uom,
      updated_at
    )
    values (
      v_check_id,
      nullif(v_row ->> 'raw_material_id', '')::uuid,
      coalesce((v_row ->> 'system_qty')::numeric, 0),
      coalesce((v_row ->> 'physical_qty')::numeric, coalesce((v_row ->> 'system_qty')::numeric, 0)),
      coalesce((v_row ->> 'variance_qty')::numeric, 0),
      coalesce((v_row ->> 'variance_percent')::numeric, 0),
      coalesce(nullif(v_row ->> 'count_status', ''), 'counted'),
      coalesce(nullif(v_row ->> 'variance_status', ''), 'Normal'),
      coalesce(v_row ->> 'variance_reason', ''),
      coalesce(v_row ->> 'uom', ''),
      now()
    );
  end loop;

  return query select v_check_id as id, v_check_no as check_no;
end;
$$;

grant execute on function public.factory_create_raw_material_stock_check(uuid, date, text, jsonb) to authenticated;
