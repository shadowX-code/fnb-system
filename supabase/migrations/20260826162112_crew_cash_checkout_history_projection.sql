-- A bounded, token-bound read model for immutable completed Cash Checkout
-- snapshots. This intentionally never derives checkout history from the Cash
-- Deposit ledger, and it does not alter the existing Crew cash projection.
create or replace function public.crew_cash_checkout_history(
  p_token text,
  p_business_date date default timezone('Asia/Kuala_Lumpur', now())::date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  ctx jsonb;
  outlet uuid;
begin
  ctx := public.crew_operations_employee_context(p_token);
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
$$;

revoke all on function public.crew_cash_checkout_history(text, date) from public, anon, authenticated;
grant execute on function public.crew_cash_checkout_history(text, date) to anon, authenticated;
