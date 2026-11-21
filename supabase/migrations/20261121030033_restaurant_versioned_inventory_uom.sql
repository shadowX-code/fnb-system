begin;

alter table inventory_authority.item_stock_uom_changes
  add column effective_date date,
  add column old_quantity numeric,
  add column new_quantity numeric,
  add column basis_numerator numeric,
  add column basis_denominator numeric,
  add column par_evidence jsonb,
  add column recipe_evidence jsonb,
  add column prior_cost_revision_id uuid references inventory_authority.item_cost_revisions(id),
  add constraint stock_uom_change_factor_check check (
    (effective_date is null and old_quantity is null and new_quantity is null and basis_numerator is null and basis_denominator is null)
    or (effective_date is not null and old_quantity > 0 and new_quantity > 0 and basis_numerator > 0 and basis_denominator > 0)
  );

alter table public.inventory_items add column stock_uom_change_id uuid
  references inventory_authority.item_stock_uom_changes(id);
alter table inventory_authority.item_cost_revisions
  add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id),
  add column is_uom_conversion boolean not null default false,
  add constraint cost_basis_change_required check (not is_uom_conversion or stock_uom_change_id is not null);
drop index inventory_authority.inventory_cost_revision_effective_date;
create unique index inventory_cost_revision_effective_date
  on inventory_authority.item_cost_revisions(item_id, effective_date, stock_uom_change_id) nulls not distinct
  where effective_date is not null and supersedes_revision_id is null and not is_uom_conversion;

alter table public.inventory_item_outlets add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id);
alter table public.inventory_stock_check_items add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id),
  add column cost_revision_snapshot_id uuid references inventory_authority.item_cost_revisions(id);
alter table public.inventory_purchase_order_items add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id);
alter table public.inventory_purchase_receipt_items add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id);
alter table public.inventory_movements add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id);
alter table public.inventory_waste_records add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id);
alter table public.inventory_recipe_items add column stock_uom_change_id uuid references inventory_authority.item_stock_uom_changes(id),
  add column unit_cost_snapshot numeric(12,4), add column cost_revision_snapshot_id uuid references inventory_authority.item_cost_revisions(id);

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
        where line.item_id = p_item_id and check_header.status = 'draft' and check_header.correction_of_id is null)
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

create or replace function inventory_authority.guard_item_stock_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit is distinct from old.unit or new.stock_uom_change_id is distinct from old.stock_uom_change_id then
    if new.stock_uom_change_id is null or new.stock_uom_change_id is not distinct from old.stock_uom_change_id
      or not exists (select 1 from inventory_authority.item_stock_uom_changes change
        where change.id = new.stock_uom_change_id and change.item_id = old.id
          and change.old_unit is not distinct from old.unit and change.new_unit = new.unit
          and change.effective_date is not null)
      or (old.cost_revision_id is not null and not exists (
        select 1 from inventory_authority.item_cost_revisions revision where revision.id = new.cost_revision_id
          and revision.item_id = old.id and revision.is_uom_conversion
          and revision.stock_uom_change_id = new.stock_uom_change_id and revision.unit = new.unit
          and revision.unit_cost = new.cost)) then
      raise exception using errcode = '23514', message = 'Use Change UOM in Edit Item to record the verified change and cost basis.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger inventory_stock_unit_guard on public.inventory_items;
create trigger inventory_stock_unit_guard before update of unit, stock_uom_change_id on public.inventory_items
for each row execute function inventory_authority.guard_item_stock_unit();

create or replace function public.inventory_master_stock_uom_history(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not inventory_authority.can_read_item_cost(p_item_id) then
    raise exception using errcode = '42501', message = 'Master Inventory access is required.';
  end if;
  select jsonb_build_object(
    'unit', item.unit,
    'blocked_reason', inventory_authority.stock_uom_change_blocker(item.id),
    'current_cost', case when item.cost_revision_id is not null then item.cost end,
    'current_cost_revision_id', item.cost_revision_id,
    'par_count', (select count(*) from public.inventory_item_outlets link where link.inventory_item_id = item.id and link.par_level is not null),
    'recipe_count', (select count(*) from public.inventory_recipe_items line join public.inventory_recipes recipe on recipe.id = line.recipe_id
      where line.inventory_item_id = item.id and recipe.status = 'active'),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', change.id, 'old_unit', change.old_unit, 'new_unit', change.new_unit, 'effective_date', change.effective_date,
        'old_quantity', change.old_quantity, 'new_quantity', change.new_quantity,
        'reason', change.reason, 'actor_name', change.actor_name, 'recorded_at', change.recorded_at,
        'par_count', jsonb_array_length(change.par_evidence), 'recipe_count', jsonb_array_length(change.recipe_evidence)
      ) order by change.recorded_at desc, change.id desc)
      from inventory_authority.item_stock_uom_changes change where change.item_id = item.id
    ), '[]'::jsonb)
  ) into v_result from public.inventory_items item where item.id = p_item_id;
  if not found then raise exception 'Inventory item was not found.'; end if;
  return v_result;
