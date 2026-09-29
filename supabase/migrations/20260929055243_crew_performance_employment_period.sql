-- Performance consumes People assignment history. One monthly result cannot
-- safely represent two different employment identities, so mixed periods wait
-- for review instead of choosing the current or month-end Employee row.
create function public.crew_performance_period_employment(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee public.employees%rowtype;
  v_revision public.employee_employment_assignment_revisions%rowtype;
  v_start date:=date_trunc('month',p_period)::date;
  v_end date:=(date_trunc('month',p_period)+interval '1 month'-interval '1 day')::date;
  v_day date; v_first boolean:=true; v_outlet uuid; v_day_outlet uuid;
  v_position text; v_workplace text; v_status text; v_type text;
  v_revisions jsonb:='[]'::jsonb;
begin
  if p_employee_id is null or p_period is null then
    return jsonb_build_object('state','unresolved','reason','Employment history is unavailable for this period.');
  end if;
  select * into v_employee from public.employees where id=p_employee_id;
  if v_employee.id is null or v_employee.joined_date is null then
    return jsonb_build_object('state','unresolved','reason','Joined Date or employment history is missing.');
  end if;
  v_start:=greatest(v_start,v_employee.joined_date);
  v_end:=least(v_end,coalesce(v_employee.resigned_date,v_end));
  if v_start>v_end then
    return jsonb_build_object('state','ineligible','reason','Outside the employment period.');
  end if;
  for v_day in select generate_series(v_start,v_end,interval '1 day')::date loop
    v_revision:=public.employee_employment_assignment_at(p_employee_id,v_day);
    if v_revision.id is null then
      return jsonb_build_object('state','unresolved','reason',
        format('Employment history is unverified from %s.',to_char(v_day,'DD Mon YYYY')),
        'unresolved_from',v_day);
    end if;
    if nullif(btrim(coalesce(v_revision.position,'')),'') is null
      or nullif(btrim(coalesce(v_revision.workplace,'')),'') is null
      or v_revision.employment_status is null or v_revision.employment_type is null then
      return jsonb_build_object('state','unresolved','reason','Employment assignment is incomplete for this period.');
    end if;
    select case when count(*)=1 then (array_agg(o.id))[1] else null end into v_day_outlet
    from public.outlets o where lower(btrim(v_revision.workplace)) in
      (lower(btrim(o.name)),lower(btrim(coalesce(o.code,''))));
    if v_first then
      v_first:=false; v_position:=v_revision.position; v_workplace:=v_revision.workplace;
      v_status:=v_revision.employment_status; v_type:=v_revision.employment_type;
      v_outlet:=v_day_outlet;
    elsif (v_position,v_workplace,v_status,v_type,v_outlet) is distinct from
      (v_revision.position,v_revision.workplace,v_revision.employment_status,
        v_revision.employment_type,v_day_outlet) then
      return jsonb_build_object('state','mixed','reason',
        'Employment assignment changed during this Performance month; review is required.',
        'change_date',v_day);
    end if;
    if not v_revisions ? v_revision.id::text then
      v_revisions:=v_revisions||to_jsonb(v_revision.id::text);
    end if;
  end loop;
  return jsonb_build_object('state',case when v_status='active'
      and lower(btrim(v_position))='service crew' and v_outlet is not null
      then 'eligible' else 'ineligible' end,
    'reason',case when v_status<>'active' then 'Employment status is not active for this period.'
      when lower(btrim(v_position))<>'service crew' then 'Position is not Service Crew for this period.'
      when v_outlet is null then 'Workplace is not a verified Restaurant outlet for this period.'
      else null end,
    'outlet_id',v_outlet,'position',v_position,'workplace',v_workplace,
    'employment_status',v_status,'employment_type',v_type,
    'active_from',v_start,'active_through',v_end,'revision_ids',v_revisions);
end $$;
revoke all on function public.crew_performance_period_employment(uuid,date) from public,anon,authenticated;

create function public.crew_performance_employment_needs_review(
  p_result public.crew_performance_results,p_employment jsonb)
returns boolean language sql stable security definer set search_path=public as $$
  select p_result.status<>'finalized' and
    (p_employment->>'state' is distinct from 'eligible'
      or p_result.components->'employment' is distinct from p_employment);
$$;
revoke all on function public.crew_performance_employment_needs_review(public.crew_performance_results,jsonb)
  from public,anon,authenticated;

create or replace function public.crew_performance_model(p_employee_id uuid,p_period date)
returns text language sql stable security definer set search_path=public as $$
  select case when public.crew_performance_period_employment(p_employee_id,p_period)->>'state'='eligible'
    then 'performance-v2' else null end;
$$;
revoke all on function public.crew_performance_model(uuid,date) from public,anon,authenticated;

-- Growth keeps its live skill workflow. Performance only substitutes the
-- verified period Position/Outlet when selecting relevant skill evidence.
create function public.crew_performance_period_skill_applicable(
  p_skill_id uuid,p_outlet_id uuid,p_position text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.crew_skills s
    where s.id=p_skill_id and s.status='active' and s.outlet_id=p_outlet_id
      and (not exists(select 1 from public.crew_skill_positions sp where sp.skill_id=s.id)
        or exists(select 1 from public.crew_skill_positions sp where sp.skill_id=s.id
          and lower(btrim(sp.position))=lower(btrim(p_position))))
      and (not exists(select 1 from public.crew_skill_outlets so where so.skill_id=s.id)
        or exists(select 1 from public.crew_skill_outlets so where so.skill_id=s.id
          and so.outlet_id=p_outlet_id)));
$$;
revoke all on function public.crew_performance_period_skill_applicable(uuid,uuid,text)
  from public,anon,authenticated;

create or replace function public.crew_performance_knowledge_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare onboarding_ratio numeric:=0; sop_ratio numeric:=0; quiz_ratio numeric:=0;
  growth_ratio numeric:=0; total_required int:=0; total_done int:=0; score numeric;
  rec record; v_employment jsonb:=public.crew_performance_period_employment(p_employee_id,p_period);
begin
 if v_employment->>'state'<>'eligible' then
   return jsonb_build_object('score',null,'max_score',15,'status','review_required',
     'explanation','Employment assignment needs review before this month can be assessed.');
 end if;
 select coalesce(max(case when a.status='completed' then 1 else coalesce(
   (select count(*) filter(where lp.status='completed')::numeric/nullif(count(*),0)
    from public.crew_lesson_progress lp where lp.assignment_id=a.id),0) end),0)
 into onboarding_ratio from public.crew_journey_assignments a
 join public.crew_journeys j on j.id=a.journey_id
 where a.employee_id=p_employee_id and j.is_mandatory_onboarding;
 select count(distinct (block->'payload'->>'sop_version_id')),
   count(distinct (block->'payload'->>'sop_version_id')) filter(where exists(
     select 1 from public.crew_sop_acknowledgements sa where sa.employee_id=p_employee_id
       and sa.sop_version_id=(block->'payload'->>'sop_version_id')::uuid))
 into total_required,total_done from public.crew_journey_assignments a
 cross join lateral jsonb_path_query(a.journey_snapshot,
   '$.modules[*].lessons[*].blocks[*] ? (@.block_type == "sop_reference" && @.payload.required_acknowledgement == true)') block
 where a.employee_id=p_employee_id;
 sop_ratio:=case when total_required=0 then 1 else total_done::numeric/total_required end;
 select coalesce(count(distinct quiz_id) filter(where passed)::numeric/nullif(count(distinct quiz_id),0),0)
 into quiz_ratio from public.crew_quiz_attempts where employee_id=p_employee_id
   and completed_at<(date_trunc('month',p_period)::date+interval '1 month');
 total_required:=0; total_done:=0;
 for rec in select s.id from public.crew_skills s where s.status='active'
   and public.crew_performance_period_skill_applicable(s.id,(v_employment->>'outlet_id')::uuid,
     v_employment->>'position') loop
   total_required:=total_required+coalesce(
     (public.crew_growth_employee_skill(p_employee_id,rec.id)->>'requirements_total')::int,0);
   total_done:=total_done+coalesce(
     (public.crew_growth_employee_skill(p_employee_id,rec.id)->>'requirements_completed')::int,0);
 end loop;
 growth_ratio:=case when total_required=0 then 1 else least(1,total_done::numeric/total_required) end;
 score:=round(least(15,6*onboarding_ratio+3.75*sop_ratio+3.75*quiz_ratio+1.5*growth_ratio),2);
 return jsonb_build_object('score',score,'max_score',15,'status','calculated',
   'explanation','Knowledge uses durable onboarding, pinned SOP acknowledgements, passed quizzes and Growth learning evidence; completed historical onboarding remains valid.',
   'evidence',jsonb_build_object('onboarding_ratio',round(onboarding_ratio,3),
     'sop_ratio',round(sop_ratio,3),'quiz_ratio',round(quiz_ratio,3),
     'growth_ratio',round(growth_ratio,3)),'calculation_version','performance-v2');
end $$;
revoke all on function public.crew_performance_knowledge_component(uuid,date)
  from public,anon,authenticated;

create function public.crew_refresh_performance(p_employee_id uuid,p_period date,p_confirm_employment boolean)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; v_employment jsonb;
  outlet uuid; attendance jsonb; knowledge jsonb; peer_review jsonb;
  service_review public.crew_performance_reviews%rowtype;
  v_existing public.crew_performance_results%rowtype;
  result_id uuid; current_total numeric; v_components jsonb;
begin
  select * into v_existing from public.crew_performance_results
    where employee_id=p_employee_id and period_start=period;
  if v_existing.status='finalized' then return v_existing.id; end if;
  v_employment:=public.crew_performance_period_employment(p_employee_id,period);
  if v_employment->>'state'<>'eligible' then return v_existing.id; end if;
  if v_existing.id is not null and not p_confirm_employment
    and public.crew_performance_employment_needs_review(v_existing,v_employment) then
    return v_existing.id;
  end if;
  outlet:=(v_employment->>'outlet_id')::uuid;
  if outlet is null then return v_existing.id; end if;
  attendance:=public.crew_performance_attendance_component(p_employee_id,period);
  knowledge:=public.crew_performance_knowledge_component(p_employee_id,period);
  -- Production retains Peer Review. A subject created under a different outlet
  -- cannot supply the period-correct Performance component.
  if exists(select 1 from public.crew_peer_review_subjects prs
    where prs.employee_id=p_employee_id and prs.period_start=period
      and prs.outlet_id is distinct from outlet) then
    peer_review:=jsonb_build_object('score',null,'max_score',5,'status','pending',
      'reason','employment_outlet_review_required');
  else
    peer_review:=public.crew_peer_review_component(p_employee_id,period);
  end if;
  select * into service_review from public.crew_performance_reviews
    where employee_id=p_employee_id and period_start=period and component='service'
      and outlet_id=outlet order by reviewed_at desc limit 1;
  current_total:=round(coalesce((attendance->>'score')::numeric,0)
    +coalesce(service_review.score,0)+coalesce((knowledge->>'score')::numeric,0)
    +coalesce((peer_review->>'score')::numeric,0),2);
  v_components:=jsonb_build_object('employment',v_employment,'attendance',attendance,
    'service',case when service_review.id is null then
      jsonb_build_object('score',null,'max_score',30,'status','review_required')
      else jsonb_build_object('score',service_review.score,'max_score',30,'status','reviewed',
        'criteria',service_review.criteria,'reviewed_at',service_review.reviewed_at,
        'calculation_version',service_review.calculation_version) end,
    'customer',jsonb_build_object('score',null,'max_score',20,'status','pending',
      'reason','google_review_authority_not_available','calculation_version','performance-v2'),
    'knowledge',knowledge,'peer',peer_review);
  insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,
    calculation_version,attendance_score,service_score,customer_score,knowledge_score,
    conduct_score,peer_score,current_score,total_score,components,computed_at)
  values(p_employee_id,outlet,period,'review_required','performance-v2',
    (attendance->>'score')::numeric,service_review.score,null,(knowledge->>'score')::numeric,
    null,(peer_review->>'score')::numeric,current_total,null,v_components,now())
  on conflict(employee_id,period_start) do update set outlet_id=excluded.outlet_id,
    status=excluded.status,calculation_version='performance-v2',
    attendance_score=excluded.attendance_score,service_score=excluded.service_score,
    customer_score=null,knowledge_score=excluded.knowledge_score,conduct_score=null,
    peer_score=excluded.peer_score,current_score=excluded.current_score,total_score=null,
    components=excluded.components,computed_at=now()
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.crew_refresh_performance(uuid,date,boolean) from public,anon,authenticated;

