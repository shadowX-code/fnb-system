-- Draft-only Recipe repinning for Production SOPs. This preserves the SOP
-- version and structure while keeping Active, Archived, and used SOP evidence
-- immutable. Recipe versions themselves are never altered.

create or replace function public.factory_update_draft_production_sop_recipe(
  p_sop_id uuid,
  p_recipe_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sop public.factory_production_sops%rowtype;
  v_recipe public.factory_product_recipes%rowtype;
begin
  if not (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  ) then
    raise exception 'Missing permission: factory_production_sop.edit';
  end if;

  select sop.*
  into v_sop
  from public.factory_production_sops sop
  where sop.id = p_sop_id
  for update;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  if lower(coalesce(v_sop.status, '')) <> 'draft'
     or exists (
       select 1
       from public.factory_productions production
       where production.production_sop_id = v_sop.id
     ) then
    raise exception using errcode = '55000', message = 'FACTORY_SOP_RECIPE_UPDATE_PROTECTED';
  end if;

  select recipe.*
  into v_recipe
  from public.factory_product_recipes recipe
  where recipe.id = p_recipe_id
    and recipe.product_family_id = v_sop.finished_good_id
    and lower(coalesce(recipe.status, '')) = 'active';

  if not found then
    raise exception 'Only the current active Product Recipe for this Finished Good can be linked to a Draft SOP.';
  end if;

  update public.factory_production_sops sop
  set recipe_id = v_recipe.id,
      recipe_version = v_recipe.version,
      updated_at = now()
  where sop.id = v_sop.id;

  return jsonb_build_object(
    'sop_id', v_sop.id,
    'recipe_id', v_recipe.id,
    'recipe_version', v_recipe.version
  );
end;
$$;

revoke all on function public.factory_update_draft_production_sop_recipe(uuid, uuid) from public, anon;
grant execute on function public.factory_update_draft_production_sop_recipe(uuid, uuid) to authenticated;
