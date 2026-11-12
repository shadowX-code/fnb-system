-- Staging only. Uses disposable QA batch fixtures and rolls back every change.
begin;
do $qa$
declare
  v_short_sku uuid;
  v_zero_sku uuid;
  v_short_batch uuid;
  v_zero_batch uuid;
  v_location uuid;
  v_check uuid;
  v_rows jsonb;
  v_complete_rows jsonb;
begin
  perform set_config('request.jwt.claim.sub', (
    select employee.auth_user_id::text from public.employees employee
    join public.roles role on role.id = employee.role_id
    where lower(role.name) = 'owner' and employee.auth_user_id is not null limit 1
  ), true);

  select sku.id, batch.id, batch.storage_location_id into strict v_short_sku, v_short_batch, v_location
  from public.factory_finished_goods sku
  join public.factory_finished_good_batch_balances batch on batch.finished_good_id = sku.id
  join public.factory_storage_locations location on location.id = batch.storage_location_id
  where sku.product_code = 'QA-REV-16' and batch.batch_no = 'QA-REV-BATCH-16'
    and sku.current_balance = 10 and batch.current_balance = 10
    and location.status = 'active' and location.is_storage_location and location.location_type = 'Freezer';
  select sku.id, batch.id into strict v_zero_sku, v_zero_batch
  from public.factory_finished_goods sku
  join public.factory_finished_good_batch_balances batch on batch.finished_good_id = sku.id
  where sku.product_code = 'QA-REV-02' and batch.batch_no = 'QA-REV-BATCH-02'
    and sku.current_balance = 6 and batch.current_balance = 6;

  v_rows := jsonb_build_array(
    jsonb_build_object('finished_good_id', v_short_sku, 'physical_qty', 5, 'allocations',
      jsonb_build_array(jsonb_build_object('batch_balance_id', v_short_batch, 'quantity', 1))),
    jsonb_build_object('finished_good_id', v_zero_sku, 'physical_qty', 0)
  );
  select saved.id into strict v_check from public.factory_save_product_stock_check_structure(
    null, current_date, 'QA rollback only', 'draft', null, v_rows
  ) saved;
  assert (select count(*) from public.factory_product_stock_check_items
    where stock_check_id = v_check and count_status = 'counted' and variance_status = 'Critical'
      and (physical_qty, variance_qty) in ((5, -5), (0, -6))) = 2, 'Draft preserved shortage and counted zero';
  assert (select count(*) from public.factory_product_stock_check_batch_adjustments adjustment
    join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
    where item.stock_check_id = v_check and adjustment.quantity = 1) = 1, 'Draft preserved partial allocation';

  begin
    perform public.factory_approve_product_stock_check(v_check, null);
    raise exception 'Draft was approved';
  exception when raise_exception then
    if sqlerrm <> 'Only submitted stock checks can be approved.' then raise; end if;
  end;
  begin
    perform public.factory_save_product_stock_check_structure(v_check, current_date, '', 'submitted', null, v_rows);
    raise exception 'Incomplete counts were submitted';
  exception when raise_exception then
    if sqlerrm <> 'Complete each counted item and resolve every variance before submitting.' then raise; end if;
  end;

  v_rows := jsonb_set(jsonb_set(v_rows, '{0,variance_reason}', '"QA shortage"'), '{1,variance_reason}', '"QA zero count"');
  begin
    perform public.factory_save_product_stock_check_structure(v_check, current_date, '', 'submitted', null, v_rows);
    raise exception 'Partially allocated shortage was submitted';
  exception when raise_exception then
    if sqlerrm <> 'Complete each counted item and resolve every variance before submitting.' then raise; end if;
  end;

  v_complete_rows := jsonb_set(v_rows, '{0,allocations,0,quantity}', '5');
  v_complete_rows := jsonb_set(v_complete_rows, '{1,allocations}',
    jsonb_build_array(jsonb_build_object('batch_balance_id', v_zero_batch, 'quantity', 6)));
  begin
    update public.factory_storage_locations set is_storage_location = false where id = v_location;
    perform public.factory_save_product_stock_check_structure(v_check, current_date, '', 'draft', null, v_complete_rows);
    perform public.factory_save_product_stock_check_structure(v_check, current_date, '', 'submitted', null, v_complete_rows);
    raise exception 'Unavailable allocation was submitted';
  exception when raise_exception then
    if sqlerrm <> 'Replace batch allocations in unavailable storage locations before submitting.' then raise; end if;
  end;

  begin
    update public.factory_finished_good_batch_balances set current_balance = 5 where id = v_zero_batch;
    perform public.factory_save_product_stock_check_structure(v_check, current_date, '', 'draft', null, v_complete_rows);
    perform public.factory_save_product_stock_check_structure(v_check, current_date, '', 'submitted', null, v_complete_rows);
    raise exception 'Unreconciled inventory was submitted';
  exception when raise_exception then
    if sqlerrm <> 'Reconcile Finished Goods batch inventory before submitting this Stock Check.' then raise; end if;
  end;

  assert (select status from public.factory_product_stock_checks where id = v_check) = 'draft', 'Rejected submits keep draft editable';
  perform public.factory_save_product_stock_check_structure(v_check, current_date, '', 'submitted', null, v_complete_rows);
  assert (select status from public.factory_product_stock_checks where id = v_check) = 'submitted', 'Complete shortage submitted';
  assert (select current_balance from public.factory_finished_goods where id = v_short_sku) = 10
    and (select current_balance from public.factory_finished_goods where id = v_zero_sku) = 6
    and (select current_balance from public.factory_finished_good_batch_balances where id = v_short_batch) = 10
    and (select current_balance from public.factory_finished_good_batch_balances where id = v_zero_batch) = 6, 'Draft and Submit left balances intact';
  assert not exists (select 1 from public.factory_product_stock_movements where reference_type = 'product_stock_check' and reference_id = v_check), 'Draft and Submit posted no movements';

  perform public.factory_approve_product_stock_check(v_check, null);
  assert (select status from public.factory_product_stock_checks where id = v_check) = 'approved', 'Approval finalized the check';
  assert (select current_balance from public.factory_finished_goods where id = v_short_sku) = 5
    and (select current_balance from public.factory_finished_goods where id = v_zero_sku) = 0
    and (select current_balance from public.factory_finished_good_batch_balances where id = v_short_batch) = 5
    and (select current_balance from public.factory_finished_good_batch_balances where id = v_zero_batch) = 0, 'Approval applied exact SKU and batch reductions';
  assert (select count(*) from public.factory_product_stock_movements
    where reference_type = 'product_stock_check' and reference_id = v_check and quantity in (-5, -6)) = 2, 'Approval posted one adjustment per SKU';
  begin
    perform public.factory_approve_product_stock_check(v_check, null);
    raise exception 'Approval was repeated';
  exception when raise_exception then
    if sqlerrm <> 'Only submitted stock checks can be approved.' then raise; end if;
  end;
end $qa$;
select 'Finished Goods draft/submit/approval regression passed' as result;
rollback;
