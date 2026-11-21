-- Verified FeedX Staging only. All fixture writes roll back.
begin;
do $$
declare
  v_actor uuid;
  v_candidate uuid;
  v_outlet uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_recipe uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_check uuid := gen_random_uuid();
  v_order uuid;
  v_link uuid;
  v_cost uuid := gen_random_uuid();
begin
  insert into public.outlets(id,name,code) values(v_outlet,'QA Versioned UOM','QAV'||left(v_outlet::text,6));
  insert into public.suppliers(id,name,status) values(v_supplier,'QA Versioned UOM Supplier','active');
  insert into public.supplier_outlets(supplier_id,outlet_id) values(v_supplier,v_outlet);
  insert into public.inventory_items(id,item_name,unit) values(v_item,'QA Versioned UOM Item','kg');
  insert into public.inventory_item_outlets(inventory_item_id,outlet_id,par_level,par_unit)
    values(v_item,v_outlet,2.5,'kg') returning id into v_link;
  insert into public.inventory_item_outlet_suppliers(inventory_item_outlet_id,supplier_id) values(v_link,v_supplier);

  for v_candidate in
    select e.auth_user_id from public.employees e join public.roles role on role.id=e.role_id
    where lower(role.name) in ('owner','admin') and e.auth_user_id is not null
    union select p.id from public.user_profiles p join public.roles role on role.id=p.role_id where lower(role.name) in ('owner','admin')
  loop
    perform set_config('request.jwt.claim.sub',v_candidate::text,true);
    if public.current_user_has_permission('inventory_master.edit')
      and public.current_user_has_permission('inventory_orders.create')
      and public.current_user_has_permission('inventory_orders.cancel')
      and public.current_user_has_permission('inventory_stock_check.create')
      and public.current_user_has_permission('inventory_stock_check.submit')
      and public.current_user_can_access_outlet(v_outlet) then v_actor := v_candidate; exit; end if;
  end loop;
  if v_actor is null then raise exception 'A Staging Inventory administrator is required'; end if;

  perform public.inventory_master_revise_cost(v_item,2.5,'kg',(now() at time zone 'Asia/Kuala_Lumpur')::date-1,
    'QA configured old unit cost',v_cost,null);
  insert into public.inventory_recipes(id,outlet_id,recipe_name,status,recipe_code) values
    (v_recipe,v_outlet,'QA Active Recipe','active','QA-'||v_recipe),
    (v_inactive,v_outlet,'QA Historical Recipe','inactive','QA-'||v_inactive);
  insert into public.inventory_recipe_items(recipe_id,inventory_item_id,quantity_used,unit)
    values(v_recipe,v_item,.35,'kg'),(v_inactive,v_item,.2,'kg');
  insert into public.inventory_stock_checks(id,outlet_id,stock_check_type,audit_type,status)
    values(v_check,v_outlet,'audit','Spot Check','draft');
  insert into public.inventory_stock_check_items(stock_check_id,item_id,par_level_quantity,actual_count_quantity,unit)
    values(v_check,v_item,2.5,4,'kg');
  insert into public.inventory_purchase_orders(outlet_id,supplier_id,source_type,status,po_no)
    values(v_outlet,v_supplier,'manual','draft','PO-UOM-VERSION-'||gen_random_uuid()) returning id into v_order;
  insert into public.inventory_purchase_order_items(purchase_order_id,item_id,requested_qty,received_qty,unit,stock_unit,stock_units_per_purchase_unit)
    values(v_order,v_item,3,0,'kg','kg',1);
  insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type)
    values(v_outlet,v_item,'Adjustment',-4,'kg','manual');

  perform set_config('basis_qa.item',v_item::text,true);
  perform set_config('basis_qa.outlet',v_outlet::text,true);
  perform set_config('basis_qa.supplier',v_supplier::text,true);
  perform set_config('basis_qa.recipe',v_recipe::text,true);
  perform set_config('basis_qa.inactive',v_inactive::text,true);
  perform set_config('basis_qa.check',v_check::text,true);
  perform set_config('basis_qa.order',v_order::text,true);
  perform set_config('basis_qa.cost',v_cost::text,true);
end;
$$;

set local role authenticated;
do $$
declare
  v_item uuid := current_setting('basis_qa.item')::uuid;
  v_cost uuid := current_setting('basis_qa.cost')::uuid;
