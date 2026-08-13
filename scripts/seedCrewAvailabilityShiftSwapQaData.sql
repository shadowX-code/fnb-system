-- FeedX Crew Availability + Shift Swap v1 QA data. STAGING ONLY; never a migration.
-- Uses controlled Crew and Admin authorities for all business transitions.
begin;
do $$
declare
  admin_id constant uuid:='266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid:='e804c48d-6343-4bf8-99d7-9893c473948f';
  week_start constant date:='2026-08-17';
  employee_a uuid; employee_b uuid; employee_c uuid; employee_d uuid; qa_role uuid; template_id uuid;
  entry_id uuid; request_id uuid; leave_request uuid;
begin
  if timezone('Asia/Kuala_Lumpur',now())::date<>'2026-08-13'::date then raise exception 'Availability QA seed is date-bound to FeedX Staging 13 Aug 2026.'; end if;
  if not exists(select 1 from public.outlets where id=outlet and name='Friends Corner') then raise exception 'Friends Corner Staging outlet guard failed.'; end if;
  select id into employee_a from public.employees where employee_code='QA-CREW-CO-01';
  select id into employee_b from public.employees where employee_code='QA-CREW-IP-01';
  select id into employee_c from public.employees where employee_code='QA-CREW-NS-01';
  select id into employee_d from public.employees where employee_code='QA-CREW-NA-01';
  if employee_a is null or employee_b is null or employee_c is null or employee_d is null then raise exception 'Four dedicated QA Crew employees are required.'; end if;
  if exists(select 1 from public.duty_rosters r join public.employees e on e.id=r.employee_id where r.outlet_id=outlet and r.roster_date between week_start and week_start+6 and coalesce(e.employee_code,'') not like 'QA-CREW-%') then raise exception 'Refusing to seed a roster week containing non-QA Crew.'; end if;
  select id into template_id from public.shift_templates where outlet_id=outlet and shift_type='working' and is_active is not false order by sort_order nulls last,created_at limit 1;
  if template_id is null then raise exception 'Friends Corner needs an active working shift template.'; end if;
  select role_id into qa_role from public.employees where auth_user_id=admin_id and is_active;
  if qa_role is null then raise exception 'Crew Admin QA identity is unavailable.'; end if;
  insert into public.role_permissions(role_id,permission_id) select qa_role,p.id from public.permissions p where p.code in ('crew_availability.view','crew_availability.manage','crew_shift_requests.view','crew_shift_requests.review','crew_roster.view','crew_roster.manage','crew_roster.publish','duty_roster.create','duty_roster.edit','duty_roster.delete','duty_roster.manage','crew_leave.view','crew_leave.review') on conflict do nothing;
  if not exists(select 1 from public.role_outlets where role_id=qa_role and outlet_id=outlet) then raise exception 'Crew Admin QA lacks Friends Corner outlet scope.'; end if;

  insert into public.crew_sessions(employee_id,token_hash,expires_at)
  select e.id,encode(extensions.digest('availability-demo-'||e.employee_code,'sha256'),'hex'),now()+interval '30 days'
  from public.employees e where e.id in(employee_a,employee_b,employee_c,employee_d)
  on conflict(token_hash) do update set expires_at=excluded.expires_at,revoked_at=null;

  execute 'set local role anon';
  perform public.crew_availability_save('availability-demo-QA-CREW-CO-01',jsonb_build_object('weekly',(select jsonb_agg(jsonb_build_object('day_of_week',d,'type','available','windows',jsonb_build_array(jsonb_build_object('start_time','08:00','end_time','22:00')))) from generate_series(1,7)d),'exceptions','[]'::jsonb));
  perform public.crew_availability_save('availability-demo-QA-CREW-IP-01',jsonb_build_object('weekly',(select jsonb_agg(jsonb_build_object('day_of_week',d,'type',case when d in(6,7) then 'preferred' else 'available' end,'windows','[]'::jsonb)) from generate_series(1,7)d),'exceptions',jsonb_build_array(jsonb_build_object('date','2026-08-22','type','available','windows',jsonb_build_array(jsonb_build_object('start_time','18:00','end_time','22:00')),'reason','Available after 6 PM'))));
  perform public.crew_availability_save('availability-demo-QA-CREW-NS-01',jsonb_build_object('weekly',(select jsonb_agg(jsonb_build_object('day_of_week',d,'type',case when d=5 then 'unavailable' else 'available' end,'windows','[]'::jsonb)) from generate_series(1,7)d),'exceptions','[]'::jsonb));
  perform public.crew_availability_save('availability-demo-QA-CREW-NA-01',jsonb_build_object('weekly',(select jsonb_agg(jsonb_build_object('day_of_week',d,'type','available','windows','[]'::jsonb)) from generate_series(1,7)d),'exceptions','[]'::jsonb));
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.save_roster_week_snapshot('61304000-0000-4000-8000-000000000101',outlet,week_start,jsonb_build_array(
    jsonb_build_object('employee_id',employee_a,'roster_date','2026-08-17','shift_template_id',template_id,'remark','QA specific swap'),
    jsonb_build_object('employee_id',employee_a,'roster_date','2026-08-18','shift_template_id',template_id,'remark','QA open cover'),
    jsonb_build_object('employee_id',employee_a,'roster_date','2026-08-19','shift_template_id',template_id,'remark','QA rejected swap'),
    jsonb_build_object('employee_id',employee_a,'roster_date','2026-08-20','shift_template_id',template_id,'remark','QA approved swap'),
    jsonb_build_object('employee_id',employee_a,'roster_date','2026-08-21','shift_template_id',template_id,'remark','QA leave candidate conflict'),
    jsonb_build_object('employee_id',employee_c,'roster_date','2026-08-21','shift_template_id',template_id,'remark','QA availability warning')
  ));
  perform public.publish_roster_week('61304000-0000-4000-8000-000000000102',outlet,week_start);
  execute 'reset role';

  if not exists(select 1 from public.crew_leave_requests where reason='[QA Availability] Approved leave candidate conflict') then
    execute 'set local role anon';
    leave_request:=(public.crew_leave_submit('availability-demo-QA-CREW-NA-01',jsonb_build_object('leave_type','annual','start_date','2026-08-21','end_date','2026-08-21','duration_type','full_day','reason','[QA Availability] Approved leave candidate conflict'))->>'id')::uuid;
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_leave_review(leave_request,'approve'); execute 'reset role';
  end if;

  -- Approved scenario first, proving that approval produces a new immutable roster revision.
  if not exists(select 1 from public.crew_shift_requests where reason='[QA Shift Swap] Approved') then
    select e.id into entry_id from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id where e.employee_id=employee_a and e.roster_date='2026-08-20' and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date);
    execute 'set local role anon'; request_id:=(public.crew_shift_request_submit('availability-demo-QA-CREW-CO-01',jsonb_build_object('entry_id',entry_id,'reason_code','personal','reason','[QA Shift Swap] Approved','coverage_mode','specific','replacement_employee_id',employee_c))->>'id')::uuid; perform public.crew_shift_request_respond('availability-demo-QA-CREW-NS-01',request_id,'accept'); execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_shift_request_review(request_id,'approve','QA approved coverage'); execute 'reset role';
  end if;

  if not exists(select 1 from public.crew_shift_requests where reason='[QA Shift Swap] Rejected') then
    select e.id into entry_id from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id where e.employee_id=employee_a and e.roster_date='2026-08-19' and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date);
    execute 'set local role anon'; request_id:=(public.crew_shift_request_submit('availability-demo-QA-CREW-CO-01',jsonb_build_object('entry_id',entry_id,'reason_code','transport','reason','[QA Shift Swap] Rejected','coverage_mode','specific','replacement_employee_id',employee_b))->>'id')::uuid; perform public.crew_shift_request_respond('availability-demo-QA-CREW-IP-01',request_id,'accept'); execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_shift_request_review(request_id,'reject','QA coverage not approved'); execute 'reset role';
  end if;

  if not exists(select 1 from public.crew_shift_requests where reason='[QA Shift Swap] Specific Pending Manager') then
    select e.id into entry_id from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id where e.employee_id=employee_a and e.roster_date='2026-08-17' and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date);
    execute 'set local role anon'; request_id:=(public.crew_shift_request_submit('availability-demo-QA-CREW-CO-01',jsonb_build_object('entry_id',entry_id,'reason_code','personal','reason','[QA Shift Swap] Specific Pending Manager','coverage_mode','specific','replacement_employee_id',employee_b))->>'id')::uuid; perform public.crew_shift_request_respond('availability-demo-QA-CREW-IP-01',request_id,'accept'); execute 'reset role';
  end if;

  if not exists(select 1 from public.crew_shift_requests where reason='[QA Shift Swap] Open Cover') then
    select e.id into entry_id from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id where e.employee_id=employee_a and e.roster_date='2026-08-18' and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date);
    execute 'set local role anon'; perform public.crew_shift_request_submit('availability-demo-QA-CREW-CO-01',jsonb_build_object('entry_id',entry_id,'reason_code','other','reason','[QA Shift Swap] Open Cover','coverage_mode','open')); execute 'reset role';
  end if;
end $$;
commit;
