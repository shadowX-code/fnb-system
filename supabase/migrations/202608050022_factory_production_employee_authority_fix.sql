-- Repair employee authority checks introduced by the applied Raw Material batch
-- allocation migration without changing Production or Stock Check business logic.

do $migration$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_bad_reference_count integer;
begin
  foreach v_signature in array array[
    'public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb)',
    'public.factory_approve_raw_material_stock_check(uuid,uuid)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Required Factory function is missing: %', v_signature;
    end if;

    select pg_get_functiondef(v_function::oid)
    into v_definition;

    v_bad_reference_count := (
      length(v_definition) - length(replace(v_definition, 'employee.status', ''))
    ) / length('employee.status');

    if v_bad_reference_count <> 1 then
      raise exception 'Expected exactly one employee.status reference in %, found %.',
        v_signature,
        v_bad_reference_count;
    end if;

    execute replace(
      v_definition,
      'employee.status',
      'employee.employment_status'
    );
  end loop;

  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname like 'factory\_%' escape '\'
      and has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      and position('employee.status' in pg_get_functiondef(function_row.oid)) > 0
  ) then
    raise exception 'A callable Factory function still references the invalid employees.status field.';
  end if;
end;
$migration$;

revoke execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
to authenticated;

revoke execute on function public.factory_approve_raw_material_stock_check(uuid, uuid)
from public, anon;
grant execute on function public.factory_approve_raw_material_stock_check(uuid, uuid)
to authenticated;
