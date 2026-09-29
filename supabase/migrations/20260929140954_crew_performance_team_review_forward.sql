-- Forward-only Production parity: 20260929055243 is already ledgered in both
-- environments, but Production's three-argument body still reads Peer Review.
-- Installing Team Review after it also replaces the two-argument wrapper.
-- Restore the period-employment wrapper and replace only the open calculation.
-- Finalized results remain pinned by the three-argument function's early return.
do $guard$
begin
  if to_regprocedure('public.crew_team_review_performance_component(uuid,date)') is null then
    raise exception 'Team Review Performance component must be installed first';
  end if;
end
$guard$;

create or replace function public.crew_refresh_performance(p_employee_id uuid,p_period date,p_confirm_employment boolean)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; v_employment jsonb;
  outlet uuid; attendance jsonb; knowledge jsonb; team_review jsonb;
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
  team_review:=public.crew_team_review_performance_component(p_employee_id,period);
  select * into service_review from public.crew_performance_reviews
    where employee_id=p_employee_id and period_start=period and component='service'
      and outlet_id=outlet order by reviewed_at desc limit 1;
  current_total:=round(coalesce((attendance->>'score')::numeric,0)
    +coalesce(service_review.score,0)+coalesce((knowledge->>'score')::numeric,0)
    +coalesce((team_review->>'score')::numeric,0),2);
  v_components:=jsonb_build_object('employment',v_employment,'attendance',attendance,
    'service',case when service_review.id is null then
      jsonb_build_object('score',null,'max_score',30,'status','review_required')
      else jsonb_build_object('score',service_review.score,'max_score',30,'status','reviewed',
        'criteria',service_review.criteria,'reviewed_at',service_review.reviewed_at,
        'calculation_version',service_review.calculation_version) end,
    'customer',jsonb_build_object('score',null,'max_score',20,'status','pending',
      'reason','google_review_authority_not_available','calculation_version','performance-v2'),
    'knowledge',knowledge,'peer',team_review);
  insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,
    calculation_version,attendance_score,service_score,customer_score,knowledge_score,
    conduct_score,peer_score,current_score,total_score,components,computed_at)
  values(p_employee_id,outlet,period,'review_required','performance-v2',
    (attendance->>'score')::numeric,service_review.score,null,(knowledge->>'score')::numeric,
    null,(team_review->>'score')::numeric,current_total,null,v_components,now())
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