create or replace function public.crew_refresh_performance(p_employee_id uuid,p_period date)
returns uuid language sql volatile security definer set search_path=public as $$
  select public.crew_refresh_performance(p_employee_id,p_period,false);
$$;
revoke all on function public.crew_refresh_performance(uuid,date) from public,anon,authenticated;

create function public.crew_performance_recalculate_employment(
  p_employee_id uuid,p_period date,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_employment jsonb;
  v_existing public.crew_performance_results%rowtype; v_result uuid;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_performance.review') then
    raise exception using errcode='42501',message='Performance review permission is required.';
  end if;
  if length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>500 then
    raise exception using errcode='22023',message='A reason is required to recalculate Performance.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text||':'||v_period::text,0));
  select * into v_existing from public.crew_performance_results
    where employee_id=p_employee_id and period_start=v_period for update;
  if v_existing.id is null or v_existing.status='finalized' then
    raise exception using errcode='22023',message='Only an open Performance result may be recalculated.';
  end if;
  v_employment:=public.crew_performance_period_employment(p_employee_id,v_period);
  if v_employment->>'state'<>'eligible' then
    raise exception using errcode='22023',message=coalesce(v_employment->>'reason',
      'Employment assignment needs review for this period.');
  end if;
  if not public.current_user_can_access_outlet((v_employment->>'outlet_id')::uuid)
    or not public.current_user_can_access_outlet(v_existing.outlet_id) then
    raise exception using errcode='42501',message='Performance is outside your outlet scope.';
  end if;
  v_result:=public.crew_refresh_performance(p_employee_id,v_period,true);
  insert into public.audit_logs(action,module,user_id,description,metadata)
  values('crew_performance_employment_recalculated','crew_performance',auth.uid(),
    'Open Performance recalculated after employment review.',
    jsonb_build_object('employee_id',p_employee_id,'period',v_period,
      'previous_outlet_id',v_existing.outlet_id,'current_outlet_id',v_employment->>'outlet_id',
      'previous_revision_ids',v_existing.components->'employment'->'revision_ids',
      'current_revision_ids',v_employment->'revision_ids','reason',btrim(p_reason)));
  return jsonb_build_object('result_id',v_result,'status','review_required');
end $$;
revoke all on function public.crew_performance_recalculate_employment(uuid,date,text)
  from public,anon,authenticated;
grant execute on function public.crew_performance_recalculate_employment(uuid,date,text)
  to authenticated;

create or replace function public.crew_performance_submit_review(
  p_employee_id uuid,p_period date,p_component text,p_criteria jsonb,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; outlet uuid; calc jsonb;
  review_id uuid; result_id uuid; v_employment jsonb;
  v_existing public.crew_performance_results%rowtype;
begin
  if not public.current_user_has_permission('crew_performance.review') then
    raise exception using errcode='42501',message='Performance review permission is required.';
  end if;
  v_employment:=public.crew_performance_period_employment(p_employee_id,period);
  if v_employment->>'state'<>'eligible' then
    raise exception using errcode='22023',message=coalesce(v_employment->>'reason',
      'Employment assignment needs review for this period.');
  end if;
  outlet:=(v_employment->>'outlet_id')::uuid;
  if not public.current_user_can_access_outlet(outlet) then
    raise exception using errcode='42501',message='Crew member is outside your outlet scope.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text||':'||period::text,0));
  select * into v_existing from public.crew_performance_results
    where employee_id=p_employee_id and period_start=period;
  if v_existing.status='finalized' then
    raise exception using errcode='22023',message='Finalized Performance cannot receive new review evidence.';
  end if;
  if v_existing.id is not null and
    public.crew_performance_employment_needs_review(v_existing,v_employment) then
    raise exception using errcode='22023',message=
      'Review the changed employment assignment and recalculate Performance first.';
  end if;
  if char_length(coalesce(p_note,''))>1000 then
    raise exception using errcode='22023',message='Review note is too long.';
  end if;
  calc:=public.crew_performance_review_score(p_component,p_criteria);
  insert into public.crew_performance_reviews(employee_id,outlet_id,period_start,component,
    criteria,score,max_score,calculation_version,manager_note,reviewed_by)
  values(p_employee_id,outlet,period,p_component,p_criteria,(calc->>'score')::numeric,30,
    'service-standards-v2',nullif(btrim(p_note),''),auth.uid()) returning id into review_id;
  result_id:=public.crew_refresh_performance(p_employee_id,period);
  return jsonb_build_object('review_id',review_id,'result_id',result_id,'component','service',
    'score',(calc->>'score')::numeric,'max_score',30,'reviewed_at',now());
end $$;
revoke all on function public.crew_performance_submit_review(uuid,date,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.crew_performance_submit_review(uuid,date,text,jsonb,text)
  to authenticated;

create function public.crew_performance_period_result_projection(
  p_result public.crew_performance_results,p_employment jsonb,p_can_review boolean)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_pending boolean:=false; v_components jsonb;
begin
  v_pending:=public.crew_performance_employment_needs_review(p_result,p_employment);
  if v_pending then
    v_components:=jsonb_build_object('employment',jsonb_build_object(
      'status','review_required','reason',case when p_employment->>'state'='eligible'
        then 'Employment history changed. Review and recalculate this open Performance period.'
        else coalesce(p_employment->>'reason','Employment history needs review.') end),
      'attendance',jsonb_build_object('score',null,'max_score',30,'status','review_required'),
      'service',jsonb_build_object('score',null,'max_score',30,'status','review_required'),
      'customer',jsonb_build_object('score',null,'max_score',20,'status','pending'),
      'knowledge',jsonb_build_object('score',null,'max_score',15,'status','review_required'),
      'peer',jsonb_build_object('score',null,'max_score',5,'status','review_required'));
  else
    v_components:=p_result.components;
    if not p_can_review then
      v_components:=jsonb_set(v_components,'{service}',
        coalesce(v_components->'service','{}'::jsonb)-'manager_note'-'criteria');
    end if;
  end if;
  return jsonb_build_object('id',p_result.id,
    'status',case when v_pending then 'review_required' else p_result.status end,
    'period_start',p_result.period_start,
    'current_score',case when v_pending then null else p_result.current_score end,
    'total_score',case when v_pending then null else p_result.total_score end,
    'attendance_score',case when v_pending then null else p_result.attendance_score end,
    'service_score',case when v_pending then null else p_result.service_score end,
    'customer_score',case when v_pending then null else p_result.customer_score end,
    'knowledge_score',case when v_pending then null else p_result.knowledge_score end,
    'peer_score',case when v_pending then null else p_result.peer_score end,
    'employment_review_required',v_pending,'employment_can_recalculate',
      v_pending and p_employment->>'state'='eligible' and p_result.status<>'finalized',
    'employment_reason',case when v_pending then v_components->'employment'->>'reason' else null end,
    'components',v_components,'calculation_version',p_result.calculation_version,
    'computed_at',p_result.computed_at,'finalized_at',p_result.finalized_at);
end $$;
revoke all on function public.crew_performance_period_result_projection(
  public.crew_performance_results,jsonb,boolean) from public,anon,authenticated;

create or replace function public.crew_performance_admin_data(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; employee record;
  v_result public.crew_performance_results%rowtype; v_employment jsonb;
  v_row jsonb; rows jsonb:='[]'::jsonb; review_rows jsonb:='[]'::jsonb;
  summary jsonb:='{}'::jsonb; can_performance boolean:=public.current_user_has_permission('crew_performance.view');
  can_review boolean:=public.current_user_has_permission('crew_performance.review');
begin
  if p_outlet_id is null or not (can_performance or can_review)
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Performance is unavailable for this outlet.';
  end if;
  if can_performance then
    for employee in
      select e.id,e.full_name,e.employee_code from public.employees e where
        exists(select 1 from public.employee_employment_assignment_revisions a
          join public.outlets o on o.id=p_outlet_id
          where a.employee_id=e.id and a.effective_from<(period+interval '1 month')::date
            and lower(btrim(coalesce(a.workplace,''))) in
              (lower(btrim(o.name)),lower(btrim(coalesce(o.code,''))))
            and not exists(select 1 from public.employee_employment_assignment_revisions newer
              where newer.supersedes_revision_id=a.id))
        or exists(select 1 from public.crew_performance_results r
          where r.employee_id=e.id and r.outlet_id=p_outlet_id and r.period_start=period)
        or exists(select 1 from public.crew_performance_reviews v
          where v.employee_id=e.id and v.outlet_id=p_outlet_id and v.period_start=period)
      order by e.full_name,e.id
    loop
      v_employment:=public.crew_performance_period_employment(employee.id,period);
      select * into v_result from public.crew_performance_results
        where employee_id=employee.id and period_start=period;
      if v_result.status='finalized' then
        if v_result.outlet_id<>p_outlet_id then continue; end if;
      elsif v_result.id is not null and v_result.outlet_id<>p_outlet_id then
        continue; -- a changed outlet remains in its old review queue until confirmed
      elsif v_employment->>'state'='eligible'
        and (v_employment->>'outlet_id')::uuid=p_outlet_id then
        perform public.crew_refresh_performance(employee.id,period);
        select * into v_result from public.crew_performance_results
          where employee_id=employee.id and period_start=period;
      elsif v_result.id is null then
        continue; -- no outlet evidence exists for unresolved/ineligible history
      end if;
      v_row:=jsonb_build_object('employee',jsonb_build_object('id',employee.id,
        'full_name',employee.full_name,'employee_code',employee.employee_code,
        'position',case when v_result.status='finalized'
          then v_result.components->'employment'->>'position'
          else v_employment->>'position' end),
        'result',public.crew_performance_period_result_projection(v_result,v_employment,can_review));
      rows:=rows||jsonb_build_array(v_row);
    end loop;
    select jsonb_build_object(
      'average_score',round(avg((value->'result'->>'total_score')::numeric)
        filter(where value->'result'->>'total_score' is not null),1),
      'reviewed',count(*) filter(where value->'result'->'components'->'service'->>'status'='reviewed'
        and jsonb_typeof(value->'result'->'components'->'peer'->'score')='number'
        and value->'result'->>'employment_review_required'='false'),
      'awaiting_review',count(*) filter(where value->'result'->'components'->'service'->>'status' is distinct from 'reviewed'
        or jsonb_typeof(value->'result'->'components'->'peer'->'score') is distinct from 'number'
        or value->'result'->>'employment_review_required'='true'),
      'crew_total',count(*)) into summary from jsonb_array_elements(rows);
  end if;
  if can_review then
    select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,
      'employee_name',e.full_name,'position',
        public.crew_performance_period_employment(v.employee_id,period)->>'position',
      'component',v.component,'criteria',v.criteria,'score',v.score,
      'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at)
      order by v.reviewed_at desc),'[]'::jsonb) into review_rows
    from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id
    where v.outlet_id=p_outlet_id and v.period_start=period and v.component='service';
  end if;
  return jsonb_build_object('period_start',period,'period',period,'summary',summary,
    'scoring_framework',case when can_performance then jsonb_build_array(
      jsonb_build_object('key','attendance','label','Attendance','max_score',30),
      jsonb_build_object('key','service','label','Service','max_score',30),
      jsonb_build_object('key','customer','label','Customer','max_score',20),
      jsonb_build_object('key','knowledge','label','Knowledge','max_score',15),
      jsonb_build_object('key','peer','label','Peer Review','max_score',5)) else '[]'::jsonb end,
    'crew',rows,'reviews',review_rows);
end $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;

create or replace function public.crew_performance_mobile(p_token text,p_period date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid:=public.crew_session_employee(p_token); result_id uuid;
  result public.crew_performance_results%rowtype; trend jsonb; safe_components jsonb;
  scored_components integer; pending_names jsonb; v_employment jsonb; v_pending boolean:=false;
begin
  result_id:=public.crew_refresh_performance(employee,p_period);
  v_employment:=public.crew_performance_period_employment(employee,p_period);
  if result_id is not null then
    select * into result from public.crew_performance_results where id=result_id;
    v_pending:=public.crew_performance_employment_needs_review(result,v_employment);
  elsif v_employment->>'state' not in ('unresolved','mixed') then
    return null;
  else
    v_pending:=true;
  end if;
  if v_pending then
    safe_components:=jsonb_build_object(
      'attendance',jsonb_build_object('score',null,'max_score',30,'status','review_required'),
      'service',jsonb_build_object('score',null,'max_score',30,'status','review_required'),
      'customer',jsonb_build_object('score',null,'max_score',20,'status','pending'),
      'knowledge',jsonb_build_object('score',null,'max_score',15,'status','review_required'),
      'peer',jsonb_build_object('score',null,'max_score',5,'status','review_required'));
  else
    safe_components:=jsonb_build_object('attendance',result.components->'attendance',
      'service',(result.components->'service')-'manager_note',
      'customer',result.components->'customer',
      'knowledge',result.components->'knowledge','peer',result.components->'peer');
  end if;
  select count(*) filter(where jsonb_typeof(value->'score')='number')::integer,
    coalesce(jsonb_agg(key order by key) filter(where jsonb_typeof(value->'score') is distinct from 'number'),'[]'::jsonb)
    into scored_components,pending_names from jsonb_each(safe_components);
  select coalesce(jsonb_agg(jsonb_build_object('period_start',period_start,'score',total_score,
    'status',status) order by period_start),'[]'::jsonb) into trend
    from (select period_start,total_score,status from public.crew_performance_results
      where employee_id=employee order by period_start desc limit 6) x;
  return jsonb_build_object('period_start',date_trunc('month',p_period)::date,
    'status',case when v_pending then 'review_required' else result.status end,
    'score',case when v_pending then null when scored_components>0 then result.current_score else null end,
    'current_score',case when v_pending then null else result.current_score end,
    'total_score',case when v_pending then null else result.total_score end,
    'score_state',case when v_pending then 'unavailable' when scored_components>0 then 'partial' else 'unavailable' end,
    'scored_components',scored_components,'pending_components',5-scored_components,
    'pending_component_names',pending_names,'total_components',5,
    'calculation_version','performance-v2','breakdown',safe_components,
    'trend',trend,'updated_at',result.computed_at);
end $$;
revoke all on function public.crew_performance_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_performance_mobile(text,date) to anon,authenticated;

create or replace function public.crew_performance_finalize(p_employee_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employment jsonb;
begin
  if not public.current_user_has_permission('crew_performance.finalize') then
    raise exception using errcode='42501',message='Performance finalization permission is required.';
  end if;
  v_employment:=public.crew_performance_period_employment(p_employee_id,p_period);
  if v_employment->>'state'<>'eligible' then
    raise exception using errcode='22023',message=coalesce(v_employment->>'reason',
      'Employment assignment needs review for this period.');
  end if;
  if not public.current_user_can_access_outlet((v_employment->>'outlet_id')::uuid) then
    raise exception using errcode='42501',message='Crew member is outside your outlet scope.';
  end if;
  raise exception using errcode='22023',
    message='Google Customer evidence is pending; Performance cannot be finalized.';
end $$;
revoke all on function public.crew_performance_finalize(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_finalize(uuid,date) to authenticated;
