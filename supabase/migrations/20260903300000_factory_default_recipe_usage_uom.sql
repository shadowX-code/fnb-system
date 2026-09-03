-- Raw Material defaults guide only newly selected Recipe/BOM rows. They do not
-- rewrite stored recipe semantics, stock quantities, or historical production.
alter table public.factory_raw_materials
  add column if not exists default_recipe_usage_uom text;

create or replace function public.factory_raw_material_uom_reachable(
  p_storage_uom text,
  p_package_uom text,
  p_package_quantity numeric,
  p_base_uom text,
  p_from_uom text,
  p_to_uom text
) returns boolean language plpgsql immutable set search_path = public as $$
declare
  v_from text := public.factory_normalize_uom(p_from_uom);
  v_to text := public.factory_normalize_uom(p_to_uom);
  v_package text := public.factory_normalize_uom(p_package_uom);
  v_base text := public.factory_normalize_uom(p_base_uom);
begin
  if v_from = '' or v_to = '' then return false; end if;
  if v_from = v_to then return true; end if;
  if public.factory_uom_dimension(v_from) is not null
    and public.factory_uom_dimension(v_from) = public.factory_uom_dimension(v_to) then
    return true;
  end if;
  if v_package = '' or public.factory_uom_dimension(v_base) is null or coalesce(p_package_quantity, 0) <= 0 then
    return false;
  end if;
  if v_from = v_package and public.factory_uom_dimension(v_to) = public.factory_uom_dimension(v_base) then
    return true;
  end if;
  if v_to = v_package and public.factory_uom_dimension(v_from) = public.factory_uom_dimension(v_base) then
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.factory_validate_raw_material_uom_conversion()
returns trigger language plpgsql set search_path = public as $$
declare
  v_package text := public.factory_normalize_uom(new.conversion_package_uom);
  v_base text := public.factory_normalize_uom(new.conversion_base_uom);
  v_default text := public.factory_normalize_uom(new.default_recipe_usage_uom);
begin
  if not (new.conversion_package_uom is null and new.conversion_package_quantity is null and new.conversion_base_uom is null) then
    if new.conversion_package_uom is null or new.conversion_package_quantity is null or new.conversion_base_uom is null then
      raise exception 'Package conversion requires package UOM, quantity and base UOM.';
    end if;
    if new.conversion_package_quantity <= 0 then
      raise exception 'Package conversion quantity must be greater than zero.';
    end if;
    if v_package not in ('pack', 'pail', 'bottle', 'bag', 'carton', 'pcs') then
      raise exception 'Package conversion source UOM must be a package unit.';
    end if;
    if public.factory_uom_dimension(v_base) is null then
      raise exception 'Package conversion base UOM must be kg, g, litre or ml.';
    end if;
    new.conversion_package_uom := v_package;
    new.conversion_base_uom := v_base;
  end if;
  if v_default = '' then
    new.default_recipe_usage_uom := null;
  elsif not public.factory_raw_material_uom_reachable(new.uom, new.conversion_package_uom, new.conversion_package_quantity, new.conversion_base_uom, v_default, new.uom) then
    raise exception 'Default Recipe Usage UOM must be reachable from Raw Material storage UOM.';
  else
    new.default_recipe_usage_uom := v_default;
  end if;
  return new;
end;
$$;

drop trigger if exists factory_validate_raw_material_uom_conversion on public.factory_raw_materials;
create trigger factory_validate_raw_material_uom_conversion
before insert or update of uom, conversion_package_uom, conversion_package_quantity, conversion_base_uom, default_recipe_usage_uom
on public.factory_raw_materials
for each row execute function public.factory_validate_raw_material_uom_conversion();

create or replace function public.factory_validate_recipe_usage_uom()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_material public.factory_raw_materials%rowtype;
  v_usage text := public.factory_normalize_uom(coalesce(new.recipe_usage_uom, new.uom));
begin
  select * into v_material from public.factory_raw_materials where id = new.raw_material_id;
  if not found then raise exception 'Every BOM row requires an existing raw material and positive quantity.'; end if;
  if v_usage = '' then raise exception 'Every BOM row requires a Usage UOM.'; end if;
  if not public.factory_raw_material_uom_reachable(v_material.uom, v_material.conversion_package_uom, v_material.conversion_package_quantity, v_material.conversion_base_uom, v_usage, v_material.uom) then
    raise exception 'Recipe Usage UOM must be reachable from Raw Material storage UOM.';
  end if;
  new.recipe_usage_uom := v_usage;
  new.uom := v_usage;
  return new;
end;
$$;

drop trigger if exists factory_validate_recipe_usage_uom on public.factory_product_recipe_items;
create trigger factory_validate_recipe_usage_uom
before insert or update of raw_material_id, recipe_usage_uom, uom
on public.factory_product_recipe_items
for each row execute function public.factory_validate_recipe_usage_uom();
