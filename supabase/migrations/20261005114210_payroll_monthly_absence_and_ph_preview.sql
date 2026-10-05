-- Targeted projection correction. No business evidence is rewritten.
-- Reuse the existing calendar-day Monthly entitlement and canonical PH quote.
CREATE OR REPLACE FUNCTION public.payroll_monthly_entitlement(p_employee_id uuid, p_period_id uuid, p_compensation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_employee public.employees%rowtype; v_period public.payroll_periods%rowtype;
  v_comp public.payroll_compensation_versions%rowtype; v_rule public.payroll_pay_rule_versions%rowtype;
  v_start date; v_end date; v_days integer; v_employed integer; v_unpaid integer:=0;
  v_leaves jsonb; v_dates jsonb; v_leave_dates jsonb; v_absence_dates jsonb:='[]';
  v_absences jsonb:='[]'; v_time public.payroll_payable_time_versions%rowtype; v_source jsonb;
  v_leave_days integer; v_leave_pay numeric; v_issues text[]:='{}'; v_outlet uuid; v_state text;
  v_state_version uuid; v_employed_pay numeric; v_pay numeric; v_basis jsonb;
  v_day date; v_assignment public.employee_employment_assignment_revisions%rowtype;
  v_first_active date; v_last_active date; v_unresolved date; v_active_dates jsonb:='[]'::jsonb;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_period from public.payroll_periods where id=p_period_id;
  select * into v_comp from public.payroll_compensation_versions where id=p_compensation_id;
  v_days:=v_period.period_end-v_period.period_start+1;
  v_start:=greatest(v_period.period_start,v_employee.joined_date);
  v_end:=v_period.period_end;
  v_employed:=0;
  for v_day in select generate_series(v_start,v_end,interval '1 day')::date loop
    v_assignment:=public.employee_employment_assignment_at(p_employee_id,v_day);
    if v_assignment.id is null then
      v_unresolved:=coalesce(v_unresolved,v_day);
    elsif v_assignment.employment_status='active'
      and (v_assignment.employment_end_date is null or v_day<=v_assignment.employment_end_date) then
      v_employed:=v_employed+1;
      v_first_active:=coalesce(v_first_active,v_day);
      v_last_active:=v_day;
      v_active_dates:=v_active_dates||to_jsonb(v_day::text);
    end if;
  end loop;
  if v_unresolved is not null then
    v_issues:=array_append(v_issues,'employment_history_unresolved');
  elsif v_employed=0 and v_employee.joined_date<=v_period.period_end then
    v_issues:=array_append(v_issues,'employment_assignment_requires_review');
  end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.start_date,l.id),'[]'::jsonb) into v_leaves
    from public.crew_approved_leaves l where l.employee_id=p_employee_id and l.leave_type='unpaid'
      and l.start_date<=v_period.period_end and l.end_date>=v_period.period_start;
  select count(*),coalesce(jsonb_agg(d.work_date order by d.work_date),'[]'::jsonb)
    into v_unpaid,v_dates from (select value::date work_date from jsonb_array_elements_text(v_active_dates)) d
    where exists(select 1 from public.crew_approved_leaves l where l.employee_id=p_employee_id
      and l.leave_type='unpaid' and l.duration_type='full_day' and d.work_date between l.start_date and l.end_date);
  v_leave_dates:=v_dates; v_leave_days:=v_unpaid;
  -- A full-day unpaid absence is an explicit current Payroll decision, not Leave.
  -- Read only the latest candidate per day. Never reuse stale or superseded evidence,
  -- infer an absence from missing punches, or absorb PH/Leave treatment here.
  for v_time in select distinct on (work_date) * from public.payroll_payable_time_versions
    where employee_id=p_employee_id and work_date between v_start and v_end
    order by work_date,revision desc loop
    if v_time.status not in ('approved_manual','non_payable')
      or v_time.classification<>'non_payable' or v_time.approved_minutes is distinct from 0
      or coalesce(v_time.approved_extra_minutes,0)<>0
      or not (v_active_dates ? v_time.work_date::text) then continue; end if;
    v_source:=public.payroll_time_evidence(p_employee_id,v_time.work_date);
    if v_source is null or v_time.source_fingerprint is distinct from v_source->>'source_fingerprint'
      or v_source->>'legal_entity_id' is distinct from v_period.legal_entity_id::text
      or v_source->>'pay_basis' is distinct from 'monthly'
      or v_source#>>'{paid_holiday_policy,status}'='paid_holiday'
      or v_source->>'classification' in ('public_holiday','public_holiday_ot') then continue; end if;
    -- Approved Leave owns its date even when a Payroll decision also exists.
    if exists(select 1 from public.crew_approved_leaves l where l.employee_id=p_employee_id
      and v_time.work_date between l.start_date and l.end_date) then continue; end if;
    v_absence_dates:=v_absence_dates||to_jsonb(v_time.work_date::text);
    v_absences:=v_absences||jsonb_build_array(jsonb_build_object('date',v_time.work_date,
      'time_version_id',v_time.id,'revision',v_time.revision,'source_fingerprint',v_time.source_fingerprint,
      'treatment','unpaid_absence','decision',to_jsonb(v_time)));
  end loop;
  select count(*),coalesce(jsonb_agg(d order by d),'[]') into v_unpaid,v_dates
    from (select distinct value d from jsonb_array_elements_text(v_leave_dates||v_absence_dates)) dates;
  if exists(select 1 from public.crew_approved_leaves l where l.employee_id=p_employee_id
      and l.leave_type='unpaid' and l.start_date<=v_end and l.end_date>=v_start and l.duration_type<>'full_day') then
    v_issues:=array_append(v_issues,'unpaid_half_day_policy_required');
  end if;
  if exists(select 1 from public.crew_approved_leaves a join public.crew_approved_leaves b
      on a.employee_id=b.employee_id and a.id<b.id and a.start_date<=b.end_date and b.start_date<=a.end_date
      where a.employee_id=p_employee_id and (a.leave_type='unpaid' or b.leave_type='unpaid')
        and greatest(a.start_date,b.start_date)<=v_end and least(a.end_date,b.end_date)>=v_start) then
    v_issues:=array_append(v_issues,'unpaid_leave_overlap_requires_review');
  end if;
  if exists(select 1 from public.crew_attendance_records a join public.crew_approved_leaves l
      on l.employee_id=a.employee_id and timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date between l.start_date and l.end_date
      where l.employee_id=p_employee_id and l.leave_type='unpaid'
        and timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date between v_start and v_end) then
    v_issues:=array_append(v_issues,'unpaid_leave_attendance_conflict');
  end if;
  select * into v_rule from public.payroll_pay_rule_versions where rule_code='monthly_proration'
    and pay_basis='monthly' and effective_from<=v_period.period_start order by effective_from desc limit 1;
  if v_employed<v_days or v_unpaid>0 or jsonb_array_length(v_leaves)>0 then
    if v_rule.id is null or v_rule.formula_code is distinct from 'ea18a_calendar_days_v1' then
      v_issues:=array_append(v_issues,'monthly_calendar_rule_confirmation_required');
    end if;
    -- Fail closed outside verified s18A geography. Do not derive jurisdiction
    -- from a free-text address or infer Factory/Management location.
    -- Compensation scope guard snapshots this from canonical workplace,
    -- rejecting a client-selected cost outlet (20260925085144).
    v_outlet:=v_comp.default_cost_outlet_id;
    if v_outlet is null and (select count(distinct l.employment_outlet_id) from public.crew_approved_leaves l
        where l.employee_id=p_employee_id and l.leave_type='unpaid' and l.start_date<=v_end and l.end_date>=v_start)=1 then
      select l.employment_outlet_id into v_outlet from public.crew_approved_leaves l where l.employee_id=p_employee_id
        and l.leave_type='unpaid' and l.start_date<=v_end and l.end_date>=v_start limit 1;
    end if;
    select id,state_code into v_state_version,v_state from public.payroll_outlet_state_versions
      where outlet_id=v_outlet and effective_from<=v_start order by effective_from desc,created_at desc limit 1;
    if v_state is null or v_state not in ('MY-01','MY-02','MY-03','MY-04','MY-05','MY-06','MY-07',
      'MY-08','MY-09','MY-10','MY-11','MY-14','MY-15','MY-16') then
      v_issues:=array_append(v_issues,'monthly_proration_jurisdiction_requires_review');
    end if;
    if exists(select 1 from public.payroll_outlet_state_versions where outlet_id=v_outlet
        and effective_from>v_start and effective_from<=v_end and state_code is distinct from v_state) then
      v_issues:=array_append(v_issues,'monthly_proration_jurisdiction_change');
    end if;
  end if;
  -- Round the final entitlement once; displayed reduction reconciles exactly.
  v_employed_pay:=round(v_comp.basic_salary*v_employed/v_days,2);
  v_leave_pay:=round(v_comp.basic_salary*(v_employed-v_leave_days)/v_days,2);
  v_pay:=round(v_comp.basic_salary*(v_employed-v_unpaid)/v_days,2);
  v_basis:=jsonb_build_object('formula_code','ea18a_calendar_days_v1','rule_version_id',v_rule.id,
    'rule_source',v_rule.source_note,'period_start',v_period.period_start,'period_end',v_period.period_end,
    'employment_start',v_first_active,'employment_end',v_last_active,'joined_date',v_employee.joined_date,
    'last_employment_date',v_assignment.employment_end_date,'period_days',v_days,'employed_days',v_employed,
    'active_employment_dates',v_active_dates,
    'unpaid_leave_days',v_leave_days,'unpaid_leave_dates',v_leave_dates,
    'unpaid_absence_days',jsonb_array_length(v_absence_dates),'unpaid_absence_dates',v_absence_dates,
    'confirmed_unpaid_absences',v_absences,
    'unpaid_days',v_unpaid,'eligible_days',v_employed-v_unpaid,'unpaid_dates',v_dates,
    'approved_unpaid_leaves',v_leaves,'monthly_salary',v_comp.basic_salary,
    'employment_reduction',v_comp.basic_salary-v_employed_pay,'unpaid_leave_reduction',v_employed_pay-v_leave_pay,
    'unpaid_absence_reduction',v_leave_pay-v_pay,
    'payable_basic_salary',v_pay,'outlet_state_version_id',v_state_version,'state_code',v_state,
    'rounding','Final basic entitlement rounded to RM0.01; reduction is reconciliation, not a second deduction.');
  return jsonb_build_object('amount',case when cardinality(v_issues)=0 then v_pay else null end,
    'issues',to_jsonb(v_issues),'basis',v_basis);
