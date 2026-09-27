-- A second source/name must not create duplicate entitlement for the same
-- date/jurisdiction. Corrections need a reviewed supersession contract instead.
create unique index additional_holiday_date_jurisdiction_idx
 on public.payroll_additional_holiday_confirmations
 ((entry->'holiday'->>'holiday_date'),(entry->'holiday'->>'scope'),(coalesce(entry->'holiday'->>'state_code','')));
do $$ declare d text; begin
 d:=pg_get_functiondef('public.payroll_holiday_history_read(uuid)'::regprocedure);
 if position($s$'editable',v_editable$s$ in d)=0 then raise exception 'Holiday history contract changed'; end if;
 d:=replace(d,$s$'editable',v_editable$s$,$s$'editable',v_editable and not exists(select 1 from public.payroll_additional_holiday_confirmations where holiday_id=p_holiday_id)$s$);
 execute d;
end $$;
