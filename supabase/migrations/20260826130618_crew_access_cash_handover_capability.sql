-- Cash Handover initiation is a Crew Access capability.  It deliberately does
-- not use employees.role_id or the Admin RBAC permission graph: Crew sessions
-- are a separate authority surface.
alter table public.crew_access
  add column if not exists can_initiate_handover boolean not null default false;

-- Preserve only the already-effective Crew handover population at cutover.
-- This is a one-time compatibility snapshot: an active Crew Access record,
-- eligible employee, assigned outlet, and the previous record_collection
-- permission were all required.  No Admin role without active Crew Access is
-- granted this Crew capability, and future Admin role edits have no effect.
update public.crew_access ca
set can_initiate_handover = true,
    updated_at = now()
from public.employees e
join public.role_permissions rp on rp.role_id = e.role_id
join public.permissions p on p.id = rp.permission_id
where ca.employee_id = e.id
  and ca.access_state = 'active'
  and ca.primary_outlet_id is not null
  and e.is_active
  and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  and p.code = 'crew_cash_deposit.record_collection';

create or replace function public.crew_can_initiate_cash_handover(
  p_employee_id uuid,
  p_outlet_id uuid
)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.crew_access ca
    join public.employees e on e.id = ca.employee_id
    where ca.employee_id = p_employee_id
      and ca.primary_outlet_id = p_outlet_id
      and ca.access_state = 'active'
      and ca.can_initiate_handover
      and e.is_active
      and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  );
