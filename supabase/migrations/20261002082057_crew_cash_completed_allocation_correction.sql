do $$ begin
 if md5(pg_get_functiondef('public.crew_cash_admin_page(uuid,date,date,text,integer,integer)'::regprocedure))<>'092e292229a0959270c6746ea761aaa5' then raise exception 'Reviewed allocation baseline drift: crew_cash_admin_page(uuid,date,date,text,integer,integer)'; end if;
 if md5(pg_get_functiondef('public.crew_cash_admin_data_projection_source(uuid,date,date)'::regprocedure))<>'6cd4b7405dcdce4e45fdd83eabaef7de' then raise exception 'Reviewed allocation baseline drift: crew_cash_admin_data_projection_source(uuid,date,date)'; end if;
 if md5(pg_get_functiondef('public.crew_cash_mobile_projection_source(text,date)'::regprocedure))<>'90f2f428d8f6b8db52603cecb8a41df1' then raise exception 'Reviewed allocation baseline drift: crew_cash_mobile_projection_source(text,date)'; end if;
 if md5(pg_get_functiondef('public.crew_cash_checkout_history(text,date)'::regprocedure))<>'3e40715b2afc960d41620ea9934958b4' then raise exception 'Reviewed allocation baseline drift: crew_cash_checkout_history(text,date)'; end if;
 if md5(pg_get_functiondef('public.crew_cash_previous_carry(uuid,date)'::regprocedure))<>'168387ec0b5eb5db72d62511de988c89' then raise exception 'Reviewed allocation baseline drift: crew_cash_previous_carry(uuid,date)'; end if;
 if md5(pg_get_functiondef('public.crew_cash_adjust_checkout(uuid,text,numeric,text)'::regprocedure))<>'0179d8440010686bcf1788996047b1f3' then raise exception 'Reviewed allocation baseline drift: crew_cash_adjust_checkout(uuid,text,numeric,text)'; end if;
 if md5(pg_get_functiondef('public.crew_cash_record_collection(text,jsonb)'::regprocedure))<>'7ddb0e69ec9da578bee8a12b8d9ccaf7' then raise exception 'Reviewed allocation baseline drift: crew_cash_record_collection(text,jsonb)'; end if;
 if md5(pg_get_functiondef('public.crew_cash_admin_record_collection(uuid,jsonb)'::regprocedure))<>'1bb164e87233920378bfc7a07d5f5e7a' then raise exception 'Reviewed allocation baseline drift: crew_cash_admin_record_collection(uuid,jsonb)'; end if;
end $$;

alter table public.crew_cash_checkout_adjustments
 add column request_id uuid,
 add column previous_allocation_id uuid references public.crew_cash_checkout_adjustments(id),
 add column allocation_original jsonb,
 add column allocation_before jsonb,
 add column allocation_after jsonb;
alter table public.crew_cash_checkout_adjustments drop constraint crew_cash_checkout_adjustments_action_check;
alter table public.crew_cash_checkout_adjustments add constraint crew_cash_checkout_adjustments_action_check check(action in ('adjustment','reversal','allocation'));
alter table public.crew_cash_checkout_adjustments add constraint crew_cash_allocation_evidence_check check(
 (action='allocation' and request_id is not null and actor_user_id is not null and allocation_original is not null and allocation_before is not null and allocation_after is not null)
 or (action<>'allocation' and request_id is null and previous_allocation_id is null and allocation_original is null and allocation_before is null and allocation_after is null));
create unique index crew_cash_allocation_request_unique on public.crew_cash_checkout_adjustments(request_id) where request_id is not null;
create unique index crew_cash_allocation_successor_unique on public.crew_cash_checkout_adjustments(checkout_id,coalesce(previous_allocation_id,'00000000-0000-0000-0000-000000000000'::uuid)) where action='allocation';
-- Existing crew_cash_ledger_adjustment_idx enforces one ledger entry per correction.

