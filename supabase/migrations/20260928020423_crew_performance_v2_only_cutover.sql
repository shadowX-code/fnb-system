-- Retire only V1 Performance and its dependent QA Reward cycle. Independent
-- Customer Feedback and unrelated Reward cycles remain untouched.
begin;

create temporary table v1_reward_cycles on commit drop as
select distinct c.id from public.crew_reward_cycles c
join public.crew_reward_entries e on e.cycle_id = c.id
join public.crew_performance_results r on r.id = e.performance_result_id
where r.calculation_version = 'performance-v1';

do $$
declare v_cycle record;
begin
  for v_cycle in
    select distinct c.id, c.status, c.paid_at
    from public.crew_reward_cycles c
    join public.crew_reward_entries e on e.cycle_id = c.id
    join public.crew_performance_results r on r.id = e.performance_result_id
    where c.id in (select id from v1_reward_cycles)
  loop
    if v_cycle.paid_at is not null or v_cycle.status = 'paid' or exists (
      select 1 from public.crew_reward_entries e
      where e.cycle_id = v_cycle.id and e.employee_name not like 'QA Crew - %'
    ) or exists (
      select 1 from public.crew_reward_adjustments a where a.cycle_id = v_cycle.id
    ) then
      raise exception using errcode = '55000',
        message = 'V1 Performance has a non-QA or paid Reward dependency; cutover stopped.';
    end if;
  end loop;
end; $$;

alter table public.crew_reward_entries disable trigger crew_reward_entry_immutable;
alter table public.crew_reward_cycles disable trigger crew_reward_cycle_immutable;
alter table public.crew_performance_results disable trigger crew_performance_result_immutable;

delete from public.crew_reward_participants where cycle_id in (select id from v1_reward_cycles);
delete from public.crew_reward_entries where cycle_id in (select id from v1_reward_cycles);
delete from public.crew_reward_cycles where id in (select id from v1_reward_cycles);
delete from public.crew_performance_reviews v
using public.crew_performance_results r
where v.employee_id=r.employee_id and v.period_start=r.period_start
  and r.calculation_version='performance-v1';
delete from public.crew_performance_results where calculation_version = 'performance-v1';

alter table public.crew_performance_results enable trigger crew_performance_result_immutable;
alter table public.crew_reward_cycles enable trigger crew_reward_cycle_immutable;
alter table public.crew_reward_entries enable trigger crew_reward_entry_immutable;

alter table public.crew_performance_results alter column calculation_version set default 'performance-v2';
alter table public.crew_performance_results drop constraint crew_performance_customer_model_check;
alter table public.crew_performance_results add constraint crew_performance_v2_only_check check (
  calculation_version = 'performance-v2' and (customer_score is null or customer_score between 0 and 20)
  and conduct_score is null and (status <> 'finalized' or total_score is not null)
);
alter table public.crew_performance_reviews drop constraint crew_performance_reviews_component_check;
alter table public.crew_performance_reviews drop constraint crew_performance_reviews_max_score_check;
alter table public.crew_performance_reviews add constraint crew_performance_reviews_service_only_check
  check (component = 'service' and max_score = 30);
alter table public.crew_performance_reviews alter column calculation_version set default 'service-standards-v2';

create or replace function public.crew_performance_model(p_employee_id uuid, p_period date)
returns text language sql stable security definer set search_path=public as $$
  select case when lower(btrim(e.position)) = 'service crew'
    and e.is_active and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and ca.primary_outlet_id is not null
    then 'performance-v2' else null end
  from public.employees e join public.crew_access ca on ca.employee_id = e.id
  where e.id = p_employee_id;
$$;
revoke all on function public.crew_performance_model(uuid, date) from public, anon, authenticated;

