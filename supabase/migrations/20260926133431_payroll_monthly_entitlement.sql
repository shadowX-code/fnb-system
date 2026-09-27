-- JTKSM Employment Act 1955 s18A: calendar wage-period days, not s60I/OT divisor.
-- Supported: unchanged Monthly basic salary, inclusive employment dates and
-- canonical approved full-day unpaid leave. Other remuneration policies stay gated.
alter table public.payroll_pay_rule_versions add column formula_code text;
alter table public.payroll_pay_rule_versions drop constraint payroll_pay_rule_versions_rule_code_check;
alter table public.payroll_pay_rule_versions add constraint payroll_pay_rule_versions_rule_code_check
  check (rule_code in ('monthly_basic','regular','overtime','rest_day','public_holiday',
    'public_holiday_ot','unpaid_time','non_payable','monthly_proration'));
alter table public.payroll_pay_rule_versions drop constraint payroll_pay_rule_versions_check;
alter table public.payroll_pay_rule_versions add constraint payroll_pay_rule_versions_check
  check ((pay_basis='hourly' and monthly_divisor_minutes is null)
    or (pay_basis='monthly' and ((rule_code in ('monthly_basic','non_payable','monthly_proration')
      and monthly_divisor_minutes is null) or (rule_code not in
      ('monthly_basic','non_payable','monthly_proration') and monthly_divisor_minutes is not null))));
alter table public.payroll_pay_rule_versions add constraint payroll_monthly_formula_check
  check ((rule_code='monthly_proration' and pay_basis='monthly' and multiplier=1
    and formula_code is not distinct from 'ea18a_calendar_days_v1') or (rule_code<>'monthly_proration' and formula_code is null));

-- Explicit Admin confirmation records the real approving actor; no impersonated
-- migration-seeded employee approval. The immutable formula is not editable as a multiplier.
create function public.payroll_monthly_rule_confirm()
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_id uuid;
begin
  if not public.current_user_has_permission('payroll.manage') or not exists
    (select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=v_actor and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Payroll rule authority required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('payroll-monthly-ea18a-v1'));
  select id into v_id from public.payroll_pay_rule_versions where rule_code='monthly_proration'
    and pay_basis='monthly' and effective_from=date '2023-01-01';
  if v_id is not null then return v_id; end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_pay_rule_versions(rule_code,pay_basis,effective_from,multiplier,
    formula_code,source_note,reason,approved_by_employee_id)
  values('monthly_proration','monthly','2023-01-01',1,'ea18a_calendar_days_v1',
    'Employment Act 1955 s18A; JTKSM BPP2026 Pembayaran Upah: monthly wages / wage-period calendar days * eligible days. https://jtksm.mohr.gov.my/sites/default/files/2026-04/BPP2026%20-%20Pembayaran%20Upah.pdf',
    'Confirm official calendar-day Monthly basic entitlement for supported employment/unpaid-leave evidence; no OT divisor or rate blending.',v_actor)
    returning id into v_id;
  insert into public.payroll_events(event_type,rule_version_id,actor_employee_id,reason,details)
    values('pay_rule_published',v_id,v_actor,'Official Monthly calendar-day formula confirmed',
      jsonb_build_object('formula_code','ea18a_calendar_days_v1','rule_version_id',v_id));
  return v_id;
end; $$;
revoke all on function public.payroll_monthly_rule_confirm() from public,anon;
grant execute on function public.payroll_monthly_rule_confirm() to authenticated;

