-- The POS wizard uses Malaysia-local dates; UTC midnight must not reject today's export.
do $$
declare signature regprocedure;definition text;
begin
 foreach signature in array array['public.platform_customer_command(uuid,uuid,uuid,jsonb)'::regprocedure,'marketing_private.customer_import_row(uuid,uuid,jsonb)'::regprocedure,'public.platform_customer_import_job(uuid,uuid,text,uuid,jsonb)'::regprocedure] loop
  definition:=pg_get_functiondef(signature);
  execute replace(definition,'current_date', $date$(now() at time zone 'Asia/Kuala_Lumpur')::date$date$);
 end loop;
end;$$;
