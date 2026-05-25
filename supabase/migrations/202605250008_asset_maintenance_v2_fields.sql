alter table public.asset_items
  add column if not exists maintenance_override text not null default 'inherit';

alter table public.asset_items
  drop constraint if exists asset_items_maintenance_override_check;

alter table public.asset_items
  add constraint asset_items_maintenance_override_check
  check (maintenance_override in ('inherit', 'enabled', 'disabled'));

alter table public.asset_maintenance_records
  add column if not exists maintenance_type text not null default 'repair',
  add column if not exists priority text not null default 'medium',
  add column if not exists scheduled_date date,
  add column if not exists completed_date date,
  add column if not exists next_service_date date;

update public.asset_maintenance_records
set scheduled_date = coalesce(scheduled_date, date)
where scheduled_date is null;

update public.asset_maintenance_records
set completed_date = coalesce(completed_date, date)
where completed_date is null
  and status = 'completed';

alter table public.asset_maintenance_records
  drop constraint if exists asset_maintenance_records_priority_check;

alter table public.asset_maintenance_records
  add constraint asset_maintenance_records_priority_check
  check (priority in ('low', 'medium', 'high', 'critical'));

alter table public.asset_maintenance_records
  drop constraint if exists asset_maintenance_records_type_check;

alter table public.asset_maintenance_records
  add constraint asset_maintenance_records_type_check
  check (maintenance_type in ('preventive', 'repair', 'inspection', 'cleaning', 'calibration', 'replacement', 'emergency'));

create index if not exists asset_maintenance_records_schedule_idx
on public.asset_maintenance_records (scheduled_date, status, priority);
