do $$ begin
if md5(pg_get_functiondef('public.crew_cash_checkout_allocation(uuid)'::regprocedure))<>'2b075b8aaa6cfc9efa9cb4882ed34321' then raise exception 'Cross-day baseline drift: crew_cash_checkout_allocation(uuid)'; end if;
if md5(pg_get_functiondef('public.crew_cash_previous_carry(uuid,date)'::regprocedure))<>'d69e0af8cf8c4cac65b2db3ebf06eb31' then raise exception 'Cross-day baseline drift: crew_cash_previous_carry(uuid,date)'; end if;
if md5(pg_get_functiondef('public.crew_cash_save_checkout(text,text,jsonb)'::regprocedure))<>'f5d87ea902db68557c5a57f076d74b14' then raise exception 'Cross-day baseline drift: crew_cash_save_checkout(text,text,jsonb)'; end if;
if md5(pg_get_functiondef('public.crew_cash_review_checkout(uuid,text,text)'::regprocedure))<>'3644da6ebb5ef0305c75dd103961259b' then raise exception 'Cross-day baseline drift: crew_cash_review_checkout(uuid,text,text)'; end if;
if md5(pg_get_functiondef('public.crew_cash_protect_completed_checkout()'::regprocedure))<>'5b95e1ccb5b0df6e1bbb95207d6039d4' then raise exception 'Cross-day baseline drift: crew_cash_protect_completed_checkout()'; end if;
if md5(pg_get_functiondef('public.crew_cash_capture_review_event()'::regprocedure))<>'963a4973f8941a8469ffa81adb5a6fcb' then raise exception 'Cross-day baseline drift: crew_cash_capture_review_event()'; end if;
if md5(pg_get_functiondef('public.crew_cash_mobile_projection_source(text,date)'::regprocedure))<>'7ad0c77943937310290d7aad5b9e23ff' then raise exception 'Cross-day baseline drift: crew_cash_mobile_projection_source(text,date)'; end if;
if md5(pg_get_functiondef('public.crew_cash_checkout_history(text,date)'::regprocedure))<>'8d7ac17aa36e3567c31281a2601d1432' then raise exception 'Cross-day baseline drift: crew_cash_checkout_history(text,date)'; end if;
if md5(pg_get_functiondef('public.crew_cash_admin_context(uuid)'::regprocedure))<>'0e0d7502ac534bb0cc404ff9d9cdbaac' then raise exception 'Cross-day baseline drift: crew_cash_admin_context(uuid)'; end if;
end $$;

-- In this authority reconciled is the mutable Allocate step; only completed is finalized.
alter table public.crew_cash_checkouts drop constraint crew_cash_checkouts_status_check;
alter table public.crew_cash_checkouts add constraint crew_cash_checkouts_status_check check(status in ('draft','reconciled','submitted','completed','cancelled'));
alter table public.crew_cash_checkout_review_events drop constraint crew_cash_checkout_review_events_event_check;
alter table public.crew_cash_checkout_review_events add constraint crew_cash_checkout_review_events_event_check check(event in ('submitted','resubmitted','returned','approved','completed','cancelled','basis_changed','basis_reviewed'));
alter table public.crew_cash_checkout_review_events drop constraint crew_cash_checkout_review_events_check;
alter table public.crew_cash_checkout_review_events add constraint crew_cash_checkout_review_events_check check(
 (event in ('submitted','resubmitted') and actor_employee_id is not null) or
 (event in ('returned','cancelled') and (actor_user_id is not null or actor_employee_id is not null) and char_length(btrim(reason))>0) or
 event in ('approved','completed','basis_changed','basis_reviewed'));
