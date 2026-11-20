begin;

do $guard$
begin
  if exists (
    select 1 from (values
      ('feedx_integrations.ra_save_purchase_order(uuid,uuid,jsonb,jsonb,uuid,uuid,uuid,text)'::regprocedure, 'ddeb02f2c381539debc6f6f80878db7d'),
      ('feedx_integrations.ra_receive_purchase_order(uuid,uuid,uuid,text,jsonb,uuid,uuid,uuid,text)'::regprocedure, '558e59b137d28999e0290470658f2c73'),
      ('public.crew_inventory_purchase_orders(text,uuid,uuid)'::regprocedure, '07f3ff80bb02518ae4d30b3d49fc225e')
    ) expected(oid, body_hash) join pg_catalog.pg_proc p on p.oid = expected.oid
    where md5(btrim(p.prosrc)) <> expected.body_hash
  ) then
    raise exception 'A shared Purchase Order authority changed. Review the UOM migration against the deployed function.';
  end if;
end;
$guard$;

create table inventory_authority.item_uom_revisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  stock_unit text not null check (btrim(stock_unit) <> ''),
  purchase_unit text,
  stock_units_per_purchase_unit numeric(15,6),
  effective_date date,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  recorded_by uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  previous_revision_id uuid unique references inventory_authority.item_uom_revisions(id),
  check (
    (effective_date is null and purchase_unit is null and stock_units_per_purchase_unit is null
      and previous_revision_id is null and recorded_by is null)
    or (effective_date is not null and purchase_unit is not null
      and stock_units_per_purchase_unit > 0 and stock_units_per_purchase_unit < 'Infinity'::numeric
      and previous_revision_id is not null and recorded_by is not null)
  )
);
create unique index item_uom_baseline on inventory_authority.item_uom_revisions(item_id) where effective_date is null;
create index item_uom_effective on inventory_authority.item_uom_revisions(item_id, effective_date desc, recorded_at desc);
alter table inventory_authority.item_uom_revisions enable row level security;
revoke all on inventory_authority.item_uom_revisions from public, anon, authenticated, service_role;

create function inventory_authority.protect_item_uom_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'Inventory UOM history is immutable.';
end;
$$;
create trigger item_uom_revision_immutable before update or delete on inventory_authority.item_uom_revisions
for each row execute function inventory_authority.protect_item_uom_revision();

create function inventory_authority.guard_item_stock_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit is distinct from old.unit and (
    exists (select 1 from public.inventory_item_outlets r where r.inventory_item_id = old.id)
    or exists (select 1 from public.inventory_stock_check_items r where r.item_id = old.id)
    or exists (select 1 from public.inventory_movements r where r.inventory_item_id = old.id)
    or exists (select 1 from public.inventory_purchase_order_items r where r.item_id = old.id)
    or exists (select 1 from public.inventory_recipe_items r where r.inventory_item_id = old.id)
    or exists (select 1 from public.inventory_waste_records r where r.inventory_item_id = old.id)
    or exists (select 1 from inventory_authority.item_uom_revisions r where r.item_id = old.id)
  ) then
    raise exception using errcode = '23514', message = 'This Stock UOM is in use. Use Manage Units to configure a purchase unit.';
  end if;
  return new;
end;
$$;
create trigger inventory_stock_unit_guard before update of unit on public.inventory_items
for each row execute function inventory_authority.guard_item_stock_unit();

create function inventory_authority.protect_used_uom_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.code = old.code then return new; end if;
  if exists (select 1 from public.inventory_items r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from public.inventory_stock_check_items r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from public.inventory_purchase_order_items r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from public.inventory_purchase_receipt_items r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from public.inventory_movements r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from public.inventory_waste_records r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from public.inventory_recipe_items r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from inventory_authority.item_cost_revisions r where lower(btrim(r.unit)) = lower(btrim(old.code)))
    or exists (select 1 from inventory_authority.item_uom_revisions r
      where lower(btrim(r.stock_unit)) = lower(btrim(old.code)) or lower(btrim(r.purchase_unit)) = lower(btrim(old.code))) then
    raise exception using errcode = '23514', message = 'This UOM code is in use. Archive it instead.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger inventory_uom_code_guard before update of code or delete on public.inventory_uoms
for each row execute function inventory_authority.protect_used_uom_code();