create or replace function public.crew_performance_review_score(p_component text,p_criteria jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare required_keys text[] := array['welcome_greeting','thank_you_goodbye','grooming','work_area_cleanliness','guest_interaction'];
  item jsonb; k text; seen text[] := '{}'; observed integer := 0; earned numeric := 0; rating text;
begin
  if p_component <> 'service' then
    raise exception using errcode='22023', message='Only Service Standards can be reviewed.';
  end if;
  if jsonb_typeof(p_criteria) <> 'array' or jsonb_array_length(p_criteria) <> cardinality(required_keys) then
    raise exception using errcode='22023', message='Every Service criterion is required.';
  end if;
  for item in select value from jsonb_array_elements(p_criteria) loop
    if jsonb_typeof(item) <> 'object' or not (item ? 'key') or not (item ? 'rating')
      or item ?| array['score','points','is_correct'] then
      raise exception using errcode='22023', message='Review criteria payload is invalid.';
    end if;
    k := item->>'key'; rating := item->>'rating';
    if not (k = any(required_keys)) or k = any(seen) then
      raise exception using errcode='22023', message='Review criteria contain an unknown or duplicate item.';
    end if;
    if rating not in ('meets_standard','needs_improvement','not_observed') then
      raise exception using errcode='22023', message='Review rating is invalid.';
    end if;
    seen := array_append(seen,k);
    if rating <> 'not_observed' then
      observed := observed + 1;
      earned := earned + case rating when 'meets_standard' then 1 else 0.5 end;
    end if;
  end loop;
  if observed = 0 then
    raise exception using errcode='22023', message='At least one criterion must be observed.';
  end if;
  return jsonb_build_object('score',round(30 * earned / observed,2),'max_score',30,
    'observed_count',observed,'criteria_count',cardinality(required_keys),
    'calculation_version','service-standards-v2');
end; $$;
revoke all on function public.crew_performance_review_score(text,jsonb) from public,anon,authenticated;

create or replace function public.crew_performance_submit_review(p_employee_id uuid,p_period date,p_component text,p_criteria jsonb,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date := date_trunc('month',p_period)::date; outlet uuid; calc jsonb; review_id uuid; result_id uuid;
begin
  if not public.current_user_has_permission('crew_performance.review') then
    raise exception using errcode='42501', message='Performance review permission is required.';
  end if;
  if public.crew_performance_model(p_employee_id,period) is distinct from 'performance-v2' then
    raise exception using errcode='22023', message='Performance is available to active Service Crew only.';
  end if;
  outlet := public.crew_growth_employee_outlet(p_employee_id);
  if outlet is null or not public.current_user_can_access_outlet(outlet) then
    raise exception using errcode='42501', message='Crew member is outside your outlet scope.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || period::text,0));
  if exists(select 1 from public.crew_performance_results
      where employee_id=p_employee_id and period_start=period and status='finalized') then
    raise exception using errcode='22023', message='Finalized Performance cannot receive new review evidence.';
  end if;
  if char_length(coalesce(p_note,'')) > 1000 then
    raise exception using errcode='22023', message='Review note is too long.';
  end if;
  calc := public.crew_performance_review_score(p_component,p_criteria);
  insert into public.crew_performance_reviews(employee_id,outlet_id,period_start,component,criteria,score,max_score,calculation_version,manager_note,reviewed_by)
  values(p_employee_id,outlet,period,p_component,p_criteria,(calc->>'score')::numeric,30,
    'service-standards-v2',nullif(btrim(p_note),''),auth.uid()) returning id into review_id;
  result_id := public.crew_refresh_performance(p_employee_id,period);
  return jsonb_build_object('review_id',review_id,'result_id',result_id,'component','service',
    'score',(calc->>'score')::numeric,'max_score',30,'reviewed_at',now());
end; $$;
revoke all on function public.crew_performance_submit_review(uuid,date,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crew_performance_submit_review(uuid,date,text,jsonb,text) to authenticated;

create or replace function public.crew_performance_knowledge_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare onboarding_ratio numeric:=0; sop_ratio numeric:=0; quiz_ratio numeric:=0; growth_ratio numeric:=0; total_required int:=0; total_done int:=0; score numeric; rec record;
begin
 select coalesce(max(case when a.status='completed' then 1 else coalesce((select count(*) filter(where lp.status='completed')::numeric/nullif(count(*),0) from public.crew_lesson_progress lp where lp.assignment_id=a.id),0) end),0)
 into onboarding_ratio from public.crew_journey_assignments a join public.crew_journeys j on j.id=a.journey_id where a.employee_id=p_employee_id and j.is_mandatory_onboarding;
 select count(distinct (block->'payload'->>'sop_version_id')),
 count(distinct (block->'payload'->>'sop_version_id')) filter(where exists(select 1 from public.crew_sop_acknowledgements sa where sa.employee_id=p_employee_id and sa.sop_version_id=(block->'payload'->>'sop_version_id')::uuid))
 into total_required,total_done from public.crew_journey_assignments a cross join lateral jsonb_path_query(a.journey_snapshot,'$.modules[*].lessons[*].blocks[*] ? (@.block_type == "sop_reference" && @.payload.required_acknowledgement == true)') block where a.employee_id=p_employee_id;
 sop_ratio:=case when total_required=0 then 1 else total_done::numeric/total_required end;
 select coalesce(count(distinct quiz_id) filter(where passed)::numeric/nullif(count(distinct quiz_id),0),0) into quiz_ratio from public.crew_quiz_attempts where employee_id=p_employee_id and completed_at<(p_period+interval '1 month');
 total_required:=0; total_done:=0;
 for rec in select s.id from public.crew_skills s where s.status='active' and public.crew_growth_skill_applicable(p_employee_id,s.id) loop
   total_required:=total_required+coalesce((public.crew_growth_employee_skill(p_employee_id,rec.id)->>'requirements_total')::int,0);
   total_done:=total_done+coalesce((public.crew_growth_employee_skill(p_employee_id,rec.id)->>'requirements_completed')::int,0);
 end loop;
 growth_ratio:=case when total_required=0 then 1 else least(1,total_done::numeric/total_required) end;
 score:=round(least(15,6*onboarding_ratio+3.75*sop_ratio+3.75*quiz_ratio+1.5*growth_ratio),2);
 return jsonb_build_object('score',score,'max_score',15,'status','calculated',
   'explanation','Knowledge uses durable onboarding, pinned SOP acknowledgements, passed quizzes and Growth learning evidence; completed historical onboarding remains valid.',
   'evidence',jsonb_build_object('onboarding_ratio',round(onboarding_ratio,3),'sop_ratio',round(sop_ratio,3),'quiz_ratio',round(quiz_ratio,3),'growth_ratio',round(growth_ratio,3)),
   'calculation_version','performance-v2');
end; $$;
revoke all on function public.crew_performance_knowledge_component(uuid,date) from public,anon,authenticated;

create or replace function public.crew_refresh_performance(p_employee_id uuid, p_period date)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare period date := date_trunc('month',p_period)::date; outlet uuid; attendance jsonb;
  knowledge jsonb; peer jsonb; service_review public.crew_performance_reviews%rowtype;
  result_id uuid; current_total numeric; v_components jsonb;
begin
  if public.crew_performance_model(p_employee_id,period) is distinct from 'performance-v2' then
    return null;
  end if;
  outlet := public.crew_growth_employee_outlet(p_employee_id);
  if outlet is null then return null; end if;
  select id into result_id from public.crew_performance_results
    where employee_id=p_employee_id and period_start=period and status='finalized';
  if found then return result_id; end if;
  attendance := public.crew_performance_attendance_component(p_employee_id,period);
  knowledge := public.crew_performance_knowledge_component(p_employee_id,period);
  peer := public.crew_peer_review_component(p_employee_id,period);
  select * into service_review from public.crew_performance_reviews
    where employee_id=p_employee_id and period_start=period and component='service'
    order by reviewed_at desc limit 1;
  current_total := round(coalesce((attendance->>'score')::numeric,0) + coalesce(service_review.score,0)
    + coalesce((knowledge->>'score')::numeric,0) + coalesce((peer->>'score')::numeric,0),2);
  v_components := jsonb_build_object('attendance',attendance,
    'service',case when service_review.id is null then
      jsonb_build_object('score',null,'max_score',30,'status','review_required')
      else jsonb_build_object('score',service_review.score,'max_score',30,'status','reviewed',
        'criteria',service_review.criteria,'reviewed_at',service_review.reviewed_at,
        'calculation_version',service_review.calculation_version) end,
    'customer',jsonb_build_object('score',null,'max_score',20,'status','pending',
      'reason','google_review_authority_not_available','calculation_version','performance-v2'),
    'knowledge',knowledge,'peer',peer);
  insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,
    calculation_version,attendance_score,service_score,customer_score,knowledge_score,
    conduct_score,peer_score,current_score,total_score,components,computed_at)
  values(p_employee_id,outlet,period,'review_required','performance-v2',
    (attendance->>'score')::numeric,service_review.score,null,(knowledge->>'score')::numeric,
    null,(peer->>'score')::numeric,current_total,null,v_components,now())
  on conflict(employee_id,period_start) do update set outlet_id=excluded.outlet_id,
    status=excluded.status,calculation_version='performance-v2',
    attendance_score=excluded.attendance_score,service_score=excluded.service_score,
    customer_score=null,knowledge_score=excluded.knowledge_score,conduct_score=null,
    peer_score=excluded.peer_score,current_score=excluded.current_score,total_score=null,
    components=excluded.components,computed_at=now()
  returning id into result_id;
  return result_id;
end; $$;
revoke all on function public.crew_refresh_performance(uuid,date) from public,anon,authenticated;

create or replace function public.crew_performance_finalize(p_employee_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
begin
  if not public.current_user_has_permission('crew_performance.finalize') then
    raise exception using errcode='42501',message='Performance finalization permission is required.';
  end if;
  if public.crew_performance_model(p_employee_id,p_period) is distinct from 'performance-v2' then
    raise exception using errcode='22023',message='Performance is available to active Service Crew only.';
  end if;
  if not public.current_user_can_access_outlet(public.crew_growth_employee_outlet(p_employee_id)) then
    raise exception using errcode='42501',message='Crew member is outside your outlet scope.';
  end if;
  raise exception using errcode='22023',
    message='Google Customer evidence is pending; Performance cannot be finalized.';
end; $$;
revoke all on function public.crew_performance_finalize(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_finalize(uuid,date) to authenticated;

create or replace function public.crew_performance_mobile(p_token text,p_period date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid := public.crew_session_employee(p_token); result_id uuid;
  result public.crew_performance_results%rowtype; trend jsonb; safe_components jsonb;
  scored_components integer; pending_names jsonb;
begin
  result_id := public.crew_refresh_performance(employee,p_period);
  if result_id is null then return null; end if;
  select * into result from public.crew_performance_results where id=result_id;
  safe_components := jsonb_build_object('attendance',result.components->'attendance',
    'service',(result.components->'service') - 'manager_note',
    'customer',result.components->'customer',
    'knowledge',result.components->'knowledge','peer',result.components->'peer');
  select count(*) filter(where jsonb_typeof(value->'score')='number')::integer,
    coalesce(jsonb_agg(key order by key) filter(where jsonb_typeof(value->'score') is distinct from 'number'),'[]'::jsonb)
    into scored_components,pending_names from jsonb_each(safe_components);
  select coalesce(jsonb_agg(jsonb_build_object('period_start',period_start,'score',total_score,
    'status',status) order by period_start),'[]'::jsonb) into trend
    from (select period_start,total_score,status from public.crew_performance_results
      where employee_id=employee order by period_start desc limit 6) x;
  return jsonb_build_object('period_start',result.period_start,'status',result.status,
    'score',case when scored_components>0 then result.current_score else null end,
    'current_score',result.current_score,'total_score',result.total_score,
    'score_state',case when scored_components>0 then 'partial' else 'unavailable' end,
    'scored_components',scored_components,'pending_components',5-scored_components,
    'pending_component_names',pending_names,'total_components',5,
    'calculation_version','performance-v2','breakdown',safe_components,
    'trend',trend,'updated_at',result.computed_at);
end; $$;
revoke all on function public.crew_performance_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_performance_mobile(text,date) to anon,authenticated;

create or replace function public.crew_performance_admin_page(p_outlet_id uuid,p_period date,
  p_listing text,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_source jsonb; v_rows jsonb; v_total integer;
  v_page integer := greatest(coalesce(p_page,1),1);
  v_size integer := case when p_page_size in (20,50,100) then p_page_size else 20 end;
  v_query text := coalesce(p_filters->>'query','');
  v_position text := coalesce(p_filters->>'position','all');
  v_status text := coalesce(p_filters->>'status','all');
begin
  if p_listing not in ('review_queue','team') then
    raise exception using errcode='22023',message='Unsupported Performance listing.';
  end if;
  v_source := public.crew_performance_admin_data(p_outlet_id,p_period);
  with rows as (select value as row from jsonb_array_elements(coalesce(v_source->'crew','[]'::jsonb))),
  classified as (
    select row,(row->'result'->'components'->'service'->>'status'='reviewed'
      and jsonb_typeof(row->'result'->'components'->'peer'->'score')='number') as reviewed
    from rows
  ),filtered as (
    select row,reviewed from classified where
      (v_query='' or concat_ws(' ',row->'employee'->>'full_name',row->'employee'->>'employee_code',
        row->'employee'->>'position') ilike '%'||v_query||'%')
      and (v_position='all' or row->'employee'->>'position'=v_position)
      and (v_status='all' or (v_status='awaiting' and not reviewed)
        or (v_status='reviewed' and reviewed)
        or (v_status='finalized' and row->'result'->>'status'='finalized'))
  ),numbered as (
    select row,row_number() over(order by
      case when p_listing='review_queue' then reviewed else false end,
      row->'employee'->>'full_name') as rn from filtered
  )
  select count(*)::integer,
    coalesce(jsonb_agg(row order by rn) filter(where rn>(v_page-1)*v_size and rn<=v_page*v_size),'[]'::jsonb)
    into v_total,v_rows from numbered;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,
    'summary',jsonb_build_object('period_summary',coalesce(v_source->'summary','{}'::jsonb),
      'scoring_framework',coalesce(v_source->'scoring_framework','[]'::jsonb)));
end; $$;
revoke all on function public.crew_performance_admin_page(uuid,date,text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_page(uuid,date,text,jsonb,integer,integer) to authenticated;

create or replace function public.crew_performance_admin_data(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date := date_trunc('month',p_period)::date; employee record;
  rows jsonb := '[]'::jsonb; review_rows jsonb := '[]'::jsonb; summary jsonb := '{}'::jsonb;
  can_performance boolean := public.current_user_has_permission('crew_performance.view');
  can_review boolean := public.current_user_has_permission('crew_performance.review');
begin
  if not (can_performance or can_review) or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Performance is unavailable for this outlet.';
  end if;
  if can_performance then
    for employee in
      select e.id from public.employees e join public.crew_access ca on ca.employee_id=e.id
      where ca.primary_outlet_id=p_outlet_id and e.is_active
        and coalesce(e.employment_status,'active') not in ('resigned','terminated')
        and lower(btrim(e.position))='service crew'
    loop
      perform public.crew_refresh_performance(employee.id,period);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object(
      'employee',jsonb_build_object('id',e.id,'full_name',e.full_name,
        'employee_code',e.employee_code,'position',e.position),
      'result',jsonb_build_object('id',r.id,'status',r.status,'period_start',r.period_start,
        'current_score',r.current_score,'total_score',r.total_score,
        'attendance_score',r.attendance_score,'service_score',r.service_score,
        'customer_score',r.customer_score,'knowledge_score',r.knowledge_score,
        'peer_score',r.peer_score,
        'components',case when can_review then r.components else
          jsonb_set(r.components,'{service}',coalesce(r.components->'service','{}'::jsonb)
            - 'manager_note' - 'criteria') end,
        'calculation_version',r.calculation_version,'computed_at',r.computed_at,
        'finalized_at',r.finalized_at)) order by e.full_name),'[]'::jsonb)
      into rows from public.crew_performance_results r join public.employees e on e.id=r.employee_id
      where r.outlet_id=p_outlet_id and r.period_start=period and r.calculation_version='performance-v2';
    select jsonb_build_object('average_score',round(avg(total_score) filter(where total_score is not null),1),
      'reviewed',count(*) filter(where components->'service'->>'status'='reviewed'
        and jsonb_typeof(components->'peer'->'score')='number'),
      'awaiting_review',count(*) filter(where components->'service'->>'status' is distinct from 'reviewed'
        or jsonb_typeof(components->'peer'->'score') is distinct from 'number'),
      'crew_total',count(*)) into summary from public.crew_performance_results
      where outlet_id=p_outlet_id and period_start=period and calculation_version='performance-v2';
  end if;
  if can_review then
    select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,
      'employee_name',e.full_name,'position',e.position,'component',v.component,
      'criteria',v.criteria,'score',v.score,'max_score',v.max_score,
      'manager_note',v.manager_note,'reviewed_at',v.reviewed_at)
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
end; $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;

-- Customer Feedback keeps its own moderation and trust history. It no longer
-- refreshes a score because V2 Customer evidence belongs to Google Reviews.
create or replace function public.crew_feedback_refresh_mutable_performance(p_employee_id uuid,p_outlet_id uuid,p_period date)
returns void language plpgsql volatile security definer set search_path=public as $$
begin
  return;
end; $$;
revoke all on function public.crew_feedback_refresh_mutable_performance(uuid,uuid,date) from public,anon,authenticated;

drop function public.crew_performance_customer_component(uuid,date);
drop table public.crew_performance_model_periods;

create or replace function public.crew_peer_open_month(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_period date := date_trunc('month',p_period)::date;
  v_team_size integer; v_required integer; v_subject record; v_reviewer record;
  v_existing integer; v_added integer := 0;
begin
  if not public.current_user_has_permission('crew_performance.review')
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Performance review permission is required for this outlet.';
  end if;
  if timezone('Asia/Kuala_Lumpur',now())::date < (v_period+interval '1 month'-interval '7 days')::date
    or timezone('Asia/Kuala_Lumpur',now())::date >= (v_period+interval '1 month'+interval '7 days')::date then
    raise exception using errcode='22023',message='Peer Review opens near the end of a worked month.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text||v_period::text||'peer',0));
  select count(*) into v_team_size from public.crew_peer_worked_team(p_outlet_id,v_period);
  v_required := case when v_team_size>=4 then 3 when v_team_size=3 then 2 else 0 end;
  for v_subject in select employee_id from public.crew_peer_worked_team(p_outlet_id,v_period)
    order by employee_id
  loop
    if exists(select 1 from public.crew_performance_results
      where employee_id=v_subject.employee_id and period_start=v_period and status='finalized') then
      continue;
    end if;
    insert into public.crew_peer_review_subjects(employee_id,outlet_id,period_start,
      required_count,team_size,opened_by)
    values(v_subject.employee_id,p_outlet_id,v_period,v_required,v_team_size,auth.uid())
    on conflict(employee_id,period_start) do nothing;
  end loop;
  if v_required>0 then
    for v_subject in
      select s.employee_id,s.required_count from public.crew_peer_review_subjects s
      where s.outlet_id=p_outlet_id and s.period_start=v_period and s.required_count>0
      order by (select count(*) from public.crew_peer_worked_overlap(p_outlet_id,v_period) o
        where o.subject_id=s.employee_id),s.employee_id
    loop
      select count(*) into v_existing from public.crew_peer_review_assignments
        where subject_id=v_subject.employee_id and period_start=v_period;
      for v_reviewer in
        select o.reviewer_id from public.crew_peer_worked_overlap(p_outlet_id,v_period) o
        where o.subject_id=v_subject.employee_id and not exists (
          select 1 from public.crew_peer_review_assignments a
          where a.subject_id=o.subject_id and a.reviewer_id=o.reviewer_id and a.period_start=v_period)
        order by (select count(*) from public.crew_peer_review_assignments a
          where a.reviewer_id=o.reviewer_id and a.period_start=v_period),
          o.overlap_minutes desc,o.reviewer_id
        limit greatest(0,v_subject.required_count-v_existing)
      loop
        insert into public.crew_peer_review_assignments(subject_id,reviewer_id,outlet_id,period_start)
        values(v_subject.employee_id,v_reviewer.reviewer_id,p_outlet_id,v_period)
        on conflict(subject_id,reviewer_id,period_start) do nothing;
        v_added := v_added+1;
      end loop;
    end loop;
  end if;
  return jsonb_build_object('team_size',v_team_size,'required_reviews',v_required,
    'assignments_added',v_added);
end; $$;
revoke all on function public.crew_peer_open_month(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_peer_open_month(uuid,date) to authenticated;

create or replace function public.crew_performance_attendance_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_expected integer:=0; v_completed integer:=0; v_punctual_records integer:=0;
  v_minor integer:=0; v_late integer:=0; v_severe integer:=0; v_excluded_leave integer:=0; v_excluded_late_roster integer:=0; v_exceptions integer:=0;
  v_completeness numeric:=12; v_punctuality numeric:=12; v_score numeric; v_location_exceptions integer:=0;
begin
  with days as (
    select generate_series(v_period,v_period+interval '1 month'-interval '1 day',interval '1 day')::date business_date
  ), latest_published as (
    select distinct on (pe.roster_date) pe.roster_date,pe.start_time,pe.end_time,pe.entry_type,pe.published_at
    from public.duty_roster_published_entries pe join public.duty_roster_publications publication on publication.id=pe.publication_id
    where pe.employee_id=p_employee_id and pe.roster_date>=v_period and pe.roster_date<v_period+interval '1 month'
    order by pe.roster_date,publication.published_at desc,pe.published_at desc
  ), scheduled as (
    select d.business_date,lp.start_time,lp.end_time,lp.entry_type,lp.published_at,
      ((d.business_date+lp.start_time) at time zone 'Asia/Kuala_Lumpur') scheduled_start,
      case when lp.end_time is null then null when lp.end_time>lp.start_time then ((d.business_date+lp.end_time) at time zone 'Asia/Kuala_Lumpur') else (((d.business_date+1)+lp.end_time) at time zone 'Asia/Kuala_Lumpur') end scheduled_end
    from days d left join latest_published lp on lp.roster_date=d.business_date
  ), attendance as (
    select timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date business_date,min(a.clock_in_at) clock_in_at,
      bool_or(a.status='completed' and a.clock_out_at is not null) completed,
      min(a.scheduled_start_at) filter(where a.scheduled_start_at is not null) snap_start,
      min(a.scheduled_published_at) filter(where a.scheduled_published_at is not null) snap_published
    from public.crew_attendance_records a where a.employee_id=p_employee_id and a.clock_in_at>=v_period and a.clock_in_at<v_period+interval '1 month'
    group by 1
  ), active_exceptions as (
    select distinct business_date from public.crew_attendance_performance_exceptions where employee_id=p_employee_id and business_date>=v_period and business_date<v_period+interval '1 month' and revoked_at is null
  ), eligible as (
    select s.*,a.clock_in_at,a.completed,coalesce(a.snap_start,s.scheduled_start) score_start,coalesce(a.snap_published,s.published_at) score_published,
      exists(select 1 from active_exceptions x where x.business_date=s.business_date) has_exception
    from scheduled s left join attendance a using(business_date)
    where s.entry_type='working' and s.start_time is not null and coalesce(s.scheduled_end,s.scheduled_start+interval '12 hours') < now() and s.published_at<=s.scheduled_start
  )
  select count(*) filter(where not has_exception),count(*) filter(where not has_exception and completed),count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start),
    count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start and extract(epoch from(clock_in_at-score_start)) > 600 and extract(epoch from(clock_in_at-score_start)) <= 1200),
    count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start and extract(epoch from(clock_in_at-score_start)) > 1200 and extract(epoch from(clock_in_at-score_start)) <= 2700),
    count(*) filter(where not has_exception and completed and score_start is not null and score_published<=score_start and extract(epoch from(clock_in_at-score_start)) > 2700),
    count(*) filter(where entry_type is not null and entry_type<>'working'),count(*) filter(where published_at>scheduled_start),count(*) filter(where has_exception)
  into v_expected,v_completed,v_punctual_records,v_minor,v_late,v_severe,v_excluded_leave,v_excluded_late_roster,v_exceptions
  from eligible;
  select count(*) into v_location_exceptions from public.crew_attendance_records a where a.employee_id=p_employee_id and a.clock_in_at>=v_period and a.clock_in_at<v_period+interval '1 month' and (coalesce(a.clock_in_location_exception,false) or coalesce(a.clock_out_location_exception,false));
  if v_expected>0 then v_completeness:=round(15*v_completed::numeric/v_expected,2); end if;
  if v_punctual_records>0 then v_punctuality:=round(greatest(0,15-v_minor*0.5-v_late*1.5-v_severe*3),2); end if;
  v_score:=round(v_completeness+v_punctuality,2);
  return jsonb_build_object('score',v_score,'max_score',30,'status',case when v_expected=0 and v_punctual_records=0 then 'insufficient_data' else 'calculated' end,
    'explanation',case when v_expected=0 then 'No completed eligible published shifts this month; Attendance uses the neutral 12/15 completeness baseline.' else 'Attendance combines completed scheduled shifts and clock-in punctuality against the published roster.' end,
    'evidence',jsonb_build_object('scheduled_completed_shifts',v_expected,'completed_scheduled_shifts',v_completed,'punctuality_records',v_punctual_records,'completeness_score',v_completeness,'punctuality_score',v_punctuality,'grace_minutes',10,'late_minor',v_minor,'late',v_late,'late_severe',v_severe,'approved_exceptions',v_exceptions,'late_roster_excluded',v_excluded_late_roster,'location_exceptions',v_location_exceptions),'calculation_version','performance-attendance-v2');
end; $$;
revoke all on function public.crew_performance_attendance_component(uuid,date) from public,anon,authenticated;

create or replace function public.crew_reward_mobile(p_token text, p_period date default current_date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  employee uuid;
  period date := date_trunc('month', p_period)::date;
  current_row record;
  history jsonb;
  reward_amount numeric;
  reward_label text;
  tier_name text;
  maximum_share numeric;
  total_hours numeric;
  earn_rate numeric;
  projections jsonb;
begin
  employee := public.crew_session_employee(p_token);
  select
    c.*,
    e.performance_score,
    e.eligible_hours,
    e.contribution_share,
    e.performance_factor,
    e.base_reward,
    e.calculated_reward,
    e.final_payout,
    e.status as entry_status,
    e.eligibility_reason,
    coalesce((e.source_snapshot ->> 'outlet_total_eligible_hours')::numeric, 0) as outlet_total_eligible_hours
  into current_row
  from public.crew_reward_entries e
  join public.crew_reward_cycles c on c.id = e.cycle_id
  where e.employee_id = employee
    and c.period_start = period
  order by c.created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'period_start', x.period_start,
    'amount', x.final_payout,
    'status', x.entry_status,
    'paid_at', x.paid_at
  ) order by x.period_start desc), '[]'::jsonb)
  into history
  from (
    select c.period_start, e.final_payout, e.status as entry_status, c.paid_at
    from public.crew_reward_entries e
    join public.crew_reward_cycles c on c.id = e.cycle_id
    where e.employee_id = employee
      and c.period_start < period
      and c.status in ('finalized', 'paid')
    order by c.period_start desc
    limit 12
  ) x;

  if current_row.id is null then
    return jsonb_build_object(
      'period_start', period,
      'status', 'not_available',
      'explanation', 'No Reward cycle is available for this month.',
      'calculation_version', 'reward-tier-v2',
      'history', history
    );
  end if;

  if current_row.entry_status not in ('finalized', 'paid') or current_row.performance_score is null then
    return jsonb_build_object(
      'period_start', period,
      'status', current_row.entry_status,
      'cycle_status', current_row.status,
      'explanation', 'Finalized Performance is required before Reward can be calculated.',
      'calculation_version', 'reward-tier-v2',
      'history', history
    );
  end if;

  earn_rate := public.crew_reward_earn_rate(current_row.performance_score);
  maximum_share := round(coalesce(current_row.base_reward, current_row.configured_pool * current_row.contribution_share, 0), 2);
  total_hours := coalesce(current_row.outlet_total_eligible_hours,
    case when current_row.contribution_share > 0 then current_row.eligible_hours / current_row.contribution_share else 0 end,
    0);
  reward_amount := case
    when current_row.entry_status in ('finalized', 'paid') then current_row.final_payout
    else round(maximum_share * earn_rate, 2)
  end;
  reward_label := case current_row.entry_status when 'paid' then 'Paid Reward' when 'finalized' then 'Final Reward' else 'Estimated Reward' end;
  tier_name := case
    when current_row.performance_score is null then 'Awaiting Review'
    when current_row.performance_score >= 95 then 'Outstanding'
    when current_row.performance_score >= 90 then 'Excellent'
    when current_row.performance_score >= 85 then 'Strong'
    when current_row.performance_score >= 80 then 'Good'
    when current_row.performance_score >= 75 then 'Meets Standard'
    when current_row.performance_score >= 70 then 'Developing'
    else 'Below Standard'
  end;

  projections := '[]'::jsonb;

  return jsonb_build_object(
    'period_start', current_row.period_start,
    'status', current_row.entry_status,
    'cycle_status', current_row.status,
    'reward_label', reward_label,
    'reward_amount', reward_amount,
    'estimated_reward', reward_amount,
    'performance_score', current_row.performance_score,
    'performance_level', tier_name,
    'earn_rate', earn_rate,
    'eligible_hours', current_row.eligible_hours,
    'total_eligible_hours', round(total_hours, 2),
    'contribution_share', current_row.contribution_share,
    'maximum_share', maximum_share,
    'reward_pool', current_row.configured_pool,
    'configured_pool', current_row.configured_pool,
    'calculation_version', 'reward-tier-v2',
    'eligibility_reason', current_row.eligibility_reason,
    'projection_applicable', false,
    'projections', projections,
    'earn_rate_tiers', jsonb_build_array(
      jsonb_build_object('range', '95–100', 'level', 'Outstanding', 'rate', 1),
      jsonb_build_object('range', '90–94', 'level', 'Excellent', 'rate', .90),
      jsonb_build_object('range', '85–89', 'level', 'Strong', 'rate', .80),
      jsonb_build_object('range', '80–84', 'level', 'Good', 'rate', .65),
      jsonb_build_object('range', '75–79', 'level', 'Meets Standard', 'rate', .45),
      jsonb_build_object('range', '70–74', 'level', 'Developing', 'rate', .20),
      jsonb_build_object('range', '<70', 'level', 'Below Standard', 'rate', 0)
    ),
    'history', history
  );
end;
$$;

revoke all on function public.crew_reward_mobile(text,date) from public, anon, authenticated;
grant execute on function public.crew_reward_mobile(text,date) to anon, authenticated;

drop function public.crew_reward_draft_projection(uuid,uuid,date);

create or replace function public.crew_dashboard_admin_data(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  d date := timezone('Asia/Kuala_Lumpur', now())::date;
  m date := date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date;
  scheduled int:=0; present_count int:=0; leave_count int:=0; attendance_issues int:=0;
  task_total int:=0; task_completed int:=0; task_overdue int:=0; access_issues int:=0;
  birthdays jsonb:='[]'::jsonb; upcoming jsonb:='[]'::jsonb; attention jsonb:='[]'::jsonb;
  leave_today jsonb:='[]'::jsonb; task_detail jsonb:='{}'::jsonb; missing_detail jsonb:='{}'::jsonb;
  pending_leave jsonb:='{}'::jsonb; compliance_pending int:=0; compliance_risk int:=0; performance_pending int:=0;
  can_leave boolean:=public.current_user_has_permission('crew_leave.view');
  can_attendance boolean:=public.current_user_has_permission('crew_attendance.view');
  can_tasks boolean:=public.current_user_has_permission('crew_operations.view');
  can_compliance boolean:=public.current_user_has_permission('employee_compliance.view');
  can_performance boolean:=public.current_user_has_permission('crew_performance.view');
begin
  if p_outlet_id is null or not public.current_user_has_permission('crew_dashboard.view') then raise exception using errcode='42501',message='Missing permission to view the Crew Dashboard.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Crew Dashboard is outside your outlet scope.'; end if;

  with published as (select distinct entry.employee_id from public.duty_roster_published_entries entry where entry.outlet_id=p_outlet_id and entry.roster_date=d and entry.entry_type='working' and entry.publication_id=(select p.id from public.duty_roster_publications p where p.outlet_id=p_outlet_id and p.week_start_date<=d and p.week_end_date>=d order by p.revision desc,p.published_at desc limit 1)), checked_in as (select distinct employee_id from public.crew_attendance_records where outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',clock_in_at)::date=d) select count(*),count(*) filter(where employee_id in(select employee_id from checked_in)) into scheduled,present_count from published;
  if can_attendance then
    select count(*) into attendance_issues from public.crew_attendance_records where outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',clock_in_at)::date=d and (clock_in_location_exception or clock_out_location_exception);
    with published as (select distinct entry.employee_id from public.duty_roster_published_entries entry where entry.outlet_id=p_outlet_id and entry.roster_date=d and entry.entry_type='working' and entry.publication_id=(select p.id from public.duty_roster_publications p where p.outlet_id=p_outlet_id and p.week_start_date<=d and p.week_end_date>=d order by p.revision desc,p.published_at desc limit 1)), checked_in as (select distinct employee_id from public.crew_attendance_records where outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',clock_in_at)::date=d) select jsonb_build_object('name',e.full_name,'position',e.position) into missing_detail from published p join public.employees e on e.id=p.employee_id where not exists(select 1 from checked_in c where c.employee_id=p.employee_id) order by e.full_name limit 1;
  end if;

  if can_leave then
    select count(distinct r.employee_id),coalesce(jsonb_agg(jsonb_build_object('name',e.full_name,'type',r.leave_type) order by e.full_name),'[]'::jsonb) into leave_count,leave_today from public.crew_leave_requests r join public.employees e on e.id=r.employee_id where r.employment_outlet_id=p_outlet_id and r.status='approved' and d between r.start_date and r.end_date and e.is_active;
    select jsonb_build_object('name',e.full_name,'type',r.leave_type,'date',r.start_date) into pending_leave from public.crew_leave_requests r join public.employees e on e.id=r.employee_id where r.employment_outlet_id=p_outlet_id and r.status='pending' order by r.created_at limit 1;
    if pending_leave<>'{}'::jsonb then attention:=attention||jsonb_build_array(jsonb_build_object('key','leave_requests','priority','normal','title','1 leave request awaiting review','detail',concat_ws(' · ',pending_leave->>'type',to_char((pending_leave->>'date')::date,'DD Mon'),pending_leave->>'name'))); end if;
    select coalesce(jsonb_agg(jsonb_build_object('type','leave','name',e.full_name,'position',e.position,'date',r.start_date,'days_until',r.start_date-d) order by r.start_date,e.full_name),'[]'::jsonb) into upcoming from public.crew_leave_requests r join public.employees e on e.id=r.employee_id where r.employment_outlet_id=p_outlet_id and r.status='approved' and r.start_date>d and r.start_date<=d+7;
  end if;

  if can_tasks then
    select count(*),count(*) filter(where status in('completed','completed_with_exceptions')),count(*) filter(where status='overdue' or (status='not_started' and available_until<now())) into task_total,task_completed,task_overdue from public.crew_operation_instances where outlet_id=p_outlet_id and business_date=d;
    select jsonb_build_object('name',name,'due_at',available_until) into task_detail from public.crew_operation_instances where outlet_id=p_outlet_id and business_date=d and (status='overdue' or (status='not_started' and available_until<now())) order by available_until nulls last,name limit 1;
    if task_overdue>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','tasks','priority','urgent','title',format('%s task%s overdue',task_overdue,case when task_overdue=1 then '' else 's' end),'detail',coalesce(task_detail->>'name','Today''s task'))); end if;
  end if;
  if can_attendance then
    if scheduled>present_count then attention:=attention||jsonb_build_array(jsonb_build_object('key','missing_checkin','priority','urgent','title',(scheduled-present_count)||' Crew not yet checked in','detail',coalesce(concat_ws(' · ',missing_detail->>'name',missing_detail->>'position'),'Published roster is awaiting attendance'))); end if;
    if attendance_issues>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','attendance_exceptions','priority','normal','title',format('%s attendance issue%s',attendance_issues,case when attendance_issues=1 then '' else 's' end),'detail','Location evidence needs review.')); end if;
  end if;
  if can_compliance then
    with states as (select public.employee_compliance_current(e.id,r.id,d) s from public.employees e cross join public.employee_compliance_requirements r where public.crew_resolve_employee_outlet(e.id)=p_outlet_id and e.is_active and coalesce(e.employment_status,'active')='active' and r.is_active) select count(*) filter(where s->>'effective_status'='pending_verification'),count(*) filter(where s->>'effective_status' in('missing','expired','expiring_soon')) into compliance_pending,compliance_risk from states;
    if compliance_pending>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','compliance_review','priority','normal','title',format('%s compliance record%s need verification',compliance_pending,case when compliance_pending=1 then '' else 's' end),'detail','Employee documents are waiting for review.')); end if;
    if compliance_risk>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','compliance_status','priority','normal','title',format('%s compliance record%s need follow-up',compliance_risk,case when compliance_risk=1 then '' else 's' end),'detail','Documents are missing, expiring, or expired.')); end if;
  end if;
  if can_performance then select count(*) into performance_pending from public.crew_performance_results r where r.outlet_id=p_outlet_id and r.period_start=m and r.components->'service'->>'status' is distinct from 'reviewed'; if performance_pending>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','performance_reviews','priority','normal','title',performance_pending||' Performance reviews pending','detail',to_char(m,'FMMonth YYYY'))); end if; end if;
  select count(*) into access_issues from public.employees e left join public.crew_access ca on ca.employee_id=e.id where public.crew_resolve_employee_outlet(e.id)=p_outlet_id and e.is_active and coalesce(e.employment_status,'active')='active' and coalesce(ca.access_state,'not_enabled')<>'active';
  if access_issues>0 then attention:=attention||jsonb_build_array(jsonb_build_object('key','crew_access','priority','low','title',format('%s Crew access issue%s',access_issues,case when access_issues=1 then '' else 's' end),'detail','Crew mobile access needs setup or review.')); end if;
  with active as (select e.id,e.full_name,e.position,e.birthday from public.employees e where public.crew_resolve_employee_outlet(e.id)=p_outlet_id and e.is_active and coalesce(e.employment_status,'active')='active' and e.birthday is not null), events as (select id,full_name,position,case when make_date(extract(year from d)::int,extract(month from birthday)::int,extract(day from birthday)::int)<d then make_date(extract(year from d)::int+1,extract(month from birthday)::int,extract(day from birthday)::int) else make_date(extract(year from d)::int,extract(month from birthday)::int,extract(day from birthday)::int) end date from active) select coalesce(jsonb_agg(jsonb_build_object('type','birthday','name',full_name,'position',position,'date',date,'days_until',date-d) order by date,full_name),'[]'::jsonb) into birthdays from events where date<=d+7;
  return jsonb_build_object('business_date',d,'summary',jsonb_build_object('scheduled_today',scheduled,'present_today',present_count,'not_checked_in',greatest(scheduled-present_count,0),'attendance_issues',attendance_issues,'on_leave_today',leave_count,'leave_today',leave_today,'tasks_total',task_total,'tasks_completed',task_completed,'tasks_overdue',task_overdue),'attention',(select coalesce(jsonb_agg(x order by case x->>'priority' when 'urgent' then 1 when 'normal' then 2 else 3 end),'[]'::jsonb) from jsonb_array_elements(attention)x),'upcoming',(birthdays||upcoming));
end; $$;
revoke all on function public.crew_dashboard_admin_data(uuid) from public,anon,authenticated;
grant execute on function public.crew_dashboard_admin_data(uuid) to authenticated;

commit;
