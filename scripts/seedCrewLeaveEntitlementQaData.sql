-- Idempotent Staging-only Leave Entitlement / Balance v1 demo data.
begin;
do $$
declare admin_id constant uuid:='266912cf-0e84-4074-82b5-0fc483080741'; role_id uuid; employee_row record; outlet_id uuid; v_entitlement_id uuid; balance jsonb; amount numeric; request_id uuid;
begin
 if timezone('Asia/Kuala_Lumpur',now())::date<>'2026-08-13'::date then raise exception 'Leave Balance QA seed is date-bound to FeedX Staging 13 Aug 2026.'; end if;
 if (select count(*) from public.employees where employee_code in ('QA-CREW-CO-01','QA-CREW-IF-01','QA-CREW-IP-01','QA-CREW-NA-01','QA-CREW-NS-01'))<>5 then raise exception 'Five dedicated QA Crew are required.'; end if;
 select e.role_id into role_id from public.employees e where e.auth_user_id=admin_id and e.is_active;
 if role_id is null then raise exception 'Crew Admin QA guard failed.'; end if;
 insert into public.role_permissions(role_id,permission_id) select role_id,p.id from public.permissions p where p.code in ('crew_leave.view','crew_leave.review','crew_leave.manage','crew_leave_balance.view','crew_leave_balance.manage','crew_leave_balance.adjust','crew_leave_settings.manage') on conflict do nothing;
 insert into public.crew_sessions(employee_id,token_hash,expires_at) select e.id,encode(extensions.digest('leave-balance-demo-'||e.employee_code,'sha256'),'hex'),now()+interval '30 days' from public.employees e where e.employee_code like 'QA-CREW-%' on conflict(token_hash) do update set expires_at=excluded.expires_at,revoked_at=null;
 select public.crew_resolve_employee_outlet(id) into outlet_id from public.employees where employee_code='QA-CREW-CO-01';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated';
 perform public.crew_leave_policy_save(outlet_id,'annual',jsonb_build_object('annual_days',12,'proration_enabled',true,'balance_enforced',true,'carry_forward_enabled',true,'max_carry_forward_days',5,'carry_forward_expiry_month',3,'carry_forward_expiry_day',31));
 perform public.crew_leave_policy_save(outlet_id,'medical',jsonb_build_object('annual_days',14,'proration_enabled',false,'balance_enforced',true,'carry_forward_enabled',false,'max_carry_forward_days',0));
 execute 'reset role';

 for employee_row in select e.id,e.employee_code from public.employees e where e.employee_code in ('QA-CREW-CO-01','QA-CREW-IF-01','QA-CREW-IP-01','QA-CREW-NA-01','QA-CREW-NS-01') loop
  v_entitlement_id:=public.crew_leave_ensure_entitlement(employee_row.id,'annual','2026-01-01',outlet_id,admin_id);
  if employee_row.employee_code='QA-CREW-CO-01' and not exists(select 1 from public.crew_leave_adjustments a where a.entitlement_id=v_entitlement_id and a.reason='[QA Balance v1] Extra carried training allowance') then execute 'set local role authenticated'; perform public.crew_leave_adjust(v_entitlement_id,3,'[QA Balance v1] Extra carried training allowance'); execute 'reset role'; end if;
  if employee_row.employee_code='QA-CREW-IF-01' and not exists(select 1 from public.crew_leave_adjustments a where a.entitlement_id=v_entitlement_id and a.reason='[QA Balance v1] Near-exhausted balance scenario') then balance:=public.crew_leave_entitlement_balance(v_entitlement_id); amount:=1-coalesce((balance->>'available')::numeric,0); if amount<>0 then execute 'set local role authenticated'; perform public.crew_leave_adjust(v_entitlement_id,amount,'[QA Balance v1] Near-exhausted balance scenario'); execute 'reset role'; end if; end if;
 end loop;

 if not exists(select 1 from public.crew_leave_requests where reason='[QA Balance v1] Pending reservation') then perform public.crew_leave_submit('leave-balance-demo-QA-CREW-IP-01',jsonb_build_object('leave_type','annual','start_date','2026-11-10','end_date','2026-11-10','duration_type','full_day','reason','[QA Balance v1] Pending reservation')); end if;
 if not exists(select 1 from public.crew_leave_requests where reason='[QA Balance v1] Approved medical usage') then request_id:=(public.crew_leave_submit('leave-balance-demo-QA-CREW-NA-01',jsonb_build_object('leave_type','medical','start_date','2026-11-11','end_date','2026-11-11','duration_type','full_day','reason','[QA Balance v1] Approved medical usage'))->>'id')::uuid; execute 'set local role authenticated'; perform public.crew_leave_review(request_id,'approve'); execute 'reset role'; end if;
end $$;
commit;
select jsonb_build_object('qa_crew',count(distinct e.id),'entitlements',count(distinct ce.id),'adjustments',count(distinct a.id),'pending_requests',count(distinct r.id) filter(where r.status='pending'),'approved_requests',count(distinct r.id) filter(where r.status='approved')) as crew_leave_balance_qa_data
from public.employees e join public.crew_leave_entitlements ce on ce.employee_id=e.id left join public.crew_leave_adjustments a on a.entitlement_id=ce.id and a.reason like '[QA Balance v1]%' left join public.crew_leave_requests r on r.employee_id=e.id and r.reason like '[QA Balance v1]%' where e.employee_code in ('QA-CREW-CO-01','QA-CREW-IF-01','QA-CREW-IP-01','QA-CREW-NA-01','QA-CREW-NS-01');
