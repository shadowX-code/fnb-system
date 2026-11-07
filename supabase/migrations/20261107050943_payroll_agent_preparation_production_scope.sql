alter table public.payroll_run_calculation_versions add column calculated_by_machine_id uuid references feedx_integrations.machine_identities(id);

alter table public.payroll_run_calculation_versions alter column calculated_by_employee_id drop not null;

alter table public.payroll_run_calculation_versions add constraint payroll_run_calculation_versions_typed_actor check(num_nonnulls(calculated_by_employee_id,calculated_by_machine_id)=1);

alter table public.payroll_run_statutory_versions add column calculated_by_machine_id uuid references feedx_integrations.machine_identities(id);

alter table public.payroll_run_statutory_versions alter column calculated_by_employee_id drop not null;

alter table public.payroll_run_statutory_versions add constraint payroll_run_statutory_versions_typed_actor check(num_nonnulls(calculated_by_employee_id,calculated_by_machine_id)=1);

alter table public.payroll_payable_time_versions add column actor_machine_id uuid references feedx_integrations.machine_identities(id);

alter table public.payroll_payable_time_versions alter column actor_employee_id drop not null;

alter table public.payroll_payable_time_versions add constraint payroll_payable_time_versions_typed_actor check(num_nonnulls(actor_employee_id,actor_machine_id)=1);

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_calculate_core(p_machine uuid, p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_projection jsonb;
  v_latest public.payroll_run_calculation_versions%rowtype;
  v_created integer:=0; v_unchanged integer:=0; v_blocked integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not (case when p_machine is null then public.payroll_can_recalculate_entity(v_period.legal_entity_id) else feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.prepare') end) then
    raise exception using errcode='42501',message='Payroll calculation authority denied.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open calculation Run can be recalculated.';
  end if;
  if p_only_employee_id is not null and not exists (
    select 1 from public.payroll_run_employee_ids(p_run_id) where employee_id=p_only_employee_id
  ) then raise exception using errcode='42501',message='Employee is not included in this Payroll Run.'; end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) where p_only_employee_id is null or employee_id=p_only_employee_id order by employee_id loop
    v_projection:=public.payroll_calculation_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_calculation_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1 for update;
    -- Review evidence is not a completed financial version. Keep the last valid version.
    if not public.payroll_calculation_has_totals(v_projection) then
      v_blocked:=v_blocked+1; continue;
    end if;
    if v_latest.id is not null and v_latest.input_fingerprint=v_projection->>'input_fingerprint' then
      v_unchanged:=v_unchanged+1; continue;
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_calculation_versions
      (run_id,employee_id,revision,supersedes_id,input_fingerprint,status,pay_basis,
       basic_or_hours,lines,issues,inputs,gross_earnings,non_statutory_deductions,
       reimbursements,pre_statutory_pay,calculated_by_employee_id,calculated_by_machine_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      v_projection->>'input_fingerprint',v_projection->>'status',v_projection->>'pay_basis',
      v_projection->>'basic_or_hours',v_projection->'lines',
      array(select jsonb_array_elements_text(v_projection->'issues')),
      v_projection->'inputs',(v_projection->>'gross_earnings')::numeric,
      (v_projection->>'non_statutory_deductions')::numeric,
      (v_projection->>'reimbursements')::numeric,
      (v_projection->>'pre_statutory_pay')::numeric,v_actor,p_machine);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,details)
    values('run_calculated',p_run_id,v_actor,p_machine,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged,'blocked',v_blocked);
end; $function$;

revoke all on function feedx_integrations.hr_payroll_run_calculate_core(uuid,uuid,uuid) from public,anon,authenticated;

do $$begin if md5(pg_get_functiondef('payroll_run_calculate_core(uuid,uuid)'::regprocedure))<>'54d1aca240a2480d8e04126a9608c533' then raise exception 'Payroll authority drift: payroll_run_calculate_core';end if;end $$;

