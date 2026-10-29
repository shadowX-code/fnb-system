-- Abort if a concurrent task changes an owning authority after this audit.
do $preflight$ begin
  if md5(pg_get_functiondef('public.factory_mesti_cleaning_day(date)'::regprocedure)) <> '2c33e64ab2ae01e469a391826c4297c5' then raise exception 'Cleaning Method preflight: factory_mesti_cleaning_day changed; re-audit before applying.'; end if;
  if md5(pg_get_functiondef('public.factory_mesti_cleaning_month(date)'::regprocedure)) <> '9a748dcbf0ef6a44c50a556df54072ef' then raise exception 'Cleaning Method preflight: factory_mesti_cleaning_month changed; re-audit before applying.'; end if;
  if md5(pg_get_functiondef('public.factory_mesti_cleaning_occurrence_snapshot(factory_mesti_cleaning_requirements,factory_storage_locations)'::regprocedure)) <> 'b50bb5f2bdd12d92726c4c7afa3cd2f1' then raise exception 'Cleaning Method preflight: factory_mesti_cleaning_occurrence_snapshot changed; re-audit before applying.'; end if;
  if md5(pg_get_functiondef('public.factory_mesti_equipment_cleaning_day(date)'::regprocedure)) <> 'd04cab0df7e61e271658c76a327f0860' then raise exception 'Cleaning Method preflight: factory_mesti_equipment_cleaning_day changed; re-audit before applying.'; end if;
  if md5(pg_get_functiondef('public.factory_mesti_equipment_cleaning_month(date)'::regprocedure)) <> 'a78f67db088c04c0104677429b68cff2' then raise exception 'Cleaning Method preflight: factory_mesti_equipment_cleaning_month changed; re-audit before applying.'; end if;
  if md5(pg_get_functiondef('public.factory_mesti_materialize_equipment_cleaning_scheduled(date,date)'::regprocedure)) <> '8104cd5beb29fad10671e5c3cf826554' then raise exception 'Cleaning Method preflight: factory_mesti_materialize_equipment_cleaning_scheduled changed; re-audit before applying.'; end if;
  if md5(pg_get_functiondef('public.factory_save_mesti_cleaning_requirement(jsonb)'::regprocedure)) <> '586fbad84c613bb10eadeb3be339cd2e' then raise exception 'Cleaning Method preflight: factory_save_mesti_cleaning_requirement changed; re-audit before applying.'; end if;
  if md5(pg_get_functiondef('public.factory_save_mesti_equipment_cleaning_requirement(jsonb)'::regprocedure)) <> 'f45cd9a70faea6bd1106e0d114955160' then raise exception 'Cleaning Method preflight: factory_save_mesti_equipment_cleaning_requirement changed; re-audit before applying.'; end if;
end $preflight$;
-- Fixed reference procedures supplied by the FeedX owner; not chemical-use parameters.
-- Existing requirements and occurrence snapshots are deliberately not backfilled.
create or replace function public.factory_mesti_cleaning_methods()
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select '[{"code":"cleaning","name":"Cleaning","materials":["Water","Detergent"],"steps":["Remove visible dirt/residue","Rinse with water","Wash with detergent","Rinse thoroughly and dry"],"verification":"Visual Inspection","reference_version":1,"reference_only":true},{"code":"sanitization","name":"Sanitization","materials":["Hot Water","Sanitizing Agent"],"steps":["Rinse with hot water","Apply approved sanitizing agent to surfaces"],"verification":"Visual Inspection","reference_version":1,"reference_only":true},{"code":"clean_in_place","name":"Clean-in-Place","materials":["Warm Water","Specialized Cleaning Chemical"],"steps":["Circulate warm water","Circulate cleaning chemical","Drain cleaning solution","Rinse with cold water"],"verification":"Visual Inspection","reference_version":1,"reference_only":true}]'::jsonb
$$;
create or replace function public.factory_mesti_cleaning_method_reference(p_code text)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select value from jsonb_array_elements(public.factory_mesti_cleaning_methods()) where value->>'code' = p_code
$$;
revoke all on function public.factory_mesti_cleaning_methods() from public, anon;
revoke all on function public.factory_mesti_cleaning_method_reference(text) from public, anon;
grant execute on function public.factory_mesti_cleaning_methods(), public.factory_mesti_cleaning_method_reference(text) to authenticated;

alter table public.factory_mesti_cleaning_requirements
  add column cleaning_method text,
  add column cleaning_method_reference jsonb,
  add constraint factory_mesti_cleaning_requirements_method_valid check (
    (cleaning_method is null and cleaning_method_reference is null) or
    (cleaning_method is not null and public.factory_mesti_cleaning_method_reference(cleaning_method) is not null
      and cleaning_method_reference is not null and cleaning_method_reference->>'code' = cleaning_method)
  );