CREATE OR REPLACE FUNCTION public.crew_cash_allocation_values(p_checkout_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'carry_forward',coalesce(a.allocation_after->'carry_forward',to_jsonb(c.carry_forward)),
  'amount_for_deposit',coalesce(a.allocation_after->'amount_for_deposit',to_jsonb(c.amount_for_deposit)),
  'allocation_correction_id',a.id,
  'allocation_original',jsonb_build_object('carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit),
  'allocation_corrections',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'original',h.allocation_original,'before',h.allocation_before,'after',h.allocation_after,
   'previous_correction_id',h.previous_allocation_id,'actor_user_id',h.actor_user_id,'actor_name',coalesce((select e.full_name from public.employees e where e.auth_user_id=h.actor_user_id order by e.id limit 1),'Admin'),
   'created_at',h.created_at,'reason',h.reason,'signed_amount',h.signed_amount) order by h.created_at,h.id)
   from public.crew_cash_checkout_adjustments h where h.checkout_id=c.id and h.action='allocation'),'[]'::jsonb))||public.crew_cash_checkout_review_projection(c.id)
 from public.crew_cash_checkouts c left join lateral (
  select x.* from public.crew_cash_checkout_adjustments x where x.checkout_id=c.id and x.action='allocation'
   and not exists(select 1 from public.crew_cash_checkout_adjustments successor where successor.previous_allocation_id=x.id)
 ) a on true where c.id=p_checkout_id;
$function$
;
revoke all on function public.crew_cash_allocation_values(uuid) from public,anon,authenticated;

create function public.crew_cash_chain_context(p_outlet uuid,p_date date,p_checkout uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('previous_unresolved',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'is_returned',c.review_status='rejected','checked_out_by_employee_id',c.checked_out_by_employee_id,'checked_out_by',e.full_name,'return_reason',case when c.review_status='rejected' then c.review_note end) order by c.business_date) from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=p_outlet and c.business_date<p_date and c.status not in ('completed','cancelled')),'[]'::jsonb),
 'resolved_carry',coalesce((select case when c.status='cancelled' then 0 else (public.crew_cash_allocation_values(c.id)->>'carry_forward')::numeric end from public.crew_cash_checkouts c where c.outlet_id=p_outlet and c.business_date<p_date and c.status in ('completed','cancelled') order by c.business_date desc limit 1),0),
 'basis_review_required',coalesce((select c.status not in ('completed','cancelled') and (
 c.previous_carry_forward is distinct from coalesce((select case when prior.status='cancelled' then 0 else (public.crew_cash_allocation_values(prior.id)->>'carry_forward')::numeric end from public.crew_cash_checkouts prior where prior.outlet_id=c.outlet_id and prior.business_date<c.business_date and prior.status in ('completed','cancelled') order by prior.business_date desc limit 1),0)
 or exists(select 1 from public.crew_cash_checkout_review_events h where h.checkout_id=c.id and h.event='basis_changed' and h.id>coalesce((select max(v.id) from public.crew_cash_checkout_review_events v where v.checkout_id=c.id and v.event='basis_reviewed'),0))) from public.crew_cash_checkouts c where c.id=p_checkout),false));
$$;
revoke all on function public.crew_cash_chain_context(uuid,date,uuid) from public,anon,authenticated;
create function public.crew_cash_record_basis_changes(p_outlet uuid,p_date date,p_employee uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.crew_cash_checkouts%rowtype; context jsonb;
begin
 -- The calling authorities hold the shared outlet lock. Preserve every financial field.
 for c in select * from public.crew_cash_checkouts where outlet_id=p_outlet and business_date>p_date and status not in ('completed','cancelled') order by business_date for update loop
  context:=public.crew_cash_chain_context(c.outlet_id,c.business_date,c.id);
  if c.previous_carry_forward is distinct from (context->>'resolved_carry')::numeric then
   insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_employee_id,actor_user_id,reason,snapshot)
   values(c.id,'basis_changed',p_employee,p_user,'Earlier checkout resolution changed the carry basis; recorded opening evidence requires review.',jsonb_build_object('checkout',to_jsonb(c),'resolved_carry',context->'resolved_carry','previous_unresolved',context->'previous_unresolved'));
  end if;
 end loop;
