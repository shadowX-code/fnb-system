-- A first Recipe/SOP is the only create path for a Finished Good. Subsequent
-- revisions must use the existing trusted new-version authorities.

alter function public.save_factory_product_recipe(uuid, jsonb, jsonb)
  rename to save_factory_product_recipe_impl_0908;

create or replace function public.save_factory_product_recipe(
  p_request_id uuid, p_recipe jsonb, p_bom_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipe_id uuid := nullif(p_recipe->>'id', '')::uuid;
  v_family_id uuid := nullif(p_recipe->>'product_family_id', '')::uuid;
begin
  if v_recipe_id is null and v_family_id is not null then
    perform pg_advisory_xact_lock(hashtext('factory_product_recipe_family:' || v_family_id::text));
    if exists (select 1 from public.factory_product_recipes where product_family_id = v_family_id) then
      raise exception using errcode = '23505', message = 'FACTORY_RECIPE_FAMILY_EXISTS';
    end if;
  end if;

  return public.save_factory_product_recipe_impl_0908(p_request_id, p_recipe, p_bom_items);
end;
$$;

alter function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid, uuid[])
  rename to factory_save_production_sop_structure_impl_0908;

create or replace function public.factory_save_production_sop_structure(
  p_sop_id uuid, p_finished_good_id uuid, p_title text, p_effective_date date, p_remarks text,
  p_recipe_id uuid, p_recipe_version text, p_steps jsonb, p_created_by uuid, p_equipment_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_sop_id is null and p_finished_good_id is not null then
    perform pg_advisory_xact_lock(hashtext('factory_production_sop_family:' || p_finished_good_id::text));
    if exists (select 1 from public.factory_production_sops where finished_good_id = p_finished_good_id) then
      raise exception using errcode = '23505', message = 'FACTORY_SOP_FAMILY_EXISTS';
    end if;
  end if;

  return public.factory_save_production_sop_structure_impl_0908(
    p_sop_id, p_finished_good_id, p_title, p_effective_date, p_remarks,
    p_recipe_id, p_recipe_version, p_steps, p_created_by, p_equipment_ids
  );
end;
$$;

create unique index if not exists factory_production_sops_finished_good_version_unique
  on public.factory_production_sops (finished_good_id, lower(version))
  where finished_good_id is not null and nullif(version, '') is not null;

revoke all on function public.save_factory_product_recipe(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_factory_product_recipe(uuid, jsonb, jsonb) to authenticated;
revoke all on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid, uuid[]) from public, anon;
grant execute on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid, uuid[]) to authenticated;