alter table public.factory_mesti_equipment_cleaning_requirements
  add column cleaning_method text,
  add column cleaning_method_reference jsonb,
  add constraint factory_mesti_equipment_cleaning_requirements_method_valid check (
    (cleaning_method is null and cleaning_method_reference is null) or
    (cleaning_method is not null and public.factory_mesti_cleaning_method_reference(cleaning_method) is not null
      and cleaning_method_reference is not null and cleaning_method_reference->>'code' = cleaning_method)
  );

CREATE OR REPLACE FUNCTION public.factory_mesti_cleaning_day(p_due_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.factory_mesti_materialize_cleaning_occurrences(p_due_date, p_due_date);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'due_date', o.due_date,
      'status', o.status,
      'requirement_id', o.requirement_id,
      'logical_requirement_id', o.logical_requirement_id,
      'location_id', o.location_id,
      'location_name', o.requirement_snapshot->>'location_name',
      'location_code', o.requirement_snapshot->>'location_code',
      'location_type', o.requirement_snapshot->>'location_type',
      'recurrence_type', o.requirement_snapshot->>'recurrence_type',
      'recurrence_weekdays', o.requirement_snapshot->'recurrence_weekdays',
      'task_name', o.requirement_snapshot->>'task_name',
      'cleaning_method', o.requirement_snapshot->>'cleaning_method',
      'cleaning_method_reference', o.requirement_snapshot->'cleaning_method_reference',
      'responsible_role_id', o.requirement_snapshot->>'responsible_role_id',
      'verifier_role_id', o.requirement_snapshot->>'verifier_role_id',
      'version_no', o.requirement_snapshot->>'version_no',
      'completed_by', o.completed_by,
      'completed_by_name', coalesce(completer.nickname, completer.full_name, completer.email),
      'completed_at', o.completed_at,
      'completion_result', o.completion_result,
      'completion_note', o.completion_note,
      'verified_by', o.verified_by,
      'verified_by_name', coalesce(verifier.nickname, verifier.full_name, verifier.email),
      'verified_at', o.verified_at,
      'verification_result', o.verification_result,
      'verification_note', o.verification_note
    ) order by o.requirement_snapshot->>'location_name', o.requirement_snapshot->>'task_name')
    from public.factory_mesti_cleaning_occurrences o
    left join public.employees completer on completer.id = o.completed_by
    left join public.employees verifier on verifier.id = o.verified_by
    where o.due_date = p_due_date
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.factory_mesti_cleaning_month(p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month)::date + interval '1 month - 1 day')::date;
begin
  perform public.factory_mesti_materialize_cleaning_occurrences(v_from, v_to);
  return coalesce((
    with occurrences as (
      select o.id, o.due_date, o.status, o.requirement_id, o.logical_requirement_id, o.location_id,
             o.completed_by, o.completed_at, o.completion_result, o.completion_note,
             o.verified_by, o.verified_at, o.verification_result, o.verification_note,
             o.requirement_snapshot->>'location_name' as location_name,
             o.requirement_snapshot->>'location_code' as location_code,
             o.requirement_snapshot->>'location_type' as location_type,
             o.requirement_snapshot->>'recurrence_type' as recurrence_type,
             o.requirement_snapshot->'recurrence_weekdays' as recurrence_weekdays,
             o.requirement_snapshot->>'task_name' as task_name,
             o.requirement_snapshot->>'cleaning_method' as cleaning_method,
             o.requirement_snapshot->'cleaning_method_reference' as cleaning_method_reference,
             o.requirement_snapshot->>'responsible_role_id' as responsible_role_id,
             o.requirement_snapshot->>'verifier_role_id' as verifier_role_id,
             o.requirement_snapshot->>'version_no' as version_no,
             coalesce(completer.nickname, completer.full_name, completer.email) as completed_by_name,
             coalesce(verifier.nickname, verifier.full_name, verifier.email) as verified_by_name
      from public.factory_mesti_cleaning_occurrences o
      left join public.employees completer on completer.id = o.completed_by
      left join public.employees verifier on verifier.id = o.verified_by
      where o.due_date between v_from and v_to
    ), day_groups as (
      select requirement_id, logical_requirement_id, due_date,
             (array_agg(task_name order by id desc))[1] as task_name,
             (array_agg(recurrence_type order by id desc))[1] as recurrence_type,
             (array_agg(recurrence_weekdays order by id desc))[1] as recurrence_weekdays,
             (array_agg(version_no order by id desc))[1] as version_no,
             count(*)::integer as total_count,
             count(*) filter (where status = 'verified')::integer as verified_count,
             count(*) filter (where status = 'completed')::integer as completed_count,
             count(*) filter (where status = 'unsatisfactory')::integer as unsatisfactory_count,
             count(*) filter (where status = 'missed')::integer as missed_count,
             count(*) filter (where status = 'pending')::integer as pending_count,
             jsonb_agg(jsonb_build_object(
               'id', id, 'due_date', due_date, 'status', status,
               'requirement_id', requirement_id, 'logical_requirement_id', logical_requirement_id,
               'location_id', location_id, 'location_name', location_name,
               'location_code', location_code, 'location_type', location_type,
               'recurrence_type', recurrence_type, 'recurrence_weekdays', recurrence_weekdays,
               'cleaning_method', cleaning_method, 'cleaning_method_reference', cleaning_method_reference,
               'task_name', task_name, 'responsible_role_id', responsible_role_id,
               'verifier_role_id', verifier_role_id, 'version_no', version_no,
               'completed_by', completed_by, 'completed_by_name', completed_by_name,
               'completed_at', completed_at, 'completion_result', completion_result,
               'completion_note', completion_note, 'verified_by', verified_by,
               'verified_by_name', verified_by_name, 'verified_at', verified_at,
               'verification_result', verification_result, 'verification_note', verification_note
             ) order by location_name, id) as occurrences
      from occurrences
      group by requirement_id, logical_requirement_id, due_date
    ), requirement_groups as (
      select requirement_id, logical_requirement_id,
             (array_agg(task_name order by due_date desc))[1] as task_name,
             (array_agg(recurrence_type order by due_date desc))[1] as recurrence_type,
             (array_agg(recurrence_weekdays order by due_date desc))[1] as recurrence_weekdays,
             (array_agg(version_no order by due_date desc))[1] as version_no,
             jsonb_agg(jsonb_build_object(
               'due_date', due_date,
               'status', case
                 when unsatisfactory_count > 0 then 'unsatisfactory'
                 when missed_count > 0 then 'missed'
                 when completed_count > 0 and completed_count = total_count then 'completed'
                 when verified_count = total_count then 'verified'
                 when pending_count = total_count then 'pending'
                 else 'mixed'
               end,
               'total_count', total_count, 'verified_count', verified_count,
               'completed_count', completed_count, 'unsatisfactory_count', unsatisfactory_count,
               'missed_count', missed_count, 'pending_count', pending_count,
               'occurrences', occurrences
             ) order by due_date) as days
      from day_groups
      group by requirement_id, logical_requirement_id
    )
    select jsonb_agg(jsonb_build_object(
      'requirement_id', requirement_id,
      'logical_requirement_id', logical_requirement_id,
      'task_name', task_name,
      'recurrence_type', recurrence_type,
      'recurrence_weekdays', recurrence_weekdays,
      'version_no', version_no,
      'days', days
    ) order by task_name, logical_requirement_id, version_no)
    from requirement_groups
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.factory_mesti_cleaning_occurrence_snapshot(p_requirement factory_mesti_cleaning_requirements, p_location factory_storage_locations)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'requirement_id', p_requirement.id,
    'logical_requirement_id', p_requirement.logical_requirement_id,
    'task_name', p_requirement.task_name,
    'cleaning_method', p_requirement.cleaning_method,
    'cleaning_method_reference', p_requirement.cleaning_method_reference,
    'recurrence_type', p_requirement.recurrence_type,
    'recurrence_weekdays', p_requirement.recurrence_weekdays,
    'effective_from', p_requirement.effective_from,
    'effective_until', p_requirement.effective_until,
    'version_no', p_requirement.version_no,
    'location_id', p_location.id,
    'location_name', p_location.location_name,
    'location_code', p_location.location_code,
    'location_type', p_location.location_type
  )
$function$
;

CREATE OR REPLACE FUNCTION public.factory_mesti_equipment_cleaning_day(p_due_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(p_due_date,p_due_date);
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'due_date',o.due_date,'status',o.status,'requirement_id',o.requirement_id,'logical_requirement_id',o.logical_requirement_id,'task_name',o.requirement_snapshot->>'task_name','cleaning_method',o.requirement_snapshot->>'cleaning_method','cleaning_method_reference',o.requirement_snapshot->'cleaning_method_reference','source_type',o.source_type,'recurrence_type',o.requirement_snapshot->>'recurrence_type','recurrence_weekdays',o.requirement_snapshot->'recurrence_weekdays','equipment_id',o.equipment_id,'equipment_code',o.requirement_snapshot->>'equipment_code','equipment_name',o.requirement_snapshot->>'equipment_name','location_name',o.requirement_snapshot->>'location_name','production_id',o.production_id,'production_snapshot',o.requirement_snapshot->'production_snapshot','completed_by',o.completed_by,'completed_by_name',coalesce(c.nickname,c.full_name,c.email),'completed_at',o.completed_at,'verified_by',o.verified_by,'verified_by_name',coalesce(v.nickname,v.full_name,v.email),'verified_at',o.verified_at) order by o.created_at) from public.factory_mesti_equipment_cleaning_occurrences o left join public.employees c on c.id=o.completed_by left join public.employees v on v.id=o.verified_by where o.due_date=p_due_date),'[]'::jsonb);
end; $function$
;

