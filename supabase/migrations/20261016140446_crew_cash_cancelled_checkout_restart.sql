-- Cancelled evidence is retained; only the effective attempt owns the daily cash chain.
alter table public.crew_cash_checkouts add column previous_checkout_id uuid references public.crew_cash_checkouts(id) on delete restrict;
alter table public.crew_cash_checkouts drop constraint crew_cash_checkouts_outlet_id_business_date_key;
create unique index crew_cash_checkout_effective_day on public.crew_cash_checkouts(outlet_id,business_date) where status<>'cancelled';
create unique index crew_cash_checkout_one_successor on public.crew_cash_checkouts(previous_checkout_id) where previous_checkout_id is not null;
create function public.crew_cash_daily_checkout_id(p_outlet uuid,p_date date) returns uuid language sql stable security definer set search_path='' as $$
 select id from public.crew_cash_checkouts where outlet_id=p_outlet and business_date=p_date and not exists(select 1 from public.crew_cash_checkouts child where child.previous_checkout_id=crew_cash_checkouts.id) order by (status<>'cancelled') desc,created_at desc,id desc limit 1;
$$;
revoke all on function public.crew_cash_daily_checkout_id(uuid,date) from public,anon,authenticated;
create function public.crew_cash_guard_attempt() returns trigger language plpgsql security definer set search_path='' as $$
declare prior public.crew_cash_checkouts;
begin
 if tg_op='UPDATE' then
  if new.previous_checkout_id is distinct from old.previous_checkout_id or new.outlet_id<>old.outlet_id or new.business_date<>old.business_date or new.created_at<>old.created_at then raise exception 'Checkout attempt identity is immutable.';end if;
  return new;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.outlet_id::text,0));
 select * into prior from public.crew_cash_checkouts where id=public.crew_cash_daily_checkout_id(new.outlet_id,new.business_date);
 if prior.id is not null and (prior.status<>'cancelled' or new.previous_checkout_id is distinct from prior.id) then raise exception 'An effective checkout already exists or the cancelled predecessor changed.';end if;
 if prior.id is null and new.previous_checkout_id is not null then raise exception 'Cancelled predecessor unavailable.';end if;
 return new;
end;$$;
revoke all on function public.crew_cash_guard_attempt() from public,anon,authenticated;
create trigger crew_cash_guard_attempt before insert or update on public.crew_cash_checkouts for each row execute function public.crew_cash_guard_attempt();

