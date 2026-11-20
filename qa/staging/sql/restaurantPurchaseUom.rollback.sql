-- Historical verification for migration 20261120154225, before item-only UOM cutover.
-- Use restaurantMasterStockUom.rollback.sql for the current Staging workflow.
begin;

do $$
declare
  v_actor uuid;
  v_candidate uuid;
  v_outlet uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_token text := gen_random_uuid()::text;
  v_link uuid;
  v_unit text;
  v_legacy uuid;
begin
  insert into public.outlets(id, name, code) values
    (v_outlet, 'QA Purchase UOM', 'QAU' || left(v_outlet::text, 6)),
    (v_other, 'QA Purchase UOM Other', 'QAU' || left(v_other::text, 6));
  select code into v_unit from public.inventory_uoms where is_active and code not ilike 'pcs' order by sort_order limit 1;
  if v_unit is null then raise exception 'An alternate Staging UOM is required'; end if;
  insert into public.inventory_items(id, item_name, unit) values (v_item, 'QA Purchase UOM item', 'pcs');
  insert into public.suppliers(id, name, status) values (v_supplier, 'QA Purchase UOM Supplier', 'active');
  insert into public.supplier_outlets(supplier_id,outlet_id) values(v_supplier,v_outlet);
  insert into public.inventory_item_outlets(inventory_item_id, outlet_id, par_level)
    values(v_item,v_outlet,24) returning id into v_link;
  insert into public.inventory_item_outlet_suppliers(inventory_item_outlet_id,supplier_id) values(v_link,v_supplier);
  insert into public.inventory_purchase_orders(outlet_id,supplier_id,source_type,status,po_no)
    values(v_outlet,v_supplier,'manual','supplier_confirmed','PO-UOM-LEGACY-'||gen_random_uuid()) returning id into v_legacy;
  insert into public.inventory_purchase_order_items(purchase_order_id,item_id,requested_qty,received_qty,unit)
    values(v_legacy,v_item,3,0,'legacy-pack');

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
  if v_actor is null then raise exception 'A Staging Admin with Master and PO permissions is required'; end if;
  insert into public.employees(id, full_name, workplace)
    values (v_employee, 'QA rollback Crew PO', (select code from public.outlets where id = v_outlet));
  insert into public.crew_access(employee_id,mobile_number,passcode_hash,primary_outlet_id,can_manage_purchase_orders,can_receive_purchase_orders)
    values (v_employee,'60'||translate(left(v_employee::text,8),'abcdef','012345'),'rollback-only',v_outlet,true,true);
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
    values (v_employee,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '5 minutes');

  perform set_config('uom_qa.actor',v_actor::text,true);
  perform set_config('uom_qa.outlet',v_outlet::text,true);
  perform set_config('uom_qa.other',v_other::text,true);
  perform set_config('uom_qa.supplier',v_supplier::text,true);
  perform set_config('uom_qa.item',v_item::text,true);
  perform set_config('uom_qa.unit',v_unit,true);
  perform set_config('uom_qa.legacy',v_legacy::text,true);
  perform set_config('uom_qa.token',v_token,true);
end;
$$;

set local role authenticated;
do $$
declare
  v_item uuid := current_setting('uom_qa.item')::uuid;
  v_outlet uuid := current_setting('uom_qa.outlet')::uuid;
  v_supplier uuid := current_setting('uom_qa.supplier')::uuid;
  v_unit text := current_setting('uom_qa.unit');
  v_day date := timezone('Asia/Kuala_Lumpur',now())::date;
  v_first uuid := gen_random_uuid();
  v_next uuid := gen_random_uuid();
  v_future uuid := gen_random_uuid();
  v_save_request uuid := gen_random_uuid();
  v_post_request uuid := gen_random_uuid();
  v_po uuid;
  v_line uuid;
  v_legacy uuid := current_setting('uom_qa.legacy')::uuid;
  v_payload jsonb := jsonb_build_object('outlet_id',v_outlet,'supplier_id',v_supplier,'source_type','manual','po_no','PO-UOM-QA-'||gen_random_uuid());
  v_line_input jsonb := jsonb_build_object('item_id',v_item,'unit',v_unit,'uom_revision_id',v_first,'requested_qty',2.5);
  v_history jsonb;
  v_result jsonb;
  v_receipt jsonb;
