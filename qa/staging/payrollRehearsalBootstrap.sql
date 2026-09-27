-- LOCAL rehearsal only. Never apply to Staging or Production.
do $$
declare role_id uuid; auth_id uuid:=gen_random_uuid(); actor uuid;
begin
 insert into public.roles(name,is_system_role,outlet_access_type) values('Owner',true,'all') returning id into role_id;
 insert into auth.users(id) values(auth_id);
 perform set_config('request.jwt.claim.sub',auth_id::text,true);
 insert into public.employees(full_name,employee_code,auth_user_id,role_id,enable_system_login,access_state,joined_date)
 values('LOCAL ONLY rehearsal actor','LOCAL-PAYROLL',auth_id,role_id,true,'active','2026-01-01') returning id into actor;
 perform set_config('request.jwt.claim.sub',auth_id::text,true);
 if to_regprocedure('public.payroll_monthly_rule_confirm()') is not null then
   perform public.payroll_monthly_rule_confirm();
 end if;
end $$;
