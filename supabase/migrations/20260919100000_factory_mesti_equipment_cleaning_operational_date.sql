create or replace function public.factory_mesti_materialize_equipment_cleaning_after_production(p_production_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inserted integer := 0;
begin
  insert into public.factory_mesti_equipment_cleaning_occurrences(requirement_id, logical_requirement_id, equipment_id, due_date, source_type, production_id, requirement_snapshot)
  select null, null, equipment.id, production.end_date, 'after_production', production.id,
    jsonb_build_object(
      'task_name', 'After Production Cleaning', 'source_type', 'after_production',
      'equipment_id', equipment.id, 'equipment_code', equipment.equipment_code, 'equipment_name', equipment.name,
      'location_id', location.id, 'location_name', location.location_name,
      'production_id', production.id, 'job_order_id', production.job_order_id,
      'production_snapshot', jsonb_build_object(
        'production_no', production.production_no, 'batch_no', production.batch_no,
        'product_name', production.product_name, 'production_sop_id', production.production_sop_id,
        'sop_version', production.sop_version, 'production_end_date', production.end_date,
        'production_end_time', production.end_time,
        'operational_completion_at', public.factory_production_operational_completion_at(production.end_date, production.end_time),
        'completed_at', production.completed_at
      )
    )
  from public.factory_productions production
  join public.factory_production_sop_equipment binding on binding.sop_id = production.production_sop_id
  join public.factory_equipment equipment on equipment.id = binding.equipment_id
  join public.factory_storage_locations location on location.id = equipment.current_location_id
  where production.id = p_production_id
    and lower(production.status) = 'completed'
    and production.end_date is not null
  on conflict (production_id, equipment_id) where source_type = 'after_production' do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
revoke all on function public.factory_mesti_materialize_equipment_cleaning_after_production(uuid) from public, anon, authenticated;
