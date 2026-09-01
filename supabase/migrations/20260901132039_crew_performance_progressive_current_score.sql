-- Mutable Performance exposes a server-calculated current total without
-- changing the complete/final total used by finalization and Reward.
alter table public.crew_performance_results
  add column if not exists current_score numeric(6,2)
  check(current_score between 0 and 100);

create or replace function public.crew_refresh_performance(p_employee_id uuid,p_period date)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare
 period date:=date_trunc('month',p_period)::date; outlet uuid; attendance jsonb; customer jsonb; knowledge jsonb;
 service_review public.crew_performance_reviews%rowtype; conduct_review public.crew_performance_reviews%rowtype;
 result_id uuid; total numeric; current_total numeric; state text;
begin
 outlet:=public.crew_growth_employee_outlet(p_employee_id);
 if outlet is null then raise exception using errcode='22023',message='Crew outlet is unavailable.'; end if;
 if exists(select 1 from public.crew_performance_results where employee_id=p_employee_id and period_start=period and status='finalized') then
   return (select id from public.crew_performance_results where employee_id=p_employee_id and period_start=period);
 end if;
 attendance:=public.crew_performance_attendance_component(p_employee_id,period);
 customer:=public.crew_performance_customer_component(p_employee_id,period);
 knowledge:=public.crew_performance_knowledge_component(p_employee_id,period);
 select * into service_review from public.crew_performance_reviews where employee_id=p_employee_id and period_start=period and component='service' order by reviewed_at desc limit 1;
 select * into conduct_review from public.crew_performance_reviews where employee_id=p_employee_id and period_start=period and component='conduct' order by reviewed_at desc limit 1;
 state:=case when service_review.id is null or conduct_review.id is null then 'review_required' else 'draft' end;
 current_total:=round(coalesce((attendance->>'score')::numeric,0)+coalesce(service_review.score,0)+coalesce((customer->>'score')::numeric,0)+coalesce((knowledge->>'score')::numeric,0)+coalesce(conduct_review.score,0),2);
 total:=case when service_review.id is null or conduct_review.id is null then null else current_total end;
 insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,attendance_score,service_score,customer_score,knowledge_score,conduct_score,current_score,total_score,components,computed_at)
 values(p_employee_id,outlet,period,state,(attendance->>'score')::numeric,service_review.score,(customer->>'score')::numeric,(knowledge->>'score')::numeric,conduct_review.score,current_total,total,
 jsonb_build_object('attendance',attendance,'service',case when service_review.id is null then jsonb_build_object('score',null,'max_score',30,'status','review_required','calculation_version','performance-v1') else jsonb_build_object('score',service_review.score,'max_score',30,'status','reviewed','criteria',service_review.criteria,'reviewed_at',service_review.reviewed_at,'calculation_version',service_review.calculation_version) end,'customer',customer,'knowledge',knowledge,'conduct',case when conduct_review.id is null then jsonb_build_object('score',null,'max_score',10,'status','review_required','calculation_version','performance-v1') else jsonb_build_object('score',conduct_review.score,'max_score',10,'status','reviewed','criteria',conduct_review.criteria,'reviewed_at',conduct_review.reviewed_at,'calculation_version',conduct_review.calculation_version) end),now())
 on conflict(employee_id,period_start) do update set outlet_id=excluded.outlet_id,status=excluded.status,attendance_score=excluded.attendance_score,service_score=excluded.service_score,customer_score=excluded.customer_score,knowledge_score=excluded.knowledge_score,conduct_score=excluded.conduct_score,current_score=excluded.current_score,total_score=excluded.total_score,components=excluded.components,computed_at=now()
 returning id into result_id;
 return result_id;
end; $$;
revoke all on function public.crew_refresh_performance(uuid,date) from public,anon,authenticated;

create or replace function public.crew_performance_admin_data(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
 period date:=date_trunc('month',p_period)::date; employee record;
 rows jsonb:='[]'::jsonb; feedback_rows jsonb:='[]'::jsonb; review_rows jsonb:='[]'::jsonb; summary jsonb:='{}'::jsonb;
 framework jsonb:=jsonb_build_array(jsonb_build_object('key','attendance','label','Attendance','max_score',30),jsonb_build_object('key','service','label','Service','max_score',30),jsonb_build_object('key','customer','label','Customer','max_score',15),jsonb_build_object('key','knowledge','label','Knowledge','max_score',15),jsonb_build_object('key','conduct','label','Conduct','max_score',10));
 can_performance boolean:=public.current_user_has_permission('crew_performance.view');
 can_feedback boolean:=public.current_user_has_permission('crew_feedback.view');
 can_review boolean:=public.current_user_has_permission('crew_performance.review');
begin
 if not (can_performance or can_feedback) or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Performance is unavailable for this outlet.'; end if;
 if can_performance then
   for employee in select e.id from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') loop perform public.crew_refresh_performance(employee.id,period); end loop;
   select coalesce(jsonb_agg(jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),'result',jsonb_build_object('id',r.id,'status',r.status,'period_start',r.period_start,'current_score',r.current_score,'total_score',r.total_score,'attendance_score',r.attendance_score,'service_score',r.service_score,'customer_score',r.customer_score,'knowledge_score',r.knowledge_score,'conduct_score',r.conduct_score,'components',case when can_review then r.components else jsonb_set(jsonb_set(r.components,'{service}',coalesce(r.components->'service','{}'::jsonb)-('manager_note'::text)-('criteria'::text)),'{conduct}',coalesce(r.components->'conduct','{}'::jsonb)-('manager_note'::text)-('criteria'::text)) end,'calculation_version',r.calculation_version,'computed_at',r.computed_at,'finalized_at',r.finalized_at)) order by e.full_name),'[]'::jsonb) into rows
   from public.crew_performance_results r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and r.period_start=period;
   select jsonb_build_object('average_score',round(avg(total_score) filter(where total_score is not null),1),'reviewed',count(*) filter(where coalesce(components->'service'->>'status','review_required')='reviewed' and coalesce(components->'conduct'->>'status','review_required')='reviewed'),'awaiting_review',count(*) filter(where coalesce(components->'service'->>'status','review_required')<>'reviewed' or coalesce(components->'conduct'->>'status','review_required')<>'reviewed'),'crew_total',count(*)) into summary from public.crew_performance_results where outlet_id=p_outlet_id and period_start=period;
 end if;
 if can_feedback then
   select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'submitted_at',f.submitted_at,'employee_id',f.employee_id,'employee_name',e.full_name,'experience',f.experience,'positive_tags',f.positive_tags,'improvement_tags',f.improvement_tags,'comment',f.comment,'scoring_status',f.scoring_status) order by f.submitted_at desc),'[]'::jsonb) into feedback_rows from public.crew_customer_feedback f join public.employees e on e.id=f.employee_id where f.outlet_id=p_outlet_id and f.submitted_at>=period and f.submitted_at<(period+interval '1 month');
 end if;
 if can_review then
   select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,'employee_name',e.full_name,'position',e.position,'component',v.component,'criteria',v.criteria,'score',v.score,'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at) order by v.reviewed_at desc),'[]'::jsonb) into review_rows from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id where v.outlet_id=p_outlet_id and v.period_start=period;
 end if;
 return jsonb_build_object('period_start',period,'summary',summary,'scoring_framework',case when can_performance then framework else '[]'::jsonb end,'crew',rows,'reviews',review_rows,'feedback',feedback_rows);
end; $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;
