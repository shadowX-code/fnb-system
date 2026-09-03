-- Raw Material conversion metadata is the only authority for new Recipe usage
-- units. Existing BOM quantities and usage units are retained as historical
-- evidence when a Draft is otherwise edited.
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
before insert or update of uom, conversion_package_uom, conversion_package_quantity, conversion_base_uom
on public.factory_raw_materials
for each row execute function public.factory_validate_raw_material_uom_conversion();

alter table public.factory_raw_materials drop column if exists default_recipe_usage_uom;
drop function if exists public.factory_raw_material_uom_reachable(text,text,numeric,text,text,text);

create or replace function public.factory_validate_recipe_usage_uom()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_material public.factory_raw_materials%rowtype;
  v_usage text := public.factory_normalize_uom(coalesce(new.recipe_usage_uom, new.uom));
  v_canonical text;
begin
  select * into v_material from public.factory_raw_materials where id = new.raw_material_id;
  if not found then raise exception 'Every BOM row requires an existing raw material and positive quantity.'; end if;
  v_canonical := case
    when coalesce(v_material.conversion_package_quantity, 0) > 0
      and public.factory_normalize_uom(v_material.conversion_package_uom) <> ''
      and public.factory_uom_dimension(v_material.conversion_base_uom) is not null
      then public.factory_normalize_uom(v_material.conversion_base_uom)
    else public.factory_normalize_uom(v_material.uom)
  end;
  if v_usage = '' then raise exception 'Every BOM row requires a Usage UOM.'; end if;
  if current_setting('factory.allow_historical_recipe_usage_uom', true) is distinct from 'true'
    and v_usage <> v_canonical then
    raise exception 'Recipe Usage UOM must match the Raw Material canonical Recipe UOM.';
  end if;
  new.recipe_usage_uom := v_usage;
  new.uom := v_usage;
  return new;
end;
$$;

drop trigger if exists factory_validate_recipe_usage_uom on public.factory_product_recipe_items;
create trigger factory_validate_recipe_usage_uom
before insert or update of raw_material_id, recipe_usage_uom, uom
on public.factory_product_recipe_items
for each row execute function public.factory_validate_recipe_usage_uom();

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
  v_existing_item public.factory_product_recipe_items%rowtype; v_usage_uom text; v_canonical_uom text;
  v_resolved_items jsonb := '[]'::jsonb; v_preserves_historical boolean := false;
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
    v_canonical_uom := case when coalesce(v_material.conversion_package_quantity, 0) > 0 and public.factory_normalize_uom(v_material.conversion_package_uom) <> '' and public.factory_uom_dimension(v_material.conversion_base_uom) is not null then public.factory_normalize_uom(v_material.conversion_base_uom) else public.factory_normalize_uom(v_material.uom) end;
    v_existing_item := null;
    if v_recipe_id is not null and nullif(v_item->>'id', '') is not null then
      select * into v_existing_item from public.factory_product_recipe_items where id=(v_item->>'id')::uuid and recipe_id=v_recipe_id;
    end if;
    if found and v_existing_item.raw_material_id = v_material.id then
      v_usage_uom := public.factory_normalize_uom(coalesce(v_existing_item.recipe_usage_uom, v_existing_item.uom));
      v_preserves_historical := v_preserves_historical or v_usage_uom <> v_canonical_uom;
    else
      v_usage_uom := v_canonical_uom;
    end if;
    if v_usage_uom = '' then raise exception 'Every BOM row requires a Usage UOM.'; end if;
    v_resolved_items := v_resolved_items || jsonb_build_array((v_item - 'id') || jsonb_build_object('recipe_usage_uom', v_usage_uom, 'uom', v_usage_uom));
  end loop;
  v_fingerprint := md5(jsonb_build_object('operation',v_operation,'recipe',jsonb_build_object('id',v_recipe_id,'recipe_code',v_code,'recipe_name',v_name,'product_family_id',v_family,'finished_good_id',v_finished_good,'yield_quantity',v_yield,'uom',v_uom,'version',p_recipe->>'version','remarks',coalesce(p_recipe->>'remarks',p_recipe->>'notes',''),'estimated_production_time_minutes',p_recipe->>'estimated_production_time_minutes'),'items',v_resolved_items)::text);
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
  if v_preserves_historical then perform set_config('factory.allow_historical_recipe_usage_uom', 'true', true); end if;
  insert into public.factory_product_recipe_items(recipe_id,raw_material_id,quantity_used,uom,recipe_usage_uom,wastage_percent,sort_order,notes,remarks,updated_at)
  select v_saved.id,(item->>'raw_material_id')::uuid,(item->>'quantity_used')::numeric,item->>'recipe_usage_uom',item->>'recipe_usage_uom',coalesce((item->>'wastage_percent')::numeric,0),coalesce((item->>'sort_order')::integer,ordinality),coalesce(item->>'remarks',item->>'notes',''),coalesce(item->>'remarks',item->>'notes',''),now() from jsonb_array_elements(v_resolved_items) with ordinality rows(item, ordinality);
  select jsonb_build_object('recipe',to_jsonb(v_saved),'items',coalesce((select jsonb_agg(to_jsonb(item) order by item.sort_order,item.id) from public.factory_product_recipe_items item where item.recipe_id=v_saved.id),'[]'::jsonb)) into v_result;
  insert into public.factory_product_recipe_requests(request_id,operation,actor_auth_user_id,recipe_id,payload_fingerprint,canonical_result,completed_at) values(p_request_id,v_operation,v_actor,v_saved.id,v_fingerprint,v_result,now());
  return v_result;
end;
$$;

revoke all on function public.save_factory_product_recipe(uuid,jsonb,jsonb) from public;
grant execute on function public.save_factory_product_recipe(uuid,jsonb,jsonb) to authenticated;
