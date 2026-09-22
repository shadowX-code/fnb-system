-- Crew Phase C: versioned monthly Performance Engine, manager reviews,
-- controlled public guest feedback and Crew-safe own-result read model.

insert into public.permissions(code,module,description) values
 ('crew_performance.view','Crew Performance','View outlet-scoped Crew monthly performance.'),
 ('crew_performance.review','Crew Performance','Submit Service Standards and Conduct reviews.'),
 ('crew_performance.finalize','Crew Performance','Finalize immutable monthly Crew performance.'),
 ('crew_feedback.view','Crew Performance','View outlet-scoped customer feedback.'),
 ('crew_feedback.moderate','Crew Performance','Exclude feedback from scoring with an audited reason.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code in (
 'crew_performance.view','crew_performance.review','crew_performance.finalize','crew_feedback.view','crew_feedback.moderate'
) on conflict do nothing;

create table public.crew_performance_reviews (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 period_start date not null,
 component text not null check(component in ('service','conduct')),
 criteria jsonb not null,
 score numeric(5,2) not null,
 max_score integer not null check(max_score in (30,10)),
 calculation_version text not null default 'performance-v1',
 manager_note text,
 reviewed_by uuid not null references auth.users(id),
 reviewed_at timestamptz not null default now(),
 check(period_start=date_trunc('month',period_start)::date),
 check(score between 0 and max_score)
);
create index crew_performance_reviews_lookup_idx on public.crew_performance_reviews(employee_id,period_start,component,reviewed_at desc);

create table public.crew_customer_feedback (
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 employee_id uuid not null references public.employees(id) on delete restrict,
 experience text not null check(experience in ('great','okay','needs_improvement')),
 positive_tags text[] not null default '{}',
 improvement_tags text[] not null default '{}',
 comment text,
 request_hash text not null,
 scoring_status text not null default 'included' check(scoring_status in ('included','excluded')),
 submitted_at timestamptz not null default now(),
 excluded_at timestamptz,
 excluded_by uuid references auth.users(id),
 exclusion_reason text,
 check(char_length(coalesce(comment,''))<=500),
 check(cardinality(positive_tags)<=5 and cardinality(improvement_tags)<=5)
);
create index crew_customer_feedback_period_idx on public.crew_customer_feedback(outlet_id,submitted_at desc);
create index crew_customer_feedback_employee_idx on public.crew_customer_feedback(employee_id,submitted_at desc);
create index crew_customer_feedback_rate_idx on public.crew_customer_feedback(request_hash,submitted_at desc);

create table public.crew_feedback_moderation_audit (
 id uuid primary key default gen_random_uuid(),
 feedback_id uuid not null references public.crew_customer_feedback(id) on delete restrict,
 previous_status text not null,
 next_status text not null,
 reason text not null,
 changed_by uuid not null references auth.users(id),
 changed_at timestamptz not null default now()
);

create table public.crew_performance_results (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 period_start date not null,
 status text not null default 'draft' check(status in ('draft','review_required','finalized')),
 calculation_version text not null default 'performance-v1',
 attendance_score numeric(5,2),
 service_score numeric(5,2),
 customer_score numeric(5,2),
 knowledge_score numeric(5,2),
 conduct_score numeric(5,2),
 total_score numeric(6,2),
 components jsonb not null default '{}'::jsonb,
 computed_at timestamptz not null default now(),
 finalized_at timestamptz,
 finalized_by uuid references auth.users(id),
 check(period_start=date_trunc('month',period_start)::date),
 check(attendance_score between 0 and 30), check(service_score between 0 and 30),
 check(customer_score between 0 and 15), check(knowledge_score between 0 and 15),
 check(conduct_score between 0 and 10), check(total_score between 0 and 100),
 unique(employee_id,period_start)
);
create index crew_performance_results_outlet_period_idx on public.crew_performance_results(outlet_id,period_start,status);

