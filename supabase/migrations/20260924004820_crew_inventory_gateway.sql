-- Crew Inventory Gateway. Restaurant Inventory remains the only lifecycle owner.
-- All public Crew functions validate an opaque session, current outlet scope and
-- an independent outlet-specific Special Access grant before calling private cores.
alter table public.crew_access
  add column can_perform_stock_check boolean not null default false,
  add column can_create_audit_stock_check boolean not null default false,
  add column can_manage_purchase_orders boolean not null default false,
  add column can_receive_purchase_orders boolean not null default false;
alter table public.crew_management_special_access
  add column can_perform_stock_check boolean not null default false,
  add column can_create_audit_stock_check boolean not null default false,
  add column can_manage_purchase_orders boolean not null default false,
  add column can_receive_purchase_orders boolean not null default false;

create or replace function public.crew_special_access_for_outlet(p_employee_id uuid, p_outlet_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_employee public.employees%rowtype; v_access public.crew_access%rowtype;
  v_grant public.crew_management_special_access%rowtype;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_access from public.crew_access where employee_id=p_employee_id and access_state='active';
  if v_access.employee_id is null or p_outlet_id is null then
    raise exception using errcode='42501',message='Crew Special Access is unavailable.';
  end if;
  if lower(btrim(coalesce(v_employee.workplace,'')))='management' then
    if v_access.primary_outlet_id is not null or not(p_outlet_id=any(public.crew_authorized_outlet_ids(p_employee_id))) then
      raise exception using errcode='42501',message='Outlet is unavailable for this Crew employee.';
    end if;
    select * into v_grant from public.crew_management_special_access
      where employee_id=p_employee_id and outlet_id=p_outlet_id;
    return jsonb_build_object('employee_id',p_employee_id,'outlet_id',p_outlet_id,
      'can_initiate_handover',coalesce(v_grant.can_initiate_handover,false),
      'can_add_assets',coalesce(v_grant.can_add_assets,false),
      'can_manage_asset_details',coalesce(v_grant.can_manage_asset_details,false),
      'can_adjust_assets',coalesce(v_grant.can_adjust_assets,false),
      'can_perform_asset_inspections',coalesce(v_grant.can_perform_asset_inspections,false),
      'can_perform_stock_check',coalesce(v_grant.can_perform_stock_check,false),
      'can_create_audit_stock_check',coalesce(v_grant.can_create_audit_stock_check,false),
      'can_manage_purchase_orders',coalesce(v_grant.can_manage_purchase_orders,false),
      'can_receive_purchase_orders',coalesce(v_grant.can_receive_purchase_orders,false));
  end if;
  if v_access.primary_outlet_id is distinct from p_outlet_id
    or p_outlet_id is distinct from public.crew_resolve_employee_outlet(p_employee_id) then
    raise exception using errcode='42501',message='Outlet is unavailable for this Crew employee.';
  end if;
  return jsonb_build_object('employee_id',p_employee_id,'outlet_id',p_outlet_id,
    'can_initiate_handover',v_access.can_initiate_handover,
    'can_add_assets',v_access.can_add_assets,
    'can_manage_asset_details',v_access.can_manage_asset_details,
    'can_adjust_assets',v_access.can_adjust_assets,
    'can_perform_asset_inspections',v_access.can_perform_asset_inspections,
    'can_perform_stock_check',v_access.can_perform_stock_check,
    'can_create_audit_stock_check',v_access.can_create_audit_stock_check,
    'can_manage_purchase_orders',v_access.can_manage_purchase_orders,
    'can_receive_purchase_orders',v_access.can_receive_purchase_orders);
end; $$;

create function inventory_authority.stock_group_due(p_group public.inventory_stock_check_groups,p_date date)
returns boolean language sql stable set search_path = '' as $$
  select p_group.status='active' and case p_group.frequency_type
    when 'custom' then to_char(p_date,'FMDay')=any(p_group.frequency_days)
    when 'monthly' then extract(day from p_date)::integer=
      case when p_group.schedule_config->>'monthDay'='last' then
        extract(day from (date_trunc('month',p_date)+interval '1 month - 1 day'))::integer
      else least(greatest(coalesce(nullif(p_group.schedule_config->>'monthDay','')::integer,1),1),
        extract(day from (date_trunc('month',p_date)+interval '1 month - 1 day'))::integer) end
    else false end;
$$;

-- Read-only business projection: validating a Crew session may refresh its
-- session heartbeat, but no Stock Check lifecycle row is created or changed.
create function public.crew_inventory_stock_checks(p_token text,p_outlet_id uuid default null,p_check_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'stock_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid; v_today date:=timezone('Asia/Kuala_Lumpur',now())::date;
  v_check public.inventory_stock_checks%rowtype; v_detail jsonb;
begin
  if p_check_id is not null then
    select * into v_check from public.inventory_stock_checks where id=p_check_id and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Stock check is unavailable for this outlet.'; end if;
    if (v_check.stock_check_type='audit' and not coalesce((v_context->>'can_create_audit_stock_check')::boolean,false))
      or (v_check.stock_check_type='scheduled' and not coalesce((v_context->>'can_perform_stock_check')::boolean,false)) then
      raise exception using errcode='42501',message='Stock check capability is unavailable.';
    end if;
    select jsonb_build_object('id',c.id,'type',c.stock_check_type,'status',c.status,
      'group_id',c.group_id,'check_name',c.check_name,'audit_name',c.audit_name,
      'audit_type',c.audit_type,'audit_category_ids',c.audit_category_ids,'check_date',c.check_date,
      'shift',c.shift,'notes',c.notes,'submitted_at',c.submitted_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',ci.id,'item_id',ci.item_id,
        'item_name',i.item_name,'sku_code',i.sku_code,'category_id',ci.category_id,
        'par_level_quantity',ci.par_level_quantity,'actual_count_quantity',ci.actual_count_quantity,
        'variance',ci.variance,'unit',ci.unit,'status',ci.status,'notes',ci.notes,
        'skipped',ci.skipped,'skip_reason',ci.skip_reason) order by i.item_name,ci.id)
        from public.inventory_stock_check_items ci left join public.inventory_items i on i.id=ci.item_id
        where ci.stock_check_id=c.id),'[]'::jsonb)) into v_detail
      from public.inventory_stock_checks c where c.id=p_check_id;
  end if;
  return jsonb_build_object('outlet_id',v_outlet,'business_date',v_today,
    'can_perform_stock_check',v_context->'can_perform_stock_check',
    'can_create_audit_stock_check',v_context->'can_create_audit_stock_check',
    'due',case when coalesce((v_context->>'can_perform_stock_check')::boolean,false) then coalesce((
      select jsonb_agg(jsonb_build_object('group_id',g.id,'name',g.name,'shift',g.shift,
        'status',case when submitted.id is not null then 'completed'
          when draft.id is not null then 'draft' else 'due' end,
        'check_id',coalesce(submitted.id,draft.id),
        'items',coalesce((select jsonb_agg(jsonb_build_object('item_id',i.id,
          'item_name',i.item_name,'sku_code',i.sku_code,'category_id',i.category_id,
          'par_level_quantity',io.par_level,'unit',i.unit) order by i.item_name,i.id)
          from public.inventory_item_outlets io join public.inventory_items i on i.id=io.inventory_item_id
          where io.outlet_id=v_outlet and io.is_active and i.status='active'
            and exists(select 1 from public.inventory_stock_check_group_categories gc
              where gc.group_id=g.id and gc.category_id=i.category_id)),'[]'::jsonb)) order by g.name,g.id)
      from public.inventory_stock_check_groups g
      left join lateral (select id from public.inventory_stock_checks c
        where c.group_id=g.id and c.outlet_id=v_outlet and c.check_date=v_today
          and c.status='submitted' and c.stock_check_type='scheduled'
        order by c.submitted_at desc,c.id limit 1) submitted on true
      left join lateral (select id from public.inventory_stock_checks c
        where c.group_id=g.id and c.outlet_id=v_outlet and c.check_date=v_today
          and c.status='draft' and c.stock_check_type='scheduled'
        order by c.updated_at desc,c.id limit 1) draft on true
      where g.outlet_id=v_outlet and inventory_authority.stock_group_due(g,v_today)
    ),'[]'::jsonb) else '[]'::jsonb end,
    'checks',coalesce((select jsonb_agg(row_data order by sort_at desc)
      from (select jsonb_build_object('id',c.id,'type',c.stock_check_type,'status',c.status,
        'name',coalesce(c.audit_name,c.check_name,g.name),'group_id',c.group_id,
        'audit_type',c.audit_type,'check_date',c.check_date,'shift',c.shift,
        'submitted_at',c.submitted_at,'item_count',(select count(*) from public.inventory_stock_check_items ci where ci.stock_check_id=c.id)) row_data,
        coalesce(c.submitted_at,c.updated_at) sort_at
        from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
        where c.outlet_id=v_outlet and (c.status='draft' or c.check_date>=v_today-interval '90 days')
          and ((c.stock_check_type='scheduled' and coalesce((v_context->>'can_perform_stock_check')::boolean,false))
            or (c.stock_check_type='audit' and coalesce((v_context->>'can_create_audit_stock_check')::boolean,false)))
        order by coalesce(c.submitted_at,c.updated_at) desc limit 80) bounded),'[]'::jsonb),
    'detail',v_detail);
