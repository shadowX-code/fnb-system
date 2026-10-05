-- Outlet-owned, explicitly dated legal coverage. No inferred/backfilled facts.
create table public.outlet_employment_law_coverage_versions (
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 effective_from date not null,
 coverage text not null check(coverage in ('peninsular_labuan','sabah','sarawak','unresolved')),
 revision integer not null check(revision>0),
 supersedes_id uuid references public.outlet_employment_law_coverage_versions(id),
 reference text not null check(length(btrim(reference))>0),
 reason text not null check(length(btrim(reason))>0),
 actor_employee_id uuid not null references public.employees(id),
 recorded_at timestamptz not null default clock_timestamp(),
 request_id uuid not null unique, request_fingerprint text not null,
 unique(outlet_id,effective_from,revision)
);
create index outlet_law_coverage_effective_idx on public.outlet_employment_law_coverage_versions(outlet_id,effective_from desc,revision desc);
alter table public.outlet_employment_law_coverage_versions enable row level security;
revoke all on public.outlet_employment_law_coverage_versions from public,anon,authenticated;

create function public.outlet_employment_law_coverage_guard()
returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op<>'INSERT' or current_setting('feedx.outlet_coverage_command',true) is distinct from 'yes' then
  raise exception using errcode='55000',message='Employment law coverage is append-only through its confirmation authority.';
 end if;
 return new;
end $$;
create trigger outlet_law_coverage_guard before insert or update or delete on public.outlet_employment_law_coverage_versions
 for each row execute function public.outlet_employment_law_coverage_guard();
revoke all on function public.outlet_employment_law_coverage_guard() from public,anon,authenticated;

-- Private shared resolver. Explicit unresolved/unsupported evidence never falls
-- through to current state. State history is only a dated alternative source.
create function public.outlet_employment_law_coverage_at(p_outlet_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.outlet_employment_law_coverage_versions%rowtype;
 s public.payroll_outlet_state_versions%rowtype; scope text;
begin
 select * into c from outlet_employment_law_coverage_versions where outlet_id=p_outlet_id and effective_from<=p_date
 order by effective_from desc,revision desc limit 1;
 if c.id is not null then
  return jsonb_build_object('coverage',c.coverage,'origin','outlet_legal_coverage','revision_id',c.id,'effective_from',c.effective_from,'outlet_id',p_outlet_id);
 end if;
 select * into s from payroll_outlet_state_versions where outlet_id=p_outlet_id and effective_from<=p_date
 order by effective_from desc,created_at desc,id desc limit 1;
 scope:=case when s.state_code in ('MY-01','MY-02','MY-03','MY-04','MY-05','MY-06','MY-07','MY-08','MY-09','MY-10','MY-11','MY-14','MY-15','MY-16') then 'peninsular_labuan'
 when s.state_code='MY-12' then 'sabah' when s.state_code='MY-13' then 'sarawak' else 'unresolved' end;
 return jsonb_build_object('coverage',scope,'origin',case when s.id is null then 'unresolved' else 'dated_outlet_state' end,
 'revision_id',s.id,'effective_from',s.effective_from,'state_code',s.state_code,'outlet_id',p_outlet_id);
end $$;
revoke all on function public.outlet_employment_law_coverage_at(uuid,date) from public,anon,authenticated;

create function public.outlet_employment_law_coverage_read(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.current_user_can_access_outlet(p_outlet_id)
 or not (public.current_user_has_permission('outlets.view') or public.current_user_has_permission('outlets.edit')) then
  raise exception using errcode='42501',message='Outlet coverage access required.';
 end if;
 if not exists(select 1 from outlets where id=p_outlet_id) then raise exception using errcode='P0002',message='Outlet not found.'; end if;
 return jsonb_build_object('current',outlet_employment_law_coverage_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date),
 'history',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('actor_name',e.full_name) order by c.effective_from desc,c.revision desc)
 from outlet_employment_law_coverage_versions c join employees e on e.id=c.actor_employee_id where c.outlet_id=p_outlet_id),'[]'),
 'can_confirm',public.current_user_has_permission('outlets.edit'));
end $$;
revoke all on function public.outlet_employment_law_coverage_read(uuid) from public,anon;
grant execute on function public.outlet_employment_law_coverage_read(uuid) to authenticated;

