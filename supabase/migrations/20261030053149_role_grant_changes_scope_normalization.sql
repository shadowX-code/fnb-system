do $repair$
declare definition text;
begin
 select pg_get_functiondef('public.save_role_configuration(uuid,jsonb,text[],uuid[])'::regprocedure) into definition;
 if strpos(definition,'from public.role_outlets where role_id=target;')=0 then raise exception 'Role save scope contract changed.';end if;
 definition:=replace(definition,'from public.role_outlets where role_id=target;', 'from public.role_outlets where role_id=target;
   if not exists(select 1 from public.permissions p where p.code=any(codes) and p.requires_restaurant_outlet_scope) then outlets:=''{}'';end if;');
 execute definition;
end $repair$;
notify pgrst,'reload schema';