end; $function$

;
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
          and (v_employee.resigned_date is null or v_employee.resigned_date>=v_period.period_start)
          and v_entitlement->>'amount' is not null then
          v_line:=jsonb_build_object('kind','earning','code','monthly_basic',
            'label','Basic Salary','amount',(v_entitlement->>'amount')::numeric,
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
  v_inputs:=v_inputs||jsonb_build_object('calculation_contract','payroll_time_exception_v2'); v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
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
end; $function$

;
CREATE OR REPLACE FUNCTION public.payroll_ph_treatment_preview(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q jsonb; current_day jsonb; normal numeric; regular numeric; overtime numeric; company numeric; total numeric; previous numeric; determinate boolean; allowance_determinate boolean; allowance_line jsonb;
begin
 perform payroll_admin_actor();
 if not payroll_can_access_run_employee((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,'payroll.view') then raise insufficient_privilege using message='Payroll PH visibility denied.';end if;
 q:=payroll_ph_treatment_quote((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,(p_input->>'date')::date,p_input);
 current_day:=payroll_ph_statutory_project((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,(p_input->>'date')::date);
 select coalesce(sum((x->>'amount')::numeric) filter(where (x->>'code'='public_holiday' or (p_input->>'treatment_model'='unified_v1' and x->>'code'='company_ph_benefit'))),0),
 coalesce(sum((x->>'amount')::numeric) filter(where x->>'code'='public_holiday_ot'),0),
 coalesce(sum((x->>'amount')::numeric) filter(where x->>'code'='company_ph_benefit'),0),
 coalesce(sum((x->>'amount')::numeric) filter(where x->>'kind'='earning'),0)
 into normal,overtime,company,total from jsonb_array_elements(q->'lines') x;
 -- Canonical calculation consumes only resolved lines, even while other dates
 -- remain Pending Review. Compare with that same day contribution, not stale cache.
 select coalesce(sum((x->>'amount')::numeric) filter(where x->>'kind'='earning'),0) into previous from jsonb_array_elements(current_day->'lines') x;
 select coalesce(sum((x->>'amount')::numeric),0) into regular from jsonb_array_elements(q->'lines') x where x->>'code'='regular';
 determinate:=p_input->>'treatment' in ('statutory','custom','none','company') and jsonb_array_length(q->'issues')=0
   and (p_input->>'treatment'<>'statutory' or q->>'statutory_available'='true');
 -- A known allowance must remain visible independently of unresolved PH OT.
 -- Only the quote's canonical earning line is evidence of a resolved allowance;
 -- missing/invalid time, policy, replacement Leave or other blockers stay blocking.
 select x into allowance_line from jsonb_array_elements(q->'lines') x
   where x->>'code' in ('public_holiday','company_ph_benefit') limit 1;
 allowance_determinate:=determinate or (p_input->>'treatment_model'='unified_v1'
   and p_input->>'treatment'='company' and allowance_line is not null
   and not exists(select 1 from jsonb_array_elements_text(q->'issues') issue
     where issue<>'ph_ot_statutory_evidence_required'));
 return q||jsonb_build_object('pay_preview',jsonb_build_object('determinate',determinate,'allowance_determinate',allowance_determinate,
 'allowance_basis',case when allowance_determinate then allowance_line end,
 'regular_pay',regular,'monthly_basic_included',q#>>'{context,compensation,pay_basis}'='monthly',
 'public_holiday_allowance',case when allowance_determinate then normal end,'ph_ot',case when determinate then overtime end,
 'company_ph_benefit',case when determinate then case when p_input->>'treatment_model'='unified_v1' then 0 else company end end,'total_day_additions',case when determinate then total end,
 'previous_day_additions',previous,'payroll_change',case when determinate then total-previous end));
end $function$

;

-- Existing private/public boundaries remain unchanged.
revoke all on function public.payroll_monthly_entitlement(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.payroll_calculation_project(uuid,uuid) from public,anon,authenticated;
revoke all on function public.payroll_ph_treatment_preview(jsonb) from public,anon;
grant execute on function public.payroll_ph_treatment_preview(jsonb) to authenticated;
notify pgrst,'reload schema';
