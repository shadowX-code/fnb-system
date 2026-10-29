begin;

-- Owner-scoped synthetic storage only; no employee/session identities or permissions are changed.
do $test$
declare
  area public.factory_mesti_cleaning_requirements;
  eq public.factory_mesti_equipment_cleaning_requirements;
  loc public.factory_storage_locations;
  snapshot jsonb;
  legacy_id uuid;
  table_name text;
  inserted integer;
begin
  if jsonb_array_length(public.factory_mesti_cleaning_methods()) <> 3 then raise exception 'FAIL catalog count'; end if;
  if public.factory_mesti_cleaning_method_reference('invalid') is not null then raise exception 'FAIL unknown method'; end if;
  select * into loc from public.factory_storage_locations where status='active' order by id limit 1;
  if loc.id is null then raise exception 'Fixture needs an active Location'; end if;
  insert into public.factory_mesti_cleaning_requirements(logical_requirement_id,task_name,recurrence_type,recurrence_weekdays,status,effective_from,cleaning_method)
  values(gen_random_uuid(),'QA ONLY Method SQL rollback','daily','{}','active',(now() at time zone 'Asia/Kuala_Lumpur')::date+10,'cleaning') returning * into area;
  if area.cleaning_method_reference->>'name' <> 'Cleaning' then raise exception 'FAIL canonical reference'; end if;
  snapshot := public.factory_mesti_cleaning_occurrence_snapshot(area,loc);
  update public.factory_mesti_cleaning_requirements set cleaning_method='sanitization' where id=area.id returning * into area;
  if area.version_no <> 1 or area.cleaning_method_reference->>'name' <> 'Sanitization' then raise exception 'FAIL future edit'; end if;
  if snapshot->>'cleaning_method' <> 'cleaning' or snapshot->'cleaning_method_reference'->>'name' <> 'Cleaning' then raise exception 'FAIL snapshot changed'; end if;
  begin
    update public.factory_mesti_cleaning_requirements set cleaning_method_reference='{}'::jsonb where id=area.id;
    raise exception 'FAIL forged procedure accepted';
  exception when sqlstate '22023' then null; end;
  update public.factory_mesti_cleaning_requirements set effective_from=(now() at time zone 'Asia/Kuala_Lumpur')::date where id=area.id;
  begin
    update public.factory_mesti_cleaning_requirements set cleaning_method='clean_in_place' where id=area.id;
    raise exception 'FAIL effective method mutated in place';
  exception when sqlstate '22023' then null; end;
  insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id,task_name,recurrence_type,recurrence_weekdays,status,effective_from,cleaning_method)
  values(gen_random_uuid(),'QA ONLY Equipment Method SQL rollback','daily','{}','active',(now() at time zone 'Asia/Kuala_Lumpur')::date+10,'clean_in_place') returning * into eq;
  if eq.cleaning_method_reference->>'name' <> 'Clean-in-Place' or eq.cleaning_method_reference->>'verification' <> 'Visual Inspection' then raise exception 'FAIL equipment catalog'; end if;
  begin
    update public.factory_mesti_equipment_cleaning_requirements set cleaning_method=null where id=eq.id;
    raise exception 'FAIL method cleared';
  exception when sqlstate '22023' then null; end;
  begin
    insert into public.factory_mesti_cleaning_requirements(logical_requirement_id,task_name,recurrence_type,status,effective_from)
    values(gen_random_uuid(),'QA ONLY missing method','daily','active',current_date);
    raise exception 'FAIL missing method';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.factory_save_mesti_cleaning_requirement('{}'::jsonb);
    raise exception 'FAIL unauthenticated save accepted';
  exception when sqlstate '42501' then null; end;
  foreach table_name in array array['factory_mesti_cleaning_requirements','factory_mesti_equipment_cleaning_requirements'] loop
    execute format('select logical_requirement_id from public.%I group by logical_requirement_id having bool_and(cleaning_method is null) limit 1',table_name) into legacy_id;
    if legacy_id is null then raise exception 'Fixture needs an unspecified legacy lineage in %',table_name; end if;
    -- Mirror the canonical boundary closure only inside this rolled-back transaction.
    execute format('update public.%I set effective_until=current_date+10000 where logical_requirement_id=$1 and effective_until is null',table_name) using legacy_id;
    execute format('insert into public.%I(logical_requirement_id,task_name,recurrence_type,recurrence_weekdays,status,effective_from,effective_until,version_no) select logical_requirement_id,''QA ONLY legacy rollback'',recurrence_type,recurrence_weekdays,''inactive'',current_date+10000,current_date+10001,version_no+10000 from public.%I where logical_requirement_id=$1 order by version_no desc limit 1',table_name,table_name) using legacy_id;
    get diagnostics inserted=row_count;
    if inserted <> 1 then raise exception 'FAIL legacy version compatibility'; end if;
  end loop;
end $test$;
rollback;
