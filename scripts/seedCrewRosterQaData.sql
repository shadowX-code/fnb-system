-- FeedX Crew Duty Roster QA data. STAGING ONLY; never a migration.
-- Creates a published schedule for the dedicated QA Crew through the same
-- authenticated save/publish authorities used by the Admin UI.
begin;
do $$
declare
  qa_admin constant uuid:='266912cf-0e84-4074-82b5-0fc483080741';
  qa_employee constant uuid:='066594d7-800c-4b61-8de9-9de4efd57fe3';
  qa_outlet constant uuid:='49fe2aa7-fc6e-41f1-85cf-3bb8d34a87ba';
  qa_role uuid;
begin
  if timezone('Asia/Kuala_Lumpur',now())::date<>'2026-08-13'::date then raise exception 'Staging QA seed is date-bound to 13 Aug 2026.'; end if;
  if not exists(select 1 from public.outlets where id=qa_outlet and name='Hola Hola Kopitiam Ipoh') then raise exception 'Staging outlet guard failed.'; end if;
  if not exists(select 1 from public.employees where id=qa_employee and employee_code='QA-CREW-CO-01') then raise exception 'Dedicated QA Crew guard failed.'; end if;
  if exists(select 1 from public.duty_rosters r join public.employees e on e.id=r.employee_id where r.outlet_id=qa_outlet and r.roster_date between '2026-08-10' and '2026-08-16' and coalesce(e.employee_code,'') not like 'QA-CREW-%') then raise exception 'Refusing to replace a week containing non-QA Crew.'; end if;
  select role_id into qa_role from public.employees where auth_user_id=qa_admin and is_active;
  if qa_role is null or not exists(select 1 from public.roles where id=qa_role and lower(name)='crew_admin_qa') then raise exception 'Crew Admin QA identity guard failed.'; end if;
  insert into public.role_permissions(role_id,permission_id) select qa_role,id from public.permissions where code in ('crew_roster.view','crew_roster.manage','crew_roster.publish') on conflict do nothing;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.save_roster_week_snapshot(
    '13000000-0000-4000-8000-000000000101',qa_outlet,'2026-08-10',
    jsonb_build_array(
      jsonb_build_object('employee_id',qa_employee,'roster_date','2026-08-13','shift_template_id','1dc1cd46-1c62-4e62-8d2f-9b3bc1abbe66','remark','QA Today shift'),
      jsonb_build_object('employee_id',qa_employee,'roster_date','2026-08-14','shift_template_id','40c30494-8459-4b38-acb1-9534a74be1ab','remark','QA OFF'),
      jsonb_build_object('employee_id',qa_employee,'roster_date','2026-08-15','shift_template_id','0bca1d7d-99b0-44b1-9c79-a6e43bf277b9','remark','QA manual MC'),
      jsonb_build_object('employee_id',qa_employee,'roster_date','2026-08-16','shift_template_id','724313ff-e067-4109-8cac-882c42db941e','remark','QA manual AL')
    )
  );
  perform public.publish_roster_week('13000000-0000-4000-8000-000000000102',qa_outlet,'2026-08-10');
  execute 'reset role';
end $$;
commit;