do $$ begin if md5(pg_get_functiondef('crew_cash_save_checkout(text,text,jsonb)'::regprocedure))<>'e2fc22431c8769b3950f08b54e2d6cfb' then raise exception 'Cash authority drift: crew_cash_save_checkout';end if;end;$$;
CREATE OR REPLACE FUNCTION public.crew_cash_save_checkout(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; c public.crew_cash_checkouts%rowtype;
 counts jsonb; counted numeric; float_amount numeric; previous_carry numeric; expected_open numeric; actual_open numeric; pos_expected numeric; carry numeric;
 variance_amount numeric; deposit_amount numeric; shortfall numeric; needs_review boolean; action text; opening_reason text;
 opening_expected numeric; opening_previous numeric; supplied_open numeric; business_day date:=timezone('Asia/Kuala_Lumpur',now())::date; correction_run boolean:=false; financial_review boolean; predecessor public.crew_cash_checkouts%rowtype; restart boolean:=false;
begin
 ctx:=public.crew_cash_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position'; action:=lower(btrim(p_action));
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 if not public.crew_cash_can_perform_checkout(employee,outlet) then raise exception using errcode='42501',message='Cash Checkout is unavailable for your outlet eligibility.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['checked_out_by','checked_out_by_employee_id','counted_cash','variance','amount_for_deposit','status','review_status','completed_at'] then raise exception using errcode='22023',message='Cash Checkout payload contains server-controlled fields.'; end if;
 if action<>all(array['draft','reconcile','submit','complete','cancel','restart']) then raise exception using errcode='22023',message='Unsupported Cash Checkout action.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(outlet::text,0));
 restart:=action='restart';
 if restart then
  if p_payload ? 'checkout_id' or p_payload->>'previous_checkout_id' is null then raise exception 'Choose the cancelled checkout to restart.';end if;
  select * into predecessor from public.crew_cash_checkouts where id=(p_payload->>'previous_checkout_id')::uuid and outlet_id=outlet for update;
  if predecessor.id is null or predecessor.status<>'cancelled' or predecessor.business_date<>business_day then raise exception 'Only a cancelled checkout can be restarted.';end if;
  business_day:=predecessor.business_date;
  -- The predecessor is the retry identity, even if that child was later cancelled.
  select * into c from public.crew_cash_checkouts where previous_checkout_id=predecessor.id;
  if c.id is not null then
   if c.checked_out_by_employee_id<>employee then raise exception 'The replacement checkout belongs to another Crew member. Refresh Cash Checkout.';end if;
   return jsonb_build_object('checkout',to_jsonb(c)||public.crew_cash_checkout_allocation(c.id));
  end if;
  if public.crew_cash_daily_checkout_id(outlet,business_day) is distinct from predecessor.id then raise exception 'Checkout attempt changed. Refresh Cash Checkout.';end if;
  action:='draft';p_payload:='{}'::jsonb;
 end if;
 if p_payload ? 'checkout_id' then
  select * into c from public.crew_cash_checkouts x where x.id=(p_payload->>'checkout_id')::uuid and x.outlet_id=outlet for update;
  if c.id is null then raise exception using errcode='42501',message='Cash Checkout is unavailable for this outlet.'; end if;
  correction_run:=exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=c.id and event='returned') or c.review_status='rejected';
  business_day:=c.business_date;
 else
  select * into c from public.crew_cash_checkouts x where x.outlet_id=outlet and x.business_date=business_day and x.status<>'cancelled' for update;
  correction_run:=coalesce(c.review_status='rejected',false) or exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=c.id and event='returned');
 end if;
 if not restart and c.id is null and exists(select 1 from public.crew_cash_checkouts where outlet_id=outlet and business_date=business_day) then raise exception 'Start New Checkout from the cancelled daily checkout.';end if;
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
  insert into public.crew_cash_checkouts(previous_checkout_id,outlet_id,business_date,checked_out_by_employee_id,floating_cash,previous_carry_forward,expected_opening_cash,actual_opening_cash,opening_variance,opening_variance_reason,denomination_counts,counted_cash,pos_expected_cash,variance,reconciliation_status,carry_forward,amount_for_deposit,float_shortfall,variance_tolerance,review_required,variance_reason,review_status,status,reconciled_at,submitted_at)
  values(case when restart then predecessor.id end,outlet,business_day,employee,float_amount,opening_previous,opening_expected,actual_open,case when actual_open is null then null else actual_open-opening_expected end,case when actual_open is not distinct from opening_expected then null else opening_reason end,counts,counted,pos_expected,variance_amount,case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,carry,deposit_amount,shortfall,case when correction_run then c.variance_tolerance else coalesce(settings.variance_tolerance,0) end,needs_review,nullif(btrim(p_payload->>'variance_reason'),''),case when needs_review then 'pending' else 'not_required' end,case action when 'draft' then 'draft' when 'reconcile' then 'reconciled' else 'submitted' end,case when action<>'draft' then now() end,case when action in('submit','complete') then now() end)
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
 return jsonb_build_object('checkout',to_jsonb(c)||public.crew_cash_checkout_allocation(c.id),'deposit_balance',public.crew_cash_balance(outlet));
end; $function$
;

