-- Finished Goods Stock Check: pack-unit counting, optional skipped reasons,
-- total-first batch resolution, and qualified PL/pgSQL identifiers.

alter table public.factory_product_stock_check_items
  add column if not exists count_status text;

alter table public.factory_product_stock_check_items
  add column if not exists positive_adjustment_confirmed boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conname = 'factory_product_stock_check_items_count_status_check'
      and constraint_record.conrelid = 'public.factory_product_stock_check_items'::regclass
  ) then
    alter table public.factory_product_stock_check_items
      add constraint factory_product_stock_check_items_count_status_check
      check (count_status is null or count_status in ('pending', 'counted', 'skip'));
  end if;
end;
$$;

create or replace function public.factory_save_product_stock_check_structure(
  p_stock_check_id uuid,
  p_check_date date,
  p_notes text,
  p_target_status text,
  p_created_by uuid,
  p_rows jsonb
)
returns table (id uuid, check_no text)
language plpgsql security definer set search_path = public as $$
declare
  v_check public.factory_product_stock_checks%rowtype;
  v_check_id uuid;
  v_check_no text;
  v_date date := coalesce(p_check_date, current_date);
  v_status text := lower(coalesce(p_target_status, 'draft'));
  v_prefix text := 'FGSC' || to_char(coalesce(p_check_date, current_date), 'YYMMDD');
  v_next integer;
  v_row jsonb;
  v_allocation jsonb;
  v_finished_good public.factory_finished_goods%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_item_id uuid;
  v_finished_good_id uuid;
  v_physical_qty numeric;
  v_system_qty numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_status text;
  v_count_status text;
  v_is_skipped boolean;
  v_positive_adjustment_confirmed boolean;
  v_reason text;
  v_adjustment_location_id uuid;
  v_batch_total numeric;
  v_batch public.factory_finished_good_batch_balances%rowtype;
  v_batch_id uuid;
  v_allocation_qty numeric;
  v_allocation_total numeric;
