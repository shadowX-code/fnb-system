-- Qualify the existing active-Equipment guard; its unqualified id is ambiguous.
do $fix$
declare
  definition text := pg_get_functiondef('public.factory_save_mesti_equipment_cleaning_requirement(jsonb)'::regprocedure);
  old_guard text := 'from unnest(v_ids) id left join public.factory_equipment equipment on equipment.id = id and equipment.status = ''active''';
  new_guard text := 'from unnest(v_ids) as selected(equipment_id) left join public.factory_equipment equipment on equipment.id = selected.equipment_id and equipment.status = ''active''';
begin
  if md5(definition) <> 'd8a336c29e07a29253c5b5cae8352af1' or strpos(definition, old_guard) = 0 then
    raise exception 'Equipment Cleaning save authority changed; audit before applying binding guard correction.';
  end if;
  execute replace(definition, old_guard, new_guard);
end $fix$;
