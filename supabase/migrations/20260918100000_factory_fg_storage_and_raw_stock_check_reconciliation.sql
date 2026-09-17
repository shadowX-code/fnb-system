-- Finish Goods completion is pinned to the Packaging SKU's configured physical
-- Storage Location. A packaging/storage method label is not a location scope.
create or replace function public.factory_guard_production_completion_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_start_at timestamp;
  v_end_at timestamp;
  v_expected_expiry date;
  v_location public.factory_storage_locations%rowtype;
begin
  if lower(coalesce(new.status, '')) <> 'completed' then
    return new;
  end if;

  select job.* into v_job_order
  from public.factory_job_orders job
  where job.id = new.job_order_id
  for update;
  if not found then raise exception 'Job Order not found.'; end if;
  if v_job_order.production_date is null then raise exception 'Job Order Production Date is required before completing production.'; end if;
  if v_job_order.start_time is null then raise exception 'Job Order Start Time is required before completing production.'; end if;

  new.end_date := coalesce(nullif(current_setting('feedx.production_end_date', true), '')::date, new.end_date);
  new.expiry_date := coalesce(nullif(current_setting('feedx.production_expiry_date', true), '')::date, new.expiry_date);
  new.storage_location_id := coalesce(nullif(current_setting('feedx.production_storage_location_id', true), '')::uuid, new.storage_location_id);
  new.expiry_override_reason := coalesce(
    nullif(btrim(coalesce(current_setting('feedx.production_expiry_override_reason', true), '')), ''),
    nullif(btrim(coalesce(new.expiry_override_reason, '')), '')
  );

  if new.end_date is null then raise exception 'End Date is required.'; end if;
  if new.end_time is null then raise exception 'End Time is required.'; end if;
  v_start_at := v_job_order.production_date + v_job_order.start_time;
  v_end_at := new.end_date + new.end_time;
  if v_end_at < v_start_at then raise exception 'Production End Date and Time cannot be earlier than Start Date and Time.'; end if;
  if new.actual_pack_qty is null or new.actual_pack_qty <= 0 or new.actual_pack_qty <> trunc(new.actual_pack_qty) then
    raise exception 'Actual Pack Qty must be a whole number greater than zero.';
  end if;

  select finished_good.* into v_finished_good
  from public.factory_finished_goods finished_good
  where finished_good.id = new.finished_good_id;
  if not found then raise exception 'Packaging SKU not found.'; end if;

  -- The Job Order owns production start. The validated completion date owns
  -- manufacturing and expiry semantics for the resulting batch.
  new.production_date := v_job_order.production_date;
  new.start_time := v_job_order.start_time;
  new.manufacturing_date := new.end_date;
  new.shelf_life_days_snapshot := v_finished_good.shelf_life_days;

  if v_finished_good.shelf_life_days is not null then
    v_expected_expiry := new.end_date + v_finished_good.shelf_life_days;
    if new.expiry_date is null then raise exception 'Expiry Date is required for this Packaging SKU.'; end if;
    if new.expiry_date = v_expected_expiry then
      new.expiry_override_reason := null;
    elsif new.expiry_override_reason is null then
      raise exception 'Expiry override reason is required when changing the calculated Expiry Date.';
    end if;
  else
    new.expiry_override_reason := null;
  end if;
  if new.expiry_date is not null and new.expiry_date < new.end_date then
    raise exception 'Expiry Date cannot be earlier than Manufacturing Date.';
  end if;

  if v_finished_good.storage_location_id is null then
    raise exception 'Configure an active storage-enabled Storage Location on the Packaging SKU before completing Production.';
  end if;
  if new.storage_location_id is distinct from v_finished_good.storage_location_id then
    raise exception 'Production storage must match the Packaging SKU Storage Location.';
  end if;
  select location.* into v_location
  from public.factory_storage_locations location
  where location.id = v_finished_good.storage_location_id;
  if not found or lower(coalesce(v_location.status, '')) <> 'active' or v_location.is_storage_location is not true then
    raise exception 'The Packaging SKU Storage Location must be active and storage-enabled before completing Production.';
  end if;
  new.storage_location_id := v_finished_good.storage_location_id;
  return new;
end;
$$;

-- New Raw Material reconciliation batches are distinct from Receiving, but
-- are valid FEFO inventory once the Stock Check is approved.
create unique index if not exists factory_raw_material_batch_balances_adjustment_batch_no_key
  on public.factory_raw_material_batch_balances (internal_batch_no)
  where source_type = 'stock_check_adjustment'
    and internal_batch_no ~ '^ADJ-RMSC[0-9]{6}-[0-9]+$';

