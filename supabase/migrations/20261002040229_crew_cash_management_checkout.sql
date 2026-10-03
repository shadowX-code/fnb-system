-- Independent outlet-scoped Management Checkout eligibility; existing cash calculations and handover authorities remain canonical.
do $guard$
begin
 if md5(pg_get_functiondef('public.crew_cash_save_settings(uuid,jsonb)'::regprocedure)) <> '3a9f3e9ca1345cedd634b5681cb9fa5f' then raise exception 'Reviewed crew_cash_save_settings baseline differs'; end if;
 if md5(pg_get_functiondef('public.crew_cash_save_checkout(text,text,jsonb)'::regprocedure)) <> 'f862bb88a0091362f683606ba11bb4a9' then raise exception 'Reviewed crew_cash_save_checkout baseline differs'; end if;
 if md5(pg_get_functiondef('public.crew_cash_mobile_projection_source(text,date)'::regprocedure)) <> '09d29c51e69bb224bf89f0c7e7f4aeb8' then raise exception 'Reviewed crew_cash_mobile_projection_source baseline differs'; end if;
 if md5(pg_get_functiondef('public.crew_cash_checkout_history(text,date)'::regprocedure)) <> 'bba7679aa4672266a87bd2cf40379666' then raise exception 'Reviewed crew_cash_checkout_history baseline differs'; end if;
 if md5(pg_get_functiondef('public.crew_outlet_scope(text)'::regprocedure)) <> '7709b9431d46590f5dc3f3a84840b801' then raise exception 'Reviewed crew_outlet_scope baseline differs'; end if;
 if md5(pg_get_functiondef('public.crew_management_cash_mobile(text,uuid,date)'::regprocedure)) <> '4e7bbc5a2ef316e7e284de6616f871a5' then raise exception 'Reviewed crew_management_cash_mobile baseline differs'; end if;
end; $guard$;

alter table public.crew_cash_settings add column allow_authorized_management_checkout boolean not null default false;

create function public.crew_cash_can_perform_checkout(p_employee_id uuid,p_outlet_id uuid)
returns boolean language sql stable security definer set search_path='' as $function$
 select exists(
  select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id
  left join public.crew_cash_settings s on s.outlet_id=p_outlet_id
  where e.id=p_employee_id and e.is_active
   and coalesce(e.employment_status,'active') not in ('resigned','terminated')
   and ca.access_state='active'
   and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id))
   and (
    (lower(btrim(coalesce(e.workplace,'')))='management' and ca.primary_outlet_id is null
      and coalesce(s.allow_authorized_management_checkout,false))
    or (lower(btrim(coalesce(e.workplace,'')))<>'management'
      and ca.primary_outlet_id=p_outlet_id and public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and public.crew_cash_employee_has_permission(e.id,'crew_cash_checkout.perform')
      and (s.id is null or cardinality(s.required_positions)=0 or e.position=any(s.required_positions)))
   )
 );
$function$;
revoke all on function public.crew_cash_can_perform_checkout(uuid,uuid) from public,anon,authenticated;

