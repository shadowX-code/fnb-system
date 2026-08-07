-- Keep Production completion aligned with the authoritative Raw Material
-- Movement schema. Storage is derived from the immutable batch relationship;
-- the movement table intentionally does not duplicate a storage-location field.

do $migration$
declare
  v_function regprocedure := to_regprocedure(
    'public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb)'
  );
  v_definition text;
  v_old_columns text := E'reference_no, movement_date, notes, created_by, storage_location_id,\n        production_material_usage_id, raw_material_batch_balance_id';
  v_new_columns text := E'reference_no, movement_date, notes, created_by,\n        production_material_usage_id, raw_material_batch_balance_id';
  v_old_values text := E'''Raw material deducted from exact Production batch allocation.'', v_actor.id, v_batch.storage_location_id,\n        v_usage_id, v_batch.id';
  v_new_values text := E'''Raw material deducted from exact Production batch allocation.'', v_actor.id,\n        v_usage_id, v_batch.id';
begin
  if v_function is null then
    raise exception 'Required Production completion function is missing.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'factory_raw_material_movements'
      and column_name = 'storage_location_id'
  ) then
    raise exception 'Unexpected duplicate Raw Material Movement storage column exists; review before applying Production hardening.';
  end if;

  select pg_get_functiondef(v_function::oid)
  into v_definition;

  if position(v_old_columns in v_definition) = 0
     and position(v_old_values in v_definition) = 0
     and position(v_new_columns in v_definition) > 0
     and position(v_new_values in v_definition) > 0 then
    return;
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_old_columns, ''))
  ) / length(v_old_columns) <> 1 then
    raise exception 'Expected exactly one invalid Raw Material Movement storage column reference in Production completion.';
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_old_values, ''))
  ) / length(v_old_values) <> 1 then
    raise exception 'Expected exactly one invalid Raw Material Movement storage value in Production completion.';
  end if;

  v_definition := replace(v_definition, v_old_columns, v_new_columns);
  v_definition := replace(v_definition, v_old_values, v_new_values);
  execute v_definition;
end;
$migration$;

revoke execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
to authenticated;

