-- Contract test for the earlier single-UOM guard (20261120163904).
-- For the current cutover workflow, run restaurantVersionedInventoryUom.rollback.sql.
begin;
do $$
declare
  v_actor uuid;
  v_candidate uuid;
  v_item uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_cost uuid := gen_random_uuid();
  v_outlet uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_config uuid;
  v_rev uuid := gen_random_uuid();
  v_order uuid;
  v_alt text;
  v_employee uuid := gen_random_uuid();
  v_token text := gen_random_uuid()::text;
begin
  select code into v_alt from public.inventory_uoms where is_active and code <> 'pcs' order by sort_order limit 1;
  if v_alt is null then raise exception 'An alternate UOM is required'; end if;
  insert into public.outlets(id,name,code) values(v_outlet,'QA Single UOM','QAS'||left(v_outlet::text,6));
  insert into public.suppliers(id,name,status) values (v_supplier,'QA Single UOM Supplier','active');
  insert into public.supplier_outlets(supplier_id,outlet_id) values(v_supplier,v_outlet);
  insert into public.inventory_items(id,item_name,unit) values
    (v_item,'QA Unused Single UOM','pcs'),(v_legacy,'QA Legacy UOM','pcs'),(v_cost,'QA Cost UOM','pcs');
  insert into public.inventory_item_outlets(inventory_item_id,outlet_id,par_level) values(v_item,v_outlet,null),(v_cost,v_outlet,null);
  insert into public.inventory_item_outlets(inventory_item_id,outlet_id,par_level)
    values(v_legacy,v_outlet,null) returning id into v_config;
  insert into public.inventory_item_outlet_suppliers(inventory_item_outlet_id,supplier_id) values(v_config,v_supplier);
  for v_candidate in
    select e.auth_user_id from public.employees e join public.roles r on r.id=e.role_id
    where lower(r.name) in ('owner','admin') and e.auth_user_id is not null
    union select p.id from public.user_profiles p join public.roles r on r.id=p.role_id where lower(r.name) in ('owner','admin')
  loop
    perform set_config('request.jwt.claim.sub',v_candidate::text,true);
    if public.current_user_has_permission('inventory_master.edit')
      and public.current_user_has_permission('inventory_orders.create')
      and public.current_user_has_permission('inventory_orders.edit')
      and public.current_user_has_permission('inventory_orders.receive')
      and public.current_user_has_permission('inventory_orders.submit')
      and public.current_user_can_access_outlet(v_outlet) then v_actor := v_candidate; exit; end if;
  end loop;
  if v_actor is null then raise exception 'A Staging Master Inventory editor with PO permissions is required'; end if;

  insert into inventory_authority.item_uom_revisions(item_id,stock_unit,reason)
    values(v_legacy,'pcs','QA original basis') returning id into v_config;
  insert into inventory_authority.item_uom_revisions(id,item_id,stock_unit,purchase_unit,stock_units_per_purchase_unit,effective_date,reason,recorded_by,previous_revision_id)
    values(v_rev,v_legacy,'pcs',v_alt,12,current_date-1,'QA historical pack',v_actor,v_config);
  insert into public.inventory_purchase_orders(outlet_id,supplier_id,source_type,status,po_no)
    values(v_outlet,v_supplier,'manual','draft','PO-LEGACY-'||gen_random_uuid()) returning id into v_order;
  insert into public.inventory_purchase_order_items(purchase_order_id,item_id,requested_qty,received_qty,unit,stock_unit,stock_units_per_purchase_unit,uom_revision_id)
    values(v_order,v_legacy,3,0,v_alt,'pcs',12,v_rev);
  perform public.inventory_master_revise_cost(v_cost,2.5,'pcs',current_date-1,'QA confirmed cost',gen_random_uuid(),null);

  insert into public.employees(id,full_name,workplace)
    values(v_employee,'QA Single UOM Crew',(select code from public.outlets where id=v_outlet));
  insert into public.crew_access(employee_id,mobile_number,passcode_hash,primary_outlet_id,can_manage_purchase_orders,can_receive_purchase_orders)
    values(v_employee,'60'||translate(left(v_employee::text,8),'abcdef','012345'),'rollback-only',v_outlet,true,true);
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
    values(v_employee,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '5 minutes');

  perform set_config('single_uom.item',v_item::text,true);
  perform set_config('single_uom.legacy',v_legacy::text,true);
  perform set_config('single_uom.cost',v_cost::text,true);
  perform set_config('single_uom.outlet',v_outlet::text,true);
  perform set_config('single_uom.supplier',v_supplier::text,true);
  perform set_config('single_uom.alternate',v_alt,true);
  perform set_config('single_uom.revision',v_rev::text,true);
  perform set_config('single_uom.order',v_order::text,true);
  perform set_config('single_uom.token',v_token,true);
