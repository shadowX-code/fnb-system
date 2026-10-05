-- Presentation only: contractual Basic Salary and pinned reductions reconcile the
-- existing net monthly_basic earning. No calculation, statutory base, decision,
-- deduction, snapshot or stored Payslip is mutated or repriced.
create or replace function public.payroll_earning_groups(p_calculation jsonb)
returns jsonb language sql immutable set search_path=public as $$
 with normalized as (
  select x, n, case x->>'code' when 'regular' then 'Regular Pay'
    when 'company_ph_benefit' then case when x#>>'{source,treatment_model}'='unified_v1' then 'Public Holiday Allowance' else 'Company Public Holiday Benefit' end
    when 'public_holiday_ot' then 'Public Holiday Allowance' when 'public_holiday' then 'Public Holiday Allowance' else x->>'label' end label,
   coalesce((x->>'rate')::numeric,(x->>'rate_per_minute')::numeric*60,
    case when x->>'code'='company_ph_benefit' and x#>>'{source,formula_version}' is distinct from 'my_ph_2023_v1' then (x#>>'{source,ph_work,compensation,hourly_rate}')::numeric end) rate,
   coalesce((x->>'minutes')::numeric,case when x->>'code'='company_ph_benefit' and x#>>'{source,formula_version}' is distinct from 'my_ph_2023_v1'
     and x#>>'{source,ph_work,compensation,pay_basis}'='hourly' then (x#>>'{source,ph_work,time,approved_minutes}')::numeric end) minutes
  from jsonb_array_elements(coalesce(p_calculation->'lines','[]')) with ordinality a(x,n) where x->>'kind'='earning'
 ), keyed as (
  select *, case when minutes is null and x->>'quantity' is null then jsonb_build_array('individual',n) else
   jsonb_build_array(x->>'kind',x->>'code',rate,x->'rate_per_minute',x->'multiplier',
    x#>'{source,rule_version_id}',x#>'{source,compensation_version_id}',
    x#>'{source,formula}',x#>'{source,formula_version}',x#>'{source,statutory_treatment}',
    x#>'{source,ph_work,compensation,id}',x#>'{source,ph_work,policy,id}',x->'units',x->'unit',x#>'{source,normal_minutes}',x#>'{source,coverage}',x#>'{source,comparable_full_time_minutes}') end basis
  from normalized
 ), grouped as (
  select min(n) ordinal,min(label) label,sum((x->>'amount')::numeric) amount,sum(minutes) minutes,
   sum((x->>'quantity')::numeric) quantity, min(rate) rate, (array_agg(x order by n))[1] first_line,jsonb_agg(x order by n) details
  from keyed group by basis
 ), projected as (
  select ordinal, first_line||jsonb_build_object('label',label,'amount',amount,'minutes',minutes,
    'quantity',quantity,'units',case when first_line->>'unit'='day' then quantity::text||' ordinary day(s) x RM'||round(rate,2)::text||' x '||(first_line->>'multiplier') else first_line->>'units' end, 'rate',rate,'calculation_details',details,'day_count',jsonb_array_length(details)) as line from grouped
 ), presented as (
  select ordinal, part, item
  from projected
  cross join lateral (select line#>'{source,monthly_entitlement}' b) evidence
  cross join lateral jsonb_array_elements(
   case when line->>'code'='monthly_basic'
     and b->>'formula_code'='ea18a_calendar_days_v1'
     and b ?& array['monthly_salary','employment_reduction','unpaid_leave_reduction','payable_basic_salary']
     and (b->>'monthly_salary')::numeric >= 0
     and (b->>'employment_reduction')::numeric >= 0
     and (b->>'unpaid_leave_reduction')::numeric >= 0
     and coalesce((b->>'unpaid_absence_reduction')::numeric,0) >= 0
     and (line->>'amount')::numeric = (b->>'payable_basic_salary')::numeric
     and (line->>'amount')::numeric = (b->>'monthly_salary')::numeric
       - (b->>'employment_reduction')::numeric - (b->>'unpaid_leave_reduction')::numeric
       - coalesce((b->>'unpaid_absence_reduction')::numeric,0)
    then (
     select jsonb_agg(line || jsonb_build_object(
       'code',code,'label',label,'amount',amount,'units',description,
       'presentation_model','monthly_salary_reductions_v1',
       'canonical_amount',line->'amount'
     ) order by sequence)
     from (values
       (1,'monthly_basic','Basic Salary',(b->>'monthly_salary')::numeric,'Contractual monthly salary'),
       (2,'employment_proration','Employment Proration',-(b->>'employment_reduction')::numeric,'Partial employment period'),
       (3,'unpaid_leave','Unpaid Leave',-(b->>'unpaid_leave_reduction')::numeric,'Approved Leave evidence'),
       (4,'unpaid_absence','Unpaid Absence',-coalesce((b->>'unpaid_absence_reduction')::numeric,0),'Confirmed Payroll / Attendance evidence')
     ) reductions(sequence,code,label,amount,description)
     where sequence=1 or amount<>0
    )
    -- Old/incomplete/non-reconciling evidence retains its canonical net amount.
    else jsonb_build_array(line) end
  ) with ordinality expansion(item,part)
 ) select coalesce(jsonb_agg(item order by ordinal,part),'[]') from presented;
$$;
revoke all on function public.payroll_earning_groups(jsonb) from public,anon,authenticated;
comment on function public.payroll_earning_groups(jsonb) is
 'Shared priced-earning presentation. Monthly contractual salary and source-labelled reductions reconcile the canonical net earning exactly once.';
