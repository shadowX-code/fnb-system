-- Asset Tracking UI enhancement fields.
-- Adds optional asset image support and expands operational status values.

alter table public.asset_items
  add column if not exists image_url text;

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
end $$;
