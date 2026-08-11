-- Keep Raw Material Stock Check approval aligned with the authoritative
-- Raw Material Movement schema. Movement storage is resolved from the exact
-- raw_material_batch_balance_id and is not duplicated on the movement row.

do $migration$
declare
  v_function regprocedure := to_regprocedure(
    'public.factory_approve_raw_material_stock_check(uuid,uuid)'
  );
  v_definition text;
  v_old_columns text := 'created_by, storage_location_id,';
  v_new_columns text := 'created_by,';
  v_old_negative_values text := E'v_actor.id, v_batch.storage_location_id, v_batch.id';
  v_new_negative_values text := E'v_actor.id, v_batch.id';
  v_old_positive_values text := E'v_actor.id, v_location.id, v_adjustment_batch_id';
  v_new_positive_values text := E'v_actor.id, v_adjustment_batch_id';
begin
  if v_function is null then
    raise exception 'Required Raw Material Stock Check approval function is missing.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'factory_raw_material_movements'
      and column_name = 'storage_location_id'
  ) then
    raise exception 'Unexpected duplicate Raw Material Movement storage column exists; review before applying Stock Check hardening.';
  end if;

  select pg_get_functiondef(v_function::oid)
  into v_definition;

  if position(v_old_columns in v_definition) = 0
     and position(v_old_negative_values in v_definition) = 0
     and position(v_old_positive_values in v_definition) = 0
     and position(v_new_columns in v_definition) > 0
     and position(v_new_negative_values in v_definition) > 0
     and position(v_new_positive_values in v_definition) > 0 then
    return;
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_old_columns, ''))
  ) / length(v_old_columns) <> 2 then
    raise exception 'Expected exactly two invalid Raw Material Movement storage column references in Stock Check approval.';
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_old_negative_values, ''))
  ) / length(v_old_negative_values) <> 1 then
    raise exception 'Expected exactly one invalid negative Stock Check movement storage value.';
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_old_positive_values, ''))
  ) / length(v_old_positive_values) <> 1 then
    raise exception 'Expected exactly one invalid positive Stock Check movement storage value.';
  end if;

  v_definition := replace(v_definition, v_old_columns, v_new_columns);
  v_definition := replace(v_definition, v_old_negative_values, v_new_negative_values);
  v_definition := replace(v_definition, v_old_positive_values, v_new_positive_values);
  execute v_definition;
end;
$migration$;

revoke execute on function public.factory_approve_raw_material_stock_check(uuid, uuid)
from public, anon;
grant execute on function public.factory_approve_raw_material_stock_check(uuid, uuid)
to authenticated;
