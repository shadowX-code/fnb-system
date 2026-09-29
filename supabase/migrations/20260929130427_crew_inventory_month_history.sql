-- Crew-only, outlet-scoped calendar-month history. Canonical orders and checks are retained.
create index if not exists inventory_po_crew_terminal_history_idx
  on public.inventory_purchase_orders (outlet_id, (coalesce(completed_at,updated_at,created_at)) desc, id desc)
  where status in ('completed','fully_received','cancelled');
create index if not exists inventory_check_crew_submitted_history_idx
  on public.inventory_stock_checks (outlet_id, submitted_at desc, id desc) where status='submitted';
create index if not exists inventory_check_crew_skipped_history_idx
  on public.inventory_stock_checks (outlet_id, skipped_at desc, id desc) where status='skipped';
create function public.crew_inventory_purchase_order_history(
  p_token text, p_outlet_id uuid default null, p_month date default null,
  p_status text default null, p_offset integer default 0, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb := inventory_authority.crew_scope(p_token,p_outlet_id,'order_read');
  v_outlet uuid := (v_context->>'outlet_id')::uuid;
  v_month date := date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))::date;
  v_rows jsonb;
begin
  if p_month is null then p_month := v_month; end if;
  if p_month not in (v_month,(v_month-interval '1 month')::date) or p_status not in ('completed','fully_received','cancelled') and p_status is not null
    or p_offset < 0 or p_limit < 1 or p_limit > 50 then
    raise exception using errcode='22023',message='Invalid Crew history selection.';
  end if;
  select coalesce(jsonb_agg(row_data order by history_at desc,id desc),'[]'::jsonb) into v_rows
  from (select p.id,
    coalesce(p.completed_at,p.updated_at,p.created_at) history_at,
    jsonb_build_object('id',p.id,'business_po_no',p.business_po_no,'supplier_id',p.supplier_id,
      'supplier_name',s.name,'status',p.status,'source_stock_check_id',p.source_stock_check_id,
      'created_at',p.created_at,'completed_at',p.completed_at,
      'history_at',coalesce(p.completed_at,p.updated_at,p.created_at),
      'category_names',(select coalesce(jsonb_agg(category.name order by category.name),'[]'::jsonb)
        from (select distinct c.name from public.inventory_purchase_order_items l
          join public.inventory_items i on i.id=l.item_id
          join public.inventory_categories c on c.id=i.category_id where l.purchase_order_id=p.id) category),
      'line_count',(select count(*) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
      'requested_qty',(select coalesce(sum(l.requested_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
      'received_qty',(select coalesce(sum(l.received_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id)) row_data
    from public.inventory_purchase_orders p left join public.suppliers s on s.id=p.supplier_id
    where p.outlet_id=v_outlet and p.status in ('completed','fully_received','cancelled')
      and (p_status is null or p.status=p_status)
      and coalesce(p.completed_at,p.updated_at,p.created_at)>=(p_month::timestamp at time zone 'Asia/Kuala_Lumpur')
      and coalesce(p.completed_at,p.updated_at,p.created_at)<((p_month+interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')
    order by history_at desc,p.id desc offset p_offset limit p_limit+1) page;
  return jsonb_build_object('rows',v_rows,'has_more',jsonb_array_length(v_rows)>p_limit);
end; $$;

create function public.crew_inventory_stock_check_history(
  p_token text, p_outlet_id uuid default null, p_month date default null,
  p_status text default null, p_offset integer default 0, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb := inventory_authority.crew_scope(p_token,p_outlet_id,'stock_read');
  v_outlet uuid := (v_context->>'outlet_id')::uuid;
  v_today date := timezone('Asia/Kuala_Lumpur',now())::date;
  v_month date := date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))::date;
  v_rows jsonb;
begin
  if p_month is null then p_month := v_month; end if;
  if p_month not in (v_month,(v_month-interval '1 month')::date)
    or p_status not in ('completed','missed','skipped') and p_status is not null
    or p_offset < 0 or p_limit < 1 or p_limit > 50 then
    raise exception using errcode='22023',message='Invalid Crew history selection.';
  end if;
  with checks as (
    select c.*, g.name group_name,
      case when c.status='submitted' then 'completed'
        when c.status='skipped' then 'skipped' else 'missed' end history_status,
      case when c.status='submitted' then c.submitted_at
        when c.status='skipped' then c.skipped_at
        else (c.check_date::timestamp at time zone 'Asia/Kuala_Lumpur') end history_at,
      row_number() over (partition by c.group_id,c.check_date,c.shift
        order by case c.status when 'submitted' then 0 when 'skipped' then 1 else 2 end,
          c.updated_at desc,c.id) occurrence_rank
    from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
    where c.outlet_id=v_outlet
      and (c.status in ('submitted','skipped') or c.status='draft' and c.check_date<v_today)
      and coalesce(c.submitted_at,c.skipped_at,(c.check_date::timestamp at time zone 'Asia/Kuala_Lumpur'))>=
        (p_month::timestamp at time zone 'Asia/Kuala_Lumpur')
      and coalesce(c.submitted_at,c.skipped_at,(c.check_date::timestamp at time zone 'Asia/Kuala_Lumpur'))<
        ((p_month+interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')
      and ((c.stock_check_type='scheduled' and coalesce((v_context->>'can_perform_stock_check')::boolean,false))
        or (c.stock_check_type='audit' and coalesce((v_context->>'can_create_audit_stock_check')::boolean,false)))
  ), history as (
    select c.id,c.history_at,c.history_status,c.stock_check_type type,c.group_id,c.check_date,c.shift,
      coalesce(c.audit_name,c.check_name,c.group_name) name,c.audit_type,
      (select ci.item_id from public.inventory_stock_check_items ci where ci.stock_check_id=c.id order by ci.id limit 1) cover_item_id,
      (select count(*) from public.inventory_stock_check_items ci where ci.stock_check_id=c.id) item_count
    from checks c where (c.stock_check_type='audit' or c.occurrence_rank=1)
    union all
    select null::uuid,(day.run_date::timestamp at time zone 'Asia/Kuala_Lumpur'),'missed','scheduled',g.id,day.run_date,g.shift,
      g.name,null::text,null::uuid,null::bigint
    from public.inventory_stock_check_groups g
    cross join lateral (select series::date run_date from generate_series(
      greatest(p_month,(v_today-7)::date)::timestamp,
      least((p_month+interval '1 month'-interval '1 day')::date,(v_today-1)::date)::timestamp,
      interval '1 day') series) day
    where g.outlet_id=v_outlet and coalesce((v_context->>'can_perform_stock_check')::boolean,false)
      and day.run_date>=timezone('Asia/Kuala_Lumpur',g.created_at)::date
      and inventory_authority.stock_group_due(g,day.run_date)
      and not exists(select 1 from public.inventory_stock_checks c where c.group_id=g.id
        and c.outlet_id=v_outlet and c.check_date=day.run_date and c.stock_check_type='scheduled')
  )
  select coalesce(jsonb_agg(row_data order by history_at desc,sort_id desc),'[]'::jsonb) into v_rows
  from (select h.history_at,coalesce(h.id,h.group_id) sort_id,
      jsonb_build_object('id',h.id,'type',h.type,'status',h.history_status,'name',h.name,
        'group_id',h.group_id,'check_date',h.check_date,'shift',h.shift,'audit_type',h.audit_type,
        'cover_item_id',h.cover_item_id,'item_count',h.item_count) row_data
    from history h where h.history_at>=(p_month::timestamp at time zone 'Asia/Kuala_Lumpur') and h.history_at<((p_month+interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')
      and (p_status is null or h.history_status=p_status)
    order by h.history_at desc,sort_id desc offset p_offset limit p_limit+1) page;
  return jsonb_build_object('rows',v_rows,'has_more',jsonb_array_length(v_rows)>p_limit);
end; $$;

revoke all on function public.crew_inventory_purchase_order_history(text,uuid,date,text,integer,integer),
  public.crew_inventory_stock_check_history(text,uuid,date,text,integer,integer) from public,anon,authenticated;
grant execute on function public.crew_inventory_purchase_order_history(text,uuid,date,text,integer,integer),
  public.crew_inventory_stock_check_history(text,uuid,date,text,integer,integer) to anon,authenticated;

-- Existing list gateways now serve active work and only recent Crew detail.
create or replace function public.crew_inventory_purchase_orders(p_token text,p_outlet_id uuid default null,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'order_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid; v_order public.inventory_purchase_orders%rowtype;
  v_detail jsonb;
begin
  if p_order_id is not null then
    select * into v_order from public.inventory_purchase_orders where id=p_order_id and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Purchase order is unavailable for this outlet.'; end if;
    if v_order.status in ('completed','fully_received','cancelled') and
      coalesce(v_order.completed_at,v_order.updated_at,v_order.created_at)<
        (date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))-interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur' then
      raise exception using errcode='42501',message='Purchase order is outside Crew history.';
    end if;
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
          and p.status not in ('completed','fully_received','cancelled')
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
    if (v_check.status in ('submitted','skipped') or v_check.stock_check_type='scheduled' and v_check.check_date<v_today)
      and coalesce(v_check.submitted_at,v_check.skipped_at,(v_check.check_date::timestamp at time zone 'Asia/Kuala_Lumpur'))<
        (date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))-interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur' then
      raise exception using errcode='42501',message='Stock check is outside Crew history.';
    end if;
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
            then (c.check_date::timestamp at time zone 'Asia/Kuala_Lumpur') else coalesce(c.submitted_at,c.skipped_at,c.updated_at) end sort_at
        from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
        where c.outlet_id=v_outlet and c.status='draft' and (c.stock_check_type='audit' or c.check_date>=v_today)
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
          (day.run_date::timestamp at time zone 'Asia/Kuala_Lumpur') sort_at
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

-- Source-linked PO identity for a completed check result; no broad terminal list needed.
create function public.crew_inventory_purchase_orders_for_check(
  p_token text, p_outlet_id uuid, p_check_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb := inventory_authority.crew_scope(p_token,p_outlet_id,'order_read');
  v_outlet uuid := (v_context->>'outlet_id')::uuid;
  v_floor timestamptz := (date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))-interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur';
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,
    'supplier_id',p.supplier_id,'business_po_no',p.business_po_no) order by p.created_at desc,p.id desc)
    from (select p.id,p.status,p.supplier_id,p.business_po_no,p.created_at
      from public.inventory_purchase_orders p
      where p.outlet_id=v_outlet and p.source_stock_check_id=p_check_id and p.status<>'cancelled'
        and (p.status not in ('completed','fully_received') or coalesce(p.completed_at,p.updated_at,p.created_at)>=v_floor)
      order by p.created_at desc,p.id desc limit 50) p),'[]'::jsonb);
end; $$;
revoke all on function public.crew_inventory_purchase_orders_for_check(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_inventory_purchase_orders_for_check(text,uuid,uuid) to anon,authenticated;
