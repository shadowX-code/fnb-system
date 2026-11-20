create table inventory_authority.item_cost_revisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  revision_number integer not null,
  unit_cost numeric(12,4) not null check (unit_cost >= 0 and unit_cost < 'Infinity'::numeric),
  unit text,
  effective_date date,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  actor_user_id uuid,
  actor_employee_id uuid,
  actor_name text,
  recorded_at timestamptz not null,
  previous_revision_id uuid references inventory_authority.item_cost_revisions(id),
  supersedes_revision_id uuid unique references inventory_authority.item_cost_revisions(id),
  comparison_revision_id uuid references inventory_authority.item_cost_revisions(id),
  unique (item_id, revision_number),
  check (
    (effective_date is null and revision_number = 1 and previous_revision_id is null
      and supersedes_revision_id is null)
    or
    (effective_date is not null and nullif(btrim(unit), '') is not null
      and actor_user_id is not null)
  )
);
alter table inventory_authority.item_cost_revisions enable row level security;
revoke all on inventory_authority.item_cost_revisions from public, anon, authenticated, service_role;

create unique index inventory_cost_revision_effective_date
  on inventory_authority.item_cost_revisions (item_id, effective_date)
  where effective_date is not null and supersedes_revision_id is null;

alter table public.inventory_items
  add column cost_revision_id uuid;

-- The old write timestamp is evidence of recording, not an effective date.
insert into inventory_authority.item_cost_revisions (
  item_id, revision_number, unit_cost, unit, reason, actor_employee_id, actor_name, recorded_at
)
select item.id, 1, item.cost, item.unit, 'Existing configured cost', item.cost_updated_by,
  coalesce(nullif(btrim(employee.nickname), ''), nullif(btrim(employee.full_name), '')),
  item.cost_updated_at
from public.inventory_items item
left join public.employees employee on employee.id = item.cost_updated_by
where item.cost_updated_at is not null and item.cost >= 0 and item.cost < 'Infinity'::numeric;

update public.inventory_items item set cost_revision_id = revision.id
from inventory_authority.item_cost_revisions revision where revision.item_id = item.id;

create function inventory_authority.protect_item_cost_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'Inventory cost revisions are immutable.';
end;
$$;

create trigger inventory_cost_revision_immutable before update or delete
on inventory_authority.item_cost_revisions for each row
execute function inventory_authority.protect_item_cost_revision();

create function inventory_authority.guard_item_cost_projection()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.cost_revision_id is not null and nullif(btrim(old.unit), '') is not null
      and lower(btrim(new.unit)) is distinct from lower(btrim(old.unit)) then
      raise exception using errcode = '23514',
        message = 'This item has cost history in its current UOM. Create a separate item to use a different UOM.';
    end if;
    if current_user = 'postgres' or (
      (new.cost, new.cost_updated_at, new.cost_revision_id)
        is not distinct from (old.cost, old.cost_updated_at, old.cost_revision_id)
      and (new.cost_updated_by is not distinct from old.cost_updated_by
        or (new.cost_updated_by is null and pg_trigger_depth() > 1))
    ) then
      return new;
    end if;
  elsif coalesce(new.cost, 0) = 0 and new.cost_updated_at is null and new.cost_updated_by is null
    and new.cost_revision_id is null then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'Use Cost History to configure or update the unit cost.';
end;
$$;

create trigger inventory_item_cost_projection_guard before insert or update
on public.inventory_items for each row
execute function inventory_authority.guard_item_cost_projection();