$$;
revoke all on function public.crew_can_initiate_cash_handover(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_update_cash_operations_access(
  p_employee_id uuid,
  p_can_initiate_handover boolean
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_access public.crew_access%rowtype;
  v_before boolean;
begin
  if not public.current_user_has_permission('crew_employees.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to manage Crew Access.';
  end if;

  select * into v_access
  from public.crew_access
  where employee_id = p_employee_id
  for update;

  if v_access.employee_id is null then
    raise exception using errcode = '22023', message = 'Crew Access must be enabled before Cash Operations can be configured.';
  end if;
  if v_access.primary_outlet_id is null or not public.current_user_can_access_outlet(v_access.primary_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot manage Crew Access for an employee assigned to an inaccessible outlet.';
  end if;

  v_before := v_access.can_initiate_handover;
  update public.crew_access
  set can_initiate_handover = coalesce(p_can_initiate_handover, false),
      updated_at = now()
  where employee_id = p_employee_id
  returning * into v_access;

  if v_before is distinct from v_access.can_initiate_handover then
    insert into public.audit_logs(action, module, description, metadata)
    values (
      'crew_access_cash_handover_capability_updated',
      'crew',
      'Crew Cash Handover capability updated.',
      jsonb_build_object(
        'employee_id', p_employee_id,
        'outlet_id', v_access.primary_outlet_id,
        'can_initiate_handover_before', v_before,
        'can_initiate_handover_after', v_access.can_initiate_handover,
        'actor_id', auth.uid()
      )
    );
  end if;

  return jsonb_build_object(
    'employee_id', v_access.employee_id,
    'access_state', v_access.access_state,
    'can_initiate_handover', v_access.can_initiate_handover,
    'updated_at', v_access.updated_at
  );
end;
$$;
revoke all on function public.crew_update_cash_operations_access(uuid,boolean) from public,anon,authenticated;
grant execute on function public.crew_update_cash_operations_access(uuid,boolean) to authenticated;

-- Crew handover submission remains token, outlet, balance, receiver and
-- idempotency-bound.  Only its authorization source changes from Admin RBAC
-- to the canonical Crew Access capability above.
create or replace function public.crew_cash_record_collection(p_token text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; receiver uuid; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype;
begin
 ctx:=public.crew_operations_employee_context(p_token);
 employee:=(ctx->>'employee_id')::uuid;
 outlet:=(ctx->>'outlet_id')::uuid;
 if not public.crew_can_initiate_cash_handover(employee,outlet) then raise exception using errcode='42501',message='You do not have permission to hand over Cash Deposit funds.'; end if;
 receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
 if receiver is null or not public.crew_cash_receiver_is_eligible(outlet,receiver) then raise exception using errcode='42501',message='Receiver is not approved for this outlet.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_balance(outlet) then raise exception using errcode='22023',message='Amount must not exceed the Cash Deposit Balance.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',outlet,'receiver_employee_id',receiver,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext(outlet::text),hashtext(request::text));
 select * into row from public.crew_cash_collections c where c.outlet_id=outlet and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Idempotency conflict: request_id payload differs.'; end if; return to_jsonb(row); end if;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,amount,difference,purpose,note,status,handed_over_by_employee_id)
 values(outlet,request,fingerprint,'internal',receiver,amount,0,nullif(btrim(p_payload->>'purpose'),''),nullif(btrim(p_payload->>'note'),''),'pending_receipt',employee) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_employee_id)
 values(outlet,'collection',-row.amount,row.id,'Cash Handover',(select full_name from public.employees where id=receiver),row.submitted_at,employee);
 return to_jsonb(row);
end;
$$;
revoke all on function public.crew_cash_record_collection(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_record_collection(text,jsonb) to anon,authenticated;

-- The previous display projection is retained as a compatibility input.  The
-- canonical new field is can_initiate_handover; can_record_collection remains
-- a temporary projection alias for existing clients.
create or replace function public.crew_cash_mobile(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare payload jsonb; outlet uuid; employee uuid; initiator_name text; receivers jsonb; pending jsonb; ledger jsonb; recent jsonb; can_initiate boolean;
begin
  payload:=public.crew_cash_mobile_projection_source(p_token,p_business_date);
  outlet:=(payload->'outlet'->>'id')::uuid;
  employee:=public.crew_session_employee(p_token);
  can_initiate:=public.crew_can_initiate_cash_handover(employee,outlet);
  select e.full_name into initiator_name from public.employees e where e.id=employee;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into receivers
  from public.crew_cash_handover_receivers r
  join public.employees e on e.id=r.employee_id
  where r.outlet_id=outlet and public.crew_cash_receiver_is_eligible(outlet,e.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'note',c.note,'sender',coalesce(se.full_name,au.email,'Admin'),'outlet_name',payload->'outlet'->>'name','submitted_at',c.submitted_at) order by c.submitted_at desc),'[]'::jsonb) into pending
  from public.crew_cash_collections c
  left join public.employees se on se.id=c.handed_over_by_employee_id
  left join auth.users au on au.id=c.handed_over_by_user_id
  where c.outlet_id=outlet and c.receiver_employee_id=employee and c.status='pending_receipt';
  select coalesce(jsonb_agg(
    case when item->>'entry_type'='collection' then item || jsonb_build_object(
      'activity','Cash Handover',
      'handover_from',coalesce(sender.full_name,submitter.email,'Admin'),
      'handover_to',coalesce(receiver.full_name,item->>'receiver_name')
    ) else item end order by item->>'occurred_at' desc,item->>'id' desc
  ),'[]'::jsonb) into ledger
  from jsonb_array_elements(coalesce(payload#>'{deposit,ledger}','[]'::jsonb)) item
  left join public.crew_cash_ledger_entries entry on entry.id=(item->>'id')::uuid
  left join public.crew_cash_collections collection_row on collection_row.id=entry.collection_id
  left join public.employees sender on sender.id=collection_row.handed_over_by_employee_id
  left join auth.users submitter on submitter.id=collection_row.handed_over_by_user_id
  left join public.employees receiver on receiver.id=collection_row.receiver_employee_id;
  select coalesce(jsonb_agg(
    case when item->>'entry_type'='collection' then item || jsonb_build_object(
      'activity','Cash Handover',
      'handover_from',coalesce(sender.full_name,submitter.email,'Admin'),
      'handover_to',coalesce(receiver.full_name,item->>'receiver_name')
    ) else item end order by item->>'occurred_at' desc,item->>'id' desc
  ),'[]'::jsonb) into recent
  from jsonb_array_elements(coalesce(payload#>'{deposit,recent}','[]'::jsonb)) item
  left join public.crew_cash_ledger_entries entry on entry.id=(item->>'id')::uuid
  left join public.crew_cash_collections collection_row on collection_row.id=entry.collection_id
  left join public.employees sender on sender.id=collection_row.handed_over_by_employee_id
  left join auth.users submitter on submitter.id=collection_row.handed_over_by_user_id
  left join public.employees receiver on receiver.id=collection_row.receiver_employee_id;
  payload:=jsonb_set(payload,'{deposit,available_balance}',to_jsonb(public.crew_cash_balance(outlet)),true);
  payload:=jsonb_set(payload,'{deposit,ledger}',ledger,true);
  payload:=jsonb_set(payload,'{deposit,recent}',recent,true);
  payload:=jsonb_set(payload,'{initiator_name}',to_jsonb(initiator_name),true);
  payload:=jsonb_set(payload,'{receivers}',receivers,true);
  payload:=jsonb_set(payload,'{pending_receipts}',pending,true);
  payload:=jsonb_set(payload,'{can_initiate_handover}',to_jsonb(can_initiate),true);
  payload:=jsonb_set(payload,'{can_record_collection}',to_jsonb(can_initiate),true);
  payload:=jsonb_set(payload,'{is_cash_handover_receiver}',to_jsonb(public.crew_cash_receiver_is_eligible(outlet,employee) or exists(select 1 from public.crew_cash_collections c where c.outlet_id=outlet and c.receiver_employee_id=employee and c.status='pending_receipt')),true);
  return payload;
end;
$$;
revoke all on function public.crew_cash_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated;
