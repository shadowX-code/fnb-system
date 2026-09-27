-- Reuse the existing Reporting financial contract for Outlet P&L. No formula,
-- source-row or role-permission writes. Product Analytics remains reports-only.
do $migration$
declare
  definition text;
  signature text;
  old_guard text := 'if not public.current_user_has_permission(''reports.view'') then';
begin
  foreach signature in array array[
    'public.reporting_monthly_outlet_financials(uuid,integer,integer)',
    'public.reporting_scope_outlets(uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition, old_guard) = 0 then
      raise exception 'Unexpected Reporting permission contract: %', signature;
    end if;
    execute replace(definition, old_guard,
      'if not (public.current_user_has_permission(''reports.view'') or public.current_user_has_permission(''outlet_pnl.view'')) then');
  end loop;
  -- This shared scope helper also serves products: retain the original stricter
  -- Reports permission at that public endpoint before using the shared scope.
  definition := pg_get_functiondef('public.reporting_monthly_scope_product_sales(uuid,integer,integer)'::regprocedure);
  if strpos(definition, E'begin\n') = 0 then raise exception 'Unexpected Product Reporting contract'; end if;
  execute replace(definition, E'begin\n', E'begin\n  if auth.uid() is null or not public.current_user_has_permission(''reports.view'') then\n    raise exception using errcode = ''42501'', message = ''Missing permission to view reports.'';\n  end if;\n');
end;
$migration$;
