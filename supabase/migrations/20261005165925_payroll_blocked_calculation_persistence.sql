-- Partial earning evidence must not be stored as a completed financial version.
-- Required financial columns and all existing version/snapshot constraints remain intact.
create or replace function public.payroll_calculation_has_totals(p_projection jsonb)
returns boolean language sql immutable set search_path=public as $$
 select bool_and(coalesce(jsonb_typeof(p_projection->key)='number',false))
 from unnest(array['gross_earnings','non_statutory_deductions','reimbursements','pre_statutory_pay']) key;
$$;
revoke all on function public.payroll_calculation_has_totals(jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.payroll_run_calculate_core(p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_projection jsonb;
  v_latest public.payroll_run_calculation_versions%rowtype;
  v_created integer:=0; v_unchanged integer:=0; v_blocked integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage') then
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
       reimbursements,pre_statutory_pay,calculated_by_employee_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      v_projection->>'input_fingerprint',v_projection->>'status',v_projection->>'pay_basis',
      v_projection->>'basic_or_hours',v_projection->'lines',
      array(select jsonb_array_elements_text(v_projection->'issues')),
      v_projection->'inputs',(v_projection->>'gross_earnings')::numeric,
      (v_projection->>'non_statutory_deductions')::numeric,
      (v_projection->>'reimbursements')::numeric,
      (v_projection->>'pre_statutory_pay')::numeric,v_actor);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,details)
    values('run_calculated',p_run_id,v_actor,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged,'blocked',v_blocked);
end; $function$
;
CREATE OR REPLACE FUNCTION public.payroll_run_statutory_calculate_core(p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_project jsonb;
  v_latest public.payroll_run_statutory_versions%rowtype; v_created integer:=0; v_unchanged integer:=0; v_blocked integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage') then
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
      total_employer_cost,calculated_by_employee_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      (v_project->>'calculation_version_id')::uuid,v_project->>'input_fingerprint',v_project->>'status',
      v_project->'lines',array(select jsonb_array_elements_text(v_project->'issues')),
      v_project->'inputs',(v_project->>'gross_earnings')::numeric,
      (v_project->>'non_statutory_deductions')::numeric,(v_project->>'reimbursements')::numeric,
      (v_project->>'net_pay')::numeric,(v_project->>'employer_statutory_cost')::numeric,
      (v_project->>'total_employer_cost')::numeric,v_actor);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,details)
    values('run_statutory_calculated',p_run_id,v_actor,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged,'blocked',v_blocked);
end; $function$
;
CREATE OR REPLACE FUNCTION public.payroll_run_evidence_read(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
 perform public.payroll_admin_actor();
 select * into r from public.payroll_runs where id=p_run_id;
 if r.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
 select * into p from public.payroll_periods where id=r.period_id;
 if not public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll Run view authority denied.';
 end if;
 if r.status in ('finalized','paid') then
  raise exception using errcode='22023',message='Use the frozen Payroll record for finalized runs.';
 end if;
 -- This authority checks dated membership and each employee's access.
 prep:=public.payroll_run_preparation_read(p_run_id);
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
  'time',public.payroll_time_read(p.legal_entity_id,p.period_start,p.period_end),
  'pcb',public.payroll_run_pcb_read(p_run_id),
  'readiness',jsonb_build_object('time',public.payroll_run_time_readiness(p_run_id),
   'calculation',calc_readiness,'statutory',stat_readiness));
end $function$
;
CREATE OR REPLACE FUNCTION public.payroll_run_calculation_read(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_rows jsonb; v_adjustments jsonb; v_readiness jsonb;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  if v_run.status in ('finalized','paid') then
    select coalesce(jsonb_agg(s.calculation || jsonb_build_object(
      'employee_name',coalesce(p.employee_name_snapshot,e.full_name),
      'employee_code',e.employee_code,'is_stale',false)
      order by coalesce(p.employee_name_snapshot,e.full_name)),'[]'::jsonb) into v_rows
    from public.payroll_run_calculation_snapshots s
      join public.employees e on e.id=s.employee_id
      left join public.payroll_run_profile_snapshots p
        on p.run_id=s.run_id and p.employee_id=s.employee_id
    where s.run_id=p_run_id;
    v_readiness:=jsonb_build_object('ready',jsonb_array_length(v_rows)>0,
      'employees',jsonb_array_length(v_rows),'review_required',0,'uncalculated',0,
      'stale',0,'period_in_progress',false,'pinned',true);
  else
    -- Open reads share the same live blocked evidence and current-version semantics.
    return public.payroll_run_evidence_read(p_run_id)->'calculation';

  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,
    'component_id',a.component_id,'component_name',d.name,'component_type',d.component_type,
    'amount',a.amount,'reason',a.reason,'created_at',a.created_at) order by a.created_at),'[]'::jsonb)
    into v_adjustments
  from public.payroll_run_component_adjustments a
    join public.payroll_component_definitions d on d.id=a.component_id
  where a.run_id=p_run_id and a.reverses_id is null
    and not exists(select 1 from public.payroll_run_component_adjustments reverse where reverse.reverses_id=a.id);
  select coalesce(jsonb_agg(x||jsonb_build_object('earning_groups',public.payroll_earning_groups(x))),'[]') into v_rows from jsonb_array_elements(v_rows) x; return jsonb_build_object('results',v_rows,'adjustments',v_adjustments,'readiness',v_readiness);
