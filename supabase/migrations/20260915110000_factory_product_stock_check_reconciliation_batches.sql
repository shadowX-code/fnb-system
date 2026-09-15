-- Finished-goods Stock Checks reconcile verified physical stock without
-- fabricating Production batches. A positive variance either credits a selected
-- existing batch or creates one adjustment batch per Stock Check / SKU.

alter table public.factory_product_stock_check_items
  add column if not exists positive_adjustment_batch_balance_id uuid
  references public.factory_finished_good_batch_balances(id) on delete restrict;

drop index if exists public.factory_finished_good_batch_balances_adjustment_key;
create unique index if not exists factory_finished_good_batch_balances_adjustment_source_key
  on public.factory_finished_good_batch_balances (source_reference_id, finished_good_id)
  where source_type = 'adjustment';

create or replace function public.factory_list_product_stock_check_positive_batches(p_finished_good_id uuid)
returns table (batch_balance_id uuid, batch_no text, source_type text, current_balance numeric, storage_location_id uuid, storage_location text, storage_location_type text)
language sql stable security invoker set search_path = public as $$
  select balance.id, balance.batch_no, balance.source_type, balance.current_balance,
    balance.storage_location_id, location.location_name, location.location_type
  from public.factory_finished_good_batch_balances balance
  join public.factory_storage_locations location on location.id = balance.storage_location_id
  where balance.finished_good_id = p_finished_good_id
    and lower(coalesce(location.status, '')) = 'active'
    and location.is_storage_location is true
  order by balance.manufacturing_date nulls last, balance.batch_no, balance.id;
$$;
revoke execute on function public.factory_list_product_stock_check_positive_batches(uuid) from public, anon;
grant execute on function public.factory_list_product_stock_check_positive_batches(uuid) to authenticated;

create or replace function public.factory_save_product_stock_check_structure(
  p_stock_check_id uuid, p_check_date date, p_notes text, p_target_status text,
  p_created_by uuid, p_rows jsonb
)
returns table (id uuid, check_no text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_saved_id uuid;
  v_base_rows jsonb;
  v_invalid boolean;
begin
  -- The established structure saver owns the snapshot and negative allocation
  -- contract. Positive intent is applied after it saves the immutable rows.
  select coalesce(jsonb_agg(jsonb_set(row, '{positive_adjustment_confirmed}', 'false'::jsonb)), '[]'::jsonb)
  into v_base_rows
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) row;

  select saved.id into v_saved_id
  from public.factory_save_product_stock_check_structure_business_no_v1(
    p_stock_check_id, p_check_date, p_notes, p_target_status, p_created_by, v_base_rows
  ) saved;
  if v_saved_id is null then raise exception 'Product Stock Check save did not return a record.'; end if;

  if lower(coalesce(p_target_status, 'draft')) = 'submitted' then
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

  return query select stock_check.id, stock_check.check_no
  from public.factory_product_stock_checks stock_check where stock_check.id = v_saved_id;
end;
$$;