alter table public.crew_performance_reviews enable row level security;
alter table public.crew_customer_feedback enable row level security;
alter table public.crew_feedback_moderation_audit enable row level security;
alter table public.crew_performance_results enable row level security;
revoke all on public.crew_performance_reviews,public.crew_customer_feedback,public.crew_feedback_moderation_audit,public.crew_performance_results from public,anon,authenticated;

create or replace function public.crew_performance_result_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
 if old.status='finalized' then
   raise exception using errcode='55000',message='Finalized performance is immutable.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function public.crew_performance_result_immutable() from public,anon,authenticated;
create trigger crew_performance_result_immutable before update or delete on public.crew_performance_results
for each row execute function public.crew_performance_result_immutable();

create or replace function public.crew_performance_review_score(p_component text,p_criteria jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare required_keys text[]; max_points numeric; item jsonb; k text; seen text[]:='{}'; observed int:=0; earned numeric:=0; rating text;
begin
 if p_component='service' then required_keys:=array['welcome_greeting','thank_you_goodbye','grooming','work_area_cleanliness','initiative','guest_interaction']; max_points:=30;
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
 return jsonb_build_object('score',round(max_points*earned/observed,2),'max_score',max_points,'observed_count',observed,'criteria_count',cardinality(required_keys),'calculation_version','performance-v1');
end; $$;
revoke all on function public.crew_performance_review_score(text,jsonb) from public,anon,authenticated;

create or replace function public.crew_performance_attendance_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare total_count int; completed_count int; incomplete_count int; exception_count int; verified_count int; component_score numeric;
begin
 select count(*),count(*) filter(where status='completed' and clock_out_at is not null),count(*) filter(where status<>'completed' or clock_out_at is null),
 count(*) filter(where coalesce(clock_in_location_exception,false) or coalesce(clock_out_location_exception,false)),
 count(*) filter(where coalesce(clock_in_location_verified,false) or coalesce(clock_out_location_verified,false))
 into total_count,completed_count,incomplete_count,exception_count,verified_count
 from public.crew_attendance_records where employee_id=p_employee_id and clock_in_at>=p_period and clock_in_at<(p_period+interval '1 month');
 component_score:=case when total_count=0 then 24 else round(greatest(0,30*(1-(incomplete_count::numeric/total_count)*0.5)),2) end;
 return jsonb_build_object('score',component_score,'max_score',30,'status',case when total_count=0 then 'insufficient_data' else 'calculated' end,
 'explanation',case when total_count=0 then 'No attendance records this month; v1 applies an 80% neutral baseline.' when incomplete_count=0 then 'All recorded shifts are complete. Location exceptions are evidence flags and are not penalized.' else incomplete_count||' incomplete attendance record(s) reduced this component.' end,
 'evidence',jsonb_build_object('records',total_count,'completed',completed_count,'incomplete',incomplete_count,'location_exceptions',exception_count,'location_verified',verified_count),'calculation_version','performance-v1');
end; $$;
revoke all on function public.crew_performance_attendance_component(uuid,date) from public,anon,authenticated;

create or replace function public.crew_performance_customer_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare n int; positive int; improvement int; raw numeric; score numeric; confidence text; v_positive_tags jsonb; v_improvement_tags jsonb;
begin
 select count(*),count(*) filter(where experience='great'),count(*) filter(where experience='needs_improvement'),
 coalesce(avg(case experience when 'great' then 1.0 when 'okay' then 0.65 else 0.25 end),0)
 into n,positive,improvement,raw from public.crew_customer_feedback
 where employee_id=p_employee_id and submitted_at>=p_period and submitted_at<(p_period+interval '1 month') and scoring_status='included';
 if n=0 then score:=12;confidence:='insufficient_data';
 elsif n<3 then score:=round(15*((raw*n+0.8*(3-n))/3),2);confidence:='low';
 else score:=round(15*raw,2);confidence:='established'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'count',tag_count) order by tag_count desc,tag),'[]'::jsonb) into v_positive_tags from (select unnest(f.positive_tags) tag,count(*) tag_count from public.crew_customer_feedback f where f.employee_id=p_employee_id and f.scoring_status='included' and f.submitted_at>=p_period and f.submitted_at<(p_period+interval '1 month') group by 1 order by 2 desc,1 limit 5) x;
 select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'count',tag_count) order by tag_count desc,tag),'[]'::jsonb) into v_improvement_tags from (select unnest(f.improvement_tags) tag,count(*) tag_count from public.crew_customer_feedback f where f.employee_id=p_employee_id and f.scoring_status='included' and f.submitted_at>=p_period and f.submitted_at<(p_period+interval '1 month') group by 1 order by 2 desc,1 limit 5) x;
 return jsonb_build_object('score',score,'max_score',15,'sample_count',n,'confidence',confidence,'positive_count',positive,'improvement_count',improvement,'top_positive_tags',v_positive_tags,'top_improvement_tags',v_improvement_tags,
 'explanation',case confidence when 'insufficient_data' then 'No feedback yet; v1 uses a neutral 12/15 baseline and marks the result insufficient.' when 'low' then 'One or two responses are blended with a neutral prior to avoid sample-size distortion.' else 'Three or more included responses use the transparent Great 100%, Okay 65%, Needs Improvement 25% formula.' end,'calculation_version','customer-feedback-v1');