begin
  begin
    update public.inventory_items set unit='kg' where id=v_item;
    raise exception 'An uncosted item with operational dependencies accepted a Stock UOM change';
  exception when check_violation then null; end;
  if has_schema_privilege(current_user,'inventory_authority','USAGE')
    or has_table_privilege(current_user,'public.inventory_purchase_order_items','INSERT') then
    raise exception 'Client can bypass a UOM or PO write authority';
  end if;
  begin
    perform public.inventory_master_revise_uom(v_item,v_unit,0,v_day,'Bad factor',gen_random_uuid(),null,'pcs');
    raise exception 'Zero factor accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.inventory_master_revise_uom(v_item,v_unit,12,v_day-1,'Backdate',gen_random_uuid(),null,'pcs');
    raise exception 'Backdated conversion accepted';
  exception when raise_exception then
    if sqlerrm not like 'Choose today or a future date%' then raise; end if;
  end;
  v_history := public.inventory_master_revise_uom(v_item,v_unit,12,v_day,'QA verified pack size',v_first,null,'pcs');
  if v_history#>>'{revisions,1,effective_date}' is not null or jsonb_array_length(v_history->'revisions')<>2
    or v_history#>>'{current,id}' is distinct from v_first::text
    or (public.inventory_purchase_uom_choices(v_outlet)->v_item::text->>'stock_units_per_purchase_unit')::numeric is distinct from 12 then
    raise exception 'UOM baseline, configuration and scoped choice did not agree';
  end if;
  if v_history is distinct from public.inventory_master_revise_uom(v_item,v_unit,12,v_day,'QA verified pack size',v_first,null,'pcs') then
    raise exception 'Retry appended UOM history';
  end if;
  begin
    update public.inventory_uoms set code='qa-changed-unit' where code=v_unit;
    raise exception 'Used unit code was renamed';
  exception when check_violation then null; end;
  v_result := public.inventory_save_purchase_order(v_save_request,v_payload,jsonb_build_array(v_line_input));
  if (v_result#>>'{items,0,stock_units_per_purchase_unit}')::numeric is distinct from 12
    or v_result#>>'{items,0,unit}' is distinct from v_unit or v_result#>>'{items,0,stock_unit}' is distinct from 'pcs' then
    raise exception 'Converted order did not pin both units and factor';
  end if;
  if v_result is distinct from public.inventory_save_purchase_order(v_save_request,v_payload,jsonb_build_array(v_line_input)) then
    raise exception 'PO save replay changed evidence';
  end if;
  v_po := (v_result#>>'{order,id}')::uuid;
  v_line := (v_result#>>'{items,0,id}')::uuid;
  perform public.inventory_master_revise_uom(v_item,v_unit,24,v_day,'QA verified new pack size',v_next,v_first,'pcs');
  v_result := public.inventory_save_purchase_order(gen_random_uuid(),v_payload||jsonb_build_object('id',v_po),
    jsonb_build_array(v_line_input||jsonb_build_object('line_id',v_line)));
  if (v_result#>>'{items,0,stock_units_per_purchase_unit}')::numeric is distinct from 12 then
    raise exception 'Draft edit repinned a saved conversion';
  end if;
  v_line := (v_result#>>'{items,0,id}')::uuid;
  perform public.inventory_master_revise_uom(v_item,v_unit,48,v_day+1,'QA future pack size',v_future,v_next,'pcs');
  if public.inventory_purchase_uom_choices(v_outlet)->v_item::text->>'uom_revision_id' is distinct from v_next::text then
    raise exception 'Future pack size activated early';
  end if;
  begin
    perform public.inventory_save_purchase_order(gen_random_uuid(),v_payload,jsonb_build_array(v_line_input));
    raise exception 'Stale factor accepted on a new line';
  exception when raise_exception then if sqlerrm not like 'Purchase UOM changed.%' then raise; end if; end;
  begin
    perform public.inventory_save_purchase_order(gen_random_uuid(),v_payload,
      jsonb_build_array(v_line_input||jsonb_build_object('uom_revision_id',v_next,'requested_qty',0.0001)));
    raise exception 'Unrepresentable purchase quantity accepted';
  exception when invalid_parameter_value then null; end;
  perform public.inventory_transition_purchase_order(v_po,gen_random_uuid(),'submit',null);
  perform public.inventory_transition_purchase_order(v_po,gen_random_uuid(),'confirm',null);
  v_receipt := jsonb_build_array(jsonb_build_object('purchase_order_item_id',v_line,'item_id',v_item,'received_qty',0.5,'unit',v_unit));
  begin
    perform public.inventory_receive_purchase_order(v_po,gen_random_uuid(),null,
      jsonb_build_array((v_receipt->0)||'{"unit":"pcs"}'));
    raise exception 'Wrong receiving unit accepted';
  exception when raise_exception then if sqlerrm not like 'Receive quantities in the unit pinned%' then raise; end if; end;
  v_result := public.inventory_receive_purchase_order(v_po,v_post_request,null,v_receipt);
  if v_result->>'status' is distinct from 'partial_received'
    or v_result is distinct from public.inventory_receive_purchase_order(v_po,v_post_request,null,v_receipt) then
    raise exception 'Partial receiving or retry failed';
  end if;
  if not exists (select 1 from public.inventory_purchase_receipt_items where purchase_order_item_id=v_line
    and received_qty=.5 and unit=v_unit and stock_quantity=6 and stock_unit='pcs')
    or (select count(*) from public.inventory_movements where reference_id=v_po and unit='pcs' and quantity=6)<>1
    or (select received_qty from public.inventory_purchase_order_items where id=v_line) is distinct from .5 then
    raise exception 'Purchase-to-stock quantity or receipt evidence differs';
  end if;

  select id into v_line from public.inventory_purchase_order_items where purchase_order_id=v_legacy;
  perform public.inventory_receive_purchase_order(v_legacy,gen_random_uuid(),null,
    jsonb_build_array(jsonb_build_object('purchase_order_item_id',v_line,'item_id',v_item,'received_qty',1,'unit','legacy-pack')));
  if not exists(select 1 from public.inventory_movements where reference_id=v_legacy and unit='legacy-pack' and quantity=1)
    or exists(select 1 from public.inventory_purchase_receipt_items where purchase_order_item_id=v_line and stock_unit is not null) then
    raise exception 'Ambiguous legacy receipt was retrospectively converted';
  end if;
  if (select cost_revision_id from public.inventory_items where id=v_item) is not null then
    raise exception 'UOM management created a cost revision';
  end if;
  perform set_config('uom_qa.po',v_po::text,true);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.inventory_master_uom_history(v_item);
    raise exception 'Unauthorized actor could read Master Unit History';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$
declare
  v_token text := current_setting('uom_qa.token');
  v_outlet uuid := current_setting('uom_qa.outlet')::uuid;
  v_po uuid := current_setting('uom_qa.po')::uuid;
  v_item uuid := current_setting('uom_qa.item')::uuid;
  v_unit text := current_setting('uom_qa.unit');
  v_detail jsonb;
  v_result jsonb;
  v_line uuid;
begin
  v_detail := public.crew_inventory_purchase_orders(v_token,v_outlet,v_po)->'detail';
  v_line := (v_detail#>>'{lines,0,id}')::uuid;
  if (v_detail#>>'{lines,0,stock_units_per_purchase_unit}')::numeric is distinct from 12
    or (v_detail#>>'{lines,0,remaining_qty}')::numeric is distinct from 2
    or (v_detail#>>'{receipts,0,lines,0,stock_quantity}')::numeric is distinct from 6
    or (public.crew_inventory_purchase_orders(v_token,v_outlet,null)->'purchase_units'->v_item::text->>'stock_units_per_purchase_unit')::numeric is distinct from 24 then
    raise exception 'Crew read mixed an order pin with the current choice';
  end if;
  v_result := public.crew_inventory_receive_purchase_order(v_token,v_outlet,v_po,gen_random_uuid(),null,
    jsonb_build_array(jsonb_build_object('purchase_order_item_id',v_line,'item_id',v_item,'received_qty',2,'unit',v_unit)));
  if v_result->>'status' is distinct from 'fully_received' then raise exception 'Crew remaining order did not fully receive'; end if;
  begin
    perform public.crew_inventory_purchase_orders(v_token,current_setting('uom_qa.other')::uuid,null);
    raise exception 'Crew could read results outside its outlet';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from public.inventory_movements where reference_id=current_setting('uom_qa.po')::uuid and unit='pcs' and quantity=24)<>1 then
    raise exception 'Crew did not post the converted stock quantity';
  end if;
end;
$$;
select 'UOM history, authorization, PO pinning, Admin partial receive/replay, Crew completion, and legacy compatibility passed' as result;
rollback;