create or replace function public.factory_approve_product_stock_check(p_stock_check_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_check public.factory_product_stock_checks%rowtype;
  v_item record; v_adjustment record; v_batch public.factory_finished_good_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype; v_total numeric; v_batch_total numeric;
begin
  if not public.current_user_has_permission('factory_product_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Insufficient permission to approve Product Stock Check.';
  end if;
  select * into v_check from public.factory_product_stock_checks where id = p_stock_check_id for update;
  if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
  if v_check.status <> 'submitted' then raise exception 'Only submitted stock checks can be approved.'; end if;

  for v_item in
    select item.*, sku.product_name, sku.storage_location_id as current_default_storage_location_id
    from public.factory_product_stock_check_items item
    join public.factory_finished_goods sku on sku.id = item.finished_good_id
    where item.stock_check_id = p_stock_check_id order by item.finished_good_id, item.id for update of item
  loop
    if lower(coalesce(v_item.count_status, 'counted')) = 'skip' or v_item.variance_status = 'Skipped' then continue; end if;
    if v_item.variance_qty <> 0 and coalesce(btrim(v_item.variance_reason), '') = '' then
      raise exception 'Variance reason is required for Product Stock Check adjustments.';
    end if;
    select coalesce(sum(balance.current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances balance where balance.finished_good_id = v_item.finished_good_id;
    if abs(v_batch_total - v_item.system_qty) > 0.0001 then
      raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before approval.', v_item.product_name;
    end if;
    if v_item.variance_qty < 0 then
      select coalesce(sum(adjustment.quantity), 0) into v_total from public.factory_product_stock_check_batch_adjustments adjustment where adjustment.stock_check_item_id = v_item.id;
      if v_total <> abs(v_item.variance_qty) then raise exception 'Negative Product Stock Check variance must be fully allocated across batches.'; end if;
      for v_adjustment in select * from public.factory_product_stock_check_batch_adjustments where stock_check_item_id = v_item.id order by batch_balance_id, id loop
        select * into v_batch from public.factory_finished_good_batch_balances where id = v_adjustment.batch_balance_id for update;
        select * into v_location from public.factory_storage_locations where id = v_batch.storage_location_id;
        if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id or v_batch.current_balance < v_adjustment.quantity
          or v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active' or v_location.is_storage_location is not true then
          raise exception 'Batch stock has changed. Review the suggested resolution again.';
        end if;
        update public.factory_finished_good_batch_balances set current_balance = current_balance - v_adjustment.quantity, updated_at = now() where id = v_batch.id;
      end loop;
    elsif v_item.variance_qty > 0 then
      if not v_item.positive_adjustment_confirmed then raise exception 'Reconciliation Batch intent is required for a positive Product Stock Check variance.'; end if;
      if v_item.positive_adjustment_batch_balance_id is not null then
        select * into v_batch from public.factory_finished_good_batch_balances where id = v_item.positive_adjustment_batch_balance_id for update;
        select * into v_location from public.factory_storage_locations where id = v_batch.storage_location_id;
        if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id
          or v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active' or v_location.is_storage_location is not true then
          raise exception 'Selected reconciliation batch is no longer available.';
        end if;
        update public.factory_finished_good_batch_balances set current_balance = current_balance + v_item.variance_qty, updated_at = now() where id = v_batch.id;
      else
        select * into v_location from public.factory_storage_locations where id = v_item.adjustment_storage_location_id;
        if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active' or v_location.is_storage_location is not true then
          raise exception 'Reconciliation Batch requires an active storage location.';
        end if;
        insert into public.factory_finished_good_batch_balances (
          finished_good_id, source_type, source_reference_id, source_reference_no, batch_no, manufacturing_date,
          storage_location_id, storage_location, storage_location_type, opening_qty, current_balance, remarks
        ) values (
          v_item.finished_good_id, 'adjustment', p_stock_check_id, v_check.check_no,
          'ADJ-' || v_check.check_no || '-' || coalesce(nullif(v_item.product_name, ''), left(v_item.finished_good_id::text, 8)),
          v_check.check_date, v_location.id, v_location.location_name, v_location.location_type,
          v_item.variance_qty, v_item.variance_qty, v_item.variance_reason
        );
      end if;
    end if;
    if v_item.variance_qty <> 0 then
      perform public.factory_adjust_finished_good_balance(v_item.finished_good_id, v_item.variance_qty);
      insert into public.factory_product_stock_movements (
        finished_good_id, product_name, movement_type, quantity, uom, reference_type, reference_id, reference_no,
        movement_date, notes, created_by
      ) values (
        v_item.finished_good_id, v_item.product_name, 'Stock Check Adjustment', v_item.variance_qty, v_item.uom,
        'product_stock_check', p_stock_check_id, v_check.check_no, coalesce(v_check.check_date, current_date),
        case when v_item.positive_adjustment_batch_balance_id is null then 'Approved finished goods Stock Check reconciliation batch.' else 'Approved finished goods Stock Check adjustment to an existing batch.' end,
        public.factory_current_active_employee_id()
      );
    end if;
  end loop;
  update public.factory_product_stock_checks set status = 'approved', approved_by = public.factory_current_active_employee_id(),
    approved_at = now(), submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_stock_check_id;
end;
$$;

revoke execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb) from public, anon;
grant execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb) to authenticated;
revoke execute on function public.factory_approve_product_stock_check(uuid, uuid) from public, anon;
grant execute on function public.factory_approve_product_stock_check(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
