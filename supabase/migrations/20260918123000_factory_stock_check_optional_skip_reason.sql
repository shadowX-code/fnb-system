-- A skipped item is intentionally outside a physical-count snapshot. Its note
-- is useful evidence when supplied, but is not an adjustment prerequisite.
create or replace function public.factory_save_raw_material_stock_check_structure(
  p_stock_check_id uuid, p_category_id uuid, p_check_date date, p_notes text,
  p_target_status text, p_rows jsonb
) returns table (id uuid, check_no text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor_id uuid := public.factory_current_active_employee_id(); v_check public.factory_raw_material_stock_checks%rowtype;
  v_check_id uuid; v_check_no text; v_status text := lower(coalesce(nullif(btrim(p_target_status), ''), 'draft'));
  v_row jsonb; v_material public.factory_raw_materials%rowtype; v_material_id uuid; v_system_qty numeric; v_physical_qty numeric;
  v_variance_qty numeric; v_variance_percent numeric; v_variance_status text; v_count_status text; v_reason text;
begin
  if v_status not in ('draft', 'submitted') then raise exception 'Raw Material Stock Check status must be Draft or Submitted.'; end if;
  if p_category_id is null or not exists (select 1 from public.factory_raw_material_categories category where category.id = p_category_id) then raise exception 'Select a valid Raw Material category.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Raw Material Stock Check requires at least one item.'; end if;
  if v_status = 'submitted' and not public.current_user_has_permission('factory_raw_stock_check.submit') then raise exception using errcode = '42501', message = 'Insufficient permission to submit Raw Material Stock Check.'; end if;
  if p_stock_check_id is null then
    if not public.current_user_has_permission('factory_raw_stock_check.create') then raise exception using errcode = '42501', message = 'Insufficient permission to create Raw Material Stock Check.'; end if;
    insert into public.factory_raw_material_stock_checks (check_date, category_id, status, notes, created_by, created_at, updated_at) values (coalesce(p_check_date, timezone('Asia/Kuala_Lumpur', now())::date), p_category_id, 'draft', coalesce(p_notes, ''), v_actor_id, now(), now()) returning factory_raw_material_stock_checks.id, factory_raw_material_stock_checks.check_no into v_check_id, v_check_no;
  else
    if not (public.current_user_has_permission('factory_raw_stock_check.edit') or (v_status = 'submitted' and public.current_user_has_permission('factory_raw_stock_check.submit'))) then raise exception using errcode = '42501', message = 'Insufficient permission to edit Raw Material Stock Check.'; end if;
    select stock_check.* into v_check from public.factory_raw_material_stock_checks stock_check where stock_check.id = p_stock_check_id for update;
    if v_check.id is null then raise exception 'Raw Material Stock Check was not found.'; end if;
    if lower(coalesce(v_check.status, '')) <> 'draft' then raise exception 'Only Draft Raw Material Stock Checks can be edited or submitted.'; end if;
    v_check_id := v_check.id; v_check_no := v_check.check_no;
    update public.factory_raw_material_stock_checks stock_check set check_date = coalesce(p_check_date, stock_check.check_date), category_id = p_category_id, notes = coalesce(p_notes, ''), updated_at = now() where stock_check.id = v_check_id;
  end if;
  delete from public.factory_raw_material_stock_check_items item where item.stock_check_id = v_check_id;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_material_id := nullif(v_row ->> 'raw_material_id', '')::uuid;
    if exists (select 1 from public.factory_raw_material_stock_check_items item where item.stock_check_id = v_check_id and item.raw_material_id = v_material_id) then raise exception 'Raw Material appears more than once in this Stock Check.'; end if;
    select material.* into v_material from public.factory_raw_materials material where material.id = v_material_id and material.category_id = p_category_id and lower(coalesce(material.status, '')) = 'active' for update;
    if v_material.id is null then raise exception 'Every Stock Check row requires an active Raw Material in the selected category.'; end if;
    v_system_qty := coalesce(v_material.current_balance, 0);
    v_count_status := lower(coalesce(nullif(btrim(v_row ->> 'count_status'), ''), case when nullif(v_row ->> 'physical_qty', '') is null then 'pending' else 'counted' end));
    if v_count_status not in ('pending', 'counted', 'skip', 'skipped') then raise exception 'Raw Material Stock Check count status is invalid.'; end if;
    if v_count_status in ('skip', 'skipped') then v_count_status := 'skip'; v_physical_qty := v_system_qty;
    elsif nullif(v_row ->> 'physical_qty', '') is null then v_count_status := 'pending'; v_physical_qty := v_system_qty;
    else v_count_status := 'counted'; v_physical_qty := (v_row ->> 'physical_qty')::numeric; if v_physical_qty < 0 then raise exception 'Physical count cannot be negative.'; end if; end if;
    v_variance_qty := case when v_count_status = 'counted' then v_physical_qty - v_system_qty else 0 end;
    v_variance_percent := case when v_system_qty > 0 then (v_variance_qty / v_system_qty) * 100 else 0 end;
    v_variance_status := case when v_count_status = 'skip' then 'Skipped' when v_variance_qty = 0 then 'Normal' when v_system_qty <= 0 or abs(v_variance_percent) >= 5 then 'Critical' else 'Variance' end;
    v_reason := nullif(btrim(coalesce(v_row ->> 'variance_reason', '')), '');
    if v_status = 'submitted' and v_count_status = 'pending' then raise exception 'Submit requires every Raw Material Stock Check row to be counted or skipped.'; end if;
    if v_status = 'submitted' and v_count_status = 'counted' and v_variance_qty <> 0 and v_reason is null then raise exception 'Variance reason is required for Raw Material Stock Check adjustments.'; end if;
    insert into public.factory_raw_material_stock_check_items (stock_check_id, raw_material_id, system_qty, physical_qty, variance_qty, variance_percent, count_status, variance_status, variance_reason, uom, created_at, updated_at) values (v_check_id, v_material.id, v_system_qty, v_physical_qty, v_variance_qty, v_variance_percent, v_count_status, v_variance_status, coalesce(v_reason, ''), v_material.uom, now(), now());
  end loop;
  if v_status = 'submitted' then update public.factory_raw_material_stock_checks stock_check set status = 'submitted', submitted_by = v_actor_id, submitted_at = now(), updated_at = now() where stock_check.id = v_check_id and lower(stock_check.status) = 'draft'; if not found then raise exception 'Raw Material Stock Check is no longer Draft.'; end if; end if;
  return query select v_check_id, v_check_no;
end;
$$;
revoke all on function public.factory_save_raw_material_stock_check_structure(uuid, uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.factory_save_raw_material_stock_check_structure(uuid, uuid, date, text, text, jsonb) to authenticated;
