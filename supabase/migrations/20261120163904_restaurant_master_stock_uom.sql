begin;

create table inventory_authority.item_stock_uom_changes (
  id uuid primary key,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  old_unit text,
  new_unit text not null check (btrim(new_unit) <> ''),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  actor_id uuid not null,
  actor_name text,
  recorded_at timestamptz not null default clock_timestamp(),
  previous_change_id uuid references inventory_authority.item_stock_uom_changes(id),
  check (old_unit is distinct from new_unit)
);
create index item_stock_uom_changes_item_idx on inventory_authority.item_stock_uom_changes(item_id, recorded_at desc, id desc);
alter table inventory_authority.item_stock_uom_changes enable row level security;
revoke all on inventory_authority.item_stock_uom_changes from public, anon, authenticated, service_role;

create trigger item_stock_uom_changes_immutable before update or delete on inventory_authority.item_stock_uom_changes
for each row execute function inventory_authority.protect_item_uom_revision();

create function inventory_authority.stock_uom_change_blocker(p_item_id uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when exists (select 1 from public.inventory_items i where i.id = p_item_id
      and (i.cost_revision_id is not null or i.cost_updated_at is not null))
      or exists (select 1 from inventory_authority.item_cost_revisions r where r.item_id = p_item_id)
      then 'This item has cost history. Use a separate item for a different UOM.'
    when exists (select 1 from public.inventory_item_outlets r where r.inventory_item_id = p_item_id and r.par_level is not null)
      then 'This item has saved Par levels. Changing its UOM would change what those quantities mean.'
    when exists (select 1 from public.inventory_stock_check_items r where r.item_id = p_item_id)
      then 'This item is used in Stock Checks. Use a separate item for a different UOM.'
    when exists (select 1 from public.inventory_purchase_order_items r where r.item_id = p_item_id)
      or exists (select 1 from public.inventory_purchase_receipt_items r where r.item_id = p_item_id)
      then 'This item has purchase orders or receipts. Use a separate item for a different UOM.'
    when exists (select 1 from public.inventory_movements r where r.inventory_item_id = p_item_id)
      or exists (select 1 from public.inventory_waste_records r where r.inventory_item_id = p_item_id)
      then 'This item has inventory movements or waste records. Use a separate item for a different UOM.'
    when exists (select 1 from public.inventory_recipe_items r where r.inventory_item_id = p_item_id)
      then 'This item is used in recipes. Use a separate item for a different UOM.'
    when exists (select 1 from inventory_authority.item_uom_revisions r where r.item_id = p_item_id)
      then 'This item has a historical order-unit configuration. Use a separate item for a different UOM.'
  end;
$$;

create or replace function inventory_authority.guard_item_stock_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_blocker text;
begin
  if new.unit is distinct from old.unit then
    v_blocker := inventory_authority.stock_uom_change_blocker(old.id);
    if v_blocker is not null then raise exception using errcode = '23514', message = v_blocker; end if;
  end if;
  return new;
end;
$$;

create function inventory_authority.require_stock_uom_command() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.unit is distinct from old.unit and current_user <> 'postgres' then
    raise exception using errcode = '23514', message = 'Use Change UOM in Edit Item to record the reason.';
  end if;
  return new;
end;
$$;
create trigger inventory_stock_uom_command_required before update of unit on public.inventory_items
for each row execute function inventory_authority.require_stock_uom_command();

create function public.inventory_master_stock_uom_history(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not inventory_authority.can_read_item_cost(p_item_id) then
    raise exception using errcode = '42501', message = 'Master Inventory access is required.';
  end if;
  select jsonb_build_object(
    'unit', item.unit,
    'blocked_reason', inventory_authority.stock_uom_change_blocker(item.id),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', change.id, 'old_unit', change.old_unit, 'new_unit', change.new_unit,
        'reason', change.reason, 'actor_name', change.actor_name, 'recorded_at', change.recorded_at
      ) order by change.recorded_at desc, change.id desc)
      from inventory_authority.item_stock_uom_changes change where change.item_id = item.id
    ), '[]'::jsonb)
  ) into v_result from public.inventory_items item where item.id = p_item_id;
  if not found then raise exception 'Inventory item was not found.'; end if;
  return v_result;
end;
$$;