end;
$$;

-- One transaction preserves the prior basis, converts quantities and publishes the new item and cost projections.
create function public.inventory_master_change_stock_uom(
  p_item_id uuid, p_unit text, p_reason text, p_request_id uuid, p_expected_change_id uuid, p_expected_unit text,
  p_old_quantity numeric, p_new_quantity numeric, p_expected_cost_revision_id uuid, p_conversion_verified boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_previous inventory_authority.item_stock_uom_changes%rowtype;
  v_request inventory_authority.item_stock_uom_changes%rowtype;
  v_employee uuid;
  v_actor_name text;
  v_unit text := btrim(p_unit);
  v_reason text := btrim(p_reason);
  v_basis_num numeric;
  v_basis_den numeric;
  v_existing_num numeric;
  v_existing_den numeric;
  v_blocker text;
  v_cost numeric;
  v_cost_revision uuid;
  v_par jsonb;
  v_recipe jsonb;
  v_now timestamptz;
  v_date date;
begin
  if not inventory_authority.can_read_item_cost(p_item_id)
    or not (public.current_user_has_permission('inventory_master.edit')
      or public.current_user_has_permission('inventory_control.manage_master')) then
    raise exception using errcode = '42501', message = 'Master Inventory edit permission and item access are required.';
  end if;
  if p_request_id is null or nullif(v_unit, '') is null then
    raise exception using errcode = '22023', message = 'Choose an active UOM.';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item was not found.'; end if;
  select * into v_request from inventory_authority.item_stock_uom_changes where id = p_request_id;
  if found then
    if (v_request.item_id, v_request.actor_id, v_request.old_unit, v_request.new_unit, v_request.reason,
        v_request.previous_change_id, v_request.old_quantity, v_request.new_quantity, v_request.prior_cost_revision_id)
      is distinct from (p_item_id, v_actor, p_expected_unit, v_unit, v_reason,
        p_expected_change_id, p_old_quantity, p_new_quantity, p_expected_cost_revision_id) then
      raise exception using errcode = '22023', message = 'This request was already used for a different UOM change.';
    end if;
    return public.inventory_master_stock_uom_history(p_item_id);
  end if;
  select * into v_previous from inventory_authority.item_stock_uom_changes
    where item_id = p_item_id order by recorded_at desc, id desc limit 1;
  if v_previous.id is distinct from p_expected_change_id or v_item.unit is distinct from p_expected_unit
    or v_item.cost_revision_id is distinct from p_expected_cost_revision_id then
    raise exception using errcode = '40001', message = 'The item UOM or cost changed. Reload it before saving.';
  end if;
  if v_unit is not distinct from v_item.unit then return public.inventory_master_stock_uom_history(p_item_id); end if;
  if p_conversion_verified is not true then
    raise exception using errcode = '22023', message = 'Confirm the conversion against the item specification before saving.';
  end if;
  if coalesce(length(v_reason), 0) not between 1 and 500
    or p_old_quantity is null or not (p_old_quantity > 0 and p_old_quantity < 1000000000) or p_old_quantity <> trunc(p_old_quantity, 6)
    or p_new_quantity is null or not (p_new_quantity > 0 and p_new_quantity < 1000000000) or p_new_quantity <> trunc(p_new_quantity, 6) then
    raise exception using errcode = '22023', message = 'Enter a reason and a positive conversion with up to 6 decimal places.';
  end if;
  perform 1 from public.inventory_uoms where code = v_unit and is_active for share;
  if not found then raise exception using errcode = '22023', message = 'Choose an active UOM.'; end if;

  v_blocker := inventory_authority.stock_uom_change_blocker(p_item_id);
  if v_blocker is not null then raise exception using errcode = '23514', message = v_blocker; end if;
  if nullif(btrim(v_item.unit), '') is null and (
    p_old_quantity <> 1 or p_new_quantity <> 1 or v_item.cost_revision_id is not null
    or exists (select 1 from public.inventory_item_outlets where inventory_item_id=p_item_id and par_level is not null)
    or exists (select 1 from public.inventory_stock_check_items where item_id=p_item_id)
    or exists (select 1 from public.inventory_purchase_order_items where item_id=p_item_id)
    or exists (select 1 from public.inventory_movements where inventory_item_id=p_item_id)
    or exists (select 1 from public.inventory_recipe_items where inventory_item_id=p_item_id)
  ) then
    raise exception using errcode = '23514', message = 'This used item has no recorded current UOM. Reconcile its original unit before changing it.';
  end if;
  v_basis_num := coalesce(v_previous.basis_numerator, 1) * p_new_quantity;
  v_basis_den := coalesce(v_previous.basis_denominator, 1) * p_old_quantity;
  -- An established unit code must retain the same physical basis if reused.
  select basis.numerator, basis.denominator into v_existing_num, v_existing_den
  from (
    select change.new_unit as unit, change.basis_numerator as numerator, change.basis_denominator as denominator
    from inventory_authority.item_stock_uom_changes change where change.item_id = p_item_id and change.basis_numerator is not null
    union all
    select change.old_unit, 1::numeric, 1::numeric from inventory_authority.item_stock_uom_changes change
      where change.item_id = p_item_id and change.basis_numerator is not null
        and not exists (select 1 from inventory_authority.item_stock_uom_changes earlier
          where earlier.item_id = p_item_id and earlier.basis_numerator is not null and earlier.recorded_at < change.recorded_at)
  ) basis where lower(btrim(basis.unit)) = lower(v_unit) limit 1;
  if (v_existing_num is not null and v_existing_num * v_basis_den <> v_basis_num * v_existing_den)
    or (lower(btrim(v_item.unit)) = lower(v_unit) and p_old_quantity <> p_new_quantity) then
    raise exception using errcode = '23514', message = 'That UOM already represents a different quantity for this item. Use a different unit code.';
  end if;

  if v_item.cost_revision_id is not null then
    v_cost := round(v_item.cost * p_old_quantity / p_new_quantity, 4);
    if v_cost >= 100000000 or v_cost * p_new_quantity <> v_item.cost * p_old_quantity then
      raise exception using errcode = '23514', message = 'The equivalent cost cannot be represented exactly to 4 decimals. Choose an equivalent unit that preserves the cost.';
    end if;
  end if;
  if exists (select 1 from public.inventory_item_outlets link where link.inventory_item_id = p_item_id and link.par_level is not null
    and (link.par_level * p_new_quantity >= 100000000000 * p_old_quantity
      or round(link.par_level * p_new_quantity / p_old_quantity, 3) * p_old_quantity <> link.par_level * p_new_quantity)) then
    raise exception using errcode = '23514', message = 'A saved Par quantity cannot be converted exactly to 3 decimals. Review Par Level Setup before changing the UOM.';
  end if;

  if exists (select 1 from public.inventory_recipe_items line join public.inventory_recipes recipe on recipe.id=line.recipe_id
    where line.inventory_item_id=p_item_id and recipe.status='active'
      and round(line.quantity_used * p_new_quantity / p_old_quantity, 6) * p_old_quantity <> line.quantity_used * p_new_quantity) then
    raise exception using errcode = '23514', message = 'An active recipe quantity cannot be converted exactly to 6 decimals. Reconcile its ingredient quantity in Recipes.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('outlet_id', link.outlet_id, 'old_quantity', link.par_level,
    'new_quantity', round(link.par_level * p_new_quantity / p_old_quantity, 3), 'old_unit', coalesce(link.par_unit, v_item.unit)) order by link.id), '[]')
    into v_par from public.inventory_item_outlets link where link.inventory_item_id = p_item_id and link.par_level is not null;
  select coalesce(jsonb_agg(jsonb_build_object('before', to_jsonb(line), 'new_quantity', round(line.quantity_used * p_new_quantity / p_old_quantity, 6),
    'new_unit', v_unit) order by line.id), '[]') into v_recipe
    from public.inventory_recipe_items line join public.inventory_recipes recipe on recipe.id = line.recipe_id
    where line.inventory_item_id = p_item_id and recipe.status = 'active';

  select employee.id, coalesce(nullif(employee.nickname, ''), employee.full_name) into v_employee, v_actor_name
    from public.employees employee where employee.auth_user_id = v_actor order by employee.id limit 1;
  v_now := clock_timestamp();
  v_date := (v_now at time zone 'Asia/Kuala_Lumpur')::date;
  insert into inventory_authority.item_stock_uom_changes (
    id, item_id, old_unit, new_unit, reason, actor_id, actor_name, recorded_at, previous_change_id,
    effective_date, old_quantity, new_quantity, basis_numerator, basis_denominator, par_evidence, recipe_evidence, prior_cost_revision_id
  ) values (p_request_id, p_item_id, v_item.unit, v_unit, v_reason, v_actor, v_actor_name, v_now, v_previous.id,
    v_date, p_old_quantity, p_new_quantity, v_basis_num, v_basis_den, v_par, v_recipe, v_item.cost_revision_id);

  if v_item.cost_revision_id is not null then
    insert into inventory_authority.item_cost_revisions (
      item_id, revision_number, unit_cost, unit, effective_date, reason, actor_user_id, actor_employee_id, actor_name,
      recorded_at, previous_revision_id, stock_uom_change_id, is_uom_conversion
    )
    select p_item_id, revision.revision_number + 1, v_cost, v_unit, v_date, v_reason, v_actor, v_employee, v_actor_name,
      v_now, revision.id, p_request_id, true
    from inventory_authority.item_cost_revisions revision where revision.item_id = p_item_id
    order by revision.revision_number desc limit 1 returning id into v_cost_revision;
  end if;
  update public.inventory_items set unit = v_unit, stock_uom_change_id = p_request_id,
    cost = case when v_cost_revision is not null then v_cost else v_item.cost end,
    cost_revision_id = v_cost_revision, updated_by = v_actor, updated_at = v_now
  where id = p_item_id;
  update public.inventory_item_outlets set par_level = round(par_level * p_new_quantity / p_old_quantity, 3), par_unit = v_unit,
    stock_uom_change_id = p_request_id, updated_at = v_now
  where inventory_item_id = p_item_id and par_level is not null;
  update public.inventory_recipe_items line set quantity_used = round(line.quantity_used * p_new_quantity / p_old_quantity, 6),
    unit = v_unit, updated_at = v_now
  from public.inventory_recipes recipe where recipe.id = line.recipe_id and recipe.status = 'active'
    and line.inventory_item_id = p_item_id;
  return public.inventory_master_stock_uom_history(p_item_id);
