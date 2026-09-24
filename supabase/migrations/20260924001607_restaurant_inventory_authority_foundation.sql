-- Restaurant Inventory authority foundation. Existing Admin signatures remain stable;
-- future Crew wrappers may call only the private, actor-explicit cores after token validation.
create schema if not exists inventory_authority;
revoke all on schema inventory_authority from public, anon, authenticated;

alter table public.inventory_lifecycle_requests
  add column if not exists actor_employee_id uuid references public.employees(id) on delete restrict,
  add column if not exists actor_kind text not null default 'admin',
  add column if not exists payload_fingerprint text;
alter table public.inventory_lifecycle_requests alter column actor_id drop not null;
alter table public.inventory_lifecycle_requests drop constraint if exists inventory_lifecycle_requests_actor_check;
alter table public.inventory_lifecycle_requests add constraint inventory_lifecycle_requests_actor_check
  check ((actor_kind = 'admin' and actor_id is not null)
    or (actor_kind = 'crew' and actor_employee_id is not null and actor_id is null));
alter table public.inventory_lifecycle_requests drop constraint if exists inventory_lifecycle_requests_operation_check;
alter table public.inventory_lifecycle_requests add constraint inventory_lifecycle_requests_operation_check
  check (operation in ('purchase_receipt','waste','transfer','stock_check','purchase_order',
    'manual_movement','recipe','stock_check_draft_delete','purchase_order_transition',
    'stock_check_purchase_orders'));

alter table public.inventory_purchase_receipts
  add column if not exists received_by_employee_id uuid references public.employees(id) on delete restrict;
alter table public.inventory_movements
  add column if not exists created_by_employee_id uuid references public.employees(id) on delete restrict;
alter table public.inventory_purchase_orders
  add column if not exists created_by_employee_id uuid references public.employees(id) on delete restrict;
alter table public.inventory_stock_checks
  add column if not exists created_by_employee_id uuid references public.employees(id) on delete restrict;

-- A completed count and its evidence cannot be changed by another RPC or a direct
-- table write. Draft deletion and draft row replacement remain possible.
create or replace function inventory_authority.protect_completed_stock_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'submitted' then
    raise exception 'Completed stock checks are immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

