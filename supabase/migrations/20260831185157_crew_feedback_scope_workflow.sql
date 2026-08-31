-- Customer Feedback owns raw guest evidence across Crew, food and outlet scopes.
-- Only Crew-scoped evidence can be attributed, moderated for scoring, or consumed by Performance.
alter table public.crew_customer_feedback
  add column if not exists scope text;

update public.crew_customer_feedback
set scope = 'crew'
where scope is null;

alter table public.crew_customer_feedback
  alter column scope set default 'crew',
  alter column scope set not null,
  alter column employee_id drop not null;

alter table public.crew_customer_feedback
  drop constraint if exists crew_customer_feedback_scope_check,
  drop constraint if exists crew_customer_feedback_scope_employee_check,
  drop constraint if exists crew_customer_feedback_scoring_status_check;

alter table public.crew_customer_feedback
  add constraint crew_customer_feedback_scope_check check (scope in ('crew', 'food', 'outlet')),
  add constraint crew_customer_feedback_scope_employee_check check (
    (scope = 'crew' and employee_id is not null)
    or (scope in ('food', 'outlet') and employee_id is null)
  ),
  add constraint crew_customer_feedback_scoring_status_check check (scoring_status in ('included', 'excluded', 'not_applicable'));

create index if not exists crew_customer_feedback_scope_period_idx
  on public.crew_customer_feedback(outlet_id, scope, submitted_at desc);

create or replace function public.crew_performance_customer_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare n int; positive int; improvement int; raw numeric; score numeric; confidence text; v_positive_tags jsonb; v_improvement_tags jsonb;
begin
 select count(*),count(*) filter(where experience='great'),count(*) filter(where experience='needs_improvement'),
 coalesce(avg(case experience when 'great' then 1.0 when 'okay' then 0.65 else 0.25 end),0)
 into n,positive,improvement,raw from public.crew_customer_feedback
 where employee_id=p_employee_id and scope='crew' and submitted_at>=p_period and submitted_at<(p_period+interval '1 month') and scoring_status='included';
 if n=0 then score:=12;confidence:='insufficient_data';
 elsif n<3 then score:=round(15*((raw*n+0.8*(3-n))/3),2);confidence:='low';
 else score:=round(15*raw,2);confidence:='established'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'count',tag_count) order by tag_count desc,tag),'[]'::jsonb) into v_positive_tags from (select unnest(f.positive_tags) tag,count(*) tag_count from public.crew_customer_feedback f where f.employee_id=p_employee_id and f.scope='crew' and f.scoring_status='included' and f.submitted_at>=p_period and f.submitted_at<(p_period+interval '1 month') group by 1 order by 2 desc,1 limit 5) x;
 select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'count',tag_count) order by tag_count desc,tag),'[]'::jsonb) into v_improvement_tags from (select unnest(f.improvement_tags) tag,count(*) tag_count from public.crew_customer_feedback f where f.employee_id=p_employee_id and f.scope='crew' and f.scoring_status='included' and f.submitted_at>=p_period and f.submitted_at<(p_period+interval '1 month') group by 1 order by 2 desc,1 limit 5) x;
 return jsonb_build_object('score',score,'max_score',15,'sample_count',n,'confidence',confidence,'positive_count',positive,'improvement_count',improvement,'top_positive_tags',v_positive_tags,'top_improvement_tags',v_improvement_tags,
 'explanation',case confidence when 'insufficient_data' then 'No feedback yet; v1 uses a neutral 12/15 baseline and marks the result insufficient.' when 'low' then 'One or two responses are blended with a neutral prior to avoid sample-size distortion.' else 'Three or more included responses use the transparent Great 100%, Okay 65%, Needs Improvement 25% formula.' end,'calculation_version','customer-feedback-v1');
end; $$;
revoke all on function public.crew_performance_customer_component(uuid,date) from public,anon,authenticated;

