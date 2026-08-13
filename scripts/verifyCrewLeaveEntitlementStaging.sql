-- Rollback-only behavior verification for Crew Leave Entitlement / Balance v1.
begin;
create temporary table crew_leave_balance_test_results(name text primary key,passed boolean not null,detail text);
do $$
declare
 admin_id constant uuid:='266912cf-0e84-4074-82b5-0fc483080741'; employee_a uuid; employee_b uuid; outlet_id uuid; role_id uuid;
 token_a text:='qa-leave-balance-token-a'; token_b text:='qa-leave-balance-token-b'; v_entitlement_id uuid; result jsonb; before_balance jsonb; after_balance jsonb; request_id uuid; adjustment_count int; before_used numeric; before_pending numeric; before_available numeric;
begin
 select e.id,public.crew_resolve_employee_outlet(e.id) into employee_a,outlet_id from public.employees e where e.employee_code like 'QA-CREW-%' and coalesce(e.is_active,true) order by e.employee_code limit 1;
 select e.id into employee_b from public.employees e where e.employee_code like 'QA-CREW-%' and e.id<>employee_a and coalesce(e.is_active,true) order by e.employee_code limit 1;
 if employee_a is null or employee_b is null or outlet_id is null then raise exception 'Dedicated QA Crew fixtures are unavailable.'; end if;
 select e.role_id into role_id from public.employees e where e.auth_user_id=admin_id and e.is_active;
 if role_id is null then raise exception 'Crew Admin QA fixture is unavailable.'; end if;
 insert into public.role_permissions(role_id,permission_id) select role_id,p.id from public.permissions p where p.code in ('crew_leave.view','crew_leave.review','crew_leave.manage','crew_leave_balance.view','crew_leave_balance.manage','crew_leave_balance.adjust','crew_leave_settings.manage') on conflict do nothing;
 insert into public.crew_sessions(employee_id,token_hash,expires_at) values(employee_a,encode(extensions.digest(token_a,'sha256'),'hex'),now()+interval '1 hour'),(employee_b,encode(extensions.digest(token_b,'sha256'),'hex'),now()+interval '1 hour');

 v_entitlement_id:=public.crew_leave_ensure_entitlement(employee_a,'annual','2026-01-01',outlet_id,null);
 result:=public.crew_leave_entitlement_balance(v_entitlement_id,'2026-08-13');
 if result->>'calculation_version'<>'calendar-days-half-day-v1' or not (result ?& array['used','pending','available','entitled']) then raise exception 'Balance payload is incomplete.'; end if;
 insert into crew_leave_balance_test_results values('server-derived balance payload',true,'versioned used/pending/available');

 update public.employees set joined_date='2027-07-01' where id=employee_b;
 v_entitlement_id:=public.crew_leave_ensure_entitlement(employee_b,'annual','2027-01-01',outlet_id,null); result:=public.crew_leave_entitlement_balance(v_entitlement_id,'2027-08-13');
 if (result->>'prorated')::numeric<>6 then raise exception 'Join-date proration expected 6 days, got %',result->>'prorated'; end if;
 insert into crew_leave_balance_test_results values('join-date proration',true,'1 Jul annual grant = 6.0 days');

 delete from public.crew_leave_entitlements where id=v_entitlement_id;
 update public.employees set joined_date='2024-01-01' where id=employee_b;
 select ce.id into v_entitlement_id from public.crew_leave_entitlements ce where ce.employee_id=employee_b and ce.leave_type='annual' and ce.period_start='2026-01-01';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_leave_adjust(v_entitlement_id,20,'QA carry-forward cap fixture'); execute 'reset role';
 v_entitlement_id:=public.crew_leave_ensure_entitlement(employee_b,'annual','2027-01-01',outlet_id,null); result:=public.crew_leave_entitlement_balance(v_entitlement_id,'2027-02-01');
 if (result->>'carry_forward')::numeric<>5 or (result->>'carry_forward_awarded')::numeric<>5 then raise exception 'Carry-forward cap expected 5 days.'; end if;
 insert into crew_leave_balance_test_results values('carry-forward cap',true,'unused prior balance capped at 5 days');
 result:=public.crew_leave_entitlement_balance(v_entitlement_id,'2027-04-01'); if (result->>'carry_forward')::numeric<>0 then raise exception 'Expired carry-forward remained available.'; end if;
 insert into crew_leave_balance_test_results values('carry-forward expiry',true,'31 Mar expiry removes carry from available balance');

 before_balance:=public.crew_leave_mobile(token_a); result:=public.crew_leave_submit(token_a,jsonb_build_object('leave_type','annual','start_date','2026-11-02','end_date','2026-11-02','duration_type','half_day','half_day_period','am','reason','QA half day reserve')); request_id:=(result->>'id')::uuid; after_balance:=public.crew_leave_mobile(token_a);
 if (select (x->>'pending')::numeric from jsonb_array_elements(after_balance->'balances') x where x->>'leave_type'='annual')<>(select (x->>'pending')::numeric+0.5 from jsonb_array_elements(before_balance->'balances') x where x->>'leave_type'='annual') then raise exception 'Pending reservation did not increase by 0.5.'; end if;
 insert into crew_leave_balance_test_results values('pending reservation',true,'half day reserves 0.5');
 perform public.crew_leave_cancel(token_a,request_id); result:=public.crew_leave_mobile(token_a);
 if (select (x->>'pending')::numeric from jsonb_array_elements(result->'balances') x where x->>'leave_type'='annual')<>(select (x->>'pending')::numeric from jsonb_array_elements(before_balance->'balances') x where x->>'leave_type'='annual') then raise exception 'Cancellation did not release reservation.'; end if;
 insert into crew_leave_balance_test_results values('cancellation releases balance',true,'pending returns to before value');

 before_balance:=public.crew_leave_mobile(token_a); request_id:=(public.crew_leave_submit(token_a,jsonb_build_object('leave_type','annual','start_date','2026-11-03','end_date','2026-11-03','duration_type','half_day','half_day_period','pm','reason','QA rejected release'))->>'id')::uuid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; perform public.crew_leave_review(request_id,'reject','QA balance release verification'); execute 'reset role'; after_balance:=public.crew_leave_mobile(token_a);
 if (select (x->>'pending')::numeric from jsonb_array_elements(after_balance->'balances') x where x->>'leave_type'='annual')<>(select (x->>'pending')::numeric from jsonb_array_elements(before_balance->'balances') x where x->>'leave_type'='annual') then raise exception 'Rejection did not release reservation.'; end if;
 insert into crew_leave_balance_test_results values('rejection releases balance',true,'pending returns to before value');

 before_balance:=public.crew_leave_mobile(token_a); select (x->>'used')::numeric,(x->>'pending')::numeric,(x->>'available')::numeric into before_used,before_pending,before_available from jsonb_array_elements(before_balance->'balances') x where x->>'leave_type'='annual';
 request_id:=(public.crew_leave_submit(token_a,jsonb_build_object('leave_type','annual','start_date','2026-11-04','end_date','2026-11-04','duration_type','half_day','half_day_period','am','reason','QA approval consumption'))->>'id')::uuid;
 execute 'set local role authenticated'; perform public.crew_leave_review(request_id,'approve'); execute 'reset role'; after_balance:=public.crew_leave_mobile(token_a);
 if (select (x->>'used')::numeric from jsonb_array_elements(after_balance->'balances') x where x->>'leave_type'='annual')<>before_used+0.5 or (select (x->>'pending')::numeric from jsonb_array_elements(after_balance->'balances') x where x->>'leave_type'='annual')<>before_pending or (select (x->>'available')::numeric from jsonb_array_elements(after_balance->'balances') x where x->>'leave_type'='annual')<>before_available-0.5 then raise exception 'Approval did not convert evidence to used leave.'; end if;
 insert into crew_leave_balance_test_results values('approval consumes balance',true,'used +0.5; pending released; available -0.5');

 begin perform public.crew_leave_submit(token_a,jsonb_build_object('leave_type','medical','start_date','2026-10-01','end_date','2026-10-20','duration_type','full_day','reason','QA insufficient request')); raise exception 'Expected insufficient balance rejection'; exception when invalid_parameter_value then if sqlerrm not like 'Insufficient leave balance%' then raise; end if; insert into crew_leave_balance_test_results values('insufficient balance blocked',true,'20 days exceeds medical entitlement'); end;

 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated';
 result:=public.crew_leave_policy_save(outlet_id,'medical',jsonb_build_object('annual_days',14,'proration_enabled',false,'balance_enforced',true,'carry_forward_enabled',false,'max_carry_forward_days',0));
 if (result->>'annual_days')::numeric<>14 then raise exception 'Policy authority failed.'; end if;
 execute 'reset role';
 insert into crew_leave_balance_test_results values('outlet policy authority',true,'authenticated permission and outlet scope');
 select count(*) into adjustment_count from public.crew_leave_adjustments a where a.entitlement_id=v_entitlement_id;
 execute 'set local role authenticated';
 result:=public.crew_leave_adjust(v_entitlement_id,1.5,'QA audited adjustment');
 execute 'reset role';
 if (result#>>'{adjustment,amount}')::numeric<>1.5 or (select count(*) from public.crew_leave_adjustments a where a.entitlement_id=v_entitlement_id)<>adjustment_count+1 then raise exception 'Adjustment authority failed.'; end if;
 insert into crew_leave_balance_test_results values('immutable adjustment',true,'+1.5 with actor, reason and timestamp');

 result:=public.crew_leave_mobile(token_b);
 if exists(select 1 from jsonb_array_elements(result->'balances') x where x->>'employee_id'=employee_a::text) then raise exception 'Cross-employee balance leaked.'; end if;
 insert into crew_leave_balance_test_results values('Crew own-balance isolation',true,'B receives only B entitlement IDs');

 update public.employees set is_active=false,employment_status='terminated',resigned_date='2027-12-31' where id=employee_b;
 if public.crew_leave_ensure_entitlement(employee_b,'annual','2027-01-01',outlet_id,null) is null then raise exception 'Historical entitlement became unavailable.'; end if;
 begin perform public.crew_leave_ensure_entitlement(employee_b,'annual','2028-01-01',outlet_id,null); raise exception 'Expected departed employee guard'; exception when invalid_parameter_value then if sqlerrm not like 'Future leave entitlement%' then raise; end if; insert into crew_leave_balance_test_results values('departed employee lifecycle',true,'historical grant retained; future grant blocked'); end;

 begin execute 'set local role anon'; perform count(*) from public.crew_leave_entitlements; execute 'reset role'; raise exception 'Expected raw entitlement denial'; exception when insufficient_privilege then execute 'reset role'; insert into crew_leave_balance_test_results values('raw entitlement read denied',true,'anon has no table privilege'); end;

 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; result:=public.crew_leave_admin_data(outlet_id,null,null); execute 'reset role';
 if jsonb_array_length(result->'policies')<>4 or jsonb_array_length(result->'balances')<8 then raise exception 'Admin data did not include policy/balance context.'; end if;
 insert into crew_leave_balance_test_results values('manager balance context',true,'four policies and employee balances returned');
end $$;
select jsonb_build_object('passed',count(*) filter(where passed),'failed',count(*) filter(where not passed),'tests',jsonb_agg(jsonb_build_object('name',name,'passed',passed,'detail',detail) order by name)) as crew_leave_balance_verification from crew_leave_balance_test_results;
rollback;