-- PO drafts from a stock check are serialized on the source check, including
-- separate supplier POs in one source. Cancelled historical POs do not block
-- an authorized replacement; active source lines and supplier pairs do.
create or replace function inventory_authority.save_purchase_order(
  p_request_id uuid,p_order jsonb,p_items jsonb,p_scope_outlet uuid,
  p_actor_user uuid,p_actor_employee uuid,p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
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
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint)
    values(p_request_id,'purchase_order',p_actor_user,p_actor_employee,p_actor_kind,v_outlet,v_result,v_fingerprint);
  if v_id is null then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_draft_created','inventory',p_actor_user,'Purchase order draft created.',
      jsonb_build_object('purchase_order_id',v_order.id,'outlet_id',v_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  end if;
  return v_result;
end; $$;

create or replace function public.inventory_save_purchase_order(p_request_id uuid,p_order jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_outlet uuid:=nullif(p_order->>'outlet_id','')::uuid;
  v_id uuid:=nullif(p_order->>'id','')::uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if v_id is null and not public.current_user_has_permission('inventory_orders.create') then
    raise exception using errcode='42501',message='Missing permission to create purchase orders.';
  end if;
  if v_id is not null and not public.current_user_has_permission('inventory_orders.edit') then
    raise exception using errcode='42501',message='Missing permission to edit purchase orders.';
  end if;
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='You cannot save purchase orders for this outlet.';
  end if;
  select id into v_employee from public.employees where auth_user_id=v_actor order by id limit 1;
  return inventory_authority.save_purchase_order(p_request_id,p_order,p_items,v_outlet,v_actor,v_employee,'admin');
end; $$;
create or replace function inventory_authority.protect_completed_stock_check_item()
returns trigger language plpgsql set search_path = '' as $$
declare v_check_id uuid;
begin
  v_check_id := case when tg_op = 'DELETE' then old.stock_check_id else new.stock_check_id end;
  if exists (select 1 from public.inventory_stock_checks where id = v_check_id and status = 'submitted') then
    raise exception 'Completed stock check evidence is immutable.';
  end if;
  if tg_op = 'UPDATE' and old.stock_check_id is distinct from new.stock_check_id
    and exists (select 1 from public.inventory_stock_checks where id = old.stock_check_id and status = 'submitted') then
    raise exception 'Completed stock check evidence is immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;
drop trigger if exists inventory_completed_stock_check_guard on public.inventory_stock_checks;
create trigger inventory_completed_stock_check_guard before update or delete on public.inventory_stock_checks
  for each row execute function inventory_authority.protect_completed_stock_check();
drop trigger if exists inventory_completed_stock_check_item_guard on public.inventory_stock_check_items;
create trigger inventory_completed_stock_check_item_guard before insert or update or delete on public.inventory_stock_check_items
  for each row execute function inventory_authority.protect_completed_stock_check_item();

-- Purely private transaction helper; the public wrappers own caller authentication.
create or replace function inventory_authority.save_stock_check(
  p_request_id uuid, p_check jsonb, p_items jsonb, p_scope_outlet uuid,
  p_actor_user uuid, p_actor_employee uuid, p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_existing public.inventory_stock_checks%rowtype;
  v_row jsonb;
  v_result jsonb;
  v_now timestamptz := now();
  v_status text := coalesce(p_check->>'status','draft');
  v_type text := coalesce(p_check->>'stock_check_type','scheduled');
  v_outlet uuid := nullif(p_check->>'outlet_id','')::uuid;
  v_group uuid := nullif(p_check->>'group_id','')::uuid;
  v_id uuid := nullif(p_check->>'id','')::uuid;
  v_date date := nullif(p_check->>'check_date','')::date;
  v_fingerprint text := md5(jsonb_build_object('check',p_check,'items',p_items)::text);
  v_legacy_item_ids uuid[]:='{}';
begin
  if p_request_id is null or v_outlet is null or v_outlet is distinct from p_scope_outlet or v_date is null then
    raise exception 'Request, outlet and stock check date are required.';
  end if;
  if v_type not in ('scheduled','audit') or v_status not in ('draft','submitted') then
    raise exception 'Invalid stock check type or status.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Stock check items are required.'; end if;
  if v_type = 'scheduled' then
    if v_group is null or not exists (select 1 from public.inventory_stock_check_groups where id=v_group and outlet_id=v_outlet) then
      raise exception 'Stock check group does not belong to this outlet.';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests
    where request_id=p_request_id and operation='stock_check'
      and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists (select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  if v_type='scheduled' and v_id is null then
    perform pg_advisory_xact_lock(hashtext('inventory_stock_check_run_'||v_group::text||v_date::text||coalesce(p_check->>'shift','')));
    if exists(select 1 from public.inventory_stock_checks where group_id=v_group and check_date=v_date
      and shift is not distinct from nullif(p_check->>'shift','')) then
      raise exception 'A stock check already exists for this scheduled run.';
    end if;
  end if;
  if v_id is not null then
    select * into v_existing from public.inventory_stock_checks where id=v_id for update;
    if not found then raise exception 'Stock check was not found.'; end if;
    if v_existing.status <> 'draft' then raise exception 'Completed stock checks are immutable.'; end if;
    if v_existing.outlet_id is distinct from v_outlet or v_existing.stock_check_type <> v_type then
      raise exception 'The stock check outlet and type cannot change.';
    end if;
    select coalesce(array_agg(distinct item_id),'{}') into v_legacy_item_ids
      from public.inventory_stock_check_items where stock_check_id=v_id and item_id is not null;
    delete from public.inventory_stock_check_items where stock_check_id=v_id;
    update public.inventory_stock_checks set group_id=case when v_type='audit' then null else v_group end,
      check_name=nullif(p_check->>'check_name',''), shift=nullif(p_check->>'shift',''), check_date=v_date,
      audit_type=case when v_type='audit' then nullif(p_check->>'audit_type','') else null end,
      audit_name=case when v_type='audit' then nullif(p_check->>'audit_name','') else null end,
      audit_category_ids=case when v_type='audit' then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      notes=nullif(p_check->>'notes',''), updated_at=v_now
      where id=v_id returning * into v_check;
  else
    insert into public.inventory_stock_checks(outlet_id,group_id,stock_check_type,check_name,shift,check_date,
      audit_type,audit_name,audit_category_ids,notes,status,created_by,created_by_employee_id,created_at,updated_at)
    values(v_outlet,case when v_type='audit' then null else v_group end,v_type,
      nullif(p_check->>'check_name',''),nullif(p_check->>'shift',''),v_date,
      case when v_type='audit' then nullif(p_check->>'audit_type','') else null end,
      case when v_type='audit' then nullif(p_check->>'audit_name','') else null end,
      case when v_type='audit' then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      nullif(p_check->>'notes',''),'draft',p_actor_user,p_actor_employee,v_now,v_now) returning * into v_check;
  end if;
  for v_row in select value from jsonb_array_elements(p_items) loop
    if nullif(v_row->>'item_id','') is null then raise exception 'Stock check item is required.'; end if;
    if not exists (select 1 from public.inventory_item_outlets where outlet_id=v_outlet and inventory_item_id=(v_row->>'item_id')::uuid)
      and not ((v_row->>'item_id')::uuid=any(v_legacy_item_ids)) then
      raise exception 'Stock check item does not belong to this outlet.';
    end if;
    insert into public.inventory_stock_check_items(stock_check_id,item_id,category_id,par_level_quantity,actual_count_quantity,
      variance,unit,status,notes,skipped,skip_reason,created_at,updated_at)
    values(v_check.id,(v_row->>'item_id')::uuid,nullif(v_row->>'category_id','')::uuid,nullif(v_row->>'par_level_quantity','')::numeric,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'actual_missing')::boolean,false) then null else nullif(v_row->>'actual_count_quantity','')::numeric end,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'na')::boolean,false) then null else coalesce(nullif(v_row->>'variance','')::numeric,0) end,
      nullif(v_row->>'unit',''),coalesce(nullif(v_row->>'status',''),'normal'),nullif(v_row->>'notes',''),
      coalesce((v_row->>'skipped')::boolean,false),case when coalesce((v_row->>'skipped')::boolean,false) then nullif(v_row->>'skip_reason','') else null end,v_now,v_now);
  end loop;
  if v_status='submitted' then
    update public.inventory_stock_checks set status='submitted',submitted_at=v_now,submitted_by=p_actor_employee,updated_at=v_now
      where id=v_check.id returning * into v_check;
    if v_type='scheduled' then
      update public.inventory_stock_check_groups set last_checked_at=v_now,updated_at=v_now where id=v_group;
    end if;
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_stock_check_completed','inventory',p_actor_user,'Stock check completed.',
      jsonb_build_object('stock_check_id',v_check.id,'outlet_id',v_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  end if;
  v_result:=jsonb_build_object('check',to_jsonb(v_check),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at)
    from public.inventory_stock_check_items i where i.stock_check_id=v_check.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint)
    values(p_request_id,'stock_check',p_actor_user,p_actor_employee,p_actor_kind,v_outlet,v_result,v_fingerprint);
  return v_result;
