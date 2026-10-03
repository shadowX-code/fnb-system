-- Staging only. Run inside BEGIN/ROLLBACK; no cash, settings or sessions persist.
do $qa$
declare
 m uuid; crew uuid; outlet uuid; crew_outlet uuid; unavailable uuid; admin_id uuid;
 tok text:=encode(extensions.gen_random_bytes(32),'hex');
 crew_tok text:=encode(extensions.gen_random_bytes(32),'hex');
 value jsonb; before_value jsonb; denied boolean; qa_checkout_id uuid;
 position_name text; original_positions text[];
begin
 select e.id into m from public.employees e join public.crew_access ca on ca.employee_id=e.id
 where lower(e.workplace)='management' and ca.access_state='active' and cardinality(public.crew_authorized_outlet_ids(e.id))>0 limit 1;
 select o.id into outlet from public.outlets o where o.name='QA Demo — Reporting Posters' and o.id=any(public.crew_authorized_outlet_ids(m));
 select o.id into unavailable from public.outlets o where not (o.id=any(public.crew_authorized_outlet_ids(m))) limit 1;
 select e.auth_user_id into admin_id from public.employees e join public.roles r on r.id=e.role_id
 where e.enable_system_login and e.access_state='active' and e.is_active and lower(r.name)='owner' limit 1;
 assert m is not null and outlet is not null and unavailable is not null and admin_id is not null,'Safe QA identities/outlets required';
 assert not exists(select 1 from public.crew_cash_checkouts c where c.outlet_id=outlet and c.business_date=timezone('Asia/Kuala_Lumpur',now())::date),'QA outlet already has a checkout';
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform public.crew_cash_save_settings(outlet,'{"allow_authorized_management_checkout":false}');
 insert into public.crew_sessions(employee_id,token_hash,expires_at) values(m,encode(extensions.digest(tok,'sha256'),'hex'),now()+interval '10 minutes');
 assert not public.crew_cash_can_perform_checkout(m,outlet),'Disabled Management denied';
 denied:=false; begin perform public.crew_management_cash_save_checkout(tok,outlet,'draft','{}'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Disabled Management cannot save';
 before_value:=jsonb_build_object('initiate',public.crew_can_initiate_cash_handover(m,outlet),'receiver',public.crew_cash_receiver_is_eligible(outlet,m));
 value:=public.crew_cash_save_settings(outlet,'{"allow_authorized_management_checkout":true}');
 assert value->>'allow_authorized_management_checkout'='true','Settings save returns toggle';
 assert exists(select 1 from public.audit_logs a where a.action='crew_cash_management_checkout_eligibility_updated'
   and a.user_id=admin_id and a.metadata->>'outlet_id'=outlet::text and a.metadata->>'before'='false' and a.metadata->>'after'='true'),'Toggle change audited';
 assert public.crew_cash_settings_context(outlet)#>>'{settings,allow_authorized_management_checkout}'='true','Settings readback/reopen persists toggle';
 perform public.crew_cash_save_settings(outlet,'{"variance_tolerance":0}');
 assert public.crew_cash_can_perform_checkout(m,outlet),'Partial settings save preserves toggle';
 assert before_value=jsonb_build_object('initiate',public.crew_can_initiate_cash_handover(m,outlet),'receiver',public.crew_cash_receiver_is_eligible(outlet,m)),'Checkout never grants handover/receiver';
 value:=public.crew_management_cash_mobile(tok,outlet,timezone('Asia/Kuala_Lumpur',now())::date);
 assert value->>'can_perform'='true' and value->>'can_initiate_handover'=before_value->>'initiate' and value->>'is_cash_handover_receiver'=before_value->>'receiver','Read eligibility matches independent authorities';
 denied:=false; begin perform public.crew_management_cash_mobile(tok,unavailable,current_date); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Unauthorized outlet read denied';
 denied:=false; begin perform public.crew_management_cash_save_checkout(tok,unavailable,'draft','{}'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Unauthorized outlet write denied';
 denied:=false; begin perform public.crew_management_cash_save_checkout(tok,outlet,'draft',jsonb_build_object('checked_out_by_employee_id',m)); exception when invalid_parameter_value then denied:=true; end;
 assert denied,'Actor cannot be supplied';
 value:=public.crew_management_cash_save_checkout(tok,outlet,'draft','{"denomination_counts":{"100":10},"pos_expected_cash":1000}');
 qa_checkout_id:=(value#>>'{checkout,id}')::uuid;
 assert value#>>'{checkout,checked_out_by_employee_id}'=m::text and value#>>'{checkout,status}'='draft','Real Management actor and canonical draft';
 perform public.crew_cash_save_settings(outlet,'{"allow_authorized_management_checkout":false}');
 denied:=false; begin perform public.crew_management_cash_save_checkout(tok,outlet,'reconcile','{}'); exception when insufficient_privilege then denied:=true; end;
 assert denied and (select status='draft' from public.crew_cash_checkouts where id=qa_checkout_id),'Disabled stale session cannot continue';
 perform public.crew_cash_save_settings(outlet,'{"allow_authorized_management_checkout":true}');
 value:=public.crew_management_cash_save_checkout(tok,outlet,'reconcile','{}');
 assert value#>>'{checkout,id}'=qa_checkout_id::text and value#>>'{checkout,status}'='reconciled' and (value#>>'{checkout,variance}')::numeric=0,'Shared reconcile authority';
 value:=public.crew_management_cash_save_checkout(tok,outlet,'complete','{}');
 assert value#>>'{checkout,id}'=qa_checkout_id::text and value#>>'{checkout,status}'='completed','Shared completion authority';
 assert (select count(*)=1 and bool_and(recorded_by_employee_id=m) from public.crew_cash_ledger_entries where checkout_id=qa_checkout_id::uuid),'One ledger entry retains Management actor';
 assert (public.crew_management_cash_mobile(tok,outlet,timezone('Asia/Kuala_Lumpur',now())::date)#>>'{checkout_history,0,checked_out_by}')=(select full_name from employees where id=m),'Canonical History actor';
 denied:=false; begin perform public.crew_management_cash_save_checkout(tok,outlet,'draft','{}'); exception when invalid_parameter_value then denied:=true; end;
 assert denied,'Completed evidence frozen';

 select e.id,ca.primary_outlet_id,e.position into crew,crew_outlet,position_name from public.employees e join public.crew_access ca on ca.employee_id=e.id
 where lower(coalesce(e.workplace,''))<>'management' and ca.access_state='active' and e.is_active
 and coalesce(e.employment_status,'active') not in ('resigned','terminated') and ca.primary_outlet_id=public.crew_resolve_employee_outlet(e.id)
 and not exists(select 1 from public.crew_cash_checkouts c where c.outlet_id=ca.primary_outlet_id and c.business_date=timezone('Asia/Kuala_Lumpur',now())::date) limit 1;
 assert crew is not null,'Safe active Crew required';
 insert into public.crew_sessions(employee_id,token_hash,expires_at) values(crew,encode(extensions.digest(crew_tok,'sha256'),'hex'),now()+interval '10 minutes');
 insert into public.crew_cash_settings(outlet_id,required_positions) values(crew_outlet,array[position_name]) on conflict(outlet_id) do update set required_positions=array[position_name];
 assert public.crew_cash_can_perform_checkout(crew,crew_outlet),'Crew configured position eligible';
 assert public.crew_cash_mobile(crew_tok,timezone('Asia/Kuala_Lumpur',now())::date)->>'can_perform'='true','Existing Crew read eligible';
 value:=public.crew_cash_save_checkout(crew_tok,'draft','{}');
 assert value#>>'{checkout,checked_out_by_employee_id}'=crew::text,'Crew actor remains unchanged';
 update public.crew_cash_settings set required_positions=array['QA mismatched position'] where outlet_id=crew_outlet;
 assert not public.crew_cash_can_perform_checkout(crew,crew_outlet),'Crew position still required';
 denied:=false; begin perform public.crew_cash_save_checkout(crew_tok,'reconcile','{}'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Crew mismatched position write denied';
 update public.crew_cash_settings set required_positions='{}',allow_authorized_management_checkout=false where outlet_id=crew_outlet;
 assert public.crew_cash_can_perform_checkout(crew,crew_outlet),'Crew all-position setting remains eligible with Management disabled';
 denied:=false; begin perform public.crew_management_cash_save_checkout(crew_tok,crew_outlet,'draft','{}'); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Crew cannot use Management outlet adapter';
 assert not has_function_privilege('anon','public.crew_cash_employee_context(text)','execute')
   and not has_function_privilege('authenticated','public.crew_cash_can_perform_checkout(uuid,uuid)','execute'),'Internal helpers private';
end; $qa$;
select 'PASS: independent Management/position eligibility, disabled and unauthorized denial, settings readback, shared cash lifecycle/actor/ledger/history, unchanged Crew boundary' as result;
