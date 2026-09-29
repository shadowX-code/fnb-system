-- Open Payroll consumes People assignment evidence; finalized membership stays pinned.
-- The daily walk is bounded to one payroll period and records only revision transitions.
create function public.payroll_period_employment_resolve(p_employee_id uuid,p_period_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_period public.payroll_periods%rowtype; v_employee public.employees%rowtype;
  v_revision public.employee_employment_assignment_revisions%rowtype;
  v_first public.employee_employment_assignment_revisions%rowtype;
  v_date date; v_previous uuid; v_spans jsonb:='[]'::jsonb; v_entities jsonb:='[]'::jsonb;
  v_missing_start date; v_missing_end date; v_changed boolean:=false; v_active boolean:=false;
  v_issue text; v_identity jsonb;
begin
  select * into v_period from public.payroll_periods where id=p_period_id;
  select * into v_employee from public.employees where id=p_employee_id;
  if v_period.id is null or v_employee.id is null then
    raise exception using errcode='P0002',message='Payroll period or employee not found.';
  end if;
  if v_employee.joined_date is null then
    return jsonb_build_object('state','review_required','issue','employment_joined_date_missing',
      'entity_ids','[]'::jsonb,'spans','[]'::jsonb);
  end if;
  for v_date in select generate_series(greatest(v_period.period_start,v_employee.joined_date),
      v_period.period_end,interval '1 day')::date loop
    v_revision:=public.employee_employment_assignment_at(p_employee_id,v_date);
    if v_revision.id is null then
      v_missing_start:=coalesce(v_missing_start,v_date); v_missing_end:=v_date;
      continue;
    end if;
    if v_revision.id is distinct from v_previous then
      v_spans:=v_spans||jsonb_build_array(jsonb_build_object('from',v_date,
        'revision_id',v_revision.id,'effective_from',v_revision.effective_from,
        'legal_entity_id',v_revision.legal_entity_id,'employment_status',v_revision.employment_status,
        'employment_type',v_revision.employment_type,'position',v_revision.position,
        'workplace',v_revision.workplace,'employment_end_date',v_revision.employment_end_date));
      v_previous:=v_revision.id;
    end if;
    if v_revision.employment_status='active'
      and (v_revision.employment_end_date is null or v_date<=v_revision.employment_end_date) then
      v_active:=true;
      if v_revision.legal_entity_id is not null then
        -- JSON array membership is checked below without trusting Employee's current employer.
        if not exists(select 1 from jsonb_array_elements_text(v_entities) as x(value)
          where x.value=v_revision.legal_entity_id::text) then
          v_entities:=v_entities||to_jsonb(v_revision.legal_entity_id::text);
        end if;
      end if;
      if v_first.id is null then v_first:=v_revision;
      elsif (v_first.legal_entity_id,v_first.employment_status,v_first.employment_type,
        v_first.position,v_first.workplace) is distinct from
        (v_revision.legal_entity_id,v_revision.employment_status,v_revision.employment_type,
        v_revision.position,v_revision.workplace) then v_changed:=true; end if;
    elsif v_first.id is not null then v_changed:=true;
    end if;
  end loop;
  if v_missing_start is not null then
    v_issue:='employment_history_unresolved:'||v_missing_start||'..'||v_missing_end;
  elsif v_changed then v_issue:='mid_period_employment_change';
  elsif v_active and v_first.legal_entity_id is null then v_issue:='legal_employer_unresolved';
  end if;
  if v_first.id is not null and v_issue is null then
    v_identity:=jsonb_build_object('revision_id',v_first.id,
      'legal_entity_id',v_first.legal_entity_id,'employment_status',v_first.employment_status,
      'employment_type',v_first.employment_type,'position',v_first.position,
      'workplace',v_first.workplace);
  end if;
  return jsonb_build_object('state',case when v_issue is not null then 'review_required'
      when v_active then 'resolved' else 'outside_period' end,
    'issue',v_issue,'entity_ids',v_entities,'spans',v_spans,'identity',v_identity,
    'joined_date',v_employee.joined_date,'period_start',v_period.period_start,
    'period_end',v_period.period_end);
end $$;
revoke all on function public.payroll_period_employment_resolve(uuid,uuid) from public,anon,authenticated;

-- Finalized/paid runs never consult mutable People evidence for membership.
create or replace function public.payroll_run_employee_ids(p_run_id uuid)
returns table(employee_id uuid) language sql stable security definer set search_path=public as $$
  select s.employee_id from public.payroll_run_profile_snapshots s
    join public.payroll_runs r on r.id=s.run_id
    where r.id=p_run_id and r.status in ('finalized','paid')
  union
  select e.id from public.payroll_runs r
    join public.payroll_periods period on period.id=r.period_id
    join public.employees e on e.joined_date<=period.period_end
    cross join lateral (select public.payroll_period_employment_resolve(e.id,period.id) as evidence) assignment
    where r.id=p_run_id and r.status not in ('finalized','paid')
      and exists(select 1 from jsonb_array_elements_text(assignment.evidence->'entity_ids') as entity(id)
        where entity.id=period.legal_entity_id::text);
$$;
revoke all on function public.payroll_run_employee_ids(uuid) from public,anon,authenticated;

-- An open period partly before the verified People cutover cannot be finalized.
-- This is run-wide because unknown historical members cannot be inferred from current rows.
create function public.payroll_period_employment_scope_issue(p_period_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select case when p.period_start<date '2026-09-29' then
    'employment_history_unresolved:'||p.period_start||'..'||least(p.period_end,date '2026-09-28')
    else null end from public.payroll_periods p where p.id=p_period_id;
$$;
revoke all on function public.payroll_period_employment_scope_issue(uuid) from public,anon,authenticated;

-- Current Employee outlet is not authorization for a historical Payroll run.
create function public.payroll_can_access_run_employee(p_run_id uuid,p_employee_id uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_period public.payroll_periods%rowtype; v_employment jsonb;
begin
  select period.* into v_period from public.payroll_runs run
    join public.payroll_periods period on period.id=run.period_id where run.id=p_run_id;
  if v_period.id is null or not public.payroll_can_manage_entity(v_period.legal_entity_id,p_permission)
    or not exists(select 1 from public.payroll_run_employee_ids(p_run_id) member
      where member.employee_id=p_employee_id) then return false; end if;
  if public.current_user_has_all_outlet_access() then return true; end if;
  v_employment:=public.payroll_period_employment_resolve(p_employee_id,v_period.id);
  return exists(select 1 from public.outlets outlet
    where public.current_user_can_access_outlet(outlet.id)
      and (lower(outlet.name)=lower(v_employment->'identity'->>'workplace')
        or lower(outlet.code)=lower(v_employment->'identity'->>'workplace')));
end $$;
revoke all on function public.payroll_can_access_run_employee(uuid,uuid,text) from public,anon,authenticated;

-- Augment the existing canonical calculation rather than recoding financial rules.
do $migration$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
  changed:=replace(original,'v_detail text; v_adjustment record;',
    'v_detail text; v_adjustment record; v_employment jsonb; v_employment_issue text;');
  if changed=original then raise exception 'Payroll calculation declaration anchor changed'; end if;
  original:=changed;
  changed:=replace(original,$anchor$  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;$anchor$,
    $replacement$  v_employment:=public.payroll_period_employment_resolve(p_employee_id,v_period.id);
  v_employment_issue:=v_employment->>'issue';
  if v_employment->>'state'<>'resolved' or v_employment->'identity'->>'legal_entity_id' is distinct from v_period.legal_entity_id::text then
    v_issues:=array_append(v_issues,coalesce(v_employment_issue,'employment_assignment_requires_review'));
  end if;
  v_inputs:=v_inputs||jsonb_build_object('employment_assignment',v_employment);
  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;$replacement$);
  if changed=original then raise exception 'Payroll calculation status anchor changed'; end if;
  execute changed;
end $migration$;

-- Review and Finalize share the same run-wide cutover guard.
do $migration$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.payroll_run_calculation_readiness(uuid)'::regprocedure);
  changed:=replace(original,'and v_stale=0 and not v_in_progress,',
    'and v_stale=0 and not v_in_progress and public.payroll_period_employment_scope_issue(v_period.id) is null,');
  changed:=replace(changed,$anchor$'stale',v_stale,'period_in_progress',v_in_progress);$anchor$,
    $replacement$'stale',v_stale,'period_in_progress',v_in_progress,
    'employment_issue',public.payroll_period_employment_scope_issue(v_period.id));$replacement$);
  if changed=original then raise exception 'Payroll readiness anchor changed'; end if;
  execute changed;
end $migration$;

-- The preparation read supplies period identity to the open review table.
create or replace function public.payroll_run_preparation_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
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
      'time_relevant',coalesce(v_projection->>'pay_basis'='hourly',false)
        or coalesce(jsonb_array_length(v_projection->'inputs'->'time'),0)>0));
  end loop;
  return jsonb_build_object('results',v_rows,'period_start',v_period.period_start,
    'period_end',v_period.period_end,'employment_issue',
    case when v_run.status in ('finalized','paid') then null
      else public.payroll_period_employment_scope_issue(v_period.id) end);
