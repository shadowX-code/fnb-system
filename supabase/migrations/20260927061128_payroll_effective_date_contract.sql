-- Forward-compatible month-effective statutory evidence. Legacy exact-date rows
-- are retained verbatim. Only an explicit Admin confirmation creates monthly evidence.
alter table public.payroll_statutory_profile_versions
  add column effective_basis text not null default 'exact_date' check(effective_basis in ('exact_date','payroll_month')),
  add column month_revision integer;
alter table public.payroll_statutory_input_versions
  add column effective_basis text not null default 'exact_date' check(effective_basis in ('exact_date','payroll_month')),
  add column month_revision integer;
alter table public.payroll_statutory_profile_versions drop constraint payroll_statutory_profile_version_profile_id_effective_from_key;
alter table public.payroll_statutory_input_versions drop constraint payroll_statutory_input_versions_profile_id_effective_from_key;
create unique index payroll_statutory_legacy_date on public.payroll_statutory_profile_versions(profile_id,effective_from) where effective_basis='exact_date';
create unique index payroll_category_legacy_date on public.payroll_statutory_input_versions(profile_id,effective_from) where effective_basis='exact_date';
create unique index payroll_statutory_month_revision on public.payroll_statutory_profile_versions(profile_id,effective_from,month_revision) where effective_basis='payroll_month';
create unique index payroll_category_month_revision on public.payroll_statutory_input_versions(profile_id,effective_from,month_revision) where effective_basis='payroll_month';
alter table public.payroll_statutory_profile_versions add constraint payroll_statutory_month_valid check(
  (effective_basis='exact_date' and month_revision is null) or
  (effective_basis='payroll_month' and effective_from=date_trunc('month',effective_from)::date and month_revision is not null and month_revision>0));
alter table public.payroll_statutory_input_versions add constraint payroll_category_month_valid check(
  (effective_basis='exact_date' and month_revision is null) or
  (effective_basis='payroll_month' and effective_from=date_trunc('month',effective_from)::date and month_revision is not null and month_revision>0));

create function public.payroll_statutory_applicability_effective(p_profile_id uuid,p_date date)
returns setof public.payroll_statutory_profile_versions language sql stable security definer set search_path=public as $$
 select v.* from public.payroll_statutory_profile_versions v
 where v.profile_id=p_profile_id and v.effective_from<=p_date
 order by date_trunc('month',v.effective_from) desc,
   (v.effective_basis='payroll_month') desc,v.month_revision desc nulls last,v.effective_from desc limit 1;
$$;
create function public.payroll_statutory_category_effective(p_profile_id uuid,p_date date)
returns setof public.payroll_statutory_input_versions language sql stable security definer set search_path=public as $$
 select v.* from public.payroll_statutory_input_versions v
 where v.profile_id=p_profile_id and v.effective_from<=p_date
 order by date_trunc('month',v.effective_from) desc,
   (v.effective_basis='payroll_month') desc,v.month_revision desc nulls last,v.effective_from desc limit 1;
$$;
revoke all on function public.payroll_statutory_applicability_effective(uuid,date),public.payroll_statutory_category_effective(uuid,date) from public,anon,authenticated;

