-- Applied to canonical Staging as version 20260924191411.
-- Crew PO presentation reads remain token/outlet scoped. Only Crew source-check
-- creation is limited to a recently completed scheduled count; Admin is unchanged.
create or replace function inventory_authority.crew_recent_source_check(p_check_id uuid,p_outlet_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.inventory_stock_checks c
    where c.id=p_check_id and c.outlet_id=p_outlet_id
      and c.stock_check_type='scheduled' and c.status='submitted'
      and c.submitted_at >= now()-interval '7 days');
$$;
revoke all on function inventory_authority.crew_recent_source_check(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_inventory_save_purchase_order(
  p_token text,p_outlet_id uuid,p_request_id uuid,p_order jsonb,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid;
begin
  if p_order->>'source_type'='stock_check' and nullif(p_order->>'id','') is null
    and not exists(select 1 from public.inventory_lifecycle_requests r
      where r.request_id=p_request_id and r.operation='purchase_order' and r.outlet_id=v_outlet)
    and not inventory_authority.crew_recent_source_check(nullif(p_order->>'source_stock_check_id','')::uuid,v_outlet) then
    raise exception 'Crew purchase suggestions must come from a scheduled check completed within the last 7 days.';
  end if;
  return inventory_authority.save_purchase_order(p_request_id,p_order,p_items,v_outlet,
    null,(v_context->>'employee_id')::uuid,'crew');
end; $$;

create or replace function public.crew_inventory_create_stock_check_purchase_orders(
  p_token text,p_outlet_id uuid,p_request_id uuid,p_check_id uuid,p_orders jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid;
begin
  if not exists(select 1 from public.inventory_lifecycle_requests r
      where r.request_id=p_request_id and r.operation='stock_check_purchase_orders' and r.outlet_id=v_outlet)
    and not inventory_authority.crew_recent_source_check(p_check_id,v_outlet) then
    raise exception 'Crew purchase suggestions must come from a scheduled check completed within the last 7 days.';
  end if;
  return inventory_authority.create_stock_check_purchase_orders(p_request_id,p_check_id,p_orders,
    v_outlet,null,(v_context->>'employee_id')::uuid,'crew');
end; $$;

create or replace function public.crew_inventory_purchase_orders(p_token text,p_outlet_id uuid default null,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'order_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid; v_order public.inventory_purchase_orders%rowtype;
  v_detail jsonb;
begin
  if p_order_id is not null then
    select * into v_order from public.inventory_purchase_orders where id=p_order_id and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Purchase order is unavailable for this outlet.'; end if;
    select jsonb_build_object('id',p.id,'po_no',p.po_no,'business_po_no',p.business_po_no,'status',p.status,
      'supplier_id',p.supplier_id,'supplier_name',s.name,'source_type',p.source_type,
      'source_stock_check_id',p.source_stock_check_id,'created_at',p.created_at,
      'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,'completed_at',p.completed_at,
      'category_names',(select coalesce(jsonb_agg(category.name order by category.name),'[]'::jsonb)
        from (select distinct c.name from public.inventory_purchase_order_items l
          join public.inventory_items i on i.id=l.item_id
          join public.inventory_categories c on c.id=i.category_id
          where l.purchase_order_id=p.id) category),
      'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'item_id',l.item_id,
        'item_name',i.item_name,'sku_code',i.sku_code,'photo_url',i.photo_url,
        'requested_qty',l.requested_qty,'received_qty',l.received_qty,
        'remaining_qty',greatest(l.requested_qty-l.received_qty,0),
        'unit',l.unit,'remark',l.remark,'source_stock_check_item_id',l.source_stock_check_item_id)
        order by i.item_name,l.id)
        from public.inventory_purchase_order_items l join public.inventory_items i on i.id=l.item_id
        where l.purchase_order_id=p.id),'[]'::jsonb),
      'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'received_at',r.received_at,
        'remark',r.remark,'lines',coalesce((select jsonb_agg(jsonb_build_object('item_id',ri.item_id,
        'purchase_order_item_id',ri.purchase_order_item_id,'received_qty',ri.received_qty,
        'unit',ri.unit,'remark',ri.remark) order by ri.id)
        from public.inventory_purchase_receipt_items ri where ri.receipt_id=r.id),'[]'::jsonb))
        order by r.received_at,r.id) from public.inventory_purchase_receipts r
        where r.purchase_order_id=p.id),'[]'::jsonb)) into v_detail
      from public.inventory_purchase_orders p left join public.suppliers s on s.id=p.supplier_id
      where p.id=p_order_id;
  end if;
  return jsonb_build_object('outlet_id',v_outlet,
    'can_manage_purchase_orders',v_context->'can_manage_purchase_orders',
    'can_receive_purchase_orders',v_context->'can_receive_purchase_orders',
    'orders',coalesce((select jsonb_agg(row_data order by sort_at desc)
      from (select jsonb_build_object('id',p.id,'po_no',p.po_no,'business_po_no',p.business_po_no,'supplier_id',p.supplier_id,
        'supplier_name',s.name,'status',p.status,'source_type',p.source_type,
        'source_stock_check_id',p.source_stock_check_id,
        'created_at',p.created_at,'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,'completed_at',p.completed_at,
        'category_names',(select coalesce(jsonb_agg(category.name order by category.name),'[]'::jsonb)
          from (select distinct c.name from public.inventory_purchase_order_items l
            join public.inventory_items i on i.id=l.item_id
            join public.inventory_categories c on c.id=i.category_id
            where l.purchase_order_id=p.id) category),
        'line_count',(select count(*) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'requested_qty',(select coalesce(sum(l.requested_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'received_qty',(select coalesce(sum(l.received_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id)) row_data,
        p.created_at sort_at from public.inventory_purchase_orders p
        left join public.suppliers s on s.id=p.supplier_id where p.outlet_id=v_outlet
        order by p.created_at desc,p.id limit 100) bounded),'[]'::jsonb),
    'suggestions',case when coalesce((v_context->>'can_manage_purchase_orders')::boolean,false) then
      coalesce((select jsonb_agg(row_data order by checked_at desc)
        from (select jsonb_build_object('stock_check_id',c.id,'check_name',coalesce(c.check_name,g.name),
          'check_date',c.check_date,'shortages',coalesce((select jsonb_agg(jsonb_build_object(
            'stock_check_item_id',ci.id,'item_id',ci.item_id,'item_name',i.item_name,'sku_code',i.sku_code,'photo_url',i.photo_url,
            'current_qty',ci.actual_count_quantity,'par_qty',ci.par_level_quantity,
            'shortage_qty',ci.par_level_quantity-ci.actual_count_quantity,'unit',ci.unit,
            'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
              from public.inventory_item_outlet_suppliers ios
              join public.inventory_item_outlets io on io.id=ios.inventory_item_outlet_id
              join public.suppliers s on s.id=ios.supplier_id and s.status='active'
              join public.supplier_outlets so on so.supplier_id=s.id and so.outlet_id=v_outlet
              where io.outlet_id=v_outlet and io.inventory_item_id=ci.item_id),'[]'::jsonb)) order by i.item_name,ci.id)
            from public.inventory_stock_check_items ci join public.inventory_items i on i.id=ci.item_id
            where ci.stock_check_id=c.id and not ci.skipped and ci.actual_count_quantity is not null
              and ci.par_level_quantity>ci.actual_count_quantity
              and not exists(select 1 from public.inventory_purchase_order_items l
                join public.inventory_purchase_orders p on p.id=l.purchase_order_id
                where l.source_stock_check_item_id=ci.id and p.status<>'cancelled')),'[]'::jsonb)) row_data,
          c.submitted_at checked_at
          from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
          where c.outlet_id=v_outlet and c.stock_check_type='scheduled' and c.status='submitted'
            and inventory_authority.crew_recent_source_check(c.id,v_outlet)
            and exists(select 1 from public.inventory_stock_check_items ci where ci.stock_check_id=c.id
              and not ci.skipped and ci.actual_count_quantity is not null and ci.par_level_quantity>ci.actual_count_quantity
              and not exists(select 1 from public.inventory_purchase_order_items l
                join public.inventory_purchase_orders p on p.id=l.purchase_order_id
                where l.source_stock_check_item_id=ci.id and p.status<>'cancelled'))
          order by c.submitted_at desc,c.id limit 40) bounded),'[]'::jsonb)
      else '[]'::jsonb end,'detail',v_detail);
end; $$;