end $$;
revoke all on function public.crew_cash_record_basis_changes(uuid,date,uuid,uuid) from public,anon,authenticated;
create function public.crew_cash_assert_previous_resolved(p_outlet uuid,p_date date) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.crew_cash_checkouts where outlet_id=p_outlet and business_date<p_date and status not in ('completed','cancelled')) then raise exception using errcode='22023',message='Previous Day · Action Required. Complete or cancel earlier Cash Checkouts before finalizing this checkout.'; end if;
end $$;
revoke all on function public.crew_cash_assert_previous_resolved(uuid,date) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.crew_cash_checkout_allocation(p_checkout_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.crew_cash_allocation_values(c.id)||public.crew_cash_chain_context(c.outlet_id,c.business_date,c.id)||jsonb_build_object(
 'is_previous_day',c.business_date<timezone('Asia/Kuala_Lumpur',now())::date and c.status not in ('completed','cancelled'),
 'cancellation',coalesce((select jsonb_build_object('reason',h.reason,'occurred_at',h.occurred_at,'actor_name',coalesce(e.full_name,a.full_name,'Admin')) from public.crew_cash_checkout_review_events h left join public.employees e on e.id=h.actor_employee_id left join public.employees a on a.auth_user_id=h.actor_user_id where h.checkout_id=c.id and h.event='cancelled' order by h.id limit 1),'null'::jsonb))
 ||case when c.status='cancelled' then jsonb_build_object('is_returned',false,'carry_forward',0,'amount_for_deposit',0) else '{}'::jsonb end
 from public.crew_cash_checkouts c where c.id=p_checkout_id;
$function$;
CREATE OR REPLACE FUNCTION public.crew_cash_previous_carry(p_outlet_id uuid, p_date date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select case when jsonb_array_length(public.crew_cash_chain_context(p_outlet_id,p_date)->'previous_unresolved')>0 then null else (public.crew_cash_chain_context(p_outlet_id,p_date)->>'resolved_carry')::numeric end;
$function$;
CREATE OR REPLACE FUNCTION public.crew_cash_protect_completed_checkout()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 if old.status in ('completed','cancelled') then raise exception using errcode='22023',message='Terminal Cash Checkout is immutable.'; end if;
 if old.status='submitted' and tg_op='UPDATE' and (to_jsonb(old)-array['status','review_status','review_note','reviewed_by','reviewed_at','completed_at','updated_at']) is distinct from (to_jsonb(new)-array['status','review_status','review_note','reviewed_by','reviewed_at','completed_at','updated_at']) then raise exception using errcode='22023',message='Submitted financial evidence is immutable until returned to Crew.'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.crew_cash_save_checkout(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; c public.crew_cash_checkouts%rowtype;
 counts jsonb; counted numeric; float_amount numeric; previous_carry numeric; expected_open numeric; actual_open numeric; pos_expected numeric; carry numeric;
 variance_amount numeric; deposit_amount numeric; shortfall numeric; needs_review boolean; action text; opening_reason text;
 opening_expected numeric; opening_previous numeric; supplied_open numeric; business_day date:=timezone('Asia/Kuala_Lumpur',now())::date; correction_run boolean:=false; financial_review boolean;
begin
 ctx:=public.crew_cash_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position'; action:=lower(btrim(p_action));
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 if not public.crew_cash_can_perform_checkout(employee,outlet) then raise exception using errcode='42501',message='Cash Checkout is unavailable for your outlet eligibility.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['checked_out_by','checked_out_by_employee_id','counted_cash','variance','amount_for_deposit','status','review_status','completed_at'] then raise exception using errcode='22023',message='Cash Checkout payload contains server-controlled fields.'; end if;
 if action<>all(array['draft','reconcile','submit','complete','cancel']) then raise exception using errcode='22023',message='Unsupported Cash Checkout action.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(outlet::text,0));
 if p_payload ? 'checkout_id' then
  select * into c from public.crew_cash_checkouts x where x.id=(p_payload->>'checkout_id')::uuid and x.outlet_id=outlet for update;
  if c.id is null then raise exception using errcode='42501',message='Cash Checkout is unavailable for this outlet.'; end if;
  correction_run:=exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=c.id and event='returned') or c.review_status='rejected';
  business_day:=c.business_date;
 else
  select * into c from public.crew_cash_checkouts x where x.outlet_id=outlet and x.business_date=business_day for update;
  correction_run:=coalesce(c.review_status='rejected',false) or exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=c.id and event='returned');
 end if;
 if action='cancel' then
  if c.id is null or c.status in ('completed','cancelled') then raise exception using errcode='22023',message='Only unresolved Cash Checkouts can be cancelled.'; end if;
  if c.checked_out_by_employee_id<>employee then raise exception using errcode='42501',message='Only the submitting employee may cancel this checkout.'; end if;
  if char_length(btrim(coalesce(p_payload->>'reason',''))) not between 3 and 500 then raise exception using errcode='22023',message='A cancellation reason of 3 to 500 characters is required.'; end if;
  perform set_config('feedx.crew_cash_cancellation_employee',employee::text,true);
  update public.crew_cash_checkouts set status='cancelled',review_note=btrim(p_payload->>'reason'),updated_at=now() where id=c.id returning * into c;
  perform set_config('feedx.crew_cash_cancellation_employee','',true);
  return jsonb_build_object('checkout',to_jsonb(c)||public.crew_cash_checkout_allocation(c.id));
 end if;
 if c.id is not null and c.status='submitted' then raise exception using errcode='22023',message='Submitted Cash Checkout is read-only until returned by a Manager.'; end if;

 if c.id is not null and c.status in ('completed','cancelled') then raise exception using errcode='22023',message='Terminal Cash Checkout is immutable.'; end if;
 if c.id is not null and c.checked_out_by_employee_id<>employee then raise exception using errcode='42501',message='Today''s Cash Checkout is already owned by another Crew member.'; end if;
 if action in ('submit','complete') and (c.id is null or c.status<>'reconciled') then raise exception using errcode='22023',message='Reconcile Cash Checkout before submitting it.'; end if;
 if action='reconcile' and c.id is not null and c.status not in ('draft','reconciled') then raise exception using errcode='22023',message='This Cash Checkout cannot be reconciled in its current state.'; end if;
 float_amount:=case when c.id is not null then c.floating_cash else public.crew_cash_float_at(outlet,business_day) end;
 previous_carry:=case when c.id is not null then c.previous_carry_forward else coalesce(public.crew_cash_previous_carry(outlet,business_day),0) end;
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
 financial_review:=shortfall>0 or (coalesce(settings.require_manager_review_over_tolerance,true) and variance_amount is not null and abs(variance_amount)>case when correction_run then c.variance_tolerance else coalesce(settings.variance_tolerance,0) end);
 needs_review:=financial_review or correction_run or jsonb_array_length(public.crew_cash_chain_context(outlet,business_day,c.id)->'previous_unresolved')>0 or coalesce((public.crew_cash_chain_context(outlet,business_day,c.id)->>'basis_review_required')::boolean,false);
 if action in ('reconcile','submit','complete') and pos_expected is null then raise exception using errcode='22023',message='POS Expected Cash is required to reconcile.'; end if;
 if financial_review and action in ('submit','complete') and nullif(btrim(coalesce(p_payload->>'variance_reason',c.variance_reason,'')),'') is null then raise exception using errcode='22023',message='Explain the cash variance before submitting.'; end if;
 if c.id is null then
  insert into public.crew_cash_checkouts(outlet_id,business_date,checked_out_by_employee_id,floating_cash,previous_carry_forward,expected_opening_cash,actual_opening_cash,opening_variance,opening_variance_reason,denomination_counts,counted_cash,pos_expected_cash,variance,reconciliation_status,carry_forward,amount_for_deposit,float_shortfall,variance_tolerance,review_required,variance_reason,review_status,status,reconciled_at,submitted_at)
  values(outlet,business_day,employee,float_amount,opening_previous,opening_expected,actual_open,case when actual_open is null then null else actual_open-opening_expected end,case when actual_open is not distinct from opening_expected then null else opening_reason end,counts,counted,pos_expected,variance_amount,case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,carry,deposit_amount,shortfall,case when correction_run then c.variance_tolerance else coalesce(settings.variance_tolerance,0) end,needs_review,nullif(btrim(p_payload->>'variance_reason'),''),case when needs_review then 'pending' else 'not_required' end,case action when 'draft' then 'draft' when 'reconcile' then 'reconciled' else 'submitted' end,case when action<>'draft' then now() end,case when action in('submit','complete') then now() end)
  returning * into c;
 else
  update public.crew_cash_checkouts set floating_cash=float_amount,previous_carry_forward=opening_previous,expected_opening_cash=opening_expected,actual_opening_cash=actual_open,opening_variance=case when actual_open is null then null else actual_open-opening_expected end,
   opening_variance_reason=case when actual_open is not distinct from opening_expected then null else opening_reason end,denomination_counts=counts,counted_cash=counted,
   pos_expected_cash=pos_expected,variance=variance_amount,reconciliation_status=case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,
   carry_forward=carry,amount_for_deposit=deposit_amount,float_shortfall=shortfall,variance_tolerance=case when correction_run then c.variance_tolerance else coalesce(settings.variance_tolerance,0) end,review_required=needs_review,
   variance_reason=coalesce(nullif(btrim(p_payload->>'variance_reason'),''),variance_reason),review_status=case when correction_run and action in ('draft','reconcile') then 'rejected' when needs_review then 'pending' else 'not_required' end,
   status=case action when 'draft' then case when correction_run then 'draft' else status end when 'reconcile' then 'reconciled' else 'submitted' end,
   reconciled_at=case when action<>'draft' then coalesce(reconciled_at,now()) else reconciled_at end,submitted_at=case when action in('submit','complete') then clock_timestamp() else submitted_at end,updated_at=now()
  where id=c.id returning * into c;
 end if;
 if action='complete' then
  perform public.crew_cash_assert_previous_resolved(outlet,business_day);
  if c.review_required then raise exception using errcode='22023',message='Cash Checkout requires manager review before completion.'; end if;
  update public.crew_cash_checkouts set status='completed',completed_at=now(),updated_at=now() where id=c.id returning * into c;
  perform public.crew_cash_append_checkout_ledger(c.id,null);
 end if;
 return jsonb_build_object('checkout',to_jsonb(c),'deposit_balance',public.crew_cash_balance(outlet));
end; $function$
;
CREATE OR REPLACE FUNCTION public.crew_cash_review_checkout(p_checkout_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.crew_cash_checkouts%rowtype; decision text:=lower(btrim(p_decision));
begin
 select * into c from public.crew_cash_checkouts where id=p_checkout_id;
 if c.id is not null then
  perform public.crew_cash_assert_admin(c.outlet_id,'crew_cash_checkout.review');
  perform pg_advisory_xact_lock(hashtextextended(c.outlet_id::text,0));
  select * into c from public.crew_cash_checkouts where id=p_checkout_id for update;
 end if;
 if c.id is null then raise exception using errcode='P0002',message='Cash Checkout was not found.'; end if;
 perform public.crew_cash_assert_admin(c.outlet_id,'crew_cash_checkout.review');
 if decision='cancel' then
  if c.status in ('completed','cancelled') then raise exception using errcode='22023',message='Only unresolved Cash Checkouts can be cancelled.'; end if;
  if char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then raise exception using errcode='22023',message='A cancellation reason of 3 to 500 characters is required.'; end if;
  perform set_config('feedx.crew_cash_cancellation_employee','',true);
  update public.crew_cash_checkouts set status='cancelled',review_note=btrim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=c.id returning * into c;
  return to_jsonb(c)||public.crew_cash_checkout_allocation(c.id);
 end if;
 if c.status<>'submitted' or not c.review_required or c.review_status<>'pending' then raise exception using errcode='22023',message='This Cash Checkout is not awaiting review.'; end if;
 if decision='approve' then
  perform public.crew_cash_assert_previous_resolved(c.outlet_id,c.business_date);
  if (public.crew_cash_chain_context(c.outlet_id,c.business_date,c.id)->>'basis_review_required')::boolean then
   if char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='Record the Manager review of the changed carry basis.'; end if;
   insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_user_id,reason,snapshot) values(c.id,'basis_reviewed',auth.uid(),p_note,jsonb_build_object('checkout',to_jsonb(c),'chain',public.crew_cash_chain_context(c.outlet_id,c.business_date,c.id)));
  end if;
  update public.crew_cash_checkouts set review_status='approved',review_note=nullif(btrim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now(),status='completed',completed_at=now(),updated_at=now() where id=c.id returning * into c;
  perform public.crew_cash_append_checkout_ledger(c.id,auth.uid());
 elsif decision='reject' then
  if char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then raise exception using errcode='22023',message='A return reason of 3 to 500 characters is required.'; end if;
  update public.crew_cash_checkouts set review_status='rejected',review_note=btrim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),status='reconciled',updated_at=now() where id=c.id returning * into c;
 else raise exception using errcode='22023',message='Review decision must be approve or reject.'; end if;
 return to_jsonb(c);
end; $function$
;
CREATE OR REPLACE FUNCTION public.crew_cash_capture_review_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text;
begin
 if tg_op='UPDATE' and old.status='submitted' and not exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=old.id) then
  -- Preserve the pre-existing submission at its recorded time, before any return/approval.
  insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_employee_id,occurred_at,snapshot)
  values(old.id,'submitted',old.checked_out_by_employee_id,coalesce(old.submitted_at,old.created_at),to_jsonb(old));
 end if;
 if tg_op='UPDATE' and old.review_status='rejected' and not exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=old.id) then
  if old.submitted_at is not null then
   insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_employee_id,occurred_at,snapshot)
   values(old.id,'submitted',old.checked_out_by_employee_id,old.submitted_at,to_jsonb(old));
  end if;
  if old.reviewed_by is not null and nullif(btrim(old.review_note),'') is not null then
   insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_user_id,occurred_at,reason,snapshot)
   values(old.id,'returned',old.reviewed_by,coalesce(old.reviewed_at,old.updated_at),old.review_note,to_jsonb(old));
  end if;
 end if;
 if new.status='cancelled' and (tg_op='INSERT' or old.status<>'cancelled') then kind:='cancelled';
 elsif new.status='submitted' and (tg_op='INSERT' or old.status<>'submitted') then
  kind:=case when exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=new.id and event='returned') then 'resubmitted' else 'submitted' end;
 elsif tg_op='UPDATE' and old.status='submitted' and new.status='reconciled' and new.review_status='rejected' then kind:='returned';
 elsif new.status='completed' and (tg_op='INSERT' or old.status<>'completed') then kind:=case when new.review_status='approved' then 'approved' else 'completed' end;
 else return new; end if;
 insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_employee_id,actor_user_id,reason,snapshot)
 values(new.id,kind,case when kind in ('submitted','resubmitted','completed','cancelled') then case when kind='cancelled' then nullif(current_setting('feedx.crew_cash_cancellation_employee',true),'')::uuid else new.checked_out_by_employee_id end end,
 case when kind in ('returned','approved') or kind='cancelled' and nullif(current_setting('feedx.crew_cash_cancellation_employee',true),'') is null then auth.uid() end,case when kind in ('returned','cancelled') then new.review_note end,to_jsonb(new));
 if kind in ('completed','approved','cancelled') then perform public.crew_cash_record_basis_changes(new.outlet_id,new.business_date,new.checked_out_by_employee_id,auth.uid()); end if;
 return new;