-- Private, shared projection: original snapshot plus append-only allocation evidence.
create function public.crew_cash_checkout_allocation(p_checkout_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'carry_forward',coalesce(a.allocation_after->'carry_forward',to_jsonb(c.carry_forward)),
  'amount_for_deposit',coalesce(a.allocation_after->'amount_for_deposit',to_jsonb(c.amount_for_deposit)),
  'allocation_correction_id',a.id,
  'allocation_original',jsonb_build_object('carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit),
  'allocation_corrections',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'original',h.allocation_original,'before',h.allocation_before,'after',h.allocation_after,
   'previous_correction_id',h.previous_allocation_id,'actor_user_id',h.actor_user_id,'actor_name',coalesce((select e.full_name from public.employees e where e.auth_user_id=h.actor_user_id order by e.id limit 1),'Admin'),
   'created_at',h.created_at,'reason',h.reason,'signed_amount',h.signed_amount) order by h.created_at,h.id)
   from public.crew_cash_checkout_adjustments h where h.checkout_id=c.id and h.action='allocation'),'[]'::jsonb))
 from public.crew_cash_checkouts c left join lateral (
  select x.* from public.crew_cash_checkout_adjustments x where x.checkout_id=c.id and x.action='allocation'
   and not exists(select 1 from public.crew_cash_checkout_adjustments successor where successor.previous_allocation_id=x.id)
 ) a on true where c.id=p_checkout_id;
$$;
revoke all on function public.crew_cash_checkout_allocation(uuid) from public,anon,authenticated;

