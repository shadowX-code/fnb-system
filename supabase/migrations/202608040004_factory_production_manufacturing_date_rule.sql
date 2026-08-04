-- Future Production batches use the validated Production End Date as their
-- Manufacturing Date. Historical factory_productions rows are not rewritten.

alter table public.factory_productions
  add column if not exists manufacturing_date date;

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

  -- Start remains authoritative on the Job Order; Manufacturing Date is the
  -- validated Production End Date for new completion records.
  new.production_date := v_job_order.production_date;
  new.start_time := v_job_order.start_time;
  new.manufacturing_date := new.end_date;
  new.shelf_life_days_snapshot := v_finished_good.shelf_life_days;

  if v_finished_good.shelf_life_days is not null then
    v_expected_expiry := new.end_date + v_finished_good.shelf_life_days;
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

  if new.expiry_date is not null and new.expiry_date < new.end_date then
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

revoke execute on function public.factory_guard_production_completion_details()
from public, anon, authenticated;
