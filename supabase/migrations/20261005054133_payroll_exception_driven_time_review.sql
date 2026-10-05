-- Source evidence and historical decisions remain immutable. This projection
-- determines whether a daily decision is needed, not a new salary calculator.
create or replace function public.payroll_time_requirement(p_source jsonb,p_time jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare issues jsonb:=coalesce(p_source->'issue_codes','[]'); automatic boolean:=false;
 required boolean:=true; state text; matched boolean;
begin
 if p_source is null then return jsonb_build_object('required',false,'automatic',false,'state','ready'); end if;
 -- Published PH work, missing work and OT are reviewed together by PH Treatment.
 -- This does not approve hours, resolve PH entitlement or remove PH blockers.
 if p_source#>>'{paid_holiday_policy,status}'='paid_holiday'
   or p_source->>'classification' in ('public_holiday','public_holiday_ot') then
  return jsonb_build_object('required',false,'automatic',false,'state','ph_review');
 end if;
 matched:=p_time->>'id' is not null and p_time->>'source_fingerprint'=p_source->>'source_fingerprint';
 if p_source->>'pay_basis'='monthly' then
  -- Never accept a changed source underneath an explicit approved decision.
  if p_time->>'status' in ('approved_manual','non_payable') and not coalesce(matched,false) then
   automatic:=false;
  elsif p_source->>'leave_id' is not null and p_source->>'attendance_id' is null
    and not exists(select 1 from jsonb_array_elements_text(issues) issue
      where issue not in ('missing_punch','paid_leave_basis')) then
   -- Leave units/overlap/jurisdiction remain guarded by monthly_entitlement.
   automatic:=true;
  elsif p_source->>'classification'='regular' and jsonb_array_length(issues)=0
    and p_source->>'attendance_id' is not null and p_source->>'clock_in_at' is not null
    and p_source->>'clock_out_at' is not null
    and coalesce((p_source->>'attendance_count')::integer,0)=1
    and p_time->>'status' is distinct from 'approved_manual'
    and p_time->>'status' is distinct from 'non_payable' then
   automatic:=true;
  end if;
 end if;
 required:=not automatic;
 state:=case when automatic then 'ready'
   when p_time->>'id' is null then 'unreconciled'
   when not coalesce(matched,false) then 'source_updated'
   when p_time->>'status'='review_required' then 'review_required' else 'ready' end;
 return jsonb_build_object('required',required,'automatic',automatic,'state',state,
  'issues',case when automatic then '[]'::jsonb else issues end);
end $$;
revoke all on function public.payroll_time_requirement(jsonb,jsonb) from public,anon,authenticated;

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
end; $function$;


CREATE OR REPLACE FUNCTION public.payroll_run_preparation_read(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_member record; v_projection jsonb; v_setup jsonb; v_employment jsonb; v_rows jsonb:='[]'::jsonb;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_member in select m.employee_id,p.id profile_id from public.payroll_run_employee_ids(p_run_id) m
    left join public.payroll_profiles p on p.employee_id=m.employee_id loop
    if (v_run.status in ('finalized','paid')
        and not public.payroll_can_access_employee(v_member.employee_id,'payroll.view'))
      or (v_run.status not in ('finalized','paid')
        and not public.payroll_can_access_run_employee(p_run_id,v_member.employee_id,'payroll.view')) then
      raise exception using errcode='42501',message='Payroll Run employee view authority denied.';
    end if;
    if v_run.status in ('finalized','paid') then
      select s.calculation into v_projection from public.payroll_run_calculation_snapshots s
        where s.run_id=p_run_id and s.employee_id=v_member.employee_id;
      v_setup:=null; v_employment:=null;
    else
      v_projection:=public.payroll_calculation_project(p_run_id,v_member.employee_id);
      v_setup:=case when v_member.profile_id is not null then
        public.payroll_statutory_setup_resolve(v_member.profile_id,
          public.payroll_employee_period_start(p_run_id,v_member.employee_id),null) else null end;
      v_employment:=public.payroll_period_employment_resolve(v_member.employee_id,v_period.id);
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('employee_id',v_member.employee_id,
      'projection',v_projection,'statutory_setup',v_setup,'employment',v_employment,
      'time_review',coalesce(v_projection->'time_review','[]'::jsonb),
      'time_exception_count',(select count(*) from jsonb_array_elements(coalesce(v_projection->'time_review','[]'::jsonb)) day
        where (day->>'required')::boolean and day->>'state'<>'ready'),
      'time_relevant',exists(select 1 from jsonb_array_elements(coalesce(v_projection->'time_review','[]'::jsonb)) day
        where (day->>'required')::boolean and day->>'state'<>'ready')));
  end loop;
  return jsonb_build_object('results',v_rows,'period_start',v_period.period_start,
    'period_end',v_period.period_end,'employment_issue',
    case when v_run.status in ('finalized','paid') then null
      else public.payroll_period_employment_scope_issue(v_period.id) end);
end $function$;


CREATE OR REPLACE FUNCTION public.payroll_time_read(p_legal_entity_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.payroll_admin_actor(); v_rows jsonb;
begin
  if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll time view authority required.';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+31 then
    raise exception using errcode='22023',message='Select a valid range of at most 32 days.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'employee_id',t.employee_id,'employee_name',e.full_name,
    'employee_code',e.employee_code,'pay_basis',t.evidence->>'pay_basis',
    'work_date',t.work_date,'revision',t.revision,'status',t.status,
    'issue_codes',t.issue_codes,'classification',t.classification,
    'scheduled_minutes',t.scheduled_minutes,'actual_minutes',t.actual_minutes,
    'proposed_minutes',t.proposed_minutes,'approved_minutes',t.approved_minutes,
    'approved_extra_minutes',t.approved_extra_minutes,'evidence',t.evidence,
    'decision_reason',t.decision_reason,'decided_at',t.decided_at,
    'review_state',public.payroll_time_requirement(public.payroll_time_evidence(t.employee_id,t.work_date),to_jsonb(t)),
    'source_state',public.payroll_time_source_state(t.id),'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'revision',h.revision,
      'status',h.status,'approved_minutes',h.approved_minutes,'approved_extra_minutes',h.approved_extra_minutes,
      'reason',h.decision_reason,'actor_employee_id',h.actor_employee_id,'at',h.decided_at)
      order by h.revision desc) from public.payroll_payable_time_versions h
      where h.profile_id=t.profile_id and h.work_date=t.work_date),'[]'::jsonb))
    order by t.work_date desc,e.full_name),'[]'::jsonb) into v_rows
  from public.payroll_payable_time_versions t
  join public.employees e on e.id=t.employee_id
  where t.evidence->>'legal_entity_id'=p_legal_entity_id::text and t.work_date between p_from and p_to
    and public.payroll_can_access_employee(e.id,'payroll.view')
    and not exists(select 1 from public.payroll_payable_time_versions later
      where later.profile_id=t.profile_id and later.work_date=t.work_date and later.revision>t.revision);
  return v_rows;