create function public.crew_cash_correct_checkout_allocation(p_checkout_id uuid,p_carry_forward numeric,p_expected_correction_id uuid,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.crew_cash_checkouts%rowtype; prior jsonb; target jsonb; original jsonb; a public.crew_cash_checkout_adjustments%rowtype;
 outlet uuid; deposit numeric; delta numeric; actor uuid:=auth.uid();
begin
 select outlet_id into outlet from public.crew_cash_checkouts where id=p_checkout_id;
 if outlet is null then raise exception using errcode='22023',message='Cash Checkout is unavailable.'; end if;
 perform public.crew_cash_assert_admin(outlet,'crew_cash_checkout.manage');
 if actor is null then raise exception using errcode='42501',message='An authenticated correction actor is required.'; end if;
 if p_request_id is null or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
  raise exception using errcode='22023',message='A correction request and reason are required.'; end if;
 if p_carry_forward is null or p_carry_forward::text in ('NaN','Infinity','-Infinity') or p_carry_forward<0 or p_carry_forward<>round(p_carry_forward,2) then
  raise exception using errcode='22023',message='Carry Forward must be a non-negative amount with at most two decimal places.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(outlet::text,0));
 select * into c from public.crew_cash_checkouts where id=p_checkout_id for update;
 if c.status<>'completed' then raise exception using errcode='22023',message='Only a completed Cash Checkout can have its allocation corrected.'; end if;
 select * into a from public.crew_cash_checkout_adjustments where request_id=p_request_id;
 if a.id is not null then
  if a.checkout_id<>c.id or a.actor_user_id<>actor or (a.allocation_after->>'carry_forward')::numeric<>p_carry_forward
   or a.reason<>btrim(p_reason) or a.previous_allocation_id is distinct from p_expected_correction_id then
   raise exception using errcode='22023',message='This correction request was already used with different details.'; end if;
  return jsonb_build_object('correction',to_jsonb(a),'checkout',to_jsonb(c)||public.crew_cash_checkout_allocation(c.id),'current_balance',public.crew_cash_balance(outlet),'replayed',true);
 end if;
 if exists(select 1 from public.crew_cash_checkout_adjustments where checkout_id=c.id and action<>'allocation') then
  raise exception using errcode='55000',message='This checkout has a ledger adjustment or reversal; reconcile that evidence before correcting allocation.'; end if;
 if c.amount_for_deposit>0 and not exists(select 1 from public.crew_cash_ledger_entries l where l.checkout_id=c.id and l.entry_type='checkout_due' and l.signed_amount=c.amount_for_deposit) then
  raise exception using errcode='55000',message='The original deposit obligation is missing or inconsistent; review the ledger evidence first.'; end if;
 prior:=public.crew_cash_checkout_allocation(c.id);
 if (prior->>'allocation_correction_id')::uuid is distinct from p_expected_correction_id then
  raise exception using errcode='40001',message='Allocation changed. Reopen the checkout before correcting it.'; end if;
 -- Allocation preserves the recorded retained-cash envelope, including shortfall cases.
 if c.carry_forward<0 or c.amount_for_deposit<0 or c.carry_forward+c.amount_for_deposit<>greatest(c.counted_cash-c.floating_cash,0) then
  raise exception using errcode='55000',message='The recorded allocation does not match its counted cash and float; review the original evidence first.'; end if;
 deposit:=greatest(c.counted_cash-c.floating_cash,0)-p_carry_forward;
 if deposit<0 then raise exception using errcode='22023',message='Carry Forward exceeds the checkout amount available for allocation.'; end if;
 delta:=deposit-(prior->>'amount_for_deposit')::numeric;
 if delta=0 then raise exception using errcode='22023',message='Allocation is unchanged.'; end if;
 if delta<0 and -delta>public.crew_cash_balance(outlet) then
  raise exception using errcode='22023',message='Allocation correction cannot reduce the Cash Deposit balance below zero.'; end if;
 original:=jsonb_build_object('carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit);
 target:=jsonb_build_object('carry_forward',p_carry_forward,'amount_for_deposit',deposit);
 insert into public.crew_cash_checkout_adjustments(checkout_id,action,signed_amount,reason,actor_user_id,request_id,previous_allocation_id,allocation_original,allocation_before,allocation_after,created_at)
 values(c.id,'allocation',delta,btrim(p_reason),actor,p_request_id,p_expected_correction_id,original,
  jsonb_build_object('carry_forward',prior->'carry_forward','amount_for_deposit',prior->'amount_for_deposit'),target,clock_timestamp()) returning * into a;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,checkout_id,checkout_adjustment_id,activity,occurred_at,recorded_by_user_id)
 values(outlet,'checkout_adjustment',delta,c.id,a.id,'Cash Checkout allocation correction',a.created_at,actor);
 return jsonb_build_object('correction',to_jsonb(a),'checkout',to_jsonb(c)||public.crew_cash_checkout_allocation(c.id),'current_balance',public.crew_cash_balance(outlet),'replayed',false);
end $$;
revoke all on function public.crew_cash_correct_checkout_allocation(uuid,numeric,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crew_cash_correct_checkout_allocation(uuid,numeric,uuid,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.crew_cash_admin_page(p_outlet_id uuid, p_from date, p_to date, p_listing text DEFAULT 'checkouts'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=case when p_page_size in(20,50,100) then p_page_size else 20 end; v_total integer; v_rows jsonb; v_summary jsonb; v_settings jsonb; v_collections jsonb;
begin
 if not ((public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view')) and public.current_user_can_access_outlet(p_outlet_id)) then raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception using errcode='22023',message='Cash Checkout date range must be 367 days or fewer.'; end if;
 if p_listing not in ('checkouts','ledger') then raise exception using errcode='22023',message='Unsupported Cash Checkout listing.'; end if;
 select coalesce(to_jsonb(s),'{}'::jsonb) into v_settings from public.crew_cash_settings s where s.outlet_id=p_outlet_id;
 select jsonb_build_object('current_balance',coalesce(sum(signed_amount),0),'available_balance',public.crew_cash_available_balance(p_outlet_id),'total_added',coalesce(sum(greatest(signed_amount,0)),0),'total_collected',coalesce(sum(greatest(-signed_amount,0)),0),'pending_handover',coalesce((select sum(amount) from public.crew_cash_collections where outlet_id=p_outlet_id and status='pending_receipt'),0)) into v_summary from public.crew_cash_ledger_entries where outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_collections from (select c.*,coalesce(r.full_name,c.external_receiver_name) receiver_name from public.crew_cash_collections c left join public.employees r on r.id=c.receiver_employee_id where c.outlet_id=p_outlet_id and c.status in ('pending_receipt','review_required'))x;
 if p_listing='checkouts' then
  select count(*) into v_total from public.crew_cash_checkouts where outlet_id=p_outlet_id and business_date between p_from and p_to;
  select coalesce(jsonb_agg((to_jsonb(x)||public.crew_cash_checkout_allocation(x.id)) order by x.business_date desc,x.id desc),'[]'::jsonb) into v_rows from (select c.*,e.full_name checked_out_by from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=p_outlet_id and c.business_date between p_from and p_to order by c.business_date desc,c.id desc offset (v_page-1)*v_size limit v_size)x;
 else
  select count(*) into v_total from public.crew_cash_ledger_entries l where l.outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',l.occurred_at)::date between p_from and p_to;
  with ledger as (select l.id,l.occurred_at,l.entry_type,l.activity,greatest(l.signed_amount,0) amount_in,greatest(-l.signed_amount,0) amount_out,sum(l.signed_amount) over(order by l.occurred_at,l.id) balance,l.receiver_name,coalesce(crew_actor.full_name,admin_actor.full_name,'Admin') recorded_by from public.crew_cash_ledger_entries l left join public.employees crew_actor on crew_actor.id=l.recorded_by_employee_id left join public.employees admin_actor on admin_actor.auth_user_id=l.recorded_by_user_id where l.outlet_id=p_outlet_id) select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb) into v_rows from (select * from ledger where timezone('Asia/Kuala_Lumpur',occurred_at)::date between p_from and p_to order by occurred_at desc,id desc offset (v_page-1)*v_size limit v_size)x;
 end if;
 return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,'summary',v_summary,'settings',v_settings,'collections',v_collections);
end; $function$
;

CREATE OR REPLACE FUNCTION public.crew_cash_admin_data_projection_source(p_outlet_id uuid, p_from date DEFAULT (CURRENT_DATE - 30), p_to date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare settings jsonb; ledger jsonb; total_in numeric; total_out numeric;
begin
 if not ((public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view')) and public.current_user_can_access_outlet(p_outlet_id)) then
  raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.';
 end if;
 if p_to<p_from or p_to-p_from>366 then raise exception using errcode='22023',message='Cash Checkout date range must be 367 days or fewer.'; end if;
 select coalesce(to_jsonb(s),'{}'::jsonb) into settings from public.crew_cash_settings s where s.outlet_id=p_outlet_id;
 select coalesce(sum(greatest(l.signed_amount,0)),0),coalesce(sum(greatest(-l.signed_amount,0)),0) into total_in,total_out from public.crew_cash_ledger_entries l where l.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb) into ledger from (
  select l.id,l.occurred_at,l.entry_type,l.activity,greatest(l.signed_amount,0) amount_in,greatest(-l.signed_amount,0) amount_out,
   sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance,l.receiver_name,
   coalesce(e.full_name,u.email,'System') recorded_by
  from public.crew_cash_ledger_entries l left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id
  where l.outlet_id=p_outlet_id
 )x;
 return jsonb_build_object('settings',settings,'summary',jsonb_build_object('current_balance',total_in-total_out,'available_balance',public.crew_cash_available_balance(p_outlet_id),'total_added',total_in,'total_collected',total_out),
  'checkouts',coalesce((select jsonb_agg((to_jsonb(x)||public.crew_cash_checkout_allocation(x.id)) order by x.business_date desc) from (select c.*,e.full_name checked_out_by from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=p_outlet_id and c.business_date between p_from and p_to)x),'[]'::jsonb),
  'ledger',ledger,
  'collections',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select c.*,coalesce(r.full_name,c.external_receiver_name) receiver_name,coalesce(h.full_name,u.email,'Admin') handed_over_by from public.crew_cash_collections c left join public.employees r on r.id=c.receiver_employee_id left join public.employees h on h.id=c.handed_over_by_employee_id left join auth.users u on u.id=c.handed_over_by_user_id where c.outlet_id=p_outlet_id)x),'[]'::jsonb),
  'float_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_amount',a.previous_amount,'new_amount',a.new_amount,'effective_date',a.effective_date,'reason',a.reason,'adjusted_at',a.adjusted_at,'adjusted_by',coalesce(u.email,'Admin')) order by a.effective_date desc,a.adjusted_at desc) from public.crew_cash_float_adjustments a left join auth.users u on u.id=a.adjusted_by where a.outlet_id=p_outlet_id),'[]'::jsonb),
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name) from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb));
end; $function$
;

