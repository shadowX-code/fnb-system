begin;

-- An unused item can change labels without recording an invented physical conversion.
alter table inventory_authority.item_stock_uom_changes drop constraint stock_uom_change_factor_check;
alter table inventory_authority.item_stock_uom_changes add constraint stock_uom_change_factor_check check (
  (old_quantity is null and new_quantity is null and basis_numerator is null and basis_denominator is null)
  or (effective_date is not null and old_quantity is not null and new_quantity is not null
    and basis_numerator is not null and basis_denominator is not null
    and old_quantity > 0 and new_quantity > 0 and basis_numerator > 0 and basis_denominator > 0)
);

create function inventory_authority.stock_uom_requires_conversion(p_item_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from inventory_authority.item_cost_revisions r where r.item_id = p_item_id)
    or exists (select 1 from public.inventory_item_outlets r where r.inventory_item_id = p_item_id and r.par_level is not null)
    or exists (select 1 from public.inventory_stock_check_items r where r.item_id = p_item_id)
    or exists (select 1 from public.inventory_purchase_order_items r where r.item_id = p_item_id)
    or exists (select 1 from public.inventory_purchase_receipt_items r where r.item_id = p_item_id)
    or exists (select 1 from public.inventory_movements r where r.inventory_item_id = p_item_id)
    or exists (select 1 from public.inventory_waste_records r where r.inventory_item_id = p_item_id)
    or exists (select 1 from public.inventory_recipe_items r where r.inventory_item_id = p_item_id)
    or exists (select 1 from inventory_authority.item_uom_revisions r where r.item_id = p_item_id)
    or exists (select 1 from inventory_authority.item_stock_uom_changes r where r.item_id = p_item_id and r.basis_numerator is not null);
$$;
revoke all on function inventory_authority.stock_uom_requires_conversion(uuid) from public, anon, authenticated, service_role;

create or replace function public.inventory_master_stock_uom_history(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not inventory_authority.can_read_item_cost(p_item_id) then
    raise exception using errcode = '42501', message = 'Master Inventory access is required.';
  end if;
  select jsonb_build_object(
    'unit', item.unit,
    'blocked_reason', coalesce(inventory_authority.stock_uom_change_blocker(item.id),
      case when nullif(btrim(item.unit), '') is null and dependency.requires_conversion
        then 'This used item has no recorded current UOM. Reconcile its original unit before changing it.' end),
    'requires_conversion', dependency.requires_conversion,
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
  ) into v_result from public.inventory_items item
  cross join lateral (select inventory_authority.stock_uom_requires_conversion(item.id) as requires_conversion) dependency
  where item.id = p_item_id;
  if not found then raise exception 'Inventory item was not found.'; end if;
  return v_result;
end;
$$;

-- One transaction preserves the prior basis, converts quantities and publishes the new item and cost projections.
create or replace function public.inventory_master_change_stock_uom(
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
  v_requires_conversion boolean;
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
  if coalesce(length(v_reason), 0) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'A UOM change reason is required.';
  end if;
  perform 1 from public.inventory_uoms where code = v_unit and is_active for share;
  if not found then raise exception using errcode = '22023', message = 'Choose an active UOM.'; end if;

  v_blocker := inventory_authority.stock_uom_change_blocker(p_item_id);
  if v_blocker is not null then raise exception using errcode = '23514', message = v_blocker; end if;
  v_requires_conversion := inventory_authority.stock_uom_requires_conversion(p_item_id);
  if nullif(btrim(v_item.unit), '') is null and (v_requires_conversion or (
    (p_old_quantity is not null or p_new_quantity is not null)
    and (p_old_quantity, p_new_quantity) is distinct from (1::numeric, 1::numeric)
  )) then
    raise exception using errcode = '23514', message = 'This used item has no recorded current UOM. Reconcile its original unit before changing it.';
  end if;
  if p_old_quantity is null and p_new_quantity is null then
    if v_requires_conversion then
      raise exception using errcode = '22023', message = 'Enter how many current units equal 1 new unit.';
    end if;
  else
    if p_old_quantity is null or not (p_old_quantity > 0 and p_old_quantity < 1000000000) or p_old_quantity <> trunc(p_old_quantity, 6)
      or p_new_quantity is null or not (p_new_quantity > 0 and p_new_quantity < 1000000000) or p_new_quantity <> trunc(p_new_quantity, 6) then
      raise exception using errcode = '22023', message = 'Enter a positive conversion with up to 6 decimal places.';
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

-- Keep existing sessions compatible while the simplified form uses this narrower overload.
create function public.inventory_master_change_stock_uom(
  p_item_id uuid, p_unit text, p_request_id uuid, p_expected_change_id uuid, p_expected_unit text,
  p_expected_cost_revision_id uuid, p_current_quantity_per_new_unit numeric
) returns jsonb language sql security invoker set search_path = '' as $$
  select public.inventory_master_change_stock_uom(
    p_item_id, p_unit,
    case when p_current_quantity_per_new_unit is null then 'Changed item UOM'
      else 'Changed item UOM using the specified conversion' end,
    p_request_id, p_expected_change_id, p_expected_unit,
    p_current_quantity_per_new_unit,
    case when p_current_quantity_per_new_unit is not null then 1::numeric end,
    p_expected_cost_revision_id, true
  );
$$;
revoke all on function public.inventory_master_change_stock_uom(uuid,text,uuid,uuid,text,uuid,numeric) from public, anon, authenticated, service_role;
grant execute on function public.inventory_master_change_stock_uom(uuid,text,uuid,uuid,text,uuid,numeric) to authenticated;

commit;
