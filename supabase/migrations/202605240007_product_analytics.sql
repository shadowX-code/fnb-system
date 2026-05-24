-- Product Analytics module
-- Monthly POS product sales report uploads and product performance analytics.

create extension if not exists pgcrypto;

insert into public.permissions (code, module, description)
values
  ('product_analytics.view', 'Product Analytics', 'View Product Analytics.'),
  ('product_analytics.upload', 'Product Analytics', 'Upload product sales reports.'),
  ('product_analytics.export', 'Product Analytics', 'Export Product Analytics.'),
  ('product_analytics.manage', 'Product Analytics', 'Manage uploaded product sales reports.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'product_analytics.%'
on conflict do nothing;

create table if not exists public.product_sales_reports (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  report_month integer not null check (report_month between 1 and 12),
  report_year integer not null check (report_year between 2020 and 2100),
  file_name text not null,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'completed' check (status in ('uploaded', 'completed', 'replaced', 'failed')),
  total_net_sales numeric not null default 0,
  total_quantity numeric not null default 0,
  total_discount numeric not null default 0,
  raw_metadata jsonb not null default '{}'::jsonb,
  unique (outlet_id, report_month, report_year)
);

create table if not exists public.product_sales_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.product_sales_reports(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  category_name text not null,
  product_name text not null,
  variant_name text,
  quantity numeric not null default 0,
  gross_sales numeric not null default 0,
  discount numeric not null default 0,
  sst numeric not null default 0,
  service_charge numeric not null default 0,
  nett_sales numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_sales_reports_outlet_period_idx on public.product_sales_reports (outlet_id, report_year, report_month);
create index if not exists product_sales_items_report_idx on public.product_sales_items (report_id);
create index if not exists product_sales_items_outlet_idx on public.product_sales_items (outlet_id);
create index if not exists product_sales_items_product_idx on public.product_sales_items (product_name);
create index if not exists product_sales_items_category_idx on public.product_sales_items (category_name);

grant select, insert, update, delete on table public.product_sales_reports to authenticated;
grant select, insert, update, delete on table public.product_sales_items to authenticated;
revoke all on table public.product_sales_reports from anon;
revoke all on table public.product_sales_items from anon;

alter table public.product_sales_reports enable row level security;
alter table public.product_sales_items enable row level security;

drop policy if exists "product analytics viewers can view reports" on public.product_sales_reports;
create policy "product analytics viewers can view reports"
on public.product_sales_reports for select to authenticated
using (
  public.current_user_has_permission('product_analytics.view')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics uploaders can create reports" on public.product_sales_reports;
create policy "product analytics uploaders can create reports"
on public.product_sales_reports for insert to authenticated
with check (
  public.current_user_has_permission('product_analytics.upload')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics managers can update reports" on public.product_sales_reports;
create policy "product analytics managers can update reports"
on public.product_sales_reports for update to authenticated
using (
  public.current_user_has_permission('product_analytics.manage')
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('product_analytics.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics uploaders can delete reports" on public.product_sales_reports;
create policy "product analytics uploaders can delete reports"
on public.product_sales_reports for delete to authenticated
using (
  (
    public.current_user_has_permission('product_analytics.upload')
    or public.current_user_has_permission('product_analytics.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics viewers can view items" on public.product_sales_items;
create policy "product analytics viewers can view items"
on public.product_sales_items for select to authenticated
using (
  public.current_user_has_permission('product_analytics.view')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics uploaders can create items" on public.product_sales_items;
create policy "product analytics uploaders can create items"
on public.product_sales_items for insert to authenticated
with check (
  public.current_user_has_permission('product_analytics.upload')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics uploaders can delete items" on public.product_sales_items;
create policy "product analytics uploaders can delete items"
on public.product_sales_items for delete to authenticated
using (
  (
    public.current_user_has_permission('product_analytics.upload')
    or public.current_user_has_permission('product_analytics.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

do $$
begin
  if to_regclass('public.outlets') is not null then
    execute 'drop policy if exists "outlet viewers can view outlets" on public.outlets';
    execute '
      create policy "outlet viewers can view outlets"
      on public.outlets for select to authenticated
      using (
        (
          public.current_user_has_permission(''outlets.view'')
          or public.current_user_has_permission(''dashboard.view'')
          or public.current_user_has_permission(''sales_input.view'')
          or public.current_user_has_permission(''sales_comparison.view'')
          or public.current_user_has_permission(''purchase_input.view'')
          or public.current_user_has_permission(''purchase_comparison.view'')
          or public.current_user_has_permission(''data_import.view'')
          or public.current_user_has_permission(''data_health.view'')
          or public.current_user_has_permission(''alerts.view'')
          or public.current_user_has_permission(''outlet_pnl.view'')
          or public.current_user_has_permission(''operating_expenses.view'')
          or public.current_user_has_permission(''duty_roster.view'')
          or public.current_user_has_permission(''outlet_duty_roster.view'')
          or public.current_user_has_permission(''asset_tracking.view'')
          or public.current_user_has_permission(''product_analytics.view'')
        )
        and public.current_user_can_access_outlet(id)
      )';
  end if;
end $$;