end; $function$;


create or replace function public.payroll_run_time_readiness(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r payroll_runs%rowtype; period payroll_periods%rowtype; member record;
 day date; source jsonb; t payroll_payable_time_versions%rowtype; requirement jsonb;
 hourly integer:=0; required integer:=0; missing integer:=0; stale integer:=0; unresolved integer:=0; future boolean;
begin
 perform payroll_admin_actor(); select * into r from payroll_runs where id=p_run_id;
 if r.id is null then raise exception using errcode='P0002',message='Payroll run not found.';end if;
 select * into period from payroll_periods where id=r.period_id;
 if not payroll_can_manage_entity(period.legal_entity_id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll Run view authority required.';end if;
 if r.status in ('finalized','paid') then
  return jsonb_build_object('ready',true,'frozen',true,'required_days',0,'unreconciled',0,'stale',0,'unresolved',0,'period_in_progress',false);
 end if;
 for member in select m.employee_id,p.id profile_id from payroll_run_employee_ids(r.id) m
  join payroll_profiles p on p.employee_id=m.employee_id loop
  if not payroll_can_access_run_employee(r.id,member.employee_id,'payroll.view') then
   raise exception using errcode='42501',message='Payroll Run employee view authority denied.';end if;
  for day in select generate_series(period.period_start,period.period_end,interval '1 day')::date loop
   source:=payroll_time_evidence(member.employee_id,day);
   if source is null or source->>'legal_entity_id' is distinct from period.legal_entity_id::text then continue;end if;
   if source->>'pay_basis'='hourly' then hourly:=hourly+1;end if;
   select * into t from payroll_payable_time_versions where profile_id=member.profile_id and work_date=day order by revision desc limit 1;
   requirement:=payroll_time_requirement(source,to_jsonb(t));
   if not (requirement->>'required')::boolean then continue;end if;
   required:=required+1;
   case requirement->>'state'
    when 'unreconciled' then missing:=missing+1;
    when 'source_updated' then stale:=stale+1;
    when 'review_required' then unresolved:=unresolved+1;
    else null;
   end case;
  end loop;
 end loop;
 future:=hourly>0 and period.period_end>=timezone('Asia/Kuala_Lumpur',now())::date;
 return jsonb_build_object('ready',not future and missing=0 and stale=0 and unresolved=0,
  'hourly_profile_days',hourly,'required_days',required,'unreconciled',missing,'stale',stale,'unresolved',unresolved,'period_in_progress',future);
end $$;
revoke all on function public.payroll_run_time_readiness(uuid) from public,anon;
grant execute on function public.payroll_run_time_readiness(uuid) to authenticated;

-- Fast saves return the same effective review semantics as the scoped read.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.payroll_time_decision_result(uuid)'::regprocedure);
 if position('jsonb_build_object(''employee_name''' in d)=0 then raise exception 'Unexpected time decision result contract';end if;
 d:=replace(d,'jsonb_build_object(''employee_name''','jsonb_build_object(''review_state'',public.payroll_time_requirement(public.payroll_time_evidence(t.employee_id,t.work_date),to_jsonb(t)),''employee_name''');
 execute d;
end $$;
