-- Validate optional non-personal source row metadata before background processing.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.platform_customer_import_job(uuid,uuid,text,uuid,jsonb)'::regprocedure);
 execute replace(definition,
  $old$if jsonb_typeof(v) is distinct from 'object'$old$,
  $new$if v ? 'row' then
    if jsonb_typeof(v->'row') is distinct from 'number' or v->>'row' !~ '^[0-9]{1,7}$' then raise exception 'Invalid source row number.';end if;
    if (v->>'row')::integer not between 2 and 1048576 then raise exception 'Invalid source row number.';end if;
   end if;
   if jsonb_typeof(v) is distinct from 'object'$new$);
end;$$;