end;
$$;

revoke all on function public.inventory_master_change_stock_uom(uuid,text,text,uuid,uuid,text),
  public.inventory_master_change_stock_uom(uuid,text,text,uuid,uuid,text,numeric,numeric,uuid,boolean)
from public, anon, authenticated, service_role;
grant execute on function public.inventory_master_change_stock_uom(uuid,text,text,uuid,uuid,text,numeric,numeric,uuid,boolean) to authenticated;

-- Existing clients still send unit text. Stamp the corresponding version server-side when recording a quantity.
create or replace function inventory_authority.check_item_quantity_uom() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(new);
  v_item public.inventory_items%rowtype;
  v_source public.inventory_stock_check_items%rowtype;
  v_unit text := v_row->>tg_argv[1];
begin
  if tg_table_name = 'inventory_item_outlets' and tg_op = 'UPDATE' then
    if (new.par_level, new.par_unit, new.inventory_item_id, new.is_active, new.stock_uom_change_id)
      is not distinct from (old.par_level, old.par_unit, old.inventory_item_id, old.is_active, old.stock_uom_change_id) then return new; end if;
  end if;

  select * into v_item from public.inventory_items where id = (v_row->>tg_argv[0])::uuid for share;

  if tg_table_name = 'inventory_stock_check_items' then
    select source.* into v_source from public.inventory_stock_checks correction
    join public.inventory_stock_check_items source on source.stock_check_id = correction.correction_of_id
      and source.item_id = new.item_id
    where correction.id = new.stock_check_id;
    if found then
      if (new.unit, new.unit_cost_snapshot) is distinct from (v_source.unit, v_source.unit_cost_snapshot) then
        raise exception 'An audit correction must retain the original UOM and pinned cost.';
      end if;
      new.stock_uom_change_id := v_source.stock_uom_change_id;
      new.cost_revision_snapshot_id := v_source.cost_revision_snapshot_id;
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE' and tg_table_name in ('inventory_movements','inventory_waste_records') then
    if old.stock_uom_change_id is distinct from v_item.stock_uom_change_id then
      if (new.inventory_item_id, new.quantity, new.unit) is distinct from (old.inventory_item_id, old.quantity, old.unit) then
        raise exception 'This record uses a previous item UOM. Record a new adjustment to correct its quantity.';
      end if;
      new.stock_uom_change_id := old.stock_uom_change_id;
      return new;
    end if;
  end if;

  if tg_table_name = 'inventory_item_outlets' then
    if new.par_level is null then
      new.stock_uom_change_id := null;
      return new;
    end if;
  end if;
  if v_item.stock_uom_change_id is not null
    and lower(btrim(v_unit)) is distinct from lower(btrim(v_item.unit)) then
    raise exception using errcode = '23514', message = 'The item UOM changed. Refresh and enter the quantity in its current UOM.';
  end if;

  new.stock_uom_change_id := v_item.stock_uom_change_id;
  if tg_table_name = 'inventory_recipe_items' then
    new.cost_revision_snapshot_id := null;
    new.unit_cost_snapshot := null;
    if v_item.cost_revision_id is not null and lower(btrim(v_unit)) = lower(btrim(v_item.unit)) then
      new.cost_revision_snapshot_id := v_item.cost_revision_id;
      new.unit_cost_snapshot := v_item.cost;
    end if;
  end if;
  return new;