begin
  if v_status not in ('draft', 'submitted') then
    raise exception 'Product Stock Check status must be Draft or Submitted.';
  end if;
  if v_status = 'submitted'
    and not public.current_user_has_permission('factory_product_stock_check.submit') then
    raise exception using errcode = '42501', message = 'Insufficient permission to submit Product Stock Check.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Product Stock Check requires at least one item.';
  end if;

  if p_stock_check_id is null then
    if not public.current_user_has_permission('factory_product_stock_check.create') then
      raise exception using errcode = '42501', message = 'Insufficient permission to create Product Stock Check.';
    end if;
    perform pg_advisory_xact_lock(hashtext('factory_product_stock_check_' || v_prefix));
    select coalesce(max(nullif(regexp_replace(stock_check.check_no, '^' || v_prefix || '-', ''), '')::integer), 0) + 1
    into v_next from public.factory_product_stock_checks stock_check
    where stock_check.check_no ~ ('^' || v_prefix || '-[0-9]+$');
    v_check_no := v_prefix || '-' || lpad(v_next::text, 2, '0');
    insert into public.factory_product_stock_checks (
      check_no, check_date, status, notes, created_by, submitted_by, submitted_at, created_at, updated_at
    ) values (
      v_check_no, v_date, 'draft', coalesce(p_notes, ''), p_created_by,
      case when v_status = 'submitted' then p_created_by end,
      case when v_status = 'submitted' then now() end, now(), now()
    ) returning factory_product_stock_checks.id into v_check_id;
  else
    if not (
      public.current_user_has_permission('factory_product_stock_check.edit')
      or public.current_user_has_permission('factory_product_stock_check.submit')
    ) then raise exception using errcode = '42501', message = 'Insufficient permission to edit Product Stock Check.'; end if;
    select * into v_check from public.factory_product_stock_checks
    where factory_product_stock_checks.id = p_stock_check_id for update;
    if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
    if lower(coalesce(v_check.status, '')) <> 'draft' then
      raise exception 'Only Draft Product Stock Checks can be edited or submitted.';
    end if;
    v_check_id := v_check.id;
    v_check_no := v_check.check_no;
    update public.factory_product_stock_checks
    set check_date = v_date, notes = coalesce(p_notes, ''), updated_at = now()
    where factory_product_stock_checks.id = v_check_id;
  end if;

  delete from public.factory_product_stock_check_items stock_item
  where stock_item.stock_check_id = v_check_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_finished_good_id := nullif(v_row->>'finished_good_id', '')::uuid;
    if exists (
      select 1 from public.factory_product_stock_check_items stock_item
      where stock_item.stock_check_id = v_check_id
        and stock_item.finished_good_id = v_finished_good_id
    ) then raise exception 'Packaging SKU appears more than once in Product Stock Check.'; end if;
    select * into v_finished_good from public.factory_finished_goods
    where factory_finished_goods.id = v_finished_good_id for update;
    if v_finished_good.id is null then raise exception 'Packaging SKU not found.'; end if;
    v_system_qty := coalesce(v_finished_good.current_balance, 0);
    if v_system_qty <> trunc(v_system_qty) then
      raise exception 'Packaging SKU system balance must be a whole number before Stock Check.';
    end if;
    v_is_skipped := coalesce(nullif(v_row->>'is_skipped', '')::boolean, false)
      or lower(coalesce(v_row->>'count_status', '')) = 'skip';
    v_count_status := case
      when v_is_skipped then 'skip'
      when not (v_row ? 'physical_qty') or v_row->>'physical_qty' is null then 'pending'
      else 'counted'
    end;
    v_positive_adjustment_confirmed := coalesce(nullif(v_row->>'positive_adjustment_confirmed', '')::boolean, false);
    if v_status = 'submitted' and not v_is_skipped
      and (not (v_row ? 'physical_qty') or v_row->>'physical_qty' is null) then
      raise exception 'Physical Qty is required before submitting Product Stock Check.';
    end if;
    v_physical_qty := case when v_is_skipped
      then v_system_qty
      else coalesce(nullif(v_row->>'physical_qty', '')::numeric, v_system_qty)
    end;
    if v_physical_qty < 0 or v_physical_qty <> trunc(v_physical_qty) then
      raise exception 'Physical Qty must be a whole number.';
    end if;
    v_variance_qty := v_physical_qty - v_system_qty;
    if v_status = 'submitted' and not v_is_skipped and v_variance_qty <> 0 then
      select coalesce(sum(balance.current_balance), 0) into v_batch_total
      from public.factory_finished_good_batch_balances balance
      where balance.finished_good_id = v_finished_good.id;
      if abs(v_batch_total - v_system_qty) > 0.0001 then
        raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before submitting.',
          coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU');
      end if;
    end if;
    v_variance_percent := case when v_system_qty = 0
      then case when v_variance_qty = 0 then 0 else 100 end
      else (v_variance_qty / v_system_qty) * 100 end;
    v_variance_status := case
      when v_is_skipped then 'Skipped'
      when v_count_status = 'pending' then 'Pending'
      when v_variance_qty = 0 then 'Normal'
      when v_system_qty <= 0 or abs(v_variance_percent) >= 10 then 'Critical'
      else 'Variance' end;
    v_reason := btrim(coalesce(v_row->>'variance_reason', ''));
    if v_status = 'submitted' and v_variance_qty <> 0 and v_reason = '' then
      raise exception 'Variance reason is required for Product Stock Check adjustments.';
    end if;
    v_adjustment_location_id := null;
    if v_variance_qty > 0 then
      if v_status = 'submitted' and not v_positive_adjustment_confirmed then
        raise exception 'Assign an Adjustment Batch before submitting a positive Product Stock Check variance.';
      end if;
      if v_positive_adjustment_confirmed then
        select location.* into v_location from public.factory_storage_locations location
        where location.id = v_finished_good.storage_location_id;
        if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
          or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
          raise exception 'Positive Product Stock Check variance requires an active Finished Goods default storage location.';
        end if;
        v_adjustment_location_id := v_location.id;
      end if;
    end if;
    insert into public.factory_product_stock_check_items (
      stock_check_id, finished_good_id, system_qty, physical_qty, variance_qty,
      variance_percent, variance_status, count_status, variance_reason, uom,
      adjustment_storage_location_id, positive_adjustment_confirmed, created_at, updated_at
    ) values (
      v_check_id, v_finished_good.id, v_system_qty, v_physical_qty, v_variance_qty,
      v_variance_percent, v_variance_status, v_count_status, v_reason, 'Packs',
      v_adjustment_location_id, v_positive_adjustment_confirmed, now(), now()
    ) returning factory_product_stock_check_items.id into v_item_id;

    v_allocation_total := 0;
    for v_allocation in select * from jsonb_array_elements(coalesce(v_row->'allocations', '[]'::jsonb)) loop
      v_batch_id := nullif(v_allocation->>'batch_balance_id', '')::uuid;
      v_allocation_qty := nullif(v_allocation->>'quantity', '')::numeric;
      if v_batch_id is null or v_allocation_qty is null or v_allocation_qty <= 0
        or v_allocation_qty <> trunc(v_allocation_qty) then
        raise exception 'Batch reduction quantities must be whole numbers greater than 0.';
      end if;
      select balance.* into v_batch
      from public.factory_finished_good_batch_balances balance
      where balance.id = v_batch_id for update;
      if v_batch.id is null or v_batch.finished_good_id <> v_finished_good.id then
        raise exception 'Stock Check batch does not belong to the selected Packaging SKU.';
      end if;
      if v_batch.current_balance < v_allocation_qty then
        raise exception 'Stock Check batch allocation exceeds its current balance.';
      end if;
      select location.* into v_location
      from public.factory_storage_locations location
      where location.id = v_batch.storage_location_id;
      if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Stock Check batch must be in an active Finished Goods storage location.';
      end if;
      insert into public.factory_product_stock_check_batch_adjustments
        (stock_check_item_id, batch_balance_id, quantity)
      values (v_item_id, v_batch.id, v_allocation_qty);
      v_allocation_total := v_allocation_total + v_allocation_qty;
    end loop;
    if v_variance_qty < 0 and v_allocation_total > abs(v_variance_qty) then
      raise exception 'Batch reductions cannot exceed the negative Product Stock Check variance.';
    end if;
    if v_status = 'submitted' and v_variance_qty < 0
      and v_allocation_total <> abs(v_variance_qty) then
      raise exception 'Resolve the full pack difference before submitting.';
    end if;
    if v_variance_qty >= 0 and v_allocation_total <> 0 then
      raise exception 'Batch reductions are only allowed for negative Product Stock Check variance.';
    end if;
  end loop;

  if v_status = 'submitted' then
    update public.factory_product_stock_checks
    set status = 'submitted', submitted_by = p_created_by,
      submitted_at = now(), updated_at = now()
    where factory_product_stock_checks.id = v_check_id;
  end if;
  return query select v_check_id, v_check_no;
