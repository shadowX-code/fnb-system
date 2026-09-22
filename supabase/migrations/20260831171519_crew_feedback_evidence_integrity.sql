-- Customer Feedback Evidence Integrity: controlled moderation reversals,
-- attribution corrections, and an Admin read model that keeps raw evidence visible.

insert into public.permissions(code,module,description) values
 ('crew_feedback.correct_attribution','Crew Performance','Correct customer feedback Crew attribution with an audited reason.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code='crew_feedback.correct_attribution'
on conflict do nothing;

create table public.crew_feedback_attribution_audit (
 id uuid primary key default gen_random_uuid(),
 feedback_id uuid not null references public.crew_customer_feedback(id) on delete restrict,
 previous_employee_id uuid not null references public.employees(id) on delete restrict,
 next_employee_id uuid not null references public.employees(id) on delete restrict,
 reason text not null,
 changed_by uuid not null references auth.users(id),
 changed_at timestamptz not null default now(),
 check(previous_employee_id <> next_employee_id),
 check(char_length(btrim(reason)) >= 5)
);
create index crew_feedback_attribution_audit_feedback_idx on public.crew_feedback_attribution_audit(feedback_id,changed_at desc);

alter table public.crew_feedback_attribution_audit enable row level security;
revoke all on public.crew_feedback_attribution_audit from public,anon,authenticated;
grant select,insert,update,delete on public.crew_feedback_attribution_audit to service_role;

create or replace function public.crew_feedback_refresh_mutable_performance(p_employee_id uuid,p_outlet_id uuid,p_period date)
returns void language plpgsql volatile security definer set search_path=public as $$
declare v_currently_scoped boolean:=false;
begin
 select exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=p_employee_id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) into v_currently_scoped;
 if v_currently_scoped and not exists(select 1 from public.crew_performance_results r where r.employee_id=p_employee_id and r.period_start=date_trunc('month',p_period)::date and r.status='finalized') then
   perform public.crew_refresh_performance(p_employee_id,p_period);
 end if;
end; $$;
revoke all on function public.crew_feedback_refresh_mutable_performance(uuid,uuid,date) from public,anon,authenticated;