do $migration$
declare
  v_definition text;
  v_old text := $old$
      insert into public.factory_raw_material_batch_balances (
        raw_material_stock_check_item_id, raw_material_id, source_type,
        internal_batch_no, storage_location_id, uom, opening_qty, current_balance,
        status, diagnostic
      ) values (
        v_item.id, v_material.id, 'stock_check_adjustment', null,
        v_location.id, v_item.uom, v_item.variance_qty, v_item.variance_qty,
        'reconciliation_required',
        'Positive Stock Check quantity has no supplier Receiving batch and remains unavailable for Production allocation.'
      ) returning id into v_adjustment_batch_id;

      insert into public.factory_raw_material_batch_reconciliation_diagnostics (
        raw_material_id, stock_check_item_id, diagnostic_type, diagnostic_qty, details
      ) values (
        v_material.id, v_item.id, 'stock_check_adjustment_unallocated', v_item.variance_qty,
        'Positive Stock Check quantity is represented in an unavailable adjustment bucket until exact batch provenance is reconciled.'
      );$old$;
  v_new text := $new$
      perform pg_advisory_xact_lock(hashtextextended(
        'factory_raw_stock_check_adjustment:' || 'ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD'), 0
      ));
      insert into public.factory_raw_material_batch_balances (
        raw_material_stock_check_item_id, raw_material_id, source_type,
        internal_batch_no, storage_location_id, uom, opening_qty, current_balance,
        status, diagnostic
      ) values (
        v_item.id, v_material.id, 'stock_check_adjustment',
        'ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD') || '-' || public.factory_format_business_sequence((
          select coalesce(max((substring(balance.internal_batch_no from ('^ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD') || '-([0-9]+)$')))::integer), 0) + 1
          from public.factory_raw_material_batch_balances balance
          where balance.source_type = 'stock_check_adjustment'
            and balance.internal_batch_no ~ ('^ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD') || '-[0-9]+$')
        )),
        v_location.id, v_item.uom, v_item.variance_qty, v_item.variance_qty,
        'active',
        'Approved Raw Material Stock Check reconciliation batch; source is Stock Check, not Receiving.'
      ) returning id into v_adjustment_batch_id;$new$;
begin
  select pg_get_functiondef('public.factory_approve_raw_material_stock_check(uuid,uuid)'::regprocedure) into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'Expected positive Raw Material Stock Check reconciliation branch was not found.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  if position($old_location$where location.id = v_material.storage_location_id
        and lower(coalesce(location.status, '')) = 'active';
      if v_location.id is null then
        raise exception 'Select an active Raw Material Storage Location before approving a positive Stock Check adjustment.';
      end if;$old_location$ in v_definition) = 0 then
    raise exception 'Expected Raw Material Stock Check storage-location guard was not found.';
  end if;
  v_definition := replace(
    v_definition,
    $old_location$where location.id = v_material.storage_location_id
        and lower(coalesce(location.status, '')) = 'active';
      if v_location.id is null then
        raise exception 'Select an active Raw Material Storage Location before approving a positive Stock Check adjustment.';
      end if;$old_location$,
    $new_location$where location.id = v_material.storage_location_id
        and lower(coalesce(location.status, '')) = 'active'
        and location.is_storage_location is true;
      if v_location.id is null then
        raise exception 'Select an active storage-enabled Raw Material Storage Location before approving a positive Stock Check adjustment.';
      end if;$new_location$
  );
  execute v_definition;
end;
$migration$;

-- Make the newly approved reconciliation source eligible in the same FEFO
-- authority used by Production. Receiving keeps its existing semantics.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.factory_get_raw_material_batch_availability(uuid[],uuid)'::regprocedure) into v_definition;
  if position('balance.source_type = ''receiving''' in v_definition) = 0 then
    raise exception 'Expected Raw Material availability source predicate was not found.';
  end if;
  v_definition := replace(v_definition, $old$balance.source_type = 'receiving'$old$, $new$balance.source_type in ('receiving', 'stock_check_adjustment')$new$);
  execute v_definition;

  select pg_get_functiondef(
    'public.factory_complete_production_with_raw_batch_allocations_impl_050031(uuid,jsonb)'::regprocedure
  ) into v_definition;
  if position('candidate.source_type = ''receiving''' in v_definition) = 0
     or position('v_batch.source_type <> ''receiving''' in v_definition) = 0 then
    raise exception 'Expected Production FEFO source predicates were not found.';
  end if;
  v_definition := replace(v_definition, $old$balance.source_type = 'receiving'$old$, $new$balance.source_type in ('receiving', 'stock_check_adjustment')$new$);
  v_definition := replace(v_definition, $old$candidate.source_type = 'receiving'$old$, $new$candidate.source_type in ('receiving', 'stock_check_adjustment')$new$);
  v_definition := replace(v_definition, $old$v_batch.source_type <> 'receiving'$old$, $new$v_batch.source_type not in ('receiving', 'stock_check_adjustment')$new$);
  execute v_definition;
end;
$migration$;

-- Historical repair is deliberately restricted to the three Production
-- records proven before this release. It changes neither aggregate inventory
-- nor the immutable movement ledger, and fails closed if any expected record
-- no longer has the exact approved Stock Check provenance.
do $legacy_repair$
declare
  v_expected_count integer := 3;
  v_eligible_count integer;
  v_updated_count integer;