end $$;
revoke all on function public.payroll_run_preparation_read(uuid) from public,anon;
grant execute on function public.payroll_run_preparation_read(uuid) to authenticated;

-- New finalizations pin period identity; existing immutable identity rows are untouched.
create or replace function public.payroll_payslip_identity_pin() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_period public.payroll_periods%rowtype; v_employment jsonb;
begin
  select period.* into v_period from public.payroll_runs run
    join public.payroll_periods period on period.id=run.period_id where run.id=new.run_id;
  v_employment:=public.payroll_period_employment_resolve(new.employee_id,v_period.id);
  if v_employment->>'state'<>'resolved' or
    v_employment->'identity'->>'legal_entity_id' is distinct from new.legal_entity_id_snapshot::text then
    raise exception using errcode='55000',message='Payroll employment identity requires review before Finalize.';
  end if;
  insert into public.payroll_payslip_identity_snapshots(run_id,employee_id,identity)
  select new.run_id,new.employee_id,jsonb_build_object('employee_name',new.employee_name_snapshot,
    'employee_code',e.employee_code,'employer',le.legal_company_name,'registration',le.company_registration_no,
    'workplace',v_employment->'identity'->>'workplace','position',v_employment->'identity'->>'position',
    'employment_type',v_employment->'identity'->>'employment_type',
    'ic_passport',e.ic_no,'employer_address',le.registered_address)
  from public.employees e join public.legal_entities le on le.id=new.legal_entity_id_snapshot
  where e.id=new.employee_id;
  return new;
