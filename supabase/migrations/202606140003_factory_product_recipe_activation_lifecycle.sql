-- Factory Product Recipe lifecycle activation.
-- Activating a draft Production Standard archives the previous active standard
-- for the same Finished Good inside one database transaction.

create or replace function public.factory_activate_product_recipe(
  p_recipe_id uuid
)
returns table(recipe_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_recipe record;
begin
  if not public.current_user_has_permission('factory_product_recipes.manage') then
    raise exception 'Missing permission to activate Factory Production Standards';
  end if;

  select *
  into v_recipe
  from public.factory_product_recipes
  where id = p_recipe_id
  for update;

  if v_recipe.id is null then
    raise exception 'Production Standard not found';
  end if;

  if lower(coalesce(v_recipe.status, '')) <> 'draft' then
    raise exception 'Only draft Production Standards can be activated';
  end if;

  if v_recipe.finished_good_id is null then
    raise exception 'Production Standard must be linked to a Finished Good';
  end if;

  perform pg_advisory_xact_lock(hashtext('factory_product_recipe_active:' || v_recipe.finished_good_id::text));

  update public.factory_product_recipes
  set
    status = 'archived',
    updated_at = now()
  where finished_good_id = v_recipe.finished_good_id
    and id <> v_recipe.id
    and lower(coalesce(status, '')) = 'active';

  update public.factory_product_recipes
  set
    status = 'active',
    updated_at = now()
  where id = v_recipe.id;

  return query
  select v_recipe.id;
end;
$$;

grant execute on function public.factory_activate_product_recipe(uuid) to authenticated;

do $$
begin
  if exists (
    select 1
    from (
      select finished_good_id, lower(version) as normalized_version, count(*) as version_count
      from public.factory_product_recipes
      where finished_good_id is not null
        and nullif(version, '') is not null
      group by finished_good_id, lower(version)
      having count(*) > 1
    ) duplicate_versions
  ) then
    raise notice 'Skipping factory_product_recipes_finished_good_version_unique because duplicate recipe versions already exist.';
  else
    execute 'create unique index if not exists factory_product_recipes_finished_good_version_unique on public.factory_product_recipes(finished_good_id, lower(version)) where finished_good_id is not null and nullif(version, '''') is not null';
  end if;
end;
$$;

create or replace function public.factory_create_product_recipe_new_version(
  p_source_recipe_id uuid
)
returns table(recipe_id uuid, version text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source public.factory_product_recipes%rowtype;
  v_new_recipe_id uuid;
  v_max_version integer;
  v_next_version text;
  v_recipe_code text;
begin
  if not public.current_user_has_permission('factory_product_recipes.create') then
    raise exception 'Missing permission to create Factory Production Standards';
  end if;

  select *
  into v_source
  from public.factory_product_recipes
  where id = p_source_recipe_id;

  if v_source.id is null then
    raise exception 'Source Production Standard not found';
  end if;

  if v_source.finished_good_id is null then
    raise exception 'Source Production Standard must be linked to a Finished Good';
  end if;

  perform pg_advisory_xact_lock(hashtext('factory_product_recipe_version:' || v_source.finished_good_id::text));

  select coalesce(max(substring(recipe.version from '^[vV]?([0-9]+)$')::integer), 0)
  into v_max_version
  from public.factory_product_recipes recipe
  where recipe.finished_good_id = v_source.finished_good_id;

  v_next_version := 'v' || (v_max_version + 1)::text;
  v_recipe_code := 'FGRCP-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.factory_product_recipes (
    recipe_code,
    finished_good_id,
    recipe_name,
    product_name,
    version,
    yield_quantity,
    uom,
    estimated_production_time_minutes,
    status,
    notes,
    remarks,
    created_at,
    updated_at
  )
  values (
    v_recipe_code,
    v_source.finished_good_id,
    v_source.recipe_name,
    v_source.product_name,
    v_next_version,
    v_source.yield_quantity,
    v_source.uom,
    v_source.estimated_production_time_minutes,
    'draft',
    v_source.notes,
    v_source.remarks,
    now(),
    now()
  )
  returning id into v_new_recipe_id;

  insert into public.factory_product_recipe_items (
    recipe_id,
    raw_material_id,
    quantity_used,
    uom,
    wastage_percent,
    sort_order,
    notes,
    remarks,
    created_at,
    updated_at
  )
  select
    v_new_recipe_id,
    item.raw_material_id,
    item.quantity_used,
    item.uom,
    item.wastage_percent,
    item.sort_order,
    item.notes,
    item.remarks,
    now(),
    now()
  from public.factory_product_recipe_items item
  where item.recipe_id = v_source.id
  order by item.sort_order, item.created_at, item.id;

  return query
  select v_new_recipe_id, v_next_version;
end;
$$;

grant execute on function public.factory_create_product_recipe_new_version(uuid) to authenticated;
