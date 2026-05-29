-- Keep staging Master Inventory deterministic after the baseline seed.
-- Removes incomplete staging-only scratch rows that are not part of the seeded master data.

delete from public.inventory_items item
where lower(coalesce(item.item_name, '')) = lower('Blackpepper Sauce')
  and item.sku_code is null
  and item.category_id is null
  and not exists (
    select 1
    from public.inventory_item_outlets link
    where link.inventory_item_id = item.id
  );
