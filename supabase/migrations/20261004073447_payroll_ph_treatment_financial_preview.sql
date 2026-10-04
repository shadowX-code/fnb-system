-- Read-only financial projection of the same lines consumed by Payroll.
-- Pricing, payable-time and confirmation authorities stay unchanged.
create or replace function public.payroll_ph_treatment_preview(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare q jsonb; current_day jsonb; normal numeric; overtime numeric; company numeric; total numeric; previous numeric; determinate boolean;
begin
 perform payroll_admin_actor();
 if not payroll_can_access_run_employee((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,'payroll.view') then raise insufficient_privilege using message='Payroll PH visibility denied.';end if;
 q:=payroll_ph_treatment_quote((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,(p_input->>'date')::date,p_input);
 current_day:=payroll_ph_statutory_project((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,(p_input->>'date')::date);
 select coalesce(sum((x->>'amount')::numeric) filter(where x->>'code'='public_holiday'),0),
 coalesce(sum((x->>'amount')::numeric) filter(where x->>'code'='public_holiday_ot'),0),
 coalesce(sum((x->>'amount')::numeric) filter(where x->>'code'='company_ph_benefit'),0),
 coalesce(sum((x->>'amount')::numeric) filter(where x->>'kind'='earning'),0)
 into normal,overtime,company,total from jsonb_array_elements(q->'lines') x;
 -- Canonical calculation consumes only resolved lines, even while other dates
 -- remain Pending Review. Compare with that same day contribution, not stale cache.
 select coalesce(sum((x->>'amount')::numeric) filter(where x->>'kind'='earning'),0) into previous from jsonb_array_elements(current_day->'lines') x;
 determinate:=p_input->>'treatment' in ('statutory','custom','none') and jsonb_array_length(q->'issues')=0
   and (p_input->>'treatment'<>'statutory' or q->>'statutory_available'='true');
 return q||jsonb_build_object('pay_preview',jsonb_build_object('determinate',determinate,
 'regular_pay',0,'monthly_basic_included',q#>>'{context,compensation,pay_basis}'='monthly',
 'public_holiday_allowance',case when determinate then normal end,'ph_ot',case when determinate then overtime end,
 'company_ph_benefit',case when determinate then company end,'total_day_additions',case when determinate then total end,
 'previous_day_additions',previous,'payroll_change',case when determinate then total-previous end));
end $$;
revoke all on function public.payroll_ph_treatment_preview(jsonb) from public,anon;
grant execute on function public.payroll_ph_treatment_preview(jsonb) to authenticated;

-- A correction preview also binds the prior review being replaced. Concurrent
-- confirmations cannot silently change its displayed financial delta.
do $$ declare d text; a text:='p_intent->''extra_minutes'',overlap)::text'; begin
 d:=pg_get_functiondef('public.payroll_ph_treatment_quote(uuid,uuid,date,jsonb)'::regprocedure);
 if strpos(d,a)=0 then raise exception 'PH quote fingerprint anchor changed';end if;
 execute replace(d,a,'p_intent->''extra_minutes'',overlap,prior.id)::text');
end $$;
