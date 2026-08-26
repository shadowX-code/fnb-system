-- A Cash Collection changes the deposit balance when it is handed over. Receipt
-- confirmation is acknowledgement evidence only; it must never post a second debit.

alter table public.crew_cash_collections add column if not exists request_id uuid;
alter table public.crew_cash_collections add column if not exists request_fingerprint text;
create unique index if not exists crew_cash_collections_outlet_request_idx on public.crew_cash_collections(outlet_id,request_id) where request_id is not null;

-- Transition legacy handovers exactly once. Their prior ledger history is retained;
-- this entry records the point at which an unposted pending handover joins the new
-- balance authority rather than rewriting historical entries or their timestamps.
insert into public.crew_cash_ledger_entries(
  outlet_id, entry_type, signed_amount, collection_id, activity, receiver_name,
  occurred_at, recorded_by_employee_id, recorded_by_user_id
)
select c.outlet_id, 'collection', -c.amount, c.id,
  'Cash Collection · legacy pending confirmation transition',
  coalesce(r.full_name, c.external_receiver_name), now(),
  c.handed_over_by_employee_id, c.handed_over_by_user_id
from public.crew_cash_collections c
left join public.employees r on r.id = c.receiver_employee_id
where c.status in ('pending_receipt', 'review_required')
  and not exists (
    select 1 from public.crew_cash_ledger_entries l where l.collection_id = c.id
  );

-- Retained only as a compatibility helper for existing Admin consumers. It is now
-- the same canonical balance, not a second reservation calculation.
create or replace function public.crew_cash_available_balance(p_outlet_id uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select public.crew_cash_balance(p_outlet_id);
$$;
revoke all on function public.crew_cash_available_balance(uuid) from public,anon,authenticated;

create or replace function public.crew_cash_record_collection(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; receiver_type text; receiver uuid; receiver_name text; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype; require_confirm boolean;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid;
 if not public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection') then raise exception using errcode='42501',message='You do not have permission to record a Cash Collection.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['outlet_id','handed_over_by','status','difference','confirmed_at'] then raise exception using errcode='22023',message='Cash Collection payload contains server-controlled fields.'; end if;
 receiver_type:=lower(btrim(p_payload->>'receiver_type')); receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; receiver_name:=nullif(btrim(p_payload->>'receiver_name'),''); amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='Cash Collection request_id is required.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',outlet,'receiver_type',receiver_type,'receiver_employee_id',receiver,'receiver_name',receiver_name,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(outlet::text,0));
 select * into row from public.crew_cash_collections c where c.outlet_id=outlet and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Cash Collection request_id conflicts with a different payload.'; end if; return to_jsonb(row); end if;
 if nullif(btrim(p_payload->>'purpose'),'') is null then raise exception using errcode='22023',message='Collection purpose is required.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_balance(outlet) then raise exception using errcode='22023',message='Collection amount must be positive and cannot exceed the cash deposit balance.'; end if;
 if receiver_type='internal' and not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=receiver and e.is_active and ca.access_state='active' and ca.primary_outlet_id=outlet) then raise exception using errcode='22023',message='Internal receiver must be an active Crew member in this outlet.'; end if;
 if receiver_type='external' and receiver_name is null then raise exception using errcode='22023',message='External receiver name is required.'; end if;
 if receiver_type<>all(array['internal','external']) then raise exception using errcode='22023',message='Receiver type must be internal or external.'; end if;
 select coalesce((select s.require_receiver_confirmation from public.crew_cash_settings s where s.outlet_id=outlet),true) into require_confirm;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,external_receiver_name,amount,received_amount,difference,purpose,note,status,handed_over_by_employee_id,confirmed_at)
 values(outlet,request,fingerprint,receiver_type,case when receiver_type='internal' then receiver end,case when receiver_type='external' then receiver_name end,amount,case when receiver_type='external' or not require_confirm then amount end,0,btrim(p_payload->>'purpose'),nullif(btrim(p_payload->>'note'),''),case when receiver_type='internal' and require_confirm then 'pending_receipt' else 'completed' end,employee,case when receiver_type='external' or not require_confirm then now() end)
 returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_employee_id)
 values(outlet,'collection',-row.amount,row.id,'Cash Collection',coalesce(receiver_name,(select full_name from public.employees where id=receiver)),row.submitted_at,employee);
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_record_collection(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_record_collection(text,jsonb) to anon,authenticated;

create or replace function public.crew_cash_confirm_collection(p_token text,p_collection_id uuid,p_received_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; row public.crew_cash_collections%rowtype;
begin
 employee:=public.crew_session_employee(p_token); select * into row from public.crew_cash_collections where id=p_collection_id for update;
 if row.id is null or row.receiver_employee_id<>employee then raise exception using errcode='42501',message='This Cash Collection is not assigned to you.'; end if;
 if row.status in ('completed','review_required') then return to_jsonb(row); end if;
 if row.status<>'pending_receipt' then raise exception using errcode='22023',message='This Cash Collection is no longer awaiting receipt.'; end if;
 if p_received_amount is null or p_received_amount<=0 then raise exception using errcode='22023',message='Received amount must be positive.'; end if;
 update public.crew_cash_collections set received_amount=p_received_amount,difference=p_received_amount-amount,received_by_employee_id=employee,confirmed_at=now(),status=case when p_received_amount=amount then 'completed' else 'review_required' end where id=row.id returning * into row;
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_confirm_collection(text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.crew_cash_confirm_collection(text,uuid,numeric) to anon,authenticated;

create or replace function public.crew_cash_review_collection(p_collection_id uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.crew_cash_collections%rowtype; decision text:=lower(btrim(p_decision));
begin
 select * into row from public.crew_cash_collections where id=p_collection_id for update;
 if row.id is null then raise exception using errcode='P0002',message='Cash Collection was not found.'; end if;
 perform public.crew_cash_assert_admin(row.outlet_id,'crew_cash_checkout.review');
 if row.status<>'review_required' then raise exception using errcode='22023',message='This Cash Collection is not awaiting review.'; end if;
 if nullif(btrim(p_note),'') is null then raise exception using errcode='22023',message='A review note is required.'; end if;
 if decision='approve' then
  update public.crew_cash_collections set status='completed',reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_note) where id=row.id returning * into row;
 elsif decision='reject' then
  update public.crew_cash_collections set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_note) where id=row.id returning * into row;
 else raise exception using errcode='22023',message='Review decision must be approve or reject.'; end if;
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_review_collection(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_cash_review_collection(uuid,text,text) to authenticated;

-- The Crew projection has one balance. Pending confirmation is audit context only.
create or replace function public.crew_cash_mobile(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; checkout jsonb; can_perform boolean; can_collect boolean; floating numeric; previous_carry numeric;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position';
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 floating:=public.crew_cash_float_at(outlet,p_business_date); previous_carry:=public.crew_cash_previous_carry(outlet,p_business_date);
 can_perform:=public.crew_cash_employee_has_permission(employee,'crew_cash_checkout.perform') and (settings.id is null or cardinality(settings.required_positions)=0 or position=any(settings.required_positions));
 can_collect:=public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection');
 select jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'checked_out_by',e.full_name,'floating_cash',c.floating_cash,'previous_carry_forward',c.previous_carry_forward,'expected_opening_cash',c.expected_opening_cash,'actual_opening_cash',c.actual_opening_cash,'opening_variance',c.opening_variance,'opening_variance_reason',c.opening_variance_reason,'denomination_counts',c.denomination_counts,'counted_cash',c.counted_cash,'pos_expected_cash',c.pos_expected_cash,'variance',c.variance,'reconciliation_status',c.reconciliation_status,'carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit,'float_shortfall',c.float_shortfall,'review_required',c.review_required,'review_status',c.review_status,'variance_reason',c.variance_reason,'completed_at',c.completed_at) into checkout from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=outlet and c.business_date=p_business_date;
 return jsonb_build_object('outlet',jsonb_build_object('id',outlet,'name',coalesce((select o.name from public.outlets o where o.id=outlet),ctx->>'outlet_name')),'business_date',p_business_date,'can_perform',can_perform,'can_record_collection',can_collect,'settings',jsonb_build_object('floating_cash',floating,'variance_tolerance',coalesce(settings.variance_tolerance,0),'closing_deadline',settings.closing_deadline),'cash_context',jsonb_build_object('floating_cash',floating,'previous_carry_forward',previous_carry,'expected_opening_cash',floating + previous_carry),'checkout',checkout,'deposit',jsonb_build_object('current_balance',public.crew_cash_balance(outlet),'pending_confirmation_amount',coalesce((select sum(c.amount) from public.crew_cash_collections c where c.outlet_id=outlet and c.status='pending_receipt'),0),'recent',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 3)x),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 100)x),'[]'::jsonb)),'receivers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name) from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=outlet and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb),'pending_receipts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'sender',coalesce(se.full_name,'Admin'),'submitted_at',c.submitted_at) order by c.submitted_at desc) from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt'),'[]'::jsonb));
