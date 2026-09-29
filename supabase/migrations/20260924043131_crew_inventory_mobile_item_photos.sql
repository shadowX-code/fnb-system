-- Read-only presentation fields from canonical Master Inventory and Stock Check.
-- The existing token-bound outlet/capability checks and lifecycle commands are unchanged.
create or replace function public.crew_inventory_mobile_catalog(p_token text, p_outlet_id uuid default null)
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
        'photo_url',i.photo_url,
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

create or replace function public.crew_inventory_stock_checks(p_token text,p_outlet_id uuid default null,p_check_id uuid default null)
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
        'submitted_at',c.submitted_at,'updated_at',c.updated_at,
        'cover_item_id',(select ci.item_id from public.inventory_stock_check_items ci
          where ci.stock_check_id=c.id order by ci.id limit 1),
        'item_count',(select count(*) from public.inventory_stock_check_items ci where ci.stock_check_id=c.id)) row_data,
        coalesce(c.submitted_at,c.updated_at) sort_at
        from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
        where c.outlet_id=v_outlet and (c.status='draft' or c.check_date>=v_today-interval '90 days')
          and ((c.stock_check_type='scheduled' and coalesce((v_context->>'can_perform_stock_check')::boolean,false))
            or (c.stock_check_type='audit' and coalesce((v_context->>'can_create_audit_stock_check')::boolean,false)))
        order by coalesce(c.submitted_at,c.updated_at) desc limit 80) bounded),'[]'::jsonb),
    'detail',v_detail);
end; $$;
