-- Inactive workplaces remain evidence but do not block a current operation.
do $$ declare definition text; anchor text:='where (p_outlet_id is null or o.id=p_outlet_id) and public.current_user_can_access_outlet(o.id)'; begin
 definition:=pg_get_functiondef('public.payroll_holiday_operation_read(uuid)'::regprocedure);
 if strpos(definition,anchor)=0 then raise exception 'Operation read scope anchor changed'; end if;
 execute replace(definition,anchor,'where o.is_active and (p_outlet_id is null or o.id=p_outlet_id) and public.current_user_can_access_outlet(o.id)');
end $$;