create or replace function public.crew_feedback_submit_scoped(p_outlet_id uuid,p_scope text,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  allowed_positive text[];
  allowed_improvement text[];
  req_headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  ip text;
  v_request_hash text;
  feedback_id uuid;
begin
 if p_scope not in ('crew','food','outlet') then raise exception using errcode='22023',message='Feedback type is invalid.'; end if;
 if p_experience not in ('great','okay','needs_improvement') then raise exception using errcode='22023',message='Experience selection is invalid.'; end if;
 if char_length(coalesce(p_client_token,'')) not between 16 and 128 then raise exception using errcode='22023',message='Feedback session is invalid.'; end if;
 if p_scope='crew' then
   allowed_positive:=array['Friendly','Helpful','Attentive','Fast','Knowledgeable'];
   allowed_improvement:=array['Greeting','Response Time','Accuracy','Cleanliness','Product Knowledge'];
   if p_employee_id is null or not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=p_employee_id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) then raise exception using errcode='22023',message='Crew selection is unavailable.'; end if;
 elsif p_scope='food' then
   allowed_positive:=array['Taste','Portion','Temperature','Presentation','Value','Freshness'];
   allowed_improvement:=allowed_positive;
   if p_employee_id is not null then raise exception using errcode='22023',message='Food feedback cannot be assigned to Crew.'; end if;
 else
   allowed_positive:=array['Cleanliness','Service Speed','Atmosphere','Ordering','Waiting Time','Comfort','Overall Value'];
   allowed_improvement:=allowed_positive;
   if p_employee_id is not null then raise exception using errcode='22023',message='Outlet feedback cannot be assigned to Crew.'; end if;
 end if;
 if coalesce(cardinality(p_positive_tags),0)>5 or coalesce(cardinality(p_improvement_tags),0)>5 or exists(select 1 from unnest(coalesce(p_positive_tags,'{}')) t where not(t=any(allowed_positive))) or exists(select 1 from unnest(coalesce(p_improvement_tags,'{}')) t where not(t=any(allowed_improvement))) then raise exception using errcode='22023',message='Feedback tags are invalid.'; end if;
 if char_length(coalesce(p_comment,''))>500 or coalesce(p_comment,'')~*'(https?://|<script|javascript:)' then raise exception using errcode='22023',message='Feedback comment is invalid.'; end if;
 ip:=split_part(coalesce(req_headers->>'x-forwarded-for','unknown'),',',1); v_request_hash:=encode(extensions.digest(p_client_token||':'||ip,'sha256'),'hex');
 if (select count(*) from public.crew_customer_feedback f where f.request_hash=v_request_hash and f.submitted_at>now()-interval '1 hour')>=5 then raise exception using errcode='P0001',message='Too many feedback submissions. Please try again later.'; end if;
 if exists(select 1 from public.crew_customer_feedback f where f.request_hash=v_request_hash and f.outlet_id=p_outlet_id and f.scope=p_scope and f.employee_id is not distinct from p_employee_id and f.submitted_at>now()-interval '12 hours') then raise exception using errcode='23505',message=case when p_scope='crew' then 'Feedback was already submitted for this Crew member.' else 'Feedback was already submitted for this visit.' end; end if;
 insert into public.crew_customer_feedback(outlet_id,scope,employee_id,experience,positive_tags,improvement_tags,comment,request_hash,scoring_status)
 values(p_outlet_id,p_scope,p_employee_id,p_experience,coalesce(p_positive_tags,'{}'),coalesce(p_improvement_tags,'{}'),nullif(btrim(p_comment),''),v_request_hash,case when p_scope='crew' then 'included' else 'not_applicable' end)
 returning id into feedback_id;
 if p_scope='crew' then perform public.crew_refresh_performance(p_employee_id,date_trunc('month',now())::date); end if;
 return jsonb_build_object('id',feedback_id,'scope',p_scope,'submitted_at',now(),'status','received');
end; $$;
revoke all on function public.crew_feedback_submit_scoped(uuid,text,uuid,text,text[],text[],text,text) from public,anon,authenticated;

create or replace function public.crew_feedback_submit(p_outlet_id uuid,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text)
returns jsonb language sql volatile security definer set search_path=public as $$
  select public.crew_feedback_submit_scoped(p_outlet_id,'crew',p_employee_id,p_experience,p_positive_tags,p_improvement_tags,p_comment,p_client_token);