end;
$$;

drop trigger inventory_par_item_uom on public.inventory_item_outlets;
create trigger inventory_par_item_uom before insert or update of inventory_item_id, par_level, par_unit, is_active, stock_uom_change_id
on public.inventory_item_outlets for each row execute function inventory_authority.check_item_quantity_uom('inventory_item_id','par_unit');
create trigger inventory_po_basis before insert on public.inventory_purchase_order_items
for each row execute function inventory_authority.check_item_quantity_uom('item_id','stock_unit');
create trigger inventory_receipt_basis before insert on public.inventory_purchase_receipt_items
for each row execute function inventory_authority.check_item_quantity_uom('item_id','stock_unit');


-- Share the exact existing outlet and Stock Check scope check with the dashboard.
create function inventory_projection.stock_check_rows_with_basis(p_check_ids uuid[])
returns table (id uuid, stock_check_id uuid, item_id uuid, actual_count_quantity numeric,
  par_level_quantity numeric, skipped boolean, status text, variance numeric, stock_uom_change_id uuid)
language sql stable security definer set search_path = '' as $$
  select evidence.*, line.stock_uom_change_id
  from inventory_projection.authorized_stock_check_rows(p_check_ids) evidence
  join public.inventory_stock_check_items line on line.id=evidence.id;