-- This context is cash-only. It does not broaden Task execution or Handover scope.
create function public.crew_cash_employee_context(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare employee uuid:=public.crew_session_employee(p_token); e public.employees%rowtype; outlet uuid;
begin
 select * into e from public.employees where id=employee;
 if lower(btrim(coalesce(e.workplace,'')))<>'management' then
  return public.crew_operations_employee_context(p_token);
 end if;
 outlet:=coalesce(nullif(current_setting('feedx.crew_management_cash_outlet',true),''),nullif(current_setting('feedx.crew_management_handover_outlet',true),''))::uuid;
 perform public.crew_selected_outlet(p_token,outlet);
 if not (public.crew_cash_can_perform_checkout(employee,outlet) or public.crew_can_initiate_cash_handover(employee,outlet)) then
  raise exception using errcode='42501',message='Cash access is unavailable for this outlet.';
 end if;
 return jsonb_build_object('employee_id',e.id,'employee_name',e.full_name,'position',e.position,'role_id',e.role_id,'outlet_id',outlet);
end; $function$;
revoke all on function public.crew_cash_employee_context(text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crew_cash_save_settings(p_outlet_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_row public.crew_cash_settings%rowtype;
  next_float numeric;
  current_effective_float numeric;
  effective date;
  reason text;
  positions_supplied boolean;
  next_position_ids uuid[];
  next_position_names text[];
  previous_management_checkout boolean;
begin
  perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_checkout.manage');
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023',message='Cash settings payload is invalid.';
  end if;
  if p_payload ? 'required_position_ids' and jsonb_typeof(p_payload->'required_position_ids')<>'array' then
    raise exception using errcode='22023',message='Checkout position IDs must be an array.';
  end if;
  if p_payload ? 'required_positions' and jsonb_typeof(p_payload->'required_positions')<>'array' then
    raise exception using errcode='22023',message='Checkout positions must be an array.';
  end if;

  if p_payload ? 'allow_authorized_management_checkout' and jsonb_typeof(p_payload->'allow_authorized_management_checkout')<>'boolean' then
    raise exception using errcode='22023',message='Management Checkout eligibility must be a boolean.';
  end if;

  select * into current_row
  from public.crew_cash_settings
  where outlet_id=p_outlet_id
  for update;
  previous_management_checkout:=coalesce(current_row.allow_authorized_management_checkout,false);

  current_effective_float:=public.crew_cash_float_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date);
  next_float:=coalesce((p_payload->>'floating_cash')::numeric,current_effective_float,0);
  effective:=coalesce((p_payload->>'effective_date')::date,timezone('Asia/Kuala_Lumpur',now())::date);
  reason:=nullif(btrim(p_payload->>'reason'),'');
  positions_supplied:=p_payload ? 'required_position_ids' or p_payload ? 'required_positions';

  if next_float<0 or coalesce((p_payload->>'variance_tolerance')::numeric,current_row.variance_tolerance,0)<0 then
    raise exception using errcode='22023',message='Cash settings amounts cannot be negative.';
  end if;
  if next_float is distinct from current_effective_float and reason is null then
    raise exception using errcode='22023',message='A reason is required when Floating Cash changes.';
  end if;

  if p_payload ? 'required_position_ids' then
    select coalesce(array_agg(value::uuid order by ordinal), '{}'::uuid[])
    into next_position_ids
    from jsonb_array_elements_text(p_payload->'required_position_ids') with ordinality item(value,ordinal);
  elsif p_payload ? 'required_positions' then
    select coalesce(array_agg(jp.id order by item.ordinal), '{}'::uuid[])
    into next_position_ids
    from jsonb_array_elements_text(p_payload->'required_positions') with ordinality item(value,ordinal)
    join public.job_positions jp on lower(jp.name)=lower(item.value);
    if cardinality(next_position_ids) <> jsonb_array_length(p_payload->'required_positions') then
      raise exception using errcode='22023',message='Every Checkout Position must match a canonical Job Position.';
    end if;
  else
    next_position_ids:=coalesce(current_row.required_position_ids,'{}'::uuid[]);
  end if;

  if positions_supplied and exists (
    select 1 from unnest(next_position_ids) configured(id)
    where not exists (select 1 from public.job_positions jp where jp.id=configured.id)
  ) then
    raise exception using errcode='22023',message='Every Checkout Position must match a canonical Job Position.';
  end if;

  if positions_supplied then
    select coalesce(array_agg(jp.name order by configured.ordinal), '{}'::text[])
    into next_position_names
    from unnest(next_position_ids) with ordinality configured(id,ordinal)
    join public.job_positions jp on jp.id=configured.id;
  else
    next_position_names:=coalesce(current_row.required_positions,'{}'::text[]);
  end if;

  if current_row.id is null then
    insert into public.crew_cash_settings(
      outlet_id,floating_cash,variance_tolerance,required_positions,required_position_ids,allow_authorized_management_checkout,
      closing_deadline,require_receiver_confirmation,require_manager_review_over_tolerance,created_by,updated_by
    ) values(
      p_outlet_id,next_float,coalesce((p_payload->>'variance_tolerance')::numeric,0),next_position_names,next_position_ids,coalesce((p_payload->>'allow_authorized_management_checkout')::boolean,false),
      nullif(p_payload->>'closing_deadline','')::time,coalesce((p_payload->>'require_receiver_confirmation')::boolean,true),
      coalesce((p_payload->>'require_manager_review_over_tolerance')::boolean,true),auth.uid(),auth.uid()
    ) returning * into current_row;
  else
    update public.crew_cash_settings set
      floating_cash=case when p_payload ? 'floating_cash' then next_float else floating_cash end,
      variance_tolerance=coalesce((p_payload->>'variance_tolerance')::numeric,variance_tolerance),
      required_positions=case when positions_supplied then next_position_names else required_positions end,
      required_position_ids=case when positions_supplied then next_position_ids else required_position_ids end,
      allow_authorized_management_checkout=coalesce((p_payload->>'allow_authorized_management_checkout')::boolean,allow_authorized_management_checkout),
      closing_deadline=case when p_payload ? 'closing_deadline' then nullif(p_payload->>'closing_deadline','')::time else closing_deadline end,
      require_receiver_confirmation=coalesce((p_payload->>'require_receiver_confirmation')::boolean,require_receiver_confirmation),
      require_manager_review_over_tolerance=coalesce((p_payload->>'require_manager_review_over_tolerance')::boolean,require_manager_review_over_tolerance),
      updated_at=now(),updated_by=auth.uid()
    where id=current_row.id
    returning * into current_row;
  end if;

  if next_float is distinct from current_effective_float then
    insert into public.crew_cash_float_adjustments(outlet_id,previous_amount,new_amount,effective_date,reason,adjusted_by)
    values(p_outlet_id,current_effective_float,next_float,effective,reason,auth.uid());
  end if;

  if previous_management_checkout is distinct from current_row.allow_authorized_management_checkout then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('crew_cash_management_checkout_eligibility_updated','crew',auth.uid(),'Outlet Management Cash Checkout eligibility updated.',
      jsonb_build_object('outlet_id',p_outlet_id,'actor_id',auth.uid(),'before',previous_management_checkout,'after',current_row.allow_authorized_management_checkout));
  end if;
  return to_jsonb(current_row) || jsonb_build_object('effective_floating_cash',public.crew_cash_float_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date));
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_cash_save_checkout(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; c public.crew_cash_checkouts%rowtype;
 counts jsonb; counted numeric; float_amount numeric; previous_carry numeric; expected_open numeric; actual_open numeric; pos_expected numeric; carry numeric;
 variance_amount numeric; deposit_amount numeric; shortfall numeric; needs_review boolean; action text; opening_reason text;
 opening_expected numeric; opening_previous numeric; supplied_open numeric;
begin
 ctx:=public.crew_cash_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position'; action:=lower(btrim(p_action));
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 if not public.crew_cash_can_perform_checkout(employee,outlet) then raise exception using errcode='42501',message='Cash Checkout is unavailable for your outlet eligibility.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['checked_out_by','checked_out_by_employee_id','counted_cash','variance','amount_for_deposit','status','review_status','completed_at'] then raise exception using errcode='22023',message='Cash Checkout payload contains server-controlled fields.'; end if;
 if action<>all(array['draft','reconcile','submit','complete']) then raise exception using errcode='22023',message='Unsupported Cash Checkout action.'; end if;
 select * into c from public.crew_cash_checkouts x where x.outlet_id=outlet and x.business_date=timezone('Asia/Kuala_Lumpur',now())::date for update;
 if c.id is not null and c.status='completed' then raise exception using errcode='22023',message='Completed Cash Checkout is immutable.'; end if;
 if c.id is not null and c.checked_out_by_employee_id<>employee then raise exception using errcode='42501',message='Today''s Cash Checkout is already owned by another Crew member.'; end if;
 if action in ('submit','complete') and (c.id is null or c.status<>'reconciled') then raise exception using errcode='22023',message='Reconcile Cash Checkout before submitting it.'; end if;
 if action='reconcile' and c.id is not null and c.status not in ('draft','reconciled') then raise exception using errcode='22023',message='This Cash Checkout cannot be reconciled in its current state.'; end if;
 float_amount:=public.crew_cash_float_at(outlet,timezone('Asia/Kuala_Lumpur',now())::date);
 previous_carry:=public.crew_cash_previous_carry(outlet,timezone('Asia/Kuala_Lumpur',now())::date);
 expected_open:=float_amount+previous_carry;
 counts:=coalesce(p_payload->'denomination_counts',c.denomination_counts,'{}'::jsonb);
 counted:=public.crew_cash_count_denominations(counts);
 opening_expected:=expected_open; opening_previous:=previous_carry;
 supplied_open:=case when p_payload ? 'actual_opening_cash' then round((p_payload->>'actual_opening_cash')::numeric,2) end;
 if p_payload ? 'actual_opening_cash' and (c.id is null or supplied_open is distinct from c.actual_opening_cash) then
  actual_open:=supplied_open;
  opening_reason:=nullif(btrim(p_payload->>'opening_variance_reason'),'');
 elsif c.id is not null and c.opening_variance_reason is not null then
  -- Keep a genuinely recorded opening exception and its original basis intact.
  actual_open:=c.actual_opening_cash; opening_reason:=c.opening_variance_reason;
  opening_expected:=c.expected_opening_cash; opening_previous:=c.previous_carry_forward;
 else
  -- The Crew flow does not measure Actual Opening. Earlier clients populated it
  -- with the expected value; that synthetic default is not variance evidence.
  actual_open:=null; opening_reason:=null;
 end if;
 pos_expected:=case when p_payload ? 'pos_expected_cash' then round((p_payload->>'pos_expected_cash')::numeric,2) else c.pos_expected_cash end;
 carry:=coalesce(case when p_payload ? 'carry_forward' then (p_payload->>'carry_forward')::numeric else c.carry_forward end,0);
 if actual_open is not null and actual_open<0 or pos_expected is not null and pos_expected<0 or carry<0 then raise exception using errcode='22023',message='Cash values cannot be negative.'; end if;
 if actual_open is not null and actual_open is distinct from opening_expected and opening_reason is null then raise exception using errcode='22023',message='Explain the opening cash variance.'; end if;
 variance_amount:=case when pos_expected is null then null else counted-pos_expected end;
 shortfall:=greatest(float_amount-counted,0);
 if shortfall>0 then carry:=0; deposit_amount:=0;
 else if carry>counted-float_amount then raise exception using errcode='22023',message='Carry Forward cannot exceed cash remaining after Floating Cash.'; end if; deposit_amount:=counted-float_amount-carry; end if;
 needs_review:=shortfall>0 or (coalesce(settings.require_manager_review_over_tolerance,true) and variance_amount is not null and abs(variance_amount)>coalesce(settings.variance_tolerance,0));
 if action in ('reconcile','submit','complete') and pos_expected is null then raise exception using errcode='22023',message='POS Expected Cash is required to reconcile.'; end if;
 if needs_review and action in ('submit','complete') and nullif(btrim(coalesce(p_payload->>'variance_reason',c.variance_reason,'')),'') is null then raise exception using errcode='22023',message='Explain the cash variance before submitting.'; end if;
 if c.id is null then
  insert into public.crew_cash_checkouts(outlet_id,business_date,checked_out_by_employee_id,floating_cash,previous_carry_forward,expected_opening_cash,actual_opening_cash,opening_variance,opening_variance_reason,denomination_counts,counted_cash,pos_expected_cash,variance,reconciliation_status,carry_forward,amount_for_deposit,float_shortfall,variance_tolerance,review_required,variance_reason,review_status,status,reconciled_at,submitted_at)
  values(outlet,timezone('Asia/Kuala_Lumpur',now())::date,employee,float_amount,opening_previous,opening_expected,actual_open,case when actual_open is null then null else actual_open-opening_expected end,case when actual_open is not distinct from opening_expected then null else opening_reason end,counts,counted,pos_expected,variance_amount,case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,carry,deposit_amount,shortfall,coalesce(settings.variance_tolerance,0),needs_review,nullif(btrim(p_payload->>'variance_reason'),''),case when needs_review then 'pending' else 'not_required' end,case action when 'draft' then 'draft' when 'reconcile' then 'reconciled' else 'submitted' end,case when action<>'draft' then now() end,case when action in('submit','complete') then now() end)
  returning * into c;
 else
  update public.crew_cash_checkouts set floating_cash=float_amount,previous_carry_forward=opening_previous,expected_opening_cash=opening_expected,actual_opening_cash=actual_open,opening_variance=case when actual_open is null then null else actual_open-opening_expected end,
   opening_variance_reason=case when actual_open is not distinct from opening_expected then null else opening_reason end,denomination_counts=counts,counted_cash=counted,
   pos_expected_cash=pos_expected,variance=variance_amount,reconciliation_status=case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,
   carry_forward=carry,amount_for_deposit=deposit_amount,float_shortfall=shortfall,variance_tolerance=coalesce(settings.variance_tolerance,0),review_required=needs_review,
   variance_reason=coalesce(nullif(btrim(p_payload->>'variance_reason'),''),variance_reason),review_status=case when needs_review then 'pending' else 'not_required' end,
   status=case action when 'draft' then status when 'reconcile' then 'reconciled' else 'submitted' end,
   reconciled_at=case when action<>'draft' then coalesce(reconciled_at,now()) else reconciled_at end,submitted_at=case when action in('submit','complete') then coalesce(submitted_at,now()) else submitted_at end,updated_at=now()
  where id=c.id returning * into c;
 end if;
 if action='complete' then
  if c.review_required then raise exception using errcode='22023',message='Cash Checkout requires manager review before completion.'; end if;
  update public.crew_cash_checkouts set status='completed',completed_at=now(),updated_at=now() where id=c.id returning * into c;
  perform public.crew_cash_append_checkout_ledger(c.id,null);
 end if;
 return jsonb_build_object('checkout',to_jsonb(c),'deposit_balance',public.crew_cash_balance(outlet));
end; $function$;

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
 select jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'checked_out_by',e.full_name,'floating_cash',c.floating_cash,'previous_carry_forward',c.previous_carry_forward,'expected_opening_cash',c.expected_opening_cash,'actual_opening_cash',c.actual_opening_cash,'opening_variance',c.opening_variance,'opening_variance_reason',c.opening_variance_reason,'denomination_counts',c.denomination_counts,'counted_cash',c.counted_cash,'pos_expected_cash',c.pos_expected_cash,'variance',c.variance,'reconciliation_status',c.reconciliation_status,'carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit,'float_shortfall',c.float_shortfall,'review_required',c.review_required,'review_status',c.review_status,'variance_reason',c.variance_reason,'completed_at',c.completed_at) into checkout from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=outlet and c.business_date=p_business_date;
 return jsonb_build_object('outlet',jsonb_build_object('id',outlet,'name',coalesce((select o.name from public.outlets o where o.id=outlet),ctx->>'outlet_name')),'business_date',p_business_date,'can_perform',can_perform,'can_record_collection',can_collect,'settings',jsonb_build_object('floating_cash',floating,'variance_tolerance',coalesce(settings.variance_tolerance,0),'closing_deadline',settings.closing_deadline),'cash_context',jsonb_build_object('floating_cash',floating,'previous_carry_forward',previous_carry,'expected_opening_cash',floating + previous_carry),'checkout',checkout,'deposit',jsonb_build_object('current_balance',public.crew_cash_balance(outlet),'pending_confirmation_amount',coalesce((select sum(c.amount) from public.crew_cash_collections c where c.outlet_id=outlet and c.status='pending_receipt'),0),'recent',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 3)x),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 100)x),'[]'::jsonb)),'receivers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name) from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=outlet and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb),'pending_receipts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'sender',coalesce(se.full_name,'Admin'),'submitted_at',c.submitted_at) order by c.submitted_at desc) from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt'),'[]'::jsonb));
