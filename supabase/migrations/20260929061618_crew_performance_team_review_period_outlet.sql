-- Keep one Team Review scoring projection. Its existing two-argument read
-- retains the Team Review workflow's current-outlet behavior; Performance
-- passes its verified period outlet to this private scoped read instead.
create function public.crew_team_review_result_scoped(p_employee_id uuid,p_period date,p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_period date:=date_trunc('month',p_period)::date; v_outlet uuid:=p_outlet_id;
  v_window record; v_count integer:=0; v_eligible integer:=0; v_score numeric;
  v_dimensions jsonb; v_admin public.crew_team_admin_reviews%rowtype; v_status text;
begin
  if v_outlet is null then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','no_outlet');
  end if;
  select * into v_window from public.crew_team_review_window(v_outlet,v_period);
  if v_window.state='unavailable' then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','window_not_open','completed',0);
  end if;
  if v_window.state='closed' and not v_window.frozen then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','freeze_pending','completed',0);
  end if;
  if v_window.frozen and not exists(select 1 from public.crew_team_review_subjects
    where outlet_id=v_outlet and period_start=v_period and employee_id=p_employee_id) then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','no_work_evidence','completed',0);
  end if;
  if not v_window.frozen and not exists(select 1 from public.crew_team_review_live_subjects(v_outlet,v_period)
    where employee_id=p_employee_id) then
    return jsonb_build_object('score',null,'max_score',5,'status','pending','reason','no_work_evidence','completed',0);
  end if;
  if v_window.frozen then
    select count(*) into v_eligible from public.crew_team_review_eligible_pairs
      where outlet_id=v_outlet and period_start=v_period and subject_id=p_employee_id;
  else
    select count(*) into v_eligible from public.crew_team_review_live_pairs(v_outlet,v_period)
      where subject_id=p_employee_id;
  end if;
  if v_window.state='upcoming' then
    return jsonb_build_object('score',null,'max_score',5,'status','pending',
      'reason','window_not_open','completed',0,'eligible_teammates',v_eligible);
  end if;
  with eligible as (
    select reviewer_id from public.crew_team_review_eligible_pairs
      where v_window.frozen and outlet_id=v_outlet and period_start=v_period and subject_id=p_employee_id
    union all
    select reviewer_id from public.crew_team_review_live_pairs(v_outlet,v_period)
      where not v_window.frozen and subject_id=p_employee_id
  ), valid as (
    select r.criteria from public.crew_team_reviews r join eligible e on e.reviewer_id=r.reviewer_id
    left join public.crew_team_review_exclusions x on x.review_id=r.id
    where r.subject_id=p_employee_id and r.outlet_id=v_outlet and r.period_start=v_period
      and x.review_id is null
  )
  select count(*)::integer,round(avg(public.crew_team_review_mean(criteria)),2),
    jsonb_build_object('teamwork',round(avg((criteria->>'teamwork')::numeric),2),
      'reliability',round(avg((criteria->>'reliability')::numeric),2),
      'communication',round(avg((criteria->>'communication')::numeric),2),
      'work_attitude',round(avg((criteria->>'work_attitude')::numeric),2))
    into v_count,v_score,v_dimensions from valid;
  if v_window.state='open' then v_status:='provisional';
  elsif v_count>0 then v_status:='ready';
  else v_status:='admin_review_required'; end if;
  if v_window.state='closed' and v_count=0 then
    select * into v_admin from public.crew_team_admin_reviews
      where subject_id=p_employee_id and period_start=v_period and outlet_id=v_outlet;
    if found then
      v_status:='ready'; v_score:=public.crew_team_review_mean(v_admin.criteria);
      v_dimensions:=v_admin.criteria;
    end if;
  end if;
  return jsonb_build_object('score',v_score,'max_score',5,'status',v_status,
    'source',case when v_admin.id is not null then 'admin' when v_count>0 then 'crew' else null end,
    'completed',v_count,'eligible_teammates',v_eligible,'dimensions',v_dimensions,
    'calculation_version','team-review-v1');
end $$;
revoke all on function public.crew_team_review_result_scoped(uuid,date,uuid)
  from public,anon,authenticated;

create or replace function public.crew_team_review_result(p_employee_id uuid,p_period date)
returns jsonb language sql stable security definer set search_path=public as $$
  select public.crew_team_review_result_scoped(p_employee_id,p_period,
    public.crew_growth_employee_outlet(p_employee_id));
$$;
revoke all on function public.crew_team_review_result(uuid,date) from public,anon,authenticated;

create or replace function public.crew_team_review_performance_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_assignment jsonb:=public.crew_performance_period_employment(p_employee_id,p_period);
  v_result jsonb;
begin
  if v_assignment->>'state'<>'eligible' then
    return jsonb_build_object('score',null,'max_score',5,'status','pending',
      'reason','employment_review_required','calculation_version','team-review-v1');
  end if;
  v_result:=public.crew_team_review_result_scoped(p_employee_id,p_period,
    (v_assignment->>'outlet_id')::uuid);
  return jsonb_build_object('score',case when v_result->>'status'='ready' then v_result->'score' else 'null'::jsonb end,
    'max_score',5,'status',case when v_result->>'status'='ready' then 'scored' else 'pending' end,
    'reason',case when v_result->>'status'='ready' then null else v_result->>'status' end,
    'dimensions',case when v_result->>'status'='ready' then v_result->'dimensions' else null end,
    'calculation_version','team-review-v1');
end $$;
revoke all on function public.crew_team_review_performance_component(uuid,date)
  from public,anon,authenticated;