CREATE OR REPLACE FUNCTION public.payroll_run_calculate_core(p_run_id uuid, p_only_employee_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ select feedx_integrations.hr_payroll_run_calculate_core(null,p_run_id,p_only_employee_id); $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_statutory_calculate_core(p_machine uuid, p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_project jsonb;
  v_latest public.payroll_run_statutory_versions%rowtype; v_created integer:=0; v_unchanged integer:=0; v_blocked integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not (case when p_machine is null then public.payroll_can_recalculate_entity(v_period.legal_entity_id) else feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.prepare') end) then
    raise exception using errcode='42501',message='Payroll statutory calculation authority denied.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open Payroll Run can calculate statutory results.';
  end if;
  if p_only_employee_id is not null and not exists (
    select 1 from public.payroll_run_employee_ids(p_run_id) where employee_id=p_only_employee_id
  ) then raise exception using errcode='42501',message='Employee is not included in this Payroll Run.'; end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) where p_only_employee_id is null or employee_id=p_only_employee_id order by employee_id loop
    -- Never calculate contributions from a retained but superseded wage result.
    if not public.payroll_calculation_has_totals(public.payroll_calculation_project(p_run_id,v_employee_id)) then
      v_blocked:=v_blocked+1; continue;
    end if;
    v_project:=public.payroll_statutory_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_statutory_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1 for update;
    if v_latest.id is not null and v_latest.input_fingerprint=v_project->>'input_fingerprint' then
      v_unchanged:=v_unchanged+1; continue;
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_statutory_versions(run_id,employee_id,revision,supersedes_id,
      calculation_version_id,input_fingerprint,status,lines,issues,inputs,gross_earnings,
      non_statutory_deductions,reimbursements,net_pay,employer_statutory_cost,
      total_employer_cost,calculated_by_employee_id,calculated_by_machine_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      (v_project->>'calculation_version_id')::uuid,v_project->>'input_fingerprint',v_project->>'status',
      v_project->'lines',array(select jsonb_array_elements_text(v_project->'issues')),
      v_project->'inputs',(v_project->>'gross_earnings')::numeric,
      (v_project->>'non_statutory_deductions')::numeric,(v_project->>'reimbursements')::numeric,
      (v_project->>'net_pay')::numeric,(v_project->>'employer_statutory_cost')::numeric,
      (v_project->>'total_employer_cost')::numeric,v_actor,p_machine);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,details)
    values('run_statutory_calculated',p_run_id,v_actor,p_machine,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged,'blocked',v_blocked);
end; $function$;

revoke all on function feedx_integrations.hr_payroll_run_statutory_calculate_core(uuid,uuid,uuid) from public,anon,authenticated;

do $$begin if md5(pg_get_functiondef('payroll_run_statutory_calculate_core(uuid,uuid)'::regprocedure))<>'a0e6a6694102002b204f65278893af9a' then raise exception 'Payroll authority drift: payroll_run_statutory_calculate_core';end if;end $$;

CREATE OR REPLACE FUNCTION public.payroll_run_statutory_calculate_core(p_run_id uuid, p_only_employee_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ select feedx_integrations.hr_payroll_run_statutory_calculate_core(null,p_run_id,p_only_employee_id); $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_preparation_read(p_machine uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_member record; v_projection jsonb; v_setup jsonb; v_employment jsonb; v_rows jsonb:='[]'::jsonb;
begin
  if p_machine is null then perform public.payroll_admin_actor();end if;
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_member in select m.employee_id,p.id profile_id from public.payroll_run_employee_ids(p_run_id) m
    left join public.payroll_profiles p on p.employee_id=m.employee_id loop
    if (v_run.status in ('finalized','paid')
        and not (case when p_machine is null then public.payroll_can_access_employee(v_member.employee_id,'payroll.view') else feedx_integrations.hr_actor_employee(p_machine,v_member.employee_id) end))
      or (v_run.status not in ('finalized','paid')
        and not feedx_integrations.hr_actor_run_employee(p_machine,p_run_id,v_member.employee_id,'payroll.view')) then
      raise exception using errcode='42501',message='Payroll Run employee view authority denied.';
    end if;
    if v_run.status in ('finalized','paid') then
      select s.calculation into v_projection from public.payroll_run_calculation_snapshots s
        where s.run_id=p_run_id and s.employee_id=v_member.employee_id;
      v_setup:=null; v_employment:=null;
    else
      v_projection:=public.payroll_calculation_project(p_run_id,v_member.employee_id);
      -- Statutory setup internals remain Human-only; canonical statutory calculation/readiness is shared.
      v_setup:=case when p_machine is null and v_member.profile_id is not null then
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
  return jsonb_build_object('results',v_rows,'employment_population',case when v_run.status in ('finalized','paid') then null else
      jsonb_build_object('unresolved_count',(select count(*) from public.payroll_period_population_gaps(v_period.id)),
        'records',coalesce((select jsonb_agg(jsonb_build_object('employee_id',g.employee_id,
          'employee_name',e.full_name,'date_from',g.date_from,'date_to',g.date_to,
          'employment',jsonb_build_object('state','review_required','issue',g.issue,'missing_field',g.missing_field)))
          from public.payroll_period_population_gaps(v_period.id) g join public.employees e on e.id=g.employee_id
          where case when p_machine is null then public.payroll_can_access_employee(g.employee_id,'payroll.view') else feedx_integrations.hr_actor_employee(p_machine,g.employee_id) end), '[]'::jsonb)) end,'period_start',v_period.period_start,
    'period_end',v_period.period_end,'employment_issue',
    case when v_run.status in ('finalized','paid') then null
      else public.payroll_period_employment_scope_issue(v_period.id) end);
end $function$;

revoke all on function feedx_integrations.hr_payroll_run_preparation_read(uuid,uuid) from public,anon,authenticated;

do $$begin if md5(pg_get_functiondef('payroll_run_preparation_read(uuid)'::regprocedure))<>'32bfe4224b6112468fc48463d78e791e' then raise exception 'Payroll authority drift: payroll_run_preparation_read';end if;end $$;

CREATE OR REPLACE FUNCTION public.payroll_run_preparation_read(p_run_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ select feedx_integrations.hr_payroll_run_preparation_read(null,p_run_id); $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_evidence_read(p_machine uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 r public.payroll_runs%rowtype; p public.payroll_periods%rowtype;
 prep jsonb; member jsonb; projected jsonb; row_data jsonb; stat_project jsonb;
 c public.payroll_run_calculation_versions%rowtype; s public.payroll_run_statutory_versions%rowtype;
 calculations jsonb:='[]'; statutory jsonb:='[]'; adjustments jsonb;
 calc_readiness jsonb; stat_readiness jsonb; in_progress boolean;
 count_members integer:=0; calc_missing integer:=0; calc_review integer:=0; calc_stale integer:=0;
 stat_missing integer:=0; stat_review integer:=0; stat_stale integer:=0;
 issue text; employee_name text; employee_code text;
begin
 if p_machine is null then perform public.payroll_admin_actor();end if;
 select * into r from public.payroll_runs where id=p_run_id;
 if r.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
 select * into p from public.payroll_periods where id=r.period_id;
 if not feedx_integrations.hr_actor_entity(p_machine,p.legal_entity_id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll Run view authority denied.';
 end if;
 if r.status in ('finalized','paid') then
  raise exception using errcode='22023',message='Use the frozen Payroll record for finalized runs.';
 end if;
 -- This authority checks dated membership and each employee's access.
 prep:=feedx_integrations.hr_payroll_run_preparation_read(p_machine,p_run_id);
 issue:=prep->>'employment_issue';
 in_progress:=p.period_end>=timezone('Asia/Kuala_Lumpur',now())::date;
 for member in select value from jsonb_array_elements(prep->'results') loop
  count_members:=count_members+1;
  projected:=member->'projection';
  select e.full_name,e.employee_code into employee_name,employee_code from public.employees e where e.id=(member->>'employee_id')::uuid;
  select * into c from public.payroll_run_calculation_versions
   where run_id=p_run_id and employee_id=(member->>'employee_id')::uuid order by revision desc limit 1;
  if not public.payroll_calculation_has_totals(projected) then
   -- Current source evidence can be settled Review Required without a money version.
   row_data:=projected||jsonb_build_object('id',null,'employee_id',member->>'employee_id',
    'employee_name',employee_name,'employee_code',employee_code,'revision',null,
    'previous_calculation_version_id',c.id,'persistence_state','blocked',
    'status','review_required','is_stale',false,'calculated_at',null);
   row_data:=row_data||jsonb_build_object('earning_groups',public.payroll_earning_groups(row_data));
   calculations:=calculations||jsonb_build_array(row_data);
   calc_review:=calc_review+1;
  elsif c.id is null then calc_missing:=calc_missing+1;
  else
   row_data:=jsonb_build_object('id',c.id,'employee_id',c.employee_id,'employee_name',employee_name,'employee_code',employee_code,
    'revision',c.revision,'pay_basis',c.pay_basis,'basic_or_hours',c.basic_or_hours,
    'status',c.status,'issues',to_jsonb(c.issues),'lines',c.lines,'inputs',c.inputs,
    'gross_earnings',c.gross_earnings,'non_statutory_deductions',c.non_statutory_deductions,
    'reimbursements',c.reimbursements,'pre_statutory_pay',c.pre_statutory_pay,'calculated_at',c.calculated_at,
    'is_stale',c.input_fingerprint is distinct from projected->>'input_fingerprint');
   row_data:=row_data||jsonb_build_object('earning_groups',public.payroll_earning_groups(row_data));
   calculations:=calculations||jsonb_build_array(row_data);
   if (row_data->>'is_stale')::boolean then calc_stale:=calc_stale+1;
   elsif c.status='review_required' then calc_review:=calc_review+1; end if;
  end if;
  select * into s from public.payroll_run_statutory_versions
   where run_id=p_run_id and employee_id=(member->>'employee_id')::uuid order by revision desc limit 1;
  if not public.payroll_calculation_has_totals(projected) then
   row_data:=jsonb_build_object('id',null,'employee_id',member->>'employee_id',
    'employee_name',employee_name,'employee_code',employee_code,'revision',null,
    'previous_statutory_version_id',s.id,'persistence_state','blocked',
    'status','review_required','is_stale',false,'issues',projected->'issues',
    'lines','[]'::jsonb,'inputs',projected->'inputs',
    'gross_earnings',null,'non_statutory_deductions',null,'reimbursements',null,
    'net_pay',null,'employer_statutory_cost',null,'total_employer_cost',null);
   statutory:=statutory||jsonb_build_array(row_data);
   stat_review:=stat_review+1;
  elsif s.id is null then stat_missing:=stat_missing+1;
  else
   stat_project:=public.payroll_statutory_project(p_run_id,s.employee_id);
   row_data:=jsonb_build_object('id',s.id,'employee_id',s.employee_id,'employee_name',employee_name,'employee_code',employee_code,
    'revision',s.revision,'status',s.status,'issues',to_jsonb(s.issues),'lines',s.lines,'inputs',s.inputs,
    'gross_earnings',s.gross_earnings,'non_statutory_deductions',s.non_statutory_deductions,
    'reimbursements',s.reimbursements,'net_pay',s.net_pay,
    'employer_statutory_cost',s.employer_statutory_cost,'total_employer_cost',s.total_employer_cost,
    'is_stale',s.input_fingerprint is distinct from stat_project->>'input_fingerprint');
   statutory:=statutory||jsonb_build_array(row_data);
   if (row_data->>'is_stale')::boolean then stat_stale:=stat_stale+1;
   elsif s.status='review_required' then stat_review:=stat_review+1; end if;
  end if;
 end loop;
 select coalesce(jsonb_agg(value order by value->>'employee_name'),'[]') into calculations from jsonb_array_elements(calculations);
 select coalesce(jsonb_agg(value order by value->>'employee_name'),'[]') into statutory from jsonb_array_elements(statutory);
 calc_readiness:=jsonb_build_object('ready',count_members>0 and calc_missing=0 and calc_review=0
  and calc_stale=0 and not in_progress and issue is null,'employees',count_members,
  'uncalculated',calc_missing,'review_required',calc_review,'stale',calc_stale,
  'period_in_progress',in_progress,'employment_issue',issue);
 stat_readiness:=jsonb_build_object('ready',count_members>0 and stat_missing=0 and stat_review=0
  and stat_stale=0 and not in_progress,'employees',count_members,'uncalculated',stat_missing,
  'review_required',stat_review,'stale',stat_stale);
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,
  'component_id',a.component_id,'component_name',d.name,'component_type',d.component_type,
  'amount',a.amount,'reason',a.reason,'created_at',a.created_at) order by a.created_at),'[]') into adjustments
 from public.payroll_run_component_adjustments a join public.payroll_component_definitions d on d.id=a.component_id
 where a.run_id=p_run_id and a.reverses_id is null
 and not exists(select 1 from public.payroll_run_component_adjustments reverse where reverse.reverses_id=a.id);
 return jsonb_build_object('preparation',prep,
  'calculation',jsonb_build_object('results',calculations,'adjustments',adjustments,'readiness',calc_readiness),
  'statutory',jsonb_build_object('results',statutory,'readiness',stat_readiness),
  'time',case when p_machine is null then public.payroll_time_read(p.legal_entity_id,p.period_start,p.period_end) else null end,
  'pcb',case when p_machine is null then public.payroll_run_pcb_read(p_run_id) else null end,
  'readiness',jsonb_build_object('time',feedx_integrations.hr_payroll_run_time_readiness(p_machine,p_run_id),
   'calculation',calc_readiness,'statutory',stat_readiness));
end $function$;

revoke all on function feedx_integrations.hr_payroll_run_evidence_read(uuid,uuid) from public,anon,authenticated;

do $$begin if md5(pg_get_functiondef('payroll_run_evidence_read(uuid)'::regprocedure))<>'e15760f52bee9bd303a7ef86602b3aac' then raise exception 'Payroll authority drift: payroll_run_evidence_read';end if;end $$;

CREATE OR REPLACE FUNCTION public.payroll_run_evidence_read(p_run_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ select feedx_integrations.hr_payroll_run_evidence_read(null,p_run_id); $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_time_readiness(p_machine uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r payroll_runs%rowtype; period payroll_periods%rowtype; member record;
 day date; source jsonb; t payroll_payable_time_versions%rowtype; requirement jsonb;
 hourly integer:=0; required integer:=0; missing integer:=0; stale integer:=0; unresolved integer:=0; future boolean;
begin
 if p_machine is null then perform payroll_admin_actor();end if; select * into r from payroll_runs where id=p_run_id;
 if r.id is null then raise exception using errcode='P0002',message='Payroll run not found.';end if;
 select * into period from payroll_periods where id=r.period_id;
 if not feedx_integrations.hr_actor_entity(p_machine,period.legal_entity_id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll Run view authority required.';end if;
 if r.status in ('finalized','paid') then
  return jsonb_build_object('ready',true,'frozen',true,'required_days',0,'unreconciled',0,'stale',0,'unresolved',0,'period_in_progress',false);
 end if;
 for member in select m.employee_id,p.id profile_id from payroll_run_employee_ids(r.id) m
  join payroll_profiles p on p.employee_id=m.employee_id loop
  if not feedx_integrations.hr_actor_run_employee(p_machine,r.id,member.employee_id,'payroll.view') then
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
end $function$;

revoke all on function feedx_integrations.hr_payroll_run_time_readiness(uuid,uuid) from public,anon,authenticated;

do $$begin if md5(pg_get_functiondef('payroll_run_time_readiness(uuid)'::regprocedure))<>'f747f8072caa57c64a9d96d3824f0b53' then raise exception 'Payroll authority drift: payroll_run_time_readiness';end if;end $$;

CREATE OR REPLACE FUNCTION public.payroll_run_time_readiness(p_run_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ select feedx_integrations.hr_payroll_run_time_readiness(null,p_run_id); $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_time_reconcile(p_machine uuid, p_legal_entity_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end;
  v_profile record;
  v_day date;
  v_evidence jsonb;
  v_latest public.payroll_payable_time_versions%rowtype;
  v_issues text[];
  v_status text;
  v_id uuid;
  v_created integer:=0;
  v_unchanged integer:=0;
begin
  if not (feedx_integrations.hr_actor_entity(p_machine,p_legal_entity_id,'payroll.prepare') or feedx_integrations.hr_actor_entity(p_machine,p_legal_entity_id,'payroll.review_time')) then
    raise exception using errcode='42501',message='Payroll time reconciliation authority required.';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+31
    or p_to>timezone('Asia/Kuala_Lumpur',now())::date then
    raise exception using errcode='22023',message='Select a valid elapsed range of at most 32 days.';
  end if;
  for v_profile in select p.id profile_id,p.employee_id from public.payroll_profiles p
    where case when p_machine is null then (public.payroll_can_access_employee(p.employee_id,'payroll.prepare') or public.payroll_can_access_employee(p.employee_id,'payroll.review_time')) else feedx_integrations.hr_actor_employee(p_machine,p.employee_id) end
  loop
    for v_day in select generate_series(p_from,p_to,interval '1 day')::date loop
      v_evidence:=public.payroll_time_evidence(v_profile.employee_id,v_day);
      if v_evidence is null then continue; end if;
      if v_evidence->>'legal_entity_id' is distinct from p_legal_entity_id::text then continue; end if;
      select * into v_latest from public.payroll_payable_time_versions t
        where t.profile_id=v_profile.profile_id and t.work_date=v_day
        order by revision desc limit 1 for update;
      if v_latest.id is not null and v_latest.source_fingerprint=v_evidence->>'source_fingerprint' then
        v_unchanged:=v_unchanged+1;
        continue;
      end if;
      if not public.payroll_time_correction_allowed(p_legal_entity_id,v_day) then
        raise exception using errcode='55000',message='Finalized period requires an open correction run before time evidence changes.';
      end if;
      select coalesce(array_agg(issue.code),'{}'::text[]) into v_issues
        from jsonb_array_elements_text(v_evidence->'issue_codes') as issue(code);
      v_status:=case when cardinality(v_issues)=0 and (v_evidence->>'proposed_minutes') is not null
        then 'approved_auto' else 'review_required' end;
      perform set_config('feedx.payroll_command','yes',true);
      insert into public.payroll_payable_time_versions(
        profile_id,employee_id,work_date,revision,supersedes_id,source_fingerprint,evidence,
        issue_codes,classification,scheduled_minutes,actual_minutes,proposed_minutes,
        approved_minutes,status,actor_employee_id,actor_machine_id)
      values(v_profile.profile_id,v_profile.employee_id,v_day,coalesce(v_latest.revision,0)+1,
        v_latest.id,v_evidence->>'source_fingerprint',v_evidence,v_issues,
        v_evidence->>'classification',(v_evidence->>'scheduled_minutes')::integer,
        (v_evidence->>'actual_minutes')::integer,(v_evidence->>'proposed_minutes')::integer,
        case when v_status='approved_auto' then (v_evidence->>'proposed_minutes')::integer end,
        v_status,v_actor,p_machine) returning id into v_id;
      insert into public.payroll_events(event_type,profile_id,actor_employee_id,actor_machine_id,details)
        values('time_reconciled',v_profile.profile_id,v_actor,p_machine,
          jsonb_build_object('time_version_id',v_id,'work_date',v_day,'status',v_status,
            'source_fingerprint',v_evidence->>'source_fingerprint'));
      v_created:=v_created+1;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged);
end; $function$;

revoke all on function feedx_integrations.hr_payroll_time_reconcile(uuid,uuid,date,date) from public,anon,authenticated;

do $$begin if md5(pg_get_functiondef('payroll_time_reconcile(uuid,date,date)'::regprocedure))<>'dec5b3901136b5917fb5cab2c2e6a488' then raise exception 'Payroll authority drift: payroll_time_reconcile';end if;end $$;

CREATE OR REPLACE FUNCTION public.payroll_time_reconcile(p_legal_entity_id uuid, p_from date, p_to date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ select feedx_integrations.hr_payroll_time_reconcile(null,p_legal_entity_id,p_from,p_to); $$;

do $$begin if md5(pg_get_functiondef('feedx_integrations.hr_actor_can(uuid,text)'::regprocedure))<>'c81048649161ecdb1fbb698e7974e27c' then raise exception 'Payroll authority drift: hr_actor_can';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_actor_can(p_machine uuid, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select case when p_machine is null then public.current_user_has_permission(p_permission) else exists(select 1 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id join feedx_integrations.capabilities c on c.permission_code=p.code and c.workspace='HR' and c.implemented left join feedx_integrations.factory_actions a on a.key=c.tool_id where m.id=p_machine and m.enabled and r.is_active and lower(r.name) not in ('owner','admin') and (a.human_permission=p_permission or (p_permission='payroll.view' and c.tool_id='hr.view.payroll'))) end;
$function$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_transition(p_machine uuid, p_run_id uuid, p_next_status text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_count integer;
begin
  if p_machine is not null and p_next_status is distinct from 'review_required' then raise exception using errcode='42501',message='Agents may not mark Payroll Ready, Finalize or record payment';end if;
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id for update;
  if not feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,
    case when p_next_status='finalized' then 'payroll.finalize' else 'payroll.prepare' end) then
    raise exception using errcode='42501',message='Payroll Run transition authority denied.';
  end if;
  if nullif(btrim(p_reason),'') is null or not (
    (v_run.status='draft' and p_next_status='review_required')
    or (v_run.status='review_required' and p_next_status='ready')
    or (v_run.status='ready' and p_next_status='finalized')
    or (v_run.status='ready' and p_next_status='review_required')
  ) then
    raise exception using errcode='55000',message='Invalid Payroll Run transition or missing reason.';
  end if;
  if p_next_status='finalized' then
    if v_run.supersedes_run_id is not null and v_period.current_finalized_run_id is distinct from v_run.supersedes_run_id then
      raise exception using errcode='55000',message='Current finalized run changed; recreate this correction.';
    end if;
    if v_run.supersedes_run_id is null and v_period.current_finalized_run_id is not null then
      raise exception using errcode='55000',message='Use a correction run instead.';
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_profile_snapshots(
      run_id,employee_id,profile_id,compensation_versions,statutory_versions,recurring_versions,
      employee_name_snapshot,legal_entity_id_snapshot)
    select v_run.id,e.id,p.id,
      (select coalesce(jsonb_agg(to_jsonb(c) order by c.effective_from), '[]'::jsonb)
        from public.payroll_compensation_effective_versions() c where c.profile_id=p.id and c.effective_from<=v_period.period_end
          and c.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_compensation_effective_versions() prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(s) order by s.effective_from), '[]'::jsonb)
        from public.payroll_statutory_profile_versions s where s.profile_id=p.id and s.effective_from<=v_period.period_end
          and s.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_statutory_profile_versions prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(rc) order by rc.effective_from), '[]'::jsonb)
        from public.payroll_recurring_component_versions rc where rc.profile_id=p.id and rc.effective_from<=v_period.period_end),
      e.full_name,v_period.legal_entity_id
    from public.payroll_profiles p join public.employees e on e.id=p.employee_id
    join public.payroll_run_employee_ids(p_run_id) member on member.employee_id=e.id;
    get diagnostics v_count=row_count;
    if v_count=0 then raise exception using errcode='22023',message='No effective Payroll Profiles exist for this run.'; end if;
    update public.payroll_runs set status='finalized',finalized_by_employee_id=v_actor,finalized_at=clock_timestamp()
      where id=v_run.id;
    update public.payroll_periods set current_finalized_run_id=v_run.id where id=v_period.id;
  else
    perform set_config('feedx.payroll_command','yes',true);
    update public.payroll_runs set status=p_next_status where id=v_run.id;
  end if;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,reason,details)
  values('run_'||p_next_status,v_run.id,v_actor,p_machine,btrim(p_reason),
    jsonb_build_object('from_status',v_run.status,'to_status',p_next_status,
      'foundation_only',v_run.foundation_only,'profile_count',v_count));
  return jsonb_build_object('id',v_run.id,'status',p_next_status,
    'foundation_only',v_run.foundation_only,'profile_count',v_count);
end; $function$;

revoke all on function feedx_integrations.hr_payroll_run_transition(uuid,uuid,text,text) from public,anon,authenticated;

do $$begin if md5(pg_get_functiondef('payroll_run_transition(uuid,text,text)'::regprocedure))<>'3f56d129a709cba0886fdf4caa17386d' then raise exception 'Payroll authority drift: payroll_run_transition';end if;end $$;

create or replace function public.payroll_run_transition(p_run_id uuid,p_next_status text,p_reason text) returns jsonb language sql security definer set search_path=public,pg_temp as $$ select feedx_integrations.hr_payroll_run_transition(null,p_run_id,p_next_status,p_reason); $$;

alter table feedx_integrations.capabilities drop constraint capabilities_action_type_check;

alter table feedx_integrations.capabilities add constraint capabilities_action_type_check CHECK ((action_type = ANY (ARRAY['view'::text, 'list'::text, 'read'::text, 'search'::text, 'filter'::text, 'draft'::text, 'execute'::text, 'create'::text, 'update'::text, 'submit'::text, 'complete'::text, 'verify'::text, 'approve'::text, 'cancel'::text, 'confirm'::text, 'receive'::text, 'return_to_draft'::text, 'shortlist'::text, 'advance'::text, 'reject'::text, 'reverse'::text, 'prepare'::text, 'calculate'::text])));

insert into permissions(code,module,description,requires_restaurant_outlet_scope) values('hr_agent_action_hr_payroll.prepare','hr_agent_action_hr_payroll','Refresh canonical elapsed time evidence for this open Run; unresolved facts are never approved.',true);

insert into feedx_integrations.factory_actions(key,module_id,label,action,human_permission,target_table,target_required,requires_confirmation,input_fields,description) values('hr_payroll.prepare','payroll','Payroll Preparation','prepare','payroll.prepare','payroll_runs',true,false,array['legal_entity_id'],'Refresh canonical elapsed time evidence for this open Run; unresolved facts are never approved.');

insert into feedx_integrations.capabilities(tool_id,adapter_key,label,description,workspace,domain,domain_label,action_type,permission_code,requires_human_approval,implemented,sort_order,mcp_tool,navigation_module_id) values('hr_payroll.prepare','factory_mesti','Payroll Preparation','Refresh canonical elapsed time evidence for this open Run; unresolved facts are never approved.','HR','Payroll Preparation','Payroll Preparation','prepare','hr_agent_action_hr_payroll.prepare',false,true,2150,'execute_hr_action','hr_payroll');

insert into permissions(code,module,description,requires_restaurant_outlet_scope) values('hr_agent_action_hr_payroll.calculate','hr_agent_action_hr_payroll','Calculate current earnings and statutory results through canonical Payroll; missing evidence remains Review Required.',true);

insert into feedx_integrations.factory_actions(key,module_id,label,action,human_permission,target_table,target_required,requires_confirmation,input_fields,description) values('hr_payroll.calculate','payroll','Payroll Preparation','calculate','payroll.prepare','payroll_runs',true,false,array['legal_entity_id','employee_id'],'Calculate current earnings and statutory results through canonical Payroll; missing evidence remains Review Required.');

insert into feedx_integrations.capabilities(tool_id,adapter_key,label,description,workspace,domain,domain_label,action_type,permission_code,requires_human_approval,implemented,sort_order,mcp_tool,navigation_module_id) values('hr_payroll.calculate','factory_mesti','Payroll Preparation','Calculate current earnings and statutory results through canonical Payroll; missing evidence remains Review Required.','HR','Payroll Preparation','Payroll Preparation','calculate','hr_agent_action_hr_payroll.calculate',false,true,2150,'execute_hr_action','hr_payroll');

insert into permissions(code,module,description,requires_restaurant_outlet_scope) values('hr_agent_action_hr_payroll.update','hr_agent_action_hr_payroll','Return a Ready/Draft Run to Review Required through the existing lifecycle; never change period, membership or employee inputs.',true);

insert into feedx_integrations.factory_actions(key,module_id,label,action,human_permission,target_table,target_required,requires_confirmation,input_fields,description) values('hr_payroll.update','payroll','Payroll Preparation','update','payroll.prepare','payroll_runs',true,false,array['legal_entity_id','reason'],'Return a Ready/Draft Run to Review Required through the existing lifecycle; never change period, membership or employee inputs.');

insert into feedx_integrations.capabilities(tool_id,adapter_key,label,description,workspace,domain,domain_label,action_type,permission_code,requires_human_approval,implemented,sort_order,mcp_tool,navigation_module_id) values('hr_payroll.update','factory_mesti','Payroll Preparation','Return a Ready/Draft Run to Review Required through the existing lifecycle; never change period, membership or employee inputs.','HR','Payroll Preparation','Payroll Preparation','update','hr_agent_action_hr_payroll.update',false,true,2150,'execute_hr_action','hr_payroll');

update feedx_integrations.capabilities set domain='Payroll Preparation',domain_label='Payroll Preparation' where tool_id in ('hr.view.payroll','hr_payroll.create','hr_payroll_adjustment.create','hr_payroll_adjustment.reverse');

update feedx_integrations.capabilities set label='Payroll Preparation' where tool_id='hr_payroll.create';

do $$begin if md5(pg_get_functiondef('feedx_integrations.hr_target_scope(uuid,text,uuid,jsonb)'::regprocedure))<>'5d8501f08d0eaa7bf4cd4a45af156d09' then raise exception 'Payroll authority drift: hr_target_scope';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_target_scope(p_machine uuid, p_action text, p_target uuid, p_input jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare entity uuid:=(p_input->>'legal_entity_id')::uuid; actual uuid; employee uuid;run uuid;
begin
 if not feedx_integrations.hr_scope_entity(p_machine,entity) then raise exception using errcode='42501',message='HR company scope is required';end if;
 if p_action like 'hr_payroll%' or p_action like 'hr_legal_entity%' then
  if not feedx_integrations.hr_actor_all(p_machine) then raise exception using errcode='42501',message='Company-wide HR authority required';end if;
 end if;
 if p_action='hr_employment.update' then
  select e.legal_entity_id,e.id into actual,employee from employees e where e.id=p_target;
  if actual is distinct from entity or not feedx_integrations.hr_actor_employee(p_machine,employee) or (p_input->'record'->>'legal_entity_id')::uuid is distinct from entity then raise exception using errcode='42501',message='Employee or destination company is outside this HR intent';end if;
 elsif p_action in ('hr_payroll.prepare','hr_payroll.calculate','hr_payroll.update') then
  select p.legal_entity_id into actual from payroll_runs r join payroll_periods p on p.id=r.period_id where r.id=p_target;
  if actual is distinct from entity then raise exception using errcode='42501',message='Payroll Run is outside this company';end if;
 elsif p_action='hr_payroll_adjustment.create' then
  select p.legal_entity_id into actual from payroll_runs r join payroll_periods p on p.id=r.period_id where r.id=(p_input->>'run_id')::uuid;
  if actual is distinct from entity then raise exception using errcode='42501',message='Payroll Run is outside this company';end if;
 elsif p_action='hr_payroll_adjustment.reverse' then
  select p.legal_entity_id into actual from payroll_run_component_adjustments a join payroll_runs r on r.id=a.run_id join payroll_periods p on p.id=r.period_id where a.id=p_target;
  if actual is distinct from entity then raise exception using errcode='42501',message='Adjustment is outside this company';end if;
 elsif p_action='hr_legal_entity.update' and p_target is distinct from entity then raise exception using errcode='42501',message='Legal Entity differs from this company intent';
 end if;
end $function$;

do $$begin if md5(pg_get_functiondef('feedx_integrations.hr_action_snapshot(text,uuid,boolean)'::regprocedure))<>'1ecd4576570366e453db7ffbfebb32b0' then raise exception 'Payroll authority drift: hr_action_snapshot';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_action_snapshot(p_action text, p_target uuid, p_lock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a feedx_integrations.factory_actions%rowtype;row_value jsonb;fields text[];
begin
 if p_target is null then return null;end if;
 select * into strict a from feedx_integrations.factory_actions where key=p_action and key like 'hr_%';
 if p_lock then execute format('select to_jsonb(t) from %s t where id=$1 for update',a.target_table) into row_value using p_target;
 else execute format('select to_jsonb(t) from %s t where id=$1',a.target_table) into row_value using p_target;end if;
 if row_value is null then raise exception using errcode='P0002',message='HR action target unavailable';end if;
 fields:=case
 when p_action='hr_employment.update' then array['id','legal_entity_id','employment_type','employment_status','position','workplace','resigned_date','updated_at']
 when p_action like 'hr_legal_entity.%' then array['id','legal_company_name','company_registration_no','registered_address','display_name','is_active','updated_at']
 when p_action like 'hr_payroll_adjustment.%' then array['id','run_id','employee_id','component_id','amount','reason','reverses_id','created_at','actor_machine_id']
 else array['id','period_id','revision','status','supersedes_run_id','created_at'] end;
 if p_action='hr_employment.update' then
  row_value:=row_value||jsonb_build_object('employment_revisions',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from employee_employment_assignment_revisions r where r.employee_id=p_target));
  fields:=fields||array['employment_revisions'];
 end if;
 return (select jsonb_object_agg(key,value) from jsonb_each(row_value) where key=any(fields));
end $function$;

do $$begin if md5(pg_get_functiondef('feedx_integrations.hr_execute(uuid,uuid,text,uuid,jsonb)'::regprocedure))<>'9fc0766ea2ba3d8840199f1143d50c5c' then raise exception 'Payroll authority drift: hr_execute';end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_execute(p_machine uuid, p_request uuid, p_action text, p_target uuid, p_input jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb;id uuid;
begin
 perform feedx_integrations.hr_target_scope(p_machine,p_action,p_target,p_input);
 case p_action
 when 'hr_employment.update' then
  result:=feedx_integrations.hr_employee_employment_assignment_save(p_machine,p_target,(p_input->>'effective_from')::date,p_input->'record',p_input->>'reason',(p_input->>'expected_revision_id')::uuid,null);
  return p_target;
 when 'hr_payroll.create' then
  return feedx_integrations.hr_payroll_run_create(p_machine,(p_input->>'legal_entity_id')::uuid,(p_input->>'period_start')::date,(p_input->>'period_end')::date,p_input->>'reason',null);
 when 'hr_payroll.prepare' then
  result:=feedx_integrations.hr_payroll_prepare(p_machine,p_target);return p_target;
 when 'hr_payroll.calculate' then
  result:=feedx_integrations.hr_payroll_run_calculate_core(p_machine,p_target,(p_input->>'employee_id')::uuid);
  result:=feedx_integrations.hr_payroll_run_statutory_calculate_core(p_machine,p_target,(p_input->>'employee_id')::uuid);return p_target;
 when 'hr_payroll.update' then
  result:=feedx_integrations.hr_payroll_run_transition(p_machine,p_target,'review_required',p_input->>'reason');return p_target;
 when 'hr_payroll_adjustment.create' then
  return feedx_integrations.hr_payroll_run_component_add(p_machine,p_request,(p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,(p_input->>'component_id')::uuid,(p_input->>'amount')::numeric,p_input->>'reason');
 when 'hr_payroll_adjustment.reverse' then
  return feedx_integrations.hr_payroll_run_component_reverse(p_machine,p_request,p_target,p_input->>'reason');
 when 'hr_legal_entity.create','hr_legal_entity.update' then
  result:=feedx_integrations.hr_legal_entity_save(p_machine,p_target,p_input->'record');return (result->>'id')::uuid;
 else raise exception using errcode='22023',message='Unsupported HR command';
 end case;
end $function$;

do $$begin if md5(pg_get_functiondef('factory_agent_execute_action(text,uuid,text,uuid,text,jsonb)'::regprocedure))<>'12dc44be58b49e4f2473bda4395aa8ef' then raise exception 'Payroll authority drift: factory_agent_execute_action';end if;end $$;

CREATE OR REPLACE FUNCTION public.factory_agent_execute_action(p_token text, p_request_id uuid, p_action text, p_target_id uuid, p_expected_version text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m uuid; a feedx_integrations.factory_actions%rowtype; req feedx_integrations.factory_action_requests%rowtype;
 before_value jsonb; after_value jsonb; result jsonb; v_id uuid; role_id_value uuid; fingerprint text; canonical_request uuid;
begin
 if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>65536 then
 raise exception using errcode='22023',message='Request ID and bounded action input are required.';end if;
 m:=feedx_integrations.factory_action_authorize(p_token,p_action);
 select role_id into role_id_value from feedx_integrations.machine_identities where id=m;
 -- Coordinate with access changes; reauthorize after acquiring the same role lock.
 perform pg_advisory_xact_lock(hashtext('role_configuration:'||role_id_value::text));
 perform 1 from feedx_integrations.machine_identities where id=m for update;
 if feedx_integrations.factory_action_authorize(p_token,p_action)<>m or
  (select role_id from feedx_integrations.machine_identities where id=m) is distinct from role_id_value then
 raise exception using errcode='40001',message='Agent access changed. Retry after reviewing access.';end if;
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if (a.target_required and p_target_id is null) or (not a.target_required and p_target_id is not null) then
 raise exception using errcode='22023',message='Target does not match this action.';end if;
 if exists(select 1 from jsonb_object_keys(p_input)k where not k=any(a.input_fields)) then
 raise exception using errcode='22023',message='Unsupported action input. Actor and lifecycle state are server-owned.';end if;
 if p_action like 'hr_%' then perform feedx_integrations.hr_target_scope(m,p_action,p_target_id,p_input);end if;
 if p_action like 'restaurant_%' then perform feedx_integrations.restaurant_target_scope(m,p_action,p_target_id,(p_input->>'outlet_id')::uuid);end if;
 fingerprint:=feedx_integrations.factory_action_version(jsonb_build_object('action',p_action,'target',p_target_id,'version',p_expected_version,'input',p_input));
 perform pg_advisory_xact_lock(hashtextextended('factory-agent-request:'||m::text||':'||p_request_id::text,0));
 select * into req from feedx_integrations.factory_action_requests where identity_id=m and request_id=p_request_id for update;
 if found then
  if req.payload_hash<>fingerprint then raise exception using errcode='22023',message='Request ID was used for a different intent. Use a new request ID.';end if;
  if req.status='completed' then return req.receipt||jsonb_build_object('replayed',true);end if;
 end if;
 before_value:=feedx_integrations.factory_action_state(p_action,p_target_id,true);
 if feedx_integrations.factory_action_version(before_value) is distinct from p_expected_version then
 raise exception using errcode='40001',message='Factory evidence changed. Read current action context and review a new intent.';end if;
 -- Same machine, regardless of credential, cannot review its own recorded work.
 if p_action not in ('area_cleaning.verify','equipment_cleaning.verify') and a.action in ('verify','approve') and exists(
  select 1 from feedx_integrations.factory_action_requests r where r.identity_id=m and r.status='completed'
   and r.action not like '%.verify' and r.action not like '%.approve'
   and (r.target_id=p_target_id or r.receipt->>'target_id'=p_target_id::text or (p_action='production.verify' and r.target_id=(before_value->>'job_order_id')::uuid))
 ) then raise exception using errcode='42501',message='This Agent cannot verify or approve its own work. Use an independent reviewer.';end if;
 a.requires_confirmation:=a.requires_confirmation and not coalesce((feedx_integrations.factory_execution_policy(p_action,before_value)->>'eligible_without_confirmation')::boolean,false);
 if p_action in ('area_cleaning.verify','equipment_cleaning.verify') then
 perform feedx_integrations.cleaning_verify_requirement(before_value->>'status',p_input->>'result',case when p_action='area_cleaning.verify' then 'Cleaning' else 'Equipment Cleaning' end);end if;
 if req.request_id is null then
  insert into feedx_integrations.factory_action_requests(identity_id,request_id,action,target_id,expected_version,input,payload_hash,status)
  values(m,p_request_id,p_action,p_target_id,p_expected_version,p_input,fingerprint,case when a.requires_confirmation then 'awaiting_confirmation' else 'confirmed' end)
  returning * into req;
 end if;
 if a.requires_confirmation and req.status<>'confirmed' then
 return jsonb_build_object('status','awaiting_confirmation','request_id',p_request_id,'action',p_action,'target_id',p_target_id,
 'message',feedx_integrations.factory_execution_policy(p_action,before_value)->>'execution_reason','execution_policy',feedx_integrations.factory_execution_policy(p_action,before_value)->>'execution_policy');end if;
 if a.requires_confirmation and (req.confirmed_by is null or req.confirmed_at<clock_timestamp()-interval '30 minutes') then
 raise exception using errcode='55000',message='Human confirmation expired. Submit a new intent for review.';end if;
 -- Namespace inner canonical retry keys by stable Agent identity, never by credential.
 canonical_request:=md5(m::text||':'||p_request_id::text)::uuid;
 v_id:=p_target_id;
 case p_action
 when 'hr_payroll.prepare','hr_payroll.calculate','hr_payroll.update','hr_employment.update','hr_payroll.create','hr_payroll_adjustment.create','hr_payroll_adjustment.reverse','hr_legal_entity.create','hr_legal_entity.update' then v_id:=feedx_integrations.hr_execute(m,canonical_request,p_action,p_target_id,p_input);
 when 'restaurant_asset.create','restaurant_asset.update','restaurant_inspection.create','restaurant_inspection.update','restaurant_inspection.complete','restaurant_maintenance.create','restaurant_maintenance.update','restaurant_maintenance.complete','restaurant_stock_check.create','restaurant_stock_check.update','restaurant_stock_check.submit','restaurant_purchase_order.create','restaurant_purchase_order.update','restaurant_purchase_order.submit','restaurant_purchase_order.confirm','restaurant_purchase_order.return_to_draft','restaurant_purchase_order.cancel','restaurant_purchase_order.complete','restaurant_purchase_order.receive','restaurant_movement.create','restaurant_waste.create','restaurant_recipe.create','restaurant_recipe.update' then v_id:=feedx_integrations.restaurant_execute(m,canonical_request,p_action,p_target_id,p_input);
 when 'job_order.create','job_order.update' then
  select to_jsonb(v),v.job_order_id into result,v_id from feedx_integrations.fa_save_job_order_structure(m,p_target_id,
   (p_input->>'finished_good_id')::uuid,(p_input->>'target_quantity')::numeric,p_input->>'uom',(p_input->>'planned_date')::date,
   (p_input->>'due_date')::date,p_input->>'priority',p_input->>'assigned_team',p_input->>'remarks',
   (p_input->>'target_pack_qty')::numeric,(p_input->>'target_production_qty')::numeric)v;
 when 'job_order.submit' then perform feedx_integrations.fa_release_job_order(m,p_target_id);
 when 'job_order.cancel' then perform feedx_integrations.fa_cancel_job_order(m,p_target_id);
 when 'production.update' then
  perform feedx_integrations.fa_save_production_qc_progress(m,p_target_id,coalesce(p_input->'step_rows','[]'),coalesce(p_input->'qc_rows','[]'),null,null);
 when 'production.complete' then
  v_id:=feedx_integrations.fa_complete_production_with_raw_batch_allocations(m,canonical_request,
   coalesce(p_input->'payload','{}')||jsonb_build_object('job_order_id',p_target_id));
 when 'production.verify' then perform feedx_integrations.fa_verify_production_record(m,p_target_id);
 when 'receiving.create','receiving.update','receiving.complete' then
  if p_target_id is not null then
   select coalesce(completion_request_id,canonical_request) into canonical_request from public.factory_raw_material_receiving_batches where id=p_target_id;
  end if;
  result:=feedx_integrations.fa_save_raw_material_receiving(m,p_target_id,canonical_request,(p_input->>'supplier_id')::uuid,
   p_input->>'reference_no',(p_input->>'received_date')::date,p_input->>'remarks',p_input->'items',p_action='receiving.complete');
  v_id:=coalesce((result->>'batch_id')::uuid,(result->>'id')::uuid,p_target_id);
 when 'receiving.verify' then result:=feedx_integrations.fa_verify_raw_material_receiving(m,p_target_id);
 when 'receiving.cancel' then result:=feedx_integrations.fa_cancel_raw_material_receiving(m,p_target_id);
 when 'product_stock_check.create','product_stock_check.update','product_stock_check.submit' then
  select to_jsonb(v),v.id into result,v_id from feedx_integrations.fa_save_product_stock_check_structure(m,p_target_id,
   (p_input->>'check_date')::date,p_input->>'notes',case when a.action='submit' then 'submitted' else 'draft' end,null,p_input->'rows')v;
 when 'product_stock_check.approve' then perform feedx_integrations.fa_approve_product_stock_check(m,p_target_id,null);
 when 'raw_stock_check.create','raw_stock_check.update','raw_stock_check.submit' then
  select to_jsonb(v),v.id into result,v_id from feedx_integrations.fa_save_raw_material_stock_check_structure(m,p_target_id,
   (p_input->>'category_id')::uuid,(p_input->>'check_date')::date,p_input->>'notes',case when a.action='submit' then 'submitted' else 'draft' end,p_input->'rows')v;
 when 'raw_stock_check.approve' then perform feedx_integrations.fa_approve_raw_material_stock_check(m,p_target_id,null);
 when 'area_cleaning.complete' then result:=feedx_integrations.fa_mesti_complete_cleaning_occurrence(m,p_target_id,p_input->>'note');
 when 'area_cleaning.verify' then result:=feedx_integrations.fa_mesti_verify_cleaning_occurrence(m,p_target_id,p_input->>'result',p_input->>'note');
 when 'equipment_cleaning.complete' then result:=feedx_integrations.fa_mesti_complete_equipment_cleaning_occurrence(m,p_target_id,p_input->>'note');
 when 'equipment_cleaning.verify' then result:=feedx_integrations.fa_mesti_verify_equipment_cleaning_occurrence(m,p_target_id,p_input->>'result',p_input->>'note');
 when 'calibration.create' then result:=feedx_integrations.fa_mesti_record_calibration(m,p_target_id,p_input->'record');v_id:=(result->>'id')::uuid;
 when 'calibration.verify' then result:=feedx_integrations.fa_mesti_verify_calibration(m,p_target_id);
 else raise exception using errcode='22023',message='Unsupported Factory action.';
 end case;
 if v_id is null then raise exception using errcode='55000',message='Canonical action did not return a target identity.';end if;
 after_value:=feedx_integrations.factory_action_state(
  case when p_action='production.complete' then 'production.verify' when p_action='calibration.create' then 'calibration.verify' else p_action end,v_id);
 result:=jsonb_build_object('status','completed','request_id',p_request_id,'action',p_action,'target_id',v_id,
  'actor',jsonb_build_object('type','machine','identity_id',m),'confirmed_by',req.confirmed_by,'confirmed_at',req.confirmed_at,
  'before_version',p_expected_version,'after_version',feedx_integrations.factory_action_version(after_value),
  'completed_at',clock_timestamp(),'replayed',false);
 if p_action in ('hr_payroll.create','hr_payroll.prepare','hr_payroll.calculate','hr_payroll.update') then result:=result||jsonb_build_object('payroll',feedx_integrations.hr_payroll_preparation_result(m,v_id,1,100,null));
 elsif p_action like 'hr_payroll_adjustment.%' then result:=result||jsonb_build_object('payroll',feedx_integrations.hr_payroll_preparation_result(m,(select run_id from payroll_run_component_adjustments where id=v_id),1,100,null));end if;
 update feedx_integrations.factory_action_requests set status='completed',completed_at=clock_timestamp(),receipt=result
 where identity_id=m and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
 select 'external_agent_factory_action_completed',case when p_action like 'restaurant_%' or p_action like 'hr_%' then a.module_id else 'factory' end,null,name,case when p_action like 'restaurant_%' then 'Restaurant business action executed by External Agent.' when p_action like 'hr_%' then 'HR business action executed by External Agent.' else 'Factory action executed by External Agent.' end,
 result||jsonb_build_object('workspace',case when p_action like 'hr_%' then 'HR' when p_action like 'restaurant_%' then 'Restaurant' else 'Factory' end,'business_module',a.module_id,'source_before',before_value,'source_after',after_value,'payload_hash',fingerprint)
 from feedx_integrations.machine_identities where id=m;
 return result;
end $function$;

create function feedx_integrations.hr_payroll_prepare(p_machine uuid,p_run uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r payroll_runs%rowtype;p payroll_periods%rowtype;until_date date;
begin
 select * into r from payroll_runs where id=p_run for update;
 select * into p from payroll_periods where id=r.period_id;
 if not feedx_integrations.hr_actor_entity(p_machine,p.legal_entity_id,'payroll.prepare') then raise exception using errcode='42501',message='Payroll preparation authority required';end if;
 if r.foundation_only or r.status not in ('draft','review_required') then raise exception using errcode='55000',message='Prepare requires an open calculation Draft';end if;
 until_date:=least(p.period_end,timezone('Asia/Kuala_Lumpur',now())::date);
 if until_date<p.period_start then return jsonb_build_object('created',0,'period_in_progress',true);end if;
 return feedx_integrations.hr_payroll_time_reconcile(p_machine,p.legal_entity_id,p.period_start,until_date);
end $$;
revoke all on function feedx_integrations.hr_payroll_prepare(uuid,uuid) from public,anon,authenticated;

-- Redacted projection of the same Run evidence consumed by the Payroll UI; no parallel pricing.
create function feedx_integrations.hr_payroll_preparation_result(p_machine uuid,p_run uuid,p_page int default 1,p_page_size int default 100,p_snapshot text default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r payroll_runs%rowtype;p payroll_periods%rowtype;evidence jsonb;members jsonb;member jsonb;calc jsonb;stat jsonb;rows jsonb:='[]';snapshot text;ready boolean;total int;totals jsonb;
begin
 select * into r from payroll_runs where id=p_run;
 if r.id is null then raise exception using errcode='P0002',message='Payroll Run not found';end if;
 select * into p from payroll_periods where id=r.period_id;
 if not feedx_integrations.hr_actor_entity(p_machine,p.legal_entity_id,'payroll.view') then raise exception using errcode='42501',message='Company-wide Payroll View authority required';end if;
 if r.status in ('finalized','paid') then raise exception using errcode='55000',message='Use frozen Payroll resources; preparation is unavailable after finalization';end if;
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then raise exception using errcode='22023',message='Use valid Payroll result pagination';end if;
 evidence:=feedx_integrations.hr_payroll_run_evidence_read(p_machine,p_run);
 members:=evidence#>'{preparation,results}';total:=jsonb_array_length(members);
 snapshot:=md5(evidence::text);
 if (p_page>1 and p_snapshot is null) or (p_snapshot is not null and p_snapshot<>snapshot) then raise exception using errcode='40001',message='Payroll evidence changed; restart readiness pagination';end if;
 if total>0 and (p_page-1)*p_page_size>=total then raise exception using errcode='22023',message='Page outside Payroll population';end if;
 ready:=coalesce((evidence#>>'{readiness,time,ready}')::boolean,false) and coalesce((evidence#>>'{readiness,calculation,ready}')::boolean,false) and coalesce((evidence#>>'{readiness,statutory,ready}')::boolean,false) and evidence#>>'{preparation,employment_issue}' is null;
 for member in select value from jsonb_array_elements(members) order by value->>'employee_id' offset (p_page-1)*p_page_size limit p_page_size loop
  select value into calc from jsonb_array_elements(evidence#>'{calculation,results}') where value->>'employee_id'=member->>'employee_id';
  select value into stat from jsonb_array_elements(evidence#>'{statutory,results}') where value->>'employee_id'=member->>'employee_id';
  rows:=rows||jsonb_build_array(jsonb_build_object('employee_id',member->'employee_id',
   'status',case when calc is null or stat is null then 'uncalculated' when coalesce((calc->>'is_stale')::boolean,false) or coalesce((stat->>'is_stale')::boolean,false) then 'stale' when calc->>'status'='ready' and stat->>'status'='ready' then 'ready' else 'review_required' end,
   'missing_inputs',coalesce((select jsonb_agg(code order by code) from (select distinct jsonb_array_elements_text(coalesce(calc->'issues',member#>'{projection,issues}','[]')||coalesce(stat->'issues','[]')) code) missing),'[]'),'employment',member->'employment','time_exception_count',member->'time_exception_count',
   'calculation',jsonb_build_object('version_id',calc->'id','revision',calc->'revision','status',calc->'status','is_stale',calc->'is_stale','issues',coalesce(calc->'issues',member#>'{projection,issues}','[]'),
    'gross_earnings',case when calc->>'status'='ready' and not coalesce((calc->>'is_stale')::boolean,true) then calc->'gross_earnings' end,
    'earning_groups',coalesce(calc->'earning_groups',public.payroll_earning_groups(member->'projection'))),
   'statutory',jsonb_build_object('version_id',stat->'id','revision',stat->'revision','status',stat->'status','is_stale',stat->'is_stale','issues',coalesce(stat->'issues','[]'),
    'net_pay',case when stat->>'status'='ready' and not coalesce((stat->>'is_stale')::boolean,true) then stat->'net_pay' end),
   'exceptions',coalesce((select jsonb_agg(jsonb_build_object('work_date',day->'work_date','state',day->'state','required',day->'required','issues',day->'issues','classification',day->'classification')) from jsonb_array_elements(coalesce(member->'time_review','[]')) day where coalesce((day->>'required')::boolean,false) and day->>'state'<>'ready'),'[]')));
 end loop;
 if ready then select jsonb_build_object('gross_earnings',sum((value->>'gross_earnings')::numeric),'net_pay',sum((value->>'net_pay')::numeric),'employer_statutory_cost',sum((value->>'employer_statutory_cost')::numeric),'total_employer_cost',sum((value->>'total_employer_cost')::numeric)) into totals from jsonb_array_elements(evidence#>'{statutory,results}');end if;
 return jsonb_build_object('run_id',r.id,'legal_entity_id',p.legal_entity_id,'period_start',p.period_start,'period_end',p.period_end,'run_status',r.status,'run_revision',r.revision,
  'readiness',evidence->'readiness','employment_population',evidence#>'{preparation,employment_population}','employment_issue',evidence#>'{preparation,employment_issue}',
  'preparation_ready',ready,'agent_can_finalize',false,'financial_totals',totals,'employees',rows,'total_employees',total,'page',p_page,'page_size',p_page_size,'next_page',case when p_page*p_page_size<total then p_page+1 end,'snapshot',snapshot,
  'adjustments',evidence#>'{calculation,adjustments}',
  'available_components',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'component_type',component_type) order by name,id) from payroll_component_definitions where is_active),'[]'),
  'manual_steps','Resolve missing Employment, compensation, statutory/PCB, PH and time evidence through their existing Human authorities. Finalize, Payment and Statutory Submission are unavailable to Agents.');
end $$;
revoke all on function feedx_integrations.hr_payroll_preparation_result(uuid,uuid,int,int,text) from public,anon,authenticated;
create function public.hr_agent_payroll_readiness(p_token text,p_legal_entity_id uuid,p_run_id uuid,p_page int default 1,p_page_size int default 100,p_snapshot text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m uuid;
begin
 m:=feedx_integrations.authorize(p_token,'factory_mesti_inspection.view');
 if feedx_integrations.authorize(p_token,'hr_agent_nav_payroll.view') is distinct from m or not feedx_integrations.hr_actor_all(m) or not exists(select 1 from payroll_runs r join payroll_periods p on p.id=r.period_id where r.id=p_run_id and p.legal_entity_id=p_legal_entity_id) then raise exception using errcode='42501',message='Payroll View and exact company scope required';end if;
 return feedx_integrations.hr_payroll_preparation_result(m,p_run_id,p_page,p_page_size,p_snapshot);
end $$;
revoke all on function public.hr_agent_payroll_readiness(text,uuid,uuid,int,int,text) from public;
grant execute on function public.hr_agent_payroll_readiness(text,uuid,uuid,int,int,text) to anon,authenticated;

notify pgrst,'reload schema';

do $$begin if md5(pg_get_functiondef('feedx_integrations.discovery(uuid)'::regprocedure))<>'a74451b224124d9a51be6792033a6678' then raise exception 'Discovery drift';end if;end $$;
CREATE OR REPLACE FUNCTION feedx_integrations.discovery(p_identity uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with actions as(select c from jsonb_array_elements(feedx_integrations.factory_action_catalog(p_identity)) c
 where (c->>'granted')::boolean and (c->>'view_granted')::boolean),base as(select feedx_integrations.factory_read_discovery(p_identity) v),
 reads as(select c.*,r.slug,b.allowed_fields from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.adapter_key=c.adapter_key join public.role_permissions rp on rp.role_id=m.role_id join public.permissions p on p.id=rp.permission_id and p.code=c.permission_code join feedx_integrations.navigation_resources b on b.module_id=c.navigation_module_id join feedx_integrations.resources r on r.key=b.resource_key where m.id=p_identity and c.workspace='Restaurant' and c.action_type='view' and c.implemented),
 outlets as(select o.id,o.name from public.outlets o where feedx_integrations.restaurant_actor_outlet(p_identity,o.id))
 select v||jsonb_build_object('tools',coalesce(v->'tools','[]')
 ||case when exists(select 1 from actions where c->>'workspace'='Factory') then '["factory_action_context","execute_factory_action"]'::jsonb else '[]' end
 ||case when exists(select 1 from reads) then '["query_restaurant_resources"]'::jsonb else '[]' end
 ||case when exists(select 1 from actions where c->>'workspace'='Restaurant') then '["restaurant_action_context","execute_restaurant_action"]'::jsonb else '[]' end
 ||case when exists(select 1 from feedx_integrations.machine_identities m join role_permissions rp on rp.role_id=m.role_id join permissions p on p.id=rp.permission_id where m.id=p_identity and p.code='hr_agent_nav_payroll.view') then '["check_payroll_readiness"]'::jsonb else '[]'::jsonb end
 ||case when exists(select 1 from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.id=p_identity join role_permissions rp on rp.role_id=m.role_id join permissions p on p.id=rp.permission_id and p.code=c.permission_code where c.workspace='HR' and c.implemented and c.action_type='view') then '["query_hr_resources"]'::jsonb else '[]' end
 ||case when exists(select 1 from actions where c->>'workspace'='HR') then '["hr_action_context","execute_hr_action"]'::jsonb else '[]' end
 ||case when exists(select 1 from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.id=p_identity join role_permissions rp on rp.role_id=m.role_id join permissions p on p.id=rp.permission_id and p.code=c.permission_code where c.tool_id='restaurant.view.product_analytics') then '["query_product_sales_analytics"]'::jsonb else '[]' end,
 'factory_actions',coalesce((select jsonb_agg(c) from actions where c->>'workspace'='Factory'),'[]'),
 'hr_actions',coalesce((select jsonb_agg(c) from actions where c->>'workspace'='HR'),'[]'),
 'hr_resource_catalog',coalesce((select jsonb_agg(jsonb_build_object('resource',r.slug,'business_module',c.navigation_module_id,'fields',b.allowed_fields,'company_required',true)) from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.id=p_identity join role_permissions rp on rp.role_id=m.role_id join permissions p on p.id=rp.permission_id and p.code=c.permission_code join feedx_integrations.navigation_resources b on b.module_id=c.navigation_module_id join feedx_integrations.resources r on r.key=b.resource_key where c.workspace='HR' and c.implemented and c.action_type='view'),'[]'),
 'hr_companies',case when exists(select 1 from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.id=p_identity join role_permissions rp on rp.role_id=m.role_id join permissions p on p.id=rp.permission_id and p.code=c.permission_code where c.workspace='HR') then coalesce((select jsonb_agg(jsonb_build_object('id',le.id) order by le.id) from legal_entities le where feedx_integrations.hr_scope_entity(p_identity,le.id)),'[]') else '[]' end,
 'restaurant_actions',coalesce((select jsonb_agg(c) from actions where c->>'workspace'='Restaurant'),'[]'),
 'restaurant_outlets',case when exists(select 1 from reads) or exists(select 1 from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.id=p_identity join role_permissions rp on rp.role_id=m.role_id join permissions p on p.id=rp.permission_id and p.code=c.permission_code where c.tool_id='restaurant.view.product_analytics') then coalesce((select jsonb_agg(to_jsonb(outlets) order by id) from outlets),'[]') else '[]' end,
 'restaurant_resource_catalog',coalesce((select jsonb_agg(jsonb_build_object('resource',slug,'business_module',navigation_module_id,'fields',allowed_fields,'outlet_required',true)) from reads),'[]'),
 'restaurant_resource_actions',coalesce((select jsonb_agg(jsonb_build_object('resource',slug,'business_module',navigation_module_id,'action','view')) from reads),'[]')) from base;
$function$
;
update feedx_integrations.adapters set tools=tools||'[{"name":"check_payroll_readiness","description":"Read canonical company Payroll Draft readiness, missing inputs and exceptions."}]'::jsonb where key='factory_mesti';
notify pgrst,'reload schema';