end; $function$;

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
    ) order by c.business_date desc, c.completed_at desc)
    from public.crew_cash_checkouts c
    join public.employees e on e.id = c.checked_out_by_employee_id
    where c.outlet_id = outlet
      and c.status = 'completed'
      and c.business_date between p_business_date - 29 and p_business_date
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_outlet_scope(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
  v_employee public.employees%rowtype; v_ids uuid[]; v_outlets jsonb;
  v_default uuid; v_management boolean;
begin
  select * into v_employee from public.employees where id=v_employee_id;
  v_management:=lower(btrim(coalesce(v_employee.workplace,'')))='management';
  v_ids:=public.crew_authorized_outlet_ids(v_employee_id);
  if cardinality(v_ids)=0 then
    raise exception using errcode='42501',message='Crew Access is no longer active. Please sign in again.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,
      'special_access',public.crew_special_access_for_outlet(v_employee_id,o.id),
      'can_perform_cash_checkout',public.crew_cash_can_perform_checkout(v_employee_id,o.id),
      'is_cash_handover_receiver',public.crew_cash_receiver_is_eligible(o.id,v_employee_id)
        or exists(select 1 from public.crew_cash_collections c where c.outlet_id=o.id
          and c.receiver_employee_id=v_employee_id and c.status='pending_receipt'))
      order by o.name,o.id),'[]'::jsonb),
    (array_agg(o.id order by o.name,o.id))[1]
  into v_outlets,v_default from public.outlets o where o.id=any(v_ids);
  return jsonb_build_object('employee_id',v_employee_id,'management',v_management,
    'outlets',v_outlets,'default_outlet_id',v_default);