end; $$;
revoke all on function public.crew_performance_customer_component(uuid,date) from public,anon,authenticated;

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
 return jsonb_build_object('score',score,'max_score',15,'status','calculated','explanation','v1 reuses durable onboarding, pinned SOP acknowledgements, passed quizzes and Growth learning evidence; completed historical onboarding remains valid.','evidence',jsonb_build_object('onboarding_ratio',round(onboarding_ratio,3),'sop_ratio',round(sop_ratio,3),'quiz_ratio',round(quiz_ratio,3),'growth_ratio',round(growth_ratio,3)),'calculation_version','performance-v1');
end; $$;
revoke all on function public.crew_performance_knowledge_component(uuid,date) from public,anon,authenticated;

create or replace function public.crew_refresh_performance(p_employee_id uuid,p_period date)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; outlet uuid; attendance jsonb; customer jsonb; knowledge jsonb; service_review public.crew_performance_reviews%rowtype; conduct_review public.crew_performance_reviews%rowtype; result_id uuid; total numeric; state text;
begin
 outlet:=public.crew_growth_employee_outlet(p_employee_id); if outlet is null then raise exception using errcode='22023',message='Crew outlet is unavailable.'; end if;
 if exists(select 1 from public.crew_performance_results where employee_id=p_employee_id and period_start=period and status='finalized') then return (select id from public.crew_performance_results where employee_id=p_employee_id and period_start=period); end if;
 attendance:=public.crew_performance_attendance_component(p_employee_id,period); customer:=public.crew_performance_customer_component(p_employee_id,period); knowledge:=public.crew_performance_knowledge_component(p_employee_id,period);
 select * into service_review from public.crew_performance_reviews where employee_id=p_employee_id and period_start=period and component='service' order by reviewed_at desc limit 1;
 select * into conduct_review from public.crew_performance_reviews where employee_id=p_employee_id and period_start=period and component='conduct' order by reviewed_at desc limit 1;
 state:=case when service_review.id is null or conduct_review.id is null then 'review_required' else 'draft' end;
 total:=case when service_review.id is null or conduct_review.id is null then null else round((attendance->>'score')::numeric+service_review.score+(customer->>'score')::numeric+(knowledge->>'score')::numeric+conduct_review.score,2) end;
 insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,attendance_score,service_score,customer_score,knowledge_score,conduct_score,total_score,components,computed_at)
 values(p_employee_id,outlet,period,state,(attendance->>'score')::numeric,service_review.score,(customer->>'score')::numeric,(knowledge->>'score')::numeric,conduct_review.score,total,
 jsonb_build_object('attendance',attendance,'service',case when service_review.id is null then jsonb_build_object('score',null,'max_score',30,'status','review_required','calculation_version','performance-v1') else jsonb_build_object('score',service_review.score,'max_score',30,'status','reviewed','criteria',service_review.criteria,'reviewed_at',service_review.reviewed_at,'calculation_version',service_review.calculation_version) end,'customer',customer,'knowledge',knowledge,'conduct',case when conduct_review.id is null then jsonb_build_object('score',null,'max_score',10,'status','review_required','calculation_version','performance-v1') else jsonb_build_object('score',conduct_review.score,'max_score',10,'status','reviewed','criteria',conduct_review.criteria,'reviewed_at',conduct_review.reviewed_at,'calculation_version',conduct_review.calculation_version) end),now())
 on conflict(employee_id,period_start) do update set outlet_id=excluded.outlet_id,status=excluded.status,attendance_score=excluded.attendance_score,service_score=excluded.service_score,customer_score=excluded.customer_score,knowledge_score=excluded.knowledge_score,conduct_score=excluded.conduct_score,total_score=excluded.total_score,components=excluded.components,computed_at=now()
 returning id into result_id; return result_id;
