-- Finished-goods Stock Check reconciliation batches use their own short,
-- approval-date business number. Historical and Production batch numbers stay
-- immutable and outside this sequence.

create unique index if not exists factory_finished_good_batch_balances_adjustment_batch_no_key
  on public.factory_finished_good_batch_balances (batch_no)
  where source_type = 'adjustment'
    and batch_no ~ '^ADJ-FGSC[0-9]{6}-[0-9]+$';

create or replace function public.factory_approve_product_stock_check(p_stock_check_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_check public.factory_product_stock_checks%rowtype;
  v_item record; v_adjustment record; v_batch public.factory_finished_good_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype; v_total numeric; v_batch_total numeric;
  v_approval_date date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_adjustment_prefix text := 'ADJ-FGSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD');
  v_adjustment_sequence integer;
  v_adjustment_batch_no text;
begin
  if not public.current_user_has_permission('factory_product_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Insufficient permission to approve Product Stock Check.';
  end if;
  select * into v_check from public.factory_product_stock_checks where id = p_stock_check_id for update;
  if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
  if v_check.status <> 'submitted' then raise exception 'Only submitted stock checks can be approved.'; end if;

  -- Every new reconciliation batch approved on this Factory business date shares
  -- one serialized sequence, including multiple SKU adjustments in this check.
  perform pg_advisory_xact_lock(hashtextextended('factory_product_stock_check_adjustment:' || v_adjustment_prefix, 0));

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

        select coalesce(max((substring(balance.batch_no from ('^' || v_adjustment_prefix || '-([0-9]+)$')))::integer), 0) + 1
        into v_adjustment_sequence
        from public.factory_finished_good_batch_balances balance
        where balance.source_type = 'adjustment'
          and balance.batch_no ~ ('^' || v_adjustment_prefix || '-[0-9]+$');
        v_adjustment_batch_no := v_adjustment_prefix || '-' || public.factory_format_business_sequence(v_adjustment_sequence);

        insert into public.factory_finished_good_batch_balances (
          finished_good_id, source_type, source_reference_id, source_reference_no, batch_no, manufacturing_date,
          storage_location_id, storage_location, storage_location_type, opening_qty, current_balance, remarks
        ) values (
          v_item.finished_good_id, 'adjustment', p_stock_check_id, v_check.check_no, v_adjustment_batch_no,
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

revoke execute on function public.factory_approve_product_stock_check(uuid, uuid) from public, anon;
grant execute on function public.factory_approve_product_stock_check(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
