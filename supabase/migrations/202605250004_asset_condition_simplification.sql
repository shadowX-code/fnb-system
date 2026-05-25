-- Simplifies Asset Tracking condition handling.
-- Categories classify assets only; each asset carries its current operational condition.

alter table public.asset_items
  add column if not exists condition text not null default 'healthy';

update public.asset_items
set condition = case
  when status in ('healthy', 'needs_review', 'damaged', 'missing', 'under_maintenance', 'low_quantity', 'disposed', 'inactive') then status
  when health_status in ('low', 'critical', 'out', 'needs_review') then 'needs_review'
  else 'healthy'
end
where condition is null or condition = 'healthy';

update public.asset_items
set status = case
  when status = 'inactive' then 'inactive'
  else 'active'
end
where status is null
   or status not in ('active', 'inactive');

do $$
begin
  alter table public.asset_items
    drop constraint if exists asset_items_condition_check;

  alter table public.asset_items
    add constraint asset_items_condition_check
    check (condition in (
      'healthy',
      'needs_review',
      'damaged',
      'missing',
      'under_maintenance',
      'low_quantity',
      'disposed',
      'inactive'
    ));

  alter table public.asset_items
    drop constraint if exists asset_items_status_check;

  alter table public.asset_items
    add constraint asset_items_status_check
    check (status in ('active', 'inactive'));
end $$;

create index if not exists asset_items_condition_idx
  on public.asset_items (condition, outlet_id);

update public.asset_inspection_items
set condition_status = case
  when condition_status = 'good' then 'healthy'
  when condition_status = 'need_repair' then 'needs_review'
  else condition_status
end
where condition_status in ('good', 'need_repair');

do $$
begin
  alter table public.asset_inspection_items
    drop constraint if exists asset_inspection_items_condition_status_check;

  alter table public.asset_inspection_items
    add constraint asset_inspection_items_condition_status_check
    check (condition_status in (
      'healthy',
      'needs_review',
      'damaged',
      'missing',
      'under_maintenance',
      'low_quantity',
      'disposed',
      'inactive'
    ));
end $$;
