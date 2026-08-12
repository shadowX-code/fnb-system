-- FeedX Crew Performance QA dataset. STAGING ONLY; never a migration.
-- QA fixture setup is privileged, while reviews and guest feedback use the same
-- controlled authorities as the Admin and public UIs.
begin;

do $$
declare
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  needs_id constant uuid := '841521c8-31d3-4fb0-914b-256188712001';
  insufficient_id constant uuid := '841521c8-31d3-4fb0-914b-256188712002';
  high_id uuid; average_id uuid; awaiting_id uuid; qa_role uuid; employee uuid; i int;
  service_meets jsonb := '[{"key":"welcome_greeting","rating":"meets_standard"},{"key":"thank_you_goodbye","rating":"meets_standard"},{"key":"grooming","rating":"meets_standard"},{"key":"work_area_cleanliness","rating":"meets_standard"},{"key":"initiative","rating":"meets_standard"},{"key":"guest_interaction","rating":"meets_standard"}]';
  service_average jsonb := '[{"key":"welcome_greeting","rating":"meets_standard"},{"key":"thank_you_goodbye","rating":"meets_standard"},{"key":"grooming","rating":"meets_standard"},{"key":"work_area_cleanliness","rating":"needs_improvement"},{"key":"initiative","rating":"needs_improvement"},{"key":"guest_interaction","rating":"meets_standard"}]';
  service_needs jsonb := '[{"key":"welcome_greeting","rating":"needs_improvement"},{"key":"thank_you_goodbye","rating":"needs_improvement"},{"key":"grooming","rating":"meets_standard"},{"key":"work_area_cleanliness","rating":"needs_improvement"},{"key":"initiative","rating":"needs_improvement"},{"key":"guest_interaction","rating":"needs_improvement"}]';
  conduct_meets jsonb := '[{"key":"professional_conduct","rating":"meets_standard"},{"key":"teamwork","rating":"meets_standard"},{"key":"responsibility","rating":"meets_standard"},{"key":"communication","rating":"meets_standard"},{"key":"policy_compliance","rating":"meets_standard"}]';
  conduct_average jsonb := '[{"key":"professional_conduct","rating":"meets_standard"},{"key":"teamwork","rating":"meets_standard"},{"key":"responsibility","rating":"needs_improvement"},{"key":"communication","rating":"needs_improvement"},{"key":"policy_compliance","rating":"meets_standard"}]';
