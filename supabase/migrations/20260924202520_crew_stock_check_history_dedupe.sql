-- Canonical recent History keeps one terminal state per scheduled occurrence.
-- Existing duplicate legacy rows remain intact as evidence, but do not repeat in Crew History.
create or replace function public.crew_inventory_stock_checks(p_token text,p_outlet_id uuid default null,p_check_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'stock_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid;
  v_today date:=timezone('Asia/Kuala_Lumpur',now())::date;
  v_check public.inventory_stock_checks%rowtype;
  v_detail jsonb;
begin
  if p_check_id is not null then
    select * into v_check from public.inventory_stock_checks where id=p_check_id and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Stock check is unavailable for this outlet.'; end if;
    if (v_check.stock_check_type='audit' and not coalesce((v_context->>'can_create_audit_stock_check')::boolean,false))
      or (v_check.stock_check_type='scheduled' and not coalesce((v_context->>'can_perform_stock_check')::boolean,false)) then
      raise exception using errcode='42501',message='Stock check capability is unavailable.';
    end if;
    select jsonb_build_object('id',c.id,'type',c.stock_check_type,
      'status',case when c.stock_check_type='scheduled' and c.status='draft'
          then case when c.check_date<v_today then 'missed' else 'in_progress' end
        when c.status='submitted' then 'completed' else c.status end,
      'group_id',c.group_id,'check_name',c.check_name,'audit_name',c.audit_name,
      'audit_type',c.audit_type,'audit_category_ids',c.audit_category_ids,'check_date',c.check_date,
      'shift',c.shift,'notes',c.notes,'submitted_at',c.submitted_at,
      'skipped_at',c.skipped_at,'skipped_by_employee_id',c.skipped_by_employee_id,
      'skipped_by_name',(select e.full_name from public.employees e where e.id=c.skipped_by_employee_id),
      'skip_reason',c.skip_reason,'outlet_id',c.outlet_id,
      'items',case when c.stock_check_type='scheduled' and c.status='draft' and c.check_date<v_today
        then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',ci.id,'item_id',ci.item_id,
        'item_name',i.item_name,'sku_code',i.sku_code,'category_id',ci.category_id,
        'par_level_quantity',ci.par_level_quantity,'actual_count_quantity',ci.actual_count_quantity,
        'variance',ci.variance,'unit',ci.unit,'status',ci.status,'notes',ci.notes,
        'skipped',ci.skipped,'skip_reason',ci.skip_reason,'photo_url',i.photo_url) order by i.item_name,ci.id)
        from public.inventory_stock_check_items ci left join public.inventory_items i on i.id=ci.item_id
        where ci.stock_check_id=c.id),'[]'::jsonb) end) into v_detail
      from public.inventory_stock_checks c where c.id=p_check_id;
  end if;
  return jsonb_build_object('outlet_id',v_outlet,'business_date',v_today,
    'can_perform_stock_check',v_context->'can_perform_stock_check',
    'can_create_audit_stock_check',v_context->'can_create_audit_stock_check',
    'due',case when coalesce((v_context->>'can_perform_stock_check')::boolean,false) then coalesce((
      select jsonb_agg(jsonb_build_object('group_id',g.id,'name',g.name,'shift',g.shift,
        'business_date',v_today,'status',case when check_row.status='submitted' then 'completed'
          when check_row.status='skipped' then 'skipped'
          when check_row.status='draft' then 'in_progress' else 'due' end,
        'check_id',check_row.id,
        'items',coalesce((select jsonb_agg(jsonb_build_object('item_id',i.id,
          'item_name',i.item_name,'sku_code',i.sku_code,'category_id',i.category_id,
          'par_level_quantity',io.par_level,'unit',i.unit) order by i.item_name,i.id)
          from public.inventory_item_outlets io join public.inventory_items i on i.id=io.inventory_item_id
          where io.outlet_id=v_outlet and io.is_active and i.status='active'
            and exists(select 1 from public.inventory_stock_check_group_categories gc
              where gc.group_id=g.id and gc.category_id=i.category_id)),'[]'::jsonb)) order by g.name,g.id)
      from public.inventory_stock_check_groups g
      left join lateral (select c.id,c.status from public.inventory_stock_checks c
        where c.group_id=g.id and c.outlet_id=v_outlet and c.check_date=v_today
          and c.stock_check_type='scheduled'
        order by case c.status when 'submitted' then 0 when 'skipped' then 1 else 2 end,
          c.updated_at desc,c.id limit 1) check_row on true
      where g.outlet_id=v_outlet and inventory_authority.stock_group_due(g,v_today)
    ),'[]'::jsonb) else '[]'::jsonb end,
    'checks',coalesce((select jsonb_agg(row_data order by sort_at desc)
      from (select row_data,sort_at from (
        select jsonb_build_object('id',c.id,'type',c.stock_check_type,
          'status',case when c.stock_check_type='scheduled' and c.status='draft'
            then case when c.check_date<v_today then 'missed' else 'in_progress' end
            when c.status='submitted' then 'completed' else c.status end,
          'name',coalesce(c.audit_name,c.check_name,g.name),'group_id',c.group_id,
          'audit_type',c.audit_type,'check_date',c.check_date,'shift',c.shift,
          'submitted_at',c.submitted_at,'skipped_at',c.skipped_at,
          'skipped_by_employee_id',c.skipped_by_employee_id,'skip_reason',c.skip_reason,
          'updated_at',c.updated_at,
          'cover_item_id',(select ci.item_id from public.inventory_stock_check_items ci
            where ci.stock_check_id=c.id order by ci.id limit 1),
          'cover_photo_url',(select i.photo_url from public.inventory_stock_check_items ci
            join public.inventory_items i on i.id=ci.item_id
            where ci.stock_check_id=c.id order by ci.id limit 1),
          'item_count',(select count(*) from public.inventory_stock_check_items ci
            where ci.stock_check_id=c.id)) row_data,
          case when c.stock_check_type='scheduled' and c.status='draft' and c.check_date<v_today
            then c.check_date::timestamptz else coalesce(c.submitted_at,c.skipped_at,c.updated_at) end sort_at
        from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
        where c.outlet_id=v_outlet and (c.status='draft' or c.status='skipped'
          or c.check_date>=v_today-interval '90 days'
          or c.submitted_at>=now()-interval '90 days')
          and (c.stock_check_type='audit' or c.id=(select c2.id from public.inventory_stock_checks c2
            where c2.outlet_id=c.outlet_id and c2.group_id=c.group_id
              and c2.check_date=c.check_date and c2.shift is not distinct from c.shift
              and c2.stock_check_type='scheduled'
            order by case c2.status when 'submitted' then 0 when 'skipped' then 1 else 2 end,
              c2.updated_at desc,c2.id limit 1))
          and ((c.stock_check_type='scheduled' and coalesce((v_context->>'can_perform_stock_check')::boolean,false))
            or (c.stock_check_type='audit' and coalesce((v_context->>'can_create_audit_stock_check')::boolean,false)))
        union all
        select jsonb_build_object('id',null,'type','scheduled','status','missed',
          'name',g.name,'group_id',g.id,'check_date',day.run_date,'shift',g.shift,
          'item_count',null,'outlet_id',v_outlet) row_data,
          day.run_date::timestamptz sort_at
        from public.inventory_stock_check_groups g
        cross join lateral (select series::date run_date from generate_series(
          (v_today-7)::timestamp,(v_today-1)::timestamp,interval '1 day') series) day
        where g.outlet_id=v_outlet
          and coalesce((v_context->>'can_perform_stock_check')::boolean,false)
          and day.run_date>=timezone('Asia/Kuala_Lumpur',g.created_at)::date
          and inventory_authority.stock_group_due(g,day.run_date)
          and not exists(select 1 from public.inventory_stock_checks c
            where c.group_id=g.id and c.outlet_id=v_outlet and c.check_date=day.run_date
              and c.stock_check_type='scheduled')
      ) all_rows order by sort_at desc limit 120) bounded),'[]'::jsonb),
    'detail',v_detail);
end; $$;