end; $function$;

CREATE OR REPLACE FUNCTION public.crew_management_cash_mobile(p_token text, p_outlet_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee uuid:=public.crew_session_employee(p_token); v_payload jsonb; v_pending jsonb; v_receiver boolean; v_outlet_name text; v_checkout boolean;
begin
 if not exists(select 1 from public.employees e where e.id=v_employee and lower(btrim(coalesce(e.workplace,'')))='management') then
  raise exception using errcode='42501',message='Management Cash access is unavailable.';
 end if;
 perform public.crew_selected_outlet(p_token,p_outlet_id);
 v_checkout:=public.crew_cash_can_perform_checkout(v_employee,p_outlet_id);
 if v_checkout or public.crew_can_initiate_cash_handover(v_employee,p_outlet_id) then
  perform set_config('feedx.crew_management_cash_outlet',p_outlet_id::text,true);
  v_payload:=public.crew_cash_mobile(p_token,p_business_date);
  if v_checkout then
   return v_payload || jsonb_build_object('read_only_checkout',false,'checkout_history',public.crew_cash_checkout_history(p_token,p_business_date));
  end if;
  return (v_payload - 'checkout' - 'cash_context' - 'settings')
   || jsonb_build_object('can_perform',false,'checkout',null,'read_only_checkout',true);
 end if;
 v_receiver:=public.crew_cash_receiver_is_eligible(p_outlet_id,v_employee)
  or exists(select 1 from public.crew_cash_collections c where c.outlet_id=p_outlet_id and c.receiver_employee_id=v_employee and c.status='pending_receipt');
 if not v_receiver then raise exception using errcode='42501',message='Cash Handover access is unavailable.'; end if;
 select o.name into v_outlet_name from public.outlets o where o.id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'note',c.note,
  'sender',coalesce(sender.full_name,admin_sender.full_name,'Admin'),'outlet_name',v_outlet_name,
  'occurred_at',c.submitted_at) order by c.submitted_at desc),'[]'::jsonb) into v_pending
 from public.crew_cash_collections c
 left join public.employees sender on sender.id=c.handed_over_by_employee_id
 left join public.employees admin_sender on admin_sender.auth_user_id=c.handed_over_by_user_id
 where c.outlet_id=p_outlet_id and c.receiver_employee_id=v_employee and c.status='pending_receipt';
 return jsonb_build_object('outlet',jsonb_build_object('id',p_outlet_id,'name',v_outlet_name),
  'business_date',p_business_date,'can_perform',false,'can_record_collection',false,'can_initiate_handover',false,
  'checkout',null,'read_only_checkout',true,'deposit',null,'receivers','[]'::jsonb,
  'is_cash_handover_receiver',true,'pending_receipts',v_pending);
end; $function$;

-- Outlet adapter delegates the existing Count/Allocate/Confirm mutation and actor authority.
create function public.crew_management_cash_save_checkout(p_token text,p_outlet_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare employee uuid:=public.crew_session_employee(p_token);
begin
 if not exists(select 1 from public.employees where id=employee and lower(btrim(coalesce(workplace,'')))='management') then
  raise exception using errcode='42501',message='Management Checkout access is unavailable.';
 end if;
 perform public.crew_selected_outlet(p_token,p_outlet_id);
 if not public.crew_cash_can_perform_checkout(employee,p_outlet_id) then
  raise exception using errcode='42501',message='Management Cash Checkout is disabled for this outlet.';
 end if;
 perform set_config('feedx.crew_management_cash_outlet',p_outlet_id::text,true);
 return public.crew_cash_save_checkout(p_token,p_action,p_payload);
end; $function$;
revoke all on function public.crew_management_cash_save_checkout(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_management_cash_save_checkout(text,uuid,text,jsonb) to anon,authenticated;