end $function$
;

create function public.crew_cash_allocation_basis_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.crew_cash_checkouts%rowtype;
begin
 if new.action='allocation' then
  select * into c from public.crew_cash_checkouts where id=new.checkout_id;
  perform public.crew_cash_record_basis_changes(c.outlet_id,c.business_date,null,new.actor_user_id);
 end if;
 return new;
end $$;
revoke all on function public.crew_cash_allocation_basis_changed() from public,anon,authenticated;
create trigger crew_cash_allocation_basis_changed_trigger after insert on public.crew_cash_checkout_adjustments for each row execute function public.crew_cash_allocation_basis_changed();
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
 floating:=public.crew_cash_float_at(outlet,p_business_date); previous_carry:=coalesce(public.crew_cash_previous_carry(outlet,p_business_date),0);
 can_perform:=public.crew_cash_can_perform_checkout(employee,outlet);
 can_collect:=public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection');
 select jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'checked_out_by',e.full_name,'floating_cash',c.floating_cash,'previous_carry_forward',c.previous_carry_forward,'expected_opening_cash',c.expected_opening_cash,'actual_opening_cash',c.actual_opening_cash,'opening_variance',c.opening_variance,'opening_variance_reason',c.opening_variance_reason,'denomination_counts',c.denomination_counts,'counted_cash',c.counted_cash,'pos_expected_cash',c.pos_expected_cash,'variance',c.variance,'reconciliation_status',c.reconciliation_status,'carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit,'float_shortfall',c.float_shortfall,'review_required',c.review_required,'review_status',c.review_status,'variance_reason',c.variance_reason,'completed_at',c.completed_at)||public.crew_cash_checkout_allocation(c.id) into checkout from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=outlet and c.business_date=p_business_date;
 return jsonb_build_object('outlet',jsonb_build_object('id',outlet,'name',coalesce((select o.name from public.outlets o where o.id=outlet),ctx->>'outlet_name')),'business_date',p_business_date,'can_perform',can_perform,'can_record_collection',can_collect,'settings',jsonb_build_object('floating_cash',floating,'variance_tolerance',coalesce(settings.variance_tolerance,0),'closing_deadline',settings.closing_deadline),'cash_context',case when checkout is not null then jsonb_build_object('floating_cash',checkout->'floating_cash','previous_carry_forward',checkout->'previous_carry_forward','expected_opening_cash',checkout->'expected_opening_cash') else jsonb_build_object('floating_cash',floating,'previous_carry_forward',previous_carry,'expected_opening_cash',floating + previous_carry) end,'checkout',checkout,'chain',public.crew_cash_chain_context(outlet,p_business_date,(checkout->>'id')::uuid),'can_continue_checkout',coalesce((checkout->>'checked_out_by_employee_id')::uuid=employee and checkout->>'status' not in ('completed','cancelled','submitted') and can_perform,false),'can_cancel_checkout',coalesce((checkout->>'checked_out_by_employee_id')::uuid=employee and checkout->>'status' not in ('completed','cancelled') and can_perform,false),'can_correct_checkout',coalesce(checkout->>'is_returned'='true' and (checkout->>'checked_out_by_employee_id')::uuid=employee,false),'action_required_checkouts',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'business_date',x.business_date,'status',x.status,'return_reason',case when x.review_status='rejected' then x.review_note end) order by x.business_date) from public.crew_cash_checkouts x where x.outlet_id=outlet and x.checked_out_by_employee_id=employee and x.status not in ('completed','cancelled') and (x.business_date<timezone('Asia/Kuala_Lumpur',now())::date or x.review_status='rejected')),'[]'::jsonb),'deposit',jsonb_build_object('current_balance',public.crew_cash_balance(outlet),'pending_confirmation_amount',coalesce((select sum(c.amount) from public.crew_cash_collections c where c.outlet_id=outlet and c.status='pending_receipt'),0),'recent',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 3)x),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 100)x),'[]'::jsonb)),'receivers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name) from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=outlet and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb),'pending_receipts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'sender',coalesce(se.full_name,'Admin'),'submitted_at',c.submitted_at) order by c.submitted_at desc) from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt'),'[]'::jsonb));
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
      and c.status in ('completed','cancelled')
      and c.business_date between p_business_date - 29 and p_business_date
  ), '[]'::jsonb);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.crew_cash_admin_context(p_outlet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_settings jsonb; v_employees jsonb; v_receivers jsonb; v_positions jsonb; v_history jsonb;
begin
 if not ((public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view')) and public.current_user_can_access_outlet(p_outlet_id)) then raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.'; end if;
 select to_jsonb(s) || jsonb_build_object('effective_floating_cash',public.crew_cash_float_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date)) into v_settings from public.crew_cash_settings s where s.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position,'workplace',e.workplace) order by e.full_name),'[]'::jsonb) into v_employees from public.employees e where public.crew_cash_receiver_candidate_is_eligible(p_outlet_id,e.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position,'workplace',e.workplace) order by e.full_name),'[]'::jsonb) into v_receivers from public.crew_cash_handover_receivers r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and public.crew_cash_receiver_is_eligible(p_outlet_id,e.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',p.status) order by p.name),'[]'::jsonb) into v_positions from public.job_positions p where p.status='active' or p.id=any(coalesce((select required_position_ids from public.crew_cash_settings where outlet_id=p_outlet_id),'{}'::uuid[]));
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'previous_amount',a.previous_amount,'new_amount',a.new_amount,'effective_date',a.effective_date,'reason',a.reason,'adjusted_at',a.adjusted_at,'adjusted_by',coalesce(u.email,'Admin')) order by a.effective_date desc,a.adjusted_at desc),'[]'::jsonb) into v_history from public.crew_cash_float_adjustments a left join auth.users u on u.id=a.adjusted_by where a.outlet_id=p_outlet_id;
 return jsonb_build_object('previous_unresolved',public.crew_cash_chain_context(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date)->'previous_unresolved','settings',v_settings,'employees',v_employees,'eligible_receivers',v_receivers,'checkout_positions',v_positions,'float_history',v_history,'receiver_configuration',coalesce((select jsonb_build_object('version',c.version,'updated_at',c.updated_at) from public.crew_cash_handover_receiver_configs c where c.outlet_id=p_outlet_id),'{}'::jsonb));
end; $function$
;