do $$ begin if md5(pg_get_functiondef('crew_cash_chain_context(uuid,date,uuid)'::regprocedure))<>'133a274036da0a45ba9d60e67223514b' then raise exception 'Cash authority drift: crew_cash_chain_context';end if;end;$$;
CREATE OR REPLACE FUNCTION public.crew_cash_chain_context(p_outlet uuid, p_date date, p_checkout uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('previous_unresolved',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'is_returned',c.review_status='rejected','checked_out_by_employee_id',c.checked_out_by_employee_id,'checked_out_by',e.full_name,'return_reason',case when c.review_status='rejected' then c.review_note end) order by c.business_date) from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=p_outlet and c.business_date<p_date and c.status not in ('completed','cancelled')),'[]'::jsonb),
 'resolved_carry',coalesce((select case when c.status='cancelled' then 0 else (public.crew_cash_allocation_values(c.id)->>'carry_forward')::numeric end from public.crew_cash_checkouts c where c.outlet_id=p_outlet and c.business_date<p_date and c.status in ('completed','cancelled') and c.id=public.crew_cash_daily_checkout_id(c.outlet_id,c.business_date) order by c.business_date desc limit 1),0),
 'basis_review_required',coalesce((select c.status not in ('completed','cancelled') and (
 c.previous_carry_forward is distinct from coalesce((select case when prior.status='cancelled' then 0 else (public.crew_cash_allocation_values(prior.id)->>'carry_forward')::numeric end from public.crew_cash_checkouts prior where prior.outlet_id=c.outlet_id and prior.business_date<c.business_date and prior.status in ('completed','cancelled') and prior.id=public.crew_cash_daily_checkout_id(prior.outlet_id,prior.business_date) order by prior.business_date desc limit 1),0)
 or exists(select 1 from public.crew_cash_checkout_review_events h where h.checkout_id=c.id and h.event='basis_changed' and h.id>coalesce((select max(v.id) from public.crew_cash_checkout_review_events v where v.checkout_id=c.id and v.event='basis_reviewed'),0))) from public.crew_cash_checkouts c where c.id=p_checkout),false));
$function$
;

