-- Scheduled Stock Check state is derived from the outlet business date. A past
-- draft remains historical evidence, but is no longer an executable draft.
alter table public.inventory_stock_checks
  add column skipped_at timestamptz,
  add column skipped_by_employee_id uuid references public.employees(id) on delete set null,
  add column skip_reason text;

alter table public.inventory_stock_checks
  add constraint inventory_stock_checks_skip_reason_check
  check (skip_reason is null or skip_reason in ('stock_sufficient','recently_checked','other'));

alter table public.inventory_lifecycle_requests
  drop constraint inventory_lifecycle_requests_operation_check;
alter table public.inventory_lifecycle_requests
  add constraint inventory_lifecycle_requests_operation_check
  check (operation in ('purchase_receipt','waste','transfer','stock_check','purchase_order',
    'manual_movement','recipe','stock_check_draft_delete','purchase_order_transition',
    'stock_check_purchase_orders','stock_check_skip'));

create or replace function inventory_authority.protect_completed_stock_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('submitted','skipped') then
    raise exception 'Completed or skipped stock checks are immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create or replace function inventory_authority.protect_completed_stock_check_item()
returns trigger language plpgsql set search_path = '' as $$
declare v_check_id uuid;
begin
  v_check_id := case when tg_op = 'DELETE' then old.stock_check_id else new.stock_check_id end;
  if exists (select 1 from public.inventory_stock_checks where id = v_check_id and status in ('submitted','skipped')) then
    raise exception 'Terminal stock check evidence is immutable.';
  end if;
  if tg_op = 'UPDATE' and old.stock_check_id is distinct from new.stock_check_id
    and exists (select 1 from public.inventory_stock_checks where id = old.stock_check_id and status in ('submitted','skipped')) then
    raise exception 'Terminal stock check evidence is immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create function inventory_authority.guard_scheduled_stock_check_date()
returns trigger language plpgsql set search_path = '' as $$
declare v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_shift text;
begin
  if tg_op = 'UPDATE' and old.stock_check_type = 'scheduled' then
    if old.check_date is distinct from new.check_date or old.group_id is distinct from new.group_id
      or old.shift is distinct from new.shift then
      raise exception 'A scheduled stock check cannot change its occurrence.';
    end if;
  end if;
  if new.stock_check_type = 'scheduled' and new.status in ('draft','submitted','skipped')
    and new.check_date is distinct from v_today then
    raise exception 'A scheduled stock check is no longer due on this business date.';
  end if;
  if tg_op = 'INSERT' and new.stock_check_type = 'scheduled' then
    select g.shift into v_shift from public.inventory_stock_check_groups g
      where g.id=new.group_id and g.outlet_id=new.outlet_id
        and inventory_authority.stock_group_due(g,v_today);
    if not found or new.shift is distinct from v_shift then
      raise exception 'Scheduled stock check does not match a due group and shift.';
    end if;
  end if;
  return new;
end; $$;

create trigger inventory_scheduled_stock_check_date_guard
  before insert or update on public.inventory_stock_checks
  for each row execute function inventory_authority.guard_scheduled_stock_check_date();

create function public.crew_inventory_skip_stock_check(
  p_token text, p_outlet_id uuid, p_request_id uuid, p_group_id uuid, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_scope jsonb := inventory_authority.crew_scope(p_token,p_outlet_id,'can_perform_stock_check');
  v_outlet uuid := (v_scope->>'outlet_id')::uuid;
  v_employee uuid := (v_scope->>'employee_id')::uuid;
  v_today date := timezone('Asia/Kuala_Lumpur',now())::date;
  v_group public.inventory_stock_check_groups%rowtype;
  v_check public.inventory_stock_checks%rowtype;
  v_result jsonb;
  v_fingerprint text := md5(jsonb_build_object('outlet',v_outlet,'group',p_group_id,'reason',p_reason)::text);
begin
  if p_request_id is null or p_group_id is null or (p_reason is not null
    and p_reason not in ('stock_sufficient','recently_checked','other')) then
    raise exception 'A valid request, scheduled group and reason are required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests
    where request_id=p_request_id and operation='stock_check_skip' and payload_fingerprint=v_fingerprint;
  if found then return v_result; end if;
  if exists (select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  select * into v_group from public.inventory_stock_check_groups
    where id=p_group_id and outlet_id=v_outlet;
  if not found or not inventory_authority.stock_group_due(v_group,v_today) then
    raise exception 'This stock check is not due for this outlet.';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_stock_check_run_'||p_group_id::text||v_today::text||coalesce(v_group.shift,'')));
  if exists(select 1 from public.inventory_stock_checks
      where group_id=p_group_id and outlet_id=v_outlet and check_date=v_today
        and stock_check_type='scheduled') then
    raise exception 'Only a Due stock check can be skipped.';
  end if;
  insert into public.inventory_stock_checks(outlet_id,group_id,stock_check_type,check_name,shift,
    check_date,status,skipped_at,skipped_by_employee_id,skip_reason,created_by_employee_id)
  values(v_outlet,p_group_id,'scheduled',v_group.name,v_group.shift,v_today,'skipped',
    now(),v_employee,p_reason,v_employee) returning * into v_check;
  v_result := jsonb_build_object('id',v_check.id,'status','skipped','check_date',v_today,
    'skipped_at',v_check.skipped_at,'skip_reason',v_check.skip_reason);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_employee_id,actor_kind,
    outlet_id,result,payload_fingerprint)
  values(p_request_id,'stock_check_skip',v_employee,'crew',v_outlet,v_result,v_fingerprint);
  insert into public.audit_logs(action,module,user_id,description,metadata)
  values('inventory_stock_check_skipped','inventory',null,'Scheduled stock check skipped.',
    jsonb_build_object('stock_check_id',v_check.id,'outlet_id',v_outlet,'business_date',v_today,
      'actor_employee_id',v_employee,'reason',p_reason,'request_id',p_request_id));
  return v_result;
end; $$;

revoke all on function public.crew_inventory_skip_stock_check(text,uuid,uuid,uuid,text) from public;
grant execute on function public.crew_inventory_skip_stock_check(text,uuid,uuid,uuid,text) to anon,authenticated;
revoke all on function inventory_authority.guard_scheduled_stock_check_date() from public,anon,authenticated;

-- Keep the existing RPC signature. Required is one occurrence per group/date;
-- History includes recent persisted evidence and read-derived missed runs.
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
          and ((c.stock_check_type='scheduled' and coalesce((v_context->>'can_perform_stock_check')::boolean,false))
            or (c.stock_check_type='audit' and coalesce((v_context->>'can_create_audit_stock_check')::boolean,false)))
        union all
        select jsonb_build_object('id',null,'type','scheduled','status','missed',
          'name',g.name,'group_id',g.id,'check_date',day.run_date,'shift',g.shift,
          'item_count',null,'outlet_id',v_outlet) row_data,
          day.run_date::timestamptz sort_at
        from public.inventory_stock_check_groups g
        cross join lateral (select series::date run_date from generate_series(
          (v_today-30)::timestamp,(v_today-1)::timestamp,interval '1 day') series) day
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
