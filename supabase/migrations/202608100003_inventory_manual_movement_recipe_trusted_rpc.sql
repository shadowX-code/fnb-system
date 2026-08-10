-- Phase 3: trusted standalone ledger movement and recipe structure saves.
alter table public.inventory_lifecycle_requests drop constraint if exists inventory_lifecycle_requests_operation_check;
alter table public.inventory_lifecycle_requests add constraint inventory_lifecycle_requests_operation_check
  check (operation in ('purchase_receipt','waste','transfer','stock_check','purchase_order','manual_movement','recipe'));

create or replace function public.inventory_save_manual_movement(p_request_id uuid, p_movement jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_row public.inventory_movements%rowtype; v_result jsonb; v_now timestamptz:=now(); v_id uuid:=nullif(p_movement->>'id','')::uuid; v_outlet uuid:=nullif(p_movement->>'outlet_id','')::uuid; v_item uuid:=nullif(p_movement->>'inventory_item_id','')::uuid; v_type text:=initcap(coalesce(nullif(p_movement->>'movement_type',''),'Adjustment')); v_qty numeric:=nullif(p_movement->>'quantity','')::numeric;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not public.current_user_has_permission('inventory_movements.create') then raise exception using errcode='42501',message='Missing permission to create inventory movements.'; end if;
  if p_request_id is null or v_outlet is null or v_item is null or v_qty is null or v_qty=0 then raise exception 'Request, outlet, item and non-zero quantity are required.'; end if;
  if lower(v_type) not in ('adjustment','purchase','waste','transfer out','transfer in') then raise exception 'Unsupported inventory movement type.'; end if;
  if not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode='42501',message='You cannot record movements for this outlet.'; end if;
  if lower(v_type)='purchase' then v_qty:=abs(v_qty); elsif lower(v_type)='waste' then v_qty:=-abs(v_qty); end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='manual_movement'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  if v_id is null then
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,reference_id,reference_no,notes,created_by,created_at)
    values(v_outlet,v_item,v_type,v_qty,nullif(p_movement->>'unit',''),coalesce(nullif(p_movement->>'reference_type',''),'manual'),nullif(p_movement->>'reference_id','')::uuid,nullif(p_movement->>'reference_no',''),nullif(p_movement->>'notes',''),v_actor,coalesce(nullif(p_movement->>'created_at','')::timestamptz,v_now)) returning * into v_row;
  else
    select * into v_row from public.inventory_movements where id=v_id for update;
    if not found then raise exception 'Movement record was not found.'; end if;
    if not public.current_user_can_access_outlet(v_row.outlet_id) then raise exception using errcode='42501',message='You cannot edit this movement.'; end if;
    update public.inventory_movements set outlet_id=v_outlet,inventory_item_id=v_item,movement_type=v_type,quantity=v_qty,unit=nullif(p_movement->>'unit',''),reference_type=coalesce(nullif(p_movement->>'reference_type',''),'manual'),reference_id=nullif(p_movement->>'reference_id','')::uuid,reference_no=nullif(p_movement->>'reference_no',''),notes=nullif(p_movement->>'notes',''),created_by=v_actor where id=v_id returning * into v_row;
  end if;
  v_result:=jsonb_build_object('movement',to_jsonb(v_row)); insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'manual_movement',v_actor,v_outlet,v_result); return v_result;
end; $$;

create or replace function public.inventory_save_recipe(p_request_id uuid,p_recipe jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_recipe public.inventory_recipes%rowtype; v_item jsonb; v_result jsonb; v_now timestamptz:=now(); v_id uuid:=nullif(p_recipe->>'id','')::uuid; v_outlet uuid:=nullif(p_recipe->>'outlet_id','')::uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not public.current_user_has_permission('inventory_recipes.manage') then raise exception using errcode='42501',message='Missing permission to manage recipes.'; end if;
  if p_request_id is null or v_outlet is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Request, outlet and recipe ingredients are required.'; end if;
  if not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode='42501',message='You cannot save recipes for this outlet.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text)); select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='recipe'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  if v_id is null then insert into public.inventory_recipes(outlet_id,recipe_code,recipe_name,recipe_name_en,recipe_name_cn,menu_category,recipe_photo_url,selling_price,serving_size,status,notes,created_by,created_at,updated_at)
    values(v_outlet,nullif(p_recipe->>'recipe_code',''),nullif(p_recipe->>'recipe_name',''),nullif(p_recipe->>'recipe_name_en',''),nullif(p_recipe->>'recipe_name_cn',''),nullif(p_recipe->>'menu_category',''),nullif(p_recipe->>'recipe_photo_url',''),nullif(p_recipe->>'selling_price','')::numeric,nullif(p_recipe->>'serving_size','')::numeric,coalesce(nullif(p_recipe->>'status',''),'active'),nullif(p_recipe->>'notes',''),v_actor,v_now,v_now) returning * into v_recipe;
  else
    select * into v_recipe from public.inventory_recipes where id=v_id for update;
    if not found or not public.current_user_can_access_outlet(v_recipe.outlet_id) then raise exception using errcode='42501',message='You cannot edit this recipe.'; end if;
    update public.inventory_recipes set recipe_code=nullif(p_recipe->>'recipe_code',''),recipe_name=nullif(p_recipe->>'recipe_name',''),recipe_name_en=nullif(p_recipe->>'recipe_name_en',''),recipe_name_cn=nullif(p_recipe->>'recipe_name_cn',''),menu_category=nullif(p_recipe->>'menu_category',''),recipe_photo_url=nullif(p_recipe->>'recipe_photo_url',''),selling_price=nullif(p_recipe->>'selling_price','')::numeric,serving_size=nullif(p_recipe->>'serving_size','')::numeric,status=coalesce(nullif(p_recipe->>'status',''),'active'),notes=nullif(p_recipe->>'notes',''),updated_at=v_now where id=v_id returning * into v_recipe;
  end if;
  delete from public.inventory_recipe_items where recipe_id=v_recipe.id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(coalesce(v_item->>'inventory_item_id',v_item->>'item_id'),'') is null or coalesce(nullif(coalesce(v_item->>'quantity_used',v_item->>'quantityUsed'),'')::numeric,0)<=0 then raise exception 'Recipe ingredients require an item and positive quantity.'; end if;
    insert into public.inventory_recipe_items(recipe_id,inventory_item_id,quantity_used,unit,wastage_percent,remark,created_at,updated_at) values(v_recipe.id,coalesce(nullif(v_item->>'inventory_item_id',''),nullif(v_item->>'item_id',''))::uuid,coalesce(nullif(v_item->>'quantity_used','')::numeric,nullif(v_item->>'quantityUsed','')::numeric),nullif(v_item->>'unit',''),coalesce(nullif(coalesce(v_item->>'wastage_percent',v_item->>'wastagePercent'),'')::numeric,0),nullif(v_item->>'remark',''),v_now,v_now);
  end loop;
  v_result:=jsonb_build_object('recipe',to_jsonb(v_recipe),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.inventory_recipe_items i where i.recipe_id=v_recipe.id),'[]'::jsonb)); insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'recipe',v_actor,v_outlet,v_result); return v_result;
end; $$;

revoke all on function public.inventory_save_manual_movement(uuid,jsonb), public.inventory_save_recipe(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.inventory_save_manual_movement(uuid,jsonb), public.inventory_save_recipe(uuid,jsonb,jsonb) to authenticated;