create function public.payroll_monthly_entitlement(p_employee_id uuid,p_period_id uuid,p_compensation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_period public.payroll_periods%rowtype;
  v_comp public.payroll_compensation_versions%rowtype; v_rule public.payroll_pay_rule_versions%rowtype;
  v_start date; v_end date; v_days integer; v_employed integer; v_unpaid integer:=0;
  v_leaves jsonb; v_dates jsonb; v_issues text[]:='{}'; v_outlet uuid; v_state text;
  v_state_version uuid; v_employed_pay numeric; v_pay numeric; v_basis jsonb;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_period from public.payroll_periods where id=p_period_id;
  select * into v_comp from public.payroll_compensation_versions where id=p_compensation_id;
  v_days:=v_period.period_end-v_period.period_start+1;
  v_start:=greatest(v_period.period_start,v_employee.joined_date);
  v_end:=least(v_period.period_end,coalesce(v_employee.resigned_date,v_period.period_end));
  v_employed:=greatest(0,v_end-v_start+1);
  select coalesce(jsonb_agg(to_jsonb(l) order by l.start_date,l.id),'[]'::jsonb) into v_leaves
    from public.crew_approved_leaves l where l.employee_id=p_employee_id and l.leave_type='unpaid'
      and l.start_date<=v_period.period_end and l.end_date>=v_period.period_start;
  select count(*),coalesce(jsonb_agg(d.work_date order by d.work_date),'[]'::jsonb)
    into v_unpaid,v_dates from (select generate_series(v_start,v_end,interval '1 day')::date work_date) d
    where exists(select 1 from public.crew_approved_leaves l where l.employee_id=p_employee_id
      and l.leave_type='unpaid' and l.duration_type='full_day' and d.work_date between l.start_date and l.end_date);
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
  v_pay:=round(v_comp.basic_salary*(v_employed-v_unpaid)/v_days,2);
  v_basis:=jsonb_build_object('formula_code','ea18a_calendar_days_v1','rule_version_id',v_rule.id,
    'rule_source',v_rule.source_note,'period_start',v_period.period_start,'period_end',v_period.period_end,
    'employment_start',v_start,'employment_end',v_end,'joined_date',v_employee.joined_date,
    'last_employment_date',v_employee.resigned_date,'period_days',v_days,'employed_days',v_employed,
    'unpaid_days',v_unpaid,'eligible_days',v_employed-v_unpaid,'unpaid_dates',v_dates,
    'approved_unpaid_leaves',v_leaves,'monthly_salary',v_comp.basic_salary,
    'employment_reduction',v_comp.basic_salary-v_employed_pay,'unpaid_leave_reduction',v_employed_pay-v_pay,
    'payable_basic_salary',v_pay,'outlet_state_version_id',v_state_version,'state_code',v_state,
    'rounding','Final basic entitlement rounded to RM0.01; reduction is reconciliation, not a second deduction.');
  return jsonb_build_object('amount',case when cardinality(v_issues)=0 then v_pay else null end,
    'issues',to_jsonb(v_issues),'basis',v_basis);
end; $$;
revoke all on function public.payroll_monthly_entitlement(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.payroll_calculation_project(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
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
  v_detail text; v_adjustment record; v_entitlement jsonb;
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
  if v_employee.resigned_date is not null and v_employee.resigned_date<v_period.period_start then
    v_issues:=array_append(v_issues,'employment_ended_before_period');
  end if;
  if v_profile.id is null then
    v_issues:=array_append(v_issues,'missing_payroll_profile');
  else
    select * into v_first from public.payroll_compensation_versions
      where profile_id=v_profile.id and effective_from<=greatest(v_period.period_start,coalesce(v_employee.joined_date,v_period.period_start))
      order by effective_from desc limit 1;
    select * into v_last from public.payroll_compensation_versions
      where profile_id=v_profile.id and effective_from<=v_period.period_end
      order by effective_from desc limit 1;
    -- Hourly pay is priced by each work date; an effective mid-month rate does
    -- not imply a monthly proration policy or invalidate earlier non-work days.
    if v_first.id is null and v_last.pay_basis='hourly' then v_first:=v_last; end if;
    v_inputs:=v_inputs || jsonb_build_object('profile_id',v_profile.id,
      'compensation_start',to_jsonb(v_first),'compensation_end',to_jsonb(v_last));
    if v_first.id is null or v_last.id is null then
      v_issues:=array_append(v_issues,'missing_effective_compensation_or_proration_policy');
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
      if v_basis='monthly' and exists(select 1 from public.crew_approved_leaves l
        where l.employee_id=p_employee_id and l.leave_type='unpaid'
          and v_day between l.start_date and l.end_date) then continue; end if;
      v_source:=public.payroll_time_evidence(p_employee_id,v_day);
      if v_source is null or v_source->>'legal_entity_id' is distinct from v_period.legal_entity_id::text then
        continue;
      end if;
      select * into v_day_comp from public.payroll_compensation_versions
        where profile_id=v_profile.id and effective_from<=v_day order by effective_from desc limit 1;
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
        if v_basis='monthly' and coalesce(v_time.scheduled_minutes,0)>0 then
          v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,'unpaid_time',v_time.scheduled_minutes,v_day);
          if v_line is null then v_issues:=array_append(v_issues,'missing_unpaid_time_rule:'||v_day);
          else v_lines:=v_lines||jsonb_build_array(v_line);
            v_deductions:=v_deductions+(v_line->>'amount')::numeric;
            v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          end if;
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

    -- Fixed recurring components are only unambiguous if one assignment
    -- applies for the whole period. Mid-period changes need a reviewed policy.
    for v_component_id in select distinct component_id from public.payroll_recurring_component_versions
      where profile_id=v_profile.id and effective_from<=v_period.period_end loop
      select * into v_recurring from public.payroll_recurring_component_versions
        where profile_id=v_profile.id and component_id=v_component_id
          and effective_from<=v_period.period_start order by effective_from desc limit 1;
      select count(*) into v_change_count from public.payroll_recurring_component_versions
        where profile_id=v_profile.id and component_id=v_component_id
          and effective_from>v_period.period_start and effective_from<=v_period.period_end;
      if v_change_count>0 then
        v_issues:=array_append(v_issues,'mid_period_component_change:'||v_component_id); continue;
      end if;
      if v_recurring.id is null or not v_recurring.is_active then continue; end if;
      select * into v_component from public.payroll_component_definitions where id=v_component_id;
      if v_basis='monthly' and (v_entitlement->'basis'->>'eligible_days')::integer
          <(v_entitlement->'basis'->>'period_days')::integer then
        v_issues:=array_append(v_issues,'monthly_components_entitlement_policy_required:'||v_component_id);
        continue;
      end if;
      v_line:=jsonb_build_object('kind',case v_component.component_type
          when 'deduction' then 'deduction' when 'reimbursement' then 'reimbursement' else 'earning' end,
        'code',v_component.code,'label',v_component.name,'amount',v_recurring.amount,
        'source',jsonb_build_object('component_definition_id',v_component.id,
          'component_version_id',v_recurring.id,'effective_from',v_recurring.effective_from));
      v_lines:=v_lines||jsonb_build_array(v_line);
      if v_component.component_type='deduction' then v_deductions:=v_deductions+v_recurring.amount;
      elsif v_component.component_type='reimbursement' then v_reimbursements:=v_reimbursements+v_recurring.amount;
      else v_gross:=v_gross+v_recurring.amount; end if;
      v_inputs:=jsonb_set(v_inputs,'{components}',v_inputs->'components'||jsonb_build_array(
        jsonb_build_object('version_id',v_recurring.id,'definition',to_jsonb(v_component))));
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
  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
  v_detail:=case when v_basis='monthly' then 'Basic '||coalesce(v_first.basic_salary::text,'—')
    when v_basis='hourly' then round(v_regular_minutes::numeric/60,2)::text||' regular hours'
    else null end;
  return jsonb_build_object('employee_id',p_employee_id,'profile_id',v_profile.id,
    'employee_name',v_employee.full_name,'employee_code',v_employee.employee_code,
    'pay_basis',v_basis,'basic_or_hours',v_detail,'currency','MYR',
    'status',v_status,'issues',to_jsonb(v_issues),'lines',v_lines,
    'gross_earnings',v_gross,'non_statutory_deductions',v_deductions,
    'reimbursements',v_reimbursements,'pre_statutory_pay',v_gross-v_deductions+v_reimbursements,
    'inputs',v_inputs,'input_fingerprint',md5(v_inputs::text));
end; $$;
