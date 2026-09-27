create or replace function public.payroll_payslip_document(p_identity jsonb,p_start date,p_end date,p_at timestamptz,p_calculation jsonb,p_statutory jsonb,p_draft boolean)
returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('identity',p_identity,'period_start',p_start,'period_end',p_end,
 'finalized_at',p_at,'draft',p_draft,'pay_basis',p_calculation->'pay_basis',
 'earnings',coalesce((select jsonb_agg(jsonb_build_object('label',case when x->>'code'='regular' and p_calculation->>'pay_basis'='hourly' then 'Regular Hourly Pay' else x->>'label' end,'amount',x->'amount',
   'minutes',x->'minutes','rate',coalesce((x->>'rate')::numeric,(x->>'rate_per_minute')::numeric*60),'multiplier',x->'multiplier','units',x->'units'))
   from jsonb_array_elements(p_calculation->'lines') x where x->>'kind'='earning'),'[]'::jsonb),
 'reimbursements',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount'))
   from jsonb_array_elements(p_calculation->'lines') x where x->>'kind'='reimbursement'),'[]'::jsonb),
 'deductions',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount'))
   from jsonb_array_elements(p_calculation->'lines') x where x->>'kind'='deduction'),'[]'::jsonb),
 'statutory',coalesce((select jsonb_agg(jsonb_build_object('scheme',x->>'scheme','applicable',x->'applicable',
   'amount',x->'employee_amount','employer_amount',x->'employer_amount'))
   from jsonb_array_elements(p_statutory->'lines') x),'[]'::jsonb),
 'gross_earnings',p_calculation->'gross_earnings','net_pay',p_statutory->'net_pay',
 'total_deductions',case when p_statutory->>'net_pay' is not null then
   (p_calculation->>'non_statutory_deductions')::numeric + coalesce((select sum((x->>'employee_amount')::numeric)
     from jsonb_array_elements(p_statutory->'lines') x),0) else null end);
$$;
