-- Keep unresolved PCB amounts null; zero is only valid after an explicit not-applicable decision.
create or replace function public.payroll_statutory_project(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee public.employees%rowtype; v_profile public.payroll_profiles%rowtype;
  v_applicability public.payroll_statutory_profile_versions%rowtype;
  v_input public.payroll_statutory_input_versions%rowtype;
  v_calc public.payroll_run_calculation_versions%rowtype;
  v_schedule public.payroll_statutory_schedule_versions%rowtype;
  v_band public.payroll_statutory_schedule_bands%rowtype;
  v_component public.payroll_component_definitions%rowtype;
  v_scheme text; v_category text; v_applicable boolean; v_treatment text;
  v_line jsonb; v_bases jsonb:='[]'::jsonb; v_lines jsonb:='[]'::jsonb;
  v_issues text[]:='{}'; v_base numeric(14,2); v_employee_amount numeric(14,2):=0;
  v_employer_amount numeric(14,2):=0; v_employee_total numeric(14,2):=0;
  v_employer_total numeric(14,2):=0; v_inputs jsonb; v_status text;
begin
  select * into v_run from public.payroll_runs where id=p_run_id;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_profile from public.payroll_profiles where employee_id=p_employee_id;
  if v_run.id is null or v_employee.id is null then
    raise exception using errcode='P0002',message='Payroll Run or employee not found.';
  end if;
  select * into v_calc from public.payroll_run_calculation_versions
    where run_id=p_run_id and employee_id=p_employee_id order by revision desc limit 1;
  select * into v_applicability from public.payroll_statutory_profile_versions
    where profile_id=v_profile.id and effective_from<=v_period.period_start order by effective_from desc limit 1;
  select * into v_input from public.payroll_statutory_input_versions
    where profile_id=v_profile.id and effective_from<=v_period.period_start order by effective_from desc limit 1;
  v_inputs:=jsonb_build_object('calculation_version_id',v_calc.id,
    'calculation_fingerprint',v_calc.input_fingerprint,
    'applicability',to_jsonb(v_applicability),'statutory_input',to_jsonb(v_input),
    'employee_attributes',jsonb_build_object('nationality',v_employee.nationality,'birthday',v_employee.birthday),
    'period_start',v_period.period_start,'period_end',v_period.period_end,
    'schedules',jsonb_build_array());
  if v_calc.id is null or v_calc.status<>'ready'
    or v_calc.input_fingerprint is distinct from
      (public.payroll_calculation_project(p_run_id,p_employee_id)->>'input_fingerprint') then
    v_issues:=array_append(v_issues,'phase3_calculation_missing_or_stale');
  end if;
  if v_applicability.id is null then v_issues:=array_append(v_issues,'statutory_applicability_missing'); end if;
  if v_applicability.id is not null and exists(select 1 from public.payroll_statutory_profile_versions newer
    where newer.profile_id=v_profile.id and newer.effective_from>v_period.period_start
      and newer.effective_from<=v_period.period_end) then
    v_issues:=array_append(v_issues,'mid_period_statutory_applicability_change');
  end if;
  if v_input.id is not null and exists(select 1 from public.payroll_statutory_input_versions newer
    where newer.profile_id=v_profile.id and newer.effective_from>v_period.period_start
      and newer.effective_from<=v_period.period_end) then
    v_issues:=array_append(v_issues,'mid_period_statutory_input_change');
  end if;
  foreach v_scheme in array array['epf','socso','eis','pcb'] loop
    v_applicable:=case v_scheme when 'epf' then v_applicability.epf_applicable
      when 'socso' then v_applicability.socso_applicable when 'eis' then v_applicability.eis_applicable
      else v_applicability.pcb_applicable end;
    v_category:=case v_scheme when 'epf' then v_input.epf_category
      when 'socso' then v_input.socso_category when 'eis' then v_input.eis_category else null end;
    v_base:=0; v_employee_amount:=0; v_employer_amount:=0;
    if v_applicable is null then
      v_issues:=array_append(v_issues,v_scheme||'_applicability_unreviewed');
    elsif v_applicable then
      for v_line in select value from jsonb_array_elements(coalesce(v_calc.lines,'[]'::jsonb)) loop
        v_treatment:=null;
        if v_line->>'kind'='reimbursement' then v_treatment:='excluded';
        elsif v_line->>'kind'='deduction' and v_line->>'code'<>'unpaid_time' then v_treatment:='excluded';
        elsif v_line->>'code' in ('monthly_basic','regular') then v_treatment:='included';
        elsif v_line->'source'->>'component_definition_id' is not null then
          select * into v_component from public.payroll_component_definitions
            where id=(v_line->'source'->>'component_definition_id')::uuid;
          v_treatment:=case v_scheme when 'epf' then v_component.epf_treatment
            when 'socso' then v_component.socso_treatment when 'eis' then v_component.eis_treatment
            else v_component.pcb_treatment end;
        end if;
        if v_treatment is null or v_treatment='undetermined' then
          v_issues:=array_append(v_issues,v_scheme||'_wage_treatment_unresolved:'||(v_line->>'code'));
        elsif v_treatment='included' then
          if v_line->>'kind'='deduction' then v_base:=v_base-(v_line->>'amount')::numeric;
          else v_base:=v_base+(v_line->>'amount')::numeric; end if;
        end if;
        v_bases:=v_bases||jsonb_build_array(jsonb_build_object('scheme',v_scheme,
          'line_code',v_line->>'code','amount',v_line->'amount','treatment',coalesce(v_treatment,'undetermined'),
          'source',v_line->'source'));
      end loop;
      if v_base<0 then v_issues:=array_append(v_issues,v_scheme||'_negative_wage_base'); end if;
      if v_scheme='pcb' then
        -- The 2026 HASiL specification needs YTD and prior-employer inputs and
        -- official-case reconciliation. Never turn an unresolved PCB into zero.
        v_issues:=array_append(v_issues,'pcb_2026_official_spec_unvalidated');
      elsif nullif(v_category,'') is null then
        v_issues:=array_append(v_issues,v_scheme||'_category_unreviewed');
      else
        select * into v_schedule from public.payroll_statutory_schedule_versions
          where scheme=v_scheme and category=v_category and effective_from<=v_period.period_start
            and (effective_to is null or effective_to>=v_period.period_end)
          order by effective_from desc limit 1;
        if v_schedule.id is null then v_issues:=array_append(v_issues,v_scheme||'_official_schedule_unavailable');
        else
          select * into v_band from public.payroll_statutory_schedule_bands
            where schedule_version_id=v_schedule.id and v_base>wage_above
              and (wage_through is null or v_base<=wage_through)
            order by wage_above desc limit 1;
          if v_band.id is null then v_issues:=array_append(v_issues,v_scheme||'_official_band_unavailable');
          else
            v_employee_amount:=v_band.employee_amount; v_employer_amount:=v_band.employer_amount;
            v_employee_total:=v_employee_total+v_employee_amount;
            v_employer_total:=v_employer_total+v_employer_amount;
            v_inputs:=jsonb_set(v_inputs,'{schedules}',v_inputs->'schedules'||jsonb_build_array(
              jsonb_build_object('scheme',v_scheme,'schedule',to_jsonb(v_schedule),'band',to_jsonb(v_band))));
          end if;
        end if;
      end if;
    end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('scheme',v_scheme,
      'applicable',v_applicable,'category',v_category,'wage_base',case when v_applicable then v_base else null end,
      'employee_amount',case when v_applicable is false then 0 when v_scheme='pcb' then null
        when v_band.id is not null then v_employee_amount else null end,
      'employer_amount',case when v_applicable is false then 0 when v_scheme='pcb' and v_applicable then 0
        when v_band.id is not null then v_employer_amount else null end,
      'schedule_version_id',v_schedule.id,'source_row',v_band.source_row));
    v_band:=null; v_schedule:=null;
  end loop;
  v_inputs:=v_inputs||jsonb_build_object('wage_base_lines',v_bases);
  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
  return jsonb_build_object('employee_id',p_employee_id,'calculation_version_id',v_calc.id,
    'input_fingerprint',md5(v_inputs::text),'status',v_status,'issues',to_jsonb(v_issues),
    'lines',v_lines,'inputs',v_inputs,'gross_earnings',coalesce(v_calc.gross_earnings,0),
    'non_statutory_deductions',coalesce(v_calc.non_statutory_deductions,0),
    'reimbursements',coalesce(v_calc.reimbursements,0),
    'net_pay',case when v_status='ready' then v_calc.pre_statutory_pay-v_employee_total else null end,
    'employer_statutory_cost',case when v_status='ready' then v_employer_total else null end,
    'total_employer_cost',case when v_status='ready' then v_calc.gross_earnings+v_calc.reimbursements+v_employer_total else null end);
end; $$;