end; $$;
revoke all on function public.crew_refresh_performance(uuid,date) from public,anon,authenticated;

create or replace function public.crew_performance_submit_review(p_employee_id uuid,p_period date,p_component text,p_criteria jsonb,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare outlet uuid; calc jsonb; review_id uuid; result_id uuid;
begin
 if not public.current_user_has_permission('crew_performance.review') then raise exception using errcode='42501',message='Performance review permission is required.'; end if;
 outlet:=public.crew_growth_employee_outlet(p_employee_id);
 if outlet is null or not public.current_user_can_access_outlet(outlet) then raise exception using errcode='42501',message='Crew member is outside your outlet scope.'; end if;
 if char_length(coalesce(p_note,''))>1000 then raise exception using errcode='22023',message='Review note is too long.'; end if;
 calc:=public.crew_performance_review_score(p_component,p_criteria);
 insert into public.crew_performance_reviews(employee_id,outlet_id,period_start,component,criteria,score,max_score,manager_note,reviewed_by)
 values(p_employee_id,outlet,date_trunc('month',p_period)::date,p_component,p_criteria,(calc->>'score')::numeric,(calc->>'max_score')::int,nullif(btrim(p_note),''),auth.uid()) returning id into review_id;
 result_id:=public.crew_refresh_performance(p_employee_id,p_period);
 return jsonb_build_object('review_id',review_id,'result_id',result_id,'component',p_component,'score',(calc->>'score')::numeric,'max_score',(calc->>'max_score')::int,'reviewed_at',now());
end; $$;
revoke all on function public.crew_performance_submit_review(uuid,date,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crew_performance_submit_review(uuid,date,text,jsonb,text) to authenticated;

create or replace function public.crew_performance_finalize(p_employee_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare result public.crew_performance_results%rowtype; result_id uuid;
begin
 if not public.current_user_has_permission('crew_performance.finalize') then raise exception using errcode='42501',message='Performance finalization permission is required.'; end if;
 if not public.current_user_can_access_outlet(public.crew_growth_employee_outlet(p_employee_id)) then raise exception using errcode='42501',message='Crew member is outside your outlet scope.'; end if;
 result_id:=public.crew_refresh_performance(p_employee_id,p_period);
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
declare period date:=date_trunc('month',p_period)::date; employee record; rows jsonb; feedback_rows jsonb; review_rows jsonb; summary jsonb;
begin
 if not public.current_user_has_permission('crew_performance.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Performance is unavailable for this outlet.'; end if;
 for employee in select e.id from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') loop perform public.crew_refresh_performance(employee.id,period); end loop;
 select coalesce(jsonb_agg(jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),'result',jsonb_build_object('id',r.id,'status',r.status,'period_start',r.period_start,'total_score',r.total_score,'attendance_score',r.attendance_score,'service_score',r.service_score,'customer_score',r.customer_score,'knowledge_score',r.knowledge_score,'conduct_score',r.conduct_score,'components',r.components,'calculation_version',r.calculation_version,'computed_at',r.computed_at,'finalized_at',r.finalized_at)) order by e.full_name),'[]'::jsonb) into rows
 from public.crew_performance_results r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and r.period_start=period;
 select jsonb_build_object('average_score',round(avg(total_score) filter(where total_score is not null),1),'crew_reviewed',count(*) filter(where status='finalized'),'awaiting_review',count(*) filter(where status='review_required'),'needs_attention',count(*) filter(where total_score<70),'crew_total',count(*)) into summary from public.crew_performance_results where outlet_id=p_outlet_id and period_start=period;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'submitted_at',f.submitted_at,'employee_id',f.employee_id,'employee_name',e.full_name,'experience',f.experience,'positive_tags',f.positive_tags,'improvement_tags',f.improvement_tags,'comment',f.comment,'scoring_status',f.scoring_status) order by f.submitted_at desc),'[]'::jsonb) into feedback_rows from public.crew_customer_feedback f join public.employees e on e.id=f.employee_id where f.outlet_id=p_outlet_id and f.submitted_at>=period and f.submitted_at<(period+interval '1 month');
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,'employee_name',e.full_name,'position',e.position,'component',v.component,'criteria',v.criteria,'score',v.score,'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at) order by v.reviewed_at desc),'[]'::jsonb) into review_rows from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id where v.outlet_id=p_outlet_id and v.period_start=period;
 return jsonb_build_object('period_start',period,'summary',summary,'crew',rows,'reviews',review_rows,'feedback',feedback_rows);
