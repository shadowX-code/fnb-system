-- Factory Packaging SKU production flow and parent-level Production Standards.
-- Compatibility rule:
-- - factory_job_orders.finished_good_id and factory_productions.finished_good_id remain Packaging SKU ids.
-- - factory_product_recipes.product_family_id is the new parent Finished Good link.
-- - Existing SKU-linked recipes remain readable through finished_good_id.

alter table public.factory_job_orders
  add column if not exists target_pack_qty numeric,
  add column if not exists target_production_qty numeric;

alter table public.factory_productions
  add column if not exists actual_pack_qty numeric,
  add column if not exists actual_output_qty numeric;

alter table public.factory_product_recipes
  add column if not exists product_family_id uuid references public.factory_product_families(id) on delete restrict;

create index if not exists factory_product_recipes_product_family_id_idx
on public.factory_product_recipes(product_family_id);

update public.factory_product_recipes recipe
set product_family_id = product.product_family_id
from public.factory_finished_goods product
where recipe.product_family_id is null
  and recipe.finished_good_id = product.id
  and product.product_family_id is not null;

create or replace function public.factory_packaging_production_plan(
  p_pack_qty numeric,
  p_pack_size_qty numeric,
  p_pack_size_uom text,
  p_production_uom text default null
)
returns table(target_pack_qty numeric, target_production_qty numeric, production_uom text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pack_uom text := lower(trim(coalesce(p_pack_size_uom, '')));
  v_requested_uom text := lower(trim(coalesce(p_production_uom, '')));
  v_pack_base_qty numeric;
  v_pack_base_uom text;
  v_requested_base_uom text;
begin
  if coalesce(p_pack_qty, 0) <= 0 then
    raise exception 'Target Pack Qty must be greater than 0.';
  end if;

  if coalesce(p_pack_size_qty, 0) <= 0 or v_pack_uom = '' then
    raise exception 'Packaging SKU needs Pack Size before creating Job Order.';
  end if;

  if v_pack_uom in ('kg', 'kilogram', 'kilograms') then
    v_pack_base_qty := p_pack_size_qty;
    v_pack_base_uom := 'kg';
  elsif v_pack_uom in ('g', 'gram', 'grams') then
    v_pack_base_qty := p_pack_size_qty / 1000;
    v_pack_base_uom := 'kg';
  elsif v_pack_uom in ('l', 'litre', 'liter', 'litres', 'liters') then
    v_pack_base_qty := p_pack_size_qty;
    v_pack_base_uom := 'L';
  elsif v_pack_uom in ('ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then
    v_pack_base_qty := p_pack_size_qty / 1000;
    v_pack_base_uom := 'L';
  else
    if v_requested_uom <> '' and v_requested_uom <> v_pack_uom then
      raise exception 'Packaging SKU Pack Size UOM cannot convert to the active recipe UOM.';
    end if;

    return query select p_pack_qty, p_pack_qty * p_pack_size_qty, coalesce(nullif(trim(coalesce(p_production_uom, '')), ''), trim(p_pack_size_uom));
    return;
  end if;

  if v_requested_uom in ('kg', 'kilogram', 'kilograms', 'g', 'gram', 'grams') then
    v_requested_base_uom := 'kg';
  elsif v_requested_uom in ('l', 'litre', 'liter', 'litres', 'liters', 'ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then
    v_requested_base_uom := 'L';
  elsif v_requested_uom <> '' then
    raise exception 'Packaging SKU Pack Size UOM cannot convert to the active recipe UOM.';
  end if;

  if v_requested_base_uom is not null and v_requested_base_uom <> v_pack_base_uom then
    raise exception 'Packaging SKU Pack Size UOM cannot convert to the active recipe UOM.';
  end if;

  return query select p_pack_qty, p_pack_qty * v_pack_base_qty, v_pack_base_uom;
end;
$$;

grant execute on function public.factory_packaging_production_plan(numeric, numeric, text, text) to authenticated;

do $$
begin
  if exists (
    select 1
    from (
      select product_family_id, lower(version) as normalized_version, count(*) as version_count
      from public.factory_product_recipes
      where product_family_id is not null
        and nullif(version, '') is not null
      group by product_family_id, lower(version)
      having count(*) > 1
    ) duplicate_versions
  ) then
    raise notice 'Skipping factory_product_recipes_product_family_version_unique because duplicate parent-level recipe versions already exist.';
  else
    execute 'create unique index if not exists factory_product_recipes_product_family_version_unique on public.factory_product_recipes(product_family_id, lower(version)) where product_family_id is not null and nullif(version, '''') is not null';
  end if;
end;
$$;

create or replace function public.factory_activate_product_recipe(
  p_recipe_id uuid
)
returns table(recipe_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_recipe public.factory_product_recipes%rowtype;
  v_lock_key text;
begin
  if not public.current_user_has_permission('factory_product_recipes.manage') then
    raise exception 'Missing permission to activate Factory Production Standards';
  end if;

  select *
  into v_recipe
  from public.factory_product_recipes
  where id = p_recipe_id
  for update;

  if v_recipe.id is null then
    raise exception 'Production Standard not found';
  end if;

  if lower(coalesce(v_recipe.status, '')) <> 'draft' then
    raise exception 'Only draft Production Standards can be activated';
  end if;

  if v_recipe.product_family_id is null and v_recipe.finished_good_id is null then
    raise exception 'Production Standard must be linked to a Finished Good';
  end if;

  v_lock_key := coalesce(v_recipe.product_family_id::text, 'sku:' || v_recipe.finished_good_id::text);
  perform pg_advisory_xact_lock(hashtext('factory_product_recipe_active:' || v_lock_key));

  if v_recipe.product_family_id is not null then
    update public.factory_product_recipes
    set status = 'archived',
        updated_at = now()
    where product_family_id = v_recipe.product_family_id
      and id <> v_recipe.id
      and lower(coalesce(status, '')) = 'active';
  else
    update public.factory_product_recipes
    set status = 'archived',
        updated_at = now()
    where finished_good_id = v_recipe.finished_good_id
      and product_family_id is null
      and id <> v_recipe.id
      and lower(coalesce(status, '')) = 'active';
  end if;

  update public.factory_product_recipes
  set status = 'active',
      updated_at = now()
  where id = v_recipe.id;

  return query select v_recipe.id;
end;
$$;

grant execute on function public.factory_activate_product_recipe(uuid) to authenticated;

create or replace function public.factory_create_product_recipe_new_version(
  p_source_recipe_id uuid
)
returns table(recipe_id uuid, version text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source public.factory_product_recipes%rowtype;
  v_new_recipe_id uuid;
  v_max_version integer;
  v_next_version text;
  v_recipe_code text;
  v_lock_key text;
begin
  if not public.current_user_has_permission('factory_product_recipes.create') then
    raise exception 'Missing permission to create Factory Production Standards';
  end if;

  select *
  into v_source
  from public.factory_product_recipes
  where id = p_source_recipe_id;

  if v_source.id is null then
    raise exception 'Source Production Standard not found';
  end if;

  if v_source.product_family_id is null and v_source.finished_good_id is null then
    raise exception 'Source Production Standard must be linked to a Finished Good';
  end if;

  v_lock_key := coalesce(v_source.product_family_id::text, 'sku:' || v_source.finished_good_id::text);
  perform pg_advisory_xact_lock(hashtext('factory_product_recipe_version:' || v_lock_key));

  select coalesce(max(substring(recipe.version from '^[vV]?([0-9]+)$')::integer), 0)
  into v_max_version
  from public.factory_product_recipes recipe
  where (
    (v_source.product_family_id is not null and recipe.product_family_id = v_source.product_family_id)
    or (v_source.product_family_id is null and recipe.finished_good_id = v_source.finished_good_id and recipe.product_family_id is null)
  );

  v_next_version := 'v' || (v_max_version + 1)::text;
  v_recipe_code := 'FGRCP-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.factory_product_recipes (
    recipe_code,
    finished_good_id,
    product_family_id,
    recipe_name,
    product_name,
    version,
    yield_quantity,
    uom,
    estimated_production_time_minutes,
    status,
    notes,
    remarks,
    created_at,
    updated_at
  )
  values (
    v_recipe_code,
    v_source.finished_good_id,
    v_source.product_family_id,
    v_source.recipe_name,
    v_source.product_name,
    v_next_version,
    v_source.yield_quantity,
    v_source.uom,
    v_source.estimated_production_time_minutes,
    'draft',
    v_source.notes,
    v_source.remarks,
    now(),
    now()
  )
  returning id into v_new_recipe_id;

  insert into public.factory_product_recipe_items (
    recipe_id,
    raw_material_id,
    quantity_used,
    uom,
    wastage_percent,
    sort_order,
    notes,
    remarks,
    created_at,
    updated_at
  )
  select
    v_new_recipe_id,
    item.raw_material_id,
    item.quantity_used,
    item.uom,
    item.wastage_percent,
    item.sort_order,
    item.notes,
    item.remarks,
    now(),
    now()
  from public.factory_product_recipe_items item
  where item.recipe_id = v_source.id
  order by item.sort_order, item.created_at, item.id;

  return query select v_new_recipe_id, v_next_version;
end;
$$;

grant execute on function public.factory_create_product_recipe_new_version(uuid) to authenticated;

create or replace function public.factory_create_job_order(
  p_finished_good_id uuid,
  p_target_quantity numeric,
  p_uom text,
  p_planned_date date,
  p_due_date date,
  p_priority text,
  p_assigned_team text,
  p_remarks text,
  p_created_by uuid,
  p_target_pack_qty numeric default null,
  p_target_production_qty numeric default null
)
returns table(id uuid, job_order_no text)
language plpgsql
security invoker
as $$
declare
  v_yymmdd text := to_char(current_date, 'YYMMDD');
  v_next integer;
  v_job_order_id uuid;
  v_job_order_no text;
  v_finished_good public.factory_finished_goods%rowtype;
  v_target_pack_qty numeric;
  v_target_production_qty numeric;
  v_expected_production_qty numeric;
  v_expected_production_uom text;
begin
  if not public.current_user_has_permission('factory_job_orders.create') then
    raise exception 'Missing permission to create Job Orders.';
  end if;

  if p_finished_good_id is null then
    raise exception 'Packaging SKU is required.';
  end if;

  v_target_pack_qty := coalesce(p_target_pack_qty, p_target_quantity);
  v_target_production_qty := coalesce(p_target_production_qty, p_target_quantity);

  if coalesce(v_target_pack_qty, 0) <= 0 then
    raise exception 'Target Pack Qty must be greater than 0.';
  end if;

  if coalesce(v_target_production_qty, 0) <= 0 then
    raise exception 'Target Production Qty must be greater than 0.';
  end if;

  select * into v_finished_good
  from public.factory_finished_goods
  where id = p_finished_good_id
  for update;

  if v_finished_good.id is null or lower(coalesce(v_finished_good.status, '')) <> 'active' then
    raise exception 'Packaging SKU must be active before creating a Job Order.';
  end if;

  if coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty, 0) <= 0
     or coalesce(nullif(trim(v_finished_good.pack_size_uom), ''), nullif(trim(v_finished_good.base_uom), '')) is null then
    raise exception 'Packaging SKU needs Pack Size before creating Job Order.';
  end if;

  select plan.target_production_qty, plan.production_uom
  into v_expected_production_qty, v_expected_production_uom
  from public.factory_packaging_production_plan(
    v_target_pack_qty,
    coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty),
    coalesce(v_finished_good.pack_size_uom, v_finished_good.base_uom),
    p_uom
  ) plan;

  if p_target_production_qty is not null and abs(p_target_production_qty - v_expected_production_qty) > 0.000001 then
    raise exception 'Target Production Qty does not match Packaging SKU Pack Size.';
  end if;

  if nullif(trim(coalesce(p_uom, '')), '') is not null and lower(trim(p_uom)) <> lower(v_expected_production_uom) then
    raise exception 'Production UOM must match normalized Packaging SKU Pack Size UOM.';
  end if;

  v_target_production_qty := v_expected_production_qty;

  perform pg_advisory_xact_lock(hashtextextended('factory_job_order:JO:' || v_yymmdd, 0));

  select coalesce(max((substring(jo.job_order_no from ('^JO' || v_yymmdd || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_job_orders jo
  where jo.job_order_no ~ ('^JO' || v_yymmdd || '-[0-9]+$');

  v_job_order_no := 'JO' || v_yymmdd || '-' || lpad(v_next::text, 3, '0');

  insert into public.factory_job_orders (
    job_order_no,
    finished_good_id,
    product_name,
    target_pack_qty,
    target_production_qty,
    target_quantity,
    produced_quantity,
    uom,
    planned_date,
    due_date,
    priority,
    status,
    assigned_team,
    remarks,
    created_by,
    updated_at
  )
  values (
    v_job_order_no,
    v_finished_good.id,
    v_finished_good.product_name,
    v_target_pack_qty,
    v_target_production_qty,
    v_target_production_qty,
    0,
    v_expected_production_uom,
    p_planned_date,
    p_due_date,
    coalesce(nullif(trim(coalesce(p_priority, '')), ''), 'Normal'),
    'draft',
    coalesce(p_assigned_team, ''),
    coalesce(p_remarks, ''),
    p_created_by,
    now()
  )
  returning factory_job_orders.id into v_job_order_id;

  return query select v_job_order_id as id, v_job_order_no as job_order_no;
end;
$$;

grant execute on function public.factory_create_job_order(uuid, numeric, text, date, date, text, text, text, uuid, numeric, numeric) to authenticated;

create or replace function public.factory_complete_production(
  p_job_order_id uuid,
  p_finished_good_id uuid,
  p_production_no text,
  p_product_name text,
  p_batch_no text,
  p_production_date date,
  p_operator_id uuid,
  p_operator_name text,
  p_start_time time,
  p_end_time time,
  p_actual_produced_qty numeric,
  p_good_output_qty numeric,
  p_wastage_qty numeric,
  p_uom text,
  p_qc_status text,
  p_production_sop_id uuid,
  p_sop_version text,
  p_notes text,
  p_created_by uuid,
  p_usage_items jsonb,
  p_actual_pack_qty numeric default null,
  p_actual_output_qty numeric default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_production_id uuid;
  v_finished_good public.factory_finished_goods%rowtype;
  v_job_order public.factory_job_orders%rowtype;
  v_usage_item jsonb;
  v_raw_material_id uuid;
  v_raw_material_receiving_id uuid;
  v_standard_usage numeric;
  v_actual_usage numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_reason text;
  v_production_no text;
  v_product_name text;
  v_uom text;
  v_actual_pack_qty numeric;
  v_actual_output_qty numeric;
  v_expected_output_qty numeric;
  v_expected_output_uom text;
begin
  if not public.current_user_has_permission('factory_production.complete') then
    raise exception 'Missing permission to complete production.';
  end if;

  if p_job_order_id is null then
    raise exception 'Production must start from a selected Job Order.';
  end if;

  select * into v_job_order
  from public.factory_job_orders
  where id = p_job_order_id
  for update;

  if v_job_order.id is null then
    raise exception 'Job Order was not found.';
  end if;

  if lower(coalesce(v_job_order.status, '')) = 'completed' then
    raise exception 'This Job Order has already been completed.';
  end if;

  if lower(coalesce(v_job_order.status, '')) <> 'in_progress' then
    raise exception 'Only In Progress Job Orders can be completed.';
  end if;

  if exists (
    select 1
    from public.factory_productions production
    where production.job_order_id = p_job_order_id
      and lower(coalesce(production.status, '')) = 'completed'
  ) then
    raise exception 'This Job Order already has a completed production record.';
  end if;

  if p_finished_good_id is null then
    raise exception 'Packaging SKU is required for production stock-in.';
  end if;

  if v_job_order.finished_good_id is null or v_job_order.finished_good_id <> p_finished_good_id then
    raise exception 'Production Packaging SKU must match the selected Job Order.';
  end if;

  select * into v_finished_good
  from public.factory_finished_goods
  where id = p_finished_good_id
  for update;

  if v_finished_good.id is null or lower(coalesce(v_finished_good.status, '')) <> 'active' then
    raise exception 'Production can only stock-in to an active Packaging SKU.';
  end if;

  v_actual_pack_qty := coalesce(p_actual_pack_qty, p_good_output_qty);

  if coalesce(v_actual_pack_qty, 0) <= 0 then
    raise exception 'Actual Pack Qty must be greater than 0.';
  end if;

  select plan.target_production_qty, plan.production_uom
  into v_expected_output_qty, v_expected_output_uom
  from public.factory_packaging_production_plan(
    v_actual_pack_qty,
    coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty),
    coalesce(v_finished_good.pack_size_uom, v_finished_good.base_uom),
    p_uom
  ) plan;

  if p_actual_output_qty is not null and abs(p_actual_output_qty - v_expected_output_qty) > 0.000001 then
    raise exception 'Actual Output Qty does not match Packaging SKU Pack Size.';
  end if;

  if nullif(trim(coalesce(p_uom, '')), '') is not null and lower(trim(p_uom)) <> lower(v_expected_output_uom) then
    raise exception 'Production UOM must match normalized Packaging SKU Pack Size UOM.';
  end if;

  v_actual_output_qty := v_expected_output_qty;

  if coalesce(v_actual_output_qty, 0) <= 0 then
    raise exception 'Actual Output Qty must be greater than 0.';
  end if;

  if coalesce(jsonb_array_length(p_usage_items), 0) = 0 then
    raise exception 'At least one material usage row is required.';
  end if;

  v_product_name := v_finished_good.product_name;
  v_uom := v_expected_output_uom;
  v_production_no := coalesce(nullif(trim(p_production_no), ''), 'PRD-' || to_char(now(), 'YYYYMMDDHH24MISS'));

  insert into public.factory_productions (
    job_order_id, finished_good_id, production_no, product_name, batch_no,
    actual_pack_qty, actual_output_qty,
    produced_quantity, actual_produced_qty, good_output_qty, wastage_qty, uom,
    production_date, operator_id, operator_name, start_time, end_time, qc_status,
    production_sop_id, sop_version, status, notes, created_by, completed_at, updated_at
  )
  values (
    p_job_order_id, v_finished_good.id, v_production_no, v_product_name, nullif(trim(coalesce(p_batch_no, '')), ''),
    v_actual_pack_qty, v_actual_output_qty,
    v_actual_output_qty, v_actual_output_qty, v_actual_output_qty, coalesce(p_wastage_qty, 0), v_uom,
    coalesce(p_production_date, v_job_order.production_date, current_date),
    coalesce(p_operator_id, v_job_order.production_operator_id),
    nullif(trim(coalesce(p_operator_name, v_job_order.production_operator_name, '')), ''),
    coalesce(p_start_time, v_job_order.start_time),
    p_end_time,
    coalesce(nullif(trim(p_qc_status), ''), 'Pending'),
    p_production_sop_id,
    nullif(trim(coalesce(p_sop_version, '')), ''),
    'completed',
    p_notes,
    p_created_by,
    now(),
    now()
  )
  returning id into v_production_id;

  for v_usage_item in select value from jsonb_array_elements(p_usage_items)
  loop
    v_raw_material_id := nullif(v_usage_item->>'raw_material_id', '')::uuid;
    v_raw_material_receiving_id := nullif(v_usage_item->>'raw_material_receiving_id', '')::uuid;
    v_standard_usage := coalesce(nullif(v_usage_item->>'standard_usage', '')::numeric, 0);
    v_actual_usage := coalesce(nullif(v_usage_item->>'actual_usage', '')::numeric, 0);
    v_variance_qty := v_actual_usage - v_standard_usage;
    v_variance_percent := case when v_standard_usage = 0 then case when v_actual_usage = 0 then 0 else 100 end else (v_variance_qty / v_standard_usage) * 100 end;
    v_variance_reason := nullif(trim(coalesce(v_usage_item->>'variance_reason', '')), '');

    if v_raw_material_id is null then
      raise exception 'Raw material is required for every usage row.';
    end if;
    if v_actual_usage < 0 then
      raise exception 'Actual usage cannot be negative.';
    end if;
    if abs(v_variance_qty) > 0.000001 and v_variance_reason is null then
      raise exception 'Variance reason is required when actual usage differs from standard usage.';
    end if;

    insert into public.factory_production_material_usage (
      production_id, raw_material_id, raw_material_receiving_id, raw_material_lot_no,
      quantity_used, standard_usage, actual_usage, variance_qty, variance_percent,
      variance_reason, uom, wastage_quantity, notes, updated_at
    )
    values (
      v_production_id, v_raw_material_id, v_raw_material_receiving_id,
      nullif(trim(coalesce(v_usage_item->>'raw_material_lot_no', '')), ''),
      v_actual_usage, v_standard_usage, v_actual_usage, v_variance_qty, v_variance_percent,
      v_variance_reason, v_usage_item->>'uom',
      coalesce(nullif(v_usage_item->>'wastage_quantity', '')::numeric, 0),
      v_usage_item->>'notes', now()
    );

    if v_actual_usage > 0 then
      perform public.factory_adjust_raw_material_balance(v_raw_material_id, -v_actual_usage);

      insert into public.factory_raw_material_movements (
        raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
        reference_no, movement_date, notes, created_by
      )
      values (
        v_raw_material_id, 'Production Usage', -v_actual_usage, v_usage_item->>'uom',
        'production', v_production_id, v_production_no,
        coalesce(p_production_date, v_job_order.production_date, current_date),
        case when coalesce(v_usage_item->>'raw_material_lot_no', '') <> ''
          then 'Raw material deducted from actual production usage. Lot: ' || (v_usage_item->>'raw_material_lot_no')
          else 'Raw material deducted from actual production usage.' end,
        p_created_by
      );
    end if;
  end loop;

  perform public.factory_adjust_finished_good_balance(v_finished_good.id, v_actual_pack_qty);

  insert into public.factory_product_stock_movements (
    finished_good_id, product_name, movement_type, quantity, uom, reference_type,
    reference_id, reference_no, movement_date, notes, created_by
  )
  values (
    v_finished_good.id, v_product_name, 'Production Stock In', v_actual_pack_qty,
    coalesce(v_finished_good.uom, 'packs'), 'production', v_production_id, v_production_no,
    coalesce(p_production_date, v_job_order.production_date, current_date),
    'Finished goods Packaging SKU stocked in from completed production.',
    p_created_by
  );

  update public.factory_job_orders
  set status = 'completed',
      produced_quantity = v_actual_output_qty,
      product_name = v_product_name,
      uom = v_uom,
      completed_at = now(),
      completed_by = p_created_by,
      updated_at = now()
  where id = p_job_order_id
    and status = 'in_progress';

  if not found then
    raise exception 'Unable to complete Job Order because it is no longer in progress.';
  end if;

  return v_production_id;
end;
$$;

grant execute on function public.factory_complete_production(
  uuid, uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, uuid, text, text, uuid, jsonb, numeric, numeric
) to authenticated;
