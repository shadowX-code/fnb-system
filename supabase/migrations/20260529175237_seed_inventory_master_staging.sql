-- Seed baseline Inventory Control master data for staging/demo environments.
-- Idempotent by category name, item SKU/name, and inventory item + outlet link.

do $$
declare
  raw_material_id uuid;
  packaging_id uuid;
  frozen_id uuid;
  beverage_id uuid;
  cleaning_id uuid;
  dry_goods_id uuid;
  kitchen_supply_id uuid;
  retail_item_id uuid;
  sambal_id uuid;
  cup_id uuid;
  chicken_id uuid;
  fc_id uuid;
  hpiph_id uuid;
  hliph_id uuid;
  sambal_photo_url text := 'https://ujkzdaaadnvcfayuldmh.supabase.co/storage/v1/object/public/inventory-item-photos/item_sambal/1780044957416-wv47cc.png';
begin
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Raw Material', 'Raw Material inventory classification.', 1, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Raw Material'));
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Packaging', 'Packaging inventory classification.', 2, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Packaging'));
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Frozen', 'Frozen inventory classification.', 3, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Frozen'));
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Beverage', 'Beverage inventory classification.', 4, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Beverage'));
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Cleaning', 'Cleaning inventory classification.', 5, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Cleaning'));
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Dry Goods', 'Dry Goods inventory classification.', 6, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Dry Goods'));
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Kitchen Supply', 'Kitchen Supply inventory classification.', 7, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Kitchen Supply'));
  insert into public.inventory_categories (name, description, sort_order, status, updated_at)
  select 'Retail Item', 'Retail Item inventory classification.', 8, 'active', now()
  where not exists (select 1 from public.inventory_categories where lower(name) = lower('Retail Item'));

  update public.inventory_categories
  set description = 'Raw Material inventory classification.', sort_order = 1, status = 'active', updated_at = now()
  where lower(name) = lower('Raw Material');
  update public.inventory_categories
  set description = 'Packaging inventory classification.', sort_order = 2, status = 'active', updated_at = now()
  where lower(name) = lower('Packaging');
  update public.inventory_categories
  set description = 'Frozen inventory classification.', sort_order = 3, status = 'active', updated_at = now()
  where lower(name) = lower('Frozen');
  update public.inventory_categories
  set description = 'Beverage inventory classification.', sort_order = 4, status = 'active', updated_at = now()
  where lower(name) = lower('Beverage');
  update public.inventory_categories
  set description = 'Cleaning inventory classification.', sort_order = 5, status = 'active', updated_at = now()
  where lower(name) = lower('Cleaning');
  update public.inventory_categories
  set description = 'Dry Goods inventory classification.', sort_order = 6, status = 'active', updated_at = now()
  where lower(name) = lower('Dry Goods');
  update public.inventory_categories
  set description = 'Kitchen Supply inventory classification.', sort_order = 7, status = 'active', updated_at = now()
  where lower(name) = lower('Kitchen Supply');
  update public.inventory_categories
  set description = 'Retail Item inventory classification.', sort_order = 8, status = 'active', updated_at = now()
  where lower(name) = lower('Retail Item');

  select id into raw_material_id from public.inventory_categories where lower(name) = lower('Raw Material') order by sort_order, created_at limit 1;
  select id into packaging_id from public.inventory_categories where lower(name) = lower('Packaging') order by sort_order, created_at limit 1;
  select id into frozen_id from public.inventory_categories where lower(name) = lower('Frozen') order by sort_order, created_at limit 1;
  select id into beverage_id from public.inventory_categories where lower(name) = lower('Beverage') order by sort_order, created_at limit 1;
  select id into cleaning_id from public.inventory_categories where lower(name) = lower('Cleaning') order by sort_order, created_at limit 1;
  select id into dry_goods_id from public.inventory_categories where lower(name) = lower('Dry Goods') order by sort_order, created_at limit 1;
  select id into kitchen_supply_id from public.inventory_categories where lower(name) = lower('Kitchen Supply') order by sort_order, created_at limit 1;
  select id into retail_item_id from public.inventory_categories where lower(name) = lower('Retail Item') order by sort_order, created_at limit 1;

  -- Touch variables so strict linters do not treat seeded optional categories as accidental.
  perform beverage_id, cleaning_id, dry_goods_id, kitchen_supply_id, retail_item_id;

  select id into fc_id from public.outlets where upper(coalesce(code, '')) = 'FC' or lower(name) = lower('Friends Corner') order by created_at limit 1;
  select id into hpiph_id from public.outlets where upper(coalesce(code, '')) = 'HPIPH' or lower(name) = lower('Happiness Kopitiam Ipoh') order by created_at limit 1;
  select id into hliph_id from public.outlets where upper(coalesce(code, '')) = 'HLIPH' or lower(name) = lower('Hola Hola Kopitiam Ipoh') order by created_at limit 1;

  update public.inventory_items
  set item_name = 'Sambal Sauce',
      sku_code = 'RAW-SAM-001',
      category_id = raw_material_id,
      unit = 'kg',
      photo_url = sambal_photo_url,
      description = 'House sambal batch for kitchen production.',
      status = 'active',
      updated_at = now()
  where sku_code = 'RAW-SAM-001' or lower(item_name) = lower('Sambal Sauce');

  if not found then
    insert into public.inventory_items (item_name, sku_code, category_id, unit, photo_url, description, status, created_at, updated_at)
    values ('Sambal Sauce', 'RAW-SAM-001', raw_material_id, 'kg', sambal_photo_url, 'House sambal batch for kitchen production.', 'active', now(), now());
  end if;

  update public.inventory_items
  set item_name = 'Takeaway Cup 12oz',
      sku_code = 'PKG-CUP-012',
      category_id = packaging_id,
      unit = 'pcs',
      description = 'Standard takeaway beverage cup.',
      status = 'active',
      updated_at = now()
  where sku_code = 'PKG-CUP-012' or lower(item_name) = lower('Takeaway Cup 12oz');

  if not found then
    insert into public.inventory_items (item_name, sku_code, category_id, unit, description, status, created_at, updated_at)
    values ('Takeaway Cup 12oz', 'PKG-CUP-012', packaging_id, 'pcs', 'Standard takeaway beverage cup.', 'active', now(), now());
  end if;

  update public.inventory_items
  set item_name = 'Frozen Chicken Cut',
      sku_code = 'FRZ-CHK-001',
      category_id = frozen_id,
      unit = 'kg',
      description = 'Frozen chicken for daily prep.',
      status = 'active',
      updated_at = now()
  where sku_code = 'FRZ-CHK-001' or lower(item_name) = lower('Frozen Chicken Cut');

  if not found then
    insert into public.inventory_items (item_name, sku_code, category_id, unit, description, status, created_at, updated_at)
    values ('Frozen Chicken Cut', 'FRZ-CHK-001', frozen_id, 'kg', 'Frozen chicken for daily prep.', 'active', now(), now());
  end if;

  select id into sambal_id from public.inventory_items where sku_code = 'RAW-SAM-001' order by updated_at desc limit 1;
  select id into cup_id from public.inventory_items where sku_code = 'PKG-CUP-012' order by updated_at desc limit 1;
  select id into chicken_id from public.inventory_items where sku_code = 'FRZ-CHK-001' order by updated_at desc limit 1;

  if sambal_id is not null and fc_id is not null then
    insert into public.inventory_item_outlets (inventory_item_id, outlet_id, par_level, storage_location, is_active, updated_at)
    values (sambal_id, fc_id, 24, 'Kitchen chiller', true, now())
    on conflict (inventory_item_id, outlet_id) do update
    set par_level = excluded.par_level,
        storage_location = excluded.storage_location,
        is_active = true,
        updated_at = now();
  end if;

  if sambal_id is not null and hpiph_id is not null then
    insert into public.inventory_item_outlets (inventory_item_id, outlet_id, par_level, storage_location, is_active, updated_at)
    values (sambal_id, hpiph_id, 24, 'Prep kitchen', true, now())
    on conflict (inventory_item_id, outlet_id) do update
    set par_level = excluded.par_level,
        storage_location = excluded.storage_location,
        is_active = true,
        updated_at = now();
  end if;

  if sambal_id is not null and hliph_id is not null then
    insert into public.inventory_item_outlets (inventory_item_id, outlet_id, par_level, storage_location, is_active, updated_at)
    values (sambal_id, hliph_id, 24, 'Prep kitchen', true, now())
    on conflict (inventory_item_id, outlet_id) do update
    set par_level = excluded.par_level,
        storage_location = excluded.storage_location,
        is_active = true,
        updated_at = now();
  end if;

  if cup_id is not null and fc_id is not null then
    insert into public.inventory_item_outlets (inventory_item_id, outlet_id, par_level, storage_location, is_active, updated_at)
    values (cup_id, fc_id, 800, 'Front counter dry rack', true, now())
    on conflict (inventory_item_id, outlet_id) do update
    set par_level = excluded.par_level,
        storage_location = excluded.storage_location,
        is_active = true,
        updated_at = now();
  end if;

  if chicken_id is not null and fc_id is not null then
    insert into public.inventory_item_outlets (inventory_item_id, outlet_id, par_level, storage_location, is_active, updated_at)
    values (chicken_id, fc_id, 60, 'Freezer A', true, now())
    on conflict (inventory_item_id, outlet_id) do update
    set par_level = excluded.par_level,
        storage_location = excluded.storage_location,
        is_active = true,
        updated_at = now();
  end if;

  if chicken_id is not null and hpiph_id is not null then
    insert into public.inventory_item_outlets (inventory_item_id, outlet_id, par_level, storage_location, is_active, updated_at)
    values (chicken_id, hpiph_id, 60, 'Freezer', true, now())
    on conflict (inventory_item_id, outlet_id) do update
    set par_level = excluded.par_level,
        storage_location = excluded.storage_location,
        is_active = true,
        updated_at = now();
  end if;
end $$;