end; $$;

create function public.crew_inventory_purchase_orders(p_token text,p_outlet_id uuid default null,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'order_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid; v_order public.inventory_purchase_orders%rowtype;
  v_detail jsonb;
begin
  if p_order_id is not null then
    select * into v_order from public.inventory_purchase_orders where id=p_order_id and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Purchase order is unavailable for this outlet.'; end if;
    select jsonb_build_object('id',p.id,'po_no',p.po_no,'status',p.status,
      'supplier_id',p.supplier_id,'supplier_name',s.name,'source_type',p.source_type,
      'source_stock_check_id',p.source_stock_check_id,'created_at',p.created_at,
      'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,'completed_at',p.completed_at,
      'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'item_id',l.item_id,
        'item_name',i.item_name,'sku_code',i.sku_code,'requested_qty',l.requested_qty,
        'received_qty',l.received_qty,'remaining_qty',greatest(l.requested_qty-l.received_qty,0),
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
      from (select jsonb_build_object('id',p.id,'po_no',p.po_no,'supplier_id',p.supplier_id,
        'supplier_name',s.name,'status',p.status,'source_type',p.source_type,
        'created_at',p.created_at,'line_count',(select count(*) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'requested_qty',(select coalesce(sum(l.requested_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'received_qty',(select coalesce(sum(l.received_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id)) row_data,
        p.created_at sort_at from public.inventory_purchase_orders p
        left join public.suppliers s on s.id=p.supplier_id where p.outlet_id=v_outlet
        order by p.created_at desc,p.id limit 100) bounded),'[]'::jsonb),
    'suggestions',case when coalesce((v_context->>'can_manage_purchase_orders')::boolean,false) then
      coalesce((select jsonb_agg(row_data order by checked_at desc)
        from (select jsonb_build_object('stock_check_id',c.id,'check_name',coalesce(c.check_name,g.name),
          'check_date',c.check_date,'shortages',coalesce((select jsonb_agg(jsonb_build_object(
            'stock_check_item_id',ci.id,'item_id',ci.item_id,'item_name',i.item_name,
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
            and exists(select 1 from public.inventory_stock_check_items ci where ci.stock_check_id=c.id
              and not ci.skipped and ci.actual_count_quantity is not null and ci.par_level_quantity>ci.actual_count_quantity
              and not exists(select 1 from public.inventory_purchase_order_items l
                join public.inventory_purchase_orders p on p.id=l.purchase_order_id
                where l.source_stock_check_item_id=ci.id and p.status<>'cancelled'))
          order by c.submitted_at desc,c.id limit 40) bounded),'[]'::jsonb)
      else '[]'::jsonb end,'detail',v_detail);
end; $$;

create function public.crew_inventory_attention(p_token text,p_outlet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'attention');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid; v_today date:=timezone('Asia/Kuala_Lumpur',now())::date;
  v_due integer:=0; v_confirm integer:=0; v_receive integer:=0;
begin
  if coalesce((v_context->>'can_perform_stock_check')::boolean,false) then
    select count(*) into v_due from public.inventory_stock_check_groups g
      where g.outlet_id=v_outlet and inventory_authority.stock_group_due(g,v_today)
        and not exists(select 1 from public.inventory_stock_checks c where c.group_id=g.id
          and c.outlet_id=v_outlet and c.check_date=v_today and c.status='submitted');
  end if;
  if coalesce((v_context->>'can_manage_purchase_orders')::boolean,false) then
    select count(*) into v_confirm from public.inventory_purchase_orders
      where outlet_id=v_outlet and status='submitted';
  end if;
  if coalesce((v_context->>'can_receive_purchase_orders')::boolean,false) then
    select count(*) into v_receive from public.inventory_purchase_orders
      where outlet_id=v_outlet and status in ('supplier_confirmed','partial_received');
  end if;
  return jsonb_build_object('outlet_id',v_outlet,'business_date',v_today,
    'stock_checks_due_today',v_due,'purchase_orders_awaiting_confirmation',v_confirm,
    'purchase_orders_awaiting_receiving',v_receive);
end; $$;

-- Preserve the existing Special Access editor and its existing grant save path.
-- The new wrapper composes both updates in one database transaction.
create function public.crew_update_inventory_special_access(
  p_employee_id uuid,p_can_initiate_handover boolean,p_can_adjust_assets boolean,
  p_can_perform_asset_inspections boolean,p_can_add_assets boolean,p_can_manage_asset_details boolean,
  p_can_perform_stock_check boolean,p_can_create_audit_stock_check boolean,
  p_can_manage_purchase_orders boolean,p_can_receive_purchase_orders boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_access public.crew_access%rowtype; v_outlet uuid; v_before jsonb; v_after jsonb;
begin
  perform public.crew_update_special_access(p_employee_id,p_can_initiate_handover,p_can_adjust_assets,
    p_can_perform_asset_inspections,p_can_add_assets,p_can_manage_asset_details);
  select * into v_access from public.crew_access where employee_id=p_employee_id for update;
  v_outlet:=v_access.primary_outlet_id;
  v_before:=jsonb_build_object('stock_check',v_access.can_perform_stock_check,
    'audit',v_access.can_create_audit_stock_check,'orders',v_access.can_manage_purchase_orders,
    'receive',v_access.can_receive_purchase_orders);
  update public.crew_access set can_perform_stock_check=coalesce(p_can_perform_stock_check,false),
    can_create_audit_stock_check=coalesce(p_can_create_audit_stock_check,false),
    can_manage_purchase_orders=coalesce(p_can_manage_purchase_orders,false),
    can_receive_purchase_orders=coalesce(p_can_receive_purchase_orders,false),updated_at=now()
    where employee_id=p_employee_id returning * into v_access;
  v_after:=jsonb_build_object('stock_check',v_access.can_perform_stock_check,
    'audit',v_access.can_create_audit_stock_check,'orders',v_access.can_manage_purchase_orders,
    'receive',v_access.can_receive_purchase_orders);
  if v_before is distinct from v_after then
    insert into public.audit_logs(action,module,description,metadata)
      values('crew_inventory_special_access_updated','crew','Crew Inventory Special Access updated.',
        jsonb_build_object('employee_id',p_employee_id,'outlet_id',v_outlet,'actor_id',auth.uid(),
          'before',v_before,'after',v_after));
  end if;
  return public.crew_special_access_for_outlet(p_employee_id,v_outlet);
end; $$;

create function public.crew_update_management_inventory_special_access(
  p_employee_id uuid,p_outlet_id uuid,p_can_initiate_handover boolean,
  p_can_add_assets boolean,p_can_manage_asset_details boolean,p_can_adjust_assets boolean,
  p_can_perform_asset_inspections boolean,p_can_perform_stock_check boolean,
  p_can_create_audit_stock_check boolean,p_can_manage_purchase_orders boolean,
  p_can_receive_purchase_orders boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.crew_update_management_special_access(p_employee_id,p_outlet_id,p_can_initiate_handover,
    p_can_add_assets,p_can_manage_asset_details,p_can_adjust_assets,p_can_perform_asset_inspections);
  v_before:=public.crew_special_access_for_outlet(p_employee_id,p_outlet_id);
  update public.crew_management_special_access set
    can_perform_stock_check=coalesce(p_can_perform_stock_check,false),
    can_create_audit_stock_check=coalesce(p_can_create_audit_stock_check,false),
    can_manage_purchase_orders=coalesce(p_can_manage_purchase_orders,false),
    can_receive_purchase_orders=coalesce(p_can_receive_purchase_orders,false),
    updated_by=auth.uid(),updated_at=now()
    where employee_id=p_employee_id and outlet_id=p_outlet_id;
  v_after:=public.crew_special_access_for_outlet(p_employee_id,p_outlet_id);
  if v_before is distinct from v_after then
    insert into public.audit_logs(action,module,description,metadata)
      values('crew_inventory_special_access_updated','crew','Management Crew outlet Inventory Special Access updated.',
        jsonb_build_object('employee_id',p_employee_id,'outlet_id',p_outlet_id,'actor_id',auth.uid(),
          'before',v_before,'after',v_after));
  end if;
  return v_after;
end; $$;

create function public.crew_inventory_special_access_admin(p_employee_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_outlet uuid;
begin
  if not (public.current_user_has_permission('crew_employees.view')
    or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode='42501',message='Missing permission to view Crew Access.';
  end if;
  v_outlet:=public.crew_resolve_employee_outlet(p_employee_id);
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='Crew Access outlet is unavailable.';
  end if;
  return public.crew_special_access_for_outlet(p_employee_id,v_outlet);
end; $$;

create or replace function public.crew_management_special_access_admin(p_employee_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_employee public.employees%rowtype; v_access public.crew_access%rowtype;
begin
  if not (public.current_user_has_permission('crew_employees.view')
    or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode='42501',message='Missing permission to view Crew Access.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_access from public.crew_access where employee_id=p_employee_id;
  if v_employee.id is null or lower(btrim(coalesce(v_employee.workplace,'')))<>'management'
    or v_access.employee_id is null or v_access.access_state<>'active' or v_access.primary_outlet_id is not null then
    raise exception using errcode='42501',message='Management Crew Access is unavailable.';
  end if;
  return jsonb_build_object('employee_id',p_employee_id,'outlets',coalesce((
    select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,
      'can_initiate_handover',coalesce(g.can_initiate_handover,false),
      'can_add_assets',coalesce(g.can_add_assets,false),
      'can_manage_asset_details',coalesce(g.can_manage_asset_details,false),
      'can_adjust_assets',coalesce(g.can_adjust_assets,false),
      'can_perform_asset_inspections',coalesce(g.can_perform_asset_inspections,false),
      'can_perform_stock_check',coalesce(g.can_perform_stock_check,false),
      'can_create_audit_stock_check',coalesce(g.can_create_audit_stock_check,false),
      'can_manage_purchase_orders',coalesce(g.can_manage_purchase_orders,false),
      'can_receive_purchase_orders',coalesce(g.can_receive_purchase_orders,false)) order by o.name,o.id)
    from public.outlets o left join public.crew_management_special_access g
      on g.employee_id=p_employee_id and g.outlet_id=o.id
    where o.id=any(public.crew_authorized_outlet_ids(p_employee_id))
      and public.current_user_can_access_outlet(o.id)
  ),'[]'::jsonb));
end; $$;

-- The existing Crew Access list is the owning Admin read model for the
-- fixed-outlet row summary; add only the four new flags to its safe payload.
create or replace function public.crew_access_admin_page(
  p_outlet_id uuid,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_query text:=btrim(coalesce(p_filters->>'query',''));
  v_status text:=nullif(btrim(coalesce(p_filters->>'employment_status','')),'');
  v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end;
  v_total integer; v_rows jsonb; v_summary jsonb;
begin
  if p_outlet_id is null or not (public.current_user_has_permission('crew_employees.view')
    or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode='42501',message='Missing permission to view Crew Access.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='You cannot view Crew Access outside your outlet scope.';
  end if;
  with source as (
    select e.*,ca.employee_id as access_employee_id,ca.mobile_number as crew_mobile_number,
      ca.access_state as crew_access_state,ca.activated_at as crew_activated_at,
      ca.disabled_at as crew_disabled_at,ca.locked_until as crew_locked_until,
      ca.last_login_at as crew_last_login_at,ca.primary_outlet_id as crew_primary_outlet_id,
      ca.can_initiate_handover as crew_can_initiate_handover,ca.can_add_assets as crew_can_add_assets,
      ca.can_manage_asset_details as crew_can_manage_asset_details,
      ca.can_adjust_assets as crew_can_adjust_assets,
      ca.can_perform_asset_inspections as crew_can_perform_asset_inspections,
      ca.can_perform_stock_check as crew_can_perform_stock_check,
      ca.can_create_audit_stock_check as crew_can_create_audit_stock_check,
      ca.can_manage_purchase_orders as crew_can_manage_purchase_orders,
      ca.can_receive_purchase_orders as crew_can_receive_purchase_orders
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      or (lower(btrim(coalesce(e.workplace,'')))='management'
        and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id)))
  ), filtered as (
    select * from source where (v_query='' or concat_ws(' ',full_name,employee_code,position,workplace) ilike '%'||v_query||'%')
      and (v_status is null or v_status='all' or coalesce(employment_status,'active')=v_status)
  ) select count(*) into v_total from filtered;
  with source as (
    select e.*,ca.employee_id as access_employee_id,ca.mobile_number as crew_mobile_number,
      ca.access_state as crew_access_state,ca.activated_at as crew_activated_at,
      ca.disabled_at as crew_disabled_at,ca.locked_until as crew_locked_until,
      ca.last_login_at as crew_last_login_at,ca.primary_outlet_id as crew_primary_outlet_id,
      ca.can_initiate_handover as crew_can_initiate_handover,ca.can_add_assets as crew_can_add_assets,
      ca.can_manage_asset_details as crew_can_manage_asset_details,
      ca.can_adjust_assets as crew_can_adjust_assets,
      ca.can_perform_asset_inspections as crew_can_perform_asset_inspections,
      ca.can_perform_stock_check as crew_can_perform_stock_check,
      ca.can_create_audit_stock_check as crew_can_create_audit_stock_check,
      ca.can_manage_purchase_orders as crew_can_manage_purchase_orders,
      ca.can_receive_purchase_orders as crew_can_receive_purchase_orders
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      or (lower(btrim(coalesce(e.workplace,'')))='management'
        and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id)))
  ), filtered as (
    select * from source where (v_query='' or concat_ws(' ',full_name,employee_code,position,workplace) ilike '%'||v_query||'%')
      and (v_status is null or v_status='all' or coalesce(employment_status,'active')=v_status)
  ) select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'full_name',full_name,'employee_code',employee_code,'position',position,
      'workplace',workplace,'contact',contact,'employment_type',employment_type,
      'employment_status',employment_status,'is_active',is_active,
      'crew_access',case when access_employee_id is null then null else jsonb_build_object(
        'employee_id',access_employee_id,'mobile_number',crew_mobile_number,
        'access_state',crew_access_state,'activated_at',crew_activated_at,'disabled_at',crew_disabled_at,
        'locked_until',crew_locked_until,'last_login_at',crew_last_login_at,
        'primary_outlet_id',crew_primary_outlet_id,'can_initiate_handover',crew_can_initiate_handover,
        'can_add_assets',crew_can_add_assets,'can_manage_asset_details',crew_can_manage_asset_details,
        'can_adjust_assets',crew_can_adjust_assets,
        'can_perform_asset_inspections',crew_can_perform_asset_inspections,
        'can_perform_stock_check',crew_can_perform_stock_check,
        'can_create_audit_stock_check',crew_can_create_audit_stock_check,
        'can_manage_purchase_orders',crew_can_manage_purchase_orders,
        'can_receive_purchase_orders',crew_can_receive_purchase_orders) end)
      order by full_name,id),'[]'::jsonb) into v_rows
    from (select * from filtered order by full_name,id offset (v_page-1)*v_size limit v_size) page_rows;
  with source as (
    select coalesce(ca.access_state,'not_enabled') as crew_access_state
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      or (lower(btrim(coalesce(e.workplace,'')))='management'
        and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id)))
  ) select jsonb_build_object('active',count(*) filter(where crew_access_state='active'),
    'locked',count(*) filter(where crew_access_state='locked'),
    'not_enabled',count(*) filter(where crew_access_state='not_enabled')) into v_summary from source;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,
    'page_size',v_size,'summary',coalesce(v_summary,'{}'::jsonb));
end; $$;

-- Refresh the existing Management outlet selector with live grants.
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
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name)
    || case when v_management then jsonb_build_object('special_access',
      public.crew_special_access_for_outlet(v_employee_id,o.id)) else '{}'::jsonb end
    order by o.name,o.id),'[]'::jsonb),
    (array_agg(o.id order by o.name,o.id))[1]
  into v_outlets,v_default from public.outlets o where o.id=any(v_ids);
  return jsonb_build_object('employee_id',v_employee_id,'management',v_management,
    'outlets',v_outlets,'default_outlet_id',v_default);
end; $$;

-- One outlet/capability gate for every Inventory read and command. The opaque
-- session is the sole identity input; the selected outlet is only a requested
-- scope, never authority in itself.
create function inventory_authority.crew_scope(p_token text,p_outlet_id uuid,p_capability text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_employee uuid:=public.crew_session_employee(p_token); v_workplace text;
  v_access public.crew_access%rowtype; v_outlet uuid; v_grant jsonb;
begin
  if p_capability not in ('can_perform_stock_check','can_create_audit_stock_check',
    'can_manage_purchase_orders','can_receive_purchase_orders','stock_read','order_read','attention') then
    raise exception using errcode='42501',message='Crew Inventory capability is unavailable.';
  end if;
  select workplace into v_workplace from public.employees where id=v_employee;
  select * into v_access from public.crew_access where employee_id=v_employee and access_state='active';
  if lower(btrim(coalesce(v_workplace,'')))='management' then
    v_outlet:=public.crew_selected_outlet(p_token,p_outlet_id);
  else
    v_outlet:=v_access.primary_outlet_id;
    if v_outlet is null or (p_outlet_id is not null and p_outlet_id is distinct from v_outlet) then
      raise exception using errcode='42501',message='Outlet is unavailable for this Crew session.';
    end if;
  end if;
  v_grant:=public.crew_special_access_for_outlet(v_employee,v_outlet);
  if not (case p_capability
    when 'stock_read' then coalesce((v_grant->>'can_perform_stock_check')::boolean,false)
      or coalesce((v_grant->>'can_create_audit_stock_check')::boolean,false)
    when 'order_read' then coalesce((v_grant->>'can_manage_purchase_orders')::boolean,false)
      or coalesce((v_grant->>'can_receive_purchase_orders')::boolean,false)
    when 'attention' then coalesce((v_grant->>'can_perform_stock_check')::boolean,false)
      or coalesce((v_grant->>'can_create_audit_stock_check')::boolean,false)
      or coalesce((v_grant->>'can_manage_purchase_orders')::boolean,false)
      or coalesce((v_grant->>'can_receive_purchase_orders')::boolean,false)
    else coalesce((v_grant->>p_capability)::boolean,false) end) then
    raise exception using errcode='42501',message='Crew Inventory Special Access is required.';
  end if;
  return v_grant || jsonb_build_object('employee_id',v_employee,'outlet_id',v_outlet);
end; $$;

create function public.crew_inventory_save_stock_check(
  p_token text,p_outlet_id uuid,p_request_id uuid,p_check jsonb,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_type text:=p_check->>'stock_check_type'; v_context jsonb; v_outlet uuid;
  v_group public.inventory_stock_check_groups%rowtype;
begin
  if v_type not in ('scheduled','audit') then raise exception 'Stock check type is required.'; end if;
  v_context:=inventory_authority.crew_scope(p_token,p_outlet_id,
    case when v_type='audit' then 'can_create_audit_stock_check' else 'can_perform_stock_check' end);
  v_outlet:=(v_context->>'outlet_id')::uuid;
  if v_type='scheduled' then
    select * into v_group from public.inventory_stock_check_groups
      where id=nullif(p_check->>'group_id','')::uuid and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Stock check group is unavailable.'; end if;
    if nullif(p_check->>'id','') is null then
      if (p_check->>'check_date')::date is distinct from timezone('Asia/Kuala_Lumpur',now())::date
        or not inventory_authority.stock_group_due(v_group,(p_check->>'check_date')::date) then
        raise exception 'Scheduled stock checks can only start on their assigned date.';
      end if;
    end if;
    if exists(select 1 from jsonb_array_elements(p_items) line
      join public.inventory_items i on i.id=nullif(line->>'item_id','')::uuid
      where not exists(select 1 from public.inventory_stock_check_group_categories gc
        where gc.group_id=v_group.id and gc.category_id=i.category_id)) then
      raise exception 'Stock check item is outside the scheduled group.';
    end if;
  end if;
  return inventory_authority.save_stock_check(p_request_id,p_check,p_items,v_outlet,null,
    (v_context->>'employee_id')::uuid,'crew');
end; $$;

create function public.crew_inventory_delete_audit_draft(
  p_token text,p_outlet_id uuid,p_check_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_create_audit_stock_check');
begin
  return inventory_authority.delete_stock_check_draft(p_request_id,p_check_id,
    (v_context->>'outlet_id')::uuid,null,(v_context->>'employee_id')::uuid,'crew');
end; $$;

create function public.crew_inventory_save_purchase_order(
  p_token text,p_outlet_id uuid,p_request_id uuid,p_order jsonb,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders');
begin
  return inventory_authority.save_purchase_order(p_request_id,p_order,p_items,
    (v_context->>'outlet_id')::uuid,null,(v_context->>'employee_id')::uuid,'crew');
end; $$;

create function public.crew_inventory_create_stock_check_purchase_orders(
  p_token text,p_outlet_id uuid,p_request_id uuid,p_check_id uuid,p_orders jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders');
begin
  return inventory_authority.create_stock_check_purchase_orders(p_request_id,p_check_id,p_orders,
    (v_context->>'outlet_id')::uuid,null,(v_context->>'employee_id')::uuid,'crew');
end; $$;

create function public.crew_inventory_transition_purchase_order(
  p_token text,p_outlet_id uuid,p_order_id uuid,p_request_id uuid,p_action text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders');
begin
  if p_action not in ('submit','confirm') then
    raise exception using errcode='42501',message='This purchase order action is Admin-only.';
  end if;
  return inventory_authority.transition_purchase_order(p_order_id,p_request_id,p_action,null,
    (v_context->>'outlet_id')::uuid,null,(v_context->>'employee_id')::uuid,'crew');
end; $$;

create function public.crew_inventory_receive_purchase_order(
  p_token text,p_outlet_id uuid,p_purchase_order_id uuid,p_request_id uuid,p_remark text,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_receive_purchase_orders');
begin
  return inventory_authority.receive_purchase_order(p_purchase_order_id,p_request_id,p_remark,p_items,
    (v_context->>'outlet_id')::uuid,null,(v_context->>'employee_id')::uuid,'crew');
end; $$;

-- PostgreSQL and Supabase default function grants are broad: explicitly seal
-- every helper and expose only token-validated wrappers to the anon transport.
revoke all on function inventory_authority.stock_group_due(public.inventory_stock_check_groups,date),
  inventory_authority.crew_scope(text,uuid,text) from public,anon,authenticated;
revoke all on function public.crew_update_inventory_special_access(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean),
  public.crew_update_management_inventory_special_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean),
  public.crew_inventory_special_access_admin(uuid),
  public.crew_inventory_stock_checks(text,uuid,uuid),
  public.crew_inventory_purchase_orders(text,uuid,uuid),
  public.crew_inventory_attention(text,uuid),
  public.crew_inventory_save_stock_check(text,uuid,uuid,jsonb,jsonb),
  public.crew_inventory_delete_audit_draft(text,uuid,uuid,uuid),
  public.crew_inventory_save_purchase_order(text,uuid,uuid,jsonb,jsonb),
  public.crew_inventory_create_stock_check_purchase_orders(text,uuid,uuid,uuid,jsonb),
  public.crew_inventory_transition_purchase_order(text,uuid,uuid,uuid,text),
  public.crew_inventory_receive_purchase_order(text,uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.crew_update_inventory_special_access(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean),
  public.crew_update_management_inventory_special_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean),
  public.crew_inventory_special_access_admin(uuid) to authenticated;
grant execute on function public.crew_inventory_stock_checks(text,uuid,uuid),
  public.crew_inventory_purchase_orders(text,uuid,uuid),public.crew_inventory_attention(text,uuid),
  public.crew_inventory_save_stock_check(text,uuid,uuid,jsonb,jsonb),
  public.crew_inventory_delete_audit_draft(text,uuid,uuid,uuid),
  public.crew_inventory_save_purchase_order(text,uuid,uuid,jsonb,jsonb),
  public.crew_inventory_create_stock_check_purchase_orders(text,uuid,uuid,uuid,jsonb),
  public.crew_inventory_transition_purchase_order(text,uuid,uuid,uuid,text),
  public.crew_inventory_receive_purchase_order(text,uuid,uuid,uuid,text,jsonb)
  to anon,authenticated;