end;
$$;

set local role authenticated;
do $$
declare
  v_item uuid := current_setting('single_uom.item')::uuid;
  v_legacy uuid := current_setting('single_uom.legacy')::uuid;
  v_cost uuid := current_setting('single_uom.cost')::uuid;
  v_outlet uuid := current_setting('single_uom.outlet')::uuid;
  v_supplier uuid := current_setting('single_uom.supplier')::uuid;
  v_rev uuid := current_setting('single_uom.revision')::uuid;
  v_order uuid := current_setting('single_uom.order')::uuid;
  v_alt text := current_setting('single_uom.alternate');
  v_change uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_history jsonb;
  v_result jsonb;
  v_line uuid;
  v_payload jsonb := jsonb_build_object('outlet_id',v_outlet,'supplier_id',v_supplier,'source_type','manual','po_no','PO-QA-'||gen_random_uuid());
  v_line_payload jsonb := jsonb_build_object('item_id',v_legacy,'unit',v_alt,'uom_revision_id',v_rev,'requested_qty',3);
begin
  begin
    update public.inventory_items set unit=v_alt where id=v_item;
    raise exception 'Direct UOM change bypassed the edit command';
  exception when check_violation then null; end;
  if (public.inventory_master_change_stock_uom(v_item,'pcs','',gen_random_uuid(),null,'pcs')->'changes') <> '[]'::jsonb then
    raise exception 'A no-op created history';
  end if;
  begin
    perform public.inventory_master_change_stock_uom(v_item,v_alt,' ',gen_random_uuid(),null,'pcs');
    raise exception 'A change was accepted without a reason';
  exception when invalid_parameter_value then null; end;
  v_history := public.inventory_master_change_stock_uom(v_item,v_alt,'QA unused item correction',v_change,null,'pcs');
  if v_history->>'unit' is distinct from v_alt or v_history#>>'{changes,0,old_unit}' is distinct from 'pcs'
    or v_history#>>'{changes,0,new_unit}' is distinct from v_alt
    or v_history#>>'{changes,0,reason}' is distinct from 'QA unused item correction'
    or v_history#>>'{changes,0,recorded_at}' is null
    or v_history is distinct from public.inventory_master_change_stock_uom(v_item,v_alt,'QA unused item correction',v_change,null,'pcs') then
    raise exception 'UOM history or retry did not retain the audited change';
  end if;
  begin
    perform public.inventory_master_change_stock_uom(v_item,'pcs','QA stale change',gen_random_uuid(),null,'pcs');
    raise exception 'Stale UOM change was accepted';
  exception when serialization_failure then null; end;
  begin
    -- Match the Par Level upsert entry used by Admin.
    insert into public.inventory_item_outlets(inventory_item_id,outlet_id,par_level,par_unit)
      values (v_item,v_outlet,5,'pcs') on conflict (inventory_item_id,outlet_id) do update
      set par_level=excluded.par_level,par_unit=excluded.par_unit;
    raise exception 'A stale Par quantity was accepted in the retired unit';
  exception when check_violation then null; end;
  insert into public.inventory_item_outlets(inventory_item_id,outlet_id,par_level,par_unit)
    values (v_item,v_outlet,5,v_alt) on conflict (inventory_item_id,outlet_id) do update
    set par_level=excluded.par_level,par_unit=excluded.par_unit;
  begin
    perform public.inventory_master_change_stock_uom(v_item,'pcs','QA Par would change',gen_random_uuid(),v_change,v_alt);
    raise exception 'UOM change with saved Par was accepted';
  exception when check_violation then
    if sqlerrm not like '%saved Par%' then raise; end if;
  end;
  begin
    perform public.inventory_master_change_stock_uom(v_cost,v_alt,'QA cost must stay pinned',gen_random_uuid(),null,'pcs');
    raise exception 'A costed item changed units';
  exception when check_violation then null; end;
  if public.inventory_purchase_uom_choices(v_outlet) <> '{}'::jsonb or has_function_privilege(
    current_user,'public.inventory_master_revise_uom(uuid,text,numeric,date,text,uuid,uuid,text)','EXECUTE') then
    raise exception 'A legacy conversion configuration is still exposed';
  end if;
  begin
    perform public.inventory_save_purchase_order(gen_random_uuid(),v_payload,jsonb_build_array(v_line_payload));
    raise exception 'A new order pinned a retired purchase unit';
  exception when raise_exception then if sqlerrm not like 'New order lines must use the item UOM.%' then raise; end if; end;

  v_result := public.inventory_save_purchase_order(gen_random_uuid(),v_payload,jsonb_build_array(
    jsonb_build_object('item_id',v_legacy,'unit','pcs','requested_qty',3)));
  if (v_result#>>'{items,0,stock_units_per_purchase_unit}')::numeric is distinct from 1 then raise exception 'A new order did not use item UOM'; end if;
  select id into v_line from public.inventory_purchase_order_items where purchase_order_id=v_order;
  v_result := public.inventory_save_purchase_order(gen_random_uuid(),v_payload||jsonb_build_object('id',v_order),
    jsonb_build_array(v_line_payload||jsonb_build_object('line_id',v_line)));
  if (v_result#>>'{items,0,stock_units_per_purchase_unit}')::numeric is distinct from 12 then raise exception 'Legacy draft pin changed'; end if;
  v_line := (v_result#>>'{items,0,id}')::uuid;
  perform public.inventory_transition_purchase_order(v_order,gen_random_uuid(),'submit',null);
  perform public.inventory_transition_purchase_order(v_order,gen_random_uuid(),'confirm',null);
  v_line_payload := jsonb_build_array(jsonb_build_object('purchase_order_item_id',v_line,'item_id',v_legacy,'received_qty',1,'unit',v_alt));
  v_result := public.inventory_receive_purchase_order(v_order,v_request,null,v_line_payload);
  if v_result->>'status' is distinct from 'partial_received' or v_result is distinct from
    public.inventory_receive_purchase_order(v_order,v_request,null,v_line_payload) then raise exception 'Legacy Admin partial receipt or replay failed'; end if;
  if (select count(*) from public.inventory_movements where reference_id=v_order and unit='pcs' and quantity=12) <> 1 then
    raise exception 'Legacy receipt applied the wrong conversion or duplicated evidence';
  end if;
  perform set_config('single_uom.line',v_line::text,true);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.inventory_master_stock_uom_history(v_item);
    raise exception 'A user without permissions could see UOM history';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$
declare
  v_token text := current_setting('single_uom.token');
  v_outlet uuid := current_setting('single_uom.outlet')::uuid;
  v_order uuid := current_setting('single_uom.order')::uuid;
  v_result jsonb;
begin
  if public.crew_inventory_purchase_orders(v_token,v_outlet,null)->'purchase_units' <> '{}'::jsonb then
    raise exception 'Crew can still see historical conversion configuration as a choice';
  end if;
  v_result := public.crew_inventory_receive_purchase_order(v_token,v_outlet,v_order,gen_random_uuid(),null,
    jsonb_build_array(jsonb_build_object('purchase_order_item_id',current_setting('single_uom.line'),'item_id',
      current_setting('single_uom.legacy'),'received_qty',2,'unit',current_setting('single_uom.alternate'))));
  if v_result->>'status' is distinct from 'fully_received' then raise exception 'Legacy Crew receipt did not complete'; end if;
end;
$$;

reset role;
do $$
begin
  if not exists(select 1 from inventory_authority.item_stock_uom_changes where item_id=current_setting('single_uom.item')::uuid and actor_id is not null)
    or not exists(select 1 from inventory_authority.item_uom_revisions where id=current_setting('single_uom.revision')::uuid and stock_units_per_purchase_unit=12)
    or (select count(*) from public.inventory_movements where reference_id=current_setting('single_uom.order')::uuid and unit='pcs' and quantity=24) <> 1 then
    raise exception 'Actor or historical conversion evidence not preserved';
  end if;
end;
$$;
select 'PASS: single item UOM, authorized audit history, stale/unsafe write guards, retired setup and legacy Admin/Crew receiving' as result;
rollback;
