-- Customer Feedback trust, visit context, and complaint follow-up.
-- Raw anonymous identifiers and contact PII stay private to this authority.

insert into public.permissions(code,module,description) values
 ('crew_feedback.trust_review','Crew Performance','Confirm suspicious Customer Feedback evidence as valid for scoring.'),
 ('crew_feedback.follow_up.view','Crew Performance','View guest contact details requested for Customer Feedback follow-up.'),
 ('crew_feedback.follow_up.manage','Crew Performance','Update Customer Feedback follow-up status.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code in (
 'crew_feedback.trust_review','crew_feedback.follow_up.view','crew_feedback.follow_up.manage'
) on conflict do nothing;

alter table public.crew_customer_feedback
  add column if not exists anonymous_device_hash text,
  add column if not exists trust_state text not null default 'standard',
  add column if not exists trust_reason_codes text[] not null default '{}',
  add column if not exists visit_at timestamptz,
  add column if not exists visit_business_date date,
  add column if not exists follow_up_requested boolean not null default false;

update public.crew_customer_feedback
set visit_business_date=timezone('Asia/Kuala_Lumpur',submitted_at)::date
where visit_business_date is null;

alter table public.crew_customer_feedback
  alter column visit_business_date set default timezone('Asia/Kuala_Lumpur',now())::date;

alter table public.crew_customer_feedback
  drop constraint if exists crew_customer_feedback_trust_state_check,
  add constraint crew_customer_feedback_trust_state_check check (trust_state in ('standard','review_required','confirmed')),
  drop constraint if exists crew_customer_feedback_visit_context_check,
  add constraint crew_customer_feedback_visit_context_check check (
    (experience='needs_improvement' and visit_at is not null and visit_business_date is not null)
    or (experience in ('great','okay') and visit_at is null and visit_business_date is not null)
    or (anonymous_device_hash is null and visit_at is null and visit_business_date is not null)
  );

create index if not exists crew_customer_feedback_device_crew_day_idx
  on public.crew_customer_feedback(anonymous_device_hash, employee_id, visit_business_date, submitted_at desc)
  where scope='crew' and anonymous_device_hash is not null;
create index if not exists crew_customer_feedback_trust_period_idx
  on public.crew_customer_feedback(outlet_id, trust_state, submitted_at desc);

create table if not exists public.crew_feedback_trust_audit (
 id uuid primary key default gen_random_uuid(),
 feedback_id uuid not null references public.crew_customer_feedback(id) on delete restrict,
 previous_trust_state text,
 next_trust_state text not null check(next_trust_state in ('standard','review_required','confirmed')),
 reason_codes text[] not null default '{}',
 reason text,
 decision_source text not null check(decision_source in ('system','admin')),
 changed_by uuid references auth.users(id),
 changed_at timestamptz not null default now()
);