create function public.outlet_employment_law_coverage_confirm(p_outlet_id uuid,p_effective_from date,p_coverage text,p_reference text,p_reason text,p_request_id uuid,p_expected_revision_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid; prior public.outlet_employment_law_coverage_versions%rowtype;
 retry public.outlet_employment_law_coverage_versions%rowtype; fingerprint text; result uuid;
begin
 if auth.uid() is null or not public.current_user_has_permission('outlets.edit') or not public.current_user_can_access_outlet(p_outlet_id) then
  raise exception using errcode='42501',message='Outlet edit authority required.';
 end if;
 select id into actor from employees where auth_user_id=auth.uid();
 if actor is null then raise exception using errcode='42501',message='Linked Admin identity required.'; end if;
 if p_effective_from is null or p_request_id is null or p_coverage is null or p_coverage not in ('peninsular_labuan','sabah','sarawak','unresolved')
 or nullif(btrim(p_reference),'') is null or nullif(btrim(p_reason),'') is null then
  raise exception using errcode='22023',message='Coverage, effective date, evidence reference and reason are required.';
 end if;
 fingerprint:=md5(jsonb_build_object('outlet',p_outlet_id,'date',p_effective_from,'coverage',p_coverage,
 'reference',btrim(p_reference),'reason',btrim(p_reason),'expected_revision',p_expected_revision_id)::text);
 perform pg_advisory_xact_lock(hashtext('outlet-law-coverage:'||p_outlet_id::text));
 perform pg_advisory_xact_lock(hashtext('outlet-law-request:'||p_request_id::text));
 select * into retry from outlet_employment_law_coverage_versions where request_id=p_request_id;
 if retry.id is not null then
  if retry.request_fingerprint<>fingerprint or retry.actor_employee_id<>actor then
   raise exception using errcode='22023',message='Request ID was already used for different coverage evidence.';
  end if;
  return retry.id;
 end if;
 select * into prior from outlet_employment_law_coverage_versions where outlet_id=p_outlet_id and effective_from=p_effective_from order by revision desc limit 1;
 if prior.id is distinct from p_expected_revision_id then raise exception using errcode='40001',message='Coverage history changed. Reload before confirming.'; end if;
 perform set_config('feedx.outlet_coverage_command','yes',true);
 insert into outlet_employment_law_coverage_versions(outlet_id,effective_from,coverage,revision,supersedes_id,reference,reason,actor_employee_id,request_id,request_fingerprint)
 values(p_outlet_id,p_effective_from,p_coverage,coalesce(prior.revision,0)+1,prior.id,btrim(p_reference),btrim(p_reason),actor,p_request_id,fingerprint) returning id into result;
 perform set_config('feedx.outlet_coverage_command','no',true);
 return result;
end $$;
revoke all on function public.outlet_employment_law_coverage_confirm(uuid,date,text,text,text,uuid,uuid) from public,anon;
grant execute on function public.outlet_employment_law_coverage_confirm(uuid,date,text,text,text,uuid,uuid) to authenticated;

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
  v_leave_days integer; v_leave_pay numeric; v_issues text[]:='{}'; v_outlet uuid;
  v_law jsonb; v_law_dates jsonb:='[]'; v_employed_pay numeric; v_pay numeric; v_basis jsonb;
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
    -- Resolve legal scope from each dated canonical assignment/workplace.
    -- State is an alternative source, not a compulsory historical prerequisite.
    for v_day in select value::date from jsonb_array_elements_text(v_active_dates) loop
      v_assignment:=public.employee_employment_assignment_at(p_employee_id,v_day);
      select case when count(*)=1 then (array_agg(o.id))[1] end into v_outlet from public.outlets o
        where lower(btrim(o.name))=lower(btrim(v_assignment.workplace))
          or lower(nullif(btrim(o.code),''))=lower(btrim(v_assignment.workplace));
      v_law:=public.outlet_employment_law_coverage_at(v_outlet,v_day);
      v_law_dates:=v_law_dates||jsonb_build_array(v_law||jsonb_build_object('date',v_day,'employment_revision_id',v_assignment.id));
      if v_law->>'coverage' is distinct from 'peninsular_labuan' then
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
    'payable_basic_salary',v_pay,'employment_law_coverage',v_law_dates,
    'rounding','Final basic entitlement rounded to RM0.01; reduction is reconciliation, not a second deduction.');
  return jsonb_build_object('amount',case when cardinality(v_issues)=0 then v_pay else null end,
    'issues',to_jsonb(v_issues),'basis',v_basis);
end; $function$;

notify pgrst, 'reload schema';
