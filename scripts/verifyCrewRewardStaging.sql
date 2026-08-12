-- Real Staging behavior/security verification. All fixtures roll back.
begin;
create temporary table reward_test_results(test_count int,cycle_total numeric,high_reward numeric,average_reward numeric,part_time_reward numeric) on commit drop;

do $$
declare
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  period constant date := date '2026-04-01';
  high_id uuid; average_id uuid; low_id uuid; part_id uuid; awaiting_id uuid; qa_role uuid; other_outlet uuid;
  v_cycle_id uuid; entry_id uuid; payload jsonb; high_amount numeric; average_amount numeric; part_amount numeric; total numeric; audit_count int; denied boolean;
begin
  select role_id into qa_role from public.employees where auth_user_id=qa_admin and is_active;
  insert into public.role_permissions(role_id,permission_id) select qa_role,id from public.permissions where code in ('crew_reward.view','crew_reward.manage','crew_reward.finalize','crew_reward.mark_paid') on conflict do nothing;
  select id into high_id from public.employees where employee_code='QA-CREW-CO-01';
  select id into average_id from public.employees where employee_code='QA-CREW-IP-01';
  select id into low_id from public.employees where employee_code='QA-CREW-NA-01';
  select id into part_id from public.employees where employee_code='QA-CREW-IF-01';
  select id into awaiting_id from public.employees where employee_code='QA-CREW-NS-01';
  if high_id is null or average_id is null or low_id is null or part_id is null or awaiting_id is null then raise exception 'Phase C QA employees are missing.'; end if;

  insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,attendance_score,service_score,customer_score,knowledge_score,conduct_score,total_score,components,calculation_version,computed_at,finalized_at,finalized_by)
  values
   (high_id,outlet,period,'finalized',30,27,14,14,5,90,'{}','performance-v1',now(),now(),qa_admin),
   (average_id,outlet,period,'finalized',28,22,12,9,4,75,'{}','performance-v1',now(),now(),qa_admin),
   (low_id,outlet,period,'finalized',20,16,8,7,4,55,'{}','performance-v1',now(),now(),qa_admin),
   (part_id,outlet,period,'finalized',29,24,13,12,7,85,'{}','performance-v1',now(),now(),qa_admin);

  insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source)
  select high_id,outlet,period::timestamptz+interval '1 day 8 hours'+(n||' days')::interval,period::timestamptz+interval '1 day 18 hours'+(n||' days')::interval,'completed','admin','admin' from generate_series(0,19)n;
  insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source)
  select average_id,outlet,period::timestamptz+interval '1 day 8 hours'+(n||' days')::interval,period::timestamptz+interval '1 day 18 hours'+(n||' days')::interval,'completed','admin','admin' from generate_series(0,9)n;
  insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source)
  select low_id,outlet,period::timestamptz+interval '1 day 8 hours'+(n||' days')::interval,period::timestamptz+interval '1 day 18 hours'+(n||' days')::interval,'completed','admin','admin' from generate_series(0,7)n;
  insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,status,clock_in_source,clock_out_source)
  select part_id,outlet,period::timestamptz+interval '1 day 8 hours'+(n||' days')::interval,period::timestamptz+interval '1 day 18 hours'+(n||' days')::interval,'completed','admin','admin' from generate_series(0,3)n;
  insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,status,clock_in_source) values(part_id,outlet,period::timestamptz+interval '20 days 8 hours','open','admin');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  v_cycle_id:=public.crew_reward_create_cycle(outlet,period,500,60);
  perform public.crew_reward_calculate(v_cycle_id);
  execute 'reset role';

  if (select pool_unlock_rate from public.crew_reward_cycles where id=v_cycle_id)<>.75 then raise exception 'FAIL pool unlock'; end if;
  if (select unlocked_pool from public.crew_reward_cycles where id=v_cycle_id)<>375 then raise exception 'FAIL unlocked pool'; end if;
  if (select eligible_hours from public.crew_reward_entries where crew_reward_entries.cycle_id=v_cycle_id and employee_id=part_id)<>40 then raise exception 'FAIL incomplete attendance excluded'; end if;
  if (select final_payout from public.crew_reward_entries where crew_reward_entries.cycle_id=v_cycle_id and employee_id=low_id)<>0 then raise exception 'FAIL below threshold'; end if;
  if (select status from public.crew_reward_entries where crew_reward_entries.cycle_id=v_cycle_id and employee_id=awaiting_id)<>'awaiting_performance' then raise exception 'FAIL awaiting performance'; end if;
  select final_payout into high_amount from public.crew_reward_entries where crew_reward_entries.cycle_id=v_cycle_id and employee_id=high_id;
  select final_payout into average_amount from public.crew_reward_entries where crew_reward_entries.cycle_id=v_cycle_id and employee_id=average_id;
  select final_payout,id into part_amount,entry_id from public.crew_reward_entries where crew_reward_entries.cycle_id=v_cycle_id and employee_id=part_id;
  if not(high_amount>average_amount and average_amount>part_amount and part_amount>0) then raise exception 'FAIL contribution/part-time fairness'; end if;
  select sum(final_payout) into total from public.crew_reward_entries where crew_reward_entries.cycle_id=v_cycle_id;
  if total>375 or total>500 then raise exception 'FAIL pool cap'; end if;

  execute 'set local role authenticated';
  denied:=false;
  begin
    perform public.crew_reward_adjust(entry_id,6,'Must exceed the unlocked pool');
  exception when numeric_value_out_of_range then
    denied:=true;
  end;
  execute 'reset role';
  if not denied then raise exception 'FAIL strict adjustment pool cap'; end if;
  if (select final_payout from public.crew_reward_entries where id=entry_id)<>part_amount then raise exception 'FAIL rejected adjustment mutated payout'; end if;

  execute 'set local role authenticated'; perform public.crew_reward_adjust(entry_id,-5,'Rollback-only QA adjustment'); execute 'reset role';
  select count(*) into audit_count from public.crew_reward_adjustments where reward_entry_id=entry_id and reason='Rollback-only QA adjustment';
  if audit_count<>1 then raise exception 'FAIL adjustment audit'; end if;
  execute 'set local role authenticated'; perform public.crew_reward_finalize(v_cycle_id); execute 'reset role';
  begin update public.crew_reward_entries set final_payout=final_payout+1 where id=entry_id; raise exception 'FAIL finalized entry mutable'; exception when sqlstate '55000' then null; end;
  begin update public.crew_reward_cycles set configured_pool=999 where id=v_cycle_id; raise exception 'FAIL finalized cycle mutable'; exception when sqlstate '55000' then null; end;

  insert into public.crew_sessions(employee_id,token_hash,expires_at) values(high_id,encode(extensions.digest('reward-test-token','sha256'),'hex'),now()+interval '1 hour');
  execute 'set local role anon'; payload:=public.crew_reward_mobile('reward-test-token',period); execute 'reset role';
  if (payload->>'performance_score')::numeric<>90 or payload ? 'employee_id' or payload ? 'employee_name' or payload ? 'adjustments' then raise exception 'FAIL Crew own safe payload'; end if;

  execute 'set local role anon'; denied:=false; begin perform * from public.crew_reward_entries; exception when insufficient_privilege then denied:=true; end; execute 'reset role';
  if not denied then raise exception 'FAIL anon direct table read'; end if;
  select id into other_outlet from public.outlets where id<>outlet and is_active limit 1;
  if other_outlet is not null then
    execute 'set local role authenticated'; denied:=false; begin perform public.crew_reward_create_cycle(other_outlet,period,100,60); exception when insufficient_privilege then denied:=true; end; execute 'reset role';
    if not denied then raise exception 'FAIL cross-outlet isolation'; end if;
  end if;
  execute 'set local role authenticated'; perform public.crew_reward_mark_paid(v_cycle_id); execute 'reset role';
  if (select status from public.crew_reward_cycles where id=v_cycle_id)<>'paid' then raise exception 'FAIL mark paid'; end if;
  insert into reward_test_results values(15,total,high_amount,average_amount,part_amount);
  raise notice 'CREW_REWARD_BEHAVIOR_PASS 15/15 cycle=% total=% high=% average=% part=%',v_cycle_id,total,high_amount,average_amount,part_amount;
end $$;
select * from reward_test_results;
rollback;