end; $$;

create or replace function public.inventory_save_stock_check(p_request_id uuid,p_check jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_outlet uuid:=nullif(p_check->>'outlet_id','')::uuid;
  v_status text:=coalesce(p_check->>'status','draft');
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if v_status='submitted' and not public.current_user_has_permission('inventory_stock_check.create') then
    raise exception using errcode='42501',message='Missing permission to submit stock checks.';
  end if;
  if v_status='draft' and not (public.current_user_has_permission('inventory_stock_check.create')
    or public.current_user_has_permission('inventory_stock_check.edit')) then
    raise exception using errcode='42501',message='Missing permission to save stock check drafts.';
  end if;
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='You cannot save stock checks for this outlet.';
  end if;
  select id into v_employee from public.employees where auth_user_id=v_actor order by id limit 1;
  return inventory_authority.save_stock_check(p_request_id,p_check,p_items,v_outlet,v_actor,v_employee,'admin');
end; $$;

create or replace function inventory_authority.delete_stock_check_draft(
  p_request_id uuid,p_check_id uuid,p_scope_outlet uuid,p_actor_user uuid,p_actor_employee uuid,p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare v_check public.inventory_stock_checks%rowtype; v_result jsonb;
begin
  if p_request_id is null or p_check_id is null then raise exception 'Request and stock check are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='stock_check_draft_delete';
  if found then
    if v_result->>'stock_check_id' <> p_check_id::text then raise exception 'Request ID was already used for another stock check.'; end if;
    return v_result;
  end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  select * into v_check from public.inventory_stock_checks where id=p_check_id for update;
  if not found then raise exception 'Stock check was not found.'; end if;
  if v_check.outlet_id is distinct from p_scope_outlet then raise exception using errcode='42501',message='Stock check outlet is not authorized.'; end if;
  if v_check.status <> 'draft' or v_check.stock_check_type <> 'audit' then raise exception 'Only draft audit stock checks can be deleted.'; end if;
  delete from public.inventory_stock_check_items where stock_check_id=p_check_id;
  delete from public.inventory_stock_checks where id=p_check_id;
  v_result:=jsonb_build_object('stock_check_id',p_check_id,'deleted',true);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint)
    values(p_request_id,'stock_check_draft_delete',p_actor_user,p_actor_employee,p_actor_kind,p_scope_outlet,v_result,md5(p_check_id::text));
  insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_stock_check_draft_deleted','inventory',p_actor_user,'Audit stock check draft deleted.',
      jsonb_build_object('stock_check_id',p_check_id,'outlet_id',p_scope_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  return v_result;
end; $$;

create or replace function public.inventory_delete_stock_check_draft(p_check_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_outlet uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not (public.current_user_has_permission('inventory_stock_check.audit')
    or public.current_user_has_permission('inventory_stock_check.edit')) then
    raise exception using errcode='42501',message='Missing permission to delete an audit draft.';
  end if;
  select outlet_id into v_outlet from public.inventory_stock_checks where id=p_check_id;
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='You cannot delete this stock check draft.';
  end if;
  select id into v_employee from public.employees where auth_user_id=v_actor order by id limit 1;
  return inventory_authority.delete_stock_check_draft(p_request_id,p_check_id,v_outlet,v_actor,v_employee,'admin');
end; $$;

create or replace function inventory_authority.transition_purchase_order(
  p_order_id uuid,p_request_id uuid,p_action text,p_reason text,p_scope_outlet uuid,
  p_actor_user uuid,p_actor_employee uuid,p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare v_order public.inventory_purchase_orders%rowtype; v_result jsonb; v_now timestamptz:=now();
  v_remaining numeric; v_fingerprint text:=md5(jsonb_build_object('order_id',p_order_id,'action',p_action,'reason',coalesce(p_reason,''))::text);
begin
  if p_order_id is null or p_request_id is null or p_action not in ('submit','confirm','cancel','complete') then
    raise exception 'Purchase order, request and valid action are required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id
    and operation='purchase_order_transition' and payload_fingerprint=v_fingerprint;
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  select * into v_order from public.inventory_purchase_orders where id=p_order_id for update;
  if not found then raise exception 'Purchase order was not found.'; end if;
  if v_order.outlet_id is distinct from p_scope_outlet then
    raise exception using errcode='42501',message='Purchase order outlet is not authorized.';
  end if;
  if p_action='submit' then
    if v_order.status<>'draft' then raise exception 'Only Draft purchase orders can be submitted.'; end if;
    if not exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=p_order_id) then
      raise exception 'Purchase order requires items before submission.';
    end if;
    update public.inventory_purchase_orders set status='submitted',submitted_at=v_now,updated_at=v_now
      where id=p_order_id returning * into v_order;
  elsif p_action='confirm' then
    if v_order.status<>'submitted' then raise exception 'Only Submitted purchase orders can be supplier confirmed.'; end if;
    update public.inventory_purchase_orders set status='supplier_confirmed',confirmed_at=v_now,updated_at=v_now
      where id=p_order_id returning * into v_order;
  elsif p_action='cancel' then
    if v_order.status not in ('draft','submitted','supplier_confirmed') then raise exception 'Purchase order cannot be cancelled in this state.'; end if;
    if exists(select 1 from public.inventory_purchase_receipts where purchase_order_id=p_order_id)
      or exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=p_order_id and received_qty>0) then
      raise exception 'PO cannot be cancelled after receiving has started.';
    end if;
    update public.inventory_purchase_orders set status='cancelled',cancelled_at=v_now,
      cancellation_reason=nullif(btrim(p_reason),''),updated_at=v_now where id=p_order_id returning * into v_order;
  else
    if v_order.status not in ('partial_received','fully_received') then
      raise exception 'Only received purchase orders can be completed.';
    end if;
    select coalesce(sum(greatest(requested_qty-received_qty,0)),0) into v_remaining
      from public.inventory_purchase_order_items where purchase_order_id=p_order_id;
    if v_remaining>0 and nullif(btrim(p_reason),'') is null then
      raise exception 'Completion reason is required for partially fulfilled POs.';
    end if;
    update public.inventory_purchase_orders set status='completed',completed_at=v_now,
      completion_type=case when v_remaining>0 then 'partial' else 'full' end,
      completion_reason=nullif(btrim(p_reason),''),unfulfilled_qty=v_remaining,updated_at=v_now
      where id=p_order_id returning * into v_order;
  end if;
  v_result:=jsonb_build_object('order',to_jsonb(v_order));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint)
    values(p_request_id,'purchase_order_transition',p_actor_user,p_actor_employee,p_actor_kind,p_scope_outlet,v_result,v_fingerprint);
  insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_'||p_action,'inventory',p_actor_user,'Purchase order '||p_action||' recorded.',
      jsonb_build_object('purchase_order_id',p_order_id,'outlet_id',p_scope_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id,'status',v_order.status,'reason',nullif(btrim(p_reason),'')));
  return v_result;
