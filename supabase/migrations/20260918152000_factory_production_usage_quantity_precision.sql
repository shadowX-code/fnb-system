-- Production execution uses four-decimal operational quantities from recipe
-- conversion through batch allocation and trusted inventory deduction.
-- The Raw Material storage UOM is the package source when conversion metadata
-- is configured; this replaces the retired conversion_package_uom contract.
create or replace function public.factory_convert_raw_material_quantity_internal(
  p_raw_material_id uuid,
  p_quantity numeric,
  p_from_uom text,
  p_to_uom text
) returns table(converted_quantity numeric, conversion_status text, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_material public.factory_raw_materials%rowtype;
  v_from text := public.factory_normalize_uom(p_from_uom);
  v_to text := public.factory_normalize_uom(p_to_uom);
  v_storage text;
  v_base text;
  v_base_quantity numeric;
  v_from_factor numeric;
  v_to_factor numeric;
begin
  if p_quantity is null or p_quantity < 0 then raise exception 'Quantity must be zero or greater.'; end if;
  select * into v_material from public.factory_raw_materials where id = p_raw_material_id;
  if not found then raise exception 'Raw Material was not found.'; end if;
  if v_from = '' or v_to = '' then
    return query select null::numeric, 'invalid_uom'::text, 'Usage and target UOM are required.'::text;
    return;
  end if;
  if v_from = v_to then
    return query select p_quantity, 'converted'::text, null::text;
    return;
  end if;
  v_from_factor := public.factory_uom_to_base_factor(v_from);
  v_to_factor := public.factory_uom_to_base_factor(v_to);
  if v_from_factor is not null and v_to_factor is not null and public.factory_uom_dimension(v_from) = public.factory_uom_dimension(v_to) then
    return query select p_quantity * v_from_factor / v_to_factor, 'converted'::text, null::text;
    return;
  end if;
  v_storage := public.factory_normalize_uom(v_material.uom);
  v_base := public.factory_normalize_uom(v_material.conversion_base_uom);
  if v_storage = '' or v_base = '' or coalesce(v_material.conversion_package_quantity, 0) <= 0 then
    return query select null::numeric, 'missing_conversion'::text, 'Missing UOM conversion in Raw Material master.'::text;
    return;
  end if;
  if v_from = v_storage then
    v_base_quantity := p_quantity * v_material.conversion_package_quantity;
  elsif public.factory_uom_dimension(v_from) = public.factory_uom_dimension(v_base) then
    v_base_quantity := p_quantity * public.factory_uom_to_base_factor(v_from) / public.factory_uom_to_base_factor(v_base);
  else
    return query select null::numeric, 'missing_conversion'::text, 'Missing UOM conversion in Raw Material master.'::text;
    return;
  end if;
  if v_to = v_storage then
    return query select v_base_quantity / v_material.conversion_package_quantity, 'converted'::text, null::text;
    return;
  end if;
  if public.factory_uom_dimension(v_to) = public.factory_uom_dimension(v_base) then
    return query select v_base_quantity * public.factory_uom_to_base_factor(v_base) / public.factory_uom_to_base_factor(v_to), 'converted'::text, null::text;
    return;
  end if;
  return query select null::numeric, 'missing_conversion'::text, 'Missing UOM conversion in Raw Material master.'::text;
end;
$$;
revoke all on function public.factory_convert_raw_material_quantity_internal(uuid,numeric,text,text) from public, anon, authenticated;

create or replace function public.factory_validate_production_usage_precision_internal(p_usage_items jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item jsonb;
  v_allocation jsonb;
  v_field text;
  v_quantity numeric;
begin
  if jsonb_typeof(p_usage_items) <> 'array' then raise exception 'Production material usage must be an array.'; end if;
  for v_item in select value from jsonb_array_elements(p_usage_items) loop
    foreach v_field in array array['standard_usage', 'actual_usage'] loop
      v_quantity := nullif(v_item->>v_field, '')::numeric;
      if v_quantity is null or v_quantity < 0 then raise exception 'Production % must be zero or greater.', replace(v_field, '_', ' '); end if;
      if v_quantity <> round(v_quantity, 4) then raise exception 'Production % supports up to 4 decimal places.', replace(v_field, '_', ' '); end if;
    end loop;
    if jsonb_typeof(coalesce(v_item->'allocations', '[]'::jsonb)) <> 'array' then raise exception 'Raw Material batch allocations must be an array.'; end if;
    for v_allocation in select value from jsonb_array_elements(coalesce(v_item->'allocations', '[]'::jsonb)) loop
      v_quantity := nullif(v_allocation->>'allocated_qty', '')::numeric;
      if v_quantity is null or v_quantity < 0 then raise exception 'Raw Material batch allocation quantity must be zero or greater.'; end if;
      if v_quantity <> round(v_quantity, 4) then raise exception 'Raw Material batch allocation quantity supports up to 4 decimal places.'; end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.factory_validate_production_usage_precision_internal(jsonb) from public, anon, authenticated;

create or replace function public.factory_validate_production_recipe_usage_internal(
  p_recipe_id uuid,
  p_output_quantity numeric,
  p_usage_items jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_recipe public.factory_product_recipes%rowtype;
  v_item record;
  v_expected numeric;
  v_conversion record;
  v_submitted jsonb;
  v_submitted_standard numeric;
  v_submitted_uom text;
begin
  if p_output_quantity is null or p_output_quantity < 0 then raise exception 'Production output quantity must be zero or greater.'; end if;
  if jsonb_typeof(p_usage_items) <> 'array' then raise exception 'Production material usage must be an array.'; end if;
  select * into v_recipe from public.factory_product_recipes where id = p_recipe_id;
  if not found or lower(coalesce(v_recipe.status, '')) <> 'active' then raise exception 'Production recipe must be active.'; end if;
  if coalesce(v_recipe.yield_quantity, 0) <= 0 then raise exception 'Production recipe yield must be greater than zero.'; end if;
  for v_item in
    select item.raw_material_id, item.quantity_used, coalesce(nullif(item.recipe_usage_uom, ''), item.uom) as recipe_usage_uom, material.uom as storage_uom
    from public.factory_product_recipe_items item
    join public.factory_raw_materials material on material.id = item.raw_material_id
    where item.recipe_id = p_recipe_id
  loop
    select * into v_conversion from public.factory_convert_raw_material_quantity_internal(v_item.raw_material_id, v_item.quantity_used * p_output_quantity / v_recipe.yield_quantity, v_item.recipe_usage_uom, v_item.storage_uom);
    if v_conversion.converted_quantity is null then raise exception '%', coalesce(v_conversion.reason, 'Missing UOM conversion in Raw Material master.'); end if;
    v_expected := round(v_conversion.converted_quantity, 4);
    select value into v_submitted from jsonb_array_elements(p_usage_items) value where value->>'raw_material_id' = v_item.raw_material_id::text limit 1;
    if v_submitted is null then raise exception 'Production material usage is missing a recipe raw material.'; end if;
    v_submitted_standard := nullif(v_submitted->>'standard_usage', '')::numeric;
    v_submitted_uom := public.factory_normalize_uom(v_submitted->>'uom');
    if v_submitted_standard is null or v_submitted_uom <> public.factory_normalize_uom(v_item.storage_uom) then raise exception 'Production standard usage must use the Raw Material storage UOM.'; end if;
    if abs(v_submitted_standard - v_expected) > 0.000001 then raise exception 'Production standard usage does not match the active recipe conversion.'; end if;
  end loop;
end;
$$;
revoke all on function public.factory_validate_production_recipe_usage_internal(uuid,numeric,jsonb) from public, anon, authenticated;

create or replace function public.factory_complete_production_with_raw_batch_allocations(p_request_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_employee_id uuid;
  v_employee_name text;
  v_production_id uuid;
  v_authoritative_payload jsonb;
  v_recipe_id uuid := nullif(p_payload->>'recipe_id', '')::uuid;
begin
  v_employee_id := public.factory_current_active_employee_id();
  v_employee_name := public.factory_current_active_employee_name();
  v_authoritative_payload := (p_payload - 'operator_id' - 'operator_name' - 'recipe_id') || jsonb_build_object('operator_id', v_employee_id, 'operator_name', v_employee_name);
  perform public.factory_validate_production_usage_precision_internal(coalesce(v_authoritative_payload->'usage_items', '[]'::jsonb));
  if v_recipe_id is not null then
    perform public.factory_validate_production_recipe_usage_internal(v_recipe_id, nullif(v_authoritative_payload->>'actual_output_qty', '')::numeric, coalesce(v_authoritative_payload->'usage_items', '[]'::jsonb));
  end if;
  v_production_id := public.factory_complete_production_with_raw_batch_allocations_impl_050031(p_request_id, v_authoritative_payload);
  perform public.factory_mesti_materialize_equipment_cleaning_after_production(v_production_id);
  return v_production_id;
end;
$$;
revoke all on function public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb) from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
