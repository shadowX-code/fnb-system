-- Conflicting menus never establish one price. Keep current knowledge ahead of archived history.
create or replace function marketing_private.customer_knowledge_facts(p_brand uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare facts jsonb:='{}'; k public.marketing_customer_knowledge; item jsonb; items jsonb; recipe public.inventory_recipes; today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; outlet_row record;
begin
 for k in select * from public.marketing_customer_knowledge where brand_id=p_brand and state='confirmed' order by id loop
  -- Scoped facts need an explicit conversational Outlet authority, which is not yet available.
  if jsonb_array_length(k.data->'outlet_ids')>0 then continue;end if;
  if k.kind='promotion' then
   if today not between (k.data->>'starts_on')::date and (k.data->>'ends_on')::date then continue;end if;
   facts:=facts||jsonb_build_object('promotion:'||k.id||':'||k.revision,jsonb_build_object('label',k.data->>'name','category','promotions','text',k.data->>'details','terms',k.data->>'terms','starts_on',k.data->>'starts_on','ends_on',k.data->>'ends_on','source','manager_confirmed_promotion','confirmed_at',k.confirmed_at));
  else
   items:='[]';
   for item in select value from jsonb_array_elements(k.data->'items') loop
    recipe:=null;
    if nullif(item->>'recipe_id','') is not null then
     select r.* into recipe from public.inventory_recipes r join public.brand_outlets bo on bo.outlet_id=r.outlet_id join public.outlets o on o.id=r.outlet_id where bo.brand_id=p_brand and r.id=(item->>'recipe_id')::uuid and r.status='active' and o.is_active;
     -- Restaurant recipes are Outlet-specific; unknown Outlet cannot establish one price.
     item:=item||jsonb_build_object('price',null,'price_issue','outlet_required','canonical_name',recipe.recipe_name,'canonical_updated_at',recipe.updated_at);
    elsif exists(select 1 from public.inventory_recipes r join public.brand_outlets bo on bo.outlet_id=r.outlet_id where bo.brand_id=p_brand and r.status='active' and lower(trim(r.recipe_name))=lower(trim(item->>'name'))) then
     item:=item||jsonb_build_object('price',null,'price_issue','canonical_menu_link_required');
    elsif item->>'price' is not null and exists(
     select 1 from public.marketing_customer_knowledge other cross join lateral jsonb_array_elements(other.data->'items') candidate
     where other.brand_id=p_brand and other.kind='menu' and other.state='confirmed' and jsonb_array_length(other.data->'outlet_ids')=0
      and lower(trim(candidate->>'name'))=lower(trim(item->>'name')) and candidate->>'price' is not null
      and (other.data->>'currency' is distinct from k.data->>'currency' or (candidate->>'price')::numeric<>(item->>'price')::numeric)
    ) then item:=item||jsonb_build_object('price',null,'price_issue','conflicting_confirmed_menus');
    end if;
    items:=items||jsonb_build_array(item);
   end loop;
   facts:=facts||jsonb_build_object('menu:'||k.id||':'||k.revision,jsonb_build_object('label',k.data->>'name','category','menu_drinks','items',items,'currency',k.data->>'currency','source','manager_confirmed_menu','source_file',k.filename,'source_date',k.data->>'source_date','confirmed_at',k.confirmed_at));
  end if;
 end loop;
 for outlet_row in select o.id,o.name,o.address,o.updated_at from public.outlets o join public.brand_outlets bo on bo.outlet_id=o.id where bo.brand_id=p_brand and o.is_active order by o.id loop
  if nullif(trim(outlet_row.address),'') is not null then facts:=facts||jsonb_build_object('outlet:'||outlet_row.id,jsonb_build_object('label',outlet_row.name,'category','location','text',outlet_row.name||': '||outlet_row.address,'source','restaurant_outlet_master','updated_at',outlet_row.updated_at));end if;
 end loop;
 return facts;
end;$$;
revoke all on function marketing_private.customer_knowledge_facts(uuid) from public,anon,authenticated,service_role;


create or replace function public.marketing_knowledge_workspace(p_brand uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb; entries jsonb; recipes jsonb;
begin
 r:=public.marketing_knowledge_workspace_legacy(p_brand);
 select coalesce(jsonb_agg(to_jsonb(k) order by updated_at desc),'[]') into entries from (select * from public.marketing_customer_knowledge where brand_id=p_brand order by (state='inactive'),updated_at desc limit 150)k;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',recipe_name,'outlet_id',outlet_id,'selling_price',selling_price,'category',menu_category,'updated_at',updated_at) order by recipe_name),'[]') into recipes from (select r.* from public.inventory_recipes r join public.brand_outlets bo on bo.outlet_id=r.outlet_id where bo.brand_id=p_brand and r.status='active' order by r.recipe_name limit 300) x;
 return r||jsonb_build_object('customer_knowledge',entries,'canonical_menu',recipes,'knowledge_confirmed_revision',(select confirmed_revision from public.marketing_knowledge where brand_id=p_brand));
end;$$;

