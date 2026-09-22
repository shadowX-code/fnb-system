-- A Cash Handover is acknowledged at its locked submitted amount.  This leaves
-- historical review-required collections intact while preventing a receiver
-- from creating a new amount/difference during confirmation.
create or replace function public.crew_cash_confirm_collection(p_token text,p_collection_id uuid,p_received_amount numeric)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid; row public.crew_cash_collections%rowtype;
begin
  employee:=public.crew_session_employee(p_token);
  select * into row from public.crew_cash_collections where id=p_collection_id for update;
  if row.id is null or row.receiver_employee_id<>employee then
    raise exception using errcode='42501',message='This Cash Handover is not assigned to you.';
  end if;
  if row.status in ('completed','review_required') then return to_jsonb(row); end if;
  if row.status<>'pending_receipt' then
    raise exception using errcode='22023',message='This Cash Handover is no longer awaiting confirmation.';
  end if;
  if p_received_amount is distinct from row.amount then
    raise exception using errcode='22023',message='Cash Handover confirmation must acknowledge the handed-over amount.';
  end if;
  update public.crew_cash_collections
  set received_amount=row.amount,difference=0,received_by_employee_id=employee,confirmed_at=now(),status='completed'
  where id=row.id returning * into row;
  return to_jsonb(row);
end;
$$;
revoke all on function public.crew_cash_confirm_collection(text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.crew_cash_confirm_collection(text,uuid,numeric) to anon,authenticated;

-- Preserve the audited source projection and add handover-specific display
-- evidence at the wrapper boundary.  The ledger remains canonical: no amounts
-- or balances are recomputed here.
create or replace function public.crew_cash_mobile(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare payload jsonb; outlet uuid; employee uuid; initiator_name text; receivers jsonb; pending jsonb; ledger jsonb; recent jsonb;
begin
  payload:=public.crew_cash_mobile_projection_source(p_token,p_business_date);
  outlet:=(payload->'outlet'->>'id')::uuid;
  employee:=public.crew_session_employee(p_token);
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
  return jsonb_set(payload,'{is_cash_handover_receiver}',to_jsonb(public.crew_cash_receiver_is_eligible(outlet,employee) or exists(select 1 from public.crew_cash_collections c where c.outlet_id=outlet and c.receiver_employee_id=employee and c.status='pending_receipt')),true);
end;
$$;
revoke all on function public.crew_cash_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated;
