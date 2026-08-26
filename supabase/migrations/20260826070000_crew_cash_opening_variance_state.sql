-- Keep the opening-variance reason aligned with the canonical server result.
-- A zero variance has no reason to retain; non-zero values remain server-validated.
create or replace function public.crew_cash_save_checkout(p_token text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; c public.crew_cash_checkouts%rowtype;
 counts jsonb; counted numeric; float_amount numeric; previous_carry numeric; expected_open numeric; actual_open numeric; pos_expected numeric; carry numeric;
 variance_amount numeric; deposit_amount numeric; shortfall numeric; needs_review boolean; action text; opening_reason text;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position'; action:=lower(btrim(p_action));
 if not public.crew_cash_employee_has_permission(employee,'crew_cash_checkout.perform') then raise exception using errcode='42501',message='You do not have permission to perform Cash Checkout.'; end if;
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 if settings.id is not null and cardinality(settings.required_positions)>0 and not position=any(settings.required_positions) then raise exception using errcode='42501',message='Cash Checkout is not assigned to your position.'; end if;
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
 actual_open:=case when p_payload ? 'actual_opening_cash' then round((p_payload->>'actual_opening_cash')::numeric,2) else c.actual_opening_cash end;
 pos_expected:=case when p_payload ? 'pos_expected_cash' then round((p_payload->>'pos_expected_cash')::numeric,2) else c.pos_expected_cash end;
 carry:=coalesce(case when p_payload ? 'carry_forward' then (p_payload->>'carry_forward')::numeric else c.carry_forward end,0);
 opening_reason:=nullif(btrim(coalesce(p_payload->>'opening_variance_reason',c.opening_variance_reason,'')), '');
 if actual_open is not null and actual_open<0 or pos_expected is not null and pos_expected<0 or carry<0 then raise exception using errcode='22023',message='Cash values cannot be negative.'; end if;
 if actual_open is not null and actual_open is distinct from expected_open and opening_reason is null then raise exception using errcode='22023',message='Explain the opening cash variance.'; end if;
 variance_amount:=case when pos_expected is null then null else counted-pos_expected end;
 shortfall:=greatest(float_amount-counted,0);
 if shortfall>0 then carry:=0; deposit_amount:=0;
 else if carry>counted-float_amount then raise exception using errcode='22023',message='Carry Forward cannot exceed cash remaining after Floating Cash.'; end if; deposit_amount:=counted-float_amount-carry; end if;
 needs_review:=shortfall>0 or (coalesce(settings.require_manager_review_over_tolerance,true) and variance_amount is not null and abs(variance_amount)>coalesce(settings.variance_tolerance,0));
 if action in ('reconcile','submit','complete') and pos_expected is null then raise exception using errcode='22023',message='POS Expected Cash is required to reconcile.'; end if;
 if needs_review and action in ('submit','complete') and nullif(btrim(coalesce(p_payload->>'variance_reason',c.variance_reason,'')),'') is null then raise exception using errcode='22023',message='Explain the cash variance before submitting.'; end if;
 if c.id is null then
  insert into public.crew_cash_checkouts(outlet_id,business_date,checked_out_by_employee_id,floating_cash,previous_carry_forward,expected_opening_cash,actual_opening_cash,opening_variance,opening_variance_reason,denomination_counts,counted_cash,pos_expected_cash,variance,reconciliation_status,carry_forward,amount_for_deposit,float_shortfall,variance_tolerance,review_required,variance_reason,review_status,status,reconciled_at,submitted_at)
  values(outlet,timezone('Asia/Kuala_Lumpur',now())::date,employee,float_amount,previous_carry,expected_open,actual_open,case when actual_open is null then null else actual_open-expected_open end,case when actual_open is not distinct from expected_open then null else opening_reason end,counts,counted,pos_expected,variance_amount,case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,carry,deposit_amount,shortfall,coalesce(settings.variance_tolerance,0),needs_review,nullif(btrim(p_payload->>'variance_reason'),''),case when needs_review then 'pending' else 'not_required' end,case action when 'draft' then 'draft' when 'reconcile' then 'reconciled' else 'submitted' end,case when action<>'draft' then now() end,case when action in('submit','complete') then now() end)
  returning * into c;
 else
  update public.crew_cash_checkouts set actual_opening_cash=actual_open,opening_variance=case when actual_open is null then null else actual_open-expected_open end,
   opening_variance_reason=case when actual_open is not distinct from expected_open then null else opening_reason end,denomination_counts=counts,counted_cash=counted,
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
end; $$;
revoke all on function public.crew_cash_save_checkout(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_save_checkout(text,text,jsonb) to anon,authenticated;