$$;
revoke all on function inventory_projection.stock_check_rows_with_basis(uuid[]) from public, anon, authenticated, service_role;
grant execute on function inventory_projection.stock_check_rows_with_basis(uuid[]) to authenticated;

create or replace function inventory_authority.guard_item_cost_projection()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if current_user = 'postgres' or (
      (new.cost, new.cost_updated_at, new.cost_revision_id, new.stock_uom_change_id)
        is not distinct from (old.cost, old.cost_updated_at, old.cost_revision_id, old.stock_uom_change_id)
      and (new.cost_updated_by is not distinct from old.cost_updated_by
        or (new.cost_updated_by is null and pg_trigger_depth() > 1))
    ) then
      return new;
    end if;
  elsif coalesce(new.cost, 0) = 0 and new.cost_updated_at is null and new.cost_updated_by is null
    and new.cost_revision_id is null and new.stock_uom_change_id is null then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'Use Cost History to configure or update the unit cost.';
end;
$$;

create or replace function public.inventory_master_cost_history(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_history jsonb;
begin
  if not inventory_authority.can_read_item_cost(p_item_id) then
    raise exception using errcode = '42501', message = 'You do not have access to this item’s cost history.';
  end if;

  select jsonb_build_object(
    'unit', item.unit,
    'current_revision_id', item.cost_revision_id,
    'stock_uom_change_id', item.stock_uom_change_id,
    'basis_effective_date', basis.effective_date,
    'current_cost', case when item.cost_revision_id is not null then item.cost end,
    'previous_cost', comparison.unit_cost,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', revision.id, 'unit_cost', revision.unit_cost, 'unit', revision.unit,
        'effective_date', revision.effective_date, 'reason', revision.reason,
        'stock_uom_change_id', revision.stock_uom_change_id, 'is_uom_conversion', revision.is_uom_conversion,
        'actor_name', revision.actor_name, 'recorded_at', revision.recorded_at,
        'previous_revision_id', revision.previous_revision_id,
        'supersedes_revision_id', revision.supersedes_revision_id
      ) order by revision.revision_number desc)
      from inventory_authority.item_cost_revisions revision where revision.item_id = item.id
    ), '[]'::jsonb)
  ) into v_history
  from public.inventory_items item
  left join inventory_authority.item_stock_uom_changes basis on basis.id = item.stock_uom_change_id
  left join inventory_authority.item_cost_revisions current_revision on current_revision.id = item.cost_revision_id
  left join inventory_authority.item_cost_revisions comparison on comparison.id = current_revision.comparison_revision_id
  where item.id = p_item_id;

  if v_history is null then
    raise exception 'Inventory item was not found.';
  end if;
  return v_history;
end;
$$;

