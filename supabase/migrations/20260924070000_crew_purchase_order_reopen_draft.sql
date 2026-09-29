-- A submitted PO may return to Draft only before supplier confirmation or receiving.
-- Keep the same PO identity and append a truthful transition event; the prior
-- submission remains in audit history and a later submission creates a new event.
create or replace function inventory_authority.transition_purchase_order(
  p_order_id uuid,p_request_id uuid,p_action text,p_reason text,p_scope_outlet uuid,
  p_actor_user uuid,p_actor_employee uuid,p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare v_order public.inventory_purchase_orders%rowtype; v_result jsonb; v_now timestamptz:=now();
  v_remaining numeric; v_previous_status text; v_previous_submitted_at timestamptz;
  v_fingerprint text:=md5(jsonb_build_object('order_id',p_order_id,'action',p_action,'reason',coalesce(p_reason,''))::text);
begin
  if p_order_id is null or p_request_id is null or p_action not in ('submit','confirm','cancel','complete','reopen_draft') then
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
  v_previous_status:=v_order.status;
  v_previous_submitted_at:=v_order.submitted_at;
  if p_action='submit' then
    if v_order.status<>'draft' then raise exception 'Only Draft purchase orders can be submitted.'; end if;
    if not exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=p_order_id) then
      raise exception 'Purchase order requires items before submission.';
    end if;
    update public.inventory_purchase_orders set status='submitted',submitted_at=v_now,updated_at=v_now
      where id=p_order_id returning * into v_order;
  elsif p_action='reopen_draft' then
    if v_order.status<>'submitted' then raise exception 'Only unconfirmed Submitted purchase orders can return to Draft.'; end if;
    if v_order.confirmed_at is not null or exists(select 1 from public.inventory_purchase_receipts where purchase_order_id=p_order_id)
      or exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=p_order_id and received_qty>0) then
      raise exception 'Purchase order cannot return to Draft after supplier confirmation or receiving.';
    end if;
    update public.inventory_purchase_orders set status='draft',submitted_at=null,updated_at=v_now
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
        'actor_employee_id',p_actor_employee,'request_id',p_request_id,'previous_status',v_previous_status,
        'previous_submitted_at',v_previous_submitted_at,'status',v_order.status,'reason',nullif(btrim(p_reason),'')));
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
  elsif p_action='reopen_draft' and not public.current_user_has_permission('inventory_orders.edit') then
    raise exception using errcode='42501',message='Missing permission to edit purchase orders.';
  elsif p_action='cancel' and not public.current_user_has_permission('inventory_orders.cancel') then
    raise exception using errcode='42501',message='Missing permission to cancel purchase orders.';
  elsif p_action='complete' and not public.current_user_has_permission('inventory_orders.complete') then
    raise exception using errcode='42501',message='Missing permission to complete purchase orders.';
  elsif p_action not in ('submit','confirm','cancel','complete','reopen_draft') then
    raise exception 'Invalid purchase order action.';
  end if;
  select outlet_id into v_outlet from public.inventory_purchase_orders where id=p_order_id;
  if v_outlet is null or not public.current_user_can_access_outlet(v_outlet) then
    raise exception using errcode='42501',message='You cannot change this purchase order.';
  end if;
  select id into v_employee from public.employees where auth_user_id=v_actor order by id limit 1;
  return inventory_authority.transition_purchase_order(p_order_id,p_request_id,p_action,p_reason,v_outlet,v_actor,v_employee,'admin');
end; $$;

create or replace function public.crew_inventory_transition_purchase_order(
  p_token text,p_outlet_id uuid,p_order_id uuid,p_request_id uuid,p_action text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'can_manage_purchase_orders');
begin
  if p_action not in ('submit','confirm','reopen_draft') then
    raise exception using errcode='42501',message='This purchase order action is Admin-only.';
  end if;
  return inventory_authority.transition_purchase_order(p_order_id,p_request_id,p_action,null,
    (v_context->>'outlet_id')::uuid,null,(v_context->>'employee_id')::uuid,'crew');
end; $$;