end; $$;
revoke all on function public.crew_cash_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated;

create or replace function public.crew_cash_admin_record_collection(p_outlet_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare receiver_type text; receiver uuid; receiver_name text; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype;
begin
 perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['outlet_id','handed_over_by','status','difference','confirmed_at'] then raise exception using errcode='22023',message='Cash Collection payload contains server-controlled fields.'; end if;
 receiver_type:=lower(btrim(p_payload->>'receiver_type')); receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; receiver_name:=nullif(btrim(p_payload->>'receiver_name'),''); amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='Cash Collection request_id is required.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',p_outlet_id,'receiver_type',receiver_type,'receiver_employee_id',receiver,'receiver_name',receiver_name,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text,0));
 select * into row from public.crew_cash_collections c where c.outlet_id=p_outlet_id and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Cash Collection request_id conflicts with a different payload.'; end if; return to_jsonb(row); end if;
 if nullif(btrim(p_payload->>'purpose'),'') is null then raise exception using errcode='22023',message='Collection purpose is required.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_balance(p_outlet_id) then raise exception using errcode='22023',message='Collection amount must be positive and cannot exceed the cash deposit balance.'; end if;
 if receiver_type='internal' and not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=receiver and e.is_active and ca.access_state='active' and ca.primary_outlet_id=p_outlet_id) then raise exception using errcode='22023',message='Internal receiver must be an active Crew member in this outlet.'; end if;
 if receiver_type='external' and receiver_name is null then raise exception using errcode='22023',message='External receiver name is required.'; end if;
 if receiver_type<>all(array['internal','external']) then raise exception using errcode='22023',message='Receiver type must be internal or external.'; end if;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,external_receiver_name,amount,received_amount,difference,purpose,note,status,handed_over_by_user_id,confirmed_at)
 values(p_outlet_id,request,fingerprint,receiver_type,case when receiver_type='internal' then receiver end,case when receiver_type='external' then receiver_name end,amount,case when receiver_type='external' then amount end,0,btrim(p_payload->>'purpose'),nullif(btrim(p_payload->>'note'),''),case when receiver_type='internal' then 'pending_receipt' else 'completed' end,auth.uid(),case when receiver_type='external' then now() end) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_user_id) values(p_outlet_id,'collection',-row.amount,row.id,'Cash Collection',receiver_name,row.submitted_at,auth.uid());
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_admin_record_collection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_record_collection(uuid,jsonb) to authenticated;
