-- Retire Initiative from current Service Standards without rewriting historical
-- review snapshots. The review submission guard also closes the gap between a
-- finalized result and late review inserts.
create or replace function public.crew_performance_review_score(p_component text,p_criteria jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare required_keys text[]; max_points numeric; item jsonb; k text; seen text[]:='{}'; observed int:=0; earned numeric:=0; rating text;
begin
 if p_component='service' then required_keys:=array['welcome_greeting','thank_you_goodbye','grooming','work_area_cleanliness','guest_interaction']; max_points:=30;
 elsif p_component='conduct' then required_keys:=array['professional_conduct','teamwork','responsibility','communication','policy_compliance']; max_points:=10;
 else raise exception using errcode='22023',message='Unsupported review component.'; end if;
 if jsonb_typeof(p_criteria)<>'array' or jsonb_array_length(p_criteria)<>cardinality(required_keys) then raise exception using errcode='22023',message='Every review criterion is required.'; end if;
 for item in select value from jsonb_array_elements(p_criteria) loop
   if jsonb_typeof(item)<>'object' or not (item ? 'key') or not (item ? 'rating') or item ?| array['score','points','is_correct'] then raise exception using errcode='22023',message='Review criteria payload is invalid.'; end if;
   k:=item->>'key'; rating:=item->>'rating';
   if not(k=any(required_keys)) or k=any(seen) then raise exception using errcode='22023',message='Review criteria contain an unknown or duplicate item.'; end if;
   if rating not in ('meets_standard','needs_improvement','not_observed') then raise exception using errcode='22023',message='Review rating is invalid.'; end if;
   seen:=array_append(seen,k);
   if rating<>'not_observed' then observed:=observed+1; earned:=earned+case rating when 'meets_standard' then 1 else 0.5 end; end if;
 end loop;
 if observed=0 then raise exception using errcode='22023',message='At least one criterion must be observed.'; end if;
 return jsonb_build_object('score',round(max_points*earned/observed,2),'max_score',max_points,'observed_count',observed,'criteria_count',cardinality(required_keys),'calculation_version',case when p_component='service' then 'service-standards-v2' else 'performance-v1' end);
end; $$;
revoke all on function public.crew_performance_review_score(text,jsonb) from public,anon,authenticated;

create or replace function public.crew_performance_submit_review(p_employee_id uuid,p_period date,p_component text,p_criteria jsonb,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; outlet uuid; calc jsonb; review_id uuid; result_id uuid;
begin
 if not public.current_user_has_permission('crew_performance.review') then raise exception using errcode='42501',message='Performance review permission is required.'; end if;
 outlet:=public.crew_growth_employee_outlet(p_employee_id);
 if outlet is null or not public.current_user_can_access_outlet(outlet) then raise exception using errcode='42501',message='Crew member is outside your outlet scope.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text||':'||period::text,0));
 if exists(select 1 from public.crew_performance_results where employee_id=p_employee_id and period_start=period and status='finalized') then raise exception using errcode='22023',message='Finalized Performance cannot receive new review evidence.'; end if;
 if char_length(coalesce(p_note,''))>1000 then raise exception using errcode='22023',message='Review note is too long.'; end if;
 calc:=public.crew_performance_review_score(p_component,p_criteria);
 insert into public.crew_performance_reviews(employee_id,outlet_id,period_start,component,criteria,score,max_score,calculation_version,manager_note,reviewed_by)
 values(p_employee_id,outlet,period,p_component,p_criteria,(calc->>'score')::numeric,(calc->>'max_score')::int,calc->>'calculation_version',nullif(btrim(p_note),''),auth.uid()) returning id into review_id;
 result_id:=public.crew_refresh_performance(p_employee_id,period);
 return jsonb_build_object('review_id',review_id,'result_id',result_id,'component',p_component,'score',(calc->>'score')::numeric,'max_score',(calc->>'max_score')::int,'reviewed_at',now());
end; $$;
revoke all on function public.crew_performance_submit_review(uuid,date,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crew_performance_submit_review(uuid,date,text,jsonb,text) to authenticated;

create or replace function public.crew_performance_finalize(p_employee_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; result public.crew_performance_results%rowtype; result_id uuid;
begin
 if not public.current_user_has_permission('crew_performance.finalize') then raise exception using errcode='42501',message='Performance finalization permission is required.'; end if;
 if not public.current_user_can_access_outlet(public.crew_growth_employee_outlet(p_employee_id)) then raise exception using errcode='42501',message='Crew member is outside your outlet scope.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text||':'||period::text,0));
 result_id:=public.crew_refresh_performance(p_employee_id,period);
 select * into result from public.crew_performance_results where id=result_id for update;
 if result.status='finalized' then return jsonb_build_object('id',result.id,'status',result.status,'total_score',result.total_score,'finalized_at',result.finalized_at); end if;
 if result.service_score is null or result.conduct_score is null or result.total_score is null then raise exception using errcode='22023',message='Service Standards and Conduct reviews are required before finalization.'; end if;
 update public.crew_performance_results set status='finalized',finalized_at=now(),finalized_by=auth.uid() where id=result.id returning * into result;
 return jsonb_build_object('id',result.id,'status',result.status,'total_score',result.total_score,'finalized_at',result.finalized_at,'breakdown',result.components,'calculation_version',result.calculation_version);
end; $$;
revoke all on function public.crew_performance_finalize(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_finalize(uuid,date) to authenticated;

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
   select coalesce(jsonb_agg(jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),'result',jsonb_build_object('id',r.id,'status',r.status,'period_start',r.period_start,'total_score',r.total_score,'attendance_score',r.attendance_score,'service_score',r.service_score,'customer_score',r.customer_score,'knowledge_score',r.knowledge_score,'conduct_score',r.conduct_score,'components',case when can_review then r.components else jsonb_set(jsonb_set(r.components,'{service}',coalesce(r.components->'service','{}'::jsonb)-('manager_note'::text)-('criteria'::text)),'{conduct}',coalesce(r.components->'conduct','{}'::jsonb)-('manager_note'::text)-('criteria'::text)) end,'calculation_version',r.calculation_version,'computed_at',r.computed_at,'finalized_at',r.finalized_at)) order by e.full_name),'[]'::jsonb) into rows
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
