-- One transaction-local read plan; no caching or calculation writes.
-- Existing projectors still own fingerprints, amounts, eligibility and issues.
create or replace function public.payroll_run_evidence_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
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
  if c.id is null then calc_missing:=calc_missing+1;
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
  if s.id is null then stat_missing:=stat_missing+1;
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
end $$;
revoke all on function public.payroll_run_evidence_read(uuid) from public,anon;
grant execute on function public.payroll_run_evidence_read(uuid) to authenticated;