CREATE OR REPLACE FUNCTION public.factory_mesti_equipment_cleaning_month(p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month)::date + interval '1 month - 1 day')::date;
begin
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(v_from, v_to);
  return coalesce((
    with occurrence_rows as (
      select occurrence.*, occurrence.requirement_snapshot->>'task_name' as task_name,
             occurrence.requirement_snapshot->>'recurrence_type' as recurrence_type,
             occurrence.requirement_snapshot->'recurrence_weekdays' as recurrence_weekdays,
             occurrence.requirement_snapshot->>'equipment_code' as equipment_code,
             occurrence.requirement_snapshot->>'equipment_name' as equipment_name,
             occurrence.requirement_snapshot->>'location_name' as location_name
      from public.factory_mesti_equipment_cleaning_occurrences occurrence
      where occurrence.due_date between v_from and v_to
    ), cells as (
      select occurrence_rows.equipment_id, min(occurrence_rows.equipment_code) as equipment_code,
             min(occurrence_rows.equipment_name) as equipment_name, min(occurrence_rows.location_name) as location_name,
             occurrence_rows.due_date, count(*)::integer as total_count,
             count(*) filter (where occurrence_rows.status = 'verified')::integer as verified_count,
             count(*) filter (where occurrence_rows.status = 'completed')::integer as completed_count,
             count(*) filter (where occurrence_rows.status = 'unsatisfactory')::integer as unsatisfactory_count,
             count(*) filter (where occurrence_rows.status = 'missed')::integer as missed_count,
             count(*) filter (where occurrence_rows.status = 'pending')::integer as pending_count,
             case when count(*) filter (where occurrence_rows.status = 'unsatisfactory') > 0 then 'unsatisfactory'
                  when count(*) filter (where occurrence_rows.status = 'missed') > 0 then 'missed'
                  when count(*) filter (where occurrence_rows.status = 'verified') = count(*) then 'verified'
                  when count(*) filter (where occurrence_rows.status = 'verified') > 0 then 'mixed'
                  when count(*) filter (where occurrence_rows.status = 'completed') > 0 then 'completed'
                  else 'pending' end as status,
             jsonb_agg(jsonb_build_object(
               'id', occurrence_rows.id, 'due_date', occurrence_rows.due_date, 'status', occurrence_rows.status,
               'requirement_id', occurrence_rows.requirement_id, 'logical_requirement_id', occurrence_rows.logical_requirement_id,
               'task_name', occurrence_rows.task_name,
               'cleaning_method', occurrence_rows.requirement_snapshot->>'cleaning_method',
               'cleaning_method_reference', occurrence_rows.requirement_snapshot->'cleaning_method_reference', 'source_type', occurrence_rows.source_type,
               'recurrence_type', occurrence_rows.recurrence_type, 'recurrence_weekdays', occurrence_rows.recurrence_weekdays,
               'equipment_id', occurrence_rows.equipment_id, 'equipment_code', occurrence_rows.equipment_code,
               'equipment_name', occurrence_rows.equipment_name, 'location_name', occurrence_rows.location_name,
               'production_id', occurrence_rows.production_id, 'production_snapshot', occurrence_rows.requirement_snapshot->'production_snapshot',
               'completed_by', occurrence_rows.completed_by,
               'completed_by_name', coalesce(completed_employee.nickname, completed_employee.full_name, completed_employee.email),
               'completed_at', occurrence_rows.completed_at, 'verified_by', occurrence_rows.verified_by,
               'verified_by_name', coalesce(verified_employee.nickname, verified_employee.full_name, verified_employee.email),
               'verified_at', occurrence_rows.verified_at
             ) order by occurrence_rows.created_at, occurrence_rows.id) as occurrences
      from occurrence_rows
      left join public.employees completed_employee on completed_employee.id = occurrence_rows.completed_by
      left join public.employees verified_employee on verified_employee.id = occurrence_rows.verified_by
      group by occurrence_rows.equipment_id, occurrence_rows.due_date
    ), equipment_rows as (
      select equipment_id, min(equipment_code) as equipment_code, min(equipment_name) as equipment_name, min(location_name) as location_name,
             coalesce(sum(total_count), 0)::integer as total_count, coalesce(sum(verified_count), 0)::integer as verified_count,
             coalesce(sum(completed_count), 0)::integer as completed_count, coalesce(sum(unsatisfactory_count), 0)::integer as unsatisfactory_count,
             coalesce(sum(missed_count), 0)::integer as missed_count, coalesce(sum(pending_count), 0)::integer as pending_count,
             jsonb_agg(jsonb_build_object('due_date', due_date, 'status', status, 'total_count', total_count,
               'verified_count', verified_count, 'completed_count', completed_count, 'unsatisfactory_count', unsatisfactory_count,
               'missed_count', missed_count, 'pending_count', pending_count, 'occurrences', occurrences) order by due_date) as days
      from cells
      group by equipment_id
    )
    select jsonb_agg(jsonb_build_object(
      'equipment_id', equipment_id, 'equipment_code', equipment_code, 'equipment_name', equipment_name, 'location_name', location_name,
      'summary', jsonb_build_object('total_count', total_count, 'verified_count', verified_count, 'completed_count', completed_count,
        'unsatisfactory_count', unsatisfactory_count, 'missed_count', missed_count, 'pending_count', pending_count),
      'days', days) order by equipment_code, equipment_name)
    from equipment_rows
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.factory_save_mesti_cleaning_requirement(p_requirement jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_method text := nullif(p_requirement->>'cleaning_method', '');
  v_method_reference jsonb;
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_current public.factory_mesti_cleaning_requirements%rowtype;
  v_previous public.factory_mesti_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_cleaning_requirements%rowtype;
  v_location_ids uuid[] := array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_requirement->'location_ids', '[]'::jsonb)) value order by 1);
  v_current_location_ids uuid[];
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_type text := lower(coalesce(nullif(p_requirement->>'recurrence_type', ''), 'daily'));
  v_weekdays integer[] := array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays', '[]'::jsonb)) value order by 1);
  v_requested_effective_from date;
  v_min_effective_from date;
  v_latest_evidence_date date;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_version_created boolean := false;
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.manage') or public.current_user_has_permission('factory_mesti_cleaning.create') or public.current_user_has_permission('factory_mesti_cleaning.edit')) then
    raise exception using errcode = '42501', message = 'Missing permission to manage Cleaning Requirements.';
  end if;
  if coalesce(p_requirement->>'effective_from', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'Select a valid Effective From date.';
  end if;
  begin
    v_requested_effective_from := (p_requirement->>'effective_from')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Select a valid Effective From date.';
  end;
  if nullif(btrim(p_requirement->>'task_name'), '') is null or cardinality(v_location_ids) = 0 then
    raise exception using errcode = '22023', message = 'Task name and at least one Location are required.';
  end if;
  if v_type not in ('daily', 'weekly') or (v_type = 'weekly' and cardinality(v_weekdays) = 0) then
    raise exception using errcode = '22023', message = 'Select a valid Cleaning recurrence.';
  end if;
  if exists (select 1 from unnest(v_location_ids) location_id left join public.factory_storage_locations location on location.id = location_id and location.status = 'active' where location.id is null) then
    raise exception using errcode = '22023', message = 'Only active Factory Locations may be selected.';
  end if;

  if v_method is not null and public.factory_mesti_cleaning_method_reference(v_method) is null then
    raise exception using errcode='22023', message='Select a valid Cleaning Method.';
  end if;
  v_method_reference := public.factory_mesti_cleaning_method_reference(v_method);
  if v_id is null then
    if v_method is null then raise exception using errcode='22023', message='Select one Cleaning Method.'; end if;
    insert into public.factory_mesti_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, created_by, cleaning_method, cleaning_method_reference)
    values (gen_random_uuid(), btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, coalesce(nullif(p_requirement->>'status', ''), 'active'), v_requested_effective_from, v_employee.id, v_method, v_method_reference)
    returning * into v_saved;
    v_version_created := true;
  else
    -- Hold the issued-date boundary stable against materialization and lifecycle writes.
    lock table public.factory_mesti_cleaning_occurrences in share mode;
    select * into v_current from public.factory_mesti_cleaning_requirements where id = v_id;
    if v_current.id is null then
      raise exception using errcode = '22023', message = 'Cleaning Requirement was not found.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text, 0));
    select * into v_current from public.factory_mesti_cleaning_requirements
    where logical_requirement_id = v_current.logical_requirement_id and effective_until is null
    order by version_no desc limit 1 for update;
    if v_current.id is distinct from v_id then
      raise exception using errcode = '40001', message = 'This Cleaning Requirement has changed. Reload Setup before editing.';
    end if;
    select coalesce(array_agg(link.location_id order by link.location_id), '{}'::uuid[]) into v_current_location_ids
    from public.factory_mesti_cleaning_requirement_locations link where link.requirement_id = v_current.id;
    select max(due_date) into v_latest_evidence_date from public.factory_mesti_cleaning_occurrences
    where logical_requirement_id = v_current.logical_requirement_id;

    if not (p_requirement ? 'cleaning_method') then v_method := v_current.cleaning_method; end if;
    if v_current.cleaning_method is not null and v_method is null then raise exception using errcode='22023', message='A specified Cleaning Method cannot be cleared.'; end if;
    v_method_reference := case when v_method is not distinct from v_current.cleaning_method then v_current.cleaning_method_reference else public.factory_mesti_cleaning_method_reference(v_method) end;
    if v_current.cleaning_method is not distinct from v_method and v_current.task_name = btrim(p_requirement->>'task_name') and v_current.recurrence_type = v_type
      and v_current.recurrence_weekdays = (case when v_type = 'daily' then '{}'::integer[] else v_weekdays end)
      and v_current.status = coalesce(nullif(p_requirement->>'status', ''), 'active')
      and v_current.effective_from = v_requested_effective_from and v_current_location_ids = v_location_ids then
      v_saved := v_current;
    elsif v_current.effective_from > v_today and not exists (
      select 1 from public.factory_mesti_cleaning_occurrences where requirement_id = v_current.id
    ) then
      select * into v_previous from public.factory_mesti_cleaning_requirements
      where logical_requirement_id = v_current.logical_requirement_id and superseded_by = v_current.id for update;
      v_min_effective_from := greatest(coalesce(v_previous.effective_from + 1, '-infinity'::date), coalesce(v_latest_evidence_date + 1, '-infinity'::date));
      if v_requested_effective_from < v_min_effective_from then
        raise exception using errcode = '22023', message = format('Effective From must be on or after %s to preserve existing versions and issued occurrences. The selected date was not saved.', to_char(v_min_effective_from, 'DD/MM/YYYY'));
      end if;
      -- Update the non-overlapping boundaries in the order that preserves exclusion constraints.
      if v_previous.id is not null and v_requested_effective_from < v_current.effective_from then
        update public.factory_mesti_cleaning_requirements set effective_until = v_requested_effective_from, updated_at = now() where id = v_previous.id;
      end if;
      update public.factory_mesti_cleaning_requirements
      set cleaning_method = v_method, cleaning_method_reference = v_method_reference, task_name = btrim(p_requirement->>'task_name'), recurrence_type = v_type,
        recurrence_weekdays = case when v_type = 'daily' then '{}'::integer[] else v_weekdays end,
        status = coalesce(nullif(p_requirement->>'status', ''), 'active'),
        effective_from = v_requested_effective_from, updated_at = now()
      where id = v_current.id returning * into v_saved;
      if v_previous.id is not null and v_requested_effective_from >= v_current.effective_from then
        update public.factory_mesti_cleaning_requirements set effective_until = v_requested_effective_from, updated_at = now() where id = v_previous.id;
      end if;
      delete from public.factory_mesti_cleaning_requirement_locations where requirement_id = v_saved.id;
    else
      v_min_effective_from := greatest(v_current.effective_from + 1, coalesce(v_latest_evidence_date + 1, '-infinity'::date));
      if v_requested_effective_from < v_min_effective_from then
        raise exception using errcode = '22023', message = format('Effective From must be on or after %s to preserve existing versions and issued occurrences. The selected date was not saved.', to_char(v_min_effective_from, 'DD/MM/YYYY'));
      end if;
      update public.factory_mesti_cleaning_requirements set effective_until = v_requested_effective_from, updated_at = now() where id = v_current.id;
      insert into public.factory_mesti_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by, cleaning_method, cleaning_method_reference)
      values (v_current.logical_requirement_id, btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, coalesce(nullif(p_requirement->>'status', ''), 'active'), v_requested_effective_from, v_current.version_no + 1, v_employee.id, v_method, v_method_reference)
      returning * into v_saved;
      update public.factory_mesti_cleaning_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
      v_version_created := true;
    end if;
  end if;

  insert into public.factory_mesti_cleaning_requirement_locations(requirement_id, location_id)
  select v_saved.id, location_id from unnest(v_location_ids) location_id on conflict do nothing;
  return to_jsonb(v_saved) || jsonb_build_object('location_ids', to_jsonb(v_location_ids),
    'location_names', coalesce((select jsonb_agg(location.location_name order by location.location_name) from public.factory_storage_locations location where location.id = any(v_location_ids)), '[]'::jsonb),
    'version_created', v_version_created);
