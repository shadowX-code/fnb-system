-- Phase 2: Raw Material package content is master data. Recipe usage units are
-- independently recorded and are converted to Warehouse storage quantities only
-- through the canonical relationship below. Historical BOM values are preserved.
alter table public.factory_raw_materials
  add column if not exists conversion_package_uom text,
  add column if not exists conversion_package_quantity numeric,
  add column if not exists conversion_base_uom text;

alter table public.factory_product_recipe_items
  add column if not exists recipe_usage_uom text;

update public.factory_product_recipe_items
set recipe_usage_uom = uom
where recipe_usage_uom is null;

create or replace function public.factory_normalize_uom(p_uom text)
returns text language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_uom, '')))
    when 'kilogram' then 'kg' when 'kilograms' then 'kg'
    when 'gram' then 'g' when 'grams' then 'g'
    when 'l' then 'litre' when 'liter' then 'litre' when 'liters' then 'litre' when 'litres' then 'litre'
    when 'millilitre' then 'ml' when 'milliliter' then 'ml' when 'millilitres' then 'ml' when 'milliliters' then 'ml'
    else lower(btrim(coalesce(p_uom, '')))
  end;
$$;

create or replace function public.factory_uom_dimension(p_uom text)
returns text language sql immutable set search_path = public as $$
  select case public.factory_normalize_uom(p_uom)
    when 'kg' then 'weight' when 'g' then 'weight'
    when 'litre' then 'volume' when 'ml' then 'volume'
    else null
  end;
$$;

create or replace function public.factory_uom_to_base_factor(p_uom text)
returns numeric language sql immutable set search_path = public as $$
  select case public.factory_normalize_uom(p_uom)
    when 'kg' then 1000::numeric when 'g' then 1::numeric
    when 'litre' then 1000::numeric when 'ml' then 1::numeric
    else null
  end;
$$;

create or replace function public.factory_validate_raw_material_uom_conversion()
returns trigger language plpgsql set search_path = public as $$
declare
  v_package text := public.factory_normalize_uom(new.conversion_package_uom);
  v_base text := public.factory_normalize_uom(new.conversion_base_uom);
begin
  if new.conversion_package_uom is null and new.conversion_package_quantity is null and new.conversion_base_uom is null then
    return new;
  end if;
  if new.conversion_package_uom is null or new.conversion_package_quantity is null or new.conversion_base_uom is null then
    raise exception 'Package conversion requires package UOM, quantity and base UOM.';
  end if;
  if new.conversion_package_quantity <= 0 then
    raise exception 'Package conversion quantity must be greater than zero.';
  end if;
  if v_package not in ('pack', 'pail', 'bottle', 'bag', 'carton', 'pcs') then
    raise exception 'Package conversion source UOM must be a package unit.';
  end if;
  if public.factory_uom_dimension(v_base) is null then
    raise exception 'Package conversion base UOM must be kg, g, litre or ml.';
  end if;
  new.conversion_package_uom := v_package;
  new.conversion_base_uom := v_base;
  return new;
end;
$$;

drop trigger if exists factory_validate_raw_material_uom_conversion on public.factory_raw_materials;
create trigger factory_validate_raw_material_uom_conversion
before insert or update of conversion_package_uom, conversion_package_quantity, conversion_base_uom
on public.factory_raw_materials
for each row execute function public.factory_validate_raw_material_uom_conversion();

-- Internal conversion result is deliberately tri-state so callers surface a
-- missing relationship instead of silently applying a guessed package factor.
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
  v_package text;
  v_base text;
  v_base_quantity numeric;
  v_from_factor numeric;
  v_to_factor numeric;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be zero or greater.';
  end if;
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
  v_package := public.factory_normalize_uom(v_material.conversion_package_uom);
  v_base := public.factory_normalize_uom(v_material.conversion_base_uom);
  if v_package = '' or v_base = '' or coalesce(v_material.conversion_package_quantity, 0) <= 0 then
    return query select null::numeric, 'missing_conversion'::text, 'Missing UOM conversion in Raw Material master.'::text;
    return;
  end if;
  if v_from = v_package then
    v_base_quantity := p_quantity * v_material.conversion_package_quantity;
  elsif public.factory_uom_dimension(v_from) = public.factory_uom_dimension(v_base) then
    v_base_quantity := p_quantity * public.factory_uom_to_base_factor(v_from) / public.factory_uom_to_base_factor(v_base);
  else
    return query select null::numeric, 'missing_conversion'::text, 'Missing UOM conversion in Raw Material master.'::text;
    return;
  end if;
  if v_to = v_package then
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

