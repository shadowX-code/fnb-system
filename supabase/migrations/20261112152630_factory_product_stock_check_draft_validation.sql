-- Keep the existing Admin and machine callers on the same stock-check authority.
do $migration$
declare
  v_writer constant regprocedure := 'feedx_integrations.fa_save_product_stock_check_structure_business_no_v1(uuid,uuid,date,text,text,uuid,jsonb)'::regprocedure;
  v_save constant regprocedure := 'feedx_integrations.fa_save_product_stock_check_structure(uuid,uuid,date,text,text,uuid,jsonb)'::regprocedure;
  v_definition text;
begin
  if (select md5(prosrc) from pg_proc where oid = v_writer) is distinct from '2b58ba774b780dede0274dab3e10ba1b'
    or (select md5(prosrc) from pg_proc where oid = v_save) is distinct from '6a4f557436cdd816117b1a89f9fb286f' then
    raise exception 'Unexpected Finished Goods Stock Check save authority. Review the current definition before applying.';
  end if;

  v_definition := pg_get_functiondef(v_writer);
  v_definition := replace(v_definition, $old$      if v_batch.current_balance < v_allocation_qty then
        raise exception 'Stock Check batch allocation exceeds its current balance.';
      end if;
      select location.* into v_location
      from public.factory_storage_locations location
      where location.id = v_batch.storage_location_id;
      if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Stock Check batch must be in an active Finished Goods storage location.';
      end if;$old$, $new$      -- A draft allocation is a proposal. The submit authority validates current availability.
      if v_status = 'submitted' then
        if v_batch.current_balance < v_allocation_qty then
          raise exception 'Stock Check batch allocation exceeds its current balance.';
        end if;
        select location.* into v_location
        from public.factory_storage_locations location
        where location.id = v_batch.storage_location_id;
        if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
          or v_location.is_storage_location is not true then
          raise exception 'Stock Check batch must be in an active storage location.';
        end if;
      end if;$new$);
  v_definition := replace(v_definition,
    'if v_variance_qty < 0 and v_allocation_total > abs(v_variance_qty) then',
    'if v_status = ''submitted'' and v_variance_qty < 0 and v_allocation_total > abs(v_variance_qty) then');
  v_definition := replace(v_definition,
    'if v_variance_qty >= 0 and v_allocation_total <> 0 then',
    'if v_status = ''submitted'' and v_variance_qty >= 0 and v_allocation_total <> 0 then');
  execute v_definition;

  -- The public save contract stages the rows as a draft in this transaction, then validates before submitting.
  v_definition := pg_get_functiondef(v_save);
  v_definition := replace(v_definition,
    $old$        and lower(coalesce(item.count_status, '')) <> 'skip'$old$ || chr(10),
    '');
  v_definition := replace(v_definition, $old$            item.variance_qty < 0
            and coalesce((
              select sum(adjustment.quantity)
              from public.factory_product_stock_check_batch_adjustments adjustment
              where adjustment.stock_check_item_id = item.id
            ), 0) <> abs(item.variance_qty)$old$, $new$            coalesce((
              select sum(adjustment.quantity)
              from public.factory_product_stock_check_batch_adjustments adjustment
              where adjustment.stock_check_item_id = item.id
            ), 0) <> greatest(-item.variance_qty, 0)$new$);

  v_definition := replace(v_definition, $old$    select exists (
      select 1
      from public.factory_product_stock_check_items item
      join public.factory_finished_goods sku$old$, $new$    if exists (
      select 1
      from public.factory_product_stock_check_items item
      where item.stock_check_id = v_saved_id
        and item.variance_qty <> 0
        and abs(item.system_qty - coalesce((
          select sum(batch.current_balance)
          from public.factory_finished_good_batch_balances batch
          where batch.finished_good_id = item.finished_good_id
        ), 0)) > 0.0001
    ) then
      raise exception 'Reconcile Finished Goods batch inventory before submitting this Stock Check.';
    end if;

    if exists (
      select 1
      from public.factory_product_stock_check_items item
      join public.factory_product_stock_check_batch_adjustments adjustment on adjustment.stock_check_item_id = item.id
      join public.factory_finished_good_batch_balances batch on batch.id = adjustment.batch_balance_id
      left join public.factory_storage_locations location on location.id = batch.storage_location_id
      where item.stock_check_id = v_saved_id
        and (lower(coalesce(location.status, '')) <> 'active' or location.is_storage_location is not true)
    ) then
      raise exception 'Replace batch allocations in unavailable storage locations before submitting.';
    end if;

    if exists (
      select 1
      from public.factory_product_stock_check_items item
      join public.factory_product_stock_check_batch_adjustments adjustment on adjustment.stock_check_item_id = item.id
      join public.factory_finished_good_batch_balances batch on batch.id = adjustment.batch_balance_id
      where item.stock_check_id = v_saved_id and adjustment.quantity > batch.current_balance
    ) then
      raise exception 'A batch allocation exceeds its current balance. Refresh batch availability and allocate the difference again.';
    end if;

    select exists (
      select 1
      from public.factory_product_stock_check_items item
      join public.factory_finished_goods sku$new$);
  execute v_definition;
end;
$migration$;
