-- A verified People Auth-link change must never transfer an old import approval.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('marketing_private.customer_import_tick()'::regprocedure);
 definition:=replace(definition,
  $old$perform marketing_private.require_access(j.organization_id,j.brand_id,'platform_customers.manage');$old$,
  $new$if not exists(select 1 from public.employees where id=j.actor_employee_id and auth_user_id=j.actor_auth_id) then
   raise exception using errcode='42501',message='IMPORT_ACTOR_CHANGED';
  end if;
  if marketing_private.require_access(j.organization_id,j.brand_id,'platform_customers.manage') is distinct from j.actor_employee_id then
   raise exception using errcode='42501',message='IMPORT_ACTOR_CHANGED';
  end if;$new$);
 definition:=replace(definition,'attempts=attempts+1,error_code=sqlstate,error=case when sqlstate=',
  'attempts=case when sqlerrm=''IMPORT_ACTOR_CHANGED'' then 3 else attempts+1 end,error_code=sqlstate,error=case when sqlerrm=''IMPORT_ACTOR_CHANGED'' then ''The confirming account identity changed. Start a new import through an authorized account.'' when sqlstate=');
 execute definition;
end;$$;
