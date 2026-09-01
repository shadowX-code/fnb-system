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
   if (p_contact_method='email' and (position('@' in btrim(p_contact_value))<2 or position('.' in split_part(btrim(p_contact_value),'@',2))<2)) or (p_contact_method='phone' and btrim(p_contact_value)!~'^[0-9+() .-]{6,30}$') then raise exception using errcode='22023',message='Follow-up contact details are invalid.'; end if;
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
