-- Equipment Cleaning verification is governed by canonical review/manage permission.
-- The completing employee may verify when their assigned role holds that permission.
create or replace function public.factory_mesti_verify_equipment_cleaning_occurrence(p_occurrence_id uuid, p_result text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee public.employees%rowtype := public.factory_mesti_current_employee();
  v_occurrence public.factory_mesti_equipment_cleaning_occurrences%rowtype;
  v_result text := lower(coalesce(p_result, 'verified'));
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.review') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to verify Equipment Cleaning occurrences.';
  end if;

  select * into v_occurrence from public.factory_mesti_equipment_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then
    raise exception using errcode = 'P0002', message = 'Equipment Cleaning occurrence was not found.';
  end if;
  if v_occurrence.status <> 'completed' then
    raise exception using errcode = '55000', message = 'Only completed Equipment Cleaning occurrences can be verified.';
  end if;
  if v_result not in ('verified', 'unsatisfactory') then
    raise exception using errcode = '22023', message = 'Unsupported verification result.';
  end if;

  update public.factory_mesti_equipment_cleaning_occurrences
  set status = v_result,
      verified_by = v_employee.id,
      verified_at = now(),
      verification_result = v_result,
      verification_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_occurrence.id
  returning * into v_occurrence;

  return to_jsonb(v_occurrence);
end;
$$;

revoke all on function public.factory_mesti_verify_equipment_cleaning_occurrence(uuid, text, text) from public, anon;
grant execute on function public.factory_mesti_verify_equipment_cleaning_occurrence(uuid, text, text) to authenticated;