create or replace function public.inventory_master_revise_cost(
  p_item_id uuid, p_unit_cost numeric, p_unit text, p_effective_date date, p_reason text,
  p_request_id uuid, p_expected_revision_id uuid, p_correct_revision_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_employee uuid;
  v_actor_name text;
  v_reason text := btrim(p_reason);
  v_today date := (statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_now timestamptz := clock_timestamp();
  v_item public.inventory_items%rowtype;
  v_tail inventory_authority.item_cost_revisions%rowtype;
  v_current inventory_authority.item_cost_revisions%rowtype;
  v_corrected inventory_authority.item_cost_revisions%rowtype;
  v_request inventory_authority.item_cost_revisions%rowtype;
  v_basis_date date;
begin
  if not inventory_authority.can_read_item_cost(p_item_id)
    or not (public.current_user_has_permission('inventory_master.edit')
      or public.current_user_has_permission('inventory_control.manage_master')) then
    raise exception using errcode = '42501', message = 'Inventory Master edit permission and item access are required.';
  end if;

  if p_unit_cost is null or not (p_unit_cost >= 0 and p_unit_cost < 100000000)
    or p_unit_cost <> round(p_unit_cost, 4) then
    raise exception using errcode = '22023', message = 'Enter a non-negative unit cost below RM 100,000,000 with up to 4 decimal places.';
  end if;
  if v_reason is null or length(v_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Enter a reason of up to 500 characters.';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'A cost update request ID is required.';
  end if;
  if p_effective_date is null or not isfinite(p_effective_date) or p_effective_date > v_today then
    raise exception using errcode = '22023', message = 'Choose an effective date on or before today (Malaysia time).';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item was not found.'; end if;
  select * into v_request from inventory_authority.item_cost_revisions where id = p_request_id;
  if found then
    if (v_request.item_id, v_request.actor_user_id, v_request.unit_cost, v_request.effective_date,
        v_request.reason, v_request.previous_revision_id, v_request.supersedes_revision_id, lower(btrim(v_request.unit)))
      is distinct from
       (p_item_id, v_actor, p_unit_cost, p_effective_date, v_reason,
        p_expected_revision_id, p_correct_revision_id, lower(btrim(p_unit))) or v_request.is_uom_conversion then
      raise exception using errcode = '22023', message = 'This request has already been used for a different cost update.';
    end if;
    return public.inventory_master_cost_history(p_item_id);
  end if;

  if nullif(btrim(v_item.unit), '') is null
    or lower(btrim(v_item.unit)) is distinct from lower(btrim(p_unit)) then
    raise exception using errcode = '22023', message = 'The unit must match the item’s current UOM. Reload Cost History and try again.';
  end if;

  select effective_date into v_basis_date from inventory_authority.item_stock_uom_changes where id = v_item.stock_uom_change_id;
  if p_effective_date < v_basis_date then
    raise exception using errcode = '22023', message = 'Choose a cost date on or after the current UOM effective date.';
  end if;
  select * into v_tail from inventory_authority.item_cost_revisions
    where item_id = p_item_id order by revision_number desc limit 1;
  if v_tail.id is distinct from p_expected_revision_id then
    raise exception using errcode = '40001', message = 'Cost history changed. Reload it before saving your update.';
  end if;

  select * into v_current from inventory_authority.item_cost_revisions where id = v_item.cost_revision_id;
  if p_correct_revision_id is null then
    if p_effective_date < v_current.effective_date
      or (p_effective_date = v_current.effective_date and not v_current.is_uom_conversion) then
      raise exception using errcode = '22023', message = 'Choose a date after the latest effective date, or correct a dated revision.';
    end if;
    if p_unit_cost = v_current.unit_cost then
      raise exception using errcode = '22023', message = 'Enter a unit cost different from the current cost.';
    end if;
  else
    select revision.* into v_corrected from inventory_authority.item_cost_revisions revision
    where revision.id = p_correct_revision_id and revision.item_id = p_item_id
      and revision.effective_date = p_effective_date and not revision.is_uom_conversion
      and revision.stock_uom_change_id is not distinct from v_item.stock_uom_change_id
      and not exists (select 1 from inventory_authority.item_cost_revisions newer
        where newer.supersedes_revision_id = revision.id);
    if not found then
      raise exception using errcode = '22023', message = 'Choose an active revision with the same effective date to correct.';
    end if;
    if p_unit_cost = v_corrected.unit_cost then
      raise exception using errcode = '22023', message = 'Enter a unit cost different from the revision being corrected.';
    end if;
  end if;

  select employee.id, coalesce(nullif(btrim(employee.nickname), ''), nullif(btrim(employee.full_name), ''))
  into v_employee, v_actor_name from public.employees employee where employee.auth_user_id = v_actor;

  insert into inventory_authority.item_cost_revisions (
    id, item_id, revision_number, unit_cost, unit, effective_date, reason, actor_user_id,
    actor_employee_id, actor_name, recorded_at, previous_revision_id, supersedes_revision_id, comparison_revision_id, stock_uom_change_id
  ) values (
    p_request_id, p_item_id, coalesce(v_tail.revision_number, 0) + 1, p_unit_cost, v_item.unit,
    p_effective_date, v_reason, v_actor, v_employee, coalesce(v_actor_name, 'Inventory user'),
    v_now, v_tail.id, v_corrected.id, coalesce(v_corrected.id,
      case when v_current.stock_uom_change_id is not distinct from v_item.stock_uom_change_id
        and lower(btrim(v_current.unit)) = lower(btrim(v_item.unit)) then v_current.id end), v_item.stock_uom_change_id
  );

  if p_correct_revision_id is null or v_current.id = v_corrected.id then
    update public.inventory_items
    set cost = p_unit_cost, cost_updated_at = v_now, cost_updated_by = v_employee,
      cost_revision_id = p_request_id
    where id = p_item_id;
  end if;

  return public.inventory_master_cost_history(p_item_id);
end;
$$;

create or replace function inventory_authority.snapshot_submitted_audit_cost()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'draft' and new.status = 'submitted' and new.stock_check_type = 'audit' and new.correction_of_id is null then
    update public.inventory_stock_check_items check_item
    set cost_revision_snapshot_id = case when item.cost_revision_id is not null
      and check_item.stock_uom_change_id is not distinct from item.stock_uom_change_id
      and lower(trim(check_item.unit)) = lower(trim(item.unit)) then item.cost_revision_id end,
        unit_cost_snapshot = case
      when item.cost_updated_at is not null
        and item.cost is not null
        and item.cost >= 0
        and check_item.stock_uom_change_id is not distinct from item.stock_uom_change_id
        and lower(trim(check_item.unit)) = lower(trim(item.unit))
      then item.cost
      else null
    end
    from public.inventory_items item
    where check_item.stock_check_id = new.id and check_item.item_id = item.id;
  end if;
  return new;
end; $$;

create or replace function public.inventory_dashboard_stock_evidence(p_outlet_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_dashboard.view') then
    raise exception 'Inventory Dashboard access is required.' using errcode = '42501';
  end if;
  if p_outlet_ids is null or cardinality(p_outlet_ids) = 0
     or exists (select 1 from unnest(p_outlet_ids) as requested(outlet_id)
                where requested.outlet_id is null or not public.current_user_can_access_outlet(requested.outlet_id)) then
    raise exception 'Inventory outlet scope is unavailable.' using errcode = '42501';
  end if;

  with recursive applicable as (
    select link.outlet_id, link.inventory_item_id as item_id,
           link.par_level as current_par, item.stock_uom_change_id as current_basis
    from public.inventory_item_outlets link
    join public.inventory_items item on item.id = link.inventory_item_id
    where link.outlet_id = any(p_outlet_ids)
      and link.is_active is not false
      and coalesce(lower(item.status), 'active') not in ('inactive', 'archived', 'deleted')
      and link.par_level > 0
  ),
  scoped_submitted as materialized (
    select check_header.id, check_header.outlet_id, check_header.check_date,
           check_header.submitted_at, check_header.created_at, check_header.correction_of_id
    from public.inventory_stock_checks check_header
    where check_header.outlet_id = any(p_outlet_ids)
      and check_header.status in ('submitted', 'reviewed', 'locked')
  ),
  current_headers as (
    select audit.* from scoped_submitted audit where not exists (
      select 1 from scoped_submitted successor where successor.correction_of_id = audit.id)
  ),
  correction_sources as (
    select audit.id as evidence_id, audit.id, audit.correction_of_id, audit.submitted_at, audit.created_at
    from current_headers audit where audit.correction_of_id is not null
    union all
    select lineage.evidence_id, source.id, source.correction_of_id, source.submitted_at, source.created_at
    from correction_sources lineage join scoped_submitted source on source.id = lineage.correction_of_id
  ),
  scoped_headers as materialized (
    -- The correction records new evidence about the original count, not a later physical count.
    select audit.id, audit.outlet_id, audit.check_date,
           case when source.id is not null then source.submitted_at else audit.submitted_at end as submitted_at,
           coalesce(source.created_at, audit.created_at) as created_at,
           coalesce(source.id, audit.id) as count_id
    from current_headers audit left join correction_sources source
      on source.evidence_id = audit.id and source.correction_of_id is null
  ),
  scoped_rows as materialized (
    select row.*
    from inventory_projection.stock_check_rows_with_basis(
      array(select check_header.id from scoped_headers check_header)
    ) row
  ),
  latest as (
    select distinct on (check_header.outlet_id, row.item_id)
           check_header.outlet_id, row.item_id, check_header.id as check_id,
           row.id as check_row_id, check_header.check_date,
           check_header.submitted_at, row.actual_count_quantity,
           row.par_level_quantity as submitted_par, row.skipped,
           row.status as row_status, row.stock_uom_change_id as recorded_basis
    from scoped_headers check_header
    join scoped_rows row on row.stock_check_id = check_header.id
    join applicable position on position.outlet_id = check_header.outlet_id
                            and position.item_id = row.item_id
    order by check_header.outlet_id, row.item_id,
             coalesce(check_header.submitted_at::text, check_header.check_date::text,
                      check_header.created_at::date::text) desc,
             check_header.created_at desc, check_header.count_id, row.id
  ),
  evaluated as (
    select position.outlet_id, position.item_id, position.current_par,
           evidence.check_id, evidence.check_row_id, evidence.check_date,
           evidence.submitted_at, evidence.actual_count_quantity,
           evidence.submitted_par, evidence.skipped, evidence.row_status,
           evidence.recorded_basis is distinct from position.current_basis as different_basis,
           coalesce(movement_state.has_after, false) as has_after,
           coalesce(movement_state.has_uncertain, false) as has_uncertain
    from applicable position
    left join latest evidence on evidence.outlet_id = position.outlet_id
                             and evidence.item_id = position.item_id
    left join lateral (
      select bool_or(case
               when movement.created_at is not null and evidence.submitted_at is not null
                 then movement.created_at > evidence.submitted_at
               when movement.created_at is not null and evidence.check_date is not null
                 then (movement.created_at at time zone 'UTC')::date > evidence.check_date
               else false end) as has_after,
             bool_or(case
               when movement.created_at is not null and evidence.submitted_at is not null then false
               when movement.created_at is not null and evidence.check_date is not null
                 then (movement.created_at at time zone 'UTC')::date = evidence.check_date
               else true end) as has_uncertain
      from public.inventory_movements movement
      where evidence.check_id is not null
        and movement.outlet_id = position.outlet_id
        and movement.inventory_item_id = position.item_id
        and movement.quantity is not null and movement.quantity <> 0
    ) movement_state on true
  ),
  classified as (
    select *, case
      when check_id is null or different_basis or skipped or row_status = 'na' or actual_count_quantity is null
        then 'unverified'
      when has_after then 'changed'
      when has_uncertain then 'unverified'
      when actual_count_quantity < current_par then 'below_par'
      else 'sufficient' end as evidence_state
    from evaluated
  )
  select jsonb_build_object(
    'position_count', count(*),
    'positions', coalesce(jsonb_agg(jsonb_build_object(
      'outlet_id', outlet_id, 'item_id', item_id,
      'state', evidence_state, 'check_id', check_id,
      'check_row_id', check_row_id, 'check_date', check_date,
      'submitted_at', submitted_at, 'actual_count', actual_count_quantity,
      'current_par', current_par, 'submitted_par', submitted_par,
      'movement_relation', case when has_after then 'after'
                                when has_uncertain then 'uncertain' else 'none' end
    ) order by outlet_id, item_id), '[]'::jsonb)
  ) into v_result
  from classified;

  return v_result;
end;
$function$;

create or replace function public.inventory_dashboard_cost_insights(p_outlet_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_start date := v_today - 29;
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_dashboard.view')
     or not (public.current_user_has_permission('inventory_master.view')
             or public.current_user_has_permission('inventory_control.view')) then
    raise exception 'Inventory Dashboard and standard cost access are required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_outlet_ids), 0) = 0 or exists (
    select 1 from unnest(p_outlet_ids) requested(outlet_id)
    where requested.outlet_id is null or not public.current_user_can_access_outlet(requested.outlet_id)
  ) then
    raise exception 'Inventory outlet scope is unavailable.' using errcode = '42501';
  end if;

  with scoped_items as (
    select item.id, item.item_name, item.cost_revision_id
    from public.inventory_items item
    where coalesce(lower(item.status), 'active') not in ('inactive', 'archived', 'deleted')
      and exists (
        select 1 from public.inventory_item_outlets link
        where link.inventory_item_id = item.id and link.outlet_id = any(p_outlet_ids)
          and link.is_active is not false
      )
  ), latest as (
    select distinct on (revision.item_id)
      revision.item_id, revision.unit, revision.unit_cost, revision.effective_date, revision.stock_uom_change_id, revision.revision_number
    from scoped_items item
    join inventory_authority.item_cost_revisions revision on revision.item_id = item.id
    where revision.effective_date between v_start and v_today and not revision.is_uom_conversion
      and not exists (select 1 from inventory_authority.item_cost_revisions successor
        where successor.supersedes_revision_id = revision.id)
    order by revision.item_id, revision.effective_date desc, revision.revision_number desc
  ), changes as (
    -- Compare with the effective cost entering the window. A first configuration
    -- within the window can be a comparison only when a later dated price exists.
    select latest.item_id, item.item_name, latest.unit, latest.effective_date,
      basis.unit_cost as previous_cost, latest.unit_cost,
      latest.unit_cost - basis.unit_cost as delta
    from latest
    join scoped_items item on item.id = latest.item_id
    join lateral (
      select revision.unit_cost, revision.unit
      from inventory_authority.item_cost_revisions revision
      where revision.item_id = latest.item_id
        and revision.stock_uom_change_id is not distinct from latest.stock_uom_change_id
        and (revision.effective_date is null or revision.effective_date <= latest.effective_date)
        and not exists (select 1 from inventory_authority.item_cost_revisions successor
          where successor.supersedes_revision_id = revision.id)
      order by
        coalesce(revision.effective_date >= v_start, false) asc,
        case when revision.effective_date < v_start then revision.effective_date end desc nulls last,
        revision.effective_date asc nulls first,
        revision.revision_number asc
      limit 1
    ) basis on lower(btrim(basis.unit)) = lower(btrim(latest.unit))
    where latest.unit_cost <> basis.unit_cost
  )
  select jsonb_build_object(
    'start_date', v_start, 'end_date', v_today,
    'increases', count(*) filter (where delta > 0),
    'decreases', count(*) filter (where delta < 0),
    'missing_costs', (select count(*) from scoped_items where cost_revision_id is null),
    'largest_increase', (select to_jsonb(peak) from changes peak where peak.delta > 0
      order by peak.delta desc, peak.item_id limit 1),
    'top_changes', coalesce((select jsonb_agg(to_jsonb(ranked) order by abs(ranked.delta) desc, ranked.item_id)
      from (select * from changes order by abs(delta) desc, item_id limit 5) ranked), '[]'::jsonb)
  ) into v_result from changes;
  return v_result;
end;
$$;

commit;