create function inventory_authority.can_read_item_cost(p_item_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and (
    public.current_user_has_permission('inventory_master.view')
    or public.current_user_has_permission('inventory_control.view')
  ) and (
    public.current_user_has_all_outlet_access() or exists (
      select 1 from public.inventory_item_outlets link
      where link.inventory_item_id = p_item_id
        and public.current_user_can_access_outlet(link.outlet_id)
    )
  );
$$;

create function public.inventory_master_cost_history(p_item_id uuid)
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
    'current_cost', case when item.cost_revision_id is not null then item.cost end,
    'previous_cost', comparison.unit_cost,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', revision.id, 'unit_cost', revision.unit_cost, 'unit', revision.unit,
        'effective_date', revision.effective_date, 'reason', revision.reason,
        'actor_name', revision.actor_name, 'recorded_at', revision.recorded_at,
        'previous_revision_id', revision.previous_revision_id,
        'supersedes_revision_id', revision.supersedes_revision_id
      ) order by revision.revision_number desc)
      from inventory_authority.item_cost_revisions revision where revision.item_id = item.id
    ), '[]'::jsonb)
  ) into v_history
  from public.inventory_items item
  left join inventory_authority.item_cost_revisions current_revision on current_revision.id = item.cost_revision_id
  left join inventory_authority.item_cost_revisions comparison on comparison.id = current_revision.comparison_revision_id
  where item.id = p_item_id;

  if v_history is null then
    raise exception 'Inventory item was not found.';
  end if;
  return v_history;
end;
$$;

create function public.inventory_master_cost_changes()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(current_revision.id, comparison.unit_cost), '{}'::jsonb)
  from public.inventory_items item
  join inventory_authority.item_cost_revisions current_revision on current_revision.id = item.cost_revision_id
  join inventory_authority.item_cost_revisions comparison on comparison.id = current_revision.comparison_revision_id
  where inventory_authority.can_read_item_cost(item.id);
$$;

create function public.inventory_master_revise_cost(
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
  if nullif(btrim(v_item.unit), '') is null
    or lower(btrim(v_item.unit)) is distinct from lower(btrim(p_unit)) then
    raise exception using errcode = '22023', message = 'The unit must match the item’s current UOM. Reload Cost History and try again.';
  end if;

  select * into v_request from inventory_authority.item_cost_revisions where id = p_request_id;
  if found then
    if (v_request.item_id, v_request.actor_user_id, v_request.unit_cost, v_request.effective_date,
        v_request.reason, v_request.previous_revision_id, v_request.supersedes_revision_id)
      is distinct from
       (p_item_id, v_actor, p_unit_cost, p_effective_date, v_reason,
        p_expected_revision_id, p_correct_revision_id) then
      raise exception using errcode = '22023', message = 'This request has already been used for a different cost update.';
    end if;
    return public.inventory_master_cost_history(p_item_id);
  end if;

  select * into v_tail from inventory_authority.item_cost_revisions
    where item_id = p_item_id order by revision_number desc limit 1;
  if v_tail.id is distinct from p_expected_revision_id then
    raise exception using errcode = '40001', message = 'Cost history changed. Reload it before saving your update.';
  end if;

  select * into v_current from inventory_authority.item_cost_revisions where id = v_item.cost_revision_id;
  if p_correct_revision_id is null then
    if p_effective_date <= v_current.effective_date then
      raise exception using errcode = '22023', message = 'Choose a date after the latest effective date, or correct a dated revision.';
    end if;
    if p_unit_cost = v_current.unit_cost then
      raise exception using errcode = '22023', message = 'Enter a unit cost different from the current cost.';
    end if;
  else
    select revision.* into v_corrected from inventory_authority.item_cost_revisions revision
    where revision.id = p_correct_revision_id and revision.item_id = p_item_id
      and revision.effective_date = p_effective_date
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
    actor_employee_id, actor_name, recorded_at, previous_revision_id, supersedes_revision_id, comparison_revision_id
  ) values (
    p_request_id, p_item_id, coalesce(v_tail.revision_number, 0) + 1, p_unit_cost, v_item.unit,
    p_effective_date, v_reason, v_actor, v_employee, coalesce(v_actor_name, 'Inventory user'),
    v_now, v_tail.id, v_corrected.id, coalesce(v_corrected.id,
      case when lower(btrim(v_current.unit)) = lower(btrim(v_item.unit)) then v_current.id end)
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

revoke all on function inventory_authority.protect_item_cost_revision(),
  inventory_authority.guard_item_cost_projection(), inventory_authority.can_read_item_cost(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.inventory_master_cost_history(uuid), public.inventory_master_cost_changes(),
  public.inventory_master_revise_cost(uuid,numeric,text,date,text,uuid,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.inventory_master_cost_history(uuid), public.inventory_master_cost_changes(),
  public.inventory_master_revise_cost(uuid,numeric,text,date,text,uuid,uuid,uuid) to authenticated;
