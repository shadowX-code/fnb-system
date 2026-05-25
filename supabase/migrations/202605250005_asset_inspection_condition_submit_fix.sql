-- Repair Asset Inspection condition constraints and asset photo storage.
-- This migration is safe to run after earlier Asset Tracking migrations.

alter table public.asset_items
  add column if not exists condition text not null default 'healthy';

alter table public.asset_inspection_items
  add column if not exists condition text not null default 'healthy';

do $$
begin
  alter table public.asset_items
    drop constraint if exists asset_items_condition_check;

  alter table public.asset_items
    drop constraint if exists asset_items_status_check;

  alter table public.asset_inspection_items
    drop constraint if exists asset_inspection_items_condition_status_check;

  alter table public.asset_inspection_items
    drop constraint if exists asset_inspection_items_condition_check;
end $$;

update public.asset_items
set condition = case
  when condition in ('good', 'active') then 'healthy'
  when condition = 'need_repair' then 'needs_review'
  when condition in ('healthy', 'needs_review', 'damaged', 'missing', 'under_maintenance', 'low_quantity', 'disposed', 'inactive') then condition
  when status in ('damaged', 'missing', 'disposed', 'inactive') then status
  else 'healthy'
end;

update public.asset_items
set status = case
  when status = 'inactive' then 'inactive'
  else 'active'
end
where status is null
   or status not in ('active', 'inactive');

update public.asset_inspection_items
set condition_status = case
  when condition_status in ('good', 'active') then 'healthy'
  when condition_status = 'need_repair' then 'needs_review'
  when condition_status in ('healthy', 'needs_review', 'damaged', 'missing', 'under_maintenance', 'low_quantity', 'disposed', 'inactive') then condition_status
  else 'healthy'
end;

update public.asset_inspection_items
set condition = case
  when condition in ('good', 'active') then 'healthy'
  when condition = 'need_repair' then 'needs_review'
  when condition in ('healthy', 'needs_review', 'damaged', 'missing', 'under_maintenance', 'low_quantity', 'disposed', 'inactive') then condition
  when condition_status in ('healthy', 'needs_review', 'damaged', 'missing', 'under_maintenance', 'low_quantity', 'disposed', 'inactive') then condition_status
  else 'healthy'
end;

do $$
begin
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
    add constraint asset_items_status_check
    check (status in ('active', 'inactive'));

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

  alter table public.asset_inspection_items
    add constraint asset_inspection_items_condition_check
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
end $$;

create index if not exists asset_items_condition_idx
  on public.asset_items (condition, outlet_id);

insert into storage.buckets (id, name, public)
values ('asset-photos', 'asset-photos', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "asset tracking viewers can view asset photos" on storage.objects;
create policy "asset tracking viewers can view asset photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'asset-photos'
  and public.current_user_has_permission('asset_tracking.view')
);

drop policy if exists "asset tracking editors can upload asset photos" on storage.objects;
create policy "asset tracking editors can upload asset photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'asset-photos'
  and (
    public.current_user_has_permission('asset_tracking.create')
    or public.current_user_has_permission('asset_tracking.edit')
    or public.current_user_has_permission('asset_tracking.manage')
  )
);

drop policy if exists "asset tracking editors can update asset photos" on storage.objects;
create policy "asset tracking editors can update asset photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'asset-photos'
  and (
    public.current_user_has_permission('asset_tracking.create')
    or public.current_user_has_permission('asset_tracking.edit')
    or public.current_user_has_permission('asset_tracking.manage')
  )
)
with check (
  bucket_id = 'asset-photos'
  and (
    public.current_user_has_permission('asset_tracking.create')
    or public.current_user_has_permission('asset_tracking.edit')
    or public.current_user_has_permission('asset_tracking.manage')
  )
);