$$;
revoke all on function public.crew_feedback_submit(uuid,uuid,text,text[],text[],text,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_submit(uuid,uuid,text,text[],text[],text,text) to anon,authenticated;

create or replace function public.crew_feedback_submit_public(p_outlet_token text,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_outlet_id uuid;
begin
 select o.id into v_outlet_id from public.outlets o where o.public_feedback_token=lower(btrim(p_outlet_token)) and o.is_active;
 if v_outlet_id is null then raise exception using errcode='22023',message='Feedback link is unavailable.'; end if;
 return public.crew_feedback_submit_scoped(v_outlet_id,'crew',p_employee_id,p_experience,p_positive_tags,p_improvement_tags,p_comment,p_client_token);
end; $$;
revoke all on function public.crew_feedback_submit_public(text,uuid,text,text[],text[],text,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_submit_public(text,uuid,text,text[],text[],text,text) to anon,authenticated;

create or replace function public.crew_feedback_submit_public_v2(p_outlet_token text,p_scope text,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_outlet_id uuid;
begin
 select o.id into v_outlet_id from public.outlets o where o.public_feedback_token=lower(btrim(p_outlet_token)) and o.is_active;
 if v_outlet_id is null then raise exception using errcode='22023',message='Feedback link is unavailable.'; end if;
 return public.crew_feedback_submit_scoped(v_outlet_id,p_scope,p_employee_id,p_experience,p_positive_tags,p_improvement_tags,p_comment,p_client_token);
end; $$;
revoke all on function public.crew_feedback_submit_public_v2(text,text,uuid,text,text[],text[],text,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_submit_public_v2(text,text,uuid,text,text[],text[],text,text) to anon,authenticated;

create or replace function public.crew_feedback_moderate(p_feedback_id uuid,p_exclude boolean,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_customer_feedback%rowtype; next_status text; old_status text; period date;
begin
 if not public.current_user_has_permission('crew_feedback.moderate') then raise exception using errcode='42501',message='Customer Feedback moderation permission is required.'; end if;
 if char_length(btrim(coalesce(p_reason,'')))<5 then raise exception using errcode='22023',message='A meaningful moderation reason is required.'; end if;
 select * into row from public.crew_customer_feedback where id=p_feedback_id for update;
 if row.id is null then raise exception using errcode='P0002',message='Feedback was not found.'; end if;
 if row.scope<>'crew' then raise exception using errcode='22023',message='Only Crew feedback has a scoring status.'; end if;
 if not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Feedback is outside your outlet scope.'; end if;
 next_status:=case when p_exclude then 'excluded' else 'included' end; old_status:=row.scoring_status;
 if old_status=next_status then raise exception using errcode='22023',message=case when p_exclude then 'Feedback is already excluded.' else 'Feedback is already included.' end; end if;
 update public.crew_customer_feedback set scoring_status=next_status,excluded_at=case when p_exclude then now() else null end,excluded_by=case when p_exclude then auth.uid() else null end,exclusion_reason=case when p_exclude then btrim(p_reason) else null end where id=row.id;
 insert into public.crew_feedback_moderation_audit(feedback_id,previous_status,next_status,reason,changed_by) values(row.id,old_status,next_status,btrim(p_reason),auth.uid());
 period:=date_trunc('month',row.submitted_at)::date; perform public.crew_feedback_refresh_mutable_performance(row.employee_id,row.outlet_id,period);
 return jsonb_build_object('id',row.id,'scoring_status',next_status,'period',period);
end; $$;
revoke all on function public.crew_feedback_moderate(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_moderate(uuid,boolean,text) to authenticated;

create or replace function public.crew_feedback_correct_attribution(p_feedback_id uuid,p_employee_id uuid,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_customer_feedback%rowtype; period date;
begin
 if not public.current_user_has_permission('crew_feedback.correct_attribution') then raise exception using errcode='42501',message='Customer Feedback attribution correction permission is required.'; end if;
 if char_length(btrim(coalesce(p_reason,'')))<5 then raise exception using errcode='22023',message='A meaningful attribution correction reason is required.'; end if;
 select * into row from public.crew_customer_feedback where id=p_feedback_id for update;
 if row.id is null then raise exception using errcode='P0002',message='Feedback was not found.'; end if;
 if row.scope<>'crew' then raise exception using errcode='22023',message='Only Crew feedback can be attributed.'; end if;
 if not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Feedback is outside your outlet scope.'; end if;
 if p_employee_id is null or p_employee_id=row.employee_id then raise exception using errcode='22023',message='Choose a different Crew member.'; end if;
 if not exists(select 1 from public.employees e left join public.crew_access ca on ca.employee_id=e.id where e.id=p_employee_id and ((ca.primary_outlet_id=row.outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) or exists(select 1 from public.crew_customer_feedback historical where historical.outlet_id=row.outlet_id and historical.employee_id=e.id))) then raise exception using errcode='22023',message='Crew selection is unavailable for this outlet.'; end if;
 update public.crew_customer_feedback set employee_id=p_employee_id where id=row.id;
 insert into public.crew_feedback_attribution_audit(feedback_id,previous_employee_id,next_employee_id,reason,changed_by) values(row.id,row.employee_id,p_employee_id,btrim(p_reason),auth.uid());
 period:=date_trunc('month',row.submitted_at)::date; perform public.crew_feedback_refresh_mutable_performance(row.employee_id,row.outlet_id,period); perform public.crew_feedback_refresh_mutable_performance(p_employee_id,row.outlet_id,period);
 return jsonb_build_object('id',row.id,'previous_employee_id',row.employee_id,'employee_id',p_employee_id,'period',period);
end; $$;
revoke all on function public.crew_feedback_correct_attribution(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_correct_attribution(uuid,uuid,text) to authenticated;

create or replace function public.crew_performance_admin_data(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; can_performance boolean:=public.current_user_has_permission('crew_performance.view'); can_feedback boolean:=public.current_user_has_permission('crew_feedback.view'); can_review boolean:=public.current_user_has_permission('crew_performance.review'); summary jsonb:='{}'::jsonb; crew_rows jsonb:='[]'::jsonb; feedback_rows jsonb:='[]'::jsonb; review_rows jsonb:='[]'::jsonb; feedback_summary jsonb:='{}'::jsonb; feedback_crew jsonb:='[]'::jsonb; employee record;
begin
 if not(can_performance or can_feedback or can_review) then raise exception using errcode='42501',message='Crew Performance permission is required.'; end if;
 if p_outlet_id is null or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Outlet is outside your scope.'; end if;
 if can_performance then
   for employee in select e.id from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') loop perform public.crew_refresh_performance(employee.id,period); end loop;
   select jsonb_build_object('average_score',round(avg(r.total_score),1),'crew_reviewed',count(*) filter(where r.status in ('draft','finalized')),'awaiting_review',count(*) filter(where r.status='review_required'),'needs_attention',count(*) filter(where r.total_score is not null and r.total_score<70)) into summary from public.crew_performance_results r where r.outlet_id=p_outlet_id and r.period_start=period;
   select coalesce(jsonb_agg(jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),'result',to_jsonb(r)) order by e.full_name),'[]'::jsonb) into crew_rows from public.crew_performance_results r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and r.period_start=period;
 end if;
 if can_feedback then
   select jsonb_build_object('total_feedback',count(*),'crew_feedback',count(*) filter(where scope='crew'),'food_feedback',count(*) filter(where scope='food'),'outlet_feedback',count(*) filter(where scope='outlet'),'included_feedback',count(*) filter(where scope='crew' and scoring_status='included'),'positive_feedback',count(*) filter(where experience='great'),'needs_improvement_feedback',count(*) filter(where experience='needs_improvement'),'excluded_feedback',count(*) filter(where scope='crew' and scoring_status='excluded')) into feedback_summary from public.crew_customer_feedback where outlet_id=p_outlet_id and submitted_at>=period and submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'scope',f.scope,'submitted_at',f.submitted_at,'employee_id',f.employee_id,'employee_name',e.full_name,'employee_position',e.position,'experience',f.experience,'positive_tags',f.positive_tags,'improvement_tags',f.improvement_tags,'comment',f.comment,'scoring_status',f.scoring_status,'excluded_at',f.excluded_at,'excluded_by_name',coalesce(excluded_employee.full_name,excluded_user.email),'exclusion_reason',f.exclusion_reason,'moderation_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_status',a.previous_status,'next_status',a.next_status,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_moderation_audit a left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb),'attribution_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_employee_id',a.previous_employee_id,'previous_employee_name',previous_employee.full_name,'next_employee_id',a.next_employee_id,'next_employee_name',next_employee.full_name,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_attribution_audit a join public.employees previous_employee on previous_employee.id=a.previous_employee_id join public.employees next_employee on next_employee.id=a.next_employee_id left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb)) order by f.submitted_at desc),'[]'::jsonb) into feedback_rows from public.crew_customer_feedback f left join public.employees e on e.id=f.employee_id left join public.employees excluded_employee on excluded_employee.auth_user_id=f.excluded_by left join auth.users excluded_user on excluded_user.id=f.excluded_by where f.outlet_id=p_outlet_id and f.submitted_at>=period and f.submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'availability',x.availability) order by x.full_name),'[]'::jsonb) into feedback_crew from (select distinct e.id,e.full_name,e.position,case when ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') then 'active' else 'historical' end availability from public.employees e left join public.crew_access ca on ca.employee_id=e.id where (ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) or exists(select 1 from public.crew_customer_feedback historical where historical.outlet_id=p_outlet_id and historical.scope='crew' and historical.employee_id=e.id)) x;
 end if;
 if can_review then select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,'employee_name',e.full_name,'position',e.position,'component',v.component,'criteria',v.criteria,'score',v.score,'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at) order by v.reviewed_at desc),'[]'::jsonb) into review_rows from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id where v.outlet_id=p_outlet_id and v.period_start=period; end if;
 return jsonb_build_object('period',period,'summary',coalesce(summary,'{}'::jsonb),'crew',coalesce(crew_rows,'[]'::jsonb),'reviews',coalesce(review_rows,'[]'::jsonb),'feedback',coalesce(feedback_rows,'[]'::jsonb),'feedback_summary',coalesce(feedback_summary,'{}'::jsonb),'feedback_crew',coalesce(feedback_crew,'[]'::jsonb));
end; $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;
