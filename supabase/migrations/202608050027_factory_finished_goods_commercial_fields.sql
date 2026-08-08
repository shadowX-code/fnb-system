-- Finished Goods commercial and handling metadata.
-- Product identity metadata belongs to the Finished Good family; SKU-specific
-- handling and pricing metadata belongs to the Packaging SKU inventory record.

alter table public.factory_product_families
  add column if not exists is_halal boolean not null default false;

alter table public.factory_finished_goods
  add column if not exists recommended_storage text,
  add column if not exists b2b_price numeric(12, 2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.factory_finished_goods'::regclass
      and conname = 'factory_finished_goods_recommended_storage_check'
  ) then
    alter table public.factory_finished_goods
      add constraint factory_finished_goods_recommended_storage_check
      check (recommended_storage is null or recommended_storage in ('room', 'chiller', 'freezer'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.factory_finished_goods'::regclass
      and conname = 'factory_finished_goods_b2b_price_check'
  ) then
    alter table public.factory_finished_goods
      add constraint factory_finished_goods_b2b_price_check
      check (b2b_price is null or b2b_price > 0);
  end if;
end;
$$;

comment on column public.factory_product_families.is_halal is
  'Whether the Finished Good product identity is Halal. Applies to all Packaging SKUs in the family.';

comment on column public.factory_finished_goods.recommended_storage is
  'Commercial handling recommendation: room, chiller, or freezer. This is not a physical inventory location.';

comment on column public.factory_finished_goods.b2b_price is
  'Optional B2B selling price in Malaysian Ringgit for one Packaging SKU.';

-- Active Recipe authority must be exact and singular for product-level costing.
-- Abort rather than choosing or archiving one of multiple historical candidates.
do $$
declare
  v_duplicate_families text;
begin
  select string_agg(duplicate.product_family_id::text, ', ' order by duplicate.product_family_id::text)
  into v_duplicate_families
  from (
    select recipe.product_family_id
    from public.factory_product_recipes recipe
    where recipe.product_family_id is not null
      and lower(btrim(coalesce(recipe.status, ''))) = 'active'
    group by recipe.product_family_id
    having count(*) > 1
  ) duplicate;

  if v_duplicate_families is not null then
    raise exception 'Multiple active Recipe versions exist for Finished Good families: %. Resolve them through the Recipe activation lifecycle before applying this migration.', v_duplicate_families;
  end if;
end;
$$;

create unique index if not exists factory_product_recipes_one_active_per_product_family
on public.factory_product_recipes(product_family_id)
where product_family_id is not null
  and lower(btrim(status)) = 'active';

-- Draft creation and structural editing remain available to the existing Recipe
-- roles, but direct table writes cannot establish an active version.
drop policy if exists "factory product recipes manage" on public.factory_product_recipes;
drop policy if exists "factory product recipes insert" on public.factory_product_recipes;
drop policy if exists "factory product recipes update" on public.factory_product_recipes;
drop policy if exists "factory product recipes delete" on public.factory_product_recipes;

create policy "factory product recipes insert"
on public.factory_product_recipes
for insert
to authenticated
with check (
  (
    public.current_user_has_permission('factory_product_recipes.create')
    or public.current_user_has_permission('factory_product_recipes.manage')
  )
  and lower(btrim(coalesce(status, ''))) <> 'active'
);

create policy "factory product recipes update"
on public.factory_product_recipes
for update
to authenticated
using (
  public.current_user_has_permission('factory_product_recipes.edit')
  or public.current_user_has_permission('factory_product_recipes.delete')
  or public.current_user_has_permission('factory_product_recipes.manage')
)
with check (
  (
    public.current_user_has_permission('factory_product_recipes.edit')
    or public.current_user_has_permission('factory_product_recipes.manage')
  )
  and lower(btrim(coalesce(status, ''))) <> 'active'
);

create policy "factory product recipes delete"
on public.factory_product_recipes
for delete
to authenticated
using (
  public.current_user_has_permission('factory_product_recipes.delete')
  or public.current_user_has_permission('factory_product_recipes.manage')
);

create or replace function public.factory_activate_product_recipe(
  p_recipe_id uuid
)
returns table(recipe_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipe public.factory_product_recipes%rowtype;
  v_lock_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if not public.current_user_has_permission('factory_product_recipes.manage') then
    raise exception 'Missing permission to activate Factory Production Standards';
  end if;

  select recipe.*
  into v_recipe
  from public.factory_product_recipes recipe
  where recipe.id = p_recipe_id
  for update;

  if v_recipe.id is null then
    raise exception 'Production Standard not found';
  end if;

  if lower(btrim(coalesce(v_recipe.status, ''))) <> 'draft' then
    raise exception 'Only draft Production Standards can be activated';
  end if;

  if v_recipe.product_family_id is null and v_recipe.finished_good_id is null then
    raise exception 'Production Standard must be linked to a Finished Good';
  end if;

  v_lock_key := coalesce(v_recipe.product_family_id::text, 'sku:' || v_recipe.finished_good_id::text);
  perform pg_advisory_xact_lock(hashtext('factory_product_recipe_active:' || v_lock_key));

  if v_recipe.product_family_id is not null then
    update public.factory_product_recipes recipe
    set status = 'archived',
        updated_at = now()
    where recipe.product_family_id = v_recipe.product_family_id
      and recipe.id <> v_recipe.id
      and lower(btrim(coalesce(recipe.status, ''))) = 'active';
  else
    update public.factory_product_recipes recipe
    set status = 'archived',
        updated_at = now()
    where recipe.finished_good_id = v_recipe.finished_good_id
      and recipe.product_family_id is null
      and recipe.id <> v_recipe.id
      and lower(btrim(coalesce(recipe.status, ''))) = 'active';
  end if;

  update public.factory_product_recipes recipe
  set status = 'active',
      updated_at = now()
  where recipe.id = v_recipe.id;

  return query select v_recipe.id;
end;
$$;

revoke all on function public.factory_activate_product_recipe(uuid) from public;
revoke all on function public.factory_activate_product_recipe(uuid) from anon;
grant execute on function public.factory_activate_product_recipe(uuid) to authenticated;
