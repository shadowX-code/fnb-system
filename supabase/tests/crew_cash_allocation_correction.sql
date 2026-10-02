-- Run Staging only inside BEGIN/ROLLBACK. No financial fixture persists.
do $$ declare outlet uuid; admin_id uuid; employee uuid; manager uuid; c uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); correction uuid; d date:=date '2099-01-01';
 before_checkout jsonb; before_ledger jsonb; value jsonb; denied boolean; balance_before numeric; ledger_id uuid; tok text:=encode(extensions.gen_random_bytes(32),'hex');
begin
 select id into outlet from public.outlets where name='QA Demo — Reporting Posters';
 select e.auth_user_id into admin_id from public.employees e join public.roles r on r.id=e.role_id where e.enable_system_login and e.access_state='active' and e.is_active and lower(r.name)='owner' limit 1;
 select e.id into manager from public.employees e join public.crew_access ca on ca.employee_id=e.id where lower(btrim(e.workplace))='management' and ca.access_state='active' and e.is_active and outlet=any(public.crew_authorized_outlet_ids(e.id)) limit 1;
 select e.id into employee from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.access_state='active' and ca.primary_outlet_id=public.crew_resolve_employee_outlet(e.id) and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') and lower(coalesce(e.workplace,''))<>'management' limit 1;
 assert outlet is not null and admin_id is not null and employee is not null and manager is not null,'Staging fixtures required';
 assert not exists(select 1 from public.crew_cash_checkouts where outlet_id=outlet and business_date=d),'Fixture date must be unused';
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 insert into public.crew_cash_checkouts(id,outlet_id,business_date,checked_out_by_employee_id,status,floating_cash,previous_carry_forward,expected_opening_cash,actual_opening_cash,opening_variance,counted_cash,pos_expected_cash,variance,carry_forward,amount_for_deposit,completed_at,denomination_counts)
 values(c,outlet,d,employee,'completed',300,0,300,300,0,746,746,0,0,446,now(),'{"100":7,"10":4,"1":6}');
 perform public.crew_cash_append_checkout_ledger(c);
 select to_jsonb(x) into before_checkout from public.crew_cash_checkouts x where id=c;
 select id,to_jsonb(x) into ledger_id,before_ledger from public.crew_cash_ledger_entries x where checkout_id=c;
 balance_before:=public.crew_cash_balance(outlet);
 execute 'set local role authenticated';
 value:=public.crew_cash_correct_checkout_allocation(c,46,null,request,'Correct closing allocation: RM46 carried forward to next day; deposit corrected to RM400.');
 correction:=(value#>>'{correction,id}')::uuid;
 assert value#>'{checkout,allocation_original}'='{"carry_forward":0,"amount_for_deposit":446}'::jsonb,'Original evidence';
 assert (value#>>'{checkout,carry_forward}')::numeric=46 and (value#>>'{checkout,amount_for_deposit}')::numeric=400,'Effective allocation';
 assert (value#>>'{checkout,variance}')::numeric=0 and (value#>>'{checkout,counted_cash}')::numeric=746,'Count/variance unchanged';
 assert value#>>'{correction,actor_user_id}'=admin_id::text and value#>>'{correction,created_at}' is not null,'Real actor/time';
 assert (value->>'current_balance')::numeric=balance_before-46,'Atomic ledger delta';
 value:=public.crew_cash_correct_checkout_allocation(c,46,null,request,'Correct closing allocation: RM46 carried forward to next day; deposit corrected to RM400.');
 assert value->>'replayed'='true' and value#>>'{correction,id}'=correction::text,'Retry returns original correction';
 denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,47,null,request,'Changed request'); exception when invalid_parameter_value then denied:=true; end; assert denied,'Changed request replay denied';
 denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,47,null,gen_random_uuid(),'Stale editor'); exception when serialization_failure then denied:=true; end; assert denied,'Concurrent stale editor denied';
 denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,46,correction,gen_random_uuid(),'Unchanged allocation'); exception when invalid_parameter_value then denied:=true; end; assert denied,'Duplicate allocation with new request denied';
 denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,447,correction,gen_random_uuid(),'Over allocated'); exception when invalid_parameter_value then denied:=true; end; assert denied,'Invalid amount denied';
 denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,45,correction,gen_random_uuid(),''); exception when invalid_parameter_value then denied:=true; end; assert denied,'Reason required';
 value:=public.crew_cash_admin_page(outlet,d,d,'checkouts',1,20);
 assert (value#>>'{rows,0,carry_forward}')::numeric=46 and (value#>>'{rows,0,amount_for_deposit}')::numeric=400,'Admin page/detail effective';
 value:=public.crew_cash_admin_data(outlet,d,d);
 assert (value#>>'{checkouts,0,carry_forward}')::numeric=46,'Admin nonpaged projection effective';
 execute 'reset role';
 perform public.crew_cash_save_settings(outlet,'{"allow_authorized_management_checkout":true}');
 insert into public.crew_sessions(employee_id,token_hash,expires_at) values(manager,encode(extensions.digest(tok,'sha256'),'hex'),now()+interval '5 minutes');
 value:=public.crew_management_cash_mobile(tok,outlet,d);
 assert (value#>>'{checkout,carry_forward}')::numeric=46 and (value#>>'{checkout,amount_for_deposit}')::numeric=400,'Mobile detail effective';
 assert (value#>>'{checkout_history,0,carry_forward}')::numeric=46 and (value#>>'{checkout_history,0,amount_for_deposit}')::numeric=400,'Crew History effective';
 assert jsonb_array_length(value#>'{checkout_history,0,allocation_corrections}')=1,'Shared history audit';
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,45,correction,gen_random_uuid(),'Unauthorized'); exception when insufficient_privilege then denied:=true; end; assert denied,'Unauthorized Admin denied';
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 assert public.crew_cash_previous_carry(outlet,d+1)=46,'Next-day carry effective';
 assert (select to_jsonb(x)=before_checkout from public.crew_cash_checkouts x where id=c),'Completed checkout byte-equivalent';
 assert (select to_jsonb(x)=before_ledger from public.crew_cash_ledger_entries x where id=ledger_id),'Original ledger byte-equivalent';
 assert (select count(*)=1 from public.crew_cash_checkout_adjustments where checkout_id=c),'One correction';
 assert (select count(*)=2 from public.crew_cash_ledger_entries where checkout_id=c),'One original plus one adjustment';
 assert not has_function_privilege('anon','public.crew_cash_correct_checkout_allocation(uuid,numeric,uuid,uuid,text)','EXECUTE'),'Crew cannot correct';
 assert not has_function_privilege('authenticated','public.crew_cash_checkout_allocation(uuid)','EXECUTE'),'Projector private';
 -- Existing completed-row and correction immutability guards remain effective.
 denied:=false; begin update public.crew_cash_checkouts set carry_forward=46 where id=c; exception when invalid_parameter_value then denied:=true; end; assert denied,'Original checkout immutable';
 denied:=false; begin update public.crew_cash_checkout_adjustments set reason='rewrite' where id=correction; exception when invalid_parameter_value then denied:=true; end; assert denied,'Correction evidence immutable';
 -- A subsequent allocation keeps an explicit predecessor and adds only its net delta.
 value:=public.crew_cash_correct_checkout_allocation(c,40,correction,gen_random_uuid(),'Subsequent allocation correction');
 assert (value#>>'{checkout,amount_for_deposit}')::numeric=406 and (value#>>'{correction,signed_amount}')::numeric=6,'Subsequent delta';
 value:=public.crew_cash_correct_checkout_allocation(c,46,null,request,'Correct closing allocation: RM46 carried forward to next day; deposit corrected to RM400.');
 assert value#>>'{correction,id}'=correction::text and (value#>>'{checkout,carry_forward}')::numeric=40,'Late retry cannot replay or rewind allocation';
 value:=jsonb_set(value,'{correction,id}',to_jsonb((public.crew_cash_checkout_allocation(c)->>'allocation_correction_id')::text));
 -- Exercise insufficient funds through a canonical Handover inside a subtransaction.
 begin
  perform public.crew_cash_save_handover_receivers(outlet,array[manager]);
  perform public.crew_cash_admin_record_collection(outlet,jsonb_build_object('receiver_employee_id',manager,'amount',public.crew_cash_balance(outlet),'request_id',gen_random_uuid(),'purpose','cash_handover','note','Rollback QA only'));
  denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,41,(value#>>'{correction,id}')::uuid,gen_random_uuid(),'Unavailable deposited cash'); exception when invalid_parameter_value then denied:=true; end; assert denied,'Correction cannot overspend already handed-over funds';
  raise exception using errcode='ZX001',message='Rollback temporary Handover';
 exception when sqlstate 'ZX001' then null; end;
 value:=public.crew_cash_adjust_checkout(c,'reversal' ,null,'Reverse corrected deposit');
 assert (value#>>'{adjustment,signed_amount}')::numeric=-406,'Legacy reversal respects effective allocation';
 denied:=false; begin perform public.crew_cash_correct_checkout_allocation(c,39,(select id from public.crew_cash_checkout_adjustments where checkout_id=c and action='allocation' and previous_allocation_id=correction),gen_random_uuid(),'After reversal'); exception when object_not_in_prerequisite_state then denied:=true; end; assert denied,'Ambiguous ledger correction denied';
end $$;
select 'PASS: 746/300/446 -> Carry 46/Deposit 400; immutable evidence; atomic delta; replay/stale guards; next-day carry; private authority; reversal compatibility' result;