begin
  if not exists(select 1 from public.outlets where id=outlet and name='Friends Corner') then raise exception 'Friends Corner Staging outlet is unavailable.'; end if;
  select e.role_id into qa_role from public.employees e where e.auth_user_id=qa_admin and e.is_active;
  if qa_role is null or not exists(select 1 from public.roles r where r.id=qa_role and lower(r.name)='crew_admin_qa') then raise exception 'Crew Admin QA identity is unavailable.'; end if;
  insert into public.role_permissions(role_id,permission_id) select qa_role,p.id from public.permissions p where p.code in ('crew_performance.view','crew_performance.review','crew_performance.finalize','crew_feedback.view','crew_feedback.moderate') on conflict do nothing;
  if not exists(select 1 from public.role_outlets where role_id=qa_role and outlet_id=outlet) then raise exception 'Crew Admin QA lacks Friends Corner scope.'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);

  select id into high_id from public.employees where employee_code='QA-CREW-CO-01';
  select id into average_id from public.employees where employee_code='QA-CREW-IP-01';
  select id into awaiting_id from public.employees where employee_code='QA-CREW-NS-01';
  if high_id is null or average_id is null or awaiting_id is null then raise exception 'Phase B QA Crew fixtures are unavailable.'; end if;

  insert into public.employees(id,full_name,nickname,employee_code,position,department,workplace,joined_date,employment_status,is_active)
  values(needs_id,'QA Crew - Needs Attention','Needs QA','QA-CREW-NA-01','Service Crew','Operations','Friends Corner',current_date-90,'active',true)
  on conflict(id) do update set full_name=excluded.full_name,position=excluded.position,is_active=true,employment_status='active';
  insert into public.employees(id,full_name,nickname,employee_code,position,department,workplace,joined_date,employment_status,is_active)
  values(insufficient_id,'QA Crew - Insufficient Feedback','Feedback QA','QA-CREW-IF-01','Service Crew','Operations','Friends Corner',current_date-60,'active',true)
  on conflict(id) do update set full_name=excluded.full_name,position=excluded.position,is_active=true,employment_status='active';
  insert into public.crew_access(employee_id,mobile_number,passcode_hash,access_state,primary_outlet_id)
  values(needs_id,'+601155500204',extensions.crypt('6304',extensions.gen_salt('bf')),'active',outlet)
  on conflict(employee_id) do update set access_state='active',primary_outlet_id=excluded.primary_outlet_id;
  insert into public.crew_access(employee_id,mobile_number,passcode_hash,access_state,primary_outlet_id)
  values(insufficient_id,'+601155500205',extensions.crypt('8505',extensions.gen_salt('bf')),'active',outlet)
  on conflict(employee_id) do update set access_state='active',primary_outlet_id=excluded.primary_outlet_id;

  -- Deterministic recent attendance fixtures make Crew available in the QR selector.
  foreach employee in array array[high_id,average_id,awaiting_id,needs_id,insufficient_id] loop
    for i in 1..3 loop
      insert into public.crew_attendance_records(id,employee_id,outlet_id,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source,clock_in_location_verified,clock_out_location_verified)
      values((substr(md5(employee::text||':performance:'||i),1,8)||'-'||substr(md5(employee::text||':performance:'||i),9,4)||'-4'||substr(md5(employee::text||':performance:'||i),14,3)||'-8'||substr(md5(employee::text||':performance:'||i),18,3)||'-'||substr(md5(employee::text||':performance:'||i),21,12))::uuid,employee,outlet,date_trunc('month',now())+((i+2)||' days')::interval+interval '9 hours',date_trunc('month',now())+((i+2)||' days')::interval+interval '17 hours','completed','admin','admin',true,true)
      on conflict(id) do update set clock_out_at=excluded.clock_out_at,status='completed';
    end loop;
  end loop;
  -- Genuine incomplete evidence for the Needs Attention scenario.
  insert into public.crew_attendance_records(id,employee_id,outlet_id,clock_in_at,status,clock_in_source,clock_in_location_exception,clock_in_exception_reason)
  values('841521c8-31d3-4fb0-914b-256188712099',needs_id,outlet,date_trunc('month',now())+interval '7 days 9 hours','open','admin',true,'QA incomplete record')
  on conflict(id) do nothing;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.crew_performance_submit_review(high_id,current_date,'service',service_meets,'High performer QA review');
  perform public.crew_performance_submit_review(high_id,current_date,'conduct',conduct_meets,'High performer QA review');
  perform public.crew_performance_submit_review(average_id,current_date,'service',service_average,'Average QA review');
  perform public.crew_performance_submit_review(average_id,current_date,'conduct',conduct_average,'Average QA review');
  perform public.crew_performance_submit_review(needs_id,current_date,'service',service_needs,'Coaching opportunity QA review');
  perform public.crew_performance_submit_review(needs_id,current_date,'conduct',conduct_average,'Coaching opportunity QA review');
  perform public.crew_performance_submit_review(insufficient_id,current_date,'service',service_average,'Insufficient feedback QA review');
  perform public.crew_performance_submit_review(insufficient_id,current_date,'conduct',conduct_average,'Insufficient feedback QA review');
  execute 'reset role';

  -- Controlled public submissions; idempotency is keyed by each stable QA client token.
  execute 'set local role anon';
  for i in 1..4 loop perform set_config('request.headers',jsonb_build_object('x-forwarded-for','198.51.100.'||(10+i))::text,true); begin perform public.crew_feedback_submit(outlet,high_id,'great',array['Friendly','Attentive'],array[]::text[],'Excellent QA service','phase-c-high-feedback-'||i); exception when unique_violation then null; end; end loop;
  for i in 1..3 loop perform set_config('request.headers',jsonb_build_object('x-forwarded-for','198.51.100.'||(20+i))::text,true); begin perform public.crew_feedback_submit(outlet,average_id,case when i=3 then 'okay' else 'great' end,array['Helpful'],array[]::text[],'Average scenario QA feedback','phase-c-average-feedback-'||i); exception when unique_violation then null; end; end loop;
  for i in 1..3 loop perform set_config('request.headers',jsonb_build_object('x-forwarded-for','198.51.100.'||(30+i))::text,true); begin perform public.crew_feedback_submit(outlet,needs_id,case when i=1 then 'needs_improvement' else 'okay' end,array[]::text[],array['Response Time','Accuracy'],'Needs attention QA feedback','phase-c-needs-feedback-'||i); exception when unique_violation then null; end; end loop;
  for i in 1..2 loop perform set_config('request.headers',jsonb_build_object('x-forwarded-for','198.51.100.'||(40+i))::text,true); begin perform public.crew_feedback_submit(outlet,awaiting_id,'great',array['Friendly'],array[]::text[],'Low sample QA feedback','phase-c-awaiting-feedback-'||i); exception when unique_violation then null; end; end loop;
  execute 'reset role';

  foreach employee in array array[high_id,average_id,awaiting_id,needs_id,insufficient_id] loop perform public.crew_refresh_performance(employee,current_date); end loop;
  execute 'set local role authenticated';
  perform public.crew_performance_finalize(high_id,current_date);
  perform public.crew_performance_finalize(average_id,current_date);
  perform public.crew_performance_finalize(needs_id,current_date);
  execute 'reset role';
end $$;

commit;
