-- Restore the scoped Customer Feedback projection accidentally narrowed by the
-- Service Standards and progressive-score Performance read-model replacements.
-- Performance totals/current_score continue to come from the latest authority.
create or replace function public.crew_performance_admin_data(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
 period date:=date_trunc('month',p_period)::date; employee record;
 rows jsonb:='[]'::jsonb; feedback_rows jsonb:='[]'::jsonb; review_rows jsonb:='[]'::jsonb;
 summary jsonb:='{}'::jsonb; feedback_summary jsonb:='{}'::jsonb; feedback_crew jsonb:='[]'::jsonb;
 framework jsonb:=jsonb_build_array(jsonb_build_object('key','attendance','label','Attendance','max_score',30),jsonb_build_object('key','service','label','Service','max_score',30),jsonb_build_object('key','customer','label','Customer','max_score',15),jsonb_build_object('key','knowledge','label','Knowledge','max_score',15),jsonb_build_object('key','conduct','label','Conduct','max_score',10));
 can_performance boolean:=public.current_user_has_permission('crew_performance.view');
 can_feedback boolean:=public.current_user_has_permission('crew_feedback.view');
 can_review boolean:=public.current_user_has_permission('crew_performance.review');
begin
 if not (can_performance or can_feedback or can_review) or not public.current_user_can_access_outlet(p_outlet_id) then
   raise exception using errcode='42501',message='Performance is unavailable for this outlet.';
 end if;

 if can_performance then
   for employee in select e.id from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') loop
     perform public.crew_refresh_performance(employee.id,period);
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object(
     'employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),
     'result',jsonb_build_object('id',r.id,'status',r.status,'period_start',r.period_start,'current_score',r.current_score,'total_score',r.total_score,'attendance_score',r.attendance_score,'service_score',r.service_score,'customer_score',r.customer_score,'knowledge_score',r.knowledge_score,'conduct_score',r.conduct_score,'components',case when can_review then r.components else jsonb_set(jsonb_set(r.components,'{service}',coalesce(r.components->'service','{}'::jsonb)-('manager_note'::text)-('criteria'::text)),'{conduct}',coalesce(r.components->'conduct','{}'::jsonb)-('manager_note'::text)-('criteria'::text)) end,'calculation_version',r.calculation_version,'computed_at',r.computed_at,'finalized_at',r.finalized_at)
   ) order by e.full_name),'[]'::jsonb) into rows
   from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where r.outlet_id=p_outlet_id and r.period_start=period;
   select jsonb_build_object('average_score',round(avg(total_score) filter(where total_score is not null),1),'reviewed',count(*) filter(where coalesce(components->'service'->>'status','review_required')='reviewed' and coalesce(components->'conduct'->>'status','review_required')='reviewed'),'awaiting_review',count(*) filter(where coalesce(components->'service'->>'status','review_required')<>'reviewed' or coalesce(components->'conduct'->>'status','review_required')<>'reviewed'),'crew_total',count(*))
   into summary from public.crew_performance_results where outlet_id=p_outlet_id and period_start=period;
 end if;

 if can_feedback then
   select jsonb_build_object('total_feedback',count(*),'crew_feedback',count(*) filter(where scope='crew'),'food_feedback',count(*) filter(where scope='food'),'outlet_feedback',count(*) filter(where scope='outlet'),'included_feedback',count(*) filter(where scope='crew' and scoring_status='included'),'positive_feedback',count(*) filter(where experience='great'),'needs_improvement_feedback',count(*) filter(where experience='needs_improvement'),'excluded_feedback',count(*) filter(where scope='crew' and scoring_status='excluded'))
   into feedback_summary from public.crew_customer_feedback
   where outlet_id=p_outlet_id and submitted_at>=period and submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object(
     'id',f.id,'scope',f.scope,'submitted_at',f.submitted_at,'employee_id',f.employee_id,'employee_name',e.full_name,'employee_position',e.position,'experience',f.experience,'positive_tags',f.positive_tags,'improvement_tags',f.improvement_tags,'comment',f.comment,'scoring_status',f.scoring_status,'excluded_at',f.excluded_at,'excluded_by_name',coalesce(excluded_employee.full_name,excluded_user.email),'exclusion_reason',f.exclusion_reason,
     'moderation_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_status',a.previous_status,'next_status',a.next_status,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_moderation_audit a left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb),
     'attribution_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_employee_id',a.previous_employee_id,'previous_employee_name',previous_employee.full_name,'next_employee_id',a.next_employee_id,'next_employee_name',next_employee.full_name,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_attribution_audit a join public.employees previous_employee on previous_employee.id=a.previous_employee_id join public.employees next_employee on next_employee.id=a.next_employee_id left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb)
   ) order by f.submitted_at desc),'[]'::jsonb) into feedback_rows
   from public.crew_customer_feedback f
   left join public.employees e on e.id=f.employee_id
   left join public.employees excluded_employee on excluded_employee.auth_user_id=f.excluded_by
   left join auth.users excluded_user on excluded_user.id=f.excluded_by
   where f.outlet_id=p_outlet_id and f.submitted_at>=period and f.submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'availability',x.availability) order by x.full_name),'[]'::jsonb) into feedback_crew
   from (select distinct e.id,e.full_name,e.position,case when ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') then 'active' else 'historical' end availability from public.employees e left join public.crew_access ca on ca.employee_id=e.id where (ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) or exists(select 1 from public.crew_customer_feedback historical where historical.outlet_id=p_outlet_id and historical.scope='crew' and historical.employee_id=e.id)) x;
 end if;

 if can_review then
   select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,'employee_name',e.full_name,'position',e.position,'component',v.component,'criteria',v.criteria,'score',v.score,'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at) order by v.reviewed_at desc),'[]'::jsonb) into review_rows
   from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id
   where v.outlet_id=p_outlet_id and v.period_start=period;
 end if;

 return jsonb_build_object('period_start',period,'period',period,'summary',summary,'scoring_framework',case when can_performance then framework else '[]'::jsonb end,'crew',rows,'reviews',review_rows,'feedback',feedback_rows,'feedback_summary',feedback_summary,'feedback_crew',feedback_crew);
end; $$;

revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;
