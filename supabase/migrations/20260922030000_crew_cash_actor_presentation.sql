-- Crew Cash keeps immutable actor IDs in the ledger/collection records. This
-- presentation wrapper resolves those IDs through People display names and
-- deliberately never projects auth email into a Crew session.
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'amount',c.amount,'purpose',c.purpose,'note',c.note,
    'sender',coalesce(crew_sender.full_name,admin_sender.full_name,'Admin'),
    'outlet_name',payload->'outlet'->>'name','submitted_at',c.submitted_at
  ) order by c.submitted_at desc),'[]'::jsonb) into pending
  from public.crew_cash_collections c
  left join public.employees crew_sender on crew_sender.id=c.handed_over_by_employee_id
  left join public.employees admin_sender on admin_sender.auth_user_id=c.handed_over_by_user_id
  where c.outlet_id=outlet and c.receiver_employee_id=employee and c.status='pending_receipt';

  select coalesce(jsonb_agg(
    case when item->>'entry_type'='collection' then item || jsonb_build_object(
      'recorded_by',coalesce(recorded_crew.full_name,recorded_admin.full_name,'Admin'),
      'activity','Cash Handover',
      'handover_from',coalesce(crew_sender.full_name,admin_sender.full_name,'Admin'),
      'handover_to',coalesce(receiver.full_name,item->>'receiver_name')
    ) else item || jsonb_build_object('recorded_by',coalesce(recorded_crew.full_name,recorded_admin.full_name,'Admin')) end
    order by item->>'occurred_at' desc,item->>'id' desc
  ),'[]'::jsonb) into ledger
  from jsonb_array_elements(coalesce(payload#>'{deposit,ledger}','[]'::jsonb)) item
  left join public.crew_cash_ledger_entries entry on entry.id=(item->>'id')::uuid
  left join public.crew_cash_collections collection_row on collection_row.id=entry.collection_id
  left join public.employees crew_sender on crew_sender.id=collection_row.handed_over_by_employee_id
  left join public.employees admin_sender on admin_sender.auth_user_id=collection_row.handed_over_by_user_id
  left join public.employees receiver on receiver.id=collection_row.receiver_employee_id
  left join public.employees recorded_crew on recorded_crew.id=entry.recorded_by_employee_id
  left join public.employees recorded_admin on recorded_admin.auth_user_id=entry.recorded_by_user_id;

  select coalesce(jsonb_agg(
    case when item->>'entry_type'='collection' then item || jsonb_build_object(
      'recorded_by',coalesce(recorded_crew.full_name,recorded_admin.full_name,'Admin'),
      'activity','Cash Handover',
      'handover_from',coalesce(crew_sender.full_name,admin_sender.full_name,'Admin'),
      'handover_to',coalesce(receiver.full_name,item->>'receiver_name')
    ) else item || jsonb_build_object('recorded_by',coalesce(recorded_crew.full_name,recorded_admin.full_name,'Admin')) end
    order by item->>'occurred_at' desc,item->>'id' desc
  ),'[]'::jsonb) into recent
  from jsonb_array_elements(coalesce(payload#>'{deposit,recent}','[]'::jsonb)) item
  left join public.crew_cash_ledger_entries entry on entry.id=(item->>'id')::uuid
  left join public.crew_cash_collections collection_row on collection_row.id=entry.collection_id
  left join public.employees crew_sender on crew_sender.id=collection_row.handed_over_by_employee_id
  left join public.employees admin_sender on admin_sender.auth_user_id=collection_row.handed_over_by_user_id
  left join public.employees receiver on receiver.id=collection_row.receiver_employee_id
  left join public.employees recorded_crew on recorded_crew.id=entry.recorded_by_employee_id
  left join public.employees recorded_admin on recorded_admin.auth_user_id=entry.recorded_by_user_id;

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
