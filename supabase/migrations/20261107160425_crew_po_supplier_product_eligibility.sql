-- Update the shared Admin, Crew and Restaurant agent draft-save core in place.
do $guard$
begin
  if md5(pg_get_functiondef('feedx_integrations.ra_save_purchase_order(uuid,uuid,jsonb,jsonb,uuid,uuid,uuid,text)'::regprocedure))
    <> 'f223f31b135e6dc6f9a4a128bd1dfe65' then
    raise exception 'Shared purchase order save authority changed; review supplier eligibility patch.';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_save_purchase_order(p_machine uuid, p_request_id uuid, p_order jsonb, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_existing public.inventory_purchase_orders%rowtype;
  v_check public.inventory_stock_checks%rowtype;
  v_item jsonb; v_result jsonb; v_now timestamptz:=now();
  v_id uuid:=nullif(p_order->>'id','')::uuid;
  v_outlet uuid:=nullif(p_order->>'outlet_id','')::uuid;
  v_supplier uuid:=nullif(p_order->>'supplier_id','')::uuid;
  v_source uuid:=nullif(p_order->>'source_stock_check_id','')::uuid;
  v_source_type text:=coalesce(nullif(p_order->>'source_type',''),'manual');
  v_fingerprint text:=md5(jsonb_build_object('order',p_order,'items',p_items)::text);
  v_source_item public.inventory_stock_check_items%rowtype;
  v_seen_source_items uuid[]:='{}';
begin
 if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null or p_actor_kind<>'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then raise exception using errcode='42501',message='Invalid Restaurant machine principal or outlet';end if;
  if p_request_id is null or v_outlet is null or v_outlet is distinct from p_scope_outlet or v_supplier is null then
    raise exception 'Request, outlet and supplier are required.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Purchase order requires at least one item.';
  end if;
  if coalesce(nullif(p_order->>'status',''),'draft') <> 'draft' then raise exception 'Only Draft purchase orders can be saved.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='purchase_order'
    and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  if v_id is not null then
    select * into v_existing from public.inventory_purchase_orders where id=v_id for update;
    if not found or v_existing.status <> 'draft' then raise exception 'Only Draft purchase orders can be edited.'; end if;
    if v_existing.outlet_id is distinct from v_outlet then raise exception 'Purchase order outlet cannot change.'; end if;
    if coalesce(v_existing.source_type,'manual') is distinct from v_source_type or v_existing.source_stock_check_id is distinct from v_source then
      raise exception 'Purchase order source cannot change.';
    end if;
  end if;
  if v_source_type='stock_check' then
    if v_source is null then raise exception 'Source stock check is required.'; end if;
    perform pg_advisory_xact_lock(hashtext('inventory_stock_check_po_'||v_source::text));
    select * into v_check from public.inventory_stock_checks where id=v_source;
    if not found or v_check.outlet_id is distinct from v_outlet or v_check.stock_check_type <> 'scheduled'
      or v_check.status <> 'submitted' then
      raise exception 'Only a completed scheduled stock check for this outlet can create purchase orders.';
    end if;
    if v_id is null and exists(select 1 from public.inventory_purchase_orders
      where source_type='stock_check' and source_stock_check_id=v_source and supplier_id=v_supplier and status<>'cancelled') then
      raise exception 'A purchase order already exists for this stock check and supplier.';
    end if;
  elsif v_source is not null then
    raise exception 'A source stock check requires stock_check source type.';
  end if;
  if not exists(select 1 from public.supplier_outlets where supplier_id=v_supplier and outlet_id=v_outlet) then
    raise exception 'Supplier is not assigned to this outlet.';
  end if;
  if (v_id is null or v_supplier is distinct from v_existing.supplier_id)
    and not exists(select 1 from public.suppliers where id=v_supplier and status='active') then
    raise exception 'Supplier is not active.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'item_id','') is null or coalesce(nullif(v_item->>'requested_qty','')::numeric,0)<=0 then
      raise exception 'Purchase order items require an item and positive quantity.';
    end if;
    if not exists(select 1 from public.inventory_item_outlets where outlet_id=v_outlet
      and inventory_item_id=(v_item->>'item_id')::uuid) then
      raise exception 'Purchase order item does not belong to this outlet.';
    end if;
    -- Keep existing manual draft lines editable if a catalog link was later removed.
    -- A new item, additional copy or supplier change must pass current eligibility.
    if v_source_type<>'stock_check' and not exists(
      select 1 from public.inventory_item_outlets io
      join public.inventory_items i on i.id=io.inventory_item_id and i.status='active'
      join public.inventory_item_outlet_suppliers link on link.inventory_item_outlet_id=io.id
      join public.suppliers s on s.id=link.supplier_id and s.status='active'
      where io.outlet_id=v_outlet and io.is_active and i.id=(v_item->>'item_id')::uuid
        and link.supplier_id=v_supplier
    ) and not (
      v_id is not null and v_supplier=v_existing.supplier_id
      and (select count(*) from public.inventory_purchase_order_items old_line
        where old_line.purchase_order_id=v_id and old_line.item_id=(v_item->>'item_id')::uuid)
      >= (select count(*) from jsonb_array_elements(p_items) new_line
        where (new_line->>'item_id')::uuid=(v_item->>'item_id')::uuid)
    ) then
      raise exception 'Choose an active item linked to the selected supplier at this outlet.';
    end if;
    if v_source_type='stock_check' then
      select * into v_source_item from public.inventory_stock_check_items
        where id=nullif(v_item->>'source_stock_check_item_id','')::uuid and stock_check_id=v_source;
      if not found or v_source_item.item_id is distinct from (v_item->>'item_id')::uuid
        or v_source_item.skipped or v_source_item.actual_count_quantity is null
        or v_source_item.par_level_quantity is null
        or v_source_item.par_level_quantity <= v_source_item.actual_count_quantity then
        raise exception 'Purchase order line is not an eligible stock check shortage.';
      end if;
      if v_source_item.id=any(v_seen_source_items) then raise exception 'A stock check item cannot appear twice in a purchase order.'; end if;
      v_seen_source_items:=array_append(v_seen_source_items,v_source_item.id);
      if not exists(select 1 from public.inventory_item_outlet_suppliers ios
        join public.inventory_item_outlets iio on iio.id=ios.inventory_item_outlet_id
        where iio.outlet_id=v_outlet and iio.inventory_item_id=v_source_item.item_id and ios.supplier_id=v_supplier) then
        raise exception 'Supplier is not assigned to this stock check item.';
      end if;
      if exists(select 1 from public.inventory_purchase_order_items line
        join public.inventory_purchase_orders po on po.id=line.purchase_order_id
        where line.source_stock_check_item_id=v_source_item.id and po.status<>'cancelled'
          and (v_id is null or po.id<>v_id)) then
        raise exception 'A purchase order already exists for this stock check item.';
      end if;
    elsif nullif(v_item->>'source_stock_check_item_id','') is not null then
      raise exception 'Manual purchase orders cannot reference stock check items.';
    end if;
  end loop;
  if v_id is not null then
    update public.inventory_purchase_orders set supplier_id=v_supplier,updated_at=v_now where id=v_id returning * into v_order;
    delete from public.inventory_purchase_order_items where purchase_order_id=v_id;
  else
    insert into public.inventory_purchase_orders(po_no,outlet_id,supplier_id,status,source_type,source_stock_check_id,
      created_by,created_by_employee_id,created_at,updated_at)
    values(nullif(p_order->>'po_no',''),v_outlet,v_supplier,'draft',v_source_type,v_source,p_actor_user,p_actor_employee,v_now,v_now)
    returning * into v_order;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.inventory_purchase_order_items(purchase_order_id,item_id,requested_qty,received_qty,unit,remark,
      source_stock_check_item_id,created_at,updated_at)
    values(v_order.id,(v_item->>'item_id')::uuid,(v_item->>'requested_qty')::numeric,0,
      nullif(v_item->>'unit',''),nullif(v_item->>'remark',''),
      nullif(v_item->>'source_stock_check_item_id','')::uuid,v_now,v_now);
  end loop;
  v_result:=jsonb_build_object('order',to_jsonb(v_order),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at)
    from public.inventory_purchase_order_items i where i.purchase_order_id=v_order.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id) values(p_request_id,'purchase_order',p_actor_user,p_actor_employee,p_actor_kind,v_outlet,v_result,v_fingerprint,p_machine);
  if v_id is null then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_draft_created','inventory',p_actor_user,'Purchase order draft created.',
      jsonb_build_object('purchase_order_id',v_order.id,'outlet_id',v_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  end if;
  return v_result;
end; $function$;

-- PO-only Admin roles need the same outlet-scoped link read as Master and Par Levels.
alter policy "inventory outlet supplier viewers can view links"
on public.inventory_item_outlet_suppliers
using (
  (
    public.current_user_has_permission('inventory_par_levels.view')
    or public.current_user_has_permission('inventory_master.view')
    or public.current_user_has_permission('inventory_control.view')
    or public.current_user_has_permission('inventory_orders.view')
  )
  and exists (
    select 1 from public.inventory_item_outlets io
    where io.id = inventory_item_outlet_suppliers.inventory_item_outlet_id
      and public.current_user_can_access_outlet(io.outlet_id)
  )
);

alter policy "inventory outlet config viewers can view configs"
on public.inventory_item_outlets
using (
  (
    public.current_user_has_permission('inventory_master.view')
    or public.current_user_has_permission('inventory_par_levels.view')
    or public.current_user_has_permission('inventory_stock_check.view')
    or public.current_user_has_permission('inventory_requests.view')
    or public.current_user_has_permission('inventory_control.view')
    or public.current_user_has_permission('inventory_orders.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);
