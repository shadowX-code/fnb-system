-- Phase 2: atomic stock-check and purchase-order structure persistence.
alter table public.inventory_lifecycle_requests drop constraint if exists inventory_lifecycle_requests_operation_check;
alter table public.inventory_lifecycle_requests add constraint inventory_lifecycle_requests_operation_check
  check (operation in ('purchase_receipt', 'waste', 'transfer', 'stock_check', 'purchase_order'));

create or replace function public.inventory_save_stock_check(p_request_id uuid, p_check jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_check public.inventory_stock_checks%rowtype; v_existing public.inventory_stock_checks%rowtype;
  v_row jsonb; v_result jsonb; v_now timestamptz := now(); v_status text := coalesce(p_check->>'status','draft');
  v_outlet_id uuid := nullif(p_check->>'outlet_id','')::uuid; v_group_id uuid := nullif(p_check->>'group_id','')::uuid; v_employee_id uuid;
  v_existing_id uuid := nullif(p_check->>'id','')::uuid; v_is_audit boolean := coalesce(p_check->>'stock_check_type','scheduled') = 'audit';
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  select id into v_employee_id from public.employees where auth_user_id=v_actor order by id limit 1;
  if v_status not in ('draft','submitted') then raise exception 'Stock check status must be draft or submitted.'; end if;
  if v_status='submitted' and not public.current_user_has_permission('inventory_stock_check.create') then raise exception using errcode='42501', message='Missing permission to submit stock checks.'; end if;
  if v_status='draft' and not (public.current_user_has_permission('inventory_stock_check.create') or public.current_user_has_permission('inventory_stock_check.edit')) then raise exception using errcode='42501', message='Missing permission to save stock check drafts.'; end if;
  if p_request_id is null or v_outlet_id is null or (not v_is_audit and v_group_id is null) then raise exception 'Request, outlet and stock check group are required.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501', message='You cannot save stock checks for this outlet.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Stock check items are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='stock_check'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  if v_existing_id is not null then
    select * into v_existing from public.inventory_stock_checks where id=v_existing_id for update;
    if not found then raise exception 'Stock check was not found.'; end if;
    if not public.current_user_can_access_outlet(v_existing.outlet_id) then raise exception using errcode='42501', message='You cannot edit this stock check.'; end if;
    update public.inventory_stock_checks set outlet_id=v_outlet_id, group_id=case when v_is_audit then null else v_group_id end, stock_check_type=case when v_is_audit then 'audit' else 'scheduled' end,
      check_name=nullif(p_check->>'check_name',''), shift=nullif(p_check->>'shift',''), check_date=(p_check->>'check_date')::date,
      audit_type=case when v_is_audit then nullif(p_check->>'audit_type','') else null end, audit_name=case when v_is_audit then nullif(p_check->>'audit_name','') else null end,
      audit_category_ids=case when v_is_audit then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      notes=nullif(p_check->>'notes',''), status=v_status, submitted_at=case when v_status='submitted' then v_now else null end,
      submitted_by=case when v_status='submitted' then v_employee_id else null end, updated_at=v_now where id=v_existing_id returning * into v_check;
  else
    insert into public.inventory_stock_checks(outlet_id,group_id,stock_check_type,check_name,shift,check_date,audit_type,audit_name,audit_category_ids,notes,status,submitted_at,submitted_by,created_by,created_at,updated_at)
    values(v_outlet_id,case when v_is_audit then null else v_group_id end,case when v_is_audit then 'audit' else 'scheduled' end,nullif(p_check->>'check_name',''),nullif(p_check->>'shift',''),(p_check->>'check_date')::date,
      case when v_is_audit then nullif(p_check->>'audit_type','') else null end,case when v_is_audit then nullif(p_check->>'audit_name','') else null end,
      case when v_is_audit then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      nullif(p_check->>'notes',''),v_status,case when v_status='submitted' then v_now else null end,case when v_status='submitted' then v_employee_id else null end,v_actor,v_now,v_now) returning * into v_check;
  end if;
  delete from public.inventory_stock_check_items where stock_check_id=v_check.id;
  for v_row in select value from jsonb_array_elements(p_items) loop
    insert into public.inventory_stock_check_items(stock_check_id,item_id,category_id,par_level_quantity,actual_count_quantity,variance,unit,status,notes,skipped,skip_reason,created_at,updated_at)
    values(v_check.id,nullif(v_row->>'item_id','')::uuid,nullif(v_row->>'category_id','')::uuid,nullif(v_row->>'par_level_quantity','')::numeric,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'actual_missing')::boolean,false) then null else nullif(v_row->>'actual_count_quantity','')::numeric end,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'na')::boolean,false) then null else coalesce(nullif(v_row->>'variance','')::numeric,0) end,
      nullif(v_row->>'unit',''),coalesce(nullif(v_row->>'status',''),'normal'),nullif(v_row->>'notes',''),coalesce((v_row->>'skipped')::boolean,false),case when coalesce((v_row->>'skipped')::boolean,false) then nullif(v_row->>'skip_reason','') else null end,v_now,v_now);
  end loop;
  if not v_is_audit and v_status='submitted' then update public.inventory_stock_check_groups set last_checked_at=v_check.submitted_at, updated_at=v_now where id=v_group_id; end if;
  v_result := jsonb_build_object('check',to_jsonb(v_check),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.inventory_stock_check_items i where i.stock_check_id=v_check.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'stock_check',v_actor,v_outlet_id,v_result);
  return v_result;
