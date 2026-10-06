-- No conversion/backfill: refuse retirement if any confirmed Outlet evidence exists.
-- Lock against a racing confirmation before checking; retain all applied migration history.
lock table public.outlet_employment_law_coverage_versions in access exclusive mode;
do $$ begin
 if exists(select 1 from public.outlet_employment_law_coverage_versions) then
  raise exception using errcode='55000',message='Outlet Law Coverage contains confirmed evidence. Stop retirement; preserve it for explicit review.';
 end if;
end $$;

-- Jurisdiction is part of the immutable People employment assignment, not Outlet state.
-- NULL on existing evidence means unconfirmed; it is not a historical coverage claim.
alter table public.employee_employment_assignment_revisions add column employment_jurisdiction text
 check (employment_jurisdiction in ('peninsular_labuan','sabah','sarawak','unresolved'));

-- Extend the existing command, preserving its permission, scope, concurrency,
-- full-assignment correction and projection contracts and its public signature.
do $patch$ declare d text; begin
 d:=pg_get_functiondef('public.employee_employment_assignment_save(uuid,date,jsonb,text,uuid,text)'::regprocedure);
 if strpos(d,'v_historical_baseline boolean;')=0 or strpos(d,'workplace,employment_end_date,source_kind,reason,evidence_reference,')=0 then
  raise exception 'People employment save definition drifted; review retirement compatibility';
 end if;
 d:=replace(d,'v_historical_baseline boolean;','v_historical_baseline boolean; v_jurisdiction text;');
 d:=replace(d,'v_prior:=public.employee_employment_assignment_at(p_employee_id,p_effective_from);',
 'v_prior:=public.employee_employment_assignment_at(p_employee_id,p_effective_from);
  v_jurisdiction:=case when p_assignment ? ''employment_jurisdiction'' then nullif(p_assignment->>''employment_jurisdiction'','''')
    when (v_entity,v_workplace) is not distinct from (v_prior.legal_entity_id,v_prior.workplace) then v_prior.employment_jurisdiction
    else null end;
  if v_jurisdiction is not null and v_jurisdiction not in (''peninsular_labuan'',''sabah'',''sarawak'',''unresolved'') then
    raise exception using errcode=''22023'',message=''Choose a supported Employment Jurisdiction.'';
  end if;');
 d:=replace(d,'(v_type,v_status,v_position,v_entity,v_workplace,v_end) is not distinct from',
 '(v_type,v_status,v_position,v_entity,v_workplace,v_end,v_jurisdiction) is not distinct from');
 d:=replace(d,'v_prior.legal_entity_id,v_prior.workplace,v_prior.employment_end_date) then',
 'v_prior.legal_entity_id,v_prior.workplace,v_prior.employment_end_date,v_prior.employment_jurisdiction) then');
 d:=replace(d,'workplace,employment_end_date,source_kind,reason,evidence_reference,',
 'workplace,employment_end_date,employment_jurisdiction,source_kind,reason,evidence_reference,');
 d:=replace(d,'v_workplace,v_end,''admin_change''', 'v_workplace,v_end,v_jurisdiction,''admin_change''');
 execute d;
end $patch$;

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
  v_leave_days integer; v_leave_pay numeric; v_issues text[]:='{}';
  v_law_dates jsonb:='[]'; v_employed_pay numeric; v_pay numeric; v_basis jsonb;
  v_day date; v_assignment public.employee_employment_assignment_revisions%rowtype;
  v_law_assignment public.employee_employment_assignment_revisions%rowtype;
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
    -- Only the canonical dated People employment revision establishes legal scope.
    -- Outlet state remains solely location/PH evidence, never a Payroll fallback.
    for v_day in select value::date from jsonb_array_elements_text(v_active_dates) loop
      v_law_assignment:=public.employee_employment_assignment_at(p_employee_id,v_day);
      v_law_dates:=v_law_dates||jsonb_build_array(jsonb_build_object('date',v_day,
        'employment_revision_id',v_law_assignment.id,
        'employment_jurisdiction',coalesce(v_law_assignment.employment_jurisdiction,'unresolved')));
      if v_law_assignment.employment_jurisdiction is distinct from 'peninsular_labuan' then
        v_issues:=array_append(v_issues,'monthly_proration_jurisdiction_requires_review');
      end if;
    end loop;
    select coalesce(array_agg(distinct issue),'{}') into v_issues from unnest(v_issues) issue;
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
    'payable_basic_salary',v_pay,'employment_jurisdiction',v_law_dates,
    'rounding','Final basic entitlement rounded to RM0.01; reduction is reconciliation, not a second deduction.');
  return jsonb_build_object('amount',case when cardinality(v_issues)=0 then v_pay else null end,
    'issues',to_jsonb(v_issues),'basis',v_basis);
end; $function$;

-- Drop only explicitly owned objects. RESTRICT protects unexpected dependencies.
drop function public.outlet_employment_law_coverage_read(uuid);
drop function public.outlet_employment_law_coverage_confirm(uuid,date,text,text,text,uuid,uuid);
drop function public.outlet_employment_law_coverage_at(uuid,date);
drop table public.outlet_employment_law_coverage_versions;
drop function public.outlet_employment_law_coverage_guard();
-- No dedicated permissions were introduced; shared outlets.view/edit remain intact.
notify pgrst,'reload schema';