end;
$$;
grant execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb) to authenticated;


create or replace function public.factory_approve_product_stock_check(p_stock_check_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_check public.factory_product_stock_checks%rowtype; v_item record; v_adjustment record;
  v_batch public.factory_finished_good_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype; v_total numeric; v_batch_total numeric;
begin
  if not public.current_user_has_permission('factory_product_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Insufficient permission to approve Product Stock Check.';
  end if;
  select stock_check.* into v_check
  from public.factory_product_stock_checks stock_check
  where stock_check.id = p_stock_check_id for update;
  if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
  if v_check.status <> 'submitted' then raise exception 'Only submitted stock checks can be approved.'; end if;
  perform 1 from public.factory_product_stock_check_items
    where stock_check_id = p_stock_check_id order by finished_good_id, id for update;
  perform 1 from public.factory_product_stock_check_batch_adjustments adjustment
    join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
    where item.stock_check_id = p_stock_check_id order by adjustment.batch_balance_id, adjustment.id for update of adjustment;
  perform 1 from public.factory_finished_good_batch_balances balance
    where balance.id in (
      select adjustment.batch_balance_id
      from public.factory_product_stock_check_batch_adjustments adjustment
      join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
      where item.stock_check_id = p_stock_check_id
    ) order by balance.id for update;
  for v_item in
    select item.*, product.product_name,
      product.storage_location_id as current_default_storage_location_id
    from public.factory_product_stock_check_items item
    join public.factory_finished_goods product on product.id = item.finished_good_id
    where item.stock_check_id = p_stock_check_id order by item.finished_good_id, item.id
  loop
    if lower(coalesce(v_item.count_status, 'counted')) = 'skip'
      or v_item.variance_status = 'Skipped' then
      continue;
    end if;
    if v_item.variance_qty <> 0 and coalesce(btrim(v_item.variance_reason), '') = '' then
      raise exception 'Variance reason is required for Product Stock Check adjustments.';
    end if;
    if v_item.system_qty <> trunc(v_item.system_qty)
      or v_item.physical_qty <> trunc(v_item.physical_qty)
      or v_item.variance_qty <> trunc(v_item.variance_qty) then
      raise exception 'Product Stock Check quantities must be whole pack quantities.';
    end if;
    select coalesce(sum(balance.current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances balance
    where balance.finished_good_id = v_item.finished_good_id;
    if abs(v_batch_total - v_item.system_qty) > 0.0001 then
      raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before approval.', v_item.product_name;
    end if;
    if v_item.variance_qty < 0 then
      select coalesce(sum(adjustment.quantity), 0) into v_total
      from public.factory_product_stock_check_batch_adjustments adjustment
      where adjustment.stock_check_item_id = v_item.id;
      if v_total <> abs(v_item.variance_qty) then
        raise exception 'Negative Product Stock Check variance must be fully allocated across batches.';
      end if;
      for v_adjustment in
        select adjustment.* from public.factory_product_stock_check_batch_adjustments adjustment
        where adjustment.stock_check_item_id = v_item.id order by adjustment.batch_balance_id, adjustment.id
      loop
        select balance.* into v_batch
        from public.factory_finished_good_batch_balances balance
        where balance.id = v_adjustment.batch_balance_id for update;
        if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id
          or v_batch.current_balance < v_adjustment.quantity then
          raise exception 'Batch stock has changed. Review the suggested resolution again.';
        end if;
        select location.* into v_location
        from public.factory_storage_locations location
        where location.id = v_batch.storage_location_id;
        if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
          or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
          raise exception 'Stock Check batch must be in an active Finished Goods storage location.';
        end if;
        -- Expired batches remain countable because a physical Stock Check must
        -- account for stock that still exists. Dispatch eligibility is unchanged.
        update public.factory_finished_good_batch_balances
        set current_balance = current_balance - v_adjustment.quantity, updated_at = now()
        where factory_finished_good_batch_balances.id = v_batch.id;
      end loop;
    elsif v_item.variance_qty > 0 then
      select location.* into v_location
      from public.factory_storage_locations location
      where location.id = coalesce(v_item.adjustment_storage_location_id, v_item.current_default_storage_location_id);
      if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Positive Product Stock Check variance requires an active Finished Goods default storage location.';
      end if;
      insert into public.factory_finished_good_batch_balances (
        finished_good_id, source_type, source_reference_id, source_reference_no, batch_no,
        manufacturing_date, storage_location_id, storage_location, storage_location_type,
        opening_qty, current_balance, remarks
      ) values (
        v_item.finished_good_id, 'adjustment', p_stock_check_id, v_check.check_no,
        'ADJ-' || coalesce(nullif(v_item.product_name, ''), left(v_item.finished_good_id::text, 8)),
        v_check.check_date, v_location.id, v_location.location_name, v_location.location_type,
        v_item.variance_qty, v_item.variance_qty, v_item.variance_reason
      ) on conflict (finished_good_id, storage_location_id) where source_type = 'adjustment'
      do update set opening_qty = factory_finished_good_batch_balances.opening_qty + excluded.opening_qty,
        current_balance = factory_finished_good_batch_balances.current_balance + excluded.current_balance,
        source_reference_id = excluded.source_reference_id, source_reference_no = excluded.source_reference_no,
        remarks = excluded.remarks, updated_at = now();
    end if;
    if v_item.variance_qty <> 0 then
      perform public.factory_adjust_finished_good_balance(v_item.finished_good_id, v_item.variance_qty);
      insert into public.factory_product_stock_movements (
        finished_good_id, product_name, movement_type, quantity, uom, reference_type,
        reference_id, reference_no, movement_date, notes, created_by
      ) values (
        v_item.finished_good_id, v_item.product_name, 'Stock Check Adjustment', v_item.variance_qty,
        v_item.uom, 'product_stock_check', p_stock_check_id, v_check.check_no,
        coalesce(v_check.check_date, current_date),
        'Approved finished goods stock check adjustment. Batch inventory updated explicitly.', p_approved_by
      );
    end if;
  end loop;
  update public.factory_product_stock_checks stock_check set status = 'approved', approved_by = p_approved_by,
    approved_at = now(), submitted_at = coalesce(submitted_at, now()), updated_at = now()
  where stock_check.id = p_stock_check_id;
end;
$$;
grant execute on function public.factory_approve_product_stock_check(uuid, uuid) to authenticated;

create or replace function public.factory_product_stock_check_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'checks', count(distinct stock_check.id),
    'submitted', count(distinct stock_check.id) filter (where stock_check.status = 'submitted'),
    'variance_rows', count(item.id) filter (
      where coalesce(item.count_status, case when item.variance_status = 'Skipped' then 'skip' else 'counted' end) <> 'skip'
        and coalesce(item.variance_qty, 0) <> 0
    ),
    'skipped_rows', count(item.id) filter (
      where coalesce(item.count_status, case when item.variance_status = 'Skipped' then 'skip' else 'counted' end) = 'skip'
    )
  )
  from public.factory_product_stock_checks stock_check
  left join public.factory_product_stock_check_items item on item.stock_check_id = stock_check.id;
$$;

grant execute on function public.factory_product_stock_check_summary() to authenticated;
