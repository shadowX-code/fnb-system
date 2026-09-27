-- Complete setup readiness is a read projection, never a calculation gate or
-- promotion of a future policy into work-date-effective Payroll evidence.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.payroll_annual_holiday_read(integer)'::regprocedure);
 if position('''can_manage'',public.current_user_has_permission' in definition)=0 then raise exception 'Operational holiday read contract changed'; end if;
 definition:=replace(definition,'''can_manage'',public.current_user_has_permission',
 '''benefit_ready'',public.current_user_has_all_outlet_access() and exists(select 1 from public.legal_entities where is_active)
 and not exists(select 1 from public.legal_entities le where le.is_active and not exists(select 1 from public.payroll_ph_policy_versions ph where ph.legal_entity_id=le.id
 and ph.effective_from<=case when p_year=extract(year from timezone(''Asia/Kuala_Lumpur'',now())::date)::integer then timezone(''Asia/Kuala_Lumpur'',now())::date else make_date(p_year,1,1) end)),
 ''can_manage'',public.current_user_has_permission');
 execute definition;
end $$;