CREATE OR REPLACE FUNCTION public.crew_cash_mobile_projection_source(p_token text, p_business_date date DEFAULT (timezone('Asia/Kuala_Lumpur'::text, now()))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; checkout jsonb; can_perform boolean; can_collect boolean; floating numeric; previous_carry numeric;
begin
 ctx:=public.crew_cash_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position';
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 floating:=public.crew_cash_float_at(outlet,p_business_date); previous_carry:=public.crew_cash_previous_carry(outlet,p_business_date);
 can_perform:=public.crew_cash_can_perform_checkout(employee,outlet);
 can_collect:=public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection');
 select jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'checked_out_by',e.full_name,'floating_cash',c.floating_cash,'previous_carry_forward',c.previous_carry_forward,'expected_opening_cash',c.expected_opening_cash,'actual_opening_cash',c.actual_opening_cash,'opening_variance',c.opening_variance,'opening_variance_reason',c.opening_variance_reason,'denomination_counts',c.denomination_counts,'counted_cash',c.counted_cash,'pos_expected_cash',c.pos_expected_cash,'variance',c.variance,'reconciliation_status',c.reconciliation_status,'carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit,'float_shortfall',c.float_shortfall,'review_required',c.review_required,'review_status',c.review_status,'variance_reason',c.variance_reason,'completed_at',c.completed_at)||public.crew_cash_checkout_allocation(c.id) into checkout from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=outlet and c.business_date=p_business_date;
 return jsonb_build_object('outlet',jsonb_build_object('id',outlet,'name',coalesce((select o.name from public.outlets o where o.id=outlet),ctx->>'outlet_name')),'business_date',p_business_date,'can_perform',can_perform,'can_record_collection',can_collect,'settings',jsonb_build_object('floating_cash',floating,'variance_tolerance',coalesce(settings.variance_tolerance,0),'closing_deadline',settings.closing_deadline),'cash_context',jsonb_build_object('floating_cash',floating,'previous_carry_forward',previous_carry,'expected_opening_cash',floating + previous_carry),'checkout',checkout,'deposit',jsonb_build_object('current_balance',public.crew_cash_balance(outlet),'pending_confirmation_amount',coalesce((select sum(c.amount) from public.crew_cash_collections c where c.outlet_id=outlet and c.status='pending_receipt'),0),'recent',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 3)x),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 100)x),'[]'::jsonb)),'receivers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name) from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=outlet and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb),'pending_receipts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'sender',coalesce(se.full_name,'Admin'),'submitted_at',c.submitted_at) order by c.submitted_at desc) from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt'),'[]'::jsonb));