end $$;

create or replace function public.payroll_draft_payslip_read(p_run_id uuid,p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r public.payroll_runs%rowtype; p public.payroll_periods%rowtype;
  c jsonb; s jsonb; identity jsonb; employment jsonb;
begin
 perform public.payroll_admin_actor();
 select * into r from public.payroll_runs where id=p_run_id;
 select * into p from public.payroll_periods where id=r.period_id;
 if not coalesce(public.payroll_can_access_run_employee(p_run_id,p_employee_id,'payroll.view'),false) then
  raise exception using errcode='42501',message='Draft payslip access denied.';
 end if;
 if r.status in ('finalized','paid') then raise exception 'Use the Final Payslip for this revision.'; end if;
 employment:=public.payroll_period_employment_resolve(p_employee_id,p.id);
 if employment->>'state'<>'resolved' or
   employment->'identity'->>'legal_entity_id' is distinct from p.legal_entity_id::text then
   raise exception using errcode='55000',message='Review period employment assignment before Draft Payslip.';
 end if;
 select x into c from jsonb_array_elements(public.payroll_run_calculation_read(p_run_id)->'results') x
   where x->>'employee_id'=p_employee_id::text;
 select x into s from jsonb_array_elements(public.payroll_run_statutory_read(p_run_id)->'results') x
   where x->>'employee_id'=p_employee_id::text;
 if c is null or coalesce((c->>'is_stale')::boolean,true) then
   raise exception 'Refresh Employee Calculation before previewing a Draft Payslip.'; end if;
 if s is null or coalesce((s->>'is_stale')::boolean,true) then
   s:=jsonb_build_object('lines','[]'::jsonb,'net_pay',null); end if;
 select jsonb_build_object('employee_name',e.full_name,'employee_code',e.employee_code,
   'position',employment->'identity'->>'position','workplace',employment->'identity'->>'workplace',
   'employment_type',employment->'identity'->>'employment_type',
   'employer',le.legal_company_name,'registration',le.company_registration_no,
   'ic_passport',e.ic_no,'employer_address',le.registered_address) into identity
 from public.employees e join public.legal_entities le on le.id=p.legal_entity_id where e.id=p_employee_id;
 return public.payroll_payslip_document(identity,p.period_start,p.period_end,
   (c->>'calculated_at')::timestamptz,c,s,true);
end $$;
revoke all on function public.payroll_payslip_identity_pin(),public.payroll_draft_payslip_read(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.payroll_draft_payslip_read(uuid,uuid) to authenticated;
