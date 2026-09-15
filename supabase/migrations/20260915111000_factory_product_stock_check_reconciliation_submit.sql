-- Submit reconciliation checks through the established draft writer first.
-- The previous writer predates reconciliation batches and rejects an intentional
-- unassigned positive variance before the wrapper can retain its provenance.

create or replace function public.factory_save_product_stock_check_structure(
  p_stock_check_id uuid, p_check_date date, p_notes text, p_target_status text,
  p_created_by uuid, p_rows jsonb
)
returns table (id uuid, check_no text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_saved_id uuid;
  v_base_rows jsonb;
  v_submitting boolean := lower(coalesce(p_target_status, 'draft')) = 'submitted';
  v_invalid boolean;
begin
  if v_submitting and not public.current_user_has_permission('factory_product_stock_check.submit') then
    raise exception using errcode = '42501', message = 'Insufficient permission to submit Product Stock Check.';
  end if;

  -- The established writer owns the draft snapshot and negative allocations.
  -- It cannot receive `submitted` for reconciliation intent because its legacy
  -- positive-variance guard requires a pre-existing adjustment batch.
  select coalesce(jsonb_agg(jsonb_set(row, '{positive_adjustment_confirmed}', 'false'::jsonb)), '[]'::jsonb)
  into v_base_rows
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) row;

  select saved.id into v_saved_id
  from public.factory_save_product_stock_check_structure_business_no_v1(
    p_stock_check_id, p_check_date, p_notes,
    case when v_submitting then 'draft' else lower(coalesce(p_target_status, 'draft')) end,
    p_created_by, v_base_rows
  ) saved;
  if v_saved_id is null then raise exception 'Product Stock Check save did not return a record.'; end if;

  if v_submitting then
    select exists (
      select 1
      from public.factory_product_stock_check_items item
      where item.stock_check_id = v_saved_id
        and lower(coalesce(item.count_status, '')) <> 'skip'
        and (
          lower(coalesce(item.count_status, '')) = 'pending'
          or (item.variance_qty <> 0 and coalesce(btrim(item.variance_reason), '') = '')
          or (
            item.variance_qty < 0
            and coalesce((
              select sum(adjustment.quantity)
              from public.factory_product_stock_check_batch_adjustments adjustment
              where adjustment.stock_check_item_id = item.id
            ), 0) <> abs(item.variance_qty)
          )
        )
    ) into v_invalid;
    if v_invalid then
      raise exception 'Complete each counted item and resolve every variance before submitting.';
    end if;

    select exists (
      select 1
      from public.factory_product_stock_check_items item
      join public.factory_finished_goods sku on sku.id = item.finished_good_id
      join lateral (
        select row from jsonb_array_elements(p_rows) row
        where nullif(row->>'finished_good_id', '')::uuid = item.finished_good_id
        limit 1
      ) requested on true
      left join public.factory_finished_good_batch_balances selected_batch
        on selected_batch.id = nullif(requested.row->>'positive_adjustment_batch_balance_id', '')::uuid
      left join public.factory_storage_locations selected_location
        on selected_location.id = selected_batch.storage_location_id
      left join public.factory_storage_locations default_location
        on default_location.id = sku.storage_location_id
      where item.stock_check_id = v_saved_id
        and item.variance_qty > 0
        and (
          not coalesce(nullif(requested.row->>'positive_adjustment_confirmed', '')::boolean, false)
          or (
            selected_batch.id is not null
            and (selected_batch.finished_good_id <> item.finished_good_id
              or lower(coalesce(selected_location.status, '')) <> 'active'
              or selected_location.is_storage_location is not true)
          )
          or (
            selected_batch.id is null
            and (default_location.id is null
              or lower(coalesce(default_location.status, '')) <> 'active'
              or default_location.is_storage_location is not true)
          )
        )
    ) into v_invalid;
    if v_invalid then
      raise exception 'Choose a valid existing batch or configure an active storage location for the Reconciliation Batch before submitting.';
    end if;
  end if;

  update public.factory_product_stock_check_items item
  set positive_adjustment_confirmed = coalesce(nullif(requested.row->>'positive_adjustment_confirmed', '')::boolean, false),
      positive_adjustment_batch_balance_id = nullif(requested.row->>'positive_adjustment_batch_balance_id', '')::uuid,
      adjustment_storage_location_id = case
        when item.variance_qty > 0 and nullif(requested.row->>'positive_adjustment_batch_balance_id', '') is null then sku.storage_location_id
        else null
      end,
      updated_at = now()
  from public.factory_finished_goods sku
  join lateral (
    select row from jsonb_array_elements(p_rows) row
    where nullif(row->>'finished_good_id', '')::uuid = sku.id
    limit 1
  ) requested on true
  where item.stock_check_id = v_saved_id and item.finished_good_id = sku.id;

  if v_submitting then
    update public.factory_product_stock_checks
    set status = 'submitted',
        submitted_by = coalesce(p_created_by, public.factory_current_active_employee_id()),
        submitted_at = now(),
        updated_at = now()
    where id = v_saved_id;
  end if;

  return query select stock_check.id, stock_check.check_no
  from public.factory_product_stock_checks stock_check where stock_check.id = v_saved_id;
end;
$$;

revoke execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb) from public, anon;
grant execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