end $function$
;

CREATE OR REPLACE FUNCTION public.factory_save_mesti_equipment_cleaning_requirement(p_requirement jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_method text := nullif(p_requirement->>'cleaning_method', '');
  v_method_reference jsonb;
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_current public.factory_mesti_equipment_cleaning_requirements%rowtype;
  v_saved public.factory_mesti_equipment_cleaning_requirements%rowtype;
  v_ids uuid[] := array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_requirement->'equipment_ids', '[]'::jsonb)) value order by 1);
  v_existing uuid[];
  v_weekdays integer[] := array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays', '[]'::jsonb)) value order by 1);
  v_requested date := coalesce(nullif(p_requirement->>'effective_from', '')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_effective date;
  v_latest_evidence date;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_created boolean := false;
  v_type text := coalesce(nullif(p_requirement->>'recurrence_type', ''), 'daily');
  v_status text := coalesce(nullif(p_requirement->>'status', ''), 'active');
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.manage') or public.current_user_has_permission(case when nullif(p_requirement->>'id', '') is null then 'factory_mesti_equipment_cleaning.create' else 'factory_mesti_equipment_cleaning.edit' end)) then raise exception using errcode = '42501', message = 'Missing permission to manage Equipment Cleaning Requirements.'; end if;
  if nullif(btrim(p_requirement->>'task_name'), '') is null or cardinality(v_ids) = 0 or v_type not in ('daily', 'weekly') or (v_type = 'weekly' and cardinality(v_weekdays) = 0) then raise exception using errcode = '22023', message = 'Task Name, active Equipment, and a valid recurrence are required.'; end if;
  if exists(select 1 from unnest(v_ids) id left join public.factory_equipment equipment on equipment.id = id and equipment.status = 'active' where equipment.id is null) then raise exception using errcode = '22023', message = 'Only active Equipment can be scheduled.'; end if;
  if v_method is not null and public.factory_mesti_cleaning_method_reference(v_method) is null then
    raise exception using errcode='22023', message='Select a valid Cleaning Method.';
  end if;
  v_method_reference := public.factory_mesti_cleaning_method_reference(v_method);
  if nullif(p_requirement->>'id', '') is null then
    if v_method is null then raise exception using errcode='22023', message='Select one Cleaning Method.'; end if;
    insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by, cleaning_method, cleaning_method_reference)
    values(gen_random_uuid(), btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, v_status, greatest(v_requested, v_today), 1, v_employee.id, v_method, v_method_reference) returning * into v_saved;
    v_created := true;
  else
    select * into v_current from public.factory_mesti_equipment_cleaning_requirements where id = (p_requirement->>'id')::uuid;
    if v_current.id is null then raise exception using errcode = '22023', message = 'Cleaning Requirement was not found.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text, 0));
    select * into v_current from public.factory_mesti_equipment_cleaning_requirements where logical_requirement_id = v_current.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
    select coalesce(array_agg(equipment_id order by equipment_id), '{}'::uuid[]) into v_existing from public.factory_mesti_equipment_cleaning_requirement_equipment where requirement_id = v_current.id;
    if not (p_requirement ? 'cleaning_method') then v_method := v_current.cleaning_method; end if;
    if v_current.cleaning_method is not null and v_method is null then raise exception using errcode='22023', message='A specified Cleaning Method cannot be cleared.'; end if;
    v_method_reference := case when v_method is not distinct from v_current.cleaning_method then v_current.cleaning_method_reference else public.factory_mesti_cleaning_method_reference(v_method) end;
    if v_current.cleaning_method is not distinct from v_method and v_current.task_name = btrim(p_requirement->>'task_name') and v_current.recurrence_type = v_type and v_current.recurrence_weekdays = (case when v_type = 'daily' then '{}'::integer[] else v_weekdays end) and v_current.status = v_status and v_current.effective_from = v_requested and v_existing = v_ids then
      v_saved := v_current;
    elsif v_current.effective_from > v_today and (v_method is not distinct from v_current.cleaning_method or not exists (select 1 from public.factory_mesti_equipment_cleaning_occurrences where requirement_id=v_current.id and status <> 'pending')) then
      update public.factory_mesti_equipment_cleaning_requirements set cleaning_method = v_method, cleaning_method_reference = v_method_reference, task_name = btrim(p_requirement->>'task_name'), recurrence_type = v_type, recurrence_weekdays = case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, status = v_status, effective_from = greatest(v_requested, v_today), updated_at = now() where id = v_current.id returning * into v_saved;
      delete from public.factory_mesti_equipment_cleaning_requirement_equipment where requirement_id = v_saved.id;
      delete from public.factory_mesti_equipment_cleaning_occurrences where requirement_id = v_saved.id and status = 'pending' and source_type = 'scheduled';
    else
      select max(due_date) into v_latest_evidence from public.factory_mesti_equipment_cleaning_occurrences where logical_requirement_id = v_current.logical_requirement_id and status <> 'pending';
      v_effective := greatest(v_requested, v_today, v_current.effective_from + 1, coalesce(v_latest_evidence + 1, '-infinity'::date));
      update public.factory_mesti_equipment_cleaning_requirements set effective_until = v_effective, updated_at = now() where id = v_current.id;
      insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id, task_name, recurrence_type, recurrence_weekdays, status, effective_from, version_no, created_by, cleaning_method, cleaning_method_reference)
      values(v_current.logical_requirement_id, btrim(p_requirement->>'task_name'), v_type, case when v_type = 'daily' then '{}'::integer[] else v_weekdays end, v_status, v_effective, v_current.version_no + 1, v_employee.id, v_method, v_method_reference) returning * into v_saved;
      update public.factory_mesti_equipment_cleaning_requirements set superseded_by = v_saved.id, updated_at = now() where id = v_current.id;
      delete from public.factory_mesti_equipment_cleaning_occurrences where requirement_id = v_current.id and status = 'pending' and source_type = 'scheduled' and due_date >= v_effective;
      v_created := true;
    end if;
  end if;
  insert into public.factory_mesti_equipment_cleaning_requirement_equipment(requirement_id, equipment_id) select v_saved.id, id from unnest(v_ids) id on conflict do nothing;
  return to_jsonb(v_saved) || jsonb_build_object('equipment_ids', to_jsonb(v_ids), 'version_created', v_created);