end; $function$
;

CREATE OR REPLACE FUNCTION public.crew_cash_checkout_history(p_token text, p_business_date date DEFAULT (timezone('Asia/Kuala_Lumpur'::text, now()))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ctx jsonb;
  outlet uuid;
begin
  ctx := public.crew_cash_employee_context(p_token);
  outlet := (ctx->>'outlet_id')::uuid;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'business_date', c.business_date,
      'status', c.status,
      'checked_out_by', e.full_name,
      'position', e.position,
      'floating_cash', c.floating_cash,
      'previous_carry_forward', c.previous_carry_forward,
      'expected_opening_cash', c.expected_opening_cash,
      'actual_opening_cash', c.actual_opening_cash,
      'opening_variance', c.opening_variance,
      'opening_variance_reason', c.opening_variance_reason,
      'denomination_counts', c.denomination_counts,
      'counted_cash', c.counted_cash,
      'pos_expected_cash', c.pos_expected_cash,
      'variance', c.variance,
      'reconciliation_status', c.reconciliation_status,
      'carry_forward', c.carry_forward,
      'amount_for_deposit', c.amount_for_deposit,
      'float_shortfall', c.float_shortfall,
      'review_required', c.review_required,
      'review_status', c.review_status,
      'variance_reason', c.variance_reason,
      'completed_at', c.completed_at
    )||public.crew_cash_checkout_allocation(c.id) order by c.business_date desc, c.completed_at desc)
    from public.crew_cash_checkouts c
    join public.employees e on e.id = c.checked_out_by_employee_id
    where c.outlet_id = outlet
      and c.status = 'completed'
      and c.business_date between p_business_date - 29 and p_business_date
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crew_cash_previous_carry(p_outlet_id uuid, p_date date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select coalesce((select (public.crew_cash_checkout_allocation(c.id)->>'carry_forward')::numeric from public.crew_cash_checkouts c
  where c.outlet_id=p_outlet_id and c.business_date<p_date and c.status='completed'
  order by c.business_date desc limit 1),0)::numeric(14,2);
$function$
;

CREATE OR REPLACE FUNCTION public.crew_cash_adjust_checkout(p_checkout_id uuid, p_action text, p_amount numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.crew_cash_checkouts%rowtype; row public.crew_cash_checkout_adjustments%rowtype; signed numeric; action text:=lower(btrim(p_action));
begin
 select * into c from public.crew_cash_checkouts where id=p_checkout_id and status='completed';
 if c.id is null then raise exception using errcode='22023',message='Only a completed Cash Checkout can be corrected.'; end if;
 perform public.crew_cash_assert_admin(c.outlet_id,'crew_cash_checkout.manage');
 perform pg_advisory_xact_lock(hashtextextended(c.outlet_id::text,0));
 select * into c from public.crew_cash_checkouts where id=p_checkout_id for update;
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='A correction reason is required.'; end if;
 if action='reversal' then signed:=-(public.crew_cash_checkout_allocation(c.id)->>'amount_for_deposit')::numeric; if signed=0 then raise exception using errcode='22023',message='This Cash Checkout has no deposit amount to reverse.'; end if;
 elsif action='adjustment' then signed:=p_amount; if signed is null or signed=0 then raise exception using errcode='22023',message='Adjustment amount cannot be zero.'; end if;
 else raise exception using errcode='22023',message='Correction action must be adjustment or reversal.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c.outlet_id::text,0));
 if signed<0 and abs(signed)>public.crew_cash_balance(c.outlet_id) then raise exception using errcode='22023',message='Correction cannot reduce the deposit ledger below zero.'; end if;
 insert into public.crew_cash_checkout_adjustments(checkout_id,action,signed_amount,reason,actor_user_id) values(c.id,action,signed,btrim(p_reason),auth.uid()) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,checkout_id,checkout_adjustment_id,activity,occurred_at,recorded_by_user_id) values(c.outlet_id,case when action='reversal' then 'checkout_reversal' else 'checkout_adjustment' end,signed,c.id,row.id,case when action='reversal' then 'Cash Checkout reversal' else 'Cash Checkout adjustment' end,now(),auth.uid());
 return jsonb_build_object('adjustment',to_jsonb(row),'current_balance',public.crew_cash_balance(c.outlet_id));
end; $function$
;

CREATE OR REPLACE FUNCTION public.crew_cash_record_collection(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; employee uuid; outlet uuid; receiver uuid; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype;
begin
 ctx:=public.crew_operations_employee_context(p_token);
 employee:=(ctx->>'employee_id')::uuid;
 outlet:=(ctx->>'outlet_id')::uuid;
 if not public.crew_can_initiate_cash_handover(employee,outlet) then raise exception using errcode='42501',message='You do not have permission to hand over Cash Deposit funds.'; end if;
 receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
 if receiver is null or not public.crew_cash_receiver_is_eligible(outlet,receiver) then raise exception using errcode='42501',message='Receiver is not approved for this outlet.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(outlet::text,0));
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
$function$
;

CREATE OR REPLACE FUNCTION public.crew_cash_admin_record_collection(p_outlet_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare receiver uuid; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype; require_confirm boolean;
begin
 perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
 receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
 if receiver is null or not public.crew_cash_receiver_is_eligible(p_outlet_id,receiver) then raise exception using errcode='42501',message='Receiver is not approved for this outlet.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text,0));
 if amount is null or amount<=0 or amount>public.crew_cash_balance(p_outlet_id) then raise exception using errcode='22023',message='Amount must not exceed the Cash Deposit Balance.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',p_outlet_id,'receiver_employee_id',receiver,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext(p_outlet_id::text),hashtext(request::text));
 select * into row from public.crew_cash_collections c where c.outlet_id=p_outlet_id and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Idempotency conflict: request_id payload differs.'; end if; return to_jsonb(row); end if;
 select coalesce((select s.require_receiver_confirmation from public.crew_cash_settings s where s.outlet_id=p_outlet_id),true) into require_confirm;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,external_receiver_name,amount,received_amount,difference,purpose,note,status,handed_over_by_user_id,confirmed_at)
 values(p_outlet_id,request,fingerprint,'internal',receiver,null,amount,case when not require_confirm then amount end,0,nullif(btrim(p_payload->>'purpose'),''),nullif(btrim(p_payload->>'note'),''),case when require_confirm then 'pending_receipt' else 'completed' end,auth.uid(),case when not require_confirm then now() end) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_user_id)
 values(p_outlet_id,'collection',-row.amount,row.id,'Cash Handover',(select full_name from public.employees where id=receiver),row.submitted_at,auth.uid());
 return to_jsonb(row);
end; $function$
;
