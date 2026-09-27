-- A Monthly mid-month join has no entitlement before employment begins.
-- One private cutoff is shared by contribution setup, PCB and preparation.
-- Schedule periods/amounts, category eligibility and post-cutoff change gates
-- remain unchanged. Finalized reads continue consuming their snapshots.
create function public.payroll_employee_period_start(p_run_id uuid,p_employee_id uuid)
returns date language sql stable security definer set search_path=public as $$
  select case when comp.pay_basis='monthly'
    then greatest(period.period_start,coalesce(employee.joined_date,period.period_start))
    else period.period_start end
  from public.payroll_runs run join public.payroll_periods period on period.id=run.period_id
    join public.employees employee on employee.id=p_employee_id
    left join public.payroll_profiles profile on profile.employee_id=employee.id
    left join lateral (select pay_basis from public.payroll_compensation_versions
      where profile_id=profile.id and effective_from<=greatest(period.period_start,
        coalesce(employee.joined_date,period.period_start)) order by effective_from desc limit 1) comp on true
  where run.id=p_run_id;
$$;
revoke all on function public.payroll_employee_period_start(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.payroll_statutory_project_pre_epf_oct2025(p_run_id uuid, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee public.employees%rowtype; v_profile public.payroll_profiles%rowtype;
  v_applicability public.payroll_statutory_profile_versions%rowtype;
  v_input public.payroll_statutory_input_versions%rowtype;
  v_calc public.payroll_run_calculation_versions%rowtype;
  v_schedule public.payroll_statutory_schedule_versions%rowtype;
  v_band public.payroll_statutory_schedule_bands%rowtype;
  v_component public.payroll_component_definitions%rowtype;
  v_scheme text; v_category text; v_applicable boolean; v_treatment text; v_category_issue text;
  v_line jsonb; v_bases jsonb:='[]'::jsonb; v_lines jsonb:='[]'::jsonb;
  v_issues text[]:='{}'; v_base numeric(14,2); v_employee_amount numeric(14,2):=0;
  v_monthly_basic numeric(14,2);
  v_employer_amount numeric(14,2):=0; v_employee_total numeric(14,2):=0;
  v_employer_total numeric(14,2):=0; v_inputs jsonb; v_status text; v_setup_date date;
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
  v_setup_date:=public.payroll_employee_period_start(p_run_id,p_employee_id);
  select * into v_applicability from public.payroll_statutory_profile_versions
    where profile_id=v_profile.id and effective_from<=v_setup_date order by effective_from desc limit 1;
  select * into v_input from public.payroll_statutory_input_versions
    where profile_id=v_profile.id and effective_from<=v_setup_date order by effective_from desc limit 1;
  v_inputs:=jsonb_build_object('calculation_version_id',v_calc.id,
    'calculation_fingerprint',v_calc.input_fingerprint,'setup_effective_date',v_setup_date,
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
    where newer.profile_id=v_profile.id and newer.effective_from>v_setup_date
      and newer.effective_from<=v_period.period_end) then
    v_issues:=array_append(v_issues,'mid_period_statutory_applicability_change');
  end if;
  if v_input.id is not null and exists(select 1 from public.payroll_statutory_input_versions newer
    where newer.profile_id=v_profile.id and newer.effective_from>v_setup_date
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
        elsif v_scheme='epf' and v_line->>'code' in ('overtime','public_holiday_ot') then v_treatment:='excluded';
        elsif v_scheme in ('socso','eis') and v_line->>'code' in
          ('overtime','rest_day','public_holiday','public_holiday_ot') then v_treatment:='included';
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
        v_category_issue:=public.payroll_statutory_category_issue(v_scheme,v_category,
          v_employee.nationality,v_employee.birthday,v_period.period_start,v_period.period_end);
        if v_category_issue is null and v_scheme='epf' and v_category='malaysian_under_60'
          and v_base>5000 then
          select sum((l->>'amount')::numeric) into v_monthly_basic
          from jsonb_array_elements(coalesce(v_calc.lines,'[]'::jsonb)) l
          where l->>'code' in ('monthly_basic','regular');
          if v_monthly_basic<=5000 then
            -- A bonus can retain the 13% employer rate despite a total above
            -- RM5,000. Phase 3 has no canonical bonus-vs-allowance marker.
            v_category_issue:='epf_bonus_threshold_component_classification_missing';
          end if;
        end if;
        if v_category_issue is not null then
          v_issues:=array_append(v_issues,v_category_issue);
        elsif v_scheme='epf' and v_base>20000 then
          -- Third Schedule specifies total-ringgit rounding above the last table band;
          -- do not invent a split of the fractional employee/employer shares.
          v_issues:=array_append(v_issues,'epf_above_20000_split_unreconciled');
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
end; $function$

;
CREATE OR REPLACE FUNCTION public.payroll_run_preparation_read(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_member record; v_projection jsonb; v_setup jsonb; v_rows jsonb:='[]'::jsonb;
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
    if not public.payroll_can_access_employee(v_member.employee_id,'payroll.view') then
      raise exception using errcode='42501',message='Payroll Run employee view authority denied.';
    end if;
    if v_run.status in ('finalized','paid') then
      select s.calculation into v_projection from public.payroll_run_calculation_snapshots s
        where s.run_id=p_run_id and s.employee_id=v_member.employee_id;
      v_setup:=null; -- final review uses pinned statutory results, not today's setup
    else
      v_projection:=public.payroll_calculation_project(p_run_id,v_member.employee_id);
      v_setup:=case when v_member.profile_id is not null then
        public.payroll_statutory_setup_resolve(v_member.profile_id,public.payroll_employee_period_start(p_run_id,v_member.employee_id),null) else null end;
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('employee_id',v_member.employee_id,
      'projection',v_projection,'statutory_setup',v_setup,
      'time_relevant',coalesce(v_projection->>'pay_basis'='hourly',false)
        or coalesce(jsonb_array_length(v_projection->'inputs'->'time'),0)>0));
  end loop;
  return jsonb_build_object('results',v_rows,'period_start',v_period.period_start,'period_end',v_period.period_end);
end; $function$

;
CREATE OR REPLACE FUNCTION public.payroll_run_pcb_confirm(p_request_id uuid, p_run_id uuid, p_employee_id uuid, p_amount numeric, p_source_reference text, p_note text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_profile public.payroll_profiles%rowtype;
  v_applicability public.payroll_statutory_profile_versions%rowtype;
  v_prior public.payroll_run_pcb_confirmations%rowtype;
  v_retry public.payroll_run_pcb_confirmations%rowtype; v_id uuid;
begin
  if p_request_id is null or p_run_id is null or p_employee_id is null
    or p_amount is null or p_amount::text='NaN' or p_amount<0 or round(p_amount,2)<>p_amount
    or char_length(btrim(coalesce(p_reason,'')))<3
    or (nullif(btrim(coalesce(p_source_reference,'')),'') is not null
      and char_length(btrim(p_source_reference))<3)
    or (nullif(btrim(coalesce(p_note,'')),'') is not null
      and char_length(btrim(p_note))<3) then
    raise exception using errcode='22023',message='A confirmed PCB amount and reason are required.';
  end if;
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')
    or not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll PCB confirmation authority denied.';
  end if;
  if not exists(select 1 from public.payroll_run_employee_ids(p_run_id) member
    where member.employee_id=p_employee_id) then
    raise exception using errcode='42501',message='Employee does not belong to this Payroll Run.';
  end if;
  select * into v_retry from public.payroll_run_pcb_confirmations where request_id=p_request_id;
  if v_retry.id is not null then
    if v_retry.run_id=p_run_id and v_retry.employee_id=p_employee_id and v_retry.amount=p_amount
      and v_retry.source_reference is not distinct from nullif(btrim(coalesce(p_source_reference,'')),'')
      and v_retry.note is not distinct from nullif(btrim(coalesce(p_note,'')),'')
      and v_retry.reason=btrim(p_reason) then return v_retry.id; end if;
    raise exception using errcode='23505',message='PCB request identity was already used with different content.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open Payroll Run can confirm PCB.';
  end if;
  select * into v_profile from public.payroll_profiles where employee_id=p_employee_id;
  select * into v_applicability from public.payroll_statutory_profile_versions
    where profile_id=v_profile.id and effective_from<=public.payroll_employee_period_start(p_run_id,p_employee_id)
    order by effective_from desc limit 1;
  if v_applicability.pcb_applicable is distinct from true
    or exists(select 1 from public.payroll_statutory_profile_versions newer
      where newer.profile_id=v_profile.id and newer.effective_from>public.payroll_employee_period_start(p_run_id,p_employee_id)
        and newer.effective_from<=v_period.period_end) then
    raise exception using errcode='22023',message='Reviewed, stable PCB applicability is required.';
  end if;
  select * into v_prior from public.payroll_run_pcb_confirmations
    where run_id=p_run_id and employee_id=p_employee_id order by revision desc limit 1;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_run_pcb_confirmations
    (request_id,run_id,period_id,employee_id,revision,supersedes_id,amount,
      source_reference,note,reason,confirmed_by_employee_id)
  values(p_request_id,p_run_id,v_period.id,p_employee_id,coalesce(v_prior.revision,0)+1,
    v_prior.id,p_amount,nullif(btrim(coalesce(p_source_reference,'')),''),
    nullif(btrim(coalesce(p_note,'')),''),btrim(p_reason),v_actor)
  returning id into v_id;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values('pcb_manual_confirmed',p_run_id,v_actor,btrim(p_reason),
    jsonb_build_object('confirmation_id',v_id,'employee_id',p_employee_id,
      'period_id',v_period.id,'revision',coalesce(v_prior.revision,0)+1,
      'supersedes_id',v_prior.id,'amount',p_amount));
  return v_id;
end; $function$

;
CREATE OR REPLACE FUNCTION public.payroll_run_pcb_read_pre_employee_scope(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_rows jsonb;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',member.employee_id,
    'applicable',app.pcb_applicable,'confirmation',
      case when pcb.id is null then null else to_jsonb(pcb) end,
    'history',coalesce((select jsonb_agg(to_jsonb(history) order by history.revision desc)
      from public.payroll_run_pcb_confirmations history
      where history.run_id=p_run_id and history.employee_id=member.employee_id),'[]'::jsonb))
    order by member.employee_id),'[]'::jsonb)
    into v_rows
  from public.payroll_run_employee_ids(p_run_id) member
  left join public.payroll_profiles profile on profile.employee_id=member.employee_id
  left join lateral (select s.pcb_applicable from public.payroll_statutory_profile_versions s
    where s.profile_id=profile.id and s.effective_from<=public.payroll_employee_period_start(p_run_id,member.employee_id)
    order by s.effective_from desc limit 1) app on true
  left join lateral (select c.* from public.payroll_run_pcb_confirmations c
    where c.run_id=p_run_id and c.employee_id=member.employee_id
    order by c.revision desc limit 1) pcb on true;
  return jsonb_build_object('results',v_rows);
end; $function$
