-- Extend the same token-bound read projection with current canonical item imagery.
-- Completed count evidence is unchanged; inactive items can still show their
-- Master Inventory image in result/history when one remains available.
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
        'skipped',ci.skipped,'skip_reason',ci.skip_reason,'photo_url',i.photo_url) order by i.item_name,ci.id)
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
        'cover_photo_url',(select i.photo_url from public.inventory_stock_check_items ci
          join public.inventory_items i on i.id=ci.item_id
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
