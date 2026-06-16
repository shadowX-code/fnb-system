-- Patch applied after 202606160001 was recorded on staging.
-- Adds production-quantity-first planning validation for Job Orders.

create or replace function public.factory_packaging_pack_estimate(
  p_production_qty numeric,
  p_production_uom text,
  p_pack_size_qty numeric,
  p_pack_size_uom text,
  p_recipe_uom text default null
)
returns table(target_pack_qty numeric, target_production_qty numeric, production_uom text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_production_uom text := lower(trim(coalesce(p_production_uom, '')));
  v_pack_uom text := lower(trim(coalesce(p_pack_size_uom, '')));
  v_recipe_uom text := lower(trim(coalesce(p_recipe_uom, '')));
  v_production_base_qty numeric;
  v_production_base_uom text;
  v_pack_base_qty numeric;
  v_pack_base_uom text;
  v_recipe_base_uom text;
begin
  if coalesce(p_production_qty, 0) <= 0 then
    raise exception 'Target Production Qty must be greater than 0.';
  end if;

  if v_production_uom = '' then
    raise exception 'Production UOM is required.';
  end if;

  if coalesce(p_pack_size_qty, 0) <= 0 or v_pack_uom = '' then
    raise exception 'Packaging SKU needs Pack Size before creating Job Order.';
  end if;

  if v_production_uom in ('kg', 'kilogram', 'kilograms') then
    v_production_base_qty := p_production_qty;
    v_production_base_uom := 'kg';
  elsif v_production_uom in ('g', 'gram', 'grams') then
    v_production_base_qty := p_production_qty / 1000;
    v_production_base_uom := 'kg';
  elsif v_production_uom in ('l', 'litre', 'liter', 'litres', 'liters') then
    v_production_base_qty := p_production_qty;
    v_production_base_uom := 'L';
  elsif v_production_uom in ('ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then
    v_production_base_qty := p_production_qty / 1000;
    v_production_base_uom := 'L';
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
  end if;

  if v_recipe_uom in ('kg', 'kilogram', 'kilograms', 'g', 'gram', 'grams') then
    v_recipe_base_uom := 'kg';
  elsif v_recipe_uom in ('l', 'litre', 'liter', 'litres', 'liters', 'ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then
    v_recipe_base_uom := 'L';
  elsif v_recipe_uom <> '' then
    v_recipe_base_uom := v_recipe_uom;
  end if;

  if v_production_base_uom is not null or v_pack_base_uom is not null then
    if v_production_base_uom is null or v_pack_base_uom is null or v_production_base_uom <> v_pack_base_uom then
      raise exception 'Production UOM cannot convert to the selected Packaging SKU Pack Size.';
    end if;

    if v_recipe_base_uom is not null and v_recipe_base_uom <> v_production_base_uom then
      raise exception 'Production UOM must match the active recipe UOM.';
    end if;

    return query select v_production_base_qty / v_pack_base_qty, v_production_base_qty, v_production_base_uom;
    return;
  end if;

  if v_recipe_base_uom is not null and v_recipe_base_uom <> v_production_uom then
    raise exception 'Production UOM must match the active recipe UOM.';
  end if;

  if v_pack_uom <> v_production_uom then
    raise exception 'Production UOM cannot convert to the selected Packaging SKU Pack Size.';
  end if;

  return query select p_production_qty / p_pack_size_qty, p_production_qty, trim(p_production_uom);
end;
$$;

grant execute on function public.factory_packaging_pack_estimate(numeric, text, numeric, text, text) to authenticated;

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
  v_recipe_uom text;
  v_target_pack_qty numeric;
  v_target_production_qty numeric;
  v_expected_pack_qty numeric;
  v_expected_production_qty numeric;
  v_expected_production_uom text;
begin
  if not public.current_user_has_permission('factory_job_orders.create') then
    raise exception 'Missing permission to create Job Orders.';
  end if;

  if p_finished_good_id is null then
    raise exception 'Packaging SKU is required.';
  end if;

  v_target_production_qty := coalesce(p_target_production_qty, p_target_quantity);

  if coalesce(v_target_production_qty, 0) <= 0 then
    raise exception 'Target Production Qty must be greater than 0.';
  end if;

  if nullif(trim(coalesce(p_uom, '')), '') is null then
    raise exception 'Production UOM is required.';
  end if;

  select * into v_finished_good
  from public.factory_finished_goods fg
  where fg.id = p_finished_good_id
  for update;

  if v_finished_good.id is null or lower(coalesce(v_finished_good.status, '')) <> 'active' then
    raise exception 'Packaging SKU must be active before creating a Job Order.';
  end if;

  if coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty, 0) <= 0
     or coalesce(nullif(trim(v_finished_good.pack_size_uom), ''), nullif(trim(v_finished_good.base_uom), '')) is null then
    raise exception 'Packaging SKU needs Pack Size before creating Job Order.';
  end if;

  select recipe.uom
  into v_recipe_uom
  from public.factory_product_recipes recipe
  where recipe.status = 'active'
    and recipe.product_family_id is not null
    and recipe.product_family_id = v_finished_good.product_family_id
  order by recipe.updated_at desc nulls last, recipe.created_at desc nulls last
  limit 1;

  if v_recipe_uom is null then
    select recipe.uom
    into v_recipe_uom
    from public.factory_product_recipes recipe
    where recipe.status = 'active'
      and recipe.finished_good_id = v_finished_good.id
    order by recipe.updated_at desc nulls last, recipe.created_at desc nulls last
    limit 1;
  end if;

  select plan.target_pack_qty, plan.target_production_qty, plan.production_uom
  into v_expected_pack_qty, v_expected_production_qty, v_expected_production_uom
  from public.factory_packaging_pack_estimate(
    v_target_production_qty,
    p_uom,
    coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty),
    coalesce(v_finished_good.pack_size_uom, v_finished_good.base_uom),
    v_recipe_uom
  ) plan;

  if p_target_pack_qty is not null and abs(p_target_pack_qty - v_expected_pack_qty) > 0.000001 then
    raise exception 'Estimated Pack Qty does not match Target Production Qty and Packaging SKU Pack Size.';
  end if;

  if abs(v_target_production_qty - v_expected_production_qty) > 0.000001 then
    raise exception 'Target Production Qty does not match normalized Production UOM.';
  end if;

  v_target_pack_qty := v_expected_pack_qty;
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
