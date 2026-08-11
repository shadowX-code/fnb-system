-- Cross-day Production completion and immutable batch shelf-life metadata.
-- Additive schema only. Historical Productions remain unchanged.

alter table public.factory_finished_goods
  add column if not exists shelf_life_days integer;

alter table public.factory_productions
  add column if not exists end_date date,
  add column if not exists expiry_date date,
  add column if not exists storage_location_id uuid,
  add column if not exists shelf_life_days_snapshot integer,
  add column if not exists expiry_override_reason text;

do $$
begin
  if exists (
    select 1
    from public.factory_finished_goods
    where shelf_life_days is not null and shelf_life_days <= 0
  ) then
    raise exception 'Cannot enforce positive shelf life: factory_finished_goods contains zero or negative shelf_life_days.';
  end if;

  alter table public.factory_finished_goods
    drop constraint if exists factory_finished_goods_shelf_life_days_nonnegative;
  alter table public.factory_finished_goods
    add constraint factory_finished_goods_shelf_life_days_nonnegative
    check (shelf_life_days is null or shelf_life_days > 0);

  if not exists (
    select 1 from pg_constraint
    where conname = 'factory_productions_shelf_life_days_snapshot_nonnegative'
      and conrelid = 'public.factory_productions'::regclass
  ) then
    alter table public.factory_productions
      add constraint factory_productions_shelf_life_days_snapshot_nonnegative
      check (shelf_life_days_snapshot is null or shelf_life_days_snapshot > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'factory_productions_storage_location_id_fkey'
      and conrelid = 'public.factory_productions'::regclass
  ) then
    alter table public.factory_productions
      add constraint factory_productions_storage_location_id_fkey
      foreign key (storage_location_id)
      references public.factory_storage_locations(id)
      on delete set null;
  end if;
end
$$;

create index if not exists factory_productions_expiry_date_idx
on public.factory_productions (expiry_date)
where expiry_date is not null;

create index if not exists factory_productions_storage_location_id_idx
on public.factory_productions (storage_location_id)
where storage_location_id is not null;

