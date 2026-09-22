-- FeedX Crew Leave v1 QA scenarios. STAGING ONLY; never a migration.
begin;
do $$
declare
 admin_id constant uuid:='266912cf-0e84-4074-82b5-0fc483080741'; role_id uuid; r uuid;
begin
 if timezone('Asia/Kuala_Lumpur',now())::date<>'2026-08-13'::date then raise exception 'Crew Leave QA seed is date-bound to Staging 13 Aug 2026.'; end if;
 if not exists(select 1 from public.employees where employee_code='QA-CREW-CO-01') then raise exception 'Dedicated QA Crew guard failed.'; end if;
 select e.role_id into role_id from public.employees e where e.auth_user_id=admin_id and e.is_active;
 if role_id is null then raise exception 'Crew Admin QA guard failed.'; end if;
 insert into public.role_permissions(role_id,permission_id) select role_id,p.id from public.permissions p where p.code in ('crew_leave.view','crew_leave.review','crew_leave.manage') on conflict do nothing;
 insert into public.crew_sessions(employee_id,token_hash,expires_at)
 select e.id,encode(extensions.digest('leave-demo-'||e.employee_code,'sha256'),'hex'),now()+interval '30 days' from public.employees e where e.employee_code in ('QA-CREW-CO-01','QA-CREW-IF-01','QA-CREW-IP-01','QA-CREW-NA-01','QA-CREW-NS-01')
 on conflict(token_hash) do update set expires_at=excluded.expires_at,revoked_at=null;

 if not exists(select 1 from public.crew_leave_requests where reason='[QA Leave v1] Pending annual leave') then
   perform public.crew_leave_submit('leave-demo-QA-CREW-IF-01',jsonb_build_object('leave_type','annual','start_date','2026-09-01','end_date','2026-09-02','duration_type','full_day','reason','[QA Leave v1] Pending annual leave'));
 end if;
 if not exists(select 1 from public.crew_leave_requests where reason='[QA Leave v1] Approved annual leave') then
   r:=(public.crew_leave_submit('leave-demo-QA-CREW-IP-01',jsonb_build_object('leave_type','annual','start_date','2026-09-03','end_date','2026-09-04','duration_type','full_day','reason','[QA Leave v1] Approved annual leave'))->>'id')::uuid;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_leave_review(r,'approve'); execute 'reset role';
 end if;
 if not exists(select 1 from public.crew_leave_requests where reason='[QA Leave v1] Approved medical leave') then
   r:=(public.crew_leave_submit('leave-demo-QA-CREW-NA-01',jsonb_build_object('leave_type','medical','start_date','2026-09-05','end_date','2026-09-05','duration_type','full_day','reason','[QA Leave v1] Approved medical leave'))->>'id')::uuid;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_leave_review(r,'approve'); execute 'reset role';
 end if;
 if not exists(select 1 from public.crew_leave_requests where reason='[QA Leave v1] Rejected leave') then
   r:=(public.crew_leave_submit('leave-demo-QA-CREW-NS-01',jsonb_build_object('leave_type','other','start_date','2026-09-06','end_date','2026-09-06','duration_type','full_day','reason','[QA Leave v1] Rejected leave'))->>'id')::uuid;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_leave_review(r,'reject','QA rejection: coverage is unavailable.'); execute 'reset role';
 end if;
 if not exists(select 1 from public.crew_leave_requests where reason='[QA Leave v1] Approved over scheduled shift') then
   if (public.crew_roster_employee_day((select id from public.employees where employee_code='QA-CREW-CO-01'),'2026-08-13')->>'entry_type')<>'working' then raise exception 'QA conflict scenario no longer has a working published shift.'; end if;
   r:=(public.crew_leave_submit('leave-demo-QA-CREW-CO-01',jsonb_build_object('leave_type','unpaid','start_date','2026-08-13','end_date','2026-08-13','duration_type','full_day','reason','[QA Leave v1] Approved over scheduled shift'))->>'id')::uuid;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_leave_review(r,'approve'); execute 'reset role';
 end if;
end $$;
commit;