create function public.inventory_master_change_stock_uom(
  p_item_id uuid, p_unit text, p_reason text, p_request_id uuid, p_expected_change_id uuid, p_expected_unit text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_request inventory_authority.item_stock_uom_changes%rowtype;
  v_actor_name text;
  v_latest uuid;
  v_unit text := btrim(p_unit);
  v_reason text := btrim(p_reason);
begin
  if not inventory_authority.can_read_item_cost(p_item_id)
    or not (public.current_user_has_permission('inventory_master.edit')
      or public.current_user_has_permission('inventory_control.manage_master')) then
    raise exception using errcode = '42501', message = 'Master Inventory edit permission and item access are required.';
  end if;
  if p_request_id is null or nullif(v_unit, '') is null then
    raise exception using errcode = '22023', message = 'Choose a UOM and submit the change again.';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item was not found.'; end if;

  select * into v_request from inventory_authority.item_stock_uom_changes where id = p_request_id;
  if found then
    if (v_request.item_id, v_request.actor_id, v_request.old_unit, v_request.new_unit, v_request.reason, v_request.previous_change_id)
      is distinct from (p_item_id, v_actor, p_expected_unit, v_unit, v_reason, p_expected_change_id) then
      raise exception using errcode = '22023', message = 'This request was already used for a different UOM change.';
    end if;
    return public.inventory_master_stock_uom_history(p_item_id);
  end if;
  select id into v_latest from inventory_authority.item_stock_uom_changes
    where item_id = p_item_id order by recorded_at desc, id desc limit 1;
  if v_latest is distinct from p_expected_change_id or v_item.unit is distinct from p_expected_unit then
    raise exception using errcode = '40001', message = 'The item UOM changed. Reload it before making another change.';
  end if;
  if v_unit is not distinct from v_item.unit then return public.inventory_master_stock_uom_history(p_item_id); end if;
  if coalesce(length(v_reason), 0) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Enter a reason for the UOM change (up to 500 characters).';
  end if;
  perform 1 from public.inventory_uoms where code = v_unit and is_active for share;
  if not found then raise exception using errcode = '22023', message = 'Choose an active UOM.'; end if;

  select coalesce(nullif(employee.nickname, ''), employee.full_name) into v_actor_name
    from public.employees employee where employee.auth_user_id = v_actor order by employee.id limit 1;
  update public.inventory_items set unit = v_unit, updated_by = v_actor, updated_at = clock_timestamp() where id = p_item_id;
  insert into inventory_authority.item_stock_uom_changes(id, item_id, old_unit, new_unit, reason, actor_id, actor_name, previous_change_id)
    values(p_request_id, p_item_id, v_item.unit, v_unit, v_reason, v_actor, v_actor_name, v_latest);
  return public.inventory_master_stock_uom_history(p_item_id);
end;
$$;

-- Synchronize quantity writers with a UOM change. Only items changed by the new command require a matching unit.
alter table public.inventory_item_outlets add column par_unit text;
create function inventory_authority.check_item_quantity_uom() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(new);
  v_item_id uuid := (v_row->>tg_argv[0])::uuid;
  v_unit text;
begin
  if tg_table_name = 'inventory_item_outlets' then
    if tg_op = 'INSERT' and new.par_level is null then return new; end if;
    if tg_op = 'UPDATE' then
      if new.par_level is not distinct from old.par_level and new.inventory_item_id = old.inventory_item_id then return new; end if;
    end if;
  end if;
  select unit into v_unit from public.inventory_items where id = v_item_id for key share;
  if exists (select 1 from inventory_authority.item_stock_uom_changes where item_id = v_item_id)
    and lower(btrim(v_row->>tg_argv[1])) is distinct from lower(btrim(v_unit)) then
    raise exception using errcode = '23514', message = 'The inventory item UOM changed. Refresh the item and re-enter the quantity in its current UOM.';
  end if;
  return new;
end;
$$;
create trigger inventory_par_item_uom before insert or update of inventory_item_id, par_level on public.inventory_item_outlets
for each row execute function inventory_authority.check_item_quantity_uom('inventory_item_id', 'par_unit');
create trigger inventory_count_item_uom before insert or update of item_id, unit, actual_count_quantity, par_level_quantity on public.inventory_stock_check_items
for each row execute function inventory_authority.check_item_quantity_uom('item_id', 'unit');
create trigger inventory_recipe_item_uom before insert or update of inventory_item_id, unit, quantity_used on public.inventory_recipe_items
for each row execute function inventory_authority.check_item_quantity_uom('inventory_item_id', 'unit');
create trigger inventory_movement_item_uom before insert or update of inventory_item_id, unit, quantity on public.inventory_movements
for each row execute function inventory_authority.check_item_quantity_uom('inventory_item_id', 'unit');
create trigger inventory_waste_item_uom before insert or update of inventory_item_id, unit, quantity on public.inventory_waste_records
for each row execute function inventory_authority.check_item_quantity_uom('inventory_item_id', 'unit');

create function inventory_authority.protect_stock_uom_history_codes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.code = old.code then return new; end if;
  if exists (select 1 from inventory_authority.item_stock_uom_changes
     where lower(btrim(old_unit)) = lower(btrim(old.code)) or lower(btrim(new_unit)) = lower(btrim(old.code))) then
    raise exception using errcode = '23514', message = 'This UOM code is in use. Archive it instead.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger inventory_stock_uom_history_code_guard before update of code or delete on public.inventory_uoms
for each row execute function inventory_authority.protect_stock_uom_history_codes();

revoke all on function inventory_authority.stock_uom_change_blocker(uuid),
  inventory_authority.require_stock_uom_command(), inventory_authority.check_item_quantity_uom(),
  inventory_authority.protect_stock_uom_history_codes()
from public, anon, authenticated, service_role;
revoke all on function public.inventory_master_stock_uom_history(uuid),
  public.inventory_master_change_stock_uom(uuid,text,text,uuid,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.inventory_master_stock_uom_history(uuid),
  public.inventory_master_change_stock_uom(uuid,text,text,uuid,uuid,text)
to authenticated;

-- Retire purchase-unit setup and discovery. Existing order line references and their receipt path are retained.
revoke all on function public.inventory_master_uom_history(uuid),
  public.inventory_master_revise_uom(uuid,text,numeric,date,text,uuid,uuid,text)
from public, anon, authenticated, service_role;
create or replace function inventory_authority.purchase_uom_choices(p_outlet_id uuid)
returns jsonb language sql stable set search_path = '' as $$ select '{}'::jsonb; $$;

create or replace function inventory_authority.resolve_po_line_unit(p_order_id uuid, p_line jsonb, p_source_unit text)
returns public.inventory_purchase_order_items language plpgsql set search_path = '' as $$
declare
  v_result public.inventory_purchase_order_items%rowtype;
  v_requested_revision uuid := nullif(p_line->>'uom_revision_id', '')::uuid;
  v_item_id uuid := (p_line->>'item_id')::uuid;
  v_source_id uuid := nullif(p_line->>'source_stock_check_item_id', '')::uuid;
  v_unit text := nullif(p_line->>'unit', '');
  v_stock_unit text;
  v_keep boolean;
begin
  select unit into v_stock_unit from public.inventory_items where id = v_item_id for share;
  select line.* into v_result from public.inventory_purchase_order_items line
  where line.purchase_order_id = p_order_id and line.item_id = v_item_id
    and line.source_stock_check_item_id is not distinct from v_source_id
    and (line.id = nullif(p_line->>'line_id', '')::uuid or (
      not (p_line ? 'line_id') and line.unit is not distinct from v_unit
    ))
  order by line.id limit 1;
  v_keep := found and v_result.unit is not distinct from v_unit
    and (v_result.uom_revision_id is not distinct from v_requested_revision or not (p_line ? 'uom_revision_id'));
  if v_keep then
    if not (p_line ? 'line_id') and exists (
      select 1 from public.inventory_purchase_order_items line
      where line.purchase_order_id = p_order_id and line.item_id = v_item_id
        and line.source_stock_check_item_id is not distinct from v_source_id and line.unit is not distinct from v_unit
        and (line.stock_unit, line.stock_units_per_purchase_unit, line.uom_revision_id)
          is distinct from (v_result.stock_unit, v_result.stock_units_per_purchase_unit, v_result.uom_revision_id)
    ) then
      raise exception 'Multiple saved UOM bases match this item. Reload this order before editing.';
    end if;
    return v_result;
  end if;

  if v_source_id is not null and (p_source_unit is null
    or lower(btrim(p_source_unit)) is distinct from lower(btrim(v_stock_unit))) then
    raise exception 'This stock check quantity has no compatible Stock UOM. Review the source count.';
  end if;
  v_result := null;
  if v_requested_revision is not null then
    raise exception 'New order lines must use the item UOM. Reload the order and choose the item again.';
  end if;
  if nullif(btrim(v_stock_unit), '') is null
    or (v_unit is not null and lower(btrim(v_unit)) is distinct from lower(btrim(v_stock_unit)))
    or (v_unit is null and exists (select 1 from inventory_authority.item_stock_uom_changes where item_id = v_item_id)) then
    raise exception 'Use the current item UOM for this order line. Refresh the item before saving.';
  end if;
  v_result.stock_units_per_purchase_unit := 1;
  v_result.unit := v_stock_unit;
  v_result.stock_unit := v_stock_unit;
  return v_result;
end;
$$;

commit;
