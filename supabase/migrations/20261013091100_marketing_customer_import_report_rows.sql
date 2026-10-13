-- Preserve non-personal source positions after raw input has been cleared.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('marketing_private.customer_import_tick()'::regprocedure);
 execute replace(definition,
  $old$jsonb_build_object('row',r.row_number)$old$,
  $new$jsonb_build_object('row',r.row_number,'file_row',case when r.input->>'row' ~ '^[0-9]{1,7}$' and (r.input->>'row')::integer between 2 and 1048576 then (r.input->>'row')::integer else r.row_number+1 end)$new$);
end;$$;