create function inventory_authority.effective_item_purchase_uom(p_item_id uuid)
returns inventory_authority.item_uom_revisions language sql stable set search_path = '' as $$
  select revision.* from inventory_authority.item_uom_revisions revision
  where revision.item_id = p_item_id
    and revision.effective_date <= (statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date
  order by revision.effective_date desc, revision.recorded_at desc limit 1;
$$;

create function public.inventory_master_uom_history(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not inventory_authority.can_read_item_cost(p_item_id) then
    raise exception using errcode = '42501', message = 'Master Inventory access is required.';
  end if;
  select jsonb_build_object(
    'stock_unit', item.unit,
    'current', inventory_authority.effective_item_purchase_uom(item.id),
    'revisions', coalesce((
      select jsonb_agg(to_jsonb(revision) || jsonb_build_object('actor_name',
        coalesce(nullif(employee.nickname, ''), employee.full_name)) order by revision.recorded_at desc)
      from inventory_authority.item_uom_revisions revision
      left join public.employees employee on employee.auth_user_id = revision.recorded_by
      where revision.item_id = item.id
    ), '[]'::jsonb)
  ) into v_result from public.inventory_items item where item.id = p_item_id;
  return v_result;
end;
$$;

create function public.inventory_master_revise_uom(
  p_item_id uuid, p_purchase_unit text, p_factor numeric, p_effective_date date, p_reason text,
  p_request_id uuid, p_expected_revision_id uuid, p_stock_unit text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_item public.inventory_items%rowtype;
  v_previous inventory_authority.item_uom_revisions%rowtype;
  v_request inventory_authority.item_uom_revisions%rowtype;
  v_today date := (statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_unit text := btrim(p_purchase_unit);
  v_reason text := btrim(p_reason);
begin
  if not inventory_authority.can_read_item_cost(p_item_id)
    or not (public.current_user_has_permission('inventory_master.edit')
      or public.current_user_has_permission('inventory_control.manage_master')) then
    raise exception using errcode = '42501', message = 'Master Inventory edit permission and item access are required.';
  end if;
  if p_request_id is null or p_factor is null or not (p_factor > 0 and p_factor < 1000000000)
    or p_factor <> trunc(p_factor, 6) or coalesce(length(v_reason), 0) not between 1 and 500
    or p_effective_date is null or not isfinite(p_effective_date) then
    raise exception using errcode = '22023', message = 'Enter a positive factor with up to six decimals, an effective date and a reason.';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if nullif(btrim(v_item.unit), '') is null or v_item.unit is distinct from p_stock_unit then
    raise exception 'The Stock UOM changed. Reload Manage Units.';
  end if;
  select * into v_request from inventory_authority.item_uom_revisions where id = p_request_id;
  if found then
    if (v_request.item_id, v_request.recorded_by, v_request.purchase_unit,
        v_request.stock_units_per_purchase_unit, v_request.effective_date, v_request.reason)
        is distinct from (p_item_id, v_actor, v_unit, p_factor, p_effective_date, v_reason)
      or (v_request.previous_revision_id is distinct from p_expected_revision_id
        and not (p_expected_revision_id is null and exists (
          select 1 from inventory_authority.item_uom_revisions b
          where b.id = v_request.previous_revision_id and b.effective_date is null))) then
      raise exception 'This request was already used for a different UOM change.';
    end if;
    return public.inventory_master_uom_history(p_item_id);
  end if;
  if lower(v_unit) = lower(btrim(v_item.unit)) and (p_factor <> 1 or v_unit <> v_item.unit) then
    raise exception 'Stock UOM must use a factor of 1.';
  end if;
  if nullif(v_unit, '') is null or (v_unit <> v_item.unit and not exists (
    select 1 from public.inventory_uoms where code = v_unit and is_active
  )) then
    raise exception 'Choose Stock UOM or an active purchase unit.';
  end if;
  select * into v_previous from inventory_authority.item_uom_revisions
    where item_id = p_item_id order by recorded_at desc limit 1;
  if v_previous.id is distinct from p_expected_revision_id then
    raise exception using errcode = '40001', message = 'UOM history changed. Reload Manage Units.';
  end if;
  if p_effective_date < v_today or p_effective_date < v_previous.effective_date then
    raise exception 'Choose today or a future date on or after the latest configured effective date (MYT).';
  end if;
  if (v_previous.purchase_unit, v_previous.stock_units_per_purchase_unit) is not distinct from (v_unit, p_factor) then
    raise exception 'The purchase unit and factor are already configured.';
  end if;
  if v_previous.id is null then
    insert into inventory_authority.item_uom_revisions(item_id, stock_unit, reason)
    values (p_item_id, v_item.unit, 'Stock UOM recorded when purchase unit management began')
    returning * into v_previous;
  end if;
  insert into inventory_authority.item_uom_revisions(
    id, item_id, stock_unit, purchase_unit, stock_units_per_purchase_unit, effective_date, reason, recorded_by, previous_revision_id)
  values (p_request_id, p_item_id, v_item.unit, v_unit, p_factor, p_effective_date, v_reason, v_actor, v_previous.id);
  return public.inventory_master_uom_history(p_item_id);
end;
$$;

alter table public.inventory_purchase_order_items
  add column uom_revision_id uuid references inventory_authority.item_uom_revisions(id),
  add column stock_unit text,
  add column stock_units_per_purchase_unit numeric(15,6),
  add constraint inventory_po_stock_unit_pin check (
    (stock_unit is null and stock_units_per_purchase_unit is null and uom_revision_id is null)
    or (stock_unit is not null and stock_units_per_purchase_unit is not null and stock_units_per_purchase_unit > 0)
  );

alter table public.inventory_purchase_receipt_items
  add column stock_unit text,
  add column stock_quantity numeric(14,3);

create function inventory_authority.purchase_uom_choices(p_outlet_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(link.inventory_item_id, jsonb_build_object(
    'uom_revision_id', r.id, 'unit', r.purchase_unit, 'stock_unit', r.stock_unit,
    'stock_units_per_purchase_unit', r.stock_units_per_purchase_unit)), '{}'::jsonb)
  from public.inventory_item_outlets link
  cross join lateral inventory_authority.effective_item_purchase_uom(link.inventory_item_id) r
  join public.inventory_uoms uom on uom.code = r.purchase_unit and uom.is_active
  where link.outlet_id = p_outlet_id and link.is_active is not false and r.purchase_unit <> r.stock_unit;
$$;

create function public.inventory_purchase_uom_choices(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.current_user_can_access_outlet(p_outlet_id)
    or not (public.current_user_has_permission('inventory_orders.edit')
      or public.current_user_has_permission('inventory_orders.create')
      or public.current_user_has_permission('inventory_orders.view')
      or public.current_user_has_permission('inventory_stock_check.review')) then
    raise exception using errcode = '42501', message = 'Purchase Order outlet access is required.';
  end if;
  return inventory_authority.purchase_uom_choices(p_outlet_id);
end;
$$;

create function inventory_authority.resolve_po_line_unit(p_order_id uuid, p_line jsonb, p_source_unit text)
returns public.inventory_purchase_order_items language plpgsql set search_path = '' as $$
declare
  v_result public.inventory_purchase_order_items%rowtype;
  v_revision inventory_authority.item_uom_revisions%rowtype;
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
    select * into v_revision from inventory_authority.effective_item_purchase_uom(v_item_id);
    if v_revision.id is distinct from v_requested_revision or v_revision.purchase_unit is distinct from v_unit
      or v_revision.stock_unit is distinct from v_stock_unit
      or not exists (select 1 from public.inventory_uoms where code = v_unit and is_active) then
      raise exception 'Purchase UOM changed. Reload the available units before saving.';
    end if;
    v_result.uom_revision_id := v_revision.id;
    v_result.stock_units_per_purchase_unit := v_revision.stock_units_per_purchase_unit;
    v_result.unit := v_revision.purchase_unit;
  else
    if nullif(btrim(v_stock_unit), '') is null or (v_unit is not null
      and lower(btrim(v_unit)) is distinct from lower(btrim(v_stock_unit))) then
      raise exception 'Choose the Stock UOM or a configured purchase unit.';
    end if;
    v_result.stock_units_per_purchase_unit := 1;
    v_result.unit := v_stock_unit;
  end if;
  v_result.stock_unit := v_stock_unit;
  return v_result;
end;
$$;

create function inventory_authority.validate_po_unit_quantity(p_quantity numeric, p_factor numeric)
returns void language plpgsql set search_path = '' as $$
begin
  if p_factor is not null and (
    p_quantity is null or not (p_quantity > 0 and p_quantity < 100000000000)
    or p_quantity <> trunc(p_quantity, 3)
    or p_quantity * p_factor >= 100000000000
    or p_quantity * p_factor <> trunc(p_quantity * p_factor, 3)
  ) then
    raise exception using errcode = '22023', message = 'Use a quantity that fits three decimal places in both purchase and stock units.';
  end if;
end;
$$;

revoke all on function inventory_authority.protect_item_uom_revision(),
  inventory_authority.guard_item_stock_unit(), inventory_authority.protect_used_uom_code(),
  inventory_authority.effective_item_purchase_uom(uuid), inventory_authority.purchase_uom_choices(uuid),
  inventory_authority.resolve_po_line_unit(uuid,jsonb,text), inventory_authority.validate_po_unit_quantity(numeric,numeric)
from public, anon, authenticated, service_role;
revoke all on function public.inventory_master_uom_history(uuid),
  public.inventory_master_revise_uom(uuid,text,numeric,date,text,uuid,uuid,text), public.inventory_purchase_uom_choices(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.inventory_master_uom_history(uuid),
  public.inventory_master_revise_uom(uuid,text,numeric,date,text,uuid,uuid,text), public.inventory_purchase_uom_choices(uuid)
to authenticated;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_save_purchase_order(p_machine uuid, p_request_id uuid, p_order jsonb, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_existing public.inventory_purchase_orders%rowtype;
  v_check public.inventory_stock_checks%rowtype;
  v_item jsonb; v_result jsonb; v_now timestamptz:=now();
  v_id uuid:=nullif(p_order->>'id','')::uuid;
  v_outlet uuid:=nullif(p_order->>'outlet_id','')::uuid;
  v_supplier uuid:=nullif(p_order->>'supplier_id','')::uuid;
  v_source uuid:=nullif(p_order->>'source_stock_check_id','')::uuid;
  v_source_type text:=coalesce(nullif(p_order->>'source_type',''),'manual');
  v_fingerprint text:=md5(jsonb_build_object('order',p_order,'items',p_items)::text);
  v_source_item public.inventory_stock_check_items%rowtype;
  v_seen_source_items uuid[]:='{}';
  v_units public.inventory_purchase_order_items%rowtype;
  v_resolved jsonb := '[]';
begin
 if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null or p_actor_kind<>'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then raise exception using errcode='42501',message='Invalid Restaurant machine principal or outlet';end if;
  if p_request_id is null or v_outlet is null or v_outlet is distinct from p_scope_outlet or v_supplier is null then
    raise exception 'Request, outlet and supplier are required.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Purchase order requires at least one item.';
  end if;
  if coalesce(nullif(p_order->>'status',''),'draft') <> 'draft' then raise exception 'Only Draft purchase orders can be saved.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='purchase_order'
    and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  if v_id is not null then
    select * into v_existing from public.inventory_purchase_orders where id=v_id for update;
    if not found or v_existing.status <> 'draft' then raise exception 'Only Draft purchase orders can be edited.'; end if;
    if v_existing.outlet_id is distinct from v_outlet then raise exception 'Purchase order outlet cannot change.'; end if;
    if coalesce(v_existing.source_type,'manual') is distinct from v_source_type or v_existing.source_stock_check_id is distinct from v_source then
      raise exception 'Purchase order source cannot change.';
    end if;
  end if;
  if v_source_type='stock_check' then
    if v_source is null then raise exception 'Source stock check is required.'; end if;
    perform pg_advisory_xact_lock(hashtext('inventory_stock_check_po_'||v_source::text));
    select * into v_check from public.inventory_stock_checks where id=v_source;
    if not found or v_check.outlet_id is distinct from v_outlet or v_check.stock_check_type <> 'scheduled'
      or v_check.status <> 'submitted' then
      raise exception 'Only a completed scheduled stock check for this outlet can create purchase orders.';
    end if;
    if v_id is null and exists(select 1 from public.inventory_purchase_orders
      where source_type='stock_check' and source_stock_check_id=v_source and supplier_id=v_supplier and status<>'cancelled') then
      raise exception 'A purchase order already exists for this stock check and supplier.';
    end if;
  elsif v_source is not null then
    raise exception 'A source stock check requires stock_check source type.';
  end if;
  if not exists(select 1 from public.supplier_outlets where supplier_id=v_supplier and outlet_id=v_outlet) then
    raise exception 'Supplier is not assigned to this outlet.';
  end if;
  if (v_id is null or v_supplier is distinct from v_existing.supplier_id)
    and not exists(select 1 from public.suppliers where id=v_supplier and status='active') then
    raise exception 'Supplier is not active.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'item_id','') is null or coalesce(nullif(v_item->>'requested_qty','')::numeric,0)<=0 then
      raise exception 'Purchase order items require an item and positive quantity.';
    end if;
    if not exists(select 1 from public.inventory_item_outlets where outlet_id=v_outlet
      and inventory_item_id=(v_item->>'item_id')::uuid) then
      raise exception 'Purchase order item does not belong to this outlet.';
    end if;
    -- Keep existing manual draft lines editable if a catalog link was later removed.
    -- A new item, additional copy or supplier change must pass current eligibility.
    if v_source_type<>'stock_check' and not exists(
      select 1 from public.inventory_item_outlets io
      join public.inventory_items i on i.id=io.inventory_item_id and i.status='active'
      join public.inventory_item_outlet_suppliers link on link.inventory_item_outlet_id=io.id
      join public.suppliers s on s.id=link.supplier_id and s.status='active'
      where io.outlet_id=v_outlet and io.is_active and i.id=(v_item->>'item_id')::uuid
        and link.supplier_id=v_supplier
    ) and not (
      v_id is not null and v_supplier=v_existing.supplier_id
      and (select count(*) from public.inventory_purchase_order_items old_line
        where old_line.purchase_order_id=v_id and old_line.item_id=(v_item->>'item_id')::uuid)
      >= (select count(*) from jsonb_array_elements(p_items) new_line
        where (new_line->>'item_id')::uuid=(v_item->>'item_id')::uuid)
    ) then
      raise exception 'Choose an active item linked to the selected supplier at this outlet.';
    end if;
    if v_source_type='stock_check' then
      select * into v_source_item from public.inventory_stock_check_items
        where id=nullif(v_item->>'source_stock_check_item_id','')::uuid and stock_check_id=v_source;
      if not found or v_source_item.item_id is distinct from (v_item->>'item_id')::uuid
        or v_source_item.skipped or v_source_item.actual_count_quantity is null
        or v_source_item.par_level_quantity is null
        or v_source_item.par_level_quantity <= v_source_item.actual_count_quantity then
        raise exception 'Purchase order line is not an eligible stock check shortage.';
      end if;
      if v_source_item.id=any(v_seen_source_items) then raise exception 'A stock check item cannot appear twice in a purchase order.'; end if;
      v_seen_source_items:=array_append(v_seen_source_items,v_source_item.id);
      if not exists(select 1 from public.inventory_item_outlet_suppliers ios
        join public.inventory_item_outlets iio on iio.id=ios.inventory_item_outlet_id
        where iio.outlet_id=v_outlet and iio.inventory_item_id=v_source_item.item_id and ios.supplier_id=v_supplier) then
        raise exception 'Supplier is not assigned to this stock check item.';
      end if;
      if exists(select 1 from public.inventory_purchase_order_items line
        join public.inventory_purchase_orders po on po.id=line.purchase_order_id
        where line.source_stock_check_item_id=v_source_item.id and po.status<>'cancelled'
          and (v_id is null or po.id<>v_id)) then
        raise exception 'A purchase order already exists for this stock check item.';
      end if;
    elsif nullif(v_item->>'source_stock_check_item_id','') is not null then
      raise exception 'Manual purchase orders cannot reference stock check items.';
    end if;
    v_units := inventory_authority.resolve_po_line_unit(v_id, v_item, v_source_item.unit);
    perform inventory_authority.validate_po_unit_quantity((v_item->>'requested_qty')::numeric, v_units.stock_units_per_purchase_unit);
    v_resolved := v_resolved || jsonb_build_array(v_item || jsonb_build_object(
      'unit', v_units.unit, 'uom_revision_id', v_units.uom_revision_id,
      'stock_unit', v_units.stock_unit, 'stock_units_per_purchase_unit', v_units.stock_units_per_purchase_unit
    ));
  end loop;
  if v_id is not null then
    update public.inventory_purchase_orders set supplier_id=v_supplier,updated_at=v_now where id=v_id returning * into v_order;
    delete from public.inventory_purchase_order_items where purchase_order_id=v_id;
  else
    insert into public.inventory_purchase_orders(po_no,outlet_id,supplier_id,status,source_type,source_stock_check_id,
      created_by,created_by_employee_id,created_at,updated_at)
    values(nullif(p_order->>'po_no',''),v_outlet,v_supplier,'draft',v_source_type,v_source,p_actor_user,p_actor_employee,v_now,v_now)
    returning * into v_order;
  end if;
  for v_item in select value from jsonb_array_elements(v_resolved) loop
    insert into public.inventory_purchase_order_items(purchase_order_id,item_id,requested_qty,received_qty,unit,remark,
      source_stock_check_item_id,created_at,updated_at,uom_revision_id,stock_unit,stock_units_per_purchase_unit)
    values(v_order.id,(v_item->>'item_id')::uuid,(v_item->>'requested_qty')::numeric,0,
      nullif(v_item->>'unit',''),nullif(v_item->>'remark',''),
      nullif(v_item->>'source_stock_check_item_id','')::uuid,v_now,v_now,
      (v_item->>'uom_revision_id')::uuid,v_item->>'stock_unit',(v_item->>'stock_units_per_purchase_unit')::numeric);
  end loop;
  v_result:=jsonb_build_object('order',to_jsonb(v_order),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at)
    from public.inventory_purchase_order_items i where i.purchase_order_id=v_order.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id) values(p_request_id,'purchase_order',p_actor_user,p_actor_employee,p_actor_kind,v_outlet,v_result,v_fingerprint,p_machine);
  if v_id is null then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_draft_created','inventory',p_actor_user,'Purchase order draft created.',
      jsonb_build_object('purchase_order_id',v_order.id,'outlet_id',v_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  end if;
  return v_result;
end; $function$;

CREATE OR REPLACE FUNCTION feedx_integrations.ra_receive_purchase_order(p_machine uuid, p_purchase_order_id uuid, p_request_id uuid, p_remark text, p_items jsonb, p_scope_outlet uuid, p_actor_user uuid, p_actor_employee uuid, p_actor_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_order public.inventory_purchase_orders%rowtype;
  v_line public.inventory_purchase_order_items%rowtype;
  v_item jsonb; v_receipt public.inventory_purchase_receipts%rowtype;
  v_qty numeric; v_stock_qty numeric; v_unit text; v_now timestamptz:=now(); v_status text; v_result jsonb;
  v_fingerprint text:=md5(jsonb_build_object('order_id',p_purchase_order_id,'remark',p_remark,'items',p_items)::text);
begin
 if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null or p_actor_kind<>'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then raise exception using errcode='42501',message='Invalid Restaurant machine principal or outlet';end if;
  if p_request_id is null or p_purchase_order_id is null then raise exception 'Purchase order and request ID are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id
    and operation='purchase_receipt' and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  select * into v_order from public.inventory_purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order was not found.'; end if;
  if v_order.outlet_id is distinct from p_scope_outlet then
    raise exception using errcode='42501',message='Purchase order outlet is not authorized.';
  end if;
  if v_order.status not in ('submitted','supplier_confirmed','partial_received') then
    raise exception 'Purchase order is not open for receiving.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Enter received quantity for at least one item.';
  end if;
  insert into public.inventory_purchase_receipts(purchase_order_id,outlet_id,supplier_id,received_by,
    received_by_employee_id,received_at,remark,created_at)
  values(v_order.id,v_order.outlet_id,v_order.supplier_id,p_actor_user,p_actor_employee,v_now,nullif(btrim(p_remark),''),v_now)
  returning * into v_receipt;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty:=nullif(v_item->>'received_qty','')::numeric;
    if v_qty is null or v_qty<=0 then raise exception 'Received quantity must be greater than zero.'; end if;
    select * into v_line from public.inventory_purchase_order_items
      where id=(v_item->>'purchase_order_item_id')::uuid and purchase_order_id=v_order.id for update;
    if not found or v_line.item_id is distinct from (v_item->>'item_id')::uuid then
      raise exception 'Receipt item does not belong to this purchase order.';
    end if;
    if v_qty>v_line.requested_qty-v_line.received_qty then raise exception 'Receive quantity cannot exceed remaining quantity.'; end if;
    perform inventory_authority.validate_po_unit_quantity(v_qty, v_line.stock_units_per_purchase_unit);
    if v_line.stock_unit is not null and nullif(v_item->>'unit','') is not null
      and lower(btrim(v_item->>'unit')) is distinct from lower(btrim(v_line.unit)) then
      raise exception 'Receive quantities in the unit pinned to the purchase order line.';
    end if;
    v_unit := case when v_line.stock_unit is not null then v_line.unit
      else coalesce(nullif(v_item->>'unit',''),v_line.unit) end;
    v_stock_qty := v_qty * v_line.stock_units_per_purchase_unit;
    insert into public.inventory_purchase_receipt_items(receipt_id,purchase_order_item_id,item_id,received_qty,unit,remark,created_at,stock_unit,stock_quantity)
    values(v_receipt.id,v_line.id,v_line.item_id,v_qty,v_unit,nullif(v_item->>'remark',''),v_now,
      v_line.stock_unit,v_stock_qty);
    update public.inventory_purchase_order_items set received_qty=received_qty+v_qty,updated_at=v_now where id=v_line.id;
    insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,reference_type,
      reference_id,reference_no,notes,created_by,created_by_employee_id,created_at)
    values(v_order.outlet_id,v_line.item_id,'Purchase',coalesce(v_stock_qty,v_qty),coalesce(v_line.stock_unit,v_unit),
      'purchase_order',v_order.id,v_order.po_no,
      coalesce(nullif(v_item->>'remark',''),nullif(btrim(p_remark),''),'Purchase receive'),
      p_actor_user,p_actor_employee,v_now);
  end loop;
  select case when bool_and(received_qty>=requested_qty) then 'fully_received' else 'partial_received' end
    into v_status from public.inventory_purchase_order_items where purchase_order_id=v_order.id;
  update public.inventory_purchase_orders set status=v_status,updated_at=v_now where id=v_order.id returning * into v_order;
  v_result:=jsonb_build_object('receipt_id',v_receipt.id,'purchase_order_id',v_order.id,'status',v_order.status);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id) values(p_request_id,'purchase_receipt',p_actor_user,p_actor_employee,p_actor_kind,v_order.outlet_id,v_result,v_fingerprint,p_machine);
  insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_purchase_order_received','inventory',p_actor_user,'Purchase order receipt recorded.',
      jsonb_build_object('purchase_order_id',v_order.id,'receipt_id',v_receipt.id,'outlet_id',v_order.outlet_id,
        'actor_kind',p_actor_kind,'actor_employee_id',p_actor_employee,'request_id',p_request_id,'status',v_status));
  return v_result;
end; $function$;

create or replace function public.crew_inventory_purchase_orders(p_token text,p_outlet_id uuid default null,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'order_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid; v_order public.inventory_purchase_orders%rowtype;
  v_detail jsonb;
begin
  if p_order_id is not null then
    select * into v_order from public.inventory_purchase_orders where id=p_order_id and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Purchase order is unavailable for this outlet.'; end if;
    if v_order.status in ('completed','fully_received','cancelled') and
      coalesce(v_order.completed_at,v_order.updated_at,v_order.created_at)<
        (date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))-interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur' then
      raise exception using errcode='42501',message='Purchase order is outside Crew history.';
    end if;
    select jsonb_build_object('id',p.id,'po_no',p.po_no,'business_po_no',p.business_po_no,'status',p.status,
      'supplier_id',p.supplier_id,'supplier_name',s.name,'source_type',p.source_type,
      'source_stock_check_id',p.source_stock_check_id,'created_at',p.created_at,
      'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,'completed_at',p.completed_at,
      'category_names',(select coalesce(jsonb_agg(category.name order by category.name),'[]'::jsonb)
        from (select distinct c.name from public.inventory_purchase_order_items l
          join public.inventory_items i on i.id=l.item_id
          join public.inventory_categories c on c.id=i.category_id
          where l.purchase_order_id=p.id) category),
      'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'item_id',l.item_id,
        'item_name',i.item_name,'sku_code',i.sku_code,'photo_url',i.photo_url,
        'requested_qty',l.requested_qty,'received_qty',l.received_qty,
        'remaining_qty',greatest(l.requested_qty-l.received_qty,0),
        'unit',l.unit,'stock_unit',l.stock_unit,'stock_units_per_purchase_unit',l.stock_units_per_purchase_unit,
        'uom_revision_id',l.uom_revision_id,'remark',l.remark,'source_stock_check_item_id',l.source_stock_check_item_id)
        order by i.item_name,l.id)
        from public.inventory_purchase_order_items l join public.inventory_items i on i.id=l.item_id
        where l.purchase_order_id=p.id),'[]'::jsonb),
      'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'received_at',r.received_at,
        'remark',r.remark,'lines',coalesce((select jsonb_agg(jsonb_build_object('item_id',ri.item_id,
        'purchase_order_item_id',ri.purchase_order_item_id,'received_qty',ri.received_qty,
        'unit',ri.unit,'stock_unit',ri.stock_unit,'stock_quantity',ri.stock_quantity,'remark',ri.remark) order by ri.id)
        from public.inventory_purchase_receipt_items ri where ri.receipt_id=r.id),'[]'::jsonb))
        order by r.received_at,r.id) from public.inventory_purchase_receipts r
        where r.purchase_order_id=p.id),'[]'::jsonb)) into v_detail
      from public.inventory_purchase_orders p left join public.suppliers s on s.id=p.supplier_id
      where p.id=p_order_id;
  end if;
  return jsonb_build_object('outlet_id',v_outlet,
    'can_manage_purchase_orders',v_context->'can_manage_purchase_orders',
    'can_receive_purchase_orders',v_context->'can_receive_purchase_orders',
    'purchase_units',case when p_order_id is null and (v_context->>'can_manage_purchase_orders')::boolean
      then inventory_authority.purchase_uom_choices(v_outlet) else '{}'::jsonb end,
    'orders',coalesce((select jsonb_agg(row_data order by sort_at desc)
      from (select jsonb_build_object('id',p.id,'po_no',p.po_no,'business_po_no',p.business_po_no,'supplier_id',p.supplier_id,
        'supplier_name',s.name,'status',p.status,'source_type',p.source_type,
        'source_stock_check_id',p.source_stock_check_id,
        'created_at',p.created_at,'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,'completed_at',p.completed_at,
        'category_names',(select coalesce(jsonb_agg(category.name order by category.name),'[]'::jsonb)
          from (select distinct c.name from public.inventory_purchase_order_items l
            join public.inventory_items i on i.id=l.item_id
            join public.inventory_categories c on c.id=i.category_id
            where l.purchase_order_id=p.id) category),
        'line_count',(select count(*) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'requested_qty',(select coalesce(sum(l.requested_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'received_qty',(select coalesce(sum(l.received_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id)) row_data,
        p.created_at sort_at from public.inventory_purchase_orders p
        left join public.suppliers s on s.id=p.supplier_id where p.outlet_id=v_outlet
          and p.status not in ('completed','fully_received','cancelled')
        order by p.created_at desc,p.id limit 100) bounded),'[]'::jsonb),
    'suggestions',case when coalesce((v_context->>'can_manage_purchase_orders')::boolean,false) then
      coalesce((select jsonb_agg(row_data order by checked_at desc)
        from (select jsonb_build_object('stock_check_id',c.id,'check_name',coalesce(c.check_name,g.name),
          'check_date',c.check_date,'shortages',coalesce((select jsonb_agg(jsonb_build_object(
            'stock_check_item_id',ci.id,'item_id',ci.item_id,'item_name',i.item_name,'sku_code',i.sku_code,'photo_url',i.photo_url,
            'current_qty',ci.actual_count_quantity,'par_qty',ci.par_level_quantity,
            'shortage_qty',ci.par_level_quantity-ci.actual_count_quantity,'unit',ci.unit,
            'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
              from public.inventory_item_outlet_suppliers ios
              join public.inventory_item_outlets io on io.id=ios.inventory_item_outlet_id
              join public.suppliers s on s.id=ios.supplier_id and s.status='active'
              join public.supplier_outlets so on so.supplier_id=s.id and so.outlet_id=v_outlet
              where io.outlet_id=v_outlet and io.inventory_item_id=ci.item_id),'[]'::jsonb)) order by i.item_name,ci.id)
            from public.inventory_stock_check_items ci join public.inventory_items i on i.id=ci.item_id
            where ci.stock_check_id=c.id and not ci.skipped and ci.actual_count_quantity is not null
              and ci.par_level_quantity>ci.actual_count_quantity
              and not exists(select 1 from public.inventory_purchase_order_items l
                join public.inventory_purchase_orders p on p.id=l.purchase_order_id
                where l.source_stock_check_item_id=ci.id and p.status<>'cancelled')),'[]'::jsonb)) row_data,
          c.submitted_at checked_at
          from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
          where c.outlet_id=v_outlet and c.stock_check_type='scheduled' and c.status='submitted'
            and inventory_authority.crew_recent_source_check(c.id,v_outlet)
            and exists(select 1 from public.inventory_stock_check_items ci where ci.stock_check_id=c.id
              and not ci.skipped and ci.actual_count_quantity is not null and ci.par_level_quantity>ci.actual_count_quantity
              and not exists(select 1 from public.inventory_purchase_order_items l
                join public.inventory_purchase_orders p on p.id=l.purchase_order_id
                where l.source_stock_check_item_id=ci.id and p.status<>'cancelled'))
          order by c.submitted_at desc,c.id limit 40) bounded),'[]'::jsonb)
      else '[]'::jsonb end,'detail',v_detail);
end; $$;

commit;