end; $$;

create or replace function public.inventory_transition_purchase_order(
  p_order_id uuid,p_request_id uuid,p_action text,p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_outlet uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if p_action in ('submit','confirm') and not public.current_user_has_permission('inventory_orders.submit') then
    raise exception using errcode='42501',message='Missing permission to submit or confirm purchase orders.';
  elsif p_action='cancel' and not public.current_user_has_permission('inventory_orders.cancel') then
    raise exception using errcode='42501',message='Missing permission to cancel purchase orders.';
  elsif p_action='complete' and not public.current_user_has_permission('inventory_orders.complete') then
    raise exception using errcode='42501',message='Missing permission to complete purchase orders.';
  elsif p_action not in ('submit','confirm','cancel','complete') then
    raise exception 'Invalid purchase order action.';
  end if;
  select outlet_id into v_outlet from public.inventory_purchase_orders where id=p_order_id;
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='You cannot change this purchase order.';
  end if;
  select id into v_employee from public.employees where auth_user_id=v_actor order by id limit 1;
  return inventory_authority.transition_purchase_order(p_order_id,p_request_id,p_action,p_reason,v_outlet,v_actor,v_employee,'admin');
end; $$;

-- One request creates all supplier drafts atomically. The private save core
-- validates each line against the completed check and supplier relationship.
create or replace function inventory_authority.create_stock_check_purchase_orders(
  p_request_id uuid,p_check_id uuid,p_orders jsonb,p_scope_outlet uuid,
  p_actor_user uuid,p_actor_employee uuid,p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare v_check public.inventory_stock_checks%rowtype; v_order jsonb; v_saved jsonb;
  v_result jsonb:='[]'::jsonb; v_prior jsonb;
  v_fingerprint text:=md5(jsonb_build_object('check_id',p_check_id,'orders',p_orders)::text);
begin
  if p_request_id is null or p_check_id is null or p_orders is null
    or jsonb_typeof(p_orders)<>'array' or jsonb_array_length(p_orders)=0 then
    raise exception 'Stock check, request and supplier purchase orders are required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_prior from public.inventory_lifecycle_requests where request_id=p_request_id
    and operation='stock_check_purchase_orders' and payload_fingerprint=v_fingerprint;
  if found then return v_prior; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_stock_check_po_'||p_check_id::text));
  select * into v_check from public.inventory_stock_checks where id=p_check_id;
  if not found or v_check.outlet_id is distinct from p_scope_outlet or v_check.stock_check_type<>'scheduled'
    or v_check.status<>'submitted' then
    raise exception 'Only a completed scheduled stock check for this outlet can create purchase orders.';
  end if;
  for v_order in select value from jsonb_array_elements(p_orders) loop
    if nullif(v_order->>'source_stock_check_id','')::uuid is distinct from p_check_id
      or v_order->>'source_type' is distinct from 'stock_check'
      or nullif(v_order->>'outlet_id','')::uuid is distinct from p_scope_outlet then
      raise exception 'Purchase order source or outlet does not match the stock check.';
    end if;
    v_saved:=inventory_authority.save_purchase_order(gen_random_uuid(),v_order,coalesce(v_order->'lines','[]'::jsonb),
      p_scope_outlet,p_actor_user,p_actor_employee,p_actor_kind);
    v_result:=v_result||jsonb_build_array(v_saved);
  end loop;
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint)
    values(p_request_id,'stock_check_purchase_orders',p_actor_user,p_actor_employee,p_actor_kind,p_scope_outlet,v_result,v_fingerprint);
  return v_result;
end; $$;

create or replace function public.inventory_create_stock_check_purchase_orders(
  p_request_id uuid,p_check_id uuid,p_orders jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_outlet uuid;
begin
  if v_actor is null or not public.current_user_has_permission('inventory_orders.create') then
    raise exception using errcode='42501',message='Missing permission to create purchase orders.';
  end if;
  select outlet_id into v_outlet from public.inventory_stock_checks where id=p_check_id;
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='You cannot create orders for this stock check.';
  end if;
  select id into v_employee from public.employees where auth_user_id=v_actor order by id limit 1;
  return inventory_authority.create_stock_check_purchase_orders(p_request_id,p_check_id,p_orders,v_outlet,v_actor,v_employee,'admin');
end; $$;

create or replace function inventory_authority.receive_purchase_order(
  p_purchase_order_id uuid,p_request_id uuid,p_remark text,p_items jsonb,p_scope_outlet uuid,
  p_actor_user uuid,p_actor_employee uuid,p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_line public.inventory_purchase_order_items%rowtype;
  v_item jsonb; v_receipt public.inventory_purchase_receipts%rowtype;
  v_qty numeric; v_now timestamptz:=now(); v_status text; v_result jsonb;
  v_fingerprint text:=md5(jsonb_build_object('order_id',p_purchase_order_id,'remark',p_remark,'items',p_items)::text);
begin
  if p_request_id is null or p_purchase_order_id is null then raise exception 'Purchase order and request ID are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id
    and operation='purchase_receipt' and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  select * into v_order from public.inventory_purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order was not found.'; end if;
  if v_order.outlet_id is distinct from p_scope_outlet then
    raise exception using errcode='42501',message='Purchase order outlet is not authorized.';
  end if;
  if v_order.status not in ('submitted','supplier_confirmed','partial_received') then
    raise exception 'Purchase order is not open for receiving.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Enter received quantity for at least one item.';
  end if;
  insert into public.inventory_purchase_receipts(purchase_order_id,outlet_id,supplier_id,received_by,
    received_by_employee_id,received_at,remark,created_at)
  values(v_order.id,v_order.outlet_id,v_order.supplier_id,p_actor_user,p_actor_employee,v_now,nullif(btrim(p_remark),''),v_now)
  returning * into v_receipt;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty:=nullif(v_item->>'received_qty','')::numeric;
    if v_qty is null or v_qty<=0 then raise exception 'Received quantity must be greater than zero.'; end if;
    select * into v_line from public.inventory_purchase_order_items
      where id=(v_item->>'purchase_order_item_id')::uuid and purchase_order_id=v_order.id for update;
    if not found or v_line.item_id is distinct from (v_item->>'item_id')::uuid then
      raise exception 'Receipt item does not belong to this purchase order.';
    end if;
    if v_qty>v_line.requested_qty-v_line.received_qty then raise exception 'Receive quantity cannot exceed remaining quantity.'; end if;
    insert into public.inventory_purchase_receipt_items(receipt_id,purchase_order_item_id,item_id,received_qty,unit,remark,created_at)
    values(v_receipt.id,v_line.id,v_line.item_id,v_qty,coalesce(nullif(v_item->>'unit',''),v_line.unit),
      nullif(v_item->>'remark',''),v_now);
    update public.inventory_purchase_order_items set received_qty=received_qty+v_qty,updated_at=v_now where id=v_line.id;
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,
      reference_id,reference_no,notes,created_by,created_by_employee_id,created_at)
    values(v_order.outlet_id,v_line.item_id,'Purchase',v_qty,coalesce(nullif(v_item->>'unit',''),v_line.unit),
      'purchase_order',v_order.id,v_order.po_no,
      coalesce(nullif(v_item->>'remark',''),nullif(btrim(p_remark),''),'Purchase receive'),
      p_actor_user,p_actor_employee,v_now);
  end loop;
  select case when bool_and(received_qty>=requested_qty) then 'fully_received' else 'partial_received' end
    into v_status from public.inventory_purchase_order_items where purchase_order_id=v_order.id;
  update public.inventory_purchase_orders set status=v_status,updated_at=v_now where id=v_order.id returning * into v_order;
  v_result:=jsonb_build_object('receipt_id',v_receipt.id,'purchase_order_id',v_order.id,'status',v_order.status);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint)
    values(p_request_id,'purchase_receipt',p_actor_user,p_actor_employee,p_actor_kind,v_order.outlet_id,v_result,v_fingerprint);
  insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_received','inventory',p_actor_user,'Purchase order receipt recorded.',
      jsonb_build_object('purchase_order_id',v_order.id,'receipt_id',v_receipt.id,'outlet_id',v_order.outlet_id,
        'actor_kind',p_actor_kind,'actor_employee_id',p_actor_employee,'request_id',p_request_id,'status',v_status));
  return v_result;