-- Route every operational statutory consumer through the same effective evidence.
-- Exact anchors deliberately fail migration if an upstream contract has changed.
do $migration$
declare definition text; changed text; signature text;
begin
 foreach signature in array array[
  'public.payroll_statutory_setup_core(uuid,uuid,date,jsonb)',
  'public.payroll_statutory_project_pre_epf_oct2025(uuid,uuid)',
  'public.payroll_run_pcb_confirm(uuid,uuid,uuid,numeric,text,text,text)',
  'public.payroll_run_pcb_read_pre_employee_scope(uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure); changed:=definition;
  changed:=replace(changed,'from public.payroll_statutory_profile_versions where profile_id=p_profile_id and effective_from<=p_date order by effective_from desc limit 1',
    'from public.payroll_statutory_applicability_effective(p_profile_id,p_date)');
  changed:=replace(changed,'from public.payroll_statutory_input_versions where profile_id=p_profile_id and effective_from<=p_date order by effective_from desc limit 1',
    'from public.payroll_statutory_category_effective(p_profile_id,p_date)');
  changed:=replace(changed,E'from public.payroll_statutory_profile_versions\n    where profile_id=v_profile.id and effective_from<=v_setup_date order by effective_from desc limit 1',
    'from public.payroll_statutory_applicability_effective(v_profile.id,v_setup_date)');
  changed:=replace(changed,E'from public.payroll_statutory_input_versions\n    where profile_id=v_profile.id and effective_from<=v_setup_date order by effective_from desc limit 1',
    'from public.payroll_statutory_category_effective(v_profile.id,v_setup_date)');
  changed:=replace(changed,E'from public.payroll_statutory_profile_versions\n    where profile_id=v_profile.id and effective_from<=public.payroll_employee_period_start(p_run_id,p_employee_id)\n    order by effective_from desc limit 1',
    'from public.payroll_statutory_applicability_effective(v_profile.id,public.payroll_employee_period_start(p_run_id,p_employee_id))');
  changed:=replace(changed,E'from public.payroll_statutory_profile_versions s\n    where s.profile_id=profile.id and s.effective_from<=public.payroll_employee_period_start(p_run_id,member.employee_id)\n    order by s.effective_from desc limit 1',
    'from public.payroll_statutory_applicability_effective(profile.id,public.payroll_employee_period_start(p_run_id,member.employee_id)) s');
  -- A confirmed monthly event supersedes legacy intra-month dates, not history.
  changed:=replace(changed,'v_applicability.id is not null and exists(',
    'v_applicability.id is not null and v_applicability.effective_basis<>''payroll_month'' and exists(');
  changed:=replace(changed,'v_input.id is not null and exists(',
    'v_input.id is not null and v_input.effective_basis<>''payroll_month'' and exists(');
  changed:=replace(changed,'or exists(select 1 from public.payroll_statutory_profile_versions newer',
    'or (v_applicability.effective_basis<>''payroll_month'' and exists(select 1 from public.payroll_statutory_profile_versions newer');
  if signature like '%payroll_run_pcb_confirm%' then
    changed:=replace(changed,'and newer.effective_from<=v_period.period_end) then','and newer.effective_from<=v_period.period_end)) then');
  end if;
  -- Do not call a current but blocked earnings result stale.
  changed:=replace(changed,E'if v_calc.id is null or v_calc.status<>''ready''\n    or v_calc.input_fingerprint is distinct from',
    E'if v_calc.id is null or v_calc.input_fingerprint is distinct from');
  changed:=replace(changed,E'if v_applicability.id is null then',
    E'if v_calc.id is not null and v_calc.status<>''ready'' then v_issues:=array_append(v_issues,''earnings_inputs_require_review''); end if;\n  if v_applicability.id is null then');
  if signature like '%payroll_statutory_project_pre_epf%' then
   changed:=replace(changed,'v_inputs:=jsonb_build_object(''calculation_version_id'',v_calc.id,',
    'v_inputs:=jsonb_build_object(''applicability_coverage'',jsonb_build_object(''start'',v_setup_date,''missing_through'',case when v_applicability.id is null then least(v_period.period_end,coalesce((select min(effective_from)-1 from public.payroll_statutory_profile_versions where profile_id=v_profile.id and effective_from>v_setup_date),v_period.period_end)) else null end),''calculation_version_id'',v_calc.id,');
  end if;
  if changed=definition then raise exception 'Statutory consumer anchor changed: %',signature; end if;
  execute changed;
 end loop;
end; $migration$;

create or replace function public.payroll_statutory_setup_read(p_profile_id uuid,p_date date default null,p_applicability jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; d date:=coalesce(p_date,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date); latest jsonb;
begin
 result:=public.payroll_statutory_setup_resolve(p_profile_id,d,p_applicability);
 select jsonb_build_object('applicability',coalesce((select jsonb_agg(to_jsonb(v) order by effective_from desc,created_at desc)
   from public.payroll_statutory_profile_versions v where profile_id=p_profile_id),'[]'),
   'categories',coalesce((select jsonb_agg(to_jsonb(v) order by effective_from desc,created_at desc)
   from public.payroll_statutory_input_versions v where profile_id=p_profile_id),'[]')) into latest;
 return result||jsonb_build_object('effective_basis','payroll_month',
   'next_effective_from',date_trunc('month',d)::date,'history',latest,
   'fingerprint',md5((result->>'fingerprint')||latest::text));
end; $$;

create or replace function public.payroll_statutory_setup_confirm(p_profile_id uuid,p_effective_from date,p_applicability jsonb,
 p_categories jsonb,p_fingerprint text,p_source_note text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; s text; category text; suggestion text; categories jsonb:='{}'; manual boolean:=false;
 actor uuid:=public.payroll_admin_actor(); a public.payroll_statutory_profile_versions%rowtype;
 i public.payroll_statutory_input_versions%rowtype; revision integer; source text; reason text; employee uuid;
begin
 select employee_id into employee from public.payroll_profiles where id=p_profile_id for update;
 if employee is null or not public.payroll_can_access_employee(employee,'payroll.manage') then
  raise exception using errcode='42501',message='Payroll statutory setup scope denied.'; end if;
 if p_effective_from is null or p_effective_from<>date_trunc('month',p_effective_from)::date then
  raise exception using errcode='22023',message='Choose an Effective Payroll Month.'; end if;
 -- Lock the same Run rows used by Finalize before checking frozen evidence.
 perform 1 from public.payroll_runs run join public.payroll_periods period on period.id=run.period_id
   where period.period_end>=p_effective_from and exists(select 1 from public.payroll_compensation_versions c
     where c.profile_id=p_profile_id and c.legal_entity_id=period.legal_entity_id) order by run.id for update of run;
 if exists(select 1 from public.payroll_run_profile_snapshots snap join public.payroll_runs run on run.id=snap.run_id
   join public.payroll_periods period on period.id=run.period_id where snap.profile_id=p_profile_id
   and run.status in ('finalized','paid') and period.period_end>=p_effective_from) then
  raise exception using errcode='55000',message='Use a controlled correction for a finalized period.'; end if;
 r:=public.payroll_statutory_setup_read(p_profile_id,p_effective_from,p_applicability);
 if r->>'fingerprint' is distinct from p_fingerprint then
  raise exception using errcode='PT409',message='Statutory information was updated',detail='payroll_statutory_setup_stale'; end if;
 foreach s in array array['epf','socso','eis','pcb'] loop
  if p_applicability->>s is null then raise exception using errcode='22023',message='Confirm applicability for every scheme.'; end if;
  if s='pcb' or (p_applicability->>s)::boolean=false then continue; end if;
  category:=nullif(p_categories->>s,''); suggestion:=r->'schemes'->s->>'recommendation';
  if category is not null and public.payroll_statutory_category_issue(s,category,r->'evidence'->>'nationality',
   (r->'evidence'->>'birthday')::date,p_effective_from,(p_effective_from+interval '1 month - 1 day')::date) is not null then
   raise exception using errcode='22023',message='Category is unsupported by canonical employee evidence.'; end if;
  manual:=manual or (category is not null and category is distinct from suggestion);
  categories:=categories||jsonb_build_object(s,category);
 end loop;
 if manual and (length(btrim(coalesce(p_source_note,'')))<8 or length(btrim(coalesce(p_reason,'')))<3) then
  raise exception using errcode='22023',message='An override requires evidence and reason.'; end if;
 source:=case when manual then btrim(p_source_note) else 'FeedX canonical Employee evidence: '||(r->'evidence')::text end;
 reason:=case when manual then btrim(p_reason) else 'Admin confirmed payroll-month statutory setup' end;
 select * into a from public.payroll_statutory_applicability_effective(p_profile_id,p_effective_from);
 select * into i from public.payroll_statutory_category_effective(p_profile_id,p_effective_from);
 -- Reconfirmation of identical monthly evidence is a no-op, not audit noise.
 if a.effective_basis='payroll_month' and i.effective_basis='payroll_month' and a.effective_from=p_effective_from
  and i.effective_from=p_effective_from and a.epf_applicable=(p_applicability->>'epf')::boolean
  and a.socso_applicable=(p_applicability->>'socso')::boolean and a.eis_applicable=(p_applicability->>'eis')::boolean
  and a.pcb_applicable=(p_applicability->>'pcb')::boolean and i.epf_category is not distinct from categories->>'epf'
  and i.socso_category is not distinct from categories->>'socso' and i.eis_category is not distinct from categories->>'eis' then
  return public.payroll_statutory_setup_resolve(p_profile_id,p_effective_from,null); end if;
 select coalesce(max(month_revision),0)+1 into revision from public.payroll_statutory_profile_versions
  where profile_id=p_profile_id and effective_from=p_effective_from and effective_basis='payroll_month';
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_statutory_profile_versions(profile_id,effective_from,effective_basis,month_revision,
  epf_applicable,socso_applicable,eis_applicable,pcb_applicable,reason,approved_by_employee_id)
 values(p_profile_id,p_effective_from,'payroll_month',revision,(p_applicability->>'epf')::boolean,
  (p_applicability->>'socso')::boolean,(p_applicability->>'eis')::boolean,(p_applicability->>'pcb')::boolean,reason,actor) returning * into a;
 insert into public.payroll_statutory_input_versions(profile_id,effective_from,effective_basis,month_revision,
  epf_category,socso_category,eis_category,pcb_inputs,source_note,reason,approved_by_employee_id)
 values(p_profile_id,p_effective_from,'payroll_month',revision,categories->>'epf',categories->>'socso',categories->>'eis','{}',source,reason,actor) returning * into i;
 insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
 values('statutory_month_confirmed',p_profile_id,actor,reason,jsonb_build_object('effective_payroll_month',p_effective_from,
  'applicability_version',to_jsonb(a),'category_version',to_jsonb(i),'source_evidence',r->'evidence'));
 return public.payroll_statutory_setup_resolve(p_profile_id,p_effective_from,null);
end; $$;

-- Existing initialization signature remains compatible; the new UI passes an
-- independent statutory month rather than conflating salary date and setup month.
drop function public.payroll_initial_setup_read(uuid,date,jsonb);
create function public.payroll_initial_setup_read(p_employee_id uuid,p_date date,p_applicability jsonb,p_statutory_month date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb; context jsonb; month date:=date_trunc('month',coalesce(p_statutory_month,p_date))::date;
begin
 r:=public.payroll_statutory_setup_core(p_employee_id,null,month,p_applicability);
 if exists(select 1 from public.payroll_profiles where employee_id=p_employee_id) then
  raise exception using errcode='PT409',message='Employee Payroll setup already exists. Refresh Employees.'; end if;
 select jsonb_build_object('legal_entity_id',legal_entity_id,'workplace',workplace,'joined_date',joined_date,'pay_effective_from',p_date)
 into context from public.employees where id=p_employee_id;
 return r||jsonb_build_object('fingerprint',md5((r->>'fingerprint')||context::text));
end; $$;
drop function public.payroll_initial_setup_confirm(uuid,date,text,numeric,text,jsonb,text);
create function public.payroll_initial_setup_confirm(p_employee_id uuid,p_effective_from date,p_pay_basis text,p_rate numeric,
 p_currency text,p_applicability jsonb,p_fingerprint text,p_statutory_month date default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; profile uuid; s text; categories jsonb:='{}'; month date:=date_trunc('month',coalesce(p_statutory_month,p_effective_from))::date;
begin
 perform public.payroll_admin_actor();
 if not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
  raise exception using errcode='42501',message='Payroll initial setup scope denied.'; end if;
 perform 1 from public.employees where id=p_employee_id for update;
 r:=public.payroll_initial_setup_read(p_employee_id,p_effective_from,p_applicability,month);
 if r->>'fingerprint' is distinct from p_fingerprint then
  raise exception using errcode='PT409',message='Statutory information was updated. Refresh setup.',detail='payroll_statutory_setup_stale'; end if;
 profile:=public.payroll_profile_create(p_employee_id,p_effective_from,p_pay_basis,p_rate,p_currency,
  'Admin confirmed initial pay setup',null,null,null,null,null,null);
 foreach s in array array['epf','socso','eis'] loop categories:=categories||jsonb_build_object(s,r->'schemes'->s->>'recommendation'); end loop;
 r:=public.payroll_statutory_setup_read(profile,month,p_applicability);
 return public.payroll_statutory_setup_confirm(profile,month,p_applicability,categories,r->>'fingerprint')||jsonb_build_object('profile_id',profile);
end; $$;
revoke all on function public.payroll_initial_setup_read(uuid,date,jsonb,date),public.payroll_initial_setup_confirm(uuid,date,text,numeric,text,jsonb,text,date) from public,anon;
grant execute on function public.payroll_initial_setup_read(uuid,date,jsonb,date),public.payroll_initial_setup_confirm(uuid,date,text,numeric,text,jsonb,text,date) to authenticated;

-- Component policy is explicit configuration, not an invented default.
alter table public.payroll_component_definitions add column mid_period_policy text
 check(mid_period_policy in ('calendar_days','full_when_active','next_full_period'));

alter function public.payroll_component_save(uuid,text,text,text,text,text,text,text,boolean,text) rename to payroll_component_save_pre_period_policy;
revoke all on function public.payroll_component_save_pre_period_policy(uuid,text,text,text,text,text,text,text,boolean,text) from public,anon,authenticated;
create function public.payroll_component_save(p_component_id uuid,p_code text,p_name text,p_component_type text,
 p_epf_treatment text,p_socso_treatment text,p_eis_treatment text,p_pcb_treatment text,p_is_active boolean,p_remark text,
 p_mid_period_policy text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payroll_admin_actor(); old_policy text; v_id uuid; policy text;
begin
 if not public.current_user_has_permission('payroll.manage') or not exists(select 1 from public.employees e
  join public.roles r on r.id=e.role_id where e.id=actor and lower(r.name) in ('owner','admin')) then
  raise exception using errcode='42501',message='Payroll component settings authority required.'; end if;
 if p_mid_period_policy is not null and p_mid_period_policy not in ('calendar_days','full_when_active','next_full_period') then
  raise exception using errcode='22023',message='Choose a supported recurring-component policy.'; end if;
 select mid_period_policy into old_policy from public.payroll_component_definitions where payroll_component_definitions.id=p_component_id for update;
 policy:=coalesce(p_mid_period_policy,old_policy);
 if old_policy is distinct from policy and exists(select 1 from public.payroll_run_calculation_versions c
   join public.payroll_runs r on r.id=c.run_id where r.status in ('finalized','paid') and c.inputs->'components' @>
   jsonb_build_array(jsonb_build_object('definition',jsonb_build_object('id',p_component_id)))) then
  raise exception using errcode='55000',message='This component is used by finalized Payroll. Create a successor for a changed policy.'; end if;
 v_id:=public.payroll_component_save_pre_period_policy(p_component_id,p_code,p_name,p_component_type,p_epf_treatment,
  p_socso_treatment,p_eis_treatment,p_pcb_treatment,p_is_active,p_remark);
 if old_policy is distinct from policy then
  perform set_config('feedx.payroll_command','yes',true);
  update public.payroll_component_definitions set mid_period_policy=policy where payroll_component_definitions.id=v_id;
  insert into public.payroll_events(event_type,component_id,actor_employee_id,reason,details)
  values('component_period_policy_confirmed',v_id,actor,coalesce(nullif(btrim(p_remark),''),'Recurring component policy confirmed'),
   jsonb_build_object('previous',old_policy,'policy',policy));
 end if;
 return v_id;
end; $$;
revoke all on function public.payroll_component_save(uuid,text,text,text,text,text,text,text,boolean,text,text) from public,anon;
grant execute on function public.payroll_component_save(uuid,text,text,text,text,text,text,text,boolean,text,text) to authenticated;

create function public.payroll_recurring_period_project(p_profile_id uuid,p_component_id uuid,p_start date,p_end date,p_joined date,p_left date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.payroll_component_definitions%rowtype; assignment public.payroll_recurring_component_versions%rowtype;
 d date; total numeric:=0; days integer:=0; period_days integer:=p_end-p_start+1; amounts numeric[]:='{}'; history jsonb;
 evidence jsonb; issue text; active_versions jsonb:='[]'; latest_amount numeric; amount numeric; formula text;
begin
 select * into c from public.payroll_component_definitions where id=p_component_id;
 select coalesce(jsonb_agg(to_jsonb(v) order by effective_from),'[]') into history
 from public.payroll_recurring_component_versions v where profile_id=p_profile_id and component_id=p_component_id and effective_from<=p_end;
 evidence:=jsonb_build_object('definition',to_jsonb(c),'assignments',history,'policy',c.mid_period_policy,
  'period_start',p_start,'period_end',p_end,'employment_start',p_joined,'employment_end',p_left,'period_days',period_days);
 for d in select generate_series(p_start,p_end,interval '1 day')::date loop
  if d<coalesce(p_joined,p_start) or d>coalesce(p_left,p_end) then continue; end if;
  select * into assignment from public.payroll_recurring_component_versions where profile_id=p_profile_id
    and component_id=p_component_id and effective_from<=d order by effective_from desc limit 1;
  if assignment.id is null or not assignment.is_active then continue; end if;
  days:=days+1; total:=total+assignment.amount; latest_amount:=assignment.amount;
  if not assignment.amount=any(amounts) then amounts:=array_append(amounts,assignment.amount); end if;
  if not active_versions @> jsonb_build_array(assignment.id) then active_versions:=active_versions||jsonb_build_array(assignment.id); end if;
 end loop;
 evidence:=evidence||jsonb_build_object('active_days',days,'active_version_ids',active_versions);
 if days=0 then return jsonb_build_object('evidence',evidence,'line',null); end if;
 if c.mid_period_policy is null then issue:='component_proration_policy_required:'||c.id;
 elsif c.mid_period_policy='calendar_days' then
  amount:=round(total/period_days,2); formula:='Sum of effective daily component amounts / calendar days in payroll period';
 elsif c.mid_period_policy='full_when_active' then
  if cardinality(amounts)>1 then issue:='component_multiple_amounts_requires_review:'||c.id;
  else amount:=latest_amount; formula:='Full amount when active in eligible period'; end if;
 else
  select * into assignment from public.payroll_recurring_component_versions where profile_id=p_profile_id
    and component_id=p_component_id and effective_from<=p_start order by effective_from desc limit 1;
  amount:=case when coalesce(p_joined,p_start)<=p_start and coalesce(p_left,p_end)>=p_end
    and assignment.is_active then assignment.amount else 0 end;
  formula:='Assignment effective at start of full eligible payroll period; changes start next full period';
 end if;
 return jsonb_build_object('evidence',evidence,'issue',issue,'line',case when issue is not null then null else
  jsonb_build_object('kind',case c.component_type when 'deduction' then 'deduction' when 'reimbursement' then 'reimbursement' else 'earning' end,
   'code',c.code,'label',c.name,'amount',amount,'source',jsonb_build_object('component_definition_id',c.id,
    'recurring_period',evidence,'formula',formula,'daily_amount_sum',total)) end);
end; $$;
revoke all on function public.payroll_recurring_period_project(uuid,uuid,date,date,date,date) from public,anon,authenticated;

-- Replace only recurring pricing inside the sole canonical projection.
do $migration$
declare definition text; start_at integer; end_at integer;
begin
 definition:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'v_issues:=array_append(v_issues,''missing_effective_compensation_or_proration_policy'');',
  'v_issues:=array_append(v_issues,''pay_history_missing:''||greatest(v_period.period_start,coalesce(v_employee.joined_date,v_period.period_start))::text||''..''||least(v_period.period_end,coalesce((select min(effective_from)-1 from public.payroll_compensation_versions where profile_id=v_profile.id and effective_from>greatest(v_period.period_start,coalesce(v_employee.joined_date,v_period.period_start))),v_period.period_end))::text);');
 start_at:=strpos(definition,'    -- Fixed recurring components');
 end_at:=strpos(definition,E'  for v_adjustment in');
 if start_at=0 or end_at=0 then raise exception 'Recurring projection anchor changed'; end if;
 definition:=left(definition,start_at-1)||$body$
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

$body$||substr(definition,end_at);
 execute definition;
end; $migration$;