do $$ begin if md5(pg_get_functiondef('crew_cash_checkout_allocation(uuid)'::regprocedure))<>'7ce133739fb5669a89211bb09c85aeb7' then raise exception 'Cash authority drift: crew_cash_checkout_allocation';end if;end;$$;
CREATE OR REPLACE FUNCTION public.crew_cash_checkout_allocation(p_checkout_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.crew_cash_allocation_values(c.id)||public.crew_cash_chain_context(c.outlet_id,c.business_date,c.id)||jsonb_build_object(
 'previous_checkout_id',c.previous_checkout_id,'attempt_created_at',c.created_at,'is_previous_day',c.business_date<timezone('Asia/Kuala_Lumpur',now())::date and c.status not in ('completed','cancelled'),
 'cancellation',coalesce((select jsonb_build_object('reason',h.reason,'occurred_at',h.occurred_at,'actor_name',coalesce(e.full_name,a.full_name,'Admin')) from public.crew_cash_checkout_review_events h left join public.employees e on e.id=h.actor_employee_id left join public.employees a on a.auth_user_id=h.actor_user_id where h.checkout_id=c.id and h.event='cancelled' order by h.id limit 1),'null'::jsonb))
 ||case when c.status='cancelled' then jsonb_build_object('is_returned',false,'carry_forward',0,'amount_for_deposit',0) else '{}'::jsonb end
 from public.crew_cash_checkouts c where c.id=p_checkout_id;
$function$
;

do $$ begin if md5(pg_get_functiondef('crew_cash_mobile_projection_source(text,date)'::regprocedure))<>'90a39cde689112355db524e02d01e149' then raise exception 'Cash authority drift: crew_cash_mobile_projection_source';end if;end;$$;
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
 select jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'checked_out_by',e.full_name,'floating_cash',c.floating_cash,'previous_carry_forward',c.previous_carry_forward,'expected_opening_cash',c.expected_opening_cash,'actual_opening_cash',c.actual_opening_cash,'opening_variance',c.opening_variance,'opening_variance_reason',c.opening_variance_reason,'denomination_counts',c.denomination_counts,'counted_cash',c.counted_cash,'pos_expected_cash',c.pos_expected_cash,'variance',c.variance,'reconciliation_status',c.reconciliation_status,'carry_forward',c.carry_forward,'amount_for_deposit',c.amount_for_deposit,'float_shortfall',c.float_shortfall,'review_required',c.review_required,'review_status',c.review_status,'variance_reason',c.variance_reason,'completed_at',c.completed_at)||public.crew_cash_checkout_allocation(c.id) into checkout from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.id=public.crew_cash_daily_checkout_id(outlet,p_business_date);
 return jsonb_build_object('outlet',jsonb_build_object('id',outlet,'name',coalesce((select o.name from public.outlets o where o.id=outlet),ctx->>'outlet_name')),'business_date',p_business_date,'can_perform',can_perform,'can_record_collection',can_collect,'settings',jsonb_build_object('floating_cash',floating,'variance_tolerance',coalesce(settings.variance_tolerance,0),'closing_deadline',settings.closing_deadline),'cash_context',case when checkout is not null and checkout->>'status'<>'cancelled' then jsonb_build_object('floating_cash',checkout->'floating_cash','previous_carry_forward',checkout->'previous_carry_forward','expected_opening_cash',checkout->'expected_opening_cash') else jsonb_build_object('floating_cash',floating,'previous_carry_forward',previous_carry,'expected_opening_cash',floating + previous_carry) end,'checkout',checkout,'chain',public.crew_cash_chain_context(outlet,p_business_date,(checkout->>'id')::uuid),'can_restart_checkout',coalesce(checkout->>'status'='cancelled' and p_business_date=timezone('Asia/Kuala_Lumpur',now())::date and can_perform,false),'can_continue_checkout',coalesce((checkout->>'checked_out_by_employee_id')::uuid=employee and checkout->>'status' not in ('completed','cancelled','submitted') and can_perform,false),'can_cancel_checkout',coalesce((checkout->>'checked_out_by_employee_id')::uuid=employee and checkout->>'status' not in ('completed','cancelled') and can_perform,false),'can_correct_checkout',coalesce(checkout->>'is_returned'='true' and (checkout->>'checked_out_by_employee_id')::uuid=employee,false),'action_required_checkouts',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'business_date',x.business_date,'status',x.status,'return_reason',case when x.review_status='rejected' then x.review_note end) order by x.business_date) from public.crew_cash_checkouts x where x.outlet_id=outlet and x.checked_out_by_employee_id=employee and x.status not in ('completed','cancelled') and (x.business_date<timezone('Asia/Kuala_Lumpur',now())::date or x.review_status='rejected')),'[]'::jsonb),'deposit',jsonb_build_object('current_balance',public.crew_cash_balance(outlet),'pending_confirmation_amount',coalesce((select sum(c.amount) from public.crew_cash_collections c where c.outlet_id=outlet and c.status='pending_receipt'),0),'recent',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 3)x),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from (select * from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name,l.entry_type,coalesce(e.full_name,u.email,'System') recorded_by,case when l.entry_type='collection' then case c.status when 'pending_receipt' then 'pending_confirmation' when 'completed' then 'confirmed' else c.status end end confirmation_status,sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after from public.crew_cash_ledger_entries l left join public.crew_cash_collections c on c.id=l.collection_id left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet) running order by occurred_at desc,id desc limit 100)x),'[]'::jsonb)),'receivers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name) from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=outlet and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb),'pending_receipts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'sender',coalesce(se.full_name,'Admin'),'submitted_at',c.submitted_at) order by c.submitted_at desc) from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt'),'[]'::jsonb));
end; $function$
;

do $$ begin if md5(pg_get_functiondef('crew_cash_checkout_history(text,date)'::regprocedure))<>'7f07cd00c31c317ae353e4e770afd458' then raise exception 'Cash authority drift: crew_cash_checkout_history';end if;end;$$;
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
    )||public.crew_cash_checkout_allocation(c.id) order by c.business_date desc, c.created_at desc,c.id desc)
    from public.crew_cash_checkouts c
    join public.employees e on e.id = c.checked_out_by_employee_id
    where c.outlet_id = outlet
      and c.business_date between p_business_date - 29 and p_business_date
  ), '[]'::jsonb);
end;
$function$
;
