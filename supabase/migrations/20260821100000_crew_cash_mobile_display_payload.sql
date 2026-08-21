-- Safe Crew read-model enrichment only: retain the session-bound authority and
-- expose the canonical actor name/position required for the immutable receipt.
create or replace function public.crew_cash_mobile(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; checkout jsonb; can_perform boolean; can_collect boolean;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position';
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 can_perform:=public.crew_cash_employee_has_permission(employee,'crew_cash_checkout.perform')
  and (settings.id is null or cardinality(settings.required_positions)=0 or position=any(settings.required_positions));
 can_collect:=public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection');
 select jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'checked_out_by',e.full_name,'position',e.position,
  'floating_cash',c.floating_cash,'previous_carry_forward',c.previous_carry_forward,'expected_opening_cash',c.expected_opening_cash,
  'actual_opening_cash',c.actual_opening_cash,'opening_variance',c.opening_variance,'opening_variance_reason',c.opening_variance_reason,
  'denomination_counts',c.denomination_counts,'counted_cash',c.counted_cash,'pos_expected_cash',c.pos_expected_cash,
  'variance',c.variance,'reconciliation_status',c.reconciliation_status,'carry_forward',c.carry_forward,
  'amount_for_deposit',c.amount_for_deposit,'float_shortfall',c.float_shortfall,'review_required',c.review_required,
  'review_status',c.review_status,'variance_reason',c.variance_reason,'completed_at',c.completed_at)
 into checkout from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id
 where c.outlet_id=outlet and c.business_date=p_business_date;
 return jsonb_build_object('outlet',jsonb_build_object('id',outlet,'name',coalesce((select o.name from public.outlets o where o.id=outlet),ctx->>'outlet_name')),
  'business_date',p_business_date,'can_perform',can_perform,'can_record_collection',can_collect,
  'settings',jsonb_build_object('floating_cash',public.crew_cash_float_at(outlet,p_business_date),'variance_tolerance',coalesce(settings.variance_tolerance,0),'closing_deadline',settings.closing_deadline),
  'checkout',checkout,'deposit',jsonb_build_object('current_balance',public.crew_cash_balance(outlet),'available_balance',public.crew_cash_available_balance(outlet),
   'recent',coalesce((select jsonb_agg(x order by x.occurred_at desc) from (select l.id,l.occurred_at,l.entry_type,l.activity,l.signed_amount,l.receiver_name,
     coalesce(e.full_name,u.email,'System') as recorded_by from public.crew_cash_ledger_entries l left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id where l.outlet_id=outlet order by l.occurred_at desc limit 20)x),'[]'::jsonb)),
  'receivers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name)
   from public.employees e join public.crew_access ca on ca.employee_id=e.id
   where ca.primary_outlet_id=outlet and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb),
  'pending_receipts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'sender',coalesce(se.full_name,'Admin'),'submitted_at',c.submitted_at) order by c.submitted_at desc)
   from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt'),'[]'::jsonb));
end; $$;

revoke all on function public.crew_cash_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated;
