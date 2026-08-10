-- Trusted, atomic inventory lifecycle mutations.  These functions intentionally
-- own the multi-table write boundary; browser code supplies intent only.

create table if not exists public.inventory_lifecycle_requests (
  request_id uuid primary key,
  operation text not null check (operation in ('purchase_receipt', 'waste', 'transfer')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  outlet_id uuid references public.outlets(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table public.inventory_lifecycle_requests from public, anon, authenticated;

create or replace function public.inventory_receive_purchase_order(
  p_purchase_order_id uuid,
  p_request_id uuid,
  p_remark text,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.inventory_purchase_orders%rowtype;
  v_line public.inventory_purchase_order_items%rowtype;
  v_item jsonb;
  v_receipt public.inventory_purchase_receipts%rowtype;
  v_qty numeric;
  v_now timestamptz := now();
  v_status text;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not public.current_user_has_permission('inventory_orders.receive') then raise exception using errcode = '42501', message = 'Missing permission to receive purchase orders.'; end if;
  if p_request_id is null or p_purchase_order_id is null then raise exception 'Purchase order and request ID are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_' || p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id = p_request_id and operation = 'purchase_receipt';
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id = p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  select * into v_order from public.inventory_purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order was not found.'; end if;
  if not public.current_user_can_access_outlet(v_order.outlet_id) then raise exception using errcode = '42501', message = 'You cannot receive for this outlet.'; end if;
  if v_order.status in ('cancelled', 'completed') then raise exception 'Cannot receive a Cancelled or Completed PO.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Enter received quantity for at least one item.'; end if;
  insert into public.inventory_purchase_receipts(purchase_order_id,outlet_id,supplier_id,received_by,received_at,remark,created_at)
  values (v_order.id,v_order.outlet_id,v_order.supplier_id,v_actor,v_now,nullif(btrim(p_remark),''),v_now) returning * into v_receipt;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := nullif(v_item->>'received_qty','')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Received quantity must be greater than zero.'; end if;
    select * into v_line from public.inventory_purchase_order_items where id = (v_item->>'purchase_order_item_id')::uuid and purchase_order_id = v_order.id for update;
    if not found or v_line.item_id <> (v_item->>'item_id')::uuid then raise exception 'Receipt item does not belong to this purchase order.'; end if;
    if v_qty > (v_line.requested_qty - v_line.received_qty) then raise exception 'Receive quantity cannot exceed remaining quantity.'; end if;
    insert into public.inventory_purchase_receipt_items(receipt_id,purchase_order_item_id,item_id,received_qty,unit,remark,created_at)
    values(v_receipt.id,v_line.id,v_line.item_id,v_qty,coalesce(nullif(v_item->>'unit',''),v_line.unit),nullif(v_item->>'remark',''),v_now);
    update public.inventory_purchase_order_items set received_qty = received_qty + v_qty, updated_at = v_now where id = v_line.id;
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,reference_id,reference_no,notes,created_by,created_at)
    values(v_order.outlet_id,v_line.item_id,'Purchase',v_qty,coalesce(nullif(v_item->>'unit',''),v_line.unit),'purchase_order',v_order.id,v_order.po_no,coalesce(nullif(v_item->>'remark',''),nullif(btrim(p_remark),''),'Purchase receive'),v_actor,v_now);
  end loop;
  select case when bool_and(received_qty >= requested_qty) then 'fully_received' else 'partial_received' end into v_status from public.inventory_purchase_order_items where purchase_order_id = v_order.id;
  update public.inventory_purchase_orders set status = v_status, updated_at = v_now where id = v_order.id returning * into v_order;
  v_result := jsonb_build_object('receipt_id',v_receipt.id,'purchase_order_id',v_order.id,'status',v_order.status);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'purchase_receipt',v_actor,v_order.outlet_id,v_result);
  return v_result;
end; $$;

create or replace function public.inventory_save_waste(
  p_request_id uuid, p_outlet_id uuid, p_inventory_item_id uuid, p_waste_type text, p_quantity numeric,
  p_unit text, p_waste_date date, p_notes text, p_photo_url text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_waste public.inventory_waste_records%rowtype; v_movement public.inventory_movements%rowtype; v_result jsonb; v_now timestamptz := now();
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not (public.current_user_has_permission('inventory_waste.create') or public.current_user_has_permission('inventory_waste.manage') or public.current_user_has_permission('inventory_control.manage')) then raise exception using errcode = '42501', message = 'Missing permission to record waste.'; end if;
  if p_request_id is null or p_outlet_id is null or p_inventory_item_id is null or p_quantity is null or p_quantity <= 0 then raise exception 'Request, outlet, item and positive quantity are required.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode = '42501', message = 'You cannot record waste for this outlet.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_' || p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='waste'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  insert into public.inventory_waste_records(outlet_id,inventory_item_id,waste_type,quantity,unit,waste_date,notes,photo_url,created_by,created_at,updated_at)
  values(p_outlet_id,p_inventory_item_id,coalesce(nullif(btrim(p_waste_type),''),'Unknown'),p_quantity,nullif(btrim(p_unit),''),coalesce(p_waste_date,current_date),nullif(btrim(p_notes),''),nullif(btrim(p_photo_url),''),v_actor,v_now,v_now) returning * into v_waste;
  insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,reference_id,reference_no,notes,created_by,created_at)
  values(p_outlet_id,p_inventory_item_id,'Waste',-abs(p_quantity),nullif(btrim(p_unit),''),'waste',v_waste.id,'WASTE-'||upper(left(v_waste.id::text,8)),coalesce(nullif(btrim(p_notes),''),v_waste.waste_type,'Waste recorded'),v_actor,v_now) returning * into v_movement;
  v_result := jsonb_build_object('waste_id',v_waste.id,'movement_id',v_movement.id);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'waste',v_actor,p_outlet_id,v_result);
  return v_result;
end; $$;

create or replace function public.inventory_transfer_inventory(
  p_request_id uuid, p_from_outlet_id uuid, p_to_outlet_id uuid, p_inventory_item_id uuid, p_quantity numeric, p_unit text, p_reference_no text, p_notes text,
  p_outgoing_movement_id uuid default null, p_incoming_movement_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_out public.inventory_movements%rowtype; v_in public.inventory_movements%rowtype; v_result jsonb; v_now timestamptz := now(); v_reference text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if not (public.current_user_has_permission('inventory_movements.create') or public.current_user_has_permission('inventory_control.manage')) then raise exception using errcode = '42501', message = 'Missing permission to create inventory movements.'; end if;
  if p_request_id is null or p_from_outlet_id is null or p_to_outlet_id is null or p_inventory_item_id is null or p_quantity is null or p_quantity <= 0 then raise exception 'Request, source, destination, item and positive quantity are required.'; end if;
  if p_from_outlet_id = p_to_outlet_id then raise exception 'Transfer source and destination must be different.'; end if;
  if not public.current_user_can_access_outlet(p_from_outlet_id) or not public.current_user_can_access_outlet(p_to_outlet_id) then raise exception using errcode = '42501', message = 'You cannot transfer between these outlets.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_' || p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='transfer'; if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  v_reference := coalesce(nullif(btrim(p_reference_no),''),'TRF-' || to_char(v_now,'YYMMDDHH24MISS'));
  if p_outgoing_movement_id is not null then
    select * into v_out from public.inventory_movements where id = p_outgoing_movement_id and reference_type = 'transfer' for update;
    if not found then raise exception 'Outgoing transfer movement was not found.'; end if;
    if p_incoming_movement_id is null then raise exception 'Paired incoming transfer movement is required for an update.'; end if;
    select * into v_in from public.inventory_movements where id = p_incoming_movement_id and reference_type = 'transfer' for update;
    if not found then raise exception 'Incoming transfer movement was not found.'; end if;
    update public.inventory_movements set outlet_id=p_from_outlet_id, inventory_item_id=p_inventory_item_id, movement_type='Transfer Out', quantity=-abs(p_quantity), unit=nullif(btrim(p_unit),''), reference_no=v_reference, notes=nullif(btrim(p_notes),''), created_by=v_actor where id=v_out.id returning * into v_out;
    update public.inventory_movements set outlet_id=p_to_outlet_id, inventory_item_id=p_inventory_item_id, movement_type='Transfer In', quantity=abs(p_quantity), unit=nullif(btrim(p_unit),''), reference_no=v_reference, notes=nullif(btrim(p_notes),''), created_by=v_actor where id=v_in.id returning * into v_in;
  else
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,reference_no,notes,created_by,created_at)
    values(p_from_outlet_id,p_inventory_item_id,'Transfer Out',-abs(p_quantity),nullif(btrim(p_unit),''),'transfer',v_reference,nullif(btrim(p_notes),''),v_actor,v_now) returning * into v_out;
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,reference_no,notes,created_by,created_at)
    values(p_to_outlet_id,p_inventory_item_id,'Transfer In',abs(p_quantity),nullif(btrim(p_unit),''),'transfer',v_reference,nullif(btrim(p_notes),''),v_actor,v_now) returning * into v_in;
  end if;
  v_result := jsonb_build_object('outgoing_movement_id',v_out.id,'incoming_movement_id',v_in.id,'reference_no',v_reference);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,outlet_id,result) values(p_request_id,'transfer',v_actor,p_from_outlet_id,v_result);
  return v_result;
end; $$;

revoke all on function public.inventory_receive_purchase_order(uuid,uuid,text,jsonb) from public, anon;
revoke all on function public.inventory_save_waste(uuid,uuid,uuid,text,numeric,text,date,text,text) from public, anon;
revoke all on function public.inventory_transfer_inventory(uuid,uuid,uuid,uuid,numeric,text,text,text,uuid,uuid) from public, anon;
grant execute on function public.inventory_receive_purchase_order(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.inventory_save_waste(uuid,uuid,uuid,text,numeric,text,date,text,text) to authenticated;
grant execute on function public.inventory_transfer_inventory(uuid,uuid,uuid,uuid,numeric,text,text,text,uuid,uuid) to authenticated;