create or replace function public.factory_convert_raw_material_quantity(
  p_raw_material_id uuid,
  p_quantity numeric,
  p_from_uom text,
  p_to_uom text
) returns table(converted_quantity numeric, conversion_status text, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not (
    public.current_user_has_permission('factory_raw_inventory.view')
    or public.current_user_has_permission('factory_product_recipes.view')
    or public.current_user_has_permission('factory_production.complete')
  ) then raise exception using errcode = '42501', message = 'Missing Factory UOM conversion permission.'; end if;
  return query select * from public.factory_convert_raw_material_quantity_internal(p_raw_material_id, p_quantity, p_from_uom, p_to_uom);
end;
$$;

revoke all on function public.factory_convert_raw_material_quantity_internal(uuid,numeric,text,text) from public, anon, authenticated;
revoke all on function public.factory_convert_raw_material_quantity(uuid,numeric,text,text) from public, anon;
grant execute on function public.factory_convert_raw_material_quantity(uuid,numeric,text,text) to authenticated;

-- Updates preserve recipe code and persist the independently selected usage
-- UOM. Existing rows remain untouched and are not reinterpreted.
create or replace function public.save_factory_product_recipe(
  p_request_id uuid, p_recipe jsonb, p_bom_items jsonb
) returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare
  v_actor uuid := auth.uid(); v_recipe_id uuid := nullif(p_recipe->>'id','')::uuid;
  v_operation text := case when v_recipe_id is null then 'create_product_recipe' else 'update_product_recipe' end;
  v_existing public.factory_product_recipes%rowtype; v_saved public.factory_product_recipes%rowtype;
  v_request public.factory_product_recipe_requests%rowtype; v_employee_id uuid;
  v_code text := nullif(btrim(p_recipe->>'recipe_code'),''); v_name text := nullif(btrim(p_recipe->>'recipe_name'),'');
  v_family uuid := nullif(p_recipe->>'product_family_id','')::uuid; v_finished_good uuid := nullif(p_recipe->>'finished_good_id','')::uuid;
  v_yield numeric := nullif(p_recipe->>'yield_quantity','')::numeric; v_uom text := nullif(btrim(p_recipe->>'uom'),'');
  v_fingerprint text; v_result jsonb; v_item jsonb; v_material public.factory_raw_materials%rowtype;
  v_usage_uom text;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if p_request_id is null or jsonb_typeof(p_bom_items) <> 'array' then raise exception 'A request ID and BOM array are required.'; end if;
  if v_operation='create_product_recipe' and not public.current_user_has_permission('factory_product_recipes.create') then raise exception using errcode='42501', message='Missing Factory Product Recipe create permission.'; end if;
  if v_operation='update_product_recipe' and not (public.current_user_has_permission('factory_product_recipes.edit') or public.current_user_has_permission('factory_product_recipes.manage')) then raise exception using errcode='42501', message='Missing Factory Product Recipe edit permission.'; end if;
  if v_recipe_id is not null then
    select * into v_existing from public.factory_product_recipes where id=v_recipe_id for update;
    if not found then raise exception 'Recipe not found.'; end if;
    if lower(coalesce(v_existing.status,'')) <> 'draft' then raise exception 'Only draft recipes can be structurally edited.'; end if;
    v_code := v_existing.recipe_code;
  end if;
  if v_code is null or v_name is null or v_family is null or v_yield is null or v_yield <= 0 or v_uom is null then raise exception 'Recipe code, name, Finished Good family, positive yield and UOM are required.'; end if;
  if jsonb_array_length(p_bom_items)=0 then raise exception 'At least one BOM row is required.'; end if;
  for v_item in select value from jsonb_array_elements(p_bom_items) loop
    if nullif(v_item->>'raw_material_id','') is null or coalesce((v_item->>'quantity_used')::numeric,0) <= 0 then raise exception 'Every BOM row requires an existing raw material and positive quantity.'; end if;
    select * into v_material from public.factory_raw_materials where id=(v_item->>'raw_material_id')::uuid;
    if not found then raise exception 'Every BOM row requires an existing raw material and positive quantity.'; end if;
    v_usage_uom := coalesce(nullif(btrim(v_item->>'recipe_usage_uom'), ''), nullif(btrim(v_item->>'uom'), ''));
    if v_usage_uom is null then raise exception 'Every BOM row requires a Usage UOM.'; end if;
  end loop;
  v_fingerprint := md5(jsonb_build_object('operation',v_operation,'recipe',jsonb_build_object('id',v_recipe_id,'recipe_code',v_code,'recipe_name',v_name,'product_family_id',v_family,'finished_good_id',v_finished_good,'yield_quantity',v_yield,'uom',v_uom,'version',p_recipe->>'version','remarks',coalesce(p_recipe->>'remarks',p_recipe->>'notes',''),'estimated_production_time_minutes',p_recipe->>'estimated_production_time_minutes'),'items',(select coalesce(jsonb_agg(item order by coalesce((item->>'sort_order')::integer,1), item->>'raw_material_id', item->>'quantity_used'),'[]'::jsonb) from jsonb_array_elements(p_bom_items) item))::text);
  select * into v_request from public.factory_product_recipe_requests where request_id=p_request_id for update;
  if found then
    if v_request.operation=v_operation and v_request.actor_auth_user_id=v_actor and v_request.payload_fingerprint=v_fingerprint and v_request.canonical_result is not null then return v_request.canonical_result; end if;
    raise exception 'Request ID was already used for a different Factory Product Recipe save.';
  end if;
  if v_recipe_id is not null then
    update public.factory_product_recipes set recipe_code=v_code, recipe_name=v_name, product_name=coalesce(nullif(p_recipe->>'product_name',''),v_existing.product_name), product_family_id=v_family, finished_good_id=v_finished_good, version=nullif(p_recipe->>'version',''), yield_quantity=v_yield, uom=v_uom, estimated_production_time_minutes=nullif(p_recipe->>'estimated_production_time_minutes','')::numeric, notes=coalesce(p_recipe->>'remarks',p_recipe->>'notes',''), remarks=coalesce(p_recipe->>'remarks',p_recipe->>'notes',''), status='draft', updated_at=now() where id=v_recipe_id returning * into v_saved;
    delete from public.factory_product_recipe_items where recipe_id=v_recipe_id;
  else
    select id into v_employee_id from public.employees where auth_user_id=v_actor limit 1;
    insert into public.factory_product_recipes(recipe_code,recipe_name,product_name,product_family_id,finished_good_id,version,yield_quantity,uom,estimated_production_time_minutes,status,notes,remarks,created_by) values(v_code,v_name,coalesce(nullif(p_recipe->>'product_name',''),v_name),v_family,v_finished_good,nullif(p_recipe->>'version',''),v_yield,v_uom,nullif(p_recipe->>'estimated_production_time_minutes','')::numeric,'draft',coalesce(p_recipe->>'remarks',p_recipe->>'notes',''),coalesce(p_recipe->>'remarks',p_recipe->>'notes',''),v_employee_id) returning * into v_saved;
  end if;
  insert into public.factory_product_recipe_items(recipe_id,raw_material_id,quantity_used,uom,recipe_usage_uom,wastage_percent,sort_order,notes,remarks,updated_at)
  select v_saved.id,(item->>'raw_material_id')::uuid,(item->>'quantity_used')::numeric,coalesce(nullif(item->>'recipe_usage_uom',''),nullif(item->>'uom','')),coalesce(nullif(item->>'recipe_usage_uom',''),nullif(item->>'uom','')),coalesce((item->>'wastage_percent')::numeric,0),coalesce((item->>'sort_order')::integer,ordinality),coalesce(item->>'remarks',item->>'notes',''),coalesce(item->>'remarks',item->>'notes',''),now() from jsonb_array_elements(p_bom_items) with ordinality rows(item, ordinality);
  select jsonb_build_object('recipe',to_jsonb(v_saved),'items',coalesce((select jsonb_agg(to_jsonb(item) order by item.sort_order,item.id) from public.factory_product_recipe_items item where item.recipe_id=v_saved.id),'[]'::jsonb)) into v_result;
  insert into public.factory_product_recipe_requests(request_id,operation,actor_auth_user_id,recipe_id,payload_fingerprint,canonical_result,completed_at) values(p_request_id,v_operation,v_actor,v_saved.id,v_fingerprint,v_result,now());
  return v_result;
end; $$;

revoke all on function public.save_factory_product_recipe(uuid,jsonb,jsonb) from public;
grant execute on function public.save_factory_product_recipe(uuid,jsonb,jsonb) to authenticated;

-- The client uses the same pure conversion contract for its preview. The
-- completion wrapper repeats the standard-usage calculation before stock is
-- deducted, so browser state cannot substitute a different storage quantity.
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
    select item.id, item.raw_material_id, item.quantity_used, coalesce(nullif(item.recipe_usage_uom, ''), item.uom) as recipe_usage_uom, material.uom as storage_uom
    from public.factory_product_recipe_items item
    join public.factory_raw_materials material on material.id = item.raw_material_id
    where item.recipe_id = p_recipe_id
  loop
    select * into v_conversion from public.factory_convert_raw_material_quantity_internal(v_item.raw_material_id, v_item.quantity_used * p_output_quantity / v_recipe.yield_quantity, v_item.recipe_usage_uom, v_item.storage_uom);
    if v_conversion.converted_quantity is null then raise exception '%', coalesce(v_conversion.reason, 'Missing UOM conversion in Raw Material master.'); end if;
    select value into v_submitted from jsonb_array_elements(p_usage_items) value where value->>'raw_material_id' = v_item.raw_material_id::text limit 1;
    if v_submitted is null then raise exception 'Production material usage is missing a recipe raw material.'; end if;
    v_submitted_standard := nullif(v_submitted->>'standard_usage', '')::numeric;
    v_submitted_uom := public.factory_normalize_uom(v_submitted->>'uom');
    if v_submitted_standard is null or v_submitted_uom <> public.factory_normalize_uom(v_item.storage_uom) then raise exception 'Production standard usage must use the Raw Material storage UOM.'; end if;
    if abs(v_submitted_standard - v_conversion.converted_quantity) > 0.000001 then raise exception 'Production standard usage does not match the active recipe conversion.'; end if;
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