end; $$;

create or replace function public.inventory_save_purchase_order(p_request_id uuid, p_order jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=auth.uid(); v_order public.inventory_purchase_orders%rowtype; v_existing public.inventory_purchase_orders%rowtype; v_item jsonb; v_result jsonb; v_now timestamptz:=now();
  v_id uuid:=nullif(p_order->>'id','')::uuid; v_outlet uuid:=nullif(p_order->>'outlet_id','')::uuid; v_supplier uuid:=nullif(p_order->>'supplier_id','')::uuid;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if v_id is null and not public.current_user_has_permission('inventory_orders.create') then raise exception using errcode='42501', message='Missing permission to create purchase orders.'; end if;
  if v_id is not null and not public.current_user_has_permission('inventory_orders.edit') then raise exception using errcode='42501', message='Missing permission to edit purchase orders.'; end if;
  if p_request_id is null or v_outlet is null or v_supplier is null then raise exception 'Request, outlet and supplier are required.'; end if;
  if not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode='42501', message='You cannot save purchase orders for this outlet.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Purchase order requires at least one item.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='purchase_order'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  if v_id is not null then
    select * into v_existing from public.inventory_purchase_orders where id=v_id for update;
    if not found or v_existing.status <> 'draft' then raise exception 'Only Draft purchase orders can be edited.'; end if;
    update public.inventory_purchase_orders set supplier_id=v_supplier, updated_at=v_now where id=v_id returning * into v_order;
    delete from public.inventory_purchase_order_items where purchase_order_id=v_id;
  else
    insert into public.inventory_purchase_orders(po_no,outlet_id,supplier_id,status,source_type,source_stock_check_id,created_by,created_at,updated_at)
    values(nullif(p_order->>'po_no',''),v_outlet,v_supplier,coalesce(nullif(p_order->>'status',''),'draft'),nullif(p_order->>'source_type',''),nullif(p_order->>'source_stock_check_id','')::uuid,v_actor,v_now,v_now) returning * into v_order;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'item_id','') is null or coalesce(nullif(v_item->>'requested_qty','')::numeric,0)<=0 then raise exception 'Purchase order items require an item and positive quantity.'; end if;
    insert into public.inventory_purchase_order_items(purchase_order_id,item_id,requested_qty,received_qty,unit,remark,source_stock_check_item_id,created_at,updated_at)
    values(v_order.id,(v_item->>'item_id')::uuid,(v_item->>'requested_qty')::numeric,0,nullif(v_item->>'unit',''),nullif(v_item->>'remark',''),nullif(v_item->>'source_stock_check_item_id','')::uuid,v_now,v_now);
  end loop;
  v_result:=jsonb_build_object('order',to_jsonb(v_order),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.inventory_purchase_order_items i where i.purchase_order_id=v_order.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'purchase_order',v_actor,v_outlet,v_result);
  return v_result;
end; $$;

revoke all on function public.inventory_save_stock_check(uuid,jsonb,jsonb), public.inventory_save_purchase_order(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.inventory_save_stock_check(uuid,jsonb,jsonb), public.inventory_save_purchase_order(uuid,jsonb,jsonb) to authenticated;
