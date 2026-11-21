begin;

-- Anchor the expiry check to the verified Stock Check write lifecycle and UOM blocker.
do $guard$
begin
  if exists (
    select 1 from (values
      ('inventory_authority.guard_scheduled_stock_check_date()'::regprocedure, '96d0e16e62901ca911225ee932a56907'),
      ('inventory_authority.stock_uom_change_blocker(uuid)'::regprocedure, '46c3d6a86d631325ed87ba0adde88e95')
    ) expected(oid, body_hash) join pg_catalog.pg_proc p on p.oid = expected.oid
    where md5(btrim(p.prosrc)) <> expected.body_hash
  ) then
    raise exception 'The Stock Check lifecycle or UOM guard changed. Review the expiry rule against the deployed functions.';
  end if;
end;
$guard$;

-- The scheduled write guard rejects changes after the stored occurrence's MYT business date.
-- A missing, non-finite or future date cannot establish that an occurrence has expired.
create function inventory_authority.scheduled_stock_check_occurrence_expired(p_check_date date, p_as_of timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(isfinite(p_check_date) and p_check_date < timezone('Asia/Kuala_Lumpur', p_as_of)::date, false);
$$;
revoke all on function inventory_authority.scheduled_stock_check_occurrence_expired(date,timestamptz)
  from public, anon, authenticated, service_role;

-- The caller must be able to reconcile every operational configuration on this global item.
create or replace function inventory_authority.stock_uom_change_blocker(p_item_id uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from public.inventory_item_outlets link where link.inventory_item_id = p_item_id
        and not public.current_user_can_access_outlet(link.outlet_id))
      or exists (select 1 from public.inventory_recipe_items line
        join public.inventory_recipes recipe on recipe.id = line.recipe_id
        where line.inventory_item_id = p_item_id and recipe.status = 'active'
          and not public.current_user_can_access_outlet(recipe.outlet_id))
      then 'An administrator with access to all affected outlets must change this UOM.'
    when exists (select 1 from public.inventory_stock_check_items line
        join public.inventory_stock_checks check_header on check_header.id = line.stock_check_id
        where line.item_id = p_item_id and check_header.status = 'draft'
          and not (check_header.stock_check_type = 'scheduled' and check_header.correction_of_id is null
            and inventory_authority.scheduled_stock_check_occurrence_expired(check_header.check_date, now())))
      then 'Submit or discard the open Stock Check drafts for this item, then reload Edit Item.'
    when exists (select 1 from public.inventory_purchase_order_items line
        join public.inventory_purchase_orders order_header on order_header.id = line.purchase_order_id
        where line.item_id = p_item_id and order_header.status not in ('cancelled', 'completed', 'fully_received'))
      then 'Finish receiving, close, or cancel the open purchase orders for this item, then reload Edit Item.'
    when exists (select 1 from public.inventory_items item where item.id = p_item_id
      and item.cost_revision_id is null and (item.cost_updated_at is not null or coalesce(item.cost, 0) <> 0))
      then 'Resolve the item’s current cost in Cost History before changing the UOM.'
    when exists (select 1 from public.inventory_item_outlets link join public.inventory_items item on item.id = link.inventory_item_id
      where link.inventory_item_id = p_item_id and link.par_level is not null and link.par_unit is not null
        and lower(btrim(link.par_unit)) is distinct from lower(btrim(item.unit)))
      then 'Review the saved outlet Par quantities in Par Level Setup before changing this item UOM.'
    when exists (select 1 from public.inventory_recipe_items line
      join public.inventory_recipes recipe on recipe.id = line.recipe_id
      join public.inventory_items item on item.id = line.inventory_item_id
      where line.inventory_item_id = p_item_id and recipe.status = 'active'
        and (nullif(btrim(line.unit), '') is null or lower(btrim(line.unit)) is distinct from lower(btrim(item.unit))))
      then 'Review active recipes using this item. Save each ingredient quantity in the current item UOM before changing it.'
  end;
$$;

commit;
