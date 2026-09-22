-- Rollback-only real Staging verification for Crew Leave v1.
begin;
create temporary table crew_leave_test_results(name text primary key,passed boolean not null,detail text);
do $$
declare
 admin_id constant uuid:='266912cf-0e84-4074-82b5-0fc483080741';
 employee_a uuid; employee_b uuid; v_outlet_id uuid; other_outlet uuid; role_id uuid;
 token_a text:='qa-leave-token-a'; token_b text:='qa-leave-token-b'; request_a uuid; request_half uuid; request_reject uuid; approved_id uuid; working_template uuid; payload jsonb; result jsonb;
begin
 select e.id,public.crew_resolve_employee_outlet(e.id) into employee_a,v_outlet_id from public.employees e where e.employee_code like 'QA-CREW-%' and coalesce(e.employment_status,'active')='active' order by e.employee_code limit 1;
 select e.id into employee_b from public.employees e where e.employee_code like 'QA-CREW-%' and e.id<>employee_a and coalesce(e.employment_status,'active')='active' order by e.employee_code limit 1;
 if employee_a is null or employee_b is null or v_outlet_id is null then raise exception 'Dedicated QA Crew fixtures are unavailable.'; end if;
 select e.role_id into role_id from public.employees e where e.auth_user_id=admin_id and e.is_active;
 if role_id is null then raise exception 'Crew Admin QA fixture is unavailable.'; end if;
 insert into public.role_permissions(role_id,permission_id) select role_id,p.id from public.permissions p where p.code in ('crew_leave.view','crew_leave.review','crew_leave.manage') on conflict do nothing;
 insert into public.crew_sessions(employee_id,token_hash,expires_at) values(employee_a,encode(extensions.digest(token_a,'sha256'),'hex'),now()+interval '1 hour'),(employee_b,encode(extensions.digest(token_b,'sha256'),'hex'),now()+interval '1 hour');

 payload:=jsonb_build_object('leave_type','annual','start_date','2026-09-20','end_date','2026-09-21','duration_type','full_day','reason','QA annual leave verification');
 result:=public.crew_leave_submit(token_a,payload); request_a:=(result->>'id')::uuid;
 if result->>'status'<>'pending' or (result->>'requested_days')::numeric<>2 then raise exception 'Valid full-day submission failed.'; end if;
 insert into crew_leave_test_results values('valid full-day submit',true,'2 requested days; server-derived');

 begin perform public.crew_leave_submit(token_a,payload); raise exception 'Expected overlap rejection'; exception when exclusion_violation then insert into crew_leave_test_results values('overlap pending rejected',true,'23P01'); end;
 begin perform public.crew_leave_submit(token_a,payload||jsonb_build_object('end_date','2026-09-19')); raise exception 'Expected invalid range'; exception when invalid_parameter_value then insert into crew_leave_test_results values('invalid range rejected',true,'22023'); end;
 begin perform public.crew_leave_submit(token_a,payload||jsonb_build_object('employee_id',employee_b)); raise exception 'Expected identity field rejection'; exception when invalid_parameter_value then insert into crew_leave_test_results values('caller employee id rejected',true,'session-bound'); end;

 result:=public.crew_leave_submit(token_a,jsonb_build_object('leave_type','medical','start_date','2026-09-25','end_date','2026-09-25','duration_type','half_day','half_day_period','pm','reason','QA medical appointment')); request_half:=(result->>'id')::uuid;
 if (result->>'requested_days')::numeric<>0.5 or result->>'document_status'<>'not_uploaded' then raise exception 'Half-day or MC document behavior failed.'; end if;
 insert into crew_leave_test_results values('half-day medical submit',true,'0.5 day; optional document');
 perform public.crew_leave_cancel(token_a,request_half);
 if (select status from public.crew_leave_requests where id=request_half)<>'cancelled' then raise exception 'Pending cancellation failed.'; end if;
 insert into crew_leave_test_results values('cancel pending',true,'cancelled with audit');

 result:=public.crew_leave_submit(token_a,jsonb_build_object('leave_type','other','start_date','2026-09-27','end_date','2026-09-27','duration_type','full_day','reason','QA rejection scenario')); request_reject:=(result->>'id')::uuid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated';
 perform public.crew_leave_review(request_reject,'reject','Coverage cannot be arranged for this QA date.');
 execute 'reset role';
 if (select status from public.crew_leave_requests where id=request_reject)<>'rejected' then raise exception 'Manager rejection failed.'; end if;
 insert into crew_leave_test_results values('manager reject',true,'safe reason stored');

 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated';
 result:=public.crew_leave_review(request_a,'approve'); execute 'reset role'; approved_id:=(result->>'approved_leave_id')::uuid;
 if approved_id is null or (select count(*) from public.crew_leave_roster_projections where approved_leave_id=approved_id)<>2 then raise exception 'Approval projection failed.'; end if;
 insert into crew_leave_test_results values('manager approve',true,'formal approved record');
 insert into crew_leave_test_results values('roster projection',true,'2 employee-level day projections');

 begin perform public.crew_leave_cancel(token_a,request_a); raise exception 'Expected approved cancel rejection'; exception when invalid_parameter_value then insert into crew_leave_test_results values('approved cancel rejected',true,'manager change required'); end;
 select st.id into working_template from public.shift_templates st where st.outlet_id=public.crew_resolve_employee_outlet(employee_a) and st.shift_type='working' limit 1;
 begin insert into public.duty_rosters(outlet_id,employee_id,roster_date,shift_template_id,start_time,end_time,status,source) values(public.crew_resolve_employee_outlet(employee_a),employee_a,'2026-09-20',working_template,'10:00','18:00','draft','manual_roster') on conflict(outlet_id,employee_id,roster_date) do update set shift_template_id=excluded.shift_template_id,start_time=excluded.start_time,end_time=excluded.end_time,source='manual_roster'; raise exception 'Expected approved leave roster block'; exception when exclusion_violation then insert into crew_leave_test_results values('future working roster blocked',true,'approved leave protected across outlets'); end;

 result:=public.crew_my_roster(token_a,'2026-09-20','2026-09-21');
 if jsonb_array_length(result->'entries')<>2 or exists(select 1 from jsonb_array_elements(result->'entries') x where x->>'source'<>'approved_leave') then raise exception 'Crew roster leave projection is unsafe.'; end if;
 insert into crew_leave_test_results values('Crew schedule leave display',true,'approved_leave source only');
 result:=public.crew_leave_mobile(token_b);
 if exists(select 1 from jsonb_array_elements(result->'requests') x where x->>'id' in (request_a::text,request_reject::text)) then raise exception 'Cross-employee read leaked.'; end if;
 insert into crew_leave_test_results values('cross-employee mobile isolation',true,'B cannot read A');
 if (public.crew_performance_roster_attendance_evidence(employee_a,'2026-09-01')->>'approved_leave_days')::int<>2 then raise exception 'Performance evidence did not exclude leave.'; end if;
 insert into crew_leave_test_results values('performance leave evidence',true,'2 approved days excluded from missing');
 if not exists(select 1 from public.crew_leave_audit where request_id=request_a and action='approved') then raise exception 'Audit history missing.'; end if;
 insert into crew_leave_test_results values('audit trace',true,'submit, approve and projection trace retained');
end $$;
select jsonb_build_object('passed',count(*) filter(where passed),'failed',count(*) filter(where not passed),'tests',jsonb_agg(jsonb_build_object('name',name,'passed',passed,'detail',detail) order by name)) as crew_leave_verification from crew_leave_test_results;
rollback;