create table if not exists public.crew_feedback_follow_ups (
 feedback_id uuid primary key references public.crew_customer_feedback(id) on delete restrict,
 preferred_name text not null check(char_length(btrim(preferred_name)) between 1 and 120),
 contact_method text not null check(contact_method in ('phone','email')),
 contact_value text not null check(char_length(btrim(contact_value)) between 3 and 160),
 status text not null default 'requested' check(status in ('requested','in_progress','resolved')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 resolved_at timestamptz,
 updated_by uuid references auth.users(id)
);

create table if not exists public.crew_feedback_follow_up_audit (
 id uuid primary key default gen_random_uuid(),
 feedback_id uuid not null references public.crew_customer_feedback(id) on delete restrict,
 previous_status text,
 next_status text not null check(next_status in ('requested','in_progress','resolved')),
 changed_by uuid references auth.users(id),
 changed_at timestamptz not null default now()
);

alter table public.crew_feedback_trust_audit enable row level security;
alter table public.crew_feedback_follow_ups enable row level security;
alter table public.crew_feedback_follow_up_audit enable row level security;
revoke all on public.crew_feedback_trust_audit,public.crew_feedback_follow_ups,public.crew_feedback_follow_up_audit from public,anon,authenticated;
grant select,insert,update,delete on public.crew_feedback_trust_audit,public.crew_feedback_follow_ups,public.crew_feedback_follow_up_audit to service_role;

create or replace function public.crew_performance_customer_component(p_employee_id uuid,p_period date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare n int; positive int; improvement int; raw numeric; score numeric; confidence text; v_positive_tags jsonb; v_improvement_tags jsonb;
begin
 select count(*),count(*) filter(where experience='great'),count(*) filter(where experience='needs_improvement'),
 coalesce(avg(case experience when 'great' then 1.0 when 'okay' then 0.65 else 0.25 end),0)
 into n,positive,improvement,raw from public.crew_customer_feedback
 where employee_id=p_employee_id and scope='crew' and submitted_at>=p_period and submitted_at<(p_period+interval '1 month')
   and scoring_status='included' and trust_state in ('standard','confirmed');
 if n=0 then score:=12;confidence:='insufficient_data';
 elsif n<3 then score:=round(15*((raw*n+0.8*(3-n))/3),2);confidence:='low';
 else score:=round(15*raw,2);confidence:='established'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'count',tag_count) order by tag_count desc,tag),'[]'::jsonb) into v_positive_tags from (select unnest(f.positive_tags) tag,count(*) tag_count from public.crew_customer_feedback f where f.employee_id=p_employee_id and f.scope='crew' and f.scoring_status='included' and f.trust_state in ('standard','confirmed') and f.submitted_at>=p_period and f.submitted_at<(p_period+interval '1 month') group by 1 order by 2 desc,1 limit 5) x;
 select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'count',tag_count) order by tag_count desc,tag),'[]'::jsonb) into v_improvement_tags from (select unnest(f.improvement_tags) tag,count(*) tag_count from public.crew_customer_feedback f where f.employee_id=p_employee_id and f.scope='crew' and f.scoring_status='included' and f.trust_state in ('standard','confirmed') and f.submitted_at>=p_period and f.submitted_at<(p_period+interval '1 month') group by 1 order by 2 desc,1 limit 5) x;
 return jsonb_build_object('score',score,'max_score',15,'sample_count',n,'confidence',confidence,'positive_count',positive,'improvement_count',improvement,'top_positive_tags',v_positive_tags,'top_improvement_tags',v_improvement_tags,
 'explanation',case confidence when 'insufficient_data' then 'No eligible feedback yet; v1 uses a neutral 12/15 baseline and marks the result insufficient.' when 'low' then 'One or two eligible responses are blended with a neutral prior to avoid sample-size distortion.' else 'Three or more eligible responses use the transparent Great 100%, Okay 65%, Needs Improvement 25% formula.' end,'calculation_version','customer-feedback-v2-trust');
end; $$;
revoke all on function public.crew_performance_customer_component(uuid,date) from public,anon,authenticated;

create or replace function public.crew_feedback_submit_scoped_v2(
 p_outlet_id uuid,p_scope text,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text,
 p_anonymous_device_id text,p_visit_time_mode text default null,p_visit_time time default null,p_follow_up_requested boolean default false,p_preferred_name text default null,p_contact_method text default null,p_contact_value text default null
) returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
 allowed_positive text[]; allowed_improvement text[]; req_headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 ip text; v_request_hash text; v_device_hash text; feedback_id uuid; v_visit_at timestamptz; v_business_date date;
 v_trust_state text:='standard'; v_reasons text[]:='{}'; v_normalized_comment text; v_same_day_exists boolean;