end; $$;

create or replace function public.inventory_receive_purchase_order(
  p_purchase_order_id uuid,p_request_id uuid,p_remark text,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_outlet uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not public.current_user_has_permission('inventory_orders.receive') then
    raise exception using errcode='42501',message='Missing permission to receive purchase orders.';
  end if;
  select outlet_id into v_outlet from public.inventory_purchase_orders where id=p_purchase_order_id;
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='You cannot receive for this outlet.';
  end if;
  select id into v_employee from public.employees where auth_user_id=v_actor order by id limit 1;
  return inventory_authority.receive_purchase_order(p_purchase_order_id,p_request_id,p_remark,p_items,
    v_outlet,v_actor,v_employee,'admin');
end; $$;

-- Clients retain outlet-scoped SELECT under existing RLS. Lifecycle writes
-- travel only through the authorized wrappers above.
revoke insert,update,delete on public.inventory_stock_checks,public.inventory_stock_check_items,
  public.inventory_purchase_orders,public.inventory_purchase_order_items,
  public.inventory_purchase_receipts,public.inventory_purchase_receipt_items from authenticated;

revoke all on function inventory_authority.protect_completed_stock_check(),
  inventory_authority.protect_completed_stock_check_item(),
  inventory_authority.save_stock_check(uuid,jsonb,jsonb,uuid,uuid,uuid,text),
  inventory_authority.delete_stock_check_draft(uuid,uuid,uuid,uuid,uuid,text),
  inventory_authority.save_purchase_order(uuid,jsonb,jsonb,uuid,uuid,uuid,text),
  inventory_authority.transition_purchase_order(uuid,uuid,text,text,uuid,uuid,uuid,text),
  inventory_authority.create_stock_check_purchase_orders(uuid,uuid,jsonb,uuid,uuid,uuid,text),
  inventory_authority.receive_purchase_order(uuid,uuid,text,jsonb,uuid,uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.inventory_delete_stock_check_draft(uuid,uuid),
  public.inventory_transition_purchase_order(uuid,uuid,text,text),
  public.inventory_create_stock_check_purchase_orders(uuid,uuid,jsonb) from public,anon;
grant execute on function public.inventory_delete_stock_check_draft(uuid,uuid),
  public.inventory_transition_purchase_order(uuid,uuid,text,text),
  public.inventory_create_stock_check_purchase_orders(uuid,uuid,jsonb) to authenticated;
