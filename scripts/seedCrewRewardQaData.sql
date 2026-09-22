-- FeedX Crew Reward QA data. STAGING ONLY; never a migration.
begin;
do $$
declare
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  period date:=date_trunc('month',current_date)::date;
  qa_role uuid; high_id uuid; average_id uuid; needs_id uuid; part_id uuid; awaiting_id uuid; cycle_id uuid; employee uuid; i int;
begin
  if not exists(select 1 from public.outlets where id=outlet and name='Friends Corner') then raise exception 'Friends Corner Staging outlet is unavailable.'; end if;
  select role_id into qa_role from public.employees where auth_user_id=qa_admin and is_active;
  if qa_role is null or not exists(select 1 from public.roles where id=qa_role and lower(name)='crew_admin_qa') then raise exception 'Crew Admin QA identity is unavailable.'; end if;
  insert into public.role_permissions(role_id,permission_id) select qa_role,id from public.permissions where code in ('crew_reward.view','crew_reward.manage','crew_reward.finalize','crew_reward.mark_paid') on conflict do nothing;
  if not exists(select 1 from public.role_outlets where role_id=qa_role and outlet_id=outlet) then raise exception 'Crew Admin QA lacks Friends Corner scope.'; end if;
  select id into high_id from public.employees where employee_code='QA-CREW-CO-01';
  select id into average_id from public.employees where employee_code='QA-CREW-IP-01';
  select id into needs_id from public.employees where employee_code='QA-CREW-NA-01';
  select id into part_id from public.employees where employee_code='QA-CREW-IF-01';
  select id into awaiting_id from public.employees where employee_code='QA-CREW-NS-01';
  if high_id is null or average_id is null or needs_id is null or part_id is null or awaiting_id is null then raise exception 'Phase C QA Crew fixtures are unavailable.'; end if;
  update public.employees set employment_type='part_time' where id=part_id;

  -- Additional deterministic completed shifts create visibly different eligible-hour shares.
  foreach employee in array array[high_id,average_id,needs_id] loop
    for i in 1..case when employee=high_id then 12 when employee=average_id then 8 else 4 end loop
      insert into public.crew_attendance_records(id,employee_id,outlet_id,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source,clock_in_location_verified,clock_out_location_verified)
      values((substr(md5(employee::text||':reward:'||i),1,8)||'-'||substr(md5(employee::text||':reward:'||i),9,4)||'-4'||substr(md5(employee::text||':reward:'||i),14,3)||'-8'||substr(md5(employee::text||':reward:'||i),18,3)||'-'||substr(md5(employee::text||':reward:'||i),21,12))::uuid,employee,outlet,period+((10+i)||' days')::interval+interval '9 hours',period+((10+i)||' days')::interval+interval '17 hours','completed','admin','admin',true,true)
      on conflict(id) do update set clock_out_at=excluded.clock_out_at,status='completed';
    end loop;
  end loop;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.crew_performance_finalize(part_id,period);
  execute 'reset role';
  select id into cycle_id from public.crew_reward_cycles where outlet_id=outlet and period_start=period;
  if cycle_id is null then
    execute 'set local role authenticated';
    cycle_id:=public.crew_reward_create_cycle(outlet,period,500,60);
    perform public.crew_reward_calculate(cycle_id);
    execute 'reset role';
  end if;
end $$;
commit;
