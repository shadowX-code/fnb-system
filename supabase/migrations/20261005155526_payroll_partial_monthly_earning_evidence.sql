-- Preserve independently verified contractual salary when monthly entitlement pricing is blocked.
-- Null canonical net salary never authorizes Gross, statutory readiness or Finalize.
CREATE OR REPLACE FUNCTION public.payroll_calculation_project(p_run_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee public.employees%rowtype; v_profile public.payroll_profiles%rowtype;
  v_first public.payroll_compensation_versions%rowtype;
  v_last public.payroll_compensation_versions%rowtype;
  v_day_comp public.payroll_compensation_versions%rowtype;
  v_time public.payroll_payable_time_versions%rowtype;
  v_component public.payroll_component_definitions%rowtype;
  v_recurring public.payroll_recurring_component_versions%rowtype;
  v_rule public.payroll_pay_rule_versions%rowtype;
  v_day date; v_source jsonb; v_line jsonb; v_lines jsonb:='[]'::jsonb;
  v_inputs jsonb; v_issues text[]:='{}'; v_gross numeric(14,2):=0;
  v_deductions numeric(14,2):=0; v_reimbursements numeric(14,2):=0;
  v_regular_minutes integer:=0; v_billable_minutes integer; v_rule_code text;
  v_component_id uuid; v_change_count integer; v_status text; v_basis text;
  v_detail text; v_adjustment record; v_employment jsonb; v_employment_issue text; v_entitlement jsonb; v_ph jsonb; v_requirement jsonb; v_time_review jsonb:='[]'::jsonb;
begin
  select * into v_run from public.payroll_runs where id=p_run_id;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  select * into v_employee from public.employees where id=p_employee_id;
  if v_run.id is null or v_employee.id is null then
    raise exception using errcode='P0002',message='Payroll Run or employee not found.';
  end if;
  select * into v_profile from public.payroll_profiles where employee_id=p_employee_id;
  v_inputs:=jsonb_build_object('period_id',v_period.id,'employee_id',p_employee_id,
    'legal_entity_id',v_period.legal_entity_id,'joined_date',v_employee.joined_date,
    'resigned_date',v_employee.resigned_date,'employment_status',v_employee.employment_status,
    'time',jsonb_build_array(),'components',jsonb_build_array(),'rules',jsonb_build_array(),
    'rule_catalog',coalesce((select jsonb_agg(to_jsonb(rule) order by rule.rule_code,rule.pay_basis,rule.effective_from)
      from public.payroll_pay_rule_versions rule where rule.effective_from<=v_period.period_end),'[]'::jsonb));
  if v_employee.joined_date is null then
    v_issues:=array_append(v_issues,'employment_start_date_requires_review');
  elsif v_employee.joined_date>v_period.period_end then
    v_issues:=array_append(v_issues,'employee_not_yet_joined');
  end if;
  -- Period employment eligibility is resolved from People below.
  if v_profile.id is null then
    v_issues:=array_append(v_issues,'missing_payroll_profile');
  else
    select * into v_first from public.payroll_compensation_versions
      where profile_id=v_profile.id and effective_from<=greatest(v_period.period_start,coalesce(v_employee.joined_date,v_period.period_start))
      order by effective_from desc,revision desc limit 1;
    select * into v_last from public.payroll_compensation_versions
      where profile_id=v_profile.id and effective_from<=v_period.period_end
      order by effective_from desc,revision desc limit 1;
    -- Hourly pay is priced by each work date; an effective mid-month rate does
    -- not imply a monthly proration policy or invalidate earlier non-work days.
    if v_first.id is null and v_last.pay_basis='hourly' then v_first:=v_last; end if;
    v_inputs:=v_inputs || jsonb_build_object('profile_id',v_profile.id,
      'compensation_start',to_jsonb(v_first),'compensation_end',to_jsonb(v_last));
    if v_first.id is null or v_last.id is null then
      v_issues:=array_append(v_issues,'pay_history_missing:'||greatest(v_period.period_start,coalesce(v_employee.joined_date,v_period.period_start))::text||'..'||least(v_period.period_end,coalesce((select min(effective_from)-1 from public.payroll_compensation_versions where profile_id=v_profile.id and effective_from>greatest(v_period.period_start,coalesce(v_employee.joined_date,v_period.period_start))),v_period.period_end))::text);
    elsif v_first.legal_entity_id<>v_period.legal_entity_id or v_last.legal_entity_id<>v_period.legal_entity_id then
      v_issues:=array_append(v_issues,'legal_employer_change_requires_review');
    end if;
    if v_first.id is not null then
      v_basis:=v_first.pay_basis;
      if v_first.currency<>'MYR' then v_issues:=array_append(v_issues,'non_myr_currency_requires_review'); end if;
      if v_first.id is distinct from v_last.id and v_first.pay_basis='monthly' then
        v_issues:=array_append(v_issues,'monthly_rate_change_requires_proration_policy');
      end if;
      if v_first.pay_basis='monthly' then
        v_entitlement:=public.payroll_monthly_entitlement(p_employee_id,v_period.id,v_first.id);
        v_inputs:=v_inputs||jsonb_build_object('monthly_entitlement',v_entitlement->'basis');
        select v_issues||coalesce(array_agg(issue),'{}'::text[]) into v_issues
          from jsonb_array_elements_text(v_entitlement->'issues') issue;
        select * into v_rule from public.payroll_pay_rule_versions
          where rule_code='monthly_basic' and pay_basis='monthly'
            and effective_from<=v_period.period_start order by effective_from desc limit 1;
        if v_rule.id is null then v_issues:=array_append(v_issues,'missing_monthly_basic_rule');
        elsif v_first.id=v_last.id and v_first.currency='MYR'
          and v_employee.joined_date is not null and v_employee.joined_date<=v_period.period_end
          and (v_employee.resigned_date is null or v_employee.resigned_date>=v_period.period_start) then
          v_line:=jsonb_build_object('kind','earning','code','monthly_basic',
            'label','Basic Salary','amount',(v_entitlement->>'amount')::numeric,
            'contractual_amount',v_first.basic_salary,
            'calculation_state',case when v_entitlement->>'amount' is null then 'review_required' else 'resolved' end,
            'source',jsonb_build_object('compensation_version_id',v_first.id,
              'rule_version_id',v_rule.id,'rule_source',v_rule.source_note,
              'monthly_entitlement',v_entitlement->'basis',
              'period_start',v_period.period_start,'period_end',v_period.period_end));
          v_lines:=v_lines||jsonb_build_array(v_line);
          v_gross:=v_gross+(v_entitlement->>'amount')::numeric;
          v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||to_jsonb(v_rule.id));
        end if;
      end if;
    end if;
  end if;

  -- A time result is counted only when it is the latest approved decision for
  -- the same current source fingerprint. A changed source never stays payable.
  if v_profile.id is not null then
    for v_day in select generate_series(v_period.period_start,v_period.period_end,interval '1 day')::date loop
      if v_day<coalesce(v_employee.joined_date,v_period.period_start)
        or v_day>coalesce(v_employee.resigned_date,v_period.period_end) then continue; end if;
      -- Approved Monthly unpaid leave is a calendar-day Basic entitlement,
      -- independent of roster duration or a Payroll time override. The helper
      -- pins canonical leave and blocks conflicts/unsupported units.

      v_source:=public.payroll_time_evidence(p_employee_id,v_day);
      select * into v_time from public.payroll_payable_time_versions
        where profile_id=v_profile.id and work_date=v_day order by revision desc limit 1;
      v_requirement:=public.payroll_time_requirement(v_source,to_jsonb(v_time));
      if v_source is not null and v_source->>'legal_entity_id'=v_period.legal_entity_id::text then
        v_time_review:=v_time_review||jsonb_build_array(v_requirement||jsonb_build_object('work_date',v_day));
      end if;
      v_ph:=public.payroll_ph_statutory_project(p_run_id,p_employee_id,v_day);
      if v_ph is not null then
       v_inputs:=jsonb_set(v_inputs,'{ph_statutory}',coalesce(v_inputs->'ph_statutory','[]'::jsonb)||jsonb_build_array(v_ph),true);
       select v_issues||coalesce(array_agg(issue||':'||v_day),'{}'::text[]) into v_issues from jsonb_array_elements_text(v_ph->'issues') issue;
       for v_line in select value from jsonb_array_elements(v_ph->'lines') loop
        v_line:=jsonb_set(v_line,'{source,ph_review_id}',coalesce(v_ph#>'{review,id}','null'::jsonb),true);
        v_lines:=v_lines||jsonb_build_array(v_line); v_gross:=v_gross+(v_line->>'amount')::numeric;
       end loop;
       continue;
      end if;
      if v_source#>>'{paid_holiday_policy,status}'='paid_holiday' then
       v_issues:=array_append(v_issues,'ph_employment_or_pay_evidence_required:'||v_day); continue;
      end if;
      if v_source is null or v_source->>'legal_entity_id' is distinct from v_period.legal_entity_id::text then
        continue;
      end if;
      select * into v_day_comp from public.payroll_compensation_versions
        where profile_id=v_profile.id and effective_from<=v_day order by effective_from desc,revision desc limit 1;
      select * into v_time from public.payroll_payable_time_versions
        where profile_id=v_profile.id and work_date=v_day order by revision desc limit 1;
      v_inputs:=jsonb_set(v_inputs,'{time}',v_inputs->'time'||jsonb_build_array(
        jsonb_build_object('date',v_day,'source_fingerprint',v_source->>'source_fingerprint',
          'time_version_id',v_time.id,'time_status',v_time.status,
          'compensation_version_id',v_day_comp.id)));
      if v_day_comp.id is null or v_day_comp.legal_entity_id<>v_period.legal_entity_id
        or v_first.id is null or v_day_comp.pay_basis<>v_first.pay_basis
        or v_day_comp.currency<>'MYR' then
        v_issues:=array_append(v_issues,'missing_or_changed_daily_compensation:'||v_day);
        continue;
      end if;
      if (v_requirement->>'automatic')::boolean then
        -- Monthly normal attendance and approved Leave are already authoritative.
        -- Monthly unpaid Leave is priced once by monthly_entitlement, never again here.
        continue;
      end if;
      if v_time.id is null then
        v_issues:=array_append(v_issues,'unreconciled_time:'||v_day); continue;
      end if;
      if v_time.source_fingerprint is distinct from v_source->>'source_fingerprint' then
        v_issues:=array_append(v_issues,'stale_time_evidence:'||v_day); continue;
      end if;
      if v_time.status='review_required' then
        v_issues:=array_append(v_issues,'unresolved_time_exception:'||v_day); continue;
      end if;

      if v_time.classification='leave' then
        if v_basis='hourly' then v_issues:=array_append(v_issues,'paid_leave_pay_rule_required:'||v_day); end if;
        continue;
      end if;
      if v_time.classification='non_payable' then
        select * into v_rule from public.payroll_pay_rule_versions
          where rule_code='non_payable' and pay_basis=v_basis and effective_from<=v_day
          order by effective_from desc limit 1;
        if v_rule.id is null then v_issues:=array_append(v_issues,'missing_non_payable_rule:'||v_day);
        else v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||to_jsonb(v_rule.id)); end if;
        -- Full-day Monthly unpaid absence is priced once by monthly_entitlement.
        -- Hourly non-payable remains zero; no second roster-minute deduction.
        if v_basis='monthly' and (v_time.approved_minutes is distinct from 0
          or coalesce(v_time.approved_extra_minutes,0)<>0) then
          v_issues:=array_append(v_issues,'non_payable_time_requires_review:'||v_day);
        end if;
        continue;
      end if;

      
 -- Regular Monthly time is already covered by Basic Salary, but an
      -- approved deficit needs a sourced unpaid-time rule and approved extra
      -- minutes need a sourced premium rule.
      if v_basis='monthly' and v_time.classification='regular' then
        v_billable_minutes:=greatest(0,coalesce(v_time.scheduled_minutes,0)-coalesce(v_time.approved_minutes,0));
        if v_billable_minutes>0 then
          v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,'unpaid_time',v_billable_minutes,v_day);
          if v_line is null then v_issues:=array_append(v_issues,'missing_unpaid_time_rule:'||v_day);
          else v_lines:=v_lines||jsonb_build_array(v_line);
            v_deductions:=v_deductions+(v_line->>'amount')::numeric;
            v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          end if;
        end if;
      else
        v_rule_code:=case when v_time.classification='regular' then 'regular'
          else v_time.classification end;
        v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,v_rule_code,
          coalesce(v_time.approved_minutes,0),v_day);
        if v_line is null then v_issues:=array_append(v_issues,'missing_'||v_rule_code||'_rule:'||v_day);
        else v_lines:=v_lines||jsonb_build_array(v_line);
          v_gross:=v_gross+(v_line->>'amount')::numeric;
          v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          if v_rule_code='regular' then v_regular_minutes:=v_regular_minutes+coalesce(v_time.approved_minutes,0); end if;
        end if;
      end if;
      if coalesce(v_time.approved_extra_minutes,0)>0 then
        v_rule_code:=case v_time.classification when 'regular' then 'overtime'
          when 'public_holiday' then 'public_holiday_ot' else null end;
        if v_rule_code is null then v_issues:=array_append(v_issues,'extra_time_policy_required:'||v_day);
        else
          v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,v_rule_code,
            v_time.approved_extra_minutes,v_day);
          if v_line is null then v_issues:=array_append(v_issues,'missing_'||v_rule_code||'_rule:'||v_day);
          else v_lines:=v_lines||jsonb_build_array(v_line);
            v_gross:=v_gross+(v_line->>'amount')::numeric;
            v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          end if;
        end if;
      end if;
    end loop;


    for v_component_id in select distinct component_id from public.payroll_recurring_component_versions
      where profile_id=v_profile.id and effective_from<=v_period.period_end loop
      v_source:=public.payroll_recurring_period_project(v_profile.id,v_component_id,v_period.period_start,
        v_period.period_end,v_employee.joined_date,v_employee.resigned_date);
      v_inputs:=jsonb_set(v_inputs,'{components}',v_inputs->'components'||jsonb_build_array(v_source->'evidence'));
      if v_source->>'issue' is not null then v_issues:=array_append(v_issues,v_source->>'issue'); continue; end if;
      v_line:=v_source->'line';
      if v_line is null or v_line='null'::jsonb then continue; end if;
      v_lines:=v_lines||jsonb_build_array(v_line);
      if v_line->>'kind'='deduction' then v_deductions:=v_deductions+(v_line->>'amount')::numeric;
      elsif v_line->>'kind'='reimbursement' then v_reimbursements:=v_reimbursements+(v_line->>'amount')::numeric;
      else v_gross:=v_gross+(v_line->>'amount')::numeric; end if;
    end loop;
  end if;

  for v_adjustment in select a.id,a.component_id,a.amount from public.payroll_run_component_adjustments a
    where a.run_id=p_run_id and a.employee_id=p_employee_id and a.reverses_id is null
      and not exists(select 1 from public.payroll_run_component_adjustments reversal
        where reversal.reverses_id=a.id) order by a.created_at,a.id loop
    select * into v_component from public.payroll_component_definitions where id=v_adjustment.component_id;
    v_line:=jsonb_build_object('kind',case v_component.component_type
        when 'deduction' then 'deduction' when 'reimbursement' then 'reimbursement' else 'earning' end,
      'code',v_component.code,'label',v_component.name,'amount',v_adjustment.amount,
      'source',jsonb_build_object('run_adjustment_id',v_adjustment.id,
        'component_definition_id',v_component.id));
    v_lines:=v_lines||jsonb_build_array(v_line);
    if v_component.component_type='deduction' then v_deductions:=v_deductions+v_adjustment.amount;
    elsif v_component.component_type='reimbursement' then v_reimbursements:=v_reimbursements+v_adjustment.amount;
    else v_gross:=v_gross+v_adjustment.amount; end if;
    v_inputs:=jsonb_set(v_inputs,'{components}',v_inputs->'components'||jsonb_build_array(
      jsonb_build_object('adjustment_id',v_adjustment.id,'definition',to_jsonb(v_component))));
  end loop;
  v_employment:=public.payroll_period_employment_resolve(p_employee_id,v_period.id);
  v_employment_issue:=v_employment->>'issue';
  if v_employment->>'state'<>'resolved' or v_employment->'identity'->>'legal_entity_id' is distinct from v_period.legal_entity_id::text then
    v_issues:=array_append(v_issues,coalesce(v_employment_issue,'employment_assignment_requires_review'));
  end if;
  v_inputs:=v_inputs||jsonb_build_object('employment_assignment',v_employment);
  v_inputs:=v_inputs||jsonb_build_object('calculation_contract','payroll_partial_monthly_evidence_v3'); v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
  v_detail:=case when v_basis='monthly' then 'Basic '||coalesce(v_first.basic_salary::text,'—')
    when v_basis='hourly' then round(v_regular_minutes::numeric/60,2)::text||' regular hours'
    else null end;
  return jsonb_build_object('employee_id',p_employee_id,'profile_id',v_profile.id,
    'employee_name',v_employee.full_name,'employee_code',v_employee.employee_code,
    'pay_basis',v_basis,'basic_or_hours',v_detail,'currency','MYR',
    'status',v_status,'issues',to_jsonb(v_issues),'lines',v_lines,'time_review',v_time_review,
    'gross_earnings',v_gross,'non_statutory_deductions',v_deductions,
    'reimbursements',v_reimbursements,'pre_statutory_pay',v_gross-v_deductions+v_reimbursements,
    'inputs',v_inputs,'input_fingerprint',md5(v_inputs::text));