-- Production users need read-only access to active Finished Goods locations.
-- Existing location mutation permissions remain unchanged.
drop policy if exists "factory storage locations view" on public.factory_storage_locations;
create policy "factory storage locations view" on public.factory_storage_locations
for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_batch_traceability.view')
  or public.current_user_has_permission('factory_storage_locations.view')
  or public.current_user_has_permission('factory_storage_locations.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

-- The wrapper below passes completion metadata to this trigger using
-- transaction-local settings. The Job Order and Packaging SKU remain the
-- authoritative sources for start datetime and shelf life.
create or replace function public.factory_guard_production_completion_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_start_at timestamp;
  v_end_at timestamp;
  v_expected_expiry date;
  v_location public.factory_storage_locations%rowtype;
begin
  if lower(coalesce(new.status, '')) <> 'completed' then
    return new;
  end if;

  select job.*
  into v_job_order
  from public.factory_job_orders job
  where job.id = new.job_order_id
  for update;

  if not found then
    raise exception 'Job Order not found.';
  end if;
  if v_job_order.production_date is null then
    raise exception 'Job Order Production Date is required before completing production.';
  end if;
  if v_job_order.start_time is null then
    raise exception 'Job Order Start Time is required before completing production.';
  end if;

  new.end_date := coalesce(nullif(current_setting('feedx.production_end_date', true), '')::date, new.end_date);
  new.expiry_date := coalesce(nullif(current_setting('feedx.production_expiry_date', true), '')::date, new.expiry_date);
  new.storage_location_id := coalesce(nullif(current_setting('feedx.production_storage_location_id', true), '')::uuid, new.storage_location_id);
  new.expiry_override_reason := coalesce(
    nullif(btrim(coalesce(current_setting('feedx.production_expiry_override_reason', true), '')), ''),
    nullif(btrim(coalesce(new.expiry_override_reason, '')), '')
  );

  if new.end_date is null then
    raise exception 'End Date is required.';
  end if;
  if new.end_time is null then
    raise exception 'End Time is required.';
  end if;

  v_start_at := v_job_order.production_date + v_job_order.start_time;
  v_end_at := new.end_date + new.end_time;
  if v_end_at < v_start_at then
    raise exception 'Production End Date and Time cannot be earlier than Start Date and Time.';
  end if;

  if new.actual_pack_qty is null
     or new.actual_pack_qty <= 0
     or new.actual_pack_qty <> trunc(new.actual_pack_qty) then
    raise exception 'Actual Pack Qty must be a whole number greater than zero.';
  end if;

  select finished_good.*
  into v_finished_good
  from public.factory_finished_goods finished_good
  where finished_good.id = new.finished_good_id;

  if not found then
    raise exception 'Packaging SKU not found.';
  end if;

  new.production_date := v_job_order.production_date;
  new.start_time := v_job_order.start_time;
  new.shelf_life_days_snapshot := v_finished_good.shelf_life_days;

  if v_finished_good.shelf_life_days is not null then
    v_expected_expiry := v_job_order.production_date + v_finished_good.shelf_life_days;
    if new.expiry_date is null then
      raise exception 'Expiry Date is required for this Packaging SKU.';
    end if;
    if new.expiry_date = v_expected_expiry then
      new.expiry_override_reason := null;
    elsif new.expiry_override_reason is null then
      raise exception 'Expiry override reason is required when changing the calculated Expiry Date.';
    end if;
  else
    new.expiry_override_reason := null;
  end if;

  if new.expiry_date is not null and new.expiry_date < v_job_order.production_date then
    raise exception 'Expiry Date cannot be earlier than Manufacturing Date.';
  end if;

  if new.storage_location_id is not null then
    select location.*
    into v_location
    from public.factory_storage_locations location
    where location.id = new.storage_location_id;

    if not found
       or lower(coalesce(v_location.status, '')) <> 'active'
       or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
      raise exception 'Select an active Finished Goods Area for Production storage.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists factory_guard_production_completion_details_trigger
on public.factory_productions;
create trigger factory_guard_production_completion_details_trigger
before insert on public.factory_productions
for each row execute function public.factory_guard_production_completion_details();

revoke execute on function public.factory_guard_production_completion_details()
from public, anon, authenticated;

-- Keep the established accounting RPC unchanged. This trusted wrapper validates
-- permission, supplies batch metadata transaction-locally, and invokes the
-- existing transaction so trigger failures occur before any accounting writes.
create or replace function public.factory_complete_production_with_batch(
  p_job_order_id uuid,
  p_finished_good_id uuid,
  p_production_no text,
  p_product_name text,
  p_batch_no text,
  p_production_date date,
  p_operator_id uuid,
  p_operator_name text,
  p_start_time time,
  p_end_time time,
  p_actual_produced_qty numeric,
  p_good_output_qty numeric,
  p_wastage_qty numeric,
  p_uom text,
  p_qc_status text,
  p_production_sop_id uuid,
  p_sop_version text,
  p_notes text,
  p_created_by uuid,
  p_usage_items jsonb,
  p_actual_pack_qty numeric default null,
  p_actual_output_qty numeric default null,
  p_end_date date default null,
  p_expiry_date date default null,
  p_storage_location_id uuid default null,
  p_expiry_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_production_id uuid;
  v_job_production_date date;
  v_job_start_time time;
begin
  if not public.current_user_has_permission('factory_production.complete') then
    raise exception 'Missing permission to complete production.';
  end if;
  if p_end_date is null then
    raise exception 'End Date is required.';
  end if;

  select job.production_date, job.start_time
  into v_job_production_date, v_job_start_time
  from public.factory_job_orders job
  where job.id = p_job_order_id;
  if not found then
    raise exception 'Job Order not found.';
  end if;
  if v_job_production_date is null then
    raise exception 'Job Order Production Date is required before completing production.';
  end if;
  if v_job_start_time is null then
    raise exception 'Job Order Start Time is required before completing production.';
  end if;

  perform set_config('feedx.production_end_date', p_end_date::text, true);
  perform set_config('feedx.production_expiry_date', coalesce(p_expiry_date::text, ''), true);
  perform set_config('feedx.production_storage_location_id', coalesce(p_storage_location_id::text, ''), true);
  perform set_config('feedx.production_expiry_override_reason', coalesce(p_expiry_override_reason, ''), true);

  v_production_id := public.factory_complete_production(
    p_job_order_id,
    p_finished_good_id,
    p_production_no,
    p_product_name,
    p_batch_no,
    v_job_production_date,
    p_operator_id,
    p_operator_name,
    v_job_start_time,
    p_end_time,
    p_actual_produced_qty,
    p_good_output_qty,
    p_wastage_qty,
    p_uom,
    p_qc_status,
    p_production_sop_id,
    p_sop_version,
    p_notes,
    p_created_by,
    p_usage_items,
    p_actual_pack_qty,
    p_actual_output_qty
  );

  return v_production_id;
end;
$$;

revoke execute on function public.factory_complete_production(
  uuid, uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, uuid, text, text, uuid, jsonb, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.factory_complete_production_with_batch(
  uuid, uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, uuid, text, text, uuid, jsonb,
  numeric, numeric, date, date, uuid, text
) to authenticated;

revoke execute on function public.factory_complete_production_with_batch(
  uuid, uuid, text, text, text, date, uuid, text, time, time,
  numeric, numeric, numeric, text, text, uuid, text, text, uuid, jsonb,
  numeric, numeric, date, date, uuid, text
) from public, anon;
