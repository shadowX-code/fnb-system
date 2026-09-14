-- Equipment is a required activation configuration, not a Draft authoring
-- prerequisite. Draft SOPs may be authored/imported without Equipment so long
-- as activation remains blocked until an active binding is provided.

alter function public.factory_save_production_sop_structure(
  uuid, uuid, text, date, text, uuid, text, jsonb, uuid, uuid[]
) rename to factory_save_production_sop_structure_impl_20260914;

create or replace function public.factory_save_production_sop_structure(
  p_sop_id uuid,
  p_finished_good_id uuid,
  p_title text,
  p_effective_date date,
  p_remarks text,
  p_recipe_id uuid,
  p_recipe_version text,
  p_steps jsonb,
  p_created_by uuid,
  p_equipment_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved jsonb;
  v_sop_id uuid;
begin
  if p_sop_id is null and p_finished_good_id is not null then
    perform pg_advisory_xact_lock(hashtext('factory_production_sop_family:' || p_finished_good_id::text));
    if exists (
      select 1
      from public.factory_production_sops sop
      where sop.finished_good_id = p_finished_good_id
    ) then
      raise exception using errcode = '23505', message = 'FACTORY_SOP_FAMILY_EXISTS';
    end if;
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_equipment_ids, '{}'::uuid[])) equipment_id
    left join public.factory_equipment equipment
      on equipment.id = equipment_id
     and equipment.status = 'active'
    where equipment.id is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'Only active Equipment can be bound to a Production SOP.';
  end if;

  v_saved := public.factory_save_production_sop_structure(
    p_sop_id,
    p_finished_good_id,
    p_title,
    p_effective_date,
    p_remarks,
    p_recipe_id,
    p_recipe_version,
    p_steps,
    p_created_by
  );

  v_sop_id := (v_saved->>'sop_id')::uuid;
  delete from public.factory_production_sop_equipment where sop_id = v_sop_id;
  insert into public.factory_production_sop_equipment(sop_id, equipment_id)
  select v_sop_id, equipment_id
  from unnest(coalesce(p_equipment_ids, '{}'::uuid[])) equipment_id
  on conflict do nothing;

  return v_saved;
end;
$$;

alter function public.factory_activate_production_sop(uuid)
  rename to factory_activate_production_sop_impl_20260914;

create or replace function public.factory_activate_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();

  if exists (
    select 1
    from public.factory_production_sops sop
    where sop.id = p_sop_id
      and lower(coalesce(sop.status, '')) = 'draft'
  ) and not exists (
    select 1
    from public.factory_production_sop_equipment binding
    join public.factory_equipment equipment
      on equipment.id = binding.equipment_id
     and equipment.status = 'active'
    where binding.sop_id = p_sop_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'Assign at least one active Equipment before activating this SOP.';
  end if;

  return public.factory_activate_production_sop_impl_20260914(p_sop_id);
end;
$$;

revoke all on function public.factory_save_production_sop_structure(
  uuid, uuid, text, date, text, uuid, text, jsonb, uuid, uuid[]
) from public, anon;
grant execute on function public.factory_save_production_sop_structure(
  uuid, uuid, text, date, text, uuid, text, jsonb, uuid, uuid[]
) to authenticated;

revoke all on function public.factory_activate_production_sop(uuid) from public, anon;
grant execute on function public.factory_activate_production_sop(uuid) to authenticated;