create or replace function public.crew_feedback_moderate(p_feedback_id uuid,p_exclude boolean,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_customer_feedback%rowtype; next_status text; old_status text; period date;
begin
 if not public.current_user_has_permission('crew_feedback.moderate') then raise exception using errcode='42501',message='Customer Feedback moderation permission is required.'; end if;
 if char_length(btrim(coalesce(p_reason,'')))<5 then raise exception using errcode='22023',message='A meaningful moderation reason is required.'; end if;
 select * into row from public.crew_customer_feedback where id=p_feedback_id for update;
 if row.id is null then raise exception using errcode='P0002',message='Feedback was not found.'; end if;
 if not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Feedback is outside your outlet scope.'; end if;
 next_status:=case when p_exclude then 'excluded' else 'included' end; old_status:=row.scoring_status;
 if old_status=next_status then raise exception using errcode='22023',message=case when p_exclude then 'Feedback is already excluded.' else 'Feedback is already included.' end; end if;
 update public.crew_customer_feedback set scoring_status=next_status,excluded_at=case when p_exclude then now() else null end,excluded_by=case when p_exclude then auth.uid() else null end,exclusion_reason=case when p_exclude then btrim(p_reason) else null end where id=row.id;
 insert into public.crew_feedback_moderation_audit(feedback_id,previous_status,next_status,reason,changed_by) values(row.id,old_status,next_status,btrim(p_reason),auth.uid());
 period:=date_trunc('month',row.submitted_at)::date;
 perform public.crew_feedback_refresh_mutable_performance(row.employee_id,row.outlet_id,period);
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
 if not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Feedback is outside your outlet scope.'; end if;
 if p_employee_id is null or p_employee_id=row.employee_id then raise exception using errcode='22023',message='Choose a different Crew member.'; end if;
 if not exists(
   select 1 from public.employees e left join public.crew_access ca on ca.employee_id=e.id
   where e.id=p_employee_id and (
     (ca.primary_outlet_id=row.outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated'))
     or exists(select 1 from public.crew_customer_feedback historical where historical.outlet_id=row.outlet_id and historical.employee_id=e.id)
   )
 ) then raise exception using errcode='22023',message='Crew selection is unavailable for this outlet.'; end if;
 update public.crew_customer_feedback set employee_id=p_employee_id where id=row.id;
 insert into public.crew_feedback_attribution_audit(feedback_id,previous_employee_id,next_employee_id,reason,changed_by) values(row.id,row.employee_id,p_employee_id,btrim(p_reason),auth.uid());
 period:=date_trunc('month',row.submitted_at)::date;
 perform public.crew_feedback_refresh_mutable_performance(row.employee_id,row.outlet_id,period);
 perform public.crew_feedback_refresh_mutable_performance(p_employee_id,row.outlet_id,period);
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
   select jsonb_build_object('total_feedback',count(*),'included_feedback',count(*) filter(where scoring_status='included'),'positive_feedback',count(*) filter(where scoring_status='included' and experience='great'),'needs_improvement_feedback',count(*) filter(where scoring_status='included' and experience='needs_improvement'),'excluded_feedback',count(*) filter(where scoring_status='excluded')) into feedback_summary from public.crew_customer_feedback where outlet_id=p_outlet_id and submitted_at>=period and submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'submitted_at',f.submitted_at,'employee_id',f.employee_id,'employee_name',e.full_name,'employee_position',e.position,'experience',f.experience,'positive_tags',f.positive_tags,'improvement_tags',f.improvement_tags,'comment',f.comment,'scoring_status',f.scoring_status,'excluded_at',f.excluded_at,'excluded_by_name',coalesce(excluded_employee.full_name,excluded_user.email),'exclusion_reason',f.exclusion_reason,'moderation_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_status',a.previous_status,'next_status',a.next_status,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_moderation_audit a left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb),'attribution_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_employee_id',a.previous_employee_id,'previous_employee_name',previous_employee.full_name,'next_employee_id',a.next_employee_id,'next_employee_name',next_employee.full_name,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_attribution_audit a join public.employees previous_employee on previous_employee.id=a.previous_employee_id join public.employees next_employee on next_employee.id=a.next_employee_id left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb)) order by f.submitted_at desc),'[]'::jsonb) into feedback_rows from public.crew_customer_feedback f join public.employees e on e.id=f.employee_id left join public.employees excluded_employee on excluded_employee.auth_user_id=f.excluded_by left join auth.users excluded_user on excluded_user.id=f.excluded_by where f.outlet_id=p_outlet_id and f.submitted_at>=period and f.submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'availability',x.availability) order by x.full_name),'[]'::jsonb) into feedback_crew from (
     select distinct e.id,e.full_name,e.position,case when ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') then 'active' else 'historical' end availability
     from public.employees e left join public.crew_access ca on ca.employee_id=e.id
     where (ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) or exists(select 1 from public.crew_customer_feedback historical where historical.outlet_id=p_outlet_id and historical.employee_id=e.id)
   ) x;
 end if;
 if can_review then
   select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,'employee_name',e.full_name,'position',e.position,'component',v.component,'criteria',v.criteria,'score',v.score,'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at) order by v.reviewed_at desc),'[]'::jsonb) into review_rows from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id where v.outlet_id=p_outlet_id and v.period_start=period;
 end if;
 return jsonb_build_object('period',period,'summary',coalesce(summary,'{}'::jsonb),'crew',coalesce(crew_rows,'[]'::jsonb),'reviews',coalesce(review_rows,'[]'::jsonb),'feedback',coalesce(feedback_rows,'[]'::jsonb),'feedback_summary',coalesce(feedback_summary,'{}'::jsonb),'feedback_crew',coalesce(feedback_crew,'[]'::jsonb));
end; $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;
