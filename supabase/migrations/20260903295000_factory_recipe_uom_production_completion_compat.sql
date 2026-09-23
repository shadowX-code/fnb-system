-- Production does not include the later MeSTI equipment-cleaning chain. Keep
-- its established completion authority intact while enforcing Recipe UOM
-- validation whenever a recipe-linked completion supplies a recipe ID.
create or replace function public.factory_complete_production_with_raw_batch_allocations(p_request_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_employee_id uuid;
  v_employee_name text;
  v_production_id uuid;
  v_authoritative_payload jsonb;
  v_recipe_id uuid := nullif(p_payload->>'recipe_id', '')::uuid;
begin
  v_employee_id := public.factory_current_active_employee_id();
  v_employee_name := public.factory_current_active_employee_name();
  v_authoritative_payload := (p_payload - 'operator_id' - 'operator_name' - 'recipe_id') || jsonb_build_object('operator_id', v_employee_id, 'operator_name', v_employee_name);
  if v_recipe_id is not null then
    perform public.factory_validate_production_recipe_usage_internal(v_recipe_id, nullif(v_authoritative_payload->>'actual_output_qty', '')::numeric, coalesce(v_authoritative_payload->'usage_items', '[]'::jsonb));
  end if;
  v_production_id := public.factory_complete_production_with_raw_batch_allocations_impl_050031(p_request_id, v_authoritative_payload);
  if to_regprocedure('public.factory_mesti_materialize_equipment_cleaning_after_production(uuid)') is not null then
    execute 'select public.factory_mesti_materialize_equipment_cleaning_after_production($1)' using v_production_id;
  end if;
  return v_production_id;
end;
$$;

revoke all on function public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb) from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb) to authenticated;
