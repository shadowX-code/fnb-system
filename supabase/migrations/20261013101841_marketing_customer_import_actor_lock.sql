-- Keep the verified employee/Auth pairing stable until this bounded batch commits.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('marketing_private.customer_import_tick()'::regprocedure);
 execute replace(definition,
  $old$if not exists(select 1 from public.employees where id=j.actor_employee_id and auth_user_id=j.actor_auth_id) then$old$,
  $new$perform 1 from public.employees where id=j.actor_employee_id and auth_user_id=j.actor_auth_id for share;
  if not found then$new$);
end;$$;