begin
  with expected(batch_id, expected_qty) as (
    values
      ('1095488e-eac5-4592-bb88-ca5819a46451'::uuid, 5::numeric),
      ('cf832e87-2ec9-495e-ade9-fe81a7213e62'::uuid, 15::numeric),
      ('23111ec4-2de8-49b6-adb4-0c69e9667a18'::uuid, 10::numeric)
  ), eligible as (
    select batch.id
    from expected
    join public.factory_raw_material_batch_balances batch
      on batch.id = expected.batch_id
    join public.factory_raw_material_stock_check_items item
      on item.id = batch.raw_material_stock_check_item_id
     and item.variance_qty = expected.expected_qty
     and item.variance_qty > 0
    join public.factory_raw_material_stock_checks stock_check
      on stock_check.id = item.stock_check_id
     and stock_check.check_no = 'RMSC-260915-01'
     and lower(coalesce(stock_check.status, '')) = 'approved'
    join public.factory_raw_materials material
      on material.id = item.raw_material_id
     and material.current_balance = expected.expected_qty
    join public.factory_storage_locations location
      on location.id = batch.storage_location_id
     and lower(coalesce(location.status, '')) = 'active'
     and location.is_storage_location is true
    where batch.source_type = 'stock_check_adjustment'
      and batch.status = 'reconciliation_required'
      and batch.current_balance = expected.expected_qty
      and batch.internal_batch_no is null
      and abs(material.current_balance - coalesce((
        select sum(all_batch.current_balance)
        from public.factory_raw_material_batch_balances all_batch
        where all_batch.raw_material_id = material.id
      ), 0)) <= 0.000001
      and 1 = (
        select count(*)
        from public.factory_raw_material_movements movement
        where movement.reference_type = 'raw_material_stock_check'
          and movement.reference_id = stock_check.id
          and movement.raw_material_id = material.id
          and movement.raw_material_batch_balance_id = batch.id
          and movement.quantity = item.variance_qty
      )
  )
  select count(*) into v_eligible_count from eligible;

  if v_eligible_count <> v_expected_count then
    raise exception 'Expected exactly % whitelisted legacy Raw Material Stock Check reconciliation batches; found %.', v_expected_count, v_eligible_count;
  end if;

  with expected(batch_id, expected_qty) as (
    values
      ('1095488e-eac5-4592-bb88-ca5819a46451'::uuid, 5::numeric),
      ('cf832e87-2ec9-495e-ade9-fe81a7213e62'::uuid, 15::numeric),
      ('23111ec4-2de8-49b6-adb4-0c69e9667a18'::uuid, 10::numeric)
  ), eligible as (
    select batch.id
    from expected
    join public.factory_raw_material_batch_balances batch
      on batch.id = expected.batch_id
    join public.factory_raw_material_stock_check_items item
      on item.id = batch.raw_material_stock_check_item_id
     and item.variance_qty = expected.expected_qty
     and item.variance_qty > 0
    join public.factory_raw_material_stock_checks stock_check
      on stock_check.id = item.stock_check_id
     and stock_check.check_no = 'RMSC-260915-01'
     and lower(coalesce(stock_check.status, '')) = 'approved'
    join public.factory_raw_materials material
      on material.id = item.raw_material_id
     and material.current_balance = expected.expected_qty
    join public.factory_storage_locations location
      on location.id = batch.storage_location_id
     and lower(coalesce(location.status, '')) = 'active'
     and location.is_storage_location is true
    where batch.source_type = 'stock_check_adjustment'
      and batch.status = 'reconciliation_required'
      and batch.current_balance = expected.expected_qty
      and batch.internal_batch_no is null
      and abs(material.current_balance - coalesce((
        select sum(all_batch.current_balance)
        from public.factory_raw_material_batch_balances all_batch
        where all_batch.raw_material_id = material.id
      ), 0)) <= 0.000001
      and 1 = (
        select count(*)
        from public.factory_raw_material_movements movement
        where movement.reference_type = 'raw_material_stock_check'
          and movement.reference_id = stock_check.id
          and movement.raw_material_id = material.id
          and movement.raw_material_batch_balance_id = batch.id
          and movement.quantity = item.variance_qty
      )
  )
  update public.factory_raw_material_batch_balances batch
  set status = 'active',
      diagnostic = 'Whitelisted legacy approved Raw Material Stock Check reconciliation batch; activated without inventory or movement changes.',
      updated_at = now()
  where batch.id in (select id from eligible);

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_expected_count then
    raise exception 'Expected to activate exactly % whitelisted legacy reconciliation batches; updated %.', v_expected_count, v_updated_count;
  end if;
end;
$legacy_repair$;

revoke execute on function public.factory_guard_production_completion_details() from public, anon, authenticated;
revoke execute on function public.factory_approve_raw_material_stock_check(uuid, uuid) from public, anon;
grant execute on function public.factory_approve_raw_material_stock_check(uuid, uuid) to authenticated;
revoke execute on function public.factory_get_raw_material_batch_availability(uuid[], uuid) from public, anon;
grant execute on function public.factory_get_raw_material_batch_availability(uuid[], uuid) to authenticated;
revoke execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb) from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