begin
 if p_scope not in ('crew','food','outlet') then raise exception using errcode='22023',message='Feedback type is invalid.'; end if;
 if p_experience not in ('great','okay','needs_improvement') then raise exception using errcode='22023',message='Experience selection is invalid.'; end if;
 if char_length(coalesce(p_client_token,'')) not between 16 and 128 then raise exception using errcode='22023',message='Feedback session is invalid.'; end if;
 if char_length(coalesce(p_anonymous_device_id,'')) not between 16 and 128 then raise exception using errcode='22023',message='Feedback device is invalid.'; end if;
 if p_scope='crew' then
   allowed_positive:=array['Friendly','Helpful','Attentive','Fast','Knowledgeable']; allowed_improvement:=array['Greeting','Response Time','Accuracy','Cleanliness','Product Knowledge'];
   if p_employee_id is null or not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=p_employee_id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) then raise exception using errcode='22023',message='Crew selection is unavailable.'; end if;
 elsif p_scope='food' then
   allowed_positive:=array['Taste','Portion','Temperature','Presentation','Value','Freshness']; allowed_improvement:=allowed_positive;
   if p_employee_id is not null then raise exception using errcode='22023',message='Food feedback cannot be assigned to Crew.'; end if;
 else
   allowed_positive:=array['Cleanliness','Service Speed','Atmosphere','Ordering','Waiting Time','Comfort','Overall Value']; allowed_improvement:=allowed_positive;
   if p_employee_id is not null then raise exception using errcode='22023',message='Outlet feedback cannot be assigned to Crew.'; end if;
 end if;
 if coalesce(cardinality(p_positive_tags),0)>5 or coalesce(cardinality(p_improvement_tags),0)>5 or exists(select 1 from unnest(coalesce(p_positive_tags,'{}')) t where not(t=any(allowed_positive))) or exists(select 1 from unnest(coalesce(p_improvement_tags,'{}')) t where not(t=any(allowed_improvement))) then raise exception using errcode='22023',message='Feedback tags are invalid.'; end if;
 if char_length(coalesce(p_comment,''))>500 or coalesce(p_comment,'')~*'(https?://|<script|javascript:)' then raise exception using errcode='22023',message='Feedback comment is invalid.'; end if;
 if p_experience='needs_improvement' then
   if p_visit_time_mode='just_now' then v_visit_at:=now();
   elsif p_visit_time_mode='chosen_time' and p_visit_time is not null then v_visit_at:=((timezone('Asia/Kuala_Lumpur',now())::date+p_visit_time) at time zone 'Asia/Kuala_Lumpur');
   else raise exception using errcode='22023',message='An approximate visit time is required for improvement feedback.'; end if;
   v_business_date:=timezone('Asia/Kuala_Lumpur',v_visit_at)::date;
 else
   if p_visit_time_mode is not null or p_visit_time is not null or p_follow_up_requested then raise exception using errcode='22023',message='Visit context is only collected for improvement feedback.'; end if;
   v_business_date:=timezone('Asia/Kuala_Lumpur',now())::date;
 end if;
 if p_follow_up_requested then
   if p_experience<>'needs_improvement' then raise exception using errcode='22023',message='Follow-up is only available for improvement feedback.'; end if;
   if char_length(btrim(coalesce(p_preferred_name,''))) not between 1 and 120 or p_contact_method not in ('phone','email') or char_length(btrim(coalesce(p_contact_value,''))) not between 3 and 160 then raise exception using errcode='22023',message='Follow-up contact details are incomplete.'; end if;
   if (p_contact_method='email' and btrim(p_contact_value)!~*'^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$') or (p_contact_method='phone' and btrim(p_contact_value)!~'^[0-9+() .-]{6,30}$') then raise exception using errcode='22023',message='Follow-up contact details are invalid.'; end if;
 elsif p_preferred_name is not null or p_contact_method is not null or p_contact_value is not null then raise exception using errcode='22023',message='Contact details require a follow-up request.'; end if;
 ip:=split_part(coalesce(req_headers->>'x-forwarded-for','unknown'),',',1); v_request_hash:=encode(extensions.digest(p_client_token||':'||ip,'sha256'),'hex'); v_device_hash:=encode(extensions.digest(p_anonymous_device_id,'sha256'),'hex');
 if (select count(*) from public.crew_customer_feedback f where f.request_hash=v_request_hash and f.submitted_at>now()-interval '1 hour')>=5 then raise exception using errcode='P0001',message='Too many feedback submissions. Please try again later.'; end if;
 if (select count(*) from public.crew_customer_feedback f where f.anonymous_device_hash=v_device_hash and f.submitted_at>now()-interval '15 minutes')>=3 then v_trust_state:='review_required'; v_reasons:=array_append(v_reasons,'rapid_submissions'); end if;
 if exists(select 1 from public.crew_customer_feedback f where f.request_hash=v_request_hash and f.outlet_id=p_outlet_id and f.scope=p_scope and f.employee_id is not distinct from p_employee_id and f.submitted_at>now()-interval '12 hours') then raise exception using errcode='23505',message=case when p_scope='crew' then 'Feedback was already submitted for this Crew member.' else 'Feedback was already submitted for this visit.' end; end if;
 if p_scope='crew' then
   select exists(select 1 from public.crew_customer_feedback f where f.anonymous_device_hash=v_device_hash and f.employee_id=p_employee_id and f.visit_business_date=v_business_date and f.scoring_status='included' and f.trust_state in ('standard','confirmed')) into v_same_day_exists;
   if v_same_day_exists then v_trust_state:='review_required'; v_reasons:=array_append(v_reasons,'same_device_crew_business_day'); end if;
   if p_experience='great' and (select count(distinct coalesce(f.visit_business_date,timezone('Asia/Kuala_Lumpur',f.submitted_at)::date)) from public.crew_customer_feedback f where f.anonymous_device_hash=v_device_hash and f.employee_id=p_employee_id and f.experience='great' and f.submitted_at>=now()-interval '14 days')>=3 then v_trust_state:='review_required'; v_reasons:=array_append(v_reasons,'repeat_positive_pattern'); end if;
   v_normalized_comment:=regexp_replace(lower(btrim(coalesce(p_comment,''))),'[^a-z0-9]+','','g');
   if char_length(v_normalized_comment)>=12 and exists(select 1 from public.crew_customer_feedback f where f.anonymous_device_hash=v_device_hash and f.employee_id=p_employee_id and f.experience=p_experience and coalesce(f.positive_tags,'{}')=coalesce(p_positive_tags,'{}') and coalesce(f.improvement_tags,'{}')=coalesce(p_improvement_tags,'{}') and regexp_replace(lower(coalesce(f.comment,'')),'[^a-z0-9]+','','g')=v_normalized_comment and f.submitted_at>=now()-interval '14 days') then v_trust_state:='review_required'; v_reasons:=array_append(v_reasons,'similar_repeat'); end if;
   if exists(select 1 from public.employees e where e.id=p_employee_id and e.auth_user_id=auth.uid()) then v_trust_state:='review_required'; v_reasons:=array_append(v_reasons,'crew_account_match'); end if;
 end if;
 insert into public.crew_customer_feedback(outlet_id,scope,employee_id,experience,positive_tags,improvement_tags,comment,request_hash,anonymous_device_hash,trust_state,trust_reason_codes,visit_at,visit_business_date,follow_up_requested,scoring_status)
 values(p_outlet_id,p_scope,p_employee_id,p_experience,coalesce(p_positive_tags,'{}'),coalesce(p_improvement_tags,'{}'),nullif(btrim(p_comment),''),v_request_hash,v_device_hash,v_trust_state,v_reasons,v_visit_at,v_business_date,p_follow_up_requested,case when p_scope='crew' then 'included' else 'not_applicable' end)
 returning id into feedback_id;
 if v_trust_state='review_required' then insert into public.crew_feedback_trust_audit(feedback_id,previous_trust_state,next_trust_state,reason_codes,decision_source) values(feedback_id,'standard','review_required',v_reasons,'system'); end if;
 if p_follow_up_requested then
   insert into public.crew_feedback_follow_ups(feedback_id,preferred_name,contact_method,contact_value) values(feedback_id,btrim(p_preferred_name),p_contact_method,btrim(p_contact_value));
   insert into public.crew_feedback_follow_up_audit(feedback_id,next_status) values(feedback_id,'requested');
 end if;
 if p_scope='crew' then perform public.crew_feedback_refresh_mutable_performance(p_employee_id,p_outlet_id,date_trunc('month',now())::date); end if;
 return jsonb_build_object('id',feedback_id,'scope',p_scope,'submitted_at',now(),'status','received');