end; $function$
;
CREATE OR REPLACE FUNCTION public.payroll_run_statutory_read(p_run_id uuid)
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
  if v_run.status not in ('finalized','paid') then
    return public.payroll_run_evidence_read(p_run_id)->'statutory';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'employee_id',s.employee_id,
    'employee_name',e.full_name,'employee_code',e.employee_code,'revision',s.revision,
    'status',s.status,'issues',to_jsonb(s.issues),'lines',s.lines,'inputs',s.inputs,
    'is_stale',s.input_fingerprint is distinct from
      (public.payroll_statutory_project(p_run_id,s.employee_id)->>'input_fingerprint'),
    'gross_earnings',s.gross_earnings,'non_statutory_deductions',s.non_statutory_deductions,
    'reimbursements',s.reimbursements,'net_pay',s.net_pay,
    'employer_statutory_cost',s.employer_statutory_cost,
    'total_employer_cost',s.total_employer_cost) order by e.full_name),'[]'::jsonb) into v_rows
  from public.payroll_run_statutory_versions s join public.employees e on e.id=s.employee_id
  where s.run_id=p_run_id and not exists(select 1 from public.payroll_run_statutory_versions newer
    where newer.run_id=s.run_id and newer.employee_id=s.employee_id and newer.revision>s.revision);
  return jsonb_build_object('results',v_rows,'readiness',public.payroll_run_statutory_readiness(p_run_id));
end; $function$
;
CREATE OR REPLACE FUNCTION public.payroll_run_calculation_readiness(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee_id uuid; v_project jsonb; v_latest public.payroll_run_calculation_versions%rowtype;
  v_count integer:=0; v_missing integer:=0; v_review integer:=0; v_stale integer:=0;
  v_in_progress boolean;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) loop
    v_count:=v_count+1;
    v_project:=public.payroll_calculation_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_calculation_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1;
    if v_run.status not in ('finalized','paid') and not public.payroll_calculation_has_totals(v_project) then v_review:=v_review+1;
    elsif v_latest.id is null then v_missing:=v_missing+1;
    elsif v_latest.input_fingerprint is distinct from v_project->>'input_fingerprint' then v_stale:=v_stale+1;
    elsif v_latest.status='review_required' then v_review:=v_review+1;
    end if;
  end loop;
  v_in_progress:=v_period.period_end>=timezone('Asia/Kuala_Lumpur',now())::date;
  return jsonb_build_object('ready',v_count>0 and v_missing=0 and v_review=0
      and v_stale=0 and not v_in_progress and public.payroll_period_employment_scope_issue(v_period.id) is null,
    'employees',v_count,'uncalculated',v_missing,'review_required',v_review,
    'stale',v_stale,'period_in_progress',v_in_progress,
    'employment_issue',public.payroll_period_employment_scope_issue(v_period.id));
end; $function$
;
CREATE OR REPLACE FUNCTION public.payroll_run_statutory_readiness(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee_id uuid; v_project jsonb; v_latest public.payroll_run_statutory_versions%rowtype;
  v_count integer:=0; v_missing integer:=0; v_review integer:=0; v_stale integer:=0;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) loop
    v_count:=v_count+1; v_project:=public.payroll_statutory_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_statutory_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1;
    if v_run.status not in ('finalized','paid') and not public.payroll_calculation_has_totals(public.payroll_calculation_project(p_run_id,v_employee_id)) then v_review:=v_review+1;
    elsif v_latest.id is null then v_missing:=v_missing+1;
    elsif v_latest.input_fingerprint is distinct from v_project->>'input_fingerprint' then v_stale:=v_stale+1;
    elsif v_latest.status='review_required' then v_review:=v_review+1; end if;
  end loop;
  return jsonb_build_object('ready',v_count>0 and v_missing=0 and v_review=0 and v_stale=0
      and (v_period.period_end<timezone('Asia/Kuala_Lumpur',now())::date),
    'employees',v_count,'uncalculated',v_missing,'review_required',v_review,'stale',v_stale);
end; $function$;

-- Replacements retain established grants; the predicate is private.
revoke all on function public.payroll_run_calculate_core(uuid,uuid), public.payroll_run_statutory_calculate_core(uuid,uuid) from public,anon,authenticated;
