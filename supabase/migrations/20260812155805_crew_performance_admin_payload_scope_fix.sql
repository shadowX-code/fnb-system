-- Keep the consolidated Admin transport while enforcing each permission at the
-- field group it authorizes. Performance viewers cannot inherit raw feedback or
-- private manager review notes; feedback viewers do not need Performance access.
create or replace function public.crew_performance_admin_data(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
 period date:=date_trunc('month',p_period)::date; employee record;
 rows jsonb:='[]'::jsonb; feedback_rows jsonb:='[]'::jsonb; review_rows jsonb:='[]'::jsonb; summary jsonb:='{}'::jsonb;
 can_performance boolean:=public.current_user_has_permission('crew_performance.view');
 can_feedback boolean:=public.current_user_has_permission('crew_feedback.view');
 can_review boolean:=public.current_user_has_permission('crew_performance.review');
begin
 if not (can_performance or can_feedback) or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Performance is unavailable for this outlet.'; end if;
 if can_performance then
   for employee in select e.id from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') loop perform public.crew_refresh_performance(employee.id,period); end loop;
   select coalesce(jsonb_agg(jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),'result',jsonb_build_object('id',r.id,'status',r.status,'period_start',r.period_start,'total_score',r.total_score,'attendance_score',r.attendance_score,'service_score',r.service_score,'customer_score',r.customer_score,'knowledge_score',r.knowledge_score,'conduct_score',r.conduct_score,'components',case when can_review then r.components else jsonb_set(jsonb_set(r.components,'{service}',coalesce(r.components->'service','{}'::jsonb)-('manager_note'::text)-('criteria'::text)),'{conduct}',coalesce(r.components->'conduct','{}'::jsonb)-('manager_note'::text)-('criteria'::text)) end,'calculation_version',r.calculation_version,'computed_at',r.computed_at,'finalized_at',r.finalized_at)) order by e.full_name),'[]'::jsonb) into rows
   from public.crew_performance_results r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and r.period_start=period;
   select jsonb_build_object('average_score',round(avg(total_score) filter(where total_score is not null),1),'crew_reviewed',count(*) filter(where status='finalized'),'awaiting_review',count(*) filter(where status='review_required'),'needs_attention',count(*) filter(where total_score<70),'crew_total',count(*)) into summary from public.crew_performance_results where outlet_id=p_outlet_id and period_start=period;
 end if;
 if can_feedback then
   select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'submitted_at',f.submitted_at,'employee_id',f.employee_id,'employee_name',e.full_name,'experience',f.experience,'positive_tags',f.positive_tags,'improvement_tags',f.improvement_tags,'comment',f.comment,'scoring_status',f.scoring_status) order by f.submitted_at desc),'[]'::jsonb) into feedback_rows from public.crew_customer_feedback f join public.employees e on e.id=f.employee_id where f.outlet_id=p_outlet_id and f.submitted_at>=period and f.submitted_at<(period+interval '1 month');
 end if;
 if can_review then
   select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,'employee_name',e.full_name,'position',e.position,'component',v.component,'criteria',v.criteria,'score',v.score,'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at) order by v.reviewed_at desc),'[]'::jsonb) into review_rows from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id where v.outlet_id=p_outlet_id and v.period_start=period;
 end if;
 return jsonb_build_object('period_start',period,'summary',summary,'crew',rows,'reviews',review_rows,'feedback',feedback_rows);
end; $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;