end; $$;
revoke all on function public.crew_feedback_submit_scoped_v2(uuid,text,uuid,text,text[],text[],text,text,text,text,time,boolean,text,text,text) from public,anon,authenticated;

create or replace function public.crew_feedback_submit_v3(p_outlet_id uuid,p_scope text,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text,p_anonymous_device_id text,p_visit_time_mode text default null,p_visit_time time default null,p_follow_up_requested boolean default false,p_preferred_name text default null,p_contact_method text default null,p_contact_value text default null)
returns jsonb language sql volatile security definer set search_path=public as $$
 select public.crew_feedback_submit_scoped_v2(p_outlet_id,p_scope,p_employee_id,p_experience,p_positive_tags,p_improvement_tags,p_comment,p_client_token,p_anonymous_device_id,p_visit_time_mode,p_visit_time,p_follow_up_requested,p_preferred_name,p_contact_method,p_contact_value);
$$;
revoke all on function public.crew_feedback_submit_v3(uuid,text,uuid,text,text[],text[],text,text,text,text,time,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_submit_v3(uuid,text,uuid,text,text[],text[],text,text,text,text,time,boolean,text,text,text) to anon,authenticated;

create or replace function public.crew_feedback_submit_public_v3(p_outlet_token text,p_scope text,p_employee_id uuid,p_experience text,p_positive_tags text[],p_improvement_tags text[],p_comment text,p_client_token text,p_anonymous_device_id text,p_visit_time_mode text default null,p_visit_time time default null,p_follow_up_requested boolean default false,p_preferred_name text default null,p_contact_method text default null,p_contact_value text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_outlet_id uuid;
begin
 select o.id into v_outlet_id from public.outlets o where o.public_feedback_token=lower(btrim(p_outlet_token)) and o.is_active;
 if v_outlet_id is null then raise exception using errcode='22023',message='Feedback link is unavailable.'; end if;
 return public.crew_feedback_submit_scoped_v2(v_outlet_id,p_scope,p_employee_id,p_experience,p_positive_tags,p_improvement_tags,p_comment,p_client_token,p_anonymous_device_id,p_visit_time_mode,p_visit_time,p_follow_up_requested,p_preferred_name,p_contact_method,p_contact_value);
end; $$;
revoke all on function public.crew_feedback_submit_public_v3(text,text,uuid,text,text[],text[],text,text,text,text,time,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_submit_public_v3(text,text,uuid,text,text[],text[],text,text,text,text,time,boolean,text,text,text) to anon,authenticated;

create or replace function public.crew_feedback_confirm_trust(p_feedback_id uuid,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_customer_feedback%rowtype; period date;
begin
 if not public.current_user_has_permission('crew_feedback.trust_review') then raise exception using errcode='42501',message='Customer Feedback trust review permission is required.'; end if;
 if char_length(btrim(coalesce(p_reason,'')))<5 then raise exception using errcode='22023',message='A meaningful trust decision reason is required.'; end if;
 select * into row from public.crew_customer_feedback where id=p_feedback_id for update;
 if row.id is null then raise exception using errcode='P0002',message='Feedback was not found.'; end if;
 if row.scope<>'crew' or row.trust_state<>'review_required' then raise exception using errcode='22023',message='Only Crew feedback awaiting trust review can be confirmed.'; end if;
 if not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Feedback is outside your outlet scope.'; end if;
 update public.crew_customer_feedback set trust_state='confirmed' where id=row.id;
 insert into public.crew_feedback_trust_audit(feedback_id,previous_trust_state,next_trust_state,reason_codes,reason,decision_source,changed_by) values(row.id,row.trust_state,'confirmed',row.trust_reason_codes,btrim(p_reason),'admin',auth.uid());
 period:=date_trunc('month',row.submitted_at)::date; perform public.crew_feedback_refresh_mutable_performance(row.employee_id,row.outlet_id,period);
 return jsonb_build_object('id',row.id,'trust_state','confirmed','period',period);
end; $$;
revoke all on function public.crew_feedback_confirm_trust(uuid,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_confirm_trust(uuid,text) to authenticated;

create or replace function public.crew_feedback_follow_up_update(p_feedback_id uuid,p_status text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_feedback_follow_ups%rowtype; outlet uuid;
begin
 if not public.current_user_has_permission('crew_feedback.follow_up.manage') then raise exception using errcode='42501',message='Customer Feedback follow-up permission is required.'; end if;
 if p_status not in ('requested','in_progress','resolved') then raise exception using errcode='22023',message='Follow-up status is invalid.'; end if;
 select fu.* into row from public.crew_feedback_follow_ups fu where fu.feedback_id=p_feedback_id for update;
 if row.feedback_id is null then raise exception using errcode='P0002',message='Follow-up was not found.'; end if;
 select f.outlet_id into outlet from public.crew_customer_feedback f where f.id=p_feedback_id;
 if not public.current_user_can_access_outlet(outlet) then raise exception using errcode='42501',message='Feedback is outside your outlet scope.'; end if;
 if row.status=p_status then raise exception using errcode='22023',message='Follow-up already has this status.'; end if;
 update public.crew_feedback_follow_ups set status=p_status,updated_at=now(),updated_by=auth.uid(),resolved_at=case when p_status='resolved' then now() else null end where feedback_id=p_feedback_id;
 insert into public.crew_feedback_follow_up_audit(feedback_id,previous_status,next_status,changed_by) values(p_feedback_id,row.status,p_status,auth.uid());
 return jsonb_build_object('feedback_id',p_feedback_id,'status',p_status);
end; $$;
revoke all on function public.crew_feedback_follow_up_update(uuid,text) from public,anon,authenticated;
grant execute on function public.crew_feedback_follow_up_update(uuid,text) to authenticated;

create or replace function public.crew_performance_admin_data(p_outlet_id uuid,p_period date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
 period date:=date_trunc('month',p_period)::date; employee record; rows jsonb:='[]'::jsonb; feedback_rows jsonb:='[]'::jsonb; review_rows jsonb:='[]'::jsonb;
 summary jsonb:='{}'::jsonb; feedback_summary jsonb:='{}'::jsonb; feedback_crew jsonb:='[]'::jsonb;
 framework jsonb:=jsonb_build_array(jsonb_build_object('key','attendance','label','Attendance','max_score',30),jsonb_build_object('key','service','label','Service','max_score',30),jsonb_build_object('key','customer','label','Customer','max_score',15),jsonb_build_object('key','knowledge','label','Knowledge','max_score',15),jsonb_build_object('key','conduct','label','Conduct','max_score',10));
 can_performance boolean:=public.current_user_has_permission('crew_performance.view'); can_feedback boolean:=public.current_user_has_permission('crew_feedback.view'); can_review boolean:=public.current_user_has_permission('crew_performance.review'); can_follow_up_view boolean:=public.current_user_has_permission('crew_feedback.follow_up.view');
begin
 if not (can_performance or can_feedback or can_review) or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Performance is unavailable for this outlet.'; end if;
 if can_performance then
   for employee in select e.id from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') loop perform public.crew_refresh_performance(employee.id,period); end loop;
   select coalesce(jsonb_agg(jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position),'result',jsonb_build_object('id',r.id,'status',r.status,'period_start',r.period_start,'current_score',r.current_score,'total_score',r.total_score,'attendance_score',r.attendance_score,'service_score',r.service_score,'customer_score',r.customer_score,'knowledge_score',r.knowledge_score,'conduct_score',r.conduct_score,'components',case when can_review then r.components else jsonb_set(jsonb_set(r.components,'{service}',coalesce(r.components->'service','{}'::jsonb)-('manager_note'::text)-('criteria'::text)),'{conduct}',coalesce(r.components->'conduct','{}'::jsonb)-('manager_note'::text)-('criteria'::text)) end,'calculation_version',r.calculation_version,'computed_at',r.computed_at,'finalized_at',r.finalized_at)) order by e.full_name),'[]'::jsonb) into rows from public.crew_performance_results r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and r.period_start=period;
   select jsonb_build_object('average_score',round(avg(total_score) filter(where total_score is not null),1),'reviewed',count(*) filter(where coalesce(components->'service'->>'status','review_required')='reviewed' and coalesce(components->'conduct'->>'status','review_required')='reviewed'),'awaiting_review',count(*) filter(where coalesce(components->'service'->>'status','review_required')<>'reviewed' or coalesce(components->'conduct'->>'status','review_required')<>'reviewed'),'crew_total',count(*)) into summary from public.crew_performance_results where outlet_id=p_outlet_id and period_start=period;
 end if;
 if can_feedback then
   select jsonb_build_object('total_feedback',count(*),'crew_feedback',count(*) filter(where scope='crew'),'food_feedback',count(*) filter(where scope='food'),'outlet_feedback',count(*) filter(where scope='outlet'),'included_feedback',count(*) filter(where scope='crew' and scoring_status='included' and trust_state in ('standard','confirmed')),'review_required_feedback',count(*) filter(where scope='crew' and trust_state='review_required'),'positive_feedback',count(*) filter(where experience='great'),'needs_improvement_feedback',count(*) filter(where experience='needs_improvement'),'excluded_feedback',count(*) filter(where scope='crew' and scoring_status='excluded')) into feedback_summary from public.crew_customer_feedback where outlet_id=p_outlet_id and submitted_at>=period and submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'scope',f.scope,'submitted_at',f.submitted_at,'employee_id',f.employee_id,'employee_name',e.full_name,'employee_position',e.position,'experience',f.experience,'positive_tags',f.positive_tags,'improvement_tags',f.improvement_tags,'comment',f.comment,'scoring_status',f.scoring_status,'trust_state',f.trust_state,'trust_reason_codes',f.trust_reason_codes,'visit_at',f.visit_at,'visit_business_date',f.visit_business_date,'follow_up_requested',f.follow_up_requested,'excluded_at',f.excluded_at,'excluded_by_name',coalesce(excluded_employee.full_name,excluded_user.email),'exclusion_reason',f.exclusion_reason,
    'moderation_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_status',a.previous_status,'next_status',a.next_status,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_moderation_audit a left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb),
    'trust_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_trust_state',a.previous_trust_state,'next_trust_state',a.next_trust_state,'reason_codes',a.reason_codes,'reason',a.reason,'decision_source',a.decision_source,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_trust_audit a left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb),
    'attribution_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_employee_id',a.previous_employee_id,'previous_employee_name',previous_employee.full_name,'next_employee_id',a.next_employee_id,'next_employee_name',next_employee.full_name,'reason',a.reason,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_attribution_audit a join public.employees previous_employee on previous_employee.id=a.previous_employee_id join public.employees next_employee on next_employee.id=a.next_employee_id left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb),
    'follow_up',case when can_follow_up_view then coalesce((select jsonb_build_object('preferred_name',fu.preferred_name,'contact_method',fu.contact_method,'contact_value',fu.contact_value,'status',fu.status,'created_at',fu.created_at,'resolved_at',fu.resolved_at,'history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_status',a.previous_status,'next_status',a.next_status,'changed_by',coalesce(actor.full_name,user_actor.email),'changed_at',a.changed_at) order by a.changed_at desc) from public.crew_feedback_follow_up_audit a left join public.employees actor on actor.auth_user_id=a.changed_by left join auth.users user_actor on user_actor.id=a.changed_by where a.feedback_id=f.id),'[]'::jsonb)) from public.crew_feedback_follow_ups fu where fu.feedback_id=f.id),'null'::jsonb) else 'null'::jsonb end
   ) order by f.submitted_at desc),'[]'::jsonb) into feedback_rows from public.crew_customer_feedback f left join public.employees e on e.id=f.employee_id left join public.employees excluded_employee on excluded_employee.auth_user_id=f.excluded_by left join auth.users excluded_user on excluded_user.id=f.excluded_by where f.outlet_id=p_outlet_id and f.submitted_at>=period and f.submitted_at<(period+interval '1 month');
   select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'availability',x.availability) order by x.full_name),'[]'::jsonb) into feedback_crew from (select distinct e.id,e.full_name,e.position,case when ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') then 'active' else 'historical' end availability from public.employees e left join public.crew_access ca on ca.employee_id=e.id where (ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')) or exists(select 1 from public.crew_customer_feedback historical where historical.outlet_id=p_outlet_id and historical.scope='crew' and historical.employee_id=e.id)) x;
 end if;
 if can_review then select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,'employee_name',e.full_name,'position',e.position,'component',v.component,'criteria',v.criteria,'score',v.score,'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at) order by v.reviewed_at desc),'[]'::jsonb) into review_rows from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id where v.outlet_id=p_outlet_id and v.period_start=period; end if;
 return jsonb_build_object('period_start',period,'period',period,'summary',summary,'scoring_framework',case when can_performance then framework else '[]'::jsonb end,'crew',rows,'reviews',review_rows,'feedback',feedback_rows,'feedback_summary',feedback_summary,'feedback_crew',feedback_crew);
end; $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;