end; $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;

create or replace function public.crew_feedback_moderate(p_feedback_id uuid,p_exclude boolean,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_customer_feedback%rowtype; next_status text; old_status text;
begin
 if not public.current_user_has_permission('crew_feedback.moderate') then raise exception using errcode='42501',message='Feedback moderation permission is required.'; end if;
 select * into row from public.crew_customer_feedback where id=p_feedback_id for update;
 if not found or not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Feedback is outside your outlet scope.'; end if;
 if char_length(btrim(coalesce(p_reason,'')))<5 then raise exception using errcode='22023',message='A moderation reason is required.'; end if;
 old_status:=row.scoring_status; next_status:=case when p_exclude then 'excluded' else 'included' end;
 update public.crew_customer_feedback set scoring_status=next_status,excluded_at=case when p_exclude then now() else null end,excluded_by=case when p_exclude then auth.uid() else null end,exclusion_reason=case when p_exclude then btrim(p_reason) else null end where id=row.id;
 insert into public.crew_feedback_moderation_audit(feedback_id,previous_status,next_status,reason,changed_by) values(row.id,old_status,next_status,btrim(p_reason),auth.uid());
 perform public.crew_refresh_performance(row.employee_id,date_trunc('month',row.submitted_at)::date);
 return jsonb_build_object('id',row.id,'scoring_status',next_status);
end; $$;
revoke all on function public.crew_feedback_moderate(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_moderate(uuid,boolean,text) to authenticated;

create or replace function public.crew_feedback_public_crew(p_outlet_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('outlet',jsonb_build_object('id',o.id,'name',o.name),'crew',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'on_shift',x.on_shift) order by x.on_shift desc,x.last_shift desc nulls last,x.full_name) from (select e.id,e.full_name,e.position,exists(select 1 from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.status='open') on_shift,(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.clock_in_at>now()-interval '14 days') last_shift from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=o.id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') and exists(select 1 from public.crew_attendance_records recent where recent.employee_id=e.id and recent.outlet_id=o.id and recent.clock_in_at>now()-interval '14 days') order by on_shift desc,last_shift desc nulls last limit 12) x),'[]'::jsonb)) from public.outlets o where o.id=p_outlet_id and o.is_active;
$$;
revoke all on function public.crew_feedback_public_crew(uuid) from public,anon,authenticated;
grant execute on function public.crew_feedback_public_crew(uuid) to anon,authenticated;

create or replace function public.crew_feedback_submit(p_outlet_id uuid,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare allowed_positive constant text[]:=array['Friendly','Helpful','Attentive','Fast','Knowledgeable']; allowed_improvement constant text[]:=array['Greeting','Response Time','Accuracy','Cleanliness','Product Knowledge']; req_headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb); ip text; v_request_hash text; feedback_id uuid;
begin
 if p_experience not in ('great','okay','needs_improvement') then raise exception using errcode='22023',message='Experience selection is invalid.'; end if;
 if char_length(coalesce(p_client_token,'')) not between 16 and 128 then raise exception using errcode='22023',message='Feedback session is invalid.'; end if;
 if coalesce(cardinality(p_positive_tags),0)>5 or coalesce(cardinality(p_improvement_tags),0)>5 or exists(select 1 from unnest(coalesce(p_positive_tags,'{}')) t where not(t=any(allowed_positive))) or exists(select 1 from unnest(coalesce(p_improvement_tags,'{}')) t where not(t=any(allowed_improvement))) then raise exception using errcode='22023',message='Feedback tags are invalid.'; end if;
 if char_length(coalesce(p_comment,''))>500 or coalesce(p_comment,'')~*'(https?://|<script|javascript:)' then raise exception using errcode='22023',message='Feedback comment is invalid.'; end if;
 if not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=p_employee_id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) then raise exception using errcode='22023',message='Crew selection is unavailable.'; end if;
 ip:=split_part(coalesce(req_headers->>'x-forwarded-for','unknown'),',',1); v_request_hash:=encode(extensions.digest(p_client_token||':'||ip,'sha256'),'hex');
 if (select count(*) from public.crew_customer_feedback f where f.request_hash=v_request_hash and f.submitted_at>now()-interval '1 hour')>=5 then raise exception using errcode='P0001',message='Too many feedback submissions. Please try again later.'; end if;
 if exists(select 1 from public.crew_customer_feedback f where f.request_hash=v_request_hash and f.outlet_id=p_outlet_id and f.employee_id=p_employee_id and f.submitted_at>now()-interval '12 hours') then raise exception using errcode='23505',message='Feedback was already submitted for this Crew member.'; end if;
 insert into public.crew_customer_feedback(outlet_id,employee_id,experience,positive_tags,improvement_tags,comment,request_hash) values(p_outlet_id,p_employee_id,p_experience,coalesce(p_positive_tags,'{}'),coalesce(p_improvement_tags,'{}'),nullif(btrim(p_comment),''),v_request_hash) returning id into feedback_id;
 perform public.crew_refresh_performance(p_employee_id,date_trunc('month',now())::date);
 return jsonb_build_object('id',feedback_id,'submitted_at',now(),'status','received');
end; $$;
revoke all on function public.crew_feedback_submit(uuid,uuid,text,text[],text[],text,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_submit(uuid,uuid,text,text[],text[],text,text) to anon,authenticated;

create or replace function public.crew_performance_mobile(p_token text,p_period date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid; result_id uuid; result public.crew_performance_results%rowtype; trend jsonb; safe_components jsonb;
begin
 employee:=public.crew_session_employee(p_token); result_id:=public.crew_refresh_performance(employee,p_period); select * into result from public.crew_performance_results where id=result_id;
 safe_components:=jsonb_build_object('attendance',(result.components->'attendance')-('manager_note'::text),'service',(result.components->'service')-('manager_note'::text),'customer',(result.components->'customer')-('moderation_reason'::text),'knowledge',result.components->'knowledge','conduct',(result.components->'conduct')-('manager_note'::text));
 select coalesce(jsonb_agg(jsonb_build_object('period_start',period_start,'score',total_score,'status',status) order by period_start),'[]'::jsonb) into trend from (select period_start,total_score,status from public.crew_performance_results where employee_id=employee order by period_start desc limit 6) x;
 return jsonb_build_object('period_start',result.period_start,'status',result.status,'score',result.total_score,'calculation_version',result.calculation_version,'breakdown',safe_components,'trend',trend,'updated_at',result.computed_at);
end; $$;
revoke all on function public.crew_performance_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_performance_mobile(text,date) to anon,authenticated;

-- Explicit function/table privileges. Internal helpers remain unreachable.
grant select,insert,update,delete on public.crew_performance_reviews,public.crew_customer_feedback,public.crew_feedback_moderation_audit,public.crew_performance_results to service_role;