end; $function$;

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
     and line->>'calculation_state'='review_required'
     and line->>'amount' is null and (line->>'contractual_amount')::numeric >= 0
    then (
     select jsonb_agg(line || jsonb_build_object(
       'code',code,'label',label,'amount',amount,'units',description,
       'calculation_state',case when sequence=1 then 'resolved' else 'review_required' end,
       'presentation_model','monthly_salary_partial_evidence_v1','canonical_amount',line->'amount'
     ) order by sequence)
     from (values
       (1,'monthly_basic','Basic Salary',(line->>'contractual_amount')::numeric,'Contractual monthly salary; payable salary remains under review',true),
       (2,'employment_proration','Employment Proration',null::numeric,'Employment / pricing evidence requires review',coalesce((b->>'employed_days')::int < (b->>'period_days')::int,true)),
       (3,'unpaid_leave','Unpaid Leave',null::numeric,'Approved Leave evidence; salary effect requires review',coalesce((b->>'unpaid_leave_days')::int,0)>0),
       (4,'unpaid_absence','Unpaid Absence',null::numeric,'Confirmed Payroll / Attendance evidence; salary effect requires review',coalesce((b->>'unpaid_absence_days')::int,0)>0)
     ) reductions(sequence,code,label,amount,description,applicable)
     where applicable
    )
    when line->>'code'='monthly_basic'
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
