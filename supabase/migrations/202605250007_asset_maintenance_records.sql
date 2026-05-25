-- Maintenance records are available only for maintenance-enabled asset categories.

create table if not exists public.asset_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.asset_items(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  date date not null default current_date,
  issue text not null default '',
  action_taken text not null default '',
  vendor text,
  cost numeric not null default 0,
  status text not null default 'scheduled',
  remark text,
  photo_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_maintenance_records_status_check
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled'))
);

create index if not exists asset_maintenance_records_asset_idx
on public.asset_maintenance_records (asset_id, date desc);

create index if not exists asset_maintenance_records_outlet_idx
on public.asset_maintenance_records (outlet_id, date desc);

grant select, insert, update, delete on table public.asset_maintenance_records to authenticated;
revoke all on table public.asset_maintenance_records from anon;

alter table public.asset_maintenance_records enable row level security;

drop policy if exists "asset tracking scoped maintenance select" on public.asset_maintenance_records;
create policy "asset tracking scoped maintenance select"
on public.asset_maintenance_records for select to authenticated
using (public.current_user_has_permission('asset_tracking.view') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped maintenance insert" on public.asset_maintenance_records;
create policy "asset tracking scoped maintenance insert"
on public.asset_maintenance_records for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.manage') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped maintenance update" on public.asset_maintenance_records;
create policy "asset tracking scoped maintenance update"
on public.asset_maintenance_records for update to authenticated
using (public.current_user_has_permission('asset_tracking.manage') and public.current_user_can_access_outlet(outlet_id))
with check (public.current_user_has_permission('asset_tracking.manage') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped maintenance delete" on public.asset_maintenance_records;
create policy "asset tracking scoped maintenance delete"
on public.asset_maintenance_records for delete to authenticated
using (public.current_user_has_permission('asset_tracking.delete') and public.current_user_can_access_outlet(outlet_id));
