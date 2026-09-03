-- Preserve existing Recipe codes during trusted draft updates. Recipe codes are generated on create only.
create or replace function public.save_factory_product_recipe(
  p_request_id uuid, p_recipe jsonb, p_bom_items jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid(); v_recipe_id uuid := nullif(p_recipe->>'id','')::uuid;
  v_operation text := case when v_recipe_id is null then 'create_product_recipe' else 'update_product_recipe' end;
  v_existing public.factory_product_recipes%rowtype; v_saved public.factory_product_recipes%rowtype;
  v_request public.factory_product_recipe_requests%rowtype; v_employee_id uuid;
  v_code text := nullif(btrim(p_recipe->>'recipe_code'),''); v_name text := nullif(btrim(p_recipe->>'recipe_name'),'');
  v_family uuid := nullif(p_recipe->>'product_family_id','')::uuid; v_finished_good uuid := nullif(p_recipe->>'finished_good_id','')::uuid;
  v_yield numeric := nullif(p_recipe->>'yield_quantity','')::numeric; v_uom text := nullif(btrim(p_recipe->>'uom'),'');
  v_fingerprint text; v_result jsonb;
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
  if jsonb_array_length(p_bom_items)=0 or exists (select 1 from jsonb_array_elements(p_bom_items) item where nullif(item->>'raw_material_id','') is null or coalesce((item->>'quantity_used')::numeric,0)<=0 or not exists (select 1 from public.factory_raw_materials material where material.id=(item->>'raw_material_id')::uuid)) then raise exception 'Every BOM row requires an existing raw material and positive quantity.'; end if;
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
  insert into public.factory_product_recipe_items(recipe_id,raw_material_id,quantity_used,uom,wastage_percent,sort_order,notes,remarks,updated_at)
  select v_saved.id,(item->>'raw_material_id')::uuid,(item->>'quantity_used')::numeric,nullif(item->>'uom',''),coalesce((item->>'wastage_percent')::numeric,0),coalesce((item->>'sort_order')::integer,ordinality),coalesce(item->>'remarks',item->>'notes',''),coalesce(item->>'remarks',item->>'notes',''),now() from jsonb_array_elements(p_bom_items) with ordinality rows(item, ordinality);
  select jsonb_build_object('recipe',to_jsonb(v_saved),'items',coalesce((select jsonb_agg(to_jsonb(item) order by item.sort_order,item.id) from public.factory_product_recipe_items item where item.recipe_id=v_saved.id),'[]'::jsonb)) into v_result;
  insert into public.factory_product_recipe_requests(request_id,operation,actor_auth_user_id,recipe_id,payload_fingerprint,canonical_result,completed_at) values(p_request_id,v_operation,v_actor,v_saved.id,v_fingerprint,v_result,now());
  return v_result;
end; $$;

revoke all on function public.save_factory_product_recipe(uuid,jsonb,jsonb) from public;
grant execute on function public.save_factory_product_recipe(uuid,jsonb,jsonb) to authenticated;
