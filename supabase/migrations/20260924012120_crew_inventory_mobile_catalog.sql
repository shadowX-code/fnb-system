-- Only the mobile creation choices absent from the Phase 2 gateway read model.
-- Restaurant Inventory remains the owner of item, supplier and lifecycle data.
-- The existing Crew outlet projection already carries Management grants; also
-- expose the same employee-owned grant for fixed-outlet Crew so Home can avoid
-- probing forbidden Inventory RPCs. Every command still rechecks server-side.
create or replace function public.crew_outlet_scope(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
  v_employee public.employees%rowtype; v_ids uuid[]; v_outlets jsonb;
  v_default uuid; v_management boolean;
begin
  select * into v_employee from public.employees where id=v_employee_id;
  v_management:=lower(btrim(coalesce(v_employee.workplace,'')))='management';
  v_ids:=public.crew_authorized_outlet_ids(v_employee_id);
  if cardinality(v_ids)=0 then
    raise exception using errcode='42501',message='Crew Access is no longer active. Please sign in again.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,
      'special_access',public.crew_special_access_for_outlet(v_employee_id,o.id))
      order by o.name,o.id),'[]'::jsonb),
    (array_agg(o.id order by o.name,o.id))[1]
  into v_outlets,v_default from public.outlets o where o.id=any(v_ids);
  return jsonb_build_object('employee_id',v_employee_id,'management',v_management,
    'outlets',v_outlets,'default_outlet_id',v_default);
end; $$;

create function public.crew_inventory_mobile_catalog(p_token text, p_outlet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_scope jsonb := inventory_authority.crew_scope(p_token,p_outlet_id,'attention');
  v_outlet uuid := (v_scope->>'outlet_id')::uuid;
  v_stock boolean := coalesce((v_scope->>'can_perform_stock_check')::boolean,false)
    or coalesce((v_scope->>'can_create_audit_stock_check')::boolean,false);
  v_orders boolean := coalesce((v_scope->>'can_manage_purchase_orders')::boolean,false);
begin
  return jsonb_build_object(
    'outlet_id',v_outlet,
    'outlet_name',(select o.name from public.outlets o where o.id=v_outlet),
    'business_date',timezone('Asia/Kuala_Lumpur',now())::date,
    'categories',case when v_stock then coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.sort_order,c.name,c.id)
      from public.inventory_categories c where c.status='active' and exists(
        select 1 from public.inventory_items i join public.inventory_item_outlets io
          on io.inventory_item_id=i.id and io.outlet_id=v_outlet and io.is_active
        where i.category_id=c.id and i.status='active')
    ),'[]'::jsonb) else '[]'::jsonb end,
    'items',case when v_stock or v_orders then coalesce((
      select jsonb_agg(jsonb_build_object('id',i.id,'name',i.item_name,'sku',i.sku_code,
        'category_id',i.category_id,'unit',i.unit,'par_level',io.par_level,
        'supplier_ids',coalesce((select jsonb_agg(s.id order by s.name,s.id)
          from public.inventory_item_outlet_suppliers ios
          join public.suppliers s on s.id=ios.supplier_id and s.status='active'
          join public.supplier_outlets so on so.supplier_id=s.id and so.outlet_id=v_outlet
          where ios.inventory_item_outlet_id=io.id),'[]'::jsonb)) order by i.item_name,i.id)
      from public.inventory_item_outlets io join public.inventory_items i on i.id=io.inventory_item_id
      where io.outlet_id=v_outlet and io.is_active and i.status='active'
    ),'[]'::jsonb) else '[]'::jsonb end,
    'suppliers',case when v_orders then coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name,s.id)
      from public.supplier_outlets so join public.suppliers s on s.id=so.supplier_id
      where so.outlet_id=v_outlet and s.status='active'
    ),'[]'::jsonb) else '[]'::jsonb end
  );
end; $$;

revoke all on function public.crew_inventory_mobile_catalog(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_inventory_mobile_catalog(text,uuid) to anon,authenticated;