begin
  begin
    perform public.inventory_master_change_stock_uom(v_item,'g','QA confirmed metric conversion',gen_random_uuid(),null,'kg',1,1000,v_cost,true);
    raise exception 'An open count did not block conversion';
  exception when check_violation then if sqlerrm not like 'Submit or discard the open Stock Check%' then raise; end if; end;
end;
$$;

reset role;
update public.inventory_stock_checks set status='submitted',submitted_at=now()-interval '1 hour'
where id=current_setting('basis_qa.check')::uuid;

set local role authenticated;
do $$
declare
  v_item uuid := current_setting('basis_qa.item')::uuid;
  v_outlet uuid := current_setting('basis_qa.outlet')::uuid;
  v_cost uuid := current_setting('basis_qa.cost')::uuid;
  v_order uuid := current_setting('basis_qa.order')::uuid;
  v_old_check uuid := current_setting('basis_qa.check')::uuid;
  v_recipe uuid := current_setting('basis_qa.recipe')::uuid;
  v_inactive uuid := current_setting('basis_qa.inactive')::uuid;
  v_change uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_history jsonb;
  v_cost_history jsonb;
  v_converted_cost uuid;
  v_new_check uuid;
  v_new_order jsonb;
  v_stock jsonb;
  v_insights jsonb;
  v_prior_item jsonb;
  v_prior_po jsonb;