end $function$
;

CREATE OR REPLACE FUNCTION public.factory_mesti_materialize_equipment_cleaning_scheduled(p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_inserted integer;
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.view') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to view Factory MeSTI Cleaning of Equipment.'; end if;
  insert into public.factory_mesti_equipment_cleaning_occurrences(requirement_id,logical_requirement_id,equipment_id,due_date,source_type,requirement_snapshot)
  select requirement.id, requirement.logical_requirement_id, equipment.id, due.day::date, 'scheduled', jsonb_build_object('task_name',requirement.task_name,'cleaning_method',requirement.cleaning_method,'cleaning_method_reference',requirement.cleaning_method_reference,'source_type','scheduled','recurrence_type',requirement.recurrence_type,'recurrence_weekdays',requirement.recurrence_weekdays,'version_no',requirement.version_no,'equipment_id',equipment.id,'equipment_code',equipment.equipment_code,'equipment_name',equipment.name,'location_id',location.id,'location_name',location.location_name)
  from public.factory_mesti_equipment_cleaning_requirements requirement
  join public.factory_mesti_equipment_cleaning_requirement_equipment link on link.requirement_id=requirement.id
  join public.factory_equipment equipment on equipment.id=link.equipment_id and equipment.status='active'
  join public.factory_storage_locations location on location.id=equipment.current_location_id
  cross join generate_series(p_from,p_to,interval '1 day') due(day)
  where requirement.status='active' and due.day::date >= requirement.effective_from and (requirement.effective_until is null or due.day::date < requirement.effective_until) and public.factory_mesti_recurrence_due(requirement.recurrence_type,requirement.recurrence_weekdays,due.day::date)
  on conflict (logical_requirement_id,equipment_id,due_date) where source_type='scheduled' do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end; $function$
;

-- Method metadata is trusted reference data, never client-authored procedure text.
create or replace function public.factory_mesti_guard_cleaning_method()
returns trigger language plpgsql set search_path = public, pg_temp as $guard$
declare v_used boolean;
begin
  if TG_OP = 'INSERT' and new.cleaning_method is null then
    raise exception using errcode='22023', message='Select one Cleaning Method.';
  end if;
  if TG_OP = 'UPDATE' and new.cleaning_method is not distinct from old.cleaning_method then
    if new.cleaning_method_reference is distinct from old.cleaning_method_reference then
      raise exception using errcode='22023', message='Cleaning Method reference is immutable.';
    end if;
    return new;
  end if;
  if new.cleaning_method is null then raise exception using errcode='22023', message='A specified Cleaning Method cannot be cleared.'; end if;
  if TG_OP = 'UPDATE' then
    if TG_TABLE_NAME = 'factory_mesti_cleaning_requirements' then
      select exists(select 1 from public.factory_mesti_cleaning_occurrences where requirement_id=old.id and status <> 'pending') into v_used;
    else
      select exists(select 1 from public.factory_mesti_equipment_cleaning_occurrences where requirement_id=old.id and status <> 'pending') into v_used;
    end if;
    if old.effective_from <= (now() at time zone 'Asia/Kuala_Lumpur')::date or v_used then
      raise exception using errcode='22023', message='Change the Cleaning Method through a new requirement version.';
    end if;
  end if;
  new.cleaning_method_reference := public.factory_mesti_cleaning_method_reference(new.cleaning_method);
  if new.cleaning_method_reference is null then raise exception using errcode='22023', message='Select a valid Cleaning Method.'; end if;
  return new;
end $guard$;
revoke all on function public.factory_mesti_guard_cleaning_method() from public, anon;
create trigger factory_mesti_area_method_guard before insert or update of cleaning_method,cleaning_method_reference on public.factory_mesti_cleaning_requirements for each row execute function public.factory_mesti_guard_cleaning_method();
create trigger factory_mesti_equipment_method_guard before insert or update of cleaning_method,cleaning_method_reference on public.factory_mesti_equipment_cleaning_requirements for each row execute function public.factory_mesti_guard_cleaning_method();
