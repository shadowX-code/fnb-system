-- Asset Tracking UI enhancement fields.
-- Adds optional asset image support and expands operational status values.

alter table public.asset_items
  add column if not exists image_url text,
  add column if not exists thumbnail_url text,
  add column if not exists health_status text not null default 'healthy',
  add column if not exists last_inspection_at timestamptz;

update public.asset_items
set thumbnail_url = image_url
where thumbnail_url is null
  and image_url is not null;

do $$
begin
  alter table public.asset_items
    drop constraint if exists asset_items_status_check;

  alter table public.asset_items
    add constraint asset_items_status_check
    check (
      status in (
        'active',
        'healthy',
        'needs_review',
        'damaged',
        'missing',
        'under_maintenance',
        'low_quantity',
        'disposed',
        'inactive'
      )
    );

  alter table public.asset_items
    drop constraint if exists asset_items_health_status_check;

  alter table public.asset_items
    add constraint asset_items_health_status_check
    check (health_status in ('healthy', 'low', 'critical', 'out', 'needs_review'));
end $$;