begin
  begin
    perform public.inventory_master_change_stock_uom(v_item,'g','QA confirmed metric conversion',gen_random_uuid(),null,'kg',1,1000,v_cost,true);
    raise exception 'Open purchasing did not block conversion';
  exception when check_violation then if sqlerrm not like 'Finish receiving%' then raise; end if; end;
  perform public.inventory_transition_purchase_order(v_order,gen_random_uuid(),'cancel','QA discard old-basis draft');
  select to_jsonb(line) into v_prior_item from public.inventory_stock_check_items line where stock_check_id=v_old_check;
  select to_jsonb(line) into v_prior_po from public.inventory_purchase_order_items line where purchase_order_id=v_order;

  begin
    perform public.inventory_master_change_stock_uom(v_item,'g','QA unverified ratio',gen_random_uuid(),null,'kg',1,1000,v_cost,false);
    raise exception 'An unverified conversion was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.inventory_master_change_stock_uom(v_item,'g','QA recurring decimal cost',gen_random_uuid(),null,'kg',1,3,v_cost,true);
    raise exception 'An inexact equivalent cost was accepted';
  exception when check_violation then if sqlerrm not like 'The equivalent cost%' then raise; end if; end;
  begin
    perform public.inventory_master_change_stock_uom(v_item,'g','QA fractional Par',gen_random_uuid(),null,'kg',2000,1,v_cost,true);
    raise exception 'An inexact Par quantity was accepted';
  exception when check_violation then if sqlerrm not like 'A saved Par quantity%' then raise; end if; end;

  v_history := public.inventory_master_change_stock_uom(v_item,'g','QA verified 1 kg = 1000 g',v_change,null,'kg',1,1000,v_cost,true);
  if v_history->>'unit' is distinct from 'g'
    or (v_history->>'current_cost')::numeric is distinct from .0025
    or v_history#>>'{changes,0,effective_date}' is distinct from v_today::text
    or v_history#>>'{changes,0,old_unit}' is distinct from 'kg'
    or v_history#>>'{changes,0,new_unit}' is distinct from 'g'
    or v_history is distinct from public.inventory_master_change_stock_uom(v_item,'g','QA verified 1 kg = 1000 g',v_change,null,'kg',1,1000,v_cost,true)
  then raise exception 'UOM activation, equivalent cost, date, or retry failed'; end if;
  v_converted_cost := (v_history->>'current_cost_revision_id')::uuid;
  v_cost_history := public.inventory_master_cost_history(v_item);
  if v_cost_history#>>'{revisions,0,is_uom_conversion}' is distinct from 'true'
    or v_cost_history#>>'{revisions,0,stock_uom_change_id}' is distinct from v_change::text
    or v_cost_history->>'previous_cost' is not null
    or v_cost_history#>>'{revisions,1,unit}' is distinct from 'kg' then
    raise exception 'Equivalent adjustment is not distinguished from a price change';
  end if;
  if (select par_level from public.inventory_item_outlets where inventory_item_id=v_item) is distinct from 2500
    or not exists(select 1 from public.inventory_recipe_items where recipe_id=v_recipe and quantity_used=350 and unit='g' and unit_cost_snapshot=.0025)
    or not exists(select 1 from public.inventory_recipe_items where recipe_id=v_inactive and quantity_used=.2 and unit='kg' and unit_cost_snapshot=2.5)
    or (select to_jsonb(line) from public.inventory_stock_check_items line where stock_check_id=v_old_check) is distinct from v_prior_item
    or (select to_jsonb(line) from public.inventory_purchase_order_items line where purchase_order_id=v_order) is distinct from v_prior_po
    or not exists(select 1 from public.inventory_movements where inventory_item_id=v_item and quantity=-4 and unit='kg') then
    raise exception 'Operational conversion or immutable evidence failed';
  end if;

  v_stock := public.inventory_dashboard_stock_evidence(array[v_outlet]);
  if (select r->>'state' from jsonb_array_elements(v_stock->'positions') r where r->>'item_id'=v_item::text) is distinct from 'unverified' then
    raise exception 'Dashboard compared an old-basis count to the new Par';
  end if;
  v_insights := public.inventory_dashboard_cost_insights(array[v_outlet]);
  if (v_insights->>'increases')::integer <> 0 or (v_insights->>'decreases')::integer <> 0 then
    raise exception 'Dashboard counted a UOM conversion as a price change';
  end if;

  begin
    perform public.inventory_master_revise_cost(v_item,.003,'g',v_today-1,'QA wrong effective date',gen_random_uuid(),v_converted_cost,null);
    raise exception 'Price update crossed the effective UOM boundary';
  exception when invalid_parameter_value then null; end;
  perform public.inventory_master_revise_cost(v_item,.003,'g',v_today,'QA genuine current-basis price change',
    gen_random_uuid(),v_converted_cost,null);

  v_new_order := public.inventory_save_purchase_order(gen_random_uuid(),
    jsonb_build_object('outlet_id',v_outlet,'supplier_id',current_setting('basis_qa.supplier')::uuid,
     'source_type','manual','po_no','PO-UOM-AFTER-'||gen_random_uuid()),
    jsonb_build_array(jsonb_build_object('item_id',v_item,'unit','g','requested_qty',1000)));
  if v_new_order#>>'{items,0,unit}' is distinct from 'g'
    or v_new_order#>>'{items,0,stock_uom_change_id}' is distinct from v_change::text then
    raise exception 'A new PO did not pin the effective UOM';
  end if;
  v_stock := public.inventory_save_stock_check(gen_random_uuid(),jsonb_build_object(
    'outlet_id',v_outlet,'stock_check_type','audit','audit_type','Spot Check','status','submitted'
  ),jsonb_build_array(jsonb_build_object('item_id',v_item,'unit','g','actual_count_quantity',2600,'par_level_quantity',2500)));
  v_new_check := (v_stock#>>'{check,id}')::uuid;
  if not exists(select 1 from public.inventory_stock_check_items where stock_check_id=v_new_check
    and unit='g' and unit_cost_snapshot=.003 and stock_uom_change_id=v_change) then
    raise exception 'New audit did not use current UOM and cost';
  end if;
  v_stock := public.inventory_dashboard_stock_evidence(array[v_outlet]);
  if (select r->>'state' from jsonb_array_elements(v_stock->'positions') r where r->>'item_id'=v_item::text) is distinct from 'sufficient' then
    raise exception 'Dashboard did not use fresh evidence in the current UOM';
  end if;
  perform set_config('basis_qa.change',v_change::text,true);
end;
$$;

reset role;
do $$
declare v_change uuid := current_setting('basis_qa.change')::uuid;
begin
  if not exists(select 1 from inventory_authority.item_stock_uom_changes where id=v_change and actor_id is not null
    and (recipe_evidence#>>'{0,before,quantity_used}')::numeric=.35
    and (recipe_evidence#>>'{0,before,unit_cost_snapshot}')::numeric=2.5
    and (par_evidence#>>'{0,old_quantity}')::numeric=2.5) then
    raise exception 'Reconciled recipe and Par before-images were not preserved';
  end if;
end;
$$;
select 'PASS: versioned UOM, open-work blockers, exact conversion, historical evidence, snapshots, Cost History and Dashboard' as result;
rollback;
